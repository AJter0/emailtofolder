/**
 * Email to Folder for Chrome — background service worker.
 *
 * Responsibilities
 *  • Auto-sync Gmail (Gmail API) and Outlook / Office 365 (Microsoft Graph) on an alarm
 *  • Apply rules and save .eml + attachments into the Downloads folder
 *  • Handle requests from the popup, options page and Gmail / Outlook content scripts
 */
import * as gmail from './lib/providers/gmail.js';
import * as outlook from './lib/providers/outlook.js';
import { AuthRequiredError } from './lib/providers/gmail.js';
import { processRaw, preview } from './lib/processor.js';
import { base64ToBytes } from './lib/mime.js';
import { setSilent } from './lib/saver.js';
import {
  getAll,
  patchAccount,
  getProcessed,
  markProcessed,
  resetProcessed,
  clearLog,
  saveSettings,
  saveRules,
  DEFAULT_RULES
} from './lib/storage.js';

const PROVIDERS = { gmail, outlook };
const ALARM = 'etf-sync';
const HOUR = 3_600_000;
const DAY = 86_400_000;

// ---------------- serial queue (one email pipeline at a time) ----------------
let chain = Promise.resolve();
function serial(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

// ---------------- badge / notifications ----------------
async function setBadge(text, color = '#0a84ff') {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
}

async function notify(title, message) {
  const { settings } = await getAll();
  if (!settings.notify) return;
  chrome.notifications.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title,
    message,
    priority: 0
  });
}

// ---------------- alarm scheduling ----------------
async function schedule() {
  const { settings } = await getAll();
  await chrome.alarms.clear(ALARM);
  if (settings.autoSync) {
    const period = Math.max(1, Number(settings.syncInterval) || 5);
    await chrome.alarms.create(ALARM, { periodInMinutes: period, delayInMinutes: 0.5 });
  }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  const data = await chrome.storage.local.get(['rules', 'settings']);
  if (!Array.isArray(data.rules)) await saveRules(DEFAULT_RULES);
  if (!data.settings) await saveSettings({});
  await schedule();
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(schedule);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  const o = changes.settings.oldValue || {};
  const n = changes.settings.newValue || {};
  if (o.autoSync !== n.autoSync || o.syncInterval !== n.syncInterval) schedule();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) syncAll({ reason: 'alarm' });
});

// ---------------- sync ----------------
let syncing = false;

async function setSyncState(patch) {
  const { syncState } = await chrome.storage.local.get('syncState');
  await chrome.storage.local.set({ syncState: { ...(syncState || {}), ...patch } });
}

async function syncProvider(name, settings, summary) {
  const mod = PROVIDERS[name];
  const { accounts } = await getAll();
  const acc = accounts[name];
  if (!acc.connected) return;

  const startedAt = Date.now();
  try {
    const since = acc.since || startedAt;
    const ids = await mod.listNew(since - 10 * 60_000);
    const processed = await getProcessed(name);
    const todo = ids.filter((id) => !processed.has(id));
    const batch = todo.slice(0, Math.max(1, Number(settings.maxPerSync) || 25));
    let complete = batch.length === todo.length;

    for (const id of batch) {
      const { bytes } = await mod.getRaw(id);
      const res = await serial(() => processRaw(bytes, { source: name }));
      if (res.status === 'quota') {
        summary.quota = true;
        complete = false;
        break;
      }
      await markProcessed(name, id);
      if (res.status === 'saved') summary.saved += 1;
      else if (res.status === 'skipped') summary.skipped += 1;
      else summary.errors += 1;
    }

    const patch = { lastSync: Date.now(), lastError: '' };
    // Move the window forward only when everything up to now was handled.
    if (complete) patch.since = Math.max(since, startedAt - HOUR);
    await patchAccount(name, patch);
  } catch (e) {
    summary.errors += 1;
    const needsAuth = e instanceof AuthRequiredError || e.name === 'AuthRequiredError';
    const msg = needsAuth ? 'ต้องเชื่อมต่อบัญชีใหม่ (session หมดอายุ) — เปิด Options แล้วกด Connect อีกครั้ง' : e.message;
    await patchAccount(name, { lastError: msg, lastSync: Date.now() });
    summary.messages.push(`${name}: ${msg}`);
  }
}

async function syncAll({ reason = 'manual' } = {}) {
  if (syncing) return { busy: true };
  syncing = true;
  const summary = { saved: 0, skipped: 0, errors: 0, quota: false, messages: [] };
  await setSyncState({ running: true, startedAt: Date.now(), reason });

  const { settings } = await getAll();
  if (settings.silentDownloads) await setSilent(true);
  try {
    for (const name of Object.keys(PROVIDERS)) await syncProvider(name, settings, summary);
  } finally {
    if (settings.silentDownloads) await setSilent(false);
    syncing = false;
    await setSyncState({ running: false, lastRun: Date.now(), lastResult: summary });
  }

  if (summary.errors || summary.quota) await setBadge('!', '#ff453a');
  else if (summary.saved) await setBadge(String(summary.saved), '#0a84ff');
  else await setBadge('');

  if (summary.saved) {
    await notify('Email to Folder', `จัดเก็บอีเมลใหม่ ${summary.saved} ฉบับเรียบร้อยแล้ว`);
  }
  if (summary.quota) {
    await notify('Email to Folder — โควตาเต็ม', 'ครบ 100 ฉบับของเดือนนี้แล้ว จะรีเซ็ตอัตโนมัติวันที่ 1 ของเดือนถัดไป');
  }
  return summary;
}

// ---------------- manual saves (content scripts / popup) ----------------
async function saveMessages(provider, ids) {
  const mod = PROVIDERS[provider];
  const results = [];
  const { settings } = await getAll();
  if (settings.silentDownloads) await setSilent(true);
  try {
    for (const id of ids) {
      const { bytes } = await mod.getRaw(id);
      const res = await serial(() => processRaw(bytes, { source: provider, manual: true }));
      if (res.status === 'quota') {
        results.push(res);
        break;
      }
      await markProcessed(provider, id);
      results.push(res);
    }
  } finally {
    if (settings.silentDownloads) await setSilent(false);
  }
  return results;
}

async function handle(msg) {
  switch (msg.type) {
    case 'getState': {
      const all = await getAll();
      const { syncState } = await chrome.storage.local.get('syncState');
      // Never leak tokens to UI pages
      const safe = JSON.parse(JSON.stringify(all.accounts));
      delete safe.gmail.token;
      delete safe.outlook.accessToken;
      delete safe.outlook.refreshToken;
      return {
        ...all,
        accounts: safe,
        syncState: { ...(syncState || {}), running: syncing },
        redirectUri: chrome.identity.getRedirectURL(),
        extensionId: chrome.runtime.id,
        version: chrome.runtime.getManifest().version
      };
    }
    case 'connect': {
      const { settings } = await getAll();
      const since = Date.now() - Math.max(0, Number(settings.backfillDays) || 0) * DAY;
      await patchAccount(msg.provider, { since });
      const email = await PROVIDERS[msg.provider].connect();
      await patchAccount(msg.provider, { since });
      return { email };
    }
    case 'disconnect':
      await PROVIDERS[msg.provider].disconnect();
      return { ok: true };
    case 'backfill': {
      const days = Math.max(1, Number(msg.days) || 7);
      await patchAccount(msg.provider, { since: Date.now() - days * DAY });
      return syncAll({ reason: 'backfill' });
    }
    case 'syncNow':
      return syncAll({ reason: 'manual' });
    case 'processFile': {
      const bytes = base64ToBytes(msg.b64);
      const isMsg = /\.msg$/i.test(msg.name || '');
      if (isMsg) {
        return { status: 'error', message: 'ไฟล์ .msg (Outlook Classic) ยังไม่รองรับในเวอร์ชันเบราว์เซอร์ — กรุณาใช้ไฟล์ .eml หรือโปรแกรม Desktop' };
      }
      const fallbackSubject = (msg.name || '').replace(/\.[^.]+$/, '');
      return serial(() => processRaw(bytes, { source: 'manual', manual: true, fallbackSubject }));
    }
    case 'previewFile': {
      const bytes = base64ToBytes(msg.b64);
      const { parsed, rule, plan } = await preview(bytes, { source: msg.source || 'manual', manual: false });
      return {
        subject: parsed.subject,
        from: parsed.from.text,
        to: parsed.to.text,
        date: parsed.date ? parsed.date.toISOString() : '',
        attachments: parsed.attachments.map((a) => ({ filename: a.filename, size: a.size, related: a.related })),
        rule: rule ? rule.name : null,
        files: plan ? plan.files.map((f) => f.path) : []
      };
    }
    case 'saveGmail': {
      let ids = Array.isArray(msg.messageIds) ? msg.messageIds.filter(Boolean) : [];
      if (!ids.length && msg.threadId) ids = await gmail.threadMessageIds(msg.threadId);
      if (!ids.length) throw new Error('ไม่พบอีเมลที่เปิดอยู่');
      const { accounts } = await getAll();
      if (!accounts.gmail.connected) throw new Error('ยังไม่ได้เชื่อมต่อ Gmail — เปิด Options เพื่อเชื่อมต่อ');
      return { results: await saveMessages('gmail', ids) };
    }
    case 'saveOutlook': {
      const { accounts } = await getAll();
      if (!accounts.outlook.connected) throw new Error('ยังไม่ได้เชื่อมต่อ Outlook — เปิด Options เพื่อเชื่อมต่อ');
      const id = await outlook.resolveWebId(msg.webId);
      return { results: await saveMessages('outlook', [id]) };
    }
    case 'clearLog':
      await clearLog();
      return { ok: true };
    case 'resetProcessed':
      await resetProcessed(msg.provider);
      return { ok: true };
    case 'clearBadge':
      await setBadge('');
      return { ok: true };
    case 'openOptions':
      chrome.runtime.openOptionsPage();
      return { ok: true };
    default:
      throw new Error(`Unknown message: ${msg.type}`);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target === 'offscreen' || !msg.type) return false;
  handle(msg)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((e) => sendResponse({ ok: false, error: e && e.message ? e.message : String(e) }));
  return true; // async response
});

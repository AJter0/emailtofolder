/**
 * Email to Folder — chrome.storage helpers & defaults.
 */
import { normalizeQuota } from './rules.js';

export const DEFAULT_SETTINGS = {
  rootFolder: 'EmailToFolder',
  manualFolder: 'Manual',
  autoSync: true,
  syncInterval: 5, // minutes
  backfillDays: 0, // 0 = only emails received after connecting
  maxPerSync: 25,
  silentDownloads: true,
  eraseHistory: false,
  skipInlineImages: true,
  notify: true,
  lang: 'th'
};

export const DEFAULT_ACCOUNTS = {
  gmail: { clientId: '', connected: false, email: '', token: '', expiresAt: 0, since: 0, lastSync: 0, lastError: '' },
  outlook: {
    clientId: '',
    tenant: 'common',
    connected: false,
    email: '',
    accessToken: '',
    refreshToken: '',
    expiresAt: 0,
    since: 0,
    lastSync: 0,
    lastError: ''
  }
};

export function newRuleId() {
  return 'r_' + Math.random().toString(36).slice(2, 10);
}

export const DEFAULT_RULES = [
  {
    id: 'r_invoice',
    name: 'ใบแจ้งหนี้ / Invoices',
    enabled: true,
    source: 'any',
    conditionType: 'subject_contains',
    conditionValue: 'invoice',
    targetFolder: 'Finance/Invoices',
    subfolderMode: 'year_month',
    saveEml: true,
    saveAttachments: true,
    prefixAttachments: true
  },
  {
    id: 'r_all',
    name: 'อีเมลขาเข้าทั้งหมด / All Incoming',
    enabled: true,
    source: 'any',
    conditionType: 'all_emails',
    conditionValue: '',
    targetFolder: 'Inbox',
    subfolderMode: 'year_month',
    saveEml: true,
    saveAttachments: true,
    prefixAttachments: false
  }
];

const LOG_LIMIT = 1000;
const PROCESSED_LIMIT = 5000;

export async function getAll() {
  const data = await chrome.storage.local.get(['settings', 'accounts', 'rules', 'quota', 'log']);
  return {
    settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) },
    accounts: {
      gmail: { ...DEFAULT_ACCOUNTS.gmail, ...((data.accounts || {}).gmail || {}) },
      outlook: { ...DEFAULT_ACCOUNTS.outlook, ...((data.accounts || {}).outlook || {}) }
    },
    rules: Array.isArray(data.rules) ? data.rules : DEFAULT_RULES,
    quota: normalizeQuota(data.quota),
    log: Array.isArray(data.log) ? data.log : []
  };
}

export async function getSettings() {
  return (await getAll()).settings;
}

export async function saveSettings(patch) {
  const settings = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings });
  return settings;
}

export async function getAccounts() {
  return (await getAll()).accounts;
}

export async function patchAccount(provider, patch) {
  const accounts = await getAccounts();
  accounts[provider] = { ...accounts[provider], ...patch };
  await chrome.storage.local.set({ accounts });
  return accounts[provider];
}

export async function getRules() {
  return (await getAll()).rules;
}

export async function saveRules(rules) {
  await chrome.storage.local.set({ rules });
  return rules;
}

export async function getQuota() {
  return (await getAll()).quota;
}

export async function saveQuota(quota) {
  await chrome.storage.local.set({ quota: normalizeQuota(quota) });
}

export async function appendLog(entry) {
  const { log } = await chrome.storage.local.get('log');
  const list = Array.isArray(log) ? log : [];
  list.unshift({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), time: Date.now(), ...entry });
  if (list.length > LOG_LIMIT) list.length = LOG_LIMIT;
  await chrome.storage.local.set({ log: list });
}

export async function clearLog() {
  await chrome.storage.local.set({ log: [] });
}

// ---------- processed message tracker (prevents duplicates) ----------

export async function getProcessed(provider) {
  const key = `processed_${provider}`;
  const data = await chrome.storage.local.get(key);
  return new Set(Array.isArray(data[key]) ? data[key] : []);
}

export async function markProcessed(provider, id) {
  const key = `processed_${provider}`;
  const data = await chrome.storage.local.get(key);
  const list = Array.isArray(data[key]) ? data[key] : [];
  if (!list.includes(id)) list.push(id);
  if (list.length > PROCESSED_LIMIT) list.splice(0, list.length - PROCESSED_LIMIT);
  await chrome.storage.local.set({ [key]: list });
}

export async function resetProcessed(provider) {
  await chrome.storage.local.remove(`processed_${provider}`);
}

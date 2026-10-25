import { bytesToBase64 } from '../lib/mime.js';
import { saveSettings } from '../lib/storage.js';

const $ = (id) => document.getElementById(id);

function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...payload }, (res) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!res || !res.ok) return reject(new Error((res && res.error) || 'Request failed'));
      resolve(res.data);
    });
  });
}

function setLang(lang) {
  const l = lang === 'en' ? 'en' : 'th';
  document.documentElement.lang = l;
  $('langBtn').textContent = l.toUpperCase();
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

function renderAccount(provider, acc, lang) {
  const dot = $(`${provider}Dot`);
  const status = $(`${provider}Status`);
  const btn = $(`${provider}ActionBtn`);

  dot.className = 'acc-dot';
  if (acc.connected) {
    dot.classList.add(acc.lastError ? 'err' : 'on');
    status.textContent = acc.lastError ? `⚠ ${acc.lastError}` : acc.email || 'Connected';
    btn.textContent = lang === 'en' ? 'Manage' : 'จัดการ';
  } else if (acc.clientId) {
    status.textContent = lang === 'en' ? 'Ready to connect' : 'พร้อมเชื่อมต่อ';
    btn.textContent = lang === 'en' ? 'Connect' : 'เชื่อมต่อ';
  } else {
    status.textContent = lang === 'en' ? 'Not configured' : 'ยังไม่ได้ตั้งค่า Client ID';
    btn.textContent = lang === 'en' ? 'Setup' : 'ตั้งค่า';
  }

  btn.onclick = async () => {
    if (!acc.connected && acc.clientId) {
      btn.disabled = true;
      try {
        await send('connect', { provider });
        await refresh();
      } catch (e) {
        status.textContent = `⚠ ${e.message}`;
      } finally {
        btn.disabled = false;
      }
    } else {
      chrome.runtime.openOptionsPage();
    }
  };
}

function renderLogs(logs, lang) {
  const box = $('logList');
  const recent = (logs || []).slice(0, 5);
  if (!recent.length) {
    box.innerHTML = `<div class="empty-log">${
      lang === 'en' ? 'No archived emails yet.' : 'ยังไม่มีประวัติการจัดเก็บอีเมล'
    }</div>`;
    return;
  }
  box.innerHTML = recent
    .map((item) => {
      const badgeLabel =
        item.status === 'saved'
          ? lang === 'en'
            ? 'SAVED'
            : 'บันทึกแล้ว'
          : item.status === 'skipped'
          ? lang === 'en'
            ? 'SKIPPED'
            : 'ข้าม'
          : 'ERROR';
      const meta =
        item.status === 'saved'
          ? `📁 ${item.destDir} · ${(item.files || []).length} ${lang === 'en' ? 'files' : 'ไฟล์'}`
          : item.message || '';
      return `
        <div class="log-item">
          <div class="log-top">
            <span class="log-subj">${esc(item.subject || '(No Subject)')}</span>
            <span class="log-badge ${esc(item.status)}">${badgeLabel}</span>
          </div>
          <div class="log-meta">${esc(meta)}</div>
        </div>
      `;
    })
    .join('');
}

async function refresh() {
  const state = await send('getState');
  const lang = (state.settings && state.settings.lang) || 'th';
  setLang(lang);

  $('versionText').textContent = `v${state.version || '1.0.0'} · Chrome Extension`;

  const q = state.quota || { used: 0, limit: 100, isUnlimited: false };
  $('quotaText').textContent = q.isUnlimited ? `${q.used} / ∞` : `${q.used} / ${q.limit}`;
  const pct = q.isUnlimited ? 15 : Math.min(100, Math.round((q.used / Math.max(1, q.limit)) * 100));
  $('quotaBar').style.width = `${pct}%`;

  const activeCount = (state.rules || []).filter((r) => r.enabled).length;
  $('activeRulesText').textContent =
    lang === 'en' ? `${activeCount} active rules` : `${activeCount} กฎที่เปิดใช้งาน`;
  $('rootFolderText').textContent = `Downloads/${(state.settings && state.settings.rootFolder) || 'EmailToFolder'}`;

  renderAccount('gmail', state.accounts.gmail, lang);
  renderAccount('outlook', state.accounts.outlook, lang);
  renderLogs(state.log, lang);
}

async function handleFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  const status = $('syncStatus');
  let savedCount = 0;
  for (const file of files) {
    status.textContent = `กำลังประมวลผล ${file.name}...`;
    const buf = new Uint8Array(await file.arrayBuffer());
    const b64 = bytesToBase64(buf);
    const res = await send('processFile', { name: file.name, b64 });
    if (res.status === 'saved') savedCount++;
    else if (res.message) status.textContent = res.message;
  }
  if (savedCount) {
    status.textContent = `✓ จัดเก็บไฟล์ .eml สำเร็จ ${savedCount} ฉบับ`;
  }
  await refresh();
}

document.addEventListener('DOMContentLoaded', async () => {
  send('clearBadge').catch(() => {});
  await refresh();

  $('openOptionsBtn').onclick = () => chrome.runtime.openOptionsPage();
  $('viewAllLogsBtn').onclick = () => chrome.runtime.openOptionsPage();

  $('langBtn').onclick = async () => {
    const next = document.documentElement.lang === 'th' ? 'en' : 'th';
    await saveSettings({ lang: next });
    await refresh();
  };

  $('syncNowBtn').onclick = async () => {
    const btn = $('syncNowBtn');
    const status = $('syncStatus');
    btn.disabled = true;
    status.textContent = document.documentElement.lang === 'en' ? 'Syncing inbox...' : 'กำลังซิงก์อีเมลจาก Inbox...';
    try {
      const res = await send('syncNow');
      if (res.busy) {
        status.textContent = 'กำลังซิงก์อยู่แล้ว...';
      } else {
        status.textContent =
          document.documentElement.lang === 'en'
            ? `✓ Saved ${res.saved} · Skipped ${res.skipped}${res.errors ? ` · Errors ${res.errors}` : ''}`
            : `✓ บันทึกใหม่ ${res.saved} ฉบับ · ข้าม ${res.skipped} ฉบับ${res.errors ? ` · ผิดพลาด ${res.errors}` : ''}`;
      }
      await refresh();
    } catch (e) {
      status.textContent = `⚠ ${e.message}`;
    } finally {
      btn.disabled = false;
    }
  };

  const dz = $('dropzone');
  const fi = $('fileInput');
  dz.onclick = () => fi.click();
  fi.onchange = () => {
    handleFiles(fi.files);
    fi.value = '';
  };
  dz.addEventListener('dragover', (e) => {
    e.preventDefault();
    dz.classList.add('drag');
  });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('drag');
    handleFiles(e.dataTransfer.files);
  });
});

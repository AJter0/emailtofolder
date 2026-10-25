import {
  saveRules,
  saveSettings,
  patchAccount,
  newRuleId
} from '../lib/storage.js';

const $ = (id) => document.getElementById(id);
let state = null;

function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...payload }, (res) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!res || !res.ok) return reject(new Error((res && res.error) || 'Request failed'));
      resolve(res.data);
    });
  });
}

function banner(text, err = false) {
  const el = $('bannerMsg');
  el.textContent = text;
  el.className = err ? 'banner err' : 'banner';
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => {
    el.hidden = true;
  }, 5000);
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

const COND_LABELS = {
  all_emails: 'อีเมลขาเข้าทั้งหมด',
  subject_contains: 'หัวข้อมีคำว่า',
  from_contains: 'ผู้ส่งมีคำว่า',
  to_contains: 'To/CC มีคำว่า',
  body_contains: 'เนื้อหามีคำว่า',
  has_attachment: 'มีไฟล์แนบ',
  attachment_name_contains: 'ชื่อไฟล์แนบมีคำว่า'
};

const SUBFOLDER_LABELS = {
  year_month: 'แยก ปี/เดือน (YYYY/MM)',
  sender: 'แยกตามชื่อผู้ส่ง',
  email: 'โฟลเดอร์แยกต่ออีเมล',
  none: 'ไม่แยกโฟลเดอร์ย่อย'
};

function renderRules() {
  const rules = state.rules || [];
  const root = (state.settings && state.settings.rootFolder) || 'EmailToFolder';
  $('rootPreviewLbl').textContent = root;

  const box = $('ruleList');
  if (!rules.length) {
    box.innerHTML = `<div class="card"><p class="mute">ยังไม่มีกฎการจัดเก็บ คลิก "+ เพิ่มกฎใหม่" เพื่อเริ่มต้น</p></div>`;
    return;
  }

  box.innerHTML = rules
    .map((r, idx) => {
      const condText =
        r.conditionType === 'all_emails' || r.conditionType === 'has_attachment'
          ? COND_LABELS[r.conditionType]
          : `${COND_LABELS[r.conditionType] || r.conditionType}: "${r.conditionValue || '*'}"`;
      const srcLabel = r.source === 'gmail' ? 'Gmail' : r.source === 'outlook' ? 'Outlook' : 'ทุกบัญชี';
      return `
        <div class="rule-card ${r.enabled ? '' : 'off'}" data-id="${esc(r.id)}">
          <div class="rule-main">
            <div class="rule-order">${idx + 1}</div>
            <div>
              <div class="rule-title">${esc(r.name)}</div>
              <div class="rule-desc">${esc(condText)}</div>
              <div class="rule-tags">
                <span class="tag folder">📁 Downloads/${esc(root)}/${esc(r.targetFolder)}</span>
                <span class="tag">${esc(SUBFOLDER_LABELS[r.subfolderMode || 'none'])}</span>
                <span class="tag">${esc(srcLabel)}</span>
                ${r.saveEml !== false ? '<span class="tag">.eml</span>' : ''}
                ${r.saveAttachments !== false ? '<span class="tag">+ ไฟล์แนบ</span>' : ''}
              </div>
            </div>
          </div>
          <div class="rule-actions">
            <button class="btn ghost sm" data-act="toggle" data-id="${esc(r.id)}">${
        r.enabled ? '🟢 เปิดอยู่' : '⚪ ปิดอยู่'
      }</button>
            <button class="btn ghost sm" data-act="up" data-id="${esc(r.id)}" ${idx === 0 ? 'disabled' : ''}>↑</button>
            <button class="btn ghost sm" data-act="down" data-id="${esc(r.id)}" ${
        idx === rules.length - 1 ? 'disabled' : ''
      }>↓</button>
            <button class="btn ghost sm" data-act="edit" data-id="${esc(r.id)}">แก้ไข</button>
            <button class="btn danger sm" data-act="del" data-id="${esc(r.id)}">ลบ</button>
          </div>
        </div>
      `;
    })
    .join('');

  box.querySelectorAll('button[data-act]').forEach((btn) => {
    btn.onclick = () => handleRuleAction(btn.dataset.act, btn.dataset.id);
  });
}

async function handleRuleAction(act, id) {
  const rules = [...(state.rules || [])];
  const idx = rules.findIndex((r) => r.id === id);
  if (idx === -1) return;

  if (act === 'toggle') {
    rules[idx].enabled = !rules[idx].enabled;
    await saveRules(rules);
    await refresh();
  } else if (act === 'up' && idx > 0) {
    [rules[idx - 1], rules[idx]] = [rules[idx], rules[idx - 1]];
    await saveRules(rules);
    await refresh();
  } else if (act === 'down' && idx < rules.length - 1) {
    [rules[idx + 1], rules[idx]] = [rules[idx], rules[idx + 1]];
    await saveRules(rules);
    await refresh();
  } else if (act === 'del') {
    rules.splice(idx, 1);
    await saveRules(rules);
    banner('ลบกฎเรียบร้อยแล้ว');
    await refresh();
  } else if (act === 'edit') {
    openRuleForm(rules[idx]);
  }
}

function updateCondValVisibility() {
  const t = $('ruleCondType').value;
  $('ruleCondValWrap').style.display = t === 'all_emails' || t === 'has_attachment' ? 'none' : 'flex';
}

function openRuleForm(rule = null) {
  const f = $('ruleForm');
  f.hidden = false;
  $('ruleFormTitle').textContent = rule ? `แก้ไขกฎ: ${rule.name}` : 'เพิ่มกฎการจัดเก็บใหม่';
  $('ruleId').value = rule ? rule.id : '';
  $('ruleName').value = rule ? rule.name : '';
  $('ruleSource').value = (rule && rule.source) || 'any';
  $('ruleCondType').value = (rule && rule.conditionType) || 'subject_contains';
  $('ruleCondVal').value = (rule && rule.conditionValue) || '';
  $('ruleTarget').value = (rule && rule.targetFolder) || 'Inbox';
  $('ruleSubfolder').value = (rule && rule.subfolderMode) || 'year_month';
  $('ruleSaveEml').checked = rule ? rule.saveEml !== false : true;
  $('ruleSaveAtt').checked = rule ? rule.saveAttachments !== false : true;
  $('rulePrefixAtt').checked = Boolean(rule && rule.prefixAttachments);
  updateCondValVisibility();
  f.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderAccounts() {
  $('extIdCode').textContent = state.extensionId || 'cidokheholdhfghadmjihmmdfoibipoh';
  $('redirectUriCode').textContent =
    state.redirectUri || 'https://cidokheholdhfghadmjihmmdfoibipoh.chromiumapp.org/';

  const g = state.accounts.gmail;
  $('gmailClientId').value = g.clientId || '';
  $('gmailBadge').textContent = g.connected ? `เชื่อมต่อแล้ว: ${g.email}` : 'ยังไม่เชื่อมต่อ';
  $('gmailBadge').className = g.connected ? 'status-pill on' : 'status-pill';
  $('disconnectGmailBtn').hidden = !g.connected;
  $('gmailBackfillBar').hidden = !g.connected;
  $('gmailMeta').textContent = g.lastError
    ? `⚠ ${g.lastError}`
    : g.lastSync
    ? `ซิงก์ล่าสุด: ${new Date(g.lastSync).toLocaleString('th-TH')}`
    : '';

  const o = state.accounts.outlook;
  $('outlookClientId').value = o.clientId || '';
  $('outlookTenant').value = o.tenant || 'common';
  $('outlookBadge').textContent = o.connected ? `เชื่อมต่อแล้ว: ${o.email}` : 'ยังไม่เชื่อมต่อ';
  $('outlookBadge').className = o.connected ? 'status-pill on' : 'status-pill';
  $('disconnectOutlookBtn').hidden = !o.connected;
  $('outlookBackfillBar').hidden = !o.connected;
  $('outlookMeta').textContent = o.lastError
    ? `⚠ ${o.lastError}`
    : o.lastSync
    ? `ซิงก์ล่าสุด: ${new Date(o.lastSync).toLocaleString('th-TH')}`
    : '';
}

function filteredLogs() {
  const q = ($('logSearch').value || '').toLowerCase().trim();
  const ruleFilter = $('logRuleFilter').value;
  const statusFilter = $('logStatusFilter').value;

  return (state.log || []).filter((item) => {
    if (ruleFilter && item.ruleName !== ruleFilter) return false;
    if (statusFilter && item.status !== statusFilter) return false;
    if (q) {
      const hay = `${item.subject || ''} ${item.from || ''} ${item.destDir || ''} ${(item.files || []).join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderLogs() {
  const sel = $('logRuleFilter');
  const current = sel.value;
  const ruleNames = Array.from(new Set((state.log || []).map((l) => l.ruleName).filter(Boolean)));
  sel.innerHTML =
    `<option value="">ทุกกฎ (All Rules)</option>` +
    ruleNames.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  sel.value = current;

  const rows = filteredLogs();
  const tbody = $('logTableBody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#6e6e73;padding:28px;">ยังไม่มีประวัติการจัดเก็บที่ตรงกับตัวกรอง</td></tr>`;
    return;
  }

  tbody.innerHTML = rows
    .map((r) => {
      const timeStr = r.time ? new Date(r.time).toLocaleString('th-TH') : '-';
      const statusCls = r.status === 'saved' ? 'pill-saved' : r.status === 'error' ? 'pill-error' : 'pill-skipped';
      const statusLbl = r.status === 'saved' ? '✓ บันทึกสำเร็จ' : r.status === 'error' ? '✕ ผิดพลาด' : '– ข้าม';
      return `
        <tr>
          <td>${esc(timeStr)}</td>
          <td>${esc((r.source || 'manual').toUpperCase())}</td>
          <td>
            <strong>${esc(r.subject || '(No Subject)')}</strong>
            <div class="mute">${esc(r.from || '')}</div>
          </td>
          <td>${esc(r.ruleName || '-')}</td>
          <td>${r.destDir ? `<code>Downloads/${esc(r.destDir)}</code>` : '-'}</td>
          <td>${esc((r.files || []).join(', ') || r.message || '-')}</td>
          <td class="${statusCls}">${statusLbl}</td>
        </tr>
      `;
    })
    .join('');
}

function renderSettings() {
  const s = state.settings || {};
  $('setRootFolder').value = s.rootFolder || 'EmailToFolder';
  $('setManualFolder').value = s.manualFolder || 'Manual';
  $('setSyncInterval').value = s.syncInterval || 5;
  $('setMaxPerSync').value = s.maxPerSync || 25;
  $('setBackfillDays').value = s.backfillDays || 0;
  $('setAutoSync').checked = s.autoSync !== false;
  $('setSkipInline').checked = s.skipInlineImages !== false;
  $('setSilentDl').checked = s.silentDownloads !== false;
  $('setNotify').checked = s.notify !== false;
}

async function refresh() {
  state = await send('getState');
  const q = state.quota || { used: 0, limit: 100 };
  $('topQuotaPill').textContent = `โควตาเดือนนี้: ${q.used} / ${q.isUnlimited ? '∞' : q.limit}`;
  $('extVersionSub').textContent = `v${state.version || '1.0.0'} · Auto Email Archiver for Gmail & Outlook`;
  renderRules();
  renderAccounts();
  renderLogs();
  renderSettings();
}

function exportCsv() {
  const rows = filteredLogs();
  const header = ['Time', 'Source', 'Subject', 'From', 'Rule', 'DestinationFolder', 'FilesSaved', 'Status', 'Message'];
  const csvCell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const lines = [
    header.join(','),
    ...rows.map((r) =>
      [
        r.time ? new Date(r.time).toISOString() : '',
        r.source || '',
        r.subject || '',
        r.from || '',
        r.ruleName || '',
        r.destDir ? `Downloads/${r.destDir}` : '',
        (r.files || []).join('; '),
        r.status || '',
        r.message || ''
      ]
        .map(csvCell)
        .join(',')
    )
  ];
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `EmailToFolder-AuditLog-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

document.addEventListener('DOMContentLoaded', async () => {
  await refresh();

  // Tabs
  $('tabNav').querySelectorAll('.tab').forEach((btn) => {
    btn.onclick = () => {
      $('tabNav').querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      $(`tab-${btn.dataset.tab}`).classList.add('active');
    };
  });

  // Top Sync button
  $('topSyncBtn').onclick = async () => {
    const btn = $('topSyncBtn');
    btn.disabled = true;
    try {
      const r = await send('syncNow');
      banner(`ซิงก์สำเร็จ: บันทึกใหม่ ${r.saved || 0} ฉบับ · ข้าม ${r.skipped || 0} ฉบับ`);
      await refresh();
    } catch (e) {
      banner(e.message, true);
    } finally {
      btn.disabled = false;
    }
  };

  // Rule form
  $('newRuleBtn').onclick = () => openRuleForm(null);
  $('cancelRuleBtn').onclick = () => {
    $('ruleForm').hidden = true;
  };
  $('ruleCondType').onchange = updateCondValVisibility;

  $('ruleForm').onsubmit = async (e) => {
    e.preventDefault();
    const id = $('ruleId').value || newRuleId();
    const entry = {
      id,
      name: $('ruleName').value.trim() || 'Untitled Rule',
      enabled: true,
      source: $('ruleSource').value,
      conditionType: $('ruleCondType').value,
      conditionValue: $('ruleCondVal').value.trim(),
      targetFolder: $('ruleTarget').value.trim() || 'Inbox',
      subfolderMode: $('ruleSubfolder').value,
      saveEml: $('ruleSaveEml').checked,
      saveAttachments: $('ruleSaveAtt').checked,
      prefixAttachments: $('rulePrefixAtt').checked
    };
    const rules = [...(state.rules || [])];
    const idx = rules.findIndex((r) => r.id === id);
    if (idx >= 0) {
      entry.enabled = rules[idx].enabled;
      rules[idx] = entry;
    } else {
      rules.unshift(entry);
    }
    await saveRules(rules);
    $('ruleForm').hidden = true;
    banner('บันทึกกฎการจัดเก็บเรียบร้อยแล้ว');
    await refresh();
  };

  // Copy buttons
  $('copyExtIdBtn').onclick = () => {
    navigator.clipboard.writeText($('extIdCode').textContent);
    banner('คัดลอก Extension ID แล้ว');
  };
  $('copyRedirectBtn').onclick = () => {
    navigator.clipboard.writeText($('redirectUriCode').textContent);
    banner('คัดลอก OAuth Redirect URI แล้ว');
  };

  // Accounts
  $('saveGmailClientBtn').onclick = async () => {
    await patchAccount('gmail', { clientId: $('gmailClientId').value.trim() });
    banner('บันทึก Google Client ID แล้ว');
    await refresh();
  };
  $('connectGmailBtn').onclick = async () => {
    try {
      await patchAccount('gmail', { clientId: $('gmailClientId').value.trim() });
      const res = await send('connect', { provider: 'gmail' });
      banner(`เชื่อมต่อ Gmail สำเร็จ (${res.email})`);
      await refresh();
    } catch (e) {
      banner(e.message, true);
    }
  };
  $('disconnectGmailBtn').onclick = async () => {
    await send('disconnect', { provider: 'gmail' });
    banner('ตัดการเชื่อมต่อ Gmail แล้ว');
    await refresh();
  };

  $('saveOutlookClientBtn').onclick = async () => {
    await patchAccount('outlook', {
      clientId: $('outlookClientId').value.trim(),
      tenant: $('outlookTenant').value.trim() || 'common'
    });
    banner('บันทึก Microsoft Client ID แล้ว');
    await refresh();
  };
  $('connectOutlookBtn').onclick = async () => {
    try {
      await patchAccount('outlook', {
        clientId: $('outlookClientId').value.trim(),
        tenant: $('outlookTenant').value.trim() || 'common'
      });
      const res = await send('connect', { provider: 'outlook' });
      banner(`เชื่อมต่อ Outlook สำเร็จ (${res.email})`);
      await refresh();
    } catch (e) {
      banner(e.message, true);
    }
  };
  $('disconnectOutlookBtn').onclick = async () => {
    await send('disconnect', { provider: 'outlook' });
    banner('ตัดการเชื่อมต่อ Outlook แล้ว');
    await refresh();
  };

  document.querySelectorAll('button[data-backfill]').forEach((b) => {
    b.onclick = async () => {
      const [provider, days] = b.dataset.backfill.split(':');
      b.disabled = true;
      try {
        const r = await send('backfill', { provider, days: Number(days) });
        banner(`ซิงก์ย้อนหลัง ${days} วันสำเร็จ: บันทึก ${r.saved || 0} ฉบับ`);
        await refresh();
      } catch (e) {
        banner(e.message, true);
      } finally {
        b.disabled = false;
      }
    };
  });

  // Logs
  $('logSearch').oninput = renderLogs;
  $('logRuleFilter').onchange = renderLogs;
  $('logStatusFilter').onchange = renderLogs;
  $('exportCsvBtn').onclick = exportCsv;
  $('clearLogsBtn').onclick = async () => {
    await send('clearLog');
    banner('ล้างประวัติการจัดเก็บแล้ว');
    await refresh();
  };

  // Settings
  $('settingsForm').onsubmit = async (e) => {
    e.preventDefault();
    await saveSettings({
      rootFolder: $('setRootFolder').value.trim() || 'EmailToFolder',
      manualFolder: $('setManualFolder').value.trim() || 'Manual',
      syncInterval: Math.max(1, Number($('setSyncInterval').value) || 5),
      maxPerSync: Math.max(1, Number($('setMaxPerSync').value) || 25),
      backfillDays: Math.max(0, Number($('setBackfillDays').value) || 0),
      autoSync: $('setAutoSync').checked,
      skipInlineImages: $('setSkipInline').checked,
      silentDownloads: $('setSilentDl').checked,
      notify: $('setNotify').checked
    });
    banner('บันทึกการตั้งค่าระบบเรียบร้อยแล้ว');
    await refresh();
  };

  $('resetTrackerBtn').onclick = async () => {
    await send('resetProcessed', { provider: 'gmail' });
    await send('resetProcessed', { provider: 'outlook' });
    banner('รีเซ็ตตัวจำรายการอีเมลที่เคยซิงก์แล้วเรียบร้อย');
  };
});

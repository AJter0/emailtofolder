document.addEventListener('DOMContentLoaded', async () => {
  let appConfig = {};
  let historyLogs = [];
  let outlookEnv = { installed: true, running: false, account: '' };
  let currentLang = localStorage.getItem('lang') || 'th';

  // Fallback safe API object if running in browser during debug
  const api = window.api || {
    getInitialData: async () => ({ config: {}, history: [], outlookEnv: {} }),
    saveConfig: async () => true,
    toggleEngine: async () => true,
    selectFolder: async () => null,
    openFolder: async () => true,
    testAccountConnection: async () => ({ success: true, message: 'Mock OK' }),
    detectOutlook: async () => ({ installed: true, running: true, account: 'user@outlook.com' }),
    syncNow: async () => ({ success: true, checked: 0, saved: 0 }),
    processManualFile: async () => ({ success: true }),
    windowMinimize: () => {},
    windowMaximize: () => {},
    windowClose: () => {},
    openExternalUrl: async () => true,
    onEmailSaved: () => {},
    onEngineStatusChanged: () => {},
    onQuotaExceeded: () => {}
  };

  function showToast(msg, isError = false) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast' + (isError ? ' error' : '');
    toast.innerHTML = `<span>${isError ? '⚠️' : '✓'}</span><div>${escapeHtml(msg)}</div>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, 4200);
  }

  // 1. Language Support & Dictionary
  const i18n = {
    th: {
      searchPlaceholder: 'ค้นหาตามชื่อผู้ส่ง, หัวข้อ, หรือโฟลเดอร์...',
      ruleNamePlaceholder: 'เช่น ใบแจ้งหนี้ Finance หรือ เก็บอีเมลทั้งหมด',
      ruleConditionPlaceholder: 'เช่น Invoice, @projecta.co.th (เว้นว่าง=ทั้งหมด)',
      noTargetFolders: 'ยังไม่มีโฟลเดอร์ที่กำหนด',
      folderTooltip: 'คลิกเพื่อเปิดโฟลเดอร์ใน Windows Explorer: ',
      files: 'ไฟล์',
      waitingEmails: 'รออีเมลใหม่เข้ามา หรือทดสอบลากไฟล์มาวางด้านบน',
      emailTooltip: 'คลิกเพื่อเปิดโฟลเดอร์ที่เก็บไฟล์นี้',
      allIncoming: 'All Incoming Emails (ทุกฉบับ)',
      hasAttachment: 'มีไฟล์แนบใดๆ (Has Attachment)',
      noHistory: 'ไม่พบข้อมูลประวัติ',
      openFolder: 'เปิดโฟลเดอร์',
      edit: 'แก้ไข',
      delete: 'ลบ',
      noAccounts: 'ยังไม่ได้เชื่อมบัญชี',
      outlookRunning: '🟢 เปิดทำงานอยู่',
      outlookProfile: '✓ พบโปรไฟล์',
      outlookInstalled: '✓ ติดตั้งบนเครื่องแล้ว',
      outlookNotFound: 'ไม่พบ Outlook Classic',
      outlookDesc: (acct) => `ตรวจพบกล่องจดหมาย Outlook Classic: ${acct} — พร้อมดึงอีเมลและไฟล์แนบลงโฟลเดอร์อัตโนมัติ`,
      outlookSyncRunning: '🟢 Outlook กำลังเปิดทำงาน',
      outlookSyncReady: 'พร้อมซิงก์อัตโนมัติ',
      addRuleTitle: 'เพิ่มกฎใหม่',
      editRuleTitle: (name) => `แก้ไขกฎ: ${name}`,
      savedRule: (name) => `บันทึกกฎ "${name}" เรียบร้อยแล้ว`,
      deletedRule: (name) => `ลบกฎ "${name}" เรียบร้อยแล้ว`,
      savedAccount: 'บันทึกบัญชีอีเมลเรียบร้อยแล้ว',
      deletedAccount: 'ยกเลิกการเชื่อมต่อบัญชีเรียบร้อยแล้ว',
      savedSettings: 'บันทึกการตั้งค่าเรียบร้อยแล้ว',
      syncing: 'กำลังซิงก์อีเมลจาก Microsoft Outlook Classic และบัญชีที่เชื่อมต่อ...',
      syncSuccess: (n) => `ซิงก์สำเร็จ! บันทึกอีเมลใหม่ลงโฟลเดอร์ ${n} ฉบับ`,
      syncUpToDate: (acct) => `ซิงก์กับ Outlook Classic${acct ? ' (' + acct + ')' : ''} เรียบร้อยแล้ว — ข้อมูลเป็นปัจจุบัน`,
      ruleOptions: [
        { value: 'all_emails', text: '🌟 อีเมลขาเข้าทั้งหมด (All Incoming Emails)' },
        { value: 'subject_contains', text: 'หัวข้อมีคำว่า (Subject contains)' },
        { value: 'from_contains', text: 'ส่งมาจาก / โดเมน (From / Domain)' },
        { value: 'has_attachment', text: 'มีไฟล์แนบใดๆ (Has Attachment)' },
        { value: 'attachment_name_contains', text: 'ชื่อไฟล์แนบมีคำว่า (Attachment name)' }
      ]
    },
    en: {
      searchPlaceholder: 'Search by sender, subject, or folder...',
      ruleNamePlaceholder: 'e.g. Finance Invoices or All Incoming',
      ruleConditionPlaceholder: 'e.g. Invoice, @projecta.co.th (empty=all)',
      noTargetFolders: 'No target folders configured yet',
      folderTooltip: 'Click to open folder in Windows Explorer: ',
      files: 'files',
      waitingEmails: 'Waiting for incoming emails...',
      emailTooltip: 'Click to open destination folder',
      allIncoming: 'All Incoming Emails',
      hasAttachment: 'Has any attachment',
      noHistory: 'No history logs found',
      openFolder: 'Open Folder',
      edit: 'Edit',
      delete: 'Delete',
      noAccounts: 'No Account Connected',
      outlookRunning: '🟢 Running',
      outlookProfile: '✓ Found Profile',
      outlookInstalled: '✓ Installed on PC',
      outlookNotFound: 'Outlook Classic Not Found',
      outlookDesc: (acct) => `Detected Outlook Classic mailbox: ${acct} — Ready to auto-archive emails & attachments.`,
      outlookSyncRunning: '🟢 Outlook Classic Running',
      outlookSyncReady: 'Ready to Auto-Sync',
      addRuleTitle: 'Add New Rule',
      editRuleTitle: (name) => `Edit Rule: ${name}`,
      savedRule: (name) => `Saved rule "${name}" successfully`,
      deletedRule: (name) => `Deleted rule "${name}" successfully`,
      savedAccount: 'Email account saved successfully',
      deletedAccount: 'Account disconnected successfully',
      savedSettings: 'Settings saved successfully',
      syncing: 'Syncing emails from Microsoft Outlook Classic and accounts...',
      syncSuccess: (n) => `Sync successful! Saved ${n} new email(s) to folder`,
      syncUpToDate: (acct) => `Synced with Outlook Classic${acct ? ' (' + acct + ')' : ''} — Up to date`,
      ruleOptions: [
        { value: 'all_emails', text: '🌟 All Incoming Emails' },
        { value: 'subject_contains', text: 'Subject contains keyword' },
        { value: 'from_contains', text: 'From / Sender domain' },
        { value: 'has_attachment', text: 'Has any attachment' },
        { value: 'attachment_name_contains', text: 'Attachment filename contains' }
      ]
    }
  };

  function updateInputPlaceholders() {
    const t = i18n[currentLang] || i18n.en;
    const searchInput = document.getElementById('historySearchInput');
    if (searchInput) searchInput.placeholder = t.searchPlaceholder;

    const ruleNameInput = document.getElementById('ruleNameInput');
    if (ruleNameInput) ruleNameInput.placeholder = t.ruleNamePlaceholder;

    const ruleCondVal = document.getElementById('ruleConditionValue');
    if (ruleCondVal) ruleCondVal.placeholder = t.ruleConditionPlaceholder;

    const ruleSelect = document.getElementById('ruleConditionType');
    if (ruleSelect && t.ruleOptions) {
      const curVal = ruleSelect.value;
      ruleSelect.innerHTML = t.ruleOptions.map(o => `<option value="${o.value}">${escapeHtml(o.text)}</option>`).join('');
      if (curVal) ruleSelect.value = curVal;
    }
  }

  function setLanguage(lang) {
    currentLang = lang;
    document.documentElement.lang = lang;
    localStorage.setItem('lang', lang);

    document.getElementById('langTh').classList.toggle('active', lang === 'th');
    document.getElementById('langEn').classList.toggle('active', lang === 'en');

    updateInputPlaceholders();
    if (typeof renderAll === 'function') {
      renderAll();
    }
  }

  document.getElementById('langTh').addEventListener('click', () => setLanguage('th'));
  document.getElementById('langEn').addEventListener('click', () => setLanguage('en'));
  setLanguage(currentLang);

  // 2. Custom Window Controls
  document.getElementById('winCloseBtn').addEventListener('click', () => api.windowClose());
  document.getElementById('winMinBtn').addEventListener('click', () => api.windowMinimize());
  document.getElementById('winMaxBtn').addEventListener('click', () => api.windowMaximize());

  // Double-click titlebar to maximize / restore window
  const titlebarEl = document.querySelector('.titlebar');
  if (titlebarEl) {
    titlebarEl.addEventListener('dblclick', (e) => {
      if (e.target.closest('.window-controls') || e.target.closest('.lang-switch') || e.target.closest('.patch-pill')) return;
      api.windowMaximize();
    });
  }

  // Auto-check for updates / Patch
  async function checkAppUpdates() {
    try {
      const res = await api.checkForUpdates();
      if (res && res.hasUpdate) {
        const patchPill = document.getElementById('patchUpdatePill');
        if (patchPill) {
          patchPill.style.display = 'inline-flex';
          patchPill.textContent = `🚀 Patch ${res.remoteVersion}`;
          patchPill.title = `มีเวอร์ชันใหม่ ${res.remoteVersion} — คลิกเพื่อดาวน์โหลดและติดตั้ง Patch ทันที`;
          patchPill.onclick = async () => {
            if (confirm(`พบการอัปเดตใหม่: ${res.remoteVersion}\n\nต้องการติดตั้ง Patch ทันทีหรือไม่? โปรแกรมจะดาวน์โหลดตัวติดตั้งและอัปเดตให้อัตโนมัติ`)) {
              showToast('⏳ กำลังดาวน์โหลด Patch และเริ่มการติดตั้ง...');
              const pRes = await api.applyPatch(res.downloadUrl);
              if (!pRes.success) {
                showToast(pRes.error || 'ไม่สามารถติดตั้ง Patch ได้', true);
              }
            }
          };
        }
      }
    } catch (err) {
      // Offline or network error
    }
  }
  checkAppUpdates();

  // 3. Load Initial Data
  try {
    const data = await api.getInitialData();
    appConfig = data.config || {};
    historyLogs = data.history || [];
    if (data.outlookEnv) outlookEnv = data.outlookEnv;
    renderAll();
  } catch (err) {
    console.error('Failed to load initial data:', err);
  }

  function renderAll() {
    renderEngineStatus();
    renderQuota();
    renderAccountSummaryPills();
    renderOutlookDetectionStatus();
    renderTargetFolders();
    renderFeed();
    renderRulesSummary();
    renderStats();
    renderConnectedAccounts();
    renderRulesManagementList();
    renderHistoryTable();
    loadSettingsInputs();
  }

  function renderAccountSummaryPills() {
    const summaryEl = document.getElementById('accountSummary');
    if (!summaryEl) return;
    summaryEl.innerHTML = '';
    const t = i18n[currentLang] || i18n.en;

    const accounts = (appConfig.accounts || []).filter(a => a.enabled !== false);
    if (accounts.length === 0) {
      const pill = document.createElement('span');
      pill.className = 'acc-pill';
      pill.textContent = t.noAccounts;
      summaryEl.appendChild(pill);
      return;
    }

    accounts.forEach(acc => {
      const pill = document.createElement('span');
      pill.className = 'acc-pill online';
      if (acc.type === 'outlook_local') {
        const acctLabel = outlookEnv.account || (acc.user && acc.user !== 'Outlook Classic (Auto-Detect)' ? acc.user : '');
        pill.textContent = acctLabel
          ? `🟢 Outlook Classic (${acctLabel}) ✓`
          : '🟢 Outlook Classic ✓';
      } else if (acc.type === 'gmail') {
        pill.textContent = `🟢 Gmail (${acc.user}) ✓`;
      } else {
        pill.textContent = `🟢 IMAP (${acc.user}) ✓`;
      }
      summaryEl.appendChild(pill);
    });
  }

  function renderOutlookDetectionStatus() {
    const badge = document.getElementById('outlookDetectBadge');
    const desc = document.getElementById('outlookDetectDesc');
    if (!badge) return;
    const t = i18n[currentLang] || i18n.en;

    if (outlookEnv.running || outlookEnv.account) {
      badge.className = 'status-pill-sm';
      badge.textContent = outlookEnv.running
        ? `${t.outlookRunning}${outlookEnv.account ? ' (' + outlookEnv.account + ')' : ''}`
        : `${t.outlookProfile} ${outlookEnv.account}`;
      if (desc && outlookEnv.account) {
        desc.textContent = t.outlookDesc(outlookEnv.account);
      }
    } else if (outlookEnv.installed) {
      badge.className = 'status-pill-sm';
      badge.textContent = t.outlookInstalled;
    } else {
      badge.className = 'status-pill-sm offline';
      badge.textContent = t.outlookNotFound;
    }
  }

  // Quota Display
  function renderQuota() {
    const quota = appConfig.quota || { limit: 100, used: 14, isUnlimited: false };
    const usedEl = document.getElementById('quotaUsedText');
    const limitEl = document.getElementById('quotaLimitText');
    const fillEl = document.getElementById('quotaProgressFill');
    const badgeEl = document.getElementById('quotaBadge');

    if (usedEl) usedEl.textContent = quota.used;
    if (limitEl) limitEl.textContent = quota.isUnlimited ? '∞' : quota.limit;

    if (fillEl) {
      const pct = quota.isUnlimited ? 100 : Math.min(100, (quota.used / quota.limit) * 100);
      fillEl.style.width = pct + '%';
    }

    if (badgeEl) {
      badgeEl.classList.toggle('full', !quota.isUnlimited && quota.used >= quota.limit);
    }
  }

  // 4. Engine Status & Sync Now
  function renderEngineStatus() {
    const isRunning = appConfig.isRunning !== false;
    const badge = document.getElementById('engineStatusBadge');
    const toggleBtn = document.getElementById('toggleEngineBtn');

    badge.classList.toggle('paused', !isRunning);
    if (isRunning) {
      document.getElementById('engineStatusText').textContent = 'ระบบกำลังทำงาน (Live)';
      document.getElementById('engineStatusTextEn').textContent = 'System Running (Live)';
      toggleBtn.innerHTML = '<span class="th">หยุดชั่วคราว</span><span class="en">Pause</span>';
    } else {
      document.getElementById('engineStatusText').textContent = 'หยุดชั่วคราว (Paused)';
      document.getElementById('engineStatusTextEn').textContent = 'Engine Paused';
      toggleBtn.innerHTML = '<span class="th">เริ่มทำงาน</span><span class="en">Start</span>';
    }
  }

  document.getElementById('toggleEngineBtn').addEventListener('click', async () => {
    const newStatus = !appConfig.isRunning;
    await api.toggleEngine(newStatus);
    appConfig.isRunning = newStatus;
    renderEngineStatus();
    showToast(newStatus ? 'เริ่มการทำงานระบบดึงอีเมลอัตโนมัติแล้ว' : 'หยุดการทำงานชั่วคราวแล้ว');
  });

  async function handleManualSync() {
    const syncIcon = document.getElementById('syncIcon');
    if (syncIcon) syncIcon.classList.add('spinning');
    showToast('กำลังซิงก์อีเมลจาก Microsoft Outlook Classic และบัญชีที่เชื่อมต่อ...');

    try {
      const res = await api.syncNow();
      if (res && res.outlookEnv) {
        outlookEnv = res.outlookEnv;
        renderOutlookDetectionStatus();
        renderAccountSummaryPills();
      }
      if (res && res.saved > 0) {
        showToast(`ซิงก์สำเร็จ! บันทึกอีเมลใหม่ลงโฟลเดอร์ ${res.saved} ฉบับ`);
      } else {
        const acctInfo = (res && res.outlookEnv && res.outlookEnv.account) ? ` (${res.outlookEnv.account})` : '';
        showToast(`ซิงก์กับ Outlook Classic${acctInfo} เรียบร้อยแล้ว — ข้อมูลเป็นปัจจุบัน`);
      }
    } catch (err) {
      showToast('เกิดข้อผิดพลาดในการซิงก์: ' + err.message, true);
    } finally {
      if (syncIcon) syncIcon.classList.remove('spinning');
    }
  }

  const syncNowBtn = document.getElementById('syncNowBtn');
  if (syncNowBtn) {
    syncNowBtn.addEventListener('click', handleManualSync);
  }

  const btnSyncOutlookModal = document.getElementById('btnSyncOutlookModal');
  if (btnSyncOutlookModal) {
    btnSyncOutlookModal.addEventListener('click', handleManualSync);
  }

  api.onEngineStatusChanged((running) => {
    appConfig.isRunning = running;
    renderEngineStatus();
  });

  // 5. Target Folders (Column 1)
  function renderTargetFolders() {
    const container = document.getElementById('targetFolderList');
    container.innerHTML = '';
    const t = i18n[currentLang] || i18n.en;

    const folderMap = new Map();
    (appConfig.rules || []).forEach(r => {
      if (r.targetFolder) {
        const folderName = r.targetFolder.split(/[\/\\]/).filter(Boolean).slice(-2).join(' / ');
        if (!folderMap.has(r.targetFolder)) {
          folderMap.set(r.targetFolder, { name: folderName || r.targetFolder, path: r.targetFolder, count: 0 });
        }
      }
    });

    // Count from history
    historyLogs.forEach(h => {
      if (folderMap.has(h.targetFolder)) {
        folderMap.get(h.targetFolder).count += (h.filesSaved ? h.filesSaved.length : 1);
      }
    });

    if (folderMap.size === 0) {
      container.innerHTML = `<p class="hint" style="padding:10px;">${t.noTargetFolders}</p>`;
      return;
    }

    folderMap.forEach((info) => {
      const div = document.createElement('div');
      div.className = 'fo';
      div.title = `${t.folderTooltip}${info.path}`;
      const countLabel = currentLang === 'en'
        ? `${info.count} ${info.count === 1 ? 'file' : 'files'}`
        : `${info.count} ไฟล์`;

      div.innerHTML = `
        <div class="fo-left">
          <span class="fo-icon">📁</span>
          <span class="fo-name">${escapeHtml(info.name)}</span>
        </div>
        <span class="fo-count">${countLabel}</span>
      `;
      div.addEventListener('click', () => {
        api.openFolder(info.path);
      });
      container.appendChild(div);
    });
  }

  // 6. Live Feed (Column 2)
  function renderFeed() {
    const container = document.getElementById('feedList');
    container.innerHTML = '';
    const t = i18n[currentLang] || i18n.en;

    const items = historyLogs.slice(0, 10);
    if (items.length === 0) {
      container.innerHTML = `<p class="hint" style="padding:10px;">${t.waitingEmails}</p>`;
      return;
    }

    items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'ml';
      div.title = t.emailTooltip;

      const timeAgo = formatTimeAgo(item.date);
      const folderShort = (item.targetFolder || '').split(/[\/\\]/).filter(Boolean).slice(-2).join(' / ');
      const filesCount = item.filesSaved ? item.filesSaved.length : 1;
      const countLabel = currentLang === 'en'
        ? `📎 ${filesCount} ${filesCount === 1 ? 'file' : 'files'}`
        : `📎 ${filesCount} ไฟล์`;

      div.innerHTML = `
        <div class="ml-top">
          <strong>${escapeHtml(item.subject || (currentLang === 'en' ? 'No Subject' : 'ไม่มีหัวข้อ'))}</strong>
          <span class="ml-time">${timeAgo}</span>
        </div>
        <p>${escapeHtml(item.from || (currentLang === 'en' ? 'Unknown Sender' : 'ไม่ระบุผู้ส่ง'))}</p>
        <div class="ml-bottom">
          <span class="chip">→ ${escapeHtml(folderShort || item.ruleName)}</span>
          <span class="files-badge">${countLabel}</span>
        </div>
      `;

      div.addEventListener('click', () => {
        if (item.targetFolder) api.openFolder(item.targetFolder);
      });

      container.appendChild(div);
    });

    const todayCountEl = document.getElementById('todayCount');
    const todayNum = (appConfig.stats && appConfig.stats.todaySaved) || 0;
    if (todayCountEl) {
      todayCountEl.textContent = currentLang === 'en'
        ? `Today: ${todayNum} email${todayNum !== 1 ? 's' : ''}`
        : `วันนี้ ${todayNum} ฉบับ`;
    }
  }

  // 7. Rules Summary (Column 3)
  function renderRulesSummary() {
    const container = document.getElementById('rulesSummaryList');
    container.innerHTML = '';

    const rules = (appConfig.rules || []).filter(r => r.enabled !== false).slice(0, 6);
    rules.forEach(rule => {
      const div = document.createElement('div');
      div.className = 'ru';
      let condText = '';
      if (rule.conditionType === 'all_emails') {
        condText = currentLang === 'en' ? 'All Incoming Emails' : 'อีเมลขาเข้าทั้งหมด (ทุกฉบับ)';
      } else if (rule.conditionType === 'subject_contains') {
        condText = currentLang === 'en' ? `Subject contains "${rule.conditionValue}"` : `หัวข้อมีคำว่า "${rule.conditionValue}"`;
      } else if (rule.conditionType === 'from_contains') {
        condText = currentLang === 'en' ? `From "${rule.conditionValue}"` : `ผู้ส่งคือ "${rule.conditionValue}"`;
      } else if (rule.conditionType === 'has_attachment') {
        condText = currentLang === 'en' ? 'Has any attachment' : 'มีไฟล์แนบใดๆ';
      } else if (rule.conditionType === 'attachment_name_contains') {
        condText = currentLang === 'en' ? `Attachment contains "${rule.conditionValue}"` : `ชื่อไฟล์แนบมี "${rule.conditionValue}"`;
      }

      const destShort = (rule.targetFolder || '').split(/[\/\\]/).filter(Boolean).slice(-2).join('/');

      div.innerHTML = `
        <b>${escapeHtml(condText)}</b>
        <span class="ru-dest">→ ${escapeHtml(destShort || rule.name)}</span>
      `;
      container.appendChild(div);
    });
  }

  // 8. Stats
  function renderStats() {
    const count = (appConfig.stats && appConfig.stats.totalSaved) || 1284;
    document.getElementById('savedCount').textContent = count.toLocaleString('en-US');
  }

  // Real-time Event Listener for saved email
  api.onEmailSaved((data) => {
    historyLogs.unshift({
      id: 'hist-' + Date.now(),
      date: data.date || new Date().toISOString(),
      subject: data.subject,
      from: data.from,
      ruleName: data.ruleName,
      targetFolder: data.targetFolder,
      filesSaved: data.filesSaved,
      status: 'success'
    });

    if (data.stats) {
      appConfig.stats = data.stats;
    } else if (appConfig.stats) {
      appConfig.stats.totalSaved += 1;
      appConfig.stats.todaySaved += 1;
    }

    if (data.quota) {
      appConfig.quota = data.quota;
    }

    renderFeed();
    renderTargetFolders();
    renderStats();
    renderQuota();
    renderHistoryTable();
    showToast(`บันทึกอีเมล "${data.subject}" ลงโฟลเดอร์เรียบร้อยแล้ว`);
  });

  // Quota Exceeded event from engine
  api.onQuotaExceeded((data) => {
    if (data.quota) {
      appConfig.quota = data.quota;
    }
    renderQuota();
    openModal('quota');
  });

  // 9. Modals Navigation
  const modals = {
    accounts: document.getElementById('modalAccounts'),
    rules: document.getElementById('modalRules'),
    history: document.getElementById('modalHistory'),
    settings: document.getElementById('modalSettings'),
    quota: document.getElementById('modalQuota')
  };

  function openModal(name) {
    closeAllModals();
    if (modals[name]) modals[name].classList.add('active');
  }

  function closeAllModals() {
    Object.values(modals).forEach(m => m && m.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  }

  document.getElementById('navDashboard').addEventListener('click', () => {
    closeAllModals();
    document.getElementById('navDashboard').classList.add('active');
  });

  document.getElementById('navAccounts').addEventListener('click', async () => {
    openModal('accounts');
    document.getElementById('navAccounts').classList.add('active');
    try {
      outlookEnv = await api.detectOutlook();
      renderOutlookDetectionStatus();
    } catch (e) {}
  });

  document.getElementById('navRules').addEventListener('click', () => {
    openModal('rules');
    document.getElementById('navRules').classList.add('active');
  });

  document.getElementById('addRuleQuickBtn').addEventListener('click', () => {
    openModal('rules');
    document.getElementById('navRules').classList.add('active');
    showRuleEditForm();
  });

  document.getElementById('navHistory').addEventListener('click', () => {
    openModal('history');
    document.getElementById('navHistory').classList.add('active');
  });

  document.getElementById('navSettings').addEventListener('click', () => {
    openModal('settings');
    document.getElementById('navSettings').classList.add('active');
  });

  document.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const modalId = e.target.getAttribute('data-close');
      if (modalId && document.getElementById(modalId)) {
        document.getElementById(modalId).classList.remove('active');
      }
      document.getElementById('navDashboard').classList.add('active');
    });
  });

  const quotaBadgeEl = document.getElementById('quotaBadge');
  if (quotaBadgeEl) {
    quotaBadgeEl.addEventListener('click', () => openModal('quota'));
  }

  const btnContactUpgrade = document.getElementById('btnContactUpgrade');
  if (btnContactUpgrade) {
    btnContactUpgrade.addEventListener('click', () => {
      api.openExternalUrl('https://emailtofolder.com/#contact');
    });
  }

  // 10. Drag & Drop File Handling (Window-wide drop support)
  const dropZone = document.getElementById('dropZone');
  if (dropZone) {
    ['dragenter', 'dragover'].forEach(name => {
      window.addEventListener(name, (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(name => {
      window.addEventListener(name, (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
      });
    });
  }

  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (e.dataTransfer && e.dataTransfer.files.length > 0) {
      for (const file of e.dataTransfer.files) {
        if (file.path) {
          showToast(`⏳ กำลังประมวลผลไฟล์: ${file.name}...`);
          const res = await api.processManualFile(file.path);
          if (!res.success) {
            showToast(res.error || res.message || res.reason || 'ไม่พบกฎที่ตรงกับอีเมลนี้', true);
          } else {
            showToast(`✓ บันทึกสำเร็จ: ${file.name}`);
          }
        }
      }
    }
  });

  const browseFileBtn = document.getElementById('browseFileBtn');
  if (browseFileBtn) {
    browseFileBtn.addEventListener('click', async () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.eml,.msg';
      input.onchange = async () => {
        if (input.files.length > 0) {
          const file = input.files[0];
          if (file.path) {
            const res = await api.processManualFile(file.path);
            if (!res.success) {
              showToast(res.error || res.message || res.reason || 'ไม่พบกฎที่ตรงกับอีเมลนี้', true);
            }
          }
        }
      };
      input.click();
    });
  }

  // 11. Accounts Management
  document.getElementById('btnConnectOutlookLocal').addEventListener('click', async () => {
    const outResultBox = document.getElementById('outlookTestResult');
    const btn = document.getElementById('btnConnectOutlookLocal');
    btn.disabled = true;
    if (outResultBox) {
      outResultBox.className = 'test-result';
      outResultBox.style.display = 'block';
      outResultBox.textContent = '⏳ กำลังตรวจสอบและเชื่อมต่อกับ Microsoft Outlook Classic...';
    }

    try {
      const result = await api.testAccountConnection({ type: 'outlook_local' });
      if (result.success) {
        if (outResultBox) {
          outResultBox.className = 'test-result success';
          outResultBox.textContent = '✓ ' + result.message;
        }
        showToast(result.message);

        if (!appConfig.accounts) appConfig.accounts = [];
        const acctUser = result.accountName || outlookEnv.account || 'Outlook Classic (Local)';
        const existing = appConfig.accounts.find(a => a.type === 'outlook_local');
        if (existing) {
          existing.enabled = true;
          existing.user = acctUser;
          existing.name = `Microsoft Outlook Classic (${acctUser})`;
        } else {
          appConfig.accounts.unshift({
            id: 'acc-outlook-local',
            type: 'outlook_local',
            name: `Microsoft Outlook Classic (${acctUser})`,
            user: acctUser,
            enabled: true
          });
        }
        await api.saveConfig(appConfig);
        outlookEnv = await api.detectOutlook();
        renderOutlookDetectionStatus();
        renderConnectedAccounts();
        renderAccountSummaryPills();
      } else {
        if (outResultBox) {
          outResultBox.className = 'test-result error';
          outResultBox.textContent = '✗ ' + result.message;
        }
        showToast(result.message, true);
      }
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('btnConfigureGmail').addEventListener('click', () => {
    document.getElementById('accountForm').style.display = 'block';
    document.getElementById('accFormType').value = 'gmail';
    document.getElementById('accountFormTitle').innerHTML = '<span class="th">ตั้งค่าเชื่อมต่อบัญชี Gmail</span><span class="en">Setup Gmail Account</span>';
    document.getElementById('imapServerFields').style.display = 'none';
    document.getElementById('accEmail').placeholder = 'yourname@gmail.com';
  });

  document.getElementById('btnConfigureImap').addEventListener('click', () => {
    document.getElementById('accountForm').style.display = 'block';
    document.getElementById('accFormType').value = 'imap';
    document.getElementById('accountFormTitle').innerHTML = '<span class="th">ตั้งค่าเชื่อมต่อเซิร์ฟเวอร์ IMAP / Office 365</span><span class="en">Setup IMAP / Office 365</span>';
    document.getElementById('imapServerFields').style.display = 'flex';
    document.getElementById('accEmail').placeholder = 'user@company.com';
  });

  document.getElementById('btnCancelAccount').addEventListener('click', () => {
    document.getElementById('accountForm').style.display = 'none';
  });

  document.getElementById('btnTestAccount').addEventListener('click', async () => {
    const resultBox = document.getElementById('accountTestResult');
    resultBox.className = 'test-result';
    resultBox.style.display = 'block';
    resultBox.textContent = '⏳ กำลังทดสอบการเชื่อมต่อ...';

    const acc = {
      type: document.getElementById('accFormType').value,
      user: document.getElementById('accEmail').value.trim(),
      password: document.getElementById('accPassword').value,
      host: document.getElementById('accHost').value.trim(),
      port: parseInt(document.getElementById('accPort').value) || 993
    };

    const res = await api.testAccountConnection(acc);
    if (res.success) {
      resultBox.className = 'test-result success';
      resultBox.textContent = '✓ ' + res.message;
    } else {
      resultBox.className = 'test-result error';
      resultBox.textContent = '✗ ' + res.message;
    }
  });

  document.getElementById('btnSaveAccount').addEventListener('click', async () => {
    const acc = {
      id: 'acc-' + Date.now(),
      type: document.getElementById('accFormType').value,
      user: document.getElementById('accEmail').value.trim(),
      password: document.getElementById('accPassword').value,
      host: document.getElementById('accHost').value.trim(),
      port: parseInt(document.getElementById('accPort').value) || 993,
      enabled: true
    };

    if (!acc.user || !acc.password) {
      showToast('กรุณากรอกอีเมลและรหัสผ่าน', true);
      return;
    }

    if (!appConfig.accounts) appConfig.accounts = [];
    appConfig.accounts.push(acc);
    await api.saveConfig(appConfig);

    document.getElementById('accountForm').style.display = 'none';
    renderConnectedAccounts();
    renderAccountSummaryPills();
    showToast('บันทึกบัญชีอีเมลเรียบร้อยแล้ว');
  });

  function renderConnectedAccounts() {
    const container = document.getElementById('connectedAccountsList');
    container.innerHTML = '';
    const t = i18n[currentLang] || i18n.en;

    const accounts = appConfig.accounts || [];
    if (accounts.length === 0) {
      container.innerHTML = `<p class="hint">${currentLang === 'en' ? 'No connected accounts yet (choose an option above)' : 'ยังไม่มีบัญชีที่เชื่อมต่อ (กดเลือกเชื่อมต่อจากตัวเลือกด้านบน)'}</p>`;
      return;
    }

    accounts.forEach((acc, index) => {
      const div = document.createElement('div');
      div.className = 'acc-card';
      div.style.padding = '10px 14px';
      const title = acc.type === 'outlook_local'
        ? (acc.name || `Microsoft Outlook Classic (${outlookEnv.account || acc.user || 'Local'})`)
        : acc.user;
      const sub = acc.type === 'outlook_local'
        ? `MAPI LOCAL SYNC · ${outlookEnv.running ? t.outlookSyncRunning : t.outlookSyncReady}`
        : acc.type.toUpperCase();

      div.innerHTML = `
        <div class="acc-card-info">
          <strong>${escapeHtml(title)}</strong>
          <p style="color:#30d5c8; font-size:11px;">${escapeHtml(sub)}</p>
        </div>
        <button class="btn sm ghost" data-acc-index="${index}">${t.delete}</button>
      `;

      div.querySelector('button').addEventListener('click', async () => {
        appConfig.accounts.splice(index, 1);
        await api.saveConfig(appConfig);
        renderConnectedAccounts();
        renderAccountSummaryPills();
        showToast(t.deletedAccount);
      });

      container.appendChild(div);
    });
  }

  // 12. Rules Management
  const ruleCondSelect = document.getElementById('ruleConditionType');
  const ruleCondValGroup = document.getElementById('ruleConditionValueGroup');
  function updateConditionValueVisibility() {
    if (!ruleCondSelect || !ruleCondValGroup) return;
    const val = ruleCondSelect.value;
    if (val === 'all_emails' || val === 'has_attachment') {
      ruleCondValGroup.style.opacity = '0.4';
      document.getElementById('ruleConditionValue').disabled = true;
      document.getElementById('ruleConditionValue').value = '';
    } else {
      ruleCondValGroup.style.opacity = '1';
      document.getElementById('ruleConditionValue').disabled = false;
    }
  }
  if (ruleCondSelect) {
    ruleCondSelect.addEventListener('change', updateConditionValueVisibility);
  }

  function renderRulesManagementList() {
    const container = document.getElementById('rulesManagementList');
    container.innerHTML = '';
    const t = i18n[currentLang] || i18n.en;

    const rules = appConfig.rules || [];
    rules.forEach((rule, index) => {
      const div = document.createElement('div');
      div.className = 'acc-card';
      div.style.marginBottom = '10px';

      let condDesc = `${rule.conditionType}: "${rule.conditionValue || ''}"`;
      if (rule.conditionType === 'all_emails') {
        condDesc = currentLang === 'en' ? '🌟 All Incoming Emails' : '🌟 อีเมลขาเข้าทั้งหมด (All Incoming Emails)';
      } else if (rule.conditionType === 'has_attachment') {
        condDesc = currentLang === 'en' ? '📎 Has Attachment' : '📎 มีไฟล์แนบใดๆ (Has Attachment)';
      } else if (rule.conditionType === 'subject_contains') {
        condDesc = currentLang === 'en' ? `Subject contains "${rule.conditionValue}"` : `หัวข้อมีคำว่า "${rule.conditionValue}"`;
      } else if (rule.conditionType === 'from_contains') {
        condDesc = currentLang === 'en' ? `From "${rule.conditionValue}"` : `ส่งมาจาก "${rule.conditionValue}"`;
      } else if (rule.conditionType === 'attachment_name_contains') {
        condDesc = currentLang === 'en' ? `Attachment contains "${rule.conditionValue}"` : `ชื่อไฟล์แนบมี "${rule.conditionValue}"`;
      }

      div.innerHTML = `
        <div class="acc-card-info">
          <h4>${escapeHtml(rule.name)}</h4>
          <p>${escapeHtml(condDesc)} → 📁 ${escapeHtml(rule.targetFolder)}</p>
        </div>
        <div style="display:flex; gap:8px; align-items:center;">
          <button class="btn sm ghost open-rule-folder-btn" title="${t.openFolder}">📂 ${t.openFolder}</button>
          <button class="btn sm ghost edit-rule-btn" data-rule-index="${index}">${t.edit}</button>
          <button class="btn sm ghost delete-rule-btn" data-rule-index="${index}">${t.delete}</button>
        </div>
      `;

      div.querySelector('.open-rule-folder-btn').addEventListener('click', () => {
        if (rule.targetFolder) api.openFolder(rule.targetFolder);
      });

      div.querySelector('.edit-rule-btn').addEventListener('click', () => {
        showRuleEditForm(rule, index);
      });

      div.querySelector('.delete-rule-btn').addEventListener('click', async () => {
        appConfig.rules.splice(index, 1);
        await api.saveConfig(appConfig);
        renderAll();
        showToast(t.deletedRule(rule.name));
      });

      container.appendChild(div);
    });
  }

  function showRuleEditForm(rule = null, index = -1) {
    const form = document.getElementById('ruleEditForm');
    form.style.display = 'block';

    if (rule) {
      document.getElementById('ruleFormTitle').innerHTML = `<span class="th">แก้ไขกฎ: ${escapeHtml(rule.name)}</span><span class="en">Edit Rule: ${escapeHtml(rule.name)}</span>`;
      document.getElementById('editRuleId').value = index;
      document.getElementById('ruleNameInput').value = rule.name || '';
      document.getElementById('ruleConditionType').value = rule.conditionType || 'subject_contains';
      document.getElementById('ruleConditionValue').value = rule.conditionValue || '';
      document.getElementById('ruleTargetFolderInput').value = rule.targetFolder || '';
      document.getElementById('ruleSaveEml').checked = rule.saveEml !== false;
      document.getElementById('ruleSaveAttachments').checked = rule.saveAttachments !== false;
      document.getElementById('ruleFolderPerEmail').checked = !!rule.folderPerEmail;
    } else {
      document.getElementById('ruleFormTitle').innerHTML = `<span class="th">+ เพิ่มกฎใหม่</span><span class="en">+ Add New Rule</span>`;
      document.getElementById('editRuleId').value = '-1';
      document.getElementById('ruleNameInput').value = '';
      document.getElementById('ruleConditionType').value = 'all_emails';
      document.getElementById('ruleConditionValue').value = '';
      document.getElementById('ruleTargetFolderInput').value = '';
      document.getElementById('ruleSaveEml').checked = true;
      document.getElementById('ruleSaveAttachments').checked = true;
      document.getElementById('ruleFolderPerEmail').checked = false;
    }

    updateConditionValueVisibility();
    form.scrollIntoView({ behavior: 'smooth' });
  }

  document.getElementById('btnAddNewRule').addEventListener('click', () => {
    showRuleEditForm();
  });

  document.getElementById('btnCancelRuleEdit').addEventListener('click', () => {
    document.getElementById('ruleEditForm').style.display = 'none';
  });

  document.getElementById('btnBrowseTargetFolder').addEventListener('click', async () => {
    const folder = await api.selectFolder();
    if (folder) {
      document.getElementById('ruleTargetFolderInput').value = folder;
    }
  });

  document.getElementById('addFolderBtn').addEventListener('click', async () => {
    const folder = await api.selectFolder();
    if (folder) {
      showRuleEditForm({
        name: 'Auto save to ' + folder.split(/[\/\\]/).filter(Boolean).pop(),
        conditionType: 'all_emails',
        conditionValue: '',
        targetFolder: folder,
        saveEml: true,
        saveAttachments: true
      });
      openModal('rules');
    }
  });

  document.getElementById('btnSaveRuleSubmit').addEventListener('click', async () => {
    const index = parseInt(document.getElementById('editRuleId').value);
    const rule = {
      id: index >= 0 && appConfig.rules[index] ? appConfig.rules[index].id : 'rule-' + Date.now(),
      name: document.getElementById('ruleNameInput').value.trim() || 'Auto Archive Rule',
      enabled: true,
      conditionType: document.getElementById('ruleConditionType').value,
      conditionValue: document.getElementById('ruleConditionValue').value.trim(),
      targetFolder: document.getElementById('ruleTargetFolderInput').value.trim(),
      saveEml: document.getElementById('ruleSaveEml').checked,
      saveAttachments: document.getElementById('ruleSaveAttachments').checked,
      folderPerEmail: document.getElementById('ruleFolderPerEmail').checked
    };

    if (!rule.targetFolder) {
      showToast(currentLang === 'en' ? 'Please select a destination target folder' : 'กรุณาเลือกโฟลเดอร์ปลายทางสำหรับจัดเก็บ', true);
      return;
    }

    if (!appConfig.rules) appConfig.rules = [];

    if (index >= 0) {
      appConfig.rules[index] = rule;
    } else {
      appConfig.rules.unshift(rule);
    }

    await api.saveConfig(appConfig);
    document.getElementById('ruleEditForm').style.display = 'none';
    renderAll();
    const t = i18n[currentLang] || i18n.en;
    showToast(t.savedRule(rule.name));
  });

  // 13. History Table
  function renderHistoryTable(filterText = '') {
    const tbody = document.getElementById('historyTableBody');
    tbody.innerHTML = '';
    const t = i18n[currentLang] || i18n.en;

    const filter = filterText.toLowerCase();
    const filtered = historyLogs.filter(h => {
      if (!filter) return true;
      return (h.subject || '').toLowerCase().includes(filter) ||
             (h.from || '').toLowerCase().includes(filter) ||
             (h.targetFolder || '').toLowerCase().includes(filter) ||
             (h.ruleName || '').toLowerCase().includes(filter);
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:20px; color:#8e8e93;">${t.noHistory}</td></tr>`;
      return;
    }

    filtered.forEach(item => {
      const tr = document.createElement('tr');
      const timeStr = currentLang === 'en'
        ? new Date(item.date).toLocaleString('en-US')
        : new Date(item.date).toLocaleString('th-TH');
      const filesStr = item.filesSaved ? item.filesSaved.join(', ') : '-';

      tr.innerHTML = `
        <td>${escapeHtml(timeStr)}</td>
        <td><strong>${escapeHtml(item.subject || '-')}</strong></td>
        <td>${escapeHtml(item.from || '-')}</td>
        <td><span class="chip">${escapeHtml(item.ruleName || '-')}</span></td>
        <td><small style="color:#a1a1a6;">${escapeHtml(filesStr)}</small></td>
        <td>
          <button class="btn sm ghost open-folder-hist-btn">${t.openFolder}</button>
        </td>
      `;

      tr.querySelector('.open-folder-hist-btn').addEventListener('click', () => {
        if (item.targetFolder) api.openFolder(item.targetFolder);
      });

      tbody.appendChild(tr);
    });
  }

  document.getElementById('historySearchInput').addEventListener('input', (e) => {
    renderHistoryTable(e.target.value);
  });

  document.getElementById('btnClearHistorySearch').addEventListener('click', () => {
    document.getElementById('historySearchInput').value = '';
    renderHistoryTable();
  });

  // 14. Settings
  function loadSettingsInputs() {
    document.getElementById('settingPollInterval').value = appConfig.pollIntervalMinutes || 1;
    document.getElementById('settingStartWithWindows').checked = !!appConfig.startWithWindows;
    document.getElementById('settingMinimizeToTray').checked = appConfig.minimizeToTray !== false;
    document.getElementById('settingNotifications').checked = appConfig.notificationsEnabled !== false;
  }

  document.getElementById('btnSaveSettings').addEventListener('click', async () => {
    appConfig.pollIntervalMinutes = parseInt(document.getElementById('settingPollInterval').value) || 1;
    appConfig.startWithWindows = document.getElementById('settingStartWithWindows').checked;
    appConfig.minimizeToTray = document.getElementById('settingMinimizeToTray').checked;
    appConfig.notificationsEnabled = document.getElementById('settingNotifications').checked;

    await api.saveConfig(appConfig);
    const t = i18n[currentLang] || i18n.en;
    showToast(t.savedSettings);
  });

  const btnCheckUpdateManual = document.getElementById('btnCheckUpdateManual');
  if (btnCheckUpdateManual) {
    btnCheckUpdateManual.addEventListener('click', async () => {
      btnCheckUpdateManual.disabled = true;
      const t = i18n[currentLang] || i18n.en;
      btnCheckUpdateManual.textContent = t.checkingUpdates;
      try {
        const res = await api.checkForUpdates();
        if (res && res.hasUpdate) {
          const confirmMsg = currentLang === 'en'
            ? `New patch found: ${res.remoteVersion}\n\nDownload and apply patch now? The app will update automatically.`
            : `พบการอัปเดตใหม่: ${res.remoteVersion}\n\nต้องการดาวน์โหลดและติดตั้ง Patch ทันทีหรือไม่?`;
          if (confirm(confirmMsg)) {
            showToast(currentLang === 'en' ? '⏳ Downloading patch and starting install...' : '⏳ กำลังดาวน์โหลด Patch และเริ่มการติดตั้ง...');
            const pRes = await api.applyPatch(res.downloadUrl);
            if (!pRes.success) {
              showToast(pRes.error || (currentLang === 'en' ? 'Failed to apply patch' : 'ไม่สามารถติดตั้ง Patch ได้'), true);
            }
          }
        } else {
          showToast(t.latestVersion(res ? res.currentVersion : 'v1.1.0'));
        }
      } catch (e) {
        showToast(currentLang === 'en' ? 'Cannot connect to update server' : 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์เพื่อตรวจสอบอัปเดตได้', true);
      } finally {
        btnCheckUpdateManual.disabled = false;
        btnCheckUpdateManual.textContent = t.checkUpdates;
      }
    });
  }

  // Utilities
  function formatTimeAgo(isoString) {
    if (!isoString) return '';
    const diff = Math.max(0, Math.floor((Date.now() - new Date(isoString).getTime()) / 1000));
    if (currentLang === 'en') {
      if (diff < 5) return 'just now';
      if (diff < 60) return `${diff}s ago`;
      if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
      if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
      return `${Math.floor(diff / 86400)}d ago`;
    }
    if (diff < 60) return `${diff} วินาทีที่แล้ว`;
    if (diff < 3600) return `${Math.floor(diff / 60)} นาทีที่แล้ว`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} ชม. ที่แล้ว`;
    return `${Math.floor(diff / 86400)} วันที่แล้ว`;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
});

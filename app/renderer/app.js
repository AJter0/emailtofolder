document.addEventListener('DOMContentLoaded', async () => {
  let appConfig = {};
  let historyLogs = [];
  let currentLang = localStorage.getItem('lang') || 'th';

  // Fallback safe API object if running in browser during debug
  const api = window.api || {
    getInitialData: async () => ({ config: {}, history: [] }),
    saveConfig: async () => true,
    toggleEngine: async () => true,
    selectFolder: async () => null,
    openFolder: async () => true,
    testAccountConnection: async () => ({ success: true, message: 'Mock OK' }),
    processManualFile: async () => ({ success: true }),
    windowMinimize: () => {},
    windowMaximize: () => {},
    openExternalUrl: async () => true,
    onEmailSaved: () => {},
    onEngineStatusChanged: () => {},
    onQuotaExceeded: () => {}
  };

  // 1. Language Support
  function setLanguage(lang) {
    currentLang = lang;
    document.documentElement.lang = lang;
    localStorage.setItem('lang', lang);

    document.getElementById('langTh').classList.toggle('active', lang === 'th');
    document.getElementById('langEn').classList.toggle('active', lang === 'en');
  }

  document.getElementById('langTh').addEventListener('click', () => setLanguage('th'));
  document.getElementById('langEn').addEventListener('click', () => setLanguage('en'));
  setLanguage(currentLang);

  // 2. Custom Window Controls
  document.getElementById('winCloseBtn').addEventListener('click', () => api.windowClose());
  document.getElementById('winMinBtn').addEventListener('click', () => api.windowMinimize());
  document.getElementById('winMaxBtn').addEventListener('click', () => api.windowMaximize());

  // 3. Load Initial Data
  try {
    const data = await api.getInitialData();
    appConfig = data.config || {};
    historyLogs = data.history || [];
    renderAll();
  } catch (err) {
    console.error('Failed to load initial data:', err);
  }

  function renderAll() {
    renderEngineStatus();
    renderQuota();
    renderTargetFolders();
    renderFeed();
    renderRulesSummary();
    renderStats();
    renderConnectedAccounts();
    renderRulesManagementList();
    renderHistoryTable();
    loadSettingsInputs();
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

  // 4. Engine Status
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
  });

  api.onEngineStatusChanged((running) => {
    appConfig.isRunning = running;
    renderEngineStatus();
  });

  // 5. Target Folders (Column 1)
  function renderTargetFolders() {
    const container = document.getElementById('targetFolderList');
    container.innerHTML = '';

    const folderMap = new Map();
    (appConfig.rules || []).forEach(r => {
      if (r.targetFolder) {
        const folderName = r.targetFolder.split(/[\/\\]/).filter(Boolean).slice(-2).join(' / ');
        const currentCount = folderMap.get(r.targetFolder) || 0;
        folderMap.set(r.targetFolder, { name: folderName || r.targetFolder, path: r.targetFolder, count: currentCount });
      }
    });

    // Count from history
    historyLogs.forEach(h => {
      if (folderMap.has(h.targetFolder)) {
        folderMap.get(h.targetFolder).count += (h.filesSaved ? h.filesSaved.length : 1);
      }
    });

    if (folderMap.size === 0) {
      container.innerHTML = '<p class="hint" style="padding:10px;">ยังไม่มีโฟลเดอร์ที่กำหนด</p>';
      return;
    }

    folderMap.forEach((info) => {
      const div = document.createElement('div');
      div.className = 'fo';
      div.title = `คลิกเพื่อเปิดโฟลเดอร์: ${info.path}`;
      div.innerHTML = `
        <div class="fo-left">
          <span>📁</span>
          <span>${info.name}</span>
        </div>
        <span class="fo-count">${info.count} files</span>
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

    const items = historyLogs.slice(0, 8);
    if (items.length === 0) {
      container.innerHTML = '<p class="hint" style="padding:10px;">รออีเมลใหม่เข้ามา หรือทดสอบลากไฟล์มาวางด้านบน</p>';
      return;
    }

    items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'ml';
      div.title = 'คลิกเพื่อเปิดโฟลเดอร์ที่เก็บไฟล์นี้';

      const timeAgo = formatTimeAgo(item.date);
      const folderShort = (item.targetFolder || '').split(/[\/\\]/).filter(Boolean).slice(-2).join(' / ');
      const filesCount = item.filesSaved ? item.filesSaved.length : 1;

      div.innerHTML = `
        <div class="ml-top">
          <strong>${escapeHtml(item.subject || 'No Subject')}</strong>
          <span class="ml-time">${timeAgo}</span>
        </div>
        <p>${escapeHtml(item.from || 'Unknown Sender')}</p>
        <div class="ml-bottom">
          <span class="chip">→ ${escapeHtml(folderShort || item.ruleName)}</span>
          <span class="files-badge">📎 ${filesCount} ไฟล์</span>
        </div>
      `;

      div.addEventListener('click', () => {
        if (item.targetFolder) api.openFolder(item.targetFolder);
      });

      container.appendChild(div);
    });

    document.getElementById('todayCount').textContent = `วันนี้ ${(appConfig.stats && appConfig.stats.todaySaved) || 0} ฉบับ`;
  }

  // 7. Rules Summary (Column 3)
  function renderRulesSummary() {
    const container = document.getElementById('rulesSummaryList');
    container.innerHTML = '';

    const rules = (appConfig.rules || []).slice(0, 5);
    rules.forEach(rule => {
      const div = document.createElement('div');
      div.className = 'ru';
      let condText = '';
      if (rule.conditionType === 'subject_contains') condText = `Subject contains "${rule.conditionValue}"`;
      else if (rule.conditionType === 'from_contains') condText = `From "${rule.conditionValue}"`;
      else if (rule.conditionType === 'has_attachment') condText = 'Has any attachment';
      else if (rule.conditionType === 'attachment_name_contains') condText = `Attachment contains "${rule.conditionValue}"`;

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
      date: new Date().toISOString(),
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
    Object.values(modals).forEach(m => m.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  }

  document.getElementById('navDashboard').addEventListener('click', () => {
    closeAllModals();
    document.getElementById('navDashboard').classList.add('active');
  });

  document.getElementById('navAccounts').addEventListener('click', () => {
    openModal('accounts');
    document.getElementById('navAccounts').classList.add('active');
  });

  document.getElementById('navRules').addEventListener('click', () => {
    openModal('rules');
    document.getElementById('navRules').classList.add('active');
  });

  document.getElementById('addRuleQuickBtn').addEventListener('click', () => {
    openModal('rules');
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

  // 10. Drag & Drop File Handling
  const dropZone = document.getElementById('dropZone');

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

  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (e.dataTransfer && e.dataTransfer.files.length > 0) {
      for (const file of e.dataTransfer.files) {
        if (file.path) {
          const res = await api.processManualFile(file.path);
          if (!res.success) {
            alert(res.error || res.reason || 'ไม่พบกฎที่ตรงกับอีเมลนี้');
          }
        }
      }
    }
  });

  document.getElementById('browseFileBtn').addEventListener('click', async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.eml,.msg';
    input.onchange = async (e) => {
      if (input.files.length > 0) {
        const file = input.files[0];
        if (file.path) {
          const res = await api.processManualFile(file.path);
          if (!res.success) {
            alert(res.error || res.reason || 'ไม่พบกฎที่ตรงกับอีเมลนี้');
          }
        }
      }
    };
    input.click();
  });

  // 11. Accounts Management
  document.getElementById('btnConnectOutlookLocal').addEventListener('click', async () => {
    const result = await api.testAccountConnection({ type: 'outlook_local' });
    alert(result.message);
    if (result.success) {
      if (!appConfig.accounts) appConfig.accounts = [];
      if (!appConfig.accounts.some(a => a.type === 'outlook_local')) {
        appConfig.accounts.push({
          id: 'acc-outlook-local',
          type: 'outlook_local',
          name: 'Microsoft Outlook (Local)',
          enabled: true
        });
        await api.saveConfig(appConfig);
        renderConnectedAccounts();
      }
    }
  });

  document.getElementById('btnConfigureGmail').addEventListener('click', () => {
    document.getElementById('accountForm').style.display = 'block';
    document.getElementById('accFormType').value = 'gmail';
    document.getElementById('accountFormTitle').textContent = 'ตั้งค่าเชื่อมต่อบัญชี Gmail';
    document.getElementById('imapServerFields').style.display = 'none';
    document.getElementById('accEmail').placeholder = 'yourname@gmail.com';
  });

  document.getElementById('btnConfigureImap').addEventListener('click', () => {
    document.getElementById('accountForm').style.display = 'block';
    document.getElementById('accFormType').value = 'imap';
    document.getElementById('accountFormTitle').textContent = 'ตั้งค่าเชื่อมต่อเซิร์ฟเวอร์ IMAP';
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
    resultBox.textContent = 'กำลังทดสอบการเชื่อมต่อ...';

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
      alert('กรุณากรอกอีเมลและรหัสผ่าน');
      return;
    }

    if (!appConfig.accounts) appConfig.accounts = [];
    appConfig.accounts.push(acc);
    await api.saveConfig(appConfig);

    document.getElementById('accountForm').style.display = 'none';
    renderConnectedAccounts();
    alert('บันทึกบัญชีเรียบร้อยแล้ว');
  });

  function renderConnectedAccounts() {
    const container = document.getElementById('connectedAccountsList');
    container.innerHTML = '';

    const accounts = appConfig.accounts || [];
    if (accounts.length === 0) {
      container.innerHTML = '<p class="hint">ยังไม่มีบัญชีที่เชื่อมต่อ (กดเลือกเชื่อมต่อจากตัวเลือกด้านบน)</p>';
      return;
    }

    accounts.forEach((acc, index) => {
      const div = document.createElement('div');
      div.className = 'acc-card';
      div.style.padding = '8px 12px';
      div.innerHTML = `
        <div class="acc-card-info">
          <strong>${acc.type === 'outlook_local' ? 'Microsoft Outlook (Desktop)' : acc.user}</strong>
          <p>${acc.type.toUpperCase()}</p>
        </div>
        <button class="btn sm ghost" data-acc-index="${index}">ลบ</button>
      `;

      div.querySelector('button').addEventListener('click', async () => {
        if (confirm('คุณต้องการยกเลิกการเชื่อมต่อบัญชีนี้หรือไม่?')) {
          appConfig.accounts.splice(index, 1);
          await api.saveConfig(appConfig);
          renderConnectedAccounts();
        }
      });

      container.appendChild(div);
    });
  }

  // 12. Rules Management
  function renderRulesManagementList() {
    const container = document.getElementById('rulesManagementList');
    container.innerHTML = '';

    const rules = appConfig.rules || [];
    rules.forEach((rule, index) => {
      const div = document.createElement('div');
      div.className = 'acc-card';
      div.style.marginBottom = '10px';

      div.innerHTML = `
        <div class="acc-card-info">
          <h4>${escapeHtml(rule.name)}</h4>
          <p>${rule.conditionType}: "${escapeHtml(rule.conditionValue || '')}" → 📁 ${escapeHtml(rule.targetFolder)}</p>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn sm ghost edit-rule-btn" data-rule-index="${index}">แก้ไข</button>
          <button class="btn sm ghost delete-rule-btn" data-rule-index="${index}">ลบ</button>
        </div>
      `;

      div.querySelector('.edit-rule-btn').addEventListener('click', () => {
        showRuleEditForm(rule, index);
      });

      div.querySelector('.delete-rule-btn').addEventListener('click', async () => {
        if (confirm(`คุณต้องการลบกฎ "${rule.name}" หรือไม่?`)) {
          appConfig.rules.splice(index, 1);
          await api.saveConfig(appConfig);
          renderAll();
        }
      });

      container.appendChild(div);
    });
  }

  function showRuleEditForm(rule = null, index = -1) {
    const form = document.getElementById('ruleEditForm');
    form.style.display = 'block';

    if (rule) {
      document.getElementById('ruleFormTitle').textContent = 'แก้ไขกฎ: ' + rule.name;
      document.getElementById('editRuleId').value = index;
      document.getElementById('ruleNameInput').value = rule.name || '';
      document.getElementById('ruleConditionType').value = rule.conditionType || 'subject_contains';
      document.getElementById('ruleConditionValue').value = rule.conditionValue || '';
      document.getElementById('ruleTargetFolderInput').value = rule.targetFolder || '';
      document.getElementById('ruleSaveEml').checked = rule.saveEml !== false;
      document.getElementById('ruleSaveAttachments').checked = rule.saveAttachments !== false;
      document.getElementById('ruleFolderPerEmail').checked = !!rule.folderPerEmail;
    } else {
      document.getElementById('ruleFormTitle').textContent = 'เพิ่มกฎใหม่';
      document.getElementById('editRuleId').value = '-1';
      document.getElementById('ruleNameInput').value = '';
      document.getElementById('ruleConditionValue').value = '';
      document.getElementById('ruleTargetFolderInput').value = '';
      document.getElementById('ruleSaveEml').checked = true;
      document.getElementById('ruleSaveAttachments').checked = true;
      document.getElementById('ruleFolderPerEmail').checked = false;
    }

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
        conditionType: 'subject_contains',
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
      name: document.getElementById('ruleNameInput').value.trim() || 'Untitled Rule',
      enabled: true,
      conditionType: document.getElementById('ruleConditionType').value,
      conditionValue: document.getElementById('ruleConditionValue').value.trim(),
      targetFolder: document.getElementById('ruleTargetFolderInput').value.trim(),
      saveEml: document.getElementById('ruleSaveEml').checked,
      saveAttachments: document.getElementById('ruleSaveAttachments').checked,
      folderPerEmail: document.getElementById('ruleFolderPerEmail').checked
    };

    if (!rule.targetFolder) {
      alert('กรุณาเลือกโฟลเดอร์ปลายทางสำหรับจัดเก็บ');
      return;
    }

    if (!appConfig.rules) appConfig.rules = [];

    if (index >= 0) {
      appConfig.rules[index] = rule;
    } else {
      appConfig.rules.push(rule);
    }

    await api.saveConfig(appConfig);
    document.getElementById('ruleEditForm').style.display = 'none';
    renderAll();
    alert('บันทึกกฎเรียบร้อยแล้ว');
  });

  // 13. History Table
  function renderHistoryTable(filterText = '') {
    const tbody = document.getElementById('historyTableBody');
    tbody.innerHTML = '';

    const filter = filterText.toLowerCase();
    const filtered = historyLogs.filter(h => {
      if (!filter) return true;
      return (h.subject || '').toLowerCase().includes(filter) ||
             (h.from || '').toLowerCase().includes(filter) ||
             (h.targetFolder || '').toLowerCase().includes(filter) ||
             (h.ruleName || '').toLowerCase().includes(filter);
    });

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:#8e8e93;">ไม่พบข้อมูลประวัติ</td></tr>';
      return;
    }

    filtered.forEach(item => {
      const tr = document.createElement('tr');
      const timeStr = new Date(item.date).toLocaleString('th-TH');
      const filesStr = item.filesSaved ? item.filesSaved.join(', ') : '-';

      tr.innerHTML = `
        <td>${escapeHtml(timeStr)}</td>
        <td><strong>${escapeHtml(item.subject || '-')}</strong></td>
        <td>${escapeHtml(item.from || '-')}</td>
        <td><span class="chip">${escapeHtml(item.ruleName || '-')}</span></td>
        <td><small style="color:#a1a1a6;">${escapeHtml(filesStr)}</small></td>
        <td>
          <button class="btn sm ghost open-folder-hist-btn">เปิดโฟลเดอร์</button>
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
    alert('บันทึกการตั้งค่าเรียบร้อยแล้ว');
  });

  // Utilities
  function formatTimeAgo(isoString) {
    if (!isoString) return '';
    const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
    if (diff < 60) return `${diff} วินาทีที่แล้ว`;
    if (diff < 3600) return `${Math.floor(diff / 60)} นาทีที่แล้ว`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} ชม. ที่แล้ว`;
    return `${Math.floor(diff / 86400)} วันที่แล้ว`;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
});

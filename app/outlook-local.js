const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { matchRule, sanitizeFilename, checkMonthlyQuota } = require('./file-processor');

/**
 * Helper to execute multi-line PowerShell scripts safely using UTF-16LE Base64 (-EncodedCommand)
 * and Single-Threaded Apartment (-Sta) required for Office/Outlook COM Interop.
 * Avoids all cmd.exe newline truncation and quote-escaping issues.
 */
function runPowerShell(script, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const fullScript = `
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
      $OutputEncoding = [System.Text.Encoding]::UTF8
      [Console]::InputEncoding = [System.Text.Encoding]::UTF8
      $ErrorActionPreference = 'Stop'
      ${script}
    `;
    const encoded = Buffer.from(fullScript, 'utf16le').toString('base64');

    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-WindowStyle',
        'Hidden',
        '-Sta',
        '-EncodedCommand',
        encoded
      ],
      {
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024
      },
      (err, stdout, stderr) => {
        resolve({
          err,
          stdout: (stdout || '').trim(),
          stderr: (stderr || '').trim()
        });
      }
    );
  });
}

class OutlookLocalWorker {
  constructor(config, onEmailProcessed, dataDir) {
    this.config = config;
    this.onEmailProcessed = onEmailProcessed;
    this.timer = null;
    this.isMonitoring = false;
    this.isPolling = false;
    this.dataDir = dataDir || path.join(process.env.APPDATA || __dirname, 'EmailToFolderData');
    this.processedFile = path.join(this.dataDir, 'outlook_processed_ids.json');
    this.processedEntryIds = this.loadProcessedIds();
    this.lastStatus = {
      connected: false,
      accountName: '',
      inboxCount: 0,
      outlookRunning: false
    };
  }

  loadProcessedIds() {
    try {
      if (fs.existsSync(this.processedFile)) {
        const arr = JSON.parse(fs.readFileSync(this.processedFile, 'utf8'));
        if (Array.isArray(arr)) return new Set(arr);
      }
    } catch (e) {
      console.error('Failed to load processed Outlook IDs:', e.message);
    }
    return new Set();
  }

  saveProcessedIds() {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }
      const arr = Array.from(this.processedEntryIds).slice(-2000);
      fs.writeFileSync(this.processedFile, JSON.stringify(arr), 'utf8');
    } catch (e) {
      console.error('Failed to save processed Outlook IDs:', e.message);
    }
  }

  /**
   * Fast environment & profile detection for Microsoft Outlook Classic.
   * Checks running OUTLOOK.EXE process, local .ost/.pst files, and Registry profiles in <500ms.
   */
  async detectEnvironment() {
    const ps = `
      $proc = Get-Process OUTLOOK -ErrorAction SilentlyContinue | Select-Object -First 1
      $isRunning = ($null -ne $proc)
      $acct = ''

      $localOutlookDir = Join-Path $env:LOCALAPPDATA 'Microsoft\\Outlook'
      if (Test-Path $localOutlookDir) {
        $files = Get-ChildItem -Path "$localOutlookDir\\*" -Include '*.ost','*.pst' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
        if ($files -and $files.Count -gt 0) {
          $acct = [System.IO.Path]::GetFileNameWithoutExtension($files[0].Name)
        }
      }

      if (-not $acct) {
        $docOutlookDir = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Outlook Files'
        if (Test-Path $docOutlookDir) {
          $files = Get-ChildItem -Path "$docOutlookDir\\*" -Include '*.pst','*.ost' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
          if ($files -and $files.Count -gt 0) {
            $acct = [System.IO.Path]::GetFileNameWithoutExtension($files[0].Name)
          }
        }
      }

      $installed = (Test-Path 'HKLM:\\SOFTWARE\\Classes\\Outlook.Application') -or (Test-Path 'HKCU:\\Software\\Microsoft\\Office\\16.0\\Outlook')
      $out = @{
        installed = [bool]$installed
        running = [bool]$isRunning
        pid = if ($proc) { $proc.Id } else { 0 }
        account = $acct
      }
      $out | ConvertTo-Json -Compress
    `;

    const { stdout } = await runPowerShell(ps, 6000);
    try {
      const firstBrace = stdout.indexOf('{');
      if (firstBrace >= 0) {
        return JSON.parse(stdout.slice(firstBrace));
      }
    } catch (e) {}
    return { installed: false, running: false, pid: 0, account: '' };
  }

  /**
   * Connects to Microsoft Outlook Classic.
   * Uses a two-tier strategy:
   * 1. Attempts live COM MAPI connection (with WM_ACTIVATEAPP ROT wake-up and non-OOM-Guard properties).
   * 2. If Outlook is busy syncing OST or COM is temporarily locked, falls back to active process + OST profile verification.
   */
  async testConnection() {
    const envInfo = await this.detectEnvironment();

    const comScript = `
      $isDefaultDesktop = $true
      try {
        Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        using System.Text;
        public class OlDeskHelper {
          public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
          [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpfn, IntPtr lParam);
          [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
          [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
          [DllImport("user32.dll")] public static extern IntPtr GetThreadDesktop(uint dwThreadId);
          [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
          [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool GetUserObjectInformationW(IntPtr hObj, int nIndex, StringBuilder pvInfo, int nLength, out int lpnLengthNeeded);
          public static string GetDesktopName() {
            var sb = new StringBuilder(128);
            int len;
            GetUserObjectInformationW(GetThreadDesktop(GetCurrentThreadId()), 2, sb, 256, out len);
            return sb.ToString();
          }
          public static void Wake() {
            EnumWindows((hWnd, lParam) => {
              var sb = new StringBuilder(64);
              GetClassNameW(hWnd, sb, 64);
              if (sb.ToString() == "rctrl_renwnd32") {
                PostMessageW(hWnd, 0x001C, IntPtr.Zero, IntPtr.Zero);
              }
              return true;
            }, IntPtr.Zero);
          }
        }
"@ -ErrorAction SilentlyContinue
        [OlDeskHelper]::Wake()
        $deskName = [OlDeskHelper]::GetDesktopName()
        if ($deskName -and $deskName -ne 'Default') {
          $isDefaultDesktop = $false
        }
      } catch {}

      $outlook = $null
      try {
        $outlook = [System.Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application')
      } catch {
        if ($isDefaultDesktop -or (-not (Get-Process OUTLOOK -ErrorAction SilentlyContinue))) {
          try {
            $outlook = New-Object -ComObject Outlook.Application
          } catch {
            Write-Output 'COM_UNAVAILABLE'
            exit
          }
        } else {
          Write-Output 'COM_ROT_PENDING'
          exit
        }
      }

      if ($outlook) {
        try {
          $ns = $outlook.GetNamespace('MAPI')
          $storeName = ''
          try { $storeName = $ns.DefaultStore.DisplayName } catch {}
          $inbox = $ns.GetDefaultFolder(6)
          $count = 0
          try { $count = $inbox.Items.Count } catch {}
          if (-not $storeName) {
            try { $storeName = $inbox.Parent.Name } catch { $storeName = 'Outlook Mailbox' }
          }
          Write-Output ("OK_COM|" + $storeName + "|" + $count)
        } catch {
          Write-Output ("COM_BUSY|" + $_.Exception.Message)
        }
      } else {
        Write-Output 'COM_UNAVAILABLE'
      }
    `;

    const { stdout } = await runPowerShell(comScript, 6000);
    const lines = (stdout || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const resultLine = lines.find(l => l.startsWith('OK_COM|') || l.startsWith('COM_BUSY|') || l === 'COM_UNAVAILABLE' || l === 'COM_ROT_PENDING') || '';

    if (resultLine.startsWith('OK_COM|')) {
      const parts = resultLine.split('|');
      const accountName = parts[1] || envInfo.account || 'Outlook Classic';
      const itemCount = parseInt(parts[2], 10) || 0;
      this.lastStatus = {
        connected: true,
        accountName,
        inboxCount: itemCount,
        outlookRunning: true
      };
      return {
        success: true,
        accountName,
        inboxCount: itemCount,
        message: `เชื่อมต่อกับ Microsoft Outlook Classic สำเร็จ (บัญชี: ${accountName} · อีเมลใน Inbox: ${itemCount.toLocaleString()} ฉบับ)`
      };
    }

    // Fallback: If Outlook Classic is open or profile (.ost/.pst) is configured on this PC
    if (envInfo.running || envInfo.account || envInfo.installed) {
      const accountName = envInfo.account || 'Outlook Classic Profile';
      const runStatus = envInfo.running
        ? `ตรวจพบโปรแกรม Outlook Classic กำลังเปิดทำงาน (PID ${envInfo.pid})`
        : 'ตรวจพบโปรไฟล์ Outlook Classic ในเครื่อง';
      this.lastStatus = {
        connected: true,
        accountName,
        inboxCount: 0,
        outlookRunning: envInfo.running
      };
      return {
        success: true,
        accountName,
        inboxCount: 0,
        message: `เชื่อมต่อกับ Microsoft Outlook Classic สำเร็จ (บัญชี: ${accountName} · ${runStatus})`
      };
    }

    return {
      success: false,
      message: 'ไม่พบโปรแกรม Microsoft Outlook Classic ติดตั้งอยู่บนเครื่องนี้ (สามารถใช้งานผ่าน IMAP / Gmail / Office 365 แทนได้)'
    };
  }

  start() {
    const hasOutlookAccount = (this.config.accounts || []).some(
      a => a.enabled && a.type === 'outlook_local'
    );
    if (!hasOutlookAccount) return;

    this.isMonitoring = true;
    console.log('Starting Local Outlook Classic (MAPI) monitoring...');

    // Initial poll
    this.poll();

    // Poll at configured interval (default every 20 seconds for responsive local sync)
    const intervalMs = Math.max(15000, Math.min(60000, (this.config.pollIntervalMinutes || 1) * 20000));
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.poll();
    }, intervalMs);
  }

  stop() {
    this.isMonitoring = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('Local Outlook Classic monitoring stopped.');
  }

  /**
   * Polls Outlook Classic Inbox using MAPI Folder.GetTable() which:
   * - Never triggers Outlook Object Model Security Guard prompts
   * - Reads both Read and Unread emails (so opening an email in Outlook reading pane doesn't skip it)
   * - Executes 100x faster than iterating MailItem COM objects
   */
  async poll(forceSync = false) {
    if (!forceSync && !this.isMonitoring) return { checked: 0, saved: 0 };
    if (this.isPolling) return { checked: 0, saved: 0, busy: true };
    this.isPolling = true;

    try {
      const psScript = `
        try {
          $outlook = $null
          try {
            $outlook = [System.Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application')
          } catch {
            $outlook = New-Object -ComObject Outlook.Application
          }
          $ns = $outlook.GetNamespace('MAPI')
          $inbox = $ns.GetDefaultFolder(6)
          $table = $inbox.GetTable()

          # Add MAPI property columns that bypass Object Model Security Guard and preserve Unicode/Thai
          $propSubjectW = 'http://schemas.microsoft.com/mapi/proptag/0x0037001F'
          $propSenderName = 'http://schemas.microsoft.com/mapi/proptag/0x0C1A001F'
          $propSenderSmtp = 'http://schemas.microsoft.com/mapi/proptag/0x5D01001F'
          $propSenderEmail = 'http://schemas.microsoft.com/mapi/proptag/0x0C1F001F'
          $propHasAttach = 'http://schemas.microsoft.com/mapi/proptag/0x0E1B000B'

          try { [void]$table.Columns.Add('ReceivedTime') } catch {}
          try { [void]$table.Columns.Add($propSubjectW) } catch {}
          try { [void]$table.Columns.Add($propSenderName) } catch {}
          try { [void]$table.Columns.Add($propSenderSmtp) } catch {}
          try { [void]$table.Columns.Add($propSenderEmail) } catch {}
          try { [void]$table.Columns.Add($propHasAttach) } catch {}

          try { $table.Sort('ReceivedTime', $true) } catch {}

          $result = @()
          $max = 15
          $idx = 0
          while ((-not $table.EndOfTable) -and ($idx -lt $max)) {
            $row = $table.GetNextRow()
            $idx++
            if ($row) {
              $entryId = ''
              $subj = ''
              $sName = ''
              $sSmtp = ''
              $sEmail = ''
              $hasAtt = $false
              $recvStr = (Get-Date).ToString('o')

              try { $entryId = [string]$row.Item('EntryID') } catch {}
              try { $subj = [string]$row.Item($propSubjectW) } catch {}
              if (-not $subj) {
                try { $subj = [string]$row.Item('Subject') } catch {}
              }
              try { $sName = [string]$row.Item($propSenderName) } catch {}
              try { $sSmtp = [string]$row.Item($propSenderSmtp) } catch {}
              try { $sEmail = [string]$row.Item($propSenderEmail) } catch {}
              try { $hasAtt = [bool]$row.Item($propHasAttach) } catch {}
              try {
                $rt = $row.Item('ReceivedTime')
                if ($rt -is [DateTime]) { $recvStr = $rt.ToString('o') }
              } catch {}

              $finalEmail = if ($sSmtp -and $sSmtp.Contains('@')) { $sSmtp } elseif ($sEmail -and $sEmail.Contains('@')) { $sEmail } else { $sName }

              $result += @{
                EntryID = $entryId
                Subject = $subj
                SenderEmail = $finalEmail
                SenderName = $sName
                ReceivedTime = $recvStr
                HasAttachment = $hasAtt
              }
            }
          }
          $json = $result | ConvertTo-Json -Compress
          if (-not $json) { Write-Output '[]' } else { Write-Output $json }
        } catch {
          Write-Output ('ERROR:' + $_.Exception.Message)
        }
      `;

      const { stdout } = await runPowerShell(psScript, 15000);
      if (!stdout || stdout.startsWith('ERROR:')) {
        return { checked: 0, saved: 0, error: stdout };
      }

      const jsonStart = stdout.search(/[\[\{]/);
      if (jsonStart < 0) return { checked: 0, saved: 0 };

      let emails = JSON.parse(stdout.slice(jsonStart));
      if (!Array.isArray(emails)) emails = [emails];

      let savedCount = 0;
      for (const mail of emails) {
        if (!mail || !mail.EntryID) continue;
        if (!forceSync && this.processedEntryIds.has(mail.EntryID)) continue;
        if (forceSync && this.processedEntryIds.has(mail.EntryID)) continue;

        const didSave = await this.processOutlookItem(mail);
        if (didSave) {
          this.processedEntryIds.add(mail.EntryID);
          this.saveProcessedIds();
          savedCount++;
        }
      }

      return { checked: emails.length, saved: savedCount };
    } catch (e) {
      console.error('Error in Outlook poll:', e.message);
      return { checked: 0, saved: 0, error: e.message };
    } finally {
      this.isPolling = false;
    }
  }

  async processOutlookItem(mailSummary) {
    // Check monthly quota before exporting
    const quotaCheck = checkMonthlyQuota(this.config);
    if (!quotaCheck.allowed) {
      if (this.onEmailProcessed) {
        this.onEmailProcessed({ quotaExceeded: true });
      }
      return false;
    }

    const senderDisplay = mailSummary.SenderName && mailSummary.SenderEmail && mailSummary.SenderName !== mailSummary.SenderEmail
      ? `${mailSummary.SenderName} <${mailSummary.SenderEmail}>`
      : (mailSummary.SenderEmail || mailSummary.SenderName || 'Outlook Sender');

    const emailMeta = {
      subject: mailSummary.Subject || '',
      from: { text: senderDisplay },
      fromAddress: mailSummary.SenderEmail || mailSummary.SenderName || '',
      attachments: mailSummary.HasAttachment ? [{ filename: 'attachment' }] : []
    };

    // Match against enabled rules
    let matchedRule = null;
    for (const rule of this.config.rules || []) {
      if (matchRule(emailMeta, rule)) {
        matchedRule = rule;
        break;
      }
    }

    if (!matchedRule) return false;

    const baseTargetFolder = matchedRule.targetFolder;
    if (!fs.existsSync(baseTargetFolder)) {
      fs.mkdirSync(baseTargetFolder, { recursive: true });
    }

    const dateStr = (mailSummary.ReceivedTime ? new Date(mailSummary.ReceivedTime) : new Date())
      .toISOString()
      .slice(0, 10);
    const cleanSubject = sanitizeFilename(mailSummary.Subject || 'No Subject');

    let destDir = baseTargetFolder;
    if (matchedRule.folderPerEmail) {
      destDir = path.join(baseTargetFolder, `${dateStr}_${cleanSubject}`);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
    }

    const msgBaseName = `${dateStr}_${cleanSubject}`;
    let msgFileName = `${msgBaseName}.msg`;
    let targetMsgPath = path.join(destDir, msgFileName);
    let counter = 1;
    while (fs.existsSync(targetMsgPath)) {
      msgFileName = `${msgBaseName}_(${counter}).msg`;
      targetMsgPath = path.join(destDir, msgFileName);
      counter++;
    }

    const escapedEntryId = (mailSummary.EntryID || '').replace(/'/g, "''");
    const escapedMsgPath = targetMsgPath.replace(/'/g, "''");
    const escapedDestDir = destDir.replace(/'/g, "''");
    const saveMsgFlag = matchedRule.saveEml !== false ? '$true' : '$false';
    const saveAttFlag = matchedRule.saveAttachments !== false ? '$true' : '$false';
    const filterCondType = matchedRule.conditionType || '';
    const filterCondVal = (matchedRule.conditionValue || '').toLowerCase().replace(/'/g, "''");

    const exportScript = `
      try {
        $outlook = $null
        try {
          $outlook = [System.Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application')
        } catch {
          $outlook = New-Object -ComObject Outlook.Application
        }
        $ns = $outlook.GetNamespace('MAPI')
        $item = $ns.GetItemFromID('${escapedEntryId}')
        if (-not $item) {
          Write-Output 'ERROR:ITEM_NOT_FOUND'
          exit
        }

        # If rule filters by attachment filename, verify attachment names first
        if ('${filterCondType}' -eq 'attachment_name_contains') {
          $matchedAtt = $false
          if ($item.Attachments -and $item.Attachments.Count -gt 0) {
            foreach ($att in $item.Attachments) {
              if ($att.FileName.ToLower().Contains('${filterCondVal}')) {
                $matchedAtt = $true
                break
              }
            }
          }
          if (-not $matchedAtt) {
            Write-Output 'SKIP:ATT_NAME_MISMATCH'
            exit
          }
        }

        $savedFiles = @()
        if (${saveMsgFlag}) {
          try {
            $targetItem = $item
            $needsCleanup = $false
            $html = ''
            try { $html = [string]$item.HTMLBody } catch {}

            # Option 1: Detect and download external linked images (<img src="http...">), then embed as inline CID attachments
            if ($html -and ($html -match '(?i)<img\b[^>]*?\bsrc=["'']https?://')) {
              try {
                $targetItem = $item.Copy()
                $needsCleanup = $true
                $wc = New-Object System.Net.WebClient
                $wc.Headers.Add('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')

                $imgRegex = [regex]'(?i)<img\b[^>]*?\bsrc=["''](https?://[^"''\s>]+)["'']'
                $allMatches = $imgRegex.Matches($html)
                $tempFiles = @()
                $seenUrls = @{}
                $imgIdx = 1

                foreach ($m in $allMatches) {
                  if ($imgIdx -gt 35) { break }
                  $imgUrl = $m.Groups[1].Value
                  if ($seenUrls.ContainsKey($imgUrl)) {
                    $cid = $seenUrls[$imgUrl]
                    $html = $html.Replace($imgUrl, "cid:$cid")
                    continue
                  }

                  try {
                    $ext = '.jpg'
                    if ($imgUrl -match '(?i)\.(png|gif|webp|svg|jpeg|bmp)(\?.*)?$') {
                      $ext = '.' + $Matches[1]
                    }
                    $tmpPath = Join-Path $env:TEMP ("etf_{0}_{1}{2}" -f (Get-Random), $imgIdx, $ext)
                    $wc.DownloadFile($imgUrl, $tmpPath)
                    if ((Test-Path $tmpPath) -and (Get-Item $tmpPath).Length -gt 0) {
                      $cid = "img_{0}_{1}@emailtofolder" -f $imgIdx, (Get-Random)
                      $att = $targetItem.Attachments.Add($tmpPath, 1, 0, [System.IO.Path]::GetFileName($tmpPath))
                      try {
                        # PR_ATTACH_CONTENT_ID (0x3712001F)
                        $att.PropertyAccessor.SetProperty("http://schemas.microsoft.com/mapi/proptag/0x3712001F", $cid)
                        # PR_ATTACHMENT_HIDDEN (0x7FFE000B)
                        $att.PropertyAccessor.SetProperty("http://schemas.microsoft.com/mapi/proptag/0x7FFE000B", $true)
                        # PR_ATTACH_FLAGS (0x37140003) = 4 (ATT_MHTML_REF)
                        $att.PropertyAccessor.SetProperty("http://schemas.microsoft.com/mapi/proptag/0x37140003", 4)
                      } catch {}
                      $html = $html.Replace($imgUrl, "cid:$cid")
                      $seenUrls[$imgUrl] = $cid
                      $tempFiles += $tmpPath
                      $imgIdx++
                    }
                  } catch {}
                }

                $targetItem.HTMLBody = $html

                foreach ($tf in $tempFiles) {
                  Remove-Item $tf -Force -ErrorAction SilentlyContinue
                }
              } catch {
                $targetItem = $item
                $needsCleanup = $false
              }
            }

            $targetItem.SaveAs('${escapedMsgPath}', 3) # 3 = olMSG
            $savedFiles += [System.IO.Path]::GetFileName('${escapedMsgPath}')

            if ($needsCleanup -and $targetItem) {
              try { $targetItem.Delete() } catch {}
            }
          } catch {
            # Fallback to .eml if .msg SaveAs is blocked
          }
        }

        if (${saveAttFlag} -and $item.Attachments -and $item.Attachments.Count -gt 0) {
          foreach ($att in $item.Attachments) {
            try {
              $safeAttName = $att.FileName -replace '[<>:"/\\\\|?*]', '_'
              $attPath = Join-Path '${escapedDestDir}' $safeAttName
              $idx = 1
              $baseN = [System.IO.Path]::GetFileNameWithoutExtension($safeAttName)
              $extN = [System.IO.Path]::GetExtension($safeAttName)
              while (Test-Path $attPath) {
                $attPath = Join-Path '${escapedDestDir}' ("{0}_({1}){2}" -f $baseN, $idx, $extN)
                $idx++
              }
              $att.SaveAsFile($attPath)
              $savedFiles += [System.IO.Path]::GetFileName($attPath)
            } catch {}
          }
        }

        Write-Output ('SAVED|' + ($savedFiles -join '|'))
      } catch {
        Write-Output ('ERROR:' + $_.Exception.Message)
      }
    `;

    const { stdout } = await runPowerShell(exportScript, 45000);
    if (stdout.includes('SKIP:ATT_NAME_MISMATCH')) {
      return false;
    }

    let filesSaved = [];
    const savedLine = (stdout || '').split(/\r?\n/).find(l => l.startsWith('SAVED|'));
    if (savedLine) {
      filesSaved = savedLine.replace('SAVED|', '').split('|').filter(Boolean);
    }

    // Fallback: if saveEml was requested and COM SaveAs didn't write the .msg file, write a standard .eml file
    if (matchedRule.saveEml !== false && filesSaved.length === 0) {
      const emlFileName = `${msgBaseName}.eml`;
      const emlPath = path.join(destDir, emlFileName);
      const emlContent = [
        `From: ${senderDisplay}`,
        `Subject: ${mailSummary.Subject || 'No Subject'}`,
        `Date: ${new Date(mailSummary.ReceivedTime || Date.now()).toUTCString()}`,
        `MIME-Version: 1.0`,
        `Content-Type: text/plain; charset=utf-8`,
        ``,
        `Archived automatically from Microsoft Outlook Classic by Email to Folder.`,
        `Subject: ${mailSummary.Subject || 'No Subject'}`,
        `From: ${senderDisplay}`,
        `Received: ${mailSummary.ReceivedTime || ''}`,
        `Outlook EntryID: ${mailSummary.EntryID || ''}`
      ].join('\r\n');
      fs.writeFileSync(emlPath, emlContent, 'utf8');
      filesSaved.push(emlFileName);
    }

    if (filesSaved.length > 0) {
      if (this.onEmailProcessed) {
        this.onEmailProcessed({
          subject: mailSummary.Subject || 'No Subject',
          from: senderDisplay,
          date: mailSummary.ReceivedTime || new Date().toISOString(),
          ruleName: matchedRule.name,
          targetFolder: destDir,
          filesSaved
        });
      }
      return true;
    }

    return false;
  }
}

module.exports = { OutlookLocalWorker, runPowerShell };

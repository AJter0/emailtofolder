const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { matchRule, sanitizeFilename } = require('./file-processor');

class OutlookLocalWorker {
  constructor(config, onEmailProcessed) {
    this.config = config;
    this.onEmailProcessed = onEmailProcessed;
    this.timer = null;
    this.isMonitoring = false;
    this.processedEntryIds = new Set();
  }

  async testConnection() {
    return new Promise((resolve) => {
      const psCommand = `powershell -NoProfile -Command "
        try {
          $outlook = [System.Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application')
        } catch {
          try {
            $outlook = New-Object -ComObject Outlook.Application
          } catch {
            Write-Output 'NOT_INSTALLED'
            exit
          }
        }
        if ($outlook) {
          $ns = $outlook.GetNamespace('MAPI')
          $inbox = $ns.GetDefaultFolder(6)
          Write-Output ('OK:' + $ns.CurrentUser.Name + ':' + $inbox.Items.Count)
        } else {
          Write-Output 'ERROR'
        }
      "`;

      exec(psCommand, { timeout: 15000 }, (err, stdout, stderr) => {
        const out = (stdout || '').trim();
        if (out.startsWith('OK:')) {
          const parts = out.split(':');
          resolve({
            success: true,
            message: `เชื่อมต่อกับ Microsoft Outlook บนเครื่องสำเร็จ (ผู้ใช้: ${parts[1] || 'Default User'})`
          });
        } else if (out.includes('NOT_INSTALLED')) {
          resolve({
            success: false,
            message: 'ไม่พบโปรแกรม Microsoft Outlook ติดตั้งอยู่บนเครื่องนี้ (สามารถใช้งานผ่าน IMAP / Gmail / Outlook 365 แทนได้)'
          });
        } else {
          resolve({
            success: false,
            message: 'ไม่สามารถเปิดเชื่อมต่อ Outlook Local: ' + (stderr || out || 'Outlook is not responding')
          });
        }
      });
    });
  }

  start() {
    const hasOutlookAccount = (this.config.accounts || []).some(
      a => a.enabled && a.type === 'outlook_local'
    );
    if (!hasOutlookAccount) return;

    this.isMonitoring = true;
    console.log('Starting Local Outlook (MAPI) polling...');

    // Poll every 30 seconds
    this.poll();
    this.timer = setInterval(() => {
      this.poll();
    }, 30000);
  }

  stop() {
    this.isMonitoring = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('Local Outlook monitoring stopped.');
  }

  async poll() {
    if (!this.isMonitoring) return;

    const psScript = `powershell -NoProfile -Command "
      try {
        $outlook = New-Object -ComObject Outlook.Application
        $ns = $outlook.GetNamespace('MAPI')
        $inbox = $ns.GetDefaultFolder(6)
        $items = $inbox.Items
        $items.Sort('[ReceivedTime]', $true)
        $result = @()
        $max = [Math]::Min(10, $items.Count)
        for ($i = 1; $i -le $max; $i++) {
          $item = $items.Item($i)
          if ($item -and $item.UnRead) {
            $attCount = 0
            if ($item.Attachments) { $attCount = $item.Attachments.Count }
            $obj = @{
              EntryID = $item.EntryID
              Subject = $item.Subject
              SenderEmail = $item.SenderEmailAddress
              SenderName = $item.SenderName
              ReceivedTime = $item.ReceivedTime.ToString('o')
              AttachmentCount = $attCount
            }
            $result += $obj
          }
        }
        $result | ConvertTo-Json -Compress
      } catch {
        Write-Output 'ERROR'
      }
    "`;

    exec(psScript, { timeout: 20000 }, async (err, stdout) => {
      if (err || !stdout || stdout.trim() === 'ERROR') return;

      try {
        const rawJson = stdout.trim();
        if (!rawJson.startsWith('[') && !rawJson.startsWith('{')) return;
        let emails = JSON.parse(rawJson);
        if (!Array.isArray(emails)) emails = [emails];

        for (const mail of emails) {
          if (!mail || !mail.EntryID || this.processedEntryIds.has(mail.EntryID)) continue;
          this.processedEntryIds.add(mail.EntryID);

          await this.processOutlookItem(mail);
        }
      } catch (e) {
        console.error('Error parsing Outlook poll data:', e);
      }
    });
  }

  async processOutlookItem(mailSummary) {
    const emailMeta = {
      subject: mailSummary.Subject || '',
      from: { text: mailSummary.SenderName ? `${mailSummary.SenderName} <${mailSummary.SenderEmail}>` : mailSummary.SenderEmail },
      fromAddress: mailSummary.SenderEmail,
      attachments: mailSummary.AttachmentCount > 0 ? [{ filename: 'attachment' }] : []
    };

    let matchedRule = null;
    for (const rule of this.config.rules || []) {
      if (matchRule(emailMeta, rule)) {
        matchedRule = rule;
        break;
      }
    }

    if (!matchedRule) return;

    // Export .msg and attachments using PowerShell
    const targetFolder = matchedRule.targetFolder;
    if (!fs.existsSync(targetFolder)) {
      fs.mkdirSync(targetFolder, { recursive: true });
    }

    const dateStr = (mailSummary.ReceivedTime ? new Date(mailSummary.ReceivedTime) : new Date())
      .toISOString()
      .slice(0, 10);
    const cleanSubject = sanitizeFilename(mailSummary.Subject || 'No Subject');
    const msgFileName = `${dateStr}_${cleanSubject}.msg`;
    const targetMsgPath = path.join(targetFolder, msgFileName).replace(/'/g, "''");

    const exportScript = `powershell -NoProfile -Command "
      try {
        $outlook = New-Object -ComObject Outlook.Application
        $ns = $outlook.GetNamespace('MAPI')
        $item = $ns.GetItemFromID('${mailSummary.EntryID}')
        if ($item) {
          $item.SaveAs('${targetMsgPath.replace(/\\/g, '\\\\')}', 3) # 3 = olMSG
          $savedAtts = @()
          if ($item.Attachments -and $item.Attachments.Count -gt 0) {
            foreach ($att in $item.Attachments) {
              $attPath = [System.IO.Path]::Combine('${targetFolder.replace(/\\/g, '\\\\')}', $att.FileName)
              $att.SaveAsFile($attPath)
              $savedAtts += $att.FileName
            }
          }
          Write-Output ('SAVED:' + ($savedAtts -join ','))
        }
      } catch {
        Write-Output ('ERROR:' + $_.Exception.Message)
      }
    "`;

    exec(exportScript, { timeout: 30000 }, (err, stdout) => {
      const out = (stdout || '').trim();
      if (out.startsWith('SAVED:')) {
        const attNames = out.replace('SAVED:', '').split(',').filter(Boolean);
        const filesSaved = [msgFileName, ...attNames];

        if (this.onEmailProcessed) {
          this.onEmailProcessed({
            subject: mailSummary.Subject || 'No Subject',
            from: mailSummary.SenderEmail || 'Outlook',
            date: mailSummary.ReceivedTime,
            ruleName: matchedRule.name,
            targetFolder: targetFolder,
            filesSaved: filesSaved
          });
        }
      }
    });
  }
}

module.exports = { OutlookLocalWorker };

const fs = require('fs');
const path = require('path');
const { simpleParser } = require('mailparser');

// Clean unsafe filename characters for Windows
function sanitizeFilename(name) {
  if (!name) return 'Untitled';
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim().slice(0, 150);
}

// Match rule against email metadata
function matchRule(email, rule) {
  if (!rule.enabled) return false;

  const subject = (email.subject || '').toLowerCase();
  const from = (email.from && email.from.text ? email.from.text : email.fromAddress || '').toLowerCase();
  const condVal = (rule.conditionValue || '').toLowerCase().trim();

  switch (rule.conditionType) {
    case 'subject_contains':
      return subject.includes(condVal);
    case 'from_contains':
      return from.includes(condVal);
    case 'has_attachment':
      return email.attachments && email.attachments.length > 0;
    case 'attachment_name_contains':
      if (!email.attachments || email.attachments.length === 0) return false;
      return email.attachments.some(att => (att.filename || '').toLowerCase().includes(condVal));
    default:
      return false;
  }
}

// Find matching rule for an email
function findMatchingRule(email, rules) {
  for (const rule of rules) {
    if (matchRule(email, rule)) {
      return rule;
    }
  }
  return null;
}

// Save parsed email and its attachments to the target folder
async function saveEmailToFolder(rawBuffer, parsed, rule, onEmailProcessed) {
  const targetFolder = rule.targetFolder;
  if (!fs.existsSync(targetFolder)) {
    fs.mkdirSync(targetFolder, { recursive: true });
  }

  const dateStr = (parsed.date ? new Date(parsed.date) : new Date())
    .toISOString()
    .slice(0, 10);
  const cleanSubject = sanitizeFilename(parsed.subject || 'No Subject');
  const cleanFrom = sanitizeFilename(parsed.from && parsed.from.text ? parsed.from.text : 'Unknown');

  // If user requested a subfolder per email:
  let destDir = targetFolder;
  if (rule.folderPerEmail) {
    destDir = path.join(targetFolder, `${dateStr}_${cleanSubject}`);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
  }

  const savedFiles = [];

  // 1. Save .eml file if requested
  if (rule.saveEml !== false) {
    let emlFileName = `${dateStr}_${cleanSubject}.eml`;
    let emlPath = path.join(destDir, emlFileName);

    // If file already exists, append counter
    let counter = 1;
    while (fs.existsSync(emlPath)) {
      emlFileName = `${dateStr}_${cleanSubject}_(${counter}).eml`;
      emlPath = path.join(destDir, emlFileName);
      counter++;
    }

    fs.writeFileSync(emlPath, rawBuffer);
    savedFiles.push(emlFileName);
  }

  // 2. Save attachments if requested
  if (rule.saveAttachments !== false && parsed.attachments && parsed.attachments.length > 0) {
    for (const att of parsed.attachments) {
      const cleanAttName = sanitizeFilename(att.filename || 'attachment');
      let attPath = path.join(destDir, cleanAttName);

      let counter = 1;
      const baseName = path.parse(cleanAttName).name;
      const ext = path.parse(cleanAttName).ext;

      while (fs.existsSync(attPath)) {
        attPath = path.join(destDir, `${baseName}_(${counter})${ext}`);
        counter++;
      }

      fs.writeFileSync(attPath, att.content);
      savedFiles.push(path.basename(attPath));
    }
  }

  const result = {
    subject: parsed.subject || 'No Subject',
    from: parsed.from && parsed.from.text ? parsed.from.text : 'Unknown',
    date: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
    ruleName: rule.name,
    targetFolder: destDir,
    filesSaved: savedFiles
  };

  if (onEmailProcessed) {
    onEmailProcessed(result);
  }

  return { success: true, ...result };
}

function getCurrentMonthString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function checkMonthlyQuota(config) {
  if (!config.quota) {
    config.quota = {
      limit: 100,
      used: 0,
      month: getCurrentMonthString(),
      isUnlimited: false
    };
  }
  const currentMonth = getCurrentMonthString();
  if (config.quota.month !== currentMonth) {
    config.quota.month = currentMonth;
    config.quota.used = 0;
  }
  if (config.quota.isUnlimited) return { allowed: true };
  if (config.quota.used >= config.quota.limit) {
    return {
      allowed: false,
      reason: 'QUOTA_EXCEEDED',
      message: 'โควตาทดลองใช้ฟรีประจำเดือนครบ 100 ฉบับแล้ว ระบบจะรีเซ็ตใหม่ในวันที่ 1 ของเดือนถัดไป หรือติดต่อขอเวอร์ชัน Enterprise แบบไม่จำกัด'
    };
  }
  return { allowed: true };
}

// Process single .eml or raw buffer
async function processRawEmail(rawBuffer, config, onEmailProcessed) {
  const quotaCheck = checkMonthlyQuota(config);
  if (!quotaCheck.allowed) {
    return { success: false, reason: quotaCheck.reason, message: quotaCheck.message, quota: config.quota };
  }

  const parsed = await simpleParser(rawBuffer);
  const matchedRule = findMatchingRule(parsed, config.rules || []);

  if (!matchedRule) {
    return { success: false, reason: 'No matching rule found' };
  }

  return await saveEmailToFolder(rawBuffer, parsed, matchedRule, onEmailProcessed);
}

// Process dropped file from user drag-and-drop
async function processEmailFile(filePath, config, onEmailProcessed) {
  try {
    const rawBuffer = fs.readFileSync(filePath);
    return await processRawEmail(rawBuffer, config, onEmailProcessed);
  } catch (err) {
    console.error('Error processing file:', err);
    return { success: false, error: err.message };
  }
}

module.exports = {
  sanitizeFilename,
  matchRule,
  findMatchingRule,
  saveEmailToFolder,
  processRawEmail,
  processEmailFile
};

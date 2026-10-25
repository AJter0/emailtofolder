/**
 * Email to Folder — core pipeline (parse → match rule → plan → save → log).
 * Equivalent of desktop `processRawEmail` + `saveEmailToFolder`.
 */
import { parseEmail } from './mime.js';
import { findMatchingRule, planFiles, quotaAllows, normalizeQuota } from './rules.js';
import { getAll, saveQuota, appendLog } from './storage.js';
import { saveFile } from './saver.js';

export const QUOTA_MESSAGE_TH =
  'โควตาทดลองใช้ฟรีประจำเดือนครบ 100 ฉบับแล้ว ระบบจะรีเซ็ตใหม่ในวันที่ 1 ของเดือนถัดไป หรือติดต่อขอเวอร์ชัน Enterprise แบบไม่จำกัด';

function manualRule(settings) {
  return {
    id: 'manual',
    name: 'บันทึกด้วยตนเอง / Manual Save',
    enabled: true,
    source: 'any',
    conditionType: 'all_emails',
    targetFolder: settings.manualFolder || 'Manual',
    subfolderMode: 'year_month',
    saveEml: true,
    saveAttachments: true
  };
}

/**
 * Decide what would happen for a raw email without writing anything.
 */
export async function preview(bytes, { source = 'manual', manual = false, fallbackSubject = '' } = {}) {
  const { settings, rules } = await getAll();
  const parsed = parseEmail(bytes);
  if (!parsed.subject && fallbackSubject) parsed.subject = fallbackSubject;
  let rule = findMatchingRule(parsed, rules, source);
  if (!rule && manual) rule = manualRule(settings);
  const plan = rule ? planFiles(parsed, bytes, rule, settings) : null;
  return { parsed, rule, plan, settings };
}

/**
 * Process + save a raw RFC 822 message.
 * @returns {Promise<{status:'saved'|'skipped'|'quota'|'error', ...}>}
 */
export async function processRaw(bytes, opts = {}) {
  const { source = 'manual', manual = false, fallbackSubject = '' } = opts;
  const all = await getAll();
  const quota = normalizeQuota(all.quota);

  if (!quotaAllows(quota)) {
    return { status: 'quota', message: QUOTA_MESSAGE_TH, quota };
  }

  let pv;
  try {
    pv = await preview(bytes, { source, manual, fallbackSubject });
  } catch (e) {
    await appendLog({ source, status: 'error', subject: fallbackSubject || '(parse error)', message: e.message });
    return { status: 'error', message: e.message };
  }

  const { parsed, rule, plan, settings } = pv;
  const subject = parsed.subject || 'No Subject';
  const from = parsed.from.text || parsed.fromAddress || 'Unknown';

  if (!rule) {
    const message = `ไม่พบกฎที่ตรงกับอีเมลหัวข้อ "${subject}"`;
    await appendLog({ source, status: 'skipped', subject, from, message });
    return { status: 'skipped', subject, message };
  }

  const saved = [];
  const errors = [];
  for (const file of plan.files) {
    const r = await saveFile(file, { eraseHistory: settings.eraseHistory });
    if (r.ok) saved.push(r.filename.split(/[\\/]/).pop());
    else errors.push(`${file.path.split('/').pop()}: ${r.error}`);
  }

  if (saved.length) {
    quota.used += 1;
    await saveQuota(quota);
  }

  const status = saved.length ? 'saved' : 'error';
  const entry = {
    source,
    status,
    subject,
    from,
    date: parsed.date ? parsed.date.toISOString() : '',
    ruleName: rule.name,
    destDir: plan.destDir,
    files: saved,
    message: errors.join(' · ')
  };
  await appendLog(entry);
  return { ...entry, quota };
}

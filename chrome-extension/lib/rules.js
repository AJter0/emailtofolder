/**
 * Email to Folder — Rule engine & path planner.
 * Ported 1:1 from the desktop app (`app/file-processor.js`) so that rules
 * behave identically in the Chrome extension.
 */

export const CONDITION_TYPES = [
  'all_emails',
  'subject_contains',
  'from_contains',
  'to_contains',
  'body_contains',
  'has_attachment',
  'attachment_name_contains'
];

export const SUBFOLDER_MODES = ['none', 'year_month', 'sender', 'email'];

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/**
 * Clean a single path segment so it is valid for chrome.downloads
 * on Windows, macOS and Linux.
 */
export function sanitizeFilename(name, max = 120) {
  if (!name) return 'Untitled';
  let s = String(name)
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1F\x7F]/g, '_')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s~]+/, '')
    .replace(/[.\s]+$/, '');
  if (!s) s = 'Untitled';
  if (RESERVED.test(s.split('.')[0])) s = '_' + s;
  if (s.length > max) {
    const dot = s.lastIndexOf('.');
    const ext = dot > 0 && s.length - dot <= 10 ? s.slice(dot) : '';
    s = s.slice(0, max - ext.length).trim() + ext;
  }
  return s;
}

/** Sanitize a relative folder path like "Finance/Invoices". */
export function sanitizePath(p) {
  return String(p || '')
    .split(/[\\/]+/)
    .map((seg) => seg.trim())
    .filter((seg) => seg && seg !== '.' && seg !== '..')
    .map((seg) => sanitizeFilename(seg, 80))
    .join('/');
}

function lower(v) {
  return String(v || '').toLowerCase();
}

function stripHtml(html) {
  return String(html || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
}

/** Same semantics as desktop `matchRule`. */
export function matchRule(email, rule) {
  if (!rule || !rule.enabled) return false;

  const subject = lower(email.subject);
  const from = lower(email.from && email.from.text ? email.from.text : email.fromAddress);
  const to = lower(email.to && email.to.text ? email.to.text : '');
  const cc = lower(email.cc && email.cc.text ? email.cc.text : '');
  const body = lower(email.text || stripHtml(email.html));
  const atts = (email.attachments || []).filter((a) => !a.related);
  const condVal = lower(rule.conditionValue).trim();

  switch (rule.conditionType) {
    case 'all_emails':
      return true;
    case 'subject_contains':
      return !condVal || subject.includes(condVal);
    case 'from_contains':
      return !condVal || from.includes(condVal);
    case 'to_contains':
      return !condVal || to.includes(condVal) || cc.includes(condVal);
    case 'body_contains':
      return !condVal || body.includes(condVal);
    case 'has_attachment':
      return atts.length > 0;
    case 'attachment_name_contains':
      if (!atts.length) return false;
      return !condVal || atts.some((a) => lower(a.filename).includes(condVal));
    default:
      return false;
  }
}

/**
 * First matching rule wins (top → bottom), limited to rules whose
 * `source` is "any" or equals the email's provider.
 */
export function findMatchingRule(email, rules, source) {
  for (const rule of rules || []) {
    const scope = rule.source || 'any';
    if (scope !== 'any' && source && scope !== source) continue;
    if (matchRule(email, rule)) return rule;
  }
  return null;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/** Local date YYYY-MM-DD (desktop used ISO/UTC; local is friendlier for TH users). */
export function dateStamp(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Build the list of files to write for a parsed email + matched rule.
 * Returns relative paths (inside the Chrome Downloads directory).
 */
export function planFiles(parsed, rawBytes, rule, settings) {
  const dateObj = parsed.date ? new Date(parsed.date) : new Date();
  const dateStr = dateStamp(dateObj);
  const cleanSubject = sanitizeFilename(parsed.subject || 'No Subject', 90);

  const root = sanitizePath(settings.rootFolder || 'EmailToFolder');
  const target = sanitizePath(rule.targetFolder || rule.name || 'Inbox');
  let destDir = [root, target].filter(Boolean).join('/');

  const mode = rule.subfolderMode || 'none';
  if (mode === 'year_month') {
    destDir += `/${dateObj.getFullYear()}/${pad(dateObj.getMonth() + 1)}`;
  } else if (mode === 'sender') {
    const first = parsed.from && parsed.from.value && parsed.from.value[0];
    const rawSender = first ? first.name || first.address : parsed.fromAddress || 'Unknown Sender';
    destDir += '/' + sanitizeFilename(rawSender || 'Unknown Sender', 60);
  } else if (mode === 'email') {
    destDir += '/' + sanitizeFilename(`${dateStr}_${cleanSubject}`, 100);
  }

  const files = [];
  if (rule.saveEml !== false) {
    files.push({
      kind: 'eml',
      path: `${destDir}/${dateStr}_${cleanSubject}.eml`,
      mime: 'message/rfc822',
      bytes: rawBytes
    });
  }

  if (rule.saveAttachments !== false) {
    const skipInline = settings.skipInlineImages !== false;
    for (const att of parsed.attachments || []) {
      if (!att.content || !att.content.length) continue;
      if (skipInline && att.related && /^image\//.test(att.contentType)) continue;
      const prefix = rule.prefixAttachments ? `${dateStr}_` : '';
      files.push({
        kind: 'attachment',
        path: `${destDir}/${prefix}${sanitizeFilename(att.filename || 'attachment')}`,
        mime: att.contentType || 'application/octet-stream',
        bytes: att.content
      });
    }
  }

  return { destDir, files, dateStr };
}

// ---------- monthly quota (same policy as desktop) ----------

export function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

export function normalizeQuota(quota) {
  const q = quota || { limit: 100, used: 0, month: currentMonth(), isUnlimited: false };
  if (q.month !== currentMonth()) {
    q.month = currentMonth();
    q.used = 0;
  }
  if (typeof q.limit !== 'number') q.limit = 100;
  return q;
}

export function quotaAllows(quota) {
  const q = normalizeQuota(quota);
  return q.isUnlimited || q.used < q.limit;
}

/**
 * Email to Folder — Lightweight RFC 822 / MIME parser (zero dependencies).
 *
 * Mirrors the subset of `mailparser.simpleParser` used by the desktop app:
 * subject, from, to, cc, date, text, html and attachments (with binary content).
 *
 * Works on raw bytes (Uint8Array) so attachments are preserved byte-for-byte.
 */

// ---------- byte <-> binary-string helpers ----------

/** Convert bytes to a "binary string" (1 char per byte, 0-255). */
export function bytesToBinary(bytes) {
  let out = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return out;
}

/** Convert a binary string back to bytes. */
export function binaryToBytes(bin) {
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
  return out;
}

export function bytesToBase64(bytes) {
  return btoa(bytesToBinary(bytes));
}

export function base64ToBytes(b64) {
  const clean = String(b64 || '').replace(/[^A-Za-z0-9+/=_-]/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = clean + '==='.slice((clean.length + 3) % 4);
  try {
    return binaryToBytes(atob(padded));
  } catch {
    return new Uint8Array(0);
  }
}

// ---------- charset decoding ----------

const CHARSET_ALIASES = {
  'tis620': 'windows-874',
  'tis-620': 'windows-874',
  'iso-8859-11': 'windows-874',
  'cp874': 'windows-874',
  'x-windows-874': 'windows-874',
  'utf8': 'utf-8',
  'ascii': 'utf-8',
  'us-ascii': 'utf-8',
  'ks_c_5601-1987': 'euc-kr',
  'gb2312': 'gbk'
};

export function decodeCharset(bytes, charset) {
  let cs = String(charset || 'utf-8').trim().toLowerCase().replace(/^["']|["']$/g, '');
  cs = CHARSET_ALIASES[cs] || cs;
  try {
    return new TextDecoder(cs, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
}

// ---------- transfer encodings ----------

function decodeQuotedPrintableToBytes(bin) {
  // Remove soft line breaks then decode =XX escapes
  const s = bin.replace(/=\r?\n/g, '');
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '=' && i + 2 < s.length && /^[0-9A-Fa-f]{2}$/.test(s.substr(i + 1, 2))) {
      out.push(parseInt(s.substr(i + 1, 2), 16));
      i += 2;
    } else {
      out.push(s.charCodeAt(i) & 0xff);
    }
  }
  return new Uint8Array(out);
}

function decodeTransfer(bin, encoding) {
  const enc = String(encoding || '7bit').trim().toLowerCase();
  if (enc === 'base64') return base64ToBytes(bin);
  if (enc === 'quoted-printable') return decodeQuotedPrintableToBytes(bin);
  return binaryToBytes(bin);
}

// ---------- RFC 2047 encoded words ----------

export function decodeWords(value) {
  if (!value || value.indexOf('=?') === -1) return value || '';
  // Remove whitespace between adjacent encoded words
  const joined = value.replace(/(\?=)\s+(=\?)/g, '$1$2');
  return joined.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (m, charset, enc, text) => {
    try {
      let bytes;
      if (enc.toUpperCase() === 'B') {
        bytes = base64ToBytes(text);
      } else {
        bytes = decodeQuotedPrintableToBytes(text.replace(/_/g, ' '));
      }
      return decodeCharset(bytes, charset.split('*')[0]);
    } catch {
      return m;
    }
  });
}

// Header values may contain raw 8-bit UTF-8 (RFC 6532). Re-decode binary strings.
function headerToUnicode(bin) {
  // eslint-disable-next-line no-control-regex
  if (!/[\x80-\xff]/.test(bin)) return bin;
  return decodeCharset(binaryToBytes(bin), 'utf-8');
}

// ---------- headers ----------

export function parseHeaders(headerBin) {
  const unfolded = headerBin.replace(/\r?\n[ \t]+/g, ' ');
  const lines = unfolded.split(/\r?\n/);
  const headers = {};
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = headerToUnicode(line.slice(idx + 1).trim());
    if (!headers[key]) headers[key] = [];
    headers[key].push(val);
  }
  return headers;
}

function h(headers, key) {
  return headers[key] && headers[key].length ? headers[key][0] : '';
}

/** Parse `type/subtype; a=b; c="d"` incl. RFC 2231 continuations. */
export function parseStructured(value) {
  const parts = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === '"' && value[i - 1] !== '\\') quoted = !quoted;
    if (c === ';' && !quoted) {
      parts.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  parts.push(cur);

  const result = { value: (parts.shift() || '').trim().toLowerCase(), params: {} };
  const continuations = {};

  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq === -1) continue;
    let key = p.slice(0, eq).trim().toLowerCase();
    let val = p.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1).replace(/\\(.)/g, '$1');

    const m = key.match(/^([^*]+)\*(\d+)?(\*)?$/);
    if (m) {
      const name = m[1];
      const index = m[2] !== undefined ? parseInt(m[2], 10) : 0;
      const encoded = Boolean(m[3]) || (m[2] === undefined);
      if (!continuations[name]) continuations[name] = [];
      continuations[name][index] = { val, encoded };
    } else {
      result.params[key] = decodeWords(val);
    }
  }

  for (const name of Object.keys(continuations)) {
    const segs = continuations[name].filter(Boolean);
    let charset = 'utf-8';
    let bin = '';
    segs.forEach((seg, i) => {
      let v = seg.val;
      if (seg.encoded) {
        if (i === 0) {
          const q = v.match(/^([^']*)'[^']*'(.*)$/);
          if (q) {
            charset = q[1] || 'utf-8';
            v = q[2];
          }
        }
        v = v.replace(/%([0-9A-Fa-f]{2})/g, (_, x) => String.fromCharCode(parseInt(x, 16)));
      }
      bin += v;
    });
    result.params[name] = decodeCharset(binaryToBytes(bin), charset);
  }
  return result;
}

// ---------- addresses ----------

export function parseAddressList(value) {
  const decoded = decodeWords(value || '');
  const list = [];
  let cur = '';
  let quoted = false;
  let angle = 0;
  for (const c of decoded) {
    if (c === '"') quoted = !quoted;
    if (!quoted && c === '<') angle++;
    if (!quoted && c === '>') angle = Math.max(0, angle - 1);
    if (c === ',' && !quoted && angle === 0) {
      list.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  list.push(cur);
  return list
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = s.match(/^(.*?)<([^>]+)>\s*$/);
      if (m) {
        return { name: m[1].trim().replace(/^"|"$/g, '').trim(), address: m[2].trim() };
      }
      return { name: '', address: s.replace(/^"|"$/g, '') };
    });
}

function addressText(list) {
  return list.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(', ');
}

// ---------- body / multipart ----------

function splitHeaderBody(bin) {
  const m = bin.match(/\r?\n\r?\n/);
  if (!m) return { head: bin, body: '' };
  return { head: bin.slice(0, m.index), body: bin.slice(m.index + m[0].length) };
}

function splitMultipart(body, boundary) {
  const delim = '--' + boundary;
  const parts = [];
  let pos = body.indexOf(delim);
  if (pos === -1) return parts;
  while (pos !== -1) {
    let start = pos + delim.length;
    if (body.substr(start, 2) === '--') break; // closing delimiter
    // skip to end of delimiter line
    const nl = body.indexOf('\n', start);
    if (nl === -1) break;
    start = nl + 1;
    let next = body.indexOf('\n' + delim, start);
    if (next === -1) {
      parts.push(body.slice(start));
      break;
    }
    let end = next;
    if (body[end - 1] === '\r') end--;
    parts.push(body.slice(start, end));
    pos = next + 1;
  }
  return parts;
}

function extFromType(type) {
  const map = {
    'application/pdf': '.pdf',
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'text/plain': '.txt',
    'text/html': '.html',
    'text/csv': '.csv',
    'message/rfc822': '.eml',
    'application/zip': '.zip',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx'
  };
  return map[type] || '.bin';
}

function walk(bin, ctx, depth = 0) {
  const { head, body } = splitHeaderBody(bin);
  const headers = parseHeaders(head);
  const ct = parseStructured(h(headers, 'content-type') || 'text/plain; charset=us-ascii');
  const cd = parseStructured(h(headers, 'content-disposition') || '');
  const encoding = h(headers, 'content-transfer-encoding');
  const type = ct.value || 'text/plain';

  if (type.startsWith('multipart/') && ct.params.boundary && depth < 20) {
    for (const part of splitMultipart(body, ct.params.boundary)) walk(part, ctx, depth + 1);
    return headers;
  }

  const filename = cd.params.filename || ct.params.name || '';
  const isAttachment =
    cd.value === 'attachment' ||
    Boolean(filename) ||
    type === 'message/rfc822' ||
    !(type.startsWith('text/') || type.startsWith('multipart/'));

  if (!isAttachment && (type === 'text/plain' || type === 'text/html')) {
    const text = decodeCharset(decodeTransfer(body, encoding), ct.params.charset);
    if (type === 'text/html') ctx.html += (ctx.html ? '\n' : '') + text;
    else ctx.text += (ctx.text ? '\n' : '') + text;
    return headers;
  }

  const content = decodeTransfer(body, encoding);
  const contentId = (h(headers, 'content-id') || '').replace(/^<|>$/g, '');
  ctx.attachments.push({
    filename: filename || `attachment-${ctx.attachments.length + 1}${extFromType(type)}`,
    contentType: type,
    contentDisposition: cd.value || (contentId ? 'inline' : 'attachment'),
    contentId,
    related: Boolean(contentId) && cd.value !== 'attachment',
    size: content.length,
    content
  });
  return headers;
}

/**
 * Parse a raw RFC 822 message.
 * @param {Uint8Array} raw
 */
export function parseEmail(raw) {
  const bin = raw instanceof Uint8Array ? bytesToBinary(raw) : String(raw);
  const ctx = { text: '', html: '', attachments: [] };
  const headers = walk(bin, ctx);

  const fromList = parseAddressList(h(headers, 'from'));
  const toList = parseAddressList(h(headers, 'to'));
  const ccList = parseAddressList(h(headers, 'cc'));
  const dateStr = h(headers, 'date');
  const date = dateStr ? new Date(dateStr) : null;

  return {
    headers,
    subject: decodeWords(h(headers, 'subject')).trim(),
    messageId: h(headers, 'message-id').replace(/^<|>$/g, ''),
    date: date && !isNaN(date.getTime()) ? date : null,
    from: { value: fromList, text: addressText(fromList) },
    to: { value: toList, text: addressText(toList) },
    cc: { value: ccList, text: addressText(ccList) },
    fromAddress: fromList[0] ? fromList[0].address : '',
    text: ctx.text,
    html: ctx.html,
    attachments: ctx.attachments
  };
}

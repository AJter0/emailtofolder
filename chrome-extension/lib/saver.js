/**
 * Email to Folder — file writer using chrome.downloads.
 *
 * MV3 service workers cannot call URL.createObjectURL, so we create blob
 * URLs inside an offscreen document and hand them to chrome.downloads.
 * Files land in:  <Chrome Downloads folder>/<rootFolder>/<rule folder>/...
 */
import { bytesToBase64 } from './mime.js';

const OFFSCREEN_URL = 'offscreen/offscreen.html';
let creating = null;

async function ensureOffscreen() {
  if (chrome.runtime.getContexts) {
    const ctx = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]
    });
    if (ctx.length) return;
  }
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: ['BLOBS'],
        justification: 'Create blob URLs for saving emails and attachments via chrome.downloads'
      })
      .catch((e) => {
        if (!String(e.message).includes('single offscreen')) throw e;
      })
      .finally(() => {
        creating = null;
      });
  }
  await creating;
}

async function makeUrl(bytes, mime) {
  const b64 = bytesToBase64(bytes);
  try {
    await ensureOffscreen();
    const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'makeBlobUrl', b64, mime });
    if (res && res.url) return { url: res.url, blob: true };
  } catch (e) {
    console.warn('[EmailToFolder] offscreen unavailable, falling back to data URL', e);
  }
  return { url: `data:${mime || 'application/octet-stream'};base64,${b64}`, blob: false };
}

function waitForDownload(id, timeoutMs = 120_000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.downloads.onChanged.removeListener(listener);
      resolve({ state: 'timeout' });
    }, timeoutMs);
    function listener(delta) {
      if (delta.id !== id || !delta.state) return;
      if (delta.state.current === 'complete' || delta.state.current === 'interrupted') {
        clearTimeout(timer);
        chrome.downloads.onChanged.removeListener(listener);
        resolve({ state: delta.state.current, error: delta.error && delta.error.current });
      }
    }
    chrome.downloads.onChanged.addListener(listener);
  });
}

export async function setSilent(silent) {
  try {
    if (chrome.downloads.setUiOptions) await chrome.downloads.setUiOptions({ enabled: !silent });
  } catch {
    /* permission not granted or unsupported */
  }
}

/**
 * Save one file. Returns { ok, filename, error }.
 * `conflictAction: 'uniquify'` reproduces the desktop "_ (1)" counter.
 */
export async function saveFile(file, { eraseHistory = false } = {}) {
  const { url, blob } = await makeUrl(file.bytes, file.mime);
  try {
    const id = await chrome.downloads.download({
      url,
      filename: file.path,
      conflictAction: 'uniquify',
      saveAs: false
    });
    const result = await waitForDownload(id);
    let filename = file.path;
    try {
      const [item] = await chrome.downloads.search({ id });
      if (item && item.filename) filename = item.filename;
    } catch {
      /* ignore */
    }
    if (eraseHistory && result.state === 'complete') chrome.downloads.erase({ id }).catch(() => {});
    if (result.state !== 'complete') return { ok: false, filename, error: result.error || result.state };
    return { ok: true, filename };
  } catch (e) {
    return { ok: false, filename: file.path, error: e.message };
  } finally {
    if (blob) chrome.runtime.sendMessage({ target: 'offscreen', type: 'revoke', url }).catch(() => {});
  }
}

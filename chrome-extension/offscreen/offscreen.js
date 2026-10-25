// Offscreen document: turns base64 payloads into blob: URLs for chrome.downloads.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') return false;

  if (msg.type === 'makeBlobUrl') {
    const bin = atob(msg.b64 || '');
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: msg.mime || 'application/octet-stream' }));
    sendResponse({ url });
    return false;
  }

  if (msg.type === 'revoke') {
    // Give Chrome a moment to finish reading the blob before revoking
    setTimeout(() => URL.revokeObjectURL(msg.url), 30_000);
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

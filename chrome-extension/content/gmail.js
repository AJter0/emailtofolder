/**
 * Email to Folder — Gmail content script.
 * Shows a floating "Save to Folder" pill whenever a message/thread is open in Gmail.
 */
(() => {
  if (window.__etfGmailLoaded) return;
  window.__etfGmailLoaded = true;

  const wrap = document.createElement('div');
  wrap.className = 'etf-fab-wrap';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'etf-fab';
  btn.style.display = 'none';

  const iconUrl = chrome.runtime.getURL('icons/icon48.png');
  btn.innerHTML = `
    <img class="etf-fab-icon" src="${iconUrl}" alt="" />
    <span class="etf-fab-label">Save to Folder</span>
    <span class="etf-fab-dot"></span>
  `;
  wrap.appendChild(btn);
  document.documentElement.appendChild(wrap);

  function toast(text, kind = 'ok') {
    const el = document.createElement('div');
    el.className = `etf-toast ${kind}`;
    el.textContent = text;
    wrap.insertBefore(el, btn);
    setTimeout(() => el.remove(), 4200);
  }

  function currentIds() {
    const msgEls = document.querySelectorAll('[data-legacy-message-id]');
    const messageIds = [];
    msgEls.forEach((el) => {
      const id = el.getAttribute('data-legacy-message-id');
      if (id && !messageIds.includes(id)) messageIds.push(id);
    });

    let threadId = '';
    const threadEl = document.querySelector('[data-legacy-thread-id]');
    if (threadEl) threadId = threadEl.getAttribute('data-legacy-thread-id') || '';
    if (!threadId) {
      const m = location.hash.match(/#[^/]+\/(?:[a-z]+\/)?([A-Za-z0-9]{15,18})(?:[?&#]|$)/);
      if (m) threadId = m[1];
    }
    return { messageIds, threadId };
  }

  function refreshVisibility() {
    const { messageIds, threadId } = currentIds();
    const visible = messageIds.length > 0 || Boolean(threadId);
    btn.style.display = visible ? 'inline-flex' : 'none';
  }

  btn.addEventListener('click', async () => {
    const { messageIds, threadId } = currentIds();
    if (!messageIds.length && !threadId) {
      toast('กรุณาเปิดอีเมลที่ต้องการจัดเก็บก่อน', 'err');
      return;
    }
    const label = btn.querySelector('.etf-fab-label');
    const prev = label.textContent;
    btn.disabled = true;
    label.textContent = 'กำลังบันทึก...';

    try {
      const res = await chrome.runtime.sendMessage({
        type: 'saveGmail',
        messageIds,
        threadId
      });
      if (!res || !res.ok) throw new Error((res && res.error) || 'ไม่สามารถบันทึกได้');
      const results = (res.data && res.data.results) || [];
      const saved = results.filter((r) => r.status === 'saved');
      const quota = results.find((r) => r.status === 'quota');
      if (quota) {
        toast(quota.message, 'err');
      } else if (saved.length) {
        const last = saved[saved.length - 1];
        toast(`✓ บันทึก ${saved.length} ฉบับ → ${last.destDir} (${(last.files || []).length} ไฟล์)`, 'ok');
      } else {
        toast((results[0] && results[0].message) || 'ไม่พบไฟล์ที่บันทึก', 'err');
      }
    } catch (e) {
      toast(e.message || String(e), 'err');
    } finally {
      btn.disabled = false;
      label.textContent = prev;
    }
  });

  window.addEventListener('hashchange', refreshVisibility);
  const mo = new MutationObserver(refreshVisibility);
  mo.observe(document.documentElement, { childList: true, subtree: true });
  refreshVisibility();
})();

/**
 * Email to Folder — Outlook Web / Office 365 content script.
 * Shows a floating "Save to Folder" pill when an email is open in Outlook on the web.
 */
(() => {
  if (window.__etfOutlookLoaded) return;
  window.__etfOutlookLoaded = true;

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

  function currentWebId() {
    const m = (location.pathname + location.hash).match(/\/id\/([^/?&#]+)/i);
    if (m && m[1]) {
      try {
        return decodeURIComponent(m[1]);
      } catch {
        return m[1];
      }
    }
    const sel = document.querySelector('[aria-selected="true"][data-convid]');
    if (sel) return sel.getAttribute('data-convid') || '';
    return '';
  }

  function refreshVisibility() {
    const id = currentWebId();
    btn.style.display = id ? 'inline-flex' : 'none';
  }

  btn.addEventListener('click', async () => {
    const webId = currentWebId();
    if (!webId) {
      toast('กรุณาคลิกเปิดอีเมลจากรายการให้แสดงในหน้าต่างอ่านก่อน', 'err');
      return;
    }
    const label = btn.querySelector('.etf-fab-label');
    const prev = label.textContent;
    btn.disabled = true;
    label.textContent = 'กำลังบันทึก...';

    try {
      const res = await chrome.runtime.sendMessage({ type: 'saveOutlook', webId });
      if (!res || !res.ok) throw new Error((res && res.error) || 'ไม่สามารถบันทึกได้');
      const results = (res.data && res.data.results) || [];
      const saved = results.filter((r) => r.status === 'saved');
      const quota = results.find((r) => r.status === 'quota');
      if (quota) {
        toast(quota.message, 'err');
      } else if (saved.length) {
        const last = saved[saved.length - 1];
        toast(`✓ บันทึกแล้ว → ${last.destDir} (${(last.files || []).length} ไฟล์)`, 'ok');
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

  window.addEventListener('popstate', refreshVisibility);
  const mo = new MutationObserver(refreshVisibility);
  mo.observe(document.documentElement, { childList: true, subtree: true });
  refreshVisibility();
})();

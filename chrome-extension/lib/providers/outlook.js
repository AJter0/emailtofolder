/**
 * Outlook / Office 365 provider — Microsoft Graph via OAuth 2.0
 * Authorization Code + PKCE (Azure "Single-page application" redirect).
 */
import { getAccounts, patchAccount } from '../storage.js';
import { AuthRequiredError } from './gmail.js';

const SCOPES = 'openid profile offline_access User.Read Mail.Read';
const GRAPH = 'https://graph.microsoft.com/v1.0';

function b64url(bytes) {
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

function authority(acc) {
  return `https://login.microsoftonline.com/${encodeURIComponent((acc.tenant || 'common').trim())}/oauth2/v2.0`;
}

async function tokenRequest(acc, body) {
  const res = await fetch(`${authority(acc)}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: acc.clientId.trim(), scope: SCOPES, ...body })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    const err = new Error(`Microsoft: ${json.error_description || json.error || res.status}`);
    err.code = json.error;
    throw err;
  }
  await patchAccount('outlook', {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || acc.refreshToken,
    expiresAt: Date.now() + (json.expires_in || 3600) * 1000
  });
  return json.access_token;
}

async function authorize(interactive) {
  const { outlook } = await getAccounts();
  if (!outlook.clientId) throw new Error('ยังไม่ได้ตั้งค่า Microsoft Client ID (Options → Accounts)');

  const { verifier, challenge } = await pkce();
  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id: outlook.clientId.trim(),
    response_type: 'code',
    redirect_uri: chrome.identity.getRedirectURL(),
    response_mode: 'query',
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    prompt: interactive ? 'select_account' : 'none'
  });
  if (outlook.email) params.set('login_hint', outlook.email);

  let responseUrl;
  try {
    responseUrl = await chrome.identity.launchWebAuthFlow({ url: `${authority(outlook)}/authorize?${params}`, interactive });
  } catch (e) {
    if (!interactive) throw new AuthRequiredError('outlook', e.message);
    throw e;
  }
  const q = new URL(responseUrl).searchParams;
  if (q.get('error')) {
    if (!interactive) throw new AuthRequiredError('outlook', q.get('error'));
    throw new Error(`Microsoft: ${q.get('error_description') || q.get('error')}`);
  }
  if (q.get('state') !== state) throw new Error('Microsoft: state mismatch');

  return tokenRequest(outlook, {
    grant_type: 'authorization_code',
    code: q.get('code'),
    redirect_uri: chrome.identity.getRedirectURL(),
    code_verifier: verifier
  });
}

async function getToken() {
  const { outlook } = await getAccounts();
  if (outlook.accessToken && outlook.expiresAt - 60_000 > Date.now()) return outlook.accessToken;
  if (outlook.refreshToken) {
    try {
      return await tokenRequest(outlook, { grant_type: 'refresh_token', refresh_token: outlook.refreshToken });
    } catch {
      await patchAccount('outlook', { refreshToken: '' });
    }
  }
  return authorize(false);
}

async function graph(path, { raw = false, retry = true } = {}) {
  const token = await getToken();
  const res = await fetch(path.startsWith('http') ? path : GRAPH + path, {
    headers: { Authorization: `Bearer ${token}`, Prefer: 'IdType="RestId"' }
  });
  if (res.status === 401 && retry) {
    await patchAccount('outlook', { accessToken: '', expiresAt: 0 });
    return graph(path, { raw, retry: false });
  }
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const j = await res.json();
      msg = (j.error && (j.error.message || j.error.code)) || msg;
    } catch {
      /* ignore */
    }
    throw new Error(`Microsoft Graph: ${msg}`);
  }
  return raw ? res : res.json();
}

export async function connect() {
  await authorize(true);
  const me = await graph('/me?$select=mail,userPrincipalName,displayName');
  const { outlook } = await getAccounts();
  const email = me.mail || me.userPrincipalName || me.displayName || 'Microsoft account';
  await patchAccount('outlook', { connected: true, email, since: outlook.since || Date.now(), lastError: '' });
  return email;
}

export async function disconnect() {
  await patchAccount('outlook', {
    connected: false,
    accessToken: '',
    refreshToken: '',
    expiresAt: 0,
    email: '',
    since: 0,
    lastSync: 0,
    lastError: ''
  });
}

/** Return Inbox message ids received at/after `sinceMs` (oldest first). */
export async function listNew(sinceMs) {
  const iso = new Date(sinceMs).toISOString();
  let url =
    `/me/mailFolders/inbox/messages?$select=id,receivedDateTime` +
    `&$filter=receivedDateTime ge ${iso}&$orderby=receivedDateTime asc&$top=50`;
  const ids = [];
  while (url && ids.length < 500) {
    const data = await graph(url);
    (data.value || []).forEach((m) => ids.push(m.id));
    url = data['@odata.nextLink'] || '';
  }
  return ids;
}

export async function getRaw(id) {
  const res = await graph(`/me/messages/${encodeURIComponent(id)}/$value`, { raw: true });
  return { bytes: new Uint8Array(await res.arrayBuffer()), internalDate: Date.now() };
}

/** Translate an Outlook-on-the-web URL id (EWS/REST) into a Graph id when possible. */
export async function resolveWebId(webId) {
  try {
    await graph(`/me/messages/${encodeURIComponent(webId)}?$select=id`);
    return webId;
  } catch {
    const res = await fetch(`${GRAPH}/me/translateExchangeIds`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputIds: [webId], sourceIdType: 'ewsId', targetIdType: 'restId' })
    });
    const j = await res.json().catch(() => ({}));
    const out = j.value && j.value[0] && j.value[0].targetId;
    if (!out) throw new Error('ไม่พบอีเมลนี้ใน Microsoft Graph (ลองเปิดอีเมลแบบเต็มหน้าก่อน)');
    return out;
  }
}

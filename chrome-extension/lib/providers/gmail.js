/**
 * Gmail provider — official Gmail REST API via OAuth 2.0 (implicit flow
 * through chrome.identity.launchWebAuthFlow). Read-only scope.
 */
import { base64ToBytes } from '../mime.js';
import { getAccounts, patchAccount } from '../storage.js';

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me/';

export class AuthRequiredError extends Error {
  constructor(provider, message) {
    super(message || `${provider}: authorization required`);
    this.name = 'AuthRequiredError';
    this.provider = provider;
  }
}

function redirectUri() {
  return chrome.identity.getRedirectURL();
}

async function authorize(interactive) {
  const { gmail } = await getAccounts();
  if (!gmail.clientId) throw new Error('ยังไม่ได้ตั้งค่า Google Client ID (Options → Accounts)');

  const params = new URLSearchParams({
    client_id: gmail.clientId.trim(),
    response_type: 'token',
    redirect_uri: redirectUri(),
    scope: SCOPE,
    include_granted_scopes: 'true',
    state: crypto.randomUUID()
  });
  if (interactive) params.set('prompt', 'select_account consent');
  else params.set('prompt', 'none');
  if (gmail.email) params.set('login_hint', gmail.email);

  let responseUrl;
  try {
    responseUrl = await chrome.identity.launchWebAuthFlow({
      url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      interactive
    });
  } catch (e) {
    if (!interactive) throw new AuthRequiredError('gmail', e.message);
    throw e;
  }

  const hash = new URLSearchParams(new URL(responseUrl).hash.slice(1));
  if (hash.get('error')) {
    if (!interactive) throw new AuthRequiredError('gmail', hash.get('error'));
    throw new Error(`Google: ${hash.get('error')}`);
  }
  if (hash.get('state') !== params.get('state')) throw new Error('Google: state mismatch');

  const token = hash.get('access_token');
  const expiresIn = parseInt(hash.get('expires_in') || '3600', 10);
  await patchAccount('gmail', { token, expiresAt: Date.now() + expiresIn * 1000 });
  return token;
}

async function getToken() {
  const { gmail } = await getAccounts();
  if (gmail.token && gmail.expiresAt - 60_000 > Date.now()) return gmail.token;
  return authorize(false); // silent refresh (works while the Google session is alive)
}

async function api(path, { raw = false, retry = true } = {}) {
  const token = await getToken();
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401 && retry) {
    await patchAccount('gmail', { token: '', expiresAt: 0 });
    return api(path, { raw, retry: false });
  }
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const j = await res.json();
      msg = (j.error && j.error.message) || msg;
    } catch {
      /* ignore */
    }
    throw new Error(`Gmail API: ${msg}`);
  }
  return raw ? res : res.json();
}

export async function connect() {
  await authorize(true);
  const profile = await api('profile');
  const { gmail } = await getAccounts();
  await patchAccount('gmail', {
    connected: true,
    email: profile.emailAddress,
    since: gmail.since || Date.now(),
    lastError: ''
  });
  return profile.emailAddress;
}

export async function disconnect() {
  const { gmail } = await getAccounts();
  if (gmail.token) {
    fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(gmail.token)}`, { method: 'POST' }).catch(() => {});
  }
  await patchAccount('gmail', { connected: false, token: '', expiresAt: 0, email: '', since: 0, lastSync: 0, lastError: '' });
}

/** Return message ids in INBOX received after `sinceMs` (oldest first). */
export async function listNew(sinceMs) {
  const after = Math.floor(sinceMs / 1000);
  const ids = [];
  let pageToken = '';
  do {
    const q = encodeURIComponent(`in:inbox after:${after}`);
    const data = await api(`messages?q=${q}&maxResults=100${pageToken ? `&pageToken=${pageToken}` : ''}`);
    (data.messages || []).forEach((m) => ids.push(m.id));
    pageToken = data.nextPageToken || '';
  } while (pageToken && ids.length < 500);
  // API returns newest first → process oldest first
  return ids.reverse();
}

export async function getRaw(id) {
  const data = await api(`messages/${encodeURIComponent(id)}?format=raw`);
  return { bytes: base64ToBytes(data.raw), internalDate: Number(data.internalDate) || Date.now() };
}

export async function threadMessageIds(threadId) {
  const data = await api(`threads/${encodeURIComponent(threadId)}?format=minimal`);
  return (data.messages || []).map((m) => m.id);
}

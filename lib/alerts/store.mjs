// Subscriptions live in one Workers KV namespace (binding ALERTS), shared by
// the Pages Functions that take subscriptions and the cron Worker that sends.
//
// Keys
//   sub:{id}    one subscription as JSON. A pending (unconfirmed) email
//               subscription carries a 7-day expiration and disappears on its
//               own if nobody confirms it.
//   dest:{hash} id of the ACTIVE subscription for one destination, so a
//               second confirmed subscription replaces the first.
//   rl:{hash}   a 10-minute marker that stops repeated confirmation mail.
//   state:last-run  the sender's last summary, for operators.
//
// The destination (email address or webhook URL) is stored encrypted with
// AES-GCM under ALERTS_SECRET; a webhook URL is itself a credential. The
// record keeps only a masked hint for the manage page. Nothing else about the
// person is stored: no name, no IP, no browser, no click history.

const enc = new TextEncoder();
const dec = new TextDecoder();

export const PENDING_TTL_SECONDS = 7 * 24 * 3600;
export const CONFIRM_RESEND_SECONDS = 600;

function b64url(bytes) {
  let s = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s) {
  const pad = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '==='.slice((pad.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(text) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

export function newId() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return hex(b);
}

function secretOf(env) {
  const s = env && env.ALERTS_SECRET;
  if (!s || String(s).length < 32) throw new Error('ALERTS_SECRET is not set');
  return String(s);
}

async function hmacKey(env) {
  return crypto.subtle.importKey('raw', enc.encode(secretOf(env)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

async function aesKey(env) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode('tailf-alerts-aes:' + secretOf(env)));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** A link token for one purpose ('confirm' or 'manage') on one subscription. */
export async function tokenFor(env, purpose, id) {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(purpose + ':' + id));
  return b64url(sig).slice(0, 32);
}

export async function tokenOk(env, purpose, id, token) {
  if (!/^[0-9a-f]{32}$/.test(String(id || '')) || typeof token !== 'string' || token.length !== 32) return false;
  const want = await tokenFor(env, purpose, id);
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

export async function seal(env, text) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), enc.encode(text));
  return b64url(iv) + '.' + b64url(ct);
}

export async function unseal(env, sealed) {
  const [iv, ct] = String(sealed || '').split('.');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(iv) }, await aesKey(env), fromB64url(ct));
  return dec.decode(pt);
}

/** Stable key for one destination, never the destination itself. */
export async function destHash(env, kind, destination) {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode('dest:' + kind + ':' + destination));
  return b64url(sig).slice(0, 43);
}

export async function getSub(kv, id) {
  if (!/^[0-9a-f]{32}$/.test(String(id || ''))) return null;
  const raw = await kv.get('sub:' + id);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

export async function putSub(kv, sub) {
  const opts = sub.status === 'pending' ? { expirationTtl: PENDING_TTL_SECONDS } : undefined;
  await kv.put('sub:' + sub.id, JSON.stringify(sub), opts);
}

export async function deleteSub(kv, sub) {
  await kv.delete('sub:' + sub.id);
  if (sub.destHash) {
    const owner = await kv.get('dest:' + sub.destHash);
    if (owner === sub.id) await kv.delete('dest:' + sub.destHash);
  }
}

/** Every subscription id in the namespace. */
export async function listSubIds(kv) {
  const ids = [];
  let cursor;
  for (let page = 0; page < 50; page++) {
    const res = await kv.list({ prefix: 'sub:', cursor });
    for (const k of res.keys) ids.push(k.name.slice(4));
    if (res.list_complete || !res.cursor) break;
    cursor = res.cursor;
  }
  return ids;
}

export function maskEmail(email) {
  const [user, domain] = String(email).split('@');
  if (!domain) return '***';
  const head = user.length <= 2 ? user.slice(0, 1) : user.slice(0, 2);
  return head + '***@' + domain;
}

export function maskWebhook(kind, url) {
  const tail = String(url).slice(-4);
  return (kind === 'slack' ? 'Slack 웹훅' : 'Discord 웹훅') + ' …' + tail;
}

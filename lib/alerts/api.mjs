// /api/alerts/* on tailf-web (functions/api/alerts/[[path]].js).
//
//   POST subscribe    { kind, destination, roles, bands, places, skills, exclude, src }
//   POST confirm      { id, t }        email double opt-in (link from the confirmation mail)
//   GET  sub?id&t                      what the manage page shows
//   POST update       { id, t, roles, bands, places, skills, exclude }
//   POST pause        { id, t, paused }
//   POST unsubscribe  { id, t }  or  ?id&t with List-Unsubscribe=One-Click (RFC 8058)
//
// Links carry an HMAC token instead of a login. JSON endpoints require a JSON
// body, so another site cannot post a form at them; the one-click unsubscribe
// is the exception mail clients need, and it only ever removes.

import { normalizeConditions } from './match.mjs';
import { normalizeDestination, deliver } from './deliver.mjs';
import {
  newId, seal, destHash, tokenFor, tokenOk, getSub, putSub, deleteSub, maskEmail, maskWebhook,
  sha256Hex, CONFIRM_RESEND_SECONDS,
} from './store.mjs';
import { sendEmail } from './ses.mjs';
import { confirmEmail, confirmUrl, manageUrl, slackStart, discordStart } from './message.mjs';
import { latestPostingId } from './sender.mjs';
import { ALERT_SOURCES } from './sources.mjs';

const MAX_BODY = 8 * 1024;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

const fail = (status, error) => json(status, { ok: false, error });

async function readJson(request) {
  const type = request.headers.get('Content-Type') || '';
  if (!/^application\/json\b/i.test(type)) return { error: fail(415, '요청 형식이 맞지 않습니다.') };
  const text = await request.text();
  if (text.length > MAX_BODY) return { error: fail(413, '요청이 너무 깁니다.') };
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object');
    return { body };
  } catch (e) {
    return { error: fail(400, '요청을 읽지 못했습니다.') };
  }
}

// A per-IP limit on subscribe, kept in the colo cache: no KV write, no IP stored.
async function ipLimited(request, limit, windowSec) {
  try {
    if (typeof caches === 'undefined' || !caches.default) return false;
    const ip = request.headers.get('CF-Connecting-IP');
    if (!ip) return false;
    const bucket = Math.floor(Date.now() / 1000 / windowSec);
    const key = new Request('https://alerts-rate.tailf.internal/' + (await sha256Hex('rl:' + ip)) + '/' + bucket);
    const hit = await caches.default.match(key);
    const n = hit ? parseInt(await hit.text(), 10) || 0 : 0;
    if (n >= limit) return true;
    await caches.default.put(key, new Response(String(n + 1), { headers: { 'Cache-Control': 'max-age=' + windowSec } }));
    return false;
  } catch (e) {
    return false;
  }
}

function publicView(sub) {
  return {
    kind: sub.kind,
    destination: sub.destHint,
    conditions: sub.conditions,
    status: sub.status,
    confirmedAt: sub.confirmedAt || null,
    lastSentAt: sub.lastSentAt || null,
    disabledReason: sub.disabledReason || null,
  };
}

async function authed(env, id, t) {
  if (!(await tokenOk(env, 'manage', id, t))) return { error: fail(403, '이 링크로는 바꿀 수 없습니다. 메일이나 메시지에 있는 링크를 다시 열어 주세요.') };
  const sub = await getSub(env.ALERTS, id);
  if (!sub || sub.status === 'pending') return { error: fail(410, '이미 그만 받기로 한 알림이에요.') };
  return { sub };
}

async function activate(env, sub, fetchImpl) {
  const kv = env.ALERTS;
  const cursor = await latestPostingId(fetchImpl);
  const prev = await kv.get('dest:' + sub.destHash);
  const active = { ...sub, status: 'active', confirmedAt: new Date().toISOString(), cursor, sent: [], failures: 0, goneStreak: 0 };
  await putSub(kv, active);
  await kv.put('dest:' + sub.destHash, sub.id);
  // One destination, one subscription: the newly confirmed one replaces the old.
  if (prev && prev !== sub.id) await kv.delete('sub:' + prev);
  return active;
}

async function subscribe(env, request, fetchImpl) {
  const { body, error } = await readJson(request);
  if (error) return error;
  // A field people never see; forms that fill it are bots. Answer as if accepted.
  if (body.website) return json(200, { ok: true, state: 'confirm_sent' });
  if (await ipLimited(request, 8, 600)) return fail(429, '잠시 뒤에 다시 시도해 주세요.');

  const kind = String(body.kind || '');
  const dest = normalizeDestination(kind, body.destination);
  if (!dest.ok) return fail(400, dest.error);
  const cond = normalizeConditions(body);
  if (!cond.ok) return fail(400, cond.error);
  const src = ALERT_SOURCES.includes(body.src) ? body.src : 'direct';
  const kv = env.ALERTS;
  const hash = await destHash(env, kind, dest.destination);
  const id = newId();
  const now = new Date().toISOString();
  const sub = {
    v: 1, id, kind,
    dest: await seal(env, dest.destination),
    destHint: kind === 'email' ? maskEmail(dest.destination) : maskWebhook(kind, dest.destination),
    destHash: hash,
    conditions: cond.conditions,
    status: 'pending',
    src,
    createdAt: now,
  };

  if (kind === 'email') {
    // One confirmation mail per address per ten minutes, whoever asks.
    if (await kv.get('rl:' + hash)) return json(200, { ok: true, state: 'confirm_sent' });
    await kv.put('rl:' + hash, '1', { expirationTtl: CONFIRM_RESEND_SECONDS });
    await putSub(kv, sub);
    const mail = confirmEmail({ conditions: cond.conditions, confirm: confirmUrl(id, await tokenFor(env, 'confirm', id)) });
    let sent;
    try {
      sent = await sendEmail(env, { to: dest.destination, ...mail }, fetchImpl);
    } catch (e) {
      sent = { ok: false };
    }
    if (!sent.ok) {
      await kv.delete('sub:' + id);
      await kv.delete('rl:' + hash);
      return fail(502, '확인 메일을 보내지 못했습니다. 잠시 뒤에 다시 시도해 주세요.');
    }
    return json(200, { ok: true, state: 'confirm_sent' });
  }

  // A webhook URL is its own proof of ownership. The start message is the check:
  // if it does not arrive, nothing is stored.
  const manage = manageUrl(id, await tokenFor(env, 'manage', id));
  const start = kind === 'slack'
    ? { slack: slackStart({ conditions: cond.conditions, manage }) }
    : { discord: discordStart({ conditions: cond.conditions, manage }) };
  const res = await deliver(env, kind, dest.destination, start, fetchImpl);
  if (!res.ok) return fail(400, '웹훅으로 연결 확인 메시지를 보내지 못했습니다. 주소가 맞는지, 채널에 아직 연결돼 있는지 확인해 주세요.');
  await activate(env, sub, fetchImpl);
  return json(200, { ok: true, state: 'active', manage });
}

async function confirm(env, request, fetchImpl) {
  const { body, error } = await readJson(request);
  if (error) return error;
  const id = String(body.id || '');
  if (!(await tokenOk(env, 'confirm', id, body.t))) return fail(403, '확인 링크가 맞지 않습니다. 메일의 버튼을 다시 눌러 주세요.');
  const sub = await getSub(env.ALERTS, id);
  if (!sub) return fail(410, '확인 기한이 지났어요. 처음부터 다시 신청해 주세요.');
  const manage = manageUrl(id, await tokenFor(env, 'manage', id));
  if (sub.status !== 'pending') return json(200, { ok: true, state: sub.status, already: true, src: sub.src, manage });
  const active = await activate(env, sub, fetchImpl);
  return json(200, { ok: true, state: active.status, src: sub.src, manage });
}

async function read(env, url) {
  const { sub, error } = await authed(env, url.searchParams.get('id'), url.searchParams.get('t'));
  if (error) return error;
  return json(200, { ok: true, subscription: publicView(sub) });
}

async function update(env, request, fetchImpl) {
  const { body, error } = await readJson(request);
  if (error) return error;
  const auth = await authed(env, String(body.id || ''), body.t);
  if (auth.error) return auth.error;
  const cond = normalizeConditions(body);
  if (!cond.ok) return fail(400, cond.error);
  // New conditions apply from now on, so a wider condition does not replay the past.
  const cursor = await latestPostingId(fetchImpl);
  const next = { ...auth.sub, conditions: cond.conditions, cursor: Math.max(Number(auth.sub.cursor) || 0, cursor) };
  await putSub(env.ALERTS, next);
  return json(200, { ok: true, subscription: publicView(next) });
}

async function pause(env, request, fetchImpl) {
  const { body, error } = await readJson(request);
  if (error) return error;
  const auth = await authed(env, String(body.id || ''), body.t);
  if (auth.error) return auth.error;
  let next;
  if (body.paused) {
    next = { ...auth.sub, status: 'paused', pausedAt: new Date().toISOString() };
  } else {
    // 다시 받기 starts from now; what came during the pause is not sent in one burst.
    const cursor = await latestPostingId(fetchImpl);
    next = {
      ...auth.sub, status: 'active', cursor: Math.max(Number(auth.sub.cursor) || 0, cursor),
      failures: 0, goneStreak: 0, disabledAt: null, disabledReason: null, lastError: null,
    };
  }
  await putSub(env.ALERTS, next);
  return json(200, { ok: true, subscription: publicView(next) });
}

async function unsubscribe(env, request, url) {
  let id = url.searchParams.get('id');
  let t = url.searchParams.get('t');
  const type = request.headers.get('Content-Type') || '';
  if (/^application\/json\b/i.test(type)) {
    const { body, error } = await readJson(request);
    if (error) return error;
    id = String(body.id || '');
    t = body.t;
  }
  if (!(await tokenOk(env, 'manage', String(id || ''), t))) return fail(403, '이 링크로는 바꿀 수 없습니다. 메일이나 메시지에 있는 링크를 다시 열어 주세요.');
  const sub = await getSub(env.ALERTS, id);
  if (sub) await deleteSub(env.ALERTS, sub);
  return json(200, { ok: true, state: 'removed' });
}

export async function handle(context, fetchImpl = fetch) {
  const { request, env } = context;
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/api\/alerts\/?/, '').replace(/\/$/, '');
  if (!env || !env.ALERTS || !env.ALERTS_SECRET) return fail(503, '지금은 알림 신청을 받을 수 없습니다.');
  try {
    if (request.method === 'POST') {
      if (route === 'subscribe') return await subscribe(env, request, fetchImpl);
      if (route === 'confirm') return await confirm(env, request, fetchImpl);
      if (route === 'update') return await update(env, request, fetchImpl);
      if (route === 'pause') return await pause(env, request, fetchImpl);
      if (route === 'unsubscribe') return await unsubscribe(env, request, url);
    } else if (request.method === 'GET') {
      if (route === 'sub') return await read(env, url);
      if (route === 'unsubscribe') return fail(405, '그만 받기는 페이지의 버튼으로 해 주세요.');
    }
    return fail(404, '없는 주소입니다.');
  } catch (e) {
    console.error('alerts api', route, e && e.stack || e);
    return fail(500, '잠시 문제가 생겼습니다. 조금 뒤에 다시 시도해 주세요.');
  }
}

export const onRequest = (context) => handle(context);

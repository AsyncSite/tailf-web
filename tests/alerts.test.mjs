import assert from 'node:assert/strict';
import test from 'node:test';

import {
  matchPosting, rankMatches, normalizeConditions, jobRoleFocuses, jobCareerBands, jobPlaceArea, conditionsKo,
} from '../lib/alerts/match.mjs';
import { normalizeDestination, afterFailure } from '../lib/alerts/deliver.mjs';
import { runAlerts, MIN_GAP_MS } from '../lib/alerts/sender.mjs';
import { handle } from '../lib/alerts/api.mjs';
import { tokenFor, seal, unseal, destHash, putSub, getSub } from '../lib/alerts/store.mjs';
import { slackMessage, discordMessage, digestEmail } from '../lib/alerts/message.mjs';
import { ALERT_SOURCES } from '../lib/alerts/sources.mjs';
import { signRequest } from '../lib/alerts/ses.mjs';
import { readFileSync } from 'node:fs';

const NOW = new Date('2026-09-24T03:00:00Z');
const HOUR = 3600 * 1000;

function job(over) {
  return {
    id: 100,
    company: '테스트컴퍼니',
    title: 'Backend Engineer',
    description: '서비스 API를 만듭니다.',
    skills: ['Java', 'Spring', 'MySQL'],
    experience: '3년 이상',
    experienceCategory: 'MID',
    location: '서울 강남구',
    deadline: '상시채용',
    postedAt: '2026-09-23',
    isActive: true,
    ...over,
  };
}

const BACKEND_JUNIOR = normalizeConditions({ roles: ['backend'], bands: ['junior'] }).conditions;

// ---------- matching ----------

test('role family: the title decides, tags only fill a silent title', () => {
  assert.deepEqual([...jobRoleFocuses(job({ title: 'Backend Engineer', skills: ['iOS', 'Android'] }))], ['backend']);
  assert.ok(jobRoleFocuses(job({ title: '개발자', skills: ['Flutter'] })).has('mobile'));
  const full = jobRoleFocuses(job({ title: '풀스택 개발자' }));
  assert.ok(full.has('fullstack') && full.has('backend') && full.has('frontend'));
  assert.equal(jobRoleFocuses(job({ title: '개발자', skills: ['Java'] })).size, 0);
});

test('a posting must name a chosen role family; an unclassified title is not sent', () => {
  assert.ok(matchPosting(BACKEND_JUNIOR, job({}), NOW));
  assert.equal(matchPosting(BACKEND_JUNIOR, job({ title: 'iOS Engineer' }), NOW), null);
  assert.equal(matchPosting(BACKEND_JUNIOR, job({ title: '소프트웨어 개발자', skills: ['Java'] }), NOW), null);
  // A backend posting whose API serves the apps does not reach a mobile subscriber.
  const mobile = normalizeConditions({ roles: ['mobile'], bands: ['junior'] }).conditions;
  assert.equal(matchPosting(mobile, job({ skills: ['iOS', 'Android'] }), NOW), null);
});

test('experience band: category plus the stated floor, unstated passes, other bands do not', () => {
  // Upstream files 「3년 이상」 as MID; the three-year developer it names is junior.
  assert.deepEqual([...jobCareerBands(job({}))].sort(), ['experienced', 'junior']);
  assert.ok(matchPosting(BACKEND_JUNIOR, job({}), NOW));
  assert.equal(matchPosting(BACKEND_JUNIOR, job({ experience: '8년 이상', experienceCategory: 'SENIOR' }), NOW), null);
  assert.ok(matchPosting(BACKEND_JUNIOR, job({ experience: '경력 미기재', experienceCategory: null }), NOW));
  assert.ok(matchPosting(BACKEND_JUNIOR, job({ experience: '경력 무관', experienceCategory: 'ANY' }), NOW));
  const entry = normalizeConditions({ roles: ['backend'], bands: ['entry'] }).conditions;
  assert.ok(matchPosting(entry, job({ experience: '신입', experienceCategory: 'ENTRY' }), NOW));
  assert.equal(matchPosting(entry, job({}), NOW), null);
});

test('workplace, SI, excluded company, closed and past-deadline postings', () => {
  const seoul = normalizeConditions({ roles: ['backend'], bands: ['junior'], places: ['seoul'] }).conditions;
  assert.ok(matchPosting(seoul, job({}), NOW));
  assert.equal(matchPosting(seoul, job({ location: '경기도 성남시 판교' }), NOW), null);
  assert.ok(matchPosting(seoul, job({ location: '미지정' }), NOW), 'unknown place passes, as in the app');
  assert.equal(matchPosting(seoul, job({ location: 'Tokyo, Japan' }), NOW), null);
  const remote = normalizeConditions({ roles: ['backend'], bands: ['junior'], places: ['remote'] }).conditions;
  assert.ok(matchPosting(remote, job({ location: 'Tokyo, Japan', title: 'Backend Engineer (Remote)' }), NOW));
  assert.equal(jobPlaceArea(job({ location: 'Seoul, South Korea' })), 'seoul');
  assert.equal(matchPosting(BACKEND_JUNIOR, job({ description: '고객사 상주 근무' }), NOW), null);
  const excl = normalizeConditions({ roles: ['backend'], bands: ['junior'], exclude: '테스트 컴퍼니' }).conditions;
  assert.equal(matchPosting(excl, job({}), NOW), null);
  assert.equal(matchPosting(BACKEND_JUNIOR, job({ isActive: false }), NOW), null);
  assert.equal(matchPosting(BACKEND_JUNIOR, job({ deadline: '~2026.09.01' }), NOW), null);
});

test('skills rank but never drop; tools do not count', () => {
  const c = normalizeConditions({ roles: ['backend'], bands: ['junior'], skills: 'java, kafka, git' }).conditions;
  const ranked = rankMatches(c, [
    job({ id: 1, skills: ['Python'] }),
    job({ id: 2, skills: ['Java', 'Kafka', 'Git'] }),
    job({ id: 3, skills: ['Java', 'Git'] }),
    job({ id: 4, skills: ['Go'] }),
  ], NOW);
  assert.deepEqual(ranked.map((m) => m.job.id), [2, 3, 4, 1]);
  assert.deepEqual(ranked[0].overlap, ['Java', 'Kafka']);
  assert.deepEqual(ranked[1].overlap, ['Java']);
});

test('conditions need a role and a band and are cleaned', () => {
  assert.equal(normalizeConditions({ bands: ['junior'] }).ok, false);
  assert.equal(normalizeConditions({ roles: ['backend'] }).ok, false);
  const c = normalizeConditions({ roles: ['qa', 'backend', 'nope'], bands: ['senior', 'junior'], skills: ['Java', 'java', ' ', '<b>Kotlin</b>'] });
  assert.deepEqual(c.conditions.roles, ['backend', 'qa']);
  assert.deepEqual(c.conditions.bands, ['junior', 'senior']);
  assert.deepEqual(c.conditions.skills, ['Java', 'bKotlin/b']);
  assert.equal(conditionsKo(BACKEND_JUNIOR), '백엔드 · 1~3년');
});

// ---------- destinations ----------

test('only real Slack and Discord webhook endpoints are accepted', () => {
  assert.ok(normalizeDestination('slack', 'https://hooks.slack.com/services/T0001/B0002/abcdefghijklmnopqrstuvwx').ok);
  assert.equal(normalizeDestination('slack', 'https://hooks.slack.com.evil.io/services/T0001/B0002/abcdefghijklmnopqrstuvwx').ok, false);
  assert.equal(normalizeDestination('slack', 'http://hooks.slack.com/services/T0001/B0002/abcdefghijklmnopqrstuvwx').ok, false);
  assert.equal(normalizeDestination('slack', 'https://169.254.169.254/latest').ok, false);
  const d = normalizeDestination('discord', 'https://discordapp.com/api/webhooks/123456789012345678/' + 'a'.repeat(68));
  assert.ok(d.ok);
  assert.ok(d.destination.startsWith('https://discord.com/api/webhooks/'));
  assert.equal(normalizeDestination('discord', 'https://discord.com/api/webhooks/1/x').ok, false);
  assert.equal(normalizeDestination('email', 'a@b').ok, false);
  assert.equal(normalizeDestination('email', ' Dev@Example.COM ').destination, 'dev@example.com');
});

// ---------- messages ----------

test('Slack and Discord messages cannot ping, and carry the manage link', () => {
  const matches = [{ job: job({ id: 7, company: '<!channel>', title: '@everyone Backend Engineer' }), overlap: ['Java'] }];
  const s = slackMessage({ matches, conditions: BACKEND_JUNIOR, manage: 'https://tailf.asyncsite.com/alerts/?id=x&t=y' });
  const st = JSON.stringify(s);
  assert.ok(!st.includes('<!channel>'));
  assert.ok(st.includes('https://tailf.asyncsite.com/p/7/'));
  assert.ok(st.includes('조건 바꾸기'));
  const d = discordMessage({ matches, conditions: BACKEND_JUNIOR, manage: 'https://tailf.asyncsite.com/alerts/?id=x&t=y' });
  assert.deepEqual(d.allowed_mentions, { parse: [] });
  assert.ok(d.content.length <= 2000);
  assert.ok(d.content.includes('<https://tailf.asyncsite.com/p/7/>'));
});

test('a digest email lists company, title, experience and says how to stop', () => {
  const mail = digestEmail({
    matches: [{ job: job({ id: 9 }), overlap: [] }],
    conditions: BACKEND_JUNIOR,
    manage: 'https://m', unsubscribePage: 'https://u',
  });
  assert.match(mail.subject, /새 공고 1건/);
  assert.ok(mail.html.includes('테스트컴퍼니') && mail.html.includes('Backend Engineer') && mail.html.includes('3년 이상'));
  assert.ok(mail.html.includes('https://u') && mail.text.includes('그만 받기: https://u'));
});

// ---------- a fake Cloudflare and a fake internet ----------

function fakeKv() {
  const data = new Map();
  const ttl = new Map();
  return {
    data, ttl,
    async get(k) { return data.has(k) ? data.get(k) : null; },
    async put(k, v, opts) { data.set(k, v); if (opts && opts.expirationTtl) ttl.set(k, opts.expirationTtl); else ttl.delete(k); },
    async delete(k) { data.delete(k); ttl.delete(k); },
    async list({ prefix }) { return { keys: [...data.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; },
  };
}

function fakeNet({ postings = [], webhookStatus = () => 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ url: String(url), init });
    if (u.hostname === 'api.asyncsite.com') {
      const page = +u.searchParams.get('page');
      const size = +u.searchParams.get('size');
      const rows = [...postings].sort((a, b) => b.id - a.id);
      const content = rows.slice(page * size, page * size + size);
      return new Response(JSON.stringify({ content, last: (page + 1) * size >= rows.length }), { status: 200 });
    }
    if (u.hostname === 'hooks.slack.com' || u.hostname === 'discord.com') {
      const status = webhookStatus(url);
      return new Response(status === 200 ? 'ok' : status === 204 ? null : 'no_service', { status });
    }
    if (u.hostname === 'email.ap-northeast-2.amazonaws.com') {
      return new Response(JSON.stringify({ MessageId: 'm-' + calls.length }), { status: 200 });
    }
    throw new Error('unexpected fetch ' + url);
  };
  return { fetchImpl, calls, sends: () => calls.filter((c) => !c.url.includes('api.asyncsite.com')) };
}

function envWith(kv) {
  return { ALERTS: kv, ALERTS_SECRET: 's'.repeat(48), SES_ACCESS_KEY_ID: 'AKIDTEST', SES_SECRET_ACCESS_KEY: 'test-secret' };
}

const SLACK = 'https://hooks.slack.com/services/T0001/B0002/abcdefghijklmnopqrstuvwx';

async function activeSub(env, { id = 'a'.repeat(32), kind = 'slack', dest = SLACK, cursor = 100, conditions = BACKEND_JUNIOR, ...rest } = {}) {
  const sub = {
    v: 1, id, kind, dest: await seal(env, dest), destHint: 'x', destHash: await destHash(env, kind, dest),
    conditions, status: 'active', src: 'landing', createdAt: NOW.toISOString(), confirmedAt: NOW.toISOString(),
    cursor, sent: [], ...rest,
  };
  await putSub(env.ALERTS, sub);
  await env.ALERTS.put('dest:' + sub.destHash, sub.id);
  return sub;
}

function payloadIds(call) {
  return [...String(call.init.body).matchAll(/\/p\/(\d+)\//g)].map((m) => +m[1]);
}

// ---------- dedupe ----------

test('a posting is sent to a subscription once, across runs and new arrivals', async () => {
  const env = envWith(fakeKv());
  await activeSub(env);
  const net = fakeNet({ postings: [job({ id: 99 }), job({ id: 101 }), job({ id: 102, title: 'iOS Engineer' })] });

  const r1 = await runAlerts(env, { now: NOW, fetchImpl: net.fetchImpl });
  assert.equal(r1.sent, 1);
  assert.deepEqual(payloadIds(net.sends()[0]), [101], 'only new and matching; 99 is older than the cursor');

  // Same board an hour later: nothing new, nothing sent.
  const r2 = await runAlerts(env, { now: new Date(+NOW + HOUR), fetchImpl: net.fetchImpl });
  assert.equal(r2.sent, 0);
  assert.equal(r2.nothingNew, 1);

  // A new posting arrives; only it is sent.
  const net2 = fakeNet({ postings: [job({ id: 101 }), job({ id: 103 }), job({ id: 104 })] });
  const r3 = await runAlerts(env, { now: new Date(+NOW + 2 * HOUR), fetchImpl: net2.fetchImpl });
  assert.equal(r3.sent, 1);
  assert.deepEqual(payloadIds(net2.sends()[0]).sort(), [103, 104]);

  // Even with the cursor wound back, the sent list keeps 101, 103 and 104 out.
  const sub = await getSub(env.ALERTS, 'a'.repeat(32));
  await putSub(env.ALERTS, { ...sub, cursor: 0, lastSentAt: null });
  const net3 = fakeNet({ postings: [job({ id: 101 }), job({ id: 103 }), job({ id: 104 })] });
  const r4 = await runAlerts(env, { now: new Date(+NOW + 3 * HOUR), fetchImpl: net3.fetchImpl });
  assert.equal(r4.sent, 0);
});

test('at most one message per hour per subscription', async () => {
  const env = envWith(fakeKv());
  await activeSub(env, { lastSentAt: new Date(+NOW - 10 * 60 * 1000).toISOString() });
  const net = fakeNet({ postings: [job({ id: 101 })] });
  const r = await runAlerts(env, { now: NOW, fetchImpl: net.fetchImpl });
  assert.equal(r.sent, 0);
  assert.equal(r.tooSoon, 1);
  const later = await runAlerts(env, { now: new Date(+NOW + MIN_GAP_MS), fetchImpl: net.fetchImpl });
  assert.equal(later.sent, 1);
});

test('paused and pending subscriptions get nothing', async () => {
  const env = envWith(fakeKv());
  await activeSub(env, { id: 'b'.repeat(32), status: 'paused' });
  await activeSub(env, { id: 'c'.repeat(32), status: 'pending', dest: SLACK.replace('x', 'y') });
  const net = fakeNet({ postings: [job({ id: 101 })] });
  const r = await runAlerts(env, { now: NOW, fetchImpl: net.fetchImpl });
  assert.equal(r.sent, 0);
  assert.equal(net.sends().length, 0);
});

// ---------- webhook failures ----------

test('a failed delivery keeps the postings for the next hour, then succeeds and resets', async () => {
  const env = envWith(fakeKv());
  await activeSub(env);
  let status = 500;
  const net = fakeNet({ postings: [job({ id: 101 })], webhookStatus: () => status });
  const r1 = await runAlerts(env, { now: NOW, fetchImpl: net.fetchImpl });
  assert.equal(r1.failed, 1);
  let sub = await getSub(env.ALERTS, 'a'.repeat(32));
  assert.equal(sub.cursor, 100, 'claim restored');
  assert.equal(sub.failures, 1);
  assert.equal(sub.status, 'active');

  status = 200;
  const r2 = await runAlerts(env, { now: new Date(+NOW + HOUR), fetchImpl: net.fetchImpl });
  assert.equal(r2.sent, 1);
  sub = await getSub(env.ALERTS, 'a'.repeat(32));
  assert.equal(sub.failures, 0);
  assert.equal(sub.cursor, 101);
});

test('a deleted webhook stops on the second 404; flaky ones after five failures', async () => {
  const env = envWith(fakeKv());
  await activeSub(env);
  const gone = fakeNet({ postings: [job({ id: 101 })], webhookStatus: () => 404 });
  await runAlerts(env, { now: NOW, fetchImpl: gone.fetchImpl });
  assert.equal((await getSub(env.ALERTS, 'a'.repeat(32))).status, 'active');
  const r = await runAlerts(env, { now: new Date(+NOW + HOUR), fetchImpl: gone.fetchImpl });
  assert.equal(r.disabled, 1);
  const sub = await getSub(env.ALERTS, 'a'.repeat(32));
  assert.equal(sub.status, 'disabled');
  assert.equal(sub.disabledReason, 'destination_gone');
  // A stopped subscription is not tried again.
  const r3 = await runAlerts(env, { now: new Date(+NOW + 2 * HOUR), fetchImpl: gone.fetchImpl });
  assert.equal(gone.sends().length, 2);
  assert.equal(r3.active, 0);

  let s = { status: 'active', failures: 0 };
  for (let i = 0; i < 4; i++) s = afterFailure(s, { ok: false, status: 503, permanent: false }, NOW);
  assert.equal(s.status, 'active');
  s = afterFailure(s, { ok: false, status: 503, permanent: false }, NOW);
  assert.equal(s.status, 'disabled');
  assert.equal(s.disabledReason, 'repeated_failures');
});

test('stopped subscriptions are removed after 30 days', async () => {
  const env = envWith(fakeKv());
  await activeSub(env, { status: 'disabled', disabledAt: new Date(+NOW - 31 * 24 * HOUR).toISOString() });
  const r = await runAlerts(env, { now: NOW, fetchImpl: fakeNet().fetchImpl });
  assert.equal(r.purged, 1);
  assert.equal(env.ALERTS.data.size, 1, 'only state:last-run is left');
});

// ---------- API: subscribe, confirm, unsubscribe ----------

function req(path, { method = 'POST', body, type = 'application/json' } = {}) {
  return new Request('https://tailf.asyncsite.com' + path, {
    method,
    headers: body !== undefined ? { 'Content-Type': type } : {},
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function call(env, net, path, opts) {
  const res = await handle({ request: req(path, opts), env }, net.fetchImpl);
  return { status: res.status, body: await res.json() };
}

test('email: double opt-in, then manage, then one-click unsubscribe removes everything', async () => {
  const kv = fakeKv();
  const env = envWith(kv);
  const net = fakeNet({ postings: [job({ id: 120 })] });
  const sub = await call(env, net, '/api/alerts/subscribe', { body: { kind: 'email', destination: 'Dev@Example.com', roles: ['backend'], bands: ['junior'], src: 'posting' } });
  assert.equal(sub.status, 200);
  assert.equal(sub.body.state, 'confirm_sent');
  const mail = net.sends()[0];
  assert.ok(mail.url.startsWith('https://email.ap-northeast-2.amazonaws.com/'));
  const sent = JSON.parse(mail.init.body);
  assert.deepEqual(sent.Destination.ToAddresses, ['dev@example.com']);
  const link = /\/alerts\/confirm\/\?id=([0-9a-f]{32})&t=([\w-]{32})/.exec(sent.Content.Simple.Body.Text.Data);
  assert.ok(link, 'confirmation link in the mail');
  const [, id, t] = link;

  // Pending: stored with an expiry, the address only encrypted, and not sent to.
  const pending = JSON.parse(kv.data.get('sub:' + id));
  assert.equal(pending.status, 'pending');
  assert.ok(kv.ttl.get('sub:' + id) > 0);
  assert.ok(!kv.data.get('sub:' + id).includes('dev@example.com'));
  assert.equal(await unseal(env, pending.dest), 'dev@example.com');
  assert.equal((await runAlerts(env, { now: NOW, fetchImpl: net.fetchImpl })).sent, 0);

  // A second request inside ten minutes sends no second mail.
  await call(env, net, '/api/alerts/subscribe', { body: { kind: 'email', destination: 'dev@example.com', roles: ['backend'], bands: ['junior'] } });
  assert.equal(net.sends().length, 1);

  assert.equal((await call(env, net, '/api/alerts/confirm', { body: { id, t: t.replace(/.$/, t.endsWith('A') ? 'B' : 'A') } })).status, 403);
  const ok = await call(env, net, '/api/alerts/confirm', { body: { id, t } });
  assert.equal(ok.body.state, 'active');
  assert.equal(ok.body.src, 'posting');
  const active = JSON.parse(kv.data.get('sub:' + id));
  assert.equal(active.cursor, 120, 'starts from the newest posting at confirmation');
  assert.equal(kv.ttl.has('sub:' + id), false);

  const mt = await tokenFor(env, 'manage', id);
  const view = await call(env, net, '/api/alerts/sub?id=' + id + '&t=' + mt, { method: 'GET' });
  assert.equal(view.body.subscription.destination, 'de***@example.com');
  const upd = await call(env, net, '/api/alerts/update', { body: { id, t: mt, roles: ['frontend'], bands: ['senior'] } });
  assert.deepEqual(upd.body.subscription.conditions.roles, ['frontend']);
  assert.equal((await call(env, net, '/api/alerts/update', { body: { id, t: 'x'.repeat(32), roles: ['qa'], bands: ['senior'] } })).status, 403);

  // GET never unsubscribes (mail scanners open links); the RFC 8058 POST does.
  assert.equal((await call(env, net, '/api/alerts/unsubscribe?id=' + id + '&t=' + mt, { method: 'GET' })).status, 405);
  const gone = await call(env, net, '/api/alerts/unsubscribe?id=' + id + '&t=' + mt, { body: 'List-Unsubscribe=One-Click', type: 'application/x-www-form-urlencoded' });
  assert.equal(gone.body.state, 'removed');
  assert.equal(kv.data.has('sub:' + id), false);
  assert.equal([...kv.data.keys()].some((k) => k.startsWith('dest:')), false);
  const net2 = fakeNet({ postings: [job({ id: 121 })] });
  assert.equal((await runAlerts(env, { now: NOW, fetchImpl: net2.fetchImpl })).sent, 0);
  assert.equal(net2.sends().length, 0);
});

test('webhook: a start message proves the URL; a dead one is not stored; a new one replaces the old', async () => {
  const kv = fakeKv();
  const env = envWith(kv);
  const dead = fakeNet({ postings: [job({ id: 120 })], webhookStatus: () => 404 });
  const bad = await call(env, dead, '/api/alerts/subscribe', { body: { kind: 'slack', destination: SLACK, roles: ['backend'], bands: ['junior'] } });
  assert.equal(bad.status, 400);
  assert.equal([...kv.data.keys()].filter((k) => k.startsWith('sub:')).length, 0);

  const live = fakeNet({ postings: [job({ id: 120 })] });
  const first = await call(env, live, '/api/alerts/subscribe', { body: { kind: 'slack', destination: SLACK, roles: ['backend'], bands: ['junior'], src: 'company' } });
  assert.equal(first.body.state, 'active');
  assert.match(first.body.manage, /^https:\/\/tailf\.asyncsite\.com\/alerts\/\?id=[0-9a-f]{32}&t=/);
  assert.ok(String(live.sends()[0].init.body).includes('연결했어요'));
  const second = await call(env, live, '/api/alerts/subscribe', { body: { kind: 'slack', destination: SLACK, roles: ['qa'], bands: ['senior'] } });
  assert.equal(second.body.state, 'active');
  const subs = [...kv.data.keys()].filter((k) => k.startsWith('sub:'));
  assert.equal(subs.length, 1);
  assert.deepEqual(JSON.parse(kv.data.get(subs[0])).conditions.roles, ['qa']);
});

test('the API refuses non-JSON writes, unknown sources and missing conditions', async () => {
  const env = envWith(fakeKv());
  const net = fakeNet();
  assert.equal((await call(env, net, '/api/alerts/subscribe', { body: 'kind=email', type: 'application/x-www-form-urlencoded' })).status, 415);
  assert.equal((await call(env, net, '/api/alerts/subscribe', { body: { kind: 'email', destination: 'a@b.co', bands: ['junior'] } })).status, 400);
  const bot = await call(env, net, '/api/alerts/subscribe', { body: { kind: 'email', destination: 'a@b.co', roles: ['backend'], bands: ['junior'], website: 'x' } });
  assert.equal(bot.status, 200);
  assert.equal(net.sends().length, 0);
  const odd = await call(env, net, '/api/alerts/subscribe', { body: { kind: 'email', destination: 'a@b.co', roles: ['backend'], bands: ['junior'], src: 'evil' } });
  assert.equal(odd.status, 200);
  const stored = [...env.ALERTS.data.entries()].find(([k]) => k.startsWith('sub:'));
  assert.equal(JSON.parse(stored[1]).src, 'direct');
});

// ---------- wiring ----------

test('every source has its visit and signal paths', () => {
  const redirects = readFileSync(new URL('../_redirects', import.meta.url), 'utf8');
  for (const s of ALERT_SOURCES) {
    assert.ok(redirects.includes('/alerts/from/' + s + '/ /alerts/index.html 200'), s);
    assert.ok(redirects.includes('/signal/alerts-subscribed/' + s + '/ /signal/alerts-subscribed/index.html 200'), s);
    assert.ok(redirects.includes('/signal/alerts-confirmed/' + s + '/ /signal/alerts-confirmed/index.html 200'), s);
  }
});

test('SigV4 headers are well formed and stable for one instant', async () => {
  const args = { method: 'POST', host: 'email.ap-northeast-2.amazonaws.com', path: '/v2/email/outbound-emails', body: '{}', region: 'ap-northeast-2', service: 'ses', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', now: new Date('2026-09-24T00:00:00Z') };
  const a = await signRequest(args);
  const b = await signRequest(args);
  assert.equal(a.Authorization, b.Authorization);
  assert.equal(a['X-Amz-Date'], '20260924T000000Z');
  assert.match(a.Authorization, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20260924\/ap-northeast-2\/ses\/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=[0-9a-f]{64}$/);
});

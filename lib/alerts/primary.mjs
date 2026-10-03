// The existing hourly trigger and existing KV are retained. Activation belongs
// to the common Primary, after the original producer has returned its authority.
import { rankMatches } from './match.mjs';
import { getSub, putSub, listSubIds, unseal, tokenFor, sha256Hex } from './store.mjs';
import { deliver, afterFailure } from './deliver.mjs';
import { MAX_ITEMS } from './message.mjs';
import { fetchPostingsAbove, buildMessage, isFresh, MIN_GAP_MS,
  MAX_SENDS_PER_RUN, SENT_KEEP, DISABLED_KEEP_MS } from './sender.mjs';

export const SCHEMA = 'managed-worker-native/v1';
export const AUTHORITY_KEY = 'state:primary-authority';
export const SOURCE_REFS = Object.freeze({
  sender: '27cc89ad3ad41f2a11108a0f0af69672a8bda923ebe179ae511bee3b83e75fff',
  deliver: '71f7e66d70ba7bcb76b3789c8afa6f3bb221d7327099b28fe164b004049fb666',
  store: 'f5183e680190ce47c35130fbb4b1bfbaf0dcde2d0fd4430e25b899038e1993b9',
  message: '488bc60916a7e435ba3f9e2dc0de42396fa3d9ddcac2a5a6782bf633a01099ca',
  contract: '345542dea02d75c07a833bd7de2337b607b5d28bc7842903a5f3d20a841f65bb',
});

export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
const digest = value => sha256Hex(canonical(value));
const equal = (a, b) => canonical(a) === canonical(b);
function hold(reason) { const e = new Error(reason); e.code = reason; throw e; }
function original(sub) { const { primaryDelivery, ...rest } = sub; return rest; }
async function sign(env, body, purpose = 'primary') {
  const hash = await digest(body);
  return tokenFor(env, purpose + ':' + hash, hash.slice(0, 32));
}
function constantEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export async function authority(env) {
  const raw = await env.ALERTS.get(AUTHORITY_KEY);
  if (raw === null) return null; // The original scheduled sender still owns it.
  let envelope; try { envelope = JSON.parse(raw); } catch { hold('AUTHORITY_HOLD'); }
  const a = envelope.document;
  if (!a || !constantEqual(envelope.signature, await sign(env, a, 'primary-authority')) ||
      a.schema !== 'tailf-primary-authority/v1' || a.state !== 'ACTIVE' ||
      a.original_cron !== '17 * * * *' || !equal(a.source_refs, SOURCE_REFS) ||
      typeof a.callback_url !== 'string' || !a.callback_url.startsWith('https://') ||
      !a.primary_receipt_ref || !a.producer_return_ref || !a.next_trigger_ref || !a.rollback_ref)
    hold('AUTHORITY_HOLD');
  return { document: a, sha256: await digest(a) };
}
async function admission(env, context, { write = false, now = Date.now() } = {}) {
  if (!context || !context.binding || !context.binding.run_id || !context.binding.slot ||
      !context.binding.pipeline_id || !equal(context.source_refs, SOURCE_REFS) ||
      !context.lease || context.lease.run_id !== context.binding.run_id ||
      !Number.isInteger(context.lease.token) || !context.lease.owner ||
      !Number.isFinite(context.lease.expires_at) || context.lease.expires_at * 1000 <= now)
    hold('FENCE_HOLD');
  if (context.deadline !== null && !Number.isFinite(context.deadline)) hold('DEADLINE_HOLD');
  if (write && context.deadline !== null && context.deadline * 1000 <= now) hold('EXPIRED');
  const a = await authority(env);
  if (write && (!a || a.sha256 !== context.authority_sha256)) hold('AUTHORITY_HOLD');
  return a;
}
async function checkedSub(env, id) {
  const raw = await env.ALERTS.get('sub:' + id);
  if (raw === null) hold('SUBSCRIPTION_HOLD');
  let sub; try { sub = JSON.parse(raw); } catch { hold('SUBSCRIPTION_HOLD'); }
  if (!sub || sub.id !== id) hold('SUBSCRIPTION_HOLD');
  return sub;
}
function intentMatches(record, intent) {
  if (!record || !equal(record.intent, intent)) hold('ORIGINAL_INTENT_HOLD');
}
function contextMatches(record, context) {
  if (!equal(record.binding, context.binding) || record.first_deadline !== context.deadline) hold('ORIGINAL_CONTEXT_HOLD');
}
async function checkItem(sub, item, intent) {
  if (!item || intent.sub_id !== sub.id || item.sub.id !== sub.id ||
      intent.destination_hash !== sub.destHash || intent.body_sha256 !== await digest(item.message) ||
      intent.input_sha256 !== await digest(item) || !intent.operation_id || !intent.parent_intent_ref ||
      item.snapshot_sha256 !== await digest(original(sub)) ||
      !equal(item.sub, original(sub)) || sub.status !== 'active') hold('ORIGINAL_INPUT_HOLD');
}

// Input reads keep the original filters, ordering, 3 pages, 55-minute gap and
// 10-item message builders. No cursor or retention record is changed here.
export async function prepareAlerts(env, context, { now = new Date(), fetchImpl = fetch } = {}) {
  await admission(env, context, { now: now.getTime() });
  const ids = await listSubIds(env.ALERTS);
  const all = (await Promise.all(ids.map(id => getSub(env.ALERTS, id)))).filter(Boolean);
  const active = all.filter(s => s.status === 'active');
  active.sort((a, b) => String(a.lastSentAt || '').localeCompare(String(b.lastSentAt || '')));
  const jobs = active.length ? await fetchPostingsAbove(Math.min(...active.map(s => Number(s.cursor) || 0)), fetchImpl) : [];
  const summary = { at: now.toISOString(), subscriptions: all.length, active: active.length,
    postingsRead: jobs.length, topId: jobs.length ? Number(jobs[0].id) : null,
    stale: jobs.filter(j => !isFresh(j, now)).length, tooSoon: 0, nothingNew: 0,
    deferred: 0, pending: 0, sent: 0, items: 0, failed: 0, disabled: 0, purged: 0,
    byKind: { email: 0, slack: 0, discord: 0 } };
  const items = [];
  for (const raw of active) {
    if (raw.primaryDelivery && !['COMMITTED', 'ABSENT'].includes(raw.primaryDelivery.status)) { summary.pending++; continue; }
    const sub = original(raw);
    if (sub.lastSentAt && now - Date.parse(sub.lastSentAt) < MIN_GAP_MS) { summary.tooSoon++; continue; }
    const cursor = Number(sub.cursor) || 0, sent = new Set((sub.sent || []).map(Number));
    const fresh = jobs.filter(j => Number(j.id) > cursor && !sent.has(Number(j.id)));
    const matches = rankMatches(sub.conditions, fresh.filter(j => isFresh(j, now)), now);
    if (!matches.length) { summary.nothingNew++; continue; }
    if (items.length >= MAX_SENDS_PER_RUN) { summary.deferred++; continue; }
    const shown = matches.slice(0, MAX_ITEMS[sub.kind] || MAX_ITEMS.email).map(m => Number(m.job.id));
    const message = await buildMessage(env, sub, matches);
    items.push({ sub, snapshot_sha256: await digest(sub), message, shown,
      claimed: { ...sub, cursor: Math.max(cursor, ...fresh.map(j => Number(j.id))),
        sent: [...shown, ...(sub.sent || [])].slice(0, SENT_KEEP), lastSentAt: now.toISOString(),
        sentTimes: [now.toISOString(), ...(sub.sentTimes || [])].slice(0, 14) } });
  }
  const retention = all.filter(s => s.status === 'disabled' && s.disabledAt && now - Date.parse(s.disabledAt) > DISABLED_KEEP_MS)
    .map(s => ({ id: s.id, snapshot_sha256: null, state: 'FENCED_PURGE_UNRECEIVED' }));
  return { schema: SCHEMA, status: 'PREPARED', source_refs: SOURCE_REFS,
    binding: context.binding, first_deadline: context.deadline, summary, items, retention,
    whole_first_deadline: context.deadline === null ? 'UNDECLARED' : context.deadline };
}

export async function readDelivery(env, context, intent) {
  await admission(env, context); // Expired operations can only read their original receipt.
  const sub = await checkedSub(env, intent.sub_id);
  const record = sub.primaryDelivery;
  if (!record) return { status: 'UNKNOWN', replay_safe: false, reason: 'NO_NATIVE_RECEIPT', intent,
    binding: context.binding, first_deadline: context.deadline };
  intentMatches(record, intent);
  contextMatches(record, context);
  return { ...record, replay_safe: record.status === 'ABSENT' };
}

export async function executeDelivery(env, context, item, intent, { fetchImpl = fetch, now = new Date() } = {}) {
  await admission(env, context, { write: true, now: now.getTime() });
  let sub = await checkedSub(env, intent.sub_id);
  if (sub.primaryDelivery && sub.primaryDelivery.intent.operation_id === intent.operation_id) {
    intentMatches(sub.primaryDelivery, intent);
    contextMatches(sub.primaryDelivery, context);
    return { ...sub.primaryDelivery, replay_safe: sub.primaryDelivery.status === 'ABSENT' }; // GET semantics, no automatic retry.
  }
  if (sub.primaryDelivery && !['COMMITTED', 'ABSENT'].includes(sub.primaryDelivery.status)) hold('UNKNOWN_EFFECT');
  await checkItem(sub, item, intent);
  if (item.shown.length > 10 || item.claimed.sent.length > SENT_KEEP) hold('BUDGET_HOLD');
  if (sub.lastSentAt && now - Date.parse(sub.lastSentAt) < MIN_GAP_MS) hold('GAP_HOLD');
  if (!Number.isInteger(intent.ordinal) || intent.ordinal < 1 || intent.ordinal > MAX_SENDS_PER_RUN) hold('BUDGET_HOLD');
  const started = { schema: SCHEMA, status: 'STARTED', intent, binding: context.binding,
    first_deadline: context.deadline, original_snapshot_sha256: item.snapshot_sha256,
    started_at: now.toISOString(), claimed: item.claimed };
  await admission(env, context, { write: true });
  await putSub(env.ALERTS, { ...sub, primaryDelivery: started }); // Only intent; cursor/sent are unchanged.
  const trace = [];
  let result, attempted = false;
  try {
    const destination = await unseal(env, sub.dest);
    sub = await checkedSub(env, intent.sub_id);
    intentMatches(sub.primaryDelivery, intent);
    await checkItem(sub, item, intent);
    await admission(env, context, { write: true });
    const boundedFetch = async (url, options = {}) => {
      await admission(env, context, { write: true });
      const end = Math.min(context.lease.expires_at, context.deadline === null ? Infinity : context.deadline);
      const remaining = end * 1000 - Date.now();
      if (remaining <= 0) hold('EXPIRED');
      attempted = true;
      const signal = AbortSignal.any([options.signal, AbortSignal.timeout(Math.max(1, Math.floor(remaining)))].filter(Boolean));
      try {
        const response = await fetchImpl(url, { ...options, signal });
        const raw = await response.clone().text();
        trace.push({ status: response.status, raw });
        return response;
      } catch (e) { trace.push({ error: String(e), name: e.name }); throw e; }
    };
    result = await deliver(env, sub.kind, destination, item.message, boundedFetch);
  } catch (e) { result = { ok: false, status: 0, permanent: false, error: String(e), code: e.code || null }; }
  // 5xx/network ambiguity is never inferred to be ABSENT. Explicit rejection
  // preserves the original failure counter, and is retried only by a later slot.
  const absent = !attempted || [400, 401, 403, 404, 410, 429].includes(result.status);
  const status = result.ok ? 'ACKNOWLEDGED' : absent ? 'ABSENT' : 'UNKNOWN';
  const receipt = { ...started, status, native_result: result, native_raw: trace,
    completed_at: new Date().toISOString(), attempted,
    native_id: result.id || null, receipt_scope: 'PROVIDER_ACCEPTANCE_ONLY',
    destination_delivery: 'UNRECEIVED', replay_safe: status === 'ABSENT' };
  const current = await checkedSub(env, intent.sub_id);
  intentMatches(current.primaryDelivery, intent);
  // A stop/update racing the native request is preserved; its cursor is never
  // overwritten. The caller can still receive the original provider result.
  const unchanged = await digest(original(current)) === item.snapshot_sha256;
  const failed = result.ok || !unchanged ? original(current) : afterFailure(original(current), result, new Date());
  try {
    await admission(env, context, { write: true });
    await putSub(env.ALERTS, { ...failed, primaryDelivery: receipt });
    return receipt;
  } catch (e) {
    return { ...receipt, status: 'UNKNOWN', original_native_status: receipt.status,
      replay_safe: false, persistence_error: { name: e.name, cause: String(e.message || e) } };
  }
}

export async function commitDelivery(env, context, intent) {
  await admission(env, context, { write: true });
  const sub = await checkedSub(env, intent.sub_id), record = sub.primaryDelivery;
  intentMatches(record, intent);
  contextMatches(record, context);
  if (record.status === 'COMMITTED') return record;
  if (record.status !== 'ACKNOWLEDGED' || !record.native_result.ok) hold('UNKNOWN_EFFECT');
  if (sub.status !== 'active' || await digest(original(sub)) !== record.original_snapshot_sha256) hold('ORIGINAL_INPUT_HOLD');
  const committed = { ...record, status: 'COMMITTED', committed_at: new Date().toISOString() };
  await admission(env, context, { write: true });
  await putSub(env.ALERTS, { ...record.claimed, failures: 0, goneStreak: 0,
    lastError: null, lastErrorAt: null, primaryDelivery: committed });
  return committed;
}

export async function forwardTrigger(event, env, a, fetchImpl = fetch) {
  // The same CF trigger forwards to the Primary. Failure never falls back to a
  // direct send, because the Primary may already have accepted the invocation.
  const body = { schema: 'managed-worker-trigger/v1', authority_sha256: a.sha256,
    original_cron: event.cron, scheduled_time: event.scheduledTime, source_refs: SOURCE_REFS };
  const signature = await sign(env, body);
  const response = await fetchImpl(a.document.callback_url, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Primary-Signature': signature }, body: canonical(body) });
  const raw = await response.text();
  if (!response.ok) throw Object.assign(new Error('primary trigger ' + response.status), { native_raw: raw });
  return { status: 'PRIMARY_TRIGGER_RECEIVED', http_status: response.status, raw,
    actual_effect: 'UNRECEIVED', authority_sha256: a.sha256 };
}

export async function handlePrimaryRequest(request, env) {
  if (new URL(request.url).pathname !== '/_primary/alerts') return new Response('not here', { status: 404 });
  let body;
  try {
    if (request.method === 'GET') {
      const encoded = request.headers.get('X-Primary-Request') || '';
      body = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded), c => c.charCodeAt(0))));
    } else if (request.method === 'POST') body = await request.json();
    else return new Response('method', { status: 405 });
    if (!body || body.schema !== SCHEMA || !constantEqual(request.headers.get('X-Primary-Signature'), await sign(env, body)))
      return new Response('authentication', { status: 403 });
    const readOnly = ['prepare', 'read'].includes(body.action);
    if ((readOnly ? 'GET' : 'POST') !== request.method) hold('METHOD_HOLD');
    let value;
    if (body.action === 'prepare') value = await prepareAlerts(env, body.context);
    else if (body.action === 'read') value = await readDelivery(env, body.context, body.intent);
    else if (body.action === 'execute') value = await executeDelivery(env, body.context, body.item, body.intent);
    else if (body.action === 'commit') value = await commitDelivery(env, body.context, body.intent);
    else hold('ACTION_HOLD');
    return new Response(canonical({ schema: SCHEMA, action: body.action, value }),
      { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  } catch (e) {
    return new Response(canonical({ schema: SCHEMA, status: 'HOLD', error: e.code || e.name,
      cause: String(e.message || e) }), { status: 409, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }
}

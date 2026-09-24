// Edge cache for the Pages Functions that read the public jobs API.
//
// A Function runs on every request; Cloudflare does not cache its response by
// itself, whatever Cache-Control says. Without this, every landing view and
// every /p/ or /c/ view reached api.asyncsite.com (the landing alone made 14
// uncached calls per visitor, 2026-09-24). Here each data center keeps one
// copy in the Cache API:
//
//   HIT    younger than `fresh`: served from the copy, no origin call
//   STALE  older than `fresh` but within `stale` more: served from the copy
//          at once, one refresh runs after the response (stale-while-revalidate)
//   MISS   no copy: built now, stored, served
//
// A refresh that fails keeps the old copy (stale-if-error). Builds in one
// isolate are shared, so a burst of visitors on a cold copy makes one build,
// not one per visitor. The X-Tailf-Edge and Age headers say which of the three
// answered, which is how the load check counts origin calls from outside.

const STORED_AT = 'X-Tailf-Stored-At';
const OWN_CC = 'X-Tailf-Cache-Control';
export const EDGE_HEADER = 'X-Tailf-Edge';

const inflight = new Map();

function defaultPolicy(fresh, stale) {
  return (snap) => (snap.status === 200 ? { fresh, stale } : null);
}

async function snapshot(res) {
  const headers = [];
  res.headers.forEach((v, k) => headers.push([k, v]));
  return { status: res.status, headers, body: await res.arrayBuffer() };
}

function respond(snap, state, age) {
  const h = new Headers(snap.headers);
  // The stored copy carries the Cache API's own lifetime; the reader gets the
  // Cache-Control the handler wrote.
  const own = h.get(OWN_CC);
  if (own != null) {
    if (own) h.set('Cache-Control', own);
    else h.delete('Cache-Control');
  }
  for (const k of [STORED_AT, OWN_CC, 'X-Tailf-Fresh', 'X-Tailf-Stale']) h.delete(k);
  h.set(EDGE_HEADER, state);
  h.set('Age', String(Math.max(0, Math.floor(age))));
  return new Response(snap.body.slice(0), { status: snap.status, headers: h });
}

function cacheOf() {
  return (globalThis.caches && globalThis.caches.default) || null;
}

/**
 * Wraps a Pages Function handler.
 *   key(context)   the cache key URL, or null to bypass (default: origin + path, query dropped)
 *   fresh, stale   seconds
 *   policy(snap)   { fresh, stale, degraded } to store the built response, or null not to
 *   now()          clock, for tests
 */
export function withEdgeCache(handler, opts) {
  const fresh = opts.fresh;
  const stale = opts.stale || 0;
  const policy = opts.policy || defaultPolicy(fresh, stale);
  const now = opts.now || (() => Date.now());
  const keyOf = opts.key || ((ctx) => {
    const u = new URL(ctx.request.url);
    return u.origin + u.pathname;
  });

  return async function onRequest(context) {
    const cache = cacheOf();
    const method = context.request.method;
    const key = method === 'GET' || method === 'HEAD' ? keyOf(context) : null;
    if (!cache || !key) return handler(context);
    const keyReq = new Request(key, { method: 'GET' });

    let prev = null;
    let prevAge = 0;
    let prevRule = null;
    const hit = await cache.match(keyReq);
    if (hit) {
      prev = await snapshot(hit);
      const at = Number(hit.headers.get(STORED_AT)) || 0;
      prevAge = (now() - at) / 1000;
      prevRule = { fresh: Number(hit.headers.get('X-Tailf-Fresh')) || fresh, stale: Number(hit.headers.get('X-Tailf-Stale')) || 0 };
      if (prevAge < prevRule.fresh) return respond(prev, 'HIT', prevAge);
      if (prevAge >= prevRule.fresh + prevRule.stale) prev = null;
    }

    // One build per key per isolate at a time.
    const build = () => {
      if (inflight.has(key)) return inflight.get(key);
      const p = (async () => {
        const snap = await snapshot(await handler(context));
        const rule = policy(snap);
        // A degraded build (the origin half answered) never replaces a good copy.
        if (rule && !(rule.degraded && prev)) {
          const h = new Headers(snap.headers);
          h.set(STORED_AT, String(now()));
          h.set('X-Tailf-Fresh', String(rule.fresh));
          h.set('X-Tailf-Stale', String(rule.stale || 0));
          h.set(OWN_CC, snap.headers.find(([k]) => k === 'cache-control')?.[1] || '');
          h.set('Cache-Control', 'public, max-age=' + (rule.fresh + (rule.stale || 0)));
          h.delete('Set-Cookie');
          await cache.put(keyReq, new Response(snap.body.slice(0), { status: snap.status, headers: h }));
        }
        return snap;
      })().finally(() => inflight.delete(key));
      inflight.set(key, p);
      return p;
    };

    if (prev) {
      const refresh = build().catch(() => null);
      if (context.waitUntil) context.waitUntil(refresh);
      return respond(prev, 'STALE', prevAge);
    }

    const snap = await build();
    return respond(snap, 'MISS', 0);
  };
}

/** Test hook: forget in-flight builds between cases. */
export function _resetEdgeCache() {
  inflight.clear();
}

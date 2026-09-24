import assert from 'node:assert/strict';
import test from 'node:test';

import { withEdgeCache, _resetEdgeCache, EDGE_HEADER } from '../lib/edge-cache.mjs';
import { landingRoute, postingRoute, companyRoute } from '../lib/edge-routes.mjs';
import { LANDING_CACHE_CONTROL, rowsUrl, TOTAL_URL } from '../lib/landing-data.mjs';

// ---------- a Cache API stand-in (caches.default) ----------

function fakeCache() {
  const store = new Map();
  return {
    store,
    async match(req) {
      const hit = store.get(req.url);
      return hit ? hit.clone() : undefined;
    },
    async put(req, res) {
      store.set(req.url, res.clone());
    },
  };
}

function ctx(url, extra = {}) {
  const waits = [];
  return {
    request: new Request(url),
    params: extra.params || {},
    env: {},
    next: extra.next,
    waitUntil: (p) => waits.push(p),
    waits,
  };
}

async function withWorld(fn) {
  const cache = fakeCache();
  const originalCaches = globalThis.caches;
  const originalFetch = globalThis.fetch;
  globalThis.caches = { default: cache };
  _resetEdgeCache();
  try {
    await fn(cache);
  } finally {
    globalThis.caches = originalCaches;
    globalThis.fetch = originalFetch;
  }
}

// ---------- a board the jobs API would serve ----------

function board(n, { totalPages } = {}) {
  const jobs = [];
  for (let i = 0; i < n; i++) {
    jobs.push({
      id: i + 1,
      skills: i % 3 === 0 ? [' Java ', 'Kafka', 'Git'] : i % 3 === 1 ? ['Python', 'AWS', 'aws'] : [],
      postedAt: i % 5 === 0 ? null : '2026-09-' + String(1 + (i % 24)).padStart(2, '0') + (i % 2 ? 'T10:00:00' : ''),
      isActive: i % 4 !== 0,
    });
  }
  const pages = Math.ceil(n / 100);
  return (url) => {
    const u = new URL(url);
    if (u.searchParams.get('size') === '1') return Response.json({ totalElements: 777, content: [] });
    const page = +u.searchParams.get('page');
    return Response.json({ content: jobs.slice(page * 100, page * 100 + 100), totalPages: totalPages || pages, last: page >= pages - 1 });
  };
}

function countingFetch(serve) {
  const calls = [];
  const f = async (url) => {
    calls.push(String(url));
    return serve(String(url));
  };
  f.calls = calls;
  return f;
}

// The browser walk as app.js ran it before 2026-09-24 (13 requests per view),
// kept here to prove /api/landing hands the browser the very same rows.
async function browserWalkBefore(fetchImpl) {
  const API = 'https://api.asyncsite.com/api/public/jobs';
  const PAGE_SIZE = 100, MAX_ROWS = 1500, MAX_PAGES = 20, CONCURRENCY = 4;
  function norm(v) { return String(v).trim().toLowerCase(); }
  function url(page) { return API + '?jobFamily=ENGINEERING&page=' + page + '&size=' + PAGE_SIZE + '&includeInactive=true'; }
  function getPage(page) { return fetchImpl(url(page)).then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); }); }
  function reduce(body) {
    var content = (body && body.content) || [];
    var out = [];
    for (var i = 0; i < content.length; i++) {
      var j = content[i];
      var skills = j.skills || [];
      var s = [];
      for (var k = 0; k < skills.length; k++) s.push(norm(skills[k]));
      out.push({ s: s, d: String(j.postedAt || '').split('T')[0], a: j.isActive === true });
    }
    return out;
  }
  return getPage(0).then(function (body) {
    var first = reduce(body);
    if (!first.length) throw 0;
    var total = typeof body.totalPages === 'number' ? body.totalPages : 1;
    var pages = Math.min(total, MAX_PAGES, Math.ceil(MAX_ROWS / PAGE_SIZE));
    if (total > pages) throw 0;
    var got = [first];
    var next = 1;
    function worker() {
      if (next >= pages) return Promise.resolve();
      var page = next++;
      return getPage(page).then(function (b) { got[page] = reduce(b); return worker(); });
    }
    var lanes = [];
    for (var i = 0; i < CONCURRENCY; i++) lanes.push(worker());
    return Promise.all(lanes).then(function () {
      var all = [];
      for (var p = 0; p < pages; p++) {
        var chunk = got[p] || [];
        for (var q = 0; q < chunk.length; q++) { if (all.length >= MAX_ROWS) break; all.push(chunk[q]); }
      }
      if (!all.length) throw 0;
      return all;
    });
  }).catch(function () { return null; });
}

// ---------- /api/landing ----------

test('/api/landing: first view builds (14 origin calls), the next views make none', async () => {
  await withWorld(async (cache) => {
    const f = countingFetch(board(1288));
    globalThis.fetch = f;

    const a = await landingRoute(ctx('https://tailf.asyncsite.com/api/landing'));
    assert.equal(a.status, 200);
    assert.equal(a.headers.get(EDGE_HEADER), 'MISS');
    assert.equal(a.headers.get('Cache-Control'), LANDING_CACHE_CONTROL);
    assert.match(a.headers.get('Cache-Control'), /s-maxage=600/);
    assert.match(a.headers.get('Cache-Control'), /stale-while-revalidate=86400/);
    assert.equal(a.headers.get('Content-Type'), 'application/json; charset=utf-8');
    assert.equal(f.calls.length, 14);
    assert.ok(f.calls.includes(TOTAL_URL));
    assert.ok(f.calls.includes(rowsUrl(12)));
    const body = await a.json();
    assert.equal(body.total, 777);
    assert.equal(body.rows.length, 1288);

    // The stored copy lives in the Cache API with its own lifetime; readers never see it.
    const stored = cache.store.get('https://tailf.asyncsite.com/api/landing');
    assert.equal(stored.headers.get('Cache-Control'), 'public, max-age=87000');

    for (let i = 0; i < 50; i++) {
      const b = await landingRoute(ctx('https://tailf.asyncsite.com/api/landing?from=geeknews'));
      assert.equal(b.headers.get(EDGE_HEADER), 'HIT');
      assert.equal(b.headers.get('Cache-Control'), LANDING_CACHE_CONTROL);
      assert.equal(b.headers.get('X-Tailf-Stored-At'), null);
      assert.ok(Number(b.headers.get('Age')) >= 0);
    }
    assert.equal(f.calls.length, 14);
  });
});

test('/api/landing rows are exactly the rows the browser walk counted before', async () => {
  for (const n of [1288, 1500, 37]) {
    await withWorld(async () => {
      const serve = board(n);
      globalThis.fetch = countingFetch(serve);
      const res = await landingRoute(ctx('https://tailf.asyncsite.com/api/landing'));
      const body = await res.json();
      const before = await browserWalkBefore(async (u) => serve(u));
      assert.deepEqual(body.rows, before);
    });
  }
});

test('/api/landing: a list past 20 pages keeps its newest 2,000 rows instead of hiding the section', async () => {
  await withWorld(async () => {
    const serve = board(2500);
    globalThis.fetch = countingFetch(serve);
    const res = await landingRoute(ctx('https://tailf.asyncsite.com/api/landing'));
    const body = await res.json();
    assert.ok(Array.isArray(body.rows));
    assert.equal(body.rows.length, 2000);
    assert.equal(res.headers.get('X-Tailf-Degraded'), '0');
  });
});

test('/api/landing: stale copy is served at once and refreshed once; a failed refresh keeps it', async () => {
  let clock = 1_000_000;
  const route = withEdgeCache(
    async () => new Response(JSON.stringify({ n: clock }), { headers: { 'Cache-Control': LANDING_CACHE_CONTROL, 'X-Tailf-Degraded': fail ? '1' : '0' } }),
    {
      fresh: 600,
      stale: 86400,
      now: () => clock,
      policy: (snap) => (snap.headers.some(([k, v]) => k === 'x-tailf-degraded' && v === '1') ? { fresh: 60, stale: 0, degraded: true } : { fresh: 600, stale: 86400 }),
    },
  );
  let fail = false;
  await withWorld(async () => {
    const first = await (await route(ctx('https://tailf.asyncsite.com/api/landing'))).json();
    assert.equal(first.n, 1_000_000);

    clock += 601_000;   // past fresh
    const c1 = ctx('https://tailf.asyncsite.com/api/landing');
    const r1 = await route(c1);
    assert.equal(r1.headers.get(EDGE_HEADER), 'STALE');
    assert.equal((await r1.json()).n, 1_000_000);
    assert.equal(c1.waits.length, 1);
    await Promise.all(c1.waits);
    const r2 = await route(ctx('https://tailf.asyncsite.com/api/landing'));
    assert.equal(r2.headers.get(EDGE_HEADER), 'HIT');
    assert.equal((await r2.json()).n, 1_601_000);

    clock += 601_000;
    fail = true;          // the origin half answers now
    const c3 = ctx('https://tailf.asyncsite.com/api/landing');
    await route(c3);
    await Promise.all(c3.waits);
    const r4 = await route(ctx('https://tailf.asyncsite.com/api/landing'));
    assert.equal(r4.headers.get(EDGE_HEADER), 'STALE');
    assert.equal((await r4.json()).n, 1_601_000);
  });
});

test('edge cache: concurrent misses in one isolate share one build', async () => {
  let builds = 0;
  const route = withEdgeCache(async () => {
    builds++;
    await new Promise((r) => setTimeout(r, 20));
    return new Response('ok', { headers: { 'Cache-Control': 'public, max-age=60' } });
  }, { fresh: 60 });
  await withWorld(async () => {
    const all = await Promise.all(Array.from({ length: 30 }, () => route(ctx('https://tailf.asyncsite.com/x'))));
    assert.equal(builds, 1);
    assert.ok(all.every((r) => r.status === 200));
  });
});

// ---------- /p/ and /c/ ----------

const JOB = {
  id: 3283, company: '카카오뱅크', title: '[카카오뱅크] 계정계 백엔드 개발자', skills: ['Java'],
  postedAt: '2026-09-23', isActive: true, sourceUrl: 'https://recruit.kakaobank.com/jobs/267596',
};

test('/p/{id}/ is kept at the edge with the page Cache-Control; a 502 is not kept', async () => {
  await withWorld(async (cache) => {
    let up = true;
    const f = countingFetch((u) => (u.endsWith('/companies/with-count') ? Response.json([]) : up ? Response.json(JOB) : new Response('x', { status: 503 })));
    globalThis.fetch = f;

    const a = await postingRoute(ctx('https://tailf.asyncsite.com/p/3283/', { params: { path: ['3283'] } }));
    assert.equal(a.status, 200);
    assert.equal(a.headers.get(EDGE_HEADER), 'MISS');
    assert.equal(a.headers.get('Cache-Control'), 'public, max-age=300, s-maxage=600');
    const calls = f.calls.length;
    const b = await postingRoute(ctx('https://tailf.asyncsite.com/p/3283/?utm=x', { params: { path: ['3283'] } }));
    assert.equal(b.headers.get(EDGE_HEADER), 'HIT');
    assert.equal(f.calls.length, calls);
    assert.equal(await a.text(), await b.text());

    up = false;
    const c = await postingRoute(ctx('https://tailf.asyncsite.com/p/9999/', { params: { path: ['9999'] } }));
    assert.equal(c.status, 502);
    assert.equal(cache.store.has('https://tailf.asyncsite.com/p/9999/'), false);
  });
});

test('/c/ index bypasses the edge cache; /c/{id}/ is kept', async () => {
  await withWorld(async (cache) => {
    globalThis.fetch = countingFetch((u) => (u.includes('companyIds=') ? Response.json({ content: [JOB], last: true }) : Response.json([])));
    let nexts = 0;
    const idx = await companyRoute(ctx('https://tailf.asyncsite.com/c/', { params: {}, next: async () => { nexts++; return new Response('index'); } }));
    assert.equal(await idx.text(), 'index');
    assert.equal(idx.headers.get(EDGE_HEADER), null);
    assert.equal(nexts, 1);

    const a = await companyRoute(ctx('https://tailf.asyncsite.com/c/12/', { params: { path: ['12'] } }));
    assert.equal(a.status, 200);
    assert.equal(a.headers.get(EDGE_HEADER), 'MISS');
    const b = await companyRoute(ctx('https://tailf.asyncsite.com/c/12/', { params: { path: ['12'] } }));
    assert.equal(b.headers.get(EDGE_HEADER), 'HIT');
    assert.ok(cache.store.has('https://tailf.asyncsite.com/c/12/'));
  });
});

test('without a Cache API (local node) the handlers run as before', async () => {
  const originalCaches = globalThis.caches;
  globalThis.caches = undefined;
  try {
    const route = withEdgeCache(async () => new Response('plain'), { fresh: 60 });
    const r = await route(ctx('https://tailf.asyncsite.com/x'));
    assert.equal(await r.text(), 'plain');
    assert.equal(r.headers.get(EDGE_HEADER), null);
  } finally {
    globalThis.caches = originalCaches;
  }
});

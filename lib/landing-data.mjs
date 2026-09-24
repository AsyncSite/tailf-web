// /api/landing: everything the landing reads from the jobs API, in one JSON.
//
// Until 2026-09-24 each browser read this itself: one call for the hero count
// and 13 pages (1,288 rows, about 920 KB) for 「설치 전에 세어 보기」. Now the
// edge builds it once per data center (lib/edge-cache.mjs) and every visitor
// reads the one copy.
//
// The walk and the reduction are the ones app.js ran in the browser, moved
// here unchanged, so the rows a browser counts over are the same rows:
//   - jobFamily=ENGINEERING, includeInactive=true, size 100, in page order
//   - a list longer than 15 pages (MAX_ROWS / PAGE_SIZE) is not counted at all
//   - any page that fails, or an empty first page, means no rows
//   - each posting keeps only { s: normalized skills, d: posted day, a: active }
// The counting itself (chips, overlap, the 30-day window) stays in app.js.

import { API } from './seo.mjs';

export const PAGE_SIZE = 100;   // the API caps page size at 100 (jobs_api.dart)
export const MAX_ROWS = 1500;   // a guard against a feed that never says it is done
export const MAX_PAGES = 20;    // same guard as tower.dart `_maxPages`
const CONCURRENCY = 4;

/** Browser-facing cache: short in the browser, the edge copy does the rest. */
export const LANDING_CACHE_CONTROL = 'public, max-age=60, s-maxage=600, stale-while-revalidate=86400, stale-if-error=86400';
export const LANDING_FRESH = 600;
export const LANDING_STALE = 86400;

function norm(v) { return String(v).trim().toLowerCase(); }

export function rowsUrl(page) {
  return API + '?jobFamily=ENGINEERING&page=' + page + '&size=' + PAGE_SIZE + '&includeInactive=true';
}

export const TOTAL_URL = API + '?jobFamily=ENGINEERING&page=0&size=1';

async function getJson(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw r.status;
  return r.json();
}

/** app.js `reduce`: only what the rules read. */
export function reduce(body) {
  const content = (body && body.content) || [];
  const out = [];
  for (let i = 0; i < content.length; i++) {
    const j = content[i];
    const skills = j.skills || [];
    const s = [];
    for (let k = 0; k < skills.length; k++) s.push(norm(skills[k]));
    out.push({ s, d: String(j.postedAt || '').split('T')[0], a: j.isActive === true });
  }
  return out;
}

/** app.js `load`, returning the rows or null where the browser used to hide the section. */
export async function loadRows() {
  const body = await getJson(rowsUrl(0));
  const first = reduce(body);
  if (!first.length) return null;
  const total = typeof body.totalPages === 'number' ? body.totalPages : 1;
  const pages = Math.min(total, MAX_PAGES, Math.ceil(MAX_ROWS / PAGE_SIZE));
  if (total > pages) return null;
  const got = [first];
  let next = 1;
  async function worker() {
    while (next < pages) {
      const page = next++;
      got[page] = reduce(await getJson(rowsUrl(page)));
    }
  }
  const lanes = [];
  for (let i = 0; i < CONCURRENCY; i++) lanes.push(worker());
  await Promise.all(lanes);
  const all = [];
  for (let p = 0; p < pages; p++) {
    const chunk = got[p] || [];
    for (let q = 0; q < chunk.length; q++) {
      if (all.length >= MAX_ROWS) break;
      all.push(chunk[q]);
    }
  }
  return all.length ? all : null;
}

/** The hero number: open developer postings (index.html used to ask this itself). */
export async function loadTotal() {
  const d = await getJson(TOTAL_URL);
  return typeof d.totalElements === 'number' ? d.totalElements : null;
}

export async function buildLanding(now = new Date()) {
  const [rows, total] = await Promise.all([
    loadRows().catch(() => null),
    loadTotal().catch(() => null),
  ]);
  return { v: 1, builtAt: now.toISOString(), total, rows };
}

/** The Function handler, before the edge cache wraps it. */
export async function landingHandler() {
  const body = await buildLanding();
  const degraded = body.rows === null || body.total === null;
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': degraded ? 'public, max-age=30' : LANDING_CACHE_CONTROL,
      'X-Tailf-Degraded': degraded ? '1' : '0',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/** Store a whole answer for 10 minutes plus a day of stale; a half answer for 60 s and never over a whole one. */
export function landingPolicy(snap) {
  if (snap.status !== 200) return null;
  const degraded = snap.headers.some(([k, v]) => k === 'x-tailf-degraded' && v === '1');
  return degraded ? { fresh: 60, stale: 0, degraded: true } : { fresh: LANDING_FRESH, stale: LANDING_STALE };
}

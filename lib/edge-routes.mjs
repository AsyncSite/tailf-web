// The Pages Functions that read the jobs API, each behind the edge cache
// (lib/edge-cache.mjs). functions/ re-exports these; tests import them here.

import { withEdgeCache } from './edge-cache.mjs';
import { onRequest as postingPage } from './posting-page.mjs';
import { onRequest as companyPage } from './company-page.mjs';
import { landingHandler, landingPolicy, LANDING_FRESH, LANDING_STALE } from './landing-data.mjs';

// Pages: 5 minutes fresh (the same 5 minutes the posting subrequest already
// asked for), then an hour served stale while one refresh runs. 404 and 410
// are kept too, so crawlers walking dead postings do not reach the API each time.
const PAGE_FRESH = 300;
const PAGE_STALE = 3600;

export function pagePolicy(snap) {
  if (snap.status === 200 || snap.status === 404 || snap.status === 410) return { fresh: PAGE_FRESH, stale: PAGE_STALE };
  return null;
}

export const landingRoute = withEdgeCache(landingHandler, {
  fresh: LANDING_FRESH,
  stale: LANDING_STALE,
  policy: landingPolicy,
  key: (ctx) => new URL(ctx.request.url).origin + '/api/landing',
});

export const postingRoute = withEdgeCache(postingPage, { fresh: PAGE_FRESH, stale: PAGE_STALE, policy: pagePolicy });

export const companyRoute = withEdgeCache(companyPage, {
  fresh: PAGE_FRESH,
  stale: PAGE_STALE,
  policy: pagePolicy,
  // /c/ itself is the static index; only /c/{id}/ reads the API.
  key: (ctx) => {
    const u = new URL(ctx.request.url);
    return /^\/c\/\d{1,9}\/$/.test(u.pathname) ? u.origin + u.pathname : null;
  },
});

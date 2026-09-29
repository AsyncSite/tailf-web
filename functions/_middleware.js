/**
 * Old host -> new host (2026-09-30, founder: tailf moves from tailf.asyncsite.com to
 * tailf.teamgrit.co because the asyncsite brand is retired).
 *
 * The old host stays attached to this Pages project. Page requests (GET/HEAD) get a 301
 * to the same path and query on the new host, so links already published in Threads,
 * YouTube, community posts, alert emails and app share sheets keep working and pass
 * their utm/from tags along.
 *
 * Left alone on the old host:
 * - /api/*: alert emails already sent carry a one-click unsubscribe that POSTs to
 *   /api/alerts/unsubscribe (RFC 8058). A 301 turns that POST into a GET and the
 *   unsubscribe would silently fail. The HMAC tokens are not bound to the host.
 * - non-GET/HEAD requests, for the same reason.
 * - /cdn-cgi/*: Cloudflare's own endpoints.
 *
 * _routes.json keeps static assets off Functions so this does not spend the Workers quota.
 */
const NEW_ORIGIN = 'https://tailf.teamgrit.co';
const OLD_HOST = 'tailf.asyncsite.com';

export const onRequest = async ({ request, next }) => {
  const url = new URL(request.url);
  if (url.hostname !== OLD_HOST) return next();
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/cdn-cgi/')) return next();
  if (request.method !== 'GET' && request.method !== 'HEAD') return next();
  return Response.redirect(`${NEW_ORIGIN}${url.pathname}${url.search}`, 301);
};

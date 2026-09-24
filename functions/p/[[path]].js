// /p/{id} (the app's hand-off link) and /p/{id}/ (the search page).
// The page itself lives in lib/posting-page.mjs so tests and the build share it;
// lib/edge-routes.mjs puts it behind the edge cache.
export { postingRoute as onRequest } from '../../lib/edge-routes.mjs';

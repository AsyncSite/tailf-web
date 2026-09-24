// /api/landing: the landing's hero count and backtest rows in one edge-cached
// JSON (lib/landing-data.mjs, lib/edge-cache.mjs).
export { landingRoute as onRequest } from '../../lib/edge-routes.mjs';

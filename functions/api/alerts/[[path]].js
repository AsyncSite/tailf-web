// /api/alerts/* : web alert subscriptions. The handlers live in
// lib/alerts/api.mjs so the tests exercise the same code.
export { onRequest } from '../../../lib/alerts/api.mjs';

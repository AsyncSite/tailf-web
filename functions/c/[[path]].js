// /c/{companyId}/: one company's open developer postings, read live and kept
// at the edge for five minutes (lib/edge-routes.mjs).
// /c/ itself falls through to the static index the build writes.
export { companyRoute as onRequest } from '../../lib/edge-routes.mjs';

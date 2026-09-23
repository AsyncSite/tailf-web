// /c/{companyId}/: one company's open developer postings, read live.
// /c/ itself falls through to the static index the build writes.
export { onRequest } from '../../lib/company-page.mjs';

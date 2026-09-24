// The hourly sender (workers/alert-sender runs this on a cron trigger).
//
// New postings are read by id: jobdb assigns ids in registration order and the
// public API sorts by id, so "new since the last send" is "id above this
// subscription's cursor". Each subscription keeps
//   cursor  the highest posting id already considered for it,
//   sent    the ids already delivered to it (the last 500),
//   lastSentAt, failures, goneStreak.
//
// A subscription gets at most one message per hour, only when something new
// matches. The claim (cursor, sent, lastSentAt) is written BEFORE the message
// goes out, so a crash between the two can drop one batch but can never send a
// posting twice. A failed delivery restores the previous claim, so the same
// postings are tried again next hour, and repeated failures stop the
// subscription (deliver.mjs afterFailure).

import { API, kstDay } from '../seo.mjs';
import { rankMatches } from './match.mjs';
import { getSub, putSub, deleteSub, listSubIds, unseal, tokenFor } from './store.mjs';
import { deliver, afterFailure } from './deliver.mjs';
import {
  MAX_ITEMS, manageUrl, unsubscribePageUrl, oneClickUrl, slackMessage, discordMessage, digestEmail,
} from './message.mjs';

const UA = 'tailf-web-alerts/1 (+https://tailf.asyncsite.com/alerts/)';
const PAGE_SIZE = 100;
const MAX_PAGES = 3;
export const MIN_GAP_MS = 55 * 60 * 1000; // hourly cron, a little slack for trigger jitter
export const MAX_SENDS_PER_RUN = 40; // stays inside the Workers subrequest limit
export const SENT_KEEP = 500;
export const DISABLED_KEEP_MS = 30 * 24 * 3600 * 1000;
export const FRESH_MS = 72 * 3600 * 1000;

/**
 * Whether a posting is new to the market, not only new to jobdb. A crawler
 * backfill registers postings that have been open for weeks under fresh ids;
 * those must not arrive as 「새 공고」. The posted date (or the first-seen
 * date when a posting carries none) must fall within the last 72 hours,
 * compared as KST calendar days because postedAt is a date.
 *
 * A source that gives no date (Coupang) stores the crawl time as postedAt, so
 * the date alone passes a backfill. The crawler decides that case when it
 * first registers the row and the API carries the decision as
 * alertSkipReason (NEW_BOARD, COVERAGE_EXPANSION, ...); any value means no.
 */
export function isFresh(job, now) {
  if (job.alertSkipReason) return false;
  const raw = String(job.postedAt || (job.history && job.history.firstSeenAt) || '');
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  if (!m) return false;
  return m[1] >= kstDay(new Date(now.getTime() - FRESH_MS));
}

async function getJson(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('jobs api ' + res.status);
  return res.json();
}

function byIdUrl(page, size) {
  return API + '?jobFamily=ENGINEERING&sortBy=id&sortDirection=DESC&size=' + size + '&page=' + page;
}

/** The highest open developer posting id right now, the cursor a new subscription starts from. */
export async function latestPostingId(fetchImpl = fetch) {
  const body = await getJson(byIdUrl(0, 1), fetchImpl);
  const first = body && Array.isArray(body.content) ? body.content[0] : null;
  const id = first ? Number(first.id) : 0;
  if (!Number.isFinite(id)) throw new Error('jobs api: no id');
  return id;
}

/** Open developer postings with id above [floor], newest first, at most MAX_PAGES pages. */
export async function fetchPostingsAbove(floor, fetchImpl = fetch) {
  const out = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await getJson(byIdUrl(page, PAGE_SIZE), fetchImpl);
    const rows = body && Array.isArray(body.content) ? body.content : [];
    let reachedFloor = false;
    for (const job of rows) {
      const id = Number(job && job.id);
      if (!Number.isFinite(id)) continue;
      if (id <= floor) {
        reachedFloor = true;
        break;
      }
      out.push(job);
    }
    if (reachedFloor || rows.length < PAGE_SIZE || body.last === true) break;
  }
  return out;
}

/** The message payload for one subscription, in its destination's format. */
export async function buildMessage(env, sub, matches) {
  const token = await tokenFor(env, 'manage', sub.id);
  const manage = manageUrl(sub.id, token);
  if (sub.kind === 'slack') return { slack: slackMessage({ matches, conditions: sub.conditions, manage }) };
  if (sub.kind === 'discord') return { discord: discordMessage({ matches, conditions: sub.conditions, manage }) };
  const mail = digestEmail({ matches, conditions: sub.conditions, manage, unsubscribePage: unsubscribePageUrl(sub.id, token) });
  return { email: { ...mail, unsubscribeUrl: oneClickUrl(sub.id, token) } };
}

/**
 * One sender cycle. Returns a summary; also written to KV as state:last-run.
 * [fetchImpl] and [now] are injectable for tests.
 */
export async function runAlerts(env, { now = new Date(), fetchImpl = fetch } = {}) {
  const kv = env.ALERTS;
  const summary = {
    at: now.toISOString(), subscriptions: 0, active: 0, postingsRead: 0, topId: null,
    stale: 0, sent: 0, items: 0, nothingNew: 0, tooSoon: 0, deferred: 0, failed: 0, disabled: 0, purged: 0,
    byKind: { email: 0, slack: 0, discord: 0 },
  };
  const ids = await listSubIds(kv);
  summary.subscriptions = ids.length;
  const all = (await Promise.all(ids.map((id) => getSub(kv, id)))).filter(Boolean);

  // Stopped subscriptions are kept 30 days so the manage page can say why, then removed.
  for (const sub of all) {
    if (sub.status === 'disabled' && sub.disabledAt && now - Date.parse(sub.disabledAt) > DISABLED_KEEP_MS) {
      await deleteSub(kv, sub);
      summary.purged++;
    }
  }

  const active = all.filter((s) => s.status === 'active');
  summary.active = active.length;
  if (!active.length) {
    await kv.put('state:last-run', JSON.stringify(summary));
    return summary;
  }

  const floor = Math.min(...active.map((s) => Number(s.cursor) || 0));
  const jobs = await fetchPostingsAbove(floor, fetchImpl);
  summary.postingsRead = jobs.length;
  summary.topId = jobs.length ? Number(jobs[0].id) : null;
  summary.stale = jobs.filter((j) => !isFresh(j, now)).length;

  // Longest-waiting first, so a capped run never starves the same subscriptions.
  active.sort((a, b) => String(a.lastSentAt || '').localeCompare(String(b.lastSentAt || '')));

  let sends = 0;
  for (const sub of active) {
    if (sub.lastSentAt && now - Date.parse(sub.lastSentAt) < MIN_GAP_MS) {
      summary.tooSoon++;
      continue;
    }
    const cursor = Number(sub.cursor) || 0;
    const sent = new Set((sub.sent || []).map(Number));
    const fresh = jobs.filter((j) => Number(j.id) > cursor && !sent.has(Number(j.id)));
    const matches = rankMatches(sub.conditions, fresh.filter((j) => isFresh(j, now)), now);
    if (!matches.length) {
      summary.nothingNew++;
      continue;
    }
    if (sends >= MAX_SENDS_PER_RUN) {
      summary.deferred++;
      continue;
    }
    sends++;

    const shown = matches.slice(0, MAX_ITEMS[sub.kind] || MAX_ITEMS.email).map((m) => Number(m.job.id));
    const claimed = {
      ...sub,
      cursor: Math.max(cursor, ...fresh.map((j) => Number(j.id))),
      sent: [...shown, ...(sub.sent || [])].slice(0, SENT_KEEP),
      lastSentAt: now.toISOString(),
    };
    await putSub(kv, claimed);

    let result;
    try {
      const destination = await unseal(env, sub.dest);
      const message = await buildMessage(env, sub, matches);
      result = await deliver(env, sub.kind, destination, message, fetchImpl);
    } catch (e) {
      result = { ok: false, status: 0, permanent: false, error: 'send: ' + String(e && e.message || e).slice(0, 100) };
    }

    if (result.ok) {
      summary.sent++;
      summary.items += shown.length;
      summary.byKind[sub.kind] = (summary.byKind[sub.kind] || 0) + 1;
      if (sub.failures || sub.goneStreak || sub.lastError) {
        await putSub(kv, { ...claimed, failures: 0, goneStreak: 0, lastError: null, lastErrorAt: null });
      }
    } else {
      const restored = afterFailure(sub, result, now);
      await putSub(kv, restored);
      summary.failed++;
      if (restored.status === 'disabled') summary.disabled++;
    }
  }

  await kv.put('state:last-run', JSON.stringify(summary));
  return summary;
}

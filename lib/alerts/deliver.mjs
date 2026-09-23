// Posting a message to one destination, and reading the answer as one of
// three outcomes: delivered, a failure worth retrying, or a destination that
// is gone for good (a deleted webhook, an archived channel).

import { sendEmail } from './ses.mjs';

// A webhook must be exactly the provider's own endpoint. Anything else would
// let a subscriber point the sender at an arbitrary host.
const SLACK_RE = /^https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]{16,64}$/;
const DISCORD_RE = /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d{15,22}\/[A-Za-z0-9_-]{40,100}$/;
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/**
 * { ok: true, destination } with the canonical form, or { ok: false, error }.
 */
export function normalizeDestination(kind, raw) {
  const v = String(raw || '').trim();
  if (kind === 'email') {
    const e = v.toLowerCase();
    if (e.length > 254 || !EMAIL_RE.test(e)) return { ok: false, error: '이메일 주소를 다시 확인해 주세요.' };
    return { ok: true, destination: e };
  }
  if (kind === 'slack') {
    if (!SLACK_RE.test(v)) return { ok: false, error: 'Slack 웹훅 주소는 https://hooks.slack.com/services/ 로 시작해요.' };
    return { ok: true, destination: v };
  }
  if (kind === 'discord') {
    if (!DISCORD_RE.test(v)) return { ok: false, error: 'Discord 웹훅 주소는 https://discord.com/api/webhooks/ 로 시작해요.' };
    return { ok: true, destination: v.replace(/^https:\/\/(?:ptb\.|canary\.)?discordapp\.com/, 'https://discord.com') };
  }
  return { ok: false, error: '받을 곳을 골라 주세요.' };
}

// Answers that mean the webhook will never work again.
const GONE = new Set([401, 403, 404, 410]);

function classify(status, bodyText) {
  if (status >= 200 && status < 300) return { ok: true, status };
  const permanent = GONE.has(status) || (status === 400 && /invalid_token|no_service|channel_not_found|channel_is_archived|Unknown Webhook/i.test(bodyText || ''));
  return { ok: false, status, permanent, error: String(bodyText || 'http_' + status).slice(0, 120) };
}

async function postJson(url, payload, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'tailf-web-alerts/1 (+https://tailf.asyncsite.com/alerts/)' },
      body: JSON.stringify(payload),
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    return { ok: false, status: 0, permanent: false, error: 'network: ' + String(e && e.message || e).slice(0, 100) };
  }
  let text = '';
  try {
    text = await res.text();
  } catch (e) {
    text = '';
  }
  return classify(res.status, text);
}

/**
 * Delivers one prepared message. [message] holds { slack, discord, email }
 * payloads; only the one for [kind] is used.
 */
export async function deliver(env, kind, destination, message, fetchImpl = fetch) {
  if (kind === 'slack') return postJson(destination, message.slack, fetchImpl);
  if (kind === 'discord') return postJson(destination + '?wait=false', message.discord, fetchImpl);
  if (kind === 'email') {
    try {
      const r = await sendEmail(env, { to: destination, ...message.email }, fetchImpl);
      if (r.ok) return { ok: true, status: r.status, id: r.id };
      // SES rejects a bad address with 400 MessageRejected; that address will not start working.
      const permanent = r.status === 400 && /MessageRejected|not valid|Illegal address/i.test(r.error || '');
      return { ok: false, status: r.status, permanent, error: String(r.error).slice(0, 120) };
    } catch (e) {
      return { ok: false, status: 0, permanent: false, error: 'network: ' + String(e && e.message || e).slice(0, 100) };
    }
  }
  return { ok: false, status: 0, permanent: true, error: 'unknown kind' };
}

// Consecutive failures before a subscription stops: a gone destination is
// believed on the second answer, anything else after five hourly tries.
export const DISABLE_AFTER = { permanent: 2, transient: 5 };

/** The subscription after one failed delivery: counters, and maybe stopped. */
export function afterFailure(sub, result, now) {
  const failures = (sub.failures || 0) + 1;
  const goneStreak = result.permanent ? (sub.goneStreak || 0) + 1 : 0;
  const next = { ...sub, failures, goneStreak, lastError: result.error || 'http_' + result.status, lastErrorAt: now.toISOString() };
  if (goneStreak >= DISABLE_AFTER.permanent || failures >= DISABLE_AFTER.transient) {
    next.status = 'disabled';
    next.disabledAt = now.toISOString();
    next.disabledReason = goneStreak >= DISABLE_AFTER.permanent ? 'destination_gone' : 'repeated_failures';
  }
  return next;
}

// Amazon SES v2 SendEmail over HTTPS, signed with SigV4 in WebCrypto.
//
// SES is the provider the company's noti-service already sends through
// (its teamgrit and cogito chains, account 544925303809, ap-northeast-2), and
// asyncsite.com is a DKIM-verified identity there. The Worker cannot reach
// noti-service (its /api/noti sits behind the gateway's JWT and needs a
// template row in notidb), so it talks to the same SES account with its own
// send-only IAM user `tailf-web-alerts-mailer`, whose policy allows
// ses:SendEmail from alerts@asyncsite.com and nothing else.

const enc = new TextEncoder();

export const SES_REGION = 'ap-northeast-2';
export const MAIL_FROM = 'tailf <alerts@asyncsite.com>';
export const MAIL_REPLY_TO = 'asyncsite@gmail.com';

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(text) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

async function hmac(key, text) {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(text));
}

/** SigV4 headers for one JSON POST. Exported for the signing test. */
export async function signRequest({ method, host, path, body, region, service, accessKeyId, secretAccessKey, now }) {
  const t = now || new Date();
  const amzDate = t.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const payloadHash = await sha256(body);
  const canonicalHeaders = 'content-type:application/json\nhost:' + host + '\nx-amz-date:' + amzDate + '\n';
  const signedHeaders = 'content-type;host;x-amz-date';
  const canonical = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = day + '/' + region + '/' + service + '/aws4_request';
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256(canonical)].join('\n');
  let key = await hmac('AWS4' + secretAccessKey, day);
  key = await hmac(key, region);
  key = await hmac(key, service);
  key = await hmac(key, 'aws4_request');
  const signature = hex(await hmac(key, toSign));
  return {
    'Content-Type': 'application/json',
    'X-Amz-Date': amzDate,
    Authorization: 'AWS4-HMAC-SHA256 Credential=' + accessKeyId + '/' + scope + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature,
  };
}

/**
 * Sends one email. Returns { ok, status, id?, error? }; never throws for an
 * HTTP answer, only the caller's fetch can throw on a network failure.
 */
export async function sendEmail(env, { to, subject, html, text, unsubscribeUrl }, fetchImpl = fetch) {
  const accessKeyId = env.SES_ACCESS_KEY_ID;
  const secretAccessKey = env.SES_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) return { ok: false, status: 0, error: 'ses_not_configured' };
  const host = 'email.' + SES_REGION + '.amazonaws.com';
  const path = '/v2/email/outbound-emails';
  const simple = {
    Subject: { Data: subject, Charset: 'UTF-8' },
    Body: { Text: { Data: text, Charset: 'UTF-8' }, Html: { Data: html, Charset: 'UTF-8' } },
  };
  if (unsubscribeUrl) {
    // RFC 8058 one-click: mail clients POST List-Unsubscribe=One-Click here.
    simple.Headers = [
      { Name: 'List-Unsubscribe', Value: '<' + unsubscribeUrl + '>' },
      { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
    ];
  }
  const body = JSON.stringify({
    FromEmailAddress: MAIL_FROM,
    Destination: { ToAddresses: [to] },
    ReplyToAddresses: [MAIL_REPLY_TO],
    Content: { Simple: simple },
  });
  const headers = await signRequest({ method: 'POST', host, path, body, region: SES_REGION, service: 'ses', accessKeyId, secretAccessKey });
  const res = await fetchImpl('https://' + host + path, { method: 'POST', headers, body, signal: AbortSignal.timeout(15000) });
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  if (res.ok) return { ok: true, status: res.status, id: data && data.MessageId };
  return { ok: false, status: res.status, error: (data && (data.message || data.Message)) || 'ses_' + res.status };
}

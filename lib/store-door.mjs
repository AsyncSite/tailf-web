// The install door a content link or a page button leads to: /go/appstore/{source}/
// (every page's App Store button) and /get/{source}/ (the link Threads replies and
// YouTube descriptions print, with no store name in the visible URL).
//
// Two problems this answers, both measured 2026-09-25 (dev-jobs-143):
//   1. The static /go/appstore/ pages forward with a zero-second meta refresh, so the
//      Web Analytics beacon never reports: Threads readers opened channel pages 67 times
//      in 36 hours and the App Store door counted 0. A store tap was invisible.
//   2. A reader on an Android phone or a PC who is sent to the App Store gets a page it
//      cannot install from, and the Play door has nothing to install yet.
//
// So the door counts itself (one KV counter per KST day, door, channel and platform:
// no IP, no identifier, no query string) and then answers by platform. iPhone and
// iPad go to the App Store as before; everyone else gets one screen that says what the
// alert is and opens the web alert form under the same channel, with the App Store
// one tap below for a reader who has an iPhone in the other hand.

import { esc, PAGE_SOURCES } from './seo.mjs';

export const APP_STORE_URL = 'https://apps.apple.com/kr/app/tailf/id6808048845';
// Channel words the door accepts: every channel page source plus the search pages.
export const DOOR_SOURCES = new Set([...PAGE_SOURCES, 'seo']);
const COUNT_TTL_SECONDS = 400 * 24 * 3600;

// Link previews and crawlers fetch the URL a post prints; they are not readers.
// Threads (Barcelona), Instagram and KakaoTalk in-app browsers are readers and pass.
const NOT_A_READER = /bot|crawl|spider|slurp|preview|facebookexternalhit|meta-externalagent|facebookcatalog|embedly|whatsapp|telegram|slack|discord|kakaotalk-scrap|yeti|daum|headless|lighthouse|curl|wget|python|node-fetch|go-http|okhttp|java\//i;

/** 'ios' | 'android' | 'desktop' | 'bot' from a User-Agent. iPadOS Safari says Macintosh; it lands on 'desktop' and still sees the App Store link. */
export function platformOf(ua) {
  const s = String(ua || '');
  if (!s || NOT_A_READER.test(s)) return 'bot';
  if (/iPhone|iPad|iPod/.test(s)) return 'ios';
  if (/Android/.test(s)) return 'android';
  return 'desktop';
}

/** /go/appstore/{source}/ or /get/{source}/ as { door, source }; source '' is the bare door. null when the path is not a door. */
export function parseDoor(pathname) {
  const m = /^\/(go\/appstore|get)\/(?:([a-z]{2,20})\/)?$/.exec(pathname);
  if (!m) return null;
  const source = m[2] || '';
  if (source && !DOOR_SOURCES.has(source)) return null;
  return { door: m[1] === 'get' ? 'get' : 'appstore', source };
}

export function kstDate(now) {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** door:{KST day}:{door}:{source or direct}:{platform}. The collector reads this prefix. */
export function doorKey(now, door, source, platform) {
  return ['door', kstDate(now), door, source || 'direct', platform].join(':');
}

/**
 * KV has no atomic increment. Two taps in the same second can lose one; at a few
 * taps a day that is noise, and the counter never over-counts.
 */
export async function bump(kv, key) {
  if (!kv) return;
  try {
    const n = parseInt((await kv.get(key)) || '0', 10) || 0;
    await kv.put(key, String(n + 1), { expirationTtl: COUNT_TTL_SECONDS });
  } catch (e) {
    // A counter must never stand between a reader and the door.
  }
}

export function webDoorHtml(source) {
  const alerts = '/alerts/from/' + (source || 'landing') + '/';
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>새 공고 알림 받기 · tailf</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<div class="wrap">
  <header><a class="mark" href="/">tail<span>&nbsp;-f</span></a></header>
  <main class="go">
    <h1>새 공고 알림, 이메일이나 Slack 으로 바로 받을 수 있어요</h1>
    <p>직무와 경력, 쓰는 기술을 한 번 넣어두면 맞는 새 공고가 올라온 날 보내 드려요. 원티드에 안 올라오는 회사 자체 채용 공고까지 저희가 매일 보고 있어요.</p>
    <div class="cta-row"><a class="btn" href="${esc(alerts)}">앱 없이 알림 받기</a></div>
    <p>아이폰이라면 tailf 앱으로도 받을 수 있어요. <a href="${APP_STORE_URL}">App Store 에서 tailf 받기</a></p>
    <p class="go-back"><a href="/">← tailf 첫 화면으로</a></p>
  </main>
</div>
<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "1903f0756d134ec896ce7b97670134ee", "send": {"to": "https://tailf.asyncsite.com/cdn-cgi/rum"}}'></script>
</body>
</html>`;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const parsed = parseDoor(url.pathname);
  if (!parsed) return context.next();
  const { door, source } = parsed;
  const platform = platformOf(request.headers.get('User-Agent'));
  if (request.method === 'GET' && platform !== 'bot') {
    const counting = bump(env && env.ALERTS, doorKey(new Date(), door, source, platform));
    if (context.waitUntil) context.waitUntil(counting);
    else await counting;
  }
  const headers = {
    'Cache-Control': 'no-store',
    Vary: 'User-Agent',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
  };
  if (platform === 'ios') {
    return new Response(null, { status: 302, headers: { ...headers, Location: APP_STORE_URL } });
  }
  // A crawler reading the link gets the same page a PC reader does, without a count.
  return new Response(webDoorHtml(source), {
    status: 200,
    headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff' },
  });
}

// 공고 건네기 지면 (tailf-app T-502, 당근 2-7).
//
// /p/{id} 는 공고 하나를 tailf 의 말로 보여주는 지면입니다. 앱의 상세에서 「건네기」로
// 나가는 링크가 여기로 오고, 링크에는 공고 번호 하나뿐 건넨 사람의 조건이나 신원은
// 없습니다(lifecycle 606). 링크 미리보기(카카오톡, 슬랙)가 제목과 회사를 보여줄 수
// 있도록 서버에서 그립니다. 정적 파일로는 og 태그를 공고마다 다르게 줄 수 없습니다.
//
// 공고 정보는 공개 API 하나에서 옵니다. 앱 상세와 같은 출처입니다.

const API = 'https://api.asyncsite.com/api/public/jobs/';
const SITE = 'https://tailf.asyncsite.com';
const OG_IMAGE = SITE + '/assets/og.png';

const ROBOTS = 'noindex, nofollow';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// The app strips a company name that leads the title (「[하이브] Full-Stack 개발」),
// so the same posting reads the same way here.
function titleWithoutCompany(title, company) {
  const t = String(title || '').trim();
  const c = String(company || '').trim();
  if (!c) return t;
  const lc = c.toLowerCase();
  const patterns = [
    new RegExp('^\\[\\s*' + escapeRe(c) + '\\s*\\]\\s*', 'i'),
    new RegExp('^' + escapeRe(c) + '\\s*[|·:\\-]\\s*', 'i'),
  ];
  for (const re of patterns) {
    const out = t.replace(re, '');
    if (out !== t && out.trim()) return out.trim();
  }
  if (t.toLowerCase().startsWith(lc + ' ') && t.length > c.length + 3) {
    return t.slice(c.length).trim();
  }
  return t;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// KST calendar days since the posting date, the way the app's cards count.
function openDaysKo(postedAt, now) {
  if (!postedAt) return null;
  const day = String(postedAt).split('T')[0];
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const posted = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  const today = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate());
  const days = Math.max(1, Math.round((today - posted) / 86400000) + 1);
  if (days < 180) return days + '일째 열려 있어요';
  if (days < 365) return Math.floor(days / 30) + '달째 열려 있어요';
  return Math.floor(days / 365) + '년째 열려 있어요';
}

function careerKo(job) {
  const cat = String(job.experienceCategory || '').toUpperCase();
  if (cat === 'ANY') return '경력 무관';
  const text = String(job.experience || '').trim();
  if (text) return text;
  return '경력 표기 없음';
}

function page({ title, description, body, canonical, status }) {
  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="${ROBOTS}">
<link rel="canonical" href="${esc(canonical)}">
<meta name="theme-color" content="#F7FBF3">
<meta property="og:type" content="article">
<meta property="og:site_name" content="tailf">
<meta property="og:locale" content="ko_KR">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${OG_IMAGE}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${OG_IMAGE}">
<link rel="icon" href="/assets/icon-64.png" sizes="64x64" type="image/png">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<link rel="stylesheet" href="/style.css">
<style>
  .handed { max-width: 640px; margin: 0 auto; padding: 22px 20px 60px; }
  .posting { background: var(--card); border: 1px solid var(--rule); border-radius: var(--r-card); padding: 22px 20px; margin-top: 14px; }
  .posting h1 { font-size: 24px; line-height: 1.3; letter-spacing: -0.03em; font-weight: 800; margin: 0; }
  .posting .meta { margin-top: 8px; font-size: 15px; color: var(--ink-2); }
  .posting .open { margin-top: 4px; font-size: 13.5px; color: var(--ink-3); }
  .posting .closed { margin-top: 10px; display: inline-block; padding: 4px 11px; border-radius: 100px; background: var(--chip); color: var(--ink-2); font-size: 13px; font-weight: 700; }
  .posting .chips { margin-top: 14px; }
  .posting .chip { min-height: 36px; padding: 0 13px; font-size: 13.5px; cursor: default; }
  .posting .body { margin-top: 16px; font-size: 15px; line-height: 1.6; color: var(--ink-2); white-space: pre-line; }
  .posting .cta-row { margin-top: 20px; }
  .posting .btn { min-height: 52px; font-size: 16px; }
  .why { margin-top: 26px; }
  .why h2 { font-size: 21px; }
  .why .cta-row { margin-top: 18px; }
  .handed .cta-note { margin-top: 10px; }
  .privacy { margin-top: 28px; font-size: 13.5px; color: var(--ink-3); }
</style>
</head>
<body>
<header class="topbar">
  <div class="page">
    <a class="mark" href="/">tail<span>&nbsp;-f</span></a>
    <nav class="topctas" aria-label="받는 곳">
      <a class="topcta install-pending" href="/go/appstore/" data-install="appstore" data-keep-label>App Store</a>
      <a class="topcta install-pending" href="/go/play/" data-install="play" data-keep-label>Google Play</a>
    </nav>
  </div>
</header>
<main class="handed">
${body}
</main>
<footer class="foot">
  <div class="page">
    <a href="/privacy/">개인정보 처리방침</a><span class="sep">·</span><a href="/support/">문의</a><span class="sep">·</span><a href="mailto:asyncsite@gmail.com">asyncsite@gmail.com</a>
    <span class="co">AsyncSite</span>
  </div>
</footer>
<script src="/app.js" defer></script>
</body>
</html>`;
  return new Response(html, {
    status: status || 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Robots-Tag': ROBOTS,
      'Cache-Control': status && status >= 400 ? 'no-store' : 'public, max-age=300, s-maxage=600',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function whyBlock() {
  return `<section class="why">
  <p class="eyebrow">이런 공고를 매일 찾지 않아도 되게</p>
  <h2>맞는 공고가 올라온 날에만 알려드려요.</h2>
  <p class="block-sub">tailf 는 쓰는 기술과 찾는 조건을 한 번 넣어두면, 그 조건에 맞는 개발 공고가 올라온 날에만 잠금화면에 한 번 떠요. 넣어둔 건 그 폰 안에만 있고 로그인도 없어요.</p>
  <p class="cta-row">
    <a class="btn" href="/#try">지난 30일 먼저 세어보기</a>
    <a class="btn install-pending" href="/go/appstore/" data-install="appstore">App Store</a>
    <a class="btn install-pending" href="/go/play/" data-install="play">Google Play</a>
  </p>
  <p class="cta-note">설치하기 전에 내 기술로 지난 30일에 몇 번 왔을지 브라우저에서 먼저 세어볼 수 있어요.</p>
</section>
<p class="privacy">이 링크에는 공고 번호 하나뿐이에요. 건넨 사람의 기술과 조건과 이름은 들어 있지 않아요.</p>`;
}

function postingBlock(job, now) {
  const title = titleWithoutCompany(job.title, job.company);
  const career = careerKo(job);
  const where = String(job.location || '').trim();
  const meta = [job.company, career, where].filter(Boolean).map(esc).join(' · ');
  const open = job.isActive === false ? null : openDaysKo(job.postedAt, now);
  const closed = job.isActive === false;
  const skills = Array.isArray(job.skills) ? job.skills.filter(Boolean).slice(0, 12) : [];
  const body = String(job.summary || job.description || '').trim();
  const shown = body.length > 600 ? body.slice(0, 600).trim() + '…' : body;
  const source = String(job.sourceUrl || '').trim();
  return `<p class="eyebrow">tailf 를 쓰는 개발자가 건넨 공고</p>
<article class="posting">
  <h1>${esc(title)}</h1>
  <p class="meta">${meta}</p>
  ${closed ? '<p class="closed">이 공고는 내려갔어요</p>' : open ? '<p class="open">' + esc(open) + '</p>' : ''}
  ${skills.length ? '<div class="chips">' + skills.map((s) => '<span class="chip">' + esc(s) + '</span>').join('') + '</div>' : ''}
  ${shown ? '<p class="body">' + esc(shown) + '</p>' : ''}
  <p class="cta-row">
    ${source ? '<a class="btn" href="' + esc(source) + '" rel="noopener noreferrer" target="_blank">회사 사이트에서 보기</a>' : '<span class="cta-note">원문 링크가 없어요.</span>'}
  </p>
</article>
${whyBlock()}`;
}

export async function onRequest(context) {
  const { request, params } = context;
  const seg = Array.isArray(params.path) ? params.path[0] : params.path;
  const id = String(seg || '').trim();
  const now = new Date();
  const canonical = SITE + '/p/' + esc(id);
  if (!/^\d{1,12}$/.test(id)) {
    return page({
      title: 'tailf · 공고를 찾을 수 없어요',
      description: '이 링크의 공고 번호를 읽을 수 없어요.',
      canonical: SITE + '/p/',
      status: 404,
      body: `<p class="eyebrow">건네받은 공고</p><article class="posting"><h1>공고를 찾을 수 없어요.</h1><p class="meta">이 링크의 공고 번호를 읽을 수 없어요.</p></article>${whyBlock()}`,
    });
  }
  let res;
  try {
    res = await fetch(API + id, { headers: { Accept: 'application/json' }, cf: { cacheTtl: 300 } });
  } catch (e) {
    res = null;
  }
  if (!res) {
    return page({
      title: 'tailf · 지금은 불러오지 못했어요',
      description: '공고를 잠시 불러오지 못했어요. 다시 열어 주세요.',
      canonical,
      status: 502,
      body: `<p class="eyebrow">건네받은 공고</p><article class="posting"><h1>지금은 불러오지 못했어요.</h1><p class="meta">잠시 뒤 이 링크를 다시 열어 주세요.</p></article>${whyBlock()}`,
    });
  }
  // The public single-posting read answers 500 for an id it does not have
  // (2026-09-05, /api/public/jobs/99999999). Until it says 404, a 500 here is
  // read as 「찾을 수 없어요」 and not cached, so a real outage is retried on
  // the next open rather than shown as a missing posting for five minutes.
  if (res.status === 404 || res.status >= 500) {
    return page({
      title: 'tailf · 이 공고는 찾을 수 없어요',
      description: '건네받은 공고가 더는 없어요.',
      canonical,
      status: 404,
      body: `<p class="eyebrow">건네받은 공고</p><article class="posting"><h1>이 공고는 찾을 수 없어요.</h1><p class="meta">내려갔거나 주소가 바뀌었을 수 있어요.</p></article>${whyBlock()}`,
    });
  }
  let job;
  try {
    job = await res.json();
  } catch (e) {
    job = null;
  }
  if (!job || typeof job !== 'object' || !job.title) {
    return page({
      title: 'tailf · 지금은 불러오지 못했어요',
      description: '공고를 잠시 불러오지 못했어요.',
      canonical,
      status: 502,
      body: `<p class="eyebrow">건네받은 공고</p><article class="posting"><h1>지금은 불러오지 못했어요.</h1></article>${whyBlock()}`,
    });
  }
  const title = titleWithoutCompany(job.title, job.company) + (job.company ? ' · ' + job.company : '');
  const open = job.isActive === false ? '내려간 공고' : openDaysKo(job.postedAt, now);
  const description = [careerKo(job), String(job.location || '').trim(), open, 'tailf 를 쓰는 개발자가 건넨 공고'].filter(Boolean).join(' · ');
  return page({ title, description, canonical, body: postingBlock(job, now) });
}

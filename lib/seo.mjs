// Shared pieces for the pages search engines read: the posting page (/p/),
// the company page (/c/), the role and tech hubs (/r/, /t/) and the sitemaps.
//
// Everything here is a pure function of a posting as the public API returns
// it (https://api.asyncsite.com/api/public/jobs). The same code runs inside a
// Pages Function and inside the build script, so a hub and a posting page
// never disagree about a title, a date or a location.

export const SITE = 'https://tailf.asyncsite.com';
export const API = 'https://api.asyncsite.com/api/public/jobs';
export const OG_IMAGE = SITE + '/assets/og.png';

// Search visitors reach the store through a fixed path so Web Analytics can
// count them without a query string (README 「설치 클릭률 읽는 법」).
export const STORE_SEO = '/go/appstore/seo/';
export const PLAY_SEO = '/go/play/seo/';

// One positioning line for every surface (landing, /p/, /c/, hubs, Threads, YouTube).
// Measured 2026-09-24: most sampled open postings come from companies' own career pages
// and are absent from Wanted; the share is a sample range, so the copy states it without a number.
export const POSITIONING = '원티드에 안 올라오는 회사 자체 채용 공고까지 모아 보여 드려요.';
export const POSITIONING_SUPPORT = '직무와 경력, 쓰는 기술을 넣어두면 맞는 새 공고가 올라온 날 알려 드려요.';

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The app strips a company name that leads the title (「[하이브] Full-Stack 개발」),
// so the same posting reads the same way here.
export function titleWithoutCompany(title, company) {
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

export function careerKo(job) {
  const cat = String(job.experienceCategory || '').toUpperCase();
  if (cat === 'ANY') return '경력 무관';
  const text = String(job.experience || '').trim();
  if (text) return text;
  return '경력 표기 없음';
}

const EMPLOYMENT = {
  FULLTIME: { ld: 'FULL_TIME', ko: '정규직' },
  FULL_TIME: { ld: 'FULL_TIME', ko: '정규직' },
  PARTTIME: { ld: 'PART_TIME', ko: '파트타임' },
  PART_TIME: { ld: 'PART_TIME', ko: '파트타임' },
  // 계약직 in Korea is a fixed-term employee, which schema.org calls TEMPORARY.
  CONTRACT: { ld: 'TEMPORARY', ko: '계약직' },
  INTERN: { ld: 'INTERN', ko: '인턴' },
};

export function employment(job) {
  return EMPLOYMENT[String(job.jobType || '').toUpperCase()] || null;
}

// ---------- dates ----------

/** 'YYYY-MM-DD' of [d] in KST. */
export function kstDay(d) {
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  return k.toISOString().slice(0, 10);
}

/** The posting date as 'YYYY-MM-DD', or null. */
export function postedDay(job) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(job.postedAt || ''));
  return m ? m[1] + '-' + m[2] + '-' + m[3] : null;
}

/**
 * The deadline the posting states, as 'YYYY-MM-DD', or null when it states
 * none (상시채용) or a date nobody means (~2999.12.31, anything more than a
 * year out). The list carries it as 「~2026.10.08」.
 */
export function deadlineDay(job, now) {
  const m = /(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/.exec(String(job.deadline || ''));
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const day = y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  const limit = new Date(now.getTime() + 366 * 86400000);
  if (day > kstDay(limit)) return null;
  return day;
}

/** True when the posting's own deadline is already behind us (KST). */
export function pastDeadline(job, now) {
  const d = deadlineDay(job, now);
  return !!d && d < kstDay(now);
}

export function dayKoFromIso(day, now) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
  if (!m) return '';
  const md = +m[2] + '월 ' + +m[3] + '일';
  return +m[1] === +kstDay(now).slice(0, 4) ? md : m[1] + '년 ' + md;
}

// KST calendar days since the posting date, the way the app's cards count.
export function openDaysKo(postedAt, now) {
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

// ---------- location ----------

// Region words in the location strings the crawlers leave (서울 강남, Pangyo,
// 판교 오피스 (경기도 성남시 ...)). Order matters: the first hit wins.
const KR_PLACES = [
  { re: /판교|pangyo|성남|분당|정자동|정자역|그린팩토리/i, region: '경기도', locality: '성남시' },
  { re: /수원|suwon/i, region: '경기도', locality: '수원시' },
  { re: /용인|yongin/i, region: '경기도', locality: '용인시' },
  { re: /화성|hwaseong|동탄/i, region: '경기도', locality: '화성시' },
  { re: /안양|anyang|평촌/i, region: '경기도', locality: '안양시' },
  { re: /과천/i, region: '경기도', locality: '과천시' },
  { re: /하남/i, region: '경기도', locality: '하남시' },
  { re: /이천|icheon/i, region: '경기도', locality: '이천시' },
  { re: /인천|incheon|송도|songdo/i, region: '인천광역시', locality: '인천' },
  { re: /부산|busan/i, region: '부산광역시', locality: '부산' },
  { re: /대구|daegu|현풍/i, region: '대구광역시', locality: '대구' },
  { re: /대전|daejeon/i, region: '대전광역시', locality: '대전' },
  { re: /광주|gwangju/i, region: '광주광역시', locality: '광주' },
  { re: /울산|ulsan/i, region: '울산광역시', locality: '울산' },
  { re: /세종|sejong/i, region: '세종특별자치시', locality: '세종' },
  { re: /제주|jeju/i, region: '제주특별자치도', locality: '제주' },
  { re: /서울|seoul|강남|역삼|선릉|삼성동|서초|반포|송파|잠실|구로|가산|당산|영등포|여의도|성수|마포|합정|용산|을지로|종로|광화문|판교로|테헤란/i, region: '서울특별시', locality: '서울' },
  { re: /경기/i, region: '경기도', locality: '경기' },
];

const FOREIGN = [
  { re: /taipei|taiwan|대만/i, country: 'TW', locality: 'Taipei' },
  { re: /tokyo|japan|일본|도쿄|東京/i, country: 'JP', locality: 'Tokyo' },
  { re: /india|bengaluru|bangalore/i, country: 'IN', locality: null },
  { re: /germany|düsseldorf|berlin|munich/i, country: 'DE', locality: null },
  { re: /singapore|싱가포르/i, country: 'SG', locality: 'Singapore' },
  { re: /united states|usa\b|seattle|san francisco|new york|california|미국/i, country: 'US', locality: null },
  { re: /vietnam|베트남|ho chi minh|hanoi/i, country: 'VN', locality: null },
];

const REMOTE = /remote|원격|재택|리모트|work from home|wfh/i;

/**
 * What the location string lets us say without guessing. Returns
 * { remote, country, region, locality, street } or null when the posting names
 * no place we can place on a map (미지정, empty, a bare "Remote").
 */
export function parseLocation(raw) {
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!text || /^(미지정|미정|없음|-|n\/a)$/i.test(text)) return null;
  const remote = REMOTE.test(text);
  for (const f of FOREIGN) {
    if (f.re.test(text)) {
      if (f.country === 'US') {
        const m = /^([^,]+),/.exec(text);
        return { remote, country: 'US', region: null, locality: m ? m[1].trim() : null, street: null };
      }
      if (!f.locality) {
        const m = /^([^,(]+)[,(]/.exec(text);
        return { remote, country: f.country, region: null, locality: m ? m[1].trim() : null, street: null };
      }
      return { remote, country: f.country, region: null, locality: f.locality, street: null };
    }
  }
  const hangul = /[가-힣]/.test(text);
  const korea = hangul || /korea|seoul|pangyo|ulsan|busan|incheon|daejeon|suwon|songdo/i.test(text);
  if (!korea) return remote ? { remote, country: null, region: null, locality: null, street: null } : null;
  const place = KR_PLACES.find((p) => p.re.test(text));
  // A string with a street number reads as an address; keep it whole.
  const street = /\d/.test(text) && /(로|길|대로|번지|빌딩|타워|센터|층)/.test(text) ? text.slice(0, 120) : null;
  return {
    remote,
    country: 'KR',
    region: place ? place.region : null,
    locality: place ? place.locality : null,
    street,
  };
}

// ---------- JobPosting JSON-LD ----------

function experienceMonths(job) {
  const t = String(job.experience || '');
  const m = /(\d{1,2})\s*년\s*(이상|↑|\+)?/.exec(t) || /(\d{1,2})\+?\s*years?/i.exec(t);
  if (!m) return null;
  const years = +m[1];
  if (!years || years > 30) return null;
  return years * 12;
}

/** The full posting text as simple HTML, sections in the order the page shows them. */
export function descriptionSections(job) {
  const out = [];
  const main = String(job.description || job.summary || '').trim();
  if (main) out.push({ head: '하는 일', text: main });
  const req = String(job.requirements || '').trim();
  if (req && req !== main) out.push({ head: '자격 요건', text: req });
  const pref = String(job.preferred || '').trim();
  if (pref && pref !== main) out.push({ head: '우대 사항', text: pref });
  return out;
}

function textToHtml(text) {
  return esc(text).replace(/\r?\n/g, '<br>');
}

/**
 * schema.org JobPosting for one posting, shaped to Google's job posting
 * guidelines, or null when the posting cannot carry one honestly: taken down,
 * past its own deadline, or with no place we can name.
 */
export function buildJobPostingLd(job, now) {
  if (!job || typeof job !== 'object' || !job.title || !job.id) return null;
  if (job.isActive === false) return null;
  if (pastDeadline(job, now)) return null;
  const datePosted = postedDay(job);
  if (!datePosted) return null;
  const sections = descriptionSections(job);
  if (!sections.length) return null;
  const loc = parseLocation(job.location);
  if (!loc) return null;
  if (!loc.country) return null; // remote with no country: nothing to require

  const title = titleWithoutCompany(job.title, job.company);
  const ld = {
    '@context': 'https://schema.org/',
    '@type': 'JobPosting',
    title,
    description: sections.map((s) => '<p><strong>' + esc(s.head) + '</strong></p><p>' + textToHtml(s.text) + '</p>').join(''),
    identifier: { '@type': 'PropertyValue', name: 'tailf', value: String(job.id) },
    datePosted,
    hiringOrganization: { '@type': 'Organization', name: String(job.company || '').trim() },
    directApply: false,
    url: SITE + '/p/' + job.id + '/',
  };
  if (!ld.hiringOrganization.name) return null;
  const valid = deadlineDay(job, now);
  if (valid) ld.validThrough = valid + 'T23:59:59+09:00';
  const emp = employment(job);
  if (emp) ld.employmentType = emp.ld;
  const months = experienceMonths(job);
  if (months) {
    ld.experienceRequirements = { '@type': 'OccupationalExperienceRequirements', monthsOfExperience: months };
  } else if (String(job.experienceCategory || '').toUpperCase() === 'ANY' || String(job.experienceCategory || '').toUpperCase() === 'ENTRY') {
    ld.experienceRequirements = 'no requirements';
  }
  const skills = Array.isArray(job.skills) ? job.skills.filter(Boolean) : [];
  if (skills.length) ld.skills = skills.join(', ');

  const address = { '@type': 'PostalAddress', addressCountry: loc.country };
  if (loc.region) address.addressRegion = loc.region;
  if (loc.locality) address.addressLocality = loc.locality;
  if (loc.street) address.streetAddress = loc.street;
  const hasPlace = !!(loc.region || loc.locality || loc.street);

  if (loc.remote) {
    ld.jobLocationType = 'TELECOMMUTE';
    ld.applicantLocationRequirements = { '@type': 'Country', name: loc.country };
    if (hasPlace) ld.jobLocation = { '@type': 'Place', address };
  } else {
    ld.jobLocation = { '@type': 'Place', address };
  }
  return ld;
}

/** A JSON-LD object as a script tag that cannot close itself early. */
export function ldScript(obj) {
  if (!obj) return '';
  const json = JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  return '<script type="application/ld+json">' + json + '</script>';
}

export function breadcrumbLd(items) {
  return {
    '@context': 'https://schema.org/',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.url })),
  };
}

// ---------- roles and techs ----------

export const ROLES = [
  { slug: 'backend', ko: '백엔드', re: /백엔드|back[\s-]?end|\bBE\b|서버|server|full[\s-]?stack|풀스택/i },
  { slug: 'frontend', ko: '프론트엔드', re: /프론트|front[\s-]?end|\bFE\b|웹\s*개발|web\s*(developer|engineer)|full[\s-]?stack|풀스택/i },
  { slug: 'mobile', ko: '모바일', re: /\bios\b|android|안드로이드|모바일|mobile|flutter|react\s*native/i },
  { slug: 'data', ko: '데이터', re: /데이터|data\s*(engineer|platform|analyst|analytics|scien|product|service)|analytics\s*engineer|\bDBA\b/i },
  { slug: 'ai', ko: 'AI·ML', re: /\bML\b|machine\s*learning|머신\s*러닝|딥\s*러닝|\bAI\b|LLM|인공지능|computer\s*vision|컴퓨터\s*비전|\bNLP\b|research\s*(scientist|engineer)|inference|추론|\bRAG\b/i },
  { slug: 'devops', ko: '인프라·DevOps', re: /dev(sec)?ops|\bSRE\b|site\s*reliability|infra|인프라|클라우드|cloud|platform\s*engineer|플랫폼\s*엔지니어|네트워크|network|build\s*system|data\s*center/i },
  { slug: 'security', ko: '보안', re: /보안|security/i },
  { slug: 'qa', ko: 'QA', re: /\bQA\b|테스트|test(ing)?\s*engineer|품질|quality/i },
  { slug: 'architect', ko: '솔루션 아키텍트', re: /architect|아키텍트|solutions?\s*(specialist|developer|engineer)|customer\s*engineer|필드\s*엔지니어|field\s*engineer|\bFDE\b|forward\s*deployed/i },
  { slug: 'game', ko: '게임', re: /unity|유니티|unreal|언리얼|게임|\bgame\b|클라이언트\s*개발/i },
  { slug: 'embedded', ko: '임베디드·하드웨어', re: /임베디드|embedded|firmware|펌웨어|hardware|하드웨어|\bHW|driver|드라이버|kernel|커널|systems\s*software|제어기|반도체|\bSoC\b|\bNPU\b|FPGA|자율\s*주행|autonomous|vehicle|차량|compiler|컴파일러/i },
];

export function rolesOf(job) {
  const t = String(job.title || '');
  return ROLES.filter((r) => r.re.test(t));
}

// Work tools say where someone works, not what the job is (matcher.dart
// `ignoredStackTools`). Vague labels do not make a useful page either.
const TECH_SKIP = new Set(['git', 'jira', 'confluence', 'slack', 'notion', 'ci/cd', 'ai', 'gpu', 'rest api', 'nosql', 'rdbms', 'c/c++', 'claude code', 'bash']);

export function techKey(skill) {
  return String(skill || '').trim().toLowerCase();
}

export function techSlug(skill) {
  const k = techKey(skill);
  if (!k || TECH_SKIP.has(k)) return null;
  const s = k
    .replace(/\+\+/g, 'pp')
    .replace(/#/g, 'sharp')
    .replace(/\.js$/, 'js')
    .replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || null;
}

// ---------- HTML ----------

export function pageShell({ title, description, canonical, robots, body, head, ogType, status, cache, stores }) {
  const store = (stores && stores.appstore) || STORE_SEO;
  const play = (stores && stores.play) || PLAY_SEO;
  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="${esc(robots)}">
<link rel="canonical" href="${esc(canonical)}">
<meta name="theme-color" content="#F7FBF3">
<meta property="og:type" content="${esc(ogType || 'website')}">
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
  .handed { max-width: 680px; margin: 0 auto; padding: 22px 20px 60px; }
  .crumbs { font-size: 13.5px; color: var(--ink-3); }
  .crumbs a { color: var(--ink-3); }
  .crumbs .sep { margin: 0 6px; }
  .posting { background: var(--card); border: 1px solid var(--rule); border-radius: var(--r-card); padding: 22px 20px; margin-top: 14px; }
  .posting h1, .listhead h1 { font-size: 24px; line-height: 1.3; letter-spacing: -0.03em; font-weight: 800; margin: 0; }
  .posting .meta { margin-top: 8px; font-size: 15px; color: var(--ink-2); }
  .posting .meta a { color: var(--ink-2); }
  .posting .open, .posting .dates { margin-top: 4px; font-size: 13.5px; color: var(--ink-3); }
  .posting .history { margin: 4px 0 0; font-size: 13px; color: var(--ink-3); }
  .posting .closed { margin-top: 10px; display: inline-block; padding: 4px 11px; border-radius: 100px; background: var(--chip); color: var(--ink-2); font-size: 13px; font-weight: 700; }
  .posting .chips { margin-top: 14px; }
  .posting .chip { min-height: 36px; padding: 0 13px; font-size: 13.5px; cursor: default; }
  .posting h2 { font-size: 16px; margin-top: 20px; letter-spacing: -0.02em; }
  .posting .body { margin-top: 6px; font-size: 15px; line-height: 1.6; color: var(--ink-2); white-space: pre-line; }
  .posting .cta-row, .alert .cta-row { margin-top: 20px; }
  .posting .btn, .alert .btn { min-height: 52px; font-size: 16px; }
  .alert { margin-top: 26px; }
  .alert h2 { font-size: 21px; }
  .alert .cta-note { margin-top: 10px; }
  .listhead { margin-top: 14px; }
  .listhead .sub { margin-top: 8px; font-size: 15px; color: var(--ink-2); }
  .jobs { list-style: none; margin-top: 16px; border-top: 1px solid var(--rule); }
  .jobs li { padding: 14px 2px; border-bottom: 1px solid var(--rule); }
  .jobs a.t { font-size: 16px; font-weight: 700; text-decoration: none; letter-spacing: -0.02em; }
  .jobs a.t:hover { text-decoration: underline; }
  .jobs .m { margin-top: 2px; font-size: 13.5px; color: var(--ink-3); }
  .jobs .m a { color: var(--ink-3); }
  .more { margin-top: 22px; font-size: 14.5px; color: var(--ink-2); }
  .more a { color: var(--acc-ink); }
  .links { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 8px 14px; font-size: 14.5px; }
  .links a { color: var(--acc-ink); }
  .privacy { margin-top: 28px; font-size: 13.5px; color: var(--ink-3); }
</style>
${head || ''}
</head>
<body>
<header class="topbar">
  <div class="page">
    <a class="mark" href="/">tail<span>&nbsp;-f</span></a>
    <nav class="topctas" aria-label="받는 곳">
      <a class="topcta" href="${store}" data-install="appstore" data-keep-label>App Store</a>
      <a class="topcta install-pending" href="${play}" data-install="play" data-keep-label>Google Play</a>
    </nav>
  </div>
</header>
<main class="handed">
${body}
</main>
<footer class="foot">
  <div class="page">
    <a href="/c/">회사별 공고</a><span class="sep">·</span><a href="/r/">직무별 공고</a><span class="sep">·</span><a href="/t/">기술별 공고</a><span class="sep">·</span><a href="/privacy/">개인정보 처리방침</a><span class="sep">·</span><a href="/support/">문의</a>
    <span class="co">AsyncSite</span>
  </div>
</footer>
<script src="/app.js" defer></script>
<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "1903f0756d134ec896ce7b97670134ee", "send": {"to": "https://tailf.asyncsite.com/cdn-cgi/rum"}}'></script>
</body>
</html>`;
  const headers = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': cache || (status && status >= 400 ? 'no-store' : 'public, max-age=300, s-maxage=600'),
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  };
  if (/noindex/.test(robots)) headers['X-Robots-Tag'] = robots;
  return { html, headers, status: status || 200 };
}

export function toResponse(p) {
  return new Response(p.html, { status: p.status, headers: p.headers });
}

/** The way to the same alerts without the app (/alerts/), with the source path it counts under. */
export function webAlertNote(href) {
  return `<p class="cta-note web-alerts"><a href="${esc(href)}">앱 없이 이메일·슬랙으로 받기</a> · PC에서 쓴다면 이메일이나 Slack, Discord 채널로도 받을 수 있어요.</p>`;
}

/**
 * The app answers a reader's stack and conditions, not a company name, so the
 * button says 「새 공고」 and the note says how the app decides.
 */
export function alertBlock(lead, alertsHref = '/alerts/from/seo/') {
  return `<section class="alert">
  <p class="eyebrow">이런 공고를 매일 찾지 않아도 되게</p>
  <h2>${esc(lead || POSITIONING)}</h2>
  <p class="block-sub">${esc(lead ? POSITIONING + ' 직무와 경력, 쓰는 기술을 한 번 넣어두면 돼요.' : POSITIONING_SUPPORT)} 넣어둔 건 그 폰 안에만 있고 로그인도 없어요.</p>
  <p class="cta-row">
    <a class="btn" href="${STORE_SEO}" data-install="appstore" data-keep-label>새 공고 알림 받기</a>
    <a class="btn install-pending" href="${PLAY_SEO}" data-install="play">Google Play</a>
  </p>
  <p class="cta-note">App Store 에서 tailf 를 받아 기술을 고르면 바로 시작해요.</p>
  ${webAlertNote(alertsHref)}
</section>`;
}

/** One row of a posting list, as the hub and company pages draw it. */
export function jobRow(job, now, companyId) {
  const title = titleWithoutCompany(job.title, job.company);
  const posted = postedDay(job);
  const bits = [];
  if (job.company) {
    bits.push(companyId ? '<a href="/c/' + esc(companyId) + '/">' + esc(job.company) + '</a>' : esc(job.company));
  }
  bits.push(esc(careerKo(job)));
  const where = String(job.location || '').trim();
  if (where && where !== '미지정') bits.push(esc(where.length > 40 ? where.slice(0, 40) + '…' : where));
  if (posted) bits.push(esc(dayKoFromIso(posted, now)) + ' 올라옴');
  return `<li><a class="t" href="/p/${esc(job.id)}/">${esc(title)}</a><p class="m">${bits.join(' · ')}</p></li>`;
}

// ---------- sitemaps ----------

export function urlset(entries) {
  const rows = entries.map((e) => '  <url><loc>' + esc(e.loc) + '</loc>' + (e.lastmod ? '<lastmod>' + esc(e.lastmod) + '</lastmod>' : '') + '</url>');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + rows.join('\n') + '\n</urlset>\n';
}

export function sitemapIndex(entries) {
  const rows = entries.map((e) => '  <sitemap><loc>' + esc(e.loc) + '</loc>' + (e.lastmod ? '<lastmod>' + esc(e.lastmod) + '</lastmod>' : '') + '</sitemap>');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + rows.join('\n') + '\n</sitemapindex>\n';
}

/** Whether a posting belongs in the sitemap: open, and not past its own deadline. */
export function listable(job, now) {
  return !!job && job.isActive !== false && !!job.id && !!job.title && !pastDeadline(job, now);
}

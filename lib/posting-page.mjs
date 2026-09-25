// 공고 한 건의 지면 (/p/{id}/).
//
// 두 주소가 같은 공고를 그립니다.
//   /p/{id}   앱의 「건네기」가 내보내는 링크(tailf-app job_detail.dart handOffUrl).
//             건넨 사람의 조건이나 신원은 없고, 받은 사람에게 건네받은 공고라고 말합니다.
//   /p/{id}/  검색에서 오는 정본 주소. 두 주소 모두 canonical 은 이쪽입니다.
//
// 내려간 공고는 정본 주소에서 410 으로 답해 검색 결과와 Google 채용 정보에서 빠지게
// 합니다. 건넨 링크는 카카오톡 미리보기가 읽을 수 있도록 200 에 noindex 로 둡니다.
//
// 공고 정보는 공개 API 하나에서 옵니다. 앱 상세와 같은 출처입니다.

import {
  API, SITE, esc, titleWithoutCompany, careerKo, employment, postedDay, deadlineDay,
  pastDeadline, dayKoFromIso, openDaysKo, rolesOf, techSlug, descriptionSections,
  buildJobPostingLd, breadcrumbLd, ldScript, pageShell, toResponse, alertBlock, webAlertNote,
  POSITIONING, POSITIONING_SUPPORT, pageSource, sourceStores, channelStrip,
} from './seo.mjs';
import { jobRoleFocuses } from './alerts/match.mjs';

const SHARE_STORES = { appstore: '/go/appstore/', play: '/go/play/' };

/** /alerts/ from a posting, with the posting's own role families picked in advance. */
export function alertsHrefFor(job, source) {
  const roles = job ? [...jobRoleFocuses(job)] : [];
  return '/alerts/from/' + (source || 'posting') + '/' + (roles.length ? '?role=' + roles.join(',') : '');
}

function whyBlock(job) {
  return `<section class="alert">
  <p class="eyebrow">이런 공고를 매일 찾지 않아도 되게</p>
  <h2>${esc(POSITIONING)}</h2>
  <p class="block-sub">${esc(POSITIONING_SUPPORT)} 로그인 없이 쓰고, 조건은 기본으로 폰 안에서 맞춰 봐요.</p>
  <p class="cta-row">
    <a class="btn" href="/#try">지난 30일 먼저 세어보기</a>
    <a class="btn install-pending" href="/go/appstore/" data-install="appstore">App Store</a>
    <a class="btn install-pending" href="/go/play/" data-install="play">Google Play</a>
  </p>
  <p class="cta-note">설치하기 전에 내 기술로 지난 30일에 몇 번 왔을지 브라우저에서 먼저 세어볼 수 있어요.</p>
  ${webAlertNote(alertsHrefFor(job))}
</section>
<p class="privacy">이 링크에는 공고 번호 하나뿐이에요. 건넨 사람의 기술과 조건과 이름은 들어 있지 않아요.</p>`;
}

// Whether this title was posted before, as the posting carries it
// (job-pipeline-008 `history`). Facts about the calendar, nothing about why;
// the same sentences the app draws (tailf-app T-302).
function dayKo(d, now) {
  const md = (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
  return d.getFullYear() === now.getFullYear() ? md : d.getFullYear() + '년 ' + md;
}
export function historyLines(h, postedAt, now) {
  if (!h || typeof h !== 'object') return [];
  const out = [];
  if (h.kind === 'REPOST') {
    const posted = postedAt ? new Date(postedAt) : null;
    if (posted && !isNaN(posted) && Number.isInteger(h.gapDays)) {
      const down = new Date(posted.getTime() - h.gapDays * 86400000);
      out.push('이 공고는 ' + dayKo(down, now) + '에 내려갔다가 ' + h.gapDays + '일 만에 다시 올라왔어요. 이번이 ' + h.ordinal + '번째예요.');
    } else {
      out.push('이 공고는 전에도 올라온 적이 있어요. 이번이 ' + h.ordinal + '번째예요.');
    }
  } else if (h.kind === 'RENEWED') {
    const first = h.firstSeenAt ? new Date(h.firstSeenAt) : null;
    out.push(first && !isNaN(first)
      ? '이 제목의 공고는 ' + dayKo(first, now) + '부터 ' + h.ordinal + '번 올라왔어요.'
      : '이 제목의 공고는 ' + h.ordinal + '번 올라왔어요.');
  }
  if (Number.isInteger(h.openTwins) && h.openTwins > 0) {
    out.push('같은 제목의 공고가 ' + h.openTwins + '건 더 열려 있어요.');
  }
  return out;
}

// This company's posting flow over the last month, as the posting carries it
// (job-pipeline-009 `companyPulse`). The same sentence the app draws (T-303).
export function pulseLine(p) {
  if (!p || typeof p !== 'object') return null;
  const w = Number.isInteger(p.windowDays) ? p.windowDays : 30;
  const a = p.opened30, b = p.opened30Prev, c = p.closed30;
  if (![a, b, c].every(Number.isInteger)) return null;
  if (a + b + c === 0) return '최근 ' + (w * 2) + '일 동안 이 회사의 새 개발 공고를 보지 못했어요.';
  return '이 회사는 최근 ' + w + '일에 개발 공고 ' + a + '건을 올렸고 ' + c + '건을 내렸어요. 그 전 ' + w + '일에는 ' + b + '건을 올렸어요.';
}

/** 「<회사> <직무> 채용」, the name search readers type. */
export function seoTitle(job) {
  const title = titleWithoutCompany(job.title, job.company);
  const company = String(job.company || '').trim();
  return (company ? company + ' ' : '') + title + ' 채용';
}

function seoDescription(job, now) {
  const bits = [careerKo(job)];
  const where = String(job.location || '').trim();
  if (where && where !== '미지정') bits.push(where.length > 30 ? where.slice(0, 30) + '…' : where);
  const emp = employment(job);
  if (emp) bits.push(emp.ko);
  const posted = postedDay(job);
  if (posted) bits.push(dayKoFromIso(posted, now) + ' 올라온 공고');
  const skills = Array.isArray(job.skills) ? job.skills.filter(Boolean).slice(0, 5) : [];
  if (skills.length) bits.push(skills.join(', '));
  return seoTitle(job) + '. ' + bits.join(' · ') + '. 자격 요건과 우대 사항, 원문 링크를 한 화면에서 봐요.';
}

function crumbs(job, companyId) {
  const parts = ['<a href="/">tailf</a>'];
  if (job.company) {
    parts.push(companyId ? '<a href="/c/' + esc(companyId) + '/">' + esc(job.company) + '</a>' : esc(job.company));
  }
  return '<nav class="crumbs" aria-label="위치">' + parts.join('<span class="sep">›</span>') + '</nav>';
}

function postingArticle(job, now, { share, companyId, expired }) {
  const title = titleWithoutCompany(job.title, job.company);
  const history = historyLines(job.history, job.postedAt, now);
  const pulse = pulseLine(job.companyPulse);
  const career = careerKo(job);
  const where = String(job.location || '').trim();
  const emp = employment(job);
  const company = job.company
    ? (companyId && !share ? '<a href="/c/' + esc(companyId) + '/">' + esc(job.company) + '</a>' : esc(job.company))
    : '';
  const meta = [company, esc(career), esc(where), emp ? esc(emp.ko) : ''].filter(Boolean).join(' · ');
  const closed = job.isActive === false;
  const open = closed ? null : openDaysKo(job.postedAt, now);
  const posted = postedDay(job);
  const deadline = deadlineDay(job, now);
  const dates = [];
  if (posted) dates.push('올라온 날 ' + dayKoFromIso(posted, now));
  if (deadline) dates.push('마감 ' + dayKoFromIso(deadline, now));
  else if (/상시/.test(String(job.deadline || ''))) dates.push('상시채용');
  const skills = Array.isArray(job.skills) ? job.skills.filter(Boolean).slice(0, 12) : [];
  const source = String(job.sourceUrl || '').trim();
  const sections = descriptionSections(job);
  const h1 = share ? esc(title) : esc(seoTitle(job));
  const status = closed
    ? '<p class="closed">이 공고는 내려갔어요</p>'
    : expired
      ? '<p class="closed">마감일이 지났어요</p>'
      : open ? '<p class="open">' + esc(open) + '</p>' : '';
  const body = sections.map((s) => '<h2>' + esc(s.head) + '</h2><p class="body">' + esc(s.text) + '</p>').join('\n  ');
  return `<article class="posting">
  <h1>${h1}</h1>
  <p class="meta">${meta}</p>
  ${dates.length ? '<p class="dates">' + esc(dates.join(' · ')) + '</p>' : ''}
  ${status}
  ${pulse ? '<p class="history">' + esc(pulse) + '</p>' : ''}
  ${history.map((line) => '<p class="history">' + esc(line) + '</p>').join('')}
  ${skills.length ? '<div class="chips">' + skills.map((s) => '<span class="chip">' + esc(s) + '</span>').join('') + '</div>' : ''}
  ${closed ? '' : body}
  <p class="cta-row">
    ${source && !closed ? '<a class="btn" href="' + esc(source) + '" rel="noopener noreferrer nofollow" target="_blank">회사 사이트에서 지원하기</a>' : closed ? '' : '<span class="cta-note">원문 링크가 없어요.</span>'}
  </p>
</article>`;
}

// Tech hubs exist only for skills common enough to fill a page; the build
// writes their slugs next to them so a posting never links to a hub that is not there.
async function techHubs(env) {
  try {
    if (!env || !env.ASSETS) return new Set();
    const res = await env.ASSETS.fetch('https://tailf.asyncsite.com/t/slugs.json');
    if (!res.ok) return new Set();
    const list = await res.json();
    return new Set(Array.isArray(list) ? list : []);
  } catch (e) {
    return new Set();
  }
}

function relatedLinks(job, companyId, hubs, source) {
  const links = [];
  if (companyId && job.company) links.push('<a href="/c/' + esc(companyId) + '/' + (source ? 'from/' + source + '/' : '') + '">' + esc(job.company) + ' 개발 공고 모두 보기</a>');
  for (const r of rolesOf(job)) links.push('<a href="/r/' + r.slug + '/">' + esc(r.ko) + ' 공고</a>');
  const skills = Array.isArray(job.skills) ? job.skills : [];
  const seen = new Set();
  for (const s of skills) {
    const slug = techSlug(s);
    if (!slug || seen.has(slug) || !(hubs && hubs.has(slug))) continue;
    seen.add(slug);
    links.push('<a href="/t/' + slug + '/" data-tech>' + esc(s) + ' 공고</a>');
    if (seen.size >= 4) break;
  }
  if (!links.length) return '';
  return '<nav class="more" aria-label="이어서 볼 공고"><p>이어서 볼 공고</p><p class="links">' + links.join('') + '</p></nav>';
}

function errorPage({ title, head, meta, canonical, status, share }) {
  return toResponse(pageShell({
    title,
    description: meta || head,
    canonical,
    robots: 'noindex, follow',
    status,
    stores: share ? SHARE_STORES : null,
    body: `<article class="posting"><h1>${esc(head)}</h1>${meta ? '<p class="meta">' + esc(meta) + '</p>' : ''}</article>${share ? whyBlock(null) : alertBlock(undefined, alertsHrefFor(null))}`,
  }));
}

async function companyIdFor(name) {
  if (!name) return null;
  try {
    const res = await fetch(API + '/companies/with-count', {
      headers: { Accept: 'application/json' },
      cf: { cacheTtl: 3600, cacheEverything: true },
    });
    if (!res.ok) return null;
    const list = await res.json();
    if (!Array.isArray(list)) return null;
    const hit = list.find((c) => c && c.name === name);
    return hit && Number.isInteger(hit.id) ? hit.id : null;
  } catch (e) {
    return null;
  }
}

export async function onRequest(context) {
  const { request, params } = context;
  const raw = Array.isArray(params.path) ? params.path : [params.path];
  const segs = raw.filter((s) => s != null && s !== '');
  const id = String(segs[0] || '').trim();
  const path = new URL(request.url).pathname;
  // /p/{id}/from/{source}/ is the search page reached from a channel post (seo.mjs PAGE_SOURCES).
  const source = pageSource(segs, 1);
  // The app hands out /p/{id} with no slash; search reads /p/{id}/.
  const share = !source && !path.endsWith('/');
  const now = new Date();
  const canonical = SITE + '/p/' + (/^\d{1,12}$/.test(id) ? id + '/' : '');

  if (source && !path.endsWith('/')) return Response.redirect(canonical + 'from/' + source + '/', 301);
  if (!/^\d{1,12}$/.test(id) || source === null) {
    return errorPage({ title: 'tailf · 공고를 찾을 수 없어요', head: '공고를 찾을 수 없어요.', meta: '이 링크의 공고 번호를 읽을 수 없어요.', canonical: SITE + '/p/', status: 404, share });
  }

  let res;
  try {
    res = await fetch(API + '/' + id, { headers: { Accept: 'application/json' }, cf: { cacheTtl: 300 } });
  } catch (e) {
    res = null;
  }
  if (res && res.status === 404) {
    // An id the board no longer has. Gone for good as far as search is concerned.
    return errorPage({ title: 'tailf · 이 공고는 찾을 수 없어요', head: '이 공고는 찾을 수 없어요.', meta: '내려갔거나 주소가 바뀌었을 수 있어요.', canonical, status: share ? 404 : 410, share });
  }
  let job = null;
  if (res && res.ok) {
    try {
      job = await res.json();
    } catch (e) {
      job = null;
    }
  }
  if (!job || typeof job !== 'object' || !job.title) {
    return errorPage({ title: 'tailf · 지금은 불러오지 못했어요', head: '지금은 불러오지 못했어요.', meta: '잠시 뒤 이 링크를 다시 열어 주세요.', canonical, status: 502, share });
  }

  const stores = source ? sourceStores(source) : null;
  const alertsHref = alertsHrefFor(job, source);
  const [companyId, hubs] = await Promise.all([companyIdFor(String(job.company || '').trim()), techHubs(context.env)]);
  const closed = job.isActive === false;
  const expired = !closed && pastDeadline(job, now);

  if (closed && !share) {
    // 410 tells Google this job is over; the body still helps the person who came.
    const body = `${crumbs(job, companyId)}
${postingArticle(job, now, { share: false, companyId, expired })}
${relatedLinks(job, companyId, hubs, source)}
${alertBlock('다음 공고는 올라온 날 알려드려요.', alertsHref, stores)}`;
    return toResponse(pageShell({
      title: seoTitle(job) + ' (마감) | tailf',
      description: '이 공고는 내려갔어요. ' + (job.company ? job.company + '의 다른 개발 공고를 볼 수 있어요.' : ''),
      canonical,
      robots: 'noindex, follow',
      status: 410,
      stores,
      body,
    }));
  }

  const ld = closed || expired ? null : buildJobPostingLd(job, now);
  const crumbItems = [{ name: 'tailf', url: SITE + '/' }];
  if (companyId && job.company) crumbItems.push({ name: job.company, url: SITE + '/c/' + companyId + '/' });
  crumbItems.push({ name: titleWithoutCompany(job.title, job.company), url: canonical });
  const head = ldScript(ld) + (share ? '' : ldScript(breadcrumbLd(crumbItems)));
  const robots = closed || expired ? 'noindex, follow' : 'index, follow, max-snippet:-1';

  if (share) {
    const title = titleWithoutCompany(job.title, job.company) + (job.company ? ' · ' + job.company : '');
    const open = closed ? '내려간 공고' : openDaysKo(job.postedAt, now);
    const description = [careerKo(job), String(job.location || '').trim(), open, 'tailf 를 쓰는 개발자가 건넨 공고'].filter(Boolean).join(' · ');
    return toResponse(pageShell({
      title,
      description,
      canonical,
      robots,
      ogType: 'article',
      head,
      stores: SHARE_STORES,
      body: `<p class="eyebrow">tailf 를 쓰는 개발자가 건넨 공고</p>
${postingArticle(job, now, { share: true, companyId, expired })}
${whyBlock(job)}`,
    }));
  }

  return toResponse(pageShell({
    title: seoTitle(job) + ' | tailf',
    description: seoDescription(job, now),
    canonical,
    robots,
    ogType: 'article',
    head,
    stores,
    body: `${crumbs(job, companyId)}
${channelStrip(source || 'seo', alertsHref)}
${postingArticle(job, now, { share: false, companyId, expired })}
${relatedLinks(job, companyId, hubs, source)}
${alertBlock(undefined, alertsHref, stores)}`,
  }));
}

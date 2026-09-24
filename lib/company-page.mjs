// 회사 한 곳의 열린 개발 공고 (/c/{companyId}/).
//
// 회사 번호는 공개 API 의 companies/with-count 가 주는 id 입니다. 목록은 앱과 같은
// 조건(jobFamily=ENGINEERING, 열린 공고만)으로 매번 새로 읽어서, 내려간 공고가 이
// 지면에 남지 않습니다. 열린 개발 공고가 없는 회사는 noindex 로 답합니다.

import {
  API, SITE, esc, jobRow, breadcrumbLd, ldScript, pageShell, toResponse, alertBlock, listable, kstDay, dayKoFromIso,
  pageSource, sourceStores, channelStrip,
} from './seo.mjs';
import { pulseLine } from './posting-page.mjs';

const MAX_PAGES = 3;

async function getJson(url, ttl) {
  const res = await fetch(url, { headers: { Accept: 'application/json' }, cf: { cacheTtl: ttl, cacheEverything: true } });
  if (!res.ok) {
    const err = new Error('upstream ' + res.status);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export async function companyJobs(id) {
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await getJson(API + '?companyIds=' + id + '&jobFamily=ENGINEERING&size=100&page=' + page + '&sortBy=postedAt&sortDirection=DESC', 300);
    const content = body && Array.isArray(body.content) ? body.content : [];
    rows.push(...content);
    if (body.last !== false || !content.length) break;
  }
  return rows;
}

async function companyName(id) {
  try {
    const list = await getJson(API + '/companies/with-count', 3600);
    const hit = Array.isArray(list) ? list.find((c) => c && c.id === id) : null;
    return hit ? String(hit.name || '').trim() : null;
  } catch (e) {
    return null;
  }
}

function notFound(canonical) {
  return toResponse(pageShell({
    title: 'tailf · 회사를 찾을 수 없어요',
    description: '이 주소의 회사를 찾을 수 없어요.',
    canonical,
    robots: 'noindex, follow',
    status: 404,
    body: `<article class="posting"><h1>회사를 찾을 수 없어요.</h1><p class="meta"><a href="/c/">개발 공고가 열린 회사 모두 보기</a></p></article>${alertBlock(undefined, '/alerts/from/company/')}`,
  }));
}

export async function onRequest(context) {
  const { params } = context;
  const raw = Array.isArray(params.path) ? params.path : [params.path];
  const segs = raw.filter((s) => s != null && s !== '');
  // /c/ itself is the static company index the build writes.
  if (!segs.length) return context.next();
  const id = String(segs[0]).trim();
  // /c/{id}/from/{source}/ is the same page reached from a channel post (seo.mjs PAGE_SOURCES).
  const source = pageSource(segs, 1);
  if (!/^\d{1,9}$/.test(id) || source === null) return notFound(SITE + '/c/');
  const canonical = SITE + '/c/' + id + '/';
  const url = new URL(context.request.url);
  if (!url.pathname.endsWith('/')) {
    return Response.redirect(canonical + (source ? 'from/' + source + '/' : ''), 301);
  }
  const alertsHref = source ? '/alerts/from/' + source + '/' : '/alerts/from/company/';
  const stores = source ? sourceStores(source) : null;
  const strip = source ? channelStrip(source, alertsHref) : '';
  const now = new Date();

  let rows;
  try {
    rows = await companyJobs(id);
  } catch (e) {
    return toResponse(pageShell({
      title: 'tailf · 지금은 불러오지 못했어요',
      description: '공고를 잠시 불러오지 못했어요.',
      canonical,
      robots: 'noindex, follow',
      status: 502,
      body: `<article class="posting"><h1>지금은 불러오지 못했어요.</h1><p class="meta">잠시 뒤 다시 열어 주세요.</p></article>`,
    }));
  }
  const open = rows.filter((j) => listable(j, now));
  const name = (open[0] && String(open[0].company || '').trim()) || (await companyName(+id));
  if (!name) return notFound(canonical);

  const pulse = pulseLine(rows[0] && rows[0].companyPulse);
  const crumbs = `<nav class="crumbs" aria-label="위치"><a href="/">tailf</a><span class="sep">›</span><a href="/c/">회사별 공고</a><span class="sep">›</span>${esc(name)}</nav>`;
  const head = ldScript(breadcrumbLd([
    { name: 'tailf', url: SITE + '/' },
    { name: '회사별 공고', url: SITE + '/c/' },
    { name, url: canonical },
  ]));

  if (!open.length) {
    return toResponse(pageShell({
      title: name + ' 개발자 채용 공고 | tailf',
      description: name + '에 지금 열린 개발 공고가 없어요. 새 공고가 올라오면 tailf 가 알려드려요.',
      canonical,
      robots: 'noindex, follow',
      head,
      stores,
      body: `${crumbs}
<header class="listhead"><h1>${esc(name)} 개발자 채용 공고</h1><p class="sub">지금 열린 개발 공고가 없어요.</p>${pulse ? '<p class="sub">' + esc(pulse) + '</p>' : ''}</header>
${alertBlock('다음 공고는 올라온 날 알려드려요.', alertsHref, stores)}`,
    }));
  }

  const latest = open.map((j) => String(j.postedAt || '').slice(0, 10)).sort().pop();
  const list = open.map((j) => jobRow(j, now, null, source)).join('\n');
  return toResponse(pageShell({
    title: name + ' 개발자 채용 공고 ' + open.length + '건 | tailf',
    description: name + '에 지금 열린 개발 공고 ' + open.length + '건. 직무, 경력, 근무지, 올라온 날을 한 목록에서 보고 원문으로 지원해요.',
    canonical,
    robots: 'index, follow',
    head,
    stores,
    body: `${crumbs}
<header class="listhead">
  <h1>${esc(name)} 개발자 채용 공고</h1>
  <p class="sub">지금 열린 개발 공고 ${open.length}건이에요. 최근에 올라온 순서예요.${latest ? ' 가장 최근 공고는 ' + esc(dayKoFromIso(latest, now)) + '에 올라왔어요.' : ''}</p>
  ${pulse ? '<p class="sub">' + esc(pulse) + '</p>' : ''}
</header>
${strip}
<ul class="jobs">
${list}
</ul>
${alertBlock(undefined, alertsHref, stores)}
<p class="privacy">${esc(kstDay(now))} 기준으로 tailf 가 본 공개 공고예요. 지원은 각 공고의 회사 사이트에서 해요.</p>`,
  }));
}

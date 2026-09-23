#!/usr/bin/env node
// Writes the pages and sitemaps that change with the board, right before a
// deploy (.github/workflows/pages-deployment.yaml runs this on every push and every three
// hours). Nothing written here is committed; see .gitignore.
//
//   c/index.html              companies with open developer postings
//   r/index.html, r/{role}/   role hubs (백엔드, 프론트엔드, ...)
//   t/index.html, t/{tech}/   tech hubs (Kotlin, React, ...)
//   sitemap.xml               sitemap index
//   sitemap-jobs.xml          every open developer posting, /p/{id}/
//   sitemap-companies.xml     /c/{companyId}/
//   sitemap-hubs.xml          /c/, /r/..., /t/...
//
// The posting and company pages themselves are Pages Functions and read the
// board live, so a posting that closes stops being a job to Google on the next
// crawl (410) even before the next sitemap.
//
// With INDEXNOW_OUT set, the URLs added or dropped since the live sitemaps are
// written there as JSON for the IndexNow step.

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  API, SITE, esc, ROLES, rolesOf, techSlug, jobRow, listable, postedDay, kstDay,
  dayKoFromIso, pageShell, alertBlock, breadcrumbLd, ldScript, urlset, sitemapIndex,
} from '../lib/seo.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE_SIZE = 100;
const MAX_PAGES = 30;
const TECH_MIN = 20;
const UA = 'tailf-web-build/1.0 (+https://tailf.asyncsite.com/)';

async function getJson(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA } });
      if (!res.ok) throw new Error(url + ' -> ' + res.status);
      return await res.json();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw last;
}

/** Every open developer posting, the same list the app reads (jobFamily=ENGINEERING). */
export async function fetchBoard() {
  const first = await getJson(API + '?jobFamily=ENGINEERING&size=' + PAGE_SIZE + '&page=0&sortBy=postedAt&sortDirection=DESC');
  const total = first.totalElements;
  const pages = first.totalPages;
  if (!Number.isInteger(pages) || pages > MAX_PAGES) throw new Error('unexpected totalPages ' + pages);
  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, (_, i) => getJson(API + '?jobFamily=ENGINEERING&size=' + PAGE_SIZE + '&page=' + (i + 1) + '&sortBy=postedAt&sortDirection=DESC')),
  );
  const byId = new Map();
  for (const body of [first, ...rest]) {
    for (const j of body.content || []) if (j && j.id != null) byId.set(j.id, j);
  }
  // Paging by date while the board moves can shift a row across a page edge.
  // A small gap is that; a large one is a half-read list, which must not ship
  // as a sitemap that silently drops postings.
  if (byId.size < Math.max(50, total * 0.97)) throw new Error('read ' + byId.size + ' of ' + total);
  const companies = await getJson(API + '/companies/with-count');
  if (!Array.isArray(companies) || !companies.length) throw new Error('no companies');
  return { jobs: [...byId.values()], companies };
}

function sortByDate(jobs) {
  return jobs.slice().sort((a, b) => String(b.postedAt || '').localeCompare(String(a.postedAt || '')) || b.id - a.id);
}

function maxDay(jobs) {
  return jobs.map(postedDay).filter(Boolean).sort().pop() || null;
}

function hubPage({ path, title, h1, sub, description, crumbs, jobs, now, companyIds, extra }) {
  const canonical = SITE + path;
  const list = sortByDate(jobs).map((j) => jobRow(j, now, companyIds.get(j.company))).join('\n');
  const crumbHtml = crumbs.map((c, i) => (i < crumbs.length - 1 ? '<a href="' + esc(c.url.replace(SITE, '')) + '">' + esc(c.name) + '</a>' : esc(c.name))).join('<span class="sep">›</span>');
  return pageShell({
    title,
    description,
    canonical,
    robots: 'index, follow',
    head: ldScript(breadcrumbLd(crumbs)),
    body: `<nav class="crumbs" aria-label="위치">${crumbHtml}</nav>
<header class="listhead">
  <h1>${esc(h1)}</h1>
  <p class="sub">${esc(sub)}</p>
</header>
${extra || ''}
${list ? '<ul class="jobs">\n' + list + '\n</ul>' : ''}
${alertBlock(undefined, '/alerts/from/hub/')}
<p class="privacy">${esc(kstDay(now))} 기준으로 tailf 가 본 공개 공고예요. 지원은 각 공고의 회사 사이트에서 해요.</p>`,
  }).html;
}

function indexPage({ path, title, h1, sub, description, crumbs, items, now }) {
  const canonical = SITE + path;
  const crumbHtml = crumbs.map((c, i) => (i < crumbs.length - 1 ? '<a href="' + esc(c.url.replace(SITE, '')) + '">' + esc(c.name) + '</a>' : esc(c.name))).join('<span class="sep">›</span>');
  const rows = items.map((it) => `<li><a class="t" href="${esc(it.href)}">${esc(it.name)}</a><p class="m">열린 개발 공고 ${it.count}건${it.latest ? ' · 최근 ' + esc(dayKoFromIso(it.latest, now)) + ' 올라옴' : ''}</p></li>`).join('\n');
  return pageShell({
    title,
    description,
    canonical,
    robots: 'index, follow',
    head: ldScript(breadcrumbLd(crumbs)),
    body: `<nav class="crumbs" aria-label="위치">${crumbHtml}</nav>
<header class="listhead">
  <h1>${esc(h1)}</h1>
  <p class="sub">${esc(sub)}</p>
</header>
<ul class="jobs">
${rows}
</ul>
${alertBlock(undefined, '/alerts/from/hub/')}
<p class="privacy">${esc(kstDay(now))} 기준으로 tailf 가 본 공개 공고예요.</p>`,
  }).html;
}

/** Everything the build writes, as { path: content }, from a board snapshot. */
export function buildSite({ jobs, companies }, now) {
  const files = {};
  const open = jobs.filter((j) => listable(j, now));
  const today = kstDay(now);
  const todayKo = dayKoFromIso(today, now);
  const companyIds = new Map();
  for (const c of companies) if (c && c.name && Number.isInteger(c.id)) companyIds.set(String(c.name).trim(), c.id);

  // Companies.
  const byCompany = new Map();
  for (const j of open) {
    const name = String(j.company || '').trim();
    if (!name || !companyIds.has(name)) continue;
    if (!byCompany.has(name)) byCompany.set(name, []);
    byCompany.get(name).push(j);
  }
  const companyItems = [...byCompany.entries()]
    .map(([name, list]) => ({ name, href: '/c/' + companyIds.get(name) + '/', id: companyIds.get(name), count: list.length, latest: maxDay(list) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko'));

  const home = { name: 'tailf', url: SITE + '/' };
  files['c/index.html'] = indexPage({
    path: '/c/',
    title: '개발 공고가 열린 회사 ' + companyItems.length + '곳 | tailf',
    h1: '개발 공고가 열린 회사',
    sub: todayKo + ' 기준으로 개발 공고가 열려 있는 회사 ' + companyItems.length + '곳이에요. 열린 공고가 많은 순서예요.',
    description: '지금 개발 공고가 열려 있는 회사 ' + companyItems.length + '곳과 회사별 공고 수. 회사를 누르면 열린 개발 공고를 한 목록에서 봐요.',
    crumbs: [home, { name: '회사별 공고', url: SITE + '/c/' }],
    items: companyItems,
    now,
  });

  // Roles.
  const roleItems = [];
  for (const role of ROLES) {
    const list = open.filter((j) => rolesOf(j).some((r) => r.slug === role.slug));
    if (!list.length) continue;
    const path = '/r/' + role.slug + '/';
    roleItems.push({ name: role.ko, href: path, count: list.length, latest: maxDay(list), slug: role.slug });
    files['r/' + role.slug + '/index.html'] = hubPage({
      path,
      title: role.ko + ' 개발자 채용 공고 ' + list.length + '건 | tailf',
      h1: role.ko + ' 개발자 채용 공고',
      sub: todayKo + ' 기준으로 열린 ' + role.ko + ' 공고 ' + list.length + '건이에요. 최근에 올라온 순서예요.',
      description: '지금 열린 ' + role.ko + ' 개발자 채용 공고 ' + list.length + '건. 회사, 경력, 근무지, 올라온 날을 한 목록에서 보고 원문으로 지원해요.',
      crumbs: [home, { name: '직무별 공고', url: SITE + '/r/' }, { name: role.ko, url: SITE + path }],
      jobs: list,
      now,
      companyIds,
    });
  }
  files['r/index.html'] = indexPage({
    path: '/r/',
    title: '직무별 개발자 채용 공고 | tailf',
    h1: '직무별 개발자 채용 공고',
    sub: todayKo + ' 기준으로 열린 개발 공고를 직무로 나눴어요. 한 공고가 두 직무에 들어갈 수 있어요.',
    description: '백엔드, 프론트엔드, 모바일, 데이터, AI·ML, 인프라, 보안, QA, 임베디드 개발자 채용 공고를 직무별로 봐요.',
    crumbs: [home, { name: '직무별 공고', url: SITE + '/r/' }],
    items: roleItems,
    now,
  });

  // Techs.
  const bySlug = new Map();
  for (const j of open) {
    const seen = new Set();
    for (const s of Array.isArray(j.skills) ? j.skills : []) {
      const slug = techSlug(s);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      if (!bySlug.has(slug)) bySlug.set(slug, { names: new Map(), jobs: [] });
      const t = bySlug.get(slug);
      t.jobs.push(j);
      const label = String(s).trim();
      t.names.set(label, (t.names.get(label) || 0) + 1);
    }
  }
  const techItems = [];
  for (const [slug, t] of bySlug) {
    if (t.jobs.length < TECH_MIN) continue;
    // The spelling most postings use (Mysql vs MySQL).
    const name = [...t.names.entries()].sort((a, b) => b[1] - a[1] || (b[0] !== b[0].toLowerCase()) - (a[0] !== a[0].toLowerCase()))[0][0];
    const path = '/t/' + slug + '/';
    techItems.push({ name, href: path, count: t.jobs.length, latest: maxDay(t.jobs), slug });
    files['t/' + slug + '/index.html'] = hubPage({
      path,
      title: name + ' 개발자 채용 공고 ' + t.jobs.length + '건 | tailf',
      h1: name + ' 개발자 채용 공고',
      sub: '기술 ' + name + ' · ' + todayKo + ' 기준으로 열린 공고 ' + t.jobs.length + '건이에요. 최근에 올라온 순서예요.',
      description: name + ' 개발자 채용 공고 ' + t.jobs.length + '건. 회사, 경력, 근무지, 올라온 날을 한 목록에서 보고 원문으로 지원해요.',
      crumbs: [home, { name: '기술별 공고', url: SITE + '/t/' }, { name, url: SITE + path }],
      jobs: t.jobs,
      now,
      companyIds,
    });
  }
  techItems.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  files['t/slugs.json'] = JSON.stringify(techItems.map((t) => t.slug).sort());
  files['t/index.html'] = indexPage({
    path: '/t/',
    title: '기술별 개발자 채용 공고 | tailf',
    h1: '기술별 개발자 채용 공고',
    sub: todayKo + ' 기준으로 열린 공고에 ' + TECH_MIN + '번 이상 나온 기술이에요. 공고가 많은 순서예요.',
    description: 'Python, Java, Kotlin, React 같은 기술별로 지금 열린 개발자 채용 공고를 봐요.',
    crumbs: [home, { name: '기술별 공고', url: SITE + '/t/' }],
    items: techItems,
    now,
  });

  // Sitemaps.
  const jobEntries = sortByDate(open).map((j) => ({ loc: SITE + '/p/' + j.id + '/', lastmod: postedDay(j) }));
  const companyEntries = companyItems.map((c) => ({ loc: SITE + c.href, lastmod: c.latest }));
  const hubEntries = [
    { loc: SITE + '/c/', lastmod: maxDay(open) },
    { loc: SITE + '/r/', lastmod: maxDay(open) },
    ...roleItems.map((r) => ({ loc: SITE + r.href, lastmod: r.latest })),
    { loc: SITE + '/t/', lastmod: maxDay(open) },
    ...techItems.map((t) => ({ loc: SITE + t.href, lastmod: t.latest })),
  ];
  files['sitemap-jobs.xml'] = urlset(jobEntries);
  files['sitemap-companies.xml'] = urlset(companyEntries);
  files['sitemap-hubs.xml'] = urlset(hubEntries);
  files['sitemap.xml'] = sitemapIndex([
    { loc: SITE + '/sitemap-pages.xml' },
    { loc: SITE + '/sitemap-jobs.xml', lastmod: maxDay(open) },
    { loc: SITE + '/sitemap-companies.xml', lastmod: maxDay(open) },
    { loc: SITE + '/sitemap-hubs.xml', lastmod: maxDay(open) },
  ]);

  const urls = [...jobEntries, ...companyEntries, ...hubEntries].map((e) => e.loc);
  return { files, urls, counts: { jobs: jobEntries.length, companies: companyEntries.length, roles: roleItems.length, techs: techItems.length, board: jobs.length } };
}

export function locsOf(xml) {
  return [...String(xml || '').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
}

async function liveUrls() {
  const out = new Set();
  for (const name of ['sitemap-jobs.xml', 'sitemap-companies.xml', 'sitemap-hubs.xml']) {
    try {
      const res = await fetch(SITE + '/' + name, { headers: { 'User-Agent': UA } });
      if (!res.ok) continue;
      const text = await res.text();
      if (!text.includes('<urlset')) continue;
      for (const u of locsOf(text)) out.add(u);
    } catch (e) {
      // First build, or the site is down: everything counts as new.
    }
  }
  return out;
}

async function main() {
  const now = new Date();
  const board = await fetchBoard();
  const { files, urls, counts } = buildSite(board, now);
  for (const dir of ['r', 't']) await rm(join(ROOT, dir), { recursive: true, force: true });
  await rm(join(ROOT, 'c', 'index.html'), { force: true });
  for (const [rel, content] of Object.entries(files)) {
    const path = join(ROOT, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  console.log('built', JSON.stringify(counts), Object.keys(files).length + ' files');

  if (process.env.INDEXNOW_OUT) {
    const before = await liveUrls();
    const now_ = new Set(urls);
    const added = urls.filter((u) => !before.has(u));
    const dropped = [...before].filter((u) => !now_.has(u));
    const changed = [...added, ...dropped].slice(0, 10000);
    await writeFile(process.env.INDEXNOW_OUT, JSON.stringify(changed));
    console.log('indexnow', JSON.stringify({ added: added.length, dropped: dropped.length }));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error('build-seo failed:', e && e.message ? e.message : e);
    process.exit(1);
  });
}

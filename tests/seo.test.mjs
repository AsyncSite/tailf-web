import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildJobPostingLd, ldScript, parseLocation, deadlineDay, pastDeadline, techSlug, rolesOf, listable,
} from '../lib/seo.mjs';
import { onRequest as postingPage } from '../lib/posting-page.mjs';
import { onRequest as companyPage } from '../lib/company-page.mjs';
import { buildSite, locsOf } from '../scripts/build-seo.mjs';

const NOW = new Date('2026-09-24T03:00:00Z'); // 12:00 KST

const JOB = {
  id: 3283,
  company: '카카오뱅크',
  title: '[카카오뱅크] 계정계 백엔드 개발자',
  description: '코어뱅킹 시스템을 개발합니다.\n<script>alert(1)</script>',
  requirements: 'Java 경력 3년 이상',
  preferred: '금융권 경험',
  skills: ['Java', 'Kotlin', 'Git'],
  experience: '3년 이상',
  experienceCategory: 'MID',
  location: '카카오뱅크 판교오피스 (경기도 성남시 분당구 분당내곡로 131)',
  deadline: '~2026.10.08',
  sourceUrl: 'https://recruit.kakaobank.com/jobs/267596',
  postedAt: '2026-09-23',
  jobType: 'CONTRACT',
  isActive: true,
};

// ---------- JSON-LD builder ----------

test('JobPosting carries every field Google requires and the ones we can state', () => {
  const ld = buildJobPostingLd(JOB, NOW);
  assert.equal(ld['@context'], 'https://schema.org/');
  assert.equal(ld['@type'], 'JobPosting');
  assert.equal(ld.title, '계정계 백엔드 개발자');
  assert.equal(ld.datePosted, '2026-09-23');
  assert.equal(ld.validThrough, '2026-10-08T23:59:59+09:00');
  assert.deepEqual(ld.hiringOrganization, { '@type': 'Organization', name: '카카오뱅크' });
  assert.equal(ld.employmentType, 'TEMPORARY');
  assert.equal(ld.directApply, false);
  assert.deepEqual(ld.identifier, { '@type': 'PropertyValue', name: 'tailf', value: '3283' });
  assert.equal(ld.jobLocation['@type'], 'Place');
  assert.equal(ld.jobLocation.address.addressCountry, 'KR');
  assert.equal(ld.jobLocation.address.addressRegion, '경기도');
  assert.equal(ld.jobLocation.address.addressLocality, '성남시');
  assert.match(ld.jobLocation.address.streetAddress, /분당내곡로 131/);
  assert.equal(ld.experienceRequirements.monthsOfExperience, 36);
  assert.equal(ld.url, 'https://tailf.asyncsite.com/p/3283/');
  // Description is the full text: all three sections, escaped.
  assert.match(ld.description, /코어뱅킹/);
  assert.match(ld.description, /Java 경력 3년 이상/);
  assert.match(ld.description, /금융권 경험/);
  assert.doesNotMatch(ld.description, /<script>/);
});

test('the JSON-LD script parses back and cannot close its own tag', () => {
  const html = ldScript(buildJobPostingLd({ ...JOB, title: 'a</script><b>' }, NOW));
  assert.equal(html.match(/<\/script>/g).length, 1);
  const json = html.replace(/^<script type="application\/ld\+json">/, '').replace(/<\/script>$/, '');
  const back = JSON.parse(json);
  assert.equal(back.title, 'a</script><b>');
});

test('no JobPosting for a closed, expired or unplaceable posting', () => {
  assert.equal(buildJobPostingLd({ ...JOB, isActive: false }, NOW), null);
  assert.equal(buildJobPostingLd({ ...JOB, deadline: '~2026.09.20' }, NOW), null);
  assert.equal(buildJobPostingLd({ ...JOB, location: '미지정' }, NOW), null);
  assert.equal(buildJobPostingLd({ ...JOB, location: 'Remote' }, NOW), null);
  assert.equal(buildJobPostingLd({ ...JOB, postedAt: null }, NOW), null);
});

test('remote in Korea is TELECOMMUTE with an applicant country', () => {
  const ld = buildJobPostingLd({ ...JOB, location: '서울 (재택 가능)' }, NOW);
  assert.equal(ld.jobLocationType, 'TELECOMMUTE');
  assert.deepEqual(ld.applicantLocationRequirements, { '@type': 'Country', name: 'KR' });
  assert.equal(ld.jobLocation.address.addressRegion, '서울특별시');
});

test('open-ended and placeholder deadlines give no validThrough', () => {
  assert.equal(deadlineDay({ deadline: '상시채용' }, NOW), null);
  assert.equal(deadlineDay({ deadline: '~2999.12.31' }, NOW), null);
  assert.equal(buildJobPostingLd({ ...JOB, deadline: '상시채용' }, NOW).validThrough, undefined);
  assert.equal(pastDeadline({ deadline: '~2026.09.24' }, NOW), false); // today still counts
  assert.equal(pastDeadline({ deadline: '~2026.09.23' }, NOW), true);
});

test('locations: English, foreign and unknown', () => {
  assert.equal(parseLocation('Seoul, South Korea').region, '서울특별시');
  assert.equal(parseLocation('Pangyo (Software Dream Center), South Korea').locality, '성남시');
  assert.equal(parseLocation('Taipei, Taiwan').country, 'TW');
  assert.equal(parseLocation('Seattle, Washington, United States').locality, 'Seattle');
  assert.equal(parseLocation('미지정'), null);
  assert.equal(parseLocation(''), null);
});

test('employment types map to the schema.org names', () => {
  assert.equal(buildJobPostingLd({ ...JOB, jobType: 'FULLTIME' }, NOW).employmentType, 'FULL_TIME');
  assert.equal(buildJobPostingLd({ ...JOB, jobType: 'INTERN' }, NOW).employmentType, 'INTERN');
  assert.equal(buildJobPostingLd({ ...JOB, jobType: null }, NOW).employmentType, undefined);
});

test('tech slugs and roles', () => {
  assert.equal(techSlug('C++'), 'cpp');
  assert.equal(techSlug('Node.js'), 'nodejs');
  assert.equal(techSlug('Spring Boot'), 'spring-boot');
  assert.equal(techSlug('Git'), null);
  assert.deepEqual(rolesOf({ title: 'Backend Engineer (환전·자금이체)' }).map((r) => r.slug), ['backend']);
  assert.ok(rolesOf({ title: '[네이버웹툰] 글로벌 서비스 iOS 개발' }).some((r) => r.slug === 'mobile'));
});

// ---------- posting page: 410 and indexing ----------

async function renderPosting(path, upstream) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/companies/with-count')) return Response.json([{ id: 7, name: '카카오뱅크', jobCount: 1 }]);
    return typeof upstream === 'function' ? upstream() : upstream;
  };
  try {
    const id = path.split('/')[2];
    return await postingPage({
      request: new Request('https://tailf.asyncsite.com' + path),
      params: { path: path.endsWith('/') ? [id, ''] : [id] },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('search page of an open posting is indexable with JobPosting and the seo CTA', async () => {
  const res = await renderPosting('/p/3283/', () => Response.json(JOB));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('X-Robots-Tag'), null);
  const html = await res.text();
  assert.match(html, /<title>카카오뱅크 계정계 백엔드 개발자 채용 \| tailf<\/title>/);
  assert.match(html, /<meta name="robots" content="index, follow/);
  assert.match(html, /<link rel="canonical" href="https:\/\/tailf.asyncsite.com\/p\/3283\/">/);
  assert.match(html, /"@type":"JobPosting"/);
  assert.match(html, /href="\/go\/appstore\/seo\/"/);
  assert.match(html, /href="\/c\/7\/"/);
  assert.match(html, /href="\/r\/backend\/"/);
  assert.doesNotMatch(html, /<script>alert/);
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  assert.deepEqual(blocks.map((b) => b['@type']).sort(), ['BreadcrumbList', 'JobPosting']);
});

test('search page of a closed posting answers 410, noindex, no JobPosting', async () => {
  const res = await renderPosting('/p/3283/', () => Response.json({ ...JOB, isActive: false }));
  assert.equal(res.status, 410);
  assert.match(res.headers.get('X-Robots-Tag'), /noindex/);
  const html = await res.text();
  assert.doesNotMatch(html, /JobPosting/);
  assert.match(html, /이 공고는 내려갔어요/);
  assert.match(html, /href="\/c\/7\/"/);
});

test('search page of an id the board no longer has answers 410', async () => {
  const res = await renderPosting('/p/3283/', () => new Response('', { status: 404 }));
  assert.equal(res.status, 410);
});

test('a posting past its own deadline stays readable but leaves the index', async () => {
  const res = await renderPosting('/p/3283/', () => Response.json({ ...JOB, deadline: '~2026.09.01' }));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('X-Robots-Tag'), /noindex/);
  const html = await res.text();
  assert.doesNotMatch(html, /JobPosting/);
  assert.match(html, /마감일이 지났어요/);
});

test('the shared link of a closed posting keeps 200 for link previews, noindex', async () => {
  const res = await renderPosting('/p/3283', () => Response.json({ ...JOB, isActive: false }));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('X-Robots-Tag'), /noindex/);
  const html = await res.text();
  assert.match(html, /건넨 공고/);
  assert.match(html, /canonical" href="https:\/\/tailf.asyncsite.com\/p\/3283\/"/);
});

test('extra path segments are not a posting', async () => {
  const res = await postingPage({
    request: new Request('https://tailf.asyncsite.com/p/3283/x/'),
    params: { path: ['3283', 'x', ''] },
  });
  assert.equal(res.status, 404);
});

// ---------- company page ----------

async function renderCompany(path, rows) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/companies/with-count')) return Response.json([{ id: 7, name: '카카오뱅크', jobCount: rows.length }]);
    return Response.json({ content: rows, last: true, totalElements: rows.length });
  };
  try {
    const segs = path.split('/').filter(Boolean).slice(1);
    return await companyPage({
      request: new Request('https://tailf.asyncsite.com' + path),
      params: { path: segs },
      next: async () => new Response('static', { status: 200 }),
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('company page lists open postings and drops closed ones', async () => {
  const res = await renderCompany('/c/7/', [JOB, { ...JOB, id: 1, isActive: false, title: 'Closed Role' }]);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /카카오뱅크 개발자 채용 공고 1건/);
  assert.match(html, /href="\/p\/3283\/"/);
  assert.doesNotMatch(html, /Closed Role/);
  assert.match(html, /index, follow/);
});

test('company page with nothing open is noindex; unknown company is 404', async () => {
  const empty = await renderCompany('/c/7/', []);
  assert.equal(empty.status, 200);
  assert.match(empty.headers.get('X-Robots-Tag'), /noindex/);
  const unknown = await renderCompany('/c/99/', []);
  assert.equal(unknown.status, 404);
});

test('/c/ falls through to the static index and /c/7 gets its slash', async () => {
  const idx = await renderCompany('/c/', []);
  assert.equal(await idx.text(), 'static');
  const noSlash = await renderCompany('/c/7', [JOB]);
  assert.equal(noSlash.status, 301);
  assert.equal(noSlash.headers.get('Location'), 'https://tailf.asyncsite.com/c/7/');
});

// ---------- build ----------

test('sitemaps list open postings only, with lastmod', () => {
  const jobs = [
    JOB,
    { ...JOB, id: 2, isActive: false },
    { ...JOB, id: 3, deadline: '~2026.09.01' },
    { ...JOB, id: 4, title: 'Frontend Engineer', skills: ['React'] },
  ];
  const { files, counts } = buildSite({ jobs, companies: [{ id: 7, name: '카카오뱅크' }] }, NOW);
  const locs = locsOf(files['sitemap-jobs.xml']);
  assert.deepEqual(locs.sort(), ['https://tailf.asyncsite.com/p/3283/', 'https://tailf.asyncsite.com/p/4/'].sort());
  assert.match(files['sitemap-jobs.xml'], /<lastmod>2026-09-23<\/lastmod>/);
  assert.deepEqual(locsOf(files['sitemap-companies.xml']), ['https://tailf.asyncsite.com/c/7/']);
  assert.ok(locsOf(files['sitemap-hubs.xml']).includes('https://tailf.asyncsite.com/r/backend/'));
  assert.ok(locsOf(files['sitemap.xml']).includes('https://tailf.asyncsite.com/sitemap-jobs.xml'));
  assert.equal(counts.jobs, 2);
  assert.ok(files['r/backend/index.html'].includes('href="/p/3283/"'));
  assert.ok(!files['r/backend/index.html'].includes('href="/p/2/"'));
  assert.equal(listable({ ...JOB, isActive: false }, NOW), false);
});

test('a posting links only to tech hubs the build wrote', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => (String(url).endsWith('/companies/with-count') ? Response.json([]) : Response.json(JOB));
  try {
    const res = await postingPage({
      request: new Request('https://tailf.asyncsite.com/p/3283/'),
      params: { path: ['3283', ''] },
      env: { ASSETS: { fetch: async () => Response.json(['java']) } },
    });
    const html = await res.text();
    assert.match(html, /href="\/t\/java\/"/);
    assert.doesNotMatch(html, /href="\/t\/kotlin\/"/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------- the way to web alerts ----------

test('posting and company pages lead to /alerts/ under their own source path', async () => {
  const posting = await (await renderPosting('/p/3283/', () => Response.json(JOB))).text();
  assert.match(posting, /href="\/alerts\/from\/posting\/\?role=backend"[^>]*>앱 없이 이메일·슬랙으로 받기</);
  const shared = await (await renderPosting('/p/3283', () => Response.json(JOB))).text();
  assert.match(shared, /href="\/alerts\/from\/posting\/\?role=backend"/);
  const company = await (await renderCompany('/c/7/', [JOB])).text();
  assert.match(company, /href="\/alerts\/from\/company\/"/);
  assert.match(company, /static\.cloudflareinsights\.com\/beacon\.min\.js/);
});

// ---------- channel posts link to the page they talk about ----------

test('a company page reached from a channel keeps its canonical and routes every door through the channel', async () => {
  const res = await renderCompany('/c/7/from/threads/', [JOB]);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<link rel="canonical" href="https:\/\/tailf.asyncsite.com\/c\/7\/">/);
  assert.match(html, /class="cta-row channel-strip"/);
  assert.match(html, /href="\/go\/appstore\/threads\/"/);
  assert.match(html, /href="\/go\/play\/threads\/"/);
  assert.match(html, /href="\/alerts\/from\/threads\/"/);
  assert.match(html, /href="\/p\/3283\/from\/threads\/"/);
  assert.doesNotMatch(html, /\/go\/appstore\/seo\//);
  // the strip sits above the list so a phone sees it without scrolling past every row
  assert.ok(html.indexOf('channel-strip') < html.indexOf('<ul class="jobs">'));
});

test('a posting page reached from a channel routes its doors through the channel', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => (String(url).endsWith('/companies/with-count') ? Response.json([{ id: 7, name: '카카오뱅크', jobCount: 1 }]) : Response.json(JOB));
  try {
    const res = await postingPage({
      request: new Request('https://tailf.asyncsite.com/p/3283/from/youtube/'),
      params: { path: ['3283', 'from', 'youtube', ''] },
    });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<link rel="canonical" href="https:\/\/tailf.asyncsite.com\/p\/3283\/">/);
    assert.match(html, /"@type":"JobPosting"/);
    assert.match(html, /href="\/go\/appstore\/youtube\/"/);
    assert.match(html, /href="\/alerts\/from\/youtube\/\?role=backend"/);
    assert.match(html, /href="\/c\/7\/from\/youtube\/"/);
    assert.doesNotMatch(html, /건넨 공고/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('an unknown channel word is not a page, and a missing slash keeps the channel', async () => {
  const bad = await renderCompany('/c/7/from/somewhere/', [JOB]);
  assert.equal(bad.status, 404);
  const noSlash = await companyPage({
    request: new Request('https://tailf.asyncsite.com/c/7/from/threads'),
    params: { path: ['7', 'from', 'threads'] },
    next: async () => new Response('static'),
  });
  assert.equal(noSlash.status, 301);
  assert.equal(noSlash.headers.get('Location'), 'https://tailf.asyncsite.com/c/7/from/threads/');
  const badPosting = await postingPage({
    request: new Request('https://tailf.asyncsite.com/p/3283/from/somewhere/'),
    params: { path: ['3283', 'from', 'somewhere', ''] },
  });
  assert.equal(badPosting.status, 404);
});

test('canonical company and posting pages carry the top alert band on seo doors', async () => {
  const company = await (await renderCompany('/c/7/', [JOB])).text();
  assert.match(company, /<p class="cta-row channel-strip">\s*<a class="btn" href="\/go\/appstore\/seo\/"[^>]*>새 공고 알림 받기<\/a>\s*<a class="web-alerts" href="\/alerts\/from\/company\/">앱 없이 이메일·슬랙으로 받기<\/a>/);
  assert.ok(company.indexOf('channel-strip">') < company.indexOf('<ul class="jobs">'));
  assert.match(company, /<link rel="canonical" href="https:\/\/tailf.asyncsite.com\/c\/7\/">/);
  const posting = await (await renderPosting('/p/3283/', () => Response.json(JOB))).text();
  assert.match(posting, /channel-strip">\s*<a class="btn" href="\/go\/appstore\/seo\/"/);
  assert.match(posting, /<a class="web-alerts" href="\/alerts\/from\/posting\/\?role=backend">/);
  assert.ok(posting.indexOf('channel-strip">') < posting.indexOf('<article class="posting">'));
  // the app's hand-off link keeps its own layout
  const shared = await (await renderPosting('/p/3283', () => Response.json(JOB))).text();
  assert.doesNotMatch(shared, /channel-strip">/);
});

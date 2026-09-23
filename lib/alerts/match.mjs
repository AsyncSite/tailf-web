// Which new postings go to one web alert subscription.
//
// The words and bands are the app's (tailf-app lib/src/match/matcher.dart),
// so a posting means the same thing on the phone and in an email:
//   - role family: RoleFocus and jobRoleFocuses, title first, tags only when
//     the title names no role (matching review 2026-09-24).
//   - experience band: CareerBand and jobCareerBands, the upstream category
//     plus the posting's own stated floor. A posting that states nothing
//     passes every band, as in the app.
//   - workplace: jobPlaceArea and jobIsRemote. An unknown place passes.
//   - SI and dispatch postings and excluded companies are out, as in the app
//     with its default excludeSiKeywords = true.
//
// One difference is deliberate. The app lets an unclassified title through
// its role gate and then asks for two overlapping stacks. A web subscriber
// names a role family and skills are optional, so here the posting must
// positively name one of the chosen roles (the app's `namesChosenRole`).
// Skills never drop a posting; they only rank it.

import { pastDeadline } from '../seo.mjs';

export const ROLE_FOCUS = [
  { key: 'backend', ko: '백엔드' },
  { key: 'frontend', ko: '프론트엔드' },
  { key: 'fullstack', ko: '풀스택' },
  { key: 'mobile', ko: '모바일' },
  { key: 'dataAi', ko: '데이터 · AI' },
  { key: 'cloudInfra', ko: '클라우드 · 인프라' },
  { key: 'security', ko: '보안' },
  { key: 'qa', ko: 'QA · 테스트' },
];

export const CAREER_BANDS = [
  { key: 'entry', ko: '신입' },
  { key: 'junior', ko: '1~3년' },
  { key: 'experienced', ko: '4~7년' },
  { key: 'senior', ko: '8년 이상' },
];

export const PLACES = [
  { key: 'seoul', ko: '서울' },
  { key: 'gyeonggi', ko: '경기' },
  { key: 'other', ko: '그 밖의 국내' },
  { key: 'remote', ko: '원격 가능' },
];

const ROLE_KEYS = new Set(ROLE_FOCUS.map((r) => r.key));
const BAND_KEYS = new Set(CAREER_BANDS.map((b) => b.key));
const PLACE_KEYS = new Set(PLACES.map((p) => p.key));

// matcher.dart `ignoredStackTools`.
export const IGNORED_STACK_TOOLS = new Set(['git', 'jira', 'confluence', 'slack', 'notion', 'ci/cd']);

const ROLE_WORDS = [
  ['backend', ['backend', 'back-end', 'server engineer', 'server developer', '백엔드', '서버 개발']],
  ['frontend', ['frontend', 'front-end', 'web frontend', '프론트엔드', '웹 프론트']],
  ['mobile', ['android', 'ios', 'flutter', 'react native', 'mobile engineer', '모바일']],
  ['dataAi', ['data engineer', 'data scientist', 'machine learning', 'ml engineer', 'ai engineer', '데이터 엔지니어', '데이터 사이언', '머신러닝', '인공지능']],
  ['cloudInfra', ['devops', 'sre', 'site reliability', 'platform engineer', 'cloud engineer', 'infrastructure', 'solutions architect', '클라우드', '인프라', '플랫폼 엔지니어']],
  ['security', ['security', 'security engineer', '보안', '정보보호']],
  ['qa', ['qa engineer', 'quality assurance', 'test engineer', 'sdet', '테스트 자동화', '품질 엔지니어']],
];
const FULLSTACK_WORDS = ['fullstack', 'full-stack', 'full stack', '풀스택'];

function roleFocusesIn(hay) {
  const has = (words) => words.some((w) => hay.includes(w));
  const out = new Set();
  if (has(FULLSTACK_WORDS)) {
    out.add('fullstack');
    out.add('backend');
    out.add('frontend');
  }
  for (const [key, words] of ROLE_WORDS) if (has(words)) out.add(key);
  return out;
}

/** matcher.dart `jobRoleFocuses`: the title speaks first, tags fill a silent title. */
export function jobRoleFocuses(job) {
  const title = String(job.title || '').toLowerCase();
  const fromTitle = roleFocusesIn(title);
  if (fromTitle.size) return fromTitle;
  const skills = (Array.isArray(job.skills) ? job.skills : []).join(' ').toLowerCase();
  return roleFocusesIn(title + ' ' + skills);
}

function statedFloorYears(experience) {
  const text = String(experience || '');
  if (!text) return null;
  const m = /(\d+)\s*\+?\s*(?:~|-|–)?\s*\d*\s*년/.exec(text) || /(\d+)\s*\+?\s*years?/i.exec(text);
  const years = m ? parseInt(m[1], 10) : null;
  return years == null || Number.isNaN(years) || years > 40 ? null : years;
}

function bandOfYears(years) {
  if (years <= 0) return 'entry';
  if (years <= 3) return 'junior';
  if (years <= 7) return 'experienced';
  return 'senior';
}

/** matcher.dart `jobCareerBands`. Empty means the posting did not say. */
export function jobCareerBands(job) {
  const category = String(job.experienceCategory || '').toUpperCase();
  const fromCategory = {
    ENTRY: ['entry'],
    JUNIOR: ['junior'],
    MID: ['experienced'],
    SENIOR: ['senior'],
    LEAD: ['senior'],
  }[category];
  if (fromCategory) {
    const out = new Set(fromCategory);
    const floor = statedFloorYears(job.experience);
    if (floor != null) out.add(bandOfYears(floor));
    return out;
  }
  const text = String(job.experience || '');
  if (text.includes('경력 무관') || text.trim() === '무관') return new Set(BAND_KEYS);
  if (text.includes('신입') && !/\d+\s*년/.test(text)) return new Set(['entry']);
  const range = /(\d+)\s*(?:~|-|–|에서)\s*(\d+)\s*년/.exec(text);
  const years = range
    ? [parseInt(range[1], 10), parseInt(range[2], 10)]
    : [...text.matchAll(/(\d+)\s*년/g)].map((m) => parseInt(m[1], 10));
  if (!years.length) return new Set();
  const onlyUpper = text.includes('이하') && !text.includes('이상');
  const min = onlyUpper ? 0 : years[0];
  const max = years.length > 1 ? years[1] : onlyUpper ? years[0] : 99;
  const overlaps = (a, b) => min <= b && max >= a;
  const out = new Set();
  if (overlaps(0, 0)) out.add('entry');
  if (overlaps(1, 3)) out.add('junior');
  if (overlaps(4, 7)) out.add('experienced');
  if (overlaps(8, 99)) out.add('senior');
  return out;
}

// ---------- place (matcher.dart jobPlaceArea, jobIsRemote) ----------

const REMOTE_MARKERS = ['원격', '재택', 'remote'];
const ABROAD_MARKERS = [
  'United States', 'USA', 'California', 'New York', 'Irvine', 'Taipei', 'Taiwan', 'Japan', 'Tokyo',
  'Singapore', 'Vietnam', 'Germany', 'Berlin', 'London', 'United Kingdom', 'Canada', 'Australia',
  'India', 'Hong Kong', 'China', 'Shanghai', '미국', '미주', '얼바인', '일본', '대만', '싱가포르',
  '베트남', '독일', '영국', '캐나다', '호주', '중국', '홍콩',
];
// korea_places.dart keys plus the gate-only 'Korea', lowercased.
const KOREA_MARKERS = ['seoul', 'busan', 'daegu', 'incheon', 'daejeon', 'gwangju', 'ulsan', 'suwon',
  'seongnam', 'bundang', 'gyeonggi', 'jeju', 'pangyo', 'gangnam', 'korea'];
const SEOUL = ['서울', 'seoul', '강남', 'gangnam', '역삼', '교대', '서초', '잠실', '송파', '마포', '구로', '가산', '여의도', '성수', '종로', '용산'];
const GYEONGGI = ['경기', 'gyeonggi', '수원', 'suwon', '성남', 'seongnam', '분당', 'bundang', '판교', 'pangyo', '용인', '고양', '화성', '안양', '과천'];

function isAbroad(loc) {
  if (!loc.trim()) return false;
  if (ABROAD_MARKERS.some((m) => loc.includes(m))) return true;
  if (/[가-힣]/.test(loc)) return false;
  const lower = loc.toLowerCase();
  return !KOREA_MARKERS.some((m) => lower.includes(m));
}

export function jobIsRemote(job) {
  const hay = (String(job.title || '') + ' ' + String(job.description || '') + ' ' + String(job.location || '')).toLowerCase();
  return REMOTE_MARKERS.some((m) => hay.includes(m));
}

/** 'seoul' | 'gyeonggi' | 'other' | 'abroad' | 'unknown' */
export function jobPlaceArea(job) {
  const raw = String(job.location || '').trim();
  if (!raw || /^(미지정|한국|대한민국|korea|south korea)$/i.test(raw)) return 'unknown';
  if (isAbroad(raw)) return 'abroad';
  const lower = raw.toLowerCase();
  if (SEOUL.some((m) => lower.includes(m))) return 'seoul';
  if (GYEONGGI.some((m) => lower.includes(m))) return 'gyeonggi';
  return 'other';
}

// ---------- exclusions (matcher.dart _gate step 1) ----------

const SI_MARKERS = ['파견', '아웃소싱', '상주', '프로젝트 투입'];
const SI_LATIN = /(^|[^A-Za-z])SI([^A-Za-z]|$)/;

export function jobIsSiOrDispatch(job) {
  const hay = String(job.title || '') + ' ' + String(job.description || '');
  return SI_MARKERS.some((m) => hay.includes(m)) || SI_LATIN.test(hay);
}

const flat = (v) => String(v || '').toLowerCase().replace(/\s+/g, '');
const norm = (v) => String(v || '').trim().toLowerCase();

// ---------- conditions ----------

function cleanList(value, { max, maxLen }) {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,\n]/) : [];
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const s = String(raw == null ? '' : raw).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, maxLen);
    const k = s.toLowerCase();
    if (!s || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * The conditions a subscription may hold, cleaned. Returns
 * { ok: true, conditions } or { ok: false, error } with a Korean message.
 */
export function normalizeConditions(input) {
  const src = input && typeof input === 'object' ? input : {};
  const roles = [...new Set((Array.isArray(src.roles) ? src.roles : []).filter((r) => ROLE_KEYS.has(r)))];
  const bands = [...new Set((Array.isArray(src.bands) ? src.bands : []).filter((b) => BAND_KEYS.has(b)))];
  const places = [...new Set((Array.isArray(src.places) ? src.places : []).filter((p) => PLACE_KEYS.has(p)))];
  const skills = cleanList(src.skills, { max: 12, maxLen: 40 });
  const exclude = cleanList(src.exclude, { max: 10, maxLen: 40 });
  if (!roles.length) return { ok: false, error: '직무를 하나 이상 골라 주세요.' };
  if (!bands.length) return { ok: false, error: '경력을 하나 이상 골라 주세요.' };
  // Keep the canonical order so two equal conditions serialize the same way.
  const order = (keys, list) => keys.filter((k) => list.includes(k));
  return {
    ok: true,
    conditions: {
      roles: order(ROLE_FOCUS.map((r) => r.key), roles),
      bands: order(CAREER_BANDS.map((b) => b.key), bands),
      places: order(PLACES.map((p) => p.key), places),
      skills,
      exclude,
    },
  };
}

/** 「백엔드 · 1~3년 · 서울」, the condition line every message carries. */
export function conditionsKo(c) {
  const pick = (table, keys) => table.filter((t) => keys.includes(t.key)).map((t) => t.ko);
  const parts = [pick(ROLE_FOCUS, c.roles).join(', '), pick(CAREER_BANDS, c.bands).join(', ')];
  if (c.places && c.places.length) parts.push(pick(PLACES, c.places).join(', '));
  if (c.skills && c.skills.length) parts.push(c.skills.join(', '));
  return parts.filter(Boolean).join(' · ');
}

// ---------- the match ----------

/**
 * Whether [job] belongs to a subscriber with conditions [c]. Returns null
 * when it does not, or { overlap } with the subscriber's skills it carries.
 */
export function matchPosting(c, job, now = new Date()) {
  if (!job || typeof job !== 'object' || !job.id || !job.title) return null;
  if (job.isActive === false || pastDeadline(job, now)) return null;
  const company = flat(job.company);
  if ((c.exclude || []).map(flat).filter(Boolean).some((e) => company.includes(e))) return null;
  if (jobIsSiOrDispatch(job)) return null;

  const roles = jobRoleFocuses(job);
  if (!c.roles.some((r) => roles.has(r))) return null;

  const bands = jobCareerBands(job);
  if (bands.size && !c.bands.some((b) => bands.has(b))) return null;

  if (c.places && c.places.length) {
    const remoteOk = c.places.includes('remote') && jobIsRemote(job);
    if (!remoteOk) {
      const area = jobPlaceArea(job);
      if (area === 'abroad') return null;
      if (area !== 'unknown' && !c.places.includes(area)) return null;
    }
  }

  const mine = new Set((c.skills || []).map(norm).filter((s) => s && !IGNORED_STACK_TOOLS.has(s)));
  const overlap = [];
  const seen = new Set();
  for (const skill of Array.isArray(job.skills) ? job.skills : []) {
    const k = norm(skill);
    if (!k || IGNORED_STACK_TOOLS.has(k) || !mine.has(k) || seen.has(k)) continue;
    seen.add(k);
    overlap.push(String(skill).trim());
  }
  return { overlap };
}

/** Matching postings, most overlapping skills first, newest first within a tie. */
export function rankMatches(c, jobs, now = new Date()) {
  const out = [];
  for (const job of jobs) {
    const m = matchPosting(c, job, now);
    if (m) out.push({ job, overlap: m.overlap });
  }
  out.sort((a, b) => b.overlap.length - a.overlap.length || Number(b.job.id) - Number(a.job.id));
  return out;
}

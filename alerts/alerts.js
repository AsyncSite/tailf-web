// /alerts/ : subscribe, and with ?id&t the same form manages one subscription.
// The condition vocabulary and the preview count come from the module the
// sender uses (lib/alerts/match.mjs), so the page cannot promise a match the
// sender would not make.
import { ROLE_FOCUS, CAREER_BANDS, PLACES, rankMatches } from '/lib/alerts/match.mjs';
import { titleWithoutCompany, careerKo, kstDay } from '/lib/seo.mjs';
import { ALERT_SOURCES } from '/lib/alerts/sources.mjs';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const manageId = params.get('id');
const manageT = params.get('t');
const managing = !!(manageId && manageT);
const src = (() => {
  const m = /^\/alerts\/from\/([^/]+)\/?$/.exec(location.pathname);
  return m && ALERT_SOURCES.includes(m[1]) ? m[1] : 'direct';
})();

const state = { roles: new Set(), bands: new Set(), places: new Set(), status: null };
const listParam = (name, table) => (params.get(name) || '').split(',').filter((k) => table.some((t) => t.key === k));
listParam('role', ROLE_FOCUS).forEach((k) => state.roles.add(k));
listParam('band', CAREER_BANDS).forEach((k) => state.bands.add(k));

function renderChips(group, table) {
  const box = document.querySelector('[data-group="' + group + '"]');
  box.textContent = '';
  for (const t of table) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (state[group].has(t.key) ? ' on' : '');
    b.textContent = t.ko;
    b.setAttribute('aria-pressed', state[group].has(t.key) ? 'true' : 'false');
    b.addEventListener('click', () => {
      if (state[group].has(t.key)) state[group].delete(t.key);
      else state[group].add(t.key);
      renderChips(group, table);
      schedulePreview();
    });
    box.appendChild(b);
  }
}

function listOf(text) {
  return String(text || '').split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
}

function conditions() {
  return {
    roles: [...state.roles],
    bands: [...state.bands],
    places: [...state.places],
    skills: listOf($('skills').value),
    exclude: listOf($('exclude').value),
  };
}

function say(text, isError) {
  const el = $('form-msg');
  el.textContent = text || '';
  el.classList.toggle('err', !!isError);
}

// ---------- the preview: the same match over postings open right now ----------

const DAYS = 14;
let board = null;
let previewTimer = 0;

async function loadBoard() {
  if (board) return board;
  const url = (page) => 'https://api.asyncsite.com/api/public/jobs?jobFamily=ENGINEERING&sortBy=id&sortDirection=DESC&size=100&page=' + page;
  const pages = await Promise.all([0, 1].map((p) => fetch(url(p)).then((r) => (r.ok ? r.json() : Promise.reject(r.status)))));
  board = pages.flatMap((b) => (b && Array.isArray(b.content) ? b.content : []));
  return board;
}

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 250);
}

async function renderPreview() {
  const box = $('preview');
  const c = conditions();
  if (!c.roles.length || !c.bands.length) {
    box.hidden = true;
    return;
  }
  let jobs;
  try {
    jobs = await loadBoard();
  } catch (e) {
    box.hidden = true;
    return;
  }
  const now = new Date();
  const since = kstDay(new Date(now.getTime() - (DAYS - 1) * 86400000));
  const recent = jobs.filter((j) => String(j.postedAt || '').slice(0, 10) >= since);
  const matches = rankMatches(c, recent, now);
  $('preview-n').textContent = matches.length
    ? '지난 ' + DAYS + '일에 올라와 지금도 열려 있는 공고 중 이 조건에 맞는 건 ' + matches.length + '건이에요.'
    : '지난 ' + DAYS + '일에는 이 조건에 맞는 공고가 없었어요. 직무나 경력을 넓히면 더 받을 수 있어요.';
  const list = $('preview-list');
  list.textContent = '';
  for (const m of matches.slice(0, 3)) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = '/p/' + m.job.id + '/';
    a.textContent = titleWithoutCompany(m.job.title, m.job.company);
    li.appendChild(a);
    li.appendChild(document.createTextNode(' · ' + [m.job.company, careerKo(m.job)].filter(Boolean).join(' · ')));
    list.appendChild(li);
  }
  $('preview-basis').textContent = '보내는 쪽과 같은 규칙으로 지금 열려 있는 공개 공고를 셌어요. 받기 시작한 뒤에 올라오는 공고부터 보내요.';
  box.hidden = false;
}

// ---------- destination ----------

const KIND = {
  email: { type: 'email', label: '이메일 주소', placeholder: 'you@example.com', auto: 'email', mode: 'email',
    hint: '받을 주소로 확인 메일을 보내요. 메일의 버튼을 눌러야 보내기 시작해요.' },
  slack: { type: 'url', label: 'Slack 웹훅 주소', placeholder: 'https://hooks.slack.com/services/…', auto: 'off', mode: 'url',
    hint: '연결하자마자 그 채널에 확인 메시지를 한 번 보내요. 웹훅 주소를 아는 사람은 그 채널에 글을 쓸 수 있으니 공개된 곳에 올리지 마세요.' },
  discord: { type: 'url', label: 'Discord 웹후크 주소', placeholder: 'https://discord.com/api/webhooks/…', auto: 'off', mode: 'url',
    hint: '연결하자마자 그 채널에 확인 메시지를 한 번 보내요. 웹후크 주소를 아는 사람은 그 채널에 글을 쓸 수 있으니 공개된 곳에 올리지 마세요.' },
};

function kindNow() {
  const el = document.querySelector('input[name="kind"]:checked');
  return el ? el.value : 'email';
}

function applyKind() {
  const k = KIND[kindNow()];
  const input = $('destination');
  input.type = k.type;
  input.placeholder = k.placeholder;
  input.autocomplete = k.auto;
  input.inputMode = k.mode;
  $('dest-label').textContent = k.label;
  $('dest-hint').textContent = k.hint;
  input.removeAttribute('aria-invalid');
}

// ---------- signals (README 「설치 클릭률 읽는 법」) ----------

function emitSignal(name) {
  const key = 'tailf.signal.' + name + '.v1';
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
  } catch (e) { /* counted once per page view then */ }
  const frame = document.createElement('iframe');
  frame.src = '/signal/' + name + '/' + (src !== 'direct' ? src + '/' : '');
  frame.title = '';
  frame.tabIndex = -1;
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:absolute;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
  document.body.appendChild(frame);
  setTimeout(() => frame.remove(), 8000);
}

// ---------- API ----------

async function api(path, body, method) {
  const init = method === 'GET'
    ? { method: 'GET' }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  let res;
  try {
    res = await fetch('/api/alerts/' + path, init);
  } catch (e) {
    return { ok: false, error: '연결이 끊겼습니다. 잠시 뒤에 다시 시도해 주세요.' };
  }
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  if (!res.ok || !data || !data.ok) return { ok: false, error: (data && data.error) || '잠시 문제가 생겼습니다. 조금 뒤에 다시 시도해 주세요.' };
  return data;
}

function showDone(title, body, manageLink) {
  $('alert-form').hidden = true;
  $('done').hidden = false;
  $('done-title').textContent = title;
  $('done-body').textContent = body;
  if (manageLink) {
    const p = $('done-manage');
    p.textContent = '조건 바꾸기와 그만 받기는 ';
    const a = document.createElement('a');
    a.href = manageLink;
    a.textContent = '이 링크';
    p.appendChild(a);
    p.appendChild(document.createTextNode('에서 할 수 있어요. 채널에 보낸 확인 메시지에도 같은 링크가 있어요.'));
    p.hidden = false;
  }
  $('done').scrollIntoView({ block: 'start' });
}

async function subscribe() {
  const c = conditions();
  if (!c.roles.length) return say('찾는 직무를 하나 이상 골라 주세요.', true);
  if (!c.bands.length) return say('경력을 하나 이상 골라 주세요.', true);
  const destination = $('destination').value.trim();
  if (!destination) {
    $('destination').setAttribute('aria-invalid', 'true');
    $('destination').focus();
    return say(KIND[kindNow()].label + '를 넣어 주세요.', true);
  }
  $('submit').disabled = true;
  say('보내는 중이에요.');
  const kind = kindNow();
  const r = await api('subscribe', { ...c, kind, destination, src, website: $('website').value });
  $('submit').disabled = false;
  if (!r.ok) return say(r.error, true);
  say('');
  emitSignal('alerts-subscribed');
  if (r.state === 'active') {
    showDone('채널에 연결했어요', '방금 그 채널에 확인 메시지를 보냈어요. 이제부터 맞는 새 공고가 올라오면 한 시간에 한 번까지 모아서 보내요.', r.manage);
  } else {
    showDone('확인 메일을 보냈어요', '메일의 「받기 확인」 버튼을 누르면 그때부터 보내요. 메일이 보이지 않으면 스팸함도 봐 주세요. 10분 안에 다시 신청해도 확인 메일은 한 번만 가요.');
  }
}

// ---------- manage ----------

function statusLine(sub) {
  if (sub.status === 'paused') return '잠깐 쉬는 중이에요. 다시 받기를 누르면 그때부터 올라오는 공고를 보내요.';
  if (sub.status === 'disabled') {
    return sub.disabledReason === 'destination_gone'
      ? '받을 곳이 없어져서 멈췄어요. 웹훅이 지워졌거나 채널 연결이 끊긴 것 같아요.'
      : '여러 번 보내지 못해서 멈췄어요. 다시 받기를 누르면 다음 시간부터 다시 보내요.';
  }
  if (sub.lastSentAt) {
    const d = new Date(sub.lastSentAt);
    const t = d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    return '받는 중이에요. 마지막으로 보낸 때는 ' + t + '예요.';
  }
  return '받는 중이에요. 아직 맞는 새 공고가 없어서 보낸 적은 없어요.';
}

function applySub(sub) {
  state.status = sub.status;
  state.roles = new Set(sub.conditions.roles);
  state.bands = new Set(sub.conditions.bands);
  state.places = new Set(sub.conditions.places || []);
  $('skills').value = (sub.conditions.skills || []).join(', ');
  $('exclude').value = (sub.conditions.exclude || []).join(', ');
  $('lead').textContent = '받는 곳: ' + sub.destination;
  $('manage-state').textContent = statusLine(sub);
  $('manage-state').hidden = false;
  $('pause').textContent = sub.status === 'active' ? '잠깐 쉬기' : '다시 받기';
  renderAll();
}

async function startManage() {
  document.title = 'tailf · 알림 조건 바꾸기';
  $('eyebrow').textContent = '넣어둔 알림';
  $('title').textContent = '알림 조건 바꾸기';
  $('dest-field').hidden = true;
  $('submit').textContent = '조건 저장';
  $('pause').hidden = false;
  const stop = $('stop');
  stop.hidden = false;
  stop.href = '/alerts/unsubscribe/?id=' + encodeURIComponent(manageId) + '&t=' + encodeURIComponent(manageT);
  const r = await api('sub?id=' + encodeURIComponent(manageId) + '&t=' + encodeURIComponent(manageT), null, 'GET');
  if (!r.ok) {
    $('alert-form').hidden = true;
    $('lead').textContent = r.error;
    const p = document.createElement('p');
    p.className = 'cta-note';
    const a = document.createElement('a');
    a.href = '/alerts/';
    a.textContent = '처음부터 새로 받기';
    p.appendChild(a);
    $('lead').after(p);
    return;
  }
  applySub(r.subscription);
  $('pause').addEventListener('click', async () => {
    $('pause').disabled = true;
    const res = await api('pause', { id: manageId, t: manageT, paused: state.status === 'active' });
    $('pause').disabled = false;
    if (!res.ok) return say(res.error, true);
    applySub(res.subscription);
    say(res.subscription.status === 'paused' ? '잠깐 쉬어요. 그동안은 보내지 않아요.' : '다시 받아요. 지금부터 올라오는 공고를 보내요.');
  });
}

async function saveConditions() {
  const c = conditions();
  if (!c.roles.length) return say('찾는 직무를 하나 이상 골라 주세요.', true);
  if (!c.bands.length) return say('경력을 하나 이상 골라 주세요.', true);
  $('submit').disabled = true;
  const r = await api('update', { ...c, id: manageId, t: manageT });
  $('submit').disabled = false;
  if (!r.ok) return say(r.error, true);
  applySub(r.subscription);
  say('저장했어요. 지금부터 올라오는 공고에 새 조건을 써요.');
}

// ---------- start ----------

function renderAll() {
  renderChips('roles', ROLE_FOCUS);
  renderChips('bands', CAREER_BANDS);
  renderChips('places', PLACES);
  schedulePreview();
}

document.querySelectorAll('input[name="kind"]').forEach((el) => el.addEventListener('change', applyKind));
$('skills').addEventListener('input', schedulePreview);
$('exclude').addEventListener('input', schedulePreview);
$('destination').addEventListener('input', () => $('destination').removeAttribute('aria-invalid'));
$('alert-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (managing) saveConditions();
  else subscribe();
});
applyKind();
renderAll();
if (managing) {
  const robots = document.createElement('meta');
  robots.name = 'robots';
  robots.content = 'noindex, nofollow';
  document.head.appendChild(robots);
  startManage();
}

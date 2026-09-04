/* tailf web. "설치 전에 세어 보기".
 *
 * Everything below counts in this browser. Nothing the reader taps is sent
 * anywhere: the only request this file makes is the public postings list,
 * which carries no chip and no reader.
 *
 * The rules are ported from the app and must stay identical to it:
 *   - normalization: lib/src/match/matcher.dart `_overlap` / `_normalizedStack`
 *     (trim + lowercase, `ignoredStackTools` dropped on both sides)
 *   - two overlaps is a match, one is a reference: matcher.dart `evaluate`
 *   - the gates (경력 · 근무지 · 안 볼 회사) are empty here, exactly as on the
 *     app's first run (screens/stacks.dart `_engine`), so every posting reaches
 *     the stack step and only the threshold decides
 *   - the 30-day window: watch/backtest.dart `run` — posted_at within the last
 *     30 days, postings already taken down included
 * A number this file cannot count is not drawn. If the list does not arrive,
 * the whole section leaves rather than showing a number we did not count.
 */
/* The store buttons, everywhere on the page, are one state component.
 *
 * Each store has two states and the page ships in the honest one. A button is
 * a link in both of them: its href never moves, it always points at /go/<store>/,
 * and that page either forwards to the store or says what is actually happening.
 * That is the whole reason a state that has no store link is still pressable.
 * The released label is drawn only when the store itself answers with the app,
 * and the address is the one the store gives, never one we assemble.
 */
(function () {
  'use strict';

  /* Google Play. One line, one place: put the address Google serves here and
     every Play button on the site, the top pill included, leads to it. An empty
     string is the honest state while Play has nothing of ours. */
  var PLAY_URL = '';

  var LOOKUP = 'https://itunes.apple.com/lookup?id=6808048845&country=kr';
  var CACHE_KEY = 'tailf.appstore.v1';
  var CACHE_MS = 10 * 60 * 1000;
  /* Only an address the store itself serves. A payload that carried anything
     else would be a link we made up, and this page does not make up links. */
  var APPLE_URL = /^https:\/\/(apps|itunes)\.apple\.com\//;
  var PLAY_STORE = /^https:\/\/play\.google\.com\/store\/apps\//;

  var LABELS = {
    appstore: { live: 'App Store 에서 받기', pending: 'App Store 심사 중이에요' },
    play: { live: 'Google Play 에서 받기', pending: 'Google Play 에도 올라가요' }
  };

  function each(sel, fn) {
    var all = document.querySelectorAll(sel);
    for (var i = 0; i < all.length; i++) fn(all[i]);
  }

  /** The Play address, or null while there is nothing to link. */
  function playUrl() { return PLAY_STORE.test(PLAY_URL) ? PLAY_URL : null; }

  /** [url] is the store address, or null while there is nothing to link.
   *  Nothing here touches href: the button leads to /go/<store>/ in both states,
   *  so a reader can press it and a press can be counted either way. */
  function drawStore(store, url) {
    var live = !!url;
    each('[data-install="' + store + '"]', function (el) {
      el.classList.toggle('install-pending', !live);
      // The top pills carry the store name and nothing else. Two full sentences
      // do not fit beside the mark on a 390px screen, and a pill that wrapped
      // would push the mark off the bar.
      if (!el.hasAttribute('data-keep-label')) {
        el.textContent = LABELS[store][live ? 'live' : 'pending'];
      }
    });
    each('[data-' + store + '-when="pending"]', function (el) { el.hidden = live; });
    each('[data-' + store + '-when="live"]', function (el) { el.hidden = !live; });
  }

  function cached() {
    try {
      var raw = window.sessionStorage.getItem(CACHE_KEY);
      if (!raw) return undefined;
      var v = JSON.parse(raw);
      if (!v || (Date.now() - v.at) > CACHE_MS) return undefined;
      return v.url || null;   // null is a real answer: Apple has no app yet
    } catch (e) { return undefined; }
  }

  function remember(url) {
    try {
      window.sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), url: url }));
    } catch (e) { /* a browser that keeps nothing still draws the right button */ }
  }

  /** Asks Apple and hands back the address, or null. [cb] runs exactly once. */
  function askApple(cb) {
    var hit = cached();
    if (hit !== undefined) { cb(hit); return; }
    fetch(LOOKUP)
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (d) {
        var rows = (d && d.results) || [];
        var url = (d && d.resultCount > 0 && rows[0] && rows[0].trackViewUrl) || '';
        var ok = APPLE_URL.test(url) ? url : null;
        remember(ok);   // a lookup that answered is worth keeping, either way
        cb(ok);
      })
      // A lookup we could not make is not a release. The page stays as it
      // shipped and nothing is cached, so the next open asks again.
      .catch(function () { cb(null); });
  }

  /* The /go/ pages read the same two answers from here, so the Play address
     lives in one place and the App Store one is asked the one way. */
  window.TAILF = { PLAY_URL: playUrl(), appStoreUrl: askApple };

  /* A page with no store button asks nobody: /go/play/ has no business
     opening a connection to Apple. */
  if (document.querySelector('[data-install]')) {
    drawStore('play', playUrl());
    askApple(function (url) { drawStore('appstore', url); });
  }

  var API = 'https://api.asyncsite.com/api/public/jobs';
  var PAGE_SIZE = 100;   // the API caps page size at 100 (jobs_api.dart)
  var MAX_ROWS = 1500;   // a guard against a feed that never says it is done
  var MAX_PAGES = 20;    // same guard as tower.dart `_maxPages`
  var CONCURRENCY = 4;
  var DAYS = 30;

  /* Collaboration tools are useful at work but do not explain job fit.
     matcher.dart `ignoredStackTools`, normalized the same way. */
  var IGNORED = { 'git': 1, 'jira': 1, 'confluence': 1, 'slack': 1, 'notion': 1, 'ci/cd': 1 };

  /* measured 2026-09-03, stacks.dart `_stackGroups`. Same five names, same 24. */
  var GROUPS = [
    { name: '언어', stacks: ['Python', 'Java', 'C++', 'SQL', 'Go'] },
    { name: '백엔드와 데이터', stacks: ['Kafka', 'Redis', 'MySQL', 'PostgreSQL', 'Airflow'] },
    { name: '인프라와 클라우드', stacks: ['AWS', 'Kubernetes', 'Linux', 'Docker', 'GCP', 'Terraform', 'Grafana', 'Azure'] },
    { name: '프론트와 모바일', stacks: ['Kotlin', 'TypeScript', 'React'] },
    { name: 'ML', stacks: ['PyTorch', 'LLM', 'TensorFlow'] }
  ];

  var section = document.getElementById('try');
  if (!section) return;
  var groupsEl = document.getElementById('try-groups');
  var bigEl = document.getElementById('try-big');
  var secondEl = document.getElementById('try-second');
  var basisEl = document.getElementById('try-basis');
  var scopeEl = document.getElementById('try-scope');

  var chosen = [];   // chip labels, in the order they were pressed
  var rows = null;   // [{ s: [normalized skills], d: 'YYYY-MM-DD', a: isActive }]
  var dead = false;

  /* ---------- the rules, ported ---------- */

  /** matcher.dart: `value.trim().toLowerCase()`. */
  function norm(v) { return String(v).trim().toLowerCase(); }

  /** The chips that count, tools dropped, as a lookup. */
  function mine() {
    var m = {};
    for (var i = 0; i < chosen.length; i++) {
      var k = norm(chosen[i]);
      if (!IGNORED[k]) m[k] = 1;
    }
    return m;
  }

  /** matcher.dart `_overlap`: a list, not a set. A posting that writes the
   *  same stack twice overlaps twice there, and it must here too. */
  function overlap(row, m) {
    var n = 0;
    for (var i = 0; i < row.s.length; i++) {
      var k = row.s[i];
      if (!IGNORED[k] && m[k]) n++;
    }
    return n;
  }

  function countAtLeast(list, m, floor) {
    var n = 0;
    for (var i = 0; i < list.length; i++) if (overlap(list[i], m) >= floor) n++;
    return n;
  }

  /** backtest.dart `ringDates`: several matches posted on one calendar day
   *  make one nightly notification. A missing date shares one unknown day. */
  function countRingDays(list, m, floor) {
    var dates = {};
    for (var i = 0; i < list.length; i++) {
      if (overlap(list[i], m) >= floor) dates[list[i].d] = 1;
    }
    return Object.keys(dates).length;
  }

  /** matcher.dart `countSingleOverlap`: exactly one, and never a match. */
  function countExactlyOne(list, m) {
    var n = 0;
    for (var i = 0; i < list.length; i++) if (overlap(list[i], m) === 1) n++;
    return n;
  }

  /** backtest.dart `_day`. */
  function day(d) {
    return d.getFullYear() + '-' +
      ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
      ('0' + d.getDate()).slice(-2);
  }

  function cutoff() {
    var t = new Date();
    t.setDate(t.getDate() - DAYS);
    return day(t);
  }

  /* ---------- drawing ---------- */

  function line(el, text) {
    if (text) { el.textContent = text; el.hidden = false; }
    else { el.textContent = ''; el.hidden = true; }
  }

  function render() {
    if (dead) return;
    var n = chosen.length;

    if (n === 0) {
      line(bigEl, '두 개만 고르면 돼요.');
      line(secondEl, '');
      line(basisEl, '');
      line(scopeEl, '');
      return;
    }
    if (rows === null) {
      line(bigEl, '세는 중이에요');
      line(secondEl, '');
      line(basisEl, n === 1 ? '하나만 더 고르면 돼요.' : '');
      line(scopeEl, '');
      return;
    }

    var m = mine();
    var active = [], window30 = [];
    var since = cutoff();
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.a) active.push(r);
      // backtest.dart counts a row with no date as inside the window rather
      // than guessing a day for it.
      if (r.d === '' || r.d >= since) window30.push(r);
    }

    if (n === 1) {
      line(bigEl, countExactlyOne(active, m) + '건이 이 기술을 써요');
      line(secondEl, '');
      line(basisEl, '하나만 더 고르면 돼요.');
      line(scopeEl, '');
      return;
    }

    line(bigEl, '지금 이 기술이면 갈 수 있는 곳 ' + countAtLeast(active, m, 2) + '건');

    var observed = window30.length;
    if (observed < 5) {  // backtest.dart `thinSample`
      line(secondEl, '지난 30일에 올라온 게 ' + observed + '건뿐이라 아직 말하기 어려워요.');
      line(basisEl, '');
      line(scopeEl, '기술만으로 센 값이에요. 경력이랑 지역은 앱에서 좁혀요.');
      return;
    }
    var matched = countAtLeast(window30, m, 2);
    var ringDays = countRingDays(window30, m, 2);
    line(secondEl, ringDays > 0
      ? '지난 30일이었다면 ' + ringDays + '번 왔을 거예요'
      : '0번이에요. 두 개 이상 겹친 공고가 없었거든요.');
    line(basisEl, ringDays > 0
      ? '겹친 공고 ' + matched + '건이 ' + ringDays + '일에 걸쳐 올라왔어요. 하루 한 번 묶어서 와요.'
      : '지난 30일에 올라온 ' + observed + '건을 봤어요.');
    line(scopeEl, '지난 30일 기준이고 이미 내려간 것도 셌어요. 기술만으로 센 값이에요. 경력이랑 지역은 앱에서 좁혀요.');
  }

  function hideSection() {
    dead = true;
    section.hidden = true;
  }

  /* ---------- chips ---------- */

  function buildChips() {
    var frag = document.createDocumentFragment();
    for (var g = 0; g < GROUPS.length; g++) {
      var group = GROUPS[g];
      var wrap = document.createElement('div');
      wrap.className = 'try-group';

      var name = document.createElement('p');
      name.className = 'try-group-name';
      name.id = 'try-group-' + g;
      name.textContent = group.name;
      wrap.appendChild(name);

      var box = document.createElement('div');
      box.className = 'chips';
      box.setAttribute('role', 'group');
      box.setAttribute('aria-labelledby', name.id);
      for (var s = 0; s < group.stacks.length; s++) {
        box.appendChild(chip(group.stacks[s]));
      }
      wrap.appendChild(box);
      frag.appendChild(wrap);
    }
    groupsEl.appendChild(frag);
  }

  function chip(label) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = label;
    b.setAttribute('aria-pressed', 'false');
    b.setAttribute('data-stack', label);
    b.addEventListener('click', function () {
      var at = chosen.indexOf(label);
      if (at >= 0) chosen.splice(at, 1); else chosen.push(label);
      var on = at < 0;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.classList.toggle('on', on);
      render();
    });
    return b;
  }

  /* ---------- the list ---------- */

  function url(page) {
    return API + '?jobFamily=ENGINEERING&page=' + page + '&size=' + PAGE_SIZE + '&includeInactive=true';
  }

  function getPage(page) {
    return fetch(url(page))
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); });
  }

  /** Only what the rules read. The rest of a posting never enters memory. */
  function reduce(body) {
    var content = (body && body.content) || [];
    var out = [];
    for (var i = 0; i < content.length; i++) {
      var j = content[i];
      var skills = j.skills || [];
      var s = [];
      for (var k = 0; k < skills.length; k++) s.push(norm(skills[k]));
      out.push({
        s: s,
        d: String(j.postedAt || '').split('T')[0],
        a: j.isActive === true
      });
    }
    return out;
  }

  function load() {
    getPage(0).then(function (body) {
      var first = reduce(body);
      if (!first.length) throw 0;
      var total = typeof body.totalPages === 'number' ? body.totalPages : 1;
      var pages = Math.min(total, MAX_PAGES, Math.ceil(MAX_ROWS / PAGE_SIZE));
      // 「갈 수 있는 곳」 is counted over every open posting, of any age, so a
      // walk that stopped short would answer with a number smaller than the
      // truth. A guard that trips is a section that leaves, not a number we
      // shaded. (11 pages · 1,064 rows on 2026-09-04, caps at 15 · 1,500.)
      if (total > pages) throw 0;
      var got = [first];
      var next = 1;

      function worker() {
        if (next >= pages) return Promise.resolve();
        var page = next++;
        return getPage(page).then(function (b) {
          got[page] = reduce(b);
          return worker();
        });
      }

      var lanes = [];
      for (var i = 0; i < CONCURRENCY; i++) lanes.push(worker());
      return Promise.all(lanes).then(function () {
        var all = [];
        for (var p = 0; p < pages; p++) {
          var chunk = got[p] || [];
          for (var q = 0; q < chunk.length; q++) {
            if (all.length >= MAX_ROWS) break;
            all.push(chunk[q]);
          }
        }
        // A half-read list would answer with a number we did not count.
        if (!all.length) throw 0;
        rows = all;
        render();
      });
    }).catch(hideSection);
  }

  /* ---------- start ---------- */

  buildChips();
  render();
  section.hidden = false;   // no chips without the script that answers them

  function begin() {
    if (window.requestIdleCallback) window.requestIdleCallback(load, { timeout: 2500 });
    else setTimeout(load, 1200);
  }
  if (document.readyState === 'complete') begin();
  else window.addEventListener('load', begin);
})();

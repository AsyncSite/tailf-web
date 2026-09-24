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
 *
 * The list comes from /api/landing, one JSON the edge builds from the jobs API
 * and keeps for ten minutes (lib/landing-data.mjs). It holds the same rows this
 * file used to walk 13 pages for, so the counts are the same counts.
 */
/* The store buttons, everywhere on the page, are one state component.
 *
 * Each store has two states and the page ships in the honest one. A button is
 * a link in both of them: its href never moves, it always points at /go/<store>/,
 * and that page either forwards to the store or says what is actually happening.
 * That is the whole reason a state that has no store link is still pressable.
 * The released Apple address is the confirmed public Korean storefront.
 */
(function () {
  'use strict';

  /* Google Play. One line, one place: put the address Google serves here and
     every Play button on the site, the top pill included, leads to it. An empty
     string is the honest state while Play has nothing of ours. */
  var PLAY_URL = '';
  var TESTFLIGHT_URL = 'https://testflight.apple.com/join/5J2W3M5p';

  // Confirmed public Korean storefront for approved build 27.
  var APP_STORE_URL = 'https://apps.apple.com/kr/app/tailf/id6808048845';
  var PLAY_STORE = /^https:\/\/play\.google\.com\/store\/apps\//;

  var LABELS = {
    appstore: { live: 'App Store 에서 받기', pending: 'App Store 심사 중이에요' },
    play: { live: 'Google Play 에서 받기', pending: 'Google Play 에도 올라가요' }
  };

  /* Distribution links use a short fixed path instead of a cookie or a free-
     form query value. Cloudflare Web Analytics can count the source from
     requestPath without learning who the reader is. */
  var ACQUISITION_SOURCES = {
    newsletter: 1,
    lounge: 1,
    cohort: 1,
    community: 1,
    threads: 1,
    youtube: 1,
    seo: 1,
    geeknews: 1,
    okky: 1,
    disquiet: 1,
    velog: 1,
    discord: 1
  };

  function acquisitionSource() {
    var match = window.location.pathname.match(
      /^\/(?:from|go\/(?:appstore|play|testflight))\/([^/]+)\/?$/
    );
    var source = match && match[1];
    return source && ACQUISITION_SOURCES[source] ? source : null;
  }

  /* Web Analytics already measures page loads on this host. Loading one of
     these fixed, noindex documents lets it count the two useful backtest
     actions without adding a stack, profile, identifier, or free-form value
     to the request. sessionStorage prevents repeat taps from inflating one
     browser session. */
  var SIGNALS = {
    'backtest-started': 1,
    'backtest-completed': 1
  };
  var emittedSignals = {};

  function emitSignal(name) {
    if (!SIGNALS[name] || emittedSignals[name]) return;
    var key = 'tailf.signal.' + name + '.v1';
    try {
      if (window.sessionStorage.getItem(key)) {
        emittedSignals[name] = true;
        return;
      }
      window.sessionStorage.setItem(key, '1');
    } catch (e) { /* in-memory dedup still applies when storage is disabled */ }
    emittedSignals[name] = true;

    var source = acquisitionSource();
    var frame = document.createElement('iframe');
    frame.src = '/signal/' + name + '/' + (source ? source + '/' : '');
    frame.title = '';
    frame.tabIndex = -1;
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:absolute;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
    document.body.appendChild(frame);
    window.setTimeout(function () {
      if (frame.parentNode) frame.parentNode.removeChild(frame);
    }, 8000);
  }

  function each(sel, fn) {
    var all = document.querySelectorAll(sel);
    for (var i = 0; i < all.length; i++) fn(all[i]);
  }

  function routeInstallLinks() {
    var source = acquisitionSource();
    if (!source) return;
    each('[data-install]', function (el) {
      var store = el.getAttribute('data-install');
      if (store === 'appstore' || store === 'play' || store === 'testflight') {
        el.href = '/go/' + store + '/' + source + '/';
      }
    });
  }

  /* The landing's 「앱 없이 이메일·슬랙으로 받기」 links keep the channel the
     reader arrived through, as /alerts/from/<source>/ (lib/alerts/sources.mjs). */
  function routeAlertLinks() {
    var source = acquisitionSource();
    if (!source) return;
    each('[data-alerts]', function (el) { el.href = '/alerts/from/' + source + '/'; });
  }

  function drawTestFlightEntry() {
    if (acquisitionSource() !== 'cohort') return;
    each('[data-testflight-cta]', function (el) { el.hidden = false; });
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

  /** The released storefront is already public; lookup indexing can lag. */
  function askApple(cb) { cb(APP_STORE_URL); }

  /* The /go/ pages read the same two answers from here, so the Play address
     lives in one place and the App Store one is asked the one way. */
  window.TAILF = {
    PLAY_URL: playUrl(),
    TESTFLIGHT_URL: TESTFLIGHT_URL,
    appStoreUrl: askApple,
    acquisitionSource: acquisitionSource()
  };

  /* A page with no store button has no landing state to draw. */
  if (document.querySelector('[data-install]')) {
    routeInstallLinks();
    routeAlertLinks();
    drawTestFlightEntry();
    drawStore('play', playUrl());
    askApple(function (url) { drawStore('appstore', url); });
  }

  var DATA = '/api/landing';
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

  var landing = null;
  /** One request for the page: the hero count and the backtest rows. */
  function landingData() {
    if (!landing) {
      landing = fetch(DATA, { headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); });
    }
    return landing;
  }

  /* 「지금 지켜보고 있는 채용 공고」: open developer postings. */
  (function drawCount() {
    var nEl = document.getElementById('n');
    var subEl = document.getElementById('nsub');
    if (!nEl || !subEl) return;
    landingData().then(function (d) {
      var n = d && d.total;
      if (typeof n !== 'number') throw 0;
      nEl.innerHTML = n.toLocaleString('ko-KR') + '<small>건</small>';
      subEl.textContent = '지금 지켜보고 있는 채용 공고예요.';
    }).catch(function () {
      nEl.textContent = '지금 지켜보고 있는 채용 공고';
      subEl.textContent = '지금은 수를 불러오지 못했습니다. 앱에서는 열 때마다 다시 셉니다.';
    });
  })();

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

    line(bigEl, '내 기술과 겹치는 채용 공고 ' + countAtLeast(active, m, 2) + '개');

    var observed = window30.length;
    if (observed < 5) {  // backtest.dart `thinSample`
      line(secondEl, '지난 30일에 올라온 게 ' + observed + '건뿐이라 아직 말하기 어려워요.');
      line(basisEl, '');
      line(scopeEl, '기술만으로 센 값이에요. 경력이랑 지역은 앱에서 좁혀요.');
      emitSignal('backtest-completed');
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
    emitSignal('backtest-completed');
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
      emitSignal('backtest-started');
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

  /** The rows arrive already reduced to what the rules read
   *  ({ s: normalized skills, d: posted day, a: active }), or null where the
   *  walk would not be honest (a failed page, more than 15 pages). */
  function load() {
    landingData().then(function (body) {
      var list = body && body.rows;
      if (!list || !list.length) throw 0;
      rows = list;
      render();
    }).catch(hideSection);
  }

  /* ---------- start ---------- */

  buildChips();
  render();
  section.hidden = false;   // no chips without the script that answers them

  // The request is already in flight for the hero count; this only waits on it.
  load();
})();

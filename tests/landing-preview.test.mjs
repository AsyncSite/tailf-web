import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { reduce } from '../lib/landing-data.mjs';

const script = await readFile(new URL('../app.js', import.meta.url), 'utf8');

// Run the shipped browser script, including chip clicks, against a small DOM.
// Network data is a saved response shape; this suite makes no external calls.
class Element {
  constructor(tag = 'div') {
    this.tag = tag;
    this.children = [];
    this.attributes = {};
    this.handlers = {};
    this.hidden = false;
    this.textContent = '';
    this.classList = { toggle() {}, add() {} };
  }
  appendChild(child) {
    if (child.tag === 'fragment') this.children.push(...child.children);
    else this.children.push(child);
    return child;
  }
  replaceChildren() { this.children = []; }
  setAttribute(k, v) { this.attributes[k] = v; }
  addEventListener(k, v) { this.handlers[k] = v; }
  set innerHTML(_) { throw new Error('Posting text must not be inserted as HTML'); }
}

const descendants = (el) => el.children.flatMap((c) => [c, ...descendants(c)]);
const textOf = (el) => [el.textContent, ...el.children.map(textOf)].join(' ');
const job = (id, skills, extra = {}) => ({
  id, skills, title: 'Engineer ' + id, company: 'Employer ' + id,
  sourceUrl: 'https://careers.example.org/' + id,
  isActive: true, postedAt: '2026-10-10', ...extra,
});

// sessionStorage stand-in. `store` seeds it; `throws` makes every call fail;
// `quiet` mimics a tab whose signals were already counted.
function fakeStorage({ store = {}, throws = false } = {}) {
  const fail = () => { throw new Error('storage disabled'); };
  return {
    data: store,
    getItem: (k) => (throws ? fail() : (k in store ? store[k] : null)),
    setItem: (k, v) => { if (throws) fail(); store[k] = String(v); },
  };
}

async function browser(rows, { fail = false, pathname = '/from/velog/', storage = null } = {}) {
  const ids = Object.fromEntries([
    'try', 'try-groups', 'try-big', 'try-second', 'try-basis', 'try-scope',
    'try-preview', 'try-preview-selected', 'try-preview-jobs',
  ].map((id) => [id, new Element()]));
  const calls = [];
  const frames = [];
  const listeners = {};
  const body = { appendChild: (el) => { frames.push(el.src); return el; } };
  const document = {
    body,
    getElementById: (id) => ids[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag) => { const el = new Element(tag); el.style = {}; return el; },
    createDocumentFragment: () => new Element('fragment'),
  };
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-10-15T12:00:00Z'])); }
  }
  vm.runInNewContext(script, {
    document, navigator: { userAgent: 'test' }, Date: FixedDate,
    window: {
      location: { pathname },
      sessionStorage: storage || { getItem: () => '1' },
      setTimeout: () => 0,
      addEventListener: (k, fn) => { listeners[k] = fn; },
    },
    setTimeout: () => 0,
    fetch: async (url) => {
      calls.push(url);
      if (fail) throw new Error('origin unavailable');
      return { ok: true, json: async () => ({ v: 2, rows }) };
    },
  });
  await new Promise(setImmediate);
  return {
    ids, calls, frames, listeners,
    click(label) {
      const chip = descendants(ids['try-groups']).find((el) => el.tag === 'button' && el.textContent === label);
      assert.ok(chip, 'real chip exists: ' + label);
      chip.handlers.click();
    },
    cards: () => ids['try-preview-jobs'].children,
    links: () => descendants(ids['try-preview-jobs']).filter((el) => el.tag === 'a'),
  };
}

test('cards and the count use the same active matches, including older open jobs', async () => {
  const rows = reduce({ content: [
    job(1, ['Python', 'AWS']),
    job(2, ['Python', 'AWS'], { isActive: false }),
    job(3, ['Python']),
    job(4, ['Python', 'AWS'], { postedAt: '2000-01-01' }),
    job(5, ['Python', 'AWS']), job(6, ['Python', 'AWS']),
  ] });
  const b = await browser(rows);
  b.click('Python');
  assert.equal(b.ids['try-preview'].hidden, true);
  b.click('AWS');
  assert.match(b.ids['try-big'].textContent, /4개$/);
  assert.equal(b.cards().length, 3);
  assert.deepEqual(b.links().map((el) => el.href), [
    '/p/1/from/velog/', '/p/4/from/velog/', '/p/5/from/velog/',
  ]);
  assert.match(b.ids['try-basis'].textContent, /겹친 공고 4건/); // includes the closed recent job, not the old open one
  assert.match(b.ids['try-preview-selected'].textContent, /Python · AWS/);
  assert.deepEqual(b.calls, ['/api/landing']);
});

test('three chosen skills match any two; changing back to one clears old cards', async () => {
  const b = await browser(reduce({ content: [job(7, ['Python', 'Kotlin'])] }));
  b.click('Python'); b.click('AWS');
  assert.match(b.ids['try-big'].textContent, /0개$/);
  assert.equal(b.ids['try-preview'].hidden, true);
  b.click('Kotlin');
  assert.equal(b.cards().length, 1);
  assert.match(textOf(b.cards()[0]), /Python Kotlin/);
  assert.doesNotMatch(textOf(b.cards()[0]), /AWS/);
  b.click('Python'); b.click('AWS');
  assert.equal(b.cards().length, 0);
  assert.equal(b.ids['try-preview'].hidden, true);
});

test('legacy cached rows keep their counts without inventing card identities', async () => {
  const b = await browser([{ s: ['python', 'aws'], d: '2026-10-10', a: true }]);
  b.click('Python'); b.click('AWS');
  assert.match(b.ids['try-big'].textContent, /1개$/);
  assert.equal(b.ids.try.hidden, false);
  assert.equal(b.ids['try-preview'].hidden, true);
  assert.equal(b.links().length, 0);
});

test('incomplete identities are skipped and duplicate IDs never fill the preview', async () => {
  const rows = reduce({ content: [
    job(null, ['Python', 'AWS']), job(8, ['Python', 'AWS'], { title: '' }),
    job(9, ['Python', 'AWS'], { company: null }), job(10, ['Python', 'AWS']),
    job(10, ['Python', 'AWS']), job(11, ['Python', 'AWS']),
  ] });
  const b = await browser(rows, { pathname: '/' });
  b.click('Python'); b.click('AWS');
  assert.match(b.ids['try-big'].textContent, /6개$/);
  assert.deepEqual(b.links().map((el) => el.href), ['/p/10/', '/p/11/']);
});

test('duplicate-skill overlap stays identical to existing counts and tags name only actual overlaps', async () => {
  const b = await browser(reduce({ content: [job(12, [' AWS ', 'aws', 'Git'])] }));
  b.click('Python'); b.click('AWS');
  assert.match(b.ids['try-big'].textContent, /1개$/);
  assert.equal(b.cards().length, 1);
  const tags = descendants(b.cards()[0]).filter((el) => el.tag === 'span');
  assert.deepEqual(tags.map((el) => el.textContent), ['AWS']);
});

test('public posting text stays literal and source URLs cannot replace the local posting route', async () => {
  const b = await browser(reduce({ content: [job(13, ['Python', 'AWS'], {
    title: '<img src=x onerror=alert(1)>', company: '<script>example</script>', sourceUrl: 'javascript:alert(1)',
  })] }));
  b.click('Python'); b.click('AWS');
  assert.match(textOf(b.cards()[0]), /<img src=x onerror=alert\(1\)>/);
  assert.equal(b.links()[0].href, '/p/13/from/velog/');
  assert.equal(b.links()[0].textContent, '공고 보기');
});

test('an unavailable or partial landing response leaves no cards behind', async () => {
  for (const options of [{ fail: true }, {}]) {
    const b = await browser(null, options);
    assert.equal(b.ids.try.hidden, true);
    assert.equal(b.cards().length, 0);
  }
});

const quietRows = (extra = []) => reduce({ content: [
  // five recent postings that overlap nothing the tests pick
  ...[21, 22, 23, 24, 25].map((id) => job(id, ['Java', 'Kotlin'])),
  ...extra,
] });

test('no new match in 30 days but open older ones: copy does not say nothing exists', async () => {
  const b = await browser(quietRows([job(30, ['C++', 'Redis'], { postedAt: '2026-07-31' })]));
  b.click('C++'); b.click('Redis');
  assert.match(b.ids['try-big'].textContent, /1개$/);
  assert.equal(b.cards().length, 1);
  assert.equal(b.ids['try-second'].textContent, '지난 30일엔 새로 올라온 게 없었어요');
  assert.match(b.ids['try-basis'].textContent, /지금 열린 1개는 그 전에 올라온 공고예요/);
  assert.doesNotMatch(textOf(b.ids.try) + b.ids['try-second'].textContent + b.ids['try-basis'].textContent, /0번이에요/);
});

test('no match at all keeps the original zero copy', async () => {
  const b = await browser(quietRows());
  b.click('C++'); b.click('Redis');
  assert.match(b.ids['try-big'].textContent, /0개$/);
  assert.equal(b.cards().length, 0);
  assert.equal(b.ids['try-second'].textContent, '0번이에요. 두 개 이상 겹친 공고가 없었거든요.');
  assert.equal(b.ids['try-basis'].textContent, '지난 30일에 올라온 5건을 봤어요.');
});

test('picks are saved per tab and restored without a duplicate user signal', async () => {
  const rows = reduce({ content: [job(1, ['Python', 'AWS']), job(2, ['Python', 'AWS'])] });
  // first visit: real taps emit once and save the picks
  const storage = fakeStorage();
  const first = await browser(rows, { storage });
  first.click('Python'); first.click('AWS');
  assert.deepEqual(JSON.parse(storage.data['tailf.picks.v1']), ['Python', 'AWS']);
  assert.deepEqual(first.frames, [
    '/signal/backtest-started/velog/', '/signal/backtest-completed/velog/',
  ]);

  // Back/reload in the same tab: signals are already counted, picks return
  const again = await browser(rows, { storage: fakeStorage({ store: { ...storage.data } }) });
  assert.match(again.ids['try-big'].textContent, /2개$/);
  assert.equal(again.cards().length, 2);
  assert.match(again.ids['try-preview-selected'].textContent, /Python · AWS/);
  assert.deepEqual(again.frames, []);

  // restored from a store with no signal keys: still silent until a real tap
  const fresh = fakeStorage({ store: { 'tailf.picks.v1': '["Python","AWS","Bogus"]' } });
  const quiet = await browser(rows, { storage: fresh });
  assert.equal(quiet.cards().length, 2);
  assert.deepEqual(quiet.frames, []);
  quiet.click('AWS');          // a real tap is counted normally
  assert.deepEqual(quiet.frames, ['/signal/backtest-started/velog/']);
  assert.deepEqual(JSON.parse(fresh.data['tailf.picks.v1']), ['Python']);
});

test('pageshow re-reads the saved picks', async () => {
  const rows = reduce({ content: [job(1, ['Python', 'AWS'])] });
  const storage = fakeStorage();
  const b = await browser(rows, { storage });
  assert.equal(b.cards().length, 0);
  storage.setItem('tailf.picks.v1', '["Python","AWS"]');
  b.listeners.pageshow({ persisted: true });
  assert.equal(b.cards().length, 1);
  assert.deepEqual(b.frames, []);
});

test('sessionStorage that throws or holds junk never breaks the page', async () => {
  const rows = reduce({ content: [job(1, ['Python', 'AWS'])] });
  const b = await browser(rows, { storage: fakeStorage({ throws: true }) });
  b.click('Python'); b.click('AWS');
  assert.equal(b.ids.try.hidden, false);
  assert.match(b.ids['try-big'].textContent, /1개$/);
  assert.equal(b.cards().length, 1);
  for (const junk of ['not json', '{"a":1}', '[1,null,"Python"]']) {
    const j = await browser(rows, { storage: fakeStorage({ store: { 'tailf.picks.v1': junk } }) });
    assert.equal(j.ids.try.hidden, false);
  }
});

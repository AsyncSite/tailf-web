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

async function browser(rows, { fail = false, pathname = '/from/velog/' } = {}) {
  const ids = Object.fromEntries([
    'try', 'try-groups', 'try-big', 'try-second', 'try-basis', 'try-scope',
    'try-preview', 'try-preview-selected', 'try-preview-jobs',
  ].map((id) => [id, new Element()]));
  const calls = [];
  const document = {
    getElementById: (id) => ids[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag) => new Element(tag),
    createDocumentFragment: () => new Element('fragment'),
  };
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-10-15T12:00:00Z'])); }
  }
  vm.runInNewContext(script, {
    document, navigator: { userAgent: 'test' }, Date: FixedDate,
    window: { location: { pathname }, sessionStorage: { getItem: () => '1' } },
    fetch: async (url) => {
      calls.push(url);
      if (fail) throw new Error('origin unavailable');
      return { ok: true, json: async () => ({ v: 2, rows }) };
    },
  });
  await new Promise(setImmediate);
  return {
    ids, calls,
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

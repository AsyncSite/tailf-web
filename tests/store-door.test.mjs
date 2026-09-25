import assert from 'node:assert/strict';
import test from 'node:test';

import { onRequest, platformOf, parseDoor, doorKey, APP_STORE_URL } from '../lib/store-door.mjs';

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Barcelona 350.0',
  android: 'Mozilla/5.0 (Linux; Android 15; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  preview: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
};

function fakeKv() {
  const store = new Map();
  return {
    store,
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
  };
}

async function hit(path, ua, kv, method = 'GET') {
  const waits = [];
  const res = await onRequest({
    request: new Request('https://tailf.asyncsite.com' + path, { method, headers: ua ? { 'User-Agent': ua } : {} }),
    env: { ALERTS: kv },
    next: async () => new Response('static', { status: 200 }),
    waitUntil: (p) => waits.push(p),
  });
  await Promise.all(waits);
  return res;
}

test('platform comes from the User-Agent and link previews are not readers', () => {
  assert.equal(platformOf(UA.iphone), 'ios');
  assert.equal(platformOf(UA.android), 'android');
  assert.equal(platformOf(UA.mac), 'desktop');
  assert.equal(platformOf(UA.preview), 'bot');
  assert.equal(platformOf(''), 'bot');
});

test('only known channel words are doors', () => {
  assert.deepEqual(parseDoor('/go/appstore/threads/'), { door: 'appstore', source: 'threads' });
  assert.deepEqual(parseDoor('/get/youtube/'), { door: 'get', source: 'youtube' });
  assert.deepEqual(parseDoor('/go/appstore/'), { door: 'appstore', source: '' });
  assert.deepEqual(parseDoor('/go/appstore/seo/'), { door: 'appstore', source: 'seo' });
  assert.equal(parseDoor('/go/appstore/somewhere/'), null);
  assert.equal(parseDoor('/go/appstore/threads'), null);
  assert.equal(parseDoor('/get/threads/extra/'), null);
});

test('the counter key is the KST day, door, channel and platform, nothing else', () => {
  // 2026-09-25 23:30 KST is 14:30 UTC
  assert.equal(doorKey(new Date('2026-09-25T14:30:00Z'), 'get', 'threads', 'android'), 'door:2026-09-25:get:threads:android');
  assert.equal(doorKey(new Date('2026-09-25T15:30:00Z'), 'appstore', '', 'ios'), 'door:2026-09-26:appstore:direct:ios');
});

test('an iPhone is counted and sent to the App Store', async () => {
  const kv = fakeKv();
  const res = await hit('/get/threads/?utm_source=threads', UA.iphone, kv);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('Location'), APP_STORE_URL);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const keys = [...kv.store.keys()];
  assert.equal(keys.length, 1);
  assert.match(keys[0], /^door:\d{4}-\d{2}-\d{2}:get:threads:ios$/);
  await hit('/get/threads/', UA.iphone, kv);
  assert.equal(kv.store.get(keys[0]), '2');
});

test('an Android phone gets one screen that opens the web alert form on its channel', async () => {
  const kv = fakeKv();
  const res = await hit('/go/appstore/threads/', UA.android, kv);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<a class="btn" href="\/alerts\/from\/threads\/">앱 없이 알림 받기<\/a>/);
  assert.match(html, /href="https:\/\/apps\.apple\.com\/kr\/app\/tailf\/id6808048845"/);
  assert.match(html, /cloudflareinsights\.com\/beacon\.min\.js/);
  assert.match(html, /noindex/);
  assert.doesNotMatch(html, /—/);
  assert.equal(res.headers.get('Vary'), 'User-Agent');
  assert.match([...kv.store.keys()][0], /:appstore:threads:android$/);
});

test('a PC gets the same screen, the bare door counts as direct', async () => {
  const kv = fakeKv();
  const html = await (await hit('/go/appstore/', UA.mac, kv)).text();
  assert.match(html, /href="\/alerts\/from\/landing\/"/);
  assert.match([...kv.store.keys()][0], /:appstore:direct:desktop$/);
});

test('link previews, HEAD requests and unknown words are not counted', async () => {
  const kv = fakeKv();
  const preview = await hit('/get/threads/', UA.preview, kv);
  assert.equal(preview.status, 200);
  await hit('/get/threads/', UA.iphone, kv, 'HEAD');
  const unknown = await hit('/go/appstore/somewhere/', UA.iphone, kv);
  assert.equal(await unknown.text(), 'static');
  assert.equal(kv.store.size, 0);
});

test('a broken counter never blocks the door', async () => {
  const broken = { async get() { throw new Error('kv down'); }, async put() { throw new Error('kv down'); } };
  const res = await hit('/get/threads/', UA.iphone, broken);
  assert.equal(res.status, 302);
  const noKv = await hit('/get/threads/', UA.android, undefined);
  assert.equal(noKv.status, 200);
});

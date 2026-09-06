import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../functions/p/[[path]].js', import.meta.url), 'utf8');
const { onRequest } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const job = {
  id: 42,
  title: 'Backend Engineer',
  company: 'Example',
  postedAt: '2026-09-05T00:00:00Z',
  isActive: true,
};

async function render(upstream) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => upstream;
  try {
    return await onRequest({
      request: new Request('https://tailf.asyncsite.com/p/42'),
      params: { path: ['42'] },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('renders a valid posting from a successful upstream response', async () => {
  const response = await render(Response.json(job));
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Backend Engineer/);
});

test('renders a missing posting only for an upstream 404', async () => {
  const response = await render(new Response('', { status: 404 }));
  assert.equal(response.status, 404);
  assert.match(await response.text(), /이 공고는 찾을 수 없어요/);
});

for (const status of [500, 503]) {
  test(`keeps upstream ${status} as a temporary error`, async () => {
    const response = await render(Response.json({ message: 'upstream error' }, { status }));
    assert.equal(response.status, 502);
    assert.match(await response.text(), /지금은 불러오지 못했어요/);
  });
}

test('keeps an empty successful response as a temporary error', async () => {
  const response = await render(new Response('', { status: 200 }));
  assert.equal(response.status, 502);
});

test('keeps a malformed successful response as a temporary error', async () => {
  const response = await render(new Response('{broken', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }));
  assert.equal(response.status, 502);
});

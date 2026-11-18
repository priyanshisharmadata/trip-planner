import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthFetch } from '../src/lib/auth-fetch';

const endpoint = 'https://exampleproject.supabase.co/auth/v1/signup';
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const isTimeout = (error: unknown) => error instanceof Error && error.name === 'AuthRequestTimeoutError'
  && 'code' in error && error.code === 'auth_request_timeout';

test('successful auth responses retain JSON, status and headers and release cancellation resources', async () => {
  const upstream = new AbortController();
  let nativeSignal: AbortSignal | null | undefined;
  const bounded = createAuthFetch(async (input, init) => {
    assert.equal(input, endpoint);
    assert.equal(init?.method, 'POST');
    assert.equal(init?.body, '{"email":"person@example.test"}');
    assert.equal(new Headers(init?.headers).get('apikey'), 'synthetic-public-key');
    nativeSignal = init?.signal;
    return new Response('{"id":"created-user"}', { status: 201, statusText: 'Created', headers: { 'X-Request-Id': 'test-request' } });
  }, 20);
  const response = await bounded(endpoint, {
    method: 'POST', body: '{"email":"person@example.test"}', headers: { apikey: 'synthetic-public-key' }, signal: upstream.signal,
  });
  assert.equal(response.status, 201);
  assert.equal(response.statusText, 'Created');
  assert.equal(response.headers.get('x-request-id'), 'test-request');
  assert.deepEqual(await response.json(), { id: 'created-user' });
  upstream.abort();
  await delay(30);
  assert.equal(nativeSignal?.aborted, false, 'Success must clear its timer and upstream abort listener.');
});

test('server errors remain HTTP responses for Supabase to classify', async () => {
  const bounded = createAuthFetch(async () => new Response('{"code":"invalid_credentials"}', { status: 400 }));
  const response = await bounded(endpoint);
  assert.equal(response.ok, false);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { code: 'invalid_credentials' });
});

test('stalled network requests time out and abort even when the fetch implementation ignores abort', async () => {
  let nativeSignal: AbortSignal | null | undefined;
  const bounded = createAuthFetch((_input, init) => {
    nativeSignal = init?.signal;
    return new Promise<Response>(() => {});
  }, 15);
  await assert.rejects(bounded(endpoint), isTimeout);
  assert.equal(nativeSignal?.aborted, true);
});

test('late network success after timeout is discarded before its body reaches the SDK', async () => {
  let complete: ((response: Response) => void) | undefined;
  let bodyRead = false;
  const bounded = createAuthFetch(() => new Promise<Response>((resolve) => { complete = resolve; }), 15);
  await assert.rejects(bounded(endpoint), isTimeout);
  const late = new Response('{"access_token":"synthetic-late-token"}');
  late.text = async () => { bodyRead = true; return '{}'; };
  complete?.(late);
  await delay(0);
  assert.equal(bodyRead, false);
});

test('the deadline also covers a response body that never finishes', async () => {
  let nativeSignal: AbortSignal | null | undefined;
  const bounded = createAuthFetch(async (_input, init) => {
    nativeSignal = init?.signal;
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"unfinished":')); },
    }));
  }, 15);
  await assert.rejects(bounded(endpoint), isTimeout);
  assert.equal(nativeSignal?.aborted, true);
});

test('an already cancelled caller never starts a network request', async () => {
  const upstream = new AbortController();
  const reason = new Error('Caller cancelled');
  upstream.abort(reason);
  let calls = 0;
  const bounded = createAuthFetch(async () => { calls++; return new Response('{}'); });
  await assert.rejects(bounded(endpoint, { signal: upstream.signal }), (error) => error === reason);
  assert.equal(calls, 0);
});

test('caller cancellation during the request propagates its reason and aborts the network', async () => {
  const upstream = new AbortController();
  const reason = new Error('Caller cancelled');
  let nativeSignal: AbortSignal | null | undefined;
  const bounded = createAuthFetch((_input, init) => {
    nativeSignal = init?.signal;
    return new Promise<Response>(() => {});
  });
  const request = bounded(endpoint, { signal: upstream.signal });
  const rejected = assert.rejects(request, (error) => error === reason);
  await Promise.resolve();
  upstream.abort(reason);
  await rejected;
  assert.equal(nativeSignal?.aborted, true);
});

test('a Request input supplies its caller cancellation signal', async () => {
  const upstream = new AbortController();
  const request = new Request(endpoint, { signal: upstream.signal });
  upstream.abort();
  let calls = 0;
  const bounded = createAuthFetch(async () => { calls++; return new Response('{}'); });
  await assert.rejects(bounded(request), (error) => error instanceof Error && error.name === 'AbortError');
  assert.equal(calls, 0);
});

test('network failures are preserved without waiting for the timeout', async () => {
  const failure = new TypeError('Network request failed');
  const bounded = createAuthFetch(async () => { throw failure; });
  await assert.rejects(bounded(endpoint), (error) => error === failure);
});

test('empty sign-out responses can still be returned without an illegal response body', async () => {
  const bounded = createAuthFetch(async () => new Response(null, { status: 204 }));
  const response = await bounded(endpoint);
  assert.equal(response.status, 204);
  assert.equal(await response.text(), '');
});

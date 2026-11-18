export const AUTH_REQUEST_TIMEOUT_MS = 15_000;

function timeoutError(): Error {
  return Object.assign(new Error('Account request timed out.'), {
    name: 'AuthRequestTimeoutError', code: 'auth_request_timeout',
  });
}

function abortError(): Error {
  return Object.assign(new Error('Account request was cancelled.'), { name: 'AbortError' });
}

// Supabase Auth returns small JSON responses. Buffer the body before returning so
// the same deadline covers both connecting and reading it. This transport is not
// intended for streaming downloads or other large responses.
export function createAuthFetch(
  fetcher: typeof fetch = globalThis.fetch,
  timeoutMs = AUTH_REQUEST_TIMEOUT_MS,
): typeof fetch {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('A positive request timeout is required.');

  return (input, init) => new Promise<Response>((resolve, reject) => {
    const controller = new AbortController();
    const upstream = init && 'signal' in init
      ? init.signal
      : typeof input === 'object' && 'signal' in input ? input.signal : undefined;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      clearTimeout(timer);
      upstream?.removeEventListener('abort', onAbort);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      // Reject independently of fetch honoring abort; a late result must never
      // reach the auth SDK and turn a timed-out action into a signed-in session.
      controller.abort();
      reject(error);
    };
    const onAbort = () => fail(upstream?.reason ?? abortError());

    if (upstream?.aborted) { onAbort(); return; }
    upstream?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => fail(timeoutError()), timeoutMs);

    void Promise.resolve().then(async () => {
      if (settled) return;
      const response = await fetcher(input, { ...init, signal: controller.signal });
      if (settled) return;
      const body = await response.text();
      if (settled) return;
      const buffered = new Response([204, 205, 304].includes(response.status) ? null : body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
      settled = true;
      cleanup();
      resolve(buffered);
    }).catch(fail);
  });
}

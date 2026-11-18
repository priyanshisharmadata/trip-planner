import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlannerHandler } from '../supabase/functions/generate-trip-plan/handler';
import { providerFailure, type ProviderDiagnostic } from '../supabase/functions/generate-trip-plan/provider-errors';
import { canonicalMapsUrl, validateAiPlannerRequest, validateAiPlannerResponse, type AiPlannerRequest } from '../supabase/functions/_shared/ai-planner';
import { findCatalogDestination, type CatalogPlace } from '../supabase/functions/_shared/destination-catalog';

const token = 'synthetic-valid-session-token';
const catalog = findCatalogDestination('Jaipur')!;
const chosenPlaces = [...catalog.places.filter(place => place.kind === 'attraction').slice(0, 2), catalog.places.find(place => place.kind === 'stay')!];
const placeUrls = chosenPlaces.map(place => canonicalMapsUrl(place.mapsUrl)!);
const names = chosenPlaces.map(place => place.name);
const request: AiPlannerRequest = {
  input: { destination: 'Jaipur', startDate: '2030-01-12', endDate: '2030-01-13', budget: 10_000, travelers: 2, interests: ['culture'], pace: 'balanced', stayPreference: 'budget' },
  excludedPlaceIds: [], excludedPlaceNames: [], variation: 0, flexibilityPercent: 10,
};
const environment: Record<string, string> = {
  SUPABASE_URL: 'https://testproject.supabase.co', SUPABASE_ANON_KEY: 'synthetic-public-key', GEMINI_API_KEY: 'synthetic-provider-secret',
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const interaction = (value: unknown) => ({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify(value) }] }] });
const structured = (available: CatalogPlace[] = catalog.places) => {
  const selected = [...available.filter(place => place.kind === 'attraction').slice(0, 2), available.find(place => place.kind === 'stay')!];
  const sourceIndex = (place: CatalogPlace) => available.indexOf(place) + 1;
  return {
  canFitBudget: true, summary: 'A relaxed heritage trip around Jaipur.',
  places: selected.map(place => ({ sourceIndex: sourceIndex(place), kind: place.kind as string, reason: 'Matches your culture interests.', popularityReason: 'A researched destination.' })),
  days: [1, 2].map(day => ({ day, stops: [{ sourceIndex: sourceIndex(selected[day - 1]), time: '10:00', note: 'Check current visitor access.', allowancePerPerson: 500 }] })),
  allowances: { nightlyPerRoom: 2000, foodPerPersonPerDay: 500, localTransportPerGroupPerDay: 500 },
  notes: ['Confirm the actual room quote before booking.'],
}; };
function httpRequest(body: unknown = request, authorization: string | null = `Bearer ${token}`) {
  return new Request('https://testproject.supabase.co/functions/v1/generate-trip-plan', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) }, body: JSON.stringify(body),
  });
}
function harness(options: { providerError?: unknown; formatted?: unknown; authStatus?: number; providerStatus?: number; env?: Record<string, string>; timeoutMs?: number; hangAt?: 'auth' | 'provider' | 'body' } = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const diagnostics: ProviderDiagnostic[] = [];
  const events: { event: string; stage: string; elapsedMs: number; status?: number; code?: string }[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/auth/v1/user')) {
      if (options.hangAt === 'auth') return new Promise(() => {});
      return json({ id: 'user-a', is_anonymous: false }, options.authStatus ?? 200);
    }
    if (options.hangAt === 'provider') return new Promise(() => {});
    if (options.hangAt === 'body') return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); } }));
    return json(options.providerError ?? interaction(options.formatted ?? structured()), options.providerStatus ?? 200);
  };
  const handler = createPlannerHandler({ env: name => (options.env ?? environment)[name], fetcher, diagnostic: event => diagnostics.push(event), telemetry: event => events.push(event), timeoutMs: options.timeoutMs ?? 1000, cooldownMs: 0, now: () => Date.parse('2030-01-01T00:00:00Z') });
  return { handler, calls, diagnostics, events };
}

test('request validation bounds dates, budget, variation, preferences and exclusions', () => {
  assert.deepEqual(validateAiPlannerRequest(request), request);
  for (const change of [{ budget: NaN }, { travelers: 0 }, { startDate: '2030-02-30' }, { endDate: '2030-02-01' }, { interests: ['unknown'] }, { destination: 'x'.repeat(101) }]) {
    assert.throws(() => validateAiPlannerRequest({ ...request, input: { ...request.input, ...change } }), /Choose a destination/);
  }
  for (const change of [{ variation: 101 }, { flexibilityPercent: 99 }, { excludedPlaceIds: ['https://evil.example/maps'] }, { excludedPlaceNames: Array(101).fill('name') }]) assert.throws(() => validateAiPlannerRequest({ ...request, ...change }));
});

test('Maps link guard rejects credentials, fake hosts, fragments and non-Maps Google paths', () => {
  assert.equal(canonicalMapsUrl('https://www.google.com/maps/place/AmberFort?utm_source=test&hl=en'), 'https://www.google.com/maps/place/AmberFort');
  assert.ok(canonicalMapsUrl('https://vertexaisearch.cloud.google.com/grounding-api-redirect/real-source'));
  for (const url of ['javascript:alert(1)', 'https://google.com.evil.example/maps/place/x', 'https://www.google.com/url?url=https://evil.example', 'https://user:pass@maps.google.com/maps', `${placeUrls[0]}#redirect`, 'https://maps.google.com:8443/maps']) assert.equal(canonicalMapsUrl(url), null);
});

test('unauthenticated or invalid sessions never call Gemini', async () => {
  const unauthenticated = harness();
  assert.equal((await unauthenticated.handler(httpRequest(request, null))).status, 401);
  assert.equal(unauthenticated.calls.length, 0);
  const invalid = harness({ authStatus: 401 });
  assert.equal((await invalid.handler(httpRequest())).status, 401);
  assert.equal(invalid.calls.length, 1);
});

test('unconfigured Gemini returns an actionable error after verifying the user', async () => {
  const { handler, calls } = harness({ env: { SUPABASE_URL: environment.SUPABASE_URL, SUPABASE_ANON_KEY: environment.SUPABASE_ANON_KEY } });
  const response = await handler(httpRequest());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'NOT_CONFIGURED');
  assert.equal(calls.length, 1);
});

test('curated result uses catalog names and costs with exactly one stateless provider request and no paid tools', async () => {
  const formatted = { ...structured(), total: 1, places: structured().places.map(place => ({ ...place, name: 'Invented model name', mapsUrl: 'https://evil.example' })) };
  const { handler, calls, events } = harness({ formatted });
  const response = await handler(httpRequest());
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.places.map((place: { name: string }) => place.name), names);
  assert.equal(result.basis, 'curated');
  assert.deepEqual(result.references, catalog.sources);
  assert.deepEqual(result.budget, { stay: 2000, food: 2000, transport: 1000, activities: 2000, contingency: 700, total: 7700, currency: 'INR', isEstimate: true });
  assert.deepEqual(validateAiPlannerResponse(result, request), result);
  assert.equal(calls.length, 2);
  assert.equal(new Headers(calls[0].init?.headers).get('authorization'), `Bearer ${token}`);
  for (const call of calls.slice(1)) {
    const body = JSON.parse(String(call.init?.body));
    assert.equal(body.store, false);
    assert.equal(body.tools, undefined, 'Free planning must not invoke paid Maps or Search grounding.');
    assert.equal(body.model, 'gemini-3.5-flash-lite');
    assert.equal(body.generation_config.thinking_level, 'minimal');
    assert.equal(body.generation_config.max_output_tokens, 2600);
    assert.ok(!body.response_format.schema.properties.places.items.required.includes('popularityReason'));
    assert.equal(new Headers(call.init?.headers).get('authorization'), null, 'User access tokens must never go to Gemini.');
    assert.equal(new Headers(call.init?.headers).get('x-goog-api-key'), environment.GEMINI_API_KEY);
  }
  assert.equal(JSON.parse(String(calls[1].init?.body)).response_format.mime_type, 'application/json');
  assert.ok(!JSON.stringify(result).includes(environment.GEMINI_API_KEY));
  assert.deepEqual(events.map(event => event.event), ['ai_planner_authenticated', 'ai_planner_provider_started', 'ai_planner_provider_response', 'ai_planner_completed']);
  assert.ok(!JSON.stringify(events).includes(request.input.destination));
  assert.ok(!JSON.stringify(events).includes(environment.GEMINI_API_KEY));
});

test('model overrides are preserved without unsupported thinking settings', async () => {
  for (const [model, thinking] of [['gemini-3.8-flash', 'low'], ['custom-model', undefined]] as const) {
    const { handler, calls } = harness({ env: { ...environment, GEMINI_MODEL: model } });
    assert.equal((await handler(httpRequest())).status, 200);
    const body = JSON.parse(String(calls[1].init?.body));
    assert.equal(body.model, model);
    assert.equal(body.generation_config.thinking_level, thinking);
  }
});

test('unsupported destinations return immediately without any network calls even when Auth would stall', async () => {
  const { handler, calls, events } = harness({ hangAt: 'auth', timeoutMs: 15 });
  const response = await handler(httpRequest({ ...request, input: { ...request.input, destination: 'Unknown destination' } }));
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, 'UNSUPPORTED_DESTINATION');
  assert.equal(calls.length, 0);
  assert.equal(events.at(-1)?.stage, 'request');
});

test('insufficient catalog coverage fails before Auth or provider requests', async () => {
  const longer = harness();
  const unavailable = await longer.handler(httpRequest({ ...request, input: { ...request.input, endDate: '2030-01-25' } }));
  assert.equal((await unavailable.json()).error.code, 'NO_NEW_SUGGESTIONS');
  assert.equal(longer.calls.length, 0);
});

test('unknown source indices and repeated sightseeing stops are rejected', async () => {
  const fakeSource = structured(); fakeSource.places[0].sourceIndex = 99;
  assert.equal((await harness({ formatted: fakeSource }).handler(httpRequest())).status, 422);
  const repeated = structured(); repeated.days[1].stops[0].sourceIndex = 1;
  assert.equal((await harness({ formatted: repeated }).handler(httpRequest())).status, 502);
});

test('Suggest more removes previous canonical URLs and normalized names', async () => {
  const attractions = catalog.places.filter(place => place.kind === 'attraction');
  for (const exclude of [{ excludedPlaceIds: attractions.map(place => place.mapsUrl) }, { excludedPlaceNames: attractions.map(place => `  ${place.name.toUpperCase().replace(/ /g, '---')}  `) }]) {
    const { handler, calls } = harness();
    const response = await handler(httpRequest({ ...request, ...exclude, variation: 1 }));
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error.code, 'NO_NEW_SUGGESTIONS');
    assert.equal(calls.length, 0);
  }
  const available = catalog.places.filter(place => place !== chosenPlaces[0]);
  const changed = harness({ formatted: structured(available) });
  const fresh = await changed.handler(httpRequest({ ...request, excludedPlaceIds: [placeUrls[0]], variation: 1 }));
  assert.equal(fresh.status, 200);
  assert.ok(!(await fresh.json()).places.some((place: { id: string }) => place.id === placeUrls[0]));
});

test('budget flexibility is enforced on computed totals without reducing estimates', async () => {
  const tight = { ...request, input: { ...request.input, budget: 7000 } };
  const accepted = await harness().handler(httpRequest(tight));
  assert.equal(accepted.status, 200, '7700 is within the selected 10% flexibility.');
  assert.equal((await accepted.json()).budget.total, 7700);
  const strict = await harness().handler(httpRequest({ ...tight, flexibilityPercent: 0 }));
  assert.equal(strict.status, 422);
  assert.equal((await strict.json()).error.code, 'BUDGET_EXCEEDED');
});

test('catalog attraction kinds cannot be changed by the model', async () => {
  const noAttraction = structured(); noAttraction.places[0].kind = 'food';
  const response = await harness({ formatted: noAttraction }).handler(httpRequest());
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error.code, 'INVALID_RESPONSE');
});

test('curated response validation rejects invented places, mismatched kinds and arbitrary source links', async () => {
  const response = await harness().handler(httpRequest());
  const valid = await response.json();
  assert.deepEqual(validateAiPlannerResponse(valid, request), valid);
  for (const modify of [
    (value: typeof valid) => { value.places[0].name = 'Invented attraction'; },
    (value: typeof valid) => { value.places[0].kind = 'stay'; },
    (value: typeof valid) => { value.places[0].id = value.places[0].mapsUrl = 'https://www.google.com/maps/place/Invented'; },
    (value: typeof valid) => { value.references[0].url = 'https://untrusted.example/place'; },
    (value: typeof valid) => { value.references[0].label = 'Invented attribution'; },
  ]) {
    const forged = structuredClone(valid); modify(forged);
    assert.throws(() => validateAiPlannerResponse(forged, request));
  }
});

test('provider quota is not reported as the local cooldown and never leaks provider content', async () => {
  const { handler, calls, diagnostics } = harness({ providerStatus: 429, providerError: { error: { message: environment.GEMINI_API_KEY } } });
  const response = await handler(httpRequest());
  assert.equal(response.status, 503, 'Existing APKs must not mistake provider quota for their own cooldown.');
  const body = await response.text();
  assert.match(body, /PROVIDER_QUOTA_EXHAUSTED/);
  assert.ok(!JSON.stringify({ body, diagnostics }).includes(environment.GEMINI_API_KEY));
  assert.equal(diagnostics[0].stage, 'formatting');
  assert.equal(diagnostics[0].status, 429);
  assert.equal(response.headers.get('retry-after'), null, 'Daily/zero quota cannot promise a ten-second recovery.');
  assert.equal(calls.length, 2);
});

test('provider quota metadata distinguishes zero/daily quota, temporary limits and setup errors', () => {
  const limited = (quotaId: string, quotaValue: string) => ({ error: { message: 'Private project data must never be logged', details: [
    { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaId, quotaValue, quotaDimensions: { project: 'private-project-id' } }] },
    { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '12.2s' },
  ] } });
  for (const [limit, value, expected] of [
    ['GenerateRequestsPerMinutePerProjectPerModel-FreeTier', '0', 'PROVIDER_QUOTA_EXHAUSTED'],
    ['GenerateRequestsPerDayPerProjectPerModel-FreeTier', '20', 'PROVIDER_QUOTA_EXHAUSTED'],
    ['GenerateRequestsPerMinutePerProjectPerModel-FreeTier', '5', 'PROVIDER_RATE_LIMITED'],
  ]) {
    const result = providerFailure(429, limited(limit, value), 'formatting', null);
    assert.equal(result.error.code, expected);
    assert.equal(result.diagnostic.retrySeconds, 13);
    assert.equal(result.diagnostic.quota[0].value, Number(value));
    assert.ok(!JSON.stringify(result).includes('private-project-id'));
    assert.ok(!JSON.stringify(result).includes('Private project data'));
  }
  for (const [status, reason, expected] of [
    [403, 'BILLING_DISABLED', 'BILLING_REQUIRED'],
    [400, 'API_KEY_INVALID', 'KEY_REJECTED'],
    [404, 'MODEL_NOT_FOUND', 'MODEL_UNAVAILABLE'],
    [503, 'SERVER_BUSY', 'CAPACITY_UNAVAILABLE'],
  ] as const) {
    const result = providerFailure(status, { error: { details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason }] } }, 'discovery', null);
    assert.equal(result.diagnostic.providerCode, expected);
    assert.equal(result.error.status, 503);
  }
  const zeroWithoutValue = providerFailure(429, { error: { message: 'Quota exceeded for metric: model requests, limit: 0', details: [
    { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '8s' },
  ] } }, 'discovery', null);
  assert.equal(zeroWithoutValue.error.code, 'PROVIDER_QUOTA_EXHAUSTED');
  assert.equal(zeroWithoutValue.retrySeconds, undefined, 'An upstream retry hint cannot fix a zero allowance.');
});

test('oversized provider error bodies fail safely without retries', async () => {
  const { handler, calls, diagnostics } = harness({ providerStatus: 429, providerError: { message: 'x'.repeat(40_000), private: environment.GEMINI_API_KEY } });
  const response = await handler(httpRequest());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'PROVIDER_QUOTA_EXHAUSTED');
  assert.equal(calls.length, 2);
  assert.ok(!JSON.stringify(diagnostics).includes(environment.GEMINI_API_KEY));
});

test('deadline aborts stalled authentication, provider transport and response body', async () => {
  for (const hangAt of ['auth', 'provider', 'body'] as const) {
    const { handler, calls, events } = harness({ hangAt, timeoutMs: 15 });
    const response = await handler(httpRequest());
    assert.equal(response.status, 504, hangAt);
    assert.equal((await response.json()).error.code, 'UPSTREAM_TIMEOUT');
    assert.equal(calls.at(-1)?.init?.signal?.aborted, true);
    assert.deepEqual(events.at(-1), { event: 'ai_planner_failed', stage: hangAt === 'body' ? 'provider_body' : hangAt, elapsedMs: 0, status: 504, code: 'UPSTREAM_TIMEOUT' });
    assert.ok(!JSON.stringify(events).includes(token));
  }
});

test('same user concurrent requests are throttled while the first request remains active', async () => {
  let release: (() => void) | undefined;
  let signalStarted: (() => void) | undefined;
  const started = new Promise<void>(resolve => { signalStarted = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  let providerCalls = 0;
  const handler = createPlannerHandler({ env: name => environment[name], timeoutMs: 1000, fetcher: async url => {
    if (String(url).endsWith('/user')) return json({ id: 'user-a' });
    providerCalls++;
    if (providerCalls === 1) { signalStarted?.(); await pending; }
    return json(interaction(structured()));
  } });
  const first = handler(httpRequest());
  await started;
  const second = await handler(httpRequest());
  assert.equal(second.status, 429);
  assert.equal((await second.json()).error.code, 'REQUEST_IN_PROGRESS');
  assert.equal(providerCalls, 1);
  release?.();
  assert.equal((await first).status, 200);
});

test('preflight is public, other methods are rejected, malformed bodies never call external services', async () => {
  const { handler, calls } = harness();
  assert.equal((await handler(new Request('https://test.example', { method: 'OPTIONS' }))).status, 204);
  assert.equal((await handler(new Request('https://test.example'))).status, 405);
  const malformed = new Request('https://test.example', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{' });
  assert.equal((await handler(malformed)).status, 400);
  assert.equal(calls.length, 0);
});

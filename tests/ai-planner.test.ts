import assert from 'node:assert/strict';
import test from 'node:test';
import { AiPlannerError, aiResponseToPlan, generateAiPlan, requestAiPlan } from '../src/lib/ai-planner';
import { canonicalMapsUrl, validateAiPlannerResponse, type AiPlannerRequest, type AiPlannerResponse } from '../supabase/functions/_shared/ai-planner';
import { findCatalogDestination } from '../supabase/functions/_shared/destination-catalog';
import { tripTotal, type Trip } from '../src/lib/trips';
import { decodeTrips } from '../src/lib/trip-storage';
import type { PlannerInput } from '../src/lib/planner';

const input: PlannerInput = { destination: 'Jaipur', startDate: '2030-02-10', endDate: '2030-02-11', budget: 4200, travelers: 2, interests: ['culture'], pace: 'relaxed', stayPreference: 'budget' };
const request: AiPlannerRequest = { input, excludedPlaceIds: [], excludedPlaceNames: [], variation: 0, flexibilityPercent: 10 };
const config = { url: 'https://exampleproject.supabase.co', key: 'sb_publishable_synthetic', accessToken: 'synthetic-session-token' };
function fixture(): AiPlannerResponse {
  const places = [
    { name: 'Amber Palace', kind: 'attraction' as const },
    { name: 'Jantar Mantar', kind: 'attraction' as const },
    { name: 'Synthetic Hotel', kind: 'stay' as const },
  ].map((place, i) => ({ ...place, id: `https://maps.google.com/?cid=${i + 100}`, mapsUrl: `https://maps.google.com/?cid=${i + 100}`, reason: 'Synthetic test recommendation.', popularityReason: 'Synthetic fixture, not a real popularity claim.' }));
  return {
    version: 1, generatedAt: '2026-10-28T00:00:00Z', summary: 'Synthetic test itinerary.', places,
    days: places.slice(0, 2).map((place, i) => ({ day: i + 1, stops: [{ placeId: place.id, time: '10:00', note: 'Check opening hours.' }] })),
    budget: { stay: 2000, food: 1200, transport: 600, activities: 200, contingency: 400, total: 4400, currency: 'INR', isEstimate: true }, notes: ['Costs are estimated.'],
  };
}

function curatedFixture(): AiPlannerResponse {
  const catalog = findCatalogDestination(input.destination)!;
  const selected = [...catalog.places.filter(place => place.kind === 'attraction').slice(0, 2), catalog.places.find(place => place.kind === 'stay')!];
  const places = selected.map(place => ({
    id: canonicalMapsUrl(place.mapsUrl)!, mapsUrl: place.mapsUrl, name: place.name, kind: place.kind,
    reason: place.description, popularityReason: 'Selected from the researched destination list.',
  }));
  return {
    ...fixture(), basis: 'curated', references: catalog.sources.map(source => ({ ...source })), places,
    days: places.slice(0, 2).map((place, i) => ({ day: i + 1, stops: [{ placeId: place.id, time: '10:00', note: 'Check opening hours.' }] })),
  };
}

test('AI preview and saved itinerary use identical group costs and retain Maps attribution', () => {
  const plan = aiResponseToPlan(input, validateAiPlannerResponse(fixture(), request));
  assert.equal(plan.summary.shortfall, 200);
  assert.equal(plan.summary.isFeasible, false);
  assert.equal(plan.breakdown.total, 4400);
  assert.equal(Math.round(plan.activities.reduce((sum, activity) => sum + activity.cost, 0) * 100) / 100, 4400);
  assert.equal(plan.stays[0].nightlyPerRoom, 2000);
  assert.match(plan.stays[0].note, /not a price quoted/i);
  assert.equal(plan.ai.basis, 'google_maps');
  assert.deepEqual(plan.ai.references, []);
  assert.equal(plan.ai.activitySources['2030-02-10|10:00'].place.name, 'Amber Palace');
  const trip: Trip = { ...plan.draft, id: 'ai-test', activities: plan.activities.map((activity, i) => ({ ...activity, id: String(i), done: false })) };
  const [restored] = decodeTrips(JSON.stringify({ version: 1, trips: [trip] }));
  assert.equal(tripTotal(restored), 4400);
  assert.equal(restored.activities.find(activity => activity.title === 'Amber Palace')?.source?.url, 'https://maps.google.com/?cid=100');
});

test('curated previews separate official research from navigation and keep area allowances when saved', () => {
  const response = curatedFixture();
  const plan = aiResponseToPlan(input, validateAiPlannerResponse(response, request));
  assert.equal(plan.ai.basis, 'curated');
  assert.deepEqual(plan.sources, response.references);
  assert.deepEqual(plan.ai.references, response.references);
  assert.ok(plan.sources.every(source => !source.url.includes('google.com')));
  assert.equal(plan.stays[0].type, 'Suggested stay area');
  assert.match(plan.stays[0].note, /Explore accommodation in this area/);
  assert.match(plan.stays[0].note, /not a hotel quote or confirmed availability/);
  assert.match(plan.summary.notes[0], /Google Maps links are for navigation/);
  assert.match(plan.summary.notes[0], /no live hotel rates/);
  assert.doesNotMatch(plan.summary.notes[0], /using Google Maps sources/);
  const trip: Trip = { ...plan.draft, id: 'curated-test', activities: plan.activities.map((activity, i) => ({ ...activity, id: String(i), done: false })) };
  const [restored] = decodeTrips(JSON.stringify({ version: 1, trips: [trip] }));
  assert.equal(tripTotal(restored), plan.breakdown.total);
  assert.equal(restored.activities.find(activity => activity.title === response.places[0].name)?.source?.url, canonicalMapsUrl(response.places[0].mapsUrl));
});

test('curated responses with invented references or place names cannot become a preview', async () => {
  const wrongReference = curatedFixture();
  wrongReference.references![0].url = 'https://attacker.example/travel';
  const wrongName = curatedFixture();
  wrongName.places[0].name = 'Invented Jaipur attraction';
  for (const body of [wrongReference, wrongName]) {
    await assert.rejects(requestAiPlan(request, config, { fetcher: async () => new Response(JSON.stringify(body)) }), (error: unknown) => error instanceof AiPlannerError && error.code === 'INVALID_RESPONSE');
  }
});

test('fractional allowances split over days without losing cents', () => {
  const response = fixture();
  response.budget = { stay: 2000.01, food: 1200.01, transport: 600.01, activities: 200.01, contingency: 400, total: 4400.04, currency: 'INR', isEstimate: true };
  const plan = aiResponseToPlan(input, validateAiPlannerResponse(response, request));
  assert.equal(Math.round(plan.activities.reduce((sum, activity) => sum + activity.cost, 0) * 100) / 100, response.budget.total);
});

test('planner requests use the signed-in session and send exclusion history without provider secrets', async () => {
  let calls = 0;
  const result = await requestAiPlan({ ...request, variation: 1, excludedPlaceIds: ['https://maps.google.com/?cid=999'], excludedPlaceNames: ['Old place'] }, config, {
    fetcher: async (url, init) => {
      calls++;
      assert.equal(url, `${config.url}/functions/v1/generate-trip-plan`);
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer synthetic-session-token');
      const sent = JSON.parse(String(init?.body));
      assert.equal(sent.variation, 1);
      assert.deepEqual(sent.excludedPlaceNames, ['Old place']);
      assert.ok(!JSON.stringify(sent).includes('GEMINI_API_KEY'));
      return new Response(JSON.stringify(fixture()), { status: 200 });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.places[0].name, 'Amber Palace');
});

test('unsafe sources, excluded repeats, and over-limit costs cannot become a preview', async () => {
  const invalidSource = fixture(); invalidSource.places[0].mapsUrl = 'https://attacker.example/place';
  const overBudget = fixture(); overBudget.budget.food = 2000; overBudget.budget.contingency = 480; overBudget.budget.total = 5280;
  for (const body of [invalidSource, overBudget]) {
    await assert.rejects(requestAiPlan(request, config, { fetcher: async () => new Response(JSON.stringify(body)) }), (error: unknown) => error instanceof AiPlannerError && error.code === 'INVALID_RESPONSE');
  }
  await assert.rejects(requestAiPlan({ ...request, excludedPlaceNames: ['amber PALACE'] }, config, { fetcher: async () => new Response(JSON.stringify(fixture())) }), /could not be checked/i);
  await assert.rejects(requestAiPlan({ ...request, flexibilityPercent: 0 }, config, { fetcher: async () => new Response(JSON.stringify(fixture())) }), /could not be checked/i);
});

test('service failures are explained without leaking provider response details or retrying', async () => {
  let calls = 0;
  await assert.rejects(requestAiPlan(request, config, { fetcher: async () => {
    calls++; return new Response(JSON.stringify({ error: { code: 'NOT_CONFIGURED', message: 'secret-provider-error-detail' } }), { status: 503 });
  } }), (error: unknown) => error instanceof AiPlannerError && /offline planner/i.test(error.message) && !error.message.includes('secret-provider-error-detail'));
  assert.equal(calls, 1);
});

test('provider quota and request limits remain distinct from the app cooldown despite HTTP 429', async () => {
  const cases = [
    { code: 'PROVIDER_QUOTA_EXHAUSTED', expected: /Google AI Studio quota and billing/, missing: /Please wait a little/ },
    { code: 'PROVIDER_RATE_LIMITED', expected: /AI service has reached its request limit/, missing: /app owner/i },
    { code: 'RATE_LIMITED', expected: /Please wait a little/, missing: /quota and billing/ },
  ];
  for (const { code, expected, missing } of cases) {
    let calls = 0;
    await assert.rejects(requestAiPlan(request, config, { fetcher: async () => {
      calls++;
      return new Response(JSON.stringify({ error: { code, message: 'private-provider-payload' } }), { status: 429 });
    } }), (error: unknown) => {
      assert.ok(error instanceof AiPlannerError);
      assert.equal(error.code, code);
      assert.match(error.message, expected);
      assert.doesNotMatch(error.message, missing);
      assert.doesNotMatch(error.message, /private-provider-payload/);
      if (code === 'PROVIDER_QUOTA_EXHAUSTED') assert.match(error.message, /Repeated retries will not fix this/);
      return true;
    });
    assert.equal(calls, 1, 'Neither provider failures nor cooldowns should trigger automatic retries.');
  }
});

test('provider setup errors and active requests show their actionable static messages', async () => {
  for (const [code, status, expected] of [
    ['PROVIDER_NOT_CONFIGURED', 503, /check the API key and model access/],
    ['REQUEST_IN_PROGRESS', 409, /already being generated/],
  ] as const) {
    await assert.rejects(requestAiPlan(request, config, { fetcher: async () => new Response(JSON.stringify({ error: { code, message: 'unsafe-server-details' } }), { status }) }), (error: unknown) => {
      assert.ok(error instanceof AiPlannerError);
      assert.equal(error.code, code);
      assert.match(error.message, expected);
      assert.doesNotMatch(error.message, /unsafe-server-details/);
      return true;
    });
  }
});

test('unsupported destinations explain the limited catalog and offer offline planning safely', async () => {
  await assert.rejects(requestAiPlan(request, config, { fetcher: async () => new Response(JSON.stringify({ error: { code: 'UNSUPPORTED_DESTINATION', message: 'unsafe-server-details' } }), { status: 422 }) }), (error: unknown) => {
    assert.ok(error instanceof AiPlannerError);
    assert.equal(error.code, 'UNSUPPORTED_DESTINATION');
    assert.match(error.message, /Jaipur, Goa, Manali, Delhi, Mumbai and Bali/);
    assert.match(error.message, /offline planner/);
    assert.doesNotMatch(error.message, /unsafe-server-details/);
    return true;
  });
});

test('unsupported cities fail before configuration, authentication or any network request', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return new Response('{}'); };
  const unsupported = { ...input, destination: 'Udaipur' };
  await assert.rejects(requestAiPlan({ ...request, input: unsupported }, { url: '', key: '', accessToken: '' }, { fetcher }), (error: unknown) => error instanceof AiPlannerError && error.code === 'UNSUPPORTED_DESTINATION');
  await assert.rejects(generateAiPlan(unsupported, { accessToken: '', flexibilityPercent: 0, config: { url: '', key: '' }, fetcher }), (error: unknown) => error instanceof AiPlannerError && error.code === 'UNSUPPORTED_DESTINATION');
  assert.equal(calls, 0);
});

test('one timed-out request produces an explicitly local researched plan with no retry', async () => {
  let calls = 0;
  let networkSignal: AbortSignal | null | undefined;
  const generousInput = { ...input, budget: 100_000 };
  const plan = await generateAiPlan(generousInput, {
    accessToken: config.accessToken, config, flexibilityPercent: 0, timeoutMs: 15,
    fetcher: (_url, init) => { calls++; networkSignal = init?.signal; return new Promise(() => {}); },
  });
  assert.equal(calls, 1);
  assert.equal(networkSignal?.aborted, true);
  assert.equal(plan.ai.generation, 'offline');
  assert.equal(plan.ai.basis, 'curated');
  assert.match(plan.ai.fallbackReason!, /took too long/);
  assert.match(plan.ai.fallbackReason!, /without AI/);
  assert.match(plan.draft.title, /Researched trip plan/);
  assert.doesNotMatch(plan.draft.title, /AI trip plan/);
  assert.match(plan.summary.notes[0], /arranged locally, without AI/);
  assert.ok(plan.breakdown.total <= generousInput.budget);
  assert.equal(Math.round(plan.activities.reduce((sum, activity) => sum + activity.cost, 0) * 100) / 100, plan.breakdown.total);
  const catalog = findCatalogDestination(generousInput.destination)!;
  assert.ok(plan.ai.places.every(place => catalog.places.some(known => known.name === place.name && canonicalMapsUrl(known.mapsUrl) === place.mapsUrl)));
  assert.deepEqual(plan.ai.references, catalog.sources);
});

test('recoverable provider failures use only the local catalog and respect exclusion history', async () => {
  const excluded = findCatalogDestination(input.destination)!.places[0];
  for (const code of ['UPSTREAM_ERROR', 'UPSTREAM_UNAVAILABLE', 'AUTH_UNAVAILABLE', 'PROVIDER_QUOTA_EXHAUSTED', 'PROVIDER_RATE_LIMITED', 'PROVIDER_NOT_CONFIGURED']) {
    let calls = 0;
    const plan = await generateAiPlan({ ...input, budget: 100_000 }, {
      accessToken: config.accessToken, config, flexibilityPercent: 10, excludedPlaceNames: [excluded.name], excludedPlaceIds: [canonicalMapsUrl(excluded.mapsUrl)!], variation: 1,
      fetcher: async () => { calls++; return new Response(JSON.stringify({ error: { code, message: 'unsafe-provider-details' } }), { status: 503 }); },
    });
    assert.equal(calls, 1);
    assert.equal(plan.ai.generation, 'offline');
    assert.ok(plan.ai.places.every(place => place.name !== excluded.name));
    assert.doesNotMatch(JSON.stringify(plan), /unsafe-provider-details/);
  }
});

test('cancelled generation and unauthorized sessions never become local fallback plans', async () => {
  const controller = new AbortController();
  let calls = 0;
  const pending = generateAiPlan({ ...input, budget: 100_000 }, {
    accessToken: config.accessToken, config, flexibilityPercent: 0, signal: controller.signal,
    fetcher: () => { calls++; return new Promise(() => {}); },
  });
  const rejected = assert.rejects(pending, (error: unknown) => error instanceof Error && error.name === 'AbortError');
  await Promise.resolve(); controller.abort(); await rejected;
  assert.equal(calls, 1);
  await assert.rejects(generateAiPlan({ ...input, budget: 100_000 }, {
    accessToken: config.accessToken, config, flexibilityPercent: 0,
    fetcher: async () => new Response(JSON.stringify({ error: { code: 'UPSTREAM_TIMEOUT' } }), { status: 401 }),
  }), (error: unknown) => error instanceof AiPlannerError && error.code === 'UNAUTHORIZED');
});

test('fallback can be disabled and a successful server plan retains its AI label', async () => {
  await assert.rejects(generateAiPlan(input, {
    accessToken: config.accessToken, config, flexibilityPercent: 10, allowOfflineFallback: false,
    fetcher: async () => { throw new Error('Network unavailable'); },
  }), (error: unknown) => error instanceof AiPlannerError && error.code === 'UPSTREAM_ERROR');
  const plan = await generateAiPlan(input, {
    accessToken: config.accessToken, config, flexibilityPercent: 10,
    fetcher: async () => new Response(JSON.stringify(curatedFixture())),
  });
  assert.equal(plan.ai.generation, 'ai');
  assert.equal(plan.ai.fallbackReason, undefined);
});

test('missing, unknown and inherited error codes use HTTP fallback without echoing upstream data', async () => {
  for (const body of [
    JSON.stringify({ error: { message: 'private-provider-payload' } }),
    JSON.stringify({ error: { code: 'private-provider-payload', message: 'private-provider-payload' } }),
    ...['constructor', '__proto__', 'toString'].map(code => JSON.stringify({ error: { code, message: 'private-provider-payload' } })),
    'private-provider-payload',
  ]) {
    await assert.rejects(requestAiPlan(request, config, { fetcher: async () => new Response(body, { status: 429 }) }), (error: unknown) => {
      assert.ok(error instanceof AiPlannerError);
      assert.equal(error.code, 'RATE_LIMITED');
      assert.equal(error.message, 'Please wait a little before requesting more suggestions.');
      return true;
    });
  }
  await assert.rejects(requestAiPlan(request, config, { fetcher: async () => new Response('{}', { status: 401 }) }), (error: unknown) => error instanceof AiPlannerError && error.code === 'UNAUTHORIZED');
  await assert.rejects(requestAiPlan(request, config, { fetcher: async () => new Response('private-provider-payload', { status: 503 }) }), (error: unknown) => error instanceof AiPlannerError && error.code === 'UPSTREAM_ERROR' && !error.message.includes('private-provider-payload'));
});

test('cancelled and timed-out planner requests abort and discard late replies', async () => {
  const controller = new AbortController();
  let networkSignal: AbortSignal | null | undefined;
  let complete: ((response: Response) => void) | undefined;
  const pending = requestAiPlan(request, config, { signal: controller.signal, fetcher: (_url, init) => {
    networkSignal = init?.signal;
    return new Promise(resolve => { complete = resolve; });
  } });
  const rejected = assert.rejects(pending, (error: unknown) => error instanceof Error && error.name === 'AbortError');
  await Promise.resolve(); controller.abort(); await rejected;
  assert.equal(networkSignal?.aborted, true);
  let readLateBody = false;
  const late = new Response(JSON.stringify(fixture())); late.text = async () => { readLateBody = true; return '{}'; };
  complete?.(late); await Promise.resolve();
  assert.equal(readLateBody, false);
  await assert.rejects(requestAiPlan(request, config, { timeoutMs: 15, fetcher: () => new Promise(() => {}) }), /took too long/i);
});

test('planner deadline includes a stalled response body and rejects missing authentication before fetch', async () => {
  await assert.rejects(requestAiPlan(request, config, { timeoutMs: 15, fetcher: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); } })) }), /took too long/i);
  let calls = 0;
  await assert.rejects(requestAiPlan(request, { ...config, accessToken: '' }, { fetcher: async () => { calls++; return new Response('{}'); } }), /sign in/i);
  assert.equal(calls, 0);
});

test('saved Maps attribution rejects unsafe URLs on reload', () => {
  const plan = aiResponseToPlan(input, fixture());
  const activities = plan.activities.map((activity, i) => ({ ...activity, id: String(i), done: false }));
  activities.find(activity => activity.source)!.source!.url = 'javascript:alert(1)';
  assert.throws(() => decodeTrips(JSON.stringify({ version: 1, trips: [{ ...plan.draft, id: 'invalid-source', activities }] })), /Invalid activity data/i);
});

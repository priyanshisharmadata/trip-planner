import assert from 'node:assert/strict';
import test from 'node:test';
import { createCuratedFallback } from '../src/lib/curated-fallback';
import { generatePlan, type PlannerInput } from '../src/lib/planner';
import {
  AiPlannerError, canonicalMapsUrl, normalizePlaceName, validateAiPlannerResponse,
  type AiPlannerRequest,
} from '../supabase/functions/_shared/ai-planner';
import { CATALOG_DESTINATIONS, findCatalogDestination } from '../supabase/functions/_shared/destination-catalog';

const input: PlannerInput = {
  destination: 'Jaipur', startDate: '2030-02-10', endDate: '2030-02-11',
  budget: 100_000, travelers: 2, interests: ['culture'], pace: 'balanced', stayPreference: 'comfort',
};
const request: AiPlannerRequest = { input, excludedPlaceIds: [], excludedPlaceNames: [], variation: 0, flexibilityPercent: 0 };
const hasCode = (code: string) => (error: unknown) => error instanceof AiPlannerError && error.code === code;

test('all supported destinations produce validated real places, one stay area and authored group costs', () => {
  for (const destination of CATALOG_DESTINATIONS) {
    const current = { ...request, input: { ...input, destination: destination.name } };
    const result = createCuratedFallback(current);
    assert.equal(result.basis, 'curated');
    assert.match(result.summary, /^Offline researched plan/);
    assert.match(result.notes.join(' '), /AI is unavailable/);
    assert.match(result.notes.join(' '), /not live hotel prices/);
    assert.equal(result.places.filter(place => place.kind === 'stay').length, 1);
    assert.match(result.places.find(place => place.kind === 'stay')!.name, /\(stay area\)$/);
    for (const place of result.places) {
      assert.ok(destination.places.some(source => source.name === place.name && source.kind === place.kind && canonicalMapsUrl(source.mapsUrl) === place.id));
    }
    assert.deepEqual(result.references, destination.sources);
    assert.deepEqual(result.budget, { ...generatePlan(current.input).breakdown, currency: 'INR', isEstimate: true });
    assert.deepEqual(validateAiPlannerResponse(result, current), result);
  }
});

test('suggest more excludes both canonical IDs and normalized names without repeating a stop', () => {
  const first = createCuratedFallback(request);
  const secondRequest: AiPlannerRequest = {
    ...request, variation: 1,
    excludedPlaceIds: first.places.filter((_, index) => index % 2 === 0).map(place => place.id),
    excludedPlaceNames: first.places.filter((_, index) => index % 2 === 1).map(place => ` ${place.name.toUpperCase()} `),
  };
  const second = createCuratedFallback(secondRequest);
  const firstNames = new Set(first.places.map(place => normalizePlaceName(place.name)));
  assert.ok(second.places.every(place => !firstNames.has(normalizePlaceName(place.name))));
  const ids = second.days.flatMap(day => day.stops.map(stop => stop.placeId));
  assert.equal(ids.length, new Set(ids).size);
  assert.ok(second.days.every(day => day.stops.length >= 1));
});

test('insufficient unseen attractions or overnight areas returns a useful error instead of inventing places', () => {
  const catalog = findCatalogDestination('Jaipur')!;
  assert.throws(() => createCuratedFallback({ ...request, excludedPlaceNames: catalog.places.filter(p => p.kind === 'stay').map(p => p.name) }), hasCode('NO_NEW_SUGGESTIONS'));
  assert.throws(() => createCuratedFallback({ ...request, excludedPlaceIds: catalog.places.filter(p => p.kind === 'attraction').slice(1).map(p => p.mapsUrl) }), hasCode('NO_NEW_SUGGESTIONS'));
  assert.throws(() => createCuratedFallback({ ...request, input: { ...input, endDate: '2030-02-18' } }), hasCode('NO_NEW_SUGGESTIONS'));
});

test('budget limits preserve authored allowances, permit only the selected flexibility and disclose tier changes', () => {
  const budgetInput: PlannerInput = { ...input, stayPreference: 'budget' };
  const baseline = generatePlan(budgetInput).breakdown.total;
  const slightlyLow = { ...request, input: { ...budgetInput, budget: Math.ceil(baseline / 1.05) } };
  assert.throws(() => createCuratedFallback(slightlyLow), hasCode('BUDGET_EXCEEDED'));
  const flexible = createCuratedFallback({ ...slightlyLow, flexibilityPercent: 10 });
  assert.equal(flexible.budget.total, baseline);
  assert.ok(flexible.budget.total > slightlyLow.input.budget);
  assert.throws(() => createCuratedFallback({ ...request, input: { ...input, budget: 1 }, flexibilityPercent: 10 }), hasCode('BUDGET_EXCEEDED'));
  const adjusted = createCuratedFallback({ ...request, input: { ...input, budget: baseline, stayPreference: 'premium' } });
  assert.equal(adjusted.budget.total, baseline);
  assert.ok(adjusted.notes.some(note => note.startsWith('Budget adjustment:')));
});

test('day trips omit stays, longer trips retain one distinct attraction each day, and selection is deterministic', () => {
  const dayTrip = createCuratedFallback({ ...request, input: { ...input, endDate: input.startDate } });
  assert.equal(dayTrip.budget.stay, 0);
  assert.ok(dayTrip.places.every(place => place.kind === 'attraction'));
  const longRequest = { ...request, input: { ...input, endDate: '2030-02-17', pace: 'packed' as const } };
  const longTrip = createCuratedFallback(longRequest);
  assert.equal(longTrip.days.length, 8);
  assert.ok(longTrip.days.every(day => day.stops.length === 1));
  assert.deepEqual(createCuratedFallback(longRequest).days, longTrip.days);
  const local = createCuratedFallback(request);
  const catalog = findCatalogDestination('Jaipur')!;
  const firstAreas = local.days[0].stops.map(stop => catalog.places.find(place => canonicalMapsUrl(place.mapsUrl) === stop.placeId)!.area);
  assert.equal(new Set(firstAreas).size, 1);
});

test('exact destination aliases work while unknown and mixed cities never receive fabricated local suggestions', () => {
  assert.match(createCuratedFallback({ ...request, input: { ...input, destination: 'Jaipur, Rajasthan, India' } }).summary, /Jaipur/);
  for (const destination of ['Delhi + Goa', 'London', 'Bali India']) {
    assert.throws(() => createCuratedFallback({ ...request, input: { ...input, destination } }), hasCode('UNSUPPORTED_DESTINATION'));
  }
  assert.throws(() => createCuratedFallback({ ...request, input: { ...input, travelers: 0 } }), hasCode('INVALID_INPUT'));
});

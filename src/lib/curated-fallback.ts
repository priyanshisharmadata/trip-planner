import { generatePlan, type PlannerInput } from './planner';
import {
  AiPlannerError,
  aiDayCount,
  canonicalMapsUrl,
  normalizePlaceName,
  roundMoney,
  validateAiPlannerRequest,
  validateAiPlannerResponse,
  type AiDay,
  type AiPlace,
  type AiPlannerRequest,
  type AiPlannerResponse,
} from '../../supabase/functions/_shared/ai-planner';
import { findCatalogDestination, type CatalogPlace } from '../../supabase/functions/_shared/destination-catalog';

/** A local, researched draft when the online planner cannot respond. No requests,
 * generated venues, hotel claims or fabricated live prices are involved. */
export function createCuratedFallback(rawRequest: AiPlannerRequest): AiPlannerResponse {
  const request = validateAiPlannerRequest(rawRequest);
  const catalog = findCatalogDestination(request.input.destination);
  if (!catalog) {
    throw new AiPlannerError('UNSUPPORTED_DESTINATION', 'Researched plans currently cover Jaipur, Goa, Manali, Delhi, Mumbai and Bali. Choose one of these destinations or use the offline planner.', 422);
  }

  const count = aiDayCount(request.input.startDate, request.input.endDate);
  const excludedIds = new Set(request.excludedPlaceIds.map(canonicalMapsUrl));
  const excludedNames = new Set((request.excludedPlaceNames ?? []).map(normalizePlaceName));
  const candidates = catalog.places.filter((place) =>
    !excludedIds.has(canonicalMapsUrl(place.mapsUrl)) && !excludedNames.has(normalizePlaceName(place.name))
  );
  const score = (place: CatalogPlace) => place.interests.filter(interest => request.input.interests.includes(interest)).length;
  const ranked = candidates.map((place, index) => ({ place, index }))
    .sort((a, b) => score(b.place) - score(a.place)
      || ((a.index - (request.variation % candidates.length) + candidates.length) % candidates.length)
        - ((b.index - (request.variation % candidates.length) + candidates.length) % candidates.length))
    .map(item => item.place);
  const available = ranked.filter(place => place.kind === 'attraction');
  const stay = ranked.find(place => place.kind === 'stay');
  if (available.length < count || (count > 1 && !stay)) {
    throw new AiPlannerError('NO_NEW_SUGGESTIONS', 'There are not enough different researched places for every selected day. Keep your previous plan, choose fewer days or another supported destination.', 422);
  }

  const ceiling = roundMoney(request.input.budget * (1 + request.flexibilityPercent / 100));
  // Reuse authored group/room/meal/transport/activity allowances without scaling
  // them down to force a fit. The planner may lower the requested stay tier.
  const estimate = generatePlan({ ...request.input, destination: catalog.name, budget: Math.min(ceiling, 10_000_000) } as PlannerInput);
  if (estimate.breakdown.total > ceiling) {
    throw new AiPlannerError('BUDGET_EXCEEDED', 'The researched draft exceeds this budget even with budget-tier allowances. Try fewer days, fewer travelers or a higher budget.', 422);
  }

  const places: AiPlace[] = [];
  const days: AiDay[] = [];
  const capacity = { relaxed: 1, balanced: 2, packed: 3 }[request.input.pace];
  const times = ['10:00', '14:00', '17:00'];
  const addPlace = (place: CatalogPlace): AiPlace => {
    const mapsUrl = canonicalMapsUrl(place.mapsUrl)!;
    const result: AiPlace = {
      id: mapsUrl, mapsUrl, name: place.name, kind: place.kind,
      reason: place.kind === 'stay'
        ? 'One researched area to compare accommodation; no specific hotel or availability has been selected.'
        : `Researched ${place.area} stop selected for your interests and ${request.input.pace} pace.`,
      popularityReason: place.description,
    };
    places.push(result);
    return result;
  };

  for (let day = 1; day <= count; day++) {
    // Spread the remaining supply over the remaining dates so no day is empty.
    const stopsToday = Math.min(capacity, Math.ceil(available.length / (count - day + 1)));
    const anchor = available[0].area;
    const stops: AiDay['stops'] = [];
    for (let slot = 0; slot < stopsToday; slot++) {
      // Prefer another stop in today's area; otherwise use the next ranked one.
      const sameAreaIndex = available.findIndex(place => place.area === anchor);
      const [source] = available.splice(sameAreaIndex < 0 ? 0 : sameAreaIndex, 1);
      const place = addPlace(source);
      stops.push({
        placeId: place.id,
        time: times[slot],
        note: `${source.area}: suggested planning slot. Confirm opening hours, entry costs and travel time before visiting.`,
      });
    }
    days.push({ day, stops });
  }
  if (count > 1 && stay) addPlace(stay);

  return validateAiPlannerResponse({
    version: 1,
    generatedAt: new Date().toISOString(),
    basis: 'curated',
    references: catalog.sources.map(source => ({ ...source })),
    summary: `Offline researched plan for ${catalog.name}: ${count} day${count === 1 ? '' : 's'} for ${request.input.travelers} traveler${request.input.travelers === 1 ? '' : 's'}.`,
    places,
    days,
    budget: { ...estimate.breakdown, currency: 'INR', isEstimate: true },
    notes: [
      'AI is unavailable, so this draft was assembled locally from researched real places. No online generation or live search was used.',
      'All costs are authored planning allowances for the whole group, not live hotel prices or ticket quotes. Confirm prices, access and availability before booking.',
      'The activity allowance is a shared sightseeing budget, not a verified price for any named stop. Times are editable planning slots; check opening days and travel time.',
      'Stay suggestions identify areas, not hotels or bookings. Accommodation assumes two travelers per room and nights between arrival and departure.',
      'Travel to and from the destination, visas, insurance, shopping and special activities are excluded. A 10% contingency is included.',
      ...(count === 1 ? ['This is a day trip; no overnight accommodation is included.'] : []),
      ...estimate.summary.notes.filter(note => note.startsWith('Budget adjustment:')),
    ],
  }, request);
}

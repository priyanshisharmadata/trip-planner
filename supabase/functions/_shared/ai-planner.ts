import { findCatalogDestination } from './destination-catalog.ts';

export type AiPlannerInput = {
  destination: string;
  startDate: string;
  endDate: string;
  budget: number;
  travelers: number;
  interests: string[];
  pace: 'relaxed' | 'balanced' | 'packed';
  stayPreference: 'budget' | 'comfort' | 'premium';
};

export type AiPlannerRequest = {
  input: AiPlannerInput;
  excludedPlaceIds: string[];
  excludedPlaceNames?: string[];
  variation: number;
  flexibilityPercent: 0 | 10;
};

export type AiPlace = {
  id: string;
  name: string;
  mapsUrl: string;
  kind: 'attraction' | 'stay' | 'food';
  reason: string;
  popularityReason: string;
};
export type AiDay = { day: number; stops: { placeId: string; time: string; note: string }[] };
export type AiReference = { label: string; url: string };
export type AiPlannerResponse = {
  version: 1;
  generatedAt: string;
  places: AiPlace[];
  days: AiDay[];
  summary: string;
  budget: {
    stay: number; food: number; transport: number; activities: number;
    contingency: number; total: number; currency: 'INR'; isEstimate: true;
  };
  notes: string[];
  basis?: 'curated' | 'google_maps';
  references?: AiReference[];
};

export class AiPlannerError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message);
    this.name = 'AiPlannerError';
  }
}

export function normalizePlaceName(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Only trusted catalog/provider Maps links may be displayed. Never open arbitrary model URLs. */
export function canonicalMapsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;
    const host = url.hostname.toLowerCase();
    const allowed = ((host === 'www.google.com' || host === 'google.com') && /^\/maps(?:\/|$)/.test(url.pathname))
      || host === 'maps.google.com'
      || (host === 'maps.app.goo.gl' && url.pathname.length > 1)
      || (host === 'goo.gl' && url.pathname.startsWith('/maps/'))
      || (host === 'vertexaisearch.cloud.google.com' && url.pathname.startsWith('/grounding-api-redirect/'));
    if (!allowed) return null;
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'hl', 'authuser']) url.searchParams.delete(key);
    if (host === 'google.com') url.hostname = 'www.google.com';
    url.searchParams.sort();
    return url.toString();
  } catch { return null; }
}

export function isGoogleMapsUrl(value: unknown): boolean {
  return canonicalMapsUrl(value) !== null;
}

export function aiDayCount(start: string, end: string): number {
  const parse = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
    const stamp = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value ? stamp : NaN;
  };
  return (parse(end) - parse(start)) / 86_400_000 + 1;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AiPlannerError('INVALID_RESPONSE', 'The planner returned an incomplete result. Please try again.', 502);
  return value as Record<string, unknown>;
}
function boundedString(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) throw new AiPlannerError('INVALID_RESPONSE', 'The planner returned an incomplete result. Please try again.', 502);
  return value.trim();
}
function amount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100_000_000) throw new AiPlannerError('INVALID_RESPONSE', 'The planner returned invalid cost estimates. Please try again.', 502);
  return Math.round(value * 100) / 100;
}
export const roundMoney = (value: number) => Math.round(value * 100) / 100;

export function validateAiPlannerRequest(raw: unknown): AiPlannerRequest {
  try {
    const request = record(raw);
    const input = record(request.input);
    const destination = boundedString(input.destination, 100);
    const startDate = boundedString(input.startDate, 10);
    const endDate = boundedString(input.endDate, 10);
    const days = aiDayCount(startDate, endDate);
    if (!Number.isInteger(days) || days < 1 || days > 14) throw new Error();
    if (typeof input.budget !== 'number' || !Number.isFinite(input.budget) || input.budget < 1 || input.budget > 10_000_000) throw new Error();
    if (!Number.isInteger(input.travelers) || Number(input.travelers) < 1 || Number(input.travelers) > 12) throw new Error();
    const interests = ['culture', 'nature', 'food', 'adventure', 'relaxation', 'shopping'];
    if (!Array.isArray(input.interests) || !input.interests.length || input.interests.length > 6 || input.interests.some(item => typeof item !== 'string' || !interests.includes(item))) throw new Error();
    if (!['relaxed', 'balanced', 'packed'].includes(String(input.pace)) || !['budget', 'comfort', 'premium'].includes(String(input.stayPreference))) throw new Error();
    if (!Array.isArray(request.excludedPlaceIds) || request.excludedPlaceIds.length > 100) throw new Error();
    const excludedPlaceIds = request.excludedPlaceIds.map(value => { const url = canonicalMapsUrl(value); if (!url) throw new Error(); return url; });
    const names = request.excludedPlaceNames ?? [];
    if (!Array.isArray(names) || names.length > 100) throw new Error();
    const excludedPlaceNames = names.map(value => boundedString(value, 160));
    if (!Number.isInteger(request.variation) || Number(request.variation) < 0 || Number(request.variation) > 100) throw new Error();
    if (request.flexibilityPercent !== 0 && request.flexibilityPercent !== 10) throw new Error();
    return {
      input: { destination, startDate, endDate, budget: input.budget, travelers: Number(input.travelers), interests: [...new Set(input.interests as string[])], pace: input.pace as AiPlannerInput['pace'], stayPreference: input.stayPreference as AiPlannerInput['stayPreference'] },
      excludedPlaceIds: [...new Set(excludedPlaceIds)], excludedPlaceNames: [...new Set(excludedPlaceNames)],
      variation: Number(request.variation), flexibilityPercent: request.flexibilityPercent,
    };
  } catch {
    throw new AiPlannerError('INVALID_INPUT', 'Choose a destination, valid dates for 1–14 days, 1–12 travelers and a valid budget.', 400);
  }
}

export function validateAiPlannerResponse(raw: unknown, request: AiPlannerRequest): AiPlannerResponse {
  const value = record(raw);
  if (value.version !== 1 || typeof value.generatedAt !== 'string' || !Number.isFinite(Date.parse(value.generatedAt))) throw new AiPlannerError('INVALID_RESPONSE', 'The planner returned an incomplete result. Please try again.', 502);
  if (value.basis !== undefined && value.basis !== 'curated' && value.basis !== 'google_maps') throw new AiPlannerError('INVALID_RESPONSE', 'The planner returned an unknown source type.', 502);
  const catalog = value.basis === 'curated' ? findCatalogDestination(request.input.destination) : undefined;
  if (value.basis === 'curated' && !catalog) throw new AiPlannerError('INVALID_RESPONSE', 'The destination sources could not be checked.', 502);
  let references: AiReference[] | undefined;
  if (value.references !== undefined || value.basis === 'curated') {
    if (!catalog || !Array.isArray(value.references) || value.references.length < 1 || value.references.length > catalog.sources.length) throw new AiPlannerError('INVALID_RESPONSE', 'The destination sources could not be checked.', 502);
    const seenReferences = new Set<string>();
    references = value.references.map(rawReference => {
      const reference = record(rawReference);
      const match = catalog.sources.find(source => source.url === reference.url && source.label === reference.label);
      if (!match || seenReferences.has(match.url)) throw new AiPlannerError('INVALID_RESPONSE', 'The destination sources could not be checked.', 502);
      seenReferences.add(match.url);
      return { label: match.label, url: match.url };
    });
  }
  const summary = boundedString(value.summary, 1200);
  if (!Array.isArray(value.places) || value.places.length < 1 || value.places.length > 64) throw new AiPlannerError('NO_NEW_SUGGESTIONS', 'Not enough new places could be checked. Try another destination or keep your previous plan.', 422);
  const excludedIds = new Set(request.excludedPlaceIds.map(canonicalMapsUrl));
  const excludedNames = new Set((request.excludedPlaceNames ?? []).map(normalizePlaceName));
  const ids = new Set<string>();
  const names = new Set<string>();
  const places = value.places.map(rawPlace => {
    const place = record(rawPlace);
    const id = canonicalMapsUrl(place.id);
    const mapsUrl = canonicalMapsUrl(place.mapsUrl);
    const name = boundedString(place.name, 160);
    const nameKey = normalizePlaceName(name);
    if (!id || !mapsUrl || id !== mapsUrl || !nameKey || ids.has(id) || names.has(nameKey) || excludedIds.has(id) || excludedNames.has(nameKey)) throw new AiPlannerError('NO_NEW_SUGGESTIONS', 'Not enough different places could be checked. Your previous suggestions are still available.', 422);
    if (!['attraction', 'stay', 'food'].includes(String(place.kind))) throw new AiPlannerError('INVALID_RESPONSE', 'The planner returned an incomplete result. Please try again.', 502);
    if (catalog && !catalog.places.some(source => canonicalMapsUrl(source.mapsUrl) === id && source.name === name && source.kind === place.kind)) throw new AiPlannerError('INVALID_RESPONSE', 'A suggested place did not match the researched destination catalog.', 502);
    ids.add(id); names.add(nameKey);
    return { id, mapsUrl, name, kind: place.kind as AiPlace['kind'], reason: boundedString(place.reason, 600), popularityReason: boundedString(place.popularityReason, 400) };
  });
  const dayCount = aiDayCount(request.input.startDate, request.input.endDate);
  if (!Array.isArray(value.days) || value.days.length !== dayCount) throw new AiPlannerError('INVALID_RESPONSE', 'The itinerary does not cover your selected dates. Please try again.', 502);
  const visited = new Set<string>();
  const days = value.days.map((rawDay, index) => {
    const day = record(rawDay);
    if (day.day !== index + 1 || !Array.isArray(day.stops) || day.stops.length < 1 || day.stops.length > 4) throw new AiPlannerError('INVALID_RESPONSE', 'The itinerary does not cover your selected dates. Please try again.', 502);
    const times = new Set<string>();
    let hasAttraction = false;
    const stops = day.stops.map(rawStop => {
      const stop = record(rawStop);
      const placeId = canonicalMapsUrl(stop.placeId);
      const place = places.find(item => item.id === placeId);
      if (!placeId || !place || place.kind === 'stay' || visited.has(placeId) || typeof stop.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(stop.time) || times.has(stop.time)) throw new AiPlannerError('INVALID_RESPONSE', 'The itinerary contains an invalid or repeated stop. Please try again.', 502);
      if (place.kind === 'attraction') hasAttraction = true;
      visited.add(placeId); times.add(stop.time);
      return { placeId, time: stop.time, note: boundedString(stop.note, 500) };
    }).sort((a, b) => a.time.localeCompare(b.time));
    if (!hasAttraction) throw new AiPlannerError('NO_NEW_SUGGESTIONS', 'Not enough popular sightseeing options could be checked for every day. Try fewer days or keep your previous plan.', 422);
    return { day: index + 1, stops };
  });
  if (dayCount > 1 && !places.some(place => place.kind === 'stay')) throw new AiPlannerError('NO_NEW_SUGGESTIONS', 'A stay suggestion could not be checked for this destination. Try again or use an offline plan.', 422);
  const budgetRaw = record(value.budget);
  const budget = {
    stay: amount(budgetRaw.stay), food: amount(budgetRaw.food), transport: amount(budgetRaw.transport),
    activities: amount(budgetRaw.activities), contingency: amount(budgetRaw.contingency), total: amount(budgetRaw.total),
    currency: 'INR' as const, isEstimate: true as const,
  };
  const subtotal = roundMoney(budget.stay + budget.food + budget.transport + budget.activities);
  if (budgetRaw.currency !== 'INR' || budgetRaw.isEstimate !== true || budget.total !== roundMoney(subtotal + budget.contingency) || budget.contingency !== roundMoney(subtotal * 0.1) || budget.food <= 0 || (dayCount === 1 ? budget.stay !== 0 : budget.stay <= 0)) throw new AiPlannerError('INVALID_RESPONSE', 'The planner returned inconsistent cost estimates. Please try again.', 502);
  if (budget.total > roundMoney(request.input.budget * (1 + request.flexibilityPercent / 100))) throw new AiPlannerError('BUDGET_EXCEEDED', 'No suitable plan fits this budget and flexibility. Try fewer days, a budget stay or a higher budget.', 422);
  if (!Array.isArray(value.notes) || value.notes.length > 12) throw new AiPlannerError('INVALID_RESPONSE', 'The planner returned incomplete notes. Please try again.', 502);
  const notes = value.notes.map(note => boundedString(note, 600));
  return { version: 1, generatedAt: value.generatedAt, summary, places, days, budget, notes,
    ...(value.basis ? { basis: value.basis } : {}), ...(references ? { references } : {}) };
}

import {
  AiPlannerError as ContractError, validateAiPlannerRequest, validateAiPlannerResponse,
  type AiPlace, type AiPlannerRequest, type AiPlannerResponse, type AiReference,
} from '../../supabase/functions/_shared/ai-planner';
import { findCatalogDestination } from '../../supabase/functions/_shared/destination-catalog';
import { isPublicSupabaseConfig } from './auth-helpers';
import { createCuratedFallback } from './curated-fallback';
import { generatePlan, type PlannerInput, type PlannerResult } from './planner';
import { addDays, dayCount, validateActivity, type ActivityDraft } from './trips';

export type { AiPlace };
export type AiPlannerResult = PlannerResult & {
  ai: {
    generatedAt: string;
    summary: string;
    generation?: 'ai' | 'offline';
    fallbackReason?: string;
    basis: 'curated' | 'google_maps';
    references: AiReference[];
    places: AiPlace[];
    activitySources: Record<string, { place: AiPlace; note: string }>;
  };
};

const messages: Record<string, string> = {
  UNAUTHORIZED: 'Please sign in again to use AI suggestions.',
  NOT_CONFIGURED: 'AI suggestions are not available yet. You can use the offline planner.',
  INVALID_INPUT: 'Check your destination, dates, travelers and budget, then try again.',
  UNSUPPORTED_DESTINATION: 'AI planning currently supports Jaipur, Goa, Manali, Delhi, Mumbai and Bali. Choose one of these destinations, or use the offline planner.',
  NO_NEW_SUGGESTIONS: 'No more new places are available for these trip details. Your current plan is still here. Try fewer days or another supported destination.',
  NO_GROUNDED_RESULTS: 'No reliable Maps suggestions were found. Try a more specific city or area.',
  NO_VERIFIED_PLACES: 'No reliable Maps suggestions were found. Try a more specific city or area.',
  BUDGET_EXCEEDED: 'No new plan fit your budget allowance. Try fewer days, a budget stay, or a higher budget.',
  RATE_LIMITED: 'Please wait a little before requesting more suggestions.',
  PROVIDER_QUOTA_EXHAUSTED: 'AI suggestions are unavailable because the service quota is exhausted. The app owner needs to check Google AI Studio quota and billing. Repeated retries will not fix this. You can use the offline planner.',
  PROVIDER_RATE_LIMITED: 'The AI service has reached its request limit. Please try again later, or use the offline planner.',
  PROVIDER_NOT_CONFIGURED: 'AI suggestions need a setup fix. The app owner needs to check the API key and model access. You can use the offline planner.',
  REQUEST_IN_PROGRESS: 'Your suggestions are already being generated. Please wait for the current request to finish.',
  UPSTREAM_TIMEOUT: 'Suggestions took too long. Please try again; your current plan is still here.',
  UPSTREAM_ERROR: 'The suggestions service is unavailable. Please try again or use the offline planner.',
  UPSTREAM_UNAVAILABLE: 'The suggestions service is unavailable. Please try again or use the offline planner.',
  AUTH_UNAVAILABLE: 'Your account could not be checked. Please try again shortly.',
  INVALID_RESPONSE: 'The suggestions could not be checked. Please try again or use the offline planner.',
};

function isKnownErrorCode(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(messages, code);
}

export class AiPlannerError extends Error {
  constructor(readonly code: string) {
    super(isKnownErrorCode(code) ? messages[code] : messages.UPSTREAM_ERROR);
    this.name = 'AiPlannerError';
  }
}

function cancelled(): Error { return Object.assign(new Error('Suggestion request cancelled.'), { name: 'AbortError' }); }

/** One bounded attempt; local fallback is handled by generateAiPlan. */
export async function requestAiPlan(
  request: AiPlannerRequest,
  config: { url: string; key: string; accessToken: string },
  options: { signal?: AbortSignal; fetcher?: typeof fetch; timeoutMs?: number } = {},
): Promise<AiPlannerResponse> {
  const input = validateAiPlannerRequest(request);
  if (!findCatalogDestination(input.input.destination)) throw new AiPlannerError('UNSUPPORTED_DESTINATION');
  if (!isPublicSupabaseConfig(config.url, config.key)) throw new AiPlannerError('NOT_CONFIGURED');
  if (!config.accessToken.trim()) throw new AiPlannerError('UNAUTHORIZED');
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid planner timeout.');
  const fetcher = options.fetcher ?? globalThis.fetch;
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true; cleanup(); controller.abort(); reject(error);
    };
    const abort = () => fail(cancelled());
    if (options.signal?.aborted) { abort(); return; }
    options.signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => fail(new AiPlannerError('UPSTREAM_TIMEOUT')), timeoutMs);
    void Promise.resolve().then(async () => {
      if (settled) return;
      const response = await fetcher(`${config.url.replace(/\/$/, '')}/functions/v1/generate-trip-plan`, {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', apikey: config.key, Authorization: `Bearer ${config.accessToken}` },
        body: JSON.stringify(input),
      });
      if (settled) return;
      const body = await response.text();
      if (settled) return;
      if (body.length > 250_000) throw new AiPlannerError('INVALID_RESPONSE');
      let raw: unknown;
      try { raw = JSON.parse(body); } catch {
        if (response.ok) throw new AiPlannerError('INVALID_RESPONSE');
        raw = null;
      }
      if (!response.ok) {
        const code = typeof raw === 'object' && raw !== null && 'error' in raw && typeof raw.error === 'object' && raw.error !== null && 'code' in raw.error && typeof raw.error.code === 'string' ? raw.error.code : '';
        const fallback = response.status === 401 ? 'UNAUTHORIZED' : response.status === 429 ? 'RATE_LIMITED' : 'UPSTREAM_ERROR';
        // A provider quota failure and a local cooldown can both use HTTP 429.
        // Use only recognized codes; provider response text must never reach the UI.
        throw new AiPlannerError(response.status === 401 ? 'UNAUTHORIZED' : isKnownErrorCode(code) ? code : fallback);
      }
      let result: AiPlannerResponse;
      try { result = validateAiPlannerResponse(raw, input); } catch { throw new AiPlannerError('INVALID_RESPONSE'); }
      if (settled) return;
      settled = true; cleanup(); resolve(result);
    }).catch(error => fail(error instanceof AiPlannerError ? error : new AiPlannerError('UPSTREAM_ERROR')));
  });
}

function splitMoney(total: number, count: number): number[] {
  if (!count) return [];
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / count);
  return Array.from({ length: count }, (_, index) => (base + (index < cents % count ? 1 : 0)) / 100);
}

/** The saved costs are the same checked planning allowances shown in the preview. */
export function aiResponseToPlan(input: PlannerInput, response: AiPlannerResponse, metadata: {
  generation?: 'ai' | 'offline'; fallbackReason?: string;
} = {}): AiPlannerResult {
  const basis = response.basis ?? 'google_maps';
  const generation = metadata.generation ?? 'ai';
  const references = response.references ?? [];
  const days = dayCount(input.startDate, input.endDate);
  const nights = days - 1;
  const rooms = Math.ceil(input.travelers / 2);
  const template = generatePlan(input);
  const byId = new Map(response.places.map(place => [place.id, place]));
  const activities: ActivityDraft[] = [];
  const activitySources: AiPlannerResult['ai']['activitySources'] = {};
  const food = splitMoney(response.budget.food, days);
  const transport = splitMoney(response.budget.transport, days);
  const lodging = splitMoney(response.budget.stay, nights);
  const stopCosts = splitMoney(response.budget.activities, response.days.reduce((sum, day) => sum + day.stops.length, 0));
  let stopIndex = 0;
  for (const day of response.days) {
    const date = addDays(input.startDate, day.day - 1);
    activities.push({ title: 'Meals allowance for the group (estimated)', date, time: '07:00', cost: food[day.day - 1] });
    activities.push({ title: 'Local transport allowance (estimated)', date, time: '07:15', cost: transport[day.day - 1] });
    for (const stop of day.stops) {
      const place = byId.get(stop.placeId);
      if (!place) throw new AiPlannerError('INVALID_RESPONSE');
      activities.push({
        title: place.name.slice(0, 120), date, time: stop.time, cost: stopCosts[stopIndex++],
        source: { label: place.name, url: place.mapsUrl },
      });
      activitySources[`${date}|${stop.time}`] = { place, note: stop.note };
    }
    if (day.day <= nights) activities.push({ title: `Stay allowance · ${rooms} room${rooms === 1 ? '' : 's'} (estimated, not a hotel quote)`, date, time: '22:00', cost: lodging[day.day - 1] });
  }
  activities.push({ title: 'Contingency reserve (estimated)', date: input.startDate, time: '23:00', cost: response.budget.contingency });
  activities.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  if (activities.some(activity => validateActivity(activity, input))) throw new AiPlannerError('INVALID_RESPONSE');
  const remaining = Math.round((input.budget - response.budget.total) * 100) / 100;
  const { stay, food: foodTotal, transport: transportTotal, activities: activityTotal, contingency, total } = response.budget;
  return {
    draft: { ...template.draft, title: `${input.destination.slice(0, 52)} · ${generation === 'offline' ? 'Researched' : 'AI'} trip plan` },
    activities,
    summary: {
      days, nights, travelers: input.travelers, rooms, estimatedTotal: total, budgetRemaining: remaining,
      isFeasible: remaining >= 0, shortfall: Math.max(0, -remaining), paceLabel: template.summary.paceLabel,
      isGeneric: false,
      notes: [
        basis === 'curated'
          ? `${generation === 'offline' ? 'This plan uses a researched destination list and was arranged locally, without AI.' : 'AI arranges places from a researched destination list.'} Official research references are provided; Google Maps links are for navigation. Prices are estimated planning allowances, with no live hotel rates, availability or crowd data.`
          : 'Places are suggested using Google Maps sources. Prices are estimated planning allowances; room availability and live crowds have not been checked.',
        'The budget covers the whole group, with two travelers per room. Travel to and from the destination, shopping and visas are excluded.',
        'Visit times are proposed slots. Confirm opening hours and access before traveling.',
        ...response.notes,
      ],
    },
    breakdown: { stay, food: foodTotal, transport: transportTotal, activities: activityTotal, contingency, total },
    stays: nights ? response.places.filter(place => place.kind === 'stay').map(place => ({
      area: place.name, type: basis === 'curated' ? 'Suggested stay area' : 'Google Maps stay suggestion', nightlyPerRoom: Math.round(stay / nights / rooms * 100) / 100,
      rooms, nights, estimatedTotal: stay, mapsUrl: place.mapsUrl,
      note: basis === 'curated'
        ? `${place.reason} Explore accommodation in this area. This amount is a planning allowance, not a hotel quote or confirmed availability.`
        : `${place.reason} This amount is your stay allowance, not a price quoted by this hotel.`,
    })) : [],
    sources: basis === 'curated' ? references.map(reference => ({ ...reference })) : response.places.map(place => ({ label: `Google Maps · ${place.name}`, url: place.mapsUrl })),
    ai: { generatedAt: response.generatedAt, summary: response.summary, generation, ...(metadata.fallbackReason ? { fallbackReason: metadata.fallbackReason } : {}), basis, references, places: response.places, activitySources },
  };
}

export async function generateAiPlan(input: PlannerInput, options: {
  accessToken: string;
  excludedPlaceIds?: string[];
  excludedPlaceNames?: string[];
  variation?: number;
  flexibilityPercent: 0 | 10;
  signal?: AbortSignal;
  allowOfflineFallback?: boolean;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  config?: { url: string; key: string };
}): Promise<AiPlannerResult> {
  const request = validateAiPlannerRequest({
    input, excludedPlaceIds: options.excludedPlaceIds ?? [], excludedPlaceNames: options.excludedPlaceNames ?? [],
    variation: options.variation ?? 0, flexibilityPercent: options.flexibilityPercent,
  });
  try {
    const response = await requestAiPlan(request, {
      url: options.config?.url ?? process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '',
      key: options.config?.key ?? process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '',
      accessToken: options.accessToken,
    }, { signal: options.signal, fetcher: options.fetcher, timeoutMs: options.timeoutMs });
    if (options.signal?.aborted) throw cancelled();
    return aiResponseToPlan(input, response);
  } catch (error) {
    if (options.signal?.aborted) throw cancelled();
    const fallbackCodes = ['UPSTREAM_TIMEOUT', 'UPSTREAM_ERROR', 'UPSTREAM_UNAVAILABLE', 'AUTH_UNAVAILABLE', 'PROVIDER_QUOTA_EXHAUSTED', 'PROVIDER_RATE_LIMITED', 'PROVIDER_NOT_CONFIGURED'];
    if (options.allowOfflineFallback === false || !(error instanceof AiPlannerError) || !fallbackCodes.includes(error.code)) throw error;
    let response: AiPlannerResponse;
    try {
      response = validateAiPlannerResponse(createCuratedFallback(request), request);
    } catch (fallbackError) {
      throw new AiPlannerError(fallbackError instanceof ContractError && isKnownErrorCode(fallbackError.code) ? fallbackError.code : 'INVALID_RESPONSE');
    }
    if (options.signal?.aborted) throw cancelled();
    return aiResponseToPlan(input, response, {
      generation: 'offline',
      fallbackReason: error.code === 'UPSTREAM_TIMEOUT'
        ? 'AI planning took too long. This plan was arranged locally from researched places, without AI.'
        : 'AI planning is unavailable right now. This plan was arranged locally from researched places, without AI.',
    });
  }
}

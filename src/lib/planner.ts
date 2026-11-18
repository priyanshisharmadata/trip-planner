import { addDays, dayCount, validateTrip, type ActivityDraft, type CoverKey, type TripDraft } from './trips';

export type Interest = 'culture' | 'nature' | 'food' | 'adventure' | 'relaxation' | 'shopping';
export type TravelPace = 'relaxed' | 'balanced' | 'packed';
export type StayPreference = 'budget' | 'comfort' | 'premium';

export type PlannerInput = {
  destination: string;
  startDate: string;
  endDate: string;
  budget: number;
  travelers: number;
  interests: Interest[];
  pace: TravelPace;
  stayPreference: StayPreference;
};

export type PlannerSource = { label: string; url: string };
export type StaySuggestion = {
  area: string;
  type: string;
  nightlyPerRoom: number;
  rooms: number;
  nights: number;
  estimatedTotal: number;
  mapsUrl: string;
  note: string;
};

export type PlannerResult = {
  draft: TripDraft & { coverKey: CoverKey };
  activities: ActivityDraft[];
  summary: {
    days: number;
    nights: number;
    travelers: number;
    rooms: number;
    estimatedTotal: number;
    budgetRemaining: number;
    isFeasible: boolean;
    shortfall: number;
    paceLabel: string;
    isGeneric: boolean;
    notes: string[];
  };
  breakdown: { stay: number; food: number; transport: number; activities: number; contingency: number; total: number };
  stays: StaySuggestion[];
  sources: PlannerSource[];
};

type Sight = {
  title: string;
  area: string;
  interests: Interest[];
  allowance: number;
  closedWeekdays?: number[];
};
type DestinationProfile = {
  aliases: string[];
  coverKey: CoverKey;
  areas: string[];
  room: Record<StayPreference, number>;
  food: number;
  transport: number;
  sights: Sight[];
  sources: PlannerSource[];
  notes?: string[];
};

export const PLANNER_INTERESTS: Interest[] = ['culture', 'nature', 'food', 'adventure', 'relaxation', 'shopping'];
export const PLANNER_PACES: TravelPace[] = ['relaxed', 'balanced', 'packed'];
export const PLANNER_STAYS: StayPreference[] = ['budget', 'comfort', 'premium'];

// These INR figures are deliberately authored planning allowances, not fetched
// prices or prices attributed to the tourism references below. Each sight cost
// is a per-person allowance; it is never presented as a verified ticket quote.
const profiles: DestinationProfile[] = [
  {
    aliases: ['jaipur'], coverKey: 'city', areas: ['Old City', 'Amer'],
    room: { budget: 1600, comfort: 3200, premium: 6500 }, food: 600, transport: 900,
    sights: [
      { title: 'Hawa Mahal visit (check access and entry fee)', area: 'Old City', interests: ['culture'], allowance: 300 },
      { title: 'Jantar Mantar visit (check access and entry fee)', area: 'Old City', interests: ['culture'], allowance: 350 },
      { title: 'Amber Palace visit (check access and entry fee)', area: 'Amer', interests: ['culture', 'adventure'], allowance: 650 },
      { title: 'Old-city craft browsing (purchases extra)', area: 'Old City', interests: ['shopping'], allowance: 0 },
    ],
    sources: [{ label: 'Rajasthan Tourism: Jaipur sights', url: 'https://www.tourism.rajasthan.gov.in/jaipur.html' }],
  },
  {
    aliases: ['goa'], coverKey: 'beach', areas: ['Panaji', 'Calangute'],
    room: { budget: 2200, comfort: 4200, premium: 8500 }, food: 800, transport: 1400,
    sights: [
      { title: 'Miramar Beach shoreline walk', area: 'Panaji', interests: ['nature', 'relaxation'], allowance: 0 },
      { title: 'Panaji heritage-street walk', area: 'Panaji', interests: ['culture', 'shopping'], allowance: 0 },
      { title: 'Old Goa heritage visit (confirm access)', area: 'Old Goa', interests: ['culture'], allowance: 300 },
      { title: 'Calangute beach walk and local browsing', area: 'Calangute', interests: ['nature', 'relaxation', 'shopping'], allowance: 0 },
    ],
    sources: [
      { label: 'Goa Tourism: Panaji', url: 'https://goa-tourism.com/guide/panaji-city/' },
      { label: 'Goa Tourism: Old Goa', url: 'https://goa-tourism.com/guide/old-goa-heritage/' },
      { label: 'Goa Tourism: Calangute', url: 'https://goa-tourism.com/guide/calangute-beach-belt/' },
    ],
    notes: ['Beach visits mean shore walks; swimming, water sports, and their charges are not included.'],
  },
  {
    aliases: ['manali'], coverKey: 'mountains', areas: ['Manali town', 'Old Manali'],
    room: { budget: 1600, comfort: 3000, premium: 6000 }, food: 600, transport: 1500,
    sights: [
      { title: 'Hidimba Devi Temple and nearby woodland', area: 'Manali town', interests: ['culture', 'nature'], allowance: 100 },
      { title: 'Manu Temple visit (confirm access)', area: 'Old Manali', interests: ['culture'], allowance: 100 },
      { title: 'Solang Valley scenic visit (check road conditions)', area: 'Solang Valley', interests: ['nature', 'adventure'], allowance: 500 },
    ],
    sources: [{ label: 'Himachal Tourism: Manali', url: 'https://himachaltourism.gov.in/destination/manali/' }],
    notes: ['Mountain access depends on weather. Skiing, paragliding, cable cars, and high-altitude excursions are not included.'],
  },
  {
    aliases: ['delhi', 'new delhi'], coverKey: 'city', areas: ['Connaught Place', 'Nizamuddin'],
    room: { budget: 2000, comfort: 4200, premium: 8500 }, food: 700, transport: 1200,
    sights: [
      { title: 'India Gate outdoor visit', area: 'Central Delhi', interests: ['culture', 'relaxation'], allowance: 0 },
      { title: "Humayun's Tomb visit (check entry fee)", area: 'Nizamuddin', interests: ['culture', 'nature'], allowance: 600 },
      { title: 'Qutb Minar visit (check entry fee)', area: 'Mehrauli', interests: ['culture'], allowance: 650 },
      { title: 'Dilli Haat craft browsing (purchases extra)', area: 'INA', interests: ['shopping', 'food'], allowance: 200 },
    ],
    sources: [{ label: 'Delhi Tourism: places to explore', url: 'https://www.delhitourism.gov.in/dt/explore-the-city.html' }],
  },
  {
    aliases: ['mumbai', 'bombay'], coverKey: 'city', areas: ['Colaba', 'Marine Drive'],
    room: { budget: 2800, comfort: 5500, premium: 10000 }, food: 800, transport: 1400,
    sights: [
      { title: 'Gateway of India waterfront visit', area: 'South Mumbai', interests: ['culture', 'relaxation'], allowance: 0 },
      { title: 'Marine Drive promenade walk', area: 'South Mumbai', interests: ['nature', 'relaxation'], allowance: 0 },
      { title: 'Elephanta Caves outing (confirm ferry and tickets)', area: 'Elephanta Island', interests: ['culture', 'adventure'], allowance: 1200, closedWeekdays: [1] },
    ],
    sources: [
      { label: 'Maharashtra Tourism: Mumbai', url: 'https://maharashtratourism.gov.in/districts/mumbai-city/' },
      { label: 'Maharashtra Tourism: Elephanta', url: 'https://maharashtratourism.gov.in/mr/cave/elephanta/' },
    ],
    notes: ['Elephanta is omitted on Mondays. Confirm current ferry schedules, weather, closures, and ticket prices.'],
  },
  {
    aliases: ['bali'], coverKey: 'bali', areas: ['Ubud', 'Sanur'],
    room: { budget: 2500, comfort: 5000, premium: 11000 }, food: 1000, transport: 2500,
    sights: [
      { title: 'Ubud rice-field walk (confirm public access)', area: 'Ubud', interests: ['nature', 'adventure'], allowance: 300 },
      { title: 'Ubud arts and craft browsing (purchases extra)', area: 'Ubud', interests: ['culture', 'shopping'], allowance: 0 },
      { title: 'Sanur shoreline walk', area: 'Sanur', interests: ['nature', 'relaxation'], allowance: 0 },
      { title: 'Uluwatu Temple visit (check entry rules)', area: 'Uluwatu', interests: ['culture', 'nature'], allowance: 800 },
    ],
    sources: [{ label: 'Indonesia Travel: Bali', url: 'https://www.indonesia.travel/id/en/destination/bali-nusa-tenggara/bali' }],
    notes: ['Bali amounts are rough INR allowances, not live currency conversions. Flights, visa costs, tourist levies, and performance tickets are excluded.'],
  },
];

const genericProfile: DestinationProfile = {
  aliases: [], coverKey: 'city', areas: ['Central area (verify location)', 'Near your main sightseeing area'],
  room: { budget: 2000, comfort: 4000, premium: 8000 }, food: 800, transport: 1200,
  sights: [], sources: [],
};
const stayTypes: Record<StayPreference, string> = {
  budget: 'Simple private guesthouse room', comfort: 'Comfortable private hotel room', premium: 'Upscale private hotel room',
};
const slots: Record<TravelPace, string[]> = {
  relaxed: ['10:00'], balanced: ['10:00', '14:00'], packed: ['10:00', '14:00', '17:00'],
};
const flexibleIdeas: Record<Interest, { title: string; allowance: number }> = {
  culture: { title: 'Choose a nearby museum or heritage stop (verify access)', allowance: 350 },
  nature: { title: 'Find a public garden or easy scenic walk (verify access)', allowance: 0 },
  food: { title: 'Try a local food stop (within the meal allowance)', allowance: 0 },
  adventure: { title: 'Arrange a guided local walk (confirm route and quote)', allowance: 700 },
  relaxation: { title: 'Free time to rest and explore around your base', allowance: 0 },
  shopping: { title: 'Browse nearby shops (purchases not budgeted)', allowance: 0 },
};

function money(value: number): number { return Math.round(value * 100) / 100; }

function profileFor(destination: string): DestinationProfile {
  const words = destination.trim().toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  // Match complete destination words; e.g. "Goa, India" matches, "Goanna" does not.
  return profiles.find((profile) => profile.aliases.some((alias) => {
    const parts = alias.split(' ');
    return words.some((_, index) => parts.every((part, offset) => words[index + offset] === part));
  })) ?? genericProfile;
}

export function validatePlannerInput(input: PlannerInput): string | null {
  if (typeof input.destination !== 'string' || !input.destination.trim()) return 'Add a destination to plan your trip.';
  const tripError = validateTrip({ title: 'Personalized trip', destination: input.destination, startDate: input.startDate, endDate: input.endDate, budget: input.budget });
  if (tripError) return tripError;
  if (dayCount(input.startDate, input.endDate) > 14) return 'Generate a plan for 1 to 14 days. You can create longer trips manually.';
  if (input.budget < 1 || input.budget > 10_000_000) return 'Enter a total budget from ₹1 to ₹1,00,00,000.';
  if (!Number.isInteger(input.travelers) || input.travelers < 1 || input.travelers > 12) return 'Choose 1 to 12 travelers.';
  if (!Array.isArray(input.interests) || !input.interests.length || input.interests.some((interest) => !PLANNER_INTERESTS.includes(interest))) return 'Select at least one valid interest.';
  if (!PLANNER_PACES.includes(input.pace)) return 'Choose a relaxed, balanced, or packed travel pace.';
  if (!PLANNER_STAYS.includes(input.stayPreference)) return 'Choose a budget, comfort, or premium stay.';
  return null;
}

function buildPlan(input: PlannerInput): PlannerResult {
  const destination = input.destination.trim();
  const profile = profileFor(destination);
  const days = dayCount(input.startDate, input.endDate);
  const nights = days - 1;
  const rooms = Math.ceil(input.travelers / 2);
  const interests = PLANNER_INTERESTS.filter((interest) => input.interests.includes(interest));
  const nightlyPerRoom = profile.room[input.stayPreference];
  const dailyFood = Math.round(profile.food * ({ budget: 1, comfort: 1.4, premium: 2.2 }[input.stayPreference])) * input.travelers;
  const dailyTransport = Math.round(profile.transport * ({ relaxed: 0.8, balanced: 1, packed: 1.25 }[input.pace])) * Math.ceil(input.travelers / 4);
  const activities: ActivityDraft[] = [];
  const remainingSights = profile.sights.filter((sight) => sight.interests.some((interest) => interests.includes(interest)))
    .map((sight, index) => ({ ...sight, score: sight.interests.filter((interest) => interests.includes(interest)).length, index }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  let activityAllowance = 0;
  let flexibleSlots = 0;

  for (let day = 0; day < days; day++) {
    const date = addDays(input.startDate, day);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const available = remainingSights.filter((sight) => !sight.closedWeekdays?.includes(weekday));
    // Keep named stops in one area per day instead of crossing a large region repeatedly.
    const area = available[0]?.area ?? profile.areas[0];
    activities.push({ title: `Meals allowance · ${input.travelers} traveler${input.travelers === 1 ? '' : 's'} (estimated)`, date, time: '08:00', cost: dailyFood });
    activities.push({ title: `Local transport allowance · day ${day + 1} (estimated)`, date, time: '08:30', cost: dailyTransport });
    slots[input.pace].forEach((time, slot) => {
      const index = remainingSights.findIndex((sight) => sight.area === area && !sight.closedWeekdays?.includes(weekday));
      if (index !== -1) {
        const [sight] = remainingSights.splice(index, 1);
        const cost = sight.allowance * input.travelers;
        activityAllowance += cost;
        activities.push({ title: sight.title, date, time, cost });
      } else {
        const interest = interests[(day + slot) % interests.length];
        const idea = flexibleIdeas[interest];
        const cost = idea.allowance * input.travelers;
        activityAllowance += cost;
        flexibleSlots++;
        activities.push({ title: `${idea.title} · day ${day + 1}`, date, time, cost });
      }
    });
    if (day < nights) activities.push({ title: `Overnight stay allowance · ${rooms} room${rooms === 1 ? '' : 's'} (estimated)`, date, time: '20:00', cost: nightlyPerRoom * rooms });
  }

  const stay = nightlyPerRoom * rooms * nights;
  const food = dailyFood * days;
  const transport = dailyTransport * days;
  const subtotal = stay + food + transport + activityAllowance;
  const contingency = money(subtotal * 0.1);
  const total = money(subtotal + contingency);
  activities.push({ title: 'Contingency reserve · 10% buffer, not a booked expense', date: input.startDate, time: '20:30', cost: contingency });
  activities.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  const budgetRemaining = money(input.budget - total);
  const isGeneric = profile === genericProfile;
  const notes = [
    'Offline draft: all costs are planning estimates, not live quotes. Check current prices, opening hours, access, and availability before booking.',
    'Budget covers the whole group. Rooms assume two people each; nights are the days between arrival and departure. Food is per person; local transport allows one vehicle or equivalent per four travelers.',
    'Travel to/from the destination, visas, insurance, shopping purchases, and special activities are excluded. Keep separate funds for these.',
    'Times are editable planning slots, not confirmed opening hours. Adjust them around your arrival, departure, and local travel time.',
    'Hotel areas are alternative bases, not bookings. The estimate counts one stay choice; confirm taxes, occupancy rules, and the final room quote.',
    ...(profile.notes ?? []),
  ];
  if (isGeneric) notes.unshift(`No researched destination profile for ${destination}. This is a generic itinerary with unlocalized INR allowances; confirm local costs and replace flexible stops.`);
  if (flexibleSlots) notes.push(`${flexibleSlots} flexible stop${flexibleSlots === 1 ? '' : 's'} need your choice of a real local venue or route; no availability has been checked.`);
  if (!nights) notes.push('This is a day trip: no overnight stay is included.');
  if (budgetRemaining < 0) notes.unshift(`The selected stay, pace, and group size exceed your budget by ₹${money(-budgetRemaining).toLocaleString('en-IN')}. Shorten the trip or increase the budget.`);

  return {
    draft: {
      title: `${destination.slice(0, 56)} · your ${days}-day plan`, destination,
      startDate: input.startDate, endDate: input.endDate, budget: money(input.budget), coverKey: profile.coverKey,
    },
    activities,
    summary: {
      days, nights, travelers: input.travelers, rooms, estimatedTotal: total, budgetRemaining,
      isFeasible: budgetRemaining >= 0, shortfall: Math.max(0, money(-budgetRemaining)),
      paceLabel: `${input.pace[0].toUpperCase()}${input.pace.slice(1)} · ${slots[input.pace].length} sightseeing slot${slots[input.pace].length === 1 ? '' : 's'} per day`,
      isGeneric, notes,
    },
    breakdown: { stay, food, transport, activities: activityAllowance, contingency, total },
    stays: nights ? profile.areas.map((area) => ({
      area, type: stayTypes[input.stayPreference], nightlyPerRoom, rooms, nights, estimatedTotal: stay,
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${stayTypes[input.stayPreference]} hotels ${area} ${destination}`)}`,
      note: 'Planning allowance only; this is an area/type search. Check actual nightly prices, taxes, reviews, and availability for your dates.',
    })) : [],
    sources: profile.sources.map((source) => ({ ...source })),
  };
}

/** Pure offline planning. The requested stay tier is a preference and a ceiling;
 * choose the highest modeled tier whose complete estimate fits the total budget.
 */
export function generatePlan(input: PlannerInput): PlannerResult {
  const validation = validatePlannerInput(input);
  if (validation) throw new RangeError(validation);
  const tiers: StayPreference[] = ['premium', 'comfort', 'budget'];
  for (const tier of tiers.slice(tiers.indexOf(input.stayPreference))) {
    const plan = buildPlan({ ...input, stayPreference: tier });
    if (!plan.summary.isFeasible && tier !== 'budget') continue;

    if (!plan.summary.isFeasible) {
      plan.summary.notes[0] = `Even the budget-tier estimate exceeds your total budget by ₹${plan.summary.shortfall.toLocaleString('en-IN')}. Shorten the trip or increase the budget; costs have not been reduced below the preset planning allowances.`;
    }
    if (tier !== input.stayPreference) {
      const allowances = plan.summary.nights ? 'stay and meal allowances' : 'meal allowance (this day trip has no hotel stay)';
      const explanation = `Budget adjustment: changed your ${input.stayPreference} preference to ${tier} ${allowances} ${plan.summary.isFeasible ? 'to fit your total budget' : 'to show the lowest modeled estimate'}. Your dates, travelers, interests, and sightseeing pace are unchanged. All prices still need checking.`;
      // Keep an unresolved shortfall first; otherwise lead with the tradeoff.
      plan.summary.notes.splice(plan.summary.isFeasible ? 0 : 1, 0, explanation);
    }
    return plan;
  }
  throw new Error('No supported planning tier was available.');
}

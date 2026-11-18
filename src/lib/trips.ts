import { isGoogleMapsUrl } from '../../supabase/functions/_shared/ai-planner';

export type CoverKey = 'bali' | 'mountains' | 'city' | 'beach';

export type Activity = {
  id: string;
  title: string;
  date: string;
  time: string;
  cost: number;
  done: boolean;
  source?: { label: string; url: string };
};

export type Trip = {
  id: string;
  title: string;
  destination: string;
  startDate: string;
  endDate: string;
  budget: number;
  coverKey: CoverKey;
  activities: Activity[];
};

export type TripDraft = Pick<Trip, 'title' | 'destination' | 'startDate' | 'endDate' | 'budget'>;
export type ActivityDraft = Pick<Activity, 'title' | 'date' | 'time' | 'cost' | 'source'>;
export type TripStatus = 'upcoming' | 'ongoing' | 'past';

const DAY_MS = 86_400_000;

/** Parse a calendar date without timezone or daylight-saving shifts. */
function parseDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date
    : null;
}

export function createId(prefix = 'item'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function addDays(value: string, amount: number): string {
  const date = parseDate(value);
  if (!date || !Number.isSafeInteger(amount)) throw new RangeError('Use a valid date and a whole number of days.');
  date.setUTCDate(date.getUTCDate() + amount);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) {
    throw new RangeError('The resulting date is outside the supported range.');
  }
  return date.toISOString().slice(0, 10);
}

/** Inclusive length; incomplete or reversed date ranges have no days. */
export function dayCount(startDate: string, endDate: string): number {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  return start && end ? Math.max(0, Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1) : 0;
}

export function formatDateRange(startDate: string, endDate: string): string {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (!start || !end || end < start) return 'Choose dates';
  const format = (date: Date, includeYear = true) => date.toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', ...(includeYear ? { year: 'numeric' as const } : {}), timeZone: 'UTC',
  });
  if (startDate === endDate) return format(start);
  if (start.getUTCFullYear() !== end.getUTCFullYear()) return `${format(start)} – ${format(end)}`;
  if (start.getUTCMonth() === end.getUTCMonth()) return `${start.getUTCDate()} – ${format(end)}`;
  return `${format(start, false)} – ${format(end)}`;
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2,
  }).format(amount);
}

export function tripStatus(trip: Pick<Trip, 'startDate' | 'endDate'>, today = localToday()): TripStatus {
  if (today < trip.startDate) return 'upcoming';
  if (today > trip.endDate) return 'past';
  return 'ongoing';
}

export function validateTrip(trip: TripDraft): string | null {
  if (!trip.title.trim()) return 'Give your trip a name.';
  if (trip.title.trim().length > 80) return 'Keep the trip name within 80 characters.';
  if (!trip.destination.trim()) return 'Add a destination.';
  if (trip.destination.trim().length > 100) return 'Keep the destination within 100 characters.';
  if (!parseDate(trip.startDate) || !parseDate(trip.endDate)) return 'Enter valid dates in YYYY-MM-DD format.';
  if (trip.endDate < trip.startDate) return 'The end date must be on or after the start date.';
  if (dayCount(trip.startDate, trip.endDate) > 60) return 'Plan up to 60 days per trip.';
  if (!Number.isFinite(trip.budget) || trip.budget < 0) return 'Enter a valid budget of ₹0 or more.';
  return null;
}

export function validateActivity(activity: ActivityDraft, trip: Pick<Trip, 'startDate' | 'endDate'>): string | null {
  if (!activity.title.trim()) return 'Give this activity a name.';
  if (activity.title.trim().length > 120) return 'Keep the activity name within 120 characters.';
  if (!parseDate(activity.date)) return 'Enter a valid activity date in YYYY-MM-DD format.';
  if (!parseDate(trip.startDate) || !parseDate(trip.endDate) || activity.date < trip.startDate || activity.date > trip.endDate) {
    return 'Choose a date within your trip.';
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(activity.time)) return 'Enter a valid time in HH:MM format, like 09:30.';
  if (!Number.isFinite(activity.cost) || activity.cost < 0) return 'Enter a valid cost of ₹0 or more.';
  if (activity.source !== undefined && (!activity.source || typeof activity.source.label !== 'string' || !activity.source.label.trim() || activity.source.label.length > 160 || !isGoogleMapsUrl(activity.source.url))) return 'This activity has an invalid Google Maps source.';
  return null;
}

/** Total planned cost includes every activity, whether completed or pending. */
export function tripTotal(trip: Pick<Trip, 'activities'>): number {
  return Math.round(trip.activities.reduce((total, activity) => total + activity.cost, 0) * 100) / 100;
}

export function seedTrips(): Trip[] {
  const today = localToday();
  const baliStart = addDays(today, 12);
  const manaliStart = addDays(today, -1);
  const jaipurStart = addDays(today, -20);
  return [
    {
      id: 'demo-bali', title: 'A little Bali escape', destination: 'Bali, Indonesia',
      startDate: baliStart, endDate: addDays(baliStart, 5), budget: 75000, coverKey: 'bali',
      activities: [
        { id: 'bali-arrival', title: 'Arrive & settle into the villa', date: baliStart, time: '14:00', cost: 18000, done: false },
        { id: 'bali-rice', title: 'Morning walk through the rice fields', date: addDays(baliStart, 1), time: '08:00', cost: 1200, done: false },
        { id: 'bali-sunset', title: 'Sunset dinner by the ocean', date: addDays(baliStart, 1), time: '18:30', cost: 3500, done: false },
      ],
    },
    {
      id: 'demo-manali', title: 'Meet me in the mountains', destination: 'Manali, Himachal Pradesh',
      startDate: manaliStart, endDate: addDays(manaliStart, 4), budget: 24000, coverKey: 'mountains',
      activities: [
        { id: 'manali-cabin', title: 'Check in to the mountain stay', date: manaliStart, time: '12:00', cost: 8000, done: true },
        { id: 'manali-cafe', title: 'Slow morning & a café stop', date: today, time: '10:00', cost: 800, done: false },
        { id: 'manali-trail', title: 'A walk along the forest trail', date: addDays(today, 1), time: '08:30', cost: 0, done: false },
      ],
    },
    {
      id: 'demo-jaipur', title: 'A weekend in the Pink City', destination: 'Jaipur, Rajasthan',
      startDate: jaipurStart, endDate: addDays(jaipurStart, 2), budget: 18000, coverKey: 'city',
      activities: [
        { id: 'jaipur-stay', title: 'Check in & explore the old city', date: jaipurStart, time: '13:00', cost: 6500, done: true },
        { id: 'jaipur-market', title: 'Market stroll & local lunch', date: addDays(jaipurStart, 1), time: '11:00', cost: 2200, done: true },
      ],
    },
  ];
}

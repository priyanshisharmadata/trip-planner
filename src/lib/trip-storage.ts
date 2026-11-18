import { validateActivity, validateTrip, type Trip } from './trips';

export type TripStorage = { getItem: (key: string) => Promise<string | null>; setItem: (key: string, value: string) => Promise<void> };
const LEGACY_KEY = 'trip-planner.trips.v1';
export const tripStorageKey = (userId: string | null) => userId ? `${LEGACY_KEY}.user.${userId}` : LEGACY_KEY;

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }

export function decodeTrips(raw: string): Trip[] {
  const cache: unknown = JSON.parse(raw);
  if (!record(cache) || cache.version !== 1 || !Array.isArray(cache.trips)) throw new Error('Invalid trip cache.');
  for (const value of cache.trips) {
    if (!record(value) || typeof value.id !== 'string' || !value.id || typeof value.title !== 'string' || typeof value.destination !== 'string' ||
      typeof value.startDate !== 'string' || typeof value.endDate !== 'string' || typeof value.budget !== 'number' ||
      typeof value.coverKey !== 'string' || !['bali', 'mountains', 'city', 'beach'].includes(value.coverKey) || !Array.isArray(value.activities)) throw new Error('Invalid trip data.');
    const trip = value as Trip;
    if (validateTrip(trip)) throw new Error('Invalid trip data.');
    for (const activity of trip.activities) {
      if (!record(activity) || typeof activity.id !== 'string' || !activity.id || typeof activity.title !== 'string' ||
        typeof activity.date !== 'string' || typeof activity.time !== 'string' || typeof activity.cost !== 'number' || typeof activity.done !== 'boolean' ||
        validateActivity(activity, trip)) throw new Error('Invalid activity data.');
    }
    if (new Set(trip.activities.map(a => a.id)).size !== trip.activities.length) throw new Error('Duplicate activities.');
  }
  if (new Set(cache.trips.map(t => t.id)).size !== cache.trips.length) throw new Error('Duplicate trips.');
  return cache.trips as Trip[];
}

/** Successful mutations have completed their write; failed writes keep the previous snapshot. */
export class TripRepository {
  private queue: Promise<unknown> = Promise.resolve();
  private trips: Trip[] = [];
  private loaded = false;
  private corrupt: string | null = null;
  constructor(private storage: TripStorage, readonly key: string) {}

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.queue.then(operation);
    this.queue = task.catch(() => {});
    return task;
  }

  load(seed: Trip[] = []): Promise<Trip[]> {
    return this.enqueue(async () => {
      const raw = await this.storage.getItem(this.key);
      let next: Trip[];
      if (raw === null) {
        next = decodeTrips(JSON.stringify({ version: 1, trips: seed }));
        await this.storage.setItem(this.key, JSON.stringify({ version: 1, trips: next }));
      } else {
        try { next = decodeTrips(raw); }
        catch { this.corrupt = raw; this.loaded = false; throw new Error('Saved trips are damaged. Use recovery to back them up before resetting.'); }
      }
      this.trips = next; this.loaded = true; this.corrupt = null;
      return decodeTrips(JSON.stringify({ version: 1, trips: next }));
    });
  }

  get needsRecovery() { return this.corrupt !== null; }

  recover(): Promise<Trip[]> {
    return this.enqueue(async () => {
      if (this.corrupt === null) throw new Error('No damaged cache to recover.');
      await this.storage.setItem(`${this.key}.recovery.${Date.now()}`, this.corrupt);
      await this.storage.setItem(this.key, JSON.stringify({ version: 1, trips: [] }));
      this.corrupt = null; this.loaded = true; this.trips = [];
      return [];
    });
  }

  mutate(change: (current: Trip[]) => Trip[]): Promise<Trip[]> {
    return this.enqueue(async () => {
      if (!this.loaded) throw new Error('Saved trips are unavailable. Retry loading before making changes.');
      const copy = decodeTrips(JSON.stringify({ version: 1, trips: this.trips }));
      const serialized = JSON.stringify({ version: 1, trips: change(copy) });
      const validated = decodeTrips(serialized);
      await this.storage.setItem(this.key, serialized);
      this.trips = validated;
      return decodeTrips(serialized);
    });
  }
}

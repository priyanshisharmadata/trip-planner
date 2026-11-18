import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeTrips, TripRepository, tripStorageKey, type TripStorage } from '../src/lib/trip-storage';
import type { Trip } from '../src/lib/trips';

function sample(id = 'trip-a'): Trip {
  return {
    id, title: 'A quiet weekend', destination: 'Jaipur', startDate: '2026-11-01', endDate: '2026-11-03',
    budget: 12000, coverKey: 'city', activities: [
      { id: `${id}-lunch`, title: 'Lunch', date: '2026-11-02', time: '12:00', cost: 500, done: false },
    ],
  };
}
const encoded = (trips: unknown[]) => JSON.stringify({ version: 1, trips });

class MemoryStorage implements TripStorage {
  values = new Map<string, string>();
  writes: { key: string; value: string }[] = [];
  failRead = false;
  failWrite: (key: string) => boolean = () => false;
  beforeWrite?: (key: string) => Promise<void>;
  async getItem(key: string) {
    if (this.failRead) throw new Error('Read unavailable');
    return this.values.get(key) ?? null;
  }
  async setItem(key: string, value: string) {
    this.writes.push({ key, value });
    await this.beforeWrite?.(key);
    if (this.failWrite(key)) throw new Error('Write unavailable');
    this.values.set(key, value);
  }
}

function cached() {
  const storage = new MemoryStorage();
  const key = tripStorageKey(null);
  storage.values.set(key, encoded([sample()]));
  return { storage, key, repository: new TripRepository(storage, key) };
}

test('failed writes preserve durable data and the snapshot, and do not block later writes', async () => {
  const { storage, key, repository } = cached();
  const original = await repository.load();
  const raw = storage.values.get(key);
  storage.failWrite = () => true;
  await assert.rejects(repository.mutate((trips) => [...trips, sample('trip-b')]), /Write unavailable/);
  assert.equal(storage.values.get(key), raw);
  assert.deepEqual(original, [sample()]);
  storage.failWrite = () => false;
  const next = await repository.mutate((trips) => [...trips, sample('trip-c')]);
  assert.deepEqual(next.map((trip) => trip.id), ['trip-a', 'trip-c']);
  assert.deepEqual(decodeTrips(storage.values.get(key)!), next);
});

test('an in-place mutator cannot corrupt the snapshot when persistence fails', async () => {
  const { storage, key, repository } = cached();
  const original = await repository.load();
  storage.failWrite = () => true;
  await assert.rejects(repository.mutate((trips) => {
    trips[0].title = 'Unsaved edit';
    trips[0].activities[0].done = true;
    return trips;
  }), /Write unavailable/);
  assert.deepEqual(original, [sample()]);
  assert.deepEqual(decodeTrips(storage.values.get(key)!), [sample()]);
  storage.failWrite = () => false;
  assert.deepEqual(await repository.mutate((trips) => trips), [sample()]);
});

test('returned snapshots cannot mutate the repository without a successful write', async () => {
  const { repository } = cached();
  const loaded = await repository.load();
  loaded[0].title = 'External edit';
  loaded[0].activities[0].cost = 9999;
  const saved = await repository.mutate((trips) => trips);
  assert.deepEqual(saved, [sample()]);
  saved.push(sample('outside'));
  assert.deepEqual(await repository.mutate((trips) => trips), [sample()]);
});

test('queued mutations wait for earlier writes and see the preceding committed result', async () => {
  const { storage, key, repository } = cached();
  await repository.load();
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const firstStarted = new Promise<void>((resolve) => { started = resolve; });
  let calls = 0;
  storage.beforeWrite = async () => {
    calls++;
    if (calls === 1) { started(); await gate; }
  };
  const first = repository.mutate((trips) => [...trips, sample('trip-b')]);
  const second = repository.mutate((trips) => [...trips, sample('trip-c')]);
  await firstStarted;
  assert.equal(calls, 1);
  assert.deepEqual(decodeTrips(storage.values.get(key)!).map((trip) => trip.id), ['trip-a']);
  release();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.deepEqual(firstResult.map((trip) => trip.id), ['trip-a', 'trip-b']);
  assert.deepEqual(secondResult.map((trip) => trip.id), ['trip-a', 'trip-b', 'trip-c']);
  assert.equal(calls, 2);
  assert.deepEqual(decodeTrips(storage.values.get(key)!), secondResult);
});

test('account keys isolate data while preserving the original guest storage key', async () => {
  const storage = new MemoryStorage();
  const guestKey = tripStorageKey(null);
  assert.equal(guestKey, 'trip-planner.trips.v1');
  const guestRaw = encoded([sample('guest')]);
  storage.values.set(guestKey, guestRaw);
  const alice = new TripRepository(storage, tripStorageKey('alice'));
  const bob = new TripRepository(storage, tripStorageKey('bob'));
  await alice.load([sample('alice-trip')]);
  await bob.load([sample('bob-trip')]);
  await alice.mutate(() => []);
  assert.deepEqual(await bob.load(), [sample('bob-trip')]);
  assert.deepEqual(await new TripRepository(storage, guestKey).load(), [sample('guest')]);
  assert.equal(storage.values.get(guestKey), guestRaw);
  assert.deepEqual(await alice.load([sample('must-not-reseed')]), []);
});

test('a cached empty list stays empty and initial seed failures do not enable mutations', async () => {
  const storage = new MemoryStorage();
  const key = tripStorageKey(null);
  storage.values.set(key, encoded([]));
  assert.deepEqual(await new TripRepository(storage, key).load([sample()]), []);
  assert.equal(storage.writes.length, 0);
  const fresh = new TripRepository(storage, 'fresh');
  storage.failWrite = () => true;
  await assert.rejects(fresh.load([sample()]), /Write unavailable/);
  await assert.rejects(fresh.mutate(() => []), /unavailable/i);
  assert.equal(storage.values.has('fresh'), false);
});

test('corrupted data is never overwritten before recovery backup succeeds', async () => {
  const storage = new MemoryStorage();
  const key = tripStorageKey(null);
  const raw = '{broken-json';
  storage.values.set(key, raw);
  const repository = new TripRepository(storage, key);
  await assert.rejects(repository.load([sample()]), /damaged/i);
  assert.equal(repository.needsRecovery, true);
  await assert.rejects(repository.mutate(() => []), /unavailable/i);
  assert.equal(storage.writes.length, 0);
  storage.failWrite = (writeKey) => writeKey.startsWith(`${key}.recovery.`);
  await assert.rejects(repository.recover(), /Write unavailable/);
  assert.equal(storage.values.get(key), raw);
  assert.equal(repository.needsRecovery, true);
  storage.failWrite = () => false;
  assert.deepEqual(await repository.recover(), []);
  assert.equal(repository.needsRecovery, false);
  const backups = [...storage.values].filter(([backupKey]) => backupKey.startsWith(`${key}.recovery.`));
  assert.ok(backups.length > 0);
  assert.ok(backups.every(([, value]) => value === raw));
  assert.deepEqual(decodeTrips(storage.values.get(key)!), []);
  assert.deepEqual(await repository.mutate(() => [sample()]), [sample()]);
});

test('failed reset after a successful backup preserves the original and allows recovery retry', async () => {
  const storage = new MemoryStorage();
  const key = tripStorageKey(null);
  const raw = 'not-json';
  storage.values.set(key, raw);
  const repository = new TripRepository(storage, key);
  await assert.rejects(repository.load());
  storage.failWrite = (writeKey) => writeKey === key;
  await assert.rejects(repository.recover(), /Write unavailable/);
  assert.equal(storage.values.get(key), raw);
  assert.ok([...storage.values].some(([backupKey, value]) => backupKey.startsWith(`${key}.recovery.`) && value === raw));
  assert.equal(repository.needsRecovery, true);
  storage.failWrite = () => false;
  assert.deepEqual(await repository.recover(), []);
});

test('invalid mutations reject before writing, including malformed covers and duplicate IDs', async () => {
  const { storage, repository } = cached();
  await repository.load();
  const wrongCover = { ...sample(), coverKey: ['bali'] } as unknown as Trip;
  for (const trips of [
    [{ ...sample(), title: '' }], [sample(), sample()], [wrongCover],
    [{ ...sample(), activities: [{ ...sample().activities[0], date: '2026-11-04' }] }],
    [{ ...sample(), activities: [sample().activities[0], sample().activities[0]] }],
  ]) await assert.rejects(repository.mutate(() => trips));
  assert.equal(storage.writes.length, 0);
  assert.throws(() => decodeTrips(encoded([wrongCover])));
  assert.throws(() => decodeTrips('{"version":2,"trips":[]}'));
  assert.deepEqual(await repository.mutate((trips) => trips), [sample()]);
});

test('read failures reject without seeding or changing stored data', async () => {
  const { storage, key, repository } = cached();
  storage.failRead = true;
  await assert.rejects(repository.load([sample('seed')]), /Read unavailable/);
  await assert.rejects(repository.mutate(() => []), /unavailable/i);
  assert.equal(storage.writes.length, 0);
  assert.deepEqual(decodeTrips(storage.values.get(key)!), [sample()]);
  storage.failRead = false;
  assert.deepEqual(await repository.load(), [sample()]);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addDays, dayCount, seedTrips, tripStatus, tripTotal, validateActivity, validateTrip,
  type ActivityDraft, type TripDraft,
} from '../src/lib/trips';

const trip: TripDraft = {
  title: 'A weekend away', destination: 'Jaipur', startDate: '2028-02-28', endDate: '2028-03-01', budget: 5000,
};
const activity: ActivityDraft = { title: 'Lunch', date: '2028-02-29', time: '12:30', cost: 250 };

test('calendar arithmetic preserves leap days and inclusive trip lengths', () => {
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2028-02-28', 2), '2028-03-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(dayCount('2028-02-28', '2028-03-01'), 3);
  assert.equal(dayCount('2026-10-14', '2026-10-14'), 1);
  assert.equal(dayCount('2026-10-15', '2026-10-14'), 0);
  assert.equal(dayCount('', '2026-10-14'), 0);
});

test('invalid calendar dates cannot silently roll into another month', () => {
  for (const startDate of ['2027-02-29', '2026-04-31', '2026-13-01', '2026-00-12', '2026-2-01', '2026-02-00', '0000-01-01']) {
    assert.match(validateTrip({ ...trip, startDate }) ?? '', /valid dates/);
    assert.throws(() => addDays(startDate, 1), RangeError);
  }
  assert.throws(() => addDays('2028-02-28', 0.5), RangeError);
});

test('trip validation accepts zero budgets and rejects missing fields, invalid ranges and nonfinite money', () => {
  assert.equal(validateTrip({ ...trip, budget: 0 }), null);
  assert.ok(validateTrip({ ...trip, title: '  ' }));
  assert.ok(validateTrip({ ...trip, destination: '' }));
  assert.ok(validateTrip({ ...trip, endDate: '2028-02-27' }));
  assert.equal(validateTrip({ ...trip, endDate: addDays(trip.startDate, 59) }), null);
  assert.match(validateTrip({ ...trip, endDate: addDays(trip.startDate, 60) }) ?? '', /60 days/);
  for (const budget of [-1, NaN, Infinity]) assert.ok(validateTrip({ ...trip, budget }));
});

test('activities must have valid dates inside the trip and 24-hour times', () => {
  assert.equal(validateActivity(activity, trip), null);
  for (const date of [trip.startDate, trip.endDate]) assert.equal(validateActivity({ ...activity, date }, trip), null);
  for (const date of ['2028-02-27', '2028-03-02', '2028-02-30']) assert.ok(validateActivity({ ...activity, date }, trip));
  for (const time of ['24:00', '12:60', '9:30', '']) assert.ok(validateActivity({ ...activity, time }, trip));
  for (const cost of [-1, Infinity, NaN]) assert.ok(validateActivity({ ...activity, cost }, trip));
  assert.equal(validateActivity({ ...activity, time: '00:00', cost: 0 }, trip), null);
});

test('trip status includes both boundary dates', () => {
  assert.equal(tripStatus(trip, '2028-02-27'), 'upcoming');
  assert.equal(tripStatus(trip, trip.startDate), 'ongoing');
  assert.equal(tripStatus(trip, trip.endDate), 'ongoing');
  assert.equal(tripStatus(trip, '2028-03-02'), 'past');
});

test('planned totals include completed activities and round floating-point cents', () => {
  assert.equal(tripTotal({ activities: [] }), 0);
  assert.equal(tripTotal({ activities: [
    { ...activity, id: 'a', done: true, cost: 0.1 },
    { ...activity, id: 'b', done: false, cost: 0.2 },
  ] }), 0.3);
});

test('demo trips and activities satisfy the same rules as user plans', () => {
  const seeds = seedTrips();
  assert.equal(new Set(seeds.map((item) => item.id)).size, seeds.length);
  assert.deepEqual(seeds.map((item) => tripStatus(item)), ['upcoming', 'ongoing', 'past']);
  for (const seededTrip of seeds) {
    assert.equal(validateTrip(seededTrip), null);
    for (const seededActivity of seededTrip.activities) assert.equal(validateActivity(seededActivity, seededTrip), null);
  }
});

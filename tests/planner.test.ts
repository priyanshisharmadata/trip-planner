import assert from 'node:assert/strict';
import test from 'node:test';
import { generatePlan, validatePlannerInput, type PlannerInput } from '../src/lib/planner';
import { addDays, validateActivity, validateTrip } from '../src/lib/trips';

const input: PlannerInput = {
  destination: 'Jaipur', startDate: '2026-11-01', endDate: '2026-11-04', budget: 45000,
  travelers: 2, interests: ['culture', 'food'], pace: 'balanced', stayPreference: 'comfort',
};

test('budget categories reconcile with the itinerary and a 10 percent contingency', () => {
  const plan = generatePlan(input);
  const { stay, food, transport, activities, contingency, total } = plan.breakdown;
  const subtotal = stay + food + transport + activities;
  assert.equal(contingency, Math.round(subtotal * 10) / 100);
  assert.equal(total, subtotal + contingency);
  assert.equal(plan.activities.reduce((sum, activity) => sum + activity.cost, 0), total);
  assert.equal(plan.summary.estimatedTotal, total);
  assert.equal(plan.summary.budgetRemaining, input.budget - total);
  assert.equal(plan.summary.rooms, 1);
  assert.equal(plan.summary.nights, 3);
  assert.equal(plan.stays[0].nightlyPerRoom * 3, stay);
  assert.equal(plan.stays[0].estimatedTotal, stay);
});

test('generation is deterministic and saved trip/activity drafts validate', () => {
  const plan = generatePlan(input);
  assert.deepEqual(generatePlan(input), plan);
  assert.equal(validateTrip(plan.draft), null);
  for (const activity of plan.activities) assert.equal(validateActivity(activity, plan.draft), null);
  assert.deepEqual([...new Set(plan.activities.map((activity) => activity.date))], [
    '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04',
  ]);
});

test('invalid dates, excessive duration, invalid choices and invalid numeric inputs are rejected', () => {
  const invalid: Partial<PlannerInput>[] = [
    { destination: ' ' }, { startDate: '2026-02-30' }, { endDate: '2026-10-31' },
    { endDate: addDays(input.startDate, 14) }, { budget: NaN }, { budget: Infinity }, { budget: -1 }, { budget: 0 },
    { travelers: 0 }, { travelers: 1.5 }, { travelers: 13 }, { travelers: Infinity },
    { interests: [] }, { interests: ['unknown'] as unknown as PlannerInput['interests'] },
    { pace: 'turbo' as PlannerInput['pace'] }, { stayPreference: 'unknown' as PlannerInput['stayPreference'] },
  ];
  for (const changes of invalid) {
    const draft = { ...input, ...changes };
    assert.ok(validatePlannerInput(draft), JSON.stringify(changes));
    assert.throws(() => generatePlan(draft), RangeError);
  }
  assert.equal(validatePlannerInput({ ...input, endDate: addDays(input.startDate, 13) }), null);
});

test('day trips include meals and local travel but no hotel nights', () => {
  const plan = generatePlan({ ...input, endDate: input.startDate });
  assert.equal(plan.summary.days, 1);
  assert.equal(plan.summary.nights, 0);
  assert.equal(plan.breakdown.stay, 0);
  assert.deepEqual(plan.stays, []);
  assert.ok(plan.breakdown.food > 0 && plan.breakdown.transport > 0);
  assert.ok(plan.activities.every((activity) => activity.date === input.startDate));
});

test('traveler costs scale per person, per room, and per four-person transport allowance', () => {
  const solo = generatePlan({ ...input, travelers: 1, budget: 1_000_000 });
  const pair = generatePlan({ ...input, travelers: 2, budget: 1_000_000 });
  const group = generatePlan({ ...input, travelers: 5, budget: 1_000_000 });
  assert.equal(pair.breakdown.food, solo.breakdown.food * 2);
  assert.equal(pair.breakdown.activities, solo.breakdown.activities * 2);
  assert.equal(pair.breakdown.stay, solo.breakdown.stay);
  assert.equal(group.breakdown.stay, solo.breakdown.stay * 3);
  assert.equal(group.breakdown.transport, solo.breakdown.transport * 2);
  assert.equal(group.breakdown.food, solo.breakdown.food * 5);
});

test('lower budgets select the highest affordable stay and meal tier with a clear tradeoff', () => {
  const premium = generatePlan({ ...input, stayPreference: 'premium', budget: 1_000_000 });
  const comfort = generatePlan({ ...input, stayPreference: 'comfort', budget: 1_000_000 });
  const budget = generatePlan({ ...input, stayPreference: 'budget', budget: 1_000_000 });
  const adjusted = generatePlan({ ...input, stayPreference: 'premium', budget: comfort.breakdown.total });
  assert.equal(adjusted.summary.isFeasible, true);
  assert.equal(adjusted.summary.budgetRemaining, 0);
  assert.deepEqual(adjusted.breakdown, comfort.breakdown);
  assert.ok(adjusted.breakdown.stay < premium.breakdown.stay);
  assert.ok(adjusted.breakdown.food < premium.breakdown.food);
  assert.match(adjusted.summary.notes[0], /premium preference to comfort stay and meal allowances/);
  const tighter = generatePlan({ ...input, stayPreference: 'premium', budget: budget.breakdown.total });
  assert.deepEqual(tighter.breakdown, budget.breakdown);
  assert.equal(tighter.summary.isFeasible, true);
  assert.match(tighter.summary.notes[0], /premium preference to budget/);
  assert.equal(tighter.activities.reduce((sum, activity) => sum + activity.cost, 0), tighter.breakdown.total);
});

test('ample budgets preserve the requested tier without upgrading it', () => {
  for (const stayPreference of ['budget', 'comfort', 'premium'] as const) {
    const plan = generatePlan({ ...input, stayPreference, budget: 1_000_000 });
    assert.equal(plan.summary.isFeasible, true);
    assert.ok(!plan.summary.notes.some((note) => note.startsWith('Budget adjustment:')));
    assert.equal(plan.stays[0].nightlyPerRoom, { budget: 1600, comfort: 3200, premium: 6500 }[stayPreference]);
  }
});

test('impossible budgets keep the lowest modeled costs and an explicit shortfall', () => {
  const minimum = generatePlan({ ...input, stayPreference: 'budget', budget: 1_000_000 });
  const short = generatePlan({ ...input, stayPreference: 'premium', budget: 1 });
  assert.deepEqual(short.breakdown, minimum.breakdown);
  assert.equal(short.summary.isFeasible, false);
  assert.equal(short.summary.shortfall, short.breakdown.total - 1);
  assert.match(short.summary.notes[0], /Even the budget-tier estimate exceeds your total budget/);
  assert.match(short.summary.notes[1], /premium preference to budget/);
});

test('unknown destinations use labeled generic ideas and encoded hotel searches', () => {
  const plan = generatePlan({ ...input, destination: 'Somewhere & Beyond' });
  assert.equal(plan.summary.isGeneric, true);
  assert.deepEqual(plan.sources, []);
  assert.ok(plan.summary.notes.some((note) => note.includes('unlocalized INR')));
  assert.ok(plan.activities.every((activity) => !activity.title.includes('Hawa Mahal')));
  const query = new URL(plan.stays[0].mapsUrl).searchParams.get('query');
  assert.ok(query?.includes('Somewhere & Beyond'));
  assert.equal(generatePlan({ ...input, destination: 'Goanna' }).summary.isGeneric, true);
  assert.equal(generatePlan({ ...input, destination: 'Goa, India' }).summary.isGeneric, false);
});

test('pace and interests change sightseeing, while Monday Elephanta closures are respected', () => {
  const relaxed = generatePlan({ ...input, pace: 'relaxed', interests: ['relaxation'] });
  const packed = generatePlan({ ...input, pace: 'packed', interests: ['culture'] });
  assert.ok(packed.activities.length > relaxed.activities.length);
  assert.ok(packed.activities.some((activity) => activity.title.includes('Hawa Mahal')));
  assert.ok(!relaxed.activities.some((activity) => activity.title.includes('Hawa Mahal')));
  const monday = generatePlan({ ...input, destination: 'Mumbai', startDate: '2026-11-02', endDate: '2026-11-02', interests: ['adventure'] });
  assert.ok(!monday.activities.some((activity) => activity.title.includes('Elephanta')));
});

test('all six researched profiles have sources and valid full-length plans', () => {
  for (const destination of ['Jaipur', 'Goa', 'Manali', 'New Delhi', 'Mumbai', 'Bali']) {
    const plan = generatePlan({ ...input, destination, endDate: addDays(input.startDate, 13), travelers: 12, pace: 'packed' });
    assert.equal(plan.summary.isGeneric, false, destination);
    assert.ok(plan.sources.length > 0, destination);
    assert.equal(validateTrip(plan.draft), null, destination);
    for (const activity of plan.activities) assert.equal(validateActivity(activity, plan.draft), null, activity.title);
  }
});

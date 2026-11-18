/* global __dirname, __filename */
// Synthetic browser regression only: no Gemini, Google Maps, or Supabase calls leave this process.
const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const { require: loadTS } = require('tsx/cjs/api');
const { findCatalogDestination } = loadTS('../supabase/functions/_shared/destination-catalog.ts', __filename);
const { canonicalMapsUrl } = loadTS('../supabase/functions/_shared/ai-planner.ts', __filename);

const exportDirectory = path.resolve(__dirname, '..', '.tools', 'smoke-web');
const artifacts = path.resolve(__dirname, '..', 'artifacts');
const syntheticHost = 'roam-smoke.supabase.co';
const plannerPath = '/functions/v1/generate-trip-plan';
const account = { id: '00000000-0000-4000-8000-000000000007', email: 'ai-planner@example.test' };
const password = 'Synthetic-password-123!';
const storageKey = `trip-planner.trips.v1.user.${account.id}`;
const startDate = '2030-01-12';
const endDate = '2030-01-13';
const mimeTypes = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-expose-headers': 'x-supabase-api-version', 'x-supabase-api-version': '2024-01-01' };

function visible(locator) { return locator.filter({ visible: true }).first(); }
function button(page, name) { return visible(page.getByRole('button', { name, exact: true })); }
function field(page, name) { return visible(page.getByLabel(name, { exact: true })); }
function text(page, value) { return visible(page.getByText(value, { exact: true })); }
async function shown(locator) { await locator.waitFor({ state: 'visible' }); }
async function fill(page, name, value) {
  await field(page, name).fill(value);
  await field(page, name).press('Tab');
  assert.equal(await field(page, name).inputValue(), value);
}
async function dismissNotices(page) {
  for (let index = 0; index < 12 && await button(page, 'Dismiss notification').isVisible(); index++) await button(page, 'Dismiss notification').click();
}
async function enabled(page, label) {
  await page.waitForFunction((name) => Array.from(document.querySelectorAll('[role="button"],button')).some(element =>
    (element.getAttribute('aria-label') || element.textContent || '').trim() === name
    && element.getAttribute('aria-disabled') !== 'true' && !element.disabled), label);
}

// Itineraries and allowances are synthetic. Place identities come from the same researched catalog.
function fixture(number, total = 9900) {
  const destination = findCatalogDestination('Jaipur');
  const attractions = destination.places.filter(place => place.kind === 'attraction').slice(number * 2, number * 2 + 2);
  const stay = destination.places.filter(place => place.kind === 'stay')[number];
  assert.equal(attractions.length, 2);
  assert.ok(stay);
  const places = [...attractions, stay].map(place => {
    const mapsUrl = canonicalMapsUrl(place.mapsUrl);
    return { id: mapsUrl, name: place.name, mapsUrl, kind: place.kind, reason: 'Synthetic preference match for this browser test.', popularityReason: place.description };
  });
  const subtotal = total / 1.1;
  return {
    version: 1, generatedAt: '2026-10-28T12:00:00.000Z', basis: 'curated', references: destination.sources,
    summary: `Synthetic Jaipur suggestion set ${number + 1}.`,
    notes: ['All prices in this test are estimates, not live hotel rates.'], places,
    days: [
      { day: 1, stops: [{ placeId: places[0].id, time: '10:00', note: 'Synthetic morning visit.' }] },
      { day: 2, stops: [{ placeId: places[1].id, time: '10:00', note: 'Synthetic morning visit.' }] },
    ],
    budget: { stay: 2200, food: 2000, transport: 1800, activities: Math.round((subtotal - 6000) * 100) / 100, contingency: Math.round((total - subtotal) * 100) / 100, total, currency: 'INR', isEstimate: true },
  };
}

function session() {
  const now = Math.floor(Date.now() / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const user = { ...account, aud: 'authenticated', role: 'authenticated', created_at: '2026-01-01T00:00:00Z', email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: { display_name: 'AI smoke user' }, identities: [] };
  return { access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: account.id, email: account.email, aud: 'authenticated', role: 'authenticated', iat: now, exp: now + 3600 })}.synthetic-signature`, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'synthetic-ai-refresh', user };
}

async function startServer() {
  await fs.access(path.join(exportDirectory, 'index.html'));
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      let file = path.resolve(exportDirectory, `.${pathname}`);
      if (file !== exportDirectory && !file.startsWith(`${exportDirectory}${path.sep}`)) { response.writeHead(403).end(); return; }
      const stat = await fs.stat(file).catch(() => null);
      if (!stat?.isFile()) file = path.join(exportDirectory, 'index.html');
      const body = await fs.readFile(file);
      response.writeHead(200, { 'content-type': mimeTypes[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      response.end(body);
    } catch { response.writeHead(500).end('Static test server failed.'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { server, baseURL: `http://127.0.0.1:${server.address().port}` };
}

async function mockServices(context, baseURL) {
  const calls = [], unexpected = [], queue = [], mapVisits = [];
  const allowedMaps = new Set([fixture(0), fixture(1), fixture(2)].flatMap(plan => plan.places.map(place => place.mapsUrl)));
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.url().startsWith(`${baseURL}/`)) return route.continue();
    if (allowedMaps.has(request.url())) { mapVisits.push(request.url()); return route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Synthetic Google Maps page.</p>' }); }
    if (url.hostname !== syntheticHost) { unexpected.push(request.url()); return route.abort('blockedbyclient'); }
    const respond = (status, value) => route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(value) });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const body = request.postData() ? request.postDataJSON() : {};
    if (url.pathname.endsWith('/auth/v1/token')) {
      assert.ok((body.email === account.email && body.password === password) || body.refresh_token === 'synthetic-ai-refresh');
      return respond(200, session());
    }
    if (url.pathname.endsWith('/auth/v1/user')) return respond(200, session().user);
    if (url.pathname.endsWith('/auth/v1/logout')) return route.fulfill({ status: 204, headers: cors });
    if (url.pathname === plannerPath) {
      assert.equal(request.method(), 'POST');
      assert.match(request.headers().authorization ?? '', /^Bearer .+synthetic-signature$/);
      calls.push(body);
      const next = queue.shift();
      if (!next) { unexpected.push('Unqueued planner request'); return respond(500, { error: { code: 'UNEXPECTED_TEST_REQUEST', message: 'Synthetic response was not queued.' } }); }
      if (next.wait) await next.wait;
      try { await respond(next.status ?? 200, next.body); }
      finally { next.finished?.(); }
      return;
    }
    unexpected.push(request.url());
    return route.abort('blockedbyclient');
  });
  return {
    calls, unexpected, mapVisits,
    reply: (body, status = 200) => queue.push({ body, status }),
    hold: (body) => {
      let release, finished;
      const wait = new Promise(resolve => { release = resolve; });
      const completed = new Promise(resolve => { finished = resolve; });
      queue.push({ body, wait, finished });
      return async () => { release(); await completed; };
    },
  };
}

async function planVisible(page, plan) {
  await shown(text(page, plan.summary));
  await enabled(page, 'Suggest more');
  await dismissNotices(page);
  for (const place of plan.places.filter(item => item.kind !== 'food')) await shown(visible(page.getByRole('link', { name: `Open in Google Maps: ${place.name}`, exact: true })));
  await shown(text(page, plan.references[0].label));
}
async function plannerResponse(page, action) {
  const done = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === plannerPath);
  await action();
  await done;
}

async function main() {
  await fs.mkdir(artifacts, { recursive: true });
  const { server, baseURL } = await startServer();
  const pageErrors = [];
  let browser, page;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Kolkata' });
    const transport = await mockServices(context, baseURL);
    page = await context.newPage();
    page.setDefaultTimeout(20_000);
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(baseURL, { waitUntil: 'networkidle' });
    await fill(page, 'Email', account.email);
    await fill(page, 'Password', password);
    await button(page, 'Sign in').click();
    await shown(button(page, 'Smart planner'));
    await dismissNotices(page);
    await button(page, 'Smart planner').click();
    await visible(page.getByRole('radio', { name: 'AI planner', exact: true })).click();
    await fill(page, 'Destination', 'Pune');
    await fill(page, 'Total budget (₹)', '20000');
    await fill(page, 'Travelers', '2');
    await fill(page, 'Start date', startDate);
    await fill(page, 'End date', endDate);
    await visible(page.getByRole('radio', { name: 'Up to 10% extra', exact: true })).click();

    await button(page, 'Generate plan').click();
    await shown(visible(page.getByText(/AI planning currently supports Jaipur/)));
    assert.equal(transport.calls.length, 0, 'An unsupported city must not make a network request.');
    await enabled(page, 'Generate plan');
    await fill(page, 'Destination', 'Jaipur');
    transport.reply({ error: { code: 'UPSTREAM_TIMEOUT' } }, 504);
    await plannerResponse(page, () => button(page, 'Generate plan').click());
    await shown(text(page, 'Offline researched plan'));
    await shown(text(page, 'Research sources'));
    await enabled(page, 'Save this plan');
    assert.equal(transport.calls.length, 1, 'Local fallback must not retry the provider.');
    await dismissNotices(page);
    await fill(page, 'Total budget (₹)', '10000');
    transport.calls.length = 0;
    console.log('PASS: Unsupported cities fail locally; slow AI produces a clearly labelled offline researched plan with no retries.');

    const first = fixture(0), second = fixture(1, 10450), third = fixture(2);
    transport.reply(first);
    await plannerResponse(page, () => button(page, 'Generate plan').click());
    await planVisible(page, first);
    assert.deepEqual(transport.calls[0].excludedPlaceIds, []);
    assert.equal(transport.calls[0].flexibilityPercent, 10);
    assert.equal(transport.calls[0].input.budget, 10000);
    const mapsPopup = context.waitForEvent('page');
    await visible(page.getByRole('link', { name: `Open in Google Maps: ${first.places[0].name}`, exact: true })).click();
    const mapPage = await mapsPopup;
    await mapPage.waitForURL(first.places[0].mapsUrl);
    await mapPage.close();
    assert.deepEqual(transport.mapVisits, [first.places[0].mapsUrl]);

    transport.reply(second);
    await plannerResponse(page, () => button(page, 'Suggest more').click());
    await planVisible(page, second);
    assert.deepEqual(new Set(transport.calls[1].excludedPlaceIds), new Set(first.places.map(place => place.id)));
    assert.deepEqual(new Set(transport.calls[1].excludedPlaceNames), new Set(first.places.map(place => place.name)));
    assert.ok(transport.calls[1].variation > transport.calls[0].variation);
    await shown(visible(page.getByText(/over budget/i)));
    await shown(visible(page.getByText(/₹450/)));
    assert.equal(await text(page, first.summary).count(), 0);
    await page.screenshot({ path: path.join(artifacts, 'ai-planner-alternatives.png'), fullPage: true });
    console.log('PASS: Researched place fixtures, official references, Maps navigation, alternatives with exclusions and explicit budget overage.');

    transport.reply({ error: { code: 'BUDGET_EXCEEDED', message: 'Private provider details must never be shown.' } }, 422);
    await plannerResponse(page, () => button(page, 'Suggest more').click());
    await shown(visible(page.getByText(/No new plan fit your budget allowance\./)));
    assert.equal(await text(page, 'Please wait a little before requesting more suggestions.').count(), 0);
    assert.equal(await text(page, 'Private provider details must never be shown.').count(), 0);
    await planVisible(page, second);
    const bad = structuredClone(third);
    bad.places[0].id = bad.places[0].mapsUrl = 'https://untrusted.example/fake-place';
    bad.days[0].stops[0].placeId = bad.places[0].id;
    transport.reply(bad);
    await plannerResponse(page, () => button(page, 'Suggest more').click());
    await shown(text(page, 'The suggestions could not be checked. Please try again or use the offline planner.'));
    await planVisible(page, second);
    assert.equal(await text(page, third.summary).count(), 0, 'Malformed results must not replace the current preview.');
    assert.deepEqual(new Set(transport.calls[3].excludedPlaceIds), new Set([...first.places, ...second.places].map(place => place.id)));
    console.log('PASS: Setup/backend failures and untrusted result URLs retain the previous plan and allow retry.');

    const releaseCancelled = transport.hold(third);
    const cancelStarted = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === plannerPath);
    const cancelAborted = page.waitForEvent('requestfailed', { predicate: request => request.method() === 'POST' && new URL(request.url()).pathname === plannerPath });
    await button(page, 'Suggest more').click();
    await cancelStarted;
    await button(page, 'Cancel generation').click();
    assert.match((await cancelAborted).failure()?.errorText ?? '', /abort/i);
    await releaseCancelled();
    await planVisible(page, second);
    assert.equal(await text(page, third.summary).count(), 0, 'Cancelled alternatives must not replace the previous plan.');

    const release = transport.hold(third);
    const requestStarted = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === plannerPath);
    const requestAborted = page.waitForEvent('requestfailed', { predicate: request => request.method() === 'POST' && new URL(request.url()).pathname === plannerPath });
    await button(page, 'Suggest more').click();
    await requestStarted;
    await shown(button(page, 'Cancel generation'));
    assert.equal(await button(page, 'Save this plan').isEnabled(), false);
    await fill(page, 'Total budget (₹)', '11000');
    const aborted = await requestAborted;
    assert.match(aborted.failure()?.errorText ?? '', /abort/i);
    await release();
    assert.equal(await text(page, second.summary).count(), 0);
    assert.equal(await text(page, third.summary).count(), 0, 'A late response after editing must never restore an outdated plan.');
    assert.equal(await button(page, 'Save this plan').count(), 0);
    await enabled(page, 'Generate plan');
    await dismissNotices(page);

    transport.reply(third);
    await plannerResponse(page, () => button(page, 'Generate plan').click());
    await planVisible(page, third);
    assert.deepEqual(transport.calls.at(-1).excludedPlaceIds, [], 'Changing inputs must clear the earlier suggestion history.');
    assert.equal(transport.calls.at(-1).input.budget, 11000);
    await button(page, 'Save this plan').click();
    await shown(button(page, 'Edit trip'));
    const persisted = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).trips, storageKey);
    assert.equal(persisted.length, 1);
    const saved = persisted[0];
    for (const place of third.places.filter(item => item.kind === 'attraction')) {
      const activity = saved.activities.find(item => item.title.includes(place.name));
      assert.ok(activity, `${place.name} must be in the saved itinerary.`);
      assert.equal(activity.source?.url, place.mapsUrl, 'Saved AI stops retain their Maps attribution.');
    }
    assert.equal(Math.round(saved.activities.reduce((sum, activity) => sum + activity.cost, 0) * 100) / 100, third.budget.total);
    assert.equal(saved.budget, 11000);
    await page.reload({ waitUntil: 'networkidle' });
    await shown(button(page, 'Edit trip'));
    await dismissNotices(page);
    const reloaded = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).trips, storageKey);
    assert.deepEqual(reloaded, persisted);
    await shown(visible(page.getByText(third.places[0].name, { exact: false })));
    console.log('PASS: Input edits abort pending work, stale responses are ignored, and saved AI activities and totals survive reload.');
    assert.deepEqual(transport.unexpected, [], 'Unexpected external request: every service call must be synthetic.');
    assert.deepEqual(pageErrors, [], 'Uncaught browser errors.');
    console.log('PASS: No uncaught browser errors or live service calls.');
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(artifacts, 'ai-planner-failure.png'), fullPage: true }).catch(() => {});
    if (pageErrors.length) console.error('Page errors:', pageErrors);
    throw error;
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });

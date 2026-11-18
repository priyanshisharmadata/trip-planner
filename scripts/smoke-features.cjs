/* global __dirname */
// Uses synthetic auth responses only. This does not verify a live Supabase project.
const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const exportDirectory = path.resolve(__dirname, '..', '.tools', 'smoke-web');
const artifacts = path.resolve(__dirname, '..', 'artifacts');
const syntheticHost = 'roam-smoke.supabase.co';
const accountA = { id: '00000000-0000-4000-8000-000000000001', email: 'account-a@example.test' };
const accountB = { id: '00000000-0000-4000-8000-000000000002', email: 'account-b@example.test' };
const verificationAccount = { id: '00000000-0000-4000-8000-000000000003', email: 'verification@example.test' };
const linkVerificationAccount = { id: '00000000-0000-4000-8000-000000000004', email: 'link-verification@example.test' };
const timeoutAccount = { id: '00000000-0000-4000-8000-000000000005', email: 'timeout@example.test' };
const directSignupAccount = { id: '00000000-0000-4000-8000-000000000006', email: 'direct-signup@example.test' };
const accounts = [accountA, accountB, verificationAccount, linkVerificationAccount, timeoutAccount, directSignupAccount];
const timeoutMessage = 'The connection took too long. Check your internet or switch between Wi-Fi and mobile data, then try again. If you were creating an account, check your inbox first.';
const verificationCode = '012345';
const verificationHash = '0123456789abcdef'.repeat(4);
const expiredHash = 'fedcba9876543210'.repeat(4);
const confirmationLink = hash => `https://${syntheticHost}/auth/v1/verify?token=${hash}&type=signup&redirect_to=http%3A%2F%2Flocalhost%3A3000`;
const password = 'Correct-password-123!';
const startDate = '2030-01-12';
const endDate = '2030-01-14';
const plannedTitle = 'Jaipur · your 3-day plan';
const mimeTypes = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

function visible(locator) { return locator.filter({ visible: true }).first(); }
function button(page, name) { return visible(page.getByRole('button', { name, exact: typeof name === 'string' })); }
function field(page, name) { return visible(page.getByLabel(name, { exact: true })); }
function text(page, value) { return visible(page.getByText(value, { exact: true })); }
async function shown(locator) { await locator.waitFor({ state: 'visible' }); assert.equal(await locator.isVisible(), true); }
async function fillField(page, name, value) {
  const input = field(page, name);
  // RN Web exposes a visible modal before its fade ends. The dialog role is
  // assigned only when its focus trap becomes active; wait for that readiness.
  if (await input.evaluate(element => Boolean(element.closest('[aria-modal="true"]')))) {
    await page.getByRole('dialog').filter({ has: input }).waitFor({ state: 'visible' });
  }
  await input.focus();
  await input.fill(value);
  await input.press('Tab');
  assert.equal(await input.inputValue(), value, `${name} must retain its value after blur.`);
}

async function startServer() {
  await fs.access(path.join(exportDirectory, 'index.html'));
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      let file = path.resolve(exportDirectory, `.${pathname}`);
      if (file !== exportDirectory && !file.startsWith(`${exportDirectory}${path.sep}`)) {
        response.writeHead(403).end(); return;
      }
      const stat = await fs.stat(file).catch(() => null);
      if (!stat?.isFile()) file = path.join(exportDirectory, 'index.html');
      const body = await fs.readFile(file);
      response.writeHead(200, { 'content-type': mimeTypes[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      response.end(body);
    } catch {
      response.writeHead(500).end('Static test server failed.');
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { server, baseURL: `http://127.0.0.1:${server.address().port}` };
}

function user(account, verified = true) {
  return {
    ...account, aud: 'authenticated', role: 'authenticated', created_at: '2026-01-01T00:00:00Z',
    ...(verified ? { email_confirmed_at: '2026-01-01T00:00:00Z' } : { confirmation_sent_at: '2026-01-01T00:00:00Z' }),
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: { display_name: 'Smoke user' }, identities: [],
  };
}

function session(account) {
  const now = Math.floor(Date.now() / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const accessToken = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: account.id, email: account.email, aud: 'authenticated', role: 'authenticated', iat: now, exp: now + 3600 })}.synthetic-signature`;
  return { access_token: accessToken, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: `synthetic-refresh-${account.id}`, user: user(account) };
}

async function mockAuthentication(context, baseURL) {
  const calls = [];
  const unexpected = [];
  let failLogout = false;
  let stallSignup = false;
  let stalledSignup;
  await context.route('**/*', async route => {
    if (route.request().url().startsWith(`${baseURL}/`)) return route.continue();
    unexpected.push(route.request().url());
    return route.abort('blockedbyclient');
  });
  await context.route('**/auth/v1/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname !== syntheticHost) {
      unexpected.push(request.url());
      await route.abort('blockedbyclient'); return;
    }
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-expose-headers': 'x-supabase-api-version', 'x-supabase-api-version': '2024-01-01' };
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
    const body = request.postData() ? request.postDataJSON() : {};
    calls.push({ path: url.pathname, email: body.email, grant: url.searchParams.get('grant_type'), verification: body.token_hash ? 'link' : body.token ? 'code' : undefined });
    const respond = (status, value) => route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(value) });
    if (url.pathname.endsWith('/signup')) {
      if (body.email === 'unapproved@example.test') return respond(403, { code: 'email_address_not_authorized', msg: 'Email address not authorized' });
      const account = accounts.find(item => item.email === body.email);
      assert.ok(account, 'Signup must use a synthetic test account.');
      if (stallSignup) {
        stallSignup = false;
        let release;
        const waiting = new Promise(resolve => { release = resolve; });
        // Release a successful session only after the client has timed out.
        // An aborted request must never turn that late response into a login.
        const completed = waiting.then(() => respond(200, session(account)));
        stalledSignup = { release, completed };
        return completed;
      }
      if (account.id === directSignupAccount.id) return respond(200, session(account));
      return respond(200, user(account, false));
    }
    if (url.pathname.endsWith('/verify')) {
      assert.equal(request.method(), 'POST');
      assert.equal(body.type, 'email');
      assert.equal(url.searchParams.has('redirect_to'), false, 'Pasted redirects must not be forwarded.');
      assert.equal(body.redirect_to, undefined);
      assert.equal(body.options?.redirectTo, undefined);
      if (body.token_hash) {
        assert.equal(body.token, undefined);
        assert.equal(body.email, undefined);
        if (body.token_hash === verificationHash) return respond(200, session(linkVerificationAccount));
        assert.equal(body.token_hash, expiredHash, 'Only the synthetic expired hash is expected here.');
        return respond(403, { code: 'otp_expired', msg: 'Email link is invalid or has expired' });
      }
      assert.equal(body.email, verificationAccount.email);
      assert.equal(body.token, verificationCode);
      return respond(200, session(verificationAccount));
    }
    if (url.pathname.endsWith('/token')) {
      const account = accounts.find(item => item.email === body.email || body.refresh_token === `synthetic-refresh-${item.id}`);
      if (account && (body.password === password || url.searchParams.get('grant_type') === 'refresh_token')) return respond(200, session(account));
      return respond(400, { code: 'invalid_credentials', error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' });
    }
    if (url.pathname.endsWith('/logout')) {
      if (failLogout) { failLogout = false; await route.abort('failed'); return; }
      await route.fulfill({ status: 204, headers }); return;
    }
    if (url.pathname.endsWith('/resend')) return respond(200, {});
    if (url.pathname.endsWith('/user')) {
      const bearer = request.headers().authorization ?? '';
      let subject;
      try { subject = JSON.parse(Buffer.from(bearer.split('.')[1], 'base64url').toString()).sub; } catch { subject = undefined; }
      const account = accounts.find(item => item.id === subject);
      if (account) return respond(200, user(account));
      return respond(401, { code: 'bad_jwt', msg: 'Synthetic session missing' });
    }
    unexpected.push(request.url());
    return respond(400, { code: 'unexpected_test_request', msg: 'Unexpected auth request in test' });
  });
  return {
    calls, unexpected,
    failNextLogout: () => { failLogout = true; },
    stallNextSignup: () => { stallSignup = true; },
    completeStalledSignup: async () => {
      assert.ok(stalledSignup, 'A signup request must be waiting before releasing its response.');
      const pending = stalledSignup;
      stalledSignup = undefined;
      pending.release();
      await pending.completed;
    },
  };
}

async function dismissNotices(page) {
  for (let index = 0; index < 12 && await button(page, 'Dismiss notification').isVisible(); index++) {
    await button(page, 'Dismiss notification').click();
  }
}

async function notice(page, message) {
  for (let index = 0; index < 12; index++) {
    if (await text(page, message).isVisible()) {
      await shown(text(page, message));
      if (await button(page, 'Dismiss notification').isVisible()) await button(page, 'Dismiss notification').click();
      return;
    }
    await button(page, 'Dismiss notification').waitFor({ state: 'visible', timeout: 10_000 });
    if (await text(page, message).isVisible()) continue;
    await button(page, 'Dismiss notification').click();
  }
  assert.fail(`Expected notification: ${message}`);
}

async function screenshot(page, filename, target) {
  if (target) await target.scrollIntoViewIfNeeded();
  else await page.evaluate(() => { for (const element of document.querySelectorAll('*')) if (element.scrollTop) element.scrollTop = 0; });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(artifacts, filename), animations: 'disabled' });
}

async function guest(page) {
  await button(page, /Continue without account/).click();
  await notice(page, 'Guest mode. Plans stay on this device.');
  await notice(page, 'Trips loaded successfully.');
}

async function home(page) {
  await visible(page.getByRole('link', { name: 'Roam home', exact: true })).click();
  await shown(button(page, 'Smart planner'));
}

async function createTrip(page, title) {
  await button(page, 'New trip').click();
  await fillField(page, 'Trip name', title);
  await fillField(page, 'Destination', 'Varkala, Kerala');
  await fillField(page, 'Start date', startDate);
  await fillField(page, 'End date', endDate);
  await fillField(page, 'Total budget (₹)', '12000');
  await button(page, 'Create trip').click();
  await shown(text(page, title));
  await notice(page, 'Trip created successfully.');
}

async function signIn(page, account) {
  await fillField(page, 'Email', account.email);
  await fillField(page, 'Password', password);
  await button(page, 'Sign in').click();
  await notice(page, 'Signed in successfully. Welcome back!');
  await notice(page, 'Trips loaded successfully.');
  await shown(button(page, 'Sign out'));
}

async function signOut(page) {
  await button(page, 'Sign out').click();
  await shown(text(page, 'Welcome back.'));
  await notice(page, 'Signed out successfully.');
}

async function main() {
  await fs.mkdir(artifacts, { recursive: true });
  const { server, baseURL } = await startServer();
  let browser;
  let page;
  const pageErrors = [];
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Kolkata' });
    const transport = await mockAuthentication(context, baseURL);
    page = await context.newPage();
    page.setDefaultTimeout(20_000);
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(baseURL, { waitUntil: 'networkidle' });
    await shown(text(page, 'Welcome back.'));
    assert.equal(await button(page, 'Sign in').isEnabled(), true, 'Export must contain synthetic test auth config.');
    await screenshot(page, 'features-auth.png');

    await button(page, 'New here? Create an account').click();
    await fillField(page, 'Name', 'Timeout User');
    await fillField(page, 'Email', timeoutAccount.email);
    await fillField(page, 'Password', password);
    await fillField(page, 'Confirm password', password);
    transport.stallNextSignup();
    const failedSignup = page.waitForEvent('requestfailed', {
      predicate: request => request.method() === 'POST' && request.url().endsWith('/auth/v1/signup'),
      timeout: 20_000,
    });
    const signupStarted = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/auth/v1/signup'));
    const signupStartTime = Date.now();
    await button(page, 'Create account').click();
    await signupStarted;
    assert.equal(await field(page, 'Email').isEditable(), false, 'Inputs must stay locked while signup is in flight.');
    await shown(text(page, timeoutMessage));
    assert.ok(Date.now() - signupStartTime < 20_000, 'A stalled signup must settle within the configured 15-second deadline plus UI overhead.');
    const abortedRequest = await failedSignup;
    assert.match(abortedRequest.failure()?.errorText ?? '', /abort/i, 'The timed-out network request must actually be aborted.');
    await dismissNotices(page);
    assert.equal(await button(page, 'Create account').isEnabled(), true);
    assert.equal(await field(page, 'Name').inputValue(), 'Timeout User');
    assert.equal(await field(page, 'Email').inputValue(), timeoutAccount.email);
    assert.equal(await field(page, 'Password').inputValue(), password);
    assert.equal(await field(page, 'Confirm password').inputValue(), password);
    assert.equal(transport.calls.filter(call => call.path.endsWith('/signup') && call.email === timeoutAccount.email).length, 1, 'Timeout must not automatically repeat account creation.');
    await transport.completeStalledSignup();
    await shown(text(page, 'Start your next chapter.'));
    assert.equal(await button(page, 'Sign out').count(), 0, 'A late successful response must not sign the user in after timeout.');
    assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('sb-') && key.endsWith('-auth-token')).length), 0);
    await screenshot(page, 'features-signup-timeout.png');
    await guest(page);
    await shown(button(page, 'Smart planner'));
    await button(page, 'Sign in').click();
    await button(page, 'New here? Create an account').click();
    await fillField(page, 'Name', 'Timeout User');
    await fillField(page, 'Email', timeoutAccount.email);
    await fillField(page, 'Password', password);
    await fillField(page, 'Confirm password', password);
    await button(page, 'Create account').click();
    await shown(text(page, 'Check your inbox.'));
    await notice(page, 'Signup request sent. Check your email to verify your account, then sign in.');
    assert.equal(transport.calls.filter(call => call.path.endsWith('/signup') && call.email === timeoutAccount.email).length, 2, 'An explicit retry must make exactly one fresh signup request.');
    await button(page, 'Back to sign in').click();
    console.log('PASS: Stalled signup aborts within 15 seconds, retains inputs, ignores late success and allows guest access or one explicit retry.');

    const callsBeforeDirectSignup = transport.calls.length;
    await button(page, 'New here? Create an account').click();
    await fillField(page, 'Name', 'Direct Signup User');
    await fillField(page, 'Email', directSignupAccount.email);
    await fillField(page, 'Password', password);
    await fillField(page, 'Confirm password', password);
    await button(page, 'Create account').click();
    await notice(page, 'Account created successfully. You are signed in!');
    await notice(page, 'Trips loaded successfully.');
    await shown(button(page, 'Smart planner'));
    await shown(button(page, 'Sign out'));
    assert.equal(await text(page, 'Check your inbox.').count(), 0, 'Signup with a session must enter the app directly.');
    assert.equal(await field(page, 'Verification code or link').count(), 0);
    assert.equal(await button(page, 'Resend verification email').count(), 0);
    await screenshot(page, 'features-direct-signup.png');
    await page.reload({ waitUntil: 'networkidle' });
    await shown(button(page, 'Smart planner'));
    await shown(button(page, 'Sign out'));
    await notice(page, 'Trips loaded successfully.');
    assert.equal(await button(page, 'Sign in').count(), 0, 'The immediately created session must survive reload.');
    const directSignupCalls = transport.calls.slice(callsBeforeDirectSignup);
    assert.equal(directSignupCalls.filter(call => call.path.endsWith('/signup') && call.email === directSignupAccount.email).length, 1);
    assert.equal(directSignupCalls.filter(call => call.path.endsWith('/verify') || call.path.endsWith('/resend')).length, 0, 'Direct signup must not request email verification or resend.');
    await signOut(page);
    console.log('PASS: Signup without email confirmation signs in immediately, shows success and preserves the session on reload.');

    await fillField(page, 'Email', 'wrong@example.test');
    await fillField(page, 'Password', 'Wrong-password-123!');
    await button(page, 'Sign in').click();
    await shown(text(page, 'Email or password is incorrect. Please try again.'));
    await screenshot(page, 'features-auth-error.png');
    await dismissNotices(page);
    assert.equal(await button(page, 'Smart planner').count(), 0);
    await button(page, 'New here? Create an account').click();
    await fillField(page, 'Name', 'Verification User');
    await fillField(page, 'Email', 'unapproved@example.test');
    await fillField(page, 'Password', password);
    await fillField(page, 'Confirm password', password);
    await button(page, 'Create account').click();
    await shown(text(page, 'Signups are currently limited to approved test email addresses. Try your test account email.'));
    assert.equal(await text(page, 'Check your inbox.').count(), 0, 'Rejected signup must not show the verification-pending screen.');
    assert.equal(await button(page, 'Sign out').count(), 0);
    await dismissNotices(page);
    await fillField(page, 'Email', verificationAccount.email);
    await button(page, 'Create account').click();
    await shown(text(page, 'Check your inbox.'));
    await notice(page, 'Signup request sent. Check your email to verify your account, then sign in.');
    await shown(field(page, 'Verification code or link'));
    assert.equal(await button(page, 'Smart planner').count(), 0, 'Unverified signup must not enter authenticated screens.');
    await screenshot(page, 'features-verification.png');
    await fillField(page, 'Verification code or link', verificationCode);
    await button(page, 'Verify email').click();
    await notice(page, 'Email verified. Your account is ready and you are signed in!');
    await notice(page, 'Trips loaded successfully.');
    await shown(button(page, 'Sign out'));
    assert.equal(transport.calls.filter(call => call.path.endsWith('/verify') && call.verification === 'code').length, 1);
    await signOut(page);
    console.log('PASS: Mocked incorrect password, restricted signup, verification-pending and numeric-code verification.');

    await button(page, 'New here? Create an account').click();
    await fillField(page, 'Name', 'Link Verification User');
    await fillField(page, 'Email', linkVerificationAccount.email);
    await fillField(page, 'Password', password);
    await fillField(page, 'Confirm password', password);
    await button(page, 'Create account').click();
    await shown(text(page, 'Check your inbox.'));
    await notice(page, 'Signup request sent. Check your email to verify your account, then sign in.');
    const callsBeforeForeignLink = transport.calls.length;
    const unexpectedBeforeForeignLink = transport.unexpected.length;
    await fillField(page, 'Verification code or link', confirmationLink(verificationHash).replace(syntheticHost, 'foreign.supabase.co'));
    await button(page, 'Verify email').click();
    await shown(text(page, 'Enter the code from your email or paste its full confirmation link.'));
    await dismissNotices(page);
    assert.equal(transport.calls.length, callsBeforeForeignLink, 'Foreign links must be rejected before any auth request.');
    assert.equal(transport.unexpected.length, unexpectedBeforeForeignLink, 'Foreign links must never be fetched.');
    await fillField(page, 'Verification code or link', confirmationLink(expiredHash));
    await button(page, 'Verify email').click();
    await shown(text(page, 'That verification code or link has expired or is incorrect. Request a new email, or sign in if you already opened the link.'));
    assert.equal(await button(page, 'Sign out').count(), 0, 'Expired links must not create a session.');
    await dismissNotices(page);
    await fillField(page, 'Verification code or link', confirmationLink(verificationHash));
    await screenshot(page, 'features-verification-link.png');
    await button(page, 'Verify email').click();
    await notice(page, 'Email verified. Your account is ready and you are signed in!');
    await notice(page, 'Trips loaded successfully.');
    await shown(button(page, 'Sign out'));
    assert.equal(transport.calls.filter(call => call.path.endsWith('/verify') && call.verification === 'link').length, 2);
    await signOut(page);
    console.log('PASS: Foreign links rejected locally, expired links explained and copied confirmation links verified without redirects.');

    await guest(page);
    await shown(button(page, 'Smart planner'));
    await screenshot(page, 'features-home.png');
    await button(page, 'Smart planner').click();
    await button(page, 'Generate plan').click();
    await shown(text(page, 'Enter your total trip budget in rupees.'));
    await dismissNotices(page);
    await fillField(page, 'Destination', 'Jaipur');
    await fillField(page, 'Total budget (₹)', '25000');
    await fillField(page, 'Travelers', '2');
    await fillField(page, 'Start date', startDate);
    await fillField(page, 'End date', endDate);
    await button(page, 'Generate plan').click();
    await shown(text(page, 'Your plan'));
    await notice(page, 'Plan ready. Review the estimates before saving.');
    assert.ok(await page.getByRole('link', { name: /Find stays in .* on Maps/ }).filter({ visible: true }).count() > 0);
    await fillField(page, 'Total budget (₹)', '30000');
    assert.equal(await button(page, 'Save this plan').count(), 0, 'Editing inputs must invalidate the preview.');
    await button(page, 'Generate plan').click();
    await notice(page, 'Plan ready. Review the estimates before saving.');
    await screenshot(page, 'features-planner.png', text(page, 'Your plan'));
    await button(page, 'Save this plan').click();
    await shown(text(page, plannedTitle));
    await notice(page, 'Your planned trip was saved successfully.');
    await page.reload({ waitUntil: 'networkidle' });
    await guest(page);
    await shown(text(page, plannedTitle));
    const storedGuestTrips = await page.evaluate(() => JSON.parse(localStorage.getItem('trip-planner.trips.v1')).trips);
    assert.equal(storedGuestTrips.filter(trip => trip.title === plannedTitle).length, 1);
    assert.ok(storedGuestTrips.find(trip => trip.title === plannedTitle).activities.length > 5);
    console.log('PASS: Guest planner generation, preview invalidation, durable save and reload.');

    await home(page);
    await button(page, 'New trip').click();
    await button(page, 'Create trip').click();
    await shown(text(page, 'Add a budget in rupees. Enter 0 if you haven’t set one yet.'));
    await screenshot(page, 'features-validation.png');
    await dismissNotices(page);
    await button(page, 'Close form').click();
    const manualTitle = 'Browser CRUD trip';
    await createTrip(page, manualTitle);
    await button(page, 'Add activity').click();
    await fillField(page, 'Activity name', 'Coffee by the sea');
    await fillField(page, 'Date', startDate);
    await fillField(page, 'Time', '08:45');
    await fillField(page, 'Estimated cost (₹)', '450');
    await button(page, 'Add to itinerary').click();
    await notice(page, 'Activity saved successfully.');
    await visible(page.getByRole('checkbox', { name: 'Mark Coffee by the sea complete', exact: true })).click();
    await notice(page, 'Activity updated successfully.');
    await button(page, 'Edit trip').click();
    await fillField(page, 'Total budget (₹)', '14000');
    await button(page, 'Save changes').click();
    await notice(page, 'Trip updated successfully.');
    await page.reload({ waitUntil: 'networkidle' });
    await guest(page);
    await shown(text(page, '₹14,000'));
    assert.equal(await visible(page.getByRole('checkbox', { name: 'Mark Coffee by the sea incomplete', exact: true })).getAttribute('aria-checked'), 'true');
    await screenshot(page, 'features-trip.png');
    await button(page, 'Remove Coffee by the sea').click();
    await notice(page, 'Activity deleted successfully.');
    await button(page, 'Delete trip').click();
    await text(page, 'Delete this trip?').locator('..').getByRole('button', { name: 'Delete trip', exact: true }).click();
    await notice(page, 'Trip deleted successfully.');
    await shown(button(page, 'Smart planner'));
    assert.equal(await button(page, `Open ${manualTitle}`).count(), 0);
    await page.reload({ waitUntil: 'networkidle' });
    await guest(page);
    assert.equal(await button(page, `Open ${manualTitle}`).count(), 0);
    console.log('PASS: Trip/activity CRUD, validation, success notifications and persisted deletion.');

    await button(page, 'Sign in').click();
    await signIn(page, accountA);
    await shown(text(page, 'No trips yet'));
    assert.equal(await button(page, `Open ${plannedTitle}`).count(), 0, 'Guest trips must not leak into account A.');
    await createTrip(page, 'Account A private trip');
    await home(page);
    await signOut(page);
    await signIn(page, accountB);
    await shown(text(page, 'No trips yet'));
    assert.equal(await button(page, 'Open Account A private trip').count(), 0, 'Account A trips must not leak into account B.');
    await screenshot(page, 'features-account-b.png');
    transport.failNextLogout();
    await button(page, 'Sign out').click();
    await shown(text(page, 'Welcome back.'));
    const offlineMessage = 'Signed out on this device. Server sign-out could not be confirmed.';
    await shown(text(page, offlineMessage));
    await screenshot(page, 'features-offline-logout.png');
    await notice(page, offlineMessage);
    assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('sb-') && key.endsWith('-auth-token')).length), 0);
    await page.reload({ waitUntil: 'networkidle' });
    await shown(text(page, 'Welcome back.'));
    assert.equal(await button(page, 'Sign out').count(), 0);
    console.log('PASS: Failed logout transport clears the local session and shows the accurate offline notice.');
    await signIn(page, accountA);
    await shown(button(page, 'Open Account A private trip'));
    await page.reload({ waitUntil: 'networkidle' });
    await shown(button(page, 'Open Account A private trip'));
    await notice(page, 'Trips loaded successfully.');
    await signOut(page);
    await guest(page);
    await shown(button(page, `Open ${plannedTitle}`));
    assert.equal(await button(page, 'Open Account A private trip').count(), 0);
    console.log('PASS: Mocked account sessions, sign-out notices and guest/account A/account B storage isolation.');

    assert.ok(transport.calls.some(call => call.path.endsWith('/signup')));
    assert.ok(transport.calls.some(call => call.path.endsWith('/token') && call.email === 'wrong@example.test'));
    assert.deepEqual(transport.unexpected, [], 'Unexpected external request; all auth must stay mocked.');
    assert.deepEqual(pageErrors, [], 'Uncaught browser errors.');
    console.log(`PASS: No uncaught browser errors or live service calls. Screenshots: ${artifacts}`);
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(artifacts, 'features-failure.png') }).catch(() => {});
    if (pageErrors.length) console.error('Page errors:', pageErrors);
    throw error;
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });

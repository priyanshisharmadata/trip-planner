/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

const baseURL = 'http://127.0.0.1:8081';
const artifactDirectory = path.resolve(__dirname, '..', 'artifacts');
const mobileViewport = { width: 390, height: 844 };

async function visible(locator) {
  const shown = locator.filter({ visible: true }).first();
  await shown.waitFor({ state: 'visible' });
  assert.equal(await shown.isVisible(), true);
}

async function screenshot(page, name) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images).map((image) => {
      if (image.complete) return Promise.resolve();
      return new Promise((resolve) => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', resolve, { once: true });
      });
    }));
    // React Native Web uses nested scroll views rather than the document scroller.
    for (const element of document.querySelectorAll('*')) {
      if (element.scrollTop) element.scrollTop = 0;
    }
    window.scrollTo(0, 0);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.screenshot({ path: path.join(artifactDirectory, name), fullPage: true, animations: 'disabled' });
}

async function main() {
  await fs.mkdir(artifactDirectory, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: mobileViewport, deviceScaleFactor: 1, timezoneId: 'Asia/Kolkata' });
  const page = await context.newPage();
  page.setDefaultTimeout(25_000);
  page.setDefaultNavigationTimeout(90_000);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));

  try {
    await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
    await visible(page.getByRole('button', { name: 'Open A little Bali escape', exact: true }));
    await visible(page.getByRole('button', { name: 'Open Meet me in the mountains', exact: true }));
    await visible(page.getByRole('button', { name: 'Open A weekend in the Pink City', exact: true }));
    await screenshot(page, 'home-mobile.png');
    await page.setViewportSize({ width: 1440, height: 1080 });
    await visible(page.getByRole('button', { name: /Plan a trip/ }));
    await screenshot(page, 'home-desktop.png');
    await page.setViewportSize(mobileViewport);
    console.log('PASS: Seed trips render at mobile and desktop widths.');

    const tripName = 'Smoke test coastal escape';
    const activityName = 'Explore the lighthouse';
    const dates = await page.evaluate(() => {
      const format = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const start = new Date();
      start.setDate(start.getDate() + 10);
      const end = new Date(start);
      end.setDate(end.getDate() + 2);
      return { start: format(start), end: format(end) };
    });

    await page.getByRole('button', { name: /New trip/ }).click();
    await page.getByRole('textbox', { name: 'Trip name', exact: true }).fill(tripName);
    await page.getByRole('textbox', { name: 'Destination', exact: true }).fill('Varkala, Kerala');
    await page.getByRole('textbox', { name: 'Start date', exact: true }).fill(dates.start);
    await page.getByRole('textbox', { name: 'End date', exact: true }).fill(dates.end);
    await page.getByRole('textbox', { name: 'Total budget (₹)', exact: true }).fill('25000');
    await page.getByRole('radio', { name: 'Beach trip cover', exact: true }).click();
    await page.getByRole('button', { name: 'Create trip', exact: true }).click();
    await page.waitForURL((url) => url.pathname.startsWith('/trip/'));
    const tripURL = page.url();
    await visible(page.getByText(tripName, { exact: true }));
    await visible(page.getByText('₹25,000', { exact: true }));
    console.log('PASS: Trip creation opens its itinerary.');

    await page.getByRole('button', { name: 'Add activity', exact: true }).click();
    await page.getByRole('textbox', { name: 'Activity name', exact: true }).fill(activityName);
    await page.getByRole('textbox', { name: 'Date', exact: true }).fill(dates.start);
    await page.getByRole('textbox', { name: 'Time', exact: true }).fill('10:30');
    await page.getByRole('textbox', { name: 'Estimated cost (₹)', exact: true }).fill('1500');
    await page.getByRole('button', { name: 'Add to itinerary', exact: true }).click();
    await visible(page.getByText(activityName, { exact: true }));
    await visible(page.getByText('10:30', { exact: true }));
    await visible(page.getByText('₹1,500 estimated', { exact: true }));
    const pendingActivity = page.getByRole('checkbox', { name: `Mark ${activityName} complete`, exact: true });
    await pendingActivity.click();
    const completedActivity = page.getByRole('checkbox', { name: `Mark ${activityName} incomplete`, exact: true });
    await visible(completedActivity);
    assert.equal(await completedActivity.getAttribute('aria-checked'), 'true');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await visible(completedActivity);
    assert.equal(await completedActivity.getAttribute('aria-checked'), 'true');
    await visible(page.getByText(tripName, { exact: true }));
    await visible(page.getByText('10:30', { exact: true }));
    await visible(page.getByText('₹1,500 estimated', { exact: true }));
    assert.equal(page.url(), tripURL);
    await screenshot(page, 'trip-mobile.png');
    console.log('PASS: Activity details and completion persist after reload.');

    await page.getByRole('button', { name: 'Edit trip', exact: true }).click();
    const budgetInput = page.getByRole('textbox', { name: 'Total budget (₹)', exact: true });
    assert.equal(await budgetInput.inputValue(), '25000');
    await budgetInput.fill('30000');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await visible(page.getByText('₹30,000', { exact: true }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await visible(page.getByText('₹30,000', { exact: true }));
    await visible(completedActivity);
    assert.equal(await completedActivity.getAttribute('aria-checked'), 'true');
    console.log('PASS: Budget edits persist and preserve activities.');

    await page.getByRole('button', { name: 'Delete trip', exact: true }).click();
    const confirmation = page.getByText('Delete this trip?', { exact: true });
    await visible(confirmation);
    await confirmation.locator('..').getByRole('button', { name: /Delete trip/ }).click();
    await page.waitForURL((url) => url.pathname === '/');
    await visible(page.getByRole('button', { name: 'Open A little Bali escape', exact: true }));
    assert.equal(await page.getByRole('button', { name: `Open ${tripName}`, exact: true }).count(), 0);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await visible(page.getByRole('button', { name: 'Open A little Bali escape', exact: true }));
    assert.equal(await page.getByRole('button', { name: `Open ${tripName}`, exact: true }).count(), 0);
    assert.equal(await page.getByText(tripName, { exact: true }).count(), 0);
    assert.deepEqual(pageErrors, [], `Uncaught browser errors:\n${pageErrors.join('\n')}`);
    console.log('PASS: Confirmed deletion persists after reload; no uncaught page errors.');
    console.log(`Screenshots saved in ${artifactDirectory}`);
  } catch (error) {
    await page.screenshot({ path: path.join(artifactDirectory, 'smoke-failure.png'), fullPage: true }).catch(() => {});
    if (pageErrors.length) console.error('Uncaught browser errors:', pageErrors.join('\n'));
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const output = resolve('test-results');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const errors = [];
const externalRequests = [];
const track = page => {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => { if (/^https?:/.test(request.url())) externalRequests.push(request.url()); });
};
const ready = async page => { await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, { timeout: 60000 }); await page.waitForTimeout(1000); };
const state = page => page.evaluate(() => window.__goldenGate.state);
const distance = (a, b) => Math.hypot(...a.map((value, i) => value - b[i]));
const screenshot = (page, name) => page.screenshot({ path: resolve(output, name + '.png') });

try {
  const page = await browser.newPage({ viewport: { width: 1512, height: 982 }, deviceScaleFactor: 1 });
  track(page);
  await page.goto(pathToFileURL(resolve('index.html')).href);
  await ready(page);
  const initial = await state(page);
  assert.equal(initial.mode, 'sunset');
  assert.equal(initial.cars, 66);
  assert.ok(initial.drawCalls < 120, 'Static structure and traffic should be batched');
  assert.ok(initial.triangles > 150000, 'Detailed model should be present');
  await screenshot(page, 'desktop');

  await page.locator('[data-light=night]').click();
  await page.waitForTimeout(800);
  assert.equal((await state(page)).mode, 'night');
  assert.equal(await page.locator('body').getAttribute('data-light'), 'night');
  await screenshot(page, 'night');
  await page.locator('[data-light=day]').click();
  assert.equal((await state(page)).mode, 'day');
  await page.locator('#fog-range').fill('83');
  await page.locator('#fog-range').dispatchEvent('input');
  assert.equal((await state(page)).fog, .83);
  assert.equal(await page.locator('#fog-value').textContent(), '83%');
  await page.locator('#fog-range').fill('20');
  await page.locator('#fog-range').dispatchEvent('input');

  await page.locator('[data-view=tower]').click();
  await page.waitForTimeout(1700);
  const close = await state(page);
  assert.ok(distance(close.camera, close.target) < 400);
  await screenshot(page, 'tower');
  await page.locator('[data-view=aerial]').click();
  await page.waitForTimeout(1700);
  assert.ok((await state(page)).camera[1] > 900);
  await screenshot(page, 'aerial');
  await page.locator('#reset-view').click();
  await page.waitForTimeout(1700);
  const beforeZoom = await state(page);
  await page.locator('#zoom-in').click();
  const afterZoom = await state(page);
  assert.ok(distance(afterZoom.camera, afterZoom.target) < distance(beforeZoom.camera, beforeZoom.target) * .9);
  await page.locator('#zoom-out').click();
  await page.locator('#scene').focus();
  const beforeKey = await state(page);
  await page.keyboard.press('ArrowLeft');
  assert.ok(distance(beforeKey.camera, (await state(page)).camera) > 15);
  await page.keyboard.press('r');
  await page.waitForTimeout(1700);
  await page.locator('#auto-rotate').click();
  const beforeRotate = await state(page);
  await page.waitForTimeout(800);
  assert.ok((await state(page)).autoRotate);
  assert.ok(distance(beforeRotate.camera, (await state(page)).camera) > 2);
  // A pointer gesture takes control back from the automated orbit.
  await page.mouse.move(740, 550); await page.mouse.down();
  await page.mouse.move(830, 530, { steps: 8 }); await page.mouse.up();
  assert.equal((await state(page)).autoRotate, false);

  await page.locator('[data-dialog=about]').click();
  assert.ok(await page.locator('#about-dialog').evaluate(dialog => dialog.open));
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#about-dialog').evaluate(dialog => dialog.open), false);
  await page.locator('[data-dialog=help]').click();
  assert.ok(await page.locator('#help-dialog').evaluate(dialog => dialog.open));
  await page.locator('#help-dialog .dialog-close').click();
  await page.locator('#fullscreen').click();
  assert.ok(await page.evaluate(() => Boolean(document.fullscreenElement)));
  await page.locator('#fullscreen').click();

  await page.locator('[data-light=sunset]').click();
  await page.locator('#reset-view').click();
  await page.waitForTimeout(1800);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#save-image').click();
  const download = await downloadPromise;
  const downloadedPath = resolve(output, 'exported-frame.png');
  await download.saveAs(downloadedPath);
  const png = await readFile(downloadedPath);
  assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a');
  assert.ok(png.readUInt32BE(16) >= 1600);
  assert.ok(png.length > 50000, 'Export must contain a rendered scene');
  console.log('PASS desktop: offline render, three light modes, fog, presets, zoom, keyboard, orbit, drag, dialogs, fullscreen, PNG export');
  await page.close();

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  track(phone);
  await phone.goto(pathToFileURL(resolve('index.html')).href);
  await ready(phone);
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await phone.evaluate(() => document.documentElement.scrollHeight <= innerHeight), true);
  await screenshot(phone, 'mobile');
  await phone.getByRole('button', { name: '夜景', exact: true }).tap();
  assert.equal((await state(phone)).mode, 'night');
  await phone.getByRole('button', { name: '海湾俯瞰', exact: true }).tap();
  await phone.waitForTimeout(1700);
  assert.ok((await state(phone)).camera[1] > 1000);
  await phone.setViewportSize({ width: 320, height: 568 });
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await phone.evaluate(() => document.documentElement.scrollHeight <= innerHeight), true);
  await screenshot(phone, 'small-mobile');
  console.log('PASS mobile: portrait layouts, touch controls, light and aerial presets, no overflow at 390px and 320px');
  await phone.close();

  const calm = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce', colorScheme: 'dark' });
  track(calm);
  await calm.goto(pathToFileURL(resolve('index.html')).href);
  await ready(calm);
  const calmState = await state(calm);
  assert.equal(calmState.mode, 'night');
  assert.equal(calmState.autoRotate, false);
  await calm.locator('[data-view=tower]').click();
  assert.ok(distance((await state(calm)).camera, [505, 181, 250]) < 1);
  console.log('PASS preferences: system dark mode and immediate reduced-motion transitions');
  assert.deepEqual(errors, [], 'Browser must not report JavaScript or shader errors');
  assert.deepEqual(externalRequests, [], 'Standalone HTML must make no network requests');
  console.log(`PASS rendering: ${initial.drawCalls} draw calls · ${initial.triangles.toLocaleString()} triangles · zero network requests or browser errors`);
} finally { await browser.close(); }

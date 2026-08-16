import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const cloud = await readFile(new URL('../public/cloud.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const sw = await readFile(new URL('../public/service-worker.js', import.meta.url), 'utf8');
const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));

test('v3 exposes explicit local and online modes', () => {
  assert.match(html, /data-v3-mode="local"/);
  assert.match(html, /data-v3-mode="online"/);
  assert.match(html, /id="v3OnlineToggle"/);
  assert.match(cloud, /function setMode\(on\)/);
});

test('local core never routes API requests through service worker', () => {
  assert.match(sw, /pathname\.startsWith\('\/api\/'\)/);
  assert.match(sw, /cnc-copilot-full-v300/);
});

test('AI scan is blocked until online mode is explicitly enabled', () => {
  assert.match(cloud, /#runScanner/);
  assert.match(cloud, /if\s*\(\s*!connected\s*\)/);
  assert.match(cloud, /AI выключен/);
});

test('passkey authentication and offline trusted-device unlock are present', () => {
  assert.match(html, /Face ID \/ Passkey/);
  assert.match(cloud, /navigator\.credentials\.get/);
  assert.match(cloud, /cncV3TrustedProfile/);
  assert.match(cloud, /verifyOfflineAssertion/);
  assert.match(cloud, /crypto\.subtle\.verify/);
  assert.match(cloud, /userVerification\s*:\s*['"]required['"]/);
});

test('smart cupboard and projects are included in cloud sync payload', () => {
  assert.match(app, /getSyncPayload\(\)/);
  assert.match(app, /tools\s*:\s*store\.get\(KEYS\.tools/);
  assert.match(app, /projects\s*:\s*store\.get\(KEYS\.projects/);
  assert.match(cloud, /function merge\(local,\s*remote\)/);
});

test('adaptive bottom dock from FULL 1.1.2 is preserved', () => {
  assert.match(app, /function initAdaptiveDock\(\)/);
  assert.match(app, /dock-collapsed/);
  assert.match(css, /body > \.bottom-nav\.glass\.dock-collapsed/);
  assert.match(html, /<nav class="bottom-nav glass mobile-only">/);
});

test('multi-operation and multi-tool workflow remains present', () => {
  assert.match(html, /id="operationCatalog"/);
  assert.match(html, /Мультивыбор из шкафа/);
  assert.match(html, /id="processToolTray"/);
  assert.match(app, /selectedToolIds/);
});

test('material color cards and three theme modes remain present', () => {
  assert.match(html, /id="materialGrid"/);
  assert.match(app, /themeModes=\['system','light','dark'\]/);
  assert.match(css, /html\[data-theme="light"\]/);
});

test('manifest identifies the 3.0 application', () => {
  assert.match(manifest.name, /3\.0/);
  assert.equal(manifest.display, 'standalone');
});

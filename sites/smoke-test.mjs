import assert from 'node:assert/strict';
import worker from './worker.mjs';

const ctx = { waitUntil(promise) { Promise.resolve(promise).catch(() => {}); } };
async function call(path, init = {}) {
  return worker.fetch(new Request('https://arena-sites.test' + path, init), {}, ctx);
}

const root = await call('/');
assert.equal(root.status, 200, 'homepage should render');
const html = await root.text();
assert.match(html, /\/v112\/app\.js/, 'homepage should point to the preserved v112 app bundle');
assert.match(html, /maximum-scale=1,user-scalable=no/, 'mobile viewport patch should be present');

const app = await call('/v112/app.js');
assert.equal(app.status, 200, 'patched app module should be served');
assert.match(await app.text(), /CLIENT_BOOT_OK/, 'client boot diagnostics should remain present');

const icon = await call('/assets/icons/esports-controller-clean-v79.png');
assert.equal(icon.status, 200, 'controller icon should be served');
assert.match(icon.headers.get('content-type') || '', /^image\/png/, 'controller icon should be PNG');
assert.equal((await icon.arrayBuffer()).byteLength, 1810, 'controller icon bytes should match the source asset');

const health = await call('/health');
assert.equal(health.status, 200, 'health endpoint should respond');
const healthJson = await health.json();
assert.equal(healthJson.ok, true);
assert.match(healthJson.runtime, /parik-feed/);

const syncStatus = await call('/api/sync/status');
assert.equal(syncStatus.status, 200, 'sync status endpoint should respond');
assert.equal((await syncStatus.json()).ok, true);

const badLoginMethod = await call('/api/profile/login', { method: 'GET' });
assert.equal(badLoginMethod.status, 405, 'login endpoint should reject non-POST methods');

console.log('SITES_SMOKE_TEST_OK ' + JSON.stringify({
  homepage: 200,
  appModule: 200,
  iconBytes: 1810,
  health: 200,
  syncStatus: 200,
  methodGuard: 405
}));

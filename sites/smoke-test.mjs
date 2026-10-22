import assert from 'node:assert/strict';
import worker from './worker.mjs';

const ctx = { waitUntil(promise) { Promise.resolve(promise).catch(() => {}); } };
async function call(path, init = {}, env = {}) {
  return worker.fetch(new Request('https://arena-sites.test' + path, init), env, ctx);
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

const profiles = new Map();
const events = new Map();
const states = new Map();
class MockStatement {
  constructor(db, sql) { this.db=db; this.sql=sql.replace(/\\s+/g,' ').trim(); this.params=[]; }
  bind(...params) { this.params=params; return this; }
  async run() {
    const sql=this.sql, p=this.params;
    if(sql.startsWith('CREATE TABLE')||sql.startsWith('CREATE INDEX')) return {meta:{changes:0}};
    if(sql.startsWith('INSERT INTO arena_profiles')) {
      const [email,hash,profile_json,profile_revision,updated_at]=p;
      if(profiles.has(email)) throw new Error('UNIQUE constraint failed: arena_profiles.email');
      profiles.set(email,{email,hash,profile_json,profile_revision,updated_at});
      return {meta:{changes:1}};
    }
    if(sql.startsWith('UPDATE arena_profiles SET hash=?,profile_json=?,profile_revision=?,updated_at=? WHERE email=? AND profile_revision=? AND hash=?')) {
      const [hash,profile_json,profile_revision,updated_at,email,expectedRevision,expectedHash]=p;
      const current=profiles.get(email);
      if(!current||current.profile_revision!==expectedRevision||current.hash!==expectedHash) return {meta:{changes:0}};
      profiles.set(email,{email,hash,profile_json,profile_revision,updated_at});
      return {meta:{changes:1}};
    }
    if(sql.startsWith('UPDATE arena_profiles SET hash=?,profile_json=?,profile_revision=?,updated_at=? WHERE email=? AND hash=? AND profile_revision=?')) {
      const [hash,profile_json,profile_revision,updated_at,email,expectedHash,expectedRevision]=p;
      const current=profiles.get(email);
      if(!current||current.hash!==expectedHash||current.profile_revision!==expectedRevision) return {meta:{changes:0}};
      profiles.set(email,{email,hash,profile_json,profile_revision,updated_at});
      return {meta:{changes:1}};
    }
    if(sql.startsWith('INSERT INTO arena_runtime_state')) {
      states.set('syncMeta',{value_json:p[0],updated_at:p[1]});
      return {meta:{changes:1}};
    }
    if(sql.startsWith('INSERT INTO arena_synced_events')) {
      const [id,event_json,synced_at,start_time]=p;
      events.set(id,{id,event_json,synced_at,start_time});
      return {meta:{changes:1}};
    }
    if(sql.startsWith('DELETE FROM arena_synced_events')) return {meta:{changes:0}};
    throw new Error('Mock D1 does not implement SQL: '+sql);
  }
  async first() {
    if(this.sql.startsWith('SELECT profile_json FROM arena_profiles')) {
      const row=profiles.get(this.params[0]);
      return row?{profile_json:row.profile_json}:null;
    }
    if(this.sql.startsWith("SELECT value_json FROM arena_runtime_state")) {
      const row=states.get('syncMeta');
      return row?{value_json:row.value_json}:null;
    }
    throw new Error('Mock D1 does not implement first(): '+this.sql);
  }
  async all() {
    if(this.sql.startsWith('SELECT event_json FROM arena_synced_events')) {
      return {results:[...events.values()].sort((a,b)=>b.synced_at-a.synced_at).slice(0,5000).map(row=>({event_json:row.event_json}))};
    }
    throw new Error('Mock D1 does not implement all(): '+this.sql);
  }
}
const db = {
  prepare(sql) { return new MockStatement(this,sql); },
  async batch(statements) { const results=[]; for(const statement of statements) results.push(await statement.run()); return results; }
};
const env={DB:db};
const email='demo@example.com';
const oldHash='a'.repeat(64);
const newHash='b'.repeat(64);
const profile={email,hash:oldHash,balance:10000,payments:[],bets:[],profileRevision:0,id:'demo-profile',firstName:'Demo',lastName:'User'};

const sync=await call('/api/profile/sync',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+oldHash},body:JSON.stringify({profile})},env);
assert.equal(sync.status,200,'new profile should persist in D1');
const synced=await sync.json();
assert.equal(synced.profile.profileRevision,1);

const login=await call('/api/profile/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,hash:oldHash})},env);
assert.equal(login.status,200,'profile should log in after sync');

const getProfile=await call('/api/profile?email='+encodeURIComponent(email),{headers:{authorization:'Bearer '+oldHash}},env);
assert.equal(getProfile.status,200,'profile should reload from D1');

const password=await call('/api/profile/password',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+oldHash},body:JSON.stringify({email,newHash})},env);
assert.equal(password.status,200,'password update should persist in D1');

const newLogin=await call('/api/profile/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,hash:newHash})},env);
assert.equal(newLogin.status,200,'new password hash should work');
const oldLogin=await call('/api/profile/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,hash:oldHash})},env);
assert.equal(oldLogin.status,401,'old password hash should stop working');

const staleProfile={...profile,hash:newHash,profileRevision:1};
const staleSync=await call('/api/profile/sync',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+newHash},body:JSON.stringify({profile:staleProfile})},env);
assert.equal(staleSync.status,409,'stale profile revisions should conflict');

const eventSync=await call('/api/sync/events',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({source:'smoke-test',sport:'esports',stage:'prematch',revision:1,rows:[{id:'event-1',name:'Team A - Team B',sport:'cs',startTime:Math.floor(Date.now()/1000)+3600,competitors:[{id:'1',name:'Team A'},{id:'2',name:'Team B'}]}]})},env);
assert.equal(eventSync.status,200,'event sync should persist');
assert.equal((await eventSync.json()).accepted,1);
const freshWorker=(await import('./worker.mjs?fresh='+Date.now())).default;
const hydrated=await freshWorker.fetch(new Request('https://arena-sites.test/api/sync/status?ids=event-1'),env,ctx);
assert.equal(hydrated.status,200);
const hydratedJson=await hydrated.json();
assert.equal(hydratedJson.events.length,1,'synced events should survive a fresh worker instance');

console.log('SITES_SMOKE_TEST_OK ' + JSON.stringify({
  homepage:200,appModule:200,iconBytes:1810,health:200,syncStatus:200,
  profileSync:200,profileLogin:200,profileReload:200,passwordChange:200,
  staleRevision:409,eventPersistence:200
}));

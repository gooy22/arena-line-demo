import http from 'node:http';
import { Readable } from 'node:stream';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import app from './dist/server/index.js';
import { augmentSettlements, completedHistory, probeResultsSource } from './results_bridge.mjs';
import { readProfile, loginProfile, syncProfile, profileStorageStatus } from './profile_store.mjs';

const port = Number(process.env.PORT || 3000);
const env = {};
const ctx = {
  waitUntil(promise) {
    Promise.resolve(promise).catch(error => {
      console.error('Arena background task failed', error?.stack || error);
    });
  }
};

const feedModule = await readFile(new URL('./feed.mjs', import.meta.url), 'utf8');
const emblemModule = await readFile(new URL('./overrides/team-emblem.mjs', import.meta.url), 'utf8');
const accountModule = await readFile(new URL('./overrides/account.mjs', import.meta.url), 'utf8');
const appModule = await readFile(new URL('./overrides/app.js', import.meta.url), 'utf8');
const betViewModule = await readFile(new URL('./overrides/bet-view.mjs', import.meta.url), 'utf8');
const themeCssModule = await readFile(new URL('./overrides/theme.css', import.meta.url), 'utf8');
const serviceWorkerModule = await readFile(new URL('./overrides/sw.js', import.meta.url), 'utf8');
const manifestModule = await readFile(new URL('./overrides/manifest.webmanifest', import.meta.url), 'utf8');

const inflateText = value => gunzipSync(Buffer.from(value,'base64')).toString('utf8');
const accountSyncModule = inflateText("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");
const appOverrideModule = inflateText("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");
const betViewOverrideModule = inflateText("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");
const arenaOverridesCss = inflateText("H4sIANlzuGoC/61WTW/jNhC951ewMArEgelIiteOFXTR7a233vZQ9ECJI4uwRAok5Y8G+e8dSnKsz3XQDQxbMDmcefPmzVCPD+SbBslIoRUvYyuUJOoAWgsOhjw83i2tKrVkOUhLzTmPVPZ6R0jE4v1Oq1LycOZ77vOLyAulLZP2xe0rzUGHvVVV2kxICAfGJ2pSxtUxlEpCe/OtE9+yyHyNSmuVXDLEegAyAe8TwwPLKeRRBjktRGxLDYu7vzmzjNoUcviNM73/h4zbLeFQ4b7ujZ4dWH2cYhqrTOkpi5uJZWqnptNxux+BkosTRdiS01xxwGA6Z1k33N3jA/lTGsuyDDj56/u30CnugCrTxDg7wrQ9Kr0neWksQcMzQSkKa0gmdimuYJ1jIFZksKx0WZ2akGTylPgAveqjqpMMuUgF5yArDto+yFJDAtgLMdCdZkUq4lFmbpx5/Qgft9DWfP0BlgAXVmmSqAyhG4JIiIEMYosssqIgFbQXIhU5psLiZgp4Skji0BIXvmKLC4bFXEZgqfNI6/892g5M31NqSp2wGBYzf4Of9byLu5ZbbSnkfjFLviSrxJ9/Tvt7xF8XJ7L28Gfmed6zo2JYg+lsaL2QCMiQ2OBL8BT4L9f1mGkn4diP/G2/CnW6vSbphSDL+klTYLyqNNM7IWmkcCbl4XNx+uGpWBXn6ynMFvOdOpOgaBYjyy4zA3Zk67rg0vzkMfju26qiHdvESoOLxYUpMnYOd3hzOHfuiSMtx0ULbkqVuTShn2iC38qAFaEf9LO/QG8o8leoBM+ZF4xzIXfVSmv8acZFaRpHI2p+d7roqJsalVgUb+A6bz4fYiDpU69STdxEuZtG/Auhk6pbcWSiINyUCgOvnxB62IPtV72B2+6mvMSenvdCBMMQddgRxWQsgqwlSqzUCMGNsZBFOSaierg4L0fBbRr6nverQ9AEXz232f95ZQ3q6NX+L9W+UjVe2aodfljaG+Mr2AbroDu+ptgKExWXZpKzevv1p6ZfpQ03+zabzWoKk3GvZv+/5RqGLw3mRq1HLjJ5D/A6VfObHdctQ8ADFmzmo2JfzBhj621L9Mc64trzumiat73BNR8km5U3VuGmrj0KK38FO2MpaKHhIODYasygpmI96PPBiDasxtJutLaRBpyKnLLqddp8reNG9RRos7DTAHKBF90W1ttqCP2eoy27z9mJ1v23cqjmdbWnLr1Lr8Ysi+9dwxJKqmMv1aZz1pTyYsEPadfm0m8VB5fB9obf7uDvz30nKEz8DZH/B+IKD2VJDAAA");



let profileRoot = process.env.ARENA_DATA_DIR || '/data/arena-line';
let profileStorePersistent = Boolean(process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.ARENA_DATA_DIR);
const profileWrites = new Map();

async function ensureProfileRoot() {
  try { await mkdir(profileRoot,{recursive:true}); }
  catch {
    profileRoot='/tmp/arena-line';
    profileStorePersistent=false;
    await mkdir(profileRoot,{recursive:true});
  }
}
await ensureProfileRoot();

function profilePath(email) {
  const id=createHash('sha256').update(String(email).toLowerCase()).digest('hex');
  return profileRoot + '/profile-' + id + '.json';
}
function safeProfileAccount(raw) {
  const account=structuredClone(raw || {});
  account.email=safeString(account.email,180).trim().toLowerCase();
  account.id=safeString(account.id,80);
  account.firstName=safeString(account.firstName,80);
  account.lastName=safeString(account.lastName,80);
  account.hash=safeString(account.hash,128);
  account.balance=Number(account.balance);
  account.syncRevision=Number.isSafeInteger(Number(account.syncRevision)) ? Number(account.syncRevision) : 0;
  account.payments=Array.isArray(account.payments) ? account.payments.slice(0,10000) : [];
  account.bets=Array.isArray(account.bets) ? account.bets.slice(0,10000) : [];
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.email)) throw new Error('Invalid email');
  if(!/^[a-f0-9]{64}$/i.test(account.hash)) throw new Error('Invalid profile hash');
  if(!Number.isSafeInteger(account.balance) || account.balance < 0 || account.balance > 999999999999) throw new Error('Invalid balance');
  if(Buffer.byteLength(JSON.stringify(account)) > 1_500_000) throw new Error('Profile too large');
  return account;
}
async function readProfile(email) {
  try { return JSON.parse(await readFile(profilePath(email),'utf8')); }
  catch(error) { if(error?.code==='ENOENT') return null; throw error; }
}
async function writeProfile(record) {
  const email=record.account.email;
  const task=(profileWrites.get(email) || Promise.resolve()).catch(()=>{}).then(async()=>{
    const target=profilePath(email),tmp=target+'.tmp-'+randomBytes(6).toString('hex');
    await writeFile(tmp,JSON.stringify(record),{encoding:'utf8',mode:0o600});
    await rename(tmp,target);
  });
  profileWrites.set(email,task);
  try { await task; } finally { if(profileWrites.get(email)===task) profileWrites.delete(email); }
}
function secureEqual(a,b) {
  const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));
  return x.length===y.length && x.length>0 && timingSafeEqual(x,y);
}
function newProfileRecord(account) {
  return {version:1,token:randomBytes(32).toString('hex'),account,updatedAt:new Date().toISOString()};
}
async function authenticatedProfile(req) {
  const email=safeString(req.headers['x-arena-email'] || '',180).trim().toLowerCase();
  const auth=safeString(req.headers.authorization || '',300);
  const token=auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if(!email || !token) return null;
  const record=await readProfile(email);
  return record && secureEqual(record.token,token) ? record : null;
}

const syncedEvents = new Map();
let resultsSource = {ok:null,error:null,count:0,disciplines:[]};
let syncMeta = {
  lastClientAt:0,
  source:'',
  sport:'',
  stage:'',
  revision:0,
  received:0,
  telemetry:null
};

async function readBody(req, limit = 2_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function json(res, status, value) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(value));
}

function textResponse(res, method, type, source) {
  res.statusCode = 200;
  res.setHeader('content-type', type);
  res.setHeader('cache-control', 'no-store, no-cache, must-revalidate');
  res.setHeader('x-content-type-options', 'nosniff');
  if (method === 'HEAD') return res.end();
  res.end(source);
}

function js(res, method, source) {
  return textResponse(res,method,'text/javascript; charset=utf-8',source);
}

function css(res, method, source) {
  return textResponse(res,method,'text/css; charset=utf-8',source);
}

function safeString(value, max = 300) {
  return String(value ?? '').slice(0, max);
}

function bearer(req) {
  const value = String(req.headers.authorization || '');
  return value.startsWith('Bearer ') ? value.slice(7) : '';
}

function safeEvent(raw) {
  const id = safeString(raw?.id, 64);
  if (!id || !/^[A-Za-z0-9:_-]{1,64}$/.test(id)) return null;
  return {
    id,
    name:safeString(raw?.name, 220),
    tournamentId:safeString(raw?.tournamentId, 80),
    tournamentName:safeString(raw?.tournamentName, 220),
    categoryName:safeString(raw?.categoryName, 120),
    categoryIconUrl:safeString(raw?.categoryIconUrl, 500),
    tournamentIconUrl:safeString(raw?.tournamentIconUrl, 500),
    sport:safeString(raw?.sport, 20),
    subsport:safeString(raw?.subsport, 40),
    stage:Number(raw?.stage || 0),
    status:Number(raw?.status || 0),
    tradingStatus:Number(raw?.tradingStatus || 0),
    startTime:Number(raw?.startTime || 0),
    regulation:safeString(raw?.regulation, 120),
    competitors:Array.isArray(raw?.competitors) ? raw.competitors.slice(0,2).map(team => ({
      id:safeString(team?.id, 64),
      name:safeString(team?.name, 160),
      icon:team?.icon?.url ? {url:safeString(team.icon.url, 500)} : undefined
    })) : [],
    scoreboard:raw?.scoreboard && typeof raw.scoreboard === 'object' ? raw.scoreboard : null,
    syncedAt:Date.now()
  };
}

function pruneSyncedEvents() {
  const cutoff = Date.now() - 48 * 3600_000;
  for (const [id, event] of syncedEvents) {
    const eventTime = Number(event.startTime || 0) * 1000;
    if ((event.syncedAt || 0) < cutoff && (!eventTime || eventTime < cutoff)) syncedEvents.delete(id);
  }
  if (syncedEvents.size > 5000) {
    const rows = [...syncedEvents.entries()].sort((a,b) => (a[1].syncedAt || 0) - (b[1].syncedAt || 0));
    for (const [id] of rows.slice(0, syncedEvents.size - 5000)) syncedEvents.delete(id);
  }
}

function eventForSettlement(event) {
  return {
    eventId:event.id,
    eventName:event.name,
    startTime:event.startTime,
    sport:event.sport,
    subsport:event.subsport,
    categoryName:event.categoryName,
    competitors:(event.competitors || []).map(team => ({name:team.name}))
  };
}

function teamMetaByProviderId(id) {
  const target=String(id || '');
  for (const event of syncedEvents.values()) {
    const team=(event.competitors || []).find(candidate => String(candidate.id || '') === target);
    if (team?.name) return {name:team.name,categoryName:event.categoryName || event.subsport || ''};
  }
  return null;
}

function patchSportsModule(source) {
  const oldBlock = `  gameBadge(event) {
    const games = { 'Counter-Strike': 'counter-strike', 'Dota 2': 'dota', 'League of Legends': 'lol' };
    const name = games[event.categoryName] || SPORTS.find(s => s[0] === event.sport)?.[1] || 'esports';
    return \`<span class="game-badge">\${graphic(name)}</span>\`;
  }`;

  const newBlock = `  gameBadge(event) {
    const games = {
      'Counter-Strike':'counter-strike',
      'Dota 2':'dota',
      'League of Legends':'lol',
      'Valorant':'esports',
      'Free Fire':'esports',
      'Mobile Legends':'esports',
      'PUBG':'esports',
      'Apex Legends':'esports',
      'Overwatch':'esports',
      'Rocket League':'esports',
      'Rainbow Six':'esports',
      'Call of Duty':'esports'
    };
    const fallback = games[event.categoryName] || SPORTS.find(s => s[0] === event.sport)?.[1] || 'esports';
    const valorant = 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Valorant_logo_-_pink_color_version.svg';
    const fallbackGraphic = event.categoryName === 'Valorant'
      ? \`<img class="reference-graphic valorant-restored" src="\${valorant}" alt="" aria-hidden="true" draggable="false">\`
      : graphic(fallback);

    const tournamentId = String(event.tournamentId || '');
    const providerPrimary = event.categoryIconUrl || event.tournamentIconUrl ||
      (/^\\d{1,16}$/.test(tournamentId) ? \`https://parik24.pro/taxonomyicons/tournaments/\${tournamentId}-164w\` : '');
    const providerFallback = /^\\d{1,16}$/.test(tournamentId)
      ? \`https://24parik-bet.org/taxonomyicons/tournaments/\${tournamentId}-164w\`
      : '';

    if (!providerPrimary) {
      return \`<span class="game-badge game-badge-dark">\${fallbackGraphic}</span>\`;
    }

    return \`<span class="game-badge game-badge-dark">
      <img class="synced-discipline-logo" src="\${escape(providerPrimary)}" data-provider-fallback="\${escape(providerFallback)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"
        onerror="const f=this.dataset.providerFallback;if(f&&this.src!==f){this.src=f;this.dataset.providerFallback='';}else{this.hidden=true;this.nextElementSibling.hidden=false;}">
      <span class="discipline-fallback" hidden>\${fallbackGraphic}</span>
    </span>\`;
  }`;

  if (!source.includes(oldBlock)) {
    console.warn('SPORTS_PATCH_MISS gameBadge block was not found');
    return source;
  }
  return source.replace(oldBlock,newBlock);
}

const sportsCssPatch = `
/* Arena sync visual patch */
.tournament-symbol{
  background:#101010!important;
  border-color:transparent;
  overflow:hidden;
}
.tournament-tabs>button.active .tournament-symbol{
  border-color:#d7e300!important;
}
.game-badge-dark,
.tournament-symbol .game-badge{
  background:#101010!important;
  border-radius:50%;
  overflow:hidden;
}
.synced-discipline-logo{
  display:block;
  width:100%;
  height:100%;
  padding:7px;
  box-sizing:border-box;
  object-fit:contain;
  background:#101010;
}
.valorant-restored{
  width:30px!important;
  height:30px!important;
  object-fit:contain;
}
.discipline-fallback{
  display:grid;
  width:100%;
  height:100%;
  place-items:center;
}
.team-emblem-picture{
  display:grid!important;
  place-items:center;
  width:100%;
  height:100%;
  border-radius:50%;
  overflow:hidden;
  background:#101010!important;
}
.team-logo{
  display:block;
  width:100%;
  height:100%;
  object-fit:contain;
  background:#101010!important;
  border-radius:50%;
}
.team-emblem-fallback{
  display:grid;
  place-items:center;
  width:100%;
  height:100%;
  border-radius:50%;
  background:#101010!important;
  color:#f3f3f3;
  font-size:10px;
  font-weight:700;
}
.event-team-emblem .team-emblem-picture{
  width:72px;
  height:72px;
}
`;

async function embeddedAsset(pathname, method, headers) {
  const request = new Request('http://localhost' + pathname, {method,headers});
  return app.fetch(request,env,ctx);
}

async function mergedSettlements(bodyBuffer, req) {
  const raw = bodyBuffer.toString('utf8');
  const payload = JSON.parse(raw || '{}');
  const events = Array.isArray(payload.events) ? payload.events : [];
  if (!events.length || events.length > 30) return {status:400,body:{error:'Invalid events'}};

  let base = {results:[],unavailable:[],pending:events.map(e => String(e.eventId || e.id || ''))};
  try {
    const request = new Request('http://localhost/api/settlements', {
      method:'POST',
      headers:req.headers,
      body:bodyBuffer
    });
    const response = await app.fetch(request,env,ctx);
    if (response.ok) {
      const value = await response.json();
      if (Array.isArray(value?.results)) base=value;
    } else {
      base.unavailable=[...(base.unavailable || []),'Embedded results HTTP ' + response.status];
    }
  } catch (error) {
    base.unavailable=[...(base.unavailable || []),'Embedded results: ' + String(error?.message || error)];
  }

  const extra = await augmentSettlements(events,base.results || []);
  const merged = new Map();
  for (const row of base.results || []) merged.set(String(row.id),row);
  for (const row of extra.results || []) if (!merged.has(String(row.id))) merged.set(String(row.id),row);

  const results=[...merged.values()];
  const unavailable=[...new Set([...(base.unavailable || []),...(extra.unavailable || [])])];
  const pending=events
    .map(event => String(event.eventId || event.id || ''))
    .filter(id => id && !merged.has(id));

  console.log('SETTLEMENT_SYNC ' + JSON.stringify({
    requested:events.length,
    embedded:(base.results || []).length,
    bo3:(extra.results || []).length,
    settled:results.length,
    pending:pending.length,
    unavailable
  }));

  return {status:200,body:{results,unavailable,pending}};
}

const server = http.createServer(async (req, res) => {
  try {
    const method = req.method || 'GET';
    const url = new URL(req.url || '/', 'http://localhost');


    if (url.pathname === '/api/profile/register') {
      if (method !== 'POST') return json(res,405,{error:'Method not allowed'});
      const body=JSON.parse((await readBody(req,1_600_000)).toString('utf8') || '{}');
      const account=safeProfileAccount(body.account);
      if (await readProfile(account.email)) return json(res,409,{error:'Профіль уже існує'});
      const record=newProfileRecord(account); await writeProfile(record);
      return json(res,200,{ok:true,token:record.token,account:record.account});
    }

    if (url.pathname === '/api/profile/import') {
      if (method !== 'POST') return json(res,405,{error:'Method not allowed'});
      const body=JSON.parse((await readBody(req,1_600_000)).toString('utf8') || '{}');
      const account=safeProfileAccount(body.account);
      let record=await readProfile(account.email);
      if (!record) {
        record=newProfileRecord(account); await writeProfile(record);
      } else {
        if(!secureEqual(record.account.hash,account.hash)) return json(res,401,{error:'Profile credentials mismatch'});
        if(Number(account.syncRevision||0) > Number(record.account.syncRevision||0)) {
          record={...record,account,updatedAt:new Date().toISOString()}; await writeProfile(record);
        }
      }
      return json(res,200,{ok:true,token:record.token,account:record.account});
    }

    if (url.pathname === '/api/profile/login') {
      if (method !== 'POST') return json(res,405,{error:'Method not allowed'});
      const body=JSON.parse((await readBody(req,32_000)).toString('utf8') || '{}');
      const email=safeString(body.email,180).trim().toLowerCase(),hash=safeString(body.hash,128);
      const record=await readProfile(email);
      if(!record) return json(res,404,{error:'Профіль не знайдено'});
      if(!secureEqual(record.account.hash,hash)) return json(res,401,{error:'Невірний пароль'});
      return json(res,200,{ok:true,token:record.token,account:record.account});
    }

    if (url.pathname === '/api/profile') {
      const record=await authenticatedProfile(req);
      if(!record) return json(res,401,{error:'Unauthorized'});
      if(method === 'GET') return json(res,200,{ok:true,account:record.account,updatedAt:record.updatedAt});
      if(method !== 'PUT') return json(res,405,{error:'Method not allowed'});
      const body=JSON.parse((await readBody(req,1_600_000)).toString('utf8') || '{}');
      const account=safeProfileAccount(body.account);
      if(account.email !== record.account.email) return json(res,400,{error:'Profile mismatch'});
      if(Number(account.syncRevision||0) < Number(record.account.syncRevision||0)) return json(res,409,{error:'Stale profile',account:record.account});
      const next={...record,account,updatedAt:new Date().toISOString()}; await writeProfile(next);
      return json(res,200,{ok:true,account:next.account,updatedAt:next.updatedAt});
    }

    if (url.pathname === '/account-base.mjs' && ['GET','HEAD'].includes(method)) {
      const response=await embeddedAsset('/account.mjs',method,req.headers);
      if(!response.ok){res.statusCode=response.status;return res.end();}
      const source=method==='HEAD'?'':await response.text();
      return js(res,method,source);
    }
    if (url.pathname === '/account.mjs' && ['GET','HEAD'].includes(method)) return js(res,method,accountSyncModule);
    if (url.pathname === '/app.js' && ['GET','HEAD'].includes(method)) return js(res,method,appOverrideModule);
    if (url.pathname === '/bet-view.mjs' && ['GET','HEAD'].includes(method)) return js(res,method,betViewOverrideModule);
    if (url.pathname === '/arena-overrides.css' && ['GET','HEAD'].includes(method)) return css(res,method,arenaOverridesCss);

    if ((url.pathname === '/' || url.pathname === '/index.html') && ['GET','HEAD'].includes(method)) {
      const response=await embeddedAsset(url.pathname,method,req.headers);
      if(!response.ok){res.statusCode=response.status;return res.end();}
      let source=method==='HEAD'?'':await response.text();
      if(source && !source.includes('/arena-overrides.css')) source=source.replace('</head>','<link rel="stylesheet" href="/arena-overrides.css?v=42"></head>');
      return textResponse(res,method,'text/html; charset=utf-8',source);
    }

    if (url.pathname === '/sw.js' && ['GET','HEAD'].includes(method)) {
      const response=await embeddedAsset('/sw.js',method,req.headers);
      if(!response.ok){res.statusCode=response.status;return res.end();}
      let source=method==='HEAD'?'':await response.text();
      source=source.replace(/arena-line-v\d+/g,'arena-line-v42');
      source=source.replace("const ASSETS = [","const ASSETS = ['/arena-overrides.css?v=42',");
      return js(res,method,source);
    }

    if (url.pathname === '/health') {
      const profileStorage = await profileStorageStatus();
      return json(res, 200, {
        ok:true,
        source:'arena-line-parik-sync-v4',
        runtime:'phone-ui + parik-feed + synced-file-profile + flexible-bet-editor + multi-esports-settlement',
        sync:{
          lastClientAt:syncMeta.lastClientAt || null,
          source:syncMeta.source || null,
          sport:syncMeta.sport || null,
          stage:syncMeta.stage || null,
          revision:syncMeta.revision || 0,
          received:syncMeta.received || 0,
          storedEvents:syncedEvents.size,
          telemetry:syncMeta.telemetry
        },
        resultsSource,
        profiles:{root:profileRoot,persistent:profileStorePersistent}
      });
    }

    if (url.pathname === '/feed.mjs' && ['GET','HEAD'].includes(method)) {
      return js(res,method,feedModule);
    }

    if (url.pathname === '/team-emblem.mjs' && ['GET','HEAD'].includes(method)) {
      return js(res,method,emblemModule);
    }

    if (url.pathname === '/account.mjs' && ['GET','HEAD'].includes(method)) {
      return js(res,method,accountModule);
    }

    if (url.pathname === '/app.js' && ['GET','HEAD'].includes(method)) {
      return js(res,method,appModule);
    }

    if (url.pathname === '/bet-view.mjs' && ['GET','HEAD'].includes(method)) {
      return js(res,method,betViewModule);
    }

    if (url.pathname === '/theme.css' && ['GET','HEAD'].includes(method)) {
      return css(res,method,themeCssModule);
    }

    if (url.pathname === '/sw.js' && ['GET','HEAD'].includes(method)) {
      res.setHeader('service-worker-allowed','/');
      return js(res,method,serviceWorkerModule);
    }

    if (url.pathname === '/manifest.webmanifest' && ['GET','HEAD'].includes(method)) {
      return textResponse(res,method,'application/manifest+json; charset=utf-8',manifestModule);
    }

    if (url.pathname === '/sports.mjs' && ['GET','HEAD'].includes(method)) {
      const response = await embeddedAsset('/sports.mjs',method,req.headers);
      if (!response.ok) {
        res.statusCode=response.status;
        return res.end();
      }
      const source=method === 'HEAD' ? '' : await response.text();
      return js(res,method,patchSportsModule(source));
    }

    if (url.pathname === '/sports.css' && ['GET','HEAD'].includes(method)) {
      const response = await embeddedAsset('/sports.css',method,req.headers);
      if (!response.ok) {
        res.statusCode=response.status;
        return res.end();
      }
      const source=method === 'HEAD' ? '' : await response.text();
      return css(res,method,source + sportsCssPatch);
    }

    if (url.pathname === '/api/profile/login') {
      if (method !== 'POST') return json(res,405,{ok:false,error:'Method not allowed'});
      const body = JSON.parse((await readBody(req,32_000)).toString('utf8') || '{}');
      const email = safeString(body.email,200).trim().toLowerCase();
      const hash = safeString(body.hash,80);
      if (!email || !/^[a-f0-9]{64}$/i.test(hash)) return json(res,400,{ok:false,error:'Invalid credentials'});
      const profile = await loginProfile(email,hash);
      if (!profile) return json(res,401,{ok:false,error:'Invalid credentials'});
      return json(res,200,{ok:true,profile});
    }

    if (url.pathname === '/api/profile') {
      if (method !== 'GET') return json(res,405,{ok:false,error:'Method not allowed'});
      const email = safeString(url.searchParams.get('email'),200).trim().toLowerCase();
      const hash = bearer(req);
      if (!email || !/^[a-f0-9]{64}$/i.test(hash)) return json(res,401,{ok:false,error:'Unauthorized'});
      const profile = await loginProfile(email,hash);
      if (!profile) return json(res,404,{ok:false,error:'Profile not found'});
      return json(res,200,{ok:true,profile});
    }

    if (url.pathname === '/api/profile/sync') {
      if (method !== 'POST') return json(res,405,{ok:false,error:'Method not allowed'});
      const hash = bearer(req);
      if (!/^[a-f0-9]{64}$/i.test(hash)) return json(res,401,{ok:false,error:'Unauthorized'});
      const body = JSON.parse((await readBody(req,2_100_000)).toString('utf8') || '{}');
      try {
        const profile = await syncProfile(body.profile,hash);
        console.log('PROFILE_SYNC ' + JSON.stringify({
          id:profile.id,
          revision:profile.profileRevision,
          bets:profile.bets.length,
          balance:profile.balance
        }));
        return json(res,200,{ok:true,profile});
      } catch (error) {
        if (error?.statusCode === 409) return json(res,409,{ok:false,error:'Profile conflict',profile:error.profile});
        if (error?.statusCode === 401) return json(res,401,{ok:false,error:'Unauthorized'});
        return json(res,400,{ok:false,error:safeString(error?.message || 'Invalid profile',200)});
      }
    }

    if (url.pathname === '/api/sync/telemetry') {
      if (method !== 'POST') return json(res,405,{ok:false,error:'Method not allowed'});
      const body = await readBody(req,16_000);
      const value = JSON.parse(body.toString('utf8') || '{}');
      const telemetry = {
        kind:safeString(value.kind,50),
        endpoint:safeString(value.endpoint,500),
        state:safeString(value.state,40),
        sport:safeString(value.sport,20),
        stage:safeString(value.stage,20),
        events:Number(value.events || 0),
        watched:Number(value.watched || 0),
        markets:Number(value.markets || 0),
        code:Number(value.code || 0),
        reason:safeString(value.reason,180),
        subscription:safeString(value.subscription,80),
        message:safeString(value.message,3000),
        at:Number(value.at || Date.now())
      };
      syncMeta.telemetry=telemetry;
      syncMeta.lastClientAt=Date.now();
      console.log('FEED_TELEMETRY ' + JSON.stringify(telemetry));
      return json(res,200,{ok:true});
    }

    if (url.pathname === '/api/sync/events') {
      if (method !== 'POST') return json(res,405,{ok:false,error:'Method not allowed'});
      const body = await readBody(req,1_500_000);
      const value = JSON.parse(body.toString('utf8') || '{}');
      if (!Array.isArray(value.rows) || value.rows.length > 250) {
        return json(res,400,{ok:false,error:'Invalid rows'});
      }

      let accepted=0;
      for (const raw of value.rows) {
        const event=safeEvent(raw);
        if (!event) continue;
        syncedEvents.set(event.id,event);
        accepted++;
      }

      syncMeta={
        ...syncMeta,
        lastClientAt:Date.now(),
        source:safeString(value.source,500),
        sport:safeString(value.sport,20),
        stage:safeString(value.stage,20),
        revision:Number(value.revision || 0),
        received:accepted
      };
      pruneSyncedEvents();

      console.log('FEED_SYNC ' + JSON.stringify({
        source:syncMeta.source,
        sport:syncMeta.sport,
        stage:syncMeta.stage,
        revision:syncMeta.revision,
        received:accepted,
        stored:syncedEvents.size
      }));
      return json(res,200,{ok:true,accepted,stored:syncedEvents.size});
    }

    if (url.pathname === '/api/sync/status') {
      if (method !== 'GET') return json(res,405,{ok:false,error:'Method not allowed'});
      const ids=(url.searchParams.get('ids') || '').split(',').filter(Boolean).slice(0,100);
      const events=ids.length
        ? ids.map(id => syncedEvents.get(id)).filter(Boolean)
        : [...syncedEvents.values()].sort((a,b) => (b.syncedAt || 0)-(a.syncedAt || 0)).slice(0,50);
      return json(res,200,{ok:true,meta:syncMeta,total:syncedEvents.size,events});
    }

    if (url.pathname === '/api/settlements') {
      if (method !== 'POST') return json(res,405,{error:'Method not allowed'});
      const body=await readBody(req,64_000);
      const merged=await mergedSettlements(body,req);
      return json(res,merged.status,merged.body);
    }

    if (url.pathname === '/api/results') {
      if (method !== 'GET') return json(res,405,{error:'Method not allowed'});
      const ids=(url.searchParams.get('ids') || '').split(',').filter(Boolean).slice(0,100);
      const events=ids.map(id => syncedEvents.get(String(id))).filter(Boolean).map(eventForSettlement);
      if (!events.length) return json(res,200,[]);
      const external=await augmentSettlements(events,[]);
      return json(res,200,external.results || []);
    }

    if (url.pathname === '/api/completed') {
      if (method !== 'GET') return json(res,405,{error:'Method not allowed'});
      const competitor=url.searchParams.get('competitor') || '';
      if (!/^\d{1,16}$/.test(competitor)) return json(res,400,{error:'Invalid competitor'});
      const team=teamMetaByProviderId(competitor);
      if (!team) return json(res,200,[]);
      try {
        const rows=await completedHistory(team.name,20,team.categoryName);
        console.log('COMPLETED_HISTORY ' + JSON.stringify({team:team.name,category:team.categoryName,rows:rows.length}));
        return json(res,200,rows);
      } catch (error) {
        console.error('COMPLETED_HISTORY_ERROR',team.name,error?.message || error);
        return json(res,200,[]);
      }
    }

    const body = ['GET','HEAD'].includes(method) ? undefined : await readBody(req);
    const request = new Request('http://localhost' + (req.url || '/'), {
      method,
      headers:req.headers,
      ...(body ? {body} : {})
    });

    const response = await app.fetch(request,env,ctx);
    res.statusCode=response.status;
    response.headers.forEach((value,key) => res.setHeader(key,value));
    res.setHeader('cache-control','no-store');

    if (method === 'HEAD' || response.status === 204 || !response.body) return res.end();
    Readable.fromWeb(response.body).pipe(res);
  } catch (error) {
    console.error('Arena Line runtime error',error?.stack || error);
    return json(res,500,{ok:false,error:'Arena Line server error'});
  }
});

server.listen(port,'0.0.0.0',() => {
  console.log('Arena Line Parik sync v4 listening on ' + port);
  probeResultsSource()
    .then(status => {
      resultsSource={...status,error:null};
      console.log('RESULTS_SOURCE_OK ' + JSON.stringify(resultsSource));
    })
    .catch(error => {
      resultsSource={ok:false,error:String(error?.message || error),count:0,disciplines:[]};
      console.error('RESULTS_SOURCE_ERROR ' + JSON.stringify(resultsSource));
    });
});

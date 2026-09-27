import http from 'node:http';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import app from './dist/server/index.js';
import { augmentSettlements, completedHistory, probeResultsSource } from './results_bridge.mjs';
import { loginProfile, syncProfile, profileStorageStatus } from './profile_store.mjs';

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

const syncedEvents = new Map();
let resultsSource = {ok:null,error:null,disciplines:[]};
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
  res.setHeader('content-type','application/json; charset=utf-8');
  res.setHeader('cache-control','no-store');
  res.end(JSON.stringify(value));
}

function textResponse(res, method, type, source) {
  res.statusCode = 200;
  res.setHeader('content-type',type);
  res.setHeader('cache-control','no-store, no-cache, must-revalidate');
  res.setHeader('x-content-type-options','nosniff');
  if (method === 'HEAD') return res.end();
  res.end(source);
}

const js = (res,method,source) => textResponse(res,method,'text/javascript; charset=utf-8',source);
const css = (res,method,source) => textResponse(res,method,'text/css; charset=utf-8',source);
const safeString = (value,max=300) => String(value ?? '').slice(0,max);

function bearer(req) {
  const value = String(req.headers.authorization || '');
  return value.startsWith('Bearer ') ? value.slice(7) : '';
}

function safeEvent(raw) {
  const id = safeString(raw?.id,64);
  if (!id || !/^[A-Za-z0-9:_-]{1,64}$/.test(id)) return null;
  return {
    id,
    name:safeString(raw?.name,220),
    tournamentId:safeString(raw?.tournamentId,80),
    tournamentName:safeString(raw?.tournamentName,220),
    categoryName:safeString(raw?.categoryName,120),
    categoryIconUrl:safeString(raw?.categoryIconUrl,500),
    tournamentIconUrl:safeString(raw?.tournamentIconUrl,500),
    sport:safeString(raw?.sport,20),
    subsport:safeString(raw?.subsport,40),
    stage:Number(raw?.stage || 0),
    status:Number(raw?.status || 0),
    tradingStatus:Number(raw?.tradingStatus || 0),
    startTime:Number(raw?.startTime || 0),
    regulation:safeString(raw?.regulation,120),
    competitors:Array.isArray(raw?.competitors) ? raw.competitors.slice(0,2).map(team => ({
      id:safeString(team?.id,64),
      name:safeString(team?.name,160),
      icon:team?.icon?.url ? {url:safeString(team.icon.url,500)} : undefined
    })) : [],
    scoreboard:raw?.scoreboard && typeof raw.scoreboard === 'object' ? raw.scoreboard : null,
    syncedAt:Date.now()
  };
}

function pruneSyncedEvents() {
  const cutoff=Date.now()-48*3600_000;
  for (const [id,event] of syncedEvents) {
    const eventTime=Number(event.startTime || 0)*1000;
    if ((event.syncedAt || 0) < cutoff && (!eventTime || eventTime < cutoff)) syncedEvents.delete(id);
  }
  if (syncedEvents.size > 5000) {
    const rows=[...syncedEvents.entries()].sort((a,b)=>(a[1].syncedAt||0)-(b[1].syncedAt||0));
    for (const [id] of rows.slice(0,syncedEvents.size-5000)) syncedEvents.delete(id);
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

async function embeddedAsset(pathname,method,headers) {
  const request = new Request('http://localhost' + pathname,{method,headers});
  return app.fetch(request,env,ctx);
}

async function mergedSettlements(bodyBuffer, req) {
  const payload=JSON.parse(bodyBuffer.toString('utf8') || '{}');
  const events=Array.isArray(payload.events) ? payload.events : [];
  if (!events.length || events.length > 30) return {status:400,body:{error:'Invalid events'}};

  let base={results:[],unavailable:[],pending:events.map(e=>String(e.eventId||e.id||''))};
  try {
    const request=new Request('http://localhost/api/settlements',{
      method:'POST',
      headers:req.headers,
      body:bodyBuffer
    });
    const response=await app.fetch(request,env,ctx);
    if (response.ok) {
      const value=await response.json();
      if (Array.isArray(value?.results)) base=value;
    } else {
      base.unavailable=[...(base.unavailable||[]),'Embedded results HTTP '+response.status];
    }
  } catch(error) {
    base.unavailable=[...(base.unavailable||[]),'Embedded results: '+String(error?.message||error)];
  }

  const extra=await augmentSettlements(events,base.results || []);
  const merged=new Map();
  for (const row of base.results || []) merged.set(String(row.id),row);
  for (const row of extra.results || []) if (!merged.has(String(row.id))) merged.set(String(row.id),row);

  const results=[...merged.values()];
  const unavailable=[...new Set([...(base.unavailable||[]),...(extra.unavailable||[])])];
  const pending=events.map(event=>String(event.eventId||event.id||'')).filter(id=>id&&!merged.has(id));

  console.log('SETTLEMENT_SYNC '+JSON.stringify({
    requested:events.length,
    embedded:(base.results||[]).length,
    bo3:(extra.results||[]).length,
    settled:results.length,
    pending:pending.length,
    unavailable
  }));
  return {status:200,body:{results,unavailable,pending}};
}

const server=http.createServer(async (req,res)=>{
  try {
    const method=req.method || 'GET';
    const url=new URL(req.url || '/','http://localhost');

    if (url.pathname === '/health') {
      const profileStorage=await profileStorageStatus();
      return json(res,200,{
        ok:true,
        source:'arena-line-parik-sync-v4',
        runtime:'parik-feed + synced-file-profile + flexible-bet-editor + multi-esports-settlement',
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
        profileStorage
      });
    }

    if (url.pathname === '/feed.mjs' && ['GET','HEAD'].includes(method)) return js(res,method,feedModule);
    if (url.pathname === '/team-emblem.mjs' && ['GET','HEAD'].includes(method)) return js(res,method,emblemModule);
    if (url.pathname === '/account.mjs' && ['GET','HEAD'].includes(method)) return js(res,method,accountModule);
    if (url.pathname === '/app.js' && ['GET','HEAD'].includes(method)) return js(res,method,appModule);
    if (url.pathname === '/bet-view.mjs' && ['GET','HEAD'].includes(method)) return js(res,method,betViewModule);
    if (url.pathname === '/theme.css' && ['GET','HEAD'].includes(method)) return css(res,method,themeCssModule);
    if (url.pathname === '/sw.js' && ['GET','HEAD'].includes(method)) {
      res.setHeader('service-worker-allowed','/');
      return js(res,method,serviceWorkerModule);
    }
    if (url.pathname === '/manifest.webmanifest' && ['GET','HEAD'].includes(method)) {
      return textResponse(res,method,'application/manifest+json; charset=utf-8',manifestModule);
    }

    if (url.pathname === '/sports.mjs' && ['GET','HEAD'].includes(method)) {
      const response=await embeddedAsset('/sports.mjs',method,req.headers);
      if (!response.ok) { res.statusCode=response.status; return res.end(); }
      const source=method === 'HEAD' ? '' : await response.text();
      return js(res,method,patchSportsModule(source));
    }

    if (url.pathname === '/sports.css' && ['GET','HEAD'].includes(method)) {
      const response=await embeddedAsset('/sports.css',method,req.headers);
      if (!response.ok) { res.statusCode=response.status; return res.end(); }
      const source=method === 'HEAD' ? '' : await response.text();
      return css(res,method,source + sportsCssPatch);
    }

    if (url.pathname === '/api/profile/login') {
      if (method !== 'POST') return json(res,405,{ok:false,error:'Method not allowed'});
      const body=JSON.parse((await readBody(req,32_000)).toString('utf8') || '{}');
      const email=safeString(body.email,200).trim().toLowerCase();
      const hash=safeString(body.hash,80);
      if (!email || !/^[a-f0-9]{64}$/i.test(hash)) return json(res,400,{ok:false,error:'Invalid credentials'});
      const profile=await loginProfile(email,hash);
      if (!profile) return json(res,401,{ok:false,error:'Invalid credentials'});
      return json(res,200,{ok:true,profile});
    }

    if (url.pathname === '/api/profile') {
      if (method !== 'GET') return json(res,405,{ok:false,error:'Method not allowed'});
      const email=safeString(url.searchParams.get('email'),200).trim().toLowerCase();
      const hash=bearer(req);
      if (!email || !/^[a-f0-9]{64}$/i.test(hash)) return json(res,401,{ok:false,error:'Unauthorized'});
      const profile=await loginProfile(email,hash);
      if (!profile) return json(res,404,{ok:false,error:'Profile not found'});
      return json(res,200,{ok:true,profile});
    }

    if (url.pathname === '/api/profile/sync') {
      if (method !== 'POST') return json(res,405,{ok:false,error:'Method not allowed'});
      const hash=bearer(req);
      if (!/^[a-f0-9]{64}$/i.test(hash)) return json(res,401,{ok:false,error:'Unauthorized'});
      const body=JSON.parse((await readBody(req,2_100_000)).toString('utf8') || '{}');
      try {
        const profile=await syncProfile(body.profile,hash);
        console.log('PROFILE_SYNC '+JSON.stringify({
          id:profile.id,
          revision:profile.profileRevision,
          bets:profile.bets.length,
          balance:profile.balance
        }));
        return json(res,200,{ok:true,profile});
      } catch(error) {
        if (error?.statusCode === 409) return json(res,409,{ok:false,error:'Profile conflict',profile:error.profile});
        if (error?.statusCode === 401) return json(res,401,{ok:false,error:'Unauthorized'});
        return json(res,400,{ok:false,error:safeString(error?.message || 'Invalid profile',200)});
      }
    }

    if (url.pathname === '/api/sync/telemetry') {
      if (method !== 'POST') return json(res,405,{ok:false,error:'Method not allowed'});
      const body=await readBody(req,16_000);
      const value=JSON.parse(body.toString('utf8') || '{}');
      const telemetry={
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
      console.log('FEED_TELEMETRY '+JSON.stringify(telemetry));
      return json(res,200,{ok:true});
    }

    if (url.pathname === '/api/sync/events') {
      if (method !== 'POST') return json(res,405,{ok:false,error:'Method not allowed'});
      const body=await readBody(req,1_500_000);
      const value=JSON.parse(body.toString('utf8') || '{}');
      if (!Array.isArray(value.rows) || value.rows.length > 250) return json(res,400,{ok:false,error:'Invalid rows'});
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
      console.log('FEED_SYNC '+JSON.stringify({
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
        ? ids.map(id=>syncedEvents.get(id)).filter(Boolean)
        : [...syncedEvents.values()].sort((a,b)=>(b.syncedAt||0)-(a.syncedAt||0)).slice(0,50);
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
      const events=ids.map(id=>syncedEvents.get(String(id))).filter(Boolean).map(eventForSettlement);
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
        console.log('COMPLETED_HISTORY '+JSON.stringify({team:team.name,category:team.categoryName,rows:rows.length}));
        return json(res,200,rows);
      } catch(error) {
        console.error('COMPLETED_HISTORY_ERROR',team.name,error?.message || error);
        return json(res,200,[]);
      }
    }

    const body=['GET','HEAD'].includes(method) ? undefined : await readBody(req);
    const request=new Request('http://localhost'+(req.url || '/'),{
      method,
      headers:req.headers,
      ...(body ? {body} : {})
    });
    const response=await app.fetch(request,env,ctx);
    res.statusCode=response.status;
    response.headers.forEach((value,key)=>res.setHeader(key,value));
    res.setHeader('cache-control','no-store');
    if (method === 'HEAD' || response.status === 204 || !response.body) return res.end();
    Readable.fromWeb(response.body).pipe(res);
  } catch(error) {
    console.error('Arena Line runtime error',error?.stack || error);
    return json(res,500,{ok:false,error:'Arena Line server error'});
  }
});

server.listen(port,'0.0.0.0',()=>{
  console.log('Arena Line Parik sync v4 listening on '+port);
  probeResultsSource().then(status=>{
    resultsSource={...status,error:null};
    console.log('RESULTS_SOURCE_OK '+JSON.stringify(resultsSource));
  }).catch(error=>{
    resultsSource={ok:false,error:String(error?.message || error),disciplines:[]};
    console.error('RESULTS_SOURCE_ERROR '+JSON.stringify(resultsSource));
  });
});

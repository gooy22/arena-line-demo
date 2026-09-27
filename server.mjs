import http from 'node:http';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import app from './dist/server/index.js';
import { augmentSettlements, completedHistory, probeResultsSource } from './results_bridge.mjs';

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

function teamNameByProviderId(id) {
  const target=String(id || '');
  for (const event of syncedEvents.values()) {
    const team=(event.competitors || []).find(candidate => String(candidate.id || '') === target);
    if (team?.name) return team.name;
  }
  return '';
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
    const remote = event.categoryIconUrl || event.tournamentIconUrl || '';
    if (!remote) return \`<span class="game-badge game-badge-dark">\${graphic(fallback)}</span>\`;
    return \`<span class="game-badge game-badge-dark"><img class="synced-discipline-logo" src="\${escape(remote)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="discipline-fallback" hidden>\${graphic(fallback)}</span></span>\`;
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
  object-fit:contain;
  background:#101010;
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

    if (url.pathname === '/health') {
      return json(res, 200, {
        ok:true,
        source:'arena-line-parik-sync-v3',
        runtime:'phone-ui + parik-direct-feed + bo3/opendota settlement',
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
        resultsSource
      });
    }

    if (url.pathname === '/feed.mjs' && ['GET','HEAD'].includes(method)) {
      return js(res,method,feedModule);
    }

    if (url.pathname === '/team-emblem.mjs' && ['GET','HEAD'].includes(method)) {
      return js(res,method,emblemModule);
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
      const teamName=teamNameByProviderId(competitor);
      if (!teamName) return json(res,200,[]);
      try {
        const rows=await completedHistory(teamName,20);
        console.log('COMPLETED_HISTORY ' + JSON.stringify({team:teamName,rows:rows.length}));
        return json(res,200,rows);
      } catch (error) {
        console.error('COMPLETED_HISTORY_ERROR',teamName,error?.message || error);
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
  console.log('Arena Line Parik sync v3 listening on ' + port);
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

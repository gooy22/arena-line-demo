import http from 'node:http';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import app from './dist/server/index.js';

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

function js(res, method, source) {
  res.statusCode = 200;
  res.setHeader('content-type', 'text/javascript; charset=utf-8');
  res.setHeader('cache-control', 'no-store, no-cache, must-revalidate');
  res.setHeader('x-content-type-options', 'nosniff');
  if (method === 'HEAD') return res.end();
  res.end(source);
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

const server = http.createServer(async (req, res) => {
  try {
    const method = req.method || 'GET';
    const url = new URL(req.url || '/', 'http://localhost');

    if (url.pathname === '/health') {
      return json(res, 200, {
        ok:true,
        source:'arena-line-parik-sync-v2',
        runtime:'phone-ui + direct-provider-feed + result-settlement',
        sync:{
          lastClientAt:syncMeta.lastClientAt || null,
          source:syncMeta.source || null,
          sport:syncMeta.sport || null,
          stage:syncMeta.stage || null,
          revision:syncMeta.revision || 0,
          received:syncMeta.received || 0,
          storedEvents:syncedEvents.size,
          telemetry:syncMeta.telemetry
        }
      });
    }

    if (url.pathname === '/feed.mjs' && ['GET','HEAD'].includes(method)) {
      return js(res, method, feedModule);
    }

    if (url.pathname === '/team-emblem.mjs' && ['GET','HEAD'].includes(method)) {
      return js(res, method, emblemModule);
    }

    if (url.pathname === '/api/sync/telemetry') {
      if (method !== 'POST') return json(res, 405, {ok:false,error:'Method not allowed'});
      const body = await readBody(req, 16_000);
      const value = JSON.parse(body.toString('utf8') || '{}');
      const telemetry = {
        kind:safeString(value.kind, 50),
        endpoint:safeString(value.endpoint, 500),
        state:safeString(value.state, 40),
        sport:safeString(value.sport, 20),
        stage:safeString(value.stage, 20),
        events:Number(value.events || 0),
        watched:Number(value.watched || 0),
        markets:Number(value.markets || 0),
        code:Number(value.code || 0),
        reason:safeString(value.reason, 180),
        subscription:safeString(value.subscription, 80),
        message:safeString(value.message, 300),
        at:Number(value.at || Date.now())
      };
      syncMeta.telemetry = telemetry;
      syncMeta.lastClientAt = Date.now();
      console.log('FEED_TELEMETRY ' + JSON.stringify(telemetry));
      return json(res, 200, {ok:true});
    }

    if (url.pathname === '/api/sync/events') {
      if (method !== 'POST') return json(res, 405, {ok:false,error:'Method not allowed'});
      const body = await readBody(req, 1_500_000);
      const value = JSON.parse(body.toString('utf8') || '{}');
      if (!Array.isArray(value.rows) || value.rows.length > 250) {
        return json(res, 400, {ok:false,error:'Invalid rows'});
      }

      let accepted = 0;
      for (const raw of value.rows) {
        const event = safeEvent(raw);
        if (!event) continue;
        syncedEvents.set(event.id, event);
        accepted++;
      }

      syncMeta = {
        ...syncMeta,
        lastClientAt:Date.now(),
        source:safeString(value.source, 500),
        sport:safeString(value.sport, 20),
        stage:safeString(value.stage, 20),
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
      return json(res, 200, {ok:true,accepted,stored:syncedEvents.size});
    }

    if (url.pathname === '/api/sync/status') {
      if (method !== 'GET') return json(res, 405, {ok:false,error:'Method not allowed'});
      const ids = (url.searchParams.get('ids') || '').split(',').filter(Boolean).slice(0,100);
      const events = ids.length
        ? ids.map(id => syncedEvents.get(id)).filter(Boolean)
        : [...syncedEvents.values()].sort((a,b) => (b.syncedAt || 0) - (a.syncedAt || 0)).slice(0,50);
      return json(res, 200, {ok:true,meta:syncMeta,total:syncedEvents.size,events});
    }

    const body = ['GET','HEAD'].includes(method) ? undefined : await readBody(req);
    const request = new Request('http://localhost' + (req.url || '/'), {
      method,
      headers:req.headers,
      ...(body ? {body} : {})
    });

    const response = await app.fetch(request, env, ctx);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.setHeader('cache-control', 'no-store');

    if (method === 'HEAD' || response.status === 204 || !response.body) return res.end();
    Readable.fromWeb(response.body).pipe(res);
  } catch (error) {
    console.error('Arena Line runtime error', error?.stack || error);
    return json(res, 500, {ok:false,error:'Arena Line server error'});
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log('Arena Line Parik sync v2 listening on ' + port);
});

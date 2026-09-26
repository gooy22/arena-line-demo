import http from 'node:http';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import app from './dist/server/index.js';

const port = Number(process.env.PORT || 3000);
const env = {};
const ctx = { waitUntil(p) { Promise.resolve(p).catch(() => {}); } };
const liveFeedModule = await readFile(new URL('./feed.mjs', import.meta.url), 'utf8');

let liveCache = { at:0, events:[], sourceStatus:'cold' };
const LIVE_SOURCE = 'https://parik24.me/uk/all-live/';

function decodeEntities(value='') {
  return String(value)
    .replace(/&nbsp;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/&quot;/gi,'"')
    .replace(/&#39;|&apos;/gi,"'")
    .replace(/&lt;/gi,'<')
    .replace(/&gt;/gi,'>')
    .replace(/&#(\d+);/g, (_,n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_,n) => String.fromCodePoint(parseInt(n,16)));
}

function htmlText(value='') {
  return decodeEntities(String(value)
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/\s+/g,' ')
    .trim());
}

function matches(re, input) {
  const out = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(input))) out.push(m);
  return out;
}

function stableHash(value='') {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function sportFromTournament(name='') {
  const v = name.toLowerCase();
  if (/кіберфутбол|esportsbattle|efootball/.test(v)) return 'CS';
  if (/кіберспорт|counter[- ]?strike|dota|league of legends|valorant/.test(v)) return 'CS';
  if (/настільн/.test(v)) return 'TT';
  if (/теніс/.test(v)) return 'T';
  if (/хокей/.test(v)) return 'H';
  if (/баскет/.test(v)) return 'B';
  if (/снукер/.test(v)) return 'PL';
  if (/волейбол/.test(v)) return 'VB';
  return 'F';
}

function categoryFromTournament(name='', sport='F') {
  if (/кіберфутбол|esportsbattle|efootball/i.test(name)) return 'Кіберфутбол';
  if (/counter[- ]?strike/i.test(name)) return 'Counter-Strike';
  if (/dota/i.test(name)) return 'Dota 2';
  if (/league of legends/i.test(name)) return 'League of Legends';
  return ({F:'Футбол',T:'Теніс',TT:'Настільний теніс',H:'Хокей',CS:'Кіберспорт',B:'Баскетбол',PL:'Снукер',VB:'Волейбол'})[sport] || 'Спорт';
}

function parseParikLive(html) {
  const tournaments = [];
  let m;
  const tournamentRe = /<span[^>]*data-id=["']events-title["'][^>]*>([\s\S]*?)<\/span>/gi;
  while ((m = tournamentRe.exec(html))) tournaments.push({ pos:m.index, name:htmlText(m[1]) });

  const markers = [];
  const eventRe = /<div[^>]*data-anchor=["']event_(\d+)["'][^>]*>/gi;
  while ((m = eventRe.exec(html))) markers.push({ pos:m.index, end:m.index + m[0].length, id:m[1] });

  let tournamentIndex = 0;
  let currentTournament = '';
  const events = [];

  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i];
    while (tournamentIndex < tournaments.length && tournaments[tournamentIndex].pos < marker.pos) {
      currentTournament = tournaments[tournamentIndex].name;
      tournamentIndex++;
    }

    const end = markers[i + 1]?.pos ?? html.length;
    const block = html.slice(marker.end, end);

    const names = matches(/<span[^>]*class=["'][^"']*styles_name__[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi, block)
      .map(x => htmlText(x[1])).filter(Boolean).slice(0,2);
    if (names.length < 2) continue;

    const time = htmlText((block.match(/<span[^>]*class=["'][^"']*styles_time__[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) || [])[1] || 'ЛАЙВ');
    const scoreBlock = (block.match(/<div[^>]*class=["'][^"']*styles_scores__[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i) || [])[1] || '';
    const scores = matches(/<span[^>]*class=["'][^"']*subhead-semibold[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi, scoreBlock)
      .map(x => htmlText(x[1])).filter(x => /^\d+$/.test(x)).slice(0,2);

    const oddValues = matches(/<span[^>]*data-id=["']odds-value["'][^>]*>([\s\S]*?)<\/span>/gi, block)
      .map(x => Number(htmlText(x[1]).replace(',','.')));
    const oddNames = matches(/<span[^>]*data-id=["']outcome-name-value["'][^>]*>([\s\S]*?)<\/span>/gi, block)
      .map(x => htmlText(x[1]));

    const sport = sportFromTournament(currentTournament);
    const categoryName = categoryFromTournament(currentTournament, sport);
    const eventName = names.join(' - ');
    const tournamentId = 'parik-' + stableHash(currentTournament || categoryName);
    const score = (scores.length === 2 ? scores : ['0','0']).join('-');

    const scoreType = sport === 'CS' ? 1006 : sport === 'F' ? 1 : ['T','TT','VB'].includes(sport) ? 1009 : sport === 'H' ? 1 : sport === 'B' ? 1010 : sport === 'PL' ? 1001 : 1;
    const scorePeriod = sport === 'CS' ? 1 : sport === 'F' ? 4 : sport === 'H' ? 5 : sport === 'B' ? 8 : 1;
    const scoreboard = { scores:[{ periodScoreType:scoreType, period:scorePeriod, score }] };
    if (sport === 'CS') scoreboard.scores.push({ periodScoreType:1007, period:1, score });

    const competitors = names.map((name,index) => ({ id:`${marker.id}-${index+1}`, name }));
    const selections = [];

    for (let j = 0; j < Math.min(oddValues.length, oddNames.length, 6); j++) {
      const odds = oddValues[j];
      if (!Number.isFinite(odds) || odds <= 1) continue;

      const raw = oddNames[j];
      let shortLabel = raw;
      let label = raw;
      let outcomeType = j === 0 ? 0 : j === 1 ? 1 : 3;

      if (/^П1$/i.test(raw)) { shortLabel='П1'; label=names[0]; outcomeType=0; }
      else if (/^Х$/i.test(raw)) { shortLabel='X'; label='Нічия'; outcomeType=1; }
      else if (/^П2$/i.test(raw)) { shortLabel='П2'; label=names[1]; outcomeType=3; }
      else if (raw === names[0]) { shortLabel='П1'; label=names[0]; outcomeType=0; }
      else if (raw === names[1]) { shortLabel='П2'; label=names[1]; outcomeType=3; }
      else if (/ніхто|нічия/i.test(raw)) { shortLabel='X'; label=raw; outcomeType=1; }

      selections.push({
        id:`parik:${marker.id}:winner:${outcomeType}:${j}`,
        eventId:marker.id,
        eventName,
        tournament:currentTournament,
        marketName:'Переможець',
        label,
        shortLabel,
        odds,
        sport,
        subsport:categoryName,
        startTime:Math.floor(Date.now()/1000),
        competitors,
        categoryName,
        outcomeType,
        outcomeValues:[],
        resultKind:1,
        frozen:false,
        stage:2,
        marketType:1,
        period:0,
        parameters:[],
        version:1
      });
    }

    events.push({
      id:marker.id,
      name:eventName,
      tournamentId,
      tournamentName:currentTournament,
      categoryName,
      sport,
      subsport:categoryName,
      stage:2,
      status:/перерва/i.test(time) ? 2 : 1,
      tradingStatus:1,
      startTime:Math.floor(Date.now()/1000),
      regulation:time,
      competitors,
      scoreboard,
      selections
    });
  }

  return events;
}

async function currentLiveEvents() {
  if (Date.now() - liveCache.at < 7000 && liveCache.events.length) return liveCache;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const url = LIVE_SOURCE + '?arena=' + Date.now();
    const response = await fetch(url, {
      signal:controller.signal,
      cache:'no-store',
      headers:{
        'user-agent':'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/153 Mobile Safari/537.36',
        'accept':'text/html,application/xhtml+xml',
        'accept-language':'uk-UA,uk;q=0.9,en;q=0.7',
        'cache-control':'no-cache',
        'pragma':'no-cache'
      }
    });

    if (!response.ok) throw new Error('Parik24 HTTP ' + response.status);
    const html = await response.text();
    const events = parseParikLive(html);
    liveCache = { at:Date.now(), events, sourceStatus:`HTTP ${response.status}; events=${events.length}` };
    console.log('PARIK_LIVE_OK ' + liveCache.sourceStatus);
    return liveCache;
  } catch (error) {
    console.error('PARIK_LIVE_ERROR', error?.cause?.code || error?.name || error?.message || error);
    if (liveCache.events.length) return { ...liveCache, stale:true, sourceStatus:'stale-cache' };
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

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

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');

    if (url.pathname === '/health') {
      let live = null;
      try {
        const result = await currentLiveEvents();
        live = { ok:true, events:result.events.length, sourceStatus:result.sourceStatus, stale:!!result.stale };
      } catch (error) {
        live = { ok:false, error:String(error?.cause?.code || error?.name || error?.message || error) };
      }
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      return res.end(JSON.stringify({ ok:true, source:'arena-line-site.zip-exact-worker-v32', live }));
    }

    if (url.pathname === '/feed.mjs') {
      res.statusCode = 200;
      res.setHeader('content-type', 'text/javascript; charset=utf-8');
      res.setHeader('cache-control', 'no-store, no-cache, must-revalidate');
      return res.end(liveFeedModule);
    }

    if (url.pathname === '/api/live') {
      try {
        const result = await currentLiveEvents();
        const sport = url.searchParams.get('sport') || '';
        const stage = url.searchParams.get('stage') || 'live';
        const events = stage === 'live'
          ? result.events.filter(event => !sport || event.sport === sport)
          : [];

        res.statusCode = 200;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.setHeader('cache-control', 'no-store');
        return res.end(JSON.stringify({
          ok:true,
          source:'parik24.me',
          sourceStatus:result.sourceStatus,
          stale:!!result.stale,
          total:result.events.length,
          sport,
          events
        }));
      } catch (error) {
        res.statusCode = 502;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.setHeader('cache-control', 'no-store');
        return res.end(JSON.stringify({
          ok:false,
          error:String(error?.cause?.code || error?.name || error?.message || error)
        }));
      }
    }

    const method = req.method || 'GET';
    const body = ['GET','HEAD'].includes(method) ? undefined : await readBody(req);
    const request = new Request('http://localhost' + (req.url || '/'), {
      method,
      headers:req.headers,
      ...(body ? { body } : {})
    });

    const response = await app.fetch(request, env, ctx);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.setHeader('cache-control', 'no-store');
    if (method === 'HEAD' || response.status === 204 || !response.body) return res.end();
    Readable.fromWeb(response.body).pipe(res);
  } catch (error) {
    console.error('Arena Line exact worker error', error?.stack || error);
    res.statusCode = 500;
    res.setHeader('content-type','text/plain; charset=utf-8');
    res.end('Arena Line server error');
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log('Arena Line exact ZIP v32 listening on ' + port + ' with current Parik24 live bridge');
  currentLiveEvents().catch(() => {});
});

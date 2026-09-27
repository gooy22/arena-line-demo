const CACHE_TTL = 60_000;
const cache = new Map();
const cooldown = new Map();

const normalize = value => String(value || '')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]/gu, '');

const aliases = team => [
  team?.name,
  ...(team?.team_clans || []).map(clan => clan?.clan_name)
].map(normalize).filter(Boolean);

const eventTeams = event => {
  const names = event?.competitors?.length === 2
    ? event.competitors.map(team => typeof team === 'string' ? team : team?.name)
    : String(event?.eventName || event?.name || '').split(/\s+[-–—]\s+/);
  return names.map(normalize).filter(Boolean);
};

const eventTime = event => {
  if (typeof event?.startTime === 'number') return event.startTime * 1000;
  return Date.parse(event?.startTime);
};

function orientation(event, teams, start) {
  const names = eventTeams(event);
  const when = eventTime(event);
  if (names.length !== 2 || !names.every(Boolean) || !Number.isFinite(when)) return -1;
  const startMs = Date.parse(start);
  if (!Number.isFinite(startMs) || Math.abs(when - startMs) > 2 * 3600_000) return -1;
  const sets = teams.map(aliases);
  if (!sets[0]?.length || !sets[1]?.length) return -1;
  const direct = sets[0].includes(names[0]) && sets[1].includes(names[1]);
  const reverse = sets[1].includes(names[0]) && sets[0].includes(names[1]);
  return direct === reverse ? -1 : direct ? 0 : 1;
}

async function cachedJSON(url, ttl = CACHE_TTL) {
  const origin = new URL(url).origin;
  if ((cooldown.get(origin) || 0) > Date.now()) throw new Error('provider cooldown');
  const old = cache.get(url);
  if (old && Date.now() - old.at < ttl) return old.task;

  const task = (async () => {
    const response = await fetch(url, {
      signal:AbortSignal.timeout(20_000),
      headers:{accept:'application/json'}
    });
    if (response.status === 429) {
      const retry = response.headers.get('retry-after');
      const delay = /^\d+$/.test(retry || '') ? Number(retry) * 1000 : 300_000;
      cooldown.set(origin, Date.now() + Math.max(300_000, delay));
    }
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response.json();
  })();

  if (cache.size > 250) cache.delete(cache.keys().next().value);
  cache.set(url, {at:Date.now(),task});
  try { return await task; }
  catch (error) { cache.delete(url); throw error; }
}

const bo3URL = (path, query = {}) => {
  const qs = new URLSearchParams(query);
  return 'https://api.bo3.gg/api/v1/' + path + (qs.size ? '?' + qs : '');
};

async function finishedArchive(events = [], pages = 4) {
  const all = [];
  const times = events.map(eventTime).filter(Number.isFinite);
  const oldest = times.length ? Math.min(...times) - 2 * 3600_000 : Date.now() - 14 * 24 * 3600_000;

  for (let page = 0; page < pages; page++) {
    const data = await cachedJSON(bo3URL('matches', {
      'page[limit]':'100',
      'page[offset]':String(page * 100),
      sort:'-start_date',
      'filter[matches.status][eq]':'finished'
    }));
    if (!Array.isArray(data?.results)) throw new Error('invalid BO3 archive');
    all.push(...data.results);
    if (data.results.length < 100) break;
    const last = data.results.at(-1);
    if (last?.start_date && Date.parse(last.start_date) < oldest) break;
  }
  return all;
}

async function teamMapFor(matches) {
  const byDiscipline = new Map();
  for (const match of matches) {
    const discipline = String(match?.discipline_id ?? '');
    if (!discipline) continue;
    if (!byDiscipline.has(discipline)) byDiscipline.set(discipline,new Set());
    if (match.team1_id) byDiscipline.get(discipline).add(match.team1_id);
    if (match.team2_id) byDiscipline.get(discipline).add(match.team2_id);
  }

  const teams = new Map();
  for (const [discipline, idsSet] of byDiscipline) {
    const ids = [...idsSet];
    for (let i=0; i<ids.length; i+=100) {
      const data = await cachedJSON(bo3URL('teams', {
        'page[limit]':'100',
        'filter[teams.discipline_id][eq]':discipline,
        'filter[teams.id][in]':ids.slice(i,i+100).join(',')
      }));
      for (const team of data?.results || []) teams.set(String(team.id),team);
    }
  }
  return teams;
}

function normalizeSeriesResult(event, match) {
  if (!match || match.status !== 'finished' || !match.team1 || !match.team2) return null;
  const side = orientation(event,[match.team1,match.team2],match.start_date);
  if (side < 0) return null;

  const teams = side ? [match.team2,match.team1] : [match.team1,match.team2];
  const scores = side
    ? [Number(match.team2_score),Number(match.team1_score)]
    : [Number(match.team1_score),Number(match.team2_score)];

  if (!scores.every(Number.isInteger) || scores.some(score => score < 0) || scores[0] === scores[1]) return null;

  const winnerIndex = scores[0] > scores[1] ? 0 : 1;
  if (String(teams[winnerIndex]?.id) !== String(match.winner_team_id)) return null;

  const category = String(event.categoryName || event.subsport || 'Кіберспорт');
  return {
    id:String(event.eventId || event.id),
    confirmed:true,
    type:0,
    sport:'CS',
    categoryName:category,
    name:event.eventName || event.name,
    competitors:teams.map(team => team.name),
    startTime:match.start_date,
    scoreText:scores.join('-'),
    seriesComplete:true,
    mapsPlayed:scores[0] + scores[1],
    bestOf:Number(match.bo_type || 0) || undefined,
    winnerOnly:true,
    winnerIndex,
    provider:'BO3.gg',
    source:'https://bo3.gg/matches/' + match.slug
  };
}

export async function augmentSettlements(events, existing = []) {
  const existingIds = new Set((existing || []).map(row => String(row.id)));
  const pending = (events || []).filter(event => {
    const id = String(event?.eventId || event?.id || '');
    if (!id || existingIds.has(id)) return false;
    const text = [event.categoryName,event.subsport,event.eventName,event.name].filter(Boolean).join(' ');
    if (/esportsbattle|efootball|кіберфутбол|киберфутбол|virtual\s*(football|hockey|basketball)/i.test(text)) return false;
    return /counter[- ]?strike|\bcs2\b|dota|valorant|league\s*of\s*legends|\blol\b|free\s*fire|mobile\s*legends|pubg|apex|overwatch|rocket\s*league|rainbow\s*six|call\s*of\s*duty/i.test(text);
  });

  if (!pending.length) return {results:[], unavailable:[], pending:[]};

  const unavailable = [];
  try {
    const archive = await finishedArchive(pending,4);
    const candidates = archive.filter(match => pending.some(event => {
      const when = eventTime(event);
      const start = Date.parse(match.start_date);
      return Number.isFinite(when) && Number.isFinite(start) && Math.abs(when-start) <= 2*3600_000;
    }));
    const teams = await teamMapFor(candidates);
    const results = [];

    for (const event of pending) {
      const matches = candidates.filter(match => {
        const a=teams.get(String(match.team1_id));
        const b=teams.get(String(match.team2_id));
        return orientation(event,[a,b],match.start_date) >= 0;
      });
      if (matches.length !== 1) continue;
      try {
        const detail = await cachedJSON(bo3URL('matches/' + encodeURIComponent(matches[0].slug)));
        const row = normalizeSeriesResult(event,detail);
        if (row) results.push(row);
      } catch (error) {
        unavailable.push('BO3 detail');
      }
    }

    return {
      results,
      unavailable:[...new Set(unavailable)],
      pending:pending.filter(event => !results.some(row => row.id === String(event.eventId || event.id))).map(event => String(event.eventId || event.id))
    };
  } catch (error) {
    return {
      results:[],
      unavailable:['BO3.gg: ' + String(error?.message || error)],
      pending:pending.map(event => String(event.eventId || event.id))
    };
  }
}

export async function completedHistory(teamName, limit = 20) {
  const needle = normalize(teamName);
  if (!needle) return [];

  const archive = await finishedArchive([],4);
  const teams = await teamMapFor(archive);
  const rows = [];

  for (const match of archive) {
    const a = teams.get(String(match.team1_id));
    const b = teams.get(String(match.team2_id));
    if (!a || !b) continue;

    const aAliases = aliases(a), bAliases = aliases(b);
    if (!aAliases.includes(needle) && !bAliases.includes(needle)) continue;

    const aScore = Number(match.team1_score);
    const bScore = Number(match.team2_score);
    const hasScore = Number.isInteger(aScore) && Number.isInteger(bScore);

    rows.push({
      id:String(match.id),
      name:[a.name,b.name].join(' - '),
      startTime:match.start_date,
      tournament:match.tournament?.name || match.event?.name || '',
      competitors:[
        {name:a.name,score:hasScore?aScore:null,isWinner:hasScore && aScore>bScore},
        {name:b.name,score:hasScore?bScore:null,isWinner:hasScore && bScore>aScore}
      ]
    });
    if (rows.length >= limit) break;
  }
  return rows;
}

export async function probeResultsSource() {
  const data = await cachedJSON(bo3URL('matches',{
    'page[limit]':'100',
    sort:'-start_date',
    'filter[matches.status][eq]':'finished'
  }),15_000);
  return {
    ok:Array.isArray(data?.results),
    count:Array.isArray(data?.results)?data.results.length:0,
    disciplines:[...new Set((data?.results || []).map(row => row.discipline_id).filter(v => v != null))]
  };
}

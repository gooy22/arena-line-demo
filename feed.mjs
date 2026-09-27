import { getLanguage } from './i18n.mjs';

export const BRAND = 'PRJ4';
export const PUBLIC_API_KEY = '507aa81f-4c27-4e37-9410-21dfb81e9efe';
export const FEED_ENDPOINTS = [
  `wss://parik24.pro/direct-feed/feed?brand=${BRAND}&X-Api-Key=${PUBLIC_API_KEY}`,
  `wss://24parik-bet.org/direct-feed/feed?brand=${BRAND}&X-Api-Key=${PUBLIC_API_KEY}`
];

const CONTEXT = { channel:'MOBILE_WEB', brand:BRAND, user:null, currency:'UAH' };
const RECORD_END = '\x1e';
const MARKET_CHUNK = 40;
const MAX_SYNC_EVENTS = 250;
const TAXONOMY_ID_RE = /^(?:\d{1,16}|[a-f0-9]{32})$/i;
const taxonomyURL = (kind,id,origin='https://parik24.pro') => TAXONOMY_ID_RE.test(String(id || '')) ? `${origin}/taxonomyicons/${kind}/${id}-164w` : '';
const canonical = value => JSON.stringify(value, (_, v) =>
  v && !Array.isArray(v) && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]]))
    : v
);

export function mergeDelta(previous, delta) {
  if (delta === null || typeof delta !== 'object') return delta;
  if (Array.isArray(delta)) {
    return delta
      .map((item, i) => mergeDelta(previous?.[i], item))
      .filter(item => !item?.isRemoved);
  }
  if (!Object.keys(delta).length) return previous;
  const result = { ...(previous || {}) };
  for (const [key, value] of Object.entries(delta)) {
    result[key] = mergeDelta(previous?.[key], value);
  }
  return result;
}

export function applyBatch(map, batch) {
  if (batch?.isInitialBatch) map.clear();
  for (const item of batch?.data || []) {
    const id = typeof item.key === 'string' ? item.key : canonical(item.key);
    if (item.isRemoved) map.delete(id);
    else map.set(id, { key:item.key, value:mergeDelta(map.get(id)?.value, item.value) });
  }
  return map;
}

export const MARKET_NAMES = {
  1:'Переможець',
  2:'Результат матчу',
  4:'Фора',
  5:'Тотал',
  6:'Парний / непарний',
  16:'Точний рахунок',
  260:'Фора за картами',
  264:'Тотал карт'
};

export function periodName(sport, period) {
  if (!period) return '';
  if (sport === 'CS') return `Карта ${period}`;
  if (sport === 'F') return `${period}-й тайм`;
  if (['T','TT','VB'].includes(sport)) return `Сет ${period}`;
  return `Період ${period}`;
}

export function marketSelections(row, event) {
  const { key, value } = row || {};
  if (!key || !value || !event || !MARKET_NAMES[key.marketType] || key.resultKind !== 1) return [];
  const marketName = [periodName(event.sport, key.period), MARKET_NAMES[key.marketType]].filter(Boolean).join(' · ');
  return (value.marketItems || [])
    .filter(item => !item.isRemoved)
    .flatMap(item => (item.outcomes || [])
      .filter(outcome => !outcome.isRemoved)
      .map(outcome => {
        const { type, values = [] } = outcome.key || {};
        const parameters = item.key?.marketParameters || [];
        const names = event.competitors?.map(c => c.name) || [];
        let shortLabel, label;

        if (type === 0 || type === 3) {
          shortLabel = type === 0 ? 'П1' : 'П2';
          label = names[type === 0 ? 0 : 1] || shortLabel;
        } else if (type === 1) {
          shortLabel = 'X'; label = 'Нічия';
        } else if (type === 4 || type === 5) {
          shortLabel = `${type === 4 ? 'Б' : 'М'} ${parameters[0] ?? ''}`;
          label = `${type === 4 ? 'Більше' : 'Менше'} ${parameters[0] ?? ''}`;
        } else if (type === 86 || type === 87) {
          const handicap = Number(parameters[0]);
          if (!Number.isFinite(handicap)) return null;
          const number = type === 86 ? handicap : -handicap;
          shortLabel = `Ф${type === 86 ? 1 : 2} (${number > 0 ? '+' : ''}${number})`;
          label = `${names[type === 86 ? 0 : 1] || ''} ${shortLabel}`;
        } else if (type === 6 || type === 7) {
          shortLabel = type === 6 ? 'Парний' : 'Непарний'; label = shortLabel;
        } else if (type === 102 && values.length === 2) {
          shortLabel = values.join(':'); label = `Рахунок ${shortLabel}`;
        } else return null;

        return {
          id:encodeURIComponent(canonical([key, item.key, outcome.key])),
          eventId:String(key.eventId),
          eventName:event.name,
          tournament:event.tournamentName,
          marketName,
          label,
          shortLabel,
          odds:Number(outcome.odd) / 100,
          sport:event.sport,
          subsport:event.subsport,
          startTime:event.startTime,
          competitors:event.competitors,
          categoryName:event.categoryName,
          outcomeType:type,
          outcomeValues:values,
          resultKind:key.resultKind,
          frozen:!!outcome.isFrozen || event.tradingStatus !== 1 || event.status >= 3 || Number(outcome.odd) <= 100,
          stage:event.stage,
          marketType:key.marketType,
          period:key.period,
          parameters,
          version:outcome.version
        };
      })
      .filter(Boolean));
}

function compactEvent(row, idOverride = '') {
  const event = row?.value || row;
  const eventId = String(idOverride || event?.id || '');
  if (!eventId) return null;
  return {
    id:eventId,
    name:String(event.name || ''),
    categoryId:String(event.categoryId || ''),
    tournamentId:String(event.tournamentId || ''),
    tournamentName:String(event.tournamentName || ''),
    categoryName:String(event.categoryName || ''),
    sport:String(event.sport || ''),
    subsport:String(event.subsport || ''),
    stage:Number(event.stage || 0),
    status:Number(event.status || 0),
    tradingStatus:Number(event.tradingStatus || 0),
    startTime:Number(event.startTime || 0),
    regulation:String(event.regulation || ''),
    competitors:(event.competitors || []).slice(0,2).map(team => ({
      id:String(team.id || ''),
      name:String(team.name || ''),
      categoryName:String(team.categoryName || event.categoryName || ''),
      icon:team.icon?.url ? {url:String(team.icon.url)} : undefined
    })),
    scoreboard:event.scoreboard || null,
    categoryIconUrl:String(event.categoryIconUrl || event?.categoryIcon?.url || event?.subsportIcon?.url || ''),
    tournamentIconUrl:String(event.tournamentIconUrl || event?.tournamentIcon?.url || '')
  };
}


const ESPORTS_RE = /(?:counter[- ]?strike|\bcs2\b|cs:go|dota|valorant|league\s*of\s*legends|\blol\b|free\s*fire|starcraft|overwatch|rainbow\s*six|rocket\s*league|mobile\s*legends|pubg|apex|call\s*of\s*duty)/i;
const ESPORTS_SPORT_RE = /(?:esport|cybersport|cyber sport|кіберспорт|киберспорт)/i;

function flatStrings(value, depth = 0, out = []) {
  if (depth > 3 || value == null) return out;
  if (typeof value === 'string' || typeof value === 'number') {
    out.push(String(value));
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value.slice(0,40)) flatStrings(item, depth + 1, out);
    return out;
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value).slice(0,60)) {
      out.push(String(key));
      flatStrings(item, depth + 1, out);
    }
  }
  return out;
}

function sportRowText(row) {
  return [...flatStrings(row?.key), ...flatStrings(row?.value)].join(' ');
}

function sportCode(row) {
  const candidates = [
    row?.key,
    row?.value?.code,
    row?.value?.sport,
    row?.value?.sportCode,
    row?.value?.id,
    row?.value?.key
  ];
  for (const candidate of candidates) {
    if ((typeof candidate === 'string' || typeof candidate === 'number') && String(candidate).trim()) {
      return String(candidate).trim();
    }
  }
  return '';
}

function inferDiscipline(event) {
  const text = [event?.categoryName,event?.subsport,event?.tournamentName,event?.name].filter(Boolean).join(' ');
  if (/esportsbattle|efootball|кіберфутбол|киберфутбол|cyber\s*(?:football|hockey|basketball)|virtual\s*(?:football|hockey|basketball)/i.test(text)) return 'Virtual';
  if (/dota/i.test(text)) return 'Dota 2';
  if (/valorant/i.test(text)) return 'Valorant';
  if (/league\s*of\s*legends|\blol\b/i.test(text)) return 'League of Legends';
  if (/counter[- ]?strike|cs2|cs:go/i.test(text)) return 'Counter-Strike';
  if (/starcraft/i.test(text)) return 'StarCraft';
  if (/overwatch/i.test(text)) return 'Overwatch';
  if (/rainbow\s*six/i.test(text)) return 'Rainbow Six';
  if (/rocket\s*league/i.test(text)) return 'Rocket League';
  if (/free\s*fire/i.test(text)) return 'Free Fire';
  if (/mobile\s*legends/i.test(text)) return 'Mobile Legends';
  if (/pubg/i.test(text)) return 'PUBG';
  if (/apex/i.test(text)) return 'Apex Legends';
  if (/call\s*of\s*duty/i.test(text)) return 'Call of Duty';
  return event?.categoryName || event?.subsport || 'Кіберспорт';
}

function normalizeEsportsRow(row) {
  if (!row?.value) return row;
  const event = row.value;
  return {
    ...row,
    value:{
      ...event,
      providerSport:event.sport,
      sport:'CS',
      categoryName:inferDiscipline(event),
      subsport:inferDiscipline(event),
      categoryIconUrl:String(
        event?.categoryIcon?.url ||
        event?.subsportIcon?.url ||
        event?.category?.icon?.url ||
        taxonomyURL('categories',event?.categoryId)
      ),
      tournamentIconUrl:String(
        event?.tournamentIcon?.url ||
        event?.tournament?.icon?.url ||
        taxonomyURL('tournaments',event?.tournamentId)
      ),
      competitors:(event.competitors || []).map(team => ({
        ...team,
        categoryName:inferDiscipline(event)
      }))
    }
  };
}

function looksEsportsEvent(event) {
  if (!event) return false;
  const text=[event.categoryName,event.subsport,event.tournamentName,event.name].filter(Boolean).join(' ');
  if (/esportsbattle|efootball|кіберфутбол|киберфутбол|cyber\s*(?:football|hockey|basketball)|virtual\s*(?:football|hockey|basketball)/i.test(text)) return false;
  if (ESPORTS_RE.test(text)) return true;
  return String(event.sport || '').toUpperCase() === 'CS';
}

export class LiveFeed {
  constructor({
    onChange = () => {},
    WebSocketImpl = WebSocket,
    endpoints = FEED_ENDPOINTS
  } = {}) {
    this.onChange = onChange;
    this.WebSocket = WebSocketImpl;
    this.endpoints = [...endpoints];
    this.sport = 'CS';
    this.stage = 'live';
    this.range = { fromInHours:0, toInHours:24 };
    try { if (localStorage.getItem('arena-default-stage') === 'prematch') this.stage = 'prematch'; } catch {}

    this.state = 'connecting';
    this.error = '';
    this.events = new Map();
    this.watched = new Map();
    this.markets = new Map();
    this.sports = new Map();
    this.tournaments = new Map();

    this.selectedIds = [];
    this.subscriptions = new Map();
    this.eventMaps = new Map();
    this.marketMaps = new Map();
    this.viewCache = new Map();

    this.nextId = 0;
    this.failures = 0;
    this.endpointIndex = 0;
    this.endpointAttempts = 0;
    this.ready = false;
    this.sportsReady = false;
    this.eventsReady = false;
    this.marketsReady = false;
    this.lastMessage = 0;
    this.stopped = false;
    this.eventBucketSignature = '';
    this.marketSignature = '';
    this.syncRevision = 0;
  }

  notify() { this.onChange(this); }

  viewKey() {
    return canonical({
      sport:this.sport,
      stage:this.stage,
      range:this.stage === 'prematch' ? this.range : null
    });
  }

  saveView() {
    if (!this.events.size) return;
    this.viewCache.set(this.viewKey(), {at:Date.now(), events:new Map(this.events)});
    while (this.viewCache.size > 12) this.viewCache.delete(this.viewCache.keys().next().value);
  }

  restoreView() {
    const cached = this.viewCache.get(this.viewKey());
    if (!cached || Date.now() - cached.at > 5 * 60_000) {
      this.events = new Map();
      this.eventsReady = false;
      return;
    }
    this.events = new Map(cached.events);
    this.eventsReady = true;
    this.rebuildTournaments();
  }

  report(kind, extra = {}) {
    const payload = {
      kind,
      at:Date.now(),
      endpoint:this.connectedUrl || this.currentUrl || '',
      state:this.state,
      sport:this.sport,
      stage:this.stage,
      events:this.events.size,
      watched:this.watched.size,
      markets:this.markets.size,
      ...extra
    };
    fetch('/api/sync/telemetry', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify(payload),
      keepalive:true
    }).catch(() => {});
  }

  connect() {
    if (this.socket && this.socket.readyState < 2) return;
    this.stopped = false;
    clearTimeout(this.retry);
    clearTimeout(this.timeout);
    clearTimeout(this.catalogTimer);
    clearInterval(this.heartbeat);
    this.state = this.events.size ? 'offline' : 'connecting';
    this.error = '';
    this.endpointAttempts = 0;
    this.tryEndpoint(this.endpointIndex);
    this.notify();
  }

  tryEndpoint(index) {
    if (this.stopped || !this.endpoints.length) return;
    clearTimeout(this.retry);
    clearTimeout(this.timeout);
    clearTimeout(this.catalogTimer);
    clearInterval(this.heartbeat);

    this.endpointIndex = ((index % this.endpoints.length) + this.endpoints.length) % this.endpoints.length;
    const url = this.endpoints[this.endpointIndex];
    this.currentUrl = url;
    this.ready = false;
    this.sportsReady = false;
    this.subscriptions.clear();
    this.eventMaps.clear();
    this.marketMaps.clear();
    this.marketsReady = false;
    this.eventBucketSignature = '';
    this.marketSignature = '';

    const socket = this.socket = new this.WebSocket(url);
    let buffer = '';
    let opened = false;

    this.timeout = setTimeout(() => {
      this.error = 'Джерело матчів не відповідає';
      try { socket.close(); } catch {}
    }, 15_000);

    socket.onopen = () => {
      if (socket !== this.socket) return;
      opened = true;
      socket.send(JSON.stringify({protocol:'json',version:1}) + RECORD_END);
    };

    socket.onmessage = ({data}) => {
      if (socket !== this.socket || typeof data !== 'string') return;
      this.lastMessage = Date.now();
      buffer += data;
      const parts = buffer.split(RECORD_END);
      buffer = parts.pop();
      try {
        for (const part of parts) if (part) this.message(JSON.parse(part));
      } catch (error) {
        this.error = 'Не вдалося прочитати оновлення лінії';
        this.report('decode-error', {message:String(error?.message || error)});
        socket.close();
      }
    };

    socket.onerror = () => {
      if (socket !== this.socket) return;
      this.error = 'Немає з’єднання з джерелом матчів';
    };

    socket.onclose = event => {
      if (socket !== this.socket) return;
      clearTimeout(this.timeout);
      clearTimeout(this.catalogTimer);
      clearInterval(this.heartbeat);
      const hadReady = this.ready;
      this.ready = false;
      this.state = this.events.size ? 'offline' : 'connecting';
      this.notify();
      if (this.stopped) return;

      this.report('closed', {
        code:event?.code || 0,
        reason:event?.reason || '',
        opened,
        hadReady
      });

      if (!hadReady && this.endpointAttempts < this.endpoints.length - 1) {
        this.endpointAttempts++;
        return this.tryEndpoint(this.endpointIndex + 1);
      }

      this.endpointAttempts = 0;
      this.failures++;
      const delay = Math.min(30_000, 1200 * 2 ** Math.min(this.failures, 5)) + Math.floor(Math.random() * 700);
      this.retry = setTimeout(() => this.tryEndpoint(this.endpointIndex + 1), delay);
    };
  }

  send(message) {
    if (this.socket?.readyState === 1) this.socket.send(JSON.stringify(message) + RECORD_END);
  }

  message(message) {
    if (!this.ready && message.type === undefined) {
      if (message.error) {
        this.error = 'Джерело відхилило підключення';
        this.report('handshake-error', {message:String(message.error)});
        this.socket.close();
        return;
      }

      clearTimeout(this.timeout);
      this.ready = true;
      this.failures = 0;
      this.endpointAttempts = 0;
      this.connectedUrl = this.currentUrl;
      this.state = 'connected';
      this.error = '';

      this.heartbeat = setInterval(() => {
        if (Date.now() - this.lastMessage > 45_000) {
          this.error = 'Потік матчів перестав оновлюватися';
          this.socket.close();
          return;
        }
        this.send({type:6});
      }, 10_000);

      this.subscribe('sports', 'GetSports', [], this.sports);
      this.subscribeWatched();

      if (this.sport !== 'CS') {
        this.subscribeEvents(true);
      } else {
        this.catalogTimer = setTimeout(() => this.subscribeEvents(true), 1800);
      }

      this.report('connected');
      this.notify();
      return;
    }

    if (message.type === 7) {
      this.error = 'Сервер завершив з’єднання';
      this.socket.close();
      return;
    }

    const subscription = this.subscriptions.get(message.invocationId);
    if (!subscription) return;

    if (message.type === 3 && message.error) {
      subscription.error = String(message.error);
      if (subscription.name.startsWith('markets:')) {
        this.marketsReady = false;
      } else if (subscription.name.startsWith('events:')) {
        this.rebuildEvents();
      } else if (subscription.name !== 'sports') {
        this.error = 'Джерело тимчасово не віддає цей розділ';
      }
      this.report('subscription-error', {
        subscription:subscription.name,
        message:String(message.error)
      });
      this.notify();
      return;
    }

    if (message.type !== 2 || !message.item) return;

    applyBatch(subscription.map, message.item);
    if (message.item.isInitialBatch) subscription.initial = true;

    if (subscription.name === 'sports') {
      this.sportsReady = !!subscription.initial;
      if (subscription.initial) {
        clearTimeout(this.catalogTimer);
        const catalog = [...this.sports.values()].slice(0,60).map(row => ({
          code:sportCode(row),
          name:String(row?.value?.name || ''),
          slug:String(row?.value?.slug || ''),
          live:Number(row?.value?.liveEventsCount || 0),
          prematch:Number(row?.value?.prematchEventsCount || 0)
        }));
        this.report('sport-catalog', {
          message:JSON.stringify(catalog).slice(0,3000)
        });
        this.subscribeEvents(true);
      }
    } else if (subscription.name.startsWith('events:')) {
      this.rebuildEvents();
    } else if (subscription.name === 'watched') {
      this.scheduleMarkets();
      this.scheduleSync();
    } else if (subscription.name.startsWith('markets:')) {
      this.rebuildMarkets();
    }

    this.notify();
  }

  subscribe(name, target, args, map) {
    this.cancel(name);
    const id = String(++this.nextId);
    this.subscriptions.set(id, {name,map,initial:false,target,error:''});
    this.send({
      type:4,
      invocationId:id,
      target,
      arguments:[...args, {...CONTEXT,language:getLanguage()}]
    });
    return id;
  }

  cancel(name) {
    for (const [id, subscription] of [...this.subscriptions]) {
      if (subscription.name !== name) continue;
      this.send({type:5,invocationId:id});
      this.subscriptions.delete(id);
    }
  }

  cancelPrefix(prefix) {
    for (const [id, subscription] of [...this.subscriptions]) {
      if (!subscription.name.startsWith(prefix)) continue;
      this.send({type:5,invocationId:id});
      this.subscriptions.delete(id);
    }
  }

  providerSportBuckets() {
    if (this.sport !== 'CS') return [this.sport];

    const catalog = [...this.sports.values()]
      .map(row => ({
        code:sportCode(row),
        name:String(row?.value?.name || ''),
        slug:String(row?.value?.slug || ''),
        text:sportRowText(row),
        live:Number(row?.value?.liveEventsCount || 0),
        prematch:Number(row?.value?.prematchEventsCount || 0)
      }))
      .filter(row => row.code);

    let buckets = catalog
      .filter(row => ESPORTS_SPORT_RE.test([row.name,row.slug,row.text].join(' ')))
      .map(row => row.code);

    // Current Parik taxonomy historically uses CS for the whole real-esports branch.
    if (!buckets.length && catalog.some(row => row.code === 'CS')) buckets = ['CS'];

    buckets = [...new Set(buckets)];
    return buckets.length ? buckets : ['CS'];
  }

  subscribeEvents(force = false) {
    if (!this.ready) return;

    const buckets = this.providerSportBuckets();
    const modes = this.sport === 'CS'
      ? [
          {stage:'live',target:'GetLiveRichEventsBySport'},
          {stage:'prematch',target:'GetRichEventsBySportAndTimeRange'}
        ]
      : [{
          stage:this.stage,
          target:this.stage === 'live' ? 'GetLiveRichEventsBySport' : 'GetRichEventsBySportAndTimeRange'
        }];

    const signature = canonical({
      modes:modes.map(mode => mode.stage),
      range:this.sport === 'CS' || this.stage === 'prematch' ? this.range : null,
      buckets
    });
    if (!force && signature === this.eventBucketSignature) return;
    this.eventBucketSignature = signature;

    this.cancelPrefix('events:');
    this.eventMaps.clear();
    this.eventsReady = this.events.size > 0;

    modes.forEach(mode => {
      buckets.forEach((bucket,index) => {
        const map = new Map();
        const name = 'events:' + mode.stage + ':' + index + ':' + bucket;
        this.eventMaps.set(name,map);
        const args = mode.stage === 'live' ? [bucket] : [bucket,this.range];
        this.subscribe(name,mode.target,args,map);
      });
    });

    this.report('event-buckets', {
      message:JSON.stringify({buckets,modes:modes.map(mode=>mode.stage)}).slice(0,1800)
    });
  }

  rebuildEvents() {
    const combined = new Map();

    for (const map of this.eventMaps.values()) {
      for (const [id,row] of map) {
        if (this.sport === 'CS') {
          if (!looksEsportsEvent(row?.value)) continue;
          const normalized=normalizeEsportsRow(row);
          normalized.value={...normalized.value,id:String(id)};
          combined.set(String(id),normalized);
        } else {
          combined.set(String(id),{...row,value:{...row.value,id:String(id)}});
        }
      }
    }

    this.events = combined;
    const eventSubs = [...this.subscriptions.values()].filter(s => s.name.startsWith('events:'));
    this.eventsReady = eventSubs.length > 0 && eventSubs.every(s => s.initial || s.error);

    this.saveView();
    this.rebuildTournaments();
    this.scheduleMarkets();
    this.scheduleSync();

    if (this.eventsReady) {
      const bucketCounts = {};
      for (const [name,map] of this.eventMaps) bucketCounts[name] = map.size;
      const categoryCounts={};
      for (const row of this.events.values()) {
        const category=String(row.value?.categoryName || 'Unknown');
        categoryCounts[category]=(categoryCounts[category] || 0) + 1;
      }
      const samples=[...this.events.values()].slice(0,12).map(row=>({
        id:String(row.value?.id || ''),
        category:String(row.value?.categoryName || ''),
        categoryId:String(row.value?.categoryId || ''),
        tournament:String(row.value?.tournamentName || ''),
        tournamentId:String(row.value?.tournamentId || ''),
        providerSport:String(row.value?.providerSport || row.value?.sport || ''),
        categoryIconUrl:String(row.value?.categoryIconUrl || ''),
        tournamentIconUrl:String(row.value?.tournamentIconUrl || ''),
        teams:(row.value?.competitors || []).slice(0,2).map(team=>({id:String(team?.id || ''),name:team.name,icon:team?.icon?.url || ''})),
        rawKeys:Object.keys(row.value || {}).slice(0,40)
      }));
      this.report('events-ready', {
        message:JSON.stringify({total:this.events.size,bucketCounts,categoryCounts,samples}).slice(0,3000)
      });
    }
  }

  setView(sport,stage) {
    const previousSport=this.sport;
    if (sport === this.sport && stage === this.stage) {
      if (this.ready) this.subscribeEvents(true);
      return;
    }

    this.saveView();
    this.sport = sport;
    this.stage = stage;
    this.restoreView();

    this.markets.clear();
    this.marketMaps.clear();
    this.marketSignature = '';
    this.marketsReady = false;
    this.eventBucketSignature = '';
    this.state = this.ready ? 'connected' : 'connecting';

    if (this.ready) {
      if (previousSport === 'CS' && sport === 'CS') {
        this.marketSignature='';
        this.scheduleMarkets();
      } else {
        this.subscribeEvents(true);
      }
    }
    this.notify();
  }

  watch(ids) {
    const next = [...new Set((ids || []).map(String))].sort();
    if (canonical(next) === canonical(this.selectedIds)) return;
    this.selectedIds = next;
    if (this.ready) {
      this.subscribeWatched();
      this.scheduleMarkets();
    }
  }

  subscribeWatched() {
    this.watched.clear();
    this.cancel('watched');
    if (this.selectedIds.length) this.subscribe('watched','GetRichEventsByIds',[this.selectedIds],this.watched);
  }

  scheduleMarkets() {
    clearTimeout(this.marketTimer);
    this.marketTimer = setTimeout(() => this.subscribeMarkets(),120);
  }

  subscribeMarkets() {
    if (!this.ready) return;
    const visibleIds=[...this.events]
      .filter(([,row]) => this.stage === 'live' ? Number(row.value?.stage) === 2 : Number(row.value?.stage) === 1)
      .map(([id]) => id);
    const ids = [...new Set([...visibleIds,...this.selectedIds])].sort();
    const signature = canonical(ids);
    if (signature === this.marketSignature) return;
    this.marketSignature = signature;

    this.cancelPrefix('markets:');
    this.marketMaps.clear();
    this.markets.clear();
    this.marketsReady = ids.length === 0;

    const chunks = [];
    for (let i=0;i<ids.length;i+=MARKET_CHUNK) chunks.push(ids.slice(i,i+MARKET_CHUNK));

    chunks.forEach((chunk,index) => {
      const name='markets:'+index;
      const map=new Map();
      this.marketMaps.set(name,map);
      this.subscribe(name,'GetMarketsByEventIds',[chunk,null],map);
    });

    if (!chunks.length) this.notify();
  }

  rebuildMarkets() {
    const combined=new Map();
    for (const map of this.marketMaps.values()) for (const [id,row] of map) combined.set(id,row);
    this.markets=combined;

    const marketSubs=[...this.subscriptions.values()].filter(s => s.name.startsWith('markets:'));
    this.marketsReady=marketSubs.length===0 || marketSubs.every(s => s.initial && !s.error);
  }

  rebuildTournaments() {
    const tournaments=new Map();
    for (const row of this.events.values()) {
      const event=row.value;
      if (!event?.tournamentId) continue;
      const key=String(event.tournamentId);
      const old=tournaments.get(key);
      if (!old) {
        tournaments.set(key,{
          id:key,
          name:event.tournamentName || '',
          categoryName:event.categoryName || '',
          sport:event.sport || this.sport,
          eventIds:[String(event.id)]
        });
      } else old.eventIds.push(String(event.id));
    }
    this.tournaments=tournaments;
  }

  scheduleSync() {
    clearTimeout(this.syncTimer);
    this.syncTimer=setTimeout(() => this.pushSync(),1200);
  }

  async pushSync() {
    const rows=[...new Map([...this.events,...this.watched]).entries()]
      .map(([id,row]) => compactEvent(row,id))
      .filter(Boolean)
      .slice(0,MAX_SYNC_EVENTS);
    if (!rows.length) return;

    const revision=++this.syncRevision;
    const batchSize=35;
    const batches=[];
    for(let i=0;i<rows.length;i+=batchSize) batches.push(rows.slice(i,i+batchSize));

    let accepted=0;
    for(let index=0; index<batches.length; index++){
      const batch=batches[index];
      try{
        const response=await fetch('/api/sync/events',{
          method:'POST',
          headers:{'content-type':'application/json'},
          body:JSON.stringify({
            revision,
            batch:index+1,
            batches:batches.length,
            source:this.connectedUrl || this.currentUrl || '',
            sport:this.sport,
            stage:this.sport === 'CS' ? 'all' : this.stage,
            rows:batch
          }),
          cache:'no-store'
        });
        if(!response.ok) throw new Error('sync HTTP '+response.status);
        const value=await response.json().catch(()=>({}));
        accepted+=Number(value?.accepted || batch.length);
      }catch(error){
        this.report('events-sync-error',{
          message:JSON.stringify({
            revision,
            batch:index+1,
            batches:batches.length,
            rows:batch.length,
            error:String(error?.message || error)
          }).slice(0,1000)
        });
        return;
      }
    }

    this.report('events-synced',{
      message:JSON.stringify({
        revision,
        rows:accepted,
        batches:batches.length
      })
    });
  }

  get fresh() {
    return this.ready &&
      this.state === 'connected' &&
      this.eventsReady &&
      this.marketsReady &&
      Date.now() - this.lastMessage < 45_000;
  }

  event(id) {
    return this.events.get(String(id))?.value || this.watched.get(String(id))?.value;
  }

  selections(eventId) {
    const event=this.event(eventId);
    if (!event) return [];
    return [...this.markets.values()]
      .filter(row => String(row.key?.eventId) === String(eventId))
      .sort((a,b) =>
        Number(a.key?.period || 0)-Number(b.key?.period || 0) ||
        Number(a.value?.sortOrder || 0)-Number(b.value?.sortOrder || 0))
      .flatMap(row => marketSelections(row,event));
  }

  quote(id) {
    for (const row of this.markets.values()) {
      const event=this.event(row.key?.eventId);
      if (!event) continue;
      const result=marketSelections(row,event).find(selection => selection.id === id);
      if (result) return result;
    }
    return null;
  }

  close() {
    this.stopped=true;
    clearTimeout(this.retry);
    clearTimeout(this.timeout);
    clearTimeout(this.catalogTimer);
    clearTimeout(this.marketTimer);
    clearTimeout(this.syncTimer);
    clearInterval(this.heartbeat);
    try { this.socket?.close(); } catch {}
  }
}

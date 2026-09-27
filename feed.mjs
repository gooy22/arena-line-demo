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

function compactEvent(row) {
  const event = row?.value || row;
  if (!event?.id) return null;
  return {
    id:String(event.id),
    name:String(event.name || ''),
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
      icon:team.icon?.url ? {url:String(team.icon.url)} : undefined
    })),
    scoreboard:event.scoreboard || null
  };
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
    try {
      if (localStorage.getItem('arena-default-stage') === 'prematch') this.stage = 'prematch';
    } catch {}

    this.state = 'connecting';
    this.error = '';
    this.events = new Map();
    this.watched = new Map();
    this.markets = new Map();
    this.sports = new Map();
    this.tournaments = new Map();

    this.selectedIds = [];
    this.subscriptions = new Map();
    this.marketMaps = new Map();
    this.viewCache = new Map();

    this.nextId = 0;
    this.failures = 0;
    this.endpointIndex = 0;
    this.endpointAttempts = 0;
    this.ready = false;
    this.eventsReady = false;
    this.marketsReady = false;
    this.lastMessage = 0;
    this.stopped = false;
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
    this.viewCache.set(this.viewKey(), {
      at:Date.now(),
      events:new Map(this.events)
    });
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
    clearInterval(this.heartbeat);

    this.endpointIndex = ((index % this.endpoints.length) + this.endpoints.length) % this.endpoints.length;
    const url = this.endpoints[this.endpointIndex];
    this.currentUrl = url;
    this.ready = false;
    this.subscriptions.clear();
    this.marketMaps.clear();
    this.marketsReady = false;
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
      socket.send(JSON.stringify({ protocol:'json', version:1 }) + RECORD_END);
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
    if (this.socket?.readyState === 1) {
      this.socket.send(JSON.stringify(message) + RECORD_END);
    }
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
      this.subscribeEvents();
      this.subscribeWatched();
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
      } else {
        this.error = 'Джерело тимчасово не віддає цей розділ';
        this.state = 'error';
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

    if (subscription.name === 'events') {
      this.eventsReady = true;
      this.saveView();
      this.rebuildTournaments();
      this.scheduleMarkets();
      this.scheduleSync();
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
    this.subscriptions.set(id, {name, map, initial:false, target});
    this.send({
      type:4,
      invocationId:id,
      target,
      arguments:[...args, {...CONTEXT, language:getLanguage()}]
    });
    return id;
  }

  cancel(name) {
    for (const [id, subscription] of [...this.subscriptions]) {
      if (subscription.name !== name) continue;
      this.send({type:5, invocationId:id});
      this.subscriptions.delete(id);
    }
  }

  cancelPrefix(prefix) {
    for (const [id, subscription] of [...this.subscriptions]) {
      if (!subscription.name.startsWith(prefix)) continue;
      this.send({type:5, invocationId:id});
      this.subscriptions.delete(id);
    }
  }

  subscribeEvents() {
    if (!this.ready) return;
    this.eventsReady = this.events.size > 0;
    const target = this.stage === 'live'
      ? 'GetLiveRichEventsBySport'
      : 'GetRichEventsBySportAndTimeRange';
    const args = this.stage === 'live'
      ? [this.sport]
      : [this.sport, this.range];
    this.subscribe('events', target, args, this.events);
  }

  setView(sport, stage) {
    if (sport === this.sport && stage === this.stage) {
      if (this.ready) this.subscribeEvents();
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
    this.state = this.ready ? 'connected' : 'connecting';

    if (this.ready) this.subscribeEvents();
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
    if (this.selectedIds.length) {
      this.subscribe('watched', 'GetRichEventsByIds', [this.selectedIds], this.watched);
    }
  }

  scheduleMarkets() {
    clearTimeout(this.marketTimer);
    this.marketTimer = setTimeout(() => this.subscribeMarkets(), 120);
  }

  subscribeMarkets() {
    if (!this.ready) return;
    const ids = [...new Set([...this.events.keys(), ...this.selectedIds])].sort();
    const signature = canonical(ids);
    if (signature === this.marketSignature) return;
    this.marketSignature = signature;

    this.cancelPrefix('markets:');
    this.marketMaps.clear();
    this.markets.clear();
    this.marketsReady = ids.length === 0;

    const chunks = [];
    for (let i=0; i<ids.length; i+=MARKET_CHUNK) chunks.push(ids.slice(i, i+MARKET_CHUNK));

    chunks.forEach((chunk, index) => {
      const name = `markets:${index}`;
      const map = new Map();
      this.marketMaps.set(name, map);
      this.subscribe(name, 'GetMarketsByEventIds', [chunk, null], map);
    });

    if (!chunks.length) this.notify();
  }

  rebuildMarkets() {
    const combined = new Map();
    for (const map of this.marketMaps.values()) {
      for (const [id, row] of map) combined.set(id, row);
    }
    this.markets = combined;

    const marketSubs = [...this.subscriptions.values()].filter(s => s.name.startsWith('markets:'));
    this.marketsReady = marketSubs.length === 0 || marketSubs.every(s => s.initial && !s.error);
  }

  rebuildTournaments() {
    const tournaments = new Map();
    for (const row of this.events.values()) {
      const event = row.value;
      if (!event?.tournamentId) continue;
      const key = String(event.tournamentId);
      const old = tournaments.get(key);
      if (!old) {
        tournaments.set(key, {
          id:key,
          name:event.tournamentName || '',
          categoryName:event.categoryName || '',
          sport:event.sport || this.sport,
          eventIds:[String(event.id)]
        });
      } else old.eventIds.push(String(event.id));
    }
    this.tournaments = tournaments;
  }

  scheduleSync() {
    clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => this.pushSync(), 1200);
  }

  pushSync() {
    const rows = [...new Map([...this.events, ...this.watched]).values()]
      .map(compactEvent)
      .filter(Boolean)
      .slice(0, MAX_SYNC_EVENTS);

    if (!rows.length) return;
    const revision = ++this.syncRevision;

    fetch('/api/sync/events', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        revision,
        source:this.connectedUrl || this.currentUrl || '',
        sport:this.sport,
        stage:this.stage,
        rows
      }),
      keepalive:true
    }).catch(() => {});
  }

  get fresh() {
    return this.ready &&
      this.state === 'connected' &&
      this.marketsReady &&
      Date.now() - this.lastMessage < 45_000;
  }

  event(id) {
    return this.events.get(String(id))?.value || this.watched.get(String(id))?.value;
  }

  selections(eventId) {
    const event = this.event(eventId);
    if (!event) return [];
    return [...this.markets.values()]
      .filter(row => String(row.key?.eventId) === String(eventId))
      .sort((a,b) =>
        Number(a.key?.period || 0) - Number(b.key?.period || 0) ||
        Number(a.value?.sortOrder || 0) - Number(b.value?.sortOrder || 0))
      .flatMap(row => marketSelections(row, event));
  }

  quote(id) {
    for (const row of this.markets.values()) {
      const event = this.event(row.key?.eventId);
      if (!event) continue;
      const result = marketSelections(row, event).find(selection => selection.id === id);
      if (result) return result;
    }
    return null;
  }

  close() {
    this.stopped = true;
    clearTimeout(this.retry);
    clearTimeout(this.timeout);
    clearTimeout(this.marketTimer);
    clearTimeout(this.syncTimer);
    clearInterval(this.heartbeat);
    try { this.socket?.close(); } catch {}
  }
}

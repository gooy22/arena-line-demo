export const MARKET_NAMES = { 1: 'Переможець', 2: 'Результат матчу', 4: 'Фора', 5: 'Тотал', 6: 'Парний / непарний', 16: 'Точний рахунок', 260: 'Фора за картами', 264: 'Тотал карт' };

export function periodName(sport, period) {
  if (!period) return '';
  if (sport === 'CS') return `Карта ${period}`;
  if (sport === 'F') return `${period}-й тайм`;
  if (['T','TT','VB'].includes(sport)) return `Сет ${period}`;
  return `Період ${period}`;
}

export class LiveFeed {
  constructor({ onChange = () => {} } = {}) {
    this.onChange = onChange;
    this.sport = 'CS';
    this.stage = 'live';
    this.range = { fromInHours: 0, toInHours: 24 };
    try { if (localStorage.getItem('arena-default-stage') === 'prematch') this.stage = 'prematch'; } catch {}
    this.state = 'connecting';
    this.error = '';
    this.events = new Map();
    this.watched = new Map();
    this.markets = new Map();
    this.sports = new Map();
    this.selectedIds = [];
    this.eventsReady = false;
    this.marketsReady = false;
    this.lastMessage = 0;
    this.stopped = false;
    this.loading = null;
    this.socket = { readyState: 3, close() {} };
    this._selections = new Map();
    this._quotes = new Map();
  }

  notify() { this.onChange(this); }

  connect() {
    this.stopped = false;
    clearTimeout(this.retry);
    clearInterval(this.poller);
    this.state = this.eventsReady ? this.state : 'connecting';
    this.error = '';
    this.socket = { readyState: 1, close() {} };
    this.notify();
    this.refresh();
    this.poller = setInterval(() => this.refresh(), 10000);
  }

  async refresh() {
    if (this.loading || this.stopped) return this.loading;
    this.loading = (async () => {
      try {
        const query = new URLSearchParams({
          sport: this.sport,
          stage: this.stage,
          _: String(Date.now())
        });
        const response = await fetch('/api/live?' + query, { cache:'no-store', headers:{accept:'application/json'} });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);

        this.events.clear();
        this._selections.clear();
        this._quotes.clear();

        for (const event of payload.events || []) {
          this.events.set(String(event.id), { key:String(event.id), value:event });
          const picks = Array.isArray(event.selections) ? event.selections : [];
          this._selections.set(String(event.id), picks);
          for (const pick of picks) this._quotes.set(String(pick.id), pick);
        }

        this.lastMessage = Date.now();
        this.eventsReady = true;
        this.marketsReady = true;
        this.state = 'connected';
        this.error = '';
        this.failures = 0;
      } catch (problem) {
        this.state = this.eventsReady ? 'offline' : 'error';
        this.error = 'Немає з’єднання з джерелом матчів';
        this.failures = (this.failures || 0) + 1;
      } finally {
        this.loading = null;
        this.notify();
      }
    })();
    return this.loading;
  }

  setView(sport, stage) {
    this.sport = sport;
    this.stage = stage;
    this.events.clear();
    this.eventsReady = false;
    this.marketsReady = false;
    this.state = 'connecting';
    this.notify();
    this.refresh();
  }

  watch(ids) {
    this.selectedIds = [...new Set((ids || []).map(String))].sort();
  }

  event(id) {
    return this.events.get(String(id))?.value || this.watched.get(String(id))?.value;
  }

  selections(eventId) {
    return this._selections.get(String(eventId)) || [];
  }

  quote(id) {
    return this._quotes.get(String(id)) || null;
  }

  get fresh() {
    return this.state === 'connected' && this.marketsReady && Date.now() - this.lastMessage < 45000;
  }

  close() {
    this.stopped = true;
    clearTimeout(this.retry);
    clearInterval(this.poller);
    this.socket = { readyState: 3, close() {} };
  }
}

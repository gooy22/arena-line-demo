import app from '../dist/server/index.js';
import { augmentSettlements, completedHistory, probeResultsSource } from '../results_bridge.mjs';
import { readProfile, loginProfile, syncProfile, profileStorageStatus, changeProfilePassword } from './profile_store.mjs';

const feedModule = "import { getLanguage } from './i18n.mjs';\n\nexport const BRAND = 'PRJ4';\nexport const PUBLIC_API_KEY = '507aa81f-4c27-4e37-9410-21dfb81e9efe';\nexport const FEED_ENDPOINTS = [\n  `wss://parik24.pro/direct-feed/feed?brand=${BRAND}&X-Api-Key=${PUBLIC_API_KEY}`,\n  `wss://24parik-bet.org/direct-feed/feed?brand=${BRAND}&X-Api-Key=${PUBLIC_API_KEY}`\n];\n\nconst CONTEXT = { channel:'MOBILE_WEB', brand:BRAND, user:null, currency:'UAH' };\nconst RECORD_END = '\\x1e';\nconst MARKET_CHUNK = 40;\nconst MAX_SYNC_EVENTS = 250;\nconst TAXONOMY_ID_RE = /^(?:\\d{1,16}|[a-f0-9]{32})$/i;\nconst taxonomyURL = (kind,id,origin='https://parik24.pro') => TAXONOMY_ID_RE.test(String(id || '')) ? `${origin}/taxonomyicons/${kind}/${id}-164w` : '';\nconst canonical = value => JSON.stringify(value, (_, v) =>\n  v && !Array.isArray(v) && typeof v === 'object'\n    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]]))\n    : v\n);\n\nexport function mergeDelta(previous, delta) {\n  if (delta === null || typeof delta !== 'object') return delta;\n  if (Array.isArray(delta)) {\n    return delta\n      .map((item, i) => mergeDelta(previous?.[i], item))\n      .filter(item => !item?.isRemoved);\n  }\n  if (!Object.keys(delta).length) return previous;\n  const result = { ...(previous || {}) };\n  for (const [key, value] of Object.entries(delta)) {\n    result[key] = mergeDelta(previous?.[key], value);\n  }\n  return result;\n}\n\nexport function applyBatch(map, batch) {\n  if (batch?.isInitialBatch) map.clear();\n  for (const item of batch?.data || []) {\n    const id = typeof item.key === 'string' ? item.key : canonical(item.key);\n    if (item.isRemoved) map.delete(id);\n    else map.set(id, { key:item.key, value:mergeDelta(map.get(id)?.value, item.value) });\n  }\n  return map;\n}\n\nexport const MARKET_NAMES = {\n  1:'Переможець',\n  2:'Результат матчу',\n  4:'Фора',\n  5:'Тотал',\n  6:'Парний / непарний',\n  16:'Точний рахунок',\n  260:'Фора за картами',\n  264:'Тотал карт'\n};\n\nexport function periodName(sport, period) {\n  if (!period) return '';\n  if (sport === 'CS') return `Карта ${period}`;\n  if (sport === 'F') return `${period}-й тайм`;\n  if (['T','TT','VB'].includes(sport)) return `Сет ${period}`;\n  return `Період ${period}`;\n}\n\nexport function marketSelections(row, event) {\n  const { key, value } = row || {};\n  if (!key || !value || !event || !MARKET_NAMES[key.marketType] || key.resultKind !== 1) return [];\n  const marketName = [periodName(event.sport, key.period), MARKET_NAMES[key.marketType]].filter(Boolean).join(' · ');\n  return (value.marketItems || [])\n    .filter(item => !item.isRemoved)\n    .flatMap(item => (item.outcomes || [])\n      .filter(outcome => !outcome.isRemoved)\n      .map(outcome => {\n        const { type, values = [] } = outcome.key || {};\n        const parameters = item.key?.marketParameters || [];\n        const names = event.competitors?.map(c => c.name) || [];\n        let shortLabel, label;\n\n        if (type === 0 || type === 3) {\n          shortLabel = type === 0 ? 'П1' : 'П2';\n          label = names[type === 0 ? 0 : 1] || shortLabel;\n        } else if (type === 1) {\n          shortLabel = 'X'; label = 'Нічия';\n        } else if (type === 4 || type === 5) {\n          shortLabel = `${type === 4 ? 'Б' : 'М'} ${parameters[0] ?? ''}`;\n          label = `${type === 4 ? 'Більше' : 'Менше'} ${parameters[0] ?? ''}`;\n        } else if (type === 86 || type === 87) {\n          const handicap = Number(parameters[0]);\n          if (!Number.isFinite(handicap)) return null;\n          const number = type === 86 ? handicap : -handicap;\n          shortLabel = `Ф${type === 86 ? 1 : 2} (${number > 0 ? '+' : ''}${number})`;\n          label = `${names[type === 86 ? 0 : 1] || ''} ${shortLabel}`;\n        } else if (type === 6 || type === 7) {\n          shortLabel = type === 6 ? 'Парний' : 'Непарний'; label = shortLabel;\n        } else if (type === 102 && values.length === 2) {\n          shortLabel = values.join(':'); label = `Рахунок ${shortLabel}`;\n        } else return null;\n\n        return {\n          id:encodeURIComponent(canonical([key, item.key, outcome.key])),\n          eventId:String(key.eventId),\n          eventName:event.name,\n          tournament:event.tournamentName,\n          marketName,\n          label,\n          shortLabel,\n          odds:Number(outcome.odd) / 100,\n          sport:event.sport,\n          subsport:event.subsport,\n          startTime:event.startTime,\n          competitors:event.competitors,\n          categoryName:event.categoryName,\n          outcomeType:type,\n          outcomeValues:values,\n          resultKind:key.resultKind,\n          frozen:!!outcome.isFrozen || event.tradingStatus !== 1 || event.status >= 3 || Number(outcome.odd) <= 100,\n          stage:event.stage,\n          marketType:key.marketType,\n          period:key.period,\n          parameters,\n          version:outcome.version\n        };\n      })\n      .filter(Boolean));\n}\n\nfunction compactEvent(row, idOverride = '') {\n  const event = row?.value || row;\n  const eventId = String(idOverride || event?.id || '');\n  if (!eventId) return null;\n  return {\n    id:eventId,\n    name:String(event.name || ''),\n    categoryId:String(event.categoryId || ''),\n    tournamentId:String(event.tournamentId || ''),\n    tournamentName:String(event.tournamentName || ''),\n    categoryName:String(event.categoryName || ''),\n    sport:String(event.sport || ''),\n    subsport:String(event.subsport || ''),\n    stage:Number(event.stage || 0),\n    status:Number(event.status || 0),\n    tradingStatus:Number(event.tradingStatus || 0),\n    startTime:Number(event.startTime || 0),\n    regulation:String(event.regulation || ''),\n    competitors:(event.competitors || []).slice(0,2).map(team => ({\n      id:String(team.id || ''),\n      name:String(team.name || ''),\n      categoryName:String(team.categoryName || event.categoryName || ''),\n      icon:team.icon?.url ? {url:String(team.icon.url)} : undefined\n    })),\n    scoreboard:event.scoreboard || null,\n    categoryIconUrl:String(event.categoryIconUrl || event?.categoryIcon?.url || event?.subsportIcon?.url || ''),\n    tournamentIconUrl:String(event.tournamentIconUrl || event?.tournamentIcon?.url || '')\n  };\n}\n\n\nconst ESPORTS_RE = /(?:counter[- ]?strike|\\bcs2\\b|cs:go|dota|valorant|league\\s*of\\s*legends|\\blol\\b|free\\s*fire|starcraft|overwatch|rainbow\\s*six|rocket\\s*league|mobile\\s*legends|pubg|apex|call\\s*of\\s*duty)/i;\nconst ESPORTS_SPORT_RE = /(?:esport|cybersport|cyber sport|кіберспорт|киберспорт)/i;\n\nfunction flatStrings(value, depth = 0, out = []) {\n  if (depth > 3 || value == null) return out;\n  if (typeof value === 'string' || typeof value === 'number') {\n    out.push(String(value));\n    return out;\n  }\n  if (Array.isArray(value)) {\n    for (const item of value.slice(0,40)) flatStrings(item, depth + 1, out);\n    return out;\n  }\n  if (typeof value === 'object') {\n    for (const [key, item] of Object.entries(value).slice(0,60)) {\n      out.push(String(key));\n      flatStrings(item, depth + 1, out);\n    }\n  }\n  return out;\n}\n\nfunction sportRowText(row) {\n  return [...flatStrings(row?.key), ...flatStrings(row?.value)].join(' ');\n}\n\nfunction sportCode(row) {\n  const candidates = [\n    row?.key,\n    row?.value?.code,\n    row?.value?.sport,\n    row?.value?.sportCode,\n    row?.value?.id,\n    row?.value?.key\n  ];\n  for (const candidate of candidates) {\n    if ((typeof candidate === 'string' || typeof candidate === 'number') && String(candidate).trim()) {\n      return String(candidate).trim();\n    }\n  }\n  return '';\n}\n\nfunction inferDiscipline(event) {\n  const text = [event?.categoryName,event?.subsport,event?.tournamentName,event?.name].filter(Boolean).join(' ');\n  if (/esportsbattle|efootball|кіберфутбол|киберфутбол|cyber\\s*(?:football|hockey|basketball)|virtual\\s*(?:football|hockey|basketball)/i.test(text)) return 'Virtual';\n  if (/dota/i.test(text)) return 'Dota 2';\n  if (/valorant/i.test(text)) return 'Valorant';\n  if (/league\\s*of\\s*legends|\\blol\\b/i.test(text)) return 'League of Legends';\n  if (/counter[- ]?strike|cs2|cs:go/i.test(text)) return 'Counter-Strike';\n  if (/starcraft/i.test(text)) return 'StarCraft';\n  if (/overwatch/i.test(text)) return 'Overwatch';\n  if (/rainbow\\s*six/i.test(text)) return 'Rainbow Six';\n  if (/rocket\\s*league/i.test(text)) return 'Rocket League';\n  if (/free\\s*fire/i.test(text)) return 'Free Fire';\n  if (/mobile\\s*legends/i.test(text)) return 'Mobile Legends';\n  if (/pubg/i.test(text)) return 'PUBG';\n  if (/apex/i.test(text)) return 'Apex Legends';\n  if (/call\\s*of\\s*duty/i.test(text)) return 'Call of Duty';\n  return event?.categoryName || event?.subsport || 'Кіберспорт';\n}\n\nfunction normalizeEsportsRow(row) {\n  if (!row?.value) return row;\n  const event = row.value;\n  return {\n    ...row,\n    value:{\n      ...event,\n      providerSport:event.sport,\n      sport:'CS',\n      categoryName:inferDiscipline(event),\n      subsport:inferDiscipline(event),\n      categoryIconUrl:String(\n        event?.categoryIcon?.url ||\n        event?.subsportIcon?.url ||\n        event?.category?.icon?.url ||\n        taxonomyURL('categories',event?.categoryId)\n      ),\n      tournamentIconUrl:String(\n        event?.tournamentIcon?.url ||\n        event?.tournament?.icon?.url ||\n        taxonomyURL('tournaments',event?.tournamentId)\n      ),\n      competitors:(event.competitors || []).map(team => ({\n        ...team,\n        categoryName:inferDiscipline(event)\n      }))\n    }\n  };\n}\n\nfunction looksEsportsEvent(event) {\n  if (!event) return false;\n  const text=[event.categoryName,event.subsport,event.tournamentName,event.name].filter(Boolean).join(' ');\n  if (/esportsbattle|efootball|кіберфутбол|киберфутбол|cyber\\s*(?:football|hockey|basketball)|virtual\\s*(?:football|hockey|basketball)/i.test(text)) return false;\n  if (ESPORTS_RE.test(text)) return true;\n  return String(event.sport || '').toUpperCase() === 'CS';\n}\n\nexport class LiveFeed {\n  constructor({\n    onChange = () => {},\n    WebSocketImpl = WebSocket,\n    endpoints = FEED_ENDPOINTS\n  } = {}) {\n    this.onChange = onChange;\n    this.WebSocket = WebSocketImpl;\n    this.endpoints = [...endpoints];\n    this.sport = 'CS';\n    this.stage = 'live';\n    this.range = { fromInHours:0, toInHours:24 };\n    try { if (localStorage.getItem('arena-default-stage') === 'prematch') this.stage = 'prematch'; } catch {}\n\n    this.state = 'connecting';\n    this.error = '';\n    this.events = new Map();\n    this.watched = new Map();\n    this.markets = new Map();\n    this.sports = new Map();\n    this.tournaments = new Map();\n\n    this.selectedIds = [];\n    this.subscriptions = new Map();\n    this.eventMaps = new Map();\n    this.marketMaps = new Map();\n    this.viewCache = new Map();\n\n    this.nextId = 0;\n    this.failures = 0;\n    this.endpointIndex = 0;\n    this.endpointAttempts = 0;\n    this.ready = false;\n    this.sportsReady = false;\n    this.eventsReady = false;\n    this.marketsReady = false;\n    this.lastMessage = 0;\n    this.stopped = false;\n    this.eventBucketSignature = '';\n    this.marketSignature = '';\n    this.syncRevision = 0;\n  }\n\n  notify() { this.onChange(this); }\n\n  viewKey() {\n    return canonical({\n      sport:this.sport,\n      stage:this.stage,\n      range:this.stage === 'prematch' ? this.range : null\n    });\n  }\n\n  saveView() {\n    if (!this.events.size) return;\n    this.viewCache.set(this.viewKey(), {at:Date.now(), events:new Map(this.events)});\n    while (this.viewCache.size > 12) this.viewCache.delete(this.viewCache.keys().next().value);\n  }\n\n  restoreView() {\n    const cached = this.viewCache.get(this.viewKey());\n    if (!cached || Date.now() - cached.at > 5 * 60_000) {\n      this.events = new Map();\n      this.eventsReady = false;\n      return;\n    }\n    this.events = new Map(cached.events);\n    this.eventsReady = true;\n    this.rebuildTournaments();\n  }\n\n  report(kind, extra = {}) {\n    const payload = {\n      kind,\n      at:Date.now(),\n      endpoint:this.connectedUrl || this.currentUrl || '',\n      state:this.state,\n      sport:this.sport,\n      stage:this.stage,\n      events:this.events.size,\n      watched:this.watched.size,\n      markets:this.markets.size,\n      ...extra\n    };\n    fetch('/api/sync/telemetry', {\n      method:'POST',\n      headers:{'content-type':'application/json'},\n      body:JSON.stringify(payload),\n      keepalive:true\n    }).catch(() => {});\n  }\n\n  connect() {\n    if (this.socket && this.socket.readyState < 2) return;\n    this.stopped = false;\n    clearTimeout(this.retry);\n    clearTimeout(this.timeout);\n    clearTimeout(this.catalogTimer);\n    clearInterval(this.heartbeat);\n    this.state = this.events.size ? 'offline' : 'connecting';\n    this.error = '';\n    this.endpointAttempts = 0;\n    this.tryEndpoint(this.endpointIndex);\n    this.notify();\n  }\n\n  tryEndpoint(index) {\n    if (this.stopped || !this.endpoints.length) return;\n    clearTimeout(this.retry);\n    clearTimeout(this.timeout);\n    clearTimeout(this.catalogTimer);\n    clearInterval(this.heartbeat);\n\n    this.endpointIndex = ((index % this.endpoints.length) + this.endpoints.length) % this.endpoints.length;\n    const url = this.endpoints[this.endpointIndex];\n    this.currentUrl = url;\n    this.ready = false;\n    this.sportsReady = false;\n    this.subscriptions.clear();\n    this.eventMaps.clear();\n    this.marketMaps.clear();\n    this.marketsReady = false;\n    this.eventBucketSignature = '';\n    this.marketSignature = '';\n\n    const socket = this.socket = new this.WebSocket(url);\n    let buffer = '';\n    let opened = false;\n\n    this.timeout = setTimeout(() => {\n      this.error = 'Джерело матчів не відповідає';\n      try { socket.close(); } catch {}\n    }, 15_000);\n\n    socket.onopen = () => {\n      if (socket !== this.socket) return;\n      opened = true;\n      socket.send(JSON.stringify({protocol:'json',version:1}) + RECORD_END);\n    };\n\n    socket.onmessage = ({data}) => {\n      if (socket !== this.socket || typeof data !== 'string') return;\n      this.lastMessage = Date.now();\n      buffer += data;\n      const parts = buffer.split(RECORD_END);\n      buffer = parts.pop();\n      try {\n        for (const part of parts) if (part) this.message(JSON.parse(part));\n      } catch (error) {\n        this.error = 'Не вдалося прочитати оновлення лінії';\n        this.report('decode-error', {message:String(error?.message || error)});\n        socket.close();\n      }\n    };\n\n    socket.onerror = () => {\n      if (socket !== this.socket) return;\n      this.error = 'Немає з’єднання з джерелом матчів';\n    };\n\n    socket.onclose = event => {\n      if (socket !== this.socket) return;\n      clearTimeout(this.timeout);\n      clearTimeout(this.catalogTimer);\n      clearInterval(this.heartbeat);\n      const hadReady = this.ready;\n      this.ready = false;\n      this.state = this.events.size ? 'offline' : 'connecting';\n      this.notify();\n      if (this.stopped) return;\n\n      this.report('closed', {\n        code:event?.code || 0,\n        reason:event?.reason || '',\n        opened,\n        hadReady\n      });\n\n      if (!hadReady && this.endpointAttempts < this.endpoints.length - 1) {\n        this.endpointAttempts++;\n        return this.tryEndpoint(this.endpointIndex + 1);\n      }\n\n      this.endpointAttempts = 0;\n      this.failures++;\n      const delay = Math.min(30_000, 1200 * 2 ** Math.min(this.failures, 5)) + Math.floor(Math.random() * 700);\n      this.retry = setTimeout(() => this.tryEndpoint(this.endpointIndex + 1), delay);\n    };\n  }\n\n  send(message) {\n    if (this.socket?.readyState === 1) this.socket.send(JSON.stringify(message) + RECORD_END);\n  }\n\n  message(message) {\n    if (!this.ready && message.type === undefined) {\n      if (message.error) {\n        this.error = 'Джерело відхилило підключення';\n        this.report('handshake-error', {message:String(message.error)});\n        this.socket.close();\n        return;\n      }\n\n      clearTimeout(this.timeout);\n      this.ready = true;\n      this.failures = 0;\n      this.endpointAttempts = 0;\n      this.connectedUrl = this.currentUrl;\n      this.state = 'connected';\n      this.error = '';\n\n      this.heartbeat = setInterval(() => {\n        if (Date.now() - this.lastMessage > 45_000) {\n          this.error = 'Потік матчів перестав оновлюватися';\n          this.socket.close();\n          return;\n        }\n        this.send({type:6});\n      }, 10_000);\n\n      this.subscribe('sports', 'GetSports', [], this.sports);\n      this.subscribeWatched();\n\n      if (this.sport !== 'CS') {\n        this.subscribeEvents(true);\n      } else {\n        this.catalogTimer = setTimeout(() => this.subscribeEvents(true), 1800);\n      }\n\n      this.report('connected');\n      this.notify();\n      return;\n    }\n\n    if (message.type === 7) {\n      this.error = 'Сервер завершив з’єднання';\n      this.socket.close();\n      return;\n    }\n\n    const subscription = this.subscriptions.get(message.invocationId);\n    if (!subscription) return;\n\n    if (message.type === 3 && message.error) {\n      subscription.error = String(message.error);\n      if (subscription.name.startsWith('markets:')) {\n        this.marketsReady = false;\n      } else if (subscription.name.startsWith('events:')) {\n        this.rebuildEvents();\n      } else if (subscription.name !== 'sports') {\n        this.error = 'Джерело тимчасово не віддає цей розділ';\n      }\n      this.report('subscription-error', {\n        subscription:subscription.name,\n        message:String(message.error)\n      });\n      this.notify();\n      return;\n    }\n\n    if (message.type !== 2 || !message.item) return;\n\n    applyBatch(subscription.map, message.item);\n    if (message.item.isInitialBatch) subscription.initial = true;\n\n    if (subscription.name === 'sports') {\n      this.sportsReady = !!subscription.initial;\n      if (subscription.initial) {\n        clearTimeout(this.catalogTimer);\n        const catalog = [...this.sports.values()].slice(0,60).map(row => ({\n          code:sportCode(row),\n          name:String(row?.value?.name || ''),\n          slug:String(row?.value?.slug || ''),\n          live:Number(row?.value?.liveEventsCount || 0),\n          prematch:Number(row?.value?.prematchEventsCount || 0)\n        }));\n        this.report('sport-catalog', {\n          message:JSON.stringify(catalog).slice(0,3000)\n        });\n        this.subscribeEvents(true);\n      }\n    } else if (subscription.name.startsWith('events:')) {\n      this.rebuildEvents();\n    } else if (subscription.name === 'watched') {\n      this.scheduleMarkets();\n      this.scheduleSync();\n    } else if (subscription.name.startsWith('markets:')) {\n      this.rebuildMarkets();\n    }\n\n    this.notify();\n  }\n\n  subscribe(name, target, args, map) {\n    this.cancel(name);\n    const id = String(++this.nextId);\n    this.subscriptions.set(id, {name,map,initial:false,target,error:''});\n    this.send({\n      type:4,\n      invocationId:id,\n      target,\n      arguments:[...args, {...CONTEXT,language:getLanguage()}]\n    });\n    return id;\n  }\n\n  cancel(name) {\n    for (const [id, subscription] of [...this.subscriptions]) {\n      if (subscription.name !== name) continue;\n      this.send({type:5,invocationId:id});\n      this.subscriptions.delete(id);\n    }\n  }\n\n  cancelPrefix(prefix) {\n    for (const [id, subscription] of [...this.subscriptions]) {\n      if (!subscription.name.startsWith(prefix)) continue;\n      this.send({type:5,invocationId:id});\n      this.subscriptions.delete(id);\n    }\n  }\n\n  providerSportBuckets() {\n    if (this.sport !== 'CS') return [this.sport];\n\n    const catalog = [...this.sports.values()]\n      .map(row => ({\n        code:sportCode(row),\n        name:String(row?.value?.name || ''),\n        slug:String(row?.value?.slug || ''),\n        text:sportRowText(row),\n        live:Number(row?.value?.liveEventsCount || 0),\n        prematch:Number(row?.value?.prematchEventsCount || 0)\n      }))\n      .filter(row => row.code);\n\n    let buckets = catalog\n      .filter(row => ESPORTS_SPORT_RE.test([row.name,row.slug,row.text].join(' ')))\n      .map(row => row.code);\n\n    // Current Parik taxonomy historically uses CS for the whole real-esports branch.\n    if (!buckets.length && catalog.some(row => row.code === 'CS')) buckets = ['CS'];\n\n    buckets = [...new Set(buckets)];\n    return buckets.length ? buckets : ['CS'];\n  }\n\n  subscribeEvents(force = false) {\n    if (!this.ready) return;\n\n    const buckets = this.providerSportBuckets();\n    const modes = this.sport === 'CS'\n      ? [\n          {stage:'live',target:'GetLiveRichEventsBySport'},\n          {stage:'prematch',target:'GetRichEventsBySportAndTimeRange'}\n        ]\n      : [{\n          stage:this.stage,\n          target:this.stage === 'live' ? 'GetLiveRichEventsBySport' : 'GetRichEventsBySportAndTimeRange'\n        }];\n\n    const signature = canonical({\n      modes:modes.map(mode => mode.stage),\n      range:this.sport === 'CS' || this.stage === 'prematch' ? this.range : null,\n      buckets\n    });\n    if (!force && signature === this.eventBucketSignature) return;\n    this.eventBucketSignature = signature;\n\n    this.cancelPrefix('events:');\n    this.eventMaps.clear();\n    this.eventsReady = this.events.size > 0;\n\n    modes.forEach(mode => {\n      buckets.forEach((bucket,index) => {\n        const map = new Map();\n        const name = 'events:' + mode.stage + ':' + index + ':' + bucket;\n        this.eventMaps.set(name,map);\n        const args = mode.stage === 'live' ? [bucket] : [bucket,this.range];\n        this.subscribe(name,mode.target,args,map);\n      });\n    });\n\n    this.report('event-buckets', {\n      message:JSON.stringify({buckets,modes:modes.map(mode=>mode.stage)}).slice(0,1800)\n    });\n  }\n\n  rebuildEvents() {\n    const combined = new Map();\n\n    for (const map of this.eventMaps.values()) {\n      for (const [id,row] of map) {\n        if (this.sport === 'CS') {\n          if (!looksEsportsEvent(row?.value)) continue;\n          const normalized=normalizeEsportsRow(row);\n          normalized.value={...normalized.value,id:String(id)};\n          combined.set(String(id),normalized);\n        } else {\n          combined.set(String(id),{...row,value:{...row.value,id:String(id)}});\n        }\n      }\n    }\n\n    this.events = combined;\n    const eventSubs = [...this.subscriptions.values()].filter(s => s.name.startsWith('events:'));\n    this.eventsReady = eventSubs.length > 0 && eventSubs.every(s => s.initial || s.error);\n\n    this.saveView();\n    this.rebuildTournaments();\n    this.scheduleMarkets();\n    this.scheduleSync();\n\n    if (this.eventsReady) {\n      const bucketCounts = {};\n      for (const [name,map] of this.eventMaps) bucketCounts[name] = map.size;\n      const categoryCounts={};\n      for (const row of this.events.values()) {\n        const category=String(row.value?.categoryName || 'Unknown');\n        categoryCounts[category]=(categoryCounts[category] || 0) + 1;\n      }\n      const samples=[...this.events.values()].slice(0,12).map(row=>({\n        id:String(row.value?.id || ''),\n        category:String(row.value?.categoryName || ''),\n        categoryId:String(row.value?.categoryId || ''),\n        tournament:String(row.value?.tournamentName || ''),\n        tournamentId:String(row.value?.tournamentId || ''),\n        providerSport:String(row.value?.providerSport || row.value?.sport || ''),\n        categoryIconUrl:String(row.value?.categoryIconUrl || ''),\n        tournamentIconUrl:String(row.value?.tournamentIconUrl || ''),\n        teams:(row.value?.competitors || []).slice(0,2).map(team=>({id:String(team?.id || ''),name:team.name,icon:team?.icon?.url || ''})),\n        rawKeys:Object.keys(row.value || {}).slice(0,40)\n      }));\n      this.report('events-ready', {\n        message:JSON.stringify({total:this.events.size,bucketCounts,categoryCounts,samples}).slice(0,3000)\n      });\n    }\n  }\n\n  setView(sport,stage) {\n    const previousSport=this.sport;\n    if (sport === this.sport && stage === this.stage) {\n      return;\n    }\n\n    this.saveView();\n    this.sport = sport;\n    this.stage = stage;\n    this.restoreView();\n\n    this.markets.clear();\n    this.marketMaps.clear();\n    this.marketSignature = '';\n    this.marketsReady = false;\n    this.eventBucketSignature = '';\n    this.state = this.ready ? 'connected' : 'connecting';\n\n    if (this.ready) {\n      if (previousSport === 'CS' && sport === 'CS') {\n        this.marketSignature='';\n        this.scheduleMarkets();\n      } else {\n        this.subscribeEvents(true);\n      }\n    }\n    this.notify();\n  }\n\n  watch(ids) {\n    const next = [...new Set((ids || []).map(String))].sort();\n    if (canonical(next) === canonical(this.selectedIds)) return;\n    this.selectedIds = next;\n    if (this.ready) {\n      this.subscribeWatched();\n      this.scheduleMarkets();\n    }\n  }\n\n  subscribeWatched() {\n    this.watched.clear();\n    this.cancel('watched');\n    if (this.selectedIds.length) this.subscribe('watched','GetRichEventsByIds',[this.selectedIds],this.watched);\n  }\n\n  scheduleMarkets() {\n    clearTimeout(this.marketTimer);\n    this.marketTimer = setTimeout(() => this.subscribeMarkets(),120);\n  }\n\n  subscribeMarkets() {\n    if (!this.ready) return;\n    const visibleIds=[...this.events]\n      .filter(([,row]) => this.stage === 'live' ? Number(row.value?.stage) === 2 : Number(row.value?.stage) === 1)\n      .map(([id]) => id);\n    const ids = [...new Set([...visibleIds,...this.selectedIds])].sort();\n    const signature = canonical(ids);\n    if (signature === this.marketSignature) return;\n    this.marketSignature = signature;\n\n    this.cancelPrefix('markets:');\n    this.marketMaps.clear();\n    this.markets.clear();\n    this.marketsReady = ids.length === 0;\n\n    const chunks = [];\n    for (let i=0;i<ids.length;i+=MARKET_CHUNK) chunks.push(ids.slice(i,i+MARKET_CHUNK));\n\n    chunks.forEach((chunk,index) => {\n      const name='markets:'+index;\n      const map=new Map();\n      this.marketMaps.set(name,map);\n      this.subscribe(name,'GetMarketsByEventIds',[chunk,null],map);\n    });\n\n    if (!chunks.length) this.notify();\n  }\n\n  rebuildMarkets() {\n    const combined=new Map();\n    for (const map of this.marketMaps.values()) for (const [id,row] of map) combined.set(id,row);\n    this.markets=combined;\n\n    const marketSubs=[...this.subscriptions.values()].filter(s => s.name.startsWith('markets:'));\n    this.marketsReady=marketSubs.length===0 || marketSubs.every(s => s.initial && !s.error);\n  }\n\n  rebuildTournaments() {\n    const tournaments=new Map();\n    for (const row of this.events.values()) {\n      const event=row.value;\n      if (!event?.tournamentId) continue;\n      const key=String(event.tournamentId);\n      const old=tournaments.get(key);\n      if (!old) {\n        tournaments.set(key,{\n          id:key,\n          name:event.tournamentName || '',\n          categoryName:event.categoryName || '',\n          sport:event.sport || this.sport,\n          eventIds:[String(event.id)]\n        });\n      } else old.eventIds.push(String(event.id));\n    }\n    this.tournaments=tournaments;\n  }\n\n  scheduleSync() {\n    clearTimeout(this.syncTimer);\n    this.syncTimer=setTimeout(() => this.pushSync(),1200);\n  }\n\n  async pushSync() {\n    const rows=[...new Map([...this.events,...this.watched]).entries()]\n      .map(([id,row]) => compactEvent(row,id))\n      .filter(Boolean)\n      .slice(0,MAX_SYNC_EVENTS);\n    if (!rows.length) return;\n\n    const revision=++this.syncRevision;\n    const batchSize=35;\n    const batches=[];\n    for(let i=0;i<rows.length;i+=batchSize) batches.push(rows.slice(i,i+batchSize));\n\n    let accepted=0;\n    for(let index=0; index<batches.length; index++){\n      const batch=batches[index];\n      try{\n        const response=await fetch('/api/sync/events',{\n          method:'POST',\n          headers:{'content-type':'application/json'},\n          body:JSON.stringify({\n            revision,\n            batch:index+1,\n            batches:batches.length,\n            source:this.connectedUrl || this.currentUrl || '',\n            sport:this.sport,\n            stage:this.sport === 'CS' ? 'all' : this.stage,\n            rows:batch\n          }),\n          cache:'no-store'\n        });\n        if(!response.ok) throw new Error('sync HTTP '+response.status);\n        const value=await response.json().catch(()=>({}));\n        accepted+=Number(value?.accepted || batch.length);\n      }catch(error){\n        this.report('events-sync-error',{\n          message:JSON.stringify({\n            revision,\n            batch:index+1,\n            batches:batches.length,\n            rows:batch.length,\n            error:String(error?.message || error)\n          }).slice(0,1000)\n        });\n        return;\n      }\n    }\n\n    this.report('events-synced',{\n      message:JSON.stringify({\n        revision,\n        rows:accepted,\n        batches:batches.length\n      })\n    });\n  }\n\n  get fresh() {\n    return this.ready &&\n      this.state === 'connected' &&\n      this.eventsReady &&\n      this.marketsReady &&\n      Date.now() - this.lastMessage < 45_000;\n  }\n\n  event(id) {\n    return this.events.get(String(id))?.value || this.watched.get(String(id))?.value;\n  }\n\n  selections(eventId) {\n    const event=this.event(eventId);\n    if (!event) return [];\n    return [...this.markets.values()]\n      .filter(row => String(row.key?.eventId) === String(eventId))\n      .sort((a,b) =>\n        Number(a.key?.period || 0)-Number(b.key?.period || 0) ||\n        Number(a.value?.sortOrder || 0)-Number(b.value?.sortOrder || 0))\n      .flatMap(row => marketSelections(row,event));\n  }\n\n  quote(id) {\n    for (const row of this.markets.values()) {\n      const event=this.event(row.key?.eventId);\n      if (!event) continue;\n      const result=marketSelections(row,event).find(selection => selection.id === id);\n      if (result) return result;\n    }\n    return null;\n  }\n\n  close() {\n    this.stopped=true;\n    clearTimeout(this.retry);\n    clearTimeout(this.timeout);\n    clearTimeout(this.catalogTimer);\n    clearTimeout(this.marketTimer);\n    clearTimeout(this.syncTimer);\n    clearInterval(this.heartbeat);\n    try { this.socket?.close(); } catch {}\n  }\n}\n";
const emblemModule = "const escape = value => String(value ?? '').replace(/[&<>\"']/g, c => ({\n  '&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'\n}[c]));\n\nexport function emblemCandidates(team) {\n  const id = String(team?.id ?? '').trim();\n  const name = String(team?.name || '').trim();\n  const category = String(team?.categoryName || '').trim();\n  const source = String(team?.icon?.url || team?.iconUrl || '').trim();\n  const numericId=/^[0-9]{1,16}$/.test(id);\n  if (!numericId && !name) return [];\n\n  const base='/api/media/team?' +\n    (numericId ? 'id=' + encodeURIComponent(id) + '&' : '') +\n    'name=' + encodeURIComponent(name) +\n    '&category=' + encodeURIComponent(category) +\n    '&source=' + encodeURIComponent(source);\n  const urls=numericId\n    ? [base + '&prefer=parik',base + '&prefer=parik-alt',base + '&prefer=bo3']\n    : [base + '&prefer=bo3'];\n  const failed=globalThis.window?.__arenaFailedLogoSources;\n  return urls.filter(url => !failed || !failed.has(url));\n}\n\nexport function emblemURL(team) {\n  return emblemCandidates(team)[0] || null;\n}\n\nexport function teamEmblem(team) {\n  const urls = emblemCandidates(team);\n  const initials = String(team?.name || '')\n    .trim()\n    .split(/\\s+/)\n    .slice(0,2)\n    .map(word => Array.from(word)[0] || '')\n    .join('')\n    .toUpperCase() || '—';\n\n  const rawEntityKey=String(team?.id || (String(team?.categoryName || '') + ':' + String(team?.name || '')) || '');\n  const entityKey='team:' + rawEntityKey;\n  const entity=globalThis.window?.__arenaEntityLogoCache?.get(entityKey);\n  const logoCache=globalThis.window?.__arenaLogoCache;\n  const cachedSource = logoCache ? urls.find(url => logoCache.has(url)) : '';\n  const ordered = cachedSource ? [cachedSource, ...urls.filter(url => url !== cachedSource)] : urls;\n  const primarySource = entity?.source || ordered[0] || '';\n  const fallbacks = ordered.filter(url => url && url !== primarySource);\n  const primary = entity?.src ||\n    (globalThis.window?.__arenaStableLogoSrc ? window.__arenaStableLogoSrc(primarySource) : primarySource);\n  const sourceIsCached = !!(cachedSource && logoCache?.has(cachedSource));\n  const logoState = entity?.src || sourceIsCached ? 'ready' : primary ? 'loading' : 'failed';\n  const image = primary\n    ? `<img class=\"team-logo\" src=\"${escape(primary)}\" data-arena-source=\"${escape(primarySource)}\" data-entity-kind=\"team\" data-entity-key=\"${escape(rawEntityKey)}\" data-entity-name=\"${escape(String(team?.name || ''))}\" data-category=\"${escape(String(team?.categoryName || ''))}\" data-fallbacks=\"${escape(JSON.stringify(fallbacks))}\" data-fallback-index=\"0\" alt=\"\" loading=\"lazy\" decoding=\"async\" referrerpolicy=\"no-referrer\" onload=\"window.__arenaNormalizeLogo&&window.__arenaNormalizeLogo(this)\" onerror=\"window.__arenaFailLogo?window.__arenaFailLogo(this):(this.hidden=true)\">`\n    : '';\n\n  return `<span class=\"team-emblem-picture\" data-logo-state=\"${logoState}\">${image}<span class=\"team-emblem-fallback\" title=\"${escape(team?.name)}\">${escape(initials)}</span></span>`;\n}\n";
const accountModule = "import { settleSelection, settledBetTotals } from './settlement.mjs';\nexport const INITIAL_BALANCE = 13459900;\nexport const EMAIL = 'hoolop22@gmail.com';\nconst KEY = 'arena-accounts-v1';\nconst SESSION = 'arena-session-v1';\nconst HASH = 'ed2d59a0e72ca1446a5a9f29e8901b59ed32cb779132055220400527ca2531bc';\nconst PROFILE_API = '/api/profile';\nconst clone = value => typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));\nconst accountStamp = account => {\n  account.updatedAt = new Date().toISOString();\n  account.profileRevision = Math.max(0, Number(account.profileRevision || 0)) + 1;\n  return account;\n};\nfunction authHeaders(account) {\n  return {\n    'content-type':'application/json',\n    'authorization':'Bearer ' + String(account?.hash || '')\n  };\n}\nexport const money = value => new Intl.NumberFormat('ru-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value / 100);\nexport function cents(value) {\n  if (!/^\\d{1,9}([.,]\\d{1,2})?$/.test(String(value).trim())) throw new Error('Укажите сумму с точностью до копеек');\n  const result = Math.round(Number(String(value).replace(',', '.')) * 100);\n  if (result <= 0 || !Number.isSafeInteger(result)) throw new Error('Сумма должна быть больше нуля');\n  return result;\n}\nexport async function digest(password) {\n  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));\n  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');\n}\nexport function betTotals(stake, selections, type = 'single', systemSize = 2) {\n  if (!Array.isArray(selections) || !selections.length || selections.length > 10) throw new Error('Добавьте исход в купон');\n  const size = type === 'single' ? 1 : type === 'express' ? selections.length : systemSize;\n  if (!['single', 'express', 'system'].includes(type) || !Number.isInteger(size) || size < 1 || size > selections.length) throw new Error('Проверьте тип купона');\n  if (type === 'express' && selections.length < 2) throw new Error('Добавьте минимум два исхода');\n  if (type === 'system' && (selections.length < 3 || size < 2 || size >= selections.length)) throw new Error('Для системы добавьте минимум три исхода');\n  if (new Set(selections.map(s => s.id)).size !== selections.length) throw new Error('В купоне повторяется исход');\n  if (type !== 'single' && new Set(selections.map(s => s.eventId)).size !== selections.length) throw new Error('В экспрессе или системе нельзя выбрать два исхода одного матча');\n  const combinations = [];\n  function choose(start, remaining, factor) {\n    if (!remaining) { combinations.push(factor); return; }\n    for (let i = start; i <= selections.length - remaining; i++) choose(i + 1, remaining - 1, factor * selections[i].odds);\n  }\n  choose(0, size, 1);\n  const cost = stake * combinations.length;\n  const potential = combinations.reduce((sum, odds) => sum + Math.round(stake * odds), 0);\n  if (!Number.isSafeInteger(cost) || !Number.isSafeInteger(potential)) throw new Error('Слишком большая сумма купона');\n  return { cost, potential, odds: potential / cost, combinations: combinations.length };\n}\n// Device-local simulation only; no authorization or transactions at Parik24.\nexport class Accounts {\n  constructor(storage) {\n    this.storage = storage;\n    this.syncChain = Promise.resolve();\n  }\n  _write(data) {\n    this.storage.setItem(KEY, JSON.stringify(data));\n  }\n  _replaceLocal(profile) {\n    if (!profile?.email) return null;\n    const data = this.read();\n    const index = data.findIndex(account => account.email === profile.email);\n    if (index >= 0) data[index] = clone(profile);\n    else data.push(clone(profile));\n    this._write(data);\n    return data[index >= 0 ? index : data.length - 1];\n  }\n  _queueSync(account) {\n    if (!account?.email || !account?.hash) return;\n    const snapshot = clone(account);\n    this.syncChain = this.syncChain.catch(() => {}).then(async () => {\n      const response = await fetch(PROFILE_API + '/sync', {\n        method:'POST',\n        headers:authHeaders(snapshot),\n        body:JSON.stringify({ profile:snapshot }),\n        keepalive:true\n      });\n      if (response.status === 409) {\n        const value = await response.json().catch(() => null);\n        if (value?.profile) this._replaceLocal(value.profile);\n        return;\n      }\n      if (!response.ok) return;\n      const value = await response.json().catch(() => null);\n      if (value?.profile) this._replaceLocal(value.profile);\n    });\n  }\n  _persist(data, account) {\n    if (account) accountStamp(account);\n    this._write(data);\n    if (account) this._queueSync(account);\n  }\n  async syncCurrentFromServer() {\n    const local = this.current();\n    if (!local?.email || !local?.hash) return local;\n    try {\n      const response = await fetch(PROFILE_API + '?email=' + encodeURIComponent(local.email), {\n        headers:{ authorization:'Bearer ' + local.hash },\n        cache:'no-store'\n      });\n      if (response.status === 404) {\n        this._queueSync(local);\n        return local;\n      }\n      if (!response.ok) return local;\n      const value = await response.json();\n      const remote = value?.profile;\n      if (!remote) return local;\n      const remoteRevision = Number(remote.profileRevision || 0);\n      const localRevision = Number(local.profileRevision || 0);\n      const remoteTime = Date.parse(remote.updatedAt || 0) || 0;\n      const localTime = Date.parse(local.updatedAt || 0) || 0;\n      if (remoteRevision > localRevision || (remoteRevision === localRevision && remoteTime >= localTime)) {\n        return this._replaceLocal(remote);\n      }\n      this._queueSync(local);\n      return local;\n    } catch {\n      return local;\n    }\n  }\n  read() {\n    const raw = this.storage.getItem(KEY);\n    if (raw) {\n      const data = JSON.parse(raw);\n      if (!Array.isArray(data) || data.some(a => !a.email || !Number.isSafeInteger(a.balance) || a.balance < 0 || !Array.isArray(a.payments))) throw new Error('Не удалось прочитать данные профиля');\n      data.forEach(a => { if (!Array.isArray(a.bets)) a.bets = []; });\n      return data;\n    }\n    let balance = INITIAL_BALANCE;\n    try {\n      const legacy = JSON.parse(this.storage.getItem('line-demo-profile-v1'));\n      if (legacy && Number.isSafeInteger(legacy.balance) && legacy.balance >= 0) balance = legacy.balance;\n    } catch { /* Ignore obsolete prototype data. */ }\n    const data = [{ id: 'AL100001', email: EMAIL, firstName: 'Роман', lastName: 'Тополя', hash: HASH, balance, payments: [], bets: [] }];\n    this._write(data);\n    return data;\n  }\n  current() {\n    const email = this.storage.getItem(SESSION);\n    return email ? this.read().find(a => a.email === email) || null : null;\n  }\n  async signIn(email, password) {\n    email = email.trim().toLowerCase();\n    const hash = await digest(password);\n    let account = this.read().find(a => a.email === email && a.hash === hash) || null;\n    try {\n      const response = await fetch(PROFILE_API + '/login', {\n        method:'POST',\n        headers:{'content-type':'application/json'},\n        body:JSON.stringify({email,hash}),\n        cache:'no-store'\n      });\n      if (response.ok) {\n        const value = await response.json();\n        if (value?.profile) account = this._replaceLocal(value.profile);\n      } else if (response.status === 401) {\n        throw new Error('Неверная почта или пароль');\n      } else if (response.status === 404 && account) {\n        this._queueSync(account);\n      }\n    } catch (error) {\n      if (error?.message === 'Неверная почта или пароль') throw error;\n    }\n    if (!account) throw new Error('Неверная почта или пароль');\n    this.storage.setItem(SESSION, account.email);\n    this.syncCurrentFromServer().catch(() => {});\n    return account;\n  }\n  async signUp({ email, password, firstName, lastName }) {\n    email = email.trim().toLowerCase(); firstName = firstName.trim(); lastName = lastName.trim();\n    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) throw new Error('Проверьте адрес почты');\n    if (password.length < 8) throw new Error('Пароль должен содержать минимум 8 символов');\n    if (!firstName || !lastName || firstName.length > 80 || lastName.length > 80) throw new Error('Укажите имя и фамилию');\n    const hash = await digest(password), data = this.read();\n    if (data.some(a => a.email === email)) throw new Error('Этот аккаунт уже создан. Войдите по почте и паролю.');\n\n    try {\n      const response = await fetch(PROFILE_API + '/login', {\n        method:'POST',\n        headers:{'content-type':'application/json'},\n        body:JSON.stringify({email,hash}),\n        cache:'no-store'\n      });\n      if (response.status === 401 || response.ok) {\n        throw new Error('Этот аккаунт уже создан. Войдите по почте и паролю.');\n      }\n    } catch (error) {\n      if (error?.message === 'Этот аккаунт уже создан. Войдите по почте и паролю.') throw error;\n    }\n\n    const account = { id: crypto.randomUUID().slice(0, 8).toUpperCase(), email, firstName, lastName, hash, balance: 0, payments: [], bets: [], profileRevision:0, updatedAt:new Date().toISOString() };\n    data.push(account);\n    this._persist(data, account);\n    this.storage.setItem(SESSION, email);\n  }\n  signOut() { this.storage.removeItem(SESSION); }\n  placeBet({ id, stake, selections, type = 'single', systemSize = 2 }) {\n    const data = this.read(), account = data.find(a => a.email === this.storage.getItem(SESSION));\n    if (!account) throw new Error('Сначала войдите в аккаунт');\n    if (!id || typeof id !== 'string') throw new Error('Не удалось создать купон');\n    const existing = account.bets.find(b => b.id === id);\n    if (existing) return existing;\n    if (!Number.isSafeInteger(stake) || stake < 2000) throw new Error('Минимальная сумма ставки 20 €');\n    if (!Array.isArray(selections) || !selections.length) throw new Error('Проверьте купон');\n    if (selections.some(s => !s.id || !s.eventId || !s.eventName || !s.label || !Number.isFinite(s.odds) || s.odds <= 1 || s.odds > 10000)) throw new Error('Коэффициент недоступен');\n    const totals = betTotals(stake, selections, type, systemSize);\n    if (totals.cost > account.balance) throw new Error('Недостаточно средств');\n    this.ensureBetNumbers(account);\n    const bet = { id, number:this.nextBetNumber(account), type, stake, systemSize, ...totals, status: 'open', date: new Date().toISOString(), selections: structuredClone(selections) };\n    account.balance -= totals.cost;\n    account.bets.unshift(bet);\n    this._persist(data, account);\n    return bet;\n  }\n  duplicateBet(id) {\n    const data = this.read();\n    const account = data.find(a => a.email === this.storage.getItem(SESSION));\n    if (!account) throw new Error('Сначала войдите в аккаунт');\n    this.ensureBetNumbers(account);\n    const source = account.bets.find(item => item.id === id);\n    if (!source) throw new Error('Ставка не найдена');\n\n    const duplicate = clone(source);\n    const duplicateId = crypto.randomUUID();\n    const cost = Number.isSafeInteger(Number(source.cost))\n      ? Number(source.cost)\n      : betTotals(Number(source.stake || 0), source.selections || [], source.type, source.systemSize).cost;\n    const payout = source.status === 'open' ? 0 : Math.max(0, Number(source.payout || 0));\n    const nextBalance = account.balance - cost + payout;\n    if (!Number.isSafeInteger(nextBalance) || nextBalance < 0) {\n      throw new Error('Недостаточно средств для дублирования ставки');\n    }\n\n    duplicate.id = duplicateId;\n    duplicate.number = this.nextBetNumber(account);\n    duplicate.hidden = false;\n    delete duplicate.hiddenNumber;\n    duplicate.duplicatedFrom = source.id;\n    duplicate.duplicatedAt = new Date().toISOString();\n\n    account.balance = nextBalance;\n    account.bets.unshift(duplicate);\n\n    if (payout > 0 && duplicate.status !== 'open') {\n      account.payments.unshift({\n        id:'bet:' + duplicateId,\n        type:duplicate.status === 'cashout' ? 'bet-cashout' : 'bet-payout',\n        amount:payout,\n        betId:duplicateId,\n        date:duplicate.settledAt || duplicate.duplicatedAt\n      });\n    }\n\n    this._persist(data, account);\n    return duplicate;\n  }\n\n  hideBet(id) {\n    const data = this.read(), account = data.find(a => a.email === this.storage.getItem(SESSION));\n    if (!account) return false;\n    this.ensureBetNumbers(account);\n    const bet = account.bets.find(b => b.id === id);\n    if (!bet || bet.hidden) return false;\n    // Hidden records keep their financial/settlement history, but no longer reserve an active bet number.\n    const releasedNumber = Number(bet.number);\n    if (Number.isSafeInteger(releasedNumber)) bet.hiddenNumber = releasedNumber;\n    bet.hidden = true;\n    delete bet.number;\n    this.ensureBetNumbers(account, releasedNumber);\n    this._persist(data, account);\n    return true;\n  }\n  settleBets(results) {\n    const data = this.read(), account = data.find(a => a.email === this.storage.getItem(SESSION));\n    if (!account) return { changed:false, settled:[] };\n    const settled = []; let changed = false;\n    for (const bet of account.bets) {\n      if (bet.status !== 'open') continue;\n      for (const selection of bet.selections) {\n        if (selection.settlement) continue;\n        if (selection.manualOutcomeEdit) continue;\n        const confirmed = results.get(String(selection.eventId));\n        const result = settleSelection(selection, confirmed);\n        if (result) {\n          selection.settlement = { ...result, date:new Date().toISOString() };\n          selection.sport ||= confirmed.sport; selection.categoryName ||= confirmed.categoryName;\n          if (!selection.startTime && Number.isFinite(Date.parse(confirmed.startTime))) selection.startTime = Date.parse(confirmed.startTime) / 1000;\n          if (!selection.competitors?.length && confirmed.competitors?.length) selection.competitors = confirmed.competitors.map(name => ({ name }));\n          changed = true;\n        }\n      }\n      const totals = settledBetTotals(bet);\n      if (!totals) continue;\n      if (!Number.isSafeInteger(account.balance + totals.payout)) throw new Error('Не вдалося зарахувати виплату');\n      Object.assign(bet, totals, { settledAt:new Date().toISOString() });\n      account.balance += totals.payout;\n      account.payments.unshift({ id:`bet:${bet.id}`, type:'bet-payout', amount:totals.payout, betId:bet.id, date:bet.settledAt });\n      settled.push(bet.id); changed = true;\n    }\n    // One atomic storage write records both the final status and its balance credit.\n    if (changed) this._persist(data, account);\n    return { changed, settled };\n  }\n  transfer(type, amount) {\n    if (!['deposit', 'withdraw'].includes(type) || !Number.isSafeInteger(amount) || amount <= 0) throw new Error('Некорректная операция');\n    const data = this.read(), account = data.find(a => a.email === this.storage.getItem(SESSION));\n    if (!account) throw new Error('Сначала войдите в аккаунт');\n    if (type === 'withdraw' && amount > account.balance) throw new Error('Недостаточно средств');\n    const balance = account.balance + (type === 'deposit' ? amount : -amount);\n    if (!Number.isSafeInteger(balance) || balance > 99999999999) throw new Error('Превышен лимит виртуального баланса');\n    account.balance = balance;\n    account.payments.unshift({ id: crypto.randomUUID(), type, amount, date: new Date().toISOString() });\n    this._persist(data, account);\n  }\n  ensureBetNumbers(account, releasedNumber = null) {\n    const all = Array.isArray(account?.bets) ? account.bets : [];\n    for (const hidden of all.filter(bet => bet.hidden)) {\n      const number = Number(hidden.number);\n      if (Number.isSafeInteger(number) && !Number.isSafeInteger(Number(hidden.hiddenNumber))) hidden.hiddenNumber = number;\n      delete hidden.number;\n    }\n\n    const ordered = all\n      .filter(bet => !bet.hidden)\n      .sort((a,b) => new Date(a.date || 0) - new Date(b.date || 0));\n    if (!ordered.length) return;\n\n    const numbers = ordered.map(bet => Number(bet.number));\n    const finite = numbers.filter(number => Number.isSafeInteger(number) && number >= 1);\n    const released = releasedNumber == null || releasedNumber === '' ? null : Number(releasedNumber);\n    const firstCandidates = [...finite, ...(Number.isSafeInteger(released) && released >= 1 ? [released] : [])];\n    const first = firstCandidates.length ? Math.min(...firstCandidates) : 1;\n\n    const valid = numbers.every(number => Number.isSafeInteger(number)) &&\n      new Set(numbers).size === numbers.length &&\n      numbers.every((number,index) => number === first + index);\n    if (valid) return;\n\n    ordered.forEach((bet,index) => { bet.number = first + index; });\n  }\n  nextBetNumber(account) {\n    this.ensureBetNumbers(account);\n    const visible = (account?.bets || []).filter(bet => !bet.hidden);\n    const numbers = visible.map(bet => Number(bet.number)).filter(number => Number.isSafeInteger(number) && number >= 1);\n    if (numbers.length) return Math.max(...numbers) + 1;\n    const released = (account?.bets || [])\n      .filter(bet => bet.hidden)\n      .map(bet => Number(bet.hiddenNumber))\n      .filter(number => Number.isSafeInteger(number) && number >= 1);\n    return released.length ? Math.max(...released) : 1;\n  }\n  editBet(id, changes = {}) {\n    const data = this.read();\n    const account = data.find(a => a.email === this.storage.getItem(SESSION));\n    if (!account) throw new Error('Сначала войдите в аккаунт');\n    this.ensureBetNumbers(account);\n    const bet = account.bets.find(item => item.id === id);\n    if (!bet) throw new Error('Ставка не найдена');\n\n    const oldCost = Number(bet.cost || 0);\n    const oldPayout = Number(bet.payout || 0);\n    const oldNumber = Number(bet.number || 1);\n    const nextDateValue = changes.date == null ? String(bet.date || '') : String(changes.date || '');\n    const nextDate = new Date(nextDateValue);\n    if (!Number.isFinite(nextDate.getTime())) throw new Error('Некорректное время ставки');\n    const nextStake = changes.stake == null ? Number(bet.stake) : Number(changes.stake);\n    if (!Number.isSafeInteger(nextStake) || nextStake <= 0) throw new Error('Некорректная сумма ставки');\n\n    const selections = clone(bet.selections || []);\n    if (!selections.length) throw new Error('У ставки нет исходов');\n\n    const teamNames = selection => (selection.competitors || [])\n      .map(team => typeof team === 'string' ? team : team?.name)\n      .filter(Boolean);\n\n    const normalized = value => String(value || '').trim().toLowerCase();\n\n    const chosenSide = selection => {\n      if (selection.outcomeType === 0) return 0;\n      if (selection.outcomeType === 3) return 1;\n      if (/^П1$/i.test(selection.shortLabel || '')) return 0;\n      if (/^П2$/i.test(selection.shortLabel || '')) return 1;\n\n      const teams = teamNames(selection);\n      const label = normalized(selection.label);\n      if (teams[0] && label === normalized(teams[0])) return 0;\n      if (teams[1] && label === normalized(teams[1])) return 1;\n\n      try {\n        const parsed = JSON.parse(decodeURIComponent(selection.id));\n        const type = Number(parsed?.[2]?.type);\n        if (type === 0) return 0;\n        if (type === 3) return 1;\n      } catch {}\n\n      return null;\n    };\n\n    const makeScore = (a,b,index) => {\n      const score = [a,b].map(value => value === '' || value == null ? null : Number(value));\n      if (score.some(value => value != null && (!Number.isInteger(value) || value < 0 || value > 999))) {\n        throw new Error(`Некорректный счёт матча #${index + 1}`);\n      }\n      return score;\n    };\n\n    const exactScoreFromLabel = value => {\n      const match = String(value || '').match(/(?:^|\\s)(\\d{1,2})\\s*[:\\-]\\s*(\\d{1,2})(?:$|\\s)/);\n      if (!match) return null;\n      return [Number(match[1]),Number(match[2])];\n    };\n\n    if (Array.isArray(changes.odds)) {\n      changes.odds.forEach((odd,index) => {\n        if (odd == null || !selections[index]) return;\n        odd = Number(odd);\n        if (!Number.isFinite(odd) || odd <= 1 || odd > 10000) throw new Error('Некорректный коэффициент');\n        selections[index].odds = odd;\n      });\n    } else if (changes.odds != null && selections.length === 1) {\n      const odd = Number(changes.odds);\n      if (!Number.isFinite(odd) || odd <= 1 || odd > 10000) throw new Error('Некорректный коэффициент');\n      selections[0].odds = odd;\n    }\n\n    const selectionEdits = Array.isArray(changes.selectionEdits) ? changes.selectionEdits : null;\n\n    if (selectionEdits) {\n      selections.forEach((selection,index) => {\n        const edit = selectionEdits[index];\n        if (!edit) return;\n\n        if (edit.odds != null) {\n          const odd = Number(edit.odds);\n          if (!Number.isFinite(odd) || odd <= 1 || odd > 10000) {\n            throw new Error(`Некорректный коэффициент матча #${index + 1}`);\n          }\n          selection.odds = odd;\n        }\n\n        const lineSelection = edit.lineSelection && typeof edit.lineSelection === 'object' ? edit.lineSelection : null;\n        if (lineSelection && String(lineSelection.eventId || selection.eventId || '') !== String(selection.eventId || '')) {\n          throw new Error(`Некорректний вибір матча #${index + 1}`);\n        }\n        const nextMarketName = lineSelection ? String(lineSelection.marketName || '').trim() : edit.marketName == null ? String(selection.marketName || '') : String(edit.marketName).trim();\n        const nextLabel = lineSelection ? String(lineSelection.label || '').trim() : edit.label == null ? String(selection.label || '') : String(edit.label).trim();\n        if (!nextMarketName || nextMarketName.length > 180) {\n          throw new Error(`Некорректний ринок матча #${index + 1}`);\n        }\n        if (!nextLabel || nextLabel.length > 180) {\n          throw new Error(`Некорректний вибір матча #${index + 1}`);\n        }\n\n        const marketChanged = nextMarketName !== String(selection.marketName || '');\n        const labelChanged = nextLabel !== String(selection.label || '');\n        const lineIdChanged = !!lineSelection?.id && String(lineSelection.id) !== String(selection.id || '');\n\n        if (marketChanged || labelChanged || lineIdChanged) {\n          if (!selection.manualOriginalOutcome) {\n            selection.manualOriginalOutcome = {\n              id:selection.id,\n              marketName:selection.marketName,\n              label:selection.label,\n              shortLabel:selection.shortLabel,\n              outcomeType:selection.outcomeType,\n              odds:selection.odds\n            };\n          }\n\n          selection.marketName = nextMarketName;\n          selection.label = nextLabel;\n          if (lineSelection) {\n            selection.id = String(lineSelection.id || selection.id || '');\n            selection.shortLabel = String(lineSelection.shortLabel || nextLabel);\n            if (lineSelection.outcomeType == null) delete selection.outcomeType;\n            else selection.outcomeType = Number(lineSelection.outcomeType);\n            selection.outcomeValues = Array.isArray(lineSelection.outcomeValues) ? clone(lineSelection.outcomeValues) : [];\n            if (lineSelection.resultKind == null) delete selection.resultKind;\n            else selection.resultKind = Number(lineSelection.resultKind);\n            if (lineSelection.marketType == null) delete selection.marketType;\n            else selection.marketType = Number(lineSelection.marketType);\n            if (lineSelection.period == null) delete selection.period;\n            else selection.period = Number(lineSelection.period);\n            selection.parameters = Array.isArray(lineSelection.parameters) ? clone(lineSelection.parameters) : [];\n            if (lineSelection.version == null) delete selection.version;\n            else selection.version = Number(lineSelection.version);\n            if (lineSelection.stage != null) selection.stage = Number(lineSelection.stage);\n            selection.frozen = !!lineSelection.frozen;\n          } else {\n            selection.shortLabel = nextLabel;\n          }\n          selection.manualOutcomeEdit = true;\n          selection.manualOutcomeEditedAt = new Date().toISOString();\n\n          if (!lineSelection) {\n            const teams = teamNames(selection);\n            const normalizedLabel = normalized(nextLabel);\n            if (/^(?:п1|p1)$/i.test(nextLabel) || (teams[0] && normalized(teams[0]) === normalizedLabel)) {\n              selection.outcomeType = 0;\n            } else if (/^(?:п2|p2)$/i.test(nextLabel) || (teams[1] && normalized(teams[1]) === normalizedLabel)) {\n              selection.outcomeType = 3;\n            } else {\n              delete selection.outcomeType;\n            }\n          }\n\n          delete selection.settlement;\n        } else {\n          selection.marketName = nextMarketName;\n          selection.label = nextLabel;\n        }\n\n        const state = String(edit.state || 'open');\n        const score = makeScore(edit.score1,edit.score2,index);\n        const previousSettlement = selection.settlement ? {...selection.settlement} : {};\n\n        if (state === 'open') {\n          delete selection.settlement;\n          return;\n        }\n\n        if (state === 'void') {\n          selection.settlement = {\n            ...previousSettlement,\n            status:'void',\n            factor:1,\n            manual:true,\n            date:new Date().toISOString(),\n            ...(score.every(value => value != null) ? {score,periods:[]} : {})\n          };\n          return;\n        }\n\n        if (state === 'score') {\n          if (!score.every(value => value != null)) {\n            throw new Error(`Вкажіть фактичний рахунок матча #${index + 1}`);\n          }\n          const selectedScore = exactScoreFromLabel(selection.label);\n          if (!selectedScore) {\n            throw new Error(`Для розрахунку за рахунком вибір матча #${index + 1} повинен містити рахунок, наприклад 3:2`);\n          }\n          const won = selectedScore[0] === score[0] && selectedScore[1] === score[1];\n          selection.settlement = {\n            ...previousSettlement,\n            status:won ? 'won' : 'lost',\n            factor:won ? selection.odds : 0,\n            manual:true,\n            manualScoreMarket:true,\n            date:new Date().toISOString(),\n            score,\n            periods:[]\n          };\n          return;\n        }\n\n        if (state === 'winner') {\n          const winnerIndex = Number(edit.winnerIndex);\n          if (winnerIndex !== 0 && winnerIndex !== 1) {\n            throw new Error(`Оберіть П1 або П2 як переможця матча #${index + 1}`);\n          }\n\n          const manualResultStatus = String(edit.manualResultStatus || '');\n          const requestedManualStatus = String(changes.status || '');\n          const manualChosenSide = Number(edit.manualChosenSide);\n          let won;\n          if (manualResultStatus === 'won' || manualResultStatus === 'lost') {\n            won = manualResultStatus === 'won';\n          } else if (requestedManualStatus === 'won' || requestedManualStatus === 'lost') {\n            won = requestedManualStatus === 'won';\n          } else {\n            const side = manualChosenSide === 0 || manualChosenSide === 1 ? manualChosenSide : chosenSide(selection);\n            if (side !== 0 && side !== 1) {\n              selection.manualActualResult = {\n                winnerIndex,\n                manual:true,\n                date:new Date().toISOString()\n              };\n              delete selection.settlement;\n              return;\n            }\n            won = side === winnerIndex;\n          }\n\n          selection.settlement = {\n            ...previousSettlement,\n            status:won ? 'won' : 'lost',\n            factor:won ? selection.odds : 0,\n            winnerIndex,\n            manual:true,\n            manualResultStatus:won ? 'won' : 'lost',\n            date:new Date().toISOString(),\n            ...(score.every(value => value != null) ? {score,periods:[]} : {})\n          };\n          return;\n        }\n\n        throw new Error(`Некорректний стан матча #${index + 1}`);\n      });\n    }\n\n    const totals = betTotals(nextStake, selections, bet.type, bet.systemSize);\n    const requestedStatus = String(changes.status || bet.status || 'open');\n    if (!['open','won','lost','void','cashout'].includes(requestedStatus)) throw new Error('Некорректный статус');\n\n    let effectiveStatus = requestedStatus;\n    let payout = 0;\n\n    if (selectionEdits && requestedStatus !== 'cashout') {\n      const derived = settledBetTotals({\n        ...bet,\n        stake:nextStake,\n        selections,\n        cost:totals.cost,\n        type:bet.type,\n        systemSize:bet.systemSize\n      });\n\n      if (derived) {\n        effectiveStatus = derived.status;\n        payout = derived.payout;\n      } else {\n        effectiveStatus = 'open';\n        payout = 0;\n      }\n    } else if (requestedStatus === 'cashout') {\n      payout = Number(changes.cashoutPayout ?? bet.payout ?? 0);\n      if (!Number.isSafeInteger(payout) || payout < 0) throw new Error('Некорректная сумма cash-out');\n    } else {\n      if (requestedStatus === 'won') payout = totals.potential;\n      if (requestedStatus === 'void') payout = totals.cost;\n    }\n\n    const nextBalance = account.balance + oldCost - totals.cost + payout - oldPayout;\n    if (!Number.isSafeInteger(nextBalance) || nextBalance < 0) throw new Error('Недостаточно средств для изменения ставки');\n\n    Object.assign(bet, {\n      date:nextDate.toISOString(),\n      stake:nextStake,\n      selections,\n      ...totals,\n      status:effectiveStatus,\n      payout,\n      manualEdit:true,\n      editedAt:new Date().toISOString()\n    });\n\n    if (effectiveStatus === 'open') {\n      delete bet.settledAt;\n      bet.payout = 0;\n    } else {\n      bet.settledAt = new Date().toISOString();\n    }\n\n    const requestedNumber = Number(changes.number);\n    if (!Number.isSafeInteger(requestedNumber) || requestedNumber < 1) throw new Error('Некорректный номер ставки');\n    if (requestedNumber !== oldNumber) {\n      const delta = requestedNumber - oldNumber;\n      const visibleBets = account.bets.filter(other => !other.hidden);\n      const shifted = visibleBets.map(other => Number(other.number) + delta);\n      if (shifted.some(number => !Number.isSafeInteger(number) || number < 1)) throw new Error('Некорректный номер ставки');\n      visibleBets.forEach((other,index) => { other.number = shifted[index]; });\n      account.bets.sort((a,b) => {\n        if (!!a.hidden !== !!b.hidden) return a.hidden ? 1 : -1;\n        if (!a.hidden) return Number(b.number || 0) - Number(a.number || 0);\n        return new Date(b.date || 0) - new Date(a.date || 0);\n      });\n    }\n\n    account.balance = nextBalance;\n    account.payments = account.payments.filter(payment => payment.id !== 'bet:' + bet.id);\n    if (payout > 0 && effectiveStatus !== 'open') {\n      account.payments.unshift({\n        id:'bet:' + bet.id,\n        type:effectiveStatus === 'cashout' ? 'bet-cashout' : 'bet-payout',\n        amount:payout,\n        betId:bet.id,\n        date:bet.settledAt\n      });\n    }\n\n    this._persist(data, account);\n    return bet;\n  }\n    async password(oldPassword, newPassword) {\n    if (newPassword.length < 8) throw new Error('Минимум 8 символов');\n    const oldHash = await digest(oldPassword), newHash = await digest(newPassword);\n    const data = this.read(), account = data.find(a => a.email === this.storage.getItem(SESSION));\n    if (!account || account.hash !== oldHash) throw new Error('Текущий пароль неверен');\n    try {\n      const response = await fetch(PROFILE_API + '/password', {\n        method:'POST',\n        headers:{'content-type':'application/json','authorization':'Bearer ' + oldHash},\n        body:JSON.stringify({email:account.email,newHash})\n      });\n      if (!response.ok && response.status !== 404) throw new Error('Не вдалося синхронізувати пароль');\n    } catch (error) {\n      if (error?.message === 'Не вдалося синхронізувати пароль') throw error;\n    }\n    account.hash = newHash;\n    this._persist(data, account);\n  }\n}\n";
const appModule = "import { Accounts, cents, money, betTotals } from './account.mjs';\nimport { SportsApp } from './sports.mjs';\nimport { icon, wordmark } from './ui.mjs';\nimport { betHistory, betDetail } from './bet-view.mjs';\nimport { openShareCoupon } from './share-coupon.mjs';\nimport { getLanguage, getLocale, setLanguage, startTranslations, t } from './i18n.mjs';\nimport { getTheme, setTheme, applyTheme } from './theme.mjs';\n\nconst $ = selector => document.querySelector(selector);\nconst esc = value => String(value).replace(/[&<>\"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' }[char]));\nconst refreshIcons = () => window.lucide?.createIcons();\nconst accounts = new Accounts({ getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value), removeItem: key => localStorage.removeItem(key) });\nconst dialog = $('#dialog');\nlet account = null;\nlet profileView = 'profile';\nlet betTab = 'open';\nlet selectedBetId = null;\nlet toastTimer;\nlet sports;\n\nfunction getAccount() {\n  try { return accounts.current(); }\n  catch { showToast('Разрешите хранение данных сайта в браузере'); return null; }\n}\nfunction showToast(message) {\n  clearTimeout(toastTimer);\n  $('#toast').textContent = message;\n  $('#toast').hidden = false;\n  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3500);\n}\nfunction syncFeedControls() {\n  account = getAccount();\n  sports?.updateAccount(account);\n  sports?.renderSlip();\n  if (account && !$('#profile-layer').hidden) renderProfile();\n  refreshIcons();\n}\nfunction row(name, label, action, value = '') {\n  return `<button class=\"row\" data-action=\"${action}\" data-value=\"${value}\">${icon(name)}<span>${label}</span>${icon('chevron-right', 'chevron')}</button>`;\n}\nfunction empty(name, heading, copy = '') {\n  return `<div class=\"empty\">${icon(name)}<h2>${heading}</h2>${copy ? `<p>${copy}</p>` : ''}</div>`;\n}\nfunction profileHeader() {\n  const titles = { personal:'Персональные данные', security:'Подтверждение аккаунта', payments:'История платежей', bets:'Мои ставки', wallet:'Баланс', menu:'Меню',settings:'Налаштування','settings-security':'Безпека','settings-notifications':'Налаштування сповіщень','settings-sport':'Налаштування спорту',feedback:'Залишити відгук',information:'Допомога та інформація',promotions:'Акції',hero:'HERO',bonuses:'Магазин бонусів',tournaments:'Турніри' };\n  const title = profileView === 'bets' ? null : titles[profileView];\n  $('#profile-header').innerHTML = `<div class=\"header-inner\">${title\n    ? `<button class=\"header-icon back\" data-action=\"profile-view\" data-value=\"profile\" aria-label=\"Назад\" title=\"Назад\">${icon('chevron-left')}</button><div class=\"page-title\">${title}</div><button class=\"header-icon\" data-action=\"help\" aria-label=\"Помощь\" title=\"Помощь\">${icon('headset')}</button>`\n    : `<button class=\"brand\" data-action=\"close-profile\" aria-label=\"Главная\">${wordmark}</button><div class=\"header-spacer\"></div><button class=\"header-icon\" data-action=\"profile-search\" aria-label=\"Поиск\">${icon('search')}</button><button class=\"header-icon\" data-action=\"notifications\" aria-label=\"Уведомления\">${icon('bell')}</button><button class=\"deposit-button\" data-action=\"deposit\">Пополнить</button>`}</div>`;\n}\nfunction profileNav() {\n  const items = [['house', 'Головна', 'close-profile', ''], ['sports-score', 'Спорт', 'close-profile', ''], ['ticket', 'Мої ставки', 'profile-view', 'bets'], ['casino-wheel', 'Казино', 'profile-casino', ''], ['profile-solid', `${new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 0 }).format(account.balance / 100)} €`, 'profile-view', 'profile'], ['menu', 'Меню', 'open-menu', 'menu']];\n  $('#profile-nav').innerHTML = `<div class=\"nav-inner\">${items.map(([name, label, action, value]) => `<button class=\"nav-item ${(profileView === value || value === 'profile' && ['personal', 'security', 'wallet', 'payments'].includes(profileView)) ? 'active' : ''}\" data-action=\"${action}\" data-value=\"${value}\">${icon(name)}<span>${esc(label)}</span></button>`).join('')}</div>`;\n}\nfunction balancePanel() {\n  return `<section class=\"panel\"><button class=\"balance-main\" data-action=\"profile-view\" data-value=\"wallet\">${icon('credit-card')}<div class=\"grow\"><div class=\"meta\">Баланс</div><div class=\"balance-value\">${money(account.balance)} <small>€</small></div></div>${icon('chevron-right', 'chevron')}</button><div class=\"balance-actions\"><button class=\"deposit-button\" data-action=\"deposit\">+ Пополнить счёт</button><button class=\"plain-action\" data-action=\"withdraw\">Вывести</button></div></section>`;\n}\nfunction mainProfile() {\n  return `<section class=\"panel\"><button class=\"identity\" data-action=\"profile-view\" data-value=\"personal\"><div class=\"avatar\">${esc(account.firstName[0]+account.lastName[0])}</div><div class=\"grow\"><div class=\"meta\">ID ${esc(account.id)}</div><div class=\"name\" data-no-translate>${esc(account.firstName)} ${esc(account.lastName)}</div></div>${icon('chevron-right','chevron')}</button></section>${balancePanel()}<div class=\"profile-shortcuts\"><button data-action=\"profile-view\" data-value=\"hero\"><span>🌟</span>HERO</button><button data-action=\"profile-view\" data-value=\"bonuses\"><span>🎁</span>Магазин бонусів</button><button data-action=\"profile-view\" data-value=\"tournaments\"><span>🏆</span>Турніри</button></div>${profileRows()}`;\n}\nfunction profileRows() {\n  return `<div class=\"menu\">${row('gift','Акції','profile-view','promotions')}${row('circle-user-round','Персональні дані','profile-view','personal')}${row('shield-check','Підтвердження акаунта','profile-view','security')}${row('history','Історія платежів','profile-view','payments')}${row('ticket','Мої ставки','profile-view','bets')}</div><div class=\"menu\">${row('notebook-pen','Залишити відгук','profile-view','feedback')}</div><div class=\"menu\">${row('settings','Налаштування','profile-view','settings')}${row('info','Допомога та інформація','profile-view','information')}</div><div class=\"menu logout-row\">${row('log-out','Вихід','logout')}</div>`;\n}\nfunction settings() {\n  return `<div class=\"settings-page\"><div class=\"menu\"><button class=\"row\" data-action=\"language\">${icon('globe')}<span>Змінити мову</span><small>${getLanguage()}</small>${icon('chevrons-up-down','chevron')}</button></div><div class=\"menu\">${row('settings','Безпека','profile-view','settings-security')}${row('bell','Налаштування сповіщень','profile-view','settings-notifications')}${row('sports-score','Налаштування спорту','profile-view','settings-sport')}</div></div>`;\n}\nfunction openLanguage() {\n  let selected=getLanguage();\n  openDialog('Мова',`<div class=\"language-options\">${[['uk','Українська'],['ru','Русский'],['en','English']].map(([value,label])=>`<label data-no-translate><span>${label}</span><input type=\"radio\" name=\"language\" value=\"${value}\" ${value===selected?'checked':''}></label>`).join('')}</div><button class=\"submit language-save\" data-action=\"save-language\">Зберегти</button>`);\n  dialog.classList.add('language-sheet');\n  dialog.querySelectorAll('[name=language]').forEach(input=>input.onchange=()=>{selected=input.value;});\n  dialog.querySelector('.language-save').onclick=()=>{setLanguage(selected);dialog.close();};\n}\nfunction field(label, value, end = '') {\n  return `<div class=\"data-field\"><div><div class=\"meta\">${label}</div><div class=\"data-value\">${esc(value)}</div></div>${end}</div>`;\n}\nfunction personal() {\n  return `<div class=\"data-page\"><h2 class=\"section-label\">Контакты</h2><div class=\"data-group\">${field('Номер счёта', account.id, `<button class=\"icon-button\" data-action=\"copy\" aria-label=\"Копировать номер счёта\" title=\"Копировать\">${icon('copy')}</button>`)}${field('Номер телефона', 'Не указан')}${field('E-mail', account.email)}</div><h2 class=\"section-label\">Персональная информация</h2><div class=\"data-group\">${field('Имя', account.firstName)}${field('Фамилия', account.lastName)}</div><h2 class=\"section-label\">Безопасность</h2><div class=\"data-group\">${field('Пароль', '••••••••', `<button class=\"icon-button\" data-action=\"password\" aria-label=\"Изменить пароль\" title=\"Изменить пароль\">${icon('pencil')}</button>`)}</div><div class=\"note\">${icon('info')}<span>Данные этого профиля относятся только к Arena Line.</span></div></div>`;\n}\nfunction bets() {\n  return betHistory(account, betTab, localStorage.getItem('arena-edit-bets') === 'on');\n}\nfunction payments() {\n  if (!account.payments.length) return empty('history', 'Операций пока нет');\n  return account.payments.map(payment => {\n    const label = payment.type === 'bet-payout' ? 'Виплата за ставкою' :\n      payment.type === 'bet-cashout' ? 'Cash-out' :\n      payment.type === 'deposit' ? 'Пополнение' : 'Вывод';\n    const positive = payment.type !== 'withdraw';\n    return `<div class=\"payment\"><div><strong>${label}</strong><div class=\"meta\">${esc(new Date(payment.date).toLocaleString(getLocale()))}</div></div><div class=\"${positive ? 'positive' : ''}\">${positive ? '+' : '-'}${money(payment.amount)} €</div></div>`;\n  }).join('');\n}\nfunction profileMenu() {\n  return profileRows();\n}\nfunction renderProfile() {\n  account = getAccount();\n  if (!account) { closeProfile(); openAuth(false, true); return; }\n  profileHeader(); profileNav();\n  const views = {\n    profile: mainProfile,\n    personal,\n    bets,\n    'bet-detail': () => betDetail(account, selectedBetId),\n    payments,\n    wallet: () => `${balancePanel()}${payments()}`,\n    security: () => `<div class=\"data-page\"><div class=\"security\">${icon('shield-check')}<h2>Аккаунт создан</h2><p>Вход по почте и паролю.<br>Виртуальный счёт активен.</p></div></div>`,\n    menu:profileMenu,settings,\n    'settings-security':()=>`<div class=\"menu\">${row('lock-keyhole','Змінити пароль','password')}</div>`,\n    'settings-notifications':()=>`<div class=\"menu\"><label class=\"row\">${icon('bell')}<span>Розрахунок ставок</span><input type=\"checkbox\" id=\"settlement-notifications\" ${localStorage.getItem('arena-settlement-notifications')!=='off'?'checked':''}></label></div>`,\n    'settings-sport':()=>`<div class=\"settings-page\"><label>Початковий розділ<select id=\"default-stage\"><option value=\"live\">Лайв</option><option value=\"prematch\" ${localStorage.getItem('arena-default-stage')==='prematch'?'selected':''}>Прематч</option></select></label><label>Сортування матчів<select id=\"match-sort\"><option value=\"time\">За часом</option><option value=\"tournament\" ${localStorage.getItem('arena-match-sort')==='tournament'?'selected':''}>За турніром</option></select></label></div>`,\n    feedback:()=>`<form id=\"feedback-form\"><label for=\"feedback-text\">Текст відгуку</label><textarea id=\"feedback-text\" required maxlength=\"2000\" rows=\"7\">${esc(localStorage.getItem('arena-feedback-v1')||'')}</textarea><button class=\"submit\" type=\"submit\">Зберегти відгук</button></form>`,\n    information:()=>`<div class=\"data-page\"><h2>Arena Line</h2><p>Профіль синхронізується з серверною копією: баланс, платежі та історія ставок доступні після входу на іншому пристрої.</p><p>Матчі та коефіцієнти надходять із лінії. Виплата за ставкою зараховується після підтвердження результату.</p></div>`,\n    promotions:()=>empty('gift','Активних бонусів немає'),hero:()=>empty('star','HERO','Для цього профілю поки немає нагород.'),bonuses:()=>empty('gift','Активних бонусів немає'),tournaments:()=>empty('trophy','Турніри','У профілі немає активних бонусних турнірів.')\n  };\n  const isBetDetail = profileView === 'bet-detail';\n  document.documentElement.classList.toggle('bet-detail-open',isBetDetail);\n  document.body.classList.toggle('bet-detail-open',isBetDetail);\n  const themeMeta=document.querySelector('meta[name=\"theme-color\"]');\n  if(themeMeta && !document.body.classList.contains('share-coupon-open')){\n    themeMeta.setAttribute('content',isBetDetail ? '#ffffff' : '#171716');\n  }\n  $('#profile-nav').hidden = isBetDetail;\n  $('#profile-content').classList.toggle('history-view', profileView === 'bets');\n  $('#profile-content').classList.toggle('bet-detail-view', isBetDetail);\n  $('#profile-content').innerHTML = (views[profileView] || mainProfile)();\n  refreshIcons();\n}\nfunction openProfile() {\n  account = getAccount();\n  if (!account) { openAuth(false, true); return; }\n  profileView = 'profile';\n  $('#betslip').close();\n  $('#profile-layer').hidden = false;\n  document.body.classList.add('profile-open');\n  history.replaceState(null, '', '#profile');\n  renderProfile();\n  sports?.renderSlip();\n}\nfunction openBets() {\n  openProfile();\n  selectedBetId = null;\n  if (!$('#profile-layer').hidden) { profileView = 'bets'; betTab = 'open'; renderProfile(); }\n  sports?.results.check(true);\n}\nfunction closeProfile() {\n  $('#profile-layer').hidden = true;\n  document.documentElement.classList.remove('bet-detail-open');\n  document.body.classList.remove('profile-open','bet-detail-open');\n  const themeMeta=document.querySelector('meta[name=\"theme-color\"]');\n  if(themeMeta && !document.body.classList.contains('share-coupon-open')) themeMeta.setAttribute('content','#171716');\n  if (location.hash) history.replaceState(null, '', location.pathname + location.search);\n  syncFeedControls();\n  sports?.resizeSlip();\n}\nfunction openDialog(title, content, dialogClass = '') {\n  dialog.classList.remove('language-sheet','theme-sheet','edit-bet-dialog');\n  if (dialogClass) dialog.classList.add(dialogClass);\n  $('#dialog-content').innerHTML = `<div class=\"dialog-head\"><h2 id=\"dialog-title\">${title}</h2><button class=\"icon-button\" type=\"button\" data-action=\"close-dialog\" aria-label=\"Закрыть\" title=\"Закрыть\">${icon('x')}</button></div>${content}`;\n  if (!dialog.open) dialog.showModal();\n  refreshIcons();\n}\n\nfunction openEditBet(id) {\n  account = getAccount();\n  const bet = account?.bets.find(item => item.id === id);\n  if (!bet) { showToast('Ставка не знайдена'); return; }\n\n  const selections = bet.selections || [];\n  const status = ['open','won','lost','void','cashout'].includes(bet.status) ? bet.status : 'open';\n  const editBetDateValue = (() => {\n    const date = new Date(bet.date || Date.now());\n    if (!Number.isFinite(date.getTime())) return '';\n    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);\n    return local.toISOString().slice(0,16);\n  })();\n\n  const parseExactScore = value => {\n    const match = String(value || '').match(/(?:^|\\s)(\\d{1,2})\\s*[:\\-]\\s*(\\d{1,2})(?:$|\\s)/);\n    return match ? [Number(match[1]),Number(match[2])] : null;\n  };\n\n  const scorePresets = selection => {\n    const labelScore = parseExactScore(selection.label);\n    const text = (String(selection.marketName || '') + ' ' + String(selection.label || '')).toLowerCase();\n    const exactMarket = /точн|точний|exact|correct\\s*score|рахунок|сч[её]т|map\\s*score|score\\s*maps?|по\\s*карт|за\\s*карт/.test(text);\n    if (!exactMarket && !labelScore) return [];\n    const max = labelScore ? Math.max(...labelScore) : 0;\n    const bo5 = max >= 3 || /\\bbo5\\b|best\\s*of\\s*5|до\\s*3|first\\s*to\\s*3/.test(text);\n    const bo3 = !bo5 && (max === 2 || /\\bbo3\\b|best\\s*of\\s*3|до\\s*2|first\\s*to\\s*2/.test(text));\n    if (bo5) return ['3:0','3:1','3:2','0:3','1:3','2:3'];\n    if (bo3) return ['2:0','2:1','0:2','1:2'];\n    return ['2:0','2:1','0:2','1:2','3:0','3:1','3:2','0:3','1:3','2:3'];\n  };\n\n  const priorEditorWatchIds = [...(sports?.feed?.selectedIds || [])];\n  const editorEventIds = [...new Set(selections.map(selection => String(selection.eventId || '')).filter(Boolean))];\n  if (sports?.feed?.watch && editorEventIds.length) {\n    sports.feed.watch([...new Set([...priorEditorWatchIds,...editorEventIds])]);\n  }\n\n  const lineSelectionsFor = selection => {\n    try {\n      return (sports?.feed?.selections?.(String(selection.eventId || '')) || [])\n        .filter(item => item && Number(item.odds) > 1 && !item.frozen);\n    } catch {\n      return [];\n    }\n  };\n\n  const lineMarketGroups = selection => {\n    const groups = new Map();\n    for (const item of lineSelectionsFor(selection)) {\n      const key = [Number(item.period || 0),Number(item.marketType || 0),String(item.marketName || '')].join(':');\n      if (!groups.has(key)) groups.set(key,{key,name:String(item.marketName || ''),items:[]});\n      groups.get(key).items.push(item);\n    }\n    return [...groups.values()];\n  };\n\n  const lineSelectionPayload = item => item ? {\n    id:String(item.id || ''),\n    eventId:String(item.eventId || ''),\n    marketName:String(item.marketName || ''),\n    label:String(item.label || ''),\n    shortLabel:String(item.shortLabel || ''),\n    odds:Number(item.odds || 0),\n    outcomeType:item.outcomeType == null ? null : Number(item.outcomeType),\n    outcomeValues:Array.isArray(item.outcomeValues) ? item.outcomeValues : [],\n    resultKind:item.resultKind == null ? null : Number(item.resultKind),\n    frozen:!!item.frozen,\n    stage:item.stage == null ? null : Number(item.stage),\n    marketType:item.marketType == null ? null : Number(item.marketType),\n    period:item.period == null ? null : Number(item.period),\n    parameters:Array.isArray(item.parameters) ? item.parameters : [],\n    version:item.version == null ? null : Number(item.version)\n  } : null;\n\n  const selectionState = selections.map(selection => {\n    const teams = selection.competitors?.length\n      ? selection.competitors.map(team => typeof team === 'string' ? team : team.name)\n      : String(selection.eventName || '').split(/\\s+[-–—]\\s+/);\n    const score = Array.isArray(selection.settlement?.score) ? selection.settlement.score : [];\n    const normalizedLabel = String(selection.label || '').trim().toLowerCase();\n    const team0 = String(teams[0] || '').trim().toLowerCase();\n    const team1 = String(teams[1] || '').trim().toLowerCase();\n    let decodedType = null;\n    try {\n      decodedType = Number(JSON.parse(decodeURIComponent(selection.id))?.[2]?.type);\n    } catch {}\n    const chosenSide = selection.outcomeType === 0 || decodedType === 0 || /^П1$/i.test(selection.shortLabel || '') || (team0 && normalizedLabel === team0) ? 0 :\n      selection.outcomeType === 3 || decodedType === 3 || /^П2$/i.test(selection.shortLabel || '') || (team1 && normalizedLabel === team1) ? 1 : null;\n    let winnerIndex = '';\n    let state = 'open';\n    if (selection.settlement?.status === 'void') state = 'void';\n    else if (selection.settlement?.manualScoreMarket && score.length === 2) state = 'score';\n    else if (selection.settlement?.winnerIndex === 0 || selection.settlement?.winnerIndex === 1) {\n      winnerIndex = Number(selection.settlement.winnerIndex);\n      state = 'winner';\n    } else if (score.length === 2 && Number(score[0]) !== Number(score[1])) {\n      winnerIndex = Number(score[0]) > Number(score[1]) ? 0 : 1;\n      state = 'winner';\n    } else if (selection.settlement?.status && chosenSide != null) {\n      if (selection.settlement.status === 'won') winnerIndex = chosenSide;\n      if (selection.settlement.status === 'lost') winnerIndex = chosenSide === 0 ? 1 : 0;\n      if (winnerIndex === 0 || winnerIndex === 1) state = 'winner';\n    }\n    const marketName=String(selection.marketName || '');\n    const label=String(selection.label || '');\n    return {teams,score,winnerIndex,state,chosenSide,marketName,label,originalMarketName:marketName,originalLabel:label,displayMarketName:t(marketName),displayLabel:t(label),odds:Number(selection.odds || 0),lineSelection:null};\n  });\n\n  const selectionCards = selections.map((selection,index) => {\n    const state = selectionState[index];\n    const team1 = state.teams[0] || 'П1';\n    const team2 = state.teams[1] || 'П2';\n    const presets = scorePresets(selection);\n    const selectedPreset = parseExactScore(state.label)?.join(':') || state.label.trim();\n    const presetMarkup = presets.length ? '<div class=\"edit-score-presets\" data-score-presets=\"' + index + '\">' + presets.map(value => '<button type=\"button\" data-edit-score-preset=\"' + index + '\" data-value=\"' + esc(value) + '\" class=\"' + (selectedPreset === value ? 'selected' : '') + '\">' + esc(value) + '</button>').join('') + '</div>' : '';\n    return `\n      <details class=\"edit-selection-card\" data-edit-selection=\"${index}\" ${selections.length === 1 ? 'open' : ''}>\n        <summary class=\"edit-selection-head\">\n          <span class=\"edit-selection-head-copy\">\n            <strong>${esc(selection.eventName || ('Матч ' + (index + 1)))}</strong>\n            <small data-edit-selection-summary=\"${index}\">${esc(state.displayMarketName)}${state.displayLabel ? ' · ' + esc(state.displayLabel) : ''} · ${Number(state.odds || 0).toFixed(2)}</small>\n          </span>\n          <span class=\"edit-selection-head-side\"><b>#${index + 1}</b>${icon('chevron-down')}</span>\n        </summary>\n        <div class=\"edit-selection-body\">\n          <div class=\"edit-selection-section-title\">Вибір у ставці</div>\n          <div class=\"edit-line-picker\" data-edit-line-picker=\"${index}\">\n            <label for=\"edit-line-market-${index}\">Ринок з лінії</label>\n            <select id=\"edit-line-market-${index}\" class=\"edit-line-market-select\" data-index=\"${index}\" disabled>\n              <option value=\"\">Завантаження лінії матчу…</option>\n            </select>\n            <label for=\"edit-line-outcome-${index}\">Вибраний результат</label>\n            <select id=\"edit-line-outcome-${index}\" class=\"edit-line-outcome-select\" data-index=\"${index}\" disabled>\n              <option value=\"\">Оберіть результат</option>\n            </select>\n            <div class=\"edit-line-status\" data-edit-line-status=\"${index}\">Завантаження лінії матчу…</div>\n          </div>\n          <details class=\"edit-manual-fallback\">\n            <summary>Ручний ввід</summary>\n            <label for=\"edit-market-${index}\">Ринок</label>\n            <input id=\"edit-market-${index}\" class=\"edit-market-name\" data-index=\"${index}\" value=\"${esc(state.displayMarketName)}\" maxlength=\"180\" required>\n            <label for=\"edit-label-${index}\">Вибраний результат</label>\n            <input id=\"edit-label-${index}\" class=\"edit-outcome-label\" data-index=\"${index}\" value=\"${esc(state.displayLabel)}\" maxlength=\"180\" required>\n            ${presetMarkup}\n            <label for=\"edit-odds-${index}\">Коефіцієнт вручну</label>\n            <input id=\"edit-odds-${index}\" class=\"edit-odds\" data-index=\"${index}\" inputmode=\"decimal\" value=\"${Number(selection.odds || 0).toFixed(2)}\" required>\n          </details>\n\n          <div class=\"edit-selection-section-title edit-result-title\">Фактичний результат</div>\n          <div class=\"edit-bet-label\">Переможець матчу</div>\n        <div class=\"edit-winner-buttons\" data-selection-winner=\"${index}\">\n          <button type=\"button\" class=\"${state.state === 'winner' && state.winnerIndex === 0 ? 'selected' : ''}\" data-edit-selection-winner=\"${index}\" data-side=\"0\">П1<small>${esc(team1)}</small></button>\n          <button type=\"button\" class=\"${state.state === 'winner' && state.winnerIndex === 1 ? 'selected' : ''}\" data-edit-selection-winner=\"${index}\" data-side=\"1\">П2<small>${esc(team2)}</small></button>\n        </div>\n        <div class=\"edit-result-controls edit-result-controls-wide\">\n          <button type=\"button\" class=\"${state.state === 'open' ? 'selected' : ''}\" data-edit-selection-state=\"${index}\" data-state=\"open\">Не зіграно</button>\n          <button type=\"button\" class=\"${state.state === 'score' ? 'selected' : ''}\" data-edit-selection-state=\"${index}\" data-state=\"score\">За рахунком</button>\n          <button type=\"button\" class=\"${state.state === 'void' ? 'selected' : ''}\" data-edit-selection-state=\"${index}\" data-state=\"void\">Повернення</button>\n        </div>\n\n        <div class=\"edit-score-grid\">\n          <div>\n            <label for=\"edit-score-${index}-1\">Рахунок 1</label>\n            <input id=\"edit-score-${index}-1\" inputmode=\"numeric\" type=\"number\" min=\"0\" value=\"${state.score[0] ?? ''}\">\n          </div>\n          <div>\n            <label for=\"edit-score-${index}-2\">Рахунок 2</label>\n            <input id=\"edit-score-${index}-2\" inputmode=\"numeric\" type=\"number\" min=\"0\" value=\"${state.score[1] ?? ''}\">\n          </div>\n        </div>\n        </div>\n      </details>\n    `;\n  }).join('');\n\n  openDialog('Редагувати ставку', `\n    <form id=\"edit-bet-form\" class=\"edit-bet-form\">\n      <p class=\"dialog-copy\">Відкрий потрібний пункт ставки та змінюй сам ринок, вибраний результат, коефіцієнт або фактичний результат. Наприклад, точний рахунок по картах 3:0 можна змінити на 3:2.</p>\n\n      <div class=\"edit-bet-card edit-bet-general\">\n        <div class=\"edit-bet-grid\">\n          <div>\n            <label for=\"edit-bet-number\">Номер ставки</label>\n            <input id=\"edit-bet-number\" inputmode=\"numeric\" type=\"number\" min=\"1\" step=\"1\" value=\"${Number(bet.number || 1)}\" required>\n          </div>\n          <div>\n            <label for=\"edit-bet-stake\">Сума ставки, €</label>\n            <input id=\"edit-bet-stake\" inputmode=\"decimal\" value=\"${(Number(bet.stake || 0) / 100).toFixed(2)}\" required>\n          </div>\n        </div>\n\n        <label for=\"edit-bet-date\">Час ставки</label>\n        <input id=\"edit-bet-date\" class=\"edit-bet-date\" type=\"datetime-local\" value=\"${esc(editBetDateValue)}\" required>\n\n        <label for=\"edit-bet-status\">Статус ставки</label>\n        <select id=\"edit-bet-status\">\n          <option value=\"open\" ${status === 'open' ? 'selected' : ''}>Нерозрахована</option>\n          <option value=\"won\" ${status === 'won' ? 'selected' : ''}>Виграна</option>\n          <option value=\"lost\" ${status === 'lost' ? 'selected' : ''}>Програна</option>\n          <option value=\"void\" ${status === 'void' ? 'selected' : ''}>Повернення</option>\n          <option value=\"cashout\" ${status === 'cashout' ? 'selected' : ''}>Cash-out</option>\n        </select>\n        <div id=\"edit-cashout-wrap\" ${status === 'cashout' ? '' : 'hidden'}>\n          <label for=\"edit-cashout\">Сума cash-out, €</label>\n          <input id=\"edit-cashout\" inputmode=\"decimal\" value=\"${status === 'cashout' ? (Number(bet.payout || 0) / 100).toFixed(2) : ''}\">\n        </div>\n      </div>\n\n      <div class=\"edit-selection-caption\"><strong>Пункти ставки</strong><span>${selections.length}</span></div>\n      <div class=\"edit-selection-list\">${selectionCards}</div>\n\n      <div class=\"edit-payout-preview\">Можлива виплата: <strong id=\"edit-payout-value\">${money(status === 'won' || status === 'cashout' ? Number(bet.payout || bet.potential || 0) : Number(bet.potential || 0))} €</strong></div>\n      <div id=\"form-error\" class=\"error\" role=\"alert\"></div>\n      <button class=\"submit edit-bet-save\" type=\"submit\">Зберегти зміни</button>\n      <button class=\"edit-bet-duplicate\" type=\"button\" data-action=\"duplicate-bet\" data-value=\"${esc(bet.id)}\">${icon('copy')}<span>Дублювати ставку</span></button>\n      <button class=\"edit-bet-hide\" type=\"button\" data-action=\"delete-bet\" data-value=\"${esc(bet.id)}\">Приховати ставку з історії</button>\n    </form>\n  `, 'edit-bet-dialog');\n\n  const form = $('#edit-bet-form');\n  const statusInput = $('#edit-bet-status');\n  const cashoutWrap = $('#edit-cashout-wrap');\n  const payoutValue = $('#edit-payout-value');\n  const persistedSelectionText = (index,field) => {\n    const state = selectionState[index];\n    const input = form.querySelector(field === 'marketName' ? `#edit-market-${index}` : `#edit-label-${index}`);\n    const current = input?.value.trim() || '';\n    if (state.lineSelection) return field === 'marketName' ? String(state.lineSelection.marketName || '') : String(state.lineSelection.label || '');\n    const display = field === 'marketName' ? state.displayMarketName : state.displayLabel;\n    const original = field === 'marketName' ? state.originalMarketName : state.originalLabel;\n    return current === display ? original : current;\n  };\n\n  const lineOptionMaps = selectionState.map(() => new Map());\n  let linePollAttempts = 0;\n  let linePollTimer = null;\n\n  const applyLineSelection = (index,item) => {\n    if (!item) return;\n    const state = selectionState[index];\n    state.lineSelection = item;\n    state.marketName = String(item.marketName || '');\n    state.label = String(item.label || '');\n    state.displayMarketName = t(state.marketName);\n    state.displayLabel = t(state.label);\n    const marketInput = form.querySelector(`#edit-market-${index}`);\n    const labelInput = form.querySelector(`#edit-label-${index}`);\n    const oddsInput = form.querySelector(`#edit-odds-${index}`);\n    if (marketInput) marketInput.value = state.displayMarketName;\n    if (labelInput) labelInput.value = state.displayLabel;\n    if (oddsInput && Number.isFinite(Number(item.odds))) oddsInput.value = Number(item.odds).toFixed(2);\n    form.querySelectorAll(`[data-edit-score-preset=\"${index}\"]`).forEach(button => {\n      const selectedScore = parseExactScore(item.label)?.join(':') || '';\n      button.classList.toggle('selected',button.dataset.value === selectedScore);\n    });\n    updateSelectionSummary(index);\n    preview();\n  };\n\n  const renderLineOutcomes = (index,group,chooseFirst = false) => {\n    const outcomeSelect = form.querySelector(`#edit-line-outcome-${index}`);\n    if (!outcomeSelect || !group) return;\n    const state = selectionState[index];\n    lineOptionMaps[index] = new Map(group.items.map(item => [String(item.id),item]));\n    const current = state.lineSelection\n      ? group.items.find(item => String(item.id) === String(state.lineSelection.id))\n      : group.items.find(item => String(item.id) === String(selections[index]?.id))\n        || group.items.find(item => String(item.label || '') === state.originalLabel);\n    outcomeSelect.innerHTML = group.items.map(item =>\n      `<option value=\"§ITEMID§\" §SELECTED§>§ITEMLABEL§ · §ODDS§</option>`\n        .replace('§ITEMID§',esc(item.id))\n        .replace('§SELECTED§',current && String(current.id) === String(item.id) ? 'selected' : '')\n        .replace('§ITEMLABEL§',esc(t(item.label)))\n        .replace('§ODDS§',Number(item.odds).toFixed(2))\n    ).join('');\n    outcomeSelect.disabled = false;\n    if (chooseFirst && group.items[0]) {\n      outcomeSelect.value = String(group.items[0].id);\n      applyLineSelection(index,group.items[0]);\n    }\n  };\n\n  const renderLinePicker = index => {\n    const selection = selections[index];\n    const marketSelect = form.querySelector(`#edit-line-market-${index}`);\n    const outcomeSelect = form.querySelector(`#edit-line-outcome-${index}`);\n    const statusNode = form.querySelector(`[data-edit-line-status=\"${index}\"]`);\n    if (!marketSelect || !outcomeSelect || !statusNode) return false;\n    const groups = lineMarketGroups(selection);\n    if (!groups.length) {\n      marketSelect.disabled = true;\n      outcomeSelect.disabled = true;\n      marketSelect.innerHTML = `<option value=\"\">§STATUS§</option>`.replace('§STATUS§',esc(t(linePollAttempts < 16 ? 'Завантаження лінії матчу…' : 'Лінія матчу зараз недоступна')));\n      outcomeSelect.innerHTML = `<option value=\"\">§OUTCOME§</option>`.replace('§OUTCOME§',esc(t('Оберіть результат')));\n      statusNode.textContent = t(linePollAttempts < 16 ? 'Завантаження лінії матчу…' : 'Лінія матчу зараз недоступна');\n      return false;\n    }\n\n    const state = selectionState[index];\n    const matchedGroup = groups.find(group => group.items.some(item => String(item.id) === String(state.lineSelection?.id || selection.id)))\n      || groups.find(group => String(group.name) === state.originalMarketName)\n      || groups[0];\n    marketSelect.innerHTML = groups.map(group =>\n      `<option value=\"§KEY§\" §SELECTED§>§NAME§</option>`\n        .replace('§KEY§',esc(group.key))\n        .replace('§SELECTED§',group.key === matchedGroup.key ? 'selected' : '')\n        .replace('§NAME§',esc(t(group.name)))\n    ).join('');\n    marketSelect.disabled = false;\n    marketSelect._arenaGroups = groups;\n    statusNode.textContent = t('Лінія матчу');\n    renderLineOutcomes(index,matchedGroup,false);\n    return true;\n  };\n\n  const refreshLinePickers = () => {\n    if (!dialog.open || !form.isConnected) return;\n    linePollAttempts++;\n    const ready = selections.map((_,index) => renderLinePicker(index));\n    if (ready.some(value => !value) && linePollAttempts < 16) linePollTimer = setTimeout(refreshLinePickers,250);\n  };\n\n  const preview = () => {\n    try {\n      const stake = Math.round(Number(String($('#edit-bet-stake').value).replace(',', '.')) * 100);\n      const nextSelections = selections.map((selection,index) => ({\n        ...selection,\n        marketName:persistedSelectionText(index,'marketName'),\n        label:persistedSelectionText(index,'label'),\n        odds:Number(String(form.querySelector(`#edit-odds-${index}`).value).replace(',', '.'))\n      }));\n      const totals = betTotals(stake,nextSelections,bet.type,bet.systemSize);\n      let value = totals.potential;\n      if (statusInput.value === 'lost') value = 0;\n      if (statusInput.value === 'void') value = totals.cost;\n      if (statusInput.value === 'cashout') {\n        const raw = Number(String($('#edit-cashout').value || '0').replace(',', '.'));\n        value = Number.isFinite(raw) ? Math.round(raw * 100) : 0;\n      }\n      payoutValue.textContent = money(value) + ' €';\n    } catch {}\n  };\n\n  const updateSelectionSummary = index => {\n    const market = form.querySelector(`#edit-market-${index}`)?.value.trim() || '';\n    const label = form.querySelector(`#edit-label-${index}`)?.value.trim() || '';\n    const odds = Number(String(form.querySelector(`#edit-odds-${index}`)?.value || '0').replace(',', '.'));\n    const summary = form.querySelector(`[data-edit-selection-summary=\"${index}\"]`);\n    if (summary) summary.textContent = `${market}${label ? ' · ' + label : ''}${Number.isFinite(odds) ? ' · ' + odds.toFixed(2) : ''}`;\n  };\n\n  const currentChosenSide = index => {\n    const state = selectionState[index];\n    const outcomeType = state.lineSelection?.outcomeType;\n    if (Number(outcomeType) === 0) return 0;\n    if (Number(outcomeType) === 3) return 1;\n\n    const clean = value => String(value || '').trim().toLowerCase().replace(/[^\\p{L}\\p{N}]+/gu,' ').replace(/\\s+/g,' ').trim();\n    const label = clean(form.querySelector(`#edit-label-${index}`)?.value || state.label || '');\n    const team0 = clean(state.teams[0] || '');\n    const team1 = clean(state.teams[1] || '');\n    if (/^(?:п1|p1)$/i.test(label) || (team0 && (label === team0 || label.includes(team0)))) return 0;\n    if (/^(?:п2|p2)$/i.test(label) || (team1 && (label === team1 || label.includes(team1)))) return 1;\n    return state.chosenSide === 0 || state.chosenSide === 1 ? state.chosenSide : null;\n  };\n\n  const actualOutcomeForSelection = index => {\n    const state = selectionState[index];\n    if (state.state === 'open') return 'open';\n    if (state.state === 'void') return 'void';\n\n    if (state.state === 'winner') {\n      const side = currentChosenSide(index);\n      const winner = Number(state.winnerIndex);\n      if ((side !== 0 && side !== 1) || (winner !== 0 && winner !== 1)) return 'open';\n      return side === winner ? 'won' : 'lost';\n    }\n\n    if (state.state === 'score') {\n      const selectedScore = parseExactScore(form.querySelector(`#edit-label-${index}`)?.value || state.label);\n      const score1 = Number(form.querySelector(`#edit-score-${index}-1`)?.value);\n      const score2 = Number(form.querySelector(`#edit-score-${index}-2`)?.value);\n      if (!selectedScore || !Number.isInteger(score1) || !Number.isInteger(score2)) return 'open';\n      return selectedScore[0] === score1 && selectedScore[1] === score2 ? 'won' : 'lost';\n    }\n\n    return 'open';\n  };\n\n  const syncOverallStatusFromActual = () => {\n    if (statusInput.value === 'cashout') return;\n    const outcomes = selectionState.map((_,index) => actualOutcomeForSelection(index));\n    let nextStatus = 'open';\n\n    if (bet.type === 'single') {\n      nextStatus = outcomes[0] || 'open';\n    } else if (bet.type === 'express') {\n      if (outcomes.includes('lost')) nextStatus = 'lost';\n      else if (outcomes.includes('open')) nextStatus = 'open';\n      else if (outcomes.every(value => value === 'void')) nextStatus = 'void';\n      else nextStatus = 'won';\n    } else {\n      if (outcomes.includes('open')) {\n        nextStatus = 'open';\n      } else {\n        const systemSize = Math.max(1, Number(bet.systemSize || 2));\n        const usable = outcomes.filter(value => value !== 'lost').length;\n        const won = outcomes.filter(value => value === 'won').length;\n        nextStatus = usable < systemSize ? 'lost' : won === 0 ? 'void' : 'won';\n      }\n    }\n\n    statusInput.value = nextStatus;\n    cashoutWrap.hidden = true;\n    preview();\n  };\n\n  form.querySelectorAll('[data-edit-score-preset]').forEach(button => {\n    button.addEventListener('click', () => {\n      const index = Number(button.dataset.editScorePreset);\n      const value = button.dataset.value;\n      const input = form.querySelector(`#edit-label-${index}`);\n      input.value = value;\n      selectionState[index].lineSelection = null;\n      selectionState[index].label = value;\n      form.querySelectorAll(`[data-edit-score-preset=\"${index}\"]`).forEach(item => item.classList.toggle('selected', item === button));\n      updateSelectionSummary(index);\n      preview();\n    });\n  });\n\n  form.querySelectorAll('[data-edit-selection-winner]').forEach(button => {\n    button.addEventListener('click', () => {\n      const index = Number(button.dataset.editSelectionWinner);\n      const side = Number(button.dataset.side);\n      selectionState[index].state = 'winner';\n      selectionState[index].winnerIndex = side;\n      form.querySelectorAll(`[data-edit-selection-winner=\"${index}\"]`).forEach(item => item.classList.toggle('selected', item === button));\n      form.querySelectorAll(`[data-edit-selection-state=\"${index}\"]`).forEach(item => item.classList.remove('selected'));\n      syncOverallStatusFromActual();\n    });\n  });\n\n  form.querySelectorAll('[data-edit-selection-state]').forEach(button => {\n    button.addEventListener('click', () => {\n      const index = Number(button.dataset.editSelectionState);\n      const state = button.dataset.state;\n      selectionState[index].state = state;\n      selectionState[index].winnerIndex = '';\n      form.querySelectorAll(`[data-edit-selection-winner=\"${index}\"]`).forEach(item => item.classList.remove('selected'));\n      form.querySelectorAll(`[data-edit-selection-state=\"${index}\"]`).forEach(item => item.classList.toggle('selected', item === button));\n      syncOverallStatusFromActual();\n    });\n  });\n\n  form.querySelectorAll('.edit-line-market-select').forEach(select => {\n    select.addEventListener('change', () => {\n      const index = Number(select.dataset.index);\n      const groups = Array.isArray(select._arenaGroups) ? select._arenaGroups : lineMarketGroups(selections[index]);\n      const group = groups.find(item => item.key === select.value);\n      if (group) renderLineOutcomes(index,group,true);\n    });\n  });\n  form.querySelectorAll('.edit-line-outcome-select').forEach(select => {\n    select.addEventListener('change', () => {\n      const index = Number(select.dataset.index);\n      const item = lineOptionMaps[index]?.get(String(select.value));\n      if (item) applyLineSelection(index,item);\n    });\n  });\n  refreshLinePickers();\n\n  statusInput.addEventListener('change', () => {\n    cashoutWrap.hidden = statusInput.value !== 'cashout';\n    preview();\n  });\n  form.querySelectorAll('.edit-market-name,.edit-outcome-label,.edit-odds').forEach(input => {\n    input.addEventListener('input', () => {\n      const index = Number(input.dataset.index);\n      if (input.classList.contains('edit-market-name') || input.classList.contains('edit-outcome-label')) selectionState[index].lineSelection = null;\n      if (input.classList.contains('edit-outcome-label')) {\n        const value = input.value.trim();\n        form.querySelectorAll(`[data-edit-score-preset=\"${index}\"]`).forEach(item => item.classList.toggle('selected', item.dataset.value === value));\n      }\n      updateSelectionSummary(index);\n      preview();\n    });\n  });\n  form.querySelectorAll('#edit-bet-stake,#edit-cashout').forEach(input => input.addEventListener('input',preview));\n  form.querySelectorAll('[id^=\"edit-score-\"]').forEach(input => input.addEventListener('input',syncOverallStatusFromActual));\n\n  form.addEventListener('submit', event => {\n    event.preventDefault();\n    const submit = form.querySelector('[type=submit]');\n    submit.disabled = true;\n    $('#form-error').textContent = '';\n    try {\n      const selectionEdits = selections.map((_,index) => ({\n        state:selectionState[index].state,\n        winnerIndex:selectionState[index].winnerIndex,\n        manualChosenSide:currentChosenSide(index),\n        manualResultStatus:actualOutcomeForSelection(index),\n        lineSelection:lineSelectionPayload(selectionState[index].lineSelection),\n        marketName:persistedSelectionText(index,'marketName'),\n        label:persistedSelectionText(index,'label'),\n        odds:Number(String(form.querySelector(`#edit-odds-${index}`).value).replace(',', '.')),\n        score1:form.querySelector(`#edit-score-${index}-1`).value,\n        score2:form.querySelector(`#edit-score-${index}-2`).value\n      }));\n      const change = {\n        number:Number($('#edit-bet-number').value),\n        date:$('#edit-bet-date').value,\n        stake:cents($('#edit-bet-stake').value),\n        odds:selectionEdits.map(item => item.odds),\n        selectionEdits,\n        status:statusInput.value\n      };\n      if (statusInput.value === 'cashout') change.cashoutPayout = cents($('#edit-cashout').value || '0');\n      accounts.editBet(bet.id,change);\n      account = accounts.current();\n      dialog.close();\n      renderProfile();\n      syncFeedControls();\n      showToast('Ставку оновлено');\n    } catch (problem) {\n      $('#form-error').textContent = problem.message || 'Не вдалося зберегти зміни';\n    } finally {\n      submit.disabled = false;\n    }\n  });\n\n  const restoreEditorWatch = () => {\n    if (linePollTimer) clearTimeout(linePollTimer);\n    if (sports?.feed?.watch) sports.feed.watch(priorEditorWatchIds);\n  };\n  dialog.addEventListener('close',restoreEditorWatch,{once:true});\n}\n\nconst themeLabels = {dark:'Темна',standard:'Стандартна',auto:'Авто'};\nfunction openTheme() {\n  let selected = getTheme();\n  openDialog('Виберіть вашу тему', `<p class=\"theme-description\">Виберіть бажану тему, щоб налаштувати інтерфейс</p><div class=\"theme-options\">${[['dark','moon','Темна тема для всіх розділів'],['standard','contrast','Світлий спорт, темне казино'],['auto','sun-moon','Відповідає налаштуванням вашого пристрою']].map(([value,symbol,description])=>`<label>${icon(symbol)}<span><strong>${themeLabels[value]}</strong><small>${description}</small></span><input type=\"radio\" name=\"theme\" value=\"${value}\" ${selected===value?'checked':''}></label>`).join('')}</div><button class=\"submit theme-save\">Зберегти</button>`);\n  dialog.classList.add('theme-sheet');\n  dialog.querySelectorAll('[name=theme]').forEach(input=>input.onchange=()=>{selected=input.value;});\n  dialog.querySelector('.theme-save').onclick=()=>{setTheme(selected);dialog.close(); if($('#site-menu')?.open)renderMenu();};\n}\nfunction renderMenu() {\n  $('#site-menu').innerHTML = `<div class=\"site-menu-head\"><strong>Меню</strong><button data-action=\"close-menu\" aria-label=\"Закрити\">${icon('x')}</button></div><div class=\"site-menu-content\"><div class=\"site-menu-sections\"><details><summary>Бонуси ${icon('chevron-down')}</summary><button data-action=\"menu-destination\" data-value=\"promotions\">Акції</button><button data-action=\"menu-destination\" data-value=\"bonuses\">Магазин бонусів</button></details><details><summary>Казино ${icon('chevron-down')}</summary><button data-action=\"menu-destination\" data-value=\"casino\">Казино</button></details><details><summary>Спорт ${icon('chevron-down')}</summary><button data-action=\"menu-destination\" data-value=\"live\">Лайв</button><button data-action=\"menu-destination\" data-value=\"prematch\">Прематч</button><button data-action=\"menu-destination\" data-value=\"bets\">Мої ставки</button></details></div><div class=\"site-menu-links\"><button data-action=\"menu-destination\" data-value=\"profile\"><span>Мій акаунт</span>${icon('arrow-up-right')}</button><button data-action=\"help\"><span>Служба підтримки</span>${icon('arrow-up-right')}</button><button data-action=\"language\"><span>Мова</span><span data-no-translate>${{uk:'Українська',ru:'Русский',en:'English'}[getLanguage()]}</span>${icon('chevrons-up-down')}</button><button class=\"menu-edit-bets\" role=\"switch\" aria-checked=\"${localStorage.getItem('arena-edit-bets') === 'on'}\" data-action=\"toggle-edit-bets\"><span>Редагувати ставки</span><span class=\"menu-toggle\" aria-hidden=\"true\"></span></button><button class=\"menu-theme\" data-action=\"theme\">${icon('moon')}<span>Вибрати тему<small>${themeLabels[getTheme()]}</small></span>${icon('chevron-right')}</button></div></div>`;\n  refreshIcons();\n}\nfunction openMenu() {\n  let menu = $('#site-menu');\n  if(!menu){menu=document.createElement('dialog');menu.id='site-menu';menu.setAttribute('aria-label','Меню');document.body.append(menu);}\n  $('#betslip').close(); renderMenu(); if(!menu.open)menu.showModal();\n}\nfunction passwordField(id, label, autocomplete) {\n  return `<label for=\"${id}\">${label}</label><div class=\"password\"><input id=\"${id}\" name=\"${id}\" type=\"password\" autocomplete=\"${autocomplete}\" required><button class=\"icon-button\" type=\"button\" data-action=\"visibility\" data-value=\"${id}\" aria-label=\"Показать пароль\">${icon('eye')}</button></div>`;\n}\nfunction openAuth(register = false, enterProfile = false, onSuccess = null) {\n  openDialog(register ? 'Регистрация' : 'Вход', `<form id=\"auth-form\"><p class=\"dialog-copy\">Аккаунт Arena Line. Не вводите данные от аккаунта Parik24.</p>${register ? '<label for=\"firstName\">Имя</label><input id=\"firstName\" name=\"firstName\" autocomplete=\"given-name\" maxlength=\"80\" required><label for=\"lastName\">Фамилия</label><input id=\"lastName\" name=\"lastName\" autocomplete=\"family-name\" maxlength=\"80\" required>' : ''}<label for=\"email\">E-mail</label><input id=\"email\" name=\"email\" type=\"email\" autocomplete=\"username\" required>${passwordField('password', 'Пароль', register ? 'new-password' : 'current-password')}<div id=\"form-error\" class=\"error\" role=\"alert\"></div><button class=\"submit\" type=\"submit\">${register ? 'Создать аккаунт' : 'Войти'}</button><button class=\"link-button\" type=\"button\" data-action=\"${register ? 'login' : 'register'}\">${register ? 'Уже есть аккаунт? Войти' : 'Регистрация'}</button></form>`);\n  $('#auth-form').addEventListener('submit', async event => {\n    event.preventDefault();\n    const form = event.currentTarget, submit = form.querySelector('[type=submit]'), error = $('#form-error');\n    submit.disabled = true; error.textContent = '';\n    try {\n      const data = Object.fromEntries(new FormData(form));\n      if (register) await accounts.signUp(data); else await accounts.signIn(data.email, data.password);\n      form.reset(); dialog.close(); syncFeedControls();\n      if (enterProfile) openProfile();\n      onSuccess?.();\n      showToast('Вы вошли в аккаунт');\n    } catch (problem) { error.textContent = problem instanceof DOMException ? 'Разрешите хранение данных сайта в браузере' : problem.message; }\n    finally { submit.disabled = false; }\n  });\n  $('#auth-form .link-button').addEventListener('click', event => {\n    event.stopPropagation(); openAuth(!register, enterProfile, onSuccess);\n  });\n}\nfunction openTransfer(type) {\n  account = getAccount();\n  if (!account) { openAuth(); return; }\n  const deposit = type === 'deposit';\n  openDialog(deposit ? 'Пополнить счёт' : 'Вывести', `<form id=\"transfer-form\"><p class=\"dialog-copy\">${deposit ? 'Добавление' : 'Списание'} виртуальных средств. Реального перевода денег не будет.</p><p>Баланс: <strong>${money(account.balance)} €</strong></p><label for=\"amount\">Сумма, €</label><input id=\"amount\" name=\"amount\" inputmode=\"decimal\" autocomplete=\"off\" placeholder=\"0,00\" required><div id=\"form-error\" class=\"error\" role=\"alert\"></div><button class=\"submit green\" type=\"submit\">Продолжить</button></form>`);\n  $('#transfer-form').addEventListener('submit', event => {\n    event.preventDefault();\n    try { accounts.transfer(type, cents($('#amount').value)); dialog.close(); syncFeedControls(); if (!$('#profile-layer').hidden) renderProfile(); showToast('Баланс обновлён'); }\n    catch (problem) { $('#form-error').textContent = problem.message; }\n  });\n}\nfunction openPassword() {\n  openDialog('Изменить пароль', `<form id=\"password-form\">${passwordField('oldPassword', 'Текущий пароль', 'current-password')}${passwordField('newPassword', 'Новый пароль', 'new-password')}<div id=\"form-error\" class=\"error\" role=\"alert\"></div><button class=\"submit\" type=\"submit\">Сохранить</button></form>`);\n  $('#password-form').addEventListener('submit', async event => {\n    event.preventDefault(); const submit = event.currentTarget.querySelector('[type=submit]'); submit.disabled = true;\n    try { await accounts.password($('#oldPassword').value, $('#newPassword').value); dialog.close(); showToast('Пароль изменён'); }\n    catch (problem) { $('#form-error').textContent = problem.message; }\n    finally { submit.disabled = false; }\n  });\n}\n\ndocument.addEventListener('click', async event => {\n  const control = event.target.closest('[data-action]');\n  if (!control) return;\n  const { action, value } = control.dataset;\n  if (action === 'login') openAuth(false);\n  else if (action === 'register') openAuth(true);\n  else if (action === 'profile') openProfile();\n  else if (action === 'close-profile') closeProfile();\n  else if (action === 'profile-search') { closeProfile(); sports.click('sports-search'); }\n  else if (action === 'profile-casino') { closeProfile(); sports.click('sports-page', 'casino'); }\n  else if (action === 'notifications') openDialog('Уведомления', empty('bell', 'Новых уведомлений нет'));\n  else if (action === 'profile-view') { profileView = value; renderProfile(); $('#profile-content').scrollTop = 0; }\n  else if (action === 'close-dialog') dialog.close();\n  else if (action === 'deposit' || action === 'withdraw') openTransfer(action);\n  else if (action === 'password') openPassword();\n  else if (action === 'language') openLanguage();\n  else if (action === 'theme') openTheme();\n  else if (action === 'open-menu') openMenu();\n  else if (action === 'close-menu') $('#site-menu').close();\n  else if (action === 'menu-destination') {\n    $('#site-menu').close();\n    if(['live','prematch'].includes(value)){closeProfile();sports.click('sports-home');sports.click('sports-stage',value);}\n    else if(value==='casino'){closeProfile();sports.click('sports-page','casino');}\n    else {openProfile(); if(getAccount()){profileView=value;renderProfile();}}\n  }\n  else if (action === 'logout') { accounts.signOut(); account = null; closeProfile(); showToast('Вы вышли из аккаунта'); }\n  else if (action === 'toggle-edit-bets') {\n    localStorage.setItem('arena-edit-bets', localStorage.getItem('arena-edit-bets') === 'on' ? 'off' : 'on');\n    renderMenu(); if (!$('#profile-layer').hidden) renderProfile();\n  }\n  else if (action === 'edit-bet') {\n    if (localStorage.getItem('arena-edit-bets') !== 'on') return;\n    openEditBet(value);\n  }\n  else if (action === 'duplicate-bet') {\n    if (localStorage.getItem('arena-edit-bets') !== 'on') return;\n    try {\n      accounts.duplicateBet(value);\n      account = accounts.current();\n      if (dialog.open) dialog.close();\n      renderProfile();\n      syncFeedControls();\n      showToast('Ставку продубльовано');\n    } catch (problem) {\n      const error = $('#form-error');\n      if (error && dialog.open) error.textContent = problem.message || 'Не вдалося продублювати ставку';\n      else showToast(problem.message || 'Не вдалося продублювати ставку');\n    }\n  }\n  else if (action === 'delete-bet') {\n    if (localStorage.getItem('arena-edit-bets') !== 'on') return;\n    if (accounts.hideBet(value)) {\n      account = accounts.current();\n      if (dialog.open) dialog.close();\n      renderProfile();\n      syncFeedControls();\n      showToast('Ставку приховано');\n    }\n  }\n  else if (action === 'bet-tab') { betTab = value; renderProfile(); }\n  else if (action === 'open-bet-detail') {\n    selectedBetId = value;\n    profileView = 'bet-detail';\n    renderProfile();\n    $('#profile-content').scrollTop = 0;\n  }\n  else if (action === 'back-to-bets') {\n    profileView = 'bets';\n    selectedBetId = null;\n    renderProfile();\n    $('#profile-content').scrollTop = 0;\n  }\n  else if (action === 'bet-event') {\n    const split = value.lastIndexOf(':'), bet = getAccount()?.bets.find(bet => bet.id === value.slice(0,split));\n    const selection = bet?.selections[Number(value.slice(split+1))];\n    if (selection) { closeProfile(); sports.openEvent(selection.eventId, { ...selection, date:bet.date }); }\n  }\n  else if (action === 'repeat-bet') {\n    const bet = getAccount()?.bets.find(bet => bet.id === value);\n    if (bet) { closeProfile(); sports.repeatBet(bet); }\n  }\n  else if (action === 'share-bet') {\n    const bet = getAccount()?.bets.find(bet => bet.id === value);\n    if (!bet) return;\n    openShareCoupon(bet, showToast);\n  }\n  else if (action === 'copy') { try { await navigator.clipboard.writeText(account.id); showToast('Номер счёта скопирован'); } catch { showToast('Не удалось скопировать'); } }\n  else if (action === 'visibility') {\n    const input = document.getElementById(value), visible = input.type === 'password';\n    input.type = visible ? 'text' : 'password'; control.innerHTML = icon(visible ? 'eye-off' : 'eye'); control.setAttribute('aria-label', visible ? 'Скрыть пароль' : 'Показать пароль'); refreshIcons();\n  } else if (action === 'help') openDialog('Профиль', '<p class=\"dialog-copy\">Личный профиль Arena Line с виртуальным балансом. Он не является аккаунтом Parik24.</p>');\n});\n\ndialog.addEventListener('click', event => {\n  if (event.target !== dialog) return;\n  const box = dialog.getBoundingClientRect();\n  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();\n});\ndocument.addEventListener('change',event=>{\n  if(event.target.id==='settlement-notifications')localStorage.setItem('arena-settlement-notifications',event.target.checked?'on':'off');\n  if(event.target.id==='default-stage')localStorage.setItem('arena-default-stage',event.target.value);\n  if(event.target.id==='match-sort'){localStorage.setItem('arena-match-sort',event.target.value);sports.renderLine();}\n});\ndocument.addEventListener('submit',event=>{if(event.target.id==='feedback-form'){event.preventDefault();localStorage.setItem('arena-feedback-v1',$('#feedback-text').value);showToast('Відгук збережено на цьому пристрої');}});\nwindow.addEventListener('storage', () => { syncFeedControls(); if (!$('#profile-layer').hidden) renderProfile(); });\napplyTheme();\nsports = new SportsApp({ openMenu, accounts, getAccount, openAuth, openProfile, openBets, onBalanceChange: syncFeedControls, showToast });\nsyncFeedControls();\nwindow.__arenaClientDiagnostic?.('CLIENT_BOOT_OK','Arena app initialized',{language:getLanguage(),hasSports:Boolean(sports)});\naccounts.syncCurrentFromServer().then(() => {\n  syncFeedControls();\n  if (!$('#profile-layer').hidden) renderProfile();\n}).catch(() => {});\nwindow.addEventListener('focus', () => {\n  accounts.syncCurrentFromServer().then(() => {\n    syncFeedControls();\n    if (!$('#profile-layer').hidden) renderProfile();\n  }).catch(() => {});\n});\nconst profileSyncTimer = setInterval(() => {\n  if (document.visibilityState !== 'visible' || !getAccount()) return;\n  accounts.syncCurrentFromServer().then(() => {\n    syncFeedControls();\n    if (!$('#profile-layer').hidden) renderProfile();\n  }).catch(() => {});\n}, 5000);\ndocument.addEventListener('visibilitychange', () => {\n  if (document.visibilityState === 'visible') accounts.syncCurrentFromServer().then(syncFeedControls).catch(() => {});\n});\nstartTranslations();\nwindow.addEventListener('arena-language-change',()=>{if($('#site-menu')?.open)renderMenu();if(!$('#profile-layer').hidden)renderProfile();sports.feed.close();sports.feed.connect();sports.renderTabs();sports.renderLine();sports.renderSlip();});\nif (location.hash === '#profile') account ? openProfile() : openAuth(false, true);\nif (location.hash.startsWith('#event/')) sports.openEvent(decodeURIComponent(location.hash.slice(7)));\nif ('serviceWorker' in navigator) {\n  // Runtime assets are versioned by path. Remove legacy workers/caches only after the app\n  // is already running so cache maintenance can never block the interface again.\n  queueMicrotask(() => {\n    navigator.serviceWorker.getRegistrations()\n      .then(registrations => Promise.all(registrations.map(registration => registration.unregister())))\n      .catch(() => {});\n    if ('caches' in window) {\n      caches.keys()\n        .then(keys => Promise.all(keys.filter(key => key.startsWith('arena-line-')).map(key => caches.delete(key))))\n        .catch(() => {});\n    }\n  });\n}\n";
const betViewModule = "import { icon, graphic } from './ui.mjs';\nimport { getLanguage, getLocale, t } from './i18n.mjs';\n\nexport const esc = value => String(value ?? '').replace(/[&<>\"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '\"':'&quot;', \"'\":'&#39;' }[char]));\nexport const amount = value => {\n  const cents = Math.round(Number(value) || 0);\n  const sign = cents < 0 ? '-' : '';\n  const absolute = Math.abs(cents);\n  const major = String(Math.floor(absolute / 100)).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ' ');\n  const minor = String(absolute % 100).padStart(2, '0');\n  return `${sign}${major}.${minor} €`;\n};\nconst date = value => new Date(value).toLocaleString(getLocale(), { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });\nconst games = { CSGO:'counter-strike', CS:'counter-strike', DOTA2:'dota', LOL:'lol', F:'football', T:'tennis', TT:'table-tennis', H:'hockey', B:'basketball', VB:'volleyball', PL:'snooker' };\n\nfunction outcomesLabel(count) {\n  const language = getLanguage();\n  if (language === 'en') return `${count} ${count === 1 ? 'selection' : 'selections'}`;\n  if (language === 'uk') {\n    const mod10 = count % 10, mod100 = count % 100;\n    const word = mod10 === 1 && mod100 !== 11 ? 'результат' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'результати' : 'результатів';\n    return `${count} ${word}`;\n  }\n  const mod10 = count % 10, mod100 = count % 100;\n  const word = mod10 === 1 && mod100 !== 11 ? 'исход' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'исхода' : 'исходов';\n  return `${count} ${word}`;\n}\n\nfunction compactOdds(bet) {\n  const value = Number(bet?.odds);\n  if (!Number.isFinite(value)) return '';\n  return value.toFixed(4).replace(/0+$/,'').replace(/\\.$/,'');\n}\n\nfunction compactBetSummary(bet) {\n  const state = ['won','lost','void','cashout'].includes(bet.status) ? bet.status : 'open';\n  const iconName = state === 'won' ? 'check' : state === 'lost' ? 'x' : state === 'cashout' ? 'undo-2' : state === 'void' ? 'minus' : 'clock-3';\n  return `<button type=\"button\" class=\"bet-selection-summary bet-multi-summary\" data-action=\"open-bet-detail\" data-value=\"${esc(bet.id)}\"><span class=\"bet-result result-${esc(state)}\">${icon(iconName)}</span><span class=\"bet-selection-label\"><strong>${esc(outcomesLabel(bet.selections?.length || 0))}</strong></span><span class=\"bet-coefficient\">${esc(compactOdds(bet))}</span>${icon('chevron-right','bet-multi-chevron')}</button>`;\n}\n\nfunction expandedMultiSelection(selection, bet, index) {\n  const result = selection.settlement;\n  const state = bet.status === 'cashout' ? 'cashout' : result?.status;\n  const resultIcon = state === 'won' ? 'check' : state === 'lost' ? 'x' : state === 'cashout' ? 'undo-2' : state === 'void' ? 'minus' : '';\n  const sportName = selection.sport === 'CS' || !games[selection.sport] || ['CSGO','DOTA2','LOL'].includes(selection.subsport) ? 'esports' : games[selection.sport];\n  const eventDate = date(selection.startTime ? selection.startTime * 1000 : bet.date);\n  const detail = `${eventDate} ${selection.eventName || ''}`;\n  return `<button class=\"bet-multi-event\" data-action=\"bet-event\" data-value=\"${esc(bet.id)}:${index}\">\n    <span class=\"bet-multi-sport\">${graphic(sportName)}</span>\n    <span class=\"bet-multi-copy\"><strong>${esc(t(selection.marketName))} ${esc(t(selection.label))}</strong><small>${esc(detail)}</small></span>\n    <span class=\"bet-multi-right\"><b class=\"${state ? `state-${esc(state)}` : ''}\">${Number(selection.odds.toFixed(2))}</b>${state ? `<span class=\"bet-result result-${esc(state)}\">${icon(resultIcon)}</span>` : ''}</span>\n  </button>`;\n}\n\nfunction selectionRow(selection, bet, index) {\n  const result = selection.settlement;\n  const state = bet.status === 'cashout' ? 'cashout' : result?.status;\n  const teams = selection.competitors?.length ? selection.competitors : selection.eventName.split(' - ').map(name => ({ name }));\n  const score = result?.score;\n  const resultIcon = state === 'won' ? 'check' : state === 'lost' ? 'x' : state === 'cashout' ? 'undo-2' : 'minus';\n  const symbol = state\n    ? `<span class=\"bet-result result-${esc(state)}\">${icon(resultIcon)}</span>`\n    : `<span class=\"bet-sport\">${graphic(selection.sport === 'CS' || !games[selection.sport] || ['CSGO','DOTA2','LOL'].includes(selection.subsport) ? 'esports' : games[selection.sport])}</span>`;\n\n  const rawPeriods = Array.isArray(result?.periods) ? result.periods : [];\n  // Old manually edited bets stored the final score as both score and \"period 1\".\n  // Treat that as one final result so history matches the original bookmaker layout.\n  const duplicateManualPeriod = result?.manual && rawPeriods.length === 1 && Array.isArray(score) &&\n    Array.isArray(rawPeriods[0]) && score.length >= 2 && rawPeriods[0].length >= 2 &&\n    Number(rawPeriods[0][0]) === Number(score[0]) && Number(rawPeriods[0][1]) === Number(score[1]);\n  const periods = duplicateManualPeriod ? [] : rawPeriods;\n\n  return `<section class=\"bet-selection\"><button class=\"bet-selection-summary\" data-action=\"bet-event\" data-value=\"${esc(bet.id)}:${index}\">${symbol}<span class=\"bet-selection-label\"><span class=\"meta\">${esc(t(selection.marketName))}</span><strong>${esc(t(selection.label))}</strong></span><span class=\"bet-coefficient\">${Number(selection.odds.toFixed(2))}</span>${icon('chevron-right')}</button><div class=\"bet-event-time\">${esc(date(selection.startTime ? selection.startTime * 1000 : bet.date))}</div><div class=\"bet-teams\">${periods.length ? `<div class=\"bet-period-labels\"><span></span><span>${periods.map((_,i) => `<small>${i+1}</small>`).join('')}<small></small></span></div>` : ''}${teams.map((team,i) => `<div><span>${esc(team.name)}</span>${score ? `<span class=\"bet-team-score\">${periods.map(period => `<small>${esc(period[i])}</small>`).join('')}<b>${esc(score[i] ?? '')}</b></span>` : ''}</div>`).join('')}</div></section>`;\n}\n\nexport function betHistory(account, tab, editing = false) {\n  const settled = tab === 'settled';\n  const visible = account.bets.filter(bet => !bet.hidden).sort((a,b) => Number(b.number || 0) - Number(a.number || 0) || new Date(b.date) - new Date(a.date));\n  const entries = visible.filter(bet => settled ? bet.status !== 'open' : bet.status === 'open');\n\n  const tabs = `<div class=\"tabs bet-history-tabs\" role=\"tablist\"><button role=\"tab\" aria-selected=\"${!settled}\" class=\"${!settled ? 'active' : ''}\" data-action=\"bet-tab\" data-value=\"open\">${esc(t('Нерозраховані'))}</button><button role=\"tab\" aria-selected=\"${settled}\" class=\"${settled ? 'active' : ''}\" data-action=\"bet-tab\" data-value=\"settled\">${esc(t('Розраховані'))}</button></div>`;\n\n  const cards = entries.map(bet => {\n    const paymentLabel = !settled ? t('Можлива виплата') : bet.status === 'cashout' ? t('Виведено') : t('Виплата');\n    const multi = bet.type === 'express' || bet.type === 'system' || (bet.selections?.length || 0) > 1;\n    const body = multi\n      ? compactBetSummary(bet)\n      : bet.selections.map((selection,index) => selectionRow(selection,bet,index)).join('');\n    return `<article class=\"bet-record${multi ? ' bet-record-multi' : ''}\" data-bet-id=\"${esc(bet.id)}\"><div class=\"bet-record-date\">№${esc(bet.number || (visible.length - visible.indexOf(bet)))} · ${esc(date(bet.date))}</div>${body}<dl class=\"bet-payment\"><div><dt>${esc(t('Сума ставки'))}</dt><dd>${amount(bet.cost)}</dd></div><div class=\"${settled && bet.payout > 0 ? 'positive' : ''}\"><dt>${esc(paymentLabel)}</dt><dd>${amount(settled ? bet.payout : bet.potential)}</dd></div></dl><div class=\"bet-record-actions\">${editing ? `<button class=\"edit-bet\" data-action=\"edit-bet\" data-value=\"${esc(bet.id)}\">${icon('pencil')}${esc(t('Редагувати'))}</button>` : ''}${!settled ? `<button data-action=\"repeat-bet\" data-value=\"${esc(bet.id)}\">${icon('rotate-cw')}${esc(t('Повторити'))}</button>` : ''}<button type=\"button\" class=\"bet-record-share\" data-action=\"share-bet\" data-value=\"${esc(bet.id)}\" aria-label=\"${esc(t('Поділитися ставкою'))}\">${icon('share')}${esc(t('Поділитися'))}</button></div></article>`;\n  }).join('');\n\n  return `${tabs}<div class=\"bet-records\">${cards || `<div class=\"empty\">${icon('ticket')}<h2>${esc(t(settled ? 'Розрахованих ставок ще немає' : 'Нерозрахованих ставок немає'))}</h2></div>`}</div>`;\n}\n\n\nexport function betDetail(account, betId) {\n  const bet = account?.bets?.find(item => String(item.id) === String(betId) && !item.hidden);\n  if (!bet) return `<div class=\"empty\">${icon('ticket')}<h2>${esc(t('Ставка не знайдена'))}</h2><button data-action=\"back-to-bets\">${esc(t('Мої ставки'))}</button></div>`;\n\n  const typeLabel = bet.type === 'system' ? t('Система') : t('Експрес');\n  const settled = bet.status !== 'open';\n  const paymentLabel = !settled ? t('Можлива виплата') : bet.status === 'cashout' ? t('Повернення') : t('Виплата');\n  const paymentValue = settled ? bet.payout : bet.potential;\n  const positive = Number(paymentValue || 0) > 0;\n\n  return `\n    <div class=\"bet-detail-page\">\n      <div class=\"bet-detail-head\">\n        <button class=\"bet-detail-back\" data-action=\"back-to-bets\" aria-label=\"${esc(t('Назад'))}\">${icon('chevron-left')}</button>\n        <div class=\"bet-detail-title\"><strong>${esc(typeLabel)} №${esc(bet.number || '')}</strong><span>${esc(date(bet.date))}</span></div>\n        <span class=\"bet-detail-head-spacer\"></span>\n      </div>\n\n      <div class=\"bet-detail-scroll\">\n        <div class=\"bet-detail-selections\">\n          ${bet.selections.map((selection,index) => selectionRow(selection,bet,index)).join('')}\n        </div>\n      </div>\n\n      <div class=\"bet-detail-footer\">\n        <dl>\n          <div><dt>${esc(t('Сума ставки'))}</dt><dd>${amount(bet.cost)}</dd></div>\n          <div><dt>${esc(t('Загальний коефіцієнт'))}</dt><dd>${esc(compactOdds(bet))}</dd></div>\n          <div class=\"${positive ? 'positive' : ''}\"><dt>${esc(paymentLabel)}</dt><dd>${amount(paymentValue)}</dd></div>\n        </dl>\n        <button type=\"button\" class=\"bet-detail-share\" data-action=\"share-bet\" data-value=\"${esc(bet.id)}\">${icon('share')}${esc(t('Поділитися'))}</button>\n      </div>\n    </div>\n  `;\n}\n";
const eventViewModule = "import { teamEmblem } from './team-emblem.mjs';\nimport { getLocale } from './i18n.mjs';\nimport { icon, graphic } from './ui.mjs';\nimport { esc } from './bet-view.mjs';\nimport { periodName, MARKET_NAMES } from './feed.mjs';\nimport { parseScore } from './settlement.mjs';\nconst sports = { CS:'Кіберспорт', F:'Футбол', T:'Теніс', TT:'Настільний теніс', H:'Хокей', B:'Баскетбол', VB:'Волейбол', PL:'Снукер' };\nconst games = { 'Counter-Strike':'counter-strike', 'Dota 2':'dota', 'League of Legends':'lol' };\nconst scoreTypes = { CS:[1006,1], F:[1,4], T:[1009,1], TT:[1009,1], H:[1,5], B:[1010,8], VB:[1009,1], PL:[1001,1] };\nconst dateText = value => new Date(value).toLocaleString(getLocale(), { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });\nconst isTeam = (candidate, team) => team.id && candidate.id ? String(candidate.id) === String(team.id) : candidate.name?.trim() === team.name?.trim();\nconst includesTeam = (row, team) => row.competitors?.some(candidate => isTeam(candidate, team));\n\nexport function eventHeader(app, event) {\n  const completed=completedResult(app,event);\n  if(completed){\n    return `<div class=\"event-header-inner completed-event-header-inner\"><button data-action=\"sports-event-back\" aria-label=\"Назад\">${icon('chevron-left')}</button><div class=\"event-heading\"><h1>${esc(sports[event.sport] || 'Спорт')}</h1></div><button data-action=\"sports-event-alert\" aria-label=\"Сповіщення про матч\">${icon('bell')}</button></div>`;\n  }\n  return `<div class=\"event-header-inner\"><button data-action=\"sports-event-back\" aria-label=\"Назад\">${icon('chevron-left')}</button><div class=\"event-heading\"><h1>${esc(sports[event.sport] || 'Спорт')}</h1><p>${esc([event.categoryName, event.tournamentName].filter(Boolean).join('. '))}</p></div><button class=\"favorite ${app.favorites.has(app.detailId) ? 'selected' : ''}\" data-action=\"sports-favorite\" data-value=\"${esc(app.detailId)}\" aria-label=\"Вибране\">${icon('star')}</button><button data-action=\"sports-event-alert\" aria-label=\"Сповіщення про матч\">${icon('bell')}</button></div>`;\n}\n\nfunction form(history, team) {\n  return history.filter(row => includesTeam(row, team)).slice(0,5).map(row => {\n    const competitor = row.competitors.find(candidate => isTeam(candidate,team));\n    const drawn = row.competitors.length === 2 && row.competitors[0].score === row.competitors[1].score;\n    const state = competitor.isWinner ? 'W' : drawn ? 'D' : 'L';\n    return `<span class=\"form-${state}\" title=\"${esc(row.name)}\">${state}</span>`;\n  }).join('');\n}\n\nfunction parsedSavedResult(result) {\n  if (!result) return null;\n  const total = Array.isArray(result.score) && result.score.length >= 2\n    ? result.score.slice(0,2).map(Number)\n    : null;\n  let periods = Array.isArray(result.periods)\n    ? result.periods.filter(row => Array.isArray(row) && row.length >= 2).map(row => row.slice(0,2).map(Number))\n    : [];\n  const duplicateManual = result.manual && periods.length === 1 && total &&\n    periods[0][0] === total[0] && periods[0][1] === total[1];\n  if (duplicateManual) periods = [];\n  return {\n    confirmed:true,\n    saved:true,\n    scoreText:total ? total.join('-') : '',\n    score:total,\n    periods,\n    winnerIndex:result.winnerIndex,\n    status:result.status,\n    source:result.source || 'saved-bet'\n  };\n}\n\nfunction completedResult(app,event) {\n  return app.results.results.get(String(app.detailId)) || parsedSavedResult(event.settlement);\n}\n\nfunction completedScore(result) {\n  if (!result) return {total:null,periods:[]};\n  const total = Array.isArray(result.score) && result.score.length >= 2\n    ? result.score.slice(0,2).map(Number)\n    : (() => {\n        const match=/^(\\d+)-(\\d+)/.exec(String(result.scoreText || ''));\n        return match ? [Number(match[1]),Number(match[2])] : null;\n      })();\n  let periods = Array.isArray(result.periods)\n    ? result.periods.filter(row => Array.isArray(row) && row.length >= 2).map(row => row.slice(0,2).map(Number))\n    : [];\n  if (!periods.length) {\n    const match=/\\((\\d+-\\d+(?:,\\s*\\d+-\\d+)*)\\)/.exec(String(result.scoreText || ''));\n    if (match) periods=match[1].split(/,\\s*/).map(row=>row.split('-').map(Number));\n  }\n  if (!periods.length && total && Number.isFinite(total[0]) && Number.isFinite(total[1])) {\n    const played=Math.max(0,Math.min(5,Number(total[0])+Number(total[1])));\n    if(played) periods=Array.from({length:played},()=>[null,null]);\n  }\n  return {total,periods};\n}\n\nfunction resultTable(event,result) {\n  const teams=(event.competitors || []).slice(0,2);\n  const {total,periods}=completedScore(result);\n  const cols=periods.map((_,index)=>`<span>${index+1}</span>`).join('');\n  return `<div class=\"completed-score-table\">\n    <div class=\"completed-score-head\"><span></span><div>${cols}<b>T</b></div></div>\n    ${teams.map((team,index)=>`<div class=\"completed-score-row\"><span>${esc(team.name || '')}</span><div>${periods.map(period=>`<small>${esc(period[index] ?? '—')}</small>`).join('')}<b>${esc(total?.[index] ?? '—')}</b></div></div>`).join('')}\n  </div>`;\n}\n\nfunction completedOverview(app,event,result) {\n  const teams=(event.competitors || []).slice(0,2);\n  const {total}=completedScore(result);\n  const scoreText=total ? total.join(':') : '—:—';\n  return `<section class=\"completed-match-card\">\n    <nav class=\"completed-match-tabs\">\n      <button class=\"active\" type=\"button\" aria-label=\"Рахунок\"><span class=\"completed-score-pill\">${esc(scoreText)}</span></button>\n      <button type=\"button\" data-action=\"sports-event-tab\" data-value=\"h2h\">H2H</button>\n    </nav>\n    <div class=\"completed-match-scoreboard\">\n      ${teams.map((team,index)=>`<div class=\"completed-team team-${index}\">\n        <span class=\"completed-team-emblem\">${teamEmblem({...team,categoryName:team.categoryName || event.categoryName || event.sport})}</span>\n        <strong>${esc(team.name || '')}</strong>\n      </div>`).join('')}\n      <div class=\"completed-center\"><span>ЗАВЕРШЕНО</span><b>${esc(scoreText)}</b></div>\n    </div>\n    ${resultTable(event,result)}\n  </section>`;\n}\n\nfunction overview(app, event, completed) {\n  const teams = event.competitors || [], history = app.detailHistory || [];\n  const [type, period] = scoreTypes[event.sport] || [];\n  const savedScore=completedScore(completed).total;\n  const score = completed ? savedScore : event.scoreboard?.scores?.find(row => row.periodScoreType === type && row.period === period)?.score?.split('-');\n  const h2h = history.filter(row => teams.length === 2 && teams.every(team => includesTeam(row,team)));\n  const wins = teams.map(team => h2h.filter(row => row.competitors.some(candidate => isTeam(candidate,team) && candidate.isWinner)).length);\n  const today = event.startTime && new Date(event.startTime * 1000).toDateString() === new Date().toDateString();\n  const subtitle = completed ? 'ЗАВЕРШЕНО' : event.stage === 2 ? app.status(event) : today ? 'СЬОГОДНІ' : event.startTime ? new Date(event.startTime * 1000).toLocaleDateString(getLocale(), { day:'2-digit',month:'short' }) : '';\n  const center = score?.length ? score.join(' : ') : event.startTime ? new Date(event.startTime * 1000).toLocaleTimeString(getLocale(), { hour:'2-digit', minute:'2-digit' }) : '—';\n  return `<section class=\"event-scoreboard\">${teams.slice(0,2).map((team,i) => `<div class=\"event-team team-${i}\"><span class=\"event-team-emblem\">${teamEmblem({...team,categoryName:team.categoryName || event.categoryName || event.sport})}</span><div>${esc(team.name)}</div><div class=\"event-form\">${form(history,team)}</div></div>`).join('')}<div class=\"event-score-center\"><span class=\"event-kickoff ${event.stage === 2 && !completed ? 'live-text' : ''}\">${esc(subtitle)}</span><strong>${esc(center)}</strong>${h2h.length ? `<div class=\"event-h2h-count\"><span>${wins[0]}<small>W</small></span><span>${h2h.length-wins[0]-wins[1]}<small>D</small></span><span>${wins[1]}<small>W</small></span></div>` : ''}</div></section>`;\n}\n\nfunction historyRows(rows) {\n  return rows.map(row => `<div class=\"h2h-row\"><div class=\"h2h-date\">${esc(dateText(row.startTime))}<small>${esc(row.tournament || '')}</small></div><div class=\"h2h-teams\">${row.competitors.map(team => `<div class=\"${team.isWinner ? 'h2h-winner' : ''}\"><span>${esc(team.name)}</span><b>${esc(team.score ?? '—')}</b></div>`).join('')}</div></div>`).join('');\n}\n\nfunction headToHead(app, event) {\n  if (app.detailHistoryState === 'loading') return '<div class=\"event-data-state\"><span class=\"spinner\"></span>Завантаження історії зустрічей</div>';\n  if (app.detailHistoryState === 'error') return '<div class=\"event-data-state\">Історія зустрічей тимчасово недоступна.<button data-action=\"sports-event-retry\">Оновити</button></div>';\n  const history = app.detailHistory || [], teams = event.competitors || [];\n  const h2h = history.filter(row => teams.length === 2 && teams.every(team => includesTeam(row,team)));\n  return `<section class=\"event-history-block\"><h2>Особисті зустрічі</h2>${h2h.length ? historyRows(h2h) : '<p class=\"event-data-state\">В історії джерела немає особистих зустрічей цих команд.</p>'}</section>${teams.map(team => `<section class=\"event-history-block\"><h2>${esc(team.name)} · останні матчі</h2>${historyRows(history.filter(row => includesTeam(row,team)).slice(0,5)) || '<p class=\"event-data-state\">Історія поки недоступна</p>'}</section>`).join('')}`;\n}\n\nfunction oddsOverview(app, picks) {\n  const main = picks.filter(pick => pick.period === 0 && [1,2].includes(pick.marketType));\n  return `<section class=\"odds-overview\"><h2>Огляд коефіцієнтів</h2>${main.length ? `<table><thead><tr><th>Результат</th><th>При відкритті</th><th>Зараз</th></tr></thead><tbody>${main.map(pick => {\n    const first = app.detailOdds.get(pick.id)?.[0]?.odds ?? pick.odds;\n    return `<tr><th>${esc(pick.label)}</th><td>${first.toFixed(2)}</td><td class=\"${pick.odds > first ? 'positive' : pick.odds < first ? 'live-text' : ''}\">${app.oddButton(pick)}</td></tr>`;\n  }).join('')}</tbody></table><p class=\"odds-history-note\">Зміни з моменту відкриття цієї сторінки. Поточні коефіцієнти оновлюються з лінії.</p>` : '<p class=\"event-data-state\">Для цього матчу зараз немає доступних коефіцієнтів.</p>'}</section>`;\n}\n\nexport function eventPage(app, event) {\n  const completed = completedResult(app,event);\n  const picks = completed ? [] : app.feed.selections(app.detailId);\n  for (const pick of picks) {\n    const history = app.detailOdds.get(pick.id) || [];\n    if (history.at(-1)?.odds !== pick.odds) history.push({ time:Date.now(), odds:pick.odds });\n    if (history.length > 200) history.splice(1,1);\n    app.detailOdds.set(pick.id, history);\n  }\n  const tabs = `<nav class=\"event-view-tabs\" role=\"tablist\" aria-label=\"Інформація про матч\">${[['overview','Огляд матчу',icon('sports-score')],['h2h','H2H','H2H'],['odds','Огляд коефіцієнтів',icon('chart-no-axes-combined')]].map(([value,label,content]) => `<button role=\"tab\" aria-label=\"${label}\" aria-selected=\"${app.detailTab === value}\" class=\"${app.detailTab === value ? 'active' : ''}\" data-action=\"sports-event-tab\" data-value=\"${value}\">${content}</button>`).join('')}</nav>`;\n  const periods = [...new Set(picks.map(pick => pick.period).filter(Boolean))].sort((a,b) => a-b);\n  const filters = [['all','Всі'],['main','Основне'],...periods.map(period => [String(period),periodName(event.sport,period)])];\n  const filtered = picks.filter(pick => app.detailFilter === 'all' || app.detailFilter === 'main' && pick.period === 0 || String(pick.period) === app.detailFilter);\n  const groups = new Map();\n  for (const pick of filtered) {\n    const key = `${pick.marketType}:${pick.period}`;\n    if (!groups.has(key)) groups.set(key, []);\n    groups.get(key).push(pick);\n  }\n  const markets = [...groups].map(([key, group]) => {\n    const rows = new Map();\n    for (const pick of group) { const line = JSON.stringify(pick.parameters); if (!rows.has(line)) rows.set(line, []); rows.get(line).push(pick); }\n    const closed = app.detailCollapsed.has(key);\n    return `<section class=\"event-market\"><button class=\"event-market-heading\" data-action=\"sports-event-market\" data-value=\"${key}\" aria-expanded=\"${!closed}\"><h2>${esc(app.detailFilter === 'all' ? group[0].marketName : MARKET_NAMES[group[0].marketType])}</h2>${icon(closed ? 'chevron-down' : 'chevron-up')}</button>${closed ? '' : [...rows.values()].map(row => `<div class=\"outcomes\">${row.map(pick => app.oddButton(pick)).join('')}</div>`).join('')}</section>`;\n  }).join('');\n  if (completed) {\n    const content = app.detailTab === 'h2h' ? headToHead(app,event) : completedOverview(app,event,completed);\n    return `<div class=\"event-page completed-event-page\">${content}</div>`;\n  }\n  const content = app.detailTab === 'h2h' ? headToHead(app,event) : app.detailTab === 'odds' ? oddsOverview(app,picks) : overview(app,event,completed);\n  return `<div class=\"event-page\"><button class=\"all-events-link\" data-action=\"sports-event-back\">Всі події ${icon('chevron-down')}</button>${tabs}${content}<nav class=\"event-market-filters\" aria-label=\"Ринки матчу\">${filters.map(([value,label]) => `<button class=\"${value === app.detailFilter ? 'active' : ''}\" data-action=\"sports-event-filter\" data-value=\"${value}\">${esc(label)}</button>`).join('')}</nav><div class=\"event-markets\">${markets || `<div class=\"event-data-state\">${app.feed.fresh ? 'Ринки цього матчу зараз недоступні' : 'Завантаження коефіцієнтів…'}</div>`}</div></div>`;\n}\n";
const shareCouponModule = "import { icon } from './ui.mjs';\nimport { amount } from './bet-view.mjs';\nimport { t, getLocale } from './i18n.mjs';\n\nconst date = value => new Date(value).toLocaleString(getLocale(), {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});\nconst games = { CSGO:'counter-strike', CS:'counter-strike', DOTA2:'dota', LOL:'lol', F:'football', T:'tennis', TT:'table-tennis', H:'hockey', B:'basketball', VB:'volleyball', PL:'snooker' };\nconst imageCache = new Map();\nconst ESPORTS_CONTROLLER_DATA='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAAA4CAMAAAB6xg5AAAABgFBMVEXc5Nvb3N6u3d/i4+WqqqqknqCwxMQAAADm5+coJynV19f29/fIyMkXFhj+/v4zNDaztbYNCQpFRUepqKmWlZaIiIl2d3hVVVfb4eESJyloaGkoJynk2Ng6OjsDqq1VVVU+PkABtrknJij09fYLhoglFhi/v7/FursZGhodHiAAx8onJih/f3+8wsMXFxccHBwpJyoqKStLhomqqqrd3+Do6Ojj4+P5+fooKClw5efb3NwJbG4MdXgrKytAP0H4+fkMCQsBS0wGlJc1iYxG5eeZy86P1deF6u3Ky8vW1tbW19ja29zJ9/ni4+Ph4uP5+/sOfoIOvcEhCAo2REc2295QXmFlZWaHh4i+v8C/v/+x5+q////Nzc3T1tPg4eH3+Pj5+fkTDw8YGBocHCofHyUeHiEMOzwAVVUAU1MAX2AA//8qHBwtHyMxMTQ7Ozw+PkE+rbE9t7s/3+NXT1dQSEhDQURIyMxJ1NZY3+F/AH9nZ2d5eXlqsrdy1Ndx3+Khl5hVpApVAAAAgHRSTlMWY/2ihf0NAPz6/Pz8/AP8/Pz6/fz9/P39/f0v/Ar9BPr90mv8/Qb8Kf39rAL8FFFSav0D/RE0MpL9bv39EPq4cv36/f39/f3bDIXV/VitTf39/P39/M6w/QT9BBIp34zQgZISMFT9A/79ARL9nM9a/f39HSPN/f39AlFY+/39/T8HDKoAAATBSURBVHja7Zf3V9tIEMeV5O60VWVVbctxiY1bIIGYFnoPkN4vdynXe+/9X7+ZlVyAOMC73+5l4GFLu/PRd8quFsP8j2a8BpwWcPEYQKmEf61R7nqgVBwJQLxVKphm8eX+cLvww+5oBZZZ/Oarqq0e4r2JiYlms6Dtw0KzCZdwc+bhg3K1M1kc1jgAlMxVFQUeI5y9/95PSqnysloul8t2ZtXVOcYJ80JFV83SUcBFsxgKnlqe2n0/m2YmaciJHhbhj4Ns9gCWNb2iRwkh3FuvUfAc8qb0bm29gYPMAcr+u5Z1GGBe4NzJR0EMk8hU+9DjKc21p3BERDSKCb9qHgJYlsW5LyWV987ywPMqt+lBQH2x0nBCwgNKXR9SsduTYAwEMApOqr543bPFRvtgALTVnkpsn3NPSteBQPsSjMx/+gX/swUeys7Nk7x4s7JIhwH1hYrH8iIMmR/5+PHsLfMgADLwLQqIaO6XhPBko/0lHQLI9gYkIKIygkRG0o34mUxCDwAl+Bmer2x37VcRxzyo3M4NTNYqHicCSDbBUCUl54YBljkLYe0s3oUA3cqWgEKRqTvnB1ap6BLkpQyYR0LphoTNpgQNuGL+gQ2wWcvlPm3/1WBOEAjSGBfjngPmwZcGiRkQPEcoqZjjQD/8Dm6DEB5FBAg7m/c3txqiq6hUcMmJrw08n0zZ9oMtuBVKXUbO1KNBCBiBr2B+kjAhYDEoyIbuSQESPEGSJwuupPWPtxPiu1BGwgUNyFMdg9GrQWAzdImJkw/LkKwwFNjV+pd8By1G7XotBkLkE+5Qn7CrQ4AVjj0m9ELIS0x2uUwjgALksf3P9Vod79G1nSTWa0V6RLCbPYBlWriIgOBwXWyYu6wURKEB8DQNsKP62t9JzGJoeY8wsGkkaMCtdBGG0kNOC/sBKEE/hPiOpPY9213fhgxBFbW/YDNYBw14rgGgHhMMg9BPimHZWD6KQhIn8zUX7LP7DVAEk/TzRXzGHMsAKykA5LshflM2Vfqa4epgMH++srBw/ntHANwNtD/LkmCkKUj9wcHNw0dg20F2A8saxyw5Oz+/3RBM4ASWAfbR2cj6ODUeSBkxcsTibpIAijmwCpweAJOAgHewCwYA6i57Dv4cNS+gLm15WQRCdG9AEhDwvOdPuuUWrCeZLuFqlR4yHJL5PoDtacDn1osM0EUB0HOdS81st7iE1rtoftTB0ZbTB2AWDdiMsghiyKGEGZdHvxovA0FGJPUXYn/XtIxBDhm0iPYvjvIvIYFKDyqgAdiLBvZh5i8gSDo52h/fjpOgQfUUYC8OA2DDkXOv8kdCByb5qf84u6EVXNDLWAuQ1Q+OOyEsaQka4ABgLAPETAt4VQJ7acAgUgkObAlvp4AuSwV0hl67owifdKSrJYwPARgKgC4pnOSQU4BcowQAwHo0rpiz6B8L6kIGT2Alc66lJTx2xIxOooVbAAlBwBcnO2mBBOkJR4hrsBRxNZ5DCSBg8mT+IIG6EbwcxB5sSQYeLaAHYLuuFk962CvC01AAHjMMTMvMM1J2jy/hwCapG7JrT7NNFfekN6q085JT5Aj7bakqv94b678X8MtS4VQnVj3dGno3jp3+kDxmvf5/4f8D+BcfSMcT3GOUnAAAAABJRU5ErkJggg==';\nconst isEsportsSelection = selection => selection?.sport === 'CS' || ['CSGO','DOTA2','LOL'].includes(selection?.subsport);\n\nfunction totalOdds(bet) {\n  const value = Number(bet?.odds);\n  if (!Number.isFinite(value)) return '';\n  return value.toFixed(4).replace(/0+$/,'').replace(/\\.$/,'');\n}\n\nfunction expressEventsLabel(count) {\n  const locale=String(getLocale()||'').toLowerCase();\n  if(locale.startsWith('en')) return count === 1 ? 'event' : 'events';\n  const mod10=count%10, mod100=count%100;\n  if(locale.startsWith('ru')) {\n    if(mod10===1 && mod100!==11) return 'событие';\n    if(mod10>=2 && mod10<=4 && (mod100<12 || mod100>14)) return 'события';\n    return 'событий';\n  }\n  if(mod10===1 && mod100!==11) return 'подія';\n  if(mod10>=2 && mod10<=4 && (mod100<12 || mod100>14)) return 'події';\n  return 'подій';\n}\n\nfunction couponTypeLabel(bet) {\n  if(bet?.type !== 'express') return t(({single:'Ординар',system:'Система'})[bet?.type] || 'Ординар');\n  const count=Array.isArray(bet?.selections) ? bet.selections.length : 0;\n  return `${t('Експрес')}, ${count} ${expressEventsLabel(count)}`;\n}\n\nfunction sportImage(selection) {\n  const name = isEsportsSelection(selection) ? 'esports' : games[selection.sport] || 'esports';\n  if (!imageCache.has(name)) imageCache.set(name, new Promise(resolve => {\n    const image = new Image();\n    image.onload = () => resolve(image);\n    image.onerror = () => resolve(null);\n    image.src = name === 'esports' ? ESPORTS_CONTROLLER_DATA : `/assets/icons/${name}.png`;\n  }));\n  return imageCache.get(name);\n}\n\nexport function couponData(bet, showAmount) {\n  const status = bet.status;\n  const openExpress = bet?.type === 'express' && status === 'open';\n  const payoutLabel=t(status === 'open' ? 'Можлива виплата' : status === 'cashout' ? 'Виведено' : 'Виплата');\n  return {\n    date:date(bet.date),\n    type:couponTypeLabel(bet),\n    rows:bet.selections.map(selection => ({\n      title:`${t(selection.marketName)} ${t(selection.label)}`,\n      detail:`${date(selection.startTime ? selection.startTime * 1000 : bet.date)} ${selection.eventName}`,\n      odds:String(Number(selection.odds.toFixed(2))),\n      status:openExpress ? null : selection.settlement?.status,\n      selection,\n    })),\n    showAmount,\n    stakeLabel:showAmount ? t('Сума ставки') : t('Коефіцієнт'),\n    stake:showAmount ? amount(bet.cost) : totalOdds(bet),\n    payout:showAmount ? amount(status === 'open' ? bet.potential : bet.payout) : '',\n    payoutLabel:showAmount ? payoutLabel : '',\n    status,\n  };\n}\n\nfunction drawContained(context,image,x,y,box=22,cropRatio=0) {\n  const iw=Number(image?.naturalWidth || image?.width || 0), ih=Number(image?.naturalHeight || image?.height || 0);\n  if(!iw || !ih) return;\n  const sx=iw*cropRatio, sy=ih*cropRatio;\n  const sw=iw-(sx*2), sh=ih-(sy*2);\n  const scale=Math.min(box/sw,box/sh);\n  const w=sw*scale,h=sh*scale;\n  context.drawImage(image,sx,sy,sw,sh,x+(box-w)/2,y+(box-h)/2,w,h);\n}\n\n\nasync function drawLegacyCoupon(canvas, bet, showAmount) {\n  await document.fonts?.ready;\n  const model = couponData(bet,showAmount), images = await Promise.all(model.rows.map(row => sportImage(row.selection)));\n  const width = 358, scale = 3, context = canvas.getContext('2d');\n  if (!context) throw new Error('Не вдалося створити зображення');\n  const font = (size, weight = 400) => { context.font = `${weight} ${size}px Roboto, sans-serif`; };\n  const wrap = (text, maxWidth) => {\n    const lines = []; let current = '';\n    for (const word of String(text).split(/\\s+/)) {\n      if (context.measureText(current ? `${current} ${word}` : word).width <= maxWidth) { current += `${current ? ' ' : ''}${word}`; continue; }\n      if (current) lines.push(current); current = '';\n      for (const char of word) {\n        if (current && context.measureText(current+char).width > maxWidth) { lines.push(current); current = ''; }\n        current += char;\n      }\n    }\n    if (current) lines.push(current);\n    return lines;\n  };\n  const rows = model.rows.map(row => {\n    font(12.5); const title = wrap(row.title, row.status ? 229 : 246);\n    font(10); const detail = wrap(row.detail, row.status ? 229 : 246);\n    return {...row,title,detail,height:Math.max(52,16*title.length+13*detail.length+16)};\n  });\n  const totalsHeight=model.showAmount ? 64 : 40;\n  const height = 40 + rows.reduce((total,row)=>total+row.height,0) + totalsHeight;\n  canvas.width = width*scale; canvas.height = height*scale;\n  context.scale(scale,scale); context.fillStyle='#e2dfd9'; context.fillRect(0,0,width,height);\n  const text = (value,x,y,color='#292621',size=14,align='left',weight=400) => {\n    font(size,weight); context.textAlign=align; context.fillStyle=color; context.fillText(value,x,y);\n  };\n  const rule = y => { context.strokeStyle='#d0cdc7'; context.lineWidth=1; context.beginPath(); context.moveTo(0,y); context.lineTo(width,y); context.stroke(); };\n  text(model.date,16,27,'#7b756b',11); text(model.type,width-16,27,'#7b756b',11,'right'); rule(40);\n  let y=40;\n  rows.forEach((row,index) => {\n    if (images[index]) {\n      const esports=isEsportsSelection(row.selection);\n      drawContained(context,images[index],17,y+(row.height-22)/2,esports ? 20 : 21,0);\n    }\n    row.title.forEach((line,i)=>text(line,52,y+21+i*16,'#292621',12.5));\n    row.detail.forEach((line,i)=>text(line,52,y+21+row.title.length*16+i*13,'#7b756b',10));\n    const color = row.status==='won' ? '#009e69' : row.status==='lost' ? '#e6253a' : '#292621';\n    text(row.odds,width-(row.status?34:16),y+row.height/2+4,color,14,'right');\n    if (row.status) {\n      const x=width-19, cy=y+row.height/2;\n      context.beginPath(); context.arc(x,cy,6.5,0,Math.PI*2); context.fillStyle=row.status==='void'?'#969186':color; context.fill();\n      context.strokeStyle='#fff'; context.lineWidth=1.5; context.lineCap='round'; context.beginPath();\n      if (row.status==='won') {context.moveTo(x-3,cy);context.lineTo(x-1,cy+2);context.lineTo(x+3,cy-2);}\n      else if(row.status==='lost') {context.moveTo(x-2,cy-2);context.lineTo(x+2,cy+2);context.moveTo(x+2,cy-2);context.lineTo(x-2,cy+2);}\n      else {context.moveTo(x-3,cy);context.lineTo(x+3,cy);}\n      context.stroke();\n    }\n    y+=row.height; rule(y);\n  });\n  text(model.stakeLabel,16,y+24,'#292621',12.5); text(model.stake,width-16,y+24,'#292621',12.5,'right');\n  if(model.showAmount){\n    const paid = (model.status==='won' || model.status==='cashout') ? '#009e69' : '#292621';\n    text(model.payoutLabel,16,y+48,paid,12.5); text(model.payout,width-16,y+48,paid,12.5,'right');\n  }\n  context.globalCompositeOperation='destination-out';\n  for(let x=0;x<=width+7;x+=width/13) for(const edge of [0,height]) {context.beginPath();context.arc(x,edge,7,0,Math.PI*2);context.fill();}\n  context.globalCompositeOperation='source-over';\n  const tail=cropSingleTotals ? '' : (model.showAmount ? ` ${model.stakeLabel}: ${model.stake}. ${model.payoutLabel}: ${model.payout}` : ` ${model.stakeLabel}: ${model.stake}`);\n  canvas.setAttribute('aria-label',`${model.type}. ${model.rows.map(row=>row.title).join('. ')}.${tail}`);\n  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Не вдалося зберегти купон')),'image/png'));\n}\n\nexport async function drawCoupon(canvas, bet, showAmount) {\n  await document.fonts?.ready;\n  const model = couponData(bet,showAmount), images = await Promise.all(model.rows.map(row => sportImage(row.selection)));\n  const width = 361, scale = 3, context = canvas.getContext('2d');\n  if (!context) throw new Error('Не вдалося створити зображення');\n  const font = (size, weight = 400) => { context.font = `${weight} ${size}px Roboto, sans-serif`; };\n  const wrap = (text, maxWidth) => {\n    const lines = []; let current = '';\n    for (const word of String(text).split(/\\s+/)) {\n      if (context.measureText(current ? `${current} ${word}` : word).width <= maxWidth) { current += `${current ? ' ' : ''}${word}`; continue; }\n      if (current) lines.push(current); current = '';\n      for (const char of word) {\n        if (current && context.measureText(current+char).width > maxWidth) { lines.push(current); current = ''; }\n        current += char;\n      }\n    }\n    if (current) lines.push(current);\n    return lines;\n  };\n  const rows = model.rows.map(row => {\n    font(16); const title = wrap(row.title, row.status ? 224 : 242);\n    font(12); const detail = wrap(row.detail, row.status ? 224 : 242);\n    return {...row,title,detail,height:Math.max(54,19*title.length+15*detail.length+15)};\n  });\n  const cropSingleTotals = bet?.type === 'single' && !model.showAmount;\n  const totalsHeight = cropSingleTotals ? 0 : (model.showAmount ? 74 : 44);\n  const height = 44 + rows.reduce((total,row)=>total+row.height,0) + totalsHeight;\n  canvas.width = width*scale; canvas.height = height*scale;\n  context.scale(scale,scale); context.fillStyle='#e4e3df'; context.fillRect(0,0,width,height);\n  const text = (value,x,y,color='#292621',size=14,align='left',weight=400) => {\n    font(size,weight); context.textAlign=align; context.fillStyle=color; context.fillText(value,x,y);\n  };\n  const rule = y => { context.strokeStyle='#d2d1cd'; context.lineWidth=1; context.beginPath(); context.moveTo(0,y); context.lineTo(width,y); context.stroke(); };\n  text(model.date,16,29,'#7b756b',13); text(model.type,width-16,29,'#7b756b',13,'right'); rule(44);\n  let y=44;\n  rows.forEach((row,index) => {\n    if (images[index]) {\n      const esports=isEsportsSelection(row.selection);\n      drawContained(context,images[index],17,y+(row.height-22)/2,esports ? 21 : 22,0);\n    }\n    row.title.forEach((line,i)=>text(line,56,y+22+i*19,'#292621',16));\n    row.detail.forEach((line,i)=>text(line,56,y+22+row.title.length*19+i*15,'#7b756b',12));\n    const color = row.status==='won' ? '#009e69' : row.status==='lost' ? '#e6253a' : '#292621';\n    text(row.odds,width-(row.status?36:16),y+row.height/2+6,color,18,'right');\n    if (row.status) {\n      const x=width-19, cy=y+row.height/2;\n      context.beginPath(); context.arc(x,cy,9,0,Math.PI*2); context.fillStyle=row.status==='void'?'#969186':color; context.fill();\n      context.strokeStyle='#fff'; context.lineWidth=1.8; context.lineCap='round'; context.beginPath();\n      if (row.status==='won') {context.moveTo(x-4,cy);context.lineTo(x-1,cy+3);context.lineTo(x+4,cy-3);}\n      else if(row.status==='lost') {context.moveTo(x-3,cy-3);context.lineTo(x+3,cy+3);context.moveTo(x+3,cy-3);context.lineTo(x-3,cy+3);}\n      else {context.moveTo(x-4,cy);context.lineTo(x+4,cy);}\n      context.stroke();\n    }\n    y+=row.height; rule(y);\n  });\n  if(!cropSingleTotals){\n    text(model.stakeLabel,16,y+29,'#292621',15); text(model.stake,width-16,y+29,'#292621',15,'right');\n  }\n  if(model.showAmount){\n    const paid = (model.status==='won' || model.status==='cashout') ? '#009e69' : '#292621';\n    text(model.payoutLabel,16,y+59,paid,15); text(model.payout,width-16,y+59,paid,15,'right');\n  }\n  context.globalCompositeOperation='destination-out';\n  for(let x=0;x<=width+7;x+=width/13) for(const edge of [0,height]) {context.beginPath();context.arc(x,edge,7,0,Math.PI*2);context.fill();}\n  context.globalCompositeOperation='source-over';\n  const tail=model.showAmount ? ` ${model.stakeLabel}: ${model.stake}. ${model.payoutLabel}: ${model.payout}` : ` ${model.stakeLabel}: ${model.stake}`;\n  canvas.setAttribute('aria-label',`${model.type}. ${model.rows.map(row=>row.title).join('. ')}.${tail}`);\n  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Не вдалося зберегти купон')),'image/png'));\n}\n\nexport function openShareCoupon(bet, showToast) {\n  const themeMeta=document.querySelector('meta[name=\"theme-color\"]');\n  const previousThemeColor=themeMeta?.getAttribute('content') || '#171716';\n  if(themeMeta) themeMeta.setAttribute('content','#f5f4f0');\n  let dialog=document.getElementById('share-coupon');\n  if (!dialog) {dialog=document.createElement('dialog');dialog.id='share-coupon';dialog.className='share-coupon';document.body.append(dialog);}\n  dialog.classList.remove('share-open-express-legacy');\n  dialog.setAttribute('aria-label',t('Поділитися ставкою'));\n  dialog.innerHTML=`<button class=\"share-close\" aria-label=\"Закрити\">${icon('x')}</button><div class=\"share-layout\"><div class=\"share-spacer\"></div><div class=\"share-ticket\"><canvas role=\"img\"></canvas><p class=\"share-error\" role=\"status\">Готуємо купон…</p></div><label class=\"share-amount\"><span>${t('Показати суму ставки:')}</span><input type=\"checkbox\" role=\"switch\" checked aria-label=\"${t('Показати суму ставки:')}\"><span class=\"share-switch\" aria-hidden=\"true\"></span></label><div class=\"share-actions\">${bet.status==='open'?`<button class=\"share-send\" disabled><span>${icon('share')}</span>${t('Поділитися')}<br>${t('ставкою')}</button>`:''}<button class=\"share-save\" disabled><span>${icon('images')}</span>${t('Зберегти')}<br>${t('зображення')}</button></div></div>`;\n  let file=null, revision=0;\n  const controls=dialog.querySelectorAll('.share-actions button'), error=dialog.querySelector('.share-error');\n  async function render() {\n    const current=++revision; file=null; controls.forEach(button=>button.disabled=true);\n    try {\n      const canvas=document.createElement('canvas');\n      const blob=await drawCoupon(canvas,bet,dialog.querySelector('input').checked);\n      if(current!==revision || !dialog.open) return;\n      dialog.querySelector('canvas').replaceWith(canvas); canvas.setAttribute('role','img'); error.hidden=true;\n      file=new File([blob],`arena-line-coupon-${String(bet.number||bet.id).replace(/[^a-zA-Z0-9_-]/g,'')}.png`,{type:'image/png'});\n      controls.forEach(button=>button.disabled=false);\n    } catch(problem) {if(current===revision){error.textContent=problem.message;error.hidden=false;}}\n  }\n  function save() {\n    if(!file)return;\n    const url=URL.createObjectURL(file), link=document.createElement('a');link.href=url;link.download=file.name;\n    document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);\n  }\n  const releaseShareBackdrop=()=>{\n    document.documentElement.classList.remove('share-coupon-open');\n    document.body.classList.remove('share-coupon-open');\n    dialog.classList.remove('share-open-express-legacy');\n    if(themeMeta) themeMeta.setAttribute('content',previousThemeColor);\n  };\n  dialog.querySelector('.share-close').onclick=()=>dialog.close();\n  dialog.addEventListener('close',releaseShareBackdrop,{once:true});\n  dialog.querySelector('input').onchange=render;\n  dialog.querySelector('.share-save').onclick=save;\n  const share=dialog.querySelector('.share-send');\n  if(share)share.onclick=async()=>{\n    if(!file)return;\n    if(!navigator.canShare?.({files:[file]})){save();return;}\n    try {await navigator.share({files:[file],title:'Купон Arena Line'});}\n    catch(problem){if(problem.name!=='AbortError')showToast('Не вдалося поділитися. Купон можна зберегти зображенням.');}\n  };\n  document.documentElement.classList.add('share-coupon-open');\n  document.body.classList.add('share-coupon-open');\n  if(!dialog.open)dialog.showModal();window.lucide?.createIcons();render();\n}\n";
const themeCssModule = ":root[data-theme=dark]{--page:#23211f;--sports-bg:#23211f;--surface:#171716;--surface-soft:#2d2a27;--surface-active:#393631;--ink:#f5f4f1;--muted:#aaa69d;--subtle:#a09b90;--line:#393630;--odds-blue:#65b6df;color-scheme:dark}\n.gamepad-graphic{display:flex;align-items:center;justify-content:center;font-family:\"Apple Color Emoji\",\"Segoe UI Emoji\",\"Noto Color Emoji\",sans-serif;font-size:24px;line-height:1;background:transparent;mix-blend-mode:normal;isolation:isolate}\n.sport-symbol .gamepad-graphic{font-size:30px}.bet-sport .gamepad-graphic{width:24px;height:24px}\n.team-emblem-picture{display:inline-flex;align-items:center;justify-content:center;width:100%;height:100%}.team-mark .team-logo,.event-team-emblem .team-logo{mix-blend-mode:normal;object-fit:contain}.team-emblem-fallback{display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:10px;font-weight:600;color:var(--muted);background:var(--surface-soft,#f2f1ee);border-radius:4px}.event-team-emblem .team-emblem-picture{width:40px;height:40px}.event-team-emblem .team-emblem-fallback{font-size:16px}.event-team-emblem{background:var(--surface,#fafaf8);border-color:var(--line)}\n[data-theme=dark] .reference-graphic{mix-blend-mode:normal}\n[data-theme=dark] .submit,[data-theme=dark] .register-button,[data-theme=dark] .odd.selected,[data-theme=dark] .avatar,[data-theme=dark] .slip-bar{color:#292621}\n[data-theme=dark] .stage-tabs>button.active{background:linear-gradient(0deg,#713a3444,transparent 65%)}\n[data-theme=dark] .sport-tabs>button.active{background:linear-gradient(0deg,#74752144,transparent 65%)}\n[data-theme=dark] input,[data-theme=dark] textarea{color:var(--ink);background:var(--surface-soft)}\n[data-theme=dark] .site-menu input{background:transparent}\ndialog#site-menu{position:fixed;inset:calc(56px + env(safe-area-inset-top)) 0 0;width:100%;height:calc(100dvh - 56px - env(safe-area-inset-top));max-width:480px;max-height:none;margin:0 auto;padding:0;border:0;border-radius:0;background:#25221f;color:#f5f4f1;overflow:auto}\n#site-menu::backdrop{background:#0008}\n.site-menu-head{position:sticky;top:0;display:flex;align-items:center;justify-content:center;height:44px;border-bottom:1px solid #3c3831;background:#25221f;z-index:1;font-size:16px}\n.site-menu-head button{position:absolute;right:12px;padding:4px;color:#a6a092}\n.site-menu-content{padding:12px 12px calc(24px + env(safe-area-inset-bottom))}\n.site-menu-sections details{background:#171716;border-radius:8px;margin-bottom:10px;overflow:hidden}\n.site-menu-sections summary{display:flex;align-items:center;justify-content:space-between;list-style:none;padding:14px 12px;cursor:pointer;font-size:14px}\n.site-menu-sections summary::-webkit-details-marker{display:none}.site-menu-sections summary svg{width:16px;color:#999388}.site-menu-sections details[open] summary svg{transform:rotate(180deg)}\n.site-menu-sections details>button{display:block;width:100%;text-align:left;padding:12px 16px;color:#b4aea2;border-top:1px solid #292621;font-size:14px}\n.site-menu-links{padding:8px 12px;background:#171716;border-radius:8px;margin-top:16px}\n.site-menu-links>button{display:flex;align-items:center;gap:10px;width:100%;min-height:42px;padding:8px 0;text-align:left;color:#aaa498;font-size:14px}\n.site-menu-links>button>span:first-child{flex:1}.site-menu-links svg{width:16px;height:16px}\n.site-menu-links>.menu-theme{margin:8px 0 4px;padding:10px 12px;background:#26231f;border-radius:8px;color:#f5f4f1}.menu-theme>span{flex:1}.menu-theme small{display:block;font-size:12px;color:#9f998e;margin-top:3px}.menu-theme>svg:first-child{width:20px;height:20px;color:#a39c8d}\ndialog.theme-sheet{position:fixed;inset:auto 0 0;width:100%;max-width:480px;max-height:calc(100dvh - 40px);margin:0 auto;padding:0;border:0;border-radius:18px 18px 0 0;background:var(--surface,#fff);color:var(--ink,#292621)}\n.theme-sheet .dialog-head{padding:16px 16px 0;margin:0;min-height:44px}.theme-sheet .dialog-head h2{font-size:16px;flex:1;text-align:center;padding-left:32px}.theme-sheet .dialog-head .icon-button{width:28px;height:28px}\n.theme-description{font-size:12px;line-height:18px;text-align:center;color:var(--muted);margin:4px 16px 12px}\n.theme-options{background:var(--surface-soft,#f2f1ee);border-radius:8px;margin:0 16px 24px;padding:0 12px}\n.theme-options label{display:flex;align-items:center;gap:12px;min-height:60px;margin:0;border-bottom:1px solid var(--line);cursor:pointer}.theme-options label:last-child{border:0}.theme-options label>svg{width:20px;color:var(--muted)}.theme-options label>span{flex:1}.theme-options strong{display:block;font-size:14px;font-weight:400}.theme-options small{display:block;color:var(--muted);font-size:12px;line-height:16px;margin-top:3px}.theme-options input{width:18px;height:18px;margin:0;accent-color:#009e69}\n.theme-sheet .theme-save{width:calc(100% - 32px);height:48px;margin:0 16px calc(16px + env(safe-area-inset-bottom));color:#292621}\n\n.theme-options input,.language-options input{padding:0;border:0;background:transparent;appearance:auto}.theme-options strong{color:var(--ink,#292621)}\n\n[data-theme=dark] .team-emblem-picture{background:#101010!important;border-radius:50%;padding:0!important}[data-theme=dark] .event-team-emblem{background:#101010!important}\n\n.reference-graphic.gamepad-restored{mix-blend-mode:normal;background:transparent}\n\n\n/* Arena account/editor dark-mode corrections */\n.edit-bet-dialog{\n  border:0!important;\n  outline:0!important;\n  box-shadow:0 18px 60px #0008!important;\n}\n.edit-bet-dialog .edit-bet-card{\n  margin:4px 0 0;\n  padding:0;\n  border:0!important;\n  outline:0!important;\n  border-radius:0!important;\n  background:transparent!important;\n  box-shadow:none!important;\n}\n.edit-bet-event{display:block;margin:0 0 4px;font-size:16px;line-height:22px}\n.edit-bet-market{margin:0 0 16px;color:var(--muted);font-size:14px;line-height:20px}\n.edit-bet-label{margin:14px 0 8px;color:var(--muted);font-size:12px}\n.edit-winner-buttons{display:grid;grid-template-columns:1fr 1fr;gap:10px}\n.edit-winner-buttons>button{\n  min-height:58px;\n  padding:10px 12px;\n  border:0!important;\n  outline:0!important;\n  border-radius:13px;\n  background:var(--surface-soft,#f2f1ee);\n  font-weight:700;\n}\n.edit-winner-buttons>button small{display:block;margin-top:4px;font-size:10px;font-weight:500;opacity:.72;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.edit-winner-buttons>button.selected{background:var(--yellow);color:#292621}\n.edit-bet-grid,.edit-score-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}\n.edit-bet-dialog input,.edit-bet-dialog select{\n  width:100%;\n  min-height:48px;\n  padding:11px 12px;\n  border:0!important;\n  outline:0!important;\n  box-shadow:none!important;\n  border-radius:12px;\n  background:var(--surface-soft,#f2f1ee);\n  color:var(--ink,#292621);\n}\n.edit-bet-dialog input:focus,.edit-bet-dialog select:focus{\n  border:0!important;\n  outline:0!important;\n  box-shadow:0 0 0 1px color-mix(in srgb,var(--muted) 35%,transparent)!important;\n}\n.edit-payout-preview{margin:22px 0 6px;font-size:18px;line-height:24px}\n.edit-payout-preview strong{font-weight:500}\n.edit-bet-save{margin-top:18px}\n.edit-bet-hide{\n  width:100%;\n  min-height:44px;\n  margin-top:8px;\n  border:0!important;\n  color:var(--muted);\n  font-size:13px;\n}\n:root[data-theme=dark] .edit-bet-dialog,\n:root[data-theme=dark] dialog#dialog.edit-bet-dialog{\n  background:#171716!important;\n  color:#f5f4f1!important;\n  border:0!important;\n  outline:0!important;\n}\n:root[data-theme=dark] .edit-bet-dialog .dialog-head{\n  border:0!important;\n}\n:root[data-theme=dark] .edit-bet-dialog input,\n:root[data-theme=dark] .edit-bet-dialog select,\n:root[data-theme=dark] .edit-bet-dialog .edit-winner-buttons>button{\n  background:#2d2a27!important;\n  color:#f5f4f1!important;\n  border:0!important;\n}\n:root[data-theme=dark] .edit-bet-dialog .edit-winner-buttons>button.selected{\n  background:#f2f740!important;\n  color:#292621!important;\n}\n@media(max-width:600px){\n  .edit-bet-dialog{\n    width:calc(100% - 28px)!important;\n    max-width:none!important;\n    padding:22px 18px calc(20px + env(safe-area-inset-bottom))!important;\n  }\n}\n@media(display-mode:standalone){\n  .reference-graphic,.team-logo,.synced-discipline-logo{\n    mix-blend-mode:normal!important;\n    filter:none!important;\n    opacity:1!important;\n  }\n  .tournament-symbol{\n    background:var(--surface,#fff)!important;\n  }\n  .game-badge-dark,\n  .team-emblem-picture,\n  .team-logo{\n    background:transparent!important;\n  }\n}\n\n/* Arena tournament/PWA corrections */\n.tournament-tabs>button .tournament-symbol,\n.tournament-tabs>button.active .tournament-symbol,\n.tournament-tabs>button:focus .tournament-symbol,\n.tournament-tabs>button:focus-visible .tournament-symbol{\n  border:0!important;\n  outline:0!important;\n  box-shadow:none!important;\n}\n@media(display-mode:standalone){\n  .sport-symbol{\n    background:#f3f1ee!important;\n    overflow:hidden;\n  }\n  .sport-symbol .reference-graphic,\n  .sport-symbol img{\n    mix-blend-mode:normal!important;\n    filter:none!important;\n    opacity:1!important;\n    background:transparent!important;\n  }\n  [data-theme=dark] .team-emblem-picture,\n  [data-theme=dark] .event-team-emblem{\n    background:transparent!important;\n  }\n}\n\n\n/* Hard guarantee: bet editor always follows the dark sports surface, never a white sheet. */\ndialog#dialog.edit-bet-dialog,\n.edit-bet-dialog{\n  background:#171716!important;\n  color:#f5f4f1!important;\n  border:0!important;\n  outline:0!important;\n  box-shadow:none!important;\n}\n.edit-bet-dialog .dialog-head,\n.edit-bet-dialog .edit-bet-card,\n.edit-bet-dialog fieldset{\n  border:0!important;\n  outline:0!important;\n  box-shadow:none!important;\n  background:transparent!important;\n}\n.edit-bet-dialog input,\n.edit-bet-dialog select,\n.edit-bet-dialog textarea,\n.edit-bet-dialog .edit-winner-buttons>button{\n  background:#2d2a27!important;\n  color:#f5f4f1!important;\n  border:0!important;\n  outline:0!important;\n  box-shadow:none!important;\n}\n.edit-bet-dialog input:focus,\n.edit-bet-dialog select:focus,\n.edit-bet-dialog textarea:focus,\n.edit-bet-dialog .edit-winner-buttons>button:focus,\n.edit-bet-dialog .edit-winner-buttons>button:focus-visible{\n  border:0!important;\n  outline:0!important;\n  box-shadow:none!important;\n}\n.edit-bet-dialog .edit-winner-buttons>button.selected{\n  background:#f2f740!important;\n  color:#292621!important;\n}\n.tournament-tabs>button,\n.tournament-tabs>button:focus,\n.tournament-tabs>button:focus-visible{\n  outline:0!important;\n  box-shadow:none!important;\n}\n.tournament-tabs>button .tournament-symbol,\n.tournament-tabs>button.active .tournament-symbol,\n.tournament-tabs>button:focus .tournament-symbol,\n.tournament-tabs>button:focus-visible .tournament-symbol{\n  border:0!important;\n  outline:0!important;\n  box-shadow:none!important;\n}\n\n\n/* v48: match original Parik tournament/avatar surfaces in standalone mode */\n:root:not([data-theme=dark]) .tournament-symbol,\n:root[data-theme=light] .tournament-symbol{\n  background:#fff!important;\n}\n:root:not([data-theme=dark]) .tournament-symbol .game-badge,\n:root[data-theme=light] .tournament-symbol .game-badge{\n  background:transparent!important;\n}\n:root:not([data-theme=dark]) .team-emblem-picture,\n:root:not([data-theme=dark]) .team-logo,\n:root[data-theme=light] .team-emblem-picture,\n:root[data-theme=light] .team-logo{\n  background:transparent!important;\n}\n\n/* Bet history: cash-out uses the same green return marker as the original UI. */\n.bet-result.result-cashout{background:#009e69}\n\n\n/* v68: compact iPhone standalone bottom navigation.\n   iOS reports ~34px safe-area at the bottom; using all of it lifted the whole\n   navigation row too far. Keep only a small guard while the black surface\n   itself still reaches the physical bottom edge. */\n@media (display-mode:standalone){\n  :root{--arena-pwa-bottom-safe:min(env(safe-area-inset-bottom),6px)}\n  .sports-nav{\n    padding-bottom:var(--arena-pwa-bottom-safe)!important;\n    min-height:calc(var(--sports-footer) + var(--arena-pwa-bottom-safe))!important;\n  }\n  .profile-nav{\n    padding-bottom:var(--arena-pwa-bottom-safe)!important;\n  }\n  .profile-content{\n    bottom:calc(var(--nav) + var(--arena-pwa-bottom-safe))!important;\n  }\n  .slip-mini{\n    bottom:calc(var(--sports-footer) + var(--arena-pwa-bottom-safe) + 6px)!important;\n  }\n  dialog.betslip{\n    padding-bottom:var(--arena-pwa-bottom-safe)!important;\n  }\n}\n\n\n/* v70: original-style compact express/system history card. */\n.bet-record-multi .bet-multi-summary{\n  margin:10px 0 12px;\n}\n.bet-record-multi .bet-multi-summary .bet-selection-label>strong{\n  font-size:16px;\n  line-height:20px;\n  font-weight:400;\n}\n.bet-record-multi .bet-payment{\n  border-top:0!important;\n  padding-top:0!important;\n}\n.bet-record-multi .bet-result.result-open{\n  background:#969186;\n}\n\n\n/* v71: expandable accumulator rows, aligned exactly by fixed icon/status columns. */\n.bet-record-multi .bet-multi-summary{\n  cursor:pointer;\n}\n.bet-record-multi .bet-multi-chevron{\n  transition:transform .18s ease;\n}\n.bet-record-multi.expanded .bet-multi-chevron{\n  transform:rotate(90deg);\n}\n.bet-multi-details{\n  margin:0 0 12px;\n  border-radius:12px;\n  overflow:hidden;\n  background:#eeece7;\n}\n.bet-multi-details[hidden]{display:none!important}\n.bet-multi-event{\n  width:100%;\n  min-height:72px;\n  display:grid;\n  grid-template-columns:32px minmax(0,1fr) auto;\n  align-items:center;\n  column-gap:12px;\n  padding:10px 14px;\n  border:0;\n  border-bottom:1px solid #d8d5cf;\n  background:#e6e3dd;\n  text-align:left;\n}\n.bet-multi-event:last-child{border-bottom:0}\n.bet-multi-sport{\n  width:28px;\n  height:28px;\n  display:grid;\n  place-items:center;\n  align-self:center;\n  overflow:visible;\n}\n.bet-multi-sport .reference-graphic,\n.bet-multi-sport .gamepad-graphic{\n  display:block!important;\n  width:26px!important;\n  height:26px!important;\n  max-width:26px!important;\n  max-height:26px!important;\n  margin:0!important;\n  padding:0!important;\n  object-fit:contain!important;\n  object-position:center!important;\n  transform:none!important;\n}\n.bet-multi-copy{\n  min-width:0;\n  display:grid;\n  align-content:center;\n  gap:3px;\n}\n.bet-multi-copy strong{\n  display:block;\n  color:#292621;\n  font-size:16px;\n  line-height:19px;\n  font-weight:400;\n  overflow-wrap:anywhere;\n}\n.bet-multi-copy small{\n  display:block;\n  color:#7b756b;\n  font-size:12px;\n  line-height:15px;\n  font-weight:400;\n  overflow-wrap:anywhere;\n}\n.bet-multi-right{\n  display:flex;\n  align-items:center;\n  justify-content:flex-end;\n  gap:8px;\n  min-width:64px;\n  white-space:nowrap;\n}\n.bet-multi-right>b{\n  font-size:16px;\n  line-height:20px;\n  font-weight:400;\n  color:#292621;\n  font-variant-numeric:tabular-nums;\n}\n.bet-multi-right>b.state-won{color:#009e69}\n.bet-multi-right>b.state-lost{color:#ee263a}\n.bet-multi-right>b.state-cashout{color:#009e69}\n.bet-multi-right .bet-result{\n  margin:0!important;\n  width:20px!important;\n  height:20px!important;\n  flex:0 0 20px!important;\n}\n\n\n/* v72: dedicated accumulator detail screen, matching the original mobile flow. */\n.profile-content.bet-detail-view{\n  top:calc(var(--header) + env(safe-area-inset-top))!important;\n  bottom:0!important;\n  max-width:640px!important;\n  padding:0!important;\n  overflow:hidden!important;\n  background:var(--surface,#fff)!important;\n}\n.bet-detail-page{\n  height:100%;\n  min-height:0;\n  display:grid;\n  grid-template-rows:auto minmax(0,1fr) auto;\n  background:var(--surface,#fff);\n}\n.bet-detail-head{\n  position:relative;\n  min-height:82px;\n  display:grid;\n  grid-template-columns:48px 1fr 48px;\n  align-items:center;\n  border-bottom:1px solid var(--line,#e6e3de);\n  background:var(--surface,#fff);\n  padding:4px 8px;\n}\n.bet-detail-back{\n  width:44px;\n  height:44px;\n  display:grid;\n  place-items:center;\n  color:var(--muted,#7b756b);\n}\n.bet-detail-back svg{width:26px;height:26px}\n.bet-detail-title{\n  min-width:0;\n  display:grid;\n  justify-items:center;\n  align-content:center;\n  gap:2px;\n  text-align:center;\n}\n.bet-detail-title strong{\n  font-size:20px;\n  line-height:24px;\n  font-weight:600;\n}\n.bet-detail-title span{\n  color:var(--muted,#7b756b);\n  font-size:16px;\n  line-height:21px;\n}\n.bet-detail-scroll{\n  min-height:0;\n  overflow-y:auto;\n  overscroll-behavior:contain;\n  -webkit-overflow-scrolling:touch;\n  background:var(--surface,#fff);\n  scrollbar-width:thin;\n}\n.bet-detail-selections{\n  min-height:100%;\n}\n.bet-detail-selections .bet-selection{\n  margin:0;\n  padding:16px 18px 18px;\n  border-bottom:1px solid var(--line,#e6e3de);\n  background:var(--surface,#fff);\n}\n.bet-detail-selections .bet-selection-summary{\n  min-height:84px;\n  padding:12px 18px;\n  border-radius:14px;\n}\n.bet-detail-selections .bet-selection-label>.meta{\n  font-size:14px;\n  line-height:18px;\n}\n.bet-detail-selections .bet-selection-label>strong{\n  font-size:18px;\n  line-height:22px;\n}\n.bet-detail-selections .bet-coefficient{\n  font-size:18px;\n}\n.bet-detail-selections .bet-event-time{\n  margin-top:12px;\n  font-size:11px;\n  line-height:15px;\n}\n.bet-detail-selections .bet-teams{\n  font-size:16px;\n  line-height:22px;\n}\n.bet-detail-selections .bet-team-score b{\n  font-size:16px;\n}\n.bet-detail-footer{\n  flex:none;\n  border-top:1px solid var(--line,#e6e3de);\n  background:var(--surface,#fff);\n  padding:14px 20px max(14px,env(safe-area-inset-bottom));\n}\n.bet-detail-footer dl{\n  margin:0;\n  display:grid;\n  gap:8px;\n  font-size:16px;\n  line-height:22px;\n}\n.bet-detail-footer dl>div{\n  display:flex;\n  align-items:center;\n  justify-content:space-between;\n  gap:16px;\n}\n.bet-detail-footer dt,.bet-detail-footer dd{margin:0}\n.bet-detail-footer dd{\n  white-space:nowrap;\n  font-variant-numeric:tabular-nums;\n}\n.bet-detail-footer .positive{color:#009e69}\n.bet-detail-share{\n  margin-top:14px;\n  display:inline-flex;\n  align-items:center;\n  justify-content:center;\n  gap:7px;\n  min-height:38px;\n  padding:0 14px;\n  border-radius:100px;\n  background:var(--surface-soft,#f2f1ee);\n  font-size:15px;\n  font-weight:600;\n}\n.bet-detail-share svg{width:18px;height:18px}\n@media (display-mode:standalone){\n  .profile-content.bet-detail-view{bottom:0!important}\n}\n@media(max-width:370px){\n  .bet-detail-head{min-height:72px}\n  .bet-detail-title strong{font-size:18px}\n  .bet-detail-title span{font-size:14px}\n  .bet-detail-selections .bet-selection{padding-left:12px;padding-right:12px}\n  .bet-detail-footer{padding-left:14px;padding-right:14px}\n}\n\n\n/* v73: share coupon must cover the full iPhone/PWA canvas, including bottom safe area. */\nhtml.share-coupon-open,\nbody.share-coupon-open{\n  background:#f5f4f0!important;\n}\nbody.share-coupon-open{\n  overflow:hidden!important;\n}\nhtml.share-coupon-open dialog.share-coupon,\nbody.share-coupon-open dialog.share-coupon{\n  position:fixed!important;\n  inset:0!important;\n  width:100vw!important;\n  max-width:100vw!important;\n  height:100vh!important;\n  min-height:100vh!important;\n  height:100dvh!important;\n  min-height:100dvh!important;\n  max-height:none!important;\n  margin:0!important;\n  padding:0!important;\n  border:0!important;\n  border-radius:0!important;\n  background:#f5f4f0!important;\n  box-shadow:0 100vh 0 100vh #f5f4f0!important;\n  overflow:hidden!important;\n}\nhtml.share-coupon-open dialog.share-coupon::backdrop{\n  background:#f5f4f0!important;\n}\nhtml.share-coupon-open .share-layout{\n  width:100%!important;\n  max-width:430px!important;\n  height:100%!important;\n  min-height:100%!important;\n  box-sizing:border-box!important;\n  background:#f5f4f0!important;\n}\nhtml.share-coupon-open .share-spacer,\nhtml.share-coupon-open .share-ticket,\nhtml.share-coupon-open .share-amount,\nhtml.share-coupon-open .share-actions{\n  background:transparent!important;\n}\n@media (display-mode:standalone){\n  html.share-coupon-open,\n  body.share-coupon-open{\n    min-height:100dvh!important;\n    background:#f5f4f0!important;\n  }\n}\n\n\n/* v74: original-scale share screen, black iOS top status strip, no bottom strip, normalized emblems. */\nhtml.share-coupon-open{\n  background:#171716!important;\n}\nbody.share-coupon-open{\n  background:#f5f4f0!important;\n  overflow:hidden!important;\n}\nhtml.share-coupon-open dialog.share-coupon,\nbody.share-coupon-open dialog.share-coupon{\n  position:fixed!important;\n  inset:0!important;\n  width:100vw!important;\n  max-width:100vw!important;\n  height:100dvh!important;\n  min-height:100dvh!important;\n  max-height:none!important;\n  margin:0!important;\n  padding:0!important;\n  border:0!important;\n  border-radius:0!important;\n  background:#f5f4f0!important;\n  box-shadow:none!important;\n  overflow:hidden!important;\n}\nhtml.share-coupon-open dialog.share-coupon::backdrop{\n  background:#f5f4f0!important;\n}\nhtml.share-coupon-open .share-layout{\n  width:100%!important;\n  max-width:430px!important;\n  min-height:100%!important;\n  height:100%!important;\n  box-sizing:border-box!important;\n  padding:56px 16px calc(12px + env(safe-area-inset-bottom))!important;\n  background:#f5f4f0!important;\n}\nhtml.share-coupon-open .share-close{\n  top:14px!important;\n  right:16px!important;\n  width:24px!important;\n  height:24px!important;\n  padding:0!important;\n  border:0!important;\n  outline:0!important;\n  box-shadow:none!important;\n  background:transparent!important;\n  -webkit-tap-highlight-color:transparent!important;\n}\nhtml.share-coupon-open .share-close:focus,\nhtml.share-coupon-open .share-close:focus-visible,\nhtml.share-coupon-open .share-close:active{\n  border:0!important;\n  outline:0!important;\n  box-shadow:none!important;\n}\nhtml.share-coupon-open .share-close svg{\n  width:22px!important;\n  height:22px!important;\n}\nhtml.share-coupon-open .share-amount{\n  margin:18px 16px 14px!important;\n  gap:10px!important;\n  font-size:15px!important;\n  line-height:21px!important;\n}\nhtml.share-coupon-open .share-switch{\n  width:34px!important;\n  height:19px!important;\n  padding:3px!important;\n}\nhtml.share-coupon-open .share-switch:after{\n  width:13px!important;\n  height:13px!important;\n}\nhtml.share-coupon-open .share-amount input:checked+.share-switch:after{\n  transform:translateX(15px)!important;\n}\nhtml.share-coupon-open .share-actions{\n  gap:28px!important;\n  margin-top:2px!important;\n}\nhtml.share-coupon-open .share-actions button{\n  min-width:78px!important;\n  gap:7px!important;\n  font-size:13px!important;\n  line-height:17px!important;\n}\nhtml.share-coupon-open .share-actions button>span{\n  width:52px!important;\n  height:52px!important;\n}\nhtml.share-coupon-open .share-actions svg{\n  width:22px!important;\n  height:22px!important;\n}\nhtml.share-coupon-open .share-ticket canvas{\n  width:100%!important;\n  height:auto!important;\n}\n@media(display-mode:standalone){\n  html.share-coupon-open{\n    background:#171716!important;\n  }\n  body.share-coupon-open{\n    min-height:100dvh!important;\n    background:#f5f4f0!important;\n  }\n}\n\n/* Keep every discipline/team emblem centered inside a fixed optical box. */\n.reference-graphic,\n.team-logo,\n.synced-discipline-logo{\n  display:block!important;\n  box-sizing:border-box!important;\n  max-width:100%!important;\n  max-height:100%!important;\n  object-fit:contain!important;\n  object-position:center!important;\n  margin:auto!important;\n  border:0!important;\n  outline:0!important;\n  box-shadow:none!important;\n}\n.sport-symbol,\n.game-badge,\n.bet-sport,\n.team-mark,\n.tournament-symbol,\n.event-team-emblem{\n  overflow:hidden!important;\n  place-items:center!important;\n}\n.sport-symbol .reference-graphic{\n  width:26px!important;\n  height:26px!important;\n  padding:2px!important;\n}\n.game-badge .reference-graphic{\n  width:20px!important;\n  height:20px!important;\n  padding:1px!important;\n}\n.tournament-heading .game-badge .reference-graphic{\n  width:14px!important;\n  height:14px!important;\n  padding:1px!important;\n}\n.bet-sport .reference-graphic{\n  width:20px!important;\n  height:20px!important;\n  padding:1px!important;\n}\n.tournament-symbol .reference-graphic,\n.tournament-symbol .synced-discipline-logo{\n  width:42px!important;\n  height:42px!important;\n  padding:3px!important;\n}\n.team-mark .team-logo{\n  width:18px!important;\n  height:18px!important;\n  padding:1px!important;\n}\n.event-team-emblem .team-logo{\n  width:36px!important;\n  height:36px!important;\n  padding:2px!important;\n}\n.gamepad-graphic{\n  width:84%!important;\n  height:84%!important;\n  padding:0!important;\n  clip-path:inset(4%)!important;\n  transform:scale(.92)!important;\n  transform-origin:center!important;\n  object-fit:contain!important;\n  background:transparent!important;\n  mix-blend-mode:normal!important;\n}\n\n\n/* v75: force the share screen to match the original PWA frame after live SW refresh. */\nbody.share-coupon-open::before{\n  content:\"\";\n  position:fixed;\n  top:0;\n  left:0;\n  right:0;\n  height:env(safe-area-inset-top);\n  background:#171716;\n  z-index:2147483647;\n  pointer-events:none;\n}\nhtml.share-coupon-open .share-close{\n  top:calc(env(safe-area-inset-top) + 14px)!important;\n}\nhtml.share-coupon-open .share-layout{\n  padding-top:calc(env(safe-area-inset-top) + 58px)!important;\n  padding-bottom:max(10px,env(safe-area-inset-bottom))!important;\n}\nhtml.share-coupon-open .share-ticket{\n  width:96%!important;\n  margin-left:auto!important;\n  margin-right:auto!important;\n}\nhtml.share-coupon-open .share-amount{\n  width:calc(96% - 32px)!important;\n  margin-left:auto!important;\n  margin-right:auto!important;\n}\nhtml.share-coupon-open .share-actions{\n  transform:scale(.94)!important;\n  transform-origin:top center!important;\n}\nhtml.share-coupon-open .share-close,\nhtml.share-coupon-open .share-close *,\nhtml.share-coupon-open button{\n  -webkit-tap-highlight-color:transparent!important;\n}\nhtml.share-coupon-open .share-close:focus,\nhtml.share-coupon-open .share-close:focus-visible,\nhtml.share-coupon-open .share-close:active{\n  outline:none!important;\n  border:none!important;\n  box-shadow:none!important;\n}\n.team-mark .team-logo,\n.event-team-emblem .team-logo{\n  transform:scale(1.08)!important;\n  transform-origin:center!important;\n}\n\n\n/* v76: compact accumulator detail rows — one event must never consume half the screen. */\n.bet-detail-head{\n  min-height:70px!important;\n  padding:2px 8px!important;\n}\n.bet-detail-title strong{\n  font-size:18px!important;\n  line-height:22px!important;\n}\n.bet-detail-title span{\n  font-size:14px!important;\n  line-height:18px!important;\n}\n.bet-detail-selections{\n  min-height:0!important;\n}\n.bet-detail-selections .bet-selection{\n  margin:0!important;\n  padding:10px 14px 12px!important;\n  min-height:0!important;\n}\n.bet-detail-selections .bet-selection-summary{\n  min-height:56px!important;\n  padding:9px 14px!important;\n  border-radius:12px!important;\n  gap:10px!important;\n}\n.bet-detail-selections .bet-selection-label>.meta{\n  font-size:12px!important;\n  line-height:15px!important;\n}\n.bet-detail-selections .bet-selection-label>strong{\n  font-size:16px!important;\n  line-height:19px!important;\n}\n.bet-detail-selections .bet-coefficient{\n  font-size:16px!important;\n  line-height:20px!important;\n}\n.bet-detail-selections .bet-sport,\n.bet-detail-selections .bet-result{\n  flex:0 0 22px!important;\n  width:22px!important;\n  height:22px!important;\n}\n.bet-detail-selections .bet-result{\n  width:20px!important;\n  height:20px!important;\n  flex-basis:20px!important;\n}\n.bet-detail-selections .bet-event-time{\n  margin:7px 0 5px!important;\n  font-size:10px!important;\n  line-height:13px!important;\n}\n.bet-detail-selections .bet-teams{\n  gap:5px!important;\n  font-size:14px!important;\n  line-height:18px!important;\n}\n.bet-detail-selections .bet-team-score{\n  gap:6px!important;\n}\n.bet-detail-selections .bet-team-score small,\n.bet-detail-selections .bet-team-score b,\n.bet-detail-selections .bet-period-labels small{\n  width:15px!important;\n  font-size:12px!important;\n}\n.bet-detail-selections .bet-team-score b{\n  font-size:14px!important;\n}\n.bet-detail-footer{\n  padding:11px 16px max(10px,env(safe-area-inset-bottom))!important;\n}\n.bet-detail-footer dl{\n  gap:6px!important;\n  font-size:14px!important;\n  line-height:19px!important;\n}\n.bet-detail-share{\n  margin-top:10px!important;\n  min-height:34px!important;\n  padding:0 12px!important;\n  font-size:14px!important;\n}\n\n\n/* v77: clean transparent esports controller — no square, no clipping hacks. */\n.gamepad-graphic{\n  display:block!important;\n  width:100%!important;\n  height:100%!important;\n  max-width:100%!important;\n  max-height:100%!important;\n  padding:0!important;\n  margin:auto!important;\n  border:0!important;\n  outline:0!important;\n  box-shadow:none!important;\n  background:transparent!important;\n  object-fit:contain!important;\n  object-position:center!important;\n  clip-path:none!important;\n  transform:none!important;\n  mix-blend-mode:normal!important;\n}\n.sport-symbol .gamepad-graphic{width:28px!important;height:25px!important;max-width:28px!important;max-height:25px!important}\n.game-badge .gamepad-graphic{width:20px!important;height:18px!important;max-width:20px!important;max-height:18px!important}\n.bet-sport .gamepad-graphic{width:22px!important;height:20px!important;max-width:22px!important;max-height:20px!important}\n.bet-detail-selections .bet-sport .gamepad-graphic{width:21px!important;height:19px!important;max-width:21px!important;max-height:19px!important}\n.tournament-symbol .gamepad-graphic{width:38px!important;height:34px!important;max-width:38px!important;max-height:34px!important}\n\n\n/* v81: compact express detail to match the reference screen. */\n.profile-content.bet-detail-view{\n  top:calc(var(--header) + env(safe-area-inset-top))!important;\n  bottom:0!important;\n  padding:0!important;\n  overflow:hidden!important;\n  background:#fff!important;\n}\n.bet-detail-page{\n  height:100%!important;\n  min-height:0!important;\n  display:grid!important;\n  grid-template-rows:52px minmax(0,1fr) auto!important;\n  background:#fff!important;\n}\n.bet-detail-head{\n  height:52px!important;\n  min-height:52px!important;\n  grid-template-columns:36px minmax(0,1fr) 36px!important;\n  padding:0 6px!important;\n  border-bottom:1px solid #e6e3de!important;\n}\n.bet-detail-back{\n  width:34px!important;\n  height:34px!important;\n  margin:0!important;\n}\n.bet-detail-back svg{\n  width:20px!important;\n  height:20px!important;\n}\n.bet-detail-title{\n  gap:0!important;\n}\n.bet-detail-title strong{\n  font-size:16px!important;\n  line-height:19px!important;\n  font-weight:600!important;\n}\n.bet-detail-title span{\n  margin-top:1px!important;\n  font-size:13px!important;\n  line-height:16px!important;\n}\n.bet-detail-scroll{\n  min-height:0!important;\n  overflow-y:auto!important;\n  overflow-x:hidden!important;\n  -webkit-overflow-scrolling:touch!important;\n  overscroll-behavior:contain!important;\n  scrollbar-width:none!important;\n  background:#fff!important;\n}\n.bet-detail-scroll::-webkit-scrollbar{display:none!important}\n.bet-detail-selections{\n  min-height:0!important;\n}\n.bet-detail-selections .bet-selection{\n  margin:0!important;\n  padding:8px 12px 10px!important;\n  min-height:0!important;\n  border-bottom:1px solid #e6e3de!important;\n  background:#fff!important;\n}\n.bet-detail-selections .bet-selection-summary{\n  min-height:48px!important;\n  padding:7px 12px!important;\n  gap:9px!important;\n  border-radius:11px!important;\n}\n.bet-detail-selections .bet-selection-label>.meta{\n  font-size:11px!important;\n  line-height:14px!important;\n}\n.bet-detail-selections .bet-selection-label>strong{\n  font-size:15px!important;\n  line-height:18px!important;\n  font-weight:400!important;\n}\n.bet-detail-selections .bet-coefficient{\n  font-size:15px!important;\n  line-height:18px!important;\n}\n.bet-detail-selections .bet-selection-summary>svg{\n  width:14px!important;\n  height:18px!important;\n  margin-left:-5px!important;\n}\n.bet-detail-selections .bet-sport{\n  width:20px!important;\n  height:20px!important;\n  flex:0 0 20px!important;\n}\n.bet-detail-selections .bet-result{\n  width:19px!important;\n  height:19px!important;\n  flex:0 0 19px!important;\n  margin:0!important;\n}\n.bet-detail-selections .bet-result svg{\n  width:13px!important;\n  height:13px!important;\n}\n.bet-detail-selections .bet-event-time{\n  margin:6px 0 4px!important;\n  font-size:9px!important;\n  line-height:12px!important;\n}\n.bet-detail-selections .bet-teams{\n  gap:4px!important;\n  font-size:13px!important;\n  line-height:17px!important;\n}\n.bet-detail-selections .bet-teams>div{\n  min-height:17px!important;\n  gap:10px!important;\n}\n.bet-detail-selections .bet-team-score{\n  gap:5px!important;\n}\n.bet-detail-selections .bet-team-score small,\n.bet-detail-selections .bet-team-score b,\n.bet-detail-selections .bet-period-labels small{\n  width:13px!important;\n}\n.bet-detail-selections .bet-team-score small,\n.bet-detail-selections .bet-period-labels small{\n  font-size:10px!important;\n}\n.bet-detail-selections .bet-team-score b{\n  font-size:13px!important;\n}\n.bet-detail-footer{\n  padding:10px 12px max(10px,env(safe-area-inset-bottom))!important;\n  border-top:1px solid #e6e3de!important;\n  background:#fff!important;\n}\n.bet-detail-footer dl{\n  gap:5px!important;\n  font-size:13px!important;\n  line-height:18px!important;\n}\n.bet-detail-footer dl>div{\n  gap:10px!important;\n}\n.bet-detail-share{\n  min-height:32px!important;\n  margin-top:8px!important;\n  padding:0 11px!important;\n  gap:5px!important;\n  font-size:13px!important;\n  line-height:17px!important;\n}\n.bet-detail-share svg{\n  width:16px!important;\n  height:16px!important;\n}\n\n@media(max-width:370px){\n  .bet-detail-page{grid-template-rows:50px minmax(0,1fr) auto!important}\n  .bet-detail-head{height:50px!important;min-height:50px!important}\n  .bet-detail-selections .bet-selection{padding:7px 10px 9px!important}\n  .bet-detail-selections .bet-selection-summary{min-height:46px!important;padding:6px 10px!important}\n}\n\n\n/* v82: share screen copied to the supplied reference proportions. */\nhtml.share-coupon-open,\nbody.share-coupon-open{\n  background:#171717!important;\n}\nbody.share-coupon-open::before{\n  content:none!important;\n}\nhtml.share-coupon-open dialog.share-coupon,\nbody.share-coupon-open dialog.share-coupon{\n  position:fixed!important;\n  inset:env(safe-area-inset-top) 0 0 0!important;\n  width:100vw!important;\n  max-width:100vw!important;\n  height:auto!important;\n  min-height:0!important;\n  max-height:none!important;\n  margin:0!important;\n  padding:0!important;\n  border:0!important;\n  border-radius:0!important;\n  background:#f5f4f0!important;\n  box-shadow:0 -8px 14px rgba(0,0,0,.16)!important;\n  overflow:hidden!important;\n}\nhtml.share-coupon-open dialog.share-coupon::backdrop{\n  background:#171717!important;\n}\nhtml.share-coupon-open .share-layout{\n  width:100%!important;\n  max-width:393px!important;\n  height:100%!important;\n  min-height:100%!important;\n  margin:0 auto!important;\n  display:flex!important;\n  flex-direction:column!important;\n  box-sizing:border-box!important;\n  padding:64px 16px max(12px,env(safe-area-inset-bottom))!important;\n  background:#f5f4f0!important;\n}\nhtml.share-coupon-open .share-spacer{\n  flex:1 1 auto!important;\n  min-height:24px!important;\n}\nhtml.share-coupon-open .share-close{\n  position:absolute!important;\n  top:16px!important;\n  right:16px!important;\n  width:28px!important;\n  height:28px!important;\n  padding:0!important;\n  margin:0!important;\n  border:0!important;\n  outline:0!important;\n  box-shadow:none!important;\n  background:transparent!important;\n  color:#7b756b!important;\n  z-index:3!important;\n  -webkit-tap-highlight-color:transparent!important;\n}\nhtml.share-coupon-open .share-close svg{\n  width:24px!important;\n  height:24px!important;\n}\nhtml.share-coupon-open .share-close:focus,\nhtml.share-coupon-open .share-close:focus-visible,\nhtml.share-coupon-open .share-close:active{\n  outline:0!important;\n  border:0!important;\n  box-shadow:none!important;\n}\nhtml.share-coupon-open .share-ticket{\n  width:100%!important;\n  margin:0!important;\n  padding:0!important;\n  background:transparent!important;\n}\nhtml.share-coupon-open .share-ticket canvas{\n  display:block!important;\n  width:100%!important;\n  height:auto!important;\n  margin:0!important;\n}\nhtml.share-coupon-open .share-amount{\n  width:auto!important;\n  margin:20px 16px 16px!important;\n  gap:12px!important;\n  font-size:16px!important;\n  line-height:24px!important;\n  color:#4b4944!important;\n}\nhtml.share-coupon-open .share-switch{\n  width:36px!important;\n  height:20px!important;\n  padding:3px!important;\n  border-radius:20px!important;\n}\nhtml.share-coupon-open .share-switch:after{\n  width:14px!important;\n  height:14px!important;\n}\nhtml.share-coupon-open .share-amount input:checked+.share-switch:after{\n  transform:translateX(16px)!important;\n}\nhtml.share-coupon-open .share-actions{\n  gap:32px!important;\n  margin-top:4px!important;\n  transform:none!important;\n}\nhtml.share-coupon-open .share-actions button{\n  min-width:84px!important;\n  padding:0!important;\n  gap:8px!important;\n  font-size:14px!important;\n  line-height:18px!important;\n}\nhtml.share-coupon-open .share-actions button>span{\n  width:48px!important;\n  height:48px!important;\n  background:#fff!important;\n}\nhtml.share-coupon-open .share-actions svg{\n  width:22px!important;\n  height:22px!important;\n}\nhtml.share-coupon-open .share-error{\n  margin:12px 0 0!important;\n}\n@media(display-mode:standalone){\n  html.share-coupon-open,\n  body.share-coupon-open{\n    background:#171717!important;\n  }\n}\n@media(min-width:768px){\n  html.share-coupon-open .share-layout{\n    padding-bottom:32px!important;\n  }\n  html.share-coupon-open .share-close{\n    right:24px!important;\n  }\n}\n\n\n/* v86: open express share stays exactly on the pre-v82/v81 layout. */\nhtml.share-coupon-open.share-open-express-legacy{\n  background:#171716!important;\n}\nbody.share-coupon-open.share-open-express-legacy{\n  background:#f5f4f0!important;\n  overflow:hidden!important;\n}\nbody.share-coupon-open.share-open-express-legacy::before{\n  content:\"\"!important;\n  position:fixed!important;\n  top:0!important;\n  left:0!important;\n  right:0!important;\n  height:env(safe-area-inset-top)!important;\n  background:#171716!important;\n  z-index:2147483647!important;\n  pointer-events:none!important;\n}\nhtml.share-coupon-open.share-open-express-legacy dialog.share-coupon,\nbody.share-coupon-open.share-open-express-legacy dialog.share-coupon{\n  position:fixed!important;\n  inset:0!important;\n  width:100vw!important;\n  max-width:100vw!important;\n  height:100dvh!important;\n  min-height:100dvh!important;\n  max-height:none!important;\n  margin:0!important;\n  padding:0!important;\n  border:0!important;\n  border-radius:0!important;\n  background:#f5f4f0!important;\n  box-shadow:none!important;\n  overflow:hidden!important;\n}\nhtml.share-coupon-open.share-open-express-legacy dialog.share-coupon::backdrop{\n  background:#f5f4f0!important;\n}\nhtml.share-coupon-open.share-open-express-legacy .share-layout{\n  width:100%!important;\n  max-width:430px!important;\n  height:100%!important;\n  min-height:100%!important;\n  margin:auto!important;\n  display:flex!important;\n  flex-direction:column!important;\n  box-sizing:border-box!important;\n  padding:calc(env(safe-area-inset-top) + 58px) 16px max(10px,env(safe-area-inset-bottom))!important;\n  background:#f5f4f0!important;\n}\nhtml.share-coupon-open.share-open-express-legacy .share-spacer{\n  flex:1!important;\n  min-height:24px!important;\n}\nhtml.share-coupon-open.share-open-express-legacy .share-close{\n  top:calc(env(safe-area-inset-top) + 14px)!important;\n  right:16px!important;\n  width:24px!important;\n  height:24px!important;\n  padding:0!important;\n  margin:0!important;\n  border:0!important;\n  outline:0!important;\n  box-shadow:none!important;\n  background:transparent!important;\n  color:#8f8b80!important;\n}\nhtml.share-coupon-open.share-open-express-legacy .share-close svg{\n  width:22px!important;\n  height:22px!important;\n}\nhtml.share-coupon-open.share-open-express-legacy .share-ticket{\n  width:96%!important;\n  margin-left:auto!important;\n  margin-right:auto!important;\n  padding:0!important;\n}\nhtml.share-coupon-open.share-open-express-legacy .share-ticket canvas{\n  width:100%!important;\n  height:auto!important;\n}\nhtml.share-coupon-open.share-open-express-legacy .share-amount{\n  width:calc(96% - 32px)!important;\n  margin-top:18px!important;\n  margin-right:auto!important;\n  margin-bottom:14px!important;\n  margin-left:auto!important;\n  gap:10px!important;\n  font-size:15px!important;\n  line-height:21px!important;\n  color:inherit!important;\n}\nhtml.share-coupon-open.share-open-express-legacy .share-switch{\n  width:34px!important;\n  height:19px!important;\n  padding:3px!important;\n}\nhtml.share-coupon-open.share-open-express-legacy .share-switch:after{\n  width:13px!important;\n  height:13px!important;\n}\nhtml.share-coupon-open.share-open-express-legacy .share-amount input:checked+.share-switch:after{\n  transform:translateX(15px)!important;\n}\nhtml.share-coupon-open.share-open-express-legacy .share-actions{\n  gap:28px!important;\n  margin-top:2px!important;\n  transform:scale(.94)!important;\n  transform-origin:top center!important;\n}\nhtml.share-coupon-open.share-open-express-legacy .share-actions button{\n  min-width:78px!important;\n  padding:0!important;\n  gap:7px!important;\n  font-size:13px!important;\n  line-height:17px!important;\n}\nhtml.share-coupon-open.share-open-express-legacy .share-actions button>span{\n  width:52px!important;\n  height:52px!important;\n}\nhtml.share-coupon-open.share-open-express-legacy .share-actions svg{\n  width:22px!important;\n  height:22px!important;\n}\n\n\n/* v90: one share scale for every bet group; dark safe-area only at the top. */\nhtml.share-coupon-open,\nbody.share-coupon-open,\nhtml.share-coupon-open.share-open-express-legacy,\nbody.share-coupon-open.share-open-express-legacy{\n  background:#f5f4f0!important;\n}\nbody.share-coupon-open::before,\nbody.share-coupon-open.share-open-express-legacy::before{\n  content:\"\"!important;\n  position:fixed!important;\n  top:0!important;\n  left:0!important;\n  right:0!important;\n  height:env(safe-area-inset-top)!important;\n  background:#171717!important;\n  z-index:2147483647!important;\n  pointer-events:none!important;\n}\nhtml.share-coupon-open dialog.share-coupon,\nbody.share-coupon-open dialog.share-coupon,\nhtml.share-coupon-open.share-open-express-legacy dialog.share-coupon,\nbody.share-coupon-open.share-open-express-legacy dialog.share-coupon{\n  inset:env(safe-area-inset-top) 0 0 0!important;\n  width:100vw!important;\n  max-width:100vw!important;\n  height:auto!important;\n  min-height:0!important;\n  background:#f5f4f0!important;\n  box-shadow:none!important;\n}\nhtml.share-coupon-open dialog.share-coupon::backdrop,\nhtml.share-coupon-open.share-open-express-legacy dialog.share-coupon::backdrop{\n  background:#171717!important;\n}\nhtml.share-coupon-open .share-layout,\nhtml.share-coupon-open.share-open-express-legacy .share-layout{\n  width:100%!important;\n  max-width:393px!important;\n  height:100%!important;\n  min-height:100%!important;\n  margin:0 auto!important;\n  padding:64px 16px max(12px,env(safe-area-inset-bottom))!important;\n  background:#f5f4f0!important;\n}\nhtml.share-coupon-open .share-close,\nhtml.share-coupon-open.share-open-express-legacy .share-close{\n  top:16px!important;\n  right:16px!important;\n  width:28px!important;\n  height:28px!important;\n}\nhtml.share-coupon-open .share-close svg,\nhtml.share-coupon-open.share-open-express-legacy .share-close svg{\n  width:24px!important;\n  height:24px!important;\n}\nhtml.share-coupon-open .share-ticket,\nhtml.share-coupon-open.share-open-express-legacy .share-ticket{\n  width:100%!important;\n  margin:0!important;\n  padding:0!important;\n}\nhtml.share-coupon-open .share-ticket canvas,\nhtml.share-coupon-open.share-open-express-legacy .share-ticket canvas{\n  width:100%!important;\n  height:auto!important;\n}\nhtml.share-coupon-open .share-amount,\nhtml.share-coupon-open.share-open-express-legacy .share-amount{\n  width:auto!important;\n  margin:20px 16px 16px!important;\n  gap:12px!important;\n  font-size:16px!important;\n  line-height:24px!important;\n}\nhtml.share-coupon-open .share-switch,\nhtml.share-coupon-open.share-open-express-legacy .share-switch{\n  width:36px!important;\n  height:20px!important;\n  padding:3px!important;\n}\nhtml.share-coupon-open .share-switch:after,\nhtml.share-coupon-open.share-open-express-legacy .share-switch:after{\n  width:14px!important;\n  height:14px!important;\n}\nhtml.share-coupon-open .share-amount input:checked+.share-switch:after,\nhtml.share-coupon-open.share-open-express-legacy .share-amount input:checked+.share-switch:after{\n  transform:translateX(16px)!important;\n}\nhtml.share-coupon-open .share-actions,\nhtml.share-coupon-open.share-open-express-legacy .share-actions{\n  gap:32px!important;\n  margin-top:4px!important;\n  transform:none!important;\n}\nhtml.share-coupon-open .share-actions button,\nhtml.share-coupon-open.share-open-express-legacy .share-actions button{\n  min-width:84px!important;\n  padding:0!important;\n  gap:8px!important;\n  font-size:14px!important;\n  line-height:18px!important;\n}\nhtml.share-coupon-open .share-actions button>span,\nhtml.share-coupon-open.share-open-express-legacy .share-actions button>span{\n  width:48px!important;\n  height:48px!important;\n}\n@media(display-mode:standalone){\n  html.share-coupon-open,\n  body.share-coupon-open,\n  html.share-coupon-open.share-open-express-legacy,\n  body.share-coupon-open.share-open-express-legacy{\n    background:#f5f4f0!important;\n  }\n}\n\n\n/* v91: remove the artificial 6px PWA lift from the MAIN sports bottom bar only. */\n@media (display-mode:standalone){\n  .sports-nav{\n    padding-bottom:0!important;\n    min-height:var(--sports-footer)!important;\n  }\n  .sports-shell .slip-mini{\n    bottom:calc(var(--sports-footer) + 6px)!important;\n  }\n}\n\n\n/* v92: main sports footer height matched to the supplied original screenshot. */\n@media (display-mode:standalone){\n  :root{\n    --sports-footer:44px!important;\n  }\n  .sports-nav{\n    min-height:44px!important;\n    height:44px!important;\n    padding:0 4px!important;\n  }\n  .sports-nav>button{\n    height:44px!important;\n    min-height:44px!important;\n    gap:1px!important;\n    padding:1px 1px!important;\n  }\n  .sports-shell .slip-mini{\n    bottom:50px!important;\n  }\n}\n\n\n/* v93: keep the share bottom light, but restore the iOS-style home indicator only. */\nbody.share-coupon-open::after{\n  content:\"\"!important;\n  position:fixed!important;\n  left:50%!important;\n  bottom:7px!important;\n  width:140px!important;\n  height:6px!important;\n  transform:translateX(-50%)!important;\n  border-radius:999px!important;\n  background:#171717!important;\n  z-index:2147483647!important;\n  pointer-events:none!important;\n}\n\n\n/* v94: screenshot-matched share scale, with no dark top/bottom bars. */\nhtml.share-coupon-open,\nbody.share-coupon-open{\n  background:#f5f4f0!important;\n}\nbody.share-coupon-open::before,\nbody.share-coupon-open::after{\n  content:none!important;\n  display:none!important;\n}\nhtml.share-coupon-open dialog.share-coupon,\nbody.share-coupon-open dialog.share-coupon{\n  position:fixed!important;\n  inset:0!important;\n  width:100vw!important;\n  max-width:100vw!important;\n  height:100dvh!important;\n  min-height:100dvh!important;\n  max-height:none!important;\n  margin:0!important;\n  padding:0!important;\n  border:0!important;\n  border-radius:0!important;\n  background:#f5f4f0!important;\n  box-shadow:none!important;\n  overflow:hidden!important;\n}\nhtml.share-coupon-open dialog.share-coupon::backdrop{\n  background:#f5f4f0!important;\n}\nhtml.share-coupon-open .share-layout{\n  width:100%!important;\n  max-width:393px!important;\n  height:100%!important;\n  min-height:100%!important;\n  margin:0 auto!important;\n  display:flex!important;\n  flex-direction:column!important;\n  box-sizing:border-box!important;\n  padding:calc(env(safe-area-inset-top) + 64px) 16px max(12px,env(safe-area-inset-bottom))!important;\n  background:#f5f4f0!important;\n}\nhtml.share-coupon-open .share-close{\n  top:calc(env(safe-area-inset-top) + 16px)!important;\n  right:16px!important;\n  width:28px!important;\n  height:28px!important;\n}\nhtml.share-coupon-open .share-ticket{\n  width:100%!important;\n  margin:0!important;\n  padding:0!important;\n}\nhtml.share-coupon-open .share-ticket canvas{\n  width:100%!important;\n  height:auto!important;\n  margin:0!important;\n}\nhtml.share-coupon-open .share-amount{\n  width:auto!important;\n  margin:20px 16px 16px!important;\n  gap:12px!important;\n  font-size:16px!important;\n  line-height:24px!important;\n}\nhtml.share-coupon-open .share-actions{\n  gap:32px!important;\n  margin-top:4px!important;\n  transform:none!important;\n}\n@media (display-mode:standalone){\n  html.share-coupon-open,\n  body.share-coupon-open{\n    background:#f5f4f0!important;\n  }\n  :root{\n    --sports-footer:44px!important;\n  }\n  .sports-nav{\n    height:44px!important;\n    min-height:44px!important;\n    padding:0 4px!important;\n  }\n  .sports-nav>button{\n    height:44px!important;\n    min-height:44px!important;\n  }\n}\n\n\n/* v96: stable 44px bottom navigation across main/profile; share dark only at top. */\n@media (display-mode:standalone){\n  :root{\n    --sports-footer:44px!important;\n    --nav:44px!important;\n  }\n  .sports-nav,\n  .profile-nav{\n    height:44px!important;\n    min-height:44px!important;\n    padding-bottom:0!important;\n    border-top:1px solid #292621!important;\n  }\n  .profile-nav .nav-inner{\n    height:44px!important;\n    min-height:44px!important;\n  }\n  .sports-nav>button,\n  .profile-nav .nav-item{\n    height:44px!important;\n    min-height:44px!important;\n    padding:1px 1px 0!important;\n    transform:translateY(2px)!important;\n  }\n  .profile-content{\n    bottom:44px!important;\n  }\n  .profile-content.bet-detail-view{\n    bottom:0!important;\n  }\n  .sports-shell .slip-mini{\n    bottom:50px!important;\n  }\n}\n\nhtml.share-coupon-open{\n  background:#171717!important;\n}\nbody.share-coupon-open{\n  background:#f5f4f0!important;\n}\nbody.share-coupon-open::before{\n  content:\"\"!important;\n  display:block!important;\n  position:fixed!important;\n  inset:0 0 auto 0!important;\n  height:env(safe-area-inset-top)!important;\n  background:#171717!important;\n  z-index:2147483647!important;\n  pointer-events:none!important;\n}\nbody.share-coupon-open::after{\n  content:none!important;\n  display:none!important;\n}\nhtml.share-coupon-open dialog.share-coupon,\nbody.share-coupon-open dialog.share-coupon{\n  inset:env(safe-area-inset-top) 0 0 0!important;\n  height:auto!important;\n  min-height:0!important;\n  background:#f5f4f0!important;\n  box-shadow:none!important;\n}\nhtml.share-coupon-open dialog.share-coupon::backdrop{\n  background:#171717!important;\n}\nhtml.share-coupon-open .share-layout{\n  max-width:393px!important;\n  padding:64px 16px max(12px,env(safe-area-inset-bottom))!important;\n  background:#f5f4f0!important;\n}\nhtml.share-coupon-open .share-close{\n  top:16px!important;\n}\n\n\n/* v98: detailed per-match bet editor. */\n.edit-bet-general{\n  margin-bottom:14px!important;\n}\n.edit-selection-list{\n  display:grid!important;\n  gap:12px!important;\n  margin-top:14px!important;\n}\n.edit-selection-card{\n  padding:14px!important;\n  border-radius:14px!important;\n  background:#211f1d!important;\n  box-shadow:inset 0 0 0 1px #34312d!important;\n}\n.edit-selection-head{\n  display:flex!important;\n  align-items:flex-start!important;\n  justify-content:space-between!important;\n  gap:10px!important;\n  margin-bottom:3px!important;\n}\n.edit-selection-head strong{\n  min-width:0!important;\n  font-size:15px!important;\n  line-height:20px!important;\n  font-weight:600!important;\n  color:#f5f4f1!important;\n  overflow-wrap:anywhere!important;\n}\n.edit-selection-head span{\n  flex:0 0 auto!important;\n  color:#8f897f!important;\n  font-size:11px!important;\n  line-height:20px!important;\n}\n.edit-selection-card .edit-bet-market{\n  margin-bottom:10px!important;\n  font-size:12px!important;\n  line-height:16px!important;\n}\n.edit-selection-card .edit-bet-label{\n  margin:10px 0 7px!important;\n}\n.edit-selection-card .edit-winner-buttons{\n  gap:8px!important;\n}\n.edit-selection-card .edit-winner-buttons>button{\n  min-height:52px!important;\n  padding:8px 10px!important;\n  border-radius:11px!important;\n}\n.edit-selection-card .edit-winner-buttons>button small{\n  margin-top:2px!important;\n  font-size:10px!important;\n  line-height:13px!important;\n}\n.edit-result-controls{\n  display:grid!important;\n  grid-template-columns:1fr 1fr!important;\n  gap:8px!important;\n  margin:8px 0 12px!important;\n}\n.edit-result-controls>button{\n  min-height:34px!important;\n  padding:0 10px!important;\n  border-radius:10px!important;\n  background:#2d2a27!important;\n  color:#aaa69d!important;\n  font-size:12px!important;\n  font-weight:500!important;\n}\n.edit-result-controls>button.selected{\n  background:#49453f!important;\n  color:#f5f4f1!important;\n}\n.edit-selection-card>label{\n  display:block!important;\n  margin:9px 0 6px!important;\n  color:#aaa69d!important;\n  font-size:12px!important;\n  line-height:16px!important;\n}\n.edit-selection-card .edit-score-grid{\n  margin-top:10px!important;\n}\n.edit-selection-card .edit-score-grid label{\n  display:block!important;\n  margin-bottom:6px!important;\n  color:#aaa69d!important;\n  font-size:12px!important;\n  line-height:16px!important;\n}\n.edit-selection-card input{\n  min-height:42px!important;\n  padding:9px 10px!important;\n  border-radius:10px!important;\n}\n\n\n/* v99: VIP HOUSE textual header brand. */\n.viphouse-wordmark{\n  display:inline-flex!important;\n  align-items:center!important;\n  justify-content:flex-start!important;\n  width:auto!important;\n  min-width:112px!important;\n  max-width:122px!important;\n  height:24px!important;\n  margin:0!important;\n  padding:0!important;\n  color:#b58d70!important;\n  font-family:Roboto,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif!important;\n  font-size:19px!important;\n  line-height:24px!important;\n  font-weight:700!important;\n  letter-spacing:1.55px!important;\n  white-space:nowrap!important;\n  text-transform:uppercase!important;\n}\n.sports-header .brand .viphouse-wordmark,\n.profile-header .brand .viphouse-wordmark{\n  color:#b58d70!important;\n}\n@media(max-width:370px){\n  .viphouse-wordmark{\n    min-width:104px!important;\n    max-width:112px!important;\n    font-size:17px!important;\n    letter-spacing:1.35px!important;\n  }\n}\n\n\n/* v100: intentionally blank brand slot in the header. */\n.brand-placeholder{\n  display:inline-block!important;\n  width:120px!important;\n  min-width:120px!important;\n  max-width:120px!important;\n  height:24px!important;\n  margin:0!important;\n  padding:0!important;\n  font-size:0!important;\n  line-height:0!important;\n  color:transparent!important;\n  background:transparent!important;\n}\n@media(max-width:370px){\n  .brand-placeholder{\n    width:112px!important;\n    min-width:112px!important;\n    max-width:112px!important;\n  }\n}\n\n\n/* v102: express detail owns the bottom safe area; no black strip below the footer. */\nhtml.bet-detail-open,\nbody.bet-detail-open{\n  background:#fff!important;\n}\nbody.bet-detail-open #profile-layer{\n  background:#fff!important;\n}\nbody.bet-detail-open .profile-content.bet-detail-view,\nbody.bet-detail-open .bet-detail-page,\nbody.bet-detail-open .bet-detail-footer{\n  background:#fff!important;\n}\n@media (display-mode:standalone){\n  html.bet-detail-open,\n  body.bet-detail-open{\n    min-height:100dvh!important;\n    background:#fff!important;\n  }\n  body.bet-detail-open #profile-layer{\n    background:#fff!important;\n  }\n}\n\n\n/* v103: completed match screen from settled bet data. */\n.completed-event-page{\n  min-height:100%;\n  padding:44px 0 24px!important;\n  background:#f5f4f1!important;\n}\n.completed-match-card{\n  margin:0 8px!important;\n  overflow:hidden!important;\n  border-radius:18px!important;\n  background:#fff!important;\n}\n.completed-match-tabs{\n  display:grid!important;\n  grid-template-columns:1fr 1fr!important;\n  gap:0!important;\n  margin:0!important;\n  padding:3px!important;\n  border-radius:28px!important;\n  background:#e7e5df!important;\n}\n.completed-match-tabs>button{\n  min-height:40px!important;\n  border-radius:24px!important;\n  font-size:15px!important;\n  font-weight:600!important;\n  color:#716c64!important;\n}\n.completed-match-tabs>button.active{\n  background:#fff!important;\n  color:#292621!important;\n}\n.completed-match-scoreboard{\n  position:relative!important;\n  display:grid!important;\n  grid-template-columns:minmax(0,1fr) 104px minmax(0,1fr)!important;\n  align-items:start!important;\n  gap:8px!important;\n  padding:18px 16px 14px!important;\n}\n.completed-team{\n  display:flex!important;\n  flex-direction:column!important;\n  align-items:center!important;\n  justify-content:flex-start!important;\n  gap:8px!important;\n  min-width:0!important;\n  text-align:center!important;\n}\n.completed-team.team-0{grid-column:1!important}\n.completed-team.team-1{grid-column:3!important}\n.completed-team-emblem{\n  display:grid!important;\n  place-items:center!important;\n  width:72px!important;\n  height:72px!important;\n  border:1px solid #e6e3de!important;\n  border-radius:50%!important;\n  background:#fff!important;\n  overflow:hidden!important;\n}\n.completed-team-emblem .team-emblem-picture{\n  width:58px!important;\n  height:58px!important;\n  min-width:58px!important;\n  min-height:58px!important;\n  flex-basis:58px!important;\n}\n.completed-team>strong{\n  max-width:120px!important;\n  overflow:hidden!important;\n  text-overflow:ellipsis!important;\n  white-space:nowrap!important;\n  font-size:15px!important;\n  line-height:20px!important;\n  font-weight:400!important;\n}\n.completed-center{\n  grid-column:2!important;\n  display:flex!important;\n  flex-direction:column!important;\n  align-items:center!important;\n  justify-content:flex-start!important;\n  padding-top:23px!important;\n  text-align:center!important;\n}\n.completed-center>span{\n  font-size:11px!important;\n  line-height:15px!important;\n  font-weight:600!important;\n  letter-spacing:.5px!important;\n  color:#777168!important;\n}\n.completed-center>b{\n  margin-top:1px!important;\n  font-size:29px!important;\n  line-height:34px!important;\n  font-weight:700!important;\n  color:#171716!important;\n  font-variant-numeric:tabular-nums!important;\n  white-space:nowrap!important;\n}\n.completed-score-table{\n  padding:10px 12px 12px!important;\n  border-radius:14px!important;\n  background:#f5f4f1!important;\n}\n.completed-score-head,\n.completed-score-row{\n  display:grid!important;\n  grid-template-columns:minmax(0,1fr) auto!important;\n  align-items:center!important;\n}\n.completed-score-head{\n  min-height:24px!important;\n  color:#7b756b!important;\n  font-size:11px!important;\n}\n.completed-score-row{\n  min-height:34px!important;\n  font-size:15px!important;\n  line-height:20px!important;\n}\n.completed-score-head>div,\n.completed-score-row>div{\n  display:flex!important;\n  align-items:center!important;\n  justify-content:flex-end!important;\n  gap:15px!important;\n}\n.completed-score-head span,\n.completed-score-head b,\n.completed-score-row small,\n.completed-score-row b{\n  width:16px!important;\n  flex:0 0 16px!important;\n  text-align:right!important;\n  font-variant-numeric:tabular-nums!important;\n}\n.completed-score-head b,\n.completed-score-row b{\n  color:#e32a2a!important;\n  font-weight:500!important;\n}\n.completed-score-row small{\n  color:#777168!important;\n  font-size:13px!important;\n}\n.completed-score-row>span{\n  min-width:0!important;\n  overflow:hidden!important;\n  text-overflow:ellipsis!important;\n  white-space:nowrap!important;\n}\n.completed-event-page .event-history-block{\n  margin:12px 8px 0!important;\n}\n\n\n/* v104: completed-match geometry measured from the supplied 390x844 reference. */\n.event-open .event-header{\n  background:#fff!important;\n}\n.completed-event-header-inner{\n  height:56px!important;\n  min-height:56px!important;\n  padding:0 16px!important;\n  gap:12px!important;\n}\n.completed-event-header-inner .event-heading{\n  text-align:center!important;\n}\n.completed-event-header-inner .event-heading h1{\n  margin:0!important;\n  font-size:18px!important;\n  line-height:24px!important;\n  font-weight:600!important;\n}\n.completed-event-header-inner>button{\n  width:24px!important;\n  height:32px!important;\n  padding:0!important;\n}\n.completed-event-header-inner>button svg{\n  width:24px!important;\n  height:24px!important;\n}\n\n.completed-event-page{\n  min-height:100%!important;\n  padding:0!important;\n  background:#f3f2ee!important;\n}\n.completed-match-card{\n  width:100%!important;\n  margin:0!important;\n  padding:20px 0 10px!important;\n  border-radius:0!important;\n  background:#fff!important;\n  overflow:visible!important;\n  box-sizing:border-box!important;\n}\n.completed-match-tabs{\n  display:grid!important;\n  grid-template-columns:1fr 1fr!important;\n  width:auto!important;\n  height:38px!important;\n  margin:0 8px!important;\n  padding:2px!important;\n  gap:0!important;\n  border-radius:22px!important;\n  background:#e1e0db!important;\n  box-sizing:border-box!important;\n}\n.completed-match-tabs>button{\n  display:grid!important;\n  place-items:center!important;\n  width:100%!important;\n  height:34px!important;\n  min-height:34px!important;\n  padding:0!important;\n  border-radius:18px!important;\n  color:#716d66!important;\n  font-size:14px!important;\n  line-height:18px!important;\n  font-weight:600!important;\n}\n.completed-match-tabs>button.active{\n  background:#fff!important;\n  color:#292621!important;\n}\n.completed-score-pill{\n  display:inline-grid!important;\n  place-items:center!important;\n  min-width:30px!important;\n  height:18px!important;\n  padding:0 5px!important;\n  border-radius:4px!important;\n  background:#292621!important;\n  color:#fff!important;\n  box-sizing:border-box!important;\n  font-size:11px!important;\n  line-height:18px!important;\n  font-weight:700!important;\n  font-variant-numeric:tabular-nums!important;\n}\n\n.completed-match-scoreboard{\n  display:grid!important;\n  grid-template-columns:minmax(0,1fr) 96px minmax(0,1fr)!important;\n  grid-template-rows:1fr!important;\n  align-items:start!important;\n  gap:8px!important;\n  width:100%!important;\n  height:112px!important;\n  min-height:112px!important;\n  padding:16px 12px 8px!important;\n  box-sizing:border-box!important;\n  background:#fff!important;\n}\n.completed-team{\n  display:flex!important;\n  flex-direction:column!important;\n  align-items:center!important;\n  justify-content:flex-start!important;\n  gap:8px!important;\n  min-width:0!important;\n  text-align:center!important;\n}\n.completed-team.team-0{\n  grid-column:1!important;\n}\n.completed-team.team-1{\n  grid-column:3!important;\n}\n.completed-team-emblem{\n  display:grid!important;\n  place-items:center!important;\n  width:64px!important;\n  height:64px!important;\n  min-width:64px!important;\n  min-height:64px!important;\n  border:1px solid #e7e5df!important;\n  border-radius:50%!important;\n  background:#fff!important;\n  box-sizing:border-box!important;\n  overflow:hidden!important;\n}\n.completed-team-emblem .team-emblem-picture{\n  width:52px!important;\n  height:52px!important;\n  min-width:52px!important;\n  min-height:52px!important;\n  flex:0 0 52px!important;\n}\n.completed-team-emblem .team-logo{\n  object-fit:contain!important;\n}\n.completed-team>strong{\n  display:block!important;\n  max-width:128px!important;\n  margin:0!important;\n  overflow:hidden!important;\n  text-overflow:ellipsis!important;\n  white-space:nowrap!important;\n  color:#292621!important;\n  font-size:12px!important;\n  line-height:16px!important;\n  font-weight:400!important;\n}\n.completed-center{\n  grid-column:2!important;\n  display:flex!important;\n  flex-direction:column!important;\n  align-items:center!important;\n  justify-content:flex-start!important;\n  padding-top:26px!important;\n  text-align:center!important;\n}\n.completed-center>span{\n  margin:0!important;\n  color:#777168!important;\n  font-size:10px!important;\n  line-height:14px!important;\n  font-weight:600!important;\n  letter-spacing:.35px!important;\n}\n.completed-center>b{\n  margin:0!important;\n  color:#171716!important;\n  font-size:24px!important;\n  line-height:32px!important;\n  font-weight:700!important;\n  font-variant-numeric:tabular-nums!important;\n  white-space:nowrap!important;\n}\n\n.completed-score-table{\n  display:grid!important;\n  grid-template-rows:17px 25px 25px!important;\n  width:auto!important;\n  height:80px!important;\n  margin:0 8px!important;\n  padding:6px 12px 7px!important;\n  border-radius:13px!important;\n  background:#f6f5f3!important;\n  box-sizing:border-box!important;\n  overflow:hidden!important;\n}\n.completed-score-head,\n.completed-score-row{\n  display:grid!important;\n  grid-template-columns:minmax(0,1fr) auto!important;\n  align-items:center!important;\n  min-height:0!important;\n}\n.completed-score-head{\n  color:#777168!important;\n  font-size:11px!important;\n  line-height:17px!important;\n}\n.completed-score-row{\n  color:#292621!important;\n  font-size:15px!important;\n  line-height:25px!important;\n}\n.completed-score-head>div,\n.completed-score-row>div{\n  display:flex!important;\n  align-items:center!important;\n  justify-content:flex-end!important;\n  gap:15px!important;\n}\n.completed-score-head span,\n.completed-score-head b,\n.completed-score-row small,\n.completed-score-row b{\n  width:16px!important;\n  flex:0 0 16px!important;\n  text-align:right!important;\n  font-variant-numeric:tabular-nums!important;\n}\n.completed-score-head b{\n  color:#777168!important;\n  font-weight:500!important;\n}\n.completed-score-row small{\n  color:#777168!important;\n  font-size:13px!important;\n  line-height:25px!important;\n}\n.completed-score-row b{\n  color:#e32a2a!important;\n  font-size:14px!important;\n  line-height:25px!important;\n  font-weight:500!important;\n}\n.completed-score-row>span{\n  min-width:0!important;\n  overflow:hidden!important;\n  text-overflow:ellipsis!important;\n  white-space:nowrap!important;\n}\n.completed-event-page .event-history-block{\n  margin:20px 8px 0!important;\n}\n\n\n/* v106: lock the completed total score to the measured reference position. */\n.completed-match-scoreboard{\n  position:relative!important;\n}\n.completed-center{\n  position:absolute!important;\n  top:29px!important;\n  left:50%!important;\n  width:96px!important;\n  grid-column:auto!important;\n  padding:0!important;\n  margin:0!important;\n  transform:translateX(-50%)!important;\n  z-index:2!important;\n}\n.completed-center>span{\n  display:block!important;\n  height:14px!important;\n  margin:0!important;\n  line-height:14px!important;\n}\n.completed-center>b{\n  display:block!important;\n  height:32px!important;\n  margin:0!important;\n  line-height:32px!important;\n}\n\n\n/* v107: no broken-image/question-mark flash while team avatars resolve. */\n.team-emblem-picture[data-logo-state=\"loading\"] .team-logo{\n  opacity:0!important;\n  visibility:hidden!important;\n}\n.team-emblem-picture[data-logo-state=\"loading\"] .team-emblem-fallback{\n  opacity:0!important;\n  visibility:hidden!important;\n}\n.team-emblem-picture[data-logo-state=\"ready\"] .team-logo{\n  opacity:1!important;\n  visibility:visible!important;\n}\n.team-emblem-picture[data-logo-state=\"ready\"] .team-emblem-fallback{\n  opacity:0!important;\n  visibility:hidden!important;\n}\n.team-emblem-picture[data-logo-state=\"failed\"] .team-logo{\n  opacity:0!important;\n  visibility:hidden!important;\n}\n.team-emblem-picture[data-logo-state=\"failed\"] .team-emblem-fallback{\n  opacity:1!important;\n  visibility:visible!important;\n}\n.team-logo{\n  transition:none!important;\n}\n\n\n/* v104: per-selection accordion editor with editable market/outcome. */\n.edit-selection-caption{\n  display:flex!important;\n  align-items:center!important;\n  justify-content:space-between!important;\n  gap:12px!important;\n  margin:16px 2px 8px!important;\n  color:#aaa69d!important;\n}\n.edit-selection-caption strong{\n  color:#f5f4f1!important;\n  font-size:14px!important;\n  line-height:20px!important;\n  font-weight:600!important;\n}\n.edit-selection-caption span{\n  display:grid!important;\n  place-items:center!important;\n  min-width:24px!important;\n  height:24px!important;\n  padding:0 7px!important;\n  border-radius:12px!important;\n  background:#2d2a27!important;\n  color:#aaa69d!important;\n  font-size:11px!important;\n}\n.edit-selection-list{\n  gap:8px!important;\n  margin-top:0!important;\n}\n.edit-selection-card{\n  padding:0!important;\n  overflow:hidden!important;\n  border-radius:14px!important;\n  background:#211f1d!important;\n  box-shadow:inset 0 0 0 1px #34312d!important;\n}\n.edit-selection-card>summary{\n  list-style:none!important;\n}\n.edit-selection-card>summary::-webkit-details-marker{\n  display:none!important;\n}\n.edit-selection-head{\n  display:flex!important;\n  align-items:center!important;\n  justify-content:space-between!important;\n  gap:12px!important;\n  width:100%!important;\n  min-height:66px!important;\n  margin:0!important;\n  padding:12px 14px!important;\n  cursor:pointer!important;\n  background:transparent!important;\n  border:0!important;\n  outline:0!important;\n  box-shadow:none!important;\n}\n.edit-selection-head-copy{\n  display:grid!important;\n  min-width:0!important;\n  gap:3px!important;\n  text-align:left!important;\n}\n.edit-selection-head-copy strong{\n  display:block!important;\n  min-width:0!important;\n  overflow:hidden!important;\n  text-overflow:ellipsis!important;\n  white-space:nowrap!important;\n  color:#f5f4f1!important;\n  font-size:14px!important;\n  line-height:19px!important;\n  font-weight:600!important;\n}\n.edit-selection-head-copy small{\n  display:block!important;\n  min-width:0!important;\n  overflow:hidden!important;\n  text-overflow:ellipsis!important;\n  white-space:nowrap!important;\n  color:#8f897f!important;\n  font-size:11px!important;\n  line-height:16px!important;\n}\n.edit-selection-head-side{\n  display:flex!important;\n  flex:0 0 auto!important;\n  align-items:center!important;\n  gap:6px!important;\n  color:#8f897f!important;\n  font-size:11px!important;\n}\n.edit-selection-head-side b{\n  font-weight:500!important;\n}\n.edit-selection-head-side svg{\n  width:16px!important;\n  height:16px!important;\n  transition:transform .18s ease!important;\n}\n.edit-selection-card[open] .edit-selection-head-side svg{\n  transform:rotate(180deg)!important;\n}\n.edit-selection-body{\n  padding:2px 14px 14px!important;\n  border-top:1px solid #34312d!important;\n}\n.edit-selection-section-title{\n  margin:12px 0 8px!important;\n  color:#f5f4f1!important;\n  font-size:12px!important;\n  line-height:17px!important;\n  font-weight:600!important;\n}\n.edit-selection-section-title.edit-result-title{\n  margin-top:18px!important;\n  padding-top:14px!important;\n  border-top:1px solid #34312d!important;\n}\n.edit-selection-body>label{\n  display:block!important;\n  margin:9px 0 6px!important;\n  color:#aaa69d!important;\n  font-size:11px!important;\n  line-height:15px!important;\n}\n.edit-selection-body input{\n  min-height:42px!important;\n  padding:9px 10px!important;\n  border-radius:10px!important;\n}\n.edit-score-presets{\n  display:grid!important;\n  grid-template-columns:repeat(3,minmax(0,1fr))!important;\n  gap:7px!important;\n  margin:8px 0 11px!important;\n}\n.edit-score-presets>button{\n  min-height:38px!important;\n  padding:6px 8px!important;\n  border:0!important;\n  outline:0!important;\n  border-radius:9px!important;\n  background:#2d2a27!important;\n  color:#d7d3cc!important;\n  font-size:13px!important;\n  font-weight:600!important;\n}\n.edit-score-presets>button.selected{\n  background:#eef719!important;\n  color:#292621!important;\n}\n.edit-result-controls-wide{\n  grid-template-columns:repeat(3,minmax(0,1fr))!important;\n}\n.edit-result-controls-wide>button{\n  padding:0 7px!important;\n  font-size:11px!important;\n}\n.edit-bet-form-v2 .edit-payout-preview{\n  position:sticky!important;\n  bottom:0!important;\n  z-index:4!important;\n  margin:14px -14px 0!important;\n  padding:12px 14px!important;\n  background:#171716!important;\n}\n@media(max-width:380px){\n  .edit-score-presets{\n    grid-template-columns:repeat(2,minmax(0,1fr))!important;\n  }\n  .edit-result-controls-wide{\n    grid-template-columns:1fr!important;\n  }\n}\n\n\n/* v113: live line picker inside bet editor. */\n.edit-line-picker{display:grid!important;gap:6px!important;margin:4px 0 8px!important}\n.edit-line-picker>label{display:block!important;margin:7px 0 0!important;color:#aaa69d!important;font-size:11px!important;line-height:15px!important}\n.edit-line-market-select,.edit-line-outcome-select{width:100%!important;min-height:44px!important;padding:0 38px 0 11px!important;border:1px solid #3a3732!important;border-radius:10px!important;outline:0!important;background:#2a2825!important;color:#f4f1ec!important;font:500 13px/18px Roboto,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif!important;appearance:auto!important}\n.edit-line-market-select:focus,.edit-line-outcome-select:focus{border-color:#817c72!important;box-shadow:0 0 0 1px #817c72!important}\n.edit-line-market-select:disabled,.edit-line-outcome-select:disabled{opacity:.62!important}\n.edit-line-status{min-height:17px!important;margin:1px 1px 4px!important;color:#777168!important;font-size:10px!important;line-height:15px!important}\n.edit-manual-fallback{margin-top:8px!important;border-top:1px solid #34312d!important}\n.edit-manual-fallback>summary{padding:10px 0 2px!important;color:#8f897f!important;font-size:11px!important;line-height:16px!important;cursor:pointer!important}\n.edit-manual-fallback>label{display:block!important;margin:8px 0 6px!important;color:#aaa69d!important;font-size:11px!important}\n.edit-manual-fallback input{width:100%!important}\n\n\n/* v114: duplicate bet action in the existing editor. */\n.edit-bet-duplicate{\n  width:100%!important;\n  min-height:44px!important;\n  margin-top:8px!important;\n  padding:0 14px!important;\n  display:flex!important;\n  align-items:center!important;\n  justify-content:center!important;\n  gap:8px!important;\n  border:1px solid #403d38!important;\n  border-radius:11px!important;\n  background:#2a2825!important;\n  color:#f5f4f1!important;\n  font-size:13px!important;\n  font-weight:600!important;\n}\n.edit-bet-duplicate svg{\n  width:16px!important;\n  height:16px!important;\n  flex:0 0 16px!important;\n}\n.edit-bet-duplicate:active{\n  background:#34312d!important;\n}\n\n\n/* v115: editable bet time and manual odds. */\n.edit-bet-date{\n  width:100%!important;\n  min-height:44px!important;\n  margin-bottom:8px!important;\n  color-scheme:dark!important;\n}\n.edit-manual-fallback .edit-odds{\n  margin-bottom:4px!important;\n}\n";
const serviceWorkerModule = "const CACHE = 'arena-line-sync-v112';\n\nconst PRECACHE = [\n  '/',\n  '/app.js',\n  '/app.css',\n  '/theme.css',\n  '/theme.mjs',\n  '/team-emblem.mjs',\n  '/settings.css',\n  '/i18n.mjs',\n  '/match-filter.mjs',\n  '/sports.css',\n  '/sports.mjs',\n  '/bet-view.css',\n  '/bet-view.mjs',\n  '/event-view.css',\n  '/event-view.mjs',\n  '/share-coupon.css',\n  '/share-coupon.mjs',\n  '/ui.mjs',\n  '/feed.mjs',\n  '/account.mjs',\n  '/settlement.mjs',\n  '/results.mjs',\n  '/lucide.min.js',\n  '/manifest.webmanifest',\n  '/assets/wordmark.png',\n  '/assets/icons/esports-controller-clean-v79.png',\n  '/assets/fonts/roboto-regular.ttf',\n  '/assets/fonts/roboto-semibold.woff2',\n  ...['favorite','football','tennis','table-tennis','hockey','esports','basketball','snooker','volleyball','lol','counter-strike','dota']\n    .map(name => `/assets/icons/${name}.png`)\n];\n\nasync function cacheFirst(request,{ignoreSearch=false,cacheMissing=false}={}) {\n  const cache = await caches.open(CACHE);\n  const cached = await cache.match(request,{ignoreSearch});\n  if (cached) return cached;\n  const response = await fetch(request);\n  if (response && (response.ok || (cacheMissing && response.status === 404))) {\n    cache.put(request,response.clone()).catch(()=>{});\n  }\n  return response;\n}\n\nasync function networkFirst(request) {\n  const cache = await caches.open(CACHE);\n  try {\n    const response = await fetch(request, { cache:'no-store' });\n    if (response && response.ok) {\n      cache.put(request,response.clone()).catch(()=>{});\n    }\n    return response;\n  } catch {\n    return (await cache.match(request,{ignoreSearch:false})) || (await cache.match(request,{ignoreSearch:true})) || Response.error();\n  }\n}\n\nasync function navigation(request) {\n  try {\n    const response = await fetch(request);\n    if (response && response.ok) {\n      const cache = await caches.open(CACHE);\n      cache.put('/',response.clone()).catch(()=>{});\n    }\n    return response;\n  } catch {\n    return (await caches.match('/')) || Response.error();\n  }\n}\n\nself.addEventListener('install', event => {\n  event.waitUntil(\n    caches.open(CACHE)\n      .then(cache => cache.addAll(PRECACHE))\n      .then(() => self.skipWaiting())\n  );\n});\n\nself.addEventListener('activate', event => {\n  event.waitUntil(\n    caches.keys()\n      .then(keys => Promise.all(\n        keys\n          .filter(key => key.startsWith('arena-line-') && key !== CACHE)\n          .map(key => caches.delete(key))\n      ))\n      .then(() => self.clients.claim())\n      .then(async () => {\n        const clients = await self.clients.matchAll({type:'window',includeUncontrolled:true});\n        await Promise.all(clients.map(client => client.navigate(client.url).catch(()=>{})));\n      })\n  );\n});\n\nself.addEventListener('fetch', event => {\n  const request = event.request;\n  if (request.method !== 'GET') return;\n\n  const url = new URL(request.url);\n  if (url.origin !== self.location.origin) return;\n\n  if (request.mode === 'navigate') {\n    event.respondWith(navigation(request));\n    return;\n  }\n\n  if (url.pathname.startsWith('/api/media/')) {\n    event.respondWith(cacheFirst(request));\n    return;\n  }\n\n  if (url.pathname.startsWith('/api/')) {\n    return;\n  }\n\n  if (url.pathname === '/sw.js') {\n    return;\n  }\n\n  if (/\\.(?:js|mjs|css|webmanifest)$/i.test(url.pathname)) {\n    event.respondWith(networkFirst(request));\n    return;\n  }\n\n  event.respondWith(cacheFirst(request,{ignoreSearch:false}));\n});\n";
const manifestModule = "{\n  \"name\": \"Arena Line Live\",\n  \"short_name\": \"ArenaLine\",\n  \"start_url\": \"/\",\n  \"scope\": \"/\",\n  \"display\": \"standalone\",\n  \"background_color\": \"#171716\",\n  \"theme_color\": \"#171716\",\n  \"icons\": [\n    {\n      \"src\": \"/assets/icons/esports.png\",\n      \"sizes\": \"any\",\n      \"type\": \"image/png\",\n      \"purpose\": \"any\"\n    },\n    {\n      \"src\": \"/assets/icons/esports.png\",\n      \"sizes\": \"any\",\n      \"type\": \"image/png\",\n      \"purpose\": \"maskable\"\n    }\n  ]\n}";
const uiModule = "// Stable same-origin/inline UI graphics for Safari/PWA.\nconst shapes = {\n  'sports-score':'<rect x=\"3\" y=\"4\" width=\"18\" height=\"16\" rx=\"2.4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\"/><text x=\"12\" y=\"15.2\" text-anchor=\"middle\" fill=\"currentColor\" font-family=\"Roboto,sans-serif\" font-size=\"9.2\" font-weight=\"600\">2:1</text>',\n  'profile-solid':'<path fill=\"currentColor\" fill-rule=\"evenodd\" d=\"M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 4a3.2 3.2 0 1 1 0 6.4A3.2 3.2 0 0 1 12 6Zm-5.5 12a6 6 0 0 1 11 0 8 8 0 0 1-11 0Z\"/>',\n  'casino-wheel':'<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"10\"/><circle cx=\"12\" cy=\"12\" r=\"7\"/><path d=\"m12 7 4.8 3.5-1.8 5.6H9l-1.8-5.6L12 7Zm0-5v5m9.5 1.9-4.7 1.6m1.1 9.6L15 16.1m-8.9 4L9 16.1M2.5 8.9l4.7 1.6\"/></g>'\n};\n\nexport function icon(name,className='') {\n  return shapes[name]\n    ? `<svg class=\"ui-icon ui-${name} ${className}\" viewBox=\"0 0 24 24\" aria-hidden=\"true\">${shapes[name]}</svg>`\n    : `<i data-lucide=\"${name}\" class=\"${className}\" aria-hidden=\"true\"></i>`;\n}\n\nconst ESPORTS_CONTROLLER_DATA='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAAA4CAMAAAB6xg5AAAABgFBMVEXc5Nvb3N6u3d/i4+WqqqqknqCwxMQAAADm5+coJynV19f29/fIyMkXFhj+/v4zNDaztbYNCQpFRUepqKmWlZaIiIl2d3hVVVfb4eESJyloaGkoJynk2Ng6OjsDqq1VVVU+PkABtrknJij09fYLhoglFhi/v7/FursZGhodHiAAx8onJih/f3+8wsMXFxccHBwpJyoqKStLhomqqqrd3+Do6Ojj4+P5+fooKClw5efb3NwJbG4MdXgrKytAP0H4+fkMCQsBS0wGlJc1iYxG5eeZy86P1deF6u3Ky8vW1tbW19ja29zJ9/ni4+Ph4uP5+/sOfoIOvcEhCAo2REc2295QXmFlZWaHh4i+v8C/v/+x5+q////Nzc3T1tPg4eH3+Pj5+fkTDw8YGBocHCofHyUeHiEMOzwAVVUAU1MAX2AA//8qHBwtHyMxMTQ7Ozw+PkE+rbE9t7s/3+NXT1dQSEhDQURIyMxJ1NZY3+F/AH9nZ2d5eXlqsrdy1Ndx3+Khl5hVpApVAAAAgHRSTlMWY/2ihf0NAPz6/Pz8/AP8/Pz6/fz9/P39/f0v/Ar9BPr90mv8/Qb8Kf39rAL8FFFSav0D/RE0MpL9bv39EPq4cv36/f39/f3bDIXV/VitTf39/P39/M6w/QT9BBIp34zQgZISMFT9A/79ARL9nM9a/f39HSPN/f39AlFY+/39/T8HDKoAAATBSURBVHja7Zf3V9tIEMeV5O60VWVVbctxiY1bIIGYFnoPkN4vdynXe+/9X7+ZlVyAOMC73+5l4GFLu/PRd8quFsP8j2a8BpwWcPEYQKmEf61R7nqgVBwJQLxVKphm8eX+cLvww+5oBZZZ/Oarqq0e4r2JiYlms6Dtw0KzCZdwc+bhg3K1M1kc1jgAlMxVFQUeI5y9/95PSqnysloul8t2ZtXVOcYJ80JFV83SUcBFsxgKnlqe2n0/m2YmaciJHhbhj4Ns9gCWNb2iRwkh3FuvUfAc8qb0bm29gYPMAcr+u5Z1GGBe4NzJR0EMk8hU+9DjKc21p3BERDSKCb9qHgJYlsW5LyWV987ywPMqt+lBQH2x0nBCwgNKXR9SsduTYAwEMApOqr543bPFRvtgALTVnkpsn3NPSteBQPsSjMx/+gX/swUeys7Nk7x4s7JIhwH1hYrH8iIMmR/5+PHsLfMgADLwLQqIaO6XhPBko/0lHQLI9gYkIKIygkRG0o34mUxCDwAl+Bmer2x37VcRxzyo3M4NTNYqHicCSDbBUCUl54YBljkLYe0s3oUA3cqWgEKRqTvnB1ap6BLkpQyYR0LphoTNpgQNuGL+gQ2wWcvlPm3/1WBOEAjSGBfjngPmwZcGiRkQPEcoqZjjQD/8Dm6DEB5FBAg7m/c3txqiq6hUcMmJrw08n0zZ9oMtuBVKXUbO1KNBCBiBr2B+kjAhYDEoyIbuSQESPEGSJwuupPWPtxPiu1BGwgUNyFMdg9GrQWAzdImJkw/LkKwwFNjV+pd8By1G7XotBkLkE+5Qn7CrQ4AVjj0m9ELIS0x2uUwjgALksf3P9Vod79G1nSTWa0V6RLCbPYBlWriIgOBwXWyYu6wURKEB8DQNsKP62t9JzGJoeY8wsGkkaMCtdBGG0kNOC/sBKEE/hPiOpPY9213fhgxBFbW/YDNYBw14rgGgHhMMg9BPimHZWD6KQhIn8zUX7LP7DVAEk/TzRXzGHMsAKykA5LshflM2Vfqa4epgMH++srBw/ntHANwNtD/LkmCkKUj9wcHNw0dg20F2A8saxyw5Oz+/3RBM4ASWAfbR2cj6ODUeSBkxcsTibpIAijmwCpweAJOAgHewCwYA6i57Dv4cNS+gLm15WQRCdG9AEhDwvOdPuuUWrCeZLuFqlR4yHJL5PoDtacDn1osM0EUB0HOdS81st7iE1rtoftTB0ZbTB2AWDdiMsghiyKGEGZdHvxovA0FGJPUXYn/XtIxBDhm0iPYvjvIvIYFKDyqgAdiLBvZh5i8gSDo52h/fjpOgQfUUYC8OA2DDkXOv8kdCByb5qf84u6EVXNDLWAuQ1Q+OOyEsaQka4ABgLAPETAt4VQJ7acAgUgkObAlvp4AuSwV0hl67owifdKSrJYwPARgKgC4pnOSQU4BcowQAwHo0rpiz6B8L6kIGT2Alc66lJTx2xIxOooVbAAlBwBcnO2mBBOkJR4hrsBRxNZ5DCSBg8mT+IIG6EbwcxB5sSQYeLaAHYLuuFk962CvC01AAHjMMTMvMM1J2jy/hwCapG7JrT7NNFfekN6q085JT5Aj7bakqv94b678X8MtS4VQnVj3dGno3jp3+kDxmvf5/4f8D+BcfSMcT3GOUnAAAAABJRU5ErkJggg==';\n\nexport const wordmark='<span class=\"wordmark brand-placeholder\" aria-hidden=\"true\"></span>';\n\nconst fallbackSvg = name => {\n  const label = {\n    valorant:'V',\n    'free-fire':'FF',\n    'mobile-legends':'ML',\n    pubg:'P',\n    apex:'A',\n    overwatch:'O',\n    'rainbow-six':'R6',\n    'rocket-league':'RL',\n    'call-of-duty':'COD'\n  }[name];\n  if (!label) return '';\n  return `<svg class=\"reference-graphic fallback-discipline\" viewBox=\"0 0 32 32\" aria-hidden=\"true\"><circle cx=\"16\" cy=\"16\" r=\"15\" fill=\"#101010\"/><text x=\"16\" y=\"19.5\" text-anchor=\"middle\" fill=\"#f2f740\" font-size=\"${label.length > 2 ? 7 : 10}\" font-family=\"Arial,sans-serif\" font-weight=\"700\">${label}</text></svg>`;\n};\n\nexport function graphic(name,className='') {\n  if (name === 'esports') {\n    return `<img class=\"reference-graphic gamepad-graphic ${className}\" src=\"${ESPORTS_CONTROLLER_DATA}\" alt=\"\" aria-hidden=\"true\" draggable=\"false\" decoding=\"async\">`;\n  }\n  const fallback=fallbackSvg(name);\n  if (fallback) return fallback.replace('reference-graphic','reference-graphic '+className);\n  return `<img class=\"reference-graphic ${className}\" src=\"/assets/icons/${name}.png\" alt=\"\" aria-hidden=\"true\" draggable=\"false\" decoding=\"async\">`;\n}\n";
const i18nModule = "const phrases = [\n ['Темна','Тёмная','Dark'],['Стандартна','Стандартная','Standard'],['Авто','Авто','Auto'],['Вибрати тему','Выбрать тему','Choose theme'],['Виберіть вашу тему','Выберите вашу тему','Choose your theme'],['Виберіть бажану тему, щоб налаштувати інтерфейс','Выберите предпочтительную тему, чтобы настроить интерфейс','Choose your preferred interface theme'],['Темна тема для всіх розділів','Тёмная тема для всех разделов','Dark theme for every section'],['Світлий спорт, темне казино','Светлый спорт, тёмное казино','Light sports, dark casino'],['Відповідає налаштуванням вашого пристрою','Соответствует настройкам вашего устройства','Matches your device settings'],['Мій акаунт','Мой аккаунт','My account'],['Служба підтримки','Служба поддержки','Support'],['Бонуси','Бонусы','Bonuses'],\n ['Головне','Главное','Main'],['Події','События','Events'],['Час матчів','Время матчей','Match time'],\n ['Головна','Главная','Home'],['Спорт','Спорт','Sport'],['Мої ставки','Мои ставки','My bets'],['Казино','Казино','Casino'],['Профіль','Профиль','Profile'],['Меню','Меню','Menu'],\n ['Поповнити','Пополнить','Deposit'],['Поповнити рахунок','Пополнить счёт','Deposit funds'],['+ Поповнити рахунок','+ Пополнить счёт','+ Deposit funds'],['Вивести','Вывести','Withdraw'],['Баланс','Баланс','Balance'],\n ['Акції','Акции','Promotions'],['Персональні дані','Персональные данные','Personal details'],['Підтвердження акаунта','Подтверждение аккаунта','Account verification'],['Історія платежів','История платежей','Payment history'],\n ['Залишити відгук','Оставить отзыв','Leave feedback'],['Налаштування','Настройки','Settings'],['Допомога та інформація','Помощь и информация','Help and information'],['Вихід','Выход','Log out'],['Вийти','Выйти','Log out'],['Вийти з акаунта','Выйти из аккаунта','Log out of account'],\n ['Змінити мову','Изменить язык','Change language'],['Редагувати ставки','Редактировать ставки','Edit bets'],['Видалити','Удалить','Delete'],['Мова','Язык','Language'],['Безпека','Безопасность','Security'],['Налаштування сповіщень','Настройки уведомлений','Notification settings'],['Налаштування спорту','Настройки спорта','Sport settings'],['Зберегти','Сохранить','Save'],\n ['Магазин бонусів','Магазин бонусов','Bonus shop'],['Турніри','Турниры','Tournaments'],['Головне','Главное','Overview'],['Події','События','Events'],\n ['Нерозраховані','Нерассчитанные','Unsettled'],['Розраховані','Рассчитанные','Settled'],['Сума ставки','Сумма ставки','Stake'],['Можлива виплата','Возможная выплата','Potential payout'],['Виплата','Выплата','Payout'],\n ['Повторити','Повторить','Repeat'],['Поділитися','Поделиться','Share'],['Поділитися ставкою','Поделиться ставкой','Share bet'],['Показати суму ставки:','Показать сумму ставки:','Show stake:'],['Зберегти зображення','Сохранить изображение','Save image'],['зображення','изображение','image'],['ставкою','ставкой','bet'],\n ['Переможець','Победитель','Winner'],['Результат матчу','Результат матча','Match result'],['Тотал','Тотал','Total'],['Тотал карт','Тотал карт','Total maps'],['Фора','Фора','Handicap'],['Фора за картами','Фора по картам','Map handicap'],['Точний рахунок','Точный счёт','Correct score'],['Точний рахунок за картами','Точный счёт по картам','Correct map score'],['Нічия','Ничья','Draw'],['Більше','Больше','Over'],['Менше','Меньше','Under'],['Парний / непарний','Чётный / нечётный','Even / odd'],['Парний','Чётный','Even'],['Непарний','Нечётный','Odd'],\n ['Переможець матчу','Победитель матча','Match winner'],['Рахунок','Счёт','Score'],['Вибір у ставці','Выбор в ставке','Bet selection'],['Вибраний результат','Выбранный исход','Selected outcome'],['Фактичний результат','Фактический результат','Actual result'],['Не зіграно','Не сыграно','Not played'],['За рахунком','По счёту','By score'],\n ['Редагувати ставку','Редактировать ставку','Edit bet'],['Номер ставки','Номер ставки','Bet number'],['Статус ставки','Статус ставки','Bet status'],['Пункти ставки','Пункты ставки','Bet selections'],['Зберегти зміни','Сохранить изменения','Save changes'],['Приховати ставку з історії','Скрыть ставку из истории','Hide bet from history'],['Не вдалося зберегти зміни','Не удалось сохранить изменения','Could not save changes'],\n ['Відкрий потрібний пункт ставки та змінюй сам ринок, вибраний результат, коефіцієнт або фактичний результат. Наприклад, точний рахунок по картах 3:0 можна змінити на 3:2.','Открой нужный пункт ставки и измени сам рынок, выбранный исход, коэффициент или фактический результат. Например, точный счёт по картам 3:0 можно изменить на 3:2.','Open the required bet selection and change the market, selected outcome, odds or actual result. For example, a correct map score of 3:0 can be changed to 3:2.'],\n ['Завантаження історії зустрічей','Загрузка истории встреч','Loading match history'],['Історія зустрічей тимчасово недоступна.','История встреч временно недоступна.','Match history is temporarily unavailable.'],['Для цього матчу зараз немає доступних коефіцієнтів.','Для этого матча сейчас нет доступных коэффициентов.','No odds are currently available for this match.'],['Ринки цього матчу зараз недоступні','Рынки этого матча сейчас недоступны','Markets for this match are currently unavailable'],['Немає з’єднання з джерелом матчів','Нет соединения с источником матчей','No connection to the match feed'],\n ['Додайте результат до купона','Добавьте исход в купон','Add a selection to the bet slip'],['Перевірте тип купона','Проверьте тип купона','Check the bet slip type'],['Додайте щонайменше два результати','Добавьте минимум два исхода','Add at least two selections'],['Для системи додайте щонайменше три результати','Для системы добавьте минимум три исхода','Add at least three selections for a system bet'],['У купоні повторюється результат','В купоне повторяется исход','The bet slip contains a duplicate selection'],['В експресі або системі не можна вибрати два результати одного матчу','В экспрессе или системе нельзя выбрать два исхода одного матча','An accumulator or system bet cannot contain two selections from the same match'],['Некоректний номер ставки','Некорректный номер ставки','Invalid bet number'],['Не вдалося зарахувати виплату','Не удалось зачислить выплату','Could not credit the payout'],\n ['Акаунт Arena Line. Не вводьте дані від акаунта Parik24.','Аккаунт Arena Line. Не вводите данные от аккаунта Parik24.','Arena Line account. Do not enter your Parik24 account details.'],['Вже є акаунт? Увійти','Уже есть аккаунт? Войти','Already have an account? Sign in'],['Сума, €','Сумма, €','Amount, €'],['Додавання віртуальних коштів. Реального переказу грошей не буде.','Добавление виртуальных средств. Реального перевода денег не будет.','Adding virtual funds. No real money will be transferred.'],['Списання віртуальних коштів. Реального переказу грошей не буде.','Списание виртуальных средств. Реального перевода денег не будет.','Withdrawing virtual funds. No real money will be transferred.'],\n ['Лінія матчу','Линия матча','Match line'],['Ринок з лінії','Рынок из линии','Market from line'],['Оберіть ринок','Выберите рынок','Choose market'],['Оберіть результат','Выберите исход','Choose outcome'],['Завантаження лінії матчу…','Загрузка линии матча…','Loading match line…'],['Лінія матчу зараз недоступна','Линия матча сейчас недоступна','Match line is currently unavailable'],['Ручний ввід','Ручной ввод','Manual input'],\n ['Дублювати ставку','Дублировать ставку','Duplicate bet'],['Ставку продубльовано','Ставка продублирована','Bet duplicated'],['Недостатньо коштів для дублювання ставки','Недостаточно средств для дублирования ставки','Insufficient funds to duplicate the bet'],\n ['Не вдалося продублювати ставку','Не удалось продублировать ставку','Could not duplicate the bet'],\n ['Час ставки','Время ставки','Bet time'],['Коефіцієнт вручну','Коэффициент вручную','Manual odds'],['Некоректний час ставки','Некорректное время ставки','Invalid bet time'],\n ['Ординар','Ординар','Single'],['Експрес','Экспресс','Accumulator'],['Система','Система','System'],['Лайв','Лайв','Live'],['ЛАЙВ','ЛАЙВ','LIVE'],['Прематч','Прематч','Prematch'],['ПРЕМАТЧ','ПРЕМАТЧ','PREMATCH'],['ЛОББІ','ЛОББИ','LOBBY'],['ПЕРЕРВА','ПЕРЕРЫВ','BREAK'],['СЬОГОДНІ','СЕГОДНЯ','TODAY'],['ЗАВЕРШЕНО','ЗАВЕРШЕНО','FINISHED'],\n ['Вибране','Избранное','Favorites'],['Футбол','Футбол','Football'],['Теніс','Теннис','Tennis'],['Настільний теніс','Настольный теннис','Table tennis'],['Хокей','Хоккей','Hockey'],['Кіберспорт','Киберспорт','Esports'],['Баскетбол','Баскетбол','Basketball'],['Волейбол','Волейбол','Volleyball'],['Снукер','Снукер','Snooker'],\n ['Всі','Все','All'],['Основне','Основное','Main'],['Всі події','Все события','All events'],['Скоро','Скоро','Soon'],['Сьогодні','Сегодня','Today'],['Завтра','Завтра','Tomorrow'],['Вихідні','Выходные','Weekend'],['Огляд матчу','Обзор матча','Match overview'],['Огляд коефіцієнтів','Обзор коэффициентов','Odds overview'],['Особисті зустрічі','Личные встречи','Head to head'],['При відкритті','При открытии','On opening'],['Зараз','Сейчас','Now'],['Результат','Результат','Result'],\n ['Увійти','Войти','Sign in'],['Увійти','Увійти','Sign in'],['Реєстрація','Регистрация','Registration'],['Вхід','Вход','Sign in'],['Створити акаунт','Создать аккаунт','Create account'],['Ім’я','Имя','First name'],['Прізвище','Фамилия','Last name'],['Пароль','Пароль','Password'],['Змінити пароль','Изменить пароль','Change password'],['Поточний пароль','Текущий пароль','Current password'],['Новий пароль','Новый пароль','New password'],['Контакти','Контакты','Contact details'],['Номер рахунку','Номер счёта','Account number'],['Номер телефону','Номер телефона','Phone number'],['Не вказано','Не указан','Not provided'],['Персональна інформація','Персональная информация','Personal information'],['Мої дані','Мои данные','My details'],\n ['Назад','Назад','Back'],['Закрити','Закрыть','Close'],['Пошук','Поиск','Search'],['Сповіщення','Уведомления','Notifications'],['Нових сповіщень немає','Новых уведомлений нет','No new notifications'],['Допомога','Помощь','Help'],['Продовжити','Продолжить','Continue'],\n ['Зробити ставку','Сделать ставку','Place bet'],['Ставку прийнято','Ставка принята','Bet accepted'],['Сума купону','Сумма купона','Bet slip total'],['Можливий виграш','Возможный выигрыш','Potential winnings'],['Твій купон порожній','Твой купон пуст','Your bet slip is empty'],['Клікни на коефіцієнт, щоб додати ставку до купону','Нажми на коэффициент, чтобы добавить ставку в купон','Select odds to add a bet to your slip'],['На все','На всё','All in'],['Коефіцієнти недоступні','Коэффициенты недоступны','Odds unavailable'],['Прийняти зміни коефіцієнтів','Принять изменения коэффициентов','Accept odds changes'],\n ['Оновити','Обновить','Refresh'],['Пошук матчу','Поиск матча','Search matches'],['Команда або турнір','Команда или турнир','Team or tournament'],['Матчів не знайдено','Матчи не найдены','No matches found'],['Завантаження матчів','Загрузка матчей','Loading matches'],['Завантаження коефіцієнтів…','Загрузка коэффициентов…','Loading odds…'],['Ринки призупинено','Рынки приостановлены','Markets suspended'],['Вибраних матчів поки немає','Избранных матчей пока нет','No favorite matches yet'],['У цьому розділі зараз немає матчів','В этом разделе сейчас нет матчей','No matches in this section'],['Переглянути прематч','Посмотреть прематч','View prematch'],['До спорту','К спорту','Back to sport'],\n ['Нерозрахованих ставок немає','Нерассчитанных ставок нет','No unsettled bets'],['Розрахованих ставок ще немає','Рассчитанных ставок ещё нет','No settled bets yet'],['Операцій поки немає','Операций пока нет','No transactions yet'],['Виплата за ставкою','Выплата по ставке','Bet payout'],['Поповнення','Пополнение','Deposit'],['Виведення','Вывод','Withdrawal'],\n ['Активних бонусів немає','Активных бонусов нет','No active bonuses'],['Відгук','Отзыв','Feedback'],['Текст відгуку','Текст отзыва','Your feedback'],['Зберегти відгук','Сохранить отзыв','Save feedback'],['Відгук збережено на цьому пристрої','Отзыв сохранён на этом устройстве','Feedback saved on this device'],['Розрахунок ставок','Расчёт ставок','Bet settlement'],['Початковий розділ','Начальный раздел','Default section'],['Сортування матчів','Сортировка матчей','Match sorting'],['За часом','По времени','By start time'],['За турніром','По турниру','By tournament'],\n ['Готуємо купон…','Готовим купон…','Preparing coupon…'],['Профіль і віртуальний баланс зберігаються в цьому браузері.','Профиль и виртуальный баланс хранятся в этом браузере.','Your profile and virtual balance are stored in this browser.'],['Дані цього профілю належать лише Arena Line.','Данные этого профиля относятся только к Arena Line.','This profile belongs only to Arena Line.'],['Зміни з моменту відкриття цієї сторінки. Поточні коефіцієнти оновлюються з лінії.','Изменения с момента открытия этой страницы. Текущие коэффициенты обновляются из линии.','Changes since this page was opened. Current odds update from the live feed.'],\n [\"Дозвольте зберігання даних сайту в браузері\",\"Разрешите хранение данных сайта в браузере\",\"Allow this site to store data in your browser\"],\n [\"Копіювати номер рахунку\",\"Копировать номер счёта\",\"Copy account number\"],\n [\"Копіювати\",\"Копировать\",\"Copy\"],\n [\"Акаунт створено\",\"Аккаунт создан\",\"Account created\"],\n [\"Вхід за електронною поштою та паролем.\",\"Вход по почте и паролю.\",\"Sign in with email and password.\"],\n [\"Віртуальний рахунок активний.\",\"Виртуальный счёт активен.\",\"Virtual account is active.\"],\n [\"Для цього профілю поки немає нагород.\",\"Для этого профиля пока нет наград.\",\"No rewards for this profile yet.\"],\n [\"У профілі немає активних бонусних турнірів.\",\"В профиле нет активных бонусных турниров.\",\"There are no active bonus tournaments in this profile.\"],\n [\"Ви увійшли в акаунт\",\"Вы вошли в аккаунт\",\"You are signed in\"],\n [\"Баланс оновлено\",\"Баланс обновлён\",\"Balance updated\"],\n [\"Пароль змінено\",\"Пароль изменён\",\"Password changed\"],\n [\"Ви вийшли з акаунта\",\"Вы вышли из аккаунта\",\"You are signed out\"],\n [\"Ставку приховано\",\"Ставку скрыто\",\"Bet hidden\"],\n [\"Номер рахунку скопійовано\",\"Номер счёта скопирован\",\"Account number copied\"],\n [\"Не вдалося скопіювати\",\"Не удалось скопировать\",\"Could not copy\"],\n [\"Показати пароль\",\"Показать пароль\",\"Show password\"],\n [\"Приховати пароль\",\"Скрыть пароль\",\"Hide password\"],\n [\"Поповнення\",\"Добавление\",\"Deposit\"],\n [\"Списання\",\"Списание\",\"Withdrawal\"],\n [\"Особистий профіль Arena Line з віртуальним балансом. Це не акаунт Parik24.\",\"Личный профиль Arena Line с виртуальным балансом. Он не является аккаунтом Parik24.\",\"Arena Line personal profile with a virtual balance. It is not a Parik24 account.\"],\n [\"Профіль синхронізується з серверною копією: баланс, платежі та історія ставок доступні після входу на іншому пристрої.\",\"Профиль синхронизируется с серверной копией: баланс, платежи и история ставок доступны после входа на другом устройстве.\",\"Your profile is synced with the server copy: balance, payments and bet history are available after signing in on another device.\"],\n [\"Матчі та коефіцієнти надходять із лінії. Виплата за ставкою зараховується після підтвердження результату.\",\"Матчи и коэффициенты поступают из линии. Выплата по ставке зачисляется после подтверждения результата.\",\"Matches and odds come from the line. Bet payout is credited after the result is confirmed.\"],\n [\"Коефіцієнт\",\"Коэффициент\",\"Odds\"],\n [\"Нерозрахована\",\"Нерассчитанная\",\"Unsettled\"],\n [\"Виграна\",\"Выиграна\",\"Won\"],\n [\"Програна\",\"Проиграна\",\"Lost\"],\n [\"Повернення\",\"Возврат\",\"Refund\"],\n [\"Сума cash-out, €\",\"Сумма cash-out, €\",\"Cash-out amount, €\"],\n [\"Рахунок 1\",\"Счёт 1\",\"Score 1\"],\n [\"Рахунок 2\",\"Счёт 2\",\"Score 2\"],\n [\"Можлива виплата:\",\"Возможная выплата:\",\"Potential payout:\"],\n [\"Ставку оновлено\",\"Ставка обновлена\",\"Bet updated\"],\n [\"Ставка не знайдена\",\"Ставка не найдена\",\"Bet not found\"],\n [\"Некоректна сума ставки\",\"Некорректная сумма ставки\",\"Invalid stake amount\"],\n [\"У ставки немає результатів\",\"У ставки нет исходов\",\"The bet has no selections\"],\n [\"Некоректний коефіцієнт\",\"Некорректный коэффициент\",\"Invalid odds\"],\n [\"Некоректний статус\",\"Некорректный статус\",\"Invalid status\"],\n [\"Некоректна сума cash-out\",\"Некорректная сумма cash-out\",\"Invalid cash-out amount\"],\n [\"Недостатньо коштів для зміни ставки\",\"Недостаточно средств для изменения ставки\",\"Insufficient funds to edit the bet\"],\n [\"Не вдалося синхронізувати пароль\",\"Не удалось синхронизировать пароль\",\"Could not sync password\"],\n [\"Вкажіть суму з точністю до копійок\",\"Укажите сумму с точностью до копеек\",\"Enter the amount to two decimal places\"],\n [\"Сума має бути більшою за нуль\",\"Сумма должна быть больше нуля\",\"Amount must be greater than zero\"],\n [\"Занадто велика сума купона\",\"Слишком большая сумма купона\",\"Bet slip amount is too large\"],\n [\"Не вдалося прочитати дані профілю\",\"Не удалось прочитать данные профиля\",\"Could not read profile data\"],\n [\"Неправильна пошта або пароль\",\"Неверная почта или пароль\",\"Incorrect email or password\"],\n [\"Перевірте адресу електронної пошти\",\"Проверьте адрес почты\",\"Check the email address\"],\n [\"Пароль має містити щонайменше 8 символів\",\"Пароль должен содержать минимум 8 символов\",\"Password must contain at least 8 characters\"],\n [\"Вкажіть ім’я та прізвище\",\"Укажите имя и фамилию\",\"Enter first and last name\"],\n [\"Цей акаунт уже створено. Увійдіть за поштою та паролем.\",\"Этот аккаунт уже создан. Войдите по почте и паролю.\",\"This account already exists. Sign in with your email and password.\"],\n [\"Спочатку увійдіть в акаунт\",\"Сначала войдите в аккаунт\",\"Sign in first\"],\n [\"Не вдалося створити купон\",\"Не удалось создать купон\",\"Could not create bet slip\"],\n [\"Мінімальна сума ставки 20 €\",\"Минимальная сумма ставки 20 €\",\"Minimum stake is €20\"],\n [\"Перевірте купон\",\"Проверьте купон\",\"Check the bet slip\"],\n [\"Коефіцієнт недоступний\",\"Коэффициент недоступен\",\"Odds unavailable\"],\n [\"Недостатньо коштів\",\"Недостаточно средств\",\"Insufficient funds\"],\n [\"Некоректна операція\",\"Некорректная операция\",\"Invalid operation\"],\n [\"Перевищено ліміт віртуального балансу\",\"Превышен лимит виртуального баланса\",\"Virtual balance limit exceeded\"],\n [\"Мінімум 8 символів\",\"Минимум 8 символов\",\"Minimum 8 characters\"],\n [\"Поточний пароль неправильний\",\"Текущий пароль неверен\",\"Current password is incorrect\"],\n [\"Відновлюємо з’єднання\",\"Восстанавливаем соединение\",\"Reconnecting\"],\n [\"З’єднання перервано. Відновлюємо лінію…\",\"Соединение прервано. Восстанавливаем линию…\",\"Connection interrupted. Reconnecting to the line…\"],\n [\"Матчі тимчасово недоступні\",\"Матчи временно недоступны\",\"Matches are temporarily unavailable\"],\n [\"Ринки матчу\",\"Рынки матча\",\"Match markets\"],\n [\"Ці результати вже недоступні. Оберіть актуальний коефіцієнт у матчі.\",\"Эти исходы уже недоступны. Выберите актуальный коэффициент в матче.\",\"These selections are no longer available. Choose current odds in the match.\"],\n [\"Коефіцієнт тимчасово недоступний\",\"Коэффициент временно недоступен\",\"Odds are temporarily unavailable\"],\n [\"Прибрати результат\",\"Убрать исход\",\"Remove selection\"],\n [\"Коефіцієнти оновлено. Підтвердьте ставку.\",\"Коэффициенты обновлены. Подтвердите ставку.\",\"Odds were updated. Confirm the bet.\"],\n [\"Коефіцієнт змінився. Перевірте купон ще раз.\",\"Коэффициент изменился. Проверьте купон ещё раз.\",\"Odds changed. Check the bet slip again.\"],\n [\"Ставку розраховано. Виплата та історія оновлені.\",\"Ставка рассчитана. Выплата и история обновлены.\",\"Bet settled. Payout and history updated.\"],\n [\"Профіль і баланс\",\"Профиль и баланс\",\"Profile and balance\"],\n [\"Всі події\",\"Все события\",\"All events\"],\n [\"Сповіщення про матч\",\"Уведомления о матче\",\"Match notifications\"],\n [\"В історії джерела немає особистих зустрічей цих команд.\",\"В истории источника нет личных встреч этих команд.\",\"The source has no head-to-head history for these teams.\"],\n [\"Історія поки недоступна\",\"История пока недоступна\",\"History is not available yet\"],\n [\"Інформація про матч\",\"Информация о матче\",\"Match information\"],\n [\"Матч завершено\",\"Матч завершён\",\"Match finished\"],\n [\"Не вдалося створити зображення\",\"Не удалось создать изображение\",\"Could not create image\"],\n [\"Не вдалося зберегти купон\",\"Не удалось сохранить купон\",\"Could not save bet slip\"],\n [\"Купон Arena Line\",\"Купон Arena Line\",\"Arena Line bet slip\"],\n [\"Не вдалося поділитися. Купон можна зберегти зображенням.\",\"Не удалось поделиться. Купон можно сохранить изображением.\",\"Could not share. You can save the bet slip as an image.\"],\n [\"Основні розділи\",\"Основные разделы\",\"Main sections\"],\n [\"Лінія\",\"Линия\",\"Line\"],\n [\"Купон\",\"Купон\",\"Bet slip\"],\n [\"Види спорту\",\"Виды спорта\",\"Sports\"],\n [\"Ринок\",\"Рынок\",\"Market\"],\n [\"Головна навігація\",\"Главная навигация\",\"Main navigation\"],\n [\"Згорнути купон\",\"Свернуть купон\",\"Collapse bet slip\"],\n [\"Розмір системи\",\"Размер системы\",\"System size\"],\n [\"Сума ставки, €\",\"Сумма ставки, €\",\"Stake, €\"],\n [\"Профіль Arena Line\",\"Профиль Arena Line\",\"Arena Line profile\"],\n [\"Навігація профілю\",\"Навигация профиля\",\"Profile navigation\"],\n [\"Доступних результатів\",\"Доступных исходов\",\"Available outcomes\"],\n [\"Виведено\",\"Выведено\",\"Cashed out\"],\n [\"Редагувати\",\"Редактировать\",\"Edit\"],\n [\"Загальний коефіцієнт\",\"Общий коэффициент\",\"Total odds\"],\n [\"Назад\",\"Назад\",\"Back\"],\n [\"Мої ставки\",\"Мои ставки\",\"My bets\"],\n];\nlet language='uk';\ntry {language=localStorage.getItem('arena-language-v1')||'uk';}catch{}\nif(!['uk','ru','en'].includes(language))language='uk';\nconst lookup=new Map();\nfor(const values of phrases){if(!Array.isArray(values)||values.length<3)continue;for(const value of values)if(!lookup.has(value))lookup.set(value,values);}\nexport const getLanguage=()=>language;\nexport const getLocale=()=>({uk:'uk-UA',ru:'ru-UA',en:'en-GB'})[language];\nexport function t(value) {\n  const text=String(value??''),trim=text.trim(),column={uk:0,ru:1,en:2}[language];\n  const exact=lookup.get(trim);\n  if(exact)return text.replace(trim,exact[column]);\n  const local=(uk,ru,en)=>[uk,ru,en][column];\n  const withTail=(uk,ru,en,tail)=>`${local(uk,ru,en)} ${tail}`;\n  const englishOrdinal=value=>{\n    const n=Number(value),mod100=n%100;\n    const suffix=mod100>=11&&mod100<=13?'th':n%10===1?'st':n%10===2?'nd':n%10===3?'rd':'th';\n    return `${n}${suffix}`;\n  };\n  let result=text.replace(/\\b(\\d+)\\s*[чЧгГ]\\b/g,(_,n)=>`${n}${language==='uk'?'Г':language==='ru'?'Ч':'H'}`);\n  result=result.replace(/(?:Карта|Map)\\s+(\\d+)/gi,(_,n)=>`${language==='en'?'Map':'Карта'} ${n}`);\n  result=result.replace(/^(?:(?:Точний рахунок|Точный сч[её]т)\\s+(?:по\\s+карт(?:ах|ам)|за\\s+картами)|(?:Correct|Exact)\\s+map\\s+score)\\s+(.+)$/i,(_,tail)=>withTail('Точний рахунок за картами','Точный счёт по картам','Correct map score',tail));\n  result=result.replace(/^(?:Точний рахунок|Точный сч[её]т|Correct score|Exact score)\\s+(.+)$/i,(_,tail)=>withTail('Точний рахунок','Точный счёт','Correct score',tail));\n  result=result.replace(/^(?:Рахунок|Сч[её]т|Score)\\s+(.+)$/i,(_,tail)=>withTail('Рахунок','Счёт','Score',tail));\n  result=result.replace(/^(?:Фора за картами|Фора по картам|Map handicap)\\s+(.+)$/i,(_,tail)=>withTail('Фора за картами','Фора по картам','Map handicap',tail));\n  result=result.replace(/^(?:Тотал карт|Total maps)\\s+(.+)$/i,(_,tail)=>withTail('Тотал карт','Тотал карт','Total maps',tail));\n  result=result.replace(/^(?:Фора|Handicap)\\s+(.+)$/i,(_,tail)=>withTail('Фора','Фора','Handicap',tail));\n  result=result.replace(/^(?:Тотал|Total)\\s+(.+)$/i,(_,tail)=>withTail('Тотал','Тотал','Total',tail));\n  result=result.replace(/^(?:Сет|Set)\\s+(\\d+)$/i,(_,n)=>language==='en'?`Set ${n}`:`Сет ${n}`);\n  result=result.replace(/^(?:Період|Период|Period)\\s+(\\d+)$/i,(_,n)=>withTail('Період','Период','Period',n));\n  result=result.replace(/^(\\d+)-(?:й|ий)\\s+тайм$/i,(_,n)=>language==='en'?`${englishOrdinal(n)} half`:`${n}-й тайм`);\n  result=result.replace(/^(\\d+)(?:st|nd|rd|th)\\s+half$/i,(_,n)=>language==='en'?`${englishOrdinal(n)} half`:`${n}-й тайм`);\n  result=result.replace(/^(\\d+)\\s+доступних\\s+результатів$/i,(_,n)=>language==='uk'?`${n} доступних результатів`:language==='ru'?`${n} доступных исходов`:`${n} available outcomes`);\n  result=result.replace(/^(\\d+)\\s+з\\s+(\\d+)$/i,(_,a,b)=>language==='uk'?`${a} з ${b}`:language==='ru'?`${a} из ${b}`:`${a} of ${b}`);\n  result=result.replace(/^Коефіцієнт змінився:\\s*(.+)$/i,(_,tail)=>language==='uk'?`Коефіцієнт змінився: ${tail}`:language==='ru'?`Коэффициент изменился: ${tail}`:`Odds changed: ${tail}`);\n  result=result.replace(/^Матч завершено\\s*·\\s*(.+)$/i,(_,tail)=>language==='uk'?`Матч завершено · ${tail}`:language==='ru'?`Матч завершён · ${tail}`:`Match finished · ${tail}`);\n  result=result.replace(/^(Менше|Меньше|Under)\\s+(.+)$/i,(_,__,tail)=>language==='uk'?`Менше ${tail}`:language==='ru'?`Меньше ${tail}`:`Under ${tail}`);\n  result=result.replace(/^(Більше|Больше|Over)\\s+(.+)$/i,(_,__,tail)=>language==='uk'?`Більше ${tail}`:language==='ru'?`Больше ${tail}`:`Over ${tail}`);\n  if(/ · | — /.test(result))result=result.split(/( · | — )/).map(part=>lookup.get(part)?.[column]||part).join('');\n  return result;\n}\nconst originals=new WeakMap();\nexport function translatePage(root=document.body) {\n  const walker=document.createTreeWalker(root,4);let node;\n  while((node=walker.nextNode())) {\n    if(node.parentElement?.closest('script,style,textarea,[data-no-translate]'))continue;\n    const prior=originals.get(node),original=prior&&node.nodeValue===prior.translated?prior.original:node.nodeValue;\n    const translated=t(original);originals.set(node,{original,translated});if(node.nodeValue!==translated)node.nodeValue=translated;\n  }\n  for(const element of root.querySelectorAll('[placeholder],[aria-label],[title]')) for(const attr of ['placeholder','aria-label','title']) {\n    if(!element.hasAttribute(attr))continue;\n    const value=element.getAttribute(attr),data=originals.get(element)||{},prior=data[attr];\n    const original=prior&&value===prior.translated?prior.original:value,translated=t(original);\n    data[attr]={original,translated};originals.set(element,data);if(value!==translated)element.setAttribute(attr,translated);\n  }\n  document.documentElement.lang=language;\n}\nexport function setLanguage(value) {\n  if(!['uk','ru','en'].includes(value))return;\n  language=value;localStorage.setItem('arena-language-v1',value);\n  window.dispatchEvent(new CustomEvent('arena-language-change'));translatePage();\n}\nexport function startTranslations() {\n  translatePage();let scheduled=false;\n  new MutationObserver(()=>{if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;translatePage();});}).observe(document.body,{childList:true,subtree:true,characterData:true});\n}\n";
const exactEsportsController = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAEAAAAA4CAMAAAB6xg5AAAABgFBMVEXc5Nvb\n3N6u3d/i4+WqqqqknqCwxMQAAADm5+coJynV19f29/fIyMkXFhj+/v4zNDaz\ntbUNCQpFRUepqKmWlZaIiIl2d3hVVVfb4eESJyloaGkoJynk2Ng6OjsDqq1V\nVVU+PkABtrknJij09fYLhoglFhi/v7/FursZGhodHiAAx8onJih/f3+8wsMX\nFxccHBwpJyoqKStLhomqqqrd3+Do6Ojj4+P5+fooKClw5efb3NwJbG4MdXgr\nKytAP0H4+fkMCQsBS0wGlJc1iYxG5eeZy86P1deF6u3Ky8vW1tbW19ja29zJ\n9/ni4+Ph4uP5+/sOfoIOvcEhCAo2REc2295QXmFlZWaHh4i+v8C/v/+x5+q/\n///Nzc3T1tPg4eH3+Pj5+fkTDw8YGBocHCofHyUeHiEMOzwAVVUAU1MAX2AA\n//8qHBwtHyMxMTQ7Ozw+PkE+rbE9t7s/3+NXT1dQSEhDQURIyMxJ1NZY3+F/\nAH9nZ2d5eXlqsrdy1Ndx3+Khl5hVpApVAAAAgHRSTlMWY/2ihf0NAPz6/Pz8\n/AP8/Pz6/fz9/P39/f0v/Ar9BPr90mv8/Qb8Kf39rAL8FFFSav0D/RE0MpL9\nbv39EPq4cv36/f39/f3bDIXV/VitTf39/P39/M6w/QT9BBIp34zQgZISMFT9\nA/79ARL9nM9a/f39HSPN/f39AlFY+/39/T8HDKoAAATBSURBVHja7Zf3V9tI\nEMeV5O60VWVVbctxiY1bIIGYFnoPkN4vdynXe+/9X7+ZlVyAOMC73+5l4GFL\nu/PRd8quFsP8j2a8BpwWcPEYQKmEf61R7nqgVBwJQLxVKphm8eX+cLvww+5o\nBZZZ/Oarqq0e4r2JiYlms6Dtw0KzCZdwc+bhg3K1M1kc1jgAlMxVFQUeI5y9\n/95PSqnysloul8t2ZtXVOcYJ80JFV83SUcBFsxgKnlqe2n0/m2YmaciJHhbh\nj4Ns9gCWNb2iRwkh3FuvUfAc8qb0bm29gYPMAcr+u5Z1GGBe4NzJR0EMk8hU\n+9DjKc21p3BERDSKCb9qHgJYlsW5LyWV987ywPMqt+lBQH2x0nBCwgNKXR9S\nsduTYAwEMApOqr543bPFRvtgALTVnkpsn3NPSteBQPsSjMx/+gX/swUeys7N\nk7x4s7JIhwH1hYrH8iIMmR/5+PHsLfMgADLwLQqIaO6XhPBko/0lHQLI9gYk\nIKIygkRG0o34mUxCDwAl+Bmer2x37VcRxzyo3M4NTNYqHicCSDbBUCUl54YB\nljkLYe0s3oUA3cqWgEKRqTvnB1ap6BLkpQyYR0LphoTNpgQNuGL+gQ2wWcvl\nPm3/1WBOEAjSGBfjngPmwZcGiRkQPEcoqZjjQD/8Dm6DEB5FBAg7m/c3txqi\nq6hUcMmJrw08n0zZ9oMtuBVKXUbO1KNBCBiBr2B+kjAhYDEoyIbuSQESPEGS\nJwuupPWPtxPiu1BGwgUNyFMdg9GrQWAzdImJkw/LkKwwFNjV+pd8By1G7Xot\nBkLkE+5Qn7CrQ4AVjj0m9ELIS0x2uUwjgALksf3P9Vod79G1nSTWa0V6RLCb\nPYBlWriIgOBwXWyYu6wURKEB8DQNsKP62t9JzGJoeY8wsGkkaMCtdBGG0kNO\nC/sBKEE/hPiOpPY9213fhgxBFbW/YDNYBw14rgGgHhMMg9BPimHZWD6KQhIn\n8zUX7LP7DVAEk/TzRXzGHMsAKykA5LshflM2Vfqa4epgMH++srBw/ntHANwN\ntD/LkmCkKUj9wcHNw0dg20F2A8saxyw5Oz+/3RBM4ASWAfbR2cj6ODUeSBkx\ncsTibpIAijmwCpweAJOAgHewCwYA6i57Dv4cNS+gLm15WQRCdG9AEhDwvOdP\nuuUWrCeZLuFqlR4yHJL5PoDtacDn1osM0EUB0HOdS81st7iE1rtoftTB0ZbT\nB2AWDdiMsghiyKGEGZdHvxovA0FGJPUXYn/XtIxBDhm0iPYvjvIvIYFKDyqg\nAdiLBvZh5i8gSDo52h/fjpOgQfUUYC8OA2DDkXOv8kdCByb5qf84u6EVXNDL\nWAuQ1Q+OOyEsaQka4ABgLAPETAt4VQJ7acAgUgkObAlvp4AuSwV0hl67owif\ndKSrJYwPARgKgC4pnOSQU4BcowQAwHo0rpiz6B8L6kIGT2Alc66lJTx2xIxO\nooVbAAlBwBcnO2mBBOkJR4hrsBRxNZ5DCSBg8mT+IIG6EbwcxB5sSQYeLaAH\nYLuuFk962CvC01AAHjMMTMvMM1J2jy/hwCapG7JrT7NNFfekN6q085JT5Aj7\nbakqv94b678X8MtS4VQnVj3dGno3jp3+kDxmvf5/4f8D+BcfSMcT3GOUnAAA\nAABJRU5ErkJggg==\n"), c => c.charCodeAt(0));



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
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    size += bytes.byteLength;
    if (size > limit) throw new Error('Request body too large');
    chunks.push(bytes);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk,offset); offset += chunk.byteLength; }
  return out;
}

function json(res, status, value) {
  res.statusCode = status;
  res.setHeader('content-type','application/json; charset=utf-8');
  res.setHeader('cache-control','no-store');
  res.end(JSON.stringify(value));
}

function textResponse(res, method, type, source, cacheControl='public, max-age=300, stale-while-revalidate=86400') {
  res.statusCode = 200;
  res.setHeader('content-type',type);
  res.setHeader('cache-control',cacheControl);
  res.setHeader('x-content-type-options','nosniff');
  if (method === 'HEAD') return res.end();
  res.end(source);
}

const js = (res,method,source,cacheControl) => textResponse(res,method,'text/javascript; charset=utf-8',source,cacheControl);
const css = (res,method,source,cacheControl) => textResponse(res,method,'text/css; charset=utf-8',source,cacheControl);

function runtimeCacheControl(pathname) {
  if (pathname === '/' || pathname === '/index.html') return 'no-store';
  if (pathname === '/sw.js') return 'no-cache, no-store, must-revalidate';
  if (pathname.startsWith('/api/')) return 'no-store';
  if (/\.(?:png|jpe?g|webp|gif|svg|ico|woff2?|ttf|otf)$/i.test(pathname)) {
    return 'public, max-age=86400, stale-while-revalidate=604800';
  }
  if (/\.(?:js|mjs|css|webmanifest)$/i.test(pathname)) {
    return 'public, max-age=300, stale-while-revalidate=86400';
  }
  return 'public, max-age=300, stale-while-revalidate=3600';
}
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
      categoryName:safeString(team?.categoryName || raw?.categoryName || '',120),
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

function patchIndexHtml(source) {
  let html=String(source || '');
  html=html.replace(
    /<meta\s+name=["']viewport["']\s+content=["'][^"']*["']\s*\/?>/i,
    '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">'
  );
  html=html.replace(/\?+v=\d+/g,'?v=112');
  html=html.replace(
    '<img class="wordmark" src="/assets/wordmark.png" width="120" height="24" alt="Parik24">',
    '<span class="wordmark brand-placeholder" aria-hidden="true"></span>'
  );
  html=html.replace(
    '<span class="wordmark viphouse-wordmark" aria-label="VIP HOUSE">VIP HOUSE</span>',
    '<span class="wordmark brand-placeholder" aria-hidden="true"></span>'
  );
  if (!html.includes('apple-touch-icon')) {
    html=html.replace(
      '<link rel="manifest" href="/manifest.webmanifest">',
      '<link rel="manifest" href="/manifest.webmanifest">\n  <link rel="apple-touch-icon" href="/assets/icons/esports-controller-clean-v79.png">\n  <meta name="apple-mobile-web-app-capable" content="yes">\n  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">'
    );
  }
  if (!html.includes('arena-editor-hotfix-v112')) {
    html=html.replace('</head>', `
<style id="arena-editor-hotfix-v112">
dialog#dialog.edit-bet-dialog{
  position:fixed!important;
  top:auto!important;
  right:auto!important;
  bottom:calc(10px + env(safe-area-inset-bottom))!important;
  left:50%!important;
  transform:translateX(-50%)!important;
  width:min(94vw,460px)!important;
  height:auto!important;
  max-height:82dvh!important;
  margin:0!important;
  padding:0!important;
  border:0!important;
  outline:0!important;
  border-radius:18px!important;
  overflow:hidden!important;
  background:#171716!important;
  color:#f5f4f1!important;
  box-shadow:0 14px 44px rgba(0,0,0,.55)!important;
  color-scheme:dark!important;
}
dialog#dialog.edit-bet-dialog::backdrop{background:rgba(0,0,0,.62)!important}
dialog#dialog.edit-bet-dialog #dialog-content{
  display:block!important;
  width:100%!important;
  max-height:82dvh!important;
  overflow-y:auto!important;
  overscroll-behavior:contain!important;
  -webkit-overflow-scrolling:touch!important;
  background:#171716!important;
  color:#f5f4f1!important;
  border:0!important;
  outline:0!important;
  box-shadow:none!important;
}
dialog#dialog.edit-bet-dialog .dialog-head{
  position:sticky!important;
  top:0!important;
  z-index:5!important;
  min-height:52px!important;
  padding:12px 14px 7px!important;
  margin:0!important;
  background:#171716!important;
  border:0!important;
  box-shadow:none!important;
}
dialog#dialog.edit-bet-dialog .dialog-head h2{
  margin:0!important;
  font-size:20px!important;
  line-height:28px!important;
}
dialog#dialog.edit-bet-dialog .edit-bet-form{
  padding:0 14px 14px!important;
  background:#171716!important;
  border:0!important;
}
dialog#dialog.edit-bet-dialog .dialog-copy{
  margin:2px 0 12px!important;
  color:#aaa69d!important;
  font-size:12px!important;
  line-height:17px!important;
}
dialog#dialog.edit-bet-dialog .edit-bet-card{
  margin:0!important;
  padding:0!important;
  border:0!important;
  border-radius:0!important;
  outline:0!important;
  background:#171716!important;
  box-shadow:none!important;
}
dialog#dialog.edit-bet-dialog .edit-bet-event{
  margin:0 0 2px!important;
  font-size:15px!important;
  line-height:20px!important;
}
dialog#dialog.edit-bet-dialog .edit-bet-market{
  margin:0 0 10px!important;
  font-size:12px!important;
  line-height:17px!important;
  color:#aaa69d!important;
}
dialog#dialog.edit-bet-dialog .edit-bet-label,
dialog#dialog.edit-bet-dialog label{
  margin:9px 0 5px!important;
  color:#aaa69d!important;
  font-size:11px!important;
  line-height:15px!important;
}
dialog#dialog.edit-bet-dialog .edit-bet-grid,
dialog#dialog.edit-bet-dialog .edit-score-grid{
  gap:8px!important;
}
dialog#dialog.edit-bet-dialog .edit-winner-buttons{
  gap:8px!important;
}
dialog#dialog.edit-bet-dialog .edit-winner-buttons>button{
  min-height:46px!important;
  padding:7px 9px!important;
  border:0!important;
  outline:0!important;
  border-radius:11px!important;
  background:#2d2a27!important;
  color:#f5f4f1!important;
  box-shadow:none!important;
}
dialog#dialog.edit-bet-dialog .edit-winner-buttons>button.selected{
  background:#eef719!important;
  color:#24221f!important;
}
dialog#dialog.edit-bet-dialog input,
dialog#dialog.edit-bet-dialog select,
dialog#dialog.edit-bet-dialog textarea{
  width:100%!important;
  min-height:42px!important;
  height:42px!important;
  padding:8px 10px!important;
  border:0!important;
  outline:0!important;
  border-radius:10px!important;
  background:#2d2a27!important;
  color:#f5f4f1!important;
  box-shadow:none!important;
  -webkit-appearance:none!important;
  appearance:none!important;
}
dialog#dialog.edit-bet-dialog select{
  -webkit-appearance:auto!important;
  appearance:auto!important;
}
dialog#dialog.edit-bet-dialog input:focus,
dialog#dialog.edit-bet-dialog select:focus,
dialog#dialog.edit-bet-dialog textarea:focus{
  border:0!important;
  outline:0!important;
  box-shadow:none!important;
}
dialog#dialog.edit-bet-dialog .edit-payout-preview{
  margin:13px 0 8px!important;
  color:#f5f4f1!important;
  font-size:15px!important;
  line-height:21px!important;
}
dialog#dialog.edit-bet-dialog .edit-bet-save{
  min-height:46px!important;
  margin-top:10px!important;
  border:0!important;
  border-radius:12px!important;
}
dialog#dialog.edit-bet-dialog .edit-bet-hide{
  min-height:34px!important;
  margin-top:5px!important;
  border:0!important;
  background:transparent!important;
}
@media (display-mode:standalone){
  html,body{min-height:100dvh!important;background:#171716!important}
  body{padding-top:0!important}
  dialog#dialog.edit-bet-dialog{max-height:78dvh!important}
  dialog#dialog.edit-bet-dialog #dialog-content{max-height:78dvh!important}
}
.tournament-tabs>button,
.tournament-tabs>button:focus,
.tournament-tabs>button:focus-visible,
.tournament-tabs>button .tournament-symbol,
.tournament-tabs>button.active .tournament-symbol,
.tournament-tabs>button:focus .tournament-symbol,
.tournament-tabs>button:focus-visible .tournament-symbol{
  outline:0!important;
  box-shadow:none!important;
}
.tournament-tabs>button .tournament-symbol,
.tournament-tabs>button.active .tournament-symbol{
  border:0!important;
}
</style>
<script>
window.__ARENA_BUILD__='112';
</script>
</head>`);
  }
  html=html
    .replace(/href="\/(app|sports|bet-view|event-view|share-coupon|settings|theme)\.css\?v=112"/g,'href="/v112/$1.css"')
    .replace('src="/lucide.min.js"','src="/v112/lucide.min.js"')
    .replace('src="/app.js?v=112"','src="/v112/app.js"');
  if(!html.includes('arena-client-diagnostics-v112')){
    html=html.replace('<title>Arena Line</title>',`<title>Arena Line</title>
<script id="arena-client-diagnostics-v112">
(()=>{const send=(kind,message,extra={})=>{try{fetch('/api/client-diagnostic',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind,message:String(message||'').slice(0,1800),build:'112',href:location.href,...extra}),keepalive:true,cache:'no-store'}).catch(()=>{})}catch{}};
window.addEventListener('error',event=>send('CLIENT_ERROR',event.message||event.error?.message||'window error',{source:event.filename||'',line:event.lineno||0,column:event.colno||0}));
window.addEventListener('unhandledrejection',event=>send('CLIENT_REJECTION',event.reason?.stack||event.reason?.message||event.reason||'unhandled rejection'));
window.__arenaClientDiagnostic=send;
})();
</script>`);
  }
  return html;
}

function patchSportsModule(source) {
  const oldBlock = `  gameBadge(event) {
    const games = { 'Counter-Strike': 'counter-strike', 'Dota 2': 'dota', 'League of Legends': 'lol' };
    const name = games[event.categoryName] || SPORTS.find(s => s[0] === event.sport)?.[1] || 'esports';
    return \`<span class="game-badge">\${graphic(name)}</span>\`;
  }`;

  const newBlock = `  gameBadge(event) {
    const fallbackImages = {
      'Dota 2':'/assets/icons/dota.png',
      'Counter-Strike':'/assets/icons/counter-strike.png',
      'League of Legends':'/assets/icons/lol.png'
    };
    const esportsController='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAAA4CAMAAAB6xg5AAAABgFBMVEXc5Nvb3N6u3d/i4+WqqqqknqCwxMQAAADm5+coJynV19f29/fIyMkXFhj+/v4zNDaztbYNCQpFRUepqKmWlZaIiIl2d3hVVVfb4eESJyloaGkoJynk2Ng6OjsDqq1VVVU+PkABtrknJij09fYLhoglFhi/v7/FursZGhodHiAAx8onJih/f3+8wsMXFxccHBwpJyoqKStLhomqqqrd3+Do6Ojj4+P5+fooKClw5efb3NwJbG4MdXgrKytAP0H4+fkMCQsBS0wGlJc1iYxG5eeZy86P1deF6u3Ky8vW1tbW19ja29zJ9/ni4+Ph4uP5+/sOfoIOvcEhCAo2REc2295QXmFlZWaHh4i+v8C/v/+x5+q////Nzc3T1tPg4eH3+Pj5+fkTDw8YGBocHCofHyUeHiEMOzwAVVUAU1MAX2AA//8qHBwtHyMxMTQ7Ozw+PkE+rbE9t7s/3+NXT1dQSEhDQURIyMxJ1NZY3+F/AH9nZ2d5eXlqsrdy1Ndx3+Khl5hVpApVAAAAgHRSTlMWY/2ihf0NAPz6/Pz8/AP8/Pz6/fz9/P39/f0v/Ar9BPr90mv8/Qb8Kf39rAL8FFFSav0D/RE0MpL9bv39EPq4cv36/f39/f3bDIXV/VitTf39/P39/M6w/QT9BBIp34zQgZISMFT9A/79ARL9nM9a/f39HSPN/f39AlFY+/39/T8HDKoAAATBSURBVHja7Zf3V9tIEMeV5O60VWVVbctxiY1bIIGYFnoPkN4vdynXe+/9X7+ZlVyAOMC73+5l4GFLu/PRd8quFsP8j2a8BpwWcPEYQKmEf61R7nqgVBwJQLxVKphm8eX+cLvww+5oBZZZ/Oarqq0e4r2JiYlms6Dtw0KzCZdwc+bhg3K1M1kc1jgAlMxVFQUeI5y9/95PSqnysloul8t2ZtXVOcYJ80JFV83SUcBFsxgKnlqe2n0/m2YmaciJHhbhj4Ns9gCWNb2iRwkh3FuvUfAc8qb0bm29gYPMAcr+u5Z1GGBe4NzJR0EMk8hU+9DjKc21p3BERDSKCb9qHgJYlsW5LyWV987ywPMqt+lBQH2x0nBCwgNKXR9SsduTYAwEMApOqr543bPFRvtgALTVnkpsn3NPSteBQPsSjMx/+gX/swUeys7Nk7x4s7JIhwH1hYrH8iIMmR/5+PHsLfMgADLwLQqIaO6XhPBko/0lHQLI9gYkIKIygkRG0o34mUxCDwAl+Bmer2x37VcRxzyo3M4NTNYqHicCSDbBUCUl54YBljkLYe0s3oUA3cqWgEKRqTvnB1ap6BLkpQyYR0LphoTNpgQNuGL+gQ2wWcvlPm3/1WBOEAjSGBfjngPmwZcGiRkQPEcoqZjjQD/8Dm6DEB5FBAg7m/c3txqiq6hUcMmJrw08n0zZ9oMtuBVKXUbO1KNBCBiBr2B+kjAhYDEoyIbuSQESPEGSJwuupPWPtxPiu1BGwgUNyFMdg9GrQWAzdImJkw/LkKwwFNjV+pd8By1G7XotBkLkE+5Qn7CrQ4AVjj0m9ELIS0x2uUwjgALksf3P9Vod79G1nSTWa0V6RLCbPYBlWriIgOBwXWyYu6wURKEB8DQNsKP62t9JzGJoeY8wsGkkaMCtdBGG0kNOC/sBKEE/hPiOpPY9213fhgxBFbW/YDNYBw14rgGgHhMMg9BPimHZWD6KQhIn8zUX7LP7DVAEk/TzRXzGHMsAKykA5LshflM2Vfqa4epgMH++srBw/ntHANwNtD/LkmCkKUj9wcHNw0dg20F2A8saxyw5Oz+/3RBM4ASWAfbR2cj6ODUeSBkxcsTibpIAijmwCpweAJOAgHewCwYA6i57Dv4cNS+gLm15WQRCdG9AEhDwvOdPuuUWrCeZLuFqlR4yHJL5PoDtacDn1osM0EUB0HOdS81st7iE1rtoftTB0ZbTB2AWDdiMsghiyKGEGZdHvxovA0FGJPUXYn/XtIxBDhm0iPYvjvIvIYFKDyqgAdiLBvZh5i8gSDo52h/fjpOgQfUUYC8OA2DDkXOv8kdCByb5qf84u6EVXNDLWAuQ1Q+OOyEsaQka4ABgLAPETAt4VQJ7acAgUgkObAlvp4AuSwV0hl67owifdKSrJYwPARgKgC4pnOSQU4BcowQAwHo0rpiz6B8L6kIGT2Alc66lJTx2xIxOooVbAAlBwBcnO2mBBOkJR4hrsBRxNZ5DCSBg8mT+IIG6EbwcxB5sSQYeLaAHYLuuFk962CvC01AAHjMMTMvMM1J2jy/hwCapG7JrT7NNFfekN6q085JT5Aj7bakqv94b678X8MtS4VQnVj3dGno3jp3+kDxmvf5/4f8D+BcfSMcT3GOUnAAAAABJRU5ErkJggg==';
    const fallbackImage=fallbackImages[event.categoryName] || esportsController;
    const fallbackGraphic='<img class="synced-discipline-logo local-fallback-logo gamepad-graphic" src="' + fallbackImage + '" alt="">';

    const rawEntityKey=String(event.tournamentId || event.tournamentName || event.categoryName || '');
    const entityKey='tournament:' + rawEntityKey;
    const stableEntity=window.__arenaEntityLogoCache?.get(entityKey);
    if(stableEntity?.src){
      return '<span class="game-badge game-badge-parik">' +
        '<img class="synced-discipline-logo" src="' + escape(stableEntity.src) +
        '" data-arena-source="' + escape(stableEntity.source || '') +
        '" data-entity-kind="tournament" data-entity-key="' + escape(rawEntityKey) +
        '" data-entity-name="' + escape(String(event.tournamentName || '')) +
        '" data-category="' + escape(String(event.categoryName || '')) +
        '" alt="" decoding="async">' +
        '<span class="discipline-fallback">' + fallbackGraphic + '</span></span>';
    }

    const exactTournament = String(event.tournamentIconUrl || '');
    const exactCategory = String(event.categoryIconUrl || '');
    const baseMedia = '/api/media/tournament?id=' +
      encodeURIComponent(String(event.tournamentId || '')) +
      '&name=' + encodeURIComponent(String(event.tournamentName || '')) +
      '&category=' + encodeURIComponent(String(event.categoryName || '')) +
      '&source=' + encodeURIComponent(exactTournament) +
      '&categorySource=' + encodeURIComponent(exactCategory);
    const sources=[
      baseMedia + '&prefer=parik',
      baseMedia + '&prefer=bo3',
      baseMedia + '&prefer=category'
    ].filter(source => !window.__arenaFailedLogoSources?.has(source));
    const providerPrimary=sources[0] || '';
    const fallbacks=sources.slice(1);

    if (!providerPrimary) {
      return '<span class="game-badge game-badge-parik">' + fallbackGraphic + '</span>';
    }

    const renderedPrimary = window.__arenaStableLogoSrc ? window.__arenaStableLogoSrc(providerPrimary) : providerPrimary;
    return '<span class="game-badge game-badge-parik">' +
      '<img class="synced-discipline-logo" src="' + escape(renderedPrimary) +
      '" data-arena-source="' + escape(providerPrimary) +
      '" data-entity-kind="tournament"' +
      '" data-entity-key="' + escape(rawEntityKey) +
      '" data-entity-name="' + escape(String(event.tournamentName || '')) +
      '" data-category="' + escape(String(event.categoryName || '')) +
      '" data-fallbacks="' + escape(JSON.stringify(fallbacks)) +
      '" data-fallback-index="0" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onload="window.__arenaNormalizeLogo&&window.__arenaNormalizeLogo(this)"' +
      ' onerror="window.__arenaFailLogo?window.__arenaFailLogo(this):(this.hidden=true)">' +
      '<span class="discipline-fallback">' + fallbackGraphic + '</span></span>';
  }`;

  if (!source.includes(oldBlock)) {
    console.warn('SPORTS_PATCH_MISS gameBadge block was not found');
    return source;
  }
  const normalizer = `
window.__arenaLogoCache = window.__arenaLogoCache || new Map();
window.__arenaEntityLogoCache = window.__arenaEntityLogoCache || new Map();
window.__arenaEntityLogoStorageLoaded = window.__arenaEntityLogoStorageLoaded || false;
if(!window.__arenaEntityLogoStorageLoaded){
  window.__arenaEntityLogoStorageLoaded=true;
  try{
    const saved=JSON.parse(sessionStorage.getItem('arena-entity-logo-cache-v1') || '{}');
    for(const [key,value] of Object.entries(saved || {})){
      if(value?.src) window.__arenaEntityLogoCache.set(key,value);
    }
  }catch{}
}
window.__arenaFailedLogoSources = window.__arenaFailedLogoSources || new Set();
window.__arenaLogoFingerprints = window.__arenaLogoFingerprints || new Map();
window.__arenaGenericFingerprints = window.__arenaGenericFingerprints || new Set();

window.__arenaStableLogoSrc = window.__arenaStableLogoSrc || function(url) {
  return window.__arenaLogoCache.get(String(url || '')) || String(url || '');
};
window.__arenaEntityKey = window.__arenaEntityKey || function(img) {
  const kind=String(img?.dataset?.entityKind || '');
  const key=String(img?.dataset?.entityKey || '');
  return kind && key ? kind+':'+key : '';
};
window.__arenaSetLogoState = window.__arenaSetLogoState || function(img,state) {
  if(!img) return;
  img.dataset.logoState=state;
  const holder=img.closest?.('.team-emblem-picture');
  if(holder) holder.dataset.logoState=state;
  if(state === 'failed'){
    img.hidden=true;
    if(img.nextElementSibling) img.nextElementSibling.hidden=false;
  }else{
    img.hidden=false;
    if(img.nextElementSibling) img.nextElementSibling.hidden=true;
  }
};
window.__arenaRememberLogo = window.__arenaRememberLogo || function(img,src,source) {
  if(!img || !src) return;
  const key=window.__arenaEntityKey(img);
  if(!key) return;
  const value={src:String(src),source:String(source || '')};
  window.__arenaEntityLogoCache.set(key,value);
  try{
    const saved=JSON.parse(sessionStorage.getItem('arena-entity-logo-cache-v1') || '{}');
    saved[key]=value;
    const entries=Object.entries(saved);
    if(entries.length>240){
      for(const [oldKey] of entries.slice(0,entries.length-240)) delete saved[oldKey];
    }
    sessionStorage.setItem('arena-entity-logo-cache-v1',JSON.stringify(saved));
  }catch{}
};
window.__arenaHashLogo = window.__arenaHashLogo || function(value) {
  let hash=2166136261;
  for(let i=0;i<value.length;i++) hash=Math.imul(hash ^ value.charCodeAt(i),16777619);
  return (hash>>>0).toString(16)+':'+value.length;
};
window.__arenaRegisterFingerprint = window.__arenaRegisterFingerprint || function(img,data,source) {
  if(!img || !String(source || '').includes('prefer=parik')) return true;
  const kind=String(img.dataset.entityKind || '');
  const key=String(img.dataset.entityKey || source || '');
  const category=String(img.dataset.category || '');
  if(!kind || !key) return true;
  const fingerprint=window.__arenaHashLogo(data);
  let row=window.__arenaLogoFingerprints.get(fingerprint);
  if(!row){
    row={kind,keys:new Set(),categories:new Set(),sources:new Set()};
    window.__arenaLogoFingerprints.set(fingerprint,row);
  }
  row.keys.add(key);
  if(category) row.categories.add(category);
  row.sources.add(String(source || ''));
  const generic = kind === 'team'
    ? row.keys.size >= 5 && row.categories.size >= 2
    : kind === 'tournament'
      ? row.keys.size >= 4 && row.categories.size >= 2
      : false;
  if(!generic && !window.__arenaGenericFingerprints.has(fingerprint)) return true;
  window.__arenaGenericFingerprints.add(fingerprint);
  for(const badSource of row.sources){
    window.__arenaFailedLogoSources.add(badSource);
    window.__arenaLogoCache.delete(badSource);
  }
  for(const badKey of row.keys){
    const entityKey=kind+':'+badKey;
    window.__arenaEntityLogoCache.delete(entityKey);
    try{
      const saved=JSON.parse(sessionStorage.getItem('arena-entity-logo-cache-v1') || '{}');
      delete saved[entityKey];
      sessionStorage.setItem('arena-entity-logo-cache-v1',JSON.stringify(saved));
    }catch{}
  }
  return false;
};
window.__arenaNextLogo = window.__arenaNextLogo || function(img) {
  if(!img) return false;
  let list=[];
  try{ list=JSON.parse(img.dataset.fallbacks || '[]'); }catch{}
  let index=Number(img.dataset.fallbackIndex || 0);
  while(index < list.length){
    const next=list[index++];
    img.dataset.fallbackIndex=String(index);
    if(window.__arenaFailedLogoSources.has(next)) continue;
    window.__arenaSetLogoState(img,'loading');
    img.dataset.arenaSource=next;
    img.dataset.arenaNormalized='0';
    img.dataset.arenaNormalizing='0';
    img.src=window.__arenaStableLogoSrc(next);
    return true;
  }
  return false;
};
window.__arenaRejectLogo = window.__arenaRejectLogo || function(img) {
  if(!img) return false;
  const source=String(img.dataset.arenaSource || '');
  if(source){
    const transientTeamLookup=source.includes('/api/media/team') && source.includes('prefer=bo3');
    if(!transientTeamLookup) window.__arenaFailedLogoSources.add(source);
    else setTimeout(()=>window.__arenaFailedLogoSources.delete(source),10000);
    window.__arenaLogoCache.delete(source);
  }
  if(window.__arenaNextLogo(img)) return true;
  window.__arenaSetLogoState(img,'failed');
  return false;
};
window.__arenaFailLogo = window.__arenaFailLogo || function(img) {
  return window.__arenaRejectLogo(img);
};
window.__arenaApplyCachedLogo = window.__arenaApplyCachedLogo || function(img) {
  if(!img) return;
  const entity=window.__arenaEntityLogoCache.get(window.__arenaEntityKey(img));
  if(entity?.src){
    img.dataset.arenaNormalized='1';
    window.__arenaSetLogoState(img,'ready');
    if(img.src !== entity.src) img.src=entity.src;
    return;
  }
  const source=String(img.dataset.arenaSource || '');
  const cached=window.__arenaLogoCache.get(source);
  if(cached){
    img.dataset.arenaNormalized='1';
    window.__arenaSetLogoState(img,'ready');
    if(img.src !== cached) img.src=cached;
  }
};
if (!window.__arenaNormalizeLogo) {
  window.__arenaNormalizeLogo = function(img) {
    if (!img || img.dataset.arenaNormalizing === '1') return;
    const original = img.dataset.arenaSource || img.currentSrc || img.src || '';
    if (!original || window.__arenaFailedLogoSources.has(original)) {
      window.__arenaRejectLogo(img);
      return;
    }
    const entity=window.__arenaEntityLogoCache.get(window.__arenaEntityKey(img));
    if(entity?.src){
      img.dataset.arenaNormalized='1';
      window.__arenaSetLogoState(img,'ready');
      if(img.src !== entity.src) img.src=entity.src;
      return;
    }
    const cached = window.__arenaLogoCache.get(original);
    if (cached) {
      img.dataset.arenaNormalized = '1';
      window.__arenaSetLogoState(img,'ready');
      window.__arenaRememberLogo(img,cached,original);
      if (img.src !== cached) img.src = cached;
      return;
    }
    if (img.dataset.arenaNormalized === '1') {
      window.__arenaSetLogoState(img,'ready');
      return;
    }
    if (!img.naturalWidth || !img.naturalHeight) return;
    window.__arenaSetLogoState(img,'loading');

    img.dataset.arenaNormalizing = '1';
    try {
      const maxSide = 256;
      const ratio = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * ratio));
      const h = Math.max(1, Math.round(img.naturalHeight * ratio));
      const sourceCanvas = document.createElement('canvas');
      sourceCanvas.width = w;
      sourceCanvas.height = h;
      const ctx = sourceCanvas.getContext('2d', { willReadFrequently:true });
      ctx.clearRect(0,0,w,h);
      ctx.drawImage(img,0,0,w,h);
      const pixels = ctx.getImageData(0,0,w,h).data;
      const corners = [[0,0],[w-1,0],[0,h-1],[w-1,h-1]].map(([x,y]) => {
        const p=(y*w+x)*4;
        return [pixels[p],pixels[p+1],pixels[p+2],pixels[p+3]];
      });
      const bg = corners.reduce((a,p) => a.map((v,i)=>v+p[i]),[0,0,0,0]).map(v=>v/corners.length);
      let minX=w,minY=h,maxX=-1,maxY=-1;
      for(let y=0;y<h;y++){
        for(let x=0;x<w;x++){
          const p=(y*w+x)*4;
          const r=pixels[p],g=pixels[p+1],b=pixels[p+2],a=pixels[p+3];
          if(a < 20) continue;
          const colorDistance=Math.abs(r-bg[0])+Math.abs(g-bg[1])+Math.abs(b-bg[2]);
          const alphaDistance=Math.abs(a-bg[3]);
          const bgDistance=colorDistance+alphaDistance*0.55;
          const opaqueBackground=bg[3] > 220 && a > 220 && bgDistance < 82;
          const transparentNoise=bg[3] < 40 && a < 32;
          if(opaqueBackground || transparentNoise) continue;
          minX=Math.min(minX,x); minY=Math.min(minY,y);
          maxX=Math.max(maxX,x); maxY=Math.max(maxY,y);
        }
      }
      if(maxX < minX || maxY < minY) {
        window.__arenaRejectLogo(img);
        return;
      }

      const cropW0=maxX-minX+1, cropH0=maxY-minY+1;
      let visible=0,strong=0,lightNeutral=0,darkNeutral=0,lumSum=0,chromaSum=0;
      for(let y=minY;y<=maxY;y++){
        for(let x=minX;x<=maxX;x++){
          const p=(y*w+x)*4;
          const r=pixels[p],g=pixels[p+1],b=pixels[p+2],a=pixels[p+3];
          if(a<24) continue;
          const chroma=Math.max(r,g,b)-Math.min(r,g,b);
          const lum=(r+g+b)/3;
          const bgDistance=Math.abs(r-bg[0])+Math.abs(g-bg[1])+Math.abs(b-bg[2])+Math.abs(a-bg[3])*0.55;
          if(bgDistance<70) continue;
          visible++; lumSum+=lum; chromaSum+=chroma;
          if(bgDistance>=115) strong++;
          if(lum>232 && chroma<22) lightNeutral++;
          if(lum<24 && chroma<22) darkNeutral++;
        }
      }
      const boxArea=Math.max(1,cropW0*cropH0);
      const strongRatio=strong/boxArea;
      const visibleRatio=visible/boxArea;
      const meanLum=visible ? lumSum/visible : 255;
      const meanChroma=visible ? chromaSum/visible : 0;
      const darkTheme=document.documentElement.dataset.theme === 'dark' ||
        (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
      const invisibleOnSurface = !darkTheme
        ? (visible && lightNeutral/visible>0.82 && meanLum>226 && meanChroma<24)
        : (visible && darkNeutral/visible>0.82 && meanLum<30 && meanChroma<24);
      const lowInformation = visible < 10 || strong < 6 || visibleRatio < 0.003 || strongRatio < 0.0015;
      if(lowInformation || invisibleOnSurface) {
        window.__arenaRejectLogo(img);
        return;
      }

      const expand=Math.max(1,Math.round(Math.max(w,h)*0.012));
      minX=Math.max(0,minX-expand); minY=Math.max(0,minY-expand);
      maxX=Math.min(w-1,maxX+expand); maxY=Math.min(h-1,maxY+expand);
      const cropW=maxX-minX+1, cropH=maxY-minY+1;
      const output=document.createElement('canvas');
      output.width=96; output.height=96;
      const out=output.getContext('2d');
      out.clearRect(0,0,96,96);
      const inner=80;
      const scale=Math.min(inner/cropW,inner/cropH);
      const drawW=Math.max(1,cropW*scale), drawH=Math.max(1,cropH*scale);
      out.drawImage(sourceCanvas,minX,minY,cropW,cropH,(96-drawW)/2,(96-drawH)/2,drawW,drawH);

      const data = output.toDataURL('image/png');
      if(!window.__arenaRegisterFingerprint(img,data,original)) {
        window.__arenaRejectLogo(img);
        return;
      }
      window.__arenaLogoCache.set(original,data);
      window.__arenaRememberLogo(img,data,original);
      img.dataset.arenaNormalized='1';
      if (img.src !== data) {
        window.__arenaSetLogoState(img,'loading');
        img.src=data;
      } else {
        window.__arenaSetLogoState(img,'ready');
      }
    } catch (error) {
      img.dataset.arenaNormalizeError='1';
      window.__arenaRejectLogo(img);
    } finally {
      img.dataset.arenaNormalizing='0';
    }
  };
}
if (!window.__arenaLogoObserver) {
  window.__arenaLogoObserver = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes || []) {
        if (!(node instanceof Element)) continue;
        const images = node.matches?.('img[data-arena-source]') ? [node] : [...node.querySelectorAll?.('img[data-arena-source]') || []];
        for (const img of images) window.__arenaApplyCachedLogo(img);
      }
    }
  });
  window.__arenaLogoObserver.observe(document.documentElement,{childList:true,subtree:true});
}
`;
  let patched=source.replace(oldBlock,newBlock);
  patched=patched.replace(
    "startTime:saved.startTime, date:saved.date, competitors:saved.competitors || (saved.eventName || '').split(' - ').filter(Boolean).map(name => ({ name })),",
    "startTime:saved.startTime, date:saved.date, settlement:saved.settlement || null, competitors:saved.competitors || (saved.eventName || '').split(' - ').filter(Boolean).map(name => ({ name })),"
  );
  return (source.includes('__arenaNormalizeLogo') ? '' : normalizer) + patched;
}

const sportsCssPatch = `
/* Arena sync visual patch */
.tournament-symbol{
  background:var(--surface,#fff)!important;
  border-color:transparent;
  overflow:hidden;
}
.tournament-tabs>button.active .tournament-symbol{
  border:0!important;
  outline:0!important;
  box-shadow:none!important;
}
.game-badge-dark,
.game-badge-parik,
.tournament-symbol .game-badge{
  position:relative;
  display:grid;
  place-items:center;
  background:transparent!important;
  border-radius:50%;
  overflow:hidden;
}
.synced-discipline-logo{
  position:absolute;
  inset:0;
  z-index:2;
  display:block;
  width:100%;
  height:100%;
  padding:0!important;
  margin:0!important;
  box-sizing:border-box;
  object-fit:contain;
  object-position:center center!important;
  transform:none!important;
  background:transparent;
}
.valorant-restored{
  width:30px!important;
  height:30px!important;
  object-fit:contain;
}
.discipline-fallback{
  position:absolute;
  inset:0;
  z-index:1;
  display:grid;
  width:100%;
  height:100%;
  place-items:center;
}
.discipline-monogram{
  display:grid;
  place-items:center;
  width:100%;
  height:100%;
  border-radius:50%;
  background:#101010;
  color:#ece9e2;
  font-size:14px;
  font-weight:800;
  letter-spacing:-.5px;
}
.discipline-dota{color:#d7222a;font-size:20px}
.discipline-cs{color:#e7d500;font-size:12px}
.discipline-valorant{color:#ff4655;font-size:20px}
.discipline-lol{color:#c89b3c;font-size:19px}
.discipline-freefire{color:#f4d600;font-size:11px}
.discipline-mlbb{color:#56a7ff;font-size:11px}
.discipline-pubg{color:#f2a900;font-size:17px}
.discipline-r6{color:#f5f5f5;font-size:12px}
.team-emblem-picture{
  position:relative!important;
  display:inline-grid!important;
  place-items:center;
  width:28px!important;
  height:28px!important;
  min-width:28px!important;
  min-height:28px!important;
  flex:0 0 28px!important;
  border-radius:50%;
  overflow:hidden;
  background:transparent!important;
}
.team-logo{
  position:absolute!important;
  inset:0!important;
  z-index:2!important;
  display:block;
  width:100%;
  height:100%;
  object-fit:contain;
  background:transparent!important;
  border-radius:50%;
}
.team-emblem-fallback{
  position:absolute!important;
  inset:0!important;
  z-index:1!important;
  display:grid;
  place-items:center;
  width:100%;
  height:100%;
  border-radius:50%;
  background:#ebeae6!important;
  color:#3c3934!important;
  font-size:9px;
  line-height:1;
  font-weight:800;
  letter-spacing:-.2px;
}
.event-team-emblem .team-emblem-picture{
  width:72px!important;
  height:72px!important;
  min-width:72px!important;
  min-height:72px!important;
  flex-basis:72px!important;
}
`;



async function probeBo3Media() {
  const urls=[
    'https://api.bo3.gg/api/v1/tournaments?page[limit]=5&sort=-id',
    'https://api.bo3.gg/api/v1/teams?page[limit]=5&sort=-id'
  ];
  for(const url of urls){
    try{
      const response=await fetch(url,{signal:AbortSignal.timeout(10000),headers:{accept:'application/json'}});
      const body=await response.text();
      console.log('BO3_MEDIA_PROBE '+JSON.stringify({url,status:response.status,body:body.slice(0,12000)}));
    }catch(error){
      console.error('BO3_MEDIA_PROBE_ERROR '+JSON.stringify({url,error:String(error?.message||error)}));
    }
  }
}

async function probeParikIconPaths() {
  const tournamentId='8df12f483e8c46f38307abc078f1b1d1';
  const categoryId='817c1aebc52740d3b77d18af36d8d42f';
  const competitorId='125332';
  const paths=[
    '/taxonomyicons/tournaments/'+tournamentId+'-164w',
    '/taxonomyicons/tournaments/'+tournamentId,
    '/taxonomyicons/tournament/'+tournamentId+'-164w',
    '/taxonomyicons/categories/'+categoryId+'-164w',
    '/taxonomyicons/categories/'+categoryId,
    '/taxonomyicons/category/'+categoryId+'-164w',
    '/taxonomyicons/competitors/'+competitorId+'-164w',
    '/taxonomyicons/competitors/'+competitorId
  ];
  const rows=[];
  for(const origin of ['https://parik24.pro','https://24parik-bet.org']) {
    for(const pathname of paths) {
      try {
        const response=await fetch(origin+pathname,{
          redirect:'manual',
          signal:AbortSignal.timeout(8000),
          headers:{
            'user-agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1',
            'accept':'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            'referer':origin+'/'
          }
        });
        const body=await response.arrayBuffer().catch(()=>new ArrayBuffer(0));
        rows.push({
          url:origin+pathname,
          status:response.status,
          type:response.headers.get('content-type')||'',
          location:response.headers.get('location')||'',
          bytes:body.byteLength
        });
      } catch(error) {
        rows.push({url:origin+pathname,error:String(error?.cause?.code||error?.message||error)});
      }
    }
  }
  console.log('PARIK_ICON_PROBE '+JSON.stringify(rows));
}


const mediaCache = new Map();
const disciplineIds = {
  'Counter-Strike':1,
  'Valorant':2,
  'League of Legends':3,
  'Dota 2':4,
  'Rainbow6':7,
  'Rainbow Six':7,
  'Mobile Legends':8
};
const localDisciplineIcon = category => {
  const map = {
    'Counter-Strike':'/assets/icons/counter-strike.png',
    'Dota 2':'/assets/icons/dota.png',
    'League of Legends':'/assets/icons/lol.png'
  };
  return map[category] || '/assets/icons/esports-controller-clean-v79.png';
};
const mediaName = value => String(value || '')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/\b(players? duel|duel players?|kills?|maps?|bo\d|closed qualifier|open qualifier|дуель гравців|вбивства|дуэль игроков|убийства|киллы)\b.*$/giu,'')
  .replace(/[^\p{L}\p{N}]+/gu,' ')
  .trim();
const mediaWords = value => new Set(mediaName(value).split(/\s+/).filter(Boolean));
const mediaScore = (query,candidate) => {
  const a=mediaName(query), b=mediaName(candidate);
  if (!a || !b) return 0;
  if (a === b) return 1000;
  if (a.startsWith(b) || b.startsWith(a)) return 700 + Math.min(a.length,b.length);
  const aw=mediaWords(a), bw=mediaWords(b);
  let same=0;
  for(const word of aw) if(bw.has(word)) same++;
  const denom=Math.max(aw.size,bw.size,1);
  return Math.round((same/denom)*500);
};
async function bo3TournamentLogo(name,category) {
  const key='t:'+category+':'+mediaName(name);
  const cached=mediaCache.get(key);
  if (cached && Date.now()-cached.at < 6*3600_000) return cached.url;
  const discipline=disciplineIds[category];
  if (!discipline) return '';
  let best=null,bestScore=0;
  for (let offset=0; offset<=300; offset+=100) {
    const qs=new URLSearchParams({
      'page[limit]':'100',
      'page[offset]':String(offset),
      'sort':'-start_date',
      'filter[tournaments.discipline_id][eq]':String(discipline)
    });
    const response=await fetch('https://api.bo3.gg/api/v1/tournaments?'+qs,{
      signal:AbortSignal.timeout(12000),
      headers:{accept:'application/json'}
    });
    if(!response.ok) break;
    const data=await response.json();
    for(const row of data?.results || []) {
      const score=mediaScore(name,row.name);
      if(score>bestScore && row.image_url){best=row;bestScore=score;}
    }
    if(bestScore>=700 || !Array.isArray(data?.results) || data.results.length<100) break;
  }
  const url=bestScore>=220 ? String(best?.image_url || '') : '';
  mediaCache.set(key,{at:Date.now(),url});
  return url;
}
const PARIK_MEDIA_HOSTS = new Set(['parik24.pro','www.parik24.pro','24parik-bet.org','www.24parik-bet.org']);

function safeParikMediaURL(value) {
  try {
    const url=new URL(String(value || ''));
    if(url.protocol !== 'https:' || !PARIK_MEDIA_HOSTS.has(url.hostname)) return '';
    if(!/^\/taxonomyicons\/(?:tournaments|categories|competitors)\/[A-Za-z0-9._-]+(?:-164w)?$/.test(url.pathname)) return '';
    return url.href;
  } catch { return ''; }
}


const backgroundMedia = {
  disciplines:new Map(),
  tournaments:new Map(),
  competitors:new Map(),
  competitorNames:new Map(),
  warming:new Set(),
  queued:new Set(),
  queue:[],
  active:0,
  exactQueue:[],
  exactQueued:new Set(),
  exactActive:0,
  exactInFlight:new Map(),
  competitorMisses:new Map()
};

function logoFromEntity(row) {
  return String(row?.image_url || row?.icon_url || row?.avatar_url || row?.photo_url || row?.image?.url || '');
}

async function fetchBo3Pages(kind, discipline, limitPages) {
  const rows=[];
  for(let page=0; page<limitPages; page++){
    const qs=new URLSearchParams({
      'page[limit]':'100',
      'page[offset]':String(page*100)
    });
    const table=kind;
    if(discipline) qs.set(`filter[${table}.discipline_id][eq]`,String(discipline));
    if(kind === 'tournaments') qs.set('sort','-start_date');
    else qs.set('sort','-id');
    try{
      const response=await fetch(`https://api.bo3.gg/api/v1/${kind}?${qs}`,{
        signal:AbortSignal.timeout(7000),
        headers:{accept:'application/json'}
      });
      if(!response.ok) break;
      const data=await response.json();
      const batch=Array.isArray(data?.results) ? data.results : [];
      rows.push(...batch);
      if(batch.length < 100) break;
    }catch{break;}
  }
  return rows;
}

function bestCatalogLogo(name, rows, fields) {
  let best='', bestScore=0;
  for(const row of rows || []){
    const logo=logoFromEntity(row);
    if(!logo) continue;
    const candidate=fields.map(field=>row?.[field]).find(Boolean) || '';
    const score=mediaScore(name,candidate);
    if(score>bestScore){best=logo;bestScore=score;}
  }
  return bestScore>=700 ? best : '';
}


function competitorNameKey(name,category) {
  return String(category || '') + ':' + mediaName(name);
}

function mediaLookupVariants(name) {
  const raw=String(name || '').normalize('NFKC').trim();
  const stripped=raw
    .replace(/\s*\((?:replays?|replay)\)\s*$/giu,'')
    .replace(/\s+(?:r6|cs2|lol|dota\s*2)\s*$/giu,'')
    .trim();
  const normalized=mediaName(stripped || raw);
  return [...new Set([stripped,raw,normalized].map(value=>String(value || '').trim()).filter(Boolean))];
}

async function exactBo3Rows(kind,name,category) {
  const discipline=disciplineIds[category] || null;
  const table=kind;
  const nameField=kind === 'players' ? 'nickname' : 'name';
  const variants=mediaLookupVariants(name);
  for(const variant of variants){
    for(const op of ['eq','ilike']){
      const qs=new URLSearchParams({'page[limit]':'30'});
      const queryValue=op === 'ilike' ? '%' + variant + '%' : variant;
      qs.set(`filter[${table}.${nameField}][${op}]`,queryValue);
      if(discipline) qs.set(`filter[${table}.discipline_id][eq]`,String(discipline));
      try{
        const response=await fetch(`https://api.bo3.gg/api/v1/${kind}?${qs}`,{
          signal:AbortSignal.timeout(3000),
          headers:{accept:'application/json'}
        });
        if(!response.ok) continue;
        const data=await response.json();
        const rows=Array.isArray(data?.results) ? data.results : [];
        if(rows.length) return rows;
      }catch{}
    }
  }
  return [];
}

async function resolveExactMediaTask(task) {
  const {kind,id,name,category}=task;
  if(!name) return;

  if(kind === 'tournament'){
    const rows=await exactBo3Rows('tournaments',mediaName(name),category);
    const logo=bestCatalogLogo(name,rows,['name','slug']);
    if(logo && id) backgroundMedia.tournaments.set(String(id),logo);
    console.log('MEDIA_EXACT '+JSON.stringify({kind,id:id||null,name,category,found:!!logo}));
    return logo;
  }

  const kinds=category === 'Dota 2' ? ['players','teams'] : ['teams','players'];
  let logo='';
  for(const candidateKind of kinds){
    const rows=await exactBo3Rows(candidateKind,name,category);
    logo=bestCatalogLogo(name,rows,['nickname','name','slug']);
    if(logo) break;
  }

  if(!logo){
    const catalog=backgroundMedia.disciplines.get(String(category || ''));
    if(catalog){
      const preferred=category === 'Dota 2'
        ? [...(catalog.players || []),...(catalog.teams || [])]
        : [...(catalog.teams || []),...(catalog.players || [])];
      logo=bestCatalogLogo(name,preferred,['nickname','name','slug']);
    }
  }

  if(logo){
    if(id) backgroundMedia.competitors.set(String(id),logo);
    backgroundMedia.competitorNames.set(competitorNameKey(name,category),logo);
  }
  console.log('MEDIA_EXACT '+JSON.stringify({kind,id:id||null,name,category,found:!!logo}));
  return logo;
}

async function resolveCompetitorLogoOnDemand(id,name,category) {
  const cached=cachedCompetitorLogo(id,name,category);
  if(cached) return cached;

  const key=competitorNameKey(name,category) || String(id || '');
  const missAt=backgroundMedia.competitorMisses.get(key) || 0;
  if(missAt && Date.now()-missAt < 90_000) return '';

  const existing=backgroundMedia.exactInFlight.get(key);
  if(existing) return existing;

  const task={kind:'competitor',id,name,category};
  const promise=Promise.resolve(resolveExactMediaTask(task))
    .then(logo=>{
      const found=logo || cachedCompetitorLogo(id,name,category) || '';
      if(found) backgroundMedia.competitorMisses.delete(key);
      else backgroundMedia.competitorMisses.set(key,Date.now());
      return found;
    })
    .catch(()=>{
      backgroundMedia.competitorMisses.set(key,Date.now());
      return '';
    })
    .finally(()=>backgroundMedia.exactInFlight.delete(key));

  backgroundMedia.exactInFlight.set(key,promise);
  return promise;
}

function queueExactMedia(task) {
  const identity=String(task.id || competitorNameKey(task.name,task.category));
  const key=task.kind+':'+identity;
  if(!task.name || !identity || backgroundMedia.exactQueued.has(key)) return;
  backgroundMedia.exactQueued.add(key);
  backgroundMedia.exactQueue.push({...task,key});
  drainExactMediaQueue();
}

function drainExactMediaQueue() {
  while(backgroundMedia.exactActive < 3 && backgroundMedia.exactQueue.length){
    const task=backgroundMedia.exactQueue.shift();
    backgroundMedia.exactActive++;
    Promise.resolve(resolveExactMediaTask(task))
      .catch(()=>{})
      .finally(()=>{
        backgroundMedia.exactActive=Math.max(0,backgroundMedia.exactActive-1);
        backgroundMedia.exactQueued.delete(task.key);
        setTimeout(drainExactMediaQueue,0);
      });
  }
}

function applyDisciplineCatalog(category,catalog) {
  if(!catalog) return;
  const {tournaments=[],teams=[],players=[]}=catalog;
  for(const event of syncedEvents.values()){
    const eventCategory=String(event.categoryName || event.subsport || '');
    if(eventCategory !== category) continue;

    if(event.tournamentId){
      const tournamentId=String(event.tournamentId);
      const logo=bestCatalogLogo(event.tournamentName,tournaments,['name','slug']);
      backgroundMedia.tournaments.set(tournamentId,logo || '');
      if(!logo) queueExactMedia({
        kind:'tournament',
        id:tournamentId,
        name:mediaName(event.tournamentName),
        category
      });
    }

    for(const team of event.competitors || []){
      const id=String(team.id || '');
      if(!id) continue;
      const preferred=category === 'Dota 2'
        ? [...players,...teams]
        : [...teams,...players];
      const logo=bestCatalogLogo(team.name,preferred,['nickname','name','slug']);
      backgroundMedia.competitors.set(id,logo || '');
      if(logo) backgroundMedia.competitorNames.set(competitorNameKey(team.name,category),logo);
      if(!logo) queueExactMedia({
        kind:'competitor',
        id,
        name:String(team.name || ''),
        category
      });
    }
  }
}

async function warmDisciplineMedia(category) {
  category=String(category || '');
  const discipline=disciplineIds[category];
  if(!discipline) return;
  const existing=backgroundMedia.disciplines.get(category);
  if(existing && Date.now()-existing.at < 12*3600_000) {
    applyDisciplineCatalog(category,existing);
    return;
  }
  if(backgroundMedia.warming.has(category)) return;

  backgroundMedia.warming.add(category);
  try{
    const [tournaments,teams,players]=await Promise.all([
      fetchBo3Pages('tournaments',discipline,4),
      fetchBo3Pages('teams',discipline,5),
      fetchBo3Pages('players',discipline,5)
    ]);
    backgroundMedia.disciplines.set(category,{
      at:Date.now(),tournaments,teams,players
    });

    applyDisciplineCatalog(category,{tournaments,teams,players});
    console.log('MEDIA_WARM '+JSON.stringify({
      category,
      tournaments:tournaments.length,
      teams:teams.length,
      players:players.length
    }));
  }catch(error){
    console.error('MEDIA_WARM_ERROR '+JSON.stringify({category,error:String(error?.message || error)}));
  }finally{
    backgroundMedia.warming.delete(category);
  }
}

function drainMediaWarmQueue() {
  while(backgroundMedia.active < 2 && backgroundMedia.queue.length){
    const category=backgroundMedia.queue.shift();
    backgroundMedia.queued.delete(category);
    backgroundMedia.active++;
    Promise.resolve(warmDisciplineMedia(category))
      .catch(()=>{})
      .finally(()=>{
        backgroundMedia.active=Math.max(0,backgroundMedia.active-1);
        setTimeout(drainMediaWarmQueue,0);
      });
  }
}

function scheduleMediaWarm(events) {
  const categories=[...new Set((events || [])
    .map(event=>String(event?.categoryName || event?.subsport || ''))
    .filter(category=>disciplineIds[category]))];

  for(const category of categories){
    const cached=backgroundMedia.disciplines.get(category);
    if(cached && Date.now()-cached.at < 12*3600_000){
      applyDisciplineCatalog(category,cached);
      continue;
    }
    if(backgroundMedia.warming.has(category) || backgroundMedia.queued.has(category)) continue;
    backgroundMedia.queued.add(category);
    backgroundMedia.queue.push(category);
  }
  drainMediaWarmQueue();
}

function cachedTournamentLogo(id) {
  return backgroundMedia.tournaments.get(String(id || '')) || '';
}

function cachedCompetitorLogo(id,name,category) {
  const byId=id ? backgroundMedia.competitors.get(String(id)) : '';
  if(byId) return byId;
  return backgroundMedia.competitorNames.get(competitorNameKey(name,category)) || '';
}

async function remoteImageResponse(candidate) {
  if(!candidate?.url) return null;
  if(!candidate.trusted && !safeParikMediaURL(candidate.url)) return null;
  try{
    const response=await fetch(candidate.url,{
      signal:AbortSignal.timeout(2200),
      headers:{
        accept:'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'user-agent':'Mozilla/5.0 ArenaLine/1.0'
      }
    });
    const type=String(response.headers.get('content-type') || '');
    if(!response.ok || !type.startsWith('image/')) return null;
    return response;
  }catch{return null;}
}

async function sendRemoteImage(res,response) {
  res.statusCode=200;
  res.setHeader('content-type',response.headers.get('content-type') || 'image/png');
  res.setHeader('cache-control','public, max-age=21600, stale-while-revalidate=86400');
  res.setHeader('x-content-type-options','nosniff');
  res.setHeader('x-arena-media-proxy','1');
  return res.end(new Uint8Array(await response.arrayBuffer()));
}

async function streamImageCandidates(res,candidates,fallback='') {
  for(const candidate of candidates){
    const response=await remoteImageResponse(candidate);
    if(response) return sendRemoteImage(res,response);
  }
  if(fallback){
    res.statusCode=302;
    res.setHeader('location',fallback);
    res.setHeader('cache-control','public, max-age=300');
    return res.end();
  }
  res.statusCode=404;
  res.setHeader('cache-control','public, max-age=120');
  return res.end();
}

function safeHeaders(headers = {}) {
  const forbidden = new Set(['host','content-length','connection','transfer-encoding','keep-alive','upgrade','te','trailer']);
  const out = {};
  for (const [key,value] of Object.entries(headers)) if (!forbidden.has(key.toLowerCase()) && value != null) out[key] = String(value);
  return out;
}
async function embeddedAsset(pathname,method,headers,env,ctx) {
  const request = new Request('http://localhost' + pathname,{method,headers:safeHeaders(headers)});
  return app.fetch(request,env,ctx);
}

async function mergedSettlements(bodyBuffer, req, env, ctx) {
  const payload=JSON.parse(new TextDecoder().decode(bodyBuffer) || '{}');
  const events=Array.isArray(payload.events) ? payload.events : [];
  if (!events.length || events.length > 30) return {status:400,body:{error:'Invalid events'}};

  let base={results:[],unavailable:[],pending:events.map(e=>String(e.eventId||e.id||''))};
  try {
    const request=new Request('http://localhost/api/settlements',{
      method:'POST',
      headers:safeHeaders(req.headers),
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

const runtimeTablePromises = new WeakMap();
let lastEventHydrateAt = 0;
async function ensureRuntimeTables(env) {
  const db=env?.DB; if(!db) return false;
  let pending=runtimeTablePromises.get(db);
  if(!pending) {
    pending=(async()=>{
      await db.prepare("CREATE TABLE IF NOT EXISTS arena_synced_events (id TEXT PRIMARY KEY, event_json TEXT NOT NULL, synced_at INTEGER NOT NULL, start_time INTEGER NOT NULL DEFAULT 0)").run();
      await db.prepare("CREATE INDEX IF NOT EXISTS arena_synced_events_synced_at_idx ON arena_synced_events(synced_at DESC)").run();
      await db.prepare("CREATE TABLE IF NOT EXISTS arena_runtime_state (state_key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL)").run();
    })().catch(error=>{runtimeTablePromises.delete(db);throw error;});
    runtimeTablePromises.set(db,pending);
  }
  await pending; return true;
}
async function persistSyncMeta(env) {
  if(!env?.DB) return;
  await ensureRuntimeTables(env);
  await env.DB.prepare("INSERT INTO arena_runtime_state (state_key,value_json,updated_at) VALUES ('syncMeta',?,?) ON CONFLICT(state_key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at").bind(JSON.stringify(syncMeta),Date.now()).run();
}
async function hydrateEventCache(env) {
  if(!env?.DB || Date.now()-lastEventHydrateAt<5000) return;
  await ensureRuntimeTables(env);
  const rows=await env.DB.prepare("SELECT event_json FROM arena_synced_events ORDER BY synced_at DESC LIMIT 5000").all();
  syncedEvents.clear();
  for(const row of rows.results||[]) { try { const event=JSON.parse(row.event_json); if(event?.id) syncedEvents.set(String(event.id),event); } catch {} }
  const state=await env.DB.prepare("SELECT value_json FROM arena_runtime_state WHERE state_key='syncMeta'").first();
  if(state?.value_json) { try { syncMeta={...syncMeta,...JSON.parse(state.value_json)}; } catch {} }
  lastEventHydrateAt=Date.now();
}
async function handle(req,res,originalRequest,env,ctx) {
  try {
    await hydrateEventCache(env);
    const method=req.method || 'GET';
    const url=new URL(req.url || '/','http://localhost');

    if (url.pathname === '/api/media/team' && method === 'GET') {
      const id=safeString(url.searchParams.get('id'),32);
      const prefer=safeString(url.searchParams.get('prefer') || 'parik',20);
      const name=safeString(url.searchParams.get('name'),160);
      const category=safeString(url.searchParams.get('category'),80);
      const exactSource=safeParikMediaURL(url.searchParams.get('source'));
      const numericId=/^[0-9]{1,16}$/.test(id);
      if(!numericId && !name) return json(res,400,{ok:false,error:'Missing competitor identity'});

      if(prefer === 'bo3'){
        const started=Date.now();
        let cached=cachedCompetitorLogo(numericId ? id : '',name,category);
        if(!cached && name){
          const direct=resolveCompetitorLogoOnDemand(numericId ? id : '',name,category);
          cached=await Promise.race([
            direct,
            new Promise(resolve=>setTimeout(()=>resolve(''),6500))
          ]);
          if(category) warmDisciplineMedia(category).catch(()=>{});
        }
        console.log('MEDIA_ONDEMAND '+JSON.stringify({
          id:numericId ? id : null,
          name,
          category,
          found:!!cached,
          ms:Date.now()-started
        }));
        if(!cached){
          res.statusCode=404;
          res.setHeader('cache-control','no-store');
          res.setHeader('x-arena-media-pending','1');
          return res.end();
        }
        return streamImageCandidates(res,[{url:cached,trusted:true}]);
      }

      if(prefer === 'parik-alt'){
        if(!numericId){
          res.statusCode=404;
          res.setHeader('cache-control','no-store');
          return res.end();
        }
        return streamImageCandidates(res,[
          {url:'https://24parik-bet.org/taxonomyicons/competitors/'+id+'-164w'}
        ]);
      }

      return streamImageCandidates(res,[
        {url:exactSource},
        ...(numericId ? [{url:'https://parik24.pro/taxonomyicons/competitors/'+id+'-164w'}] : [])
      ]);
    }

    if (url.pathname === '/api/media/tournament' && method === 'GET') {
      const id=safeString(url.searchParams.get('id'),80);
      const category=safeString(url.searchParams.get('category'),80);
      const exactTournament=safeParikMediaURL(url.searchParams.get('source'));
      const exactCategory=safeParikMediaURL(url.searchParams.get('categorySource'));
      const prefer=safeString(url.searchParams.get('prefer') || 'parik',20);
      const fallback=localDisciplineIcon(category);

      if(prefer === 'parik') return streamImageCandidates(res,[{url:exactTournament}]);

      if(prefer === 'bo3'){
        const cached=cachedTournamentLogo(id);
        if(!cached){
          res.statusCode=404;
          res.setHeader('cache-control','no-store');
          return res.end();
        }
        return streamImageCandidates(res,[{url:cached,trusted:true}]);
      }

      if(prefer === 'category'){
        return streamImageCandidates(res,[{url:exactCategory}],fallback);
      }

      return streamImageCandidates(res,[{url:exactTournament},{url:exactCategory}],fallback);
    }

    if (url.pathname === '/assets/icons/esports-controller-clean-v79.png' && ['GET','HEAD'].includes(method)) {
      res.statusCode=200;
      res.setHeader('content-type','image/png');
      res.setHeader('cache-control','public, max-age=31536000, immutable');
      res.setHeader('content-length',String(exactEsportsController.length));
      if(method==='HEAD') return res.end();
      return res.end(exactEsportsController);
    }

    if (url.pathname === '/health') {
      const profileStorage=await profileStorageStatus(env);
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

    if ((url.pathname === '/' || url.pathname === '/index.html') && ['GET','HEAD'].includes(method)) {
      const response=await embeddedAsset(url.pathname === '/' ? '/' : '/index.html',method,req.headers,env,ctx);
      if (!response.ok) { res.statusCode=response.status; return res.end(); }
      const source=method === 'HEAD' ? '' : await response.text();
      return textResponse(res,method,'text/html; charset=utf-8',patchIndexHtml(source),'no-store');
    }

    if (url.pathname.startsWith('/v112/') && ['GET','HEAD'].includes(method)) {
      const runtimePath='/' + url.pathname.slice('/v112/'.length);
      if (runtimePath === '/feed.mjs') return js(res,method,feedModule,'no-store');
      if (runtimePath === '/team-emblem.mjs') return js(res,method,emblemModule,'no-store');
      if (runtimePath === '/ui.mjs') return js(res,method,uiModule,'no-store');
      if (runtimePath === '/i18n.mjs') return js(res,method,i18nModule,'no-store');
      if (runtimePath === '/account.mjs') return js(res,method,accountModule,'no-store');
      if (runtimePath === '/app.js') return js(res,method,appModule,'no-store');
      if (runtimePath === '/bet-view.mjs') return js(res,method,betViewModule,'no-store');
      if (runtimePath === '/event-view.mjs') return js(res,method,eventViewModule,'no-store');
      if (runtimePath === '/share-coupon.mjs') return js(res,method,shareCouponModule,'no-store');
      if (runtimePath === '/theme.css') return css(res,method,themeCssModule,'no-store');
      if (runtimePath === '/sports.mjs') {
        const response=await embeddedAsset('/sports.mjs',method,req.headers,env,ctx);
        if (!response.ok) { res.statusCode=response.status; return res.end(); }
        const source=method === 'HEAD' ? '' : await response.text();
        return js(res,method,patchSportsModule(source),'no-store');
      }
      if (runtimePath === '/sports.css') {
        const response=await embeddedAsset('/sports.css',method,req.headers,env,ctx);
        if (!response.ok) { res.statusCode=response.status; return res.end(); }
        const source=method === 'HEAD' ? '' : await response.text();
        return css(res,method,source + sportsCssPatch,'no-store');
      }
      const response=await embeddedAsset(runtimePath,method,req.headers,env,ctx);
      res.statusCode=response.status;
      response.headers.forEach((value,key)=>res.setHeader(key,value));
      res.setHeader('cache-control','no-store');
      if (method === 'HEAD' || response.status === 204 || !response.body) return res.end();
      return pipeResponse(response,res);
    }

    if (url.pathname === '/feed.mjs' && ['GET','HEAD'].includes(method)) return js(res,method,feedModule);
    if (url.pathname === '/team-emblem.mjs' && ['GET','HEAD'].includes(method)) return js(res,method,emblemModule);
    if (url.pathname === '/ui.mjs' && ['GET','HEAD'].includes(method)) return js(res,method,uiModule);
    if (url.pathname === '/i18n.mjs' && ['GET','HEAD'].includes(method)) return js(res,method,i18nModule);
    if (url.pathname === '/account.mjs' && ['GET','HEAD'].includes(method)) return js(res,method,accountModule);
    if (url.pathname === '/app.js' && ['GET','HEAD'].includes(method)) return js(res,method,appModule);
    if (url.pathname === '/bet-view.mjs' && ['GET','HEAD'].includes(method)) return js(res,method,betViewModule);
    if (url.pathname === '/event-view.mjs' && ['GET','HEAD'].includes(method)) return js(res,method,eventViewModule);
    if (url.pathname === '/theme.css' && ['GET','HEAD'].includes(method)) return css(res,method,themeCssModule);
    if (url.pathname === '/sw.js' && ['GET','HEAD'].includes(method)) {
      res.setHeader('service-worker-allowed','/');
      return js(res,method,serviceWorkerModule,'no-cache, no-store, must-revalidate');
    }
    if (url.pathname === '/manifest.webmanifest' && ['GET','HEAD'].includes(method)) {
      return textResponse(res,method,'application/manifest+json; charset=utf-8',manifestModule);
    }

    if (url.pathname === '/sports.mjs' && ['GET','HEAD'].includes(method)) {
      const response=await embeddedAsset('/sports.mjs',method,req.headers,env,ctx);
      if (!response.ok) { res.statusCode=response.status; return res.end(); }
      const source=method === 'HEAD' ? '' : await response.text();
      return js(res,method,patchSportsModule(source));
    }

    if (url.pathname === '/sports.css' && ['GET','HEAD'].includes(method)) {
      const response=await embeddedAsset('/sports.css',method,req.headers,env,ctx);
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
      const stored=await readProfile(env,email);
      if (!stored) return json(res,404,{ok:false,error:'Profile not found'});
      const profile=await loginProfile(env,email,hash);
      if (!profile) return json(res,401,{ok:false,error:'Invalid credentials'});
      return json(res,200,{ok:true,profile});
    }

    if (url.pathname === '/api/profile') {
      if (method !== 'GET') return json(res,405,{ok:false,error:'Method not allowed'});
      const email=safeString(url.searchParams.get('email'),200).trim().toLowerCase();
      const hash=bearer(req);
      if (!email || !/^[a-f0-9]{64}$/i.test(hash)) return json(res,401,{ok:false,error:'Unauthorized'});
      const stored=await readProfile(env,email);
      if (!stored) return json(res,404,{ok:false,error:'Profile not found'});
      const profile=await loginProfile(env,email,hash);
      if (!profile) return json(res,401,{ok:false,error:'Unauthorized'});
      return json(res,200,{ok:true,profile});
    }

    if (url.pathname === '/api/profile/password') {
      if (method !== 'POST') return json(res,405,{ok:false,error:'Method not allowed'});
      const oldHash=bearer(req);
      const body=JSON.parse((await readBody(req,32_000)).toString('utf8') || '{}');
      const email=safeString(body.email,200).trim().toLowerCase();
      const newHash=safeString(body.newHash,80);
      if (!email || !/^[a-f0-9]{64}$/i.test(oldHash) || !/^[a-f0-9]{64}$/i.test(newHash)) {
        return json(res,400,{ok:false,error:'Invalid credential'});
      }
      try {
        const profile=await changeProfilePassword(env,email,oldHash,newHash);
        if (!profile) return json(res,404,{ok:false,error:'Profile not found'});
        return json(res,200,{ok:true,profile});
      } catch(error) {
        if (error?.statusCode === 401) return json(res,401,{ok:false,error:'Unauthorized'});
        return json(res,400,{ok:false,error:safeString(error?.message || 'Password sync failed',200)});
      }
    }

    if (url.pathname === '/api/profile/sync') {
      if (method !== 'POST') return json(res,405,{ok:false,error:'Method not allowed'});
      const hash=bearer(req);
      if (!/^[a-f0-9]{64}$/i.test(hash)) return json(res,401,{ok:false,error:'Unauthorized'});
      const body=JSON.parse((await readBody(req,2_100_000)).toString('utf8') || '{}');
      try {
        const profile=await syncProfile(env,body.profile,hash);
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

    if (url.pathname === '/api/client-diagnostic') {
      if (method !== 'POST') return json(res,405,{ok:false,error:'Method not allowed'});
      const body=await readBody(req,12_000);
      let value={};
      try{value=JSON.parse(body.toString('utf8') || '{}');}catch{}
      const diagnostic={
        kind:safeString(value.kind,60),
        message:safeString(value.message,2000),
        build:safeString(value.build,20),
        href:safeString(value.href,500),
        source:safeString(value.source,500),
        line:Number(value.line || 0),
        column:Number(value.column || 0),
        ua:safeString(req.headers['user-agent'],500),
        at:Date.now()
      };
      console.log('CLIENT_DIAGNOSTIC '+JSON.stringify(diagnostic));
      return json(res,200,{ok:true});
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
      await persistSyncMeta(env);
      console.log('FEED_TELEMETRY '+JSON.stringify(telemetry));
      return json(res,200,{ok:true});
    }

    if (url.pathname === '/api/sync/events') {
      if (method !== 'POST') return json(res,405,{ok:false,error:'Method not allowed'});
      const body=await readBody(req,1_500_000);
      const value=JSON.parse(body.toString('utf8') || '{}');
      if (!Array.isArray(value.rows) || value.rows.length > 250) return json(res,400,{ok:false,error:'Invalid rows'});
      let accepted=0;
      const persistence=[];
      for (const raw of value.rows) {
        const event=safeEvent(raw);
        if (!event) continue;
        syncedEvents.set(event.id,event);
        if (env?.DB) persistence.push(env.DB.prepare("INSERT INTO arena_synced_events (id,event_json,synced_at,start_time) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET event_json=excluded.event_json,synced_at=excluded.synced_at,start_time=excluded.start_time").bind(event.id,JSON.stringify(event),event.syncedAt,Number(event.startTime||0)));
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
      if(env?.DB && persistence.length) {
        await ensureRuntimeTables(env);
        await env.DB.batch(persistence);
        await env.DB.prepare("DELETE FROM arena_synced_events WHERE id IN (SELECT id FROM arena_synced_events ORDER BY synced_at DESC LIMIT -1 OFFSET 5000)").run();
      }
      await persistSyncMeta(env);
      lastEventHydrateAt=Date.now();
      scheduleMediaWarm([...syncedEvents.values()]);
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
      const merged=await mergedSettlements(body,req,env,ctx);
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
      headers:safeHeaders(req.headers),
      ...(body ? {body} : {})
    });
    const response=await app.fetch(request,env,ctx);
    res.statusCode=response.status;
    response.headers.forEach((value,key)=>res.setHeader(key,value));
    res.setHeader('cache-control',runtimeCacheControl(url.pathname));
    if (method === 'HEAD' || response.status === 204 || !response.body) return res.end();
    pipeResponse(response,res);
  } catch(error) {
    console.error('Arena Line runtime error',error?.stack || error);
    return json(res,500,{ok:false,error:'Arena Line server error'});
  }
}function pipeResponse(response,res) { return response.arrayBuffer().then(buffer=>res.end(new Uint8Array(buffer))); }
function makeResponseCapture(method) {
 const headers=new Headers(); let body=null; let ended=false;
 return {statusCode:200,setHeader(name,value){try{headers.set(String(name),String(value));}catch{}},end(value){if(!ended){body=value==null?null:value;ended=true;}return this;},toResponse(){const status=Number(this.statusCode||200);return new Response(method==='HEAD'||status===204||status===304?null:body,{status,headers});}};
}
let resultsProbeStarted=false;
function startResultsProbe(ctx) {
 if(resultsProbeStarted)return; resultsProbeStarted=true;
 const task=probeResultsSource().then(status=>{resultsSource={...status,error:null};console.log('RESULTS_SOURCE_OK '+JSON.stringify(resultsSource));}).catch(error=>{resultsSource={ok:false,error:String(error?.message||error),disciplines:[]};console.error('RESULTS_SOURCE_ERROR '+JSON.stringify(resultsSource));});
 if(ctx?.waitUntil)ctx.waitUntil(task);
}
export default {
 async fetch(request,env={},ctx={}) {
  startResultsProbe(ctx);
  const url=new URL(request.url);
  const req={method:request.method,url:url.pathname+url.search,headers:Object.fromEntries(request.headers.entries()),async *[Symbol.asyncIterator](){if(!request.body)return;const reader=request.body.getReader();try{while(true){const {done,value}=await reader.read();if(done)break;yield value;}}finally{try{reader.releaseLock();}catch{}}}};
  const res=makeResponseCapture(request.method);
  try{await handle(req,res,request,env,ctx);return res.toResponse();}catch(error){console.error('Arena Line Sites runtime error',error?.stack||error);return Response.json({ok:false,error:'Arena Line server error'},{status:500,headers:{'cache-control':'no-store'}});}
 }
};

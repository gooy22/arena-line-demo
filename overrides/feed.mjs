// Same UI contract as v32; only the dead provider transport is replaced.
export const FEED_URL = '/api/live-line';
const canonical = value => JSON.stringify(value, (_, v) => v && !Array.isArray(v) && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
export function mergeDelta(previous, delta) {
  if (delta === null || typeof delta !== 'object') return delta;
  if (Array.isArray(delta)) return delta.map((item, i) => mergeDelta(previous?.[i], item)).filter(item => !item?.isRemoved);
  if (!Object.keys(delta).length) return previous;
  const result = { ...previous };
  for (const [key, value] of Object.entries(delta)) result[key] = mergeDelta(previous?.[key], value);
  return result;
}
export function applyBatch(map, batch) {
  if (batch.isInitialBatch) map.clear();
  for (const item of batch.data || []) {
    const id = typeof item.key === 'string' ? item.key : canonical(item.key);
    if (item.isRemoved) map.delete(id);
    else map.set(id, { key:item.key, value:mergeDelta(map.get(id)?.value,item.value) });
  }
  return map;
}
export const MARKET_NAMES = { 1:'Переможець',2:'Результат матчу',4:'Фора',5:'Тотал',6:'Парний / непарний',16:'Точний рахунок',260:'Фора за картами',264:'Тотал карт' };
export function periodName(sport, period) {
  if (!period) return '';
  if (sport === 'CS') return `Карта ${period}`;
  if (sport === 'F') return `${period}-й тайм`;
  if (['T','TT','VB'].includes(sport)) return `Сет ${period}`;
  return `Період ${period}`;
}
export function marketSelections(row,event) { return []; }

export class LiveFeed {
  constructor({onChange=()=>{}}={}) {
    this.onChange=onChange; this.sport='CS'; this.stage='live'; this.range={fromInHours:0,toInHours:24};
    this.state='connecting'; this.error=''; this.ready=false; this.stopped=false;
    try{if(localStorage.getItem('arena-default-stage')==='prematch')this.stage='prematch';}catch{}
    this.events=new Map(); this.watched=new Map(); this.markets=new Map(); this.sports=new Map();
    this.directSelections=new Map(); this.allEvents=new Map(); this.selectedIds=[];
    this.eventsReady=false; this.marketsReady=false; this.lastMessage=0; this.failures=0;
  }
  notify(){this.onChange(this);}
  connect(){
    this.stopped=false; clearTimeout(this.retry); clearTimeout(this.pollTimer);
    this.state=this.eventsReady?this.state:'connecting'; this.notify(); this.poll();
  }
  async poll(){
    if(this.stopped||this.polling)return;
    this.polling=true;
    try{
      const response=await fetch('/api/live-line',{cache:'no-store',headers:{accept:'application/json'}});
      if(!response.ok)throw new Error('Live line '+response.status);
      const data=await response.json();
      if(!Array.isArray(data.events)||!Array.isArray(data.selections))throw new Error('Invalid live line');
      this.allEvents.clear();
      for(const event of data.events)this.allEvents.set(String(event.id),{key:String(event.id),value:event});
      this.events.clear();
      if(this.stage==='live')for(const [id,row] of this.allEvents)if(row.value.sport===this.sport)this.events.set(id,row);
      this.rebuildWatched();
      this.directSelections.clear();
      for(const selection of data.selections){
        const id=String(selection.eventId);
        if(!this.directSelections.has(id))this.directSelections.set(id,[]);
        this.directSelections.get(id).push(selection);
      }
      this.ready=true; this.eventsReady=true; this.marketsReady=true; this.lastMessage=Date.now();
      this.state='connected'; this.error=''; this.failures=0; this.notify();
    }catch(error){
      this.ready=false; this.eventsReady=this.events.size>0; this.marketsReady=this.eventsReady;
      this.state='offline'; this.error='Немає з’єднання з джерелом матчів'; this.failures+=1; this.notify();
    }finally{
      this.polling=false;
      if(!this.stopped)this.pollTimer=setTimeout(()=>this.poll(),Math.min(15000,7000+this.failures*1500));
    }
  }
  rebuildWatched(){
    this.watched.clear();
    for(const id of this.selectedIds){const row=this.allEvents.get(String(id));if(row)this.watched.set(String(id),row);}
  }
  setView(sport,stage){
    this.sport=sport;this.stage=stage;this.events.clear();
    if(stage==='live')for(const [id,row] of this.allEvents)if(row.value.sport===sport)this.events.set(id,row);
    this.eventsReady=this.allEvents.size>0||this.state==='connected';this.marketsReady=this.eventsReady;this.notify();
    if(!this.stopped){clearTimeout(this.pollTimer);this.poll();}
  }
  watch(ids){
    const next=[...new Set(ids.map(String))].sort();
    if(JSON.stringify(next)===JSON.stringify(this.selectedIds))return;
    this.selectedIds=next;this.rebuildWatched();this.notify();
  }
  get fresh(){return this.state==='connected'&&this.marketsReady&&Date.now()-this.lastMessage<30000;}
  event(id){return this.events.get(String(id))?.value||this.watched.get(String(id))?.value||this.allEvents.get(String(id))?.value;}
  selections(eventId){return (this.directSelections.get(String(eventId))||[]).slice().sort((a,b)=>(a.period||0)-(b.period||0)||(a.marketType||0)-(b.marketType||0));}
  quote(id){for(const rows of this.directSelections.values()){const result=rows.find(selection=>selection.id===id);if(result)return result;}return null;}
  close(){this.stopped=true;clearTimeout(this.retry);clearTimeout(this.pollTimer);this.ready=false;}
}

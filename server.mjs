import http from 'node:http';
import { Readable } from 'node:stream';
import app from './dist/server/index.js';

const port = Number(process.env.PORT || 3000);
const env = {};
const ctx = { waitUntil(p) { Promise.resolve(p).catch(() => {}); } };
const LIVE_SOURCE = 'https://parik24.me/uk/all-live/';
const LIVE_TTL = 7000;
let liveCache = { time:0, value:null, error:'' };
let livePending = null;

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
function text(value) {
  return String(value ?? '').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&')
    .replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/s+/g,' ').trim();
}
function attr(value) { return text(String(value ?? '').replace(/<[^>]+>/g,'')); }
function sportFromTitle(title) {
  const v=title.toLowerCase();
  if (/настільн.*теніс/.test(v)) return 'TT';
  if (/кіберспорт|counter.?strike|dota|league of legends|valorant/.test(v)) return 'CS';
  if (/баскет/.test(v)) return 'B'; if (/волейбол/.test(v)) return 'VB'; if (/хокей/.test(v)) return 'H';
  if (/снукер/.test(v)) return 'PL'; if (/теніс/.test(v)) return 'T'; return 'F';
}
function scoreType(sport) { return {F:[1,4],CS:[1006,1],T:[1009,1],TT:[1009,1],H:[1,5],B:[1010,8],VB:[1009,1],PL:[1001,1]}[sport] || [1,1]; }
function tournamentId(title) { let h=2166136261; for(const ch of title){h^=ch.codePointAt(0);h=Math.imul(h,16777619);} return 'html-'+(h>>>0).toString(36); }
function teamId(eventId,index,name){let h=0;for(const ch of name)h=(Math.imul(h,31)+ch.codePointAt(0))>>>0;return String(eventId)+String(index+1)+String(h%100000);}

function parseLiveHTML(html) {
  const titleRe=/<span[^>]*data-id=["']events-title["'][^>]*>([sS]*?)</span>/gi;
  const eventRe=/<div[^>]*data-anchor=["']event_(d+)["'][^>]*>/gi;
  const tokens=[]; let m;
  while((m=titleRe.exec(html))) tokens.push({type:'title',pos:m.index,text:text(m[1])});
  while((m=eventRe.exec(html))) tokens.push({type:'event',pos:m.index,id:m[1]});
  tokens.sort((a,b)=>a.pos-b.pos);
  let currentTitle=''; const events=[], selections=[]; const now=Math.floor(Date.now()/1000);
  for(let i=0;i<tokens.length;i++){
    const token=tokens[i];
    if(token.type==='title'){currentTitle=token.text;continue;}
    if(!currentTitle)continue;
    const end=tokens[i+1]?.pos??html.length, card=html.slice(token.pos,end), sport=sportFromTitle(currentTitle);
    const infoStart=card.indexOf('data-onboarding="event-info"'), marketStart=card.indexOf('data-onboarding="event-card-main-market"');
    const info=infoStart>=0?card.slice(infoStart,marketStart>infoStart?marketStart:card.length):card;
    const images=[...info.matchAll(/<img[^>]*(?:src=["']([^"']+)["'][^>]*alt=["']([^"']+)["']|alt=["']([^"']+)["'][^>]*src=["']([^"']+)["'])[^>]*>/gi)]
      .map(row=>({src:attr(row[1]||row[4]),alt:attr(row[2]||row[3])})).filter(row=>row.alt);
    const names=[]; for(const row of images)if(!names.includes(row.alt))names.push(row.alt);
    if(names.length<2)for(const row of info.matchAll(/<span[^>]*class=["'][^"']*styles_name[^"']*["'][^>]*>([sS]*?)</span>/gi)){const name=text(row[1]);if(name&&!names.includes(name))names.push(name);}
    if(names.length<2)continue; names.length=2;
    const scoreValues=[...info.matchAll(/<span[^>]*style=["'][^"']*--text:s*var(--text-live)[^"']*["'][^>]*>([sS]*?)</span>/gi)]
      .map(row=>text(row[1])).filter(v=>/^d+$/.test(v)).slice(-2);
    const timeMatch=card.match(/<span[^>]*class=["'][^"']*styles_time__[^"']*["'][^>]*>([sS]*?)</span>/i);
    const regulation=text(timeMatch?.[1]||'ЛАЙВ');
    const odds=[], oddsRe=/<span[^>]*data-id=["']odds-value["'][^>]*>([sS]*?)</span>[sS]{0,1800}?<span[^>]*data-id=["']outcome-name-value["'][^>]*>([sS]*?)</span>/gi;
    let om; while((om=oddsRe.exec(card))){const odd=Number(text(om[1]).replace(',','.')),label=text(om[2]);if(Number.isFinite(odd)&&odd>1&&label)odds.push({label,odds:odd});}
    const parts=currentTitle.split(/.s+/).filter(Boolean);
    const categoryName=parts.length>1?parts[0]:({F:'Футбол',CS:'Кіберспорт',T:'Теніс',TT:'Настільний теніс',H:'Хокей',B:'Баскетбол',VB:'Волейбол',PL:'Снукер'}[sport]||'Спорт');
    const tournamentName=parts.length>1?parts.slice(1).join('. '):currentTitle;
    const [periodScoreType,period]=scoreType(sport), score=scoreValues.length===2?scoreValues.join('-'):'';
    const competitors=names.map((name,index)=>{
      const image=images.find(row=>row.alt===name)?.src, url=image?new URL(image,LIVE_SOURCE).href:undefined;
      return {id:teamId(token.id,index,name),name,...(scoreValues[index]!=null?{score:Number(scoreValues[index])}:{}),...(url?{icon:{url}}:{})};
    });
    const event={id:String(token.id),name:`${names[0]} - ${names[1]}`,sport,subsport:'',stage:2,status:/перерва/i.test(regulation)?2:1,
      regulation,tradingStatus:1,startTime:now,tournamentId:tournamentId(currentTitle),tournamentName,categoryName,competitors,
      scoreboard:{scores:score?[{periodScoreType,period,score}]:[]}};
    events.push(event);
    const winner=odds.filter(row=>['П1','П2','X','Х'].includes(row.label));
    if(winner.length>=2)for(const row of winner){
      const type=row.label==='П1'?0:row.label==='П2'?3:1, shortLabel=type===0?'П1':type===3?'П2':'X';
      const label=type===0?names[0]:type===3?names[1]:'Нічия';
      selections.push({id:encodeURIComponent(JSON.stringify(['parik-html',String(token.id),type])),eventId:String(token.id),eventName:event.name,
        tournament:tournamentName,marketName:'Переможець',label,shortLabel,odds:row.odds,sport,subsport:'',startTime:event.startTime,
        competitors,categoryName,outcomeType:type,outcomeValues:[],resultKind:1,frozen:false,stage:2,marketType:1,period:0,parameters:[],version:Date.now()});
    }
  }
  return {events,selections};
}
async function loadLiveLine(force=false) {
  if(!force&&liveCache.value&&Date.now()-liveCache.time<LIVE_TTL)return liveCache.value;
  if(livePending)return livePending;
  livePending=(async()=>{
    const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await fetch(LIVE_SOURCE,{signal:controller.signal,headers:{
        'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153.0.0.0 Safari/537.36',
        'Accept':'text/html,application/xhtml+xml','Accept-Language':'uk-UA,uk;q=0.9,en;q=0.7','Cache-Control':'no-cache'
      }});
      if(!response.ok)throw new Error('Parik live HTTP '+response.status);
      const html=await response.text();
      if(html.length<20000||!/data-anchor=["']event_d+/.test(html))throw new Error('Parik live page has no event cards');
      const parsed=parseLiveHTML(html);
      if(!parsed.events.length)throw new Error('Parik live parser returned zero events');
      const value={...parsed,source:'parik24.me',fetchedAt:Date.now()};
      liveCache={time:Date.now(),value,error:''};
      console.log(`Parik live refresh ok events=${value.events.length} selections=${value.selections.length}`);
      return value;
    }catch(error){
      liveCache.error=error?.message||String(error); console.error('Parik live refresh failed',liveCache.error);
      if(liveCache.value&&Date.now()-liveCache.time<120000)return {...liveCache.value,stale:true,error:liveCache.error};
      throw error;
    }finally{clearTimeout(timeout);livePending=null;}
  })();
  return livePending;
}

const server=http.createServer(async(req,res)=>{
  try{
    const requestUrl=new URL(req.url||'/','http://localhost');
    if(requestUrl.pathname==='/health'){
      res.statusCode=200;res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');
      return res.end(JSON.stringify({ok:true,source:'arena-line-site.zip-exact-worker-v32',liveSource:LIVE_SOURCE,
        liveAge:liveCache.time?Date.now()-liveCache.time:null,liveError:liveCache.error||null}));
    }
    if(requestUrl.pathname==='/api/live-line'){
      if((req.method||'GET')!=='GET'){res.statusCode=405;return res.end('Method not allowed');}
      try{
        const value=await loadLiveLine(requestUrl.searchParams.get('force')==='1');
        res.statusCode=200;res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');
        return res.end(JSON.stringify(value));
      }catch(error){
        res.statusCode=503;res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');
        return res.end(JSON.stringify({error:'Live source unavailable',detail:error?.message||String(error)}));
      }
    }
    const method=req.method||'GET',body=['GET','HEAD'].includes(method)?undefined:await readBody(req);
    const request=new Request('http://localhost'+(req.url||'/'),{method,headers:req.headers,...(body?{body}:{})});
    const response=await app.fetch(request,env,ctx);
    res.statusCode=response.status;response.headers.forEach((value,key)=>res.setHeader(key,value));res.setHeader('cache-control','no-store');
    if(method==='HEAD'||response.status===204||!response.body)return res.end();
    Readable.fromWeb(response.body).pipe(res);
  }catch(error){
    console.error('Arena Line exact worker error',error?.stack||error);res.statusCode=500;res.setHeader('content-type','text/plain; charset=utf-8');res.end('Arena Line server error');
  }
});
server.listen(port,'0.0.0.0',()=>{console.log('Arena Line exact ZIP v32 + Parik live poller listening on '+port);setTimeout(()=>loadLiveLine(true).catch(()=>{}),800);});

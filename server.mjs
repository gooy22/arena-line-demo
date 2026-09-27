import http from 'node:http';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import app from './dist/server/index.js';
import { augmentSettlements, completedHistory, probeResultsSource } from './results_bridge.mjs';
import { readProfile, loginProfile, syncProfile, profileStorageStatus, changeProfilePassword } from './profile_store.mjs';

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
const accountModule = await readFile(new URL('./overrides/account.mjs', import.meta.url), 'utf8');
const appModule = await readFile(new URL('./overrides/app.js', import.meta.url), 'utf8');
const betViewModule = await readFile(new URL('./overrides/bet-view.mjs', import.meta.url), 'utf8');
const themeCssModule = await readFile(new URL('./overrides/theme.css', import.meta.url), 'utf8');
const serviceWorkerModule = await readFile(new URL('./overrides/sw.js', import.meta.url), 'utf8');
const manifestModule = await readFile(new URL('./overrides/manifest.webmanifest', import.meta.url), 'utf8');
const uiModule = await readFile(new URL('./overrides/ui.mjs', import.meta.url), 'utf8');

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
    size += chunk.length;
    if (size > limit) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
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
  html=html.replace(/\?+v=\d+/g,'?v=58');
  if (!html.includes('apple-touch-icon')) {
    html=html.replace(
      '<link rel="manifest" href="/manifest.webmanifest">',
      '<link rel="manifest" href="/manifest.webmanifest">\n  <link rel="apple-touch-icon" href="/assets/icons/esports.png">\n  <meta name="apple-mobile-web-app-capable" content="yes">\n  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">'
    );
  }
  if (!html.includes('arena-editor-hotfix-v58')) {
    html=html.replace('</head>', `
<style id="arena-editor-hotfix-v58">
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
window.__ARENA_BUILD__='58';
if('serviceWorker' in navigator){
  navigator.serviceWorker.getRegistrations().then(rs=>rs.forEach(r=>r.update())).catch(()=>{});
}
</script>
</head>`);
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
    const fallbackImage=fallbackImages[event.categoryName] || '/assets/icons/esports.png';
    const fallbackGraphic='<img class="synced-discipline-logo local-fallback-logo" src="' + fallbackImage + '" alt="">';

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
window.__arenaRememberLogo = window.__arenaRememberLogo || function(img,src,source) {
  if(!img || !src) return;
  const key=window.__arenaEntityKey(img);
  if(key) window.__arenaEntityLogoCache.set(key,{src:String(src),source:String(source || '')});
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
    ? row.keys.size >= 2
    : kind === 'tournament'
      ? row.keys.size >= 3 && row.categories.size >= 2
      : false;
  if(!generic && !window.__arenaGenericFingerprints.has(fingerprint)) return true;
  window.__arenaGenericFingerprints.add(fingerprint);
  for(const badSource of row.sources){
    window.__arenaFailedLogoSources.add(badSource);
    window.__arenaLogoCache.delete(badSource);
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
    img.hidden=false;
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
    window.__arenaFailedLogoSources.add(source);
    window.__arenaLogoCache.delete(source);
  }
  if(window.__arenaNextLogo(img)) return true;
  img.hidden=true;
  if(img.nextElementSibling) img.nextElementSibling.hidden=false;
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
    img.hidden=false;
    if(img.nextElementSibling) img.nextElementSibling.hidden=true;
    if(img.src !== entity.src) img.src=entity.src;
    return;
  }
  const source=String(img.dataset.arenaSource || '');
  const cached=window.__arenaLogoCache.get(source);
  if(cached){
    img.dataset.arenaNormalized='1';
    img.hidden=false;
    if(img.nextElementSibling) img.nextElementSibling.hidden=true;
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
      img.hidden=false;
      if(img.nextElementSibling) img.nextElementSibling.hidden=true;
      if(img.src !== entity.src) img.src=entity.src;
      return;
    }
    const cached = window.__arenaLogoCache.get(original);
    if (cached) {
      img.dataset.arenaNormalized = '1';
      img.hidden=false;
      if(img.nextElementSibling) img.nextElementSibling.hidden=true;
      window.__arenaRememberLogo(img,cached,original);
      if (img.src !== cached) img.src = cached;
      return;
    }
    if (img.dataset.arenaNormalized === '1') return;
    if (!img.naturalWidth || !img.naturalHeight) return;

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
      img.hidden=false;
      if(img.nextElementSibling) img.nextElementSibling.hidden=true;
      if (img.src !== data) img.src=data;
    } catch (error) {
      img.dataset.arenaNormalizeError='1';
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
  return (source.includes('__arenaNormalizeLogo') ? '' : normalizer) + source.replace(oldBlock,newBlock);
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
  return map[category] || '/assets/icons/esports.png';
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
  warming:new Set(),
  queued:new Set(),
  queue:[],
  active:0,
  exactQueue:[],
  exactQueued:new Set(),
  exactActive:0
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


async function exactBo3Rows(kind,name,category) {
  const discipline=disciplineIds[category] || null;
  const table=kind;
  const nameField=kind === 'players' ? 'nickname' : 'name';
  for(const op of ['eq','ilike']){
    const qs=new URLSearchParams({'page[limit]':'30'});
    qs.set(`filter[${table}.${nameField}][${op}]`,name);
    if(discipline) qs.set(`filter[${table}.discipline_id][eq]`,String(discipline));
    try{
      const response=await fetch(`https://api.bo3.gg/api/v1/${kind}?${qs}`,{
        signal:AbortSignal.timeout(4500),
        headers:{accept:'application/json'}
      });
      if(!response.ok) continue;
      const data=await response.json();
      const rows=Array.isArray(data?.results) ? data.results : [];
      if(rows.length) return rows;
    }catch{}
  }
  return [];
}

async function resolveExactMediaTask(task) {
  const {kind,id,name,category}=task;
  if(!id || !name) return;

  if(kind === 'tournament'){
    const rows=await exactBo3Rows('tournaments',mediaName(name),category);
    const logo=bestCatalogLogo(name,rows,['name','slug']);
    if(logo) backgroundMedia.tournaments.set(String(id),logo);
    console.log('MEDIA_EXACT '+JSON.stringify({kind,id,name,category,found:!!logo}));
    return;
  }

  const kinds=category === 'Dota 2' ? ['players','teams'] : ['teams','players'];
  let logo='';
  for(const candidateKind of kinds){
    const rows=await exactBo3Rows(candidateKind,name,category);
    logo=bestCatalogLogo(name,rows,['nickname','name','slug']);
    if(logo) break;
  }
  if(logo) backgroundMedia.competitors.set(String(id),logo);
  console.log('MEDIA_EXACT '+JSON.stringify({kind,id,name,category,found:!!logo}));
}

function queueExactMedia(task) {
  const key=task.kind+':'+String(task.id || '');
  if(!task.id || !task.name || backgroundMedia.exactQueued.has(key)) return;
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

function cachedCompetitorLogo(id) {
  return backgroundMedia.competitors.get(String(id || '')) || '';
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

function sendRemoteImage(res,response) {
  res.statusCode=200;
  res.setHeader('content-type',response.headers.get('content-type') || 'image/png');
  res.setHeader('cache-control','public, max-age=21600, stale-while-revalidate=86400');
  res.setHeader('x-content-type-options','nosniff');
  res.setHeader('x-arena-media-proxy','1');
  return Readable.fromWeb(response.body).pipe(res);
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

async function embeddedAsset(pathname,method,headers) {
  const request = new Request('http://localhost' + pathname,{method,headers});
  return app.fetch(request,env,ctx);
}

async function mergedSettlements(bodyBuffer, req) {
  const payload=JSON.parse(bodyBuffer.toString('utf8') || '{}');
  const events=Array.isArray(payload.events) ? payload.events : [];
  if (!events.length || events.length > 30) return {status:400,body:{error:'Invalid events'}};

  let base={results:[],unavailable:[],pending:events.map(e=>String(e.eventId||e.id||''))};
  try {
    const request=new Request('http://localhost/api/settlements',{
      method:'POST',
      headers:req.headers,
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

const server=http.createServer(async (req,res)=>{
  try {
    const method=req.method || 'GET';
    const url=new URL(req.url || '/','http://localhost');

    if (url.pathname === '/api/media/team' && method === 'GET') {
      const id=safeString(url.searchParams.get('id'),32);
      const prefer=safeString(url.searchParams.get('prefer') || 'parik',20);
      const exactSource=safeParikMediaURL(url.searchParams.get('source'));
      if(!/^\\d{1,16}$/.test(id)) return json(res,400,{ok:false,error:'Invalid competitor id'});

      if(prefer === 'bo3'){
        const cached=cachedCompetitorLogo(id);
        if(!cached){
          res.statusCode=404;
          res.setHeader('cache-control','no-store');
          return res.end();
        }
        return streamImageCandidates(res,[{url:cached,trusted:true}]);
      }

      return streamImageCandidates(res,[
        {url:exactSource},
        {url:'https://parik24.pro/taxonomyicons/competitors/'+id+'-164w'}
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

    if (url.pathname === '/health') {
      const profileStorage=await profileStorageStatus();
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
      const response=await embeddedAsset(url.pathname === '/' ? '/' : '/index.html',method,req.headers);
      if (!response.ok) { res.statusCode=response.status; return res.end(); }
      const source=method === 'HEAD' ? '' : await response.text();
      return textResponse(res,method,'text/html; charset=utf-8',patchIndexHtml(source),'no-store');
    }

    if (url.pathname === '/feed.mjs' && ['GET','HEAD'].includes(method)) return js(res,method,feedModule);
    if (url.pathname === '/team-emblem.mjs' && ['GET','HEAD'].includes(method)) return js(res,method,emblemModule);
    if (url.pathname === '/ui.mjs' && ['GET','HEAD'].includes(method)) return js(res,method,uiModule);
    if (url.pathname === '/account.mjs' && ['GET','HEAD'].includes(method)) return js(res,method,accountModule);
    if (url.pathname === '/app.js' && ['GET','HEAD'].includes(method)) return js(res,method,appModule);
    if (url.pathname === '/bet-view.mjs' && ['GET','HEAD'].includes(method)) return js(res,method,betViewModule);
    if (url.pathname === '/theme.css' && ['GET','HEAD'].includes(method)) return css(res,method,themeCssModule);
    if (url.pathname === '/sw.js' && ['GET','HEAD'].includes(method)) {
      res.setHeader('service-worker-allowed','/');
      return js(res,method,serviceWorkerModule,'no-cache, no-store, must-revalidate');
    }
    if (url.pathname === '/manifest.webmanifest' && ['GET','HEAD'].includes(method)) {
      return textResponse(res,method,'application/manifest+json; charset=utf-8',manifestModule);
    }

    if (url.pathname === '/sports.mjs' && ['GET','HEAD'].includes(method)) {
      const response=await embeddedAsset('/sports.mjs',method,req.headers);
      if (!response.ok) { res.statusCode=response.status; return res.end(); }
      const source=method === 'HEAD' ? '' : await response.text();
      return js(res,method,patchSportsModule(source));
    }

    if (url.pathname === '/sports.css' && ['GET','HEAD'].includes(method)) {
      const response=await embeddedAsset('/sports.css',method,req.headers);
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
      const stored=await readProfile(email);
      if (!stored) return json(res,404,{ok:false,error:'Profile not found'});
      const profile=await loginProfile(email,hash);
      if (!profile) return json(res,401,{ok:false,error:'Invalid credentials'});
      return json(res,200,{ok:true,profile});
    }

    if (url.pathname === '/api/profile') {
      if (method !== 'GET') return json(res,405,{ok:false,error:'Method not allowed'});
      const email=safeString(url.searchParams.get('email'),200).trim().toLowerCase();
      const hash=bearer(req);
      if (!email || !/^[a-f0-9]{64}$/i.test(hash)) return json(res,401,{ok:false,error:'Unauthorized'});
      const stored=await readProfile(email);
      if (!stored) return json(res,404,{ok:false,error:'Profile not found'});
      const profile=await loginProfile(email,hash);
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
        const profile=await changeProfilePassword(email,oldHash,newHash);
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
        const profile=await syncProfile(body.profile,hash);
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
      console.log('FEED_TELEMETRY '+JSON.stringify(telemetry));
      return json(res,200,{ok:true});
    }

    if (url.pathname === '/api/sync/events') {
      if (method !== 'POST') return json(res,405,{ok:false,error:'Method not allowed'});
      const body=await readBody(req,1_500_000);
      const value=JSON.parse(body.toString('utf8') || '{}');
      if (!Array.isArray(value.rows) || value.rows.length > 250) return json(res,400,{ok:false,error:'Invalid rows'});
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
      const merged=await mergedSettlements(body,req);
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
      headers:req.headers,
      ...(body ? {body} : {})
    });
    const response=await app.fetch(request,env,ctx);
    res.statusCode=response.status;
    response.headers.forEach((value,key)=>res.setHeader(key,value));
    res.setHeader('cache-control',runtimeCacheControl(url.pathname));
    if (method === 'HEAD' || response.status === 204 || !response.body) return res.end();
    Readable.fromWeb(response.body).pipe(res);
  } catch(error) {
    console.error('Arena Line runtime error',error?.stack || error);
    return json(res,500,{ok:false,error:'Arena Line server error'});
  }
});

server.listen(port,'0.0.0.0',()=>{
  console.log('Arena Line Parik sync v4 listening on '+port);
  profileStorageStatus().then(status=>{
    console.log('PROFILE_STORAGE '+JSON.stringify(status));
  }).catch(error=>{
    console.error('PROFILE_STORAGE_ERROR '+String(error?.message || error));
  });
  probeResultsSource().then(status=>{
    resultsSource={...status,error:null};
    console.log('RESULTS_SOURCE_OK '+JSON.stringify(resultsSource));
  }).catch(error=>{
    resultsSource={ok:false,error:String(error?.message || error),disciplines:[]};
    console.error('RESULTS_SOURCE_ERROR '+JSON.stringify(resultsSource));
  });
});

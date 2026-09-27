import { icon } from './ui.mjs';
import { amount } from './bet-view.mjs';
import { t, getLocale } from './i18n.mjs';

const date = value => new Date(value).toLocaleString(getLocale(), {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
const games = { CSGO:'counter-strike', CS:'counter-strike', DOTA2:'dota', LOL:'lol', F:'football', T:'tennis', TT:'table-tennis', H:'hockey', B:'basketball', VB:'volleyball', PL:'snooker' };
const imageCache = new Map();
const ESPORTS_CONTROLLER_DATA='data:image/png;base64,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';
const isEsportsSelection = selection => selection?.sport === 'CS' || ['CSGO','DOTA2','LOL'].includes(selection?.subsport);

function totalOdds(bet) {
  const value = Number(bet?.odds);
  if (!Number.isFinite(value)) return '';
  return value.toFixed(4).replace(/0+$/,'').replace(/\.$/,'');
}

function expressEventsLabel(count) {
  const locale=String(getLocale()||'').toLowerCase();
  if(locale.startsWith('en')) return count === 1 ? 'event' : 'events';
  const mod10=count%10, mod100=count%100;
  if(locale.startsWith('ru')) {
    if(mod10===1 && mod100!==11) return 'событие';
    if(mod10>=2 && mod10<=4 && (mod100<12 || mod100>14)) return 'события';
    return 'событий';
  }
  if(mod10===1 && mod100!==11) return 'подія';
  if(mod10>=2 && mod10<=4 && (mod100<12 || mod100>14)) return 'події';
  return 'подій';
}

function couponTypeLabel(bet) {
  if(bet?.type !== 'express') return t(({single:'Ординар',system:'Система'})[bet?.type] || 'Ординар');
  const count=Array.isArray(bet?.selections) ? bet.selections.length : 0;
  return `${t('Експрес')}, ${count} ${expressEventsLabel(count)}`;
}

function sportImage(selection) {
  const name = isEsportsSelection(selection) ? 'esports' : games[selection.sport] || 'esports';
  if (!imageCache.has(name)) imageCache.set(name, new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = name === 'esports' ? ESPORTS_CONTROLLER_DATA : `/assets/icons/${name}.png`;
  }));
  return imageCache.get(name);
}

export function couponData(bet, showAmount) {
  const status = bet.status;
  const payoutLabel=t(status === 'open' ? 'Можлива виплата' : status === 'cashout' ? 'Виведено' : 'Виплата');
  return {
    date:date(bet.date),
    type:couponTypeLabel(bet),
    rows:bet.selections.map(selection => ({
      title:`${t(selection.marketName)} ${t(selection.label)}`,
      detail:`${date(selection.startTime ? selection.startTime * 1000 : bet.date)} ${selection.eventName}`,
      odds:String(Number(selection.odds.toFixed(2))),
      status:selection.settlement?.status,
      selection,
    })),
    showAmount,
    stakeLabel:showAmount ? t('Сума ставки') : t('Коефіцієнт'),
    stake:showAmount ? amount(bet.cost) : totalOdds(bet),
    payout:showAmount ? amount(status === 'open' ? bet.potential : bet.payout) : '',
    payoutLabel:showAmount ? payoutLabel : '',
    status,
  };
}

function drawContained(context,image,x,y,box=22,cropRatio=0) {
  const iw=Number(image?.naturalWidth || image?.width || 0), ih=Number(image?.naturalHeight || image?.height || 0);
  if(!iw || !ih) return;
  const sx=iw*cropRatio, sy=ih*cropRatio;
  const sw=iw-(sx*2), sh=ih-(sy*2);
  const scale=Math.min(box/sw,box/sh);
  const w=sw*scale,h=sh*scale;
  context.drawImage(image,sx,sy,sw,sh,x+(box-w)/2,y+(box-h)/2,w,h);
}


async function drawLegacyCoupon(canvas, bet, showAmount) {
  await document.fonts?.ready;
  const model = couponData(bet,showAmount), images = await Promise.all(model.rows.map(row => sportImage(row.selection)));
  const width = 358, scale = 3, context = canvas.getContext('2d');
  if (!context) throw new Error('Не вдалося створити зображення');
  const font = (size, weight = 400) => { context.font = `${weight} ${size}px Roboto, sans-serif`; };
  const wrap = (text, maxWidth) => {
    const lines = []; let current = '';
    for (const word of String(text).split(/\s+/)) {
      if (context.measureText(current ? `${current} ${word}` : word).width <= maxWidth) { current += `${current ? ' ' : ''}${word}`; continue; }
      if (current) lines.push(current); current = '';
      for (const char of word) {
        if (current && context.measureText(current+char).width > maxWidth) { lines.push(current); current = ''; }
        current += char;
      }
    }
    if (current) lines.push(current);
    return lines;
  };
  const rows = model.rows.map(row => {
    font(12.5); const title = wrap(row.title, row.status ? 229 : 246);
    font(10); const detail = wrap(row.detail, row.status ? 229 : 246);
    return {...row,title,detail,height:Math.max(52,16*title.length+13*detail.length+16)};
  });
  const totalsHeight=model.showAmount ? 64 : 40;
  const height = 40 + rows.reduce((total,row)=>total+row.height,0) + totalsHeight;
  canvas.width = width*scale; canvas.height = height*scale;
  context.scale(scale,scale); context.fillStyle='#e2dfd9'; context.fillRect(0,0,width,height);
  const text = (value,x,y,color='#292621',size=14,align='left',weight=400) => {
    font(size,weight); context.textAlign=align; context.fillStyle=color; context.fillText(value,x,y);
  };
  const rule = y => { context.strokeStyle='#d0cdc7'; context.lineWidth=1; context.beginPath(); context.moveTo(0,y); context.lineTo(width,y); context.stroke(); };
  text(model.date,16,27,'#7b756b',11); text(model.type,width-16,27,'#7b756b',11,'right'); rule(40);
  let y=40;
  rows.forEach((row,index) => {
    if (images[index]) {
      const esports=isEsportsSelection(row.selection);
      drawContained(context,images[index],17,y+(row.height-22)/2,esports ? 20 : 21,0);
    }
    row.title.forEach((line,i)=>text(line,52,y+21+i*16,'#292621',12.5));
    row.detail.forEach((line,i)=>text(line,52,y+21+row.title.length*16+i*13,'#7b756b',10));
    const color = row.status==='won' ? '#009e69' : row.status==='lost' ? '#e6253a' : '#292621';
    text(row.odds,width-(row.status?34:16),y+row.height/2+4,color,14,'right');
    if (row.status) {
      const x=width-19, cy=y+row.height/2;
      context.beginPath(); context.arc(x,cy,6.5,0,Math.PI*2); context.fillStyle=row.status==='void'?'#969186':color; context.fill();
      context.strokeStyle='#fff'; context.lineWidth=1.5; context.lineCap='round'; context.beginPath();
      if (row.status==='won') {context.moveTo(x-3,cy);context.lineTo(x-1,cy+2);context.lineTo(x+3,cy-2);}
      else if(row.status==='lost') {context.moveTo(x-2,cy-2);context.lineTo(x+2,cy+2);context.moveTo(x+2,cy-2);context.lineTo(x-2,cy+2);}
      else {context.moveTo(x-3,cy);context.lineTo(x+3,cy);}
      context.stroke();
    }
    y+=row.height; rule(y);
  });
  text(model.stakeLabel,16,y+24,'#292621',12.5); text(model.stake,width-16,y+24,'#292621',12.5,'right');
  if(model.showAmount){
    const paid = (model.status==='won' || model.status==='cashout') ? '#009e69' : '#292621';
    text(model.payoutLabel,16,y+48,paid,12.5); text(model.payout,width-16,y+48,paid,12.5,'right');
  }
  context.globalCompositeOperation='destination-out';
  for(let x=0;x<=width+7;x+=width/13) for(const edge of [0,height]) {context.beginPath();context.arc(x,edge,7,0,Math.PI*2);context.fill();}
  context.globalCompositeOperation='source-over';
  const tail=model.showAmount ? ` ${model.stakeLabel}: ${model.stake}. ${model.payoutLabel}: ${model.payout}` : ` ${model.stakeLabel}: ${model.stake}`;
  canvas.setAttribute('aria-label',`${model.type}. ${model.rows.map(row=>row.title).join('. ')}.${tail}`);
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Не вдалося зберегти купон')),'image/png'));
}

export async function drawCoupon(canvas, bet, showAmount) {
  if (bet?.type === 'express' && bet?.status === 'open') return drawLegacyCoupon(canvas,bet,showAmount);
  await document.fonts?.ready;
  const model = couponData(bet,showAmount), images = await Promise.all(model.rows.map(row => sportImage(row.selection)));
  const width = 361, scale = 3, context = canvas.getContext('2d');
  if (!context) throw new Error('Не вдалося створити зображення');
  const font = (size, weight = 400) => { context.font = `${weight} ${size}px Roboto, sans-serif`; };
  const wrap = (text, maxWidth) => {
    const lines = []; let current = '';
    for (const word of String(text).split(/\s+/)) {
      if (context.measureText(current ? `${current} ${word}` : word).width <= maxWidth) { current += `${current ? ' ' : ''}${word}`; continue; }
      if (current) lines.push(current); current = '';
      for (const char of word) {
        if (current && context.measureText(current+char).width > maxWidth) { lines.push(current); current = ''; }
        current += char;
      }
    }
    if (current) lines.push(current);
    return lines;
  };
  const rows = model.rows.map(row => {
    font(16); const title = wrap(row.title, row.status ? 224 : 242);
    font(12); const detail = wrap(row.detail, row.status ? 224 : 242);
    return {...row,title,detail,height:Math.max(54,19*title.length+15*detail.length+15)};
  });
  const totalsHeight=model.showAmount ? 74 : 44;
  const height = 44 + rows.reduce((total,row)=>total+row.height,0) + totalsHeight;
  canvas.width = width*scale; canvas.height = height*scale;
  context.scale(scale,scale); context.fillStyle='#e4e3df'; context.fillRect(0,0,width,height);
  const text = (value,x,y,color='#292621',size=14,align='left',weight=400) => {
    font(size,weight); context.textAlign=align; context.fillStyle=color; context.fillText(value,x,y);
  };
  const rule = y => { context.strokeStyle='#d2d1cd'; context.lineWidth=1; context.beginPath(); context.moveTo(0,y); context.lineTo(width,y); context.stroke(); };
  text(model.date,16,29,'#7b756b',13); text(model.type,width-16,29,'#7b756b',13,'right'); rule(44);
  let y=44;
  rows.forEach((row,index) => {
    if (images[index]) {
      const esports=isEsportsSelection(row.selection);
      drawContained(context,images[index],17,y+(row.height-22)/2,esports ? 21 : 22,0);
    }
    row.title.forEach((line,i)=>text(line,56,y+22+i*19,'#292621',16));
    row.detail.forEach((line,i)=>text(line,56,y+22+row.title.length*19+i*15,'#7b756b',12));
    const color = row.status==='won' ? '#009e69' : row.status==='lost' ? '#e6253a' : '#292621';
    text(row.odds,width-(row.status?36:16),y+row.height/2+6,color,18,'right');
    if (row.status) {
      const x=width-19, cy=y+row.height/2;
      context.beginPath(); context.arc(x,cy,9,0,Math.PI*2); context.fillStyle=row.status==='void'?'#969186':color; context.fill();
      context.strokeStyle='#fff'; context.lineWidth=1.8; context.lineCap='round'; context.beginPath();
      if (row.status==='won') {context.moveTo(x-4,cy);context.lineTo(x-1,cy+3);context.lineTo(x+4,cy-3);}
      else if(row.status==='lost') {context.moveTo(x-3,cy-3);context.lineTo(x+3,cy+3);context.moveTo(x+3,cy-3);context.lineTo(x-3,cy+3);}
      else {context.moveTo(x-4,cy);context.lineTo(x+4,cy);}
      context.stroke();
    }
    y+=row.height; rule(y);
  });
  text(model.stakeLabel,16,y+29,'#292621',15); text(model.stake,width-16,y+29,'#292621',15,'right');
  if(model.showAmount){
    const paid = (model.status==='won' || model.status==='cashout') ? '#009e69' : '#292621';
    text(model.payoutLabel,16,y+59,paid,15); text(model.payout,width-16,y+59,paid,15,'right');
  }
  context.globalCompositeOperation='destination-out';
  for(let x=0;x<=width+7;x+=width/13) for(const edge of [0,height]) {context.beginPath();context.arc(x,edge,7,0,Math.PI*2);context.fill();}
  context.globalCompositeOperation='source-over';
  const tail=model.showAmount ? ` ${model.stakeLabel}: ${model.stake}. ${model.payoutLabel}: ${model.payout}` : ` ${model.stakeLabel}: ${model.stake}`;
  canvas.setAttribute('aria-label',`${model.type}. ${model.rows.map(row=>row.title).join('. ')}.${tail}`);
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Не вдалося зберегти купон')),'image/png'));
}


const htmlEsc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

function openExpressSport(selection){
  const name=isEsportsSelection(selection) ? 'esports' : games[selection?.sport] || 'esports';
  const src=name==='esports' ? ESPORTS_CONTROLLER_DATA : `/assets/icons/${name}.png`;
  return `<img class="express-share-sport-image" src="${src}" alt="">`;
}

function expressShareSelection(selection,bet){
  const result=selection?.settlement;
  const state=result?.status || '';
  const hasResult=Boolean(state);
  const stateIcon=state==='won' ? 'check' : state==='lost' ? 'x' : state==='void' ? 'undo-2' : 'clock-3';
  const teams=selection?.competitors?.length
    ? selection.competitors
    : String(selection?.eventName||'').split(' - ').map(name=>({name}));
  const score=Array.isArray(result?.score) ? result.score : null;
  const rawPeriods=Array.isArray(result?.periods) ? result.periods : [];
  const duplicateManualPeriod=result?.manual && rawPeriods.length===1 && score &&
    Array.isArray(rawPeriods[0]) && Number(rawPeriods[0][0])===Number(score[0]) && Number(rawPeriods[0][1])===Number(score[1]);
  const periods=duplicateManualPeriod ? [] : rawPeriods;
  const detailDate=date(selection?.startTime ? selection.startTime*1000 : bet.date).toUpperCase();
  const leading=hasResult
    ? `<span class="express-share-result result-${htmlEsc(state)}">${icon(stateIcon)}</span>`
    : `<span class="express-share-sport">${openExpressSport(selection)}</span>`;
  return `<section class="express-share-selection">
    <div class="express-share-summary">
      ${leading}
      <span class="express-share-pick">
        <small>${htmlEsc(t(selection?.marketName||''))}</small>
        <strong>${htmlEsc(t(selection?.label||''))}</strong>
      </span>
      <span class="express-share-odds">${htmlEsc(Number(selection?.odds||0).toFixed(2).replace(/0+$/,'').replace(/\.$/,''))}</span>
      ${icon('chevron-right','express-share-chevron')}
    </div>
    <div class="express-share-event-date">${htmlEsc(detailDate)}</div>
    <div class="express-share-teams">
      ${teams.map((team,i)=>`<div><span>${htmlEsc(team?.name||'')}</span>${score ? `<span class="express-share-team-score">${periods.map(period=>`<small>${htmlEsc(period[i] ?? '')}</small>`).join('')}<b>${htmlEsc(score[i] ?? '')}</b></span>` : ''}</div>`).join('')}
    </div>
  </section>`;
}

function ensureOpenExpressShareStyle(){
  if(document.getElementById('open-express-share-style')) return;
  const style=document.createElement('style');
  style.id='open-express-share-style';
  style.textContent=`
html.share-open-express-screen,body.share-open-express-screen{background:#171717!important}
body.share-open-express-screen::before{content:none!important}
html.share-open-express-screen dialog.share-open-express-reference,body.share-open-express-screen dialog.share-open-express-reference{position:fixed!important;inset:env(safe-area-inset-top) 0 0 0!important;width:100vw!important;max-width:100vw!important;height:auto!important;min-height:0!important;max-height:none!important;margin:0!important;padding:0!important;border:0!important;border-radius:0!important;background:#fff!important;overflow:hidden!important;box-shadow:none!important}
html.share-open-express-screen dialog.share-open-express-reference::backdrop{background:#171717!important}
.share-open-express-reference .express-share-screen{width:100%!important;max-width:393px!important;height:100%!important;min-height:100%!important;margin:0 auto!important;display:grid!important;grid-template-rows:56px 57px minmax(0,1fr) 176px!important;background:#fff!important;color:#33312e!important;font-family:Roboto,Arial,sans-serif!important}
.share-open-express-reference .express-share-appbar{height:56px!important;padding:0 12px!important;display:flex!important;align-items:center!important;justify-content:space-between!important;gap:10px!important;background:#171717!important;color:#fff!important}
.share-open-express-reference .express-share-wordmark{width:114px!important;height:auto!important;display:block!important;object-fit:contain!important}
.share-open-express-reference .express-share-app-actions{display:flex!important;align-items:center!important;justify-content:flex-end!important;gap:8px!important}
.share-open-express-reference .express-share-app-icon{width:25px!important;height:34px!important;display:grid!important;place-items:center!important;position:relative!important;color:#aaa69e!important}
.share-open-express-reference .express-share-app-icon svg{width:23px!important;height:23px!important}
.share-open-express-reference .express-share-app-icon b{position:absolute!important;top:1px!important;right:-5px!important;min-width:15px!important;height:15px!important;padding:0 3px!important;border-radius:10px!important;display:flex!important;align-items:center!important;justify-content:center!important;background:#e3273a!important;color:#fff!important;font-size:9px!important;line-height:15px!important}
.share-open-express-reference .express-share-topup{height:34px!important;padding:0 14px!important;border-radius:22px!important;display:flex!important;align-items:center!important;background:#08a878!important;color:#fff!important;font-size:14px!important;white-space:nowrap!important}
.share-open-express-reference .express-share-titlebar{height:57px!important;display:grid!important;grid-template-columns:42px 1fr 42px!important;align-items:center!important;border-bottom:1px solid #e5e3df!important;background:#fff!important}
.share-open-express-reference .express-share-back{width:42px!important;height:57px!important;padding:0!important;border:0!important;background:transparent!important;color:#8b877f!important;display:grid!important;place-items:center!important}
.share-open-express-reference .express-share-back svg{width:24px!important;height:24px!important}
.share-open-express-reference .express-share-titlebar>div{grid-column:2!important;text-align:center!important;display:flex!important;flex-direction:column!important;align-items:center!important}
.share-open-express-reference .express-share-titlebar strong{font-size:17px!important;line-height:21px!important;font-weight:600!important}
.share-open-express-reference .express-share-titlebar span{font-size:15px!important;line-height:19px!important;color:#7d7972!important}
.share-open-express-reference .express-share-content{min-height:0!important;overflow-y:auto!important;display:flex!important;flex-direction:column!important;background:#fff!important;scrollbar-width:none!important}
.share-open-express-reference .express-share-content::-webkit-scrollbar{display:none!important}
.share-open-express-reference .express-share-selection{padding:13px 12px 20px!important;border-bottom:1px solid #e7e5e1!important;background:#fff!important}
.share-open-express-reference .express-share-summary{min-height:56px!important;padding:9px 12px!important;border-radius:13px!important;background:#f3f1ed!important;display:grid!important;grid-template-columns:26px minmax(0,1fr) auto 18px!important;align-items:center!important;gap:9px!important}
.share-open-express-reference .express-share-sport,.share-open-express-reference .express-share-result{width:22px!important;height:22px!important;display:grid!important;place-items:center!important}
.share-open-express-reference .express-share-result{border-radius:50%!important;background:#08a878!important;color:#fff!important}
.share-open-express-reference .express-share-result.result-lost{background:#e6253a!important}
.share-open-express-reference .express-share-result svg{width:14px!important;height:14px!important}
.share-open-express-reference .express-share-sport-image{width:22px!important;height:22px!important;display:block!important;object-fit:contain!important;background:transparent!important}
.share-open-express-reference .express-share-pick{min-width:0!important;display:flex!important;flex-direction:column!important}
.share-open-express-reference .express-share-pick small{font-size:12px!important;line-height:15px!important;color:#837e75!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
.share-open-express-reference .express-share-pick strong{font-size:16px!important;line-height:20px!important;font-weight:400!important;color:#37332f!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
.share-open-express-reference .express-share-odds{font-size:16px!important;line-height:20px!important;color:#37332f!important}
.share-open-express-reference .express-share-chevron{width:18px!important;height:18px!important;color:#b0ada5!important}
.share-open-express-reference .express-share-event-date{margin-top:8px!important;font-size:11px!important;line-height:14px!important;font-weight:600!important;color:#6f6b64!important}
.share-open-express-reference .express-share-teams{margin-top:7px!important;display:flex!important;flex-direction:column!important;gap:7px!important}
.share-open-express-reference .express-share-teams>div{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:12px!important;font-size:15px!important;line-height:18px!important;color:#37332f!important}
.share-open-express-reference .express-share-team-score{display:flex!important;gap:7px!important;align-items:center!important}.share-open-express-reference .express-share-team-score small{font-size:11px!important;color:#8b877e!important}.share-open-express-reference .express-share-team-score b{min-width:20px!important;text-align:right!important;font-size:14px!important;font-weight:400!important}
.share-open-express-reference .express-share-fill{flex:1 1 auto!important;min-height:110px!important}
.share-open-express-reference .express-share-footer{min-height:176px!important;padding:23px 12px max(15px,env(safe-area-inset-bottom))!important;border-top:1px solid #d9d7d3!important;background:#fff!important}
.share-open-express-reference .express-share-footer dl{margin:0!important;display:grid!important;gap:10px!important}.share-open-express-reference .express-share-footer dl>div{display:flex!important;justify-content:space-between!important;gap:16px!important;font-size:15px!important;line-height:19px!important}.share-open-express-reference .express-share-footer dt,.share-open-express-reference .express-share-footer dd{margin:0!important}
.share-open-express-reference .express-share-native{min-height:34px!important;margin-top:18px!important;padding:0 13px!important;border:0!important;border-radius:18px!important;display:inline-flex!important;align-items:center!important;gap:7px!important;width:max-content!important;background:#f3f1ed!important;color:#37332f!important;font-size:14px!important;font-weight:600!important}.share-open-express-reference .express-share-native svg{width:17px!important;height:17px!important}
`;
  document.head.append(style);
}

function openOpenExpressReference(bet,showToast){
  ensureOpenExpressShareStyle();
  let dialog=document.getElementById('share-coupon');
  if(!dialog){dialog=document.createElement('dialog');dialog.id='share-coupon';document.body.append(dialog);}
  dialog.className='share-coupon share-open-express-reference';
  dialog.setAttribute('aria-label',t('Поділитися ставкою'));
  dialog.innerHTML=`<div class="express-share-screen">
    <header class="express-share-appbar">
      <img src="/assets/wordmark.png" class="express-share-wordmark" alt="PARIK24">
      <div class="express-share-app-actions">
        <span class="express-share-app-icon">${icon('message-square')}<b>99+</b></span>
        <span class="express-share-app-icon">${icon('search')}</span>
        <span class="express-share-app-icon">${icon('bell')}<b>6</b></span>
        <span class="express-share-topup">${htmlEsc(t('Поповнити'))}</span>
      </div>
    </header>
    <div class="express-share-titlebar">
      <button class="express-share-back" aria-label="${htmlEsc(t('Назад'))}">${icon('chevron-left')}</button>
      <div>
        <strong>${htmlEsc(t('Експрес'))} №${htmlEsc(bet.number||'')}</strong>
        <span>${htmlEsc(date(bet.date))}</span>
      </div>
    </div>
    <main class="express-share-content">
      <div class="express-share-selections">${(bet.selections||[]).map(selection=>expressShareSelection(selection,bet)).join('')}</div>
      <div class="express-share-fill"></div>
    </main>
    <footer class="express-share-footer">
      <dl>
        <div><dt>${htmlEsc(t('Сума ставки'))}</dt><dd>${htmlEsc(amount(bet.cost))}</dd></div>
        <div><dt>${htmlEsc(t('Загальний коефіцієнт'))}</dt><dd>${htmlEsc(totalOdds(bet))}</dd></div>
        <div><dt>${htmlEsc(t('Можлива виплата'))}</dt><dd>${htmlEsc(amount(bet.potential||0))}</dd></div>
      </dl>
      <button class="express-share-native">${icon('share-2')}${htmlEsc(t('Поділитися'))}</button>
    </footer>
  </div>`;

  const cleanup=()=>{
    document.documentElement.classList.remove('share-coupon-open','share-open-express-screen');
    document.body.classList.remove('share-coupon-open','share-open-express-screen');
    dialog.classList.remove('share-open-express-reference');
  };
  dialog.querySelector('.express-share-back').onclick=()=>dialog.close();
  dialog.addEventListener('close',cleanup,{once:true});
  dialog.querySelector('.express-share-native').onclick=async()=>{
    try{
      if(navigator.share) await navigator.share({title:`${t('Експрес')} №${bet.number||''}`});
      else showToast(t('Поділитися'));
    }catch(problem){
      if(problem?.name!=='AbortError') showToast('Не вдалося поділитися');
    }
  };
  document.documentElement.classList.add('share-coupon-open','share-open-express-screen');
  document.body.classList.add('share-coupon-open','share-open-express-screen');
  if(!dialog.open) dialog.showModal();
  window.lucide?.createIcons();
}

export function openShareCoupon(bet, showToast) {
  if (bet?.type === 'express' && bet?.status === 'open') return openOpenExpressReference(bet,showToast);
  let dialog=document.getElementById('share-coupon');
  if (!dialog) {dialog=document.createElement('dialog');dialog.id='share-coupon';dialog.className='share-coupon';document.body.append(dialog);}
  const legacyOpenExpress = false;
  dialog.classList.toggle('share-open-express-legacy',legacyOpenExpress);
  dialog.setAttribute('aria-label',t('Поділитися ставкою'));
  dialog.innerHTML=`<button class="share-close" aria-label="Закрити">${icon('x')}</button><div class="share-layout"><div class="share-spacer"></div><div class="share-ticket"><canvas role="img"></canvas><p class="share-error" role="status">Готуємо купон…</p></div><label class="share-amount"><span>${t('Показати суму ставки:')}</span><input type="checkbox" role="switch" checked aria-label="${t('Показати суму ставки:')}"><span class="share-switch" aria-hidden="true"></span></label><div class="share-actions">${bet.status==='open'?`<button class="share-send" disabled><span>${icon('share')}</span>${t('Поділитися')}<br>${t('ставкою')}</button>`:''}<button class="share-save" disabled><span>${icon('images')}</span>${t('Зберегти')}<br>${t('зображення')}</button></div></div>`;
  let file=null, revision=0;
  const controls=dialog.querySelectorAll('.share-actions button'), error=dialog.querySelector('.share-error');
  async function render() {
    const current=++revision; file=null; controls.forEach(button=>button.disabled=true);
    try {
      const canvas=document.createElement('canvas');
      const blob=await drawCoupon(canvas,bet,dialog.querySelector('input').checked);
      if(current!==revision || !dialog.open) return;
      dialog.querySelector('canvas').replaceWith(canvas); canvas.setAttribute('role','img'); error.hidden=true;
      file=new File([blob],`arena-line-coupon-${String(bet.number||bet.id).replace(/[^a-zA-Z0-9_-]/g,'')}.png`,{type:'image/png'});
      controls.forEach(button=>button.disabled=false);
    } catch(problem) {if(current===revision){error.textContent=problem.message;error.hidden=false;}}
  }
  function save() {
    if(!file)return;
    const url=URL.createObjectURL(file), link=document.createElement('a');link.href=url;link.download=file.name;
    document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  const releaseShareBackdrop=()=>{
    document.documentElement.classList.remove('share-coupon-open','share-open-express-legacy');
    document.body.classList.remove('share-coupon-open','share-open-express-legacy');
    dialog.classList.remove('share-open-express-legacy');
  };
  dialog.querySelector('.share-close').onclick=()=>dialog.close();
  dialog.addEventListener('close',releaseShareBackdrop,{once:true});
  dialog.querySelector('input').onchange=render;
  dialog.querySelector('.share-save').onclick=save;
  const share=dialog.querySelector('.share-send');
  if(share)share.onclick=async()=>{
    if(!file)return;
    if(!navigator.canShare?.({files:[file]})){save();return;}
    try {await navigator.share({files:[file],title:'Купон Arena Line'});}
    catch(problem){if(problem.name!=='AbortError')showToast('Не вдалося поділитися. Купон можна зберегти зображенням.');}
  };
  document.documentElement.classList.add('share-coupon-open');
  document.body.classList.add('share-coupon-open');
  document.documentElement.classList.toggle('share-open-express-legacy',legacyOpenExpress);
  document.body.classList.toggle('share-open-express-legacy',legacyOpenExpress);
  if(!dialog.open)dialog.showModal();window.lucide?.createIcons();render();
}

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
    type:t(({single:'Ординар',express:'Експрес',system:'Система'})[bet.type] || 'Ординар'),
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

export function openShareCoupon(bet, showToast) {
  let dialog=document.getElementById('share-coupon');
  if (!dialog) {dialog=document.createElement('dialog');dialog.id='share-coupon';dialog.className='share-coupon';document.body.append(dialog);}
  const legacyOpenExpress = bet?.type === 'express' && bet?.status === 'open';
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

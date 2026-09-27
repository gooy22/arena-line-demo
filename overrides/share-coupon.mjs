import { icon } from './ui.mjs';
import { amount } from './bet-view.mjs';
import { t, getLocale } from './i18n.mjs';

const date = value => new Date(value).toLocaleString(getLocale(), {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
const games = { CSGO:'counter-strike', CS:'counter-strike', DOTA2:'dota', LOL:'lol', F:'football', T:'tennis', TT:'table-tennis', H:'hockey', B:'basketball', VB:'volleyball', PL:'snooker' };
const imageCache = new Map();

function totalOdds(bet) {
  const value = Number(bet?.odds);
  if (!Number.isFinite(value)) return '';
  return value.toFixed(4).replace(/0+$/,'').replace(/\.$/,'');
}

function sportImage(selection) {
  const name = selection.sport==='CS' || ['CSGO','DOTA2','LOL'].includes(selection.subsport) ? 'esports' : games[selection.sport] || 'esports';
  if (!imageCache.has(name)) imageCache.set(name, new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = name === 'esports' ? '/assets/icons/esports-exact-20260927.png' : `/assets/icons/${name}.png`;
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

function drawContained(context,image,x,y,box=24) {
  const iw=Number(image?.naturalWidth || image?.width || 0), ih=Number(image?.naturalHeight || image?.height || 0);
  if(!iw || !ih) return;
  const scale=Math.min(box/iw,box/ih);
  const w=iw*scale,h=ih*scale;
  context.drawImage(image,x+(box-w)/2,y+(box-h)/2,w,h);
}

export async function drawCoupon(canvas, bet, showAmount) {
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
    font(14); const title = wrap(row.title, row.status ? 223 : 240);
    font(11); const detail = wrap(row.detail, row.status ? 223 : 240);
    return {...row,title,detail,height:Math.max(58,18*title.length+14*detail.length+18)};
  });
  const totalsHeight=model.showAmount ? 72 : 44;
  const height = 44 + rows.reduce((total,row)=>total+row.height,0) + totalsHeight;
  canvas.width = width*scale; canvas.height = height*scale;
  context.scale(scale,scale); context.fillStyle='#e2dfd9'; context.fillRect(0,0,width,height);
  const text = (value,x,y,color='#292621',size=14,align='left',weight=400) => {
    font(size,weight); context.textAlign=align; context.fillStyle=color; context.fillText(value,x,y);
  };
  const rule = y => { context.strokeStyle='#d0cdc7'; context.lineWidth=1; context.beginPath(); context.moveTo(0,y); context.lineTo(width,y); context.stroke(); };
  text(model.date,16,31,'#7b756b',12); text(model.type,width-16,31,'#7b756b',12,'right'); rule(44);
  let y=44;
  rows.forEach((row,index) => {
    if (images[index]) {
      context.save();
      context.globalCompositeOperation='multiply';
      drawContained(context,images[index],16,y+(row.height-24)/2,24);
      context.restore();
    }
    row.title.forEach((line,i)=>text(line,56,y+23+i*18));
    row.detail.forEach((line,i)=>text(line,56,y+23+row.title.length*18+i*14,'#7b756b',11));
    const color = row.status==='won' ? '#009e69' : row.status==='lost' ? '#e6253a' : '#292621';
    text(row.odds,width-(row.status?36:16),y+row.height/2+5,color,16,'right');
    if (row.status) {
      const x=width-20, cy=y+row.height/2;
      context.beginPath(); context.arc(x,cy,7,0,Math.PI*2); context.fillStyle=row.status==='void'?'#969186':color; context.fill();
      context.strokeStyle='#fff'; context.lineWidth=1.5; context.lineCap='round'; context.beginPath();
      if (row.status==='won') {context.moveTo(x-3,cy);context.lineTo(x-1,cy+2);context.lineTo(x+3,cy-2);}
      else if(row.status==='lost') {context.moveTo(x-2,cy-2);context.lineTo(x+2,cy+2);context.moveTo(x+2,cy-2);context.lineTo(x-2,cy+2);}
      else {context.moveTo(x-3,cy);context.lineTo(x+3,cy);}
      context.stroke();
    }
    y+=row.height; rule(y);
  });
  text(model.stakeLabel,16,y+27); text(model.stake,width-16,y+27,'#292621',14,'right');
  if(model.showAmount){
    const paid = (model.status==='won' || model.status==='cashout') ? '#009e69' : '#292621';
    text(model.payoutLabel,16,y+53,paid); text(model.payout,width-16,y+53,paid,14,'right');
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
    document.documentElement.classList.remove('share-coupon-open');
    document.body.classList.remove('share-coupon-open');
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
  if(!dialog.open)dialog.showModal();window.lucide?.createIcons();render();
}

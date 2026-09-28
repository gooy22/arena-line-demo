import { Accounts, cents, money, betTotals } from './account.mjs';
import { SportsApp } from './sports.mjs';
import { icon, wordmark } from './ui.mjs';
import { betHistory, betDetail } from './bet-view.mjs';
import { openShareCoupon } from './share-coupon.mjs';
import { getLanguage, getLocale, setLanguage, startTranslations, t } from './i18n.mjs';
import { getTheme, setTheme, applyTheme } from './theme.mjs';

const $ = selector => document.querySelector(selector);
const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const refreshIcons = () => window.lucide?.createIcons();
const accounts = new Accounts({ getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value), removeItem: key => localStorage.removeItem(key) });
const dialog = $('#dialog');
let account = null;
let profileView = 'profile';
let betTab = 'open';
let selectedBetId = null;
let toastTimer;
let sports;

function getAccount() {
  try { return accounts.current(); }
  catch { showToast('Разрешите хранение данных сайта в браузере'); return null; }
}
function showToast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3500);
}
function syncFeedControls() {
  account = getAccount();
  sports?.updateAccount(account);
  sports?.renderSlip();
  if (account && !$('#profile-layer').hidden) renderProfile();
  refreshIcons();
}
function row(name, label, action, value = '') {
  return `<button class="row" data-action="${action}" data-value="${value}">${icon(name)}<span>${label}</span>${icon('chevron-right', 'chevron')}</button>`;
}
function empty(name, heading, copy = '') {
  return `<div class="empty">${icon(name)}<h2>${heading}</h2>${copy ? `<p>${copy}</p>` : ''}</div>`;
}
function profileHeader() {
  const titles = { personal:'Персональные данные', security:'Подтверждение аккаунта', payments:'История платежей', bets:'Мои ставки', wallet:'Баланс', menu:'Меню',settings:'Налаштування','settings-security':'Безпека','settings-notifications':'Налаштування сповіщень','settings-sport':'Налаштування спорту',feedback:'Залишити відгук',information:'Допомога та інформація',promotions:'Акції',hero:'HERO',bonuses:'Магазин бонусів',tournaments:'Турніри' };
  const title = profileView === 'bets' ? null : titles[profileView];
  $('#profile-header').innerHTML = `<div class="header-inner">${title
    ? `<button class="header-icon back" data-action="profile-view" data-value="profile" aria-label="Назад" title="Назад">${icon('chevron-left')}</button><div class="page-title">${title}</div><button class="header-icon" data-action="help" aria-label="Помощь" title="Помощь">${icon('headset')}</button>`
    : `<button class="brand" data-action="close-profile" aria-label="Главная">${wordmark}</button><div class="header-spacer"></div><button class="header-icon" data-action="profile-search" aria-label="Поиск">${icon('search')}</button><button class="header-icon" data-action="notifications" aria-label="Уведомления">${icon('bell')}</button><button class="deposit-button" data-action="deposit">Пополнить</button>`}</div>`;
}
function profileNav() {
  const items = [['house', 'Головна', 'close-profile', ''], ['sports-score', 'Спорт', 'close-profile', ''], ['ticket', 'Мої ставки', 'profile-view', 'bets'], ['casino-wheel', 'Казино', 'profile-casino', ''], ['profile-solid', `${new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 0 }).format(account.balance / 100)} €`, 'profile-view', 'profile'], ['menu', 'Меню', 'open-menu', 'menu']];
  $('#profile-nav').innerHTML = `<div class="nav-inner">${items.map(([name, label, action, value]) => `<button class="nav-item ${(profileView === value || value === 'profile' && ['personal', 'security', 'wallet', 'payments'].includes(profileView)) ? 'active' : ''}" data-action="${action}" data-value="${value}">${icon(name)}<span>${esc(label)}</span></button>`).join('')}</div>`;
}
function balancePanel() {
  return `<section class="panel"><button class="balance-main" data-action="profile-view" data-value="wallet">${icon('credit-card')}<div class="grow"><div class="meta">Баланс</div><div class="balance-value">${money(account.balance)} <small>€</small></div></div>${icon('chevron-right', 'chevron')}</button><div class="balance-actions"><button class="deposit-button" data-action="deposit">+ Пополнить счёт</button><button class="plain-action" data-action="withdraw">Вывести</button></div></section>`;
}
function mainProfile() {
  return `<section class="panel"><button class="identity" data-action="profile-view" data-value="personal"><div class="avatar">${esc(account.firstName[0]+account.lastName[0])}</div><div class="grow"><div class="meta">ID ${esc(account.id)}</div><div class="name" data-no-translate>${esc(account.firstName)} ${esc(account.lastName)}</div></div>${icon('chevron-right','chevron')}</button></section>${balancePanel()}<div class="profile-shortcuts"><button data-action="profile-view" data-value="hero"><span>🌟</span>HERO</button><button data-action="profile-view" data-value="bonuses"><span>🎁</span>Магазин бонусів</button><button data-action="profile-view" data-value="tournaments"><span>🏆</span>Турніри</button></div>${profileRows()}`;
}
function profileRows() {
  return `<div class="menu">${row('gift','Акції','profile-view','promotions')}${row('circle-user-round','Персональні дані','profile-view','personal')}${row('shield-check','Підтвердження акаунта','profile-view','security')}${row('history','Історія платежів','profile-view','payments')}${row('ticket','Мої ставки','profile-view','bets')}</div><div class="menu">${row('notebook-pen','Залишити відгук','profile-view','feedback')}</div><div class="menu">${row('settings','Налаштування','profile-view','settings')}${row('info','Допомога та інформація','profile-view','information')}</div><div class="menu logout-row">${row('log-out','Вихід','logout')}</div>`;
}
function settings() {
  return `<div class="settings-page"><div class="menu"><button class="row" data-action="language">${icon('globe')}<span>Змінити мову</span><small>${getLanguage()}</small>${icon('chevrons-up-down','chevron')}</button></div><div class="menu">${row('settings','Безпека','profile-view','settings-security')}${row('bell','Налаштування сповіщень','profile-view','settings-notifications')}${row('sports-score','Налаштування спорту','profile-view','settings-sport')}</div></div>`;
}
function openLanguage() {
  let selected=getLanguage();
  openDialog('Мова',`<div class="language-options">${[['uk','Українська'],['ru','Русский'],['en','English']].map(([value,label])=>`<label data-no-translate><span>${label}</span><input type="radio" name="language" value="${value}" ${value===selected?'checked':''}></label>`).join('')}</div><button class="submit language-save" data-action="save-language">Зберегти</button>`);
  dialog.classList.add('language-sheet');
  dialog.querySelectorAll('[name=language]').forEach(input=>input.onchange=()=>{selected=input.value;});
  dialog.querySelector('.language-save').onclick=()=>{setLanguage(selected);dialog.close();};
}
function field(label, value, end = '') {
  return `<div class="data-field"><div><div class="meta">${label}</div><div class="data-value">${esc(value)}</div></div>${end}</div>`;
}
function personal() {
  return `<div class="data-page"><h2 class="section-label">Контакты</h2><div class="data-group">${field('Номер счёта', account.id, `<button class="icon-button" data-action="copy" aria-label="Копировать номер счёта" title="Копировать">${icon('copy')}</button>`)}${field('Номер телефона', 'Не указан')}${field('E-mail', account.email)}</div><h2 class="section-label">Персональная информация</h2><div class="data-group">${field('Имя', account.firstName)}${field('Фамилия', account.lastName)}</div><h2 class="section-label">Безопасность</h2><div class="data-group">${field('Пароль', '••••••••', `<button class="icon-button" data-action="password" aria-label="Изменить пароль" title="Изменить пароль">${icon('pencil')}</button>`)}</div><div class="note">${icon('info')}<span>Данные этого профиля относятся только к Arena Line.</span></div></div>`;
}
function bets() {
  return betHistory(account, betTab, localStorage.getItem('arena-edit-bets') === 'on');
}
function payments() {
  if (!account.payments.length) return empty('history', 'Операций пока нет');
  return account.payments.map(payment => {
    const label = payment.type === 'bet-payout' ? 'Виплата за ставкою' :
      payment.type === 'bet-cashout' ? 'Cash-out' :
      payment.type === 'deposit' ? 'Пополнение' : 'Вывод';
    const positive = payment.type !== 'withdraw';
    return `<div class="payment"><div><strong>${label}</strong><div class="meta">${esc(new Date(payment.date).toLocaleString(getLocale()))}</div></div><div class="${positive ? 'positive' : ''}">${positive ? '+' : '-'}${money(payment.amount)} €</div></div>`;
  }).join('');
}
function profileMenu() {
  return profileRows();
}
function renderProfile() {
  account = getAccount();
  if (!account) { closeProfile(); openAuth(false, true); return; }
  profileHeader(); profileNav();
  const views = {
    profile: mainProfile,
    personal,
    bets,
    'bet-detail': () => betDetail(account, selectedBetId),
    payments,
    wallet: () => `${balancePanel()}${payments()}`,
    security: () => `<div class="data-page"><div class="security">${icon('shield-check')}<h2>Аккаунт создан</h2><p>Вход по почте и паролю.<br>Виртуальный счёт активен.</p></div></div>`,
    menu:profileMenu,settings,
    'settings-security':()=>`<div class="menu">${row('lock-keyhole','Змінити пароль','password')}</div>`,
    'settings-notifications':()=>`<div class="menu"><label class="row">${icon('bell')}<span>Розрахунок ставок</span><input type="checkbox" id="settlement-notifications" ${localStorage.getItem('arena-settlement-notifications')!=='off'?'checked':''}></label></div>`,
    'settings-sport':()=>`<div class="settings-page"><label>Початковий розділ<select id="default-stage"><option value="live">Лайв</option><option value="prematch" ${localStorage.getItem('arena-default-stage')==='prematch'?'selected':''}>Прематч</option></select></label><label>Сортування матчів<select id="match-sort"><option value="time">За часом</option><option value="tournament" ${localStorage.getItem('arena-match-sort')==='tournament'?'selected':''}>За турніром</option></select></label></div>`,
    feedback:()=>`<form id="feedback-form"><label for="feedback-text">Текст відгуку</label><textarea id="feedback-text" required maxlength="2000" rows="7">${esc(localStorage.getItem('arena-feedback-v1')||'')}</textarea><button class="submit" type="submit">Зберегти відгук</button></form>`,
    information:()=>`<div class="data-page"><h2>Arena Line</h2><p>Профіль синхронізується з серверною копією: баланс, платежі та історія ставок доступні після входу на іншому пристрої.</p><p>Матчі та коефіцієнти надходять із лінії. Виплата за ставкою зараховується після підтвердження результату.</p></div>`,
    promotions:()=>empty('gift','Активних бонусів немає'),hero:()=>empty('star','HERO','Для цього профілю поки немає нагород.'),bonuses:()=>empty('gift','Активних бонусів немає'),tournaments:()=>empty('trophy','Турніри','У профілі немає активних бонусних турнірів.')
  };
  const isBetDetail = profileView === 'bet-detail';
  document.documentElement.classList.toggle('bet-detail-open',isBetDetail);
  document.body.classList.toggle('bet-detail-open',isBetDetail);
  const themeMeta=document.querySelector('meta[name="theme-color"]');
  if(themeMeta && !document.body.classList.contains('share-coupon-open')){
    themeMeta.setAttribute('content',isBetDetail ? '#ffffff' : '#171716');
  }
  $('#profile-nav').hidden = isBetDetail;
  $('#profile-content').classList.toggle('history-view', profileView === 'bets');
  $('#profile-content').classList.toggle('bet-detail-view', isBetDetail);
  $('#profile-content').innerHTML = (views[profileView] || mainProfile)();
  refreshIcons();
}
function openProfile() {
  account = getAccount();
  if (!account) { openAuth(false, true); return; }
  profileView = 'profile';
  $('#betslip').close();
  $('#profile-layer').hidden = false;
  document.body.classList.add('profile-open');
  history.replaceState(null, '', '#profile');
  renderProfile();
  sports?.renderSlip();
}
function openBets() {
  openProfile();
  selectedBetId = null;
  if (!$('#profile-layer').hidden) { profileView = 'bets'; betTab = 'open'; renderProfile(); }
  sports?.results.check(true);
}
function closeProfile() {
  $('#profile-layer').hidden = true;
  document.documentElement.classList.remove('bet-detail-open');
  document.body.classList.remove('profile-open','bet-detail-open');
  const themeMeta=document.querySelector('meta[name="theme-color"]');
  if(themeMeta && !document.body.classList.contains('share-coupon-open')) themeMeta.setAttribute('content','#171716');
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  syncFeedControls();
  sports?.resizeSlip();
}
function openDialog(title, content, dialogClass = '') {
  dialog.classList.remove('language-sheet','theme-sheet','edit-bet-dialog');
  if (dialogClass) dialog.classList.add(dialogClass);
  $('#dialog-content').innerHTML = `<div class="dialog-head"><h2 id="dialog-title">${title}</h2><button class="icon-button" type="button" data-action="close-dialog" aria-label="Закрыть" title="Закрыть">${icon('x')}</button></div>${content}`;
  if (!dialog.open) dialog.showModal();
  refreshIcons();
}

function openEditBet(id) {
  account = getAccount();
  const bet = account?.bets.find(item => item.id === id);
  if (!bet) { showToast('Ставка не знайдена'); return; }

  const selections = bet.selections || [];
  const status = ['open','won','lost','void','cashout'].includes(bet.status) ? bet.status : 'open';
  const editBetDateValue = (() => {
    const date = new Date(bet.date || Date.now());
    if (!Number.isFinite(date.getTime())) return '';
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0,16);
  })();

  const parseExactScore = value => {
    const match = String(value || '').match(/(?:^|\s)(\d{1,2})\s*[:\-]\s*(\d{1,2})(?:$|\s)/);
    return match ? [Number(match[1]),Number(match[2])] : null;
  };

  const scorePresets = selection => {
    const labelScore = parseExactScore(selection.label);
    const text = (String(selection.marketName || '') + ' ' + String(selection.label || '')).toLowerCase();
    const exactMarket = /точн|точний|exact|correct\s*score|рахунок|сч[её]т|map\s*score|score\s*maps?|по\s*карт|за\s*карт/.test(text);
    if (!exactMarket && !labelScore) return [];
    const max = labelScore ? Math.max(...labelScore) : 0;
    const bo5 = max >= 3 || /\bbo5\b|best\s*of\s*5|до\s*3|first\s*to\s*3/.test(text);
    const bo3 = !bo5 && (max === 2 || /\bbo3\b|best\s*of\s*3|до\s*2|first\s*to\s*2/.test(text));
    if (bo5) return ['3:0','3:1','3:2','0:3','1:3','2:3'];
    if (bo3) return ['2:0','2:1','0:2','1:2'];
    return ['2:0','2:1','0:2','1:2','3:0','3:1','3:2','0:3','1:3','2:3'];
  };

  const priorEditorWatchIds = [...(sports?.feed?.selectedIds || [])];
  const editorEventIds = [...new Set(selections.map(selection => String(selection.eventId || '')).filter(Boolean))];
  if (sports?.feed?.watch && editorEventIds.length) {
    sports.feed.watch([...new Set([...priorEditorWatchIds,...editorEventIds])]);
  }

  const lineSelectionsFor = selection => {
    try {
      return (sports?.feed?.selections?.(String(selection.eventId || '')) || [])
        .filter(item => item && Number(item.odds) > 1 && !item.frozen);
    } catch {
      return [];
    }
  };

  const lineMarketGroups = selection => {
    const groups = new Map();
    for (const item of lineSelectionsFor(selection)) {
      const key = [Number(item.period || 0),Number(item.marketType || 0),String(item.marketName || '')].join(':');
      if (!groups.has(key)) groups.set(key,{key,name:String(item.marketName || ''),items:[]});
      groups.get(key).items.push(item);
    }
    return [...groups.values()];
  };

  const lineSelectionPayload = item => item ? {
    id:String(item.id || ''),
    eventId:String(item.eventId || ''),
    marketName:String(item.marketName || ''),
    label:String(item.label || ''),
    shortLabel:String(item.shortLabel || ''),
    odds:Number(item.odds || 0),
    outcomeType:item.outcomeType == null ? null : Number(item.outcomeType),
    outcomeValues:Array.isArray(item.outcomeValues) ? item.outcomeValues : [],
    resultKind:item.resultKind == null ? null : Number(item.resultKind),
    frozen:!!item.frozen,
    stage:item.stage == null ? null : Number(item.stage),
    marketType:item.marketType == null ? null : Number(item.marketType),
    period:item.period == null ? null : Number(item.period),
    parameters:Array.isArray(item.parameters) ? item.parameters : [],
    version:item.version == null ? null : Number(item.version)
  } : null;

  const selectionState = selections.map(selection => {
    const teams = selection.competitors?.length
      ? selection.competitors.map(team => typeof team === 'string' ? team : team.name)
      : String(selection.eventName || '').split(/\s+[-–—]\s+/);
    const score = Array.isArray(selection.settlement?.score) ? selection.settlement.score : [];
    const normalizedLabel = String(selection.label || '').trim().toLowerCase();
    const team0 = String(teams[0] || '').trim().toLowerCase();
    const team1 = String(teams[1] || '').trim().toLowerCase();
    let decodedType = null;
    try {
      decodedType = Number(JSON.parse(decodeURIComponent(selection.id))?.[2]?.type);
    } catch {}
    const chosenSide = selection.outcomeType === 0 || decodedType === 0 || /^П1$/i.test(selection.shortLabel || '') || (team0 && normalizedLabel === team0) ? 0 :
      selection.outcomeType === 3 || decodedType === 3 || /^П2$/i.test(selection.shortLabel || '') || (team1 && normalizedLabel === team1) ? 1 : null;
    let winnerIndex = '';
    let state = 'open';
    if (selection.settlement?.status === 'void') state = 'void';
    else if (selection.settlement?.manualScoreMarket && score.length === 2) state = 'score';
    else if (selection.settlement?.winnerIndex === 0 || selection.settlement?.winnerIndex === 1) {
      winnerIndex = Number(selection.settlement.winnerIndex);
      state = 'winner';
    } else if (score.length === 2 && Number(score[0]) !== Number(score[1])) {
      winnerIndex = Number(score[0]) > Number(score[1]) ? 0 : 1;
      state = 'winner';
    } else if (selection.settlement?.status && chosenSide != null) {
      if (selection.settlement.status === 'won') winnerIndex = chosenSide;
      if (selection.settlement.status === 'lost') winnerIndex = chosenSide === 0 ? 1 : 0;
      if (winnerIndex === 0 || winnerIndex === 1) state = 'winner';
    }
    const marketName=String(selection.marketName || '');
    const label=String(selection.label || '');
    return {teams,score,winnerIndex,state,marketName,label,originalMarketName:marketName,originalLabel:label,displayMarketName:t(marketName),displayLabel:t(label),odds:Number(selection.odds || 0),lineSelection:null};
  });

  const selectionCards = selections.map((selection,index) => {
    const state = selectionState[index];
    const team1 = state.teams[0] || 'П1';
    const team2 = state.teams[1] || 'П2';
    const presets = scorePresets(selection);
    const selectedPreset = parseExactScore(state.label)?.join(':') || state.label.trim();
    const presetMarkup = presets.length ? '<div class="edit-score-presets" data-score-presets="' + index + '">' + presets.map(value => '<button type="button" data-edit-score-preset="' + index + '" data-value="' + esc(value) + '" class="' + (selectedPreset === value ? 'selected' : '') + '">' + esc(value) + '</button>').join('') + '</div>' : '';
    return `
      <details class="edit-selection-card" data-edit-selection="${index}" ${selections.length === 1 ? 'open' : ''}>
        <summary class="edit-selection-head">
          <span class="edit-selection-head-copy">
            <strong>${esc(selection.eventName || ('Матч ' + (index + 1)))}</strong>
            <small data-edit-selection-summary="${index}">${esc(state.displayMarketName)}${state.displayLabel ? ' · ' + esc(state.displayLabel) : ''} · ${Number(state.odds || 0).toFixed(2)}</small>
          </span>
          <span class="edit-selection-head-side"><b>#${index + 1}</b>${icon('chevron-down')}</span>
        </summary>
        <div class="edit-selection-body">
          <div class="edit-selection-section-title">Вибір у ставці</div>
          <div class="edit-line-picker" data-edit-line-picker="${index}">
            <label for="edit-line-market-${index}">Ринок з лінії</label>
            <select id="edit-line-market-${index}" class="edit-line-market-select" data-index="${index}" disabled>
              <option value="">Завантаження лінії матчу…</option>
            </select>
            <label for="edit-line-outcome-${index}">Вибраний результат</label>
            <select id="edit-line-outcome-${index}" class="edit-line-outcome-select" data-index="${index}" disabled>
              <option value="">Оберіть результат</option>
            </select>
            <div class="edit-line-status" data-edit-line-status="${index}">Завантаження лінії матчу…</div>
          </div>
          <details class="edit-manual-fallback">
            <summary>Ручний ввід</summary>
            <label for="edit-market-${index}">Ринок</label>
            <input id="edit-market-${index}" class="edit-market-name" data-index="${index}" value="${esc(state.displayMarketName)}" maxlength="180" required>
            <label for="edit-label-${index}">Вибраний результат</label>
            <input id="edit-label-${index}" class="edit-outcome-label" data-index="${index}" value="${esc(state.displayLabel)}" maxlength="180" required>
            ${presetMarkup}
            <label for="edit-odds-${index}">Коефіцієнт вручну</label>
            <input id="edit-odds-${index}" class="edit-odds" data-index="${index}" inputmode="decimal" value="${Number(selection.odds || 0).toFixed(2)}" required>
          </details>

          <div class="edit-selection-section-title edit-result-title">Фактичний результат</div>
          <div class="edit-bet-label">Переможець матчу</div>
        <div class="edit-winner-buttons" data-selection-winner="${index}">
          <button type="button" class="${state.state === 'winner' && state.winnerIndex === 0 ? 'selected' : ''}" data-edit-selection-winner="${index}" data-side="0">П1<small>${esc(team1)}</small></button>
          <button type="button" class="${state.state === 'winner' && state.winnerIndex === 1 ? 'selected' : ''}" data-edit-selection-winner="${index}" data-side="1">П2<small>${esc(team2)}</small></button>
        </div>
        <div class="edit-result-controls edit-result-controls-wide">
          <button type="button" class="${state.state === 'open' ? 'selected' : ''}" data-edit-selection-state="${index}" data-state="open">Не зіграно</button>
          <button type="button" class="${state.state === 'score' ? 'selected' : ''}" data-edit-selection-state="${index}" data-state="score">За рахунком</button>
          <button type="button" class="${state.state === 'void' ? 'selected' : ''}" data-edit-selection-state="${index}" data-state="void">Повернення</button>
        </div>

        <div class="edit-score-grid">
          <div>
            <label for="edit-score-${index}-1">Рахунок 1</label>
            <input id="edit-score-${index}-1" inputmode="numeric" type="number" min="0" value="${state.score[0] ?? ''}">
          </div>
          <div>
            <label for="edit-score-${index}-2">Рахунок 2</label>
            <input id="edit-score-${index}-2" inputmode="numeric" type="number" min="0" value="${state.score[1] ?? ''}">
          </div>
        </div>
        </div>
      </details>
    `;
  }).join('');

  openDialog('Редагувати ставку', `
    <form id="edit-bet-form" class="edit-bet-form">
      <p class="dialog-copy">Відкрий потрібний пункт ставки та змінюй сам ринок, вибраний результат, коефіцієнт або фактичний результат. Наприклад, точний рахунок по картах 3:0 можна змінити на 3:2.</p>

      <div class="edit-bet-card edit-bet-general">
        <div class="edit-bet-grid">
          <div>
            <label for="edit-bet-number">Номер ставки</label>
            <input id="edit-bet-number" inputmode="numeric" type="number" min="1" step="1" value="${Number(bet.number || 1)}" required>
          </div>
          <div>
            <label for="edit-bet-stake">Сума ставки, €</label>
            <input id="edit-bet-stake" inputmode="decimal" value="${(Number(bet.stake || 0) / 100).toFixed(2)}" required>
          </div>
        </div>

        <label for="edit-bet-date">Час ставки</label>
        <input id="edit-bet-date" class="edit-bet-date" type="datetime-local" value="${esc(editBetDateValue)}" required>

        <label for="edit-bet-status">Статус ставки</label>
        <select id="edit-bet-status">
          <option value="open" ${status === 'open' ? 'selected' : ''}>Нерозрахована</option>
          <option value="won" ${status === 'won' ? 'selected' : ''}>Виграна</option>
          <option value="lost" ${status === 'lost' ? 'selected' : ''}>Програна</option>
          <option value="void" ${status === 'void' ? 'selected' : ''}>Повернення</option>
          <option value="cashout" ${status === 'cashout' ? 'selected' : ''}>Cash-out</option>
        </select>
        <div id="edit-cashout-wrap" ${status === 'cashout' ? '' : 'hidden'}>
          <label for="edit-cashout">Сума cash-out, €</label>
          <input id="edit-cashout" inputmode="decimal" value="${status === 'cashout' ? (Number(bet.payout || 0) / 100).toFixed(2) : ''}">
        </div>
      </div>

      <div class="edit-selection-caption"><strong>Пункти ставки</strong><span>${selections.length}</span></div>
      <div class="edit-selection-list">${selectionCards}</div>

      <div class="edit-payout-preview">Можлива виплата: <strong id="edit-payout-value">${money(status === 'won' || status === 'cashout' ? Number(bet.payout || bet.potential || 0) : Number(bet.potential || 0))} €</strong></div>
      <div id="form-error" class="error" role="alert"></div>
      <button class="submit edit-bet-save" type="submit">Зберегти зміни</button>
      <button class="edit-bet-duplicate" type="button" data-action="duplicate-bet" data-value="${esc(bet.id)}">${icon('copy')}<span>Дублювати ставку</span></button>
      <button class="edit-bet-hide" type="button" data-action="delete-bet" data-value="${esc(bet.id)}">Приховати ставку з історії</button>
    </form>
  `, 'edit-bet-dialog');

  const form = $('#edit-bet-form');
  const statusInput = $('#edit-bet-status');
  const cashoutWrap = $('#edit-cashout-wrap');
  const payoutValue = $('#edit-payout-value');
  const persistedSelectionText = (index,field) => {
    const state = selectionState[index];
    const input = form.querySelector(field === 'marketName' ? `#edit-market-${index}` : `#edit-label-${index}`);
    const current = input?.value.trim() || '';
    if (state.lineSelection) return field === 'marketName' ? String(state.lineSelection.marketName || '') : String(state.lineSelection.label || '');
    const display = field === 'marketName' ? state.displayMarketName : state.displayLabel;
    const original = field === 'marketName' ? state.originalMarketName : state.originalLabel;
    return current === display ? original : current;
  };

  const lineOptionMaps = selectionState.map(() => new Map());
  let linePollAttempts = 0;
  let linePollTimer = null;

  const applyLineSelection = (index,item) => {
    if (!item) return;
    const state = selectionState[index];
    state.lineSelection = item;
    state.marketName = String(item.marketName || '');
    state.label = String(item.label || '');
    state.displayMarketName = t(state.marketName);
    state.displayLabel = t(state.label);
    const marketInput = form.querySelector(`#edit-market-${index}`);
    const labelInput = form.querySelector(`#edit-label-${index}`);
    const oddsInput = form.querySelector(`#edit-odds-${index}`);
    if (marketInput) marketInput.value = state.displayMarketName;
    if (labelInput) labelInput.value = state.displayLabel;
    if (oddsInput && Number.isFinite(Number(item.odds))) oddsInput.value = Number(item.odds).toFixed(2);
    form.querySelectorAll(`[data-edit-score-preset="${index}"]`).forEach(button => {
      const selectedScore = parseExactScore(item.label)?.join(':') || '';
      button.classList.toggle('selected',button.dataset.value === selectedScore);
    });
    updateSelectionSummary(index);
    preview();
  };

  const renderLineOutcomes = (index,group,chooseFirst = false) => {
    const outcomeSelect = form.querySelector(`#edit-line-outcome-${index}`);
    if (!outcomeSelect || !group) return;
    const state = selectionState[index];
    lineOptionMaps[index] = new Map(group.items.map(item => [String(item.id),item]));
    const current = state.lineSelection
      ? group.items.find(item => String(item.id) === String(state.lineSelection.id))
      : group.items.find(item => String(item.id) === String(selections[index]?.id))
        || group.items.find(item => String(item.label || '') === state.originalLabel);
    outcomeSelect.innerHTML = group.items.map(item =>
      `<option value="§ITEMID§" §SELECTED§>§ITEMLABEL§ · §ODDS§</option>`
        .replace('§ITEMID§',esc(item.id))
        .replace('§SELECTED§',current && String(current.id) === String(item.id) ? 'selected' : '')
        .replace('§ITEMLABEL§',esc(t(item.label)))
        .replace('§ODDS§',Number(item.odds).toFixed(2))
    ).join('');
    outcomeSelect.disabled = false;
    if (chooseFirst && group.items[0]) {
      outcomeSelect.value = String(group.items[0].id);
      applyLineSelection(index,group.items[0]);
    }
  };

  const renderLinePicker = index => {
    const selection = selections[index];
    const marketSelect = form.querySelector(`#edit-line-market-${index}`);
    const outcomeSelect = form.querySelector(`#edit-line-outcome-${index}`);
    const statusNode = form.querySelector(`[data-edit-line-status="${index}"]`);
    if (!marketSelect || !outcomeSelect || !statusNode) return false;
    const groups = lineMarketGroups(selection);
    if (!groups.length) {
      marketSelect.disabled = true;
      outcomeSelect.disabled = true;
      marketSelect.innerHTML = `<option value="">§STATUS§</option>`.replace('§STATUS§',esc(t(linePollAttempts < 16 ? 'Завантаження лінії матчу…' : 'Лінія матчу зараз недоступна')));
      outcomeSelect.innerHTML = `<option value="">§OUTCOME§</option>`.replace('§OUTCOME§',esc(t('Оберіть результат')));
      statusNode.textContent = t(linePollAttempts < 16 ? 'Завантаження лінії матчу…' : 'Лінія матчу зараз недоступна');
      return false;
    }

    const state = selectionState[index];
    const matchedGroup = groups.find(group => group.items.some(item => String(item.id) === String(state.lineSelection?.id || selection.id)))
      || groups.find(group => String(group.name) === state.originalMarketName)
      || groups[0];
    marketSelect.innerHTML = groups.map(group =>
      `<option value="§KEY§" §SELECTED§>§NAME§</option>`
        .replace('§KEY§',esc(group.key))
        .replace('§SELECTED§',group.key === matchedGroup.key ? 'selected' : '')
        .replace('§NAME§',esc(t(group.name)))
    ).join('');
    marketSelect.disabled = false;
    marketSelect._arenaGroups = groups;
    statusNode.textContent = t('Лінія матчу');
    renderLineOutcomes(index,matchedGroup,false);
    return true;
  };

  const refreshLinePickers = () => {
    if (!dialog.open || !form.isConnected) return;
    linePollAttempts++;
    const ready = selections.map((_,index) => renderLinePicker(index));
    if (ready.some(value => !value) && linePollAttempts < 16) linePollTimer = setTimeout(refreshLinePickers,250);
  };

  const preview = () => {
    try {
      const stake = Math.round(Number(String($('#edit-bet-stake').value).replace(',', '.')) * 100);
      const nextSelections = selections.map((selection,index) => ({
        ...selection,
        marketName:persistedSelectionText(index,'marketName'),
        label:persistedSelectionText(index,'label'),
        odds:Number(String(form.querySelector(`#edit-odds-${index}`).value).replace(',', '.'))
      }));
      const totals = betTotals(stake,nextSelections,bet.type,bet.systemSize);
      let value = totals.potential;
      if (statusInput.value === 'lost') value = 0;
      if (statusInput.value === 'void') value = totals.cost;
      if (statusInput.value === 'cashout') {
        const raw = Number(String($('#edit-cashout').value || '0').replace(',', '.'));
        value = Number.isFinite(raw) ? Math.round(raw * 100) : 0;
      }
      payoutValue.textContent = money(value) + ' €';
    } catch {}
  };

  const updateSelectionSummary = index => {
    const market = form.querySelector(`#edit-market-${index}`)?.value.trim() || '';
    const label = form.querySelector(`#edit-label-${index}`)?.value.trim() || '';
    const odds = Number(String(form.querySelector(`#edit-odds-${index}`)?.value || '0').replace(',', '.'));
    const summary = form.querySelector(`[data-edit-selection-summary="${index}"]`);
    if (summary) summary.textContent = `${market}${label ? ' · ' + label : ''}${Number.isFinite(odds) ? ' · ' + odds.toFixed(2) : ''}`;
  };

  form.querySelectorAll('[data-edit-score-preset]').forEach(button => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.editScorePreset);
      const value = button.dataset.value;
      const input = form.querySelector(`#edit-label-${index}`);
      input.value = value;
      selectionState[index].lineSelection = null;
      selectionState[index].label = value;
      form.querySelectorAll(`[data-edit-score-preset="${index}"]`).forEach(item => item.classList.toggle('selected', item === button));
      updateSelectionSummary(index);
      preview();
    });
  });

  form.querySelectorAll('[data-edit-selection-winner]').forEach(button => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.editSelectionWinner);
      const side = Number(button.dataset.side);
      selectionState[index].state = 'winner';
      selectionState[index].winnerIndex = side;
      form.querySelectorAll(`[data-edit-selection-winner="${index}"]`).forEach(item => item.classList.toggle('selected', item === button));
      form.querySelectorAll(`[data-edit-selection-state="${index}"]`).forEach(item => item.classList.remove('selected'));
    });
  });

  form.querySelectorAll('[data-edit-selection-state]').forEach(button => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.editSelectionState);
      const state = button.dataset.state;
      selectionState[index].state = state;
      selectionState[index].winnerIndex = '';
      form.querySelectorAll(`[data-edit-selection-winner="${index}"]`).forEach(item => item.classList.remove('selected'));
      form.querySelectorAll(`[data-edit-selection-state="${index}"]`).forEach(item => item.classList.toggle('selected', item === button));
    });
  });

  form.querySelectorAll('.edit-line-market-select').forEach(select => {
    select.addEventListener('change', () => {
      const index = Number(select.dataset.index);
      const groups = Array.isArray(select._arenaGroups) ? select._arenaGroups : lineMarketGroups(selections[index]);
      const group = groups.find(item => item.key === select.value);
      if (group) renderLineOutcomes(index,group,true);
    });
  });
  form.querySelectorAll('.edit-line-outcome-select').forEach(select => {
    select.addEventListener('change', () => {
      const index = Number(select.dataset.index);
      const item = lineOptionMaps[index]?.get(String(select.value));
      if (item) applyLineSelection(index,item);
    });
  });
  refreshLinePickers();

  statusInput.addEventListener('change', () => {
    cashoutWrap.hidden = statusInput.value !== 'cashout';
    preview();
  });
  form.querySelectorAll('.edit-market-name,.edit-outcome-label,.edit-odds').forEach(input => {
    input.addEventListener('input', () => {
      const index = Number(input.dataset.index);
      if (input.classList.contains('edit-market-name') || input.classList.contains('edit-outcome-label')) selectionState[index].lineSelection = null;
      if (input.classList.contains('edit-outcome-label')) {
        const value = input.value.trim();
        form.querySelectorAll(`[data-edit-score-preset="${index}"]`).forEach(item => item.classList.toggle('selected', item.dataset.value === value));
      }
      updateSelectionSummary(index);
      preview();
    });
  });
  form.querySelectorAll('#edit-bet-stake,#edit-cashout,[id^="edit-score-"]').forEach(input => input.addEventListener('input',preview));

  form.addEventListener('submit', event => {
    event.preventDefault();
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true;
    $('#form-error').textContent = '';
    try {
      const selectionEdits = selections.map((_,index) => ({
        state:selectionState[index].state,
        winnerIndex:selectionState[index].winnerIndex,
        lineSelection:lineSelectionPayload(selectionState[index].lineSelection),
        marketName:persistedSelectionText(index,'marketName'),
        label:persistedSelectionText(index,'label'),
        odds:Number(String(form.querySelector(`#edit-odds-${index}`).value).replace(',', '.')),
        score1:form.querySelector(`#edit-score-${index}-1`).value,
        score2:form.querySelector(`#edit-score-${index}-2`).value
      }));
      const change = {
        number:Number($('#edit-bet-number').value),
        date:$('#edit-bet-date').value,
        stake:cents($('#edit-bet-stake').value),
        odds:selectionEdits.map(item => item.odds),
        selectionEdits,
        status:statusInput.value
      };
      if (statusInput.value === 'cashout') change.cashoutPayout = cents($('#edit-cashout').value || '0');
      accounts.editBet(bet.id,change);
      account = accounts.current();
      dialog.close();
      renderProfile();
      syncFeedControls();
      showToast('Ставку оновлено');
    } catch (problem) {
      $('#form-error').textContent = problem.message || 'Не вдалося зберегти зміни';
    } finally {
      submit.disabled = false;
    }
  });

  const restoreEditorWatch = () => {
    if (linePollTimer) clearTimeout(linePollTimer);
    if (sports?.feed?.watch) sports.feed.watch(priorEditorWatchIds);
  };
  dialog.addEventListener('close',restoreEditorWatch,{once:true});
}

const themeLabels = {dark:'Темна',standard:'Стандартна',auto:'Авто'};
function openTheme() {
  let selected = getTheme();
  openDialog('Виберіть вашу тему', `<p class="theme-description">Виберіть бажану тему, щоб налаштувати інтерфейс</p><div class="theme-options">${[['dark','moon','Темна тема для всіх розділів'],['standard','contrast','Світлий спорт, темне казино'],['auto','sun-moon','Відповідає налаштуванням вашого пристрою']].map(([value,symbol,description])=>`<label>${icon(symbol)}<span><strong>${themeLabels[value]}</strong><small>${description}</small></span><input type="radio" name="theme" value="${value}" ${selected===value?'checked':''}></label>`).join('')}</div><button class="submit theme-save">Зберегти</button>`);
  dialog.classList.add('theme-sheet');
  dialog.querySelectorAll('[name=theme]').forEach(input=>input.onchange=()=>{selected=input.value;});
  dialog.querySelector('.theme-save').onclick=()=>{setTheme(selected);dialog.close(); if($('#site-menu')?.open)renderMenu();};
}
function renderMenu() {
  $('#site-menu').innerHTML = `<div class="site-menu-head"><strong>Меню</strong><button data-action="close-menu" aria-label="Закрити">${icon('x')}</button></div><div class="site-menu-content"><div class="site-menu-sections"><details><summary>Бонуси ${icon('chevron-down')}</summary><button data-action="menu-destination" data-value="promotions">Акції</button><button data-action="menu-destination" data-value="bonuses">Магазин бонусів</button></details><details><summary>Казино ${icon('chevron-down')}</summary><button data-action="menu-destination" data-value="casino">Казино</button></details><details><summary>Спорт ${icon('chevron-down')}</summary><button data-action="menu-destination" data-value="live">Лайв</button><button data-action="menu-destination" data-value="prematch">Прематч</button><button data-action="menu-destination" data-value="bets">Мої ставки</button></details></div><div class="site-menu-links"><button data-action="menu-destination" data-value="profile"><span>Мій акаунт</span>${icon('arrow-up-right')}</button><button data-action="help"><span>Служба підтримки</span>${icon('arrow-up-right')}</button><button data-action="language"><span>Мова</span><span data-no-translate>${{uk:'Українська',ru:'Русский',en:'English'}[getLanguage()]}</span>${icon('chevrons-up-down')}</button><button class="menu-edit-bets" role="switch" aria-checked="${localStorage.getItem('arena-edit-bets') === 'on'}" data-action="toggle-edit-bets"><span>Редагувати ставки</span><span class="menu-toggle" aria-hidden="true"></span></button><button class="menu-theme" data-action="theme">${icon('moon')}<span>Вибрати тему<small>${themeLabels[getTheme()]}</small></span>${icon('chevron-right')}</button></div></div>`;
  refreshIcons();
}
function openMenu() {
  let menu = $('#site-menu');
  if(!menu){menu=document.createElement('dialog');menu.id='site-menu';menu.setAttribute('aria-label','Меню');document.body.append(menu);}
  $('#betslip').close(); renderMenu(); if(!menu.open)menu.showModal();
}
function passwordField(id, label, autocomplete) {
  return `<label for="${id}">${label}</label><div class="password"><input id="${id}" name="${id}" type="password" autocomplete="${autocomplete}" required><button class="icon-button" type="button" data-action="visibility" data-value="${id}" aria-label="Показать пароль">${icon('eye')}</button></div>`;
}
function openAuth(register = false, enterProfile = false, onSuccess = null) {
  openDialog(register ? 'Регистрация' : 'Вход', `<form id="auth-form"><p class="dialog-copy">Аккаунт Arena Line. Не вводите данные от аккаунта Parik24.</p>${register ? '<label for="firstName">Имя</label><input id="firstName" name="firstName" autocomplete="given-name" maxlength="80" required><label for="lastName">Фамилия</label><input id="lastName" name="lastName" autocomplete="family-name" maxlength="80" required>' : ''}<label for="email">E-mail</label><input id="email" name="email" type="email" autocomplete="username" required>${passwordField('password', 'Пароль', register ? 'new-password' : 'current-password')}<div id="form-error" class="error" role="alert"></div><button class="submit" type="submit">${register ? 'Создать аккаунт' : 'Войти'}</button><button class="link-button" type="button" data-action="${register ? 'login' : 'register'}">${register ? 'Уже есть аккаунт? Войти' : 'Регистрация'}</button></form>`);
  $('#auth-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget, submit = form.querySelector('[type=submit]'), error = $('#form-error');
    submit.disabled = true; error.textContent = '';
    try {
      const data = Object.fromEntries(new FormData(form));
      if (register) await accounts.signUp(data); else await accounts.signIn(data.email, data.password);
      form.reset(); dialog.close(); syncFeedControls();
      if (enterProfile) openProfile();
      onSuccess?.();
      showToast('Вы вошли в аккаунт');
    } catch (problem) { error.textContent = problem instanceof DOMException ? 'Разрешите хранение данных сайта в браузере' : problem.message; }
    finally { submit.disabled = false; }
  });
  $('#auth-form .link-button').addEventListener('click', event => {
    event.stopPropagation(); openAuth(!register, enterProfile, onSuccess);
  });
}
function openTransfer(type) {
  account = getAccount();
  if (!account) { openAuth(); return; }
  const deposit = type === 'deposit';
  openDialog(deposit ? 'Пополнить счёт' : 'Вывести', `<form id="transfer-form"><p class="dialog-copy">${deposit ? 'Добавление' : 'Списание'} виртуальных средств. Реального перевода денег не будет.</p><p>Баланс: <strong>${money(account.balance)} €</strong></p><label for="amount">Сумма, €</label><input id="amount" name="amount" inputmode="decimal" autocomplete="off" placeholder="0,00" required><div id="form-error" class="error" role="alert"></div><button class="submit green" type="submit">Продолжить</button></form>`);
  $('#transfer-form').addEventListener('submit', event => {
    event.preventDefault();
    try { accounts.transfer(type, cents($('#amount').value)); dialog.close(); syncFeedControls(); if (!$('#profile-layer').hidden) renderProfile(); showToast('Баланс обновлён'); }
    catch (problem) { $('#form-error').textContent = problem.message; }
  });
}
function openPassword() {
  openDialog('Изменить пароль', `<form id="password-form">${passwordField('oldPassword', 'Текущий пароль', 'current-password')}${passwordField('newPassword', 'Новый пароль', 'new-password')}<div id="form-error" class="error" role="alert"></div><button class="submit" type="submit">Сохранить</button></form>`);
  $('#password-form').addEventListener('submit', async event => {
    event.preventDefault(); const submit = event.currentTarget.querySelector('[type=submit]'); submit.disabled = true;
    try { await accounts.password($('#oldPassword').value, $('#newPassword').value); dialog.close(); showToast('Пароль изменён'); }
    catch (problem) { $('#form-error').textContent = problem.message; }
    finally { submit.disabled = false; }
  });
}

document.addEventListener('click', async event => {
  const control = event.target.closest('[data-action]');
  if (!control) return;
  const { action, value } = control.dataset;
  if (action === 'login') openAuth(false);
  else if (action === 'register') openAuth(true);
  else if (action === 'profile') openProfile();
  else if (action === 'close-profile') closeProfile();
  else if (action === 'profile-search') { closeProfile(); sports.click('sports-search'); }
  else if (action === 'profile-casino') { closeProfile(); sports.click('sports-page', 'casino'); }
  else if (action === 'notifications') openDialog('Уведомления', empty('bell', 'Новых уведомлений нет'));
  else if (action === 'profile-view') { profileView = value; renderProfile(); $('#profile-content').scrollTop = 0; }
  else if (action === 'close-dialog') dialog.close();
  else if (action === 'deposit' || action === 'withdraw') openTransfer(action);
  else if (action === 'password') openPassword();
  else if (action === 'language') openLanguage();
  else if (action === 'theme') openTheme();
  else if (action === 'open-menu') openMenu();
  else if (action === 'close-menu') $('#site-menu').close();
  else if (action === 'menu-destination') {
    $('#site-menu').close();
    if(['live','prematch'].includes(value)){closeProfile();sports.click('sports-home');sports.click('sports-stage',value);}
    else if(value==='casino'){closeProfile();sports.click('sports-page','casino');}
    else {openProfile(); if(getAccount()){profileView=value;renderProfile();}}
  }
  else if (action === 'logout') { accounts.signOut(); account = null; closeProfile(); showToast('Вы вышли из аккаунта'); }
  else if (action === 'toggle-edit-bets') {
    localStorage.setItem('arena-edit-bets', localStorage.getItem('arena-edit-bets') === 'on' ? 'off' : 'on');
    renderMenu(); if (!$('#profile-layer').hidden) renderProfile();
  }
  else if (action === 'edit-bet') {
    if (localStorage.getItem('arena-edit-bets') !== 'on') return;
    openEditBet(value);
  }
  else if (action === 'duplicate-bet') {
    if (localStorage.getItem('arena-edit-bets') !== 'on') return;
    try {
      accounts.duplicateBet(value);
      account = accounts.current();
      if (dialog.open) dialog.close();
      renderProfile();
      syncFeedControls();
      showToast('Ставку продубльовано');
    } catch (problem) {
      const error = $('#form-error');
      if (error && dialog.open) error.textContent = problem.message || 'Не вдалося продублювати ставку';
      else showToast(problem.message || 'Не вдалося продублювати ставку');
    }
  }
  else if (action === 'delete-bet') {
    if (localStorage.getItem('arena-edit-bets') !== 'on') return;
    if (accounts.hideBet(value)) {
      account = accounts.current();
      if (dialog.open) dialog.close();
      renderProfile();
      syncFeedControls();
      showToast('Ставку приховано');
    }
  }
  else if (action === 'bet-tab') { betTab = value; renderProfile(); }
  else if (action === 'open-bet-detail') {
    selectedBetId = value;
    profileView = 'bet-detail';
    renderProfile();
    $('#profile-content').scrollTop = 0;
  }
  else if (action === 'back-to-bets') {
    profileView = 'bets';
    selectedBetId = null;
    renderProfile();
    $('#profile-content').scrollTop = 0;
  }
  else if (action === 'bet-event') {
    const split = value.lastIndexOf(':'), bet = getAccount()?.bets.find(bet => bet.id === value.slice(0,split));
    const selection = bet?.selections[Number(value.slice(split+1))];
    if (selection) { closeProfile(); sports.openEvent(selection.eventId, { ...selection, date:bet.date }); }
  }
  else if (action === 'repeat-bet') {
    const bet = getAccount()?.bets.find(bet => bet.id === value);
    if (bet) { closeProfile(); sports.repeatBet(bet); }
  }
  else if (action === 'share-bet') {
    const bet = getAccount()?.bets.find(bet => bet.id === value);
    if (!bet) return;
    openShareCoupon(bet, showToast);
  }
  else if (action === 'copy') { try { await navigator.clipboard.writeText(account.id); showToast('Номер счёта скопирован'); } catch { showToast('Не удалось скопировать'); } }
  else if (action === 'visibility') {
    const input = document.getElementById(value), visible = input.type === 'password';
    input.type = visible ? 'text' : 'password'; control.innerHTML = icon(visible ? 'eye-off' : 'eye'); control.setAttribute('aria-label', visible ? 'Скрыть пароль' : 'Показать пароль'); refreshIcons();
  } else if (action === 'help') openDialog('Профиль', '<p class="dialog-copy">Личный профиль Arena Line с виртуальным балансом. Он не является аккаунтом Parik24.</p>');
});

dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const box = dialog.getBoundingClientRect();
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
});
document.addEventListener('change',event=>{
  if(event.target.id==='settlement-notifications')localStorage.setItem('arena-settlement-notifications',event.target.checked?'on':'off');
  if(event.target.id==='default-stage')localStorage.setItem('arena-default-stage',event.target.value);
  if(event.target.id==='match-sort'){localStorage.setItem('arena-match-sort',event.target.value);sports.renderLine();}
});
document.addEventListener('submit',event=>{if(event.target.id==='feedback-form'){event.preventDefault();localStorage.setItem('arena-feedback-v1',$('#feedback-text').value);showToast('Відгук збережено на цьому пристрої');}});
window.addEventListener('storage', () => { syncFeedControls(); if (!$('#profile-layer').hidden) renderProfile(); });
applyTheme();
sports = new SportsApp({ openMenu, accounts, getAccount, openAuth, openProfile, openBets, onBalanceChange: syncFeedControls, showToast });
syncFeedControls();
window.__arenaClientDiagnostic?.('CLIENT_BOOT_OK','Arena app initialized',{language:getLanguage(),hasSports:Boolean(sports)});
accounts.syncCurrentFromServer().then(() => {
  syncFeedControls();
  if (!$('#profile-layer').hidden) renderProfile();
}).catch(() => {});
window.addEventListener('focus', () => {
  accounts.syncCurrentFromServer().then(() => {
    syncFeedControls();
    if (!$('#profile-layer').hidden) renderProfile();
  }).catch(() => {});
});
const profileSyncTimer = setInterval(() => {
  if (document.visibilityState !== 'visible' || !getAccount()) return;
  accounts.syncCurrentFromServer().then(() => {
    syncFeedControls();
    if (!$('#profile-layer').hidden) renderProfile();
  }).catch(() => {});
}, 5000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') accounts.syncCurrentFromServer().then(syncFeedControls).catch(() => {});
});
startTranslations();
window.addEventListener('arena-language-change',()=>{if($('#site-menu')?.open)renderMenu();if(!$('#profile-layer').hidden)renderProfile();sports.feed.close();sports.feed.connect();sports.renderTabs();sports.renderLine();sports.renderSlip();});
if (location.hash === '#profile') account ? openProfile() : openAuth(false, true);
if (location.hash.startsWith('#event/')) sports.openEvent(decodeURIComponent(location.hash.slice(7)));
if ('serviceWorker' in navigator) {
  // Runtime assets are versioned by path. Remove legacy workers/caches only after the app
  // is already running so cache maintenance can never block the interface again.
  queueMicrotask(() => {
    navigator.serviceWorker.getRegistrations()
      .then(registrations => Promise.all(registrations.map(registration => registration.unregister())))
      .catch(() => {});
    if ('caches' in window) {
      caches.keys()
        .then(keys => Promise.all(keys.filter(key => key.startsWith('arena-line-')).map(key => caches.delete(key))))
        .catch(() => {});
    }
  });
}

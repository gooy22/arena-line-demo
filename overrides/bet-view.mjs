import { icon, graphic } from './ui.mjs';
import { getLanguage, getLocale, t } from './i18n.mjs';

export const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
export const amount = value => {
  const cents = Math.round(Number(value) || 0);
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  const major = String(Math.floor(absolute / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const minor = String(absolute % 100).padStart(2, '0');
  return `${sign}${major}.${minor} €`;
};
const date = value => new Date(value).toLocaleString(getLocale(), { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
const games = { CSGO:'counter-strike', CS:'counter-strike', DOTA2:'dota', LOL:'lol', F:'football', T:'tennis', TT:'table-tennis', H:'hockey', B:'basketball', VB:'volleyball', PL:'snooker' };

function outcomesLabel(count) {
  const language = getLanguage();
  if (language === 'en') return `${count} ${count === 1 ? 'selection' : 'selections'}`;
  if (language === 'uk') {
    const mod10 = count % 10, mod100 = count % 100;
    const word = mod10 === 1 && mod100 !== 11 ? 'результат' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'результати' : 'результатів';
    return `${count} ${word}`;
  }
  const mod10 = count % 10, mod100 = count % 100;
  const word = mod10 === 1 && mod100 !== 11 ? 'исход' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'исхода' : 'исходов';
  return `${count} ${word}`;
}

function compactOdds(bet) {
  const value = Number(bet?.odds);
  if (!Number.isFinite(value)) return '';
  return value.toFixed(4).replace(/0+$/,'').replace(/\.$/,'');
}

function compactBetSummary(bet) {
  const state = ['won','lost','void','cashout'].includes(bet.status) ? bet.status : 'open';
  const iconName = state === 'won' ? 'check' : state === 'lost' ? 'x' : state === 'cashout' ? 'undo-2' : state === 'void' ? 'minus' : 'clock-3';
  return `<button class="bet-selection-summary bet-multi-summary" data-action="toggle-multi-bet" data-value="${esc(bet.id)}" aria-expanded="false"><span class="bet-result result-${esc(state)}">${icon(iconName)}</span><span class="bet-selection-label"><strong>${esc(outcomesLabel(bet.selections?.length || 0))}</strong></span><span class="bet-coefficient">${esc(compactOdds(bet))}</span>${icon('chevron-right','bet-multi-chevron')}</button>`;
}

function expandedMultiSelection(selection, bet, index) {
  const result = selection.settlement;
  const state = bet.status === 'cashout' ? 'cashout' : result?.status;
  const resultIcon = state === 'won' ? 'check' : state === 'lost' ? 'x' : state === 'cashout' ? 'undo-2' : state === 'void' ? 'minus' : '';
  const sportName = selection.sport === 'CS' || !games[selection.sport] || ['CSGO','DOTA2','LOL'].includes(selection.subsport) ? 'esports' : games[selection.sport];
  const eventDate = date(selection.startTime ? selection.startTime * 1000 : bet.date);
  const detail = `${eventDate} ${selection.eventName || ''}`;
  return `<button class="bet-multi-event" data-action="bet-event" data-value="${esc(bet.id)}:${index}">
    <span class="bet-multi-sport">${graphic(sportName)}</span>
    <span class="bet-multi-copy"><strong>${esc(t(selection.marketName))} ${esc(t(selection.label))}</strong><small>${esc(detail)}</small></span>
    <span class="bet-multi-right"><b class="${state ? `state-${esc(state)}` : ''}">${Number(selection.odds.toFixed(2))}</b>${state ? `<span class="bet-result result-${esc(state)}">${icon(resultIcon)}</span>` : ''}</span>
  </button>`;
}

function selectionRow(selection, bet, index) {
  const result = selection.settlement;
  const state = bet.status === 'cashout' ? 'cashout' : result?.status;
  const teams = selection.competitors?.length ? selection.competitors : selection.eventName.split(' - ').map(name => ({ name }));
  const score = result?.score;
  const resultIcon = state === 'won' ? 'check' : state === 'lost' ? 'x' : state === 'cashout' ? 'undo-2' : 'minus';
  const symbol = state
    ? `<span class="bet-result result-${esc(state)}">${icon(resultIcon)}</span>`
    : `<span class="bet-sport">${graphic(selection.sport === 'CS' || !games[selection.sport] || ['CSGO','DOTA2','LOL'].includes(selection.subsport) ? 'esports' : games[selection.sport])}</span>`;

  const rawPeriods = Array.isArray(result?.periods) ? result.periods : [];
  // Old manually edited bets stored the final score as both score and "period 1".
  // Treat that as one final result so history matches the original bookmaker layout.
  const duplicateManualPeriod = result?.manual && rawPeriods.length === 1 && Array.isArray(score) &&
    Array.isArray(rawPeriods[0]) && score.length >= 2 && rawPeriods[0].length >= 2 &&
    Number(rawPeriods[0][0]) === Number(score[0]) && Number(rawPeriods[0][1]) === Number(score[1]);
  const periods = duplicateManualPeriod ? [] : rawPeriods;

  return `<section class="bet-selection"><button class="bet-selection-summary" data-action="bet-event" data-value="${esc(bet.id)}:${index}">${symbol}<span class="bet-selection-label"><span class="meta">${esc(t(selection.marketName))}</span><strong>${esc(t(selection.label))}</strong></span><span class="bet-coefficient">${Number(selection.odds.toFixed(2))}</span>${icon('chevron-right')}</button><div class="bet-event-time">${esc(date(selection.startTime ? selection.startTime * 1000 : bet.date))}</div><div class="bet-teams">${periods.length ? `<div class="bet-period-labels"><span></span><span>${periods.map((_,i) => `<small>${i+1}</small>`).join('')}<small></small></span></div>` : ''}${teams.map((team,i) => `<div><span>${esc(team.name)}</span>${score ? `<span class="bet-team-score">${periods.map(period => `<small>${esc(period[i])}</small>`).join('')}<b>${esc(score[i] ?? '')}</b></span>` : ''}</div>`).join('')}</div></section>`;
}

export function betHistory(account, tab, editing = false) {
  const settled = tab === 'settled';
  const visible = account.bets.filter(bet => !bet.hidden).sort((a,b) => Number(b.number || 0) - Number(a.number || 0) || new Date(b.date) - new Date(a.date));
  const entries = visible.filter(bet => settled ? bet.status !== 'open' : bet.status === 'open');

  const tabs = `<div class="tabs bet-history-tabs" role="tablist"><button role="tab" aria-selected="${!settled}" class="${!settled ? 'active' : ''}" data-action="bet-tab" data-value="open">${esc(t('Нерозраховані'))}</button><button role="tab" aria-selected="${settled}" class="${settled ? 'active' : ''}" data-action="bet-tab" data-value="settled">${esc(t('Розраховані'))}</button></div>`;

  const cards = entries.map(bet => {
    const paymentLabel = !settled ? t('Можлива виплата') : bet.status === 'cashout' ? t('Виведено') : t('Виплата');
    const multi = bet.type === 'express' || bet.type === 'system' || (bet.selections?.length || 0) > 1;
    const body = multi
      ? `${compactBetSummary(bet)}<div class="bet-multi-details" hidden>${bet.selections.map((selection,index) => expandedMultiSelection(selection,bet,index)).join('')}</div>`
      : bet.selections.map((selection,index) => selectionRow(selection,bet,index)).join('');
    return `<article class="bet-record${multi ? ' bet-record-multi' : ''}" data-bet-id="${esc(bet.id)}"><div class="bet-record-date">№${esc(bet.number || (visible.length - visible.indexOf(bet)))} · ${esc(date(bet.date))}</div>${body}<dl class="bet-payment"><div><dt>${esc(t('Сума ставки'))}</dt><dd>${amount(bet.cost)}</dd></div><div class="${settled && bet.payout > 0 ? 'positive' : ''}"><dt>${esc(paymentLabel)}</dt><dd>${amount(settled ? bet.payout : bet.potential)}</dd></div></dl><div class="bet-record-actions">${editing ? `<button class="edit-bet" data-action="edit-bet" data-value="${esc(bet.id)}">${icon('pencil')}${esc(t('Редагувати'))}</button>` : ''}${!settled ? `<button data-action="repeat-bet" data-value="${esc(bet.id)}">${icon('rotate-cw')}${esc(t('Повторити'))}</button>` : ''}<button data-action="share-bet" data-value="${esc(bet.id)}" aria-label="${esc(t('Поділитися ставкою'))}">${icon('share')}${settled ? esc(t('Поділитися')) : ''}</button></div></article>`;
  }).join('');

  return `${tabs}<div class="bet-records">${cards || `<div class="empty">${icon('ticket')}<h2>${esc(t(settled ? 'Розрахованих ставок ще немає' : 'Нерозрахованих ставок немає'))}</h2></div>`}</div>`;
}

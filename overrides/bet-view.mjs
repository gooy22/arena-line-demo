import { icon, graphic } from './ui.mjs';
import { getLocale } from './i18n.mjs';

export const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
export const amount = value => `${new Intl.NumberFormat('uk-UA', { minimumFractionDigits:2, maximumFractionDigits:2 }).format((value || 0) / 100).replace(',', '.')} €`;
const date = value => new Date(value).toLocaleString(getLocale(), { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
const games = { CSGO:'counter-strike', CS:'counter-strike', DOTA2:'dota', LOL:'lol', F:'football', T:'tennis', TT:'table-tennis', H:'hockey', B:'basketball', VB:'volleyball', PL:'snooker' };

function selectionRow(selection, bet, index) {
  const result = selection.settlement;
  const state = result?.status;
  const teams = selection.competitors?.length ? selection.competitors : selection.eventName.split(' - ').map(name => ({ name }));
  const score = result?.score;
  const symbol = state ? `<span class="bet-result result-${esc(state)}">${icon(state === 'won' ? 'check' : state === 'lost' ? 'x' : 'minus')}</span>` : `<span class="bet-sport">${graphic(selection.sport === 'CS' || !games[selection.sport] || ['CSGO','DOTA2','LOL'].includes(selection.subsport) ? 'esports' : games[selection.sport])}</span>`;
  const periods = result?.periods || [];
  return `<section class="bet-selection"><button class="bet-selection-summary" data-action="bet-event" data-value="${esc(bet.id)}:${index}">${symbol}<span class="bet-selection-label"><span class="meta">${esc(selection.marketName)}</span><strong>${esc(selection.label)}</strong></span><span class="bet-coefficient">${Number(selection.odds.toFixed(2))}</span>${icon('chevron-right')}</button><div class="bet-event-time">${esc(date(selection.startTime ? selection.startTime * 1000 : bet.date))}</div><div class="bet-teams">${periods.length ? `<div class="bet-period-labels"><span></span><span>${periods.map((_,i) => `<small>${i+1}</small>`).join('')}<small></small></span></div>` : ''}${teams.map((team,i) => `<div><span>${esc(team.name)}</span>${score ? `<span class="bet-team-score">${periods.map(period => `<small>${esc(period[i])}</small>`).join('')}<b>${esc(score[i] ?? '')}</b></span>` : ''}</div>`).join('')}</div></section>`;
}

export function betHistory(account, tab, editing = false) {
  const settled = tab === 'settled';
  const visible = account.bets.filter(bet => !bet.hidden).sort((a,b) => Number(b.number || 0) - Number(a.number || 0) || new Date(b.date) - new Date(a.date));
  const entries = visible.filter(bet => settled ? bet.status !== 'open' : bet.status === 'open');
  const tabs = `<div class="tabs bet-history-tabs" role="tablist"><button role="tab" aria-selected="${!settled}" class="${!settled ? 'active' : ''}" data-action="bet-tab" data-value="open">Нерозраховані</button><button role="tab" aria-selected="${settled}" class="${settled ? 'active' : ''}" data-action="bet-tab" data-value="settled">Розраховані</button></div>`;
  const cards = entries.map(bet => { const statusLabel = bet.status === 'cashout' ? 'Cash-out' : bet.status === 'won' ? 'Виграна' : bet.status === 'lost' ? 'Програна' : bet.status === 'void' ? 'Повернення' : ''; return `<article class="bet-record" data-bet-id="${esc(bet.id)}"><div class="bet-record-date">№${esc(bet.number || (visible.length - visible.indexOf(bet)))} · ${esc(date(bet.date))}${bet.type !== 'single' ? `<span>${bet.type === 'express' ? 'Експрес' : 'Система'}</span>` : ''}${statusLabel ? `<span class="bet-status-pill status-${esc(bet.status)}">${esc(statusLabel)}</span>` : ''}</div>${bet.selections.map((selection,index) => selectionRow(selection,bet,index)).join('')}<dl class="bet-payment"><div><dt>Сума ставки</dt><dd>${amount(bet.cost)}</dd></div><div class="${settled && bet.payout > 0 ? 'positive' : ''}"><dt>${settled ? 'Виплата' : 'Можлива виплата'}</dt><dd>${amount(settled ? bet.payout : bet.potential)}</dd></div></dl><div class="bet-record-actions">${editing ? `<button class="edit-bet" data-action="edit-bet" data-value="${esc(bet.id)}">${icon('pencil')}Edit</button>` : ''}${!settled ? `<button data-action="repeat-bet" data-value="${esc(bet.id)}">${icon('rotate-cw')}Повторити</button>` : ''}<button data-action="share-bet" data-value="${esc(bet.id)}" aria-label="Поділитися ставкою">${icon('share')}${settled ? 'Поділитися' : ''}</button></div></article>`; }).join('');
  return `${tabs}<div class="bet-records">${cards || `<div class="empty">${icon('ticket')}<h2>${settled ? 'Розрахованих ставок ще немає' : 'Нерозрахованих ставок немає'}</h2></div>`}</div>`;
}

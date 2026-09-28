import { teamEmblem } from './team-emblem.mjs';
import { getLocale } from './i18n.mjs';
import { icon, graphic } from './ui.mjs';
import { esc } from './bet-view.mjs';
import { periodName, MARKET_NAMES } from './feed.mjs';
import { parseScore } from './settlement.mjs';
const sports = { CS:'Кіберспорт', F:'Футбол', T:'Теніс', TT:'Настільний теніс', H:'Хокей', B:'Баскетбол', VB:'Волейбол', PL:'Снукер' };
const games = { 'Counter-Strike':'counter-strike', 'Dota 2':'dota', 'League of Legends':'lol' };
const scoreTypes = { CS:[1006,1], F:[1,4], T:[1009,1], TT:[1009,1], H:[1,5], B:[1010,8], VB:[1009,1], PL:[1001,1] };
const dateText = value => new Date(value).toLocaleString(getLocale(), { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
const isTeam = (candidate, team) => team.id && candidate.id ? String(candidate.id) === String(team.id) : candidate.name?.trim() === team.name?.trim();
const includesTeam = (row, team) => row.competitors?.some(candidate => isTeam(candidate, team));

export function eventHeader(app, event) {
  const completed=completedResult(app,event);
  if(completed){
    return `<div class="event-header-inner completed-event-header-inner"><button data-action="sports-event-back" aria-label="Назад">${icon('chevron-left')}</button><div class="event-heading"><h1>${esc(sports[event.sport] || 'Спорт')}</h1></div><button data-action="sports-event-alert" aria-label="Сповіщення про матч">${icon('bell')}</button></div>`;
  }
  return `<div class="event-header-inner"><button data-action="sports-event-back" aria-label="Назад">${icon('chevron-left')}</button><div class="event-heading"><h1>${esc(sports[event.sport] || 'Спорт')}</h1><p>${esc([event.categoryName, event.tournamentName].filter(Boolean).join('. '))}</p></div><button class="favorite ${app.favorites.has(app.detailId) ? 'selected' : ''}" data-action="sports-favorite" data-value="${esc(app.detailId)}" aria-label="Вибране">${icon('star')}</button><button data-action="sports-event-alert" aria-label="Сповіщення про матч">${icon('bell')}</button></div>`;
}

function form(history, team) {
  return history.filter(row => includesTeam(row, team)).slice(0,5).map(row => {
    const competitor = row.competitors.find(candidate => isTeam(candidate,team));
    const drawn = row.competitors.length === 2 && row.competitors[0].score === row.competitors[1].score;
    const state = competitor.isWinner ? 'W' : drawn ? 'D' : 'L';
    return `<span class="form-${state}" title="${esc(row.name)}">${state}</span>`;
  }).join('');
}

function parsedSavedResult(result) {
  if (!result) return null;
  const total = Array.isArray(result.score) && result.score.length >= 2
    ? result.score.slice(0,2).map(Number)
    : null;
  let periods = Array.isArray(result.periods)
    ? result.periods.filter(row => Array.isArray(row) && row.length >= 2).map(row => row.slice(0,2).map(Number))
    : [];
  const duplicateManual = result.manual && periods.length === 1 && total &&
    periods[0][0] === total[0] && periods[0][1] === total[1];
  if (duplicateManual) periods = [];
  return {
    confirmed:true,
    saved:true,
    scoreText:total ? total.join('-') : '',
    score:total,
    periods,
    winnerIndex:result.winnerIndex,
    status:result.status,
    source:result.source || 'saved-bet'
  };
}

function completedResult(app,event) {
  return app.results.results.get(String(app.detailId)) || parsedSavedResult(event.settlement);
}

function completedScore(result) {
  if (!result) return {total:null,periods:[]};
  const total = Array.isArray(result.score) && result.score.length >= 2
    ? result.score.slice(0,2).map(Number)
    : (() => {
        const match=/^(\d+)-(\d+)/.exec(String(result.scoreText || ''));
        return match ? [Number(match[1]),Number(match[2])] : null;
      })();
  let periods = Array.isArray(result.periods)
    ? result.periods.filter(row => Array.isArray(row) && row.length >= 2).map(row => row.slice(0,2).map(Number))
    : [];
  if (!periods.length) {
    const match=/\((\d+-\d+(?:,\s*\d+-\d+)*)\)/.exec(String(result.scoreText || ''));
    if (match) periods=match[1].split(/,\s*/).map(row=>row.split('-').map(Number));
  }
  if (!periods.length && total && Number.isFinite(total[0]) && Number.isFinite(total[1])) {
    const played=Math.max(0,Math.min(5,Number(total[0])+Number(total[1])));
    if(played) periods=Array.from({length:played},()=>[null,null]);
  }
  return {total,periods};
}

function resultTable(event,result) {
  const teams=(event.competitors || []).slice(0,2);
  const {total,periods}=completedScore(result);
  const cols=periods.map((_,index)=>`<span>${index+1}</span>`).join('');
  return `<div class="completed-score-table">
    <div class="completed-score-head"><span></span><div>${cols}<b>T</b></div></div>
    ${teams.map((team,index)=>`<div class="completed-score-row"><span>${esc(team.name || '')}</span><div>${periods.map(period=>`<small>${esc(period[index] ?? '—')}</small>`).join('')}<b>${esc(total?.[index] ?? '—')}</b></div></div>`).join('')}
  </div>`;
}

function completedOverview(app,event,result) {
  const teams=(event.competitors || []).slice(0,2);
  const {total}=completedScore(result);
  const scoreText=total ? total.join(':') : '—:—';
  return `<section class="completed-match-card">
    <nav class="completed-match-tabs">
      <button class="active" type="button" aria-label="Рахунок"><span class="completed-score-pill">${esc(scoreText)}</span></button>
      <button type="button" data-action="sports-event-tab" data-value="h2h">H2H</button>
    </nav>
    <div class="completed-match-scoreboard">
      ${teams.map((team,index)=>`<div class="completed-team team-${index}">
        <span class="completed-team-emblem">${teamEmblem({...team,categoryName:team.categoryName || event.categoryName || event.sport})}</span>
        <strong>${esc(team.name || '')}</strong>
      </div>`).join('')}
      <div class="completed-center"><span>ЗАВЕРШЕНО</span><b>${esc(scoreText)}</b></div>
    </div>
    ${resultTable(event,result)}
  </section>`;
}

function overview(app, event, completed) {
  const teams = event.competitors || [], history = app.detailHistory || [];
  const [type, period] = scoreTypes[event.sport] || [];
  const savedScore=completedScore(completed).total;
  const score = completed ? savedScore : event.scoreboard?.scores?.find(row => row.periodScoreType === type && row.period === period)?.score?.split('-');
  const h2h = history.filter(row => teams.length === 2 && teams.every(team => includesTeam(row,team)));
  const wins = teams.map(team => h2h.filter(row => row.competitors.some(candidate => isTeam(candidate,team) && candidate.isWinner)).length);
  const today = event.startTime && new Date(event.startTime * 1000).toDateString() === new Date().toDateString();
  const subtitle = completed ? 'ЗАВЕРШЕНО' : event.stage === 2 ? app.status(event) : today ? 'СЬОГОДНІ' : event.startTime ? new Date(event.startTime * 1000).toLocaleDateString(getLocale(), { day:'2-digit',month:'short' }) : '';
  const center = score?.length ? score.join(' : ') : event.startTime ? new Date(event.startTime * 1000).toLocaleTimeString(getLocale(), { hour:'2-digit', minute:'2-digit' }) : '—';
  return `<section class="event-scoreboard">${teams.slice(0,2).map((team,i) => `<div class="event-team team-${i}"><span class="event-team-emblem">${teamEmblem({...team,categoryName:team.categoryName || event.categoryName || event.sport})}</span><div>${esc(team.name)}</div><div class="event-form">${form(history,team)}</div></div>`).join('')}<div class="event-score-center"><span class="event-kickoff ${event.stage === 2 && !completed ? 'live-text' : ''}">${esc(subtitle)}</span><strong>${esc(center)}</strong>${h2h.length ? `<div class="event-h2h-count"><span>${wins[0]}<small>W</small></span><span>${h2h.length-wins[0]-wins[1]}<small>D</small></span><span>${wins[1]}<small>W</small></span></div>` : ''}</div></section>`;
}

function historyRows(rows) {
  return rows.map(row => `<div class="h2h-row"><div class="h2h-date">${esc(dateText(row.startTime))}<small>${esc(row.tournament || '')}</small></div><div class="h2h-teams">${row.competitors.map(team => `<div class="${team.isWinner ? 'h2h-winner' : ''}"><span>${esc(team.name)}</span><b>${esc(team.score ?? '—')}</b></div>`).join('')}</div></div>`).join('');
}

function headToHead(app, event) {
  if (app.detailHistoryState === 'loading') return '<div class="event-data-state"><span class="spinner"></span>Завантаження історії зустрічей</div>';
  if (app.detailHistoryState === 'error') return '<div class="event-data-state">Історія зустрічей тимчасово недоступна.<button data-action="sports-event-retry">Оновити</button></div>';
  const history = app.detailHistory || [], teams = event.competitors || [];
  const h2h = history.filter(row => teams.length === 2 && teams.every(team => includesTeam(row,team)));
  return `<section class="event-history-block"><h2>Особисті зустрічі</h2>${h2h.length ? historyRows(h2h) : '<p class="event-data-state">В історії джерела немає особистих зустрічей цих команд.</p>'}</section>${teams.map(team => `<section class="event-history-block"><h2>${esc(team.name)} · останні матчі</h2>${historyRows(history.filter(row => includesTeam(row,team)).slice(0,5)) || '<p class="event-data-state">Історія поки недоступна</p>'}</section>`).join('')}`;
}

function oddsOverview(app, picks) {
  const main = picks.filter(pick => pick.period === 0 && [1,2].includes(pick.marketType));
  return `<section class="odds-overview"><h2>Огляд коефіцієнтів</h2>${main.length ? `<table><thead><tr><th>Результат</th><th>При відкритті</th><th>Зараз</th></tr></thead><tbody>${main.map(pick => {
    const first = app.detailOdds.get(pick.id)?.[0]?.odds ?? pick.odds;
    return `<tr><th>${esc(pick.label)}</th><td>${first.toFixed(2)}</td><td class="${pick.odds > first ? 'positive' : pick.odds < first ? 'live-text' : ''}">${app.oddButton(pick)}</td></tr>`;
  }).join('')}</tbody></table><p class="odds-history-note">Зміни з моменту відкриття цієї сторінки. Поточні коефіцієнти оновлюються з лінії.</p>` : '<p class="event-data-state">Для цього матчу зараз немає доступних коефіцієнтів.</p>'}</section>`;
}

export function eventPage(app, event) {
  const completed = completedResult(app,event);
  const picks = completed ? [] : app.feed.selections(app.detailId);
  for (const pick of picks) {
    const history = app.detailOdds.get(pick.id) || [];
    if (history.at(-1)?.odds !== pick.odds) history.push({ time:Date.now(), odds:pick.odds });
    if (history.length > 200) history.splice(1,1);
    app.detailOdds.set(pick.id, history);
  }
  const tabs = `<nav class="event-view-tabs" role="tablist" aria-label="Інформація про матч">${[['overview','Огляд матчу',icon('sports-score')],['h2h','H2H','H2H'],['odds','Огляд коефіцієнтів',icon('chart-no-axes-combined')]].map(([value,label,content]) => `<button role="tab" aria-label="${label}" aria-selected="${app.detailTab === value}" class="${app.detailTab === value ? 'active' : ''}" data-action="sports-event-tab" data-value="${value}">${content}</button>`).join('')}</nav>`;
  const periods = [...new Set(picks.map(pick => pick.period).filter(Boolean))].sort((a,b) => a-b);
  const filters = [['all','Всі'],['main','Основне'],...periods.map(period => [String(period),periodName(event.sport,period)])];
  const filtered = picks.filter(pick => app.detailFilter === 'all' || app.detailFilter === 'main' && pick.period === 0 || String(pick.period) === app.detailFilter);
  const groups = new Map();
  for (const pick of filtered) {
    const key = `${pick.marketType}:${pick.period}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(pick);
  }
  const markets = [...groups].map(([key, group]) => {
    const rows = new Map();
    for (const pick of group) { const line = JSON.stringify(pick.parameters); if (!rows.has(line)) rows.set(line, []); rows.get(line).push(pick); }
    const closed = app.detailCollapsed.has(key);
    return `<section class="event-market"><button class="event-market-heading" data-action="sports-event-market" data-value="${key}" aria-expanded="${!closed}"><h2>${esc(app.detailFilter === 'all' ? group[0].marketName : MARKET_NAMES[group[0].marketType])}</h2>${icon(closed ? 'chevron-down' : 'chevron-up')}</button>${closed ? '' : [...rows.values()].map(row => `<div class="outcomes">${row.map(pick => app.oddButton(pick)).join('')}</div>`).join('')}</section>`;
  }).join('');
  if (completed) {
    const content = app.detailTab === 'h2h' ? headToHead(app,event) : completedOverview(app,event,completed);
    return `<div class="event-page completed-event-page">${content}</div>`;
  }
  const content = app.detailTab === 'h2h' ? headToHead(app,event) : app.detailTab === 'odds' ? oddsOverview(app,picks) : overview(app,event,completed);
  return `<div class="event-page"><button class="all-events-link" data-action="sports-event-back">Всі події ${icon('chevron-down')}</button>${tabs}${content}<nav class="event-market-filters" aria-label="Ринки матчу">${filters.map(([value,label]) => `<button class="${value === app.detailFilter ? 'active' : ''}" data-action="sports-event-filter" data-value="${value}">${esc(label)}</button>`).join('')}</nav><div class="event-markets">${markets || `<div class="event-data-state">${app.feed.fresh ? 'Ринки цього матчу зараз недоступні' : 'Завантаження коефіцієнтів…'}</div>`}</div></div>`;
}

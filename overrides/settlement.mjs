// Only confirmed results from the provider's completed-event archive are eligible.
export function selectionIdentity(selection) {
  try {
    const [market, item, outcome] = JSON.parse(decodeURIComponent(selection.id));
    return { ...selection, marketType: market.marketType, period: market.period,
      resultKind: market.resultKind, parameters: item.marketParameters || [],
      outcomeType: outcome.type, outcomeValues: outcome.values || [] };
  } catch { return selection; }
}

export function parseScore(value) {
  const match = /^(\d+)-(\d+)(?:\s*\((\d+-\d+(?:,\s*\d+-\d+)*)\))?$/.exec(String(value).trim());
  if (!match) return null;
  return { total: [+match[1], +match[2]], periods: match[3] ? match[3].split(/,\s*/).map(p => p.split('-').map(Number)) : [] };
}

const sumScores = periods => periods.reduce((total, pair) => total.map((value, i) => value + pair[i]), [0, 0]);
const marginFactor = (margin, odds) => margin > 0 ? odds : margin < 0 ? 0 : 1;
function lineFactor(margin, line, odds) {
  // Quarter Asian lines split the stake over the two neighboring half lines.
  const quarter = Math.abs(line * 4 % 2) === 1;
  return quarter ? (marginFactor(margin - .25, odds) + marginFactor(margin + .25, odds)) / 2 : marginFactor(margin, odds);
}

export function settleSelection(original, result) {
  const s = selectionIdentity(original);
  if (!result?.confirmed || String(result.id) !== String(s.eventId) || s.resultKind !== 1) return null;
  if (result.cancelled === true) return { status:'void', factor:1, source:result.source, score:null };
  if (result.winnerOnly) {
    const period=Number(s.period || 0);
    const market=Number(s.marketType);
    const bo1MapWinner = Number(result.bestOf) === 1 && Number(result.mapsPlayed) === 1 && period === 1 && market === 1;
    const fullMatchWinner = period === 0 && market === 1;
    if ((!fullMatchWinner && !bo1MapWinner) || ![0,3].includes(s.outcomeType) || ![0,1].includes(result.winnerIndex) || !Number.isFinite(s.odds)) return null;
    const won = (s.outcomeType === 0 ? 0 : 1) === result.winnerIndex;
    return {
      status:won ? 'won' : 'lost',
      factor:won ? s.odds : 0,
      winnerIndex:result.winnerIndex,
      source:result.source,
      score:Array.isArray(result.score) ? result.score : null,
      scoreText:result.scoreText
    };
  }
  const parsed = parseScore(result.scoreText);
  if (!parsed || result.type !== 0 || !Number.isFinite(s.odds)) return null;
  const { total, periods } = parsed, period = Number(s.period || 0), market = Number(s.marketType);
  const sport = s.sport || result.sport;
  const category = s.categoryName || result.categoryName || '';
  const isEsport = sport === 'CS';
  if (isEsport && result.seriesComplete && Number.isInteger(result.mapsPlayed) && period > result.mapsPlayed && period <= result.bestOf) {
    return {status:'void', factor:1, score:total, periods, source:result.source, scoreText:result.scoreText};
  }
  const isMoba = isEsport && !/Counter-Strike|Valorant|Rainbow6/i.test(category);
  let score = period ? periods[period - 1] : total;
  // A confirmed completed series may end before a later map is played.
  if (!score && isEsport && period >= 1 && period <= 9 && periods.length > 0 && periods.length === total[0] + total[1] && total[0] !== total[1]) {
    return { status:'void', factor:1, score:total, periods, source:result.source, scoreText:result.scoreText };
  }
  if (!score) return null;
  // Kills are not wins in Dota/LoL. Only a sweep proves each played map's winner.
  if (isMoba && period && [1, 2].includes(market)) {
    if ([0,1].includes(result.periodWinners?.[period-1])) score = result.periodWinners[period-1] === 0 ? [1,0] : [0,1];
    else if (total[0] === 0 && total[1] === periods.length) score = [0, 1];
    else if (total[1] === 0 && total[0] === periods.length) score = [1, 0];
    else return null;
  }
  if (!period && [4, 5, 6].includes(market) && (isEsport || ['T','TT','VB'].includes(sport))) {
    if (!periods.length || periods.length !== total[0] + total[1]) return null;
    score = sumScores(periods);
  }
  if ([260, 264].includes(market)) {
    if (period) return null;
    score = total;
  }
  const [home, away] = score, type = s.outcomeType;
  const line = Number(s.parameters?.[0]);
  let factor;
  if ([1, 2].includes(market) && [0, 1, 3].includes(type)) {
    const won = type === 0 ? home > away : type === 3 ? away > home : home === away;
    factor = won ? s.odds : market === 1 && home === away ? 1 : 0;
  } else if ([4, 260].includes(market) && [86, 87].includes(type) && Number.isFinite(line)) {
    const margin = home - away + line;
    factor = lineFactor(type === 86 ? margin : -margin, line, s.odds);
  } else if ([5, 264].includes(market) && [4, 5].includes(type) && Number.isFinite(line)) {
    const margin = home + away - line;
    factor = lineFactor(type === 4 ? margin : -margin, line, s.odds);
  } else if (market === 6 && [6, 7].includes(type)) {
    factor = (home + away) % 2 === (type === 6 ? 0 : 1) ? s.odds : 0;
  } else if (market === 16 && type === 102 && s.outcomeValues?.length === 2) {
    factor = home === Number(s.outcomeValues[0]) && away === Number(s.outcomeValues[1]) ? s.odds : 0;
  } else return null;
  return { status:factor === 1 ? 'void' : factor > 1 ? 'won' : 'lost', factor,
    score:total, periods, source:result.source, scoreText:result.scoreText };
}

export function settledBetTotals(bet) {
  const size = bet.type === 'express' ? bet.selections.length : bet.type === 'system' ? bet.systemSize : 1;
  if (!Number.isInteger(size) || size < 1 || size > bet.selections.length) return null;
  const combinations = [];
  function choose(start, picks) {
    if (picks.length === size) { combinations.push(picks); return; }
    for (let i = start; i <= bet.selections.length - size + picks.length; i++) choose(i + 1, [...picks, bet.selections[i]]);
  }
  choose(0, []);
  let payout = 0;
  for (const picks of combinations) {
    if (picks.some(pick => pick.settlement?.factor === 0)) continue;
    if (picks.some(pick => !Number.isFinite(pick.settlement?.factor))) return null;
    payout += Math.round(bet.stake * picks.reduce((factor, pick) => factor * pick.settlement.factor, 1));
  }
  if (!Number.isSafeInteger(payout) || payout < 0) return null;
  return { payout, status:payout > bet.cost ? 'won' : payout === bet.cost ? 'void' : 'lost' };
}

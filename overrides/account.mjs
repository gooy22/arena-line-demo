import { settleSelection, settledBetTotals } from './settlement.mjs';
export const INITIAL_BALANCE = 13459900;
export const EMAIL = 'hoolop22@gmail.com';
const KEY = 'arena-accounts-v1';
const SESSION = 'arena-session-v1';
const HASH = 'ed2d59a0e72ca1446a5a9f29e8901b59ed32cb779132055220400527ca2531bc';
const PROFILE_API = '/api/profile';
const clone = value => typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
const accountStamp = account => {
  account.updatedAt = new Date().toISOString();
  account.profileRevision = Math.max(0, Number(account.profileRevision || 0)) + 1;
  return account;
};
function authHeaders(account) {
  return {
    'content-type':'application/json',
    'authorization':'Bearer ' + String(account?.hash || '')
  };
}
export const money = value => new Intl.NumberFormat('ru-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value / 100);
export function cents(value) {
  if (!/^\d{1,9}([.,]\d{1,2})?$/.test(String(value).trim())) throw new Error('Укажите сумму с точностью до копеек');
  const result = Math.round(Number(String(value).replace(',', '.')) * 100);
  if (result <= 0 || !Number.isSafeInteger(result)) throw new Error('Сумма должна быть больше нуля');
  return result;
}
export async function digest(password) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
export function betTotals(stake, selections, type = 'single', systemSize = 2) {
  if (!Array.isArray(selections) || !selections.length || selections.length > 10) throw new Error('Добавьте исход в купон');
  const size = type === 'single' ? 1 : type === 'express' ? selections.length : systemSize;
  if (!['single', 'express', 'system'].includes(type) || !Number.isInteger(size) || size < 1 || size > selections.length) throw new Error('Проверьте тип купона');
  if (type === 'express' && selections.length < 2) throw new Error('Добавьте минимум два исхода');
  if (type === 'system' && (selections.length < 3 || size < 2 || size >= selections.length)) throw new Error('Для системы добавьте минимум три исхода');
  if (new Set(selections.map(s => s.id)).size !== selections.length) throw new Error('В купоне повторяется исход');
  if (type !== 'single' && new Set(selections.map(s => s.eventId)).size !== selections.length) throw new Error('В экспрессе или системе нельзя выбрать два исхода одного матча');
  const combinations = [];
  function choose(start, remaining, factor) {
    if (!remaining) { combinations.push(factor); return; }
    for (let i = start; i <= selections.length - remaining; i++) choose(i + 1, remaining - 1, factor * selections[i].odds);
  }
  choose(0, size, 1);
  const cost = stake * combinations.length;
  const potential = combinations.reduce((sum, odds) => sum + Math.round(stake * odds), 0);
  if (!Number.isSafeInteger(cost) || !Number.isSafeInteger(potential)) throw new Error('Слишком большая сумма купона');
  return { cost, potential, odds: potential / cost, combinations: combinations.length };
}
// Device-local simulation only; no authorization or transactions at Parik24.
export class Accounts {
  constructor(storage) {
    this.storage = storage;
    this.syncChain = Promise.resolve();
  }
  _write(data) {
    this.storage.setItem(KEY, JSON.stringify(data));
  }
  _replaceLocal(profile) {
    if (!profile?.email) return null;
    const data = this.read();
    const index = data.findIndex(account => account.email === profile.email);
    if (index >= 0) data[index] = clone(profile);
    else data.push(clone(profile));
    this._write(data);
    return data[index >= 0 ? index : data.length - 1];
  }
  _queueSync(account) {
    if (!account?.email || !account?.hash) return;
    const snapshot = clone(account);
    this.syncChain = this.syncChain.catch(() => {}).then(async () => {
      const response = await fetch(PROFILE_API + '/sync', {
        method:'POST',
        headers:authHeaders(snapshot),
        body:JSON.stringify({ profile:snapshot }),
        keepalive:true
      });
      if (response.status === 409) {
        const value = await response.json().catch(() => null);
        if (value?.profile) this._replaceLocal(value.profile);
        return;
      }
      if (!response.ok) return;
      const value = await response.json().catch(() => null);
      if (value?.profile) this._replaceLocal(value.profile);
    });
  }
  _persist(data, account) {
    if (account) accountStamp(account);
    this._write(data);
    if (account) this._queueSync(account);
  }
  async syncCurrentFromServer() {
    const local = this.current();
    if (!local?.email || !local?.hash) return local;
    try {
      const response = await fetch(PROFILE_API + '?email=' + encodeURIComponent(local.email), {
        headers:{ authorization:'Bearer ' + local.hash },
        cache:'no-store'
      });
      if (response.status === 404) {
        this._queueSync(local);
        return local;
      }
      if (!response.ok) return local;
      const value = await response.json();
      const remote = value?.profile;
      if (!remote) return local;
      const remoteRevision = Number(remote.profileRevision || 0);
      const localRevision = Number(local.profileRevision || 0);
      const remoteTime = Date.parse(remote.updatedAt || 0) || 0;
      const localTime = Date.parse(local.updatedAt || 0) || 0;
      if (remoteRevision > localRevision || (remoteRevision === localRevision && remoteTime >= localTime)) {
        return this._replaceLocal(remote);
      }
      this._queueSync(local);
      return local;
    } catch {
      return local;
    }
  }
  read() {
    const raw = this.storage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (!Array.isArray(data) || data.some(a => !a.email || !Number.isSafeInteger(a.balance) || a.balance < 0 || !Array.isArray(a.payments))) throw new Error('Не удалось прочитать данные профиля');
      data.forEach(a => { if (!Array.isArray(a.bets)) a.bets = []; });
      return data;
    }
    let balance = INITIAL_BALANCE;
    try {
      const legacy = JSON.parse(this.storage.getItem('line-demo-profile-v1'));
      if (legacy && Number.isSafeInteger(legacy.balance) && legacy.balance >= 0) balance = legacy.balance;
    } catch { /* Ignore obsolete prototype data. */ }
    const data = [{ id: 'AL100001', email: EMAIL, firstName: 'Роман', lastName: 'Тополя', hash: HASH, balance, payments: [], bets: [] }];
    this._write(data);
    return data;
  }
  current() {
    const email = this.storage.getItem(SESSION);
    return email ? this.read().find(a => a.email === email) || null : null;
  }
  async signIn(email, password) {
    email = email.trim().toLowerCase();
    const hash = await digest(password);
    let account = this.read().find(a => a.email === email && a.hash === hash) || null;
    try {
      const response = await fetch(PROFILE_API + '/login', {
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({email,hash}),
        cache:'no-store'
      });
      if (response.ok) {
        const value = await response.json();
        if (value?.profile) account = this._replaceLocal(value.profile);
      } else if (response.status === 401) {
        throw new Error('Неверная почта или пароль');
      } else if (response.status === 404 && account) {
        this._queueSync(account);
      }
    } catch (error) {
      if (error?.message === 'Неверная почта или пароль') throw error;
    }
    if (!account) throw new Error('Неверная почта или пароль');
    this.storage.setItem(SESSION, account.email);
    this.syncCurrentFromServer().catch(() => {});
    return account;
  }
  async signUp({ email, password, firstName, lastName }) {
    email = email.trim().toLowerCase(); firstName = firstName.trim(); lastName = lastName.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Проверьте адрес почты');
    if (password.length < 8) throw new Error('Пароль должен содержать минимум 8 символов');
    if (!firstName || !lastName || firstName.length > 80 || lastName.length > 80) throw new Error('Укажите имя и фамилию');
    const hash = await digest(password), data = this.read();
    if (data.some(a => a.email === email)) throw new Error('Этот аккаунт уже создан. Войдите по почте и паролю.');

    try {
      const response = await fetch(PROFILE_API + '/login', {
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({email,hash}),
        cache:'no-store'
      });
      if (response.status === 401 || response.ok) {
        throw new Error('Этот аккаунт уже создан. Войдите по почте и паролю.');
      }
    } catch (error) {
      if (error?.message === 'Этот аккаунт уже создан. Войдите по почте и паролю.') throw error;
    }

    const account = { id: crypto.randomUUID().slice(0, 8).toUpperCase(), email, firstName, lastName, hash, balance: 0, payments: [], bets: [], profileRevision:0, updatedAt:new Date().toISOString() };
    data.push(account);
    this._persist(data, account);
    this.storage.setItem(SESSION, email);
  }
  signOut() { this.storage.removeItem(SESSION); }
  placeBet({ id, stake, selections, type = 'single', systemSize = 2 }) {
    const data = this.read(), account = data.find(a => a.email === this.storage.getItem(SESSION));
    if (!account) throw new Error('Сначала войдите в аккаунт');
    if (!id || typeof id !== 'string') throw new Error('Не удалось создать купон');
    const existing = account.bets.find(b => b.id === id);
    if (existing) return existing;
    if (!Number.isSafeInteger(stake) || stake < 2000) throw new Error('Минимальная сумма ставки 20 €');
    if (!Array.isArray(selections) || !selections.length) throw new Error('Проверьте купон');
    if (selections.some(s => !s.id || !s.eventId || !s.eventName || !s.label || !Number.isFinite(s.odds) || s.odds <= 1 || s.odds > 10000)) throw new Error('Коэффициент недоступен');
    const totals = betTotals(stake, selections, type, systemSize);
    if (totals.cost > account.balance) throw new Error('Недостаточно средств');
    const bet = { id, number: Math.max(0, ...account.bets.map(b => b.number || 0), account.bets.length) + 1, type, stake, systemSize, ...totals, status: 'open', date: new Date().toISOString(), selections: structuredClone(selections) };
    account.balance -= totals.cost;
    account.bets.unshift(bet);
    this._persist(data, account);
    return bet;
  }
  hideBet(id) {
    const data = this.read(), account = data.find(a => a.email === this.storage.getItem(SESSION));
    const bet = account?.bets.find(b => b.id === id);
    if (!bet || bet.hidden) return false;
    // Removing a card never refunds a stake or reverses a credited payout.
    // Pending hidden bets still settle normally, preserving the balance ledger.
    bet.hidden = true;
    this._persist(data, account);
    return true;
  }
  settleBets(results) {
    const data = this.read(), account = data.find(a => a.email === this.storage.getItem(SESSION));
    if (!account) return { changed:false, settled:[] };
    const settled = []; let changed = false;
    for (const bet of account.bets) {
      if (bet.status !== 'open') continue;
      for (const selection of bet.selections) {
        if (selection.settlement) continue;
        const confirmed = results.get(String(selection.eventId));
        const result = settleSelection(selection, confirmed);
        if (result) {
          selection.settlement = { ...result, date:new Date().toISOString() };
          selection.sport ||= confirmed.sport; selection.categoryName ||= confirmed.categoryName;
          if (!selection.startTime && Number.isFinite(Date.parse(confirmed.startTime))) selection.startTime = Date.parse(confirmed.startTime) / 1000;
          if (!selection.competitors?.length && confirmed.competitors?.length) selection.competitors = confirmed.competitors.map(name => ({ name }));
          changed = true;
        }
      }
      const totals = settledBetTotals(bet);
      if (!totals) continue;
      if (!Number.isSafeInteger(account.balance + totals.payout)) throw new Error('Не вдалося зарахувати виплату');
      Object.assign(bet, totals, { settledAt:new Date().toISOString() });
      account.balance += totals.payout;
      account.payments.unshift({ id:`bet:${bet.id}`, type:'bet-payout', amount:totals.payout, betId:bet.id, date:bet.settledAt });
      settled.push(bet.id); changed = true;
    }
    // One atomic storage write records both the final status and its balance credit.
    if (changed) this._persist(data, account);
    return { changed, settled };
  }
  transfer(type, amount) {
    if (!['deposit', 'withdraw'].includes(type) || !Number.isSafeInteger(amount) || amount <= 0) throw new Error('Некорректная операция');
    const data = this.read(), account = data.find(a => a.email === this.storage.getItem(SESSION));
    if (!account) throw new Error('Сначала войдите в аккаунт');
    if (type === 'withdraw' && amount > account.balance) throw new Error('Недостаточно средств');
    const balance = account.balance + (type === 'deposit' ? amount : -amount);
    if (!Number.isSafeInteger(balance) || balance > 99999999999) throw new Error('Превышен лимит виртуального баланса');
    account.balance = balance;
    account.payments.unshift({ id: crypto.randomUUID(), type, amount, date: new Date().toISOString() });
    this._persist(data, account);
  }
  ensureBetNumbers(account) {
    const ordered = [...account.bets].sort((a,b) => new Date(a.date) - new Date(b.date));
    if (!ordered.length) return;
    const numbers = ordered.map(bet => Number(bet.number));
    const valid = numbers.every(number => Number.isSafeInteger(number)) &&
      new Set(numbers).size === numbers.length &&
      numbers.every((number,index) => index === 0 || number === numbers[index - 1] + 1);
    if (valid) return;

    // Preserve an existing external numbering range when repairing legacy data.
    // Bet numbers are not tied to 1..N: 498,499,500 is just as valid as 1,2,3.
    const finite = numbers.filter(Number.isSafeInteger);
    const latest = finite.length ? Math.max(...finite) : ordered.length;
    const first = latest - ordered.length + 1;
    ordered.forEach((bet,index) => { bet.number = first + index; });
  }
  editBet(id, changes = {}) {
    const data = this.read();
    const account = data.find(a => a.email === this.storage.getItem(SESSION));
    if (!account) throw new Error('Сначала войдите в аккаунт');
    this.ensureBetNumbers(account);
    const bet = account.bets.find(item => item.id === id);
    if (!bet) throw new Error('Ставка не найдена');

    const oldCost = Number(bet.cost || 0);
    const oldPayout = Number(bet.payout || 0);
    const oldNumber = Number(bet.number || 1);
    const nextStake = changes.stake == null ? Number(bet.stake) : Number(changes.stake);
    if (!Number.isSafeInteger(nextStake) || nextStake <= 0) throw new Error('Некорректная сумма ставки');

    const selections = clone(bet.selections || []);
    if (!selections.length) throw new Error('У ставки нет исходов');

    const teamNames = selection => (selection.competitors || [])
      .map(team => typeof team === 'string' ? team : team?.name)
      .filter(Boolean);

    const normalized = value => String(value || '').trim().toLowerCase();

    const chosenSide = selection => {
      if (selection.outcomeType === 0) return 0;
      if (selection.outcomeType === 3) return 1;
      if (/^П1$/i.test(selection.shortLabel || '')) return 0;
      if (/^П2$/i.test(selection.shortLabel || '')) return 1;

      const teams = teamNames(selection);
      const label = normalized(selection.label);
      if (teams[0] && label === normalized(teams[0])) return 0;
      if (teams[1] && label === normalized(teams[1])) return 1;

      try {
        const parsed = JSON.parse(decodeURIComponent(selection.id));
        const type = Number(parsed?.[2]?.type);
        if (type === 0) return 0;
        if (type === 3) return 1;
      } catch {}

      return null;
    };

    const makeScore = (a,b,index) => {
      const score = [a,b].map(value => value === '' || value == null ? null : Number(value));
      if (score.some(value => value != null && (!Number.isInteger(value) || value < 0 || value > 999))) {
        throw new Error(`Некорректный счёт матча #${index + 1}`);
      }
      return score;
    };

    if (Array.isArray(changes.odds)) {
      changes.odds.forEach((odd,index) => {
        if (odd == null || !selections[index]) return;
        odd = Number(odd);
        if (!Number.isFinite(odd) || odd <= 1 || odd > 10000) throw new Error('Некорректный коэффициент');
        selections[index].odds = odd;
      });
    } else if (changes.odds != null && selections.length === 1) {
      const odd = Number(changes.odds);
      if (!Number.isFinite(odd) || odd <= 1 || odd > 10000) throw new Error('Некорректный коэффициент');
      selections[0].odds = odd;
    }

    const selectionEdits = Array.isArray(changes.selectionEdits) ? changes.selectionEdits : null;

    if (selectionEdits) {
      selections.forEach((selection,index) => {
        const edit = selectionEdits[index];
        if (!edit) return;

        if (edit.odds != null) {
          const odd = Number(edit.odds);
          if (!Number.isFinite(odd) || odd <= 1 || odd > 10000) {
            throw new Error(`Некорректный коэффициент матча #${index + 1}`);
          }
          selection.odds = odd;
        }

        const state = String(edit.state || 'open');
        const score = makeScore(edit.score1,edit.score2,index);
        const previousSettlement = selection.settlement ? {...selection.settlement} : {};

        if (state === 'open') {
          delete selection.settlement;
          return;
        }

        if (state === 'void') {
          selection.settlement = {
            ...previousSettlement,
            status:'void',
            factor:1,
            manual:true,
            date:new Date().toISOString(),
            ...(score.every(value => value != null) ? {score,periods:[]} : {})
          };
          return;
        }

        if (state === 'winner') {
          const winnerIndex = Number(edit.winnerIndex);
          if (winnerIndex !== 0 && winnerIndex !== 1) {
            throw new Error(`Оберіть П1 або П2 як переможця матча #${index + 1}`);
          }

          const side = chosenSide(selection);
          if (side !== 0 && side !== 1) {
            throw new Error(`Не вдалося визначити, на П1 чи П2 була ставка в матчі #${index + 1}`);
          }

          const won = side === winnerIndex;
          selection.settlement = {
            ...previousSettlement,
            status:won ? 'won' : 'lost',
            factor:won ? selection.odds : 0,
            winnerIndex,
            manual:true,
            date:new Date().toISOString(),
            ...(score.every(value => value != null) ? {score,periods:[]} : {})
          };
          return;
        }

        throw new Error(`Некорректний стан матча #${index + 1}`);
      });
    }

    const totals = betTotals(nextStake, selections, bet.type, bet.systemSize);
    const requestedStatus = String(changes.status || bet.status || 'open');
    if (!['open','won','lost','void','cashout'].includes(requestedStatus)) throw new Error('Некорректный статус');

    let effectiveStatus = requestedStatus;
    let payout = 0;

    if (selectionEdits && requestedStatus !== 'cashout') {
      const derived = settledBetTotals({
        ...bet,
        stake:nextStake,
        selections,
        cost:totals.cost,
        type:bet.type,
        systemSize:bet.systemSize
      });

      if (derived) {
        effectiveStatus = derived.status;
        payout = derived.payout;
      } else {
        effectiveStatus = 'open';
        payout = 0;
      }
    } else if (requestedStatus === 'cashout') {
      payout = Number(changes.cashoutPayout ?? bet.payout ?? 0);
      if (!Number.isSafeInteger(payout) || payout < 0) throw new Error('Некорректная сумма cash-out');
    } else {
      if (requestedStatus === 'won') payout = totals.potential;
      if (requestedStatus === 'void') payout = totals.cost;
    }

    const nextBalance = account.balance + oldCost - totals.cost + payout - oldPayout;
    if (!Number.isSafeInteger(nextBalance) || nextBalance < 0) throw new Error('Недостаточно средств для изменения ставки');

    Object.assign(bet, {
      stake:nextStake,
      selections,
      ...totals,
      status:effectiveStatus,
      payout,
      manualEdit:true,
      editedAt:new Date().toISOString()
    });

    if (effectiveStatus === 'open') {
      delete bet.settledAt;
      bet.payout = 0;
    } else {
      bet.settledAt = new Date().toISOString();
    }

    const requestedNumber = Number(changes.number);
    if (!Number.isSafeInteger(requestedNumber) || requestedNumber < 1) throw new Error('Некорректный номер ставки');
    if (requestedNumber !== oldNumber) {
      const delta = requestedNumber - oldNumber;
      const shifted = account.bets.map(other => Number(other.number) + delta);
      if (shifted.some(number => !Number.isSafeInteger(number))) throw new Error('Некорректный номер ставки');
      account.bets.forEach((other,index) => { other.number = shifted[index]; });
      account.bets.sort((a,b) => Number(b.number || 0) - Number(a.number || 0));
    }

    account.balance = nextBalance;
    account.payments = account.payments.filter(payment => payment.id !== 'bet:' + bet.id);
    if (payout > 0 && effectiveStatus !== 'open') {
      account.payments.unshift({
        id:'bet:' + bet.id,
        type:effectiveStatus === 'cashout' ? 'bet-cashout' : 'bet-payout',
        amount:payout,
        betId:bet.id,
        date:bet.settledAt
      });
    }

    this._persist(data, account);
    return bet;
  }
    async password(oldPassword, newPassword) {
    if (newPassword.length < 8) throw new Error('Минимум 8 символов');
    const oldHash = await digest(oldPassword), newHash = await digest(newPassword);
    const data = this.read(), account = data.find(a => a.email === this.storage.getItem(SESSION));
    if (!account || account.hash !== oldHash) throw new Error('Текущий пароль неверен');
    try {
      const response = await fetch(PROFILE_API + '/password', {
        method:'POST',
        headers:{'content-type':'application/json','authorization':'Bearer ' + oldHash},
        body:JSON.stringify({email:account.email,newHash})
      });
      if (!response.ok && response.status !== 404) throw new Error('Не вдалося синхронізувати пароль');
    } catch (error) {
      if (error?.message === 'Не вдалося синхронізувати пароль') throw error;
    }
    account.hash = newHash;
    this._persist(data, account);
  }
}

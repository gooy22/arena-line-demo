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
    let account = this.read().find(a => a.email === email && a.hash === hash);
    if (!account) {
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
        }
      } catch {}
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
    const account = { id: crypto.randomUUID().slice(0, 8).toUpperCase(), email, firstName, lastName, hash, balance: 0, payments: [], bets: [], profileRevision:0, updatedAt:new Date().toISOString() };
    data.push(account);
    this._persist(data, account); this.storage.setItem(SESSION, email);
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
  normalizeBetNumbers(account) {
    const ordered = [...account.bets].sort((a,b) => new Date(a.date) - new Date(b.date));
    ordered.forEach((bet,index) => { bet.number = index + 1; });
  }
  editBet(id, changes = {}) {
    const data = this.read();
    const account = data.find(a => a.email === this.storage.getItem(SESSION));
    if (!account) throw new Error('Сначала войдите в аккаунт');
    this.normalizeBetNumbers(account);
    const bet = account.bets.find(item => item.id === id);
    if (!bet) throw new Error('Ставка не найдена');

    const oldCost = Number(bet.cost || 0);
    const oldPayout = Number(bet.payout || 0);
    const oldNumber = Number(bet.number || 1);
    const nextStake = changes.stake == null ? Number(bet.stake) : Number(changes.stake);
    if (!Number.isSafeInteger(nextStake) || nextStake <= 0) throw new Error('Некорректная сумма ставки');

    const selections = clone(bet.selections || []);
    if (!selections.length) throw new Error('У ставки нет исходов');

    if (Array.isArray(changes.odds)) {
      changes.odds.forEach((odd,index) => {
        if (odd == null) return;
        odd = Number(odd);
        if (!Number.isFinite(odd) || odd <= 1 || odd > 10000) throw new Error('Некорректный коэффициент');
        if (selections[index]) selections[index].odds = odd;
      });
    } else if (changes.odds != null && selections.length === 1) {
      const odd = Number(changes.odds);
      if (!Number.isFinite(odd) || odd <= 1 || odd > 10000) throw new Error('Некорректный коэффициент');
      selections[0].odds = odd;
    }

    const totals = betTotals(nextStake, selections, bet.type, bet.systemSize);
    const status = String(changes.status || bet.status || 'open');
    if (!['open','won','lost','void','cashout'].includes(status)) throw new Error('Некорректный статус');

    let payout = 0;
    if (status === 'won') payout = totals.potential;
    if (status === 'void') payout = totals.cost;
    if (status === 'cashout') {
      payout = Number(changes.cashoutPayout ?? bet.payout ?? 0);
      if (!Number.isSafeInteger(payout) || payout < 0) throw new Error('Некорректная сумма cash-out');
    }

    const winnerIndex = changes.winnerIndex == null || changes.winnerIndex === '' ? null : Number(changes.winnerIndex);
    const score = [changes.score1, changes.score2].map(value => value === '' || value == null ? null : Number(value));
    if (score.some(value => value != null && (!Number.isInteger(value) || value < 0 || value > 999))) throw new Error('Некорректный счёт');

    if (effectiveStatus === 'open') {
      for (const selection of selections) delete selection.settlement;
    } else {
      selections.forEach((selection,index) => {
        let selectionStatus = effectiveStatus === 'cashout' ? 'void' : effectiveStatus;
        if (winnerIndex === 0 || winnerIndex === 1) {
          const chosenSide = selection.outcomeType === 0 || /^П1$/i.test(selection.shortLabel || '') ? 0 :
            selection.outcomeType === 3 || /^П2$/i.test(selection.shortLabel || '') ? 1 : null;
          if (chosenSide != null) selectionStatus = chosenSide === winnerIndex ? 'won' : 'lost';
        }
        selection.settlement = {
          status:selectionStatus,
          manual:true,
          date:new Date().toISOString(),
          ...(score.every(value => value != null) ? { score, periods:[score] } : {})
        };
      });
      if ((winnerIndex === 0 || winnerIndex === 1) && selections.length === 1) {
        const chosenSide = selections[0].outcomeType === 0 || /^П1$/i.test(selections[0].shortLabel || '') ? 0 :
          selections[0].outcomeType === 3 || /^П2$/i.test(selections[0].shortLabel || '') ? 1 : null;
        if (chosenSide != null && effectiveStatus !== 'cashout') {
          effectiveStatus = chosenSide === winnerIndex ? 'won' : 'lost';
          payout = effectiveStatus === 'won' ? totals.potential : 0;
          selections[0].settlement.status = effectiveStatus;
        }
      }
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
    if (Number.isInteger(requestedNumber) && requestedNumber >= 1 && requestedNumber <= account.bets.length && requestedNumber !== oldNumber) {
      for (const other of account.bets) {
        if (other === bet) continue;
        const n = Number(other.number || 0);
        if (requestedNumber < oldNumber && n >= requestedNumber && n < oldNumber) other.number = n + 1;
        if (requestedNumber > oldNumber && n <= requestedNumber && n > oldNumber) other.number = n - 1;
      }
      bet.number = requestedNumber;
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

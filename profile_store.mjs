import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash, timingSafeEqual } from 'node:crypto';

const PRIMARY_DIR = process.env.PROFILE_DIR || '/data/profiles';
const FALLBACK_DIR = '/tmp/arena-line-profiles';

let directory = PRIMARY_DIR;
let readyPromise = null;
const locks = new Map();

const clone = value => JSON.parse(JSON.stringify(value));
const safeEmail = value => String(value || '').trim().toLowerCase();

function fileName(email) {
  return createHash('sha256').update(safeEmail(email)).digest('hex').slice(0,32) + '.json';
}

function safeEqual(a,b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && timingSafeEqual(aa,bb);
}

async function ensureDir() {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    try {
      await mkdir(PRIMARY_DIR,{recursive:true,mode:0o700});
      directory = PRIMARY_DIR;
    } catch {
      await mkdir(FALLBACK_DIR,{recursive:true,mode:0o700});
      directory = FALLBACK_DIR;
    }
    return directory;
  })();
  return readyPromise;
}

async function pathFor(email) {
  await ensureDir();
  return directory + '/' + fileName(email);
}

export function validateProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('Invalid profile');
  const email = safeEmail(profile.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Invalid profile email');
  if (!/^[a-f0-9]{64}$/i.test(String(profile.hash || ''))) throw new Error('Invalid profile credential');
  if (!Number.isSafeInteger(profile.balance) || profile.balance < 0 || profile.balance > 999999999999) throw new Error('Invalid profile balance');
  if (!Array.isArray(profile.payments) || profile.payments.length > 10000) throw new Error('Invalid payments');
  if (!Array.isArray(profile.bets) || profile.bets.length > 10000) throw new Error('Invalid bets');

  const raw = JSON.stringify(profile);
  if (Buffer.byteLength(raw) > 2_000_000) throw new Error('Profile is too large');

  const clean = clone(profile);
  clean.email = email;
  clean.id = String(clean.id || '').slice(0,80);
  clean.firstName = String(clean.firstName || '').slice(0,100);
  clean.lastName = String(clean.lastName || '').slice(0,100);
  clean.profileRevision = Math.max(0,Number(clean.profileRevision || 0));
  clean.updatedAt = new Date(clean.updatedAt || Date.now()).toISOString();
  return clean;
}

export async function readProfile(email) {
  const path = await pathFor(email);
  try {
    const value = JSON.parse(await readFile(path,'utf8'));
    return validateProfile(value);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function atomicWrite(email, profile) {
  const path = await pathFor(email);
  const temp = path + '.tmp-' + process.pid + '-' + Date.now();
  await writeFile(temp,JSON.stringify(profile,null,2),{mode:0o600});
  await rename(temp,path);
}

function withLock(email, fn) {
  const key = safeEmail(email);
  const previous = locks.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(fn).finally(() => {
    if (locks.get(key) === next) locks.delete(key);
  });
  locks.set(key,next);
  return next;
}

export async function loginProfile(email, hash) {
  const profile = await readProfile(email);
  if (!profile || !safeEqual(profile.hash,hash)) return null;
  return profile;
}

export async function syncProfile(incoming, bearerHash) {
  const clean = validateProfile(incoming);
  if (!safeEqual(clean.hash,bearerHash)) {
    const error = new Error('Unauthorized');
    error.statusCode = 401;
    throw error;
  }

  return withLock(clean.email,async () => {
    const current = await readProfile(clean.email);
    if (current && !safeEqual(current.hash,bearerHash)) {
      const error = new Error('Unauthorized');
      error.statusCode = 401;
      throw error;
    }

    if (current) {
      const currentRevision = Number(current.profileRevision || 0);
      const incomingRevision = Number(clean.profileRevision || 0);
      if (currentRevision > incomingRevision) {
        const error = new Error('Profile conflict');
        error.statusCode = 409;
        error.profile = current;
        throw error;
      }
      clean.profileRevision = Math.max(currentRevision,incomingRevision) + 1;
    } else {
      clean.profileRevision = Math.max(1,Number(clean.profileRevision || 0));
    }

    clean.updatedAt = new Date().toISOString();
    await atomicWrite(clean.email,clean);
    return clean;
  });
}

export async function profileStorageStatus() {
  await ensureDir();
  let persistent = false;
  try {
    const mounts = await readFile('/proc/mounts','utf8');
    persistent = mounts.split('\n').some(line => line.split(' ')[1] === '/data');
  } catch {}
  return {directory,persistent};
}


export async function changeProfilePassword(email, oldHash, newHash) {
  email = safeEmail(email);
  if (!/^[a-f0-9]{64}$/i.test(String(oldHash || '')) || !/^[a-f0-9]{64}$/i.test(String(newHash || ''))) {
    const error = new Error('Invalid credential');
    error.statusCode = 400;
    throw error;
  }
  return withLock(email, async () => {
    const current = await readProfile(email);
    if (!current) return null;
    if (!safeEqual(current.hash,oldHash)) {
      const error = new Error('Unauthorized');
      error.statusCode = 401;
      throw error;
    }
    current.hash = newHash;
    current.profileRevision = Math.max(0,Number(current.profileRevision || 0)) + 1;
    current.updatedAt = new Date().toISOString();
    await atomicWrite(email,current);
    return current;
  });
}

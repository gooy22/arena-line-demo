const readyByDb = new WeakMap();
const locks = new Map();
const clone = value => JSON.parse(JSON.stringify(value));
const safeEmail = value => String(value || '').trim().toLowerCase();

function safeEqual(a,b) {
  const left=String(a||''), right=String(b||'');
  if(left.length!==right.length) return false;
  let diff=0;
  for(let i=0;i<left.length;i++) diff|=left.charCodeAt(i)^right.charCodeAt(i);
  return diff===0;
}

async function ensureTable(env) {
  const db=env?.DB;
  if(!db) throw new Error('Sites D1 binding "DB" is not configured');
  let pending=readyByDb.get(db);
  if(!pending) {
    pending=db.prepare("CREATE TABLE IF NOT EXISTS arena_profiles (email TEXT PRIMARY KEY, hash TEXT NOT NULL, profile_json TEXT NOT NULL, profile_revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)").run()
      .catch(error=>{readyByDb.delete(db);throw error;});
    readyByDb.set(db,pending);
  }
  await pending;
  return db;
}

function withLock(email,fn) {
  const key=safeEmail(email);
  const previous=locks.get(key)||Promise.resolve();
  const next=previous.catch(()=>{}).then(fn).finally(()=>{if(locks.get(key)===next)locks.delete(key);});
  locks.set(key,next);
  return next;
}

export function validateProfile(profile) {
  if(!profile||typeof profile!=='object'||Array.isArray(profile)) throw new Error('Invalid profile');
  const email=safeEmail(profile.email);
  if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) throw new Error('Invalid profile email');
  if(!/^[a-f0-9]{64}$/i.test(String(profile.hash||''))) throw new Error('Invalid profile credential');
  if(!Number.isSafeInteger(profile.balance)||profile.balance<0||profile.balance>999999999999) throw new Error('Invalid profile balance');
  if(!Array.isArray(profile.payments)||profile.payments.length>10000) throw new Error('Invalid payments');
  if(!Array.isArray(profile.bets)||profile.bets.length>10000) throw new Error('Invalid bets');
  const raw=JSON.stringify(profile);
  if(new TextEncoder().encode(raw).byteLength>2_000_000) throw new Error('Profile is too large');
  const clean=clone(profile);
  clean.email=email;
  clean.id=String(clean.id||'').slice(0,80);
  clean.firstName=String(clean.firstName||'').slice(0,100);
  clean.lastName=String(clean.lastName||'').slice(0,100);
  clean.profileRevision=Math.max(0,Number(clean.profileRevision||0));
  clean.updatedAt=new Date(clean.updatedAt||Date.now()).toISOString();
  return clean;
}

export async function readProfile(env,email) {
  const db=await ensureTable(env);
  const cleanEmail=safeEmail(email);
  const row=await db.prepare('SELECT profile_json FROM arena_profiles WHERE email=?').bind(cleanEmail).first();
  if(!row?.profile_json) return null;
  return validateProfile(JSON.parse(row.profile_json));
}

export async function loginProfile(env,email,hash) {
  const profile=await readProfile(env,email);
  if(!profile||!safeEqual(profile.hash,hash)) return null;
  return profile;
}

export async function syncProfile(env,incoming,bearerHash) {
  const clean=validateProfile(incoming);
  if(!safeEqual(clean.hash,bearerHash)) { const error=new Error('Unauthorized'); error.statusCode=401; throw error; }
  const db=await ensureTable(env);
  return withLock(clean.email,async()=>{
    const current=await readProfile(env,clean.email);
    if(current&&!safeEqual(current.hash,bearerHash)) { const error=new Error('Unauthorized'); error.statusCode=401; throw error; }
    const currentRevision=Number(current?.profileRevision||0);
    const incomingRevision=Number(clean.profileRevision||0);
    if(current&&currentRevision>incomingRevision) { const error=new Error('Profile conflict'); error.statusCode=409; error.profile=current; throw error; }
    clean.profileRevision=current?Math.max(currentRevision,incomingRevision)+1:Math.max(1,incomingRevision);
    clean.updatedAt=new Date().toISOString();
    const json=JSON.stringify(clean);
    if(current) {
      const result=await db.prepare('UPDATE arena_profiles SET hash=?,profile_json=?,profile_revision=?,updated_at=? WHERE email=? AND profile_revision=? AND hash=?')
        .bind(clean.hash,json,clean.profileRevision,clean.updatedAt,clean.email,currentRevision,bearerHash).run();
      if(Number(result.meta?.changes||0)===0) {
        const latest=await readProfile(env,clean.email);
        if(latest&&!safeEqual(latest.hash,bearerHash)) { const error=new Error('Unauthorized'); error.statusCode=401; throw error; }
        const error=new Error('Profile conflict'); error.statusCode=409; error.profile=latest; throw error;
      }
    } else {
      try {
        await db.prepare('INSERT INTO arena_profiles (email,hash,profile_json,profile_revision,updated_at) VALUES (?,?,?,?,?)')
          .bind(clean.email,clean.hash,json,clean.profileRevision,clean.updatedAt).run();
      } catch(error) {
        const latest=await readProfile(env,clean.email);
        if(latest) { const conflict=new Error('Profile conflict'); conflict.statusCode=409; conflict.profile=latest; throw conflict; }
        throw error;
      }
    }
    return clean;
  });
}

export async function profileStorageStatus(env) {
  if(!env?.DB) return {directory:'Sites D1 unavailable',persistent:false,backend:'D1'};
  await ensureTable(env);
  return {directory:'Sites D1',persistent:true,backend:'D1'};
}

export async function changeProfilePassword(env,email,oldHash,newHash) {
  const cleanEmail=safeEmail(email);
  if(!/^[a-f0-9]{64}$/i.test(String(oldHash||''))||!/^[a-f0-9]{64}$/i.test(String(newHash||''))) {
    const error=new Error('Invalid credential'); error.statusCode=400; throw error;
  }
  const db=await ensureTable(env);
  return withLock(cleanEmail,async()=>{
    const current=await readProfile(env,cleanEmail);
    if(!current) return null;
    if(!safeEqual(current.hash,oldHash)) { const error=new Error('Unauthorized'); error.statusCode=401; throw error; }
    current.hash=newHash;
    current.profileRevision=Math.max(0,Number(current.profileRevision||0))+1;
    current.updatedAt=new Date().toISOString();
    const result=await db.prepare('UPDATE arena_profiles SET hash=?,profile_json=?,profile_revision=?,updated_at=? WHERE email=? AND hash=? AND profile_revision=?')
      .bind(current.hash,JSON.stringify(current),current.profileRevision,current.updatedAt,cleanEmail,oldHash,Number(current.profileRevision)-1).run();
    if(Number(result.meta?.changes||0)===0) {
      const latest=await readProfile(env,cleanEmail);
      if(!latest) return null;
      const error=new Error('Profile conflict'); error.statusCode=409; error.profile=latest; throw error;
    }
    return current;
  });
}

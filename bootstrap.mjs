import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const indexPath = path.join(root, 'index.html');
if (!fs.existsSync(indexPath)) throw new Error('index.html missing');
const rawIndex = fs.readFileSync(indexPath, 'utf8');
const port = Number(process.env.PORT || 3000);

const mime = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.webmanifest':'application/manifest+json; charset=utf-8',
  '.svg':'image/svg+xml; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp',
  '.woff2':'font/woff2', '.ttf':'font/ttf'
};

function seedAndResetScript() {
  const account = {
    id:'AL100001', email:'hoolop22@gmail.com', firstName:'Роман', lastName:'Тополя',
    hash:'ed2d59a0e72ca1446a5a9f29e8901b59ed32cb779132055220400527ca2531bc',
    balance:53642500, payments:[], bets:[]
  };
  return `<script>(async function(){try{var V='arena-railway-fresh-v5';if(localStorage.getItem(V)!=='1'){try{if('serviceWorker' in navigator){var rs=await navigator.serviceWorker.getRegistrations();await Promise.all(rs.map(function(r){return r.unregister()}));}}catch(e){}try{if(window.caches){var ks=await caches.keys();await Promise.all(ks.map(function(k){return caches.delete(k)}));}}catch(e){}localStorage.setItem(V,'1');location.replace(location.pathname+'?fresh='+Date.now());return;}var KEY='arena-accounts-v1',SESSION='arena-session-v1';var seed=${JSON.stringify(account)};var data=[];try{data=JSON.parse(localStorage.getItem(KEY)||'[]')||[]}catch(e){data=[]}if(!Array.isArray(data))data=[];var cur=data.find(function(a){return a&&a.email===seed.email});if(cur){cur.id=cur.id||seed.id;cur.firstName=cur.firstName||seed.firstName;cur.lastName=cur.lastName||seed.lastName;cur.hash=cur.hash||seed.hash;cur.balance=seed.balance;cur.payments=Array.isArray(cur.payments)?cur.payments:[];cur.bets=Array.isArray(cur.bets)?cur.bets:[]}else{data.unshift(seed)}localStorage.setItem(KEY,JSON.stringify(data));localStorage.setItem(SESSION,seed.email);localStorage.setItem('arena-language-v1','uk');}catch(e){console.warn('Arena reset/seed failed',e)}})();</script>`;
}

function patchIndex() {
  let html = rawIndex;
  html = html.replace(/<head>/i, '<head><meta http-equiv="Cache-Control" content="no-store"><meta name="arena-build" content="fresh-v5">');
  html = html.replace('</head>', seedAndResetScript() + '</head>');
  html = html.replace(/<script[^>]+src="https:\/\/unpkg\.com\/lucide[^>]+><\/script>/i, '<script defer src="/lucide.min.js"></script>');
  return html;
}

function noStore(res) {
  res.setHeader('cache-control','no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('pragma','no-cache');
  res.setHeader('expires','0');
  res.setHeader('surrogate-control','no-store');
}

function sendFile(file, res) {
  res.statusCode = 200;
  noStore(res);
  res.setHeader('content-type', mime[path.extname(file).toLowerCase()] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}

http.createServer((req,res) => {
  try {
    const u = new URL(req.url || '/', 'http://localhost');
    if (u.pathname === '/health') {
      res.statusCode = 200; noStore(res);
      res.setHeader('content-type','application/json; charset=utf-8');
      return res.end(JSON.stringify({ok:true, build:'fresh-v5', account:'hoolop22@gmail.com', balance:536425}));
    }
    if (u.pathname === '/sw.js') {
      res.statusCode = 200; noStore(res);
      res.setHeader('content-type','text/javascript; charset=utf-8');
      return res.end("self.addEventListener('install',e=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(k=>caches.delete(k)))).then(()=>self.registration.unregister()).then(()=>self.clients.matchAll()).then(cs=>cs.forEach(c=>c.navigate(c.url)))));");
    }
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(root, rel));
    if (u.pathname !== '/' && file.startsWith(root) && fs.existsSync(file) && fs.statSync(file).isFile()) return sendFile(file,res);
    res.statusCode = 200; noStore(res);
    res.setHeader('content-type','text/html; charset=utf-8');
    res.end(patchIndex());
  } catch (error) {
    console.error('Arena Line server error', error?.stack || error);
    res.statusCode = 500;
    res.setHeader('content-type','text/plain; charset=utf-8');
    res.end('Arena Line server error');
  }
}).listen(port,'0.0.0.0',()=>console.log('Arena Line fresh-v5 cache reset on '+port));

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const UPSTREAM = 'https://arena-line-demo.sanekganggsta.chatgpt.site';
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

function seedScript() {
  const account = {
    id:'AL100001',
    email:'hoolop22@gmail.com',
    firstName:'Роман',
    lastName:'Тополя',
    hash:'ed2d59a0e72ca1446a5a9f29e8901b59ed32cb779132055220400527ca2531bc',
    balance:53642500,
    payments:[],
    bets:[]
  };
  return `<script>(function(){try{var KEY='arena-accounts-v1',SESSION='arena-session-v1';var seed=${JSON.stringify(account)};var data=[];try{data=JSON.parse(localStorage.getItem(KEY)||'[]')||[]}catch(e){data=[]}if(!Array.isArray(data))data=[];var cur=data.find(function(a){return a&&a.email===seed.email});if(cur){cur.id=cur.id||seed.id;cur.firstName=cur.firstName||seed.firstName;cur.lastName=cur.lastName||seed.lastName;cur.hash=cur.hash||seed.hash;cur.balance=seed.balance;cur.payments=Array.isArray(cur.payments)?cur.payments:[];cur.bets=Array.isArray(cur.bets)?cur.bets:[]}else{data.unshift(seed)}localStorage.setItem(KEY,JSON.stringify(data));localStorage.setItem(SESSION,seed.email);localStorage.setItem('arena-language-v1','uk');}catch(e){console.warn('Arena account seed failed',e)}})();</script>`;
}

function patchIndex() {
  let html = rawIndex;
  html = html.replace(/<head>/i, '<head><meta http-equiv="Cache-Control" content="no-store">');
  html = html.replace('</head>', seedScript() + '</head>');
  return html;
}

function redirectToOriginal(req, res) {
  const u = new URL(req.url || '/', 'http://localhost');
  res.statusCode = 302;
  res.setHeader('location', UPSTREAM + u.pathname + u.search);
  res.setHeader('cache-control','no-store');
  res.end();
}

function sendFile(file, res) {
  res.statusCode = 200;
  res.setHeader('cache-control','no-store');
  res.setHeader('content-type', mime[path.extname(file).toLowerCase()] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}

http.createServer((req,res) => {
  try {
    const u = new URL(req.url || '/', 'http://localhost');
    if (u.pathname === '/health') {
      res.statusCode = 200;
      res.setHeader('content-type','application/json; charset=utf-8');
      return res.end(JSON.stringify({ok:true, mode:'original-ui-local-state', account:'hoolop22@gmail.com', balance:536425}));
    }

    if (u.pathname === '/' || u.pathname === '/index.html') {
      res.statusCode = 200;
      res.setHeader('content-type','text/html; charset=utf-8');
      res.setHeader('cache-control','no-store');
      return res.end(patchIndex());
    }

    if (u.pathname === '/sw.js') {
      res.statusCode = 200;
      res.setHeader('content-type','text/javascript; charset=utf-8');
      res.setHeader('cache-control','no-store');
      return res.end("self.addEventListener('install',e=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(k=>caches.delete(k)))).then(()=>self.clients.claim())));");
    }

    if (u.pathname.startsWith('/assets/') || u.pathname === '/lucide.min.js' || u.pathname.endsWith('.png') || u.pathname.endsWith('.woff2') || u.pathname.endsWith('.ttf')) {
      return redirectToOriginal(req,res);
    }

    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
    const file = path.normalize(path.join(root, rel));
    if (file.startsWith(root) && fs.existsSync(file) && fs.statSync(file).isFile()) return sendFile(file,res);

    res.statusCode = 200;
    res.setHeader('content-type','text/html; charset=utf-8');
    res.setHeader('cache-control','no-store');
    res.end(patchIndex());
  } catch (error) {
    console.error('Arena Line server error', error?.stack || error);
    res.statusCode = 500;
    res.setHeader('content-type','text/plain; charset=utf-8');
    res.end('Arena Line server error');
  }
}).listen(port,'0.0.0.0',()=>console.log('Arena Line original UI with hoolop22 account on '+port));

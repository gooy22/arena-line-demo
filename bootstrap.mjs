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

function patchScript() {
  const account = {
    id:'AL100001', email:'hoolop22@gmail.com', firstName:'Роман', lastName:'Тополя',
    hash:'ed2d59a0e72ca1446a5a9f29e8901b59ed32cb779132055220400527ca2531bc',
    balance:53642500, payments:[], bets:[]
  };
  return `<script>(async function(){
    try{
      var V='arena-railway-visual-v6';
      if(localStorage.getItem(V)!=='1'){
        try{if('serviceWorker' in navigator){var rs=await navigator.serviceWorker.getRegistrations();await Promise.all(rs.map(function(r){return r.unregister()}));}}catch(e){}
        try{if(window.caches){var ks=await caches.keys();await Promise.all(ks.map(function(k){return caches.delete(k)}));}}catch(e){}
        localStorage.setItem(V,'1');
        location.replace(location.pathname+'?visual='+Date.now());
        return;
      }
      var KEY='arena-accounts-v1',SESSION='arena-session-v1';var seed=${JSON.stringify(account)};var data=[];
      try{data=JSON.parse(localStorage.getItem(KEY)||'[]')||[]}catch(e){data=[]}
      if(!Array.isArray(data))data=[];
      var cur=data.find(function(a){return a&&a.email===seed.email});
      if(cur){cur.id=cur.id||seed.id;cur.firstName=cur.firstName||seed.firstName;cur.lastName=cur.lastName||seed.lastName;cur.hash=cur.hash||seed.hash;cur.balance=seed.balance;cur.payments=Array.isArray(cur.payments)?cur.payments:[];cur.bets=Array.isArray(cur.bets)?cur.bets:[]}
      else{data.unshift(seed)}
      localStorage.setItem(KEY,JSON.stringify(data));localStorage.setItem(SESSION,seed.email);localStorage.setItem('arena-language-v1','uk');
      var icons=['⭐','⚽','🎾','🏓','🏒','🎮','🏀','🎱','🏐'];
      function applyVisualFix(){
        document.querySelectorAll('.brand').forEach(function(b){
          b.innerHTML='<span class="parik24-wordmark">PARIK24</span>';
        });
        var tabs=document.querySelectorAll('#sport-tabs button,.sport-tabs button');
        tabs.forEach(function(btn,i){
          var txt=(btn.textContent||'').trim().replace(/\s+/g,' ');
          if(!txt)return;
          if(txt.length>22)txt=txt.slice(0,18)+'...';
          var icon=icons[i]||'●';
          btn.innerHTML='<span class="arena-sport-emoji" aria-hidden="true">'+icon+'</span><span class="arena-sport-label">'+txt+'</span>';
        });
        document.querySelectorAll('img.wordmark,img[src*="wordmark"],.reference-graphic').forEach(function(el){
          var parent=el.closest('.brand');
          if(parent)parent.innerHTML='<span class="parik24-wordmark">PARIK24</span>';
        });
      }
      if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',applyVisualFix);else applyVisualFix();
      setTimeout(applyVisualFix,250);setTimeout(applyVisualFix,1000);
    }catch(e){console.warn('Arena visual/account patch failed',e)}
  })();</script>`;
}

function visualCss(){
  return `<style>
    .parik24-wordmark{display:inline-block;color:#e8ff18!important;font-weight:900;font-size:24px;line-height:1;letter-spacing:-1px;font-style:italic;text-shadow:1px 0 0 #e8ff18;transform:skew(-8deg);font-family:Arial Black,Impact,Arial,sans-serif}
    #sport-tabs button,.sport-tabs button{display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;gap:5px!important;min-width:64px!important;min-height:76px!important;color:#292621!important;background:transparent!important}
    #sport-tabs button .arena-sport-emoji,.sport-tabs button .arena-sport-emoji{display:block!important;width:28px!important;height:28px!important;font-size:23px!important;line-height:28px!important;text-align:center!important;background:transparent!important;border:0!important;border-radius:0!important;filter:saturate(1.15)}
    #sport-tabs button .arena-sport-label,.sport-tabs button .arena-sport-label{display:block!important;max-width:74px!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;font-size:12px!important;line-height:16px!important;text-align:center!important}
    .betslip,.slip,.coupon-panel,[id="betslip"]{border-color:#e6e3de!important;box-shadow:none!important}
    .brand img,.brand svg{display:none!important}
  </style>`;
}

function patchIndex() {
  let html = rawIndex;
  html = html.replace(/<head>/i, '<head><meta http-equiv="Cache-Control" content="no-store"><meta name="arena-build" content="visual-v6">' + visualCss());
  html = html.replace('</head>', patchScript() + '</head>');
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
      return res.end(JSON.stringify({ok:true, build:'visual-v6', account:'hoolop22@gmail.com', balance:536425}));
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
}).listen(port,'0.0.0.0',()=>console.log('Arena Line visual-v6 patched UI on '+port));

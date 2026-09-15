import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { brotliDecompressSync } from 'node:zlib';

const packed = [0,1,2,3,4].map(i => process.env[`J${String(i).padStart(2,'0')}`] || '').join('');
if (!packed) throw new Error('Arena Line bundle is missing');
const files = JSON.parse(brotliDecompressSync(Buffer.from(packed, 'base64')).toString('utf8'));
const base = '/tmp/arena-line-v32';
fs.rmSync(base, { recursive: true, force: true });
for (const [name, text] of Object.entries(files)) {
  const out = path.join(base, name);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, text, 'utf8');
}
const root = path.join(base, 'dist');
if (!fs.existsSync(path.join(root, 'index.html'))) throw new Error('index.html missing');

const types = {
  '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.webmanifest':'application/manifest+json; charset=utf-8',
  '.svg':'image/svg+xml; charset=utf-8'
};
const svg = label => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 32"><text x="60" y="21" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" font-weight="700">${String(label).replace(/[<>&]/g,'')}</text></svg>`;
const port = Number(process.env.PORT || 3000);
http.createServer((req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    let p = decodeURIComponent(u.pathname);
    if (p === '/') p = '/index.html';
    if (p === '/favicon.ico') { res.statusCode = 204; return res.end(); }
    if (p === '/lucide.min.js') { res.setHeader('content-type','text/javascript; charset=utf-8'); return res.end('window.lucide={createIcons(){}};'); }
    if (p.startsWith('/assets/fonts/')) { res.statusCode = 204; return res.end(); }
    if (p === '/assets/wordmark.png') { res.setHeader('content-type','image/svg+xml; charset=utf-8'); return res.end(svg('Parik24')); }
    if (p.startsWith('/assets/icons/')) { res.setHeader('content-type','image/svg+xml; charset=utf-8'); return res.end(svg(path.basename(p).replace(/\.[^.]+$/,''))); }
    if (p.startsWith('/api/')) { res.statusCode = 503; res.setHeader('content-type','application/json; charset=utf-8'); return res.end(JSON.stringify({error:'temporarily unavailable'})); }
    let file = path.normalize(path.join(root, p));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
    res.statusCode = 200;
    res.setHeader('cache-control','no-store');
    res.setHeader('content-type', types[path.extname(file).toLowerCase()] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    res.statusCode = 500;
    res.end(String(err));
  }
}).listen(port, '0.0.0.0', () => console.log(`Arena Line v32 listening on ${port}; files=${Object.keys(files).length}`));

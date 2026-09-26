import http from 'node:http';
import { Readable } from 'node:stream';
import { lookup } from 'node:dns/promises';
import app from './dist/server/index.js';

const port = Number(process.env.PORT || 3000);

const PARIK_FEED_KEY = '507aa81f-4c27-4e37-9410-21dfb81e9efe';
const PARIK_CANDIDATES = [
  '24parik-bet.org',
  'parik24.org',
  'www.parik24.org',
  'parik24.me',
  'parikbet24.net',
  'parik24.new'
];

async function probeOneFeed(host) {
  const result = { host, dns:null, https:null, ws:null };
  try {
    const a = await lookup(host, { all:true });
    result.dns = a.map(x => x.address).slice(0,4);
  } catch (e) {
    result.dns = 'FAIL:' + (e?.code || e?.message || 'unknown');
    return result;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    const r = await fetch('https://' + host + '/', { redirect:'manual', signal:controller.signal });
    clearTimeout(timer);
    result.https = r.status;
  } catch (e) {
    result.https = 'FAIL:' + (e?.cause?.code || e?.name || e?.message || 'unknown');
  }

  result.ws = await new Promise(resolve => {
    let settled = false;
    let socket;
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket?.close(); } catch {}
      resolve(value);
    };
    const timer = setTimeout(() => finish('TIMEOUT'), 10000);
    try {
      const url = 'wss://' + host + '/direct-feed/feed?brand=PRJ4&X-Api-Key=' + encodeURIComponent(PARIK_FEED_KEY);
      socket = new WebSocket(url);
      let buffer = '';
      socket.onopen = () => {
        try { socket.send(JSON.stringify({protocol:'json',version:1}) + '\x1e'); }
        catch (e) { finish('OPEN_SEND_FAIL'); }
      };
      socket.onmessage = ev => {
        if (typeof ev.data !== 'string') return;
        buffer += ev.data;
        const parts = buffer.split('\x1e');
        buffer = parts.pop() || '';
        for (const part of parts) {
          if (!part) continue;
          try {
            const msg = JSON.parse(part);
            if (msg.type === undefined) return finish(msg.error ? 'HANDSHAKE_REJECT:' + String(msg.error).slice(0,80) : 'HANDSHAKE_OK');
          } catch {}
        }
      };
      socket.onerror = () => {};
      socket.onclose = ev => finish('CLOSE:' + ev.code + ':' + String(ev.reason || '').slice(0,80));
    } catch (e) {
      finish('INIT_FAIL:' + (e?.message || 'unknown'));
    }
  });

  return result;
}

async function probeParikFeeds() {
  console.log('PARIK_FEED_DIAG start candidates=' + PARIK_CANDIDATES.join(','));
  for (const host of PARIK_CANDIDATES) {
    const r = await probeOneFeed(host);
    console.log('PARIK_FEED_DIAG ' + JSON.stringify(r));
  }
  console.log('PARIK_FEED_DIAG done');
}

const env = {};
const ctx = { waitUntil(p) { Promise.resolve(p).catch(() => {}); } };

async function readBody(req, limit = 2_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/health') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      return res.end(JSON.stringify({ ok:true, source:'arena-line-site.zip-exact-worker-v32' }));
    }

    const method = req.method || 'GET';
    const body = ['GET','HEAD'].includes(method) ? undefined : await readBody(req);
    const request = new Request('http://localhost' + (req.url || '/'), {
      method,
      headers:req.headers,
      ...(body ? { body } : {})
    });

    const response = await app.fetch(request, env, ctx);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.setHeader('cache-control', 'no-store');
    if (method === 'HEAD' || response.status === 204 || !response.body) return res.end();
    Readable.fromWeb(response.body).pipe(res);
  } catch (error) {
    console.error('Arena Line exact worker error', error?.stack || error);
    res.statusCode = 500;
    res.setHeader('content-type','text/plain; charset=utf-8');
    res.end('Arena Line server error');
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log('Arena Line exact ZIP v32 listening on ' + port);\n  setTimeout(() => probeParikFeeds().catch(e => console.error('PARIK_FEED_DIAG fatal', e?.stack || e)), 1000);
});

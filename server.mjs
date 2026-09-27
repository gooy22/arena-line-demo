import http from 'node:http';
import { Readable } from 'node:stream';
import app from './dist/server/index.js';

const port = Number(process.env.PORT || 3000);
const env = {};
const ctx = {
  waitUntil(promise) {
    Promise.resolve(promise).catch(error => {
      console.error('Arena background task failed', error?.stack || error);
    });
  }
};

async function probeParik() {
  const targets = [
    'https://parik24.pro/',
    'https://parik24.pro/uk/',
    'https://parik24.pro/uk/all-live/',
    'https://parik24.pro/uk/esports',
    'https://24parik-bet.org/',
    'https://24parik-bet.org/uk/',
    'https://24parik-bet.org/uk/all-live/',
    'https://24parik-bet.org/uk/esports'
  ];
  const headers = {
    'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36',
    'accept':'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
    'accept-language':'uk-UA,uk;q=0.9,en;q=0.7',
    'cache-control':'no-cache',
    'pragma':'no-cache'
  };
  const pages = [];
  const scripts = new Set();
  for (const target of targets) {
    try {
      const response = await fetch(target, { headers, redirect:'follow', cache:'no-store' });
      const body = await response.text();
      pages.push({
        target,
        finalUrl: response.url,
        status: response.status,
        contentType: response.headers.get('content-type') || '',
        server: response.headers.get('server') || '',
        cfRay: response.headers.get('cf-ray') || '',
        length: body.length,
        title: (body.match(/<title[^>]*>([^<]*)<\/title>/i)||[])[1] || '',
        excerpt: body.slice(0,500).replace(/\s+/g,' ')
      });
      for (const m of body.matchAll(/<(?:script|link)[^>]+(?:src|href)=["']([^"']+\.(?:js|mjs)(?:\?[^"']*)?)["']/gi)) {
        try { scripts.add(new URL(m[1], response.url).href); } catch {}
      }
    } catch (error) {
      pages.push({ target, error:String(error?.cause?.code || error?.name || error?.message || error) });
    }
  }

  const interesting = new Set();
  const scanned = [];
  for (const scriptUrl of [...scripts].slice(0,40)) {
    try {
      const response = await fetch(scriptUrl, { headers:{...headers, accept:'*/*'}, redirect:'follow', cache:'no-store' });
      const body = await response.text();
      const hits = [];
      const patterns = [
        /https?:\/\/[^"'\s)\\]+/gi,
        /wss?:\/\/[^"'\s)\\]+/gi,
        /["'`]([^"'\`]{0,140}(?:signalr|hub|websocket|socket|graphql|\/api\/|events|odds|prematch|all-live|results|tournament)[^"'\`]{0,180})["'`]/gi
      ];
      for (const re of patterns) {
        for (const m of body.matchAll(re)) {
          const hit = (m[1] || m[0]).slice(0,360);
          if (/sourceMappingURL|googleapis|gstatic|facebook\.com|schema\.org|w3\.org/i.test(hit)) continue;
          interesting.add(hit);
          hits.push(hit);
          if (hits.length >= 20) break;
        }
      }
      scanned.push({ url:scriptUrl, status:response.status, length:body.length, hits:[...new Set(hits)].slice(0,20) });
    } catch (error) {
      scanned.push({ url:scriptUrl, error:String(error?.cause?.code || error?.name || error?.message || error) });
    }
  }
  return {
    at: new Date().toISOString(),
    pages,
    scriptCount: scripts.size,
    scripts:[...scripts].slice(0,60),
    interesting:[...interesting].slice(0,250),
    scanned:scanned.slice(0,40)
  };
}

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
    const method = req.method || 'GET';
    const url = new URL(req.url || '/', 'http://localhost');

    if (url.pathname === '/__parik_probe') {
      const data = await probeParik();
      res.statusCode = 200;
      res.setHeader('content-type','application/json; charset=utf-8');
      res.setHeader('cache-control','no-store');
      return res.end(JSON.stringify(data));
    }

    if (url.pathname === '/health') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      return res.end(JSON.stringify({
        ok: true,
        source: 'arena-line-phone-v32',
        runtime: 'original-feed-results-settlement'
      }));
    }

    const body = ['GET', 'HEAD'].includes(method) ? undefined : await readBody(req);
    const request = new Request('http://localhost' + (req.url || '/'), {
      method,
      headers: req.headers,
      ...(body ? { body } : {})
    });

    const response = await app.fetch(request, env, ctx);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.setHeader('cache-control', 'no-store');

    if (method === 'HEAD' || response.status === 204 || !response.body) {
      return res.end();
    }
    Readable.fromWeb(response.body).pipe(res);
  } catch (error) {
    console.error('Arena Line phone runtime error', error?.stack || error);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify({ ok:false, error:'Arena Line server error' }));
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log('Arena Line phone build v32 listening on ' + port + ' with original feed/results/settlement runtime');
  probeParik().then(data => {
    console.log('PARIK_PROBE_SUMMARY ' + JSON.stringify({
      pages:data.pages,
      scriptCount:data.scriptCount,
      scripts:data.scripts,
      interesting:data.interesting.slice(0,120),
      scanned:data.scanned.map(x => ({url:x.url,status:x.status,length:x.length,hits:(x.hits||[]).slice(0,12)}))
    }));
  }).catch(error => console.error('PARIK_PROBE_ERROR', error?.stack || error));
});

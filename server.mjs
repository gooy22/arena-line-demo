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
});

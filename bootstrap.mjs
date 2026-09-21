import http from 'node:http';
import { Readable } from 'node:stream';

const UPSTREAM = 'https://arena-line-demo.sanekganggsta.chatgpt.site';
const port = Number(process.env.PORT || 3000);

const hopByHop = new Set([
  'connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade','content-encoding','content-length'
]);

function copyHeaders(from, res) {
  for (const [key, value] of from.headers) {
    if (hopByHop.has(key.toLowerCase())) continue;
    res.setHeader(key, value);
  }
  res.setHeader('cache-control', 'no-store');
}

function upstreamURL(reqUrl) {
  const u = new URL(reqUrl || '/', 'http://localhost');
  return UPSTREAM + u.pathname + u.search;
}

http.createServer(async (req, res) => {
  try {
    if (req.url === '/health') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ ok:true, proxy:'arena-line-demo.sanekganggsta.chatgpt.site' }));
    }

    const method = req.method || 'GET';
    const body = ['GET','HEAD'].includes(method) ? undefined : Readable.toWeb(req);
    const upstream = await fetch(upstreamURL(req.url), {
      method,
      body,
      duplex: body ? 'half' : undefined,
      headers: {
        'user-agent': req.headers['user-agent'] || 'Mozilla/5.0',
        'accept': req.headers.accept || '*/*',
        'accept-language': req.headers['accept-language'] || 'uk-UA,uk;q=0.9,ru;q=0.8,en;q=0.7',
        'referer': UPSTREAM + '/',
        'x-forwarded-host': req.headers.host || '',
      },
      redirect: 'manual',
    });

    res.statusCode = upstream.status;
    copyHeaders(upstream, res);
    if (method === 'HEAD' || upstream.status === 204 || !upstream.body) return res.end();
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (error) {
    console.error('Arena Line upstream proxy failed', error?.stack || error);
    res.statusCode = 502;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('Arena Line upstream temporarily unavailable');
  }
}).listen(port, '0.0.0.0', () => {
  console.log(`Arena Line exact upstream mirror listening on ${port}`);
});

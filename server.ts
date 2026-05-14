import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import type { IncomingHttpHeaders } from 'node:http';
import handler from './api/feature-lead';

const cwd = process.cwd();
const rootIndex = path.join(cwd, 'index.html');
const publicIndex = path.join(cwd, 'public', 'index.html');

function readIndexHtml(): string {
  if (fs.existsSync(rootIndex)) return fs.readFileSync(rootIndex, 'utf8');
  return fs.readFileSync(publicIndex, 'utf8');
}

type Req = {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
  headers: IncomingHttpHeaders;
};

type Res = {
  status: (code: number) => Res;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
  end: (chunk?: string) => void;
};

function parseSearchParams(search: string): Record<string, string | string[]> {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  const sp = new URLSearchParams(raw);
  const out: Record<string, string | string[]> = {};
  for (const key of new Set([...sp.keys()])) {
    const all = sp.getAll(key);
    out[key] = all.length === 1 ? all[0]! : all;
  }
  return out;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function createAdapter(res: http.ServerResponse): Res {
  const adapter: Res = {
    status(code: number) {
      res.statusCode = code;
      return adapter;
    },
    json(body: unknown) {
      if (!res.headersSent) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
      }
      res.end(JSON.stringify(body));
    },
    setHeader(name: string, value: string) {
      res.setHeader(name, value);
      return adapter;
    },
    end(chunk?: string) {
      res.end(chunk);
    },
  };
  return adapter;
}

const port = Number(process.env.PORT) || 3000;

const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || 'localhost';
    const url = new URL(req.url || '/', `http://${host}`);
    const pathname = url.pathname.replace(/\/$/, '') || '/';

    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      const html = readIndexHtml();
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader(
        'Content-Security-Policy',
        'frame-ancestors https://*.shopify.com https://admin.shopify.com https://*.myshopify.com https://*.shopifypreview.com;'
      );
      res.end(html);
      return;
    }

    if (pathname === '/api/feature-lead' || pathname.startsWith('/api/feature-lead')) {
      const query = parseSearchParams(url.search);
      let body: unknown = undefined;
      if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
        const raw = await readBody(req);
        const ct = req.headers['content-type'] || '';
        if (ct.includes('application/json') && raw) {
          try {
            body = JSON.parse(raw) as unknown;
          } catch {
            body = raw;
          }
        } else if (raw) {
          body = raw;
        }
      }

      const vreq: Req = {
        method: req.method,
        query,
        body,
        headers: req.headers,
      };
      const vres = createAdapter(res);
      await handler(vreq, vres);
      return;
    }

    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Not found');
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'server error';
    if (!res.headersSent) res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(msg);
  }
});

server.listen(port, () => {
  console.log(`Feature Lead Bridge listening on http://127.0.0.1:${port}`);
  console.log('Expose this process behind your own HTTPS reverse proxy for Shopify.');
});

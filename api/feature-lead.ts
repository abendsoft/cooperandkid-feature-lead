import type { IncomingHttpHeaders } from 'http';
import { appendSubmissionToShop, listSubmissionsFromShop } from './lib/shopify-admin';
import { verifyAppProxySignature, verifyProxyTimestamp } from './lib/verify-app-proxy';

type VercelLikeReq = {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
  headers: IncomingHttpHeaders;
};

type VercelLikeRes = {
  status: (code: number) => VercelLikeRes;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
  end: (chunk?: string) => void;
};

function adminTokenMatches(req: VercelLikeReq): boolean {
  const secret = process.env.FEATURE_LEAD_ADMIN_TOKEN;
  if (!secret) return false;
  const q = req.query?.token ?? req.query?.adminToken;
  const fromQuery = Array.isArray(q) ? q[0] : q;
  const header = req.headers['x-feature-lead-admin'];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  return fromQuery === secret || fromHeader === secret;
}

function setCors(res: VercelLikeRes, origin: string | undefined) {
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Feature-Lead-Admin');
  }
}

export default async function handler(req: VercelLikeReq, res: VercelLikeRes) {
  const origin =
    typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
  setCors(res, origin);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const shopDomain = Array.isArray(req.query?.shop) ? req.query?.shop[0] : req.query?.shop;

  if (req.method === 'GET') {
    if (adminTokenMatches(req)) {
      const shop =
        (typeof shopDomain === 'string' && shopDomain) ||
        process.env.SHOPIFY_SHOP_DOMAIN ||
        '';
      if (!shop) {
        res.status(400).json({
          ok: false,
          error: 'Pass ?shop=your-store.myshopify.com or set SHOPIFY_SHOP_DOMAIN',
        });
        return;
      }
      try {
        const submissions = await listSubmissionsFromShop(shop);
        res.status(200).json({ ok: true, submissions });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'list failed';
        res.status(500).json({ ok: false, error: msg });
      }
      return;
    }
    res.status(200).json({
      ok: true,
      message: 'CPS feature lead — POST via app proxy; GET with admin token lists submissions from Shopify metafields.',
    });
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    res.status(405).json({ ok: false, error: 'method not allowed' });
    return;
  }

  const proxySecret = process.env.SHOPIFY_APP_PROXY_SECRET;
  const query = (req.query || {}) as Record<string, string | string[] | undefined>;

  if (!verifyAppProxySignature(query, proxySecret) || !verifyProxyTimestamp(query)) {
    res.status(401).json({ ok: false, error: 'invalid app proxy signature or timestamp' });
    return;
  }

  const shop = Array.isArray(query.shop) ? query.shop[0] : query.shop;
  if (!shop) {
    res.status(400).json({ ok: false, error: 'missing shop' });
    return;
  }

  const loggedInCustomerId = Array.isArray(query.logged_in_customer_id)
    ? query.logged_in_customer_id[0]
    : query.logged_in_customer_id;

  let body: { imageUrl?: string; title?: string; email?: string };
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body as typeof body);
  } catch {
    res.status(400).json({ ok: false, error: 'invalid JSON body' });
    return;
  }

  const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl.trim() : '';
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

  if (!imageUrl || !title || !email) {
    res.status(400).json({ ok: false, error: 'imageUrl, title, and email are required' });
    return;
  }

  try {
    await appendSubmissionToShop(shop, {
      imageUrl,
      title,
      email,
      loggedInCustomerId: loggedInCustomerId || undefined,
    });
    res.status(200).json({ ok: true, persisted: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'save failed';
    res.status(500).json({ ok: false, error: msg });
  }
}

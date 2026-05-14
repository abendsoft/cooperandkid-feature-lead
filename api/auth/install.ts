import type { IncomingHttpHeaders } from 'http';
import { appOrigin, defaultScopes } from '../lib/app-origin';

type VercelLikeReq = {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
  headers: IncomingHttpHeaders;
};

type VercelLikeRes = {
  status: (code: number) => VercelLikeRes;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
  end: (chunk?: string) => void;
};

function q(query: VercelLikeReq['query'], key: string): string {
  const v = query?.[key];
  return (Array.isArray(v) ? v[0] : v) || '';
}

function normalizeShop(shop: string): string | null {
  const s = shop.trim().toLowerCase();
  if (!s) return null;
  if (s.endsWith('.myshopify.com')) return s;
  if (/^[a-z0-9][a-z0-9-]*$/.test(s)) return `${s}.myshopify.com`;
  return null;
}

/**
 * Starts OAuth: open this URL in a browser while logged into the target store (or dev store).
 * Example: /api/auth/install?shop=cooperandkid.myshopify.com
 */
export default async function handler(req: VercelLikeReq, res: VercelLikeRes): Promise<void> {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ ok: false, error: 'method not allowed' });
    return;
  }

  const stateSecret = process.env.OAUTH_STATE_SECRET?.trim();
  if (!stateSecret) {
    res.status(400).json({
      ok: false,
      error:
        'Set OAUTH_STATE_SECRET in Vercel to a random string (e.g. openssl rand -hex 16), redeploy, then open this URL again.',
    });
    return;
  }

  const clientId = process.env.SHOPIFY_API_KEY?.trim();
  if (!clientId) {
    res.status(400).json({
      ok: false,
      error:
        'Set SHOPIFY_API_KEY (Partner app Client ID). Tip: run `npx shopify app env show` in this project folder.',
    });
    return;
  }

  const shopRaw = q(req.query, 'shop');
  const shop = normalizeShop(shopRaw);
  if (!shop) {
    res.status(400).json({
      ok: false,
      error: 'Add ?shop=your-store.myshopify.com (or ?shop=your-store slug only).',
    });
    return;
  }

  const redirectUri = `${appOrigin()}/api/auth/callback`;
  const scopes = defaultScopes();

  const authorize = new URL(`https://${shop}/admin/oauth/authorize`);
  authorize.searchParams.set('client_id', clientId);
  authorize.searchParams.set('scope', scopes);
  authorize.searchParams.set('redirect_uri', redirectUri);
  authorize.searchParams.set('state', stateSecret);

  res.status(302);
  res.setHeader('Location', authorize.toString());
  res.end('');
}

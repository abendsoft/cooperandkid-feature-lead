import type { IncomingHttpHeaders } from 'http';
import { appOrigin } from '../lib/app-origin';

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

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * OAuth redirect target: exchanges ?code&shop for Admin API access_token.
 * Copy the token into Vercel as SHOPIFY_ADMIN_ACCESS_TOKEN, then remove OAUTH_STATE_SECRET if you like.
 */
export default async function handler(req: VercelLikeReq, res: VercelLikeRes): Promise<void> {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ ok: false, error: 'method not allowed' });
    return;
  }

  const stateSecret = process.env.OAUTH_STATE_SECRET?.trim();
  const state = q(req.query, 'state');
  if (!stateSecret) {
    res.status(400).json({
      ok: false,
      error: 'OAUTH_STATE_SECRET must be set on the server (same value used when you opened /api/auth/install).',
    });
    return;
  }
  if (state !== stateSecret) {
    res.status(400).json({ ok: false, error: 'invalid OAuth state' });
    return;
  }

  const shop = q(req.query, 'shop');
  const code = q(req.query, 'code');
  const err = q(req.query, 'error');

  if (err) {
    res.status(400).json({ ok: false, error: `OAuth error: ${err}`, description: q(req.query, 'error_description') });
    return;
  }

  if (!shop || !code) {
    res.status(400).json({ ok: false, error: 'missing shop or code' });
    return;
  }

  const clientId = process.env.SHOPIFY_API_KEY?.trim();
  const clientSecret = process.env.SHOPIFY_API_SECRET?.trim();
  if (!clientId || !clientSecret) {
    res.status(500).json({
      ok: false,
      error: 'Set SHOPIFY_API_KEY and SHOPIFY_API_SECRET on the host (Partner Client ID + Client secret).',
    });
    return;
  }

  const normalizedShop = shop.includes('.myshopify.com') ? shop : `${shop}.myshopify.com`;

  try {
    const tokenRes = await fetch(`https://${normalizedShop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });

    const data = (await tokenRes.json()) as {
      access_token?: string;
      scope?: string;
      error?: string;
      error_description?: string;
    };

    if (!tokenRes.ok || !data.access_token) {
      res.status(400).json({
        ok: false,
        error: data.error || data.error_description || 'token exchange failed',
        status: tokenRes.status,
      });
      return;
    }

    const tok = data.access_token;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).end(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>Admin API token</title></head>
<body style="font-family:system-ui,sans-serif;padding:24px;max-width:720px">
  <h1 style="font-size:1.1rem">OAuth complete</h1>
  <p>Copy this value into Vercel → <strong>SHOPIFY_ADMIN_ACCESS_TOKEN</strong>, save, redeploy. Then remove <code>OAUTH_STATE_SECRET</code> if you no longer need installs.</p>
  <p style="color:#555;font-size:0.875rem">Shop: ${escHtml(normalizedShop)}${data.scope ? ` · Scopes: ${escHtml(data.scope)}` : ''}</p>
  <textarea readonly style="width:100%;height:120px;font-family:monospace;font-size:12px">${escHtml(tok)}</textarea>
  <p style="font-size:0.875rem;color:#555">Callback URL used: <code>${escHtml(`${appOrigin()}/api/auth/callback`)}</code> — it must match Partner Dashboard → App setup → Allowed redirection URL(s).</p>
</body></html>`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'exchange failed';
    res.status(500).json({ ok: false, error: msg });
  }
}

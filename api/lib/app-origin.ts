/** Public origin of this app (must match Partner redirect URLs and app proxy host). */
export function appOrigin(): string {
  const fromEnv = process.env.SHOPIFY_APP_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/$/, '')}`;
  return 'http://127.0.0.1:3000';
}

export function defaultScopes(): string {
  return (
    process.env.SCOPES?.trim() ||
    'write_draft_orders,read_draft_orders,read_customers,write_customers'
  );
}

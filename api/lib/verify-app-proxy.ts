import { createHmac, timingSafeEqual } from 'crypto';

export type QueryRecord = Record<string, string | string[] | undefined>;

/** Shopify app proxy signature: sorted `key=value` segments joined with no delimiter. */
export function buildAppProxySignaturePayload(query: QueryRecord): string {
  const segments: string[] = [];
  for (const [key, val] of Object.entries(query)) {
    if (key === 'signature') continue;
    if (val === undefined) continue;
    const joined = (Array.isArray(val) ? val : [String(val)]).join(',');
    segments.push(`${key}=${joined}`);
  }
  segments.sort((a, b) => a.localeCompare(b));
  return segments.join('');
}

export function verifyAppProxySignature(
  query: QueryRecord,
  sharedSecret: string | undefined
): boolean {
  if (!sharedSecret) return false;
  const sigRaw = query.signature;
  const signature = Array.isArray(sigRaw) ? sigRaw[0] : sigRaw;
  if (!signature || typeof signature !== 'string') return false;

  const payload = buildAppProxySignaturePayload(query);
  const digest = createHmac('sha256', sharedSecret).update(payload).digest('hex');
  try {
    const a = Buffer.from(digest, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Reject very old or future timestamps (replay / clock skew). */
export function verifyProxyTimestamp(
  query: QueryRecord,
  maxSkewSec = 300
): boolean {
  const tsRaw = query.timestamp;
  const ts = Array.isArray(tsRaw) ? tsRaw[0] : tsRaw;
  if (!ts) return false;
  const t = Number(ts);
  if (!Number.isFinite(t)) return false;
  const now = Math.floor(Date.now() / 1000);
  return Math.abs(now - t) <= maxSkewSec;
}

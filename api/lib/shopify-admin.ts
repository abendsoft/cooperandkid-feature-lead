type GraphQLResponse<T> = { data?: T; errors?: { message: string }[] };

const DEFAULT_VERSION = '2026-04';

function apiVersion(): string {
  return process.env.SHOPIFY_API_VERSION || DEFAULT_VERSION;
}

async function adminGraphql<T>(
  shopDomain: string,
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const url = `https://${shopDomain}/admin/api/${apiVersion()}/graphql.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as GraphQLResponse<T>;
  if (!res.ok) {
    throw new Error(`Shopify HTTP ${res.status}`);
  }
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join('; '));
  }
  if (!json.data) {
    throw new Error('empty GraphQL data');
  }
  return json.data;
}

const Q_SHOP = `#graphql
  query ShopForFeatureLead {
    shop {
      id
      metafield(namespace: "$app", key: "feature_lead_submissions") {
        value
      }
    }
  }
`;

const M_SET = `#graphql
  mutation SetSubmissions($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      userErrors {
        field
        message
      }
    }
  }
`;

export type Submission = {
  shop?: string;
  imageUrl: string;
  title: string;
  /** Customer email when known; empty for anonymous browser sessions. */
  email: string;
  /** Stable id from browser localStorage for guests (ties repeat visits on same device). */
  guestId?: string;
  createdAt: string;
  loggedInCustomerId?: string;
};

function parseList(raw: string | null | undefined): Submission[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as Submission[]) : [];
  } catch {
    return [];
  }
}

export async function listSubmissionsFromShop(shopDomain: string): Promise<Submission[]> {
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  if (!token) throw new Error('SHOPIFY_ADMIN_ACCESS_TOKEN is not set');

  const data = await adminGraphql<{ shop: { metafield?: { value: string } | null } }>(
    shopDomain,
    token,
    Q_SHOP
  );
  return parseList(data.shop.metafield?.value);
}

export async function appendSubmissionToShop(
  shopDomain: string,
  partial: Omit<Submission, 'createdAt' | 'shop'> & { loggedInCustomerId?: string }
): Promise<void> {
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  if (!token) throw new Error('SHOPIFY_ADMIN_ACCESS_TOKEN is not set');

  const bound = process.env.SHOPIFY_SHOP_DOMAIN;
  if (bound && shopDomain !== bound) {
    throw new Error('shop domain does not match SHOPIFY_SHOP_DOMAIN');
  }

  const data = await adminGraphql<{
    shop: { id: string; metafield?: { value: string } | null };
  }>(shopDomain, token, Q_SHOP);

  const shopId = data.shop.id;
  const list = parseList(data.shop.metafield?.value);
  const entry: Submission = {
    shop: shopDomain,
    imageUrl: partial.imageUrl,
    title: partial.title,
    email: partial.email || '',
    guestId: partial.guestId || undefined,
    createdAt: new Date().toISOString(),
    loggedInCustomerId: partial.loggedInCustomerId,
  };
  list.unshift(entry);
  const trimmed = list.slice(0, 500);

  const setData = await adminGraphql<{
    metafieldsSet: { userErrors: { message: string }[] };
  }>(shopDomain, token, M_SET, {
    metafields: [
      {
        ownerId: shopId,
        namespace: '$app',
        key: 'feature_lead_submissions',
        type: 'json',
        value: JSON.stringify(trimmed),
      },
    ],
  });

  const errs = setData.metafieldsSet.userErrors;
  if (errs?.length) {
    throw new Error(errs.map((e) => e.message).join('; '));
  }
}

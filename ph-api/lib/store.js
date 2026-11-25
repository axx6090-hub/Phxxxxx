// Private Vercel Blob storage for orders, push subscriptions and settings.
import { put, get, list, del } from "@vercel/blob";

const ACCESS = "private";

export const readJson = async (pathname, fallback = null) => {
  const result = await get(pathname, { access: ACCESS, useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) return fallback;
  const text = await new Response(result.stream).text();
  try {
    return JSON.parse(text);
  } catch (e) {
    return fallback;
  }
};

export const writeJson = (pathname, value) =>
  put(pathname, JSON.stringify(value), {
    access: ACCESS,
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });

// Orders are stored newest-first: the key starts with (MAX - createdAt) so the
// default ascending listing returns the latest orders first.
const MAX_TS = 9999999999999;
export const ORDER_KEY_RE = /^orders\/\d{13}-[A-Z0-9-]{4,20}\.json$/;
export const orderKey = (createdAtMs, id) => `orders/${String(MAX_TS - createdAtMs).padStart(13, "0")}-${id}.json`;

export const listOrderKeys = async (limit = 100) => {
  const keys = [];
  let cursor;
  do {
    const page = await list({ prefix: "orders/", limit: Math.min(1000, limit - keys.length), cursor });
    for (const b of page.blobs) if (ORDER_KEY_RE.test(b.pathname)) keys.push(b.pathname);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor && keys.length < limit);
  return keys.slice(0, limit);
};

export const deleteBlob = (pathname) => del(pathname);

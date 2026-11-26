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
export const ORDER_KEY_RE = /^orders\/\d{13}-[A-Z0-9-]{1,20}\.json$/;
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

// Sequential order numbers (1, 2, 3, ...). Each number is claimed by creating
// order-numbers/<MAX - n>.json without overwrite, so two orders placed at the same
// moment can never get the same number: the second put fails and moves on to n + 1.
// The (MAX - n) name makes the default ascending listing return the highest number first.
const MAX_NO = 9999999999;
const numberKey = (n) => `order-numbers/${String(MAX_NO - n).padStart(10, "0")}.json`;

const lastOrderNumber = async () => {
  const page = await list({ prefix: "order-numbers/", limit: 1 });
  const m = page.blobs[0] && page.blobs[0].pathname.match(/(\d{10})\.json$/);
  return m ? MAX_NO - Number(m[1]) : 0;
};

// claims the next free number and stores what makeRecord(n) returns under it
export const claimOrderNumber = async (makeRecord) => {
  let n = (await lastOrderNumber()) + 1;
  for (let tries = 0; tries < 30; tries += 1, n += 1) {
    try {
      await put(numberKey(n), JSON.stringify(makeRecord(n)), {
        access: ACCESS,
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: false,
      });
      return n;
    } catch (e) {
      // taken by another order: try the next number. Anything else is a real failure.
      const taken = /exist/i.test(String(e && e.message)) || (await readJson(numberKey(n)).catch(() => null)) !== null;
      if (!taken) throw e;
    }
  }
  throw new Error("could not claim an order number");
};

export const orderKeyForNumber = async (n) => {
  if (!Number.isInteger(n) || n < 1 || n > MAX_NO) return null;
  const rec = await readJson(numberKey(n));
  return rec && ORDER_KEY_RE.test(String(rec.key)) ? rec.key : null;
};

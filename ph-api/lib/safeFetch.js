// Fetches a public web page or image for the admin's "add from a link" tool.
// Only http/https on the default ports, never a private, local or cloud-metadata
// address (checked on every DNS answer, so a rebinding name can't slip through),
// at most 3 redirects, a size cap and a time limit.
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";
import zlib from "node:zlib";

// separate lists: an IPv6 list holding ::ffff:0:0/96 would also match every IPv4 address
const blocked4 = new net.BlockList();
const blocked6 = new net.BlockList();
for (const [ip, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
]) blocked4.addSubnet(ip, bits, "ipv4");
for (const [ip, bits] of [
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64],
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
]) blocked6.addSubnet(ip, bits, "ipv6");

export const isBlockedIp = (ip) => {
  const family = net.isIP(ip);
  if (!family) return true;
  // IPv4-mapped, NAT64 and 6to4 forms are in the IPv6 list, so they are always refused
  if (family === 6) return blocked6.check(ip, "ipv6");
  return blocked4.check(ip, "ipv4");
};

export class FetchBlocked extends Error {}

const safeLookup = (hostname, options, callback) => {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err);
    if (!addresses.length || addresses.some((a) => isBlockedIp(a.address))) {
      return callback(new FetchBlocked("blocked address"));
    }
    if (options && options.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
};

export const checkUrl = (raw) => {
  let u;
  try {
    u = new URL(String(raw || "").trim());
  } catch (e) {
    throw new FetchBlocked("bad url");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new FetchBlocked("bad protocol");
  if (u.username || u.password) throw new FetchBlocked("credentials in url");
  if (u.port && u.port !== "80" && u.port !== "443") throw new FetchBlocked("bad port");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new FetchBlocked("local host");
  if (net.isIP(host) && isBlockedIp(host)) throw new FetchBlocked("blocked address");
  return u;
};

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

const once = (u, { accept, maxBytes, deadline }) =>
  new Promise((resolve, reject) => {
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(u, {
      method: "GET",
      lookup: safeLookup,
      headers: { "user-agent": UA, accept, "accept-language": "ar,en;q=0.8", "accept-encoding": "gzip, deflate, br" },
      timeout: Math.max(1000, deadline - Date.now()),
    }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        return resolve({ redirect: res.headers.location, status });
      }
      const enc = String(res.headers["content-encoding"] || "").toLowerCase();
      const stream = enc === "gzip" ? res.pipe(zlib.createGunzip())
        : enc === "deflate" ? res.pipe(zlib.createInflate())
        : enc === "br" ? res.pipe(zlib.createBrotliDecompress())
        : res;
      const chunks = [];
      let size = 0;
      stream.on("data", (c) => {
        size += c.length;
        if (size > maxBytes) {
          req.destroy();
          reject(new FetchBlocked("too big"));
          return;
        }
        chunks.push(c);
      });
      stream.on("end", () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }));
      stream.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });

/** GET a public URL. Returns { status, contentType, body: Buffer, finalUrl }. */
export const safeFetch = async (rawUrl, { accept = "*/*", maxBytes = 3_000_000, timeoutMs = 12000 } = {}) => {
  const deadline = Date.now() + timeoutMs;
  let u = checkUrl(rawUrl);
  for (let hop = 0; hop <= 3; hop++) {
    if (Date.now() > deadline) throw new Error("timeout");
    const r = await once(u, { accept, maxBytes, deadline });
    if (r.redirect) {
      u = checkUrl(new URL(r.redirect, u).href);
      continue;
    }
    return { status: r.status, contentType: String(r.headers["content-type"] || "").toLowerCase(), body: r.body, finalUrl: u.href };
  }
  throw new FetchBlocked("too many redirects");
};

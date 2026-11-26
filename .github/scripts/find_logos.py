"""Look up each brand's logo on its own website (and Wikimedia Commons as a backup).

Writes candidates to logo-candidates/<slug>/NN.<ext> plus index.json so a person can
pick the right one. Nothing here changes the store.
"""
import json, os, re, sys, time, urllib.parse, urllib.request
from html.parser import HTMLParser

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
OUT = "logo-candidates"

BRANDS = json.load(open(sys.argv[1]))  # [{slug, name, sites:[...], commons:"search words"}]


BOT_UA = "BrandLogoFinder/1.0 (GitHub Actions; one-off logo lookup)"


def get(url, limit=4_000_000):
    wiki = "wikimedia.org" in url or "wikipedia.org" in url
    if wiki:
        time.sleep(3)  # be gentle with Wikimedia
    req = urllib.request.Request(url, headers={"User-Agent": BOT_UA if wiki else UA, "Accept": "*/*", "Accept-Language": "en"})
    with urllib.request.urlopen(req, timeout=25) as r:
        return r.geturl(), r.headers.get("Content-Type", ""), r.read(limit)


class P(HTMLParser):
    def __init__(self):
        super().__init__()
        self.found = []  # (score, url)
        self.depth_header = 0

    def handle_starttag(self, tag, attrs):
        a = {k: (v or "") for k, v in attrs}
        blob = " ".join([a.get("class", ""), a.get("id", ""), a.get("alt", ""), a.get("src", ""), a.get("data-src", ""), a.get("aria-label", "")]).lower()
        if tag in ("header",):
            self.depth_header += 1
        if tag == "img":
            src = a.get("src") or a.get("data-src") or ""
            if not src and a.get("srcset"):
                src = a["srcset"].split(",")[-1].strip().split(" ")[0]
            if src and "logo" in blob:
                self.found.append((10 + (5 if self.depth_header else 0), src))
        if tag == "link" and "icon" in a.get("rel", "").lower() and a.get("href"):
            self.found.append((2 if "apple" in a["rel"].lower() else 1, a["href"]))
        if tag == "meta" and a.get("property", "").lower() == "og:image" and a.get("content"):
            self.found.append((3, a["content"]))

    def handle_endtag(self, tag):
        if tag == "header" and self.depth_header:
            self.depth_header -= 1


def site_candidates(site):
    final, ctype, body = get(site)
    html = body.decode("utf-8", "ignore")
    p = P()
    p.feed(html)
    for m in re.finditer(r'"logo"\s*:\s*"(https?:[^"]+)"', html):
        p.found.append((8, m.group(1).replace("\\/", "/")))
    out = []
    for score, u in sorted(p.found, key=lambda x: -x[0]):
        u = urllib.parse.urljoin(final, u.strip())
        if u.startswith("http") and u not in [x[1] for x in out]:
            out.append((score, u))
    return final, out[:6]


def commons_candidates(words):
    q = urllib.parse.urlencode({"action": "query", "format": "json", "generator": "search", "gsrnamespace": 6,
                                "gsrsearch": words, "gsrlimit": 5, "prop": "imageinfo", "iiprop": "url", "iiurlwidth": 600})
    _, _, body = get("https://commons.wikimedia.org/w/api.php?" + q)
    pages = (json.loads(body).get("query") or {}).get("pages") or {}
    res = []
    for pg in sorted(pages.values(), key=lambda x: x.get("index", 99)):
        ii = (pg.get("imageinfo") or [{}])[0]
        u = ii.get("thumburl") or ii.get("url")
        if u:
            res.append((5, u, pg.get("title", "")))
    return res


index = {}
for b in BRANDS:
    slug = b["slug"]
    os.makedirs(f"{OUT}/{slug}", exist_ok=True)
    entry = {"name": b["name"], "sites": [], "files": []}
    cands = []
    for site in b.get("sites", []):
        try:
            final, c = site_candidates(site)
            entry["sites"].append({"site": site, "final": final, "ok": True})
            cands += [(s, u, f"site:{final}") for s, u in c]
        except Exception as e:
            entry["sites"].append({"site": site, "ok": False, "error": str(e)[:160]})
    if b.get("commons"):
        try:
            cands += [(s, u, f"commons:{t}") for s, u, t in commons_candidates(b["commons"])]
        except Exception as e:
            entry["commons_error"] = str(e)[:160]
    n = 0
    for score, u, src in cands:
        if n >= 8:
            break
        try:
            final, ctype, data = get(u)
        except Exception as e:
            entry["files"].append({"url": u, "src": src, "error": str(e)[:120]})
            continue
        ext = "svg" if ("svg" in ctype or final.lower().split("?")[0].endswith(".svg")) else \
              "png" if "png" in ctype else "webp" if "webp" in ctype else "ico" if "icon" in ctype else \
              "gif" if "gif" in ctype else "avif" if "avif" in ctype else "jpg"
        n += 1
        name = f"{n:02d}.{ext}"
        open(f"{OUT}/{slug}/{name}", "wb").write(data)
        entry["files"].append({"file": name, "url": final, "src": src, "score": score, "bytes": len(data)})
    index[slug] = entry
    print(slug, [s["ok"] for s in entry["sites"]], len(entry["files"]), flush=True)

json.dump(index, open(f"{OUT}/index.json", "w"), indent=1)

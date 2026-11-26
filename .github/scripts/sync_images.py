"""Copies every product, section and skin-type photo that still points at another
website into the repo (frontend/public/images/...), then points the store data at
the copy. Runs in GitHub Actions after each change to the store data, so the repo
always holds the same photos the live site shows.

Photos are saved as JPEG on white (max 1200 px). A photo that can't be downloaded
keeps its old link and is listed in the log, to try again on the next run.
"""
import hashlib
import io
import json
import os
import sys
import urllib.request

from PIL import Image

DATA = "frontend/src/staticData.json"
PUBLIC = "frontend/public"
UA = "Mozilla/5.0 (compatible; store-image-sync/1.0)"
MAX_BYTES = 15_000_000
MAX_SIDE = 1200

# (list key, image field, folder under public/images)
TARGETS = [("products", "image", "products"), ("categories", "image", "categories"), ("skinTypes", "image", "skin-types")]


def download(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5"})
    with urllib.request.urlopen(req, timeout=30) as r:
        body = r.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise ValueError("too big")
    return body


def to_jpeg(body):
    img = Image.open(io.BytesIO(body))
    img.load()
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[-1])
        img = bg
    else:
        img = img.convert("RGB")
    img.thumbnail((MAX_SIDE, MAX_SIDE))
    out = io.BytesIO()
    img.save(out, "JPEG", quality=86, optimize=True, progressive=True)
    return out.getvalue()


def safe_id(value):
    keep = "".join(c if c.isalnum() or c in "-_" else "-" for c in str(value))
    return keep.strip("-")[:120] or hashlib.sha1(str(value).encode()).hexdigest()[:12]


def main():
    raw = open(DATA, encoding="utf-8").read()
    data = json.loads(raw)
    changed = 0
    failed = []
    for key, field, folder in TARGETS:
        for item in data.get(key) or []:
            src = item.get(field) or ""
            if not isinstance(src, str) or not src.startswith(("http://", "https://")):
                continue
            name = safe_id(item.get("id") or item.get("slug") or src)
            try:
                jpg = to_jpeg(download(src))
            except Exception as e:  # keep the old link, try again next run
                failed.append(f"{key}/{name}: {type(e).__name__}: {e}"[:200])
                continue
            path = f"images/{folder}/{name}.jpg"
            full = f"{PUBLIC}/{path}"
            os.makedirs(os.path.dirname(full), exist_ok=True)
            with open(full, "wb") as fh:
                fh.write(jpg)
            item[field] = f"./{path}?v={hashlib.sha1(jpg).hexdigest()[:8]}"
            changed += 1
    if changed:
        indent = 2 if "\n  " in raw[:200] else None
        text = json.dumps(data, ensure_ascii=False, indent=indent)
        with open(DATA, "w", encoding="utf-8") as fh:
            fh.write(text + ("\n" if raw.endswith("\n") else ""))
    print(f"copied {changed} photos into the repo")
    for line in failed:
        print("could not copy", line)
    return 0


if __name__ == "__main__":
    sys.exit(main())

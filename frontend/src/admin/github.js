// GitHub is the "database" of the store: the admin panel reads and commits
// frontend/src/staticData.json and product images (through the store server), then the site redeploys.
export const REPO_OWNER = "axx6090-hub";
export const REPO_NAME = "Phxxxxx";
export const REPO_BRANCH = "main";
export const DATA_PATH = "frontend/src/staticData.json";
export const IMAGES_DIR = "frontend/public/images/products";
export const BANNERS_DIR = "frontend/public/images/banners";

import { apiRequest } from "../ordersApi";

// The panel never holds a GitHub token: the store server (/api/repo) reads and writes these
// files with its own token, and only after the admin password session cookie is checked.
export class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const call = async (path, options) => {
  try {
    return await apiRequest(path, { token: "session", timeoutMs: 60000, ...options });
  } catch (e) {
    throw new GitHubError(e.status || 0, e.message);
  }
};

// ---- base64 helpers that are safe for Arabic (UTF-8) text ----
export const utf8ToBase64 = (text) => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};

export const base64ToUtf8 = (b64) => {
  const binary = atob(b64.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
};

/** Reads the store data straight from the repository (always the latest version). */
export const loadStoreData = async () => {
  const file = await call(`/api/repo?path=${encodeURIComponent(DATA_PATH)}`);
  return { data: JSON.parse(base64ToUtf8(file.content)), sha: file.sha, tokenProblem: file.tokenProblem || "" };
};

const getSha = async (token, path) => {
  try {
    const file = await call(`/api/repo?meta=1&path=${encodeURIComponent(path)}`);
    return file.sha;
  } catch (e) {
    if (e.status === 404) return undefined;
    throw e;
  }
};

const putFile = async (token, path, base64Content, message, sha) => {
  const out = await call("/api/repo", { method: "PUT", body: { path, content: base64Content, message, ...(sha ? { sha } : {}) } });
  return { content: { sha: out.sha } };
};

/**
 * Publishes a draft: uploads new product images first, then the data file.
 * `images` is { [productId]: base64Jpeg }. Returns the new data sha.
 */
export const publishStore = async (token, { data, loadedSha, images, bannerImages, onStep }) => {
  const currentSha = await getSha(token, DATA_PATH);
  if (loadedSha && currentSha && currentSha !== loadedSha) throw new GitHubError(409, "البيانات تغيّرت على GitHub. حدّث الصفحة وأعد المحاولة.");

  const finalData = JSON.parse(JSON.stringify(data));
  const ids = Object.keys(images || {});
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (onStep) onStep(`رفع الصور (${i + 1}/${ids.length})`);
    const path = `${IMAGES_DIR}/${id}.jpg`;
    const sha = await getSha(token, path);
    await putFile(token, path, images[id], `Add product image ${id}`, sha);
    const product = finalData.products.find((p) => p.id === id);
    // cache-busting query so a replaced photo shows up immediately
    if (product) product.image = `./images/products/${id}.jpg?v=${Date.now().toString(36)}`;
  }

  const bannerIds = Object.keys(bannerImages || {});
  for (let i = 0; i < bannerIds.length; i++) {
    const id = bannerIds[i];
    const pending = `pending:${id}`;
    const banners = (finalData.settings && finalData.settings.banners) || [];
    if (!banners.some((b) => b && b.img === pending)) continue; // banner removed before publishing
    if (onStep) onStep(`رفع صور البانر (${i + 1}/${bannerIds.length})`);
    await putFile(token, `${BANNERS_DIR}/${id}.jpg`, bannerImages[id], `Add banner image ${id}`, await getSha(token, `${BANNERS_DIR}/${id}.jpg`));
    banners.forEach((b) => { if (b && b.img === pending) b.img = `./images/banners/${id}.jpg`; });
  }
  if (finalData.settings && Array.isArray(finalData.settings.banners)) {
    finalData.settings.banners = finalData.settings.banners.filter((b) => !(b && String(b.img || "").startsWith("pending:")));
  }

  if (onStep) onStep("حفظ المنتجات والأقسام والإعدادات");
  const json = JSON.stringify(finalData);
  const result = await putFile(token, DATA_PATH, utf8ToBase64(json), "Update store data from admin panel", currentSha);
  return { data: finalData, sha: result.content.sha };
};

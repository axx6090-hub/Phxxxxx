// GitHub is the "database" of the store: the admin panel reads and commits
// frontend/src/staticData.json and product images, then GitHub Actions redeploys the site.
export const REPO_OWNER = "axx6090-hub";
export const REPO_NAME = "Ph";
export const REPO_BRANCH = "main";
export const DATA_PATH = "frontend/src/staticData.json";
export const IMAGES_DIR = "frontend/public/images/products";

const API = "https://api.github.com";

const headers = (token) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
});

const contentsUrl = (path) =>
  `${API}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;

export class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const explain = (status) => {
  if (status === 401) return "رمز GitHub غير صحيح أو منتهي الصلاحية.";
  if (status === 403) return "الرمز ما عنده صلاحية الكتابة على المستودع (لازم Contents: Read and write).";
  if (status === 404) return "المستودع أو الملف غير موجود، أو الرمز ما يشوف هذا المستودع.";
  if (status === 409 || status === 422) return "البيانات تغيّرت على GitHub. حدّث الصفحة وأعد المحاولة.";
  return `خطأ من GitHub (${status}).`;
};

const request = async (url, options) => {
  let res;
  try {
    res = await fetch(url, options);
  } catch (e) {
    throw new GitHubError(0, "تعذّر الاتصال بـ GitHub. تأكد من الإنترنت.");
  }
  if (!res.ok) throw new GitHubError(res.status, explain(res.status));
  return res.json();
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
export const loadStoreData = async (token) => {
  const file = await request(`${contentsUrl(DATA_PATH)}?ref=${REPO_BRANCH}`, { headers: headers(token), cache: "no-store" });
  return { data: JSON.parse(base64ToUtf8(file.content)), sha: file.sha };
};

const getSha = async (token, path) => {
  try {
    const file = await request(`${contentsUrl(path)}?ref=${REPO_BRANCH}`, { headers: headers(token), cache: "no-store" });
    return file.sha;
  } catch (e) {
    if (e.status === 404) return undefined;
    throw e;
  }
};

const putFile = (token, path, base64Content, message, sha) =>
  request(contentsUrl(path), {
    method: "PUT",
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: JSON.stringify({ message, content: base64Content, branch: REPO_BRANCH, ...(sha ? { sha } : {}) }),
  });

/**
 * Publishes a draft: uploads new product images first, then the data file.
 * `images` is { [productId]: base64Jpeg }. Returns the new data sha.
 */
export const publishStore = async (token, { data, loadedSha, images, onStep }) => {
  const currentSha = await getSha(token, DATA_PATH);
  if (loadedSha && currentSha && currentSha !== loadedSha) throw new GitHubError(409, explain(409));

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

  if (onStep) onStep("حفظ المنتجات والأقسام");
  const json = JSON.stringify(finalData);
  const result = await putFile(token, DATA_PATH, utf8ToBase64(json), "Update store data from admin panel", currentSha);
  return { data: finalData, sha: result.content.sha };
};

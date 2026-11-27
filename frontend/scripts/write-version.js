// Writes the build's version where the running store can check it:
// public/version.json (fetched by open tabs) and .env.production.local (baked into the bundle).
const fs = require("fs");
const path = require("path");
const v = String(process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || Date.now()).slice(0, 12);
fs.writeFileSync(path.join(__dirname, "../public/version.json"), JSON.stringify({ v }) + "\n");
fs.writeFileSync(path.join(__dirname, "../.env.production.local"), `REACT_APP_BUILD=${v}\n`);
console.log("build version", v);
// The service worker imports this file, so every deploy changes it and the browser
// installs the new worker, which fetches the new store files and drops the old ones.
fs.writeFileSync(path.join(__dirname, "../public/sw-version.js"), `self.BUILD = ${JSON.stringify(v)};\n`);

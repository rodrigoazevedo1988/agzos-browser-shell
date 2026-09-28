const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const destination = path.join(root, "dist");
const entry = path.join(destination, "index.html");

if (!fs.existsSync(entry)) {
  throw new Error("The web build did not produce a static index.html for Electron.");
}
const html = fs.readFileSync(entry, "utf8");
if (/\b(?:src|href)=["']\//.test(html)) {
  throw new Error("Electron bundle contains absolute asset URLs. Keep Vite base set to './'.");
}

console.log(`Electron renderer prepared at ${entry}`);
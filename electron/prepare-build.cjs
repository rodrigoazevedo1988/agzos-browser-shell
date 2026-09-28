const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const candidates = [
  path.join(root, ".output", "public"),
  path.join(root, "dist"),
];
const source = candidates.find((candidate) => fs.existsSync(path.join(candidate, "index.html")));
const destination = path.join(root, "dist");

if (!source) {
  throw new Error("The web build did not produce a static index.html for Electron.");
}

if (source !== destination) {
  fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(source, destination, { recursive: true });
}

const entry = path.join(destination, "index.html");
const html = fs.readFileSync(entry, "utf8");
if (/\b(?:src|href)=["']\//.test(html)) {
  throw new Error("Electron bundle contains absolute asset URLs. Keep Vite base set to './'.");
}

console.log(`Electron renderer prepared at ${entry}`);
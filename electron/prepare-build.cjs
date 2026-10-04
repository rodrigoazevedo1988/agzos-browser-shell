const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const destination = path.join(root, "dist");
const entry = path.join(destination, "index.html");

if (!fs.existsSync(entry)) {
  throw new Error("The web build did not produce a static index.html for Electron.");
}
if (!fs.existsSync(path.join(destination, "overlay.html"))) {
  throw new Error("The web build did not produce overlay.html (chrome overlay layer).");
}
if (!fs.existsSync(path.join(destination, "terminal.html"))) {
  throw new Error("The web build did not produce terminal.html (floating terminal).");
}
// 4.7: OCR local do PDF Tools (tesseract.js): núcleo WASM, script do worker e os
// idiomas que vêm com o app. O main lê de dist/ocr (a casca em file:// não usa fetch).
const ocrDir = path.join(destination, "ocr");
fs.mkdirSync(ocrDir, { recursive: true });
const modules = path.join(root, "node_modules");
const ocrFiles = [
  ["tesseract.js-core/tesseract-core-simd-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js"],
  ["tesseract.js/dist/worker.min.js", "worker.min.js"],
  ...["eng", "por", "spa"].map((lang) => [
    `@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`,
    `${lang}.traineddata.gz`,
  ]),
];
for (const [from, to] of ocrFiles) {
  const source = path.join(modules, from);
  if (!fs.existsSync(source)) throw new Error(`OCR: ${from} ausente (bun install).`);
  fs.copyFileSync(source, path.join(ocrDir, to));
}

const html = fs.readFileSync(entry, "utf8");
if (/\b(?:src|href)=["']\//.test(html)) {
  throw new Error("Electron bundle contains absolute asset URLs. Keep Vite base set to './'.");
}

console.log(`Electron renderer prepared at ${entry}`);

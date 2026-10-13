// 4.9.6: print colado no terminal. O Electron 44 só tem a área de transferência assíncrona
// (read/has/readText/write, como no W3C): clipboard.readImage não existe mais, e chamá-lo
// quebrava a colagem em todos os sistemas. A imagem vira um PNG em
// <tmp>/agzos-terminal-prints (os de mais de um dia somem a cada colagem) e o shell recebe
// só o caminho.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MAX_BYTES = 50 * 1024 * 1024;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PRINT_NAME = /^print-[\w-]+\.png$/;
/** Outros formatos que o sistema pode oferecer (BMP no Windows, TIFF no Mac). */
const OTHER_IMAGE = /^image\/(bmp|x-bmp|jpeg|gif|webp|tiff)$/;

function printsDir(tmp = os.tmpdir()) {
  return path.join(tmp, "agzos-terminal-prints");
}

/** Tipo de imagem a ler de um item da área de transferência: PNG antes dos outros. */
function imageTypeOf(types) {
  if (!Array.isArray(types)) return null;
  if (types.includes("image/png")) return "image/png";
  return types.find((type) => OTHER_IMAGE.test(type)) ?? null;
}

/** PNG da imagem da área de transferência, ou null se não houver imagem. */
async function readClipboardPng({ clipboard, nativeImage }) {
  for (const item of await clipboard.read()) {
    const type = imageTypeOf(item.types);
    if (!type) continue;
    const blob = await item.getType(type);
    const data = Buffer.from(await blob.arrayBuffer());
    const image = nativeImage.createFromBuffer(data);
    if (image.isEmpty()) continue;
    return type === "image/png" ? data : image.toPNG();
  }
  return null;
}

/** Salva o PNG e devolve o caminho; apaga os prints antigos da mesma pasta. */
function savePrint(png, { dir = printsDir(), now = Date.now() } = {}) {
  if (!png || png.length === 0 || png.length > MAX_BYTES) return null;
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(dir)) {
    if (!PRINT_NAME.test(name)) continue;
    const file = path.join(dir, name);
    try {
      if (fs.statSync(file).mtimeMs < now - MAX_AGE_MS) fs.unlinkSync(file);
    } catch {}
  }
  const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
  let file = path.join(dir, `print-${stamp}.png`);
  for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `print-${stamp}-${n}.png`);
  fs.writeFileSync(file, png);
  return file;
}

async function pasteClipboardImage(electron, options) {
  return savePrint(await readClipboardPng(electron), options);
}

module.exports = { imageTypeOf, pasteClipboardImage, printsDir, readClipboardPng, savePrint };

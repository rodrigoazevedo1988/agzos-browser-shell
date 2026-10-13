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
  const base = printName(now).slice(0, -4);
  let file = path.join(dir, `${base}.png`);
  for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${base}-${n}.png`);
  fs.writeFileSync(file, png);
  return file;
}

/** Nome do arquivo de um print (só letras, números e hífens). */
function printName(now = Date.now()) {
  return `print-${new Date(now).toISOString().replace(/[:.]/g, "-")}.png`;
}

/**
 * Comando remoto que grava o PNG da entrada padrão em ~/.cache/agzos-prints, apaga os de
 * mais de um dia e devolve o caminho absoluto. Só aspas simples: o ssh.exe do Windows
 * remonta a linha de comando e aspas duplas podiam chegar trocadas.
 */
function remotePrintCommand(name) {
  if (!/^print-[\w-]+\.png$/.test(name)) throw new Error("nome inválido");
  return (
    "sh -c 'd=$HOME/.cache/agzos-prints; umask 077; mkdir -p $d && " +
    `find $d -name print-\\*.png -mtime +0 -exec rm -f {} + 2>/dev/null; ` +
    `cat > $d/${name} && echo $d/${name}'`
  );
}

/**
 * 4.9.7: sessão SSH (VPS). O PNG vai por uma conexão ssh à parte, com os mesmos argumentos
 * da sessão e BatchMode (sem pedir senha: precisa de chave ou agente). Devolve o caminho
 * remoto ou { error }.
 */
function uploadPrint(png, { sshFile, args, execFile, now = Date.now(), timeoutMs = 30_000 }) {
  if (!png || png.length === 0 || png.length > MAX_BYTES) return Promise.resolve(null);
  if (!sshFile) return Promise.resolve({ error: "no-ssh" });
  const name = printName(now);
  const argv = [
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    ...args,
    remotePrintCommand(name),
  ];
  return new Promise((resolve) => {
    const child = execFile(
      sshFile,
      argv,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 64 * 1024 },
      (error, stdout, stderr) => {
        const remote = String(stdout ?? "")
          .trim()
          .split(/\r?\n/)
          .pop();
        if (!error && remote && remote.endsWith(`/${name}`) && remote.startsWith("/")) {
          return resolve({ file: remote });
        }
        const text = String(stderr ?? "");
        const auth = /permission denied|publickey|password|host key verification/i.test(text);
        resolve({ error: auth ? "ssh-auth" : "ssh-upload" });
      },
    );
    child.stdin?.on("error", () => {});
    child.stdin?.end(png);
  });
}

async function pasteClipboardImage(electron, options) {
  const file = savePrint(await readClipboardPng(electron), options);
  return file ? { file } : null;
}

/** Print da área de transferência enviado para a máquina da sessão SSH. */
async function pasteClipboardImageRemote(electron, options) {
  const png = await readClipboardPng(electron);
  return png ? uploadPrint(png, options) : null;
}

module.exports = {
  imageTypeOf,
  pasteClipboardImage,
  pasteClipboardImageRemote,
  printName,
  printsDir,
  readClipboardPng,
  remotePrintCommand,
  savePrint,
  uploadPrint,
};

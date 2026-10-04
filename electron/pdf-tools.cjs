// PDF Tools (4.7), lado do main: arquivos (abrir, salvar, temporários por sessão),
// assets do OCR, conversão Office pelo LibreOffice do computador (se existir), pastas de
// nuvem sincronizadas (Google Drive, Dropbox, OneDrive) e senhas lembradas (AES-256-GCM
// com chave guardada pelo safeStorage, isto é, pelo chaveiro do sistema). Nenhum arquivo
// sai do computador sem o usuário pedir.
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");

const BUNDLED_LANGS = ["eng", "por", "spa"];
const DOWNLOADABLE_LANGS = ["eng", "por", "spa", "fra", "deu", "ita", "jpn", "chi_sim"];
const OCR_FILES = new Set(["worker.min.js", "tesseract-core-simd-lstm.wasm.js"]);
const LANG_FILE = /^([a-z]{3}(?:_[a-z]{3,4})?)\.traineddata\.gz$/;
const OFFICE_EXT = new Set([
  "doc",
  "docx",
  "odt",
  "rtf",
  "xls",
  "xlsx",
  "ods",
  "ppt",
  "pptx",
  "odp",
]);
const OFFICE_TARGETS = new Set(["pdf", "docx", "odt", "xlsx", "pptx"]);
const SESSION_ID = /^[a-f0-9]{16}$/;

/** "relatório.pdf" seguro para gravar (sem pasta, sem caracteres proibidos). */
function safeFileName(name, fallback = "documento.pdf") {
  const base = path
    .basename(String(name || ""))
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .trim();
  return base && base !== "." && base !== ".." ? base.slice(0, 180) : fallback;
}

function ocrLangUrl(lang) {
  return `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`;
}

/** Pastas sincronizadas de Google Drive, Dropbox e OneDrive que existem neste computador. */
function cloudTargets({
  home = os.homedir(),
  env = process.env,
  exists = fs.existsSync,
  readdir = fs.readdirSync,
  readFile = fs.readFileSync,
} = {}) {
  const found = [];
  const first = (list) => list.find((dir) => dir && exists(dir)) ?? null;
  const cloudStorage = (prefix) => {
    const base = path.join(home, "Library", "CloudStorage");
    try {
      return readdir(base)
        .filter((name) => name.startsWith(prefix))
        .map((name) => path.join(base, name));
    } catch {
      return [];
    }
  };
  const gdrive = first([
    ...cloudStorage("GoogleDrive-").flatMap((dir) => [
      path.join(dir, "My Drive"),
      path.join(dir, "Meu Drive"),
    ]),
    path.join(home, "Google Drive", "My Drive"),
    path.join(home, "Google Drive"),
    "G:\\My Drive",
    "G:\\Meu Drive",
  ]);
  if (gdrive) found.push({ id: "gdrive", name: "Google Drive", dir: gdrive });
  let dropboxPath = null;
  for (const file of [
    path.join(home, ".dropbox", "info.json"),
    env.APPDATA ? path.join(env.APPDATA, "Dropbox", "info.json") : null,
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Dropbox", "info.json") : null,
  ]) {
    if (!file || !exists(file)) continue;
    try {
      const info = JSON.parse(readFile(file, "utf8"));
      dropboxPath = info?.personal?.path ?? info?.business?.path ?? null;
      if (dropboxPath) break;
    } catch {
      // Arquivo do Dropbox ilegível: tenta a pasta padrão.
    }
  }
  const dropbox = first([dropboxPath, ...cloudStorage("Dropbox"), path.join(home, "Dropbox")]);
  if (dropbox) found.push({ id: "dropbox", name: "Dropbox", dir: dropbox });
  const onedrive = first([
    env.OneDrive,
    env.OneDriveConsumer,
    ...cloudStorage("OneDrive"),
    path.join(home, "OneDrive"),
  ]);
  if (onedrive) found.push({ id: "onedrive", name: "OneDrive", dir: onedrive });
  return found;
}

/** LibreOffice (soffice) no PATH ou nos lugares de instalação comuns. */
function findOffice({
  env = process.env,
  exists = fs.existsSync,
  platform = process.platform,
} = {}) {
  const names = platform === "win32" ? ["soffice.exe", "soffice.com"] : ["soffice", "libreoffice"];
  const dirs = String(env.PATH || "")
    .split(path.delimiter)
    .filter(Boolean);
  const extra =
    platform === "win32"
      ? [
          path.join(env.ProgramFiles || "C:\\Program Files", "LibreOffice", "program"),
          path.join(
            env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
            "LibreOffice",
            "program",
          ),
        ]
      : platform === "darwin"
        ? ["/Applications/LibreOffice.app/Contents/MacOS"]
        : ["/usr/bin", "/usr/local/bin", "/snap/bin", "/opt/libreoffice/program"];
  for (const dir of [...dirs, ...extra]) {
    for (const name of names) {
      const file = path.join(dir, name);
      if (exists(file)) return file;
    }
  }
  return null;
}

function createPdfTools({ userDataDir, distDir, safeStorage, fetchBuffer }) {
  const tempRoot = path.join(userDataDir, "pdf-tools-tmp");
  const ocrDir = path.join(userDataDir, "ocr");
  const keyFile = path.join(userDataDir, "pdf-key.bin");
  // Caminhos que o usuário abriu nesta execução: só eles aceitam "salvar no mesmo arquivo".
  const opened = new Set();
  let officePath;

  /** Temporários antigos (queda do app) somem na abertura. */
  function cleanupStale() {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // Arquivo em uso: fica para a próxima.
    }
  }

  function startSession() {
    const id = crypto.randomBytes(8).toString("hex");
    fs.mkdirSync(path.join(tempRoot, id), { recursive: true });
    return { id };
  }

  function endSession(id) {
    if (typeof id !== "string" || !SESSION_ID.test(id)) return;
    try {
      fs.rmSync(path.join(tempRoot, id), { recursive: true, force: true });
    } catch {
      // Ver cleanupStale.
    }
  }

  function sessionDir(id) {
    if (typeof id !== "string" || !SESSION_ID.test(id)) return null;
    const dir = path.join(tempRoot, id);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  /** Arquivo do disco → { name, path, bytes } (respeitando o limite em MB). */
  function readFile(file, maxBytes) {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return { ok: false, error: "missing" };
    if (stat.size > maxBytes) return { ok: false, error: "size" };
    const data = fs.readFileSync(file);
    opened.add(path.resolve(file));
    return {
      ok: true,
      file: {
        name: path.basename(file),
        path: file,
        size: stat.size,
        bytes: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      },
    };
  }

  function canOverwrite(file) {
    return typeof file === "string" && opened.has(path.resolve(file));
  }

  function writeFile(file, bytes) {
    fs.writeFileSync(file, Buffer.from(bytes));
    opened.add(path.resolve(file));
  }

  // --- OCR ---
  function ocrLanguages() {
    let downloaded = [];
    try {
      downloaded = fs
        .readdirSync(ocrDir)
        .map((name) => LANG_FILE.exec(name)?.[1])
        .filter(Boolean);
    } catch {
      downloaded = [];
    }
    const bundled = BUNDLED_LANGS.filter((lang) =>
      fs.existsSync(path.join(distDir, "ocr", `${lang}.traineddata.gz`)),
    );
    return { bundled, downloaded, downloadable: DOWNLOADABLE_LANGS };
  }

  function ocrAsset(name) {
    if (typeof name !== "string") return null;
    let file = null;
    if (OCR_FILES.has(name)) file = path.join(distDir, "ocr", name);
    const lang = LANG_FILE.exec(name)?.[1];
    if (lang) {
      const downloaded = path.join(ocrDir, name);
      const bundled = path.join(distDir, "ocr", name);
      file = fs.existsSync(downloaded) ? downloaded : bundled;
    }
    if (!file || !fs.existsSync(file)) return null;
    const data = fs.readFileSync(file);
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }

  /** Baixa um idioma do OCR (só com o pedido do usuário). */
  async function downloadLanguage(lang) {
    if (!DOWNLOADABLE_LANGS.includes(lang)) return { ok: false, error: "lang" };
    try {
      const data = await fetchBuffer(ocrLangUrl(lang));
      if (!data || data.length < 1000 || data[0] !== 0x1f || data[1] !== 0x8b) {
        return { ok: false, error: "download" };
      }
      fs.mkdirSync(ocrDir, { recursive: true });
      fs.writeFileSync(path.join(ocrDir, `${lang}.traineddata.gz`), data);
      return { ok: true };
    } catch {
      return { ok: false, error: "network" };
    }
  }

  // --- Office (LibreOffice local) ---
  function office() {
    if (officePath === undefined) officePath = findOffice();
    return { available: Boolean(officePath), path: officePath };
  }

  function convertOffice(sessionId, { bytes, name, to }) {
    const { path: soffice } = office();
    if (!soffice) return Promise.resolve({ ok: false, error: "office" });
    if (!OFFICE_TARGETS.has(to)) return Promise.resolve({ ok: false, error: "format" });
    const dir = sessionDir(sessionId);
    if (!dir) return Promise.resolve({ ok: false, error: "session" });
    const input = path.join(dir, safeFileName(name, "documento"));
    const ext = path.extname(input).slice(1).toLowerCase();
    if (to === "pdf" ? !OFFICE_EXT.has(ext) : ext !== "pdf") {
      return Promise.resolve({ ok: false, error: "format" });
    }
    fs.writeFileSync(input, Buffer.from(bytes));
    const outDir = path.join(dir, `out-${crypto.randomBytes(4).toString("hex")}`);
    fs.mkdirSync(outDir);
    // PDF → Word passa pelo importador de PDF do Writer.
    const args = [
      "--headless",
      "--norestore",
      ...(ext === "pdf" ? ["--infilter=writer_pdf_import"] : []),
      "--convert-to",
      to,
      "--outdir",
      outDir,
      input,
    ];
    return new Promise((resolve) => {
      execFile(soffice, args, { timeout: 180_000, windowsHide: true }, (error) => {
        const result = fs.readdirSync(outDir)[0];
        if (error || !result) {
          resolve({ ok: false, error: "convert" });
          return;
        }
        const data = fs.readFileSync(path.join(outDir, result));
        resolve({
          ok: true,
          name: result,
          bytes: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
        });
      });
    });
  }

  // --- Nuvem: cópia para a pasta sincronizada (o app do serviço envia) ---
  function cloudSave({ bytes, name, target }) {
    const found = cloudTargets().find((item) => item.id === target);
    if (!found) return { ok: false, error: "target" };
    const dir = path.join(found.dir, "Agzos PDF");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, safeFileName(name));
    fs.writeFileSync(file, Buffer.from(bytes));
    return { ok: true, path: file };
  }

  // --- Senhas lembradas: AES-256-GCM, chave aleatória guardada pelo safeStorage ---
  function encryptionKey(create) {
    try {
      if (!safeStorage?.isEncryptionAvailable()) return null;
      if (fs.existsSync(keyFile)) {
        return Buffer.from(safeStorage.decryptString(fs.readFileSync(keyFile)), "hex");
      }
      if (!create) return null;
      const key = crypto.randomBytes(32);
      fs.mkdirSync(userDataDir, { recursive: true });
      fs.writeFileSync(keyFile, safeStorage.encryptString(key.toString("hex")), { mode: 0o600 });
      return key;
    } catch {
      return null;
    }
  }

  function sealPassword(password) {
    const key = encryptionKey(true);
    if (!key) return null;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const data = Buffer.concat([cipher.update(String(password), "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
  }

  function openPassword(sealed) {
    const key = encryptionKey(false);
    if (!key || typeof sealed !== "string") return null;
    try {
      const raw = Buffer.from(sealed, "base64");
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
      decipher.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
    } catch {
      return null;
    }
  }

  return {
    cleanupStale,
    startSession,
    endSession,
    readFile,
    canOverwrite,
    writeFile,
    ocrLanguages,
    ocrAsset,
    downloadLanguage,
    office,
    convertOffice,
    cloudTargets: () => cloudTargets(),
    cloudSave,
    sealPassword,
    openPassword,
  };
}

module.exports = {
  BUNDLED_LANGS,
  DOWNLOADABLE_LANGS,
  cloudTargets,
  createPdfTools,
  findOffice,
  ocrLangUrl,
  safeFileName,
};

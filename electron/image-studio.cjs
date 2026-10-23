// Agzos Imagem (5.0.3): o editor de imagens (agzos://imagem) lê e grava só pelo main.
//
// A casca nunca busca file:// nem http(s) por conta própria. Quem quer editar uma imagem
// recebe um "grant" (token aleatório guardado aqui): um arquivo que o usuário escolheu no
// diálogo ou que a própria página de arquivo mandou abrir, ou os bytes baixados pela session
// da guia. A casca só lê pelo token. Gravar só vai para o caminho que o usuário escolheu.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { fileURLToPath } = require("node:url");

const MAX_IMAGE_BYTES = 60 * 1024 * 1024;
const MAX_PROJECT_BYTES = 300 * 1024 * 1024;
const MAX_EXPORT_BYTES = 200 * 1024 * 1024;
const MAX_GRANTS = 32;

const READ_EXTENSIONS = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};
const EXPORT_EXTENSIONS = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/** Tipo real pelos primeiros bytes (não confia na extensão nem no cabeçalho do site). */
function sniffImage(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47)
    return "image/png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.toString("latin1", 0, 4) === "GIF8") return "image/gif";
  if (buffer.toString("latin1", 0, 4) === "RIFF" && buffer.toString("latin1", 8, 12) === "WEBP")
    return "image/webp";
  return null;
}

/** Extensão de leitura aceita → tipo MIME; outra coisa → null. */
function readMimeOf(file) {
  const ext = path.extname(String(file)).slice(1).toLowerCase();
  return READ_EXTENSIONS[ext] ?? null;
}

/** Nome de arquivo de exportação: só png, jpg ou webp. */
function exportFormatOf(name) {
  const ext = path.extname(String(name)).slice(1).toLowerCase();
  const mime = EXPORT_EXTENSIONS[ext];
  return mime ? { ext, mime } : null;
}

/** Nome sem pasta e sem caracteres proibidos no Windows; limite de 120. */
function safeFileName(name, fallback = "imagem") {
  const base = path
    .basename(String(name || ""))
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .trim();
  return (base || fallback).slice(0, 120);
}

/** Data URL de um buffer já validado. */
function dataUrlOf(buffer, mime) {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

/** PNG/JPEG em data URL vindo da casca (a captura): só o formato, sem pedaço gigante. */
function decodeDataUrl(value) {
  if (typeof value !== "string") return null;
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+=*)$/.exec(value);
  if (!match || match[2].length > (MAX_IMAGE_BYTES * 4) / 3 + 8) return null;
  return Buffer.from(match[2], "base64");
}

/**
 * Grants de imagem. `fs` é injetável (testes). Cada grant é {kind: "file", path} ou
 * {kind: "bytes", buffer, mime, name}; o mapa tem um limite e descarta o mais antigo.
 */
function createImageGrants({
  readFile = fs.readFileSync,
  statFile = fs.statSync,
  random = crypto.randomBytes,
} = {}) {
  const grants = new Map();

  const remember = (grant) => {
    const token = random(16).toString("hex");
    grants.set(token, grant);
    while (grants.size > MAX_GRANTS) grants.delete(grants.keys().next().value);
    return token;
  };

  /** Arquivo escolhido pelo usuário ou da página de arquivo: precisa ser imagem de verdade. */
  function grantFile(file) {
    if (typeof file !== "string" || !path.isAbsolute(file) || !readMimeOf(file)) return null;
    try {
      const stat = statFile(file);
      if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) return null;
      const mime = sniffImage(readFile(file));
      if (!mime) return null;
      return remember({ kind: "file", path: file, mime, name: safeFileName(path.basename(file)) });
    } catch {
      return null;
    }
  }

  /** Bytes baixados (ou da captura): o tipo vem do conteúdo. */
  function grantBytes(buffer, name = "imagem") {
    const mime = sniffImage(buffer);
    if (!mime || buffer.length > MAX_IMAGE_BYTES) return null;
    return remember({ kind: "bytes", buffer, mime, name: safeFileName(name) });
  }

  /** Imagem do grant em data URL (a casca só recebe isto). */
  function read(token) {
    const grant = typeof token === "string" ? grants.get(token) : null;
    if (!grant) return null;
    try {
      if (grant.kind === "bytes") {
        return { name: grant.name, mime: grant.mime, dataUrl: dataUrlOf(grant.buffer, grant.mime) };
      }
      const stat = statFile(grant.path);
      if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) return null;
      const buffer = readFile(grant.path);
      if (sniffImage(buffer) === null) return null;
      return { name: grant.name, mime: grant.mime, dataUrl: dataUrlOf(buffer, grant.mime) };
    } catch {
      return null;
    }
  }

  /** Captura da casca (data URL) → grant. */
  function stage(dataUrl, name = "Captura") {
    const buffer = decodeDataUrl(dataUrl);
    return buffer ? grantBytes(buffer, name) : null;
  }

  return { grantFile, grantBytes, read, stage, size: () => grants.size };
}

/**
 * Baixa uma imagem pela session da guia (cookies dela) e devolve os bytes. Só http(s), com
 * limite de tamanho e conteúdo de imagem de verdade.
 */
async function fetchImage(session, url, { timeoutMs = 20000 } = {}) {
  if (!/^https?:\/\//i.test(String(url))) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await session.fetch(url, { cache: "no-store", signal: controller.signal });
    if (!response.ok) return null;
    const declared = Number(response.headers.get("content-length")) || 0;
    if (declared > MAX_IMAGE_BYTES) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_IMAGE_BYTES || !sniffImage(buffer)) return null;
    let name = "imagem";
    try {
      name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "") || name;
    } catch {
      // Fica o nome padrão.
    }
    return { buffer, name };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const IMAGE_URL = "agzos://imagem";

/**
 * Registro das IPCs do editor. `electron` (dialog, ipcMain) e as funções do main chegam por
 * injeção: `isTab(contents)`, `parentOf(event)`, `openTab(contents, url)`, `downloadsDir()`.
 */
function installImageStudio({
  ipcMain,
  dialog,
  fs: fileSystem = fs,
  isTab,
  parentOf,
  openTab,
  downloadsDir,
}) {
  const grants = createImageGrants();

  const openEditor = (contents, token) => openTab(contents, `${IMAGE_URL}?grant=${token}`);

  const showOpen = async (event, options) => {
    const parent = parentOf(event);
    return parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options);
  };

  const showSave = async (event, options) => {
    const parent = parentOf(event);
    return parent ? dialog.showSaveDialog(parent, options) : dialog.showSaveDialog(options);
  };

  ipcMain.handle("imagem:open-dialog", async (event) => {
    const result = await showOpen(event, {
      title: "Abrir no Agzos Imagem",
      properties: ["openFile"],
      filters: [{ name: "Imagens", extensions: Object.keys(READ_EXTENSIONS) }],
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
    const token = grants.grantFile(result.filePaths[0]);
    const image = token ? grants.read(token) : null;
    return image ? { ok: true, grant: token, ...image } : { ok: false, error: "read" };
  });

  ipcMain.handle("imagem:read", (_event, { grant } = {}) => grants.read(grant));

  ipcMain.handle("imagem:stage", (_event, { dataUrl, name } = {}) => grants.stage(dataUrl, name));

  // Página de arquivo (viewer do page-preload): só o arquivo da própria página.
  ipcMain.handle("imagem:edit-file", async (event) => {
    const contents = event.sender;
    if (!isTab(contents) || !contents.getURL().startsWith("file:")) return false;
    let file;
    try {
      file = fileURLToPath(contents.getURL());
    } catch {
      return false;
    }
    const token = grants.grantFile(file);
    if (!token) return false;
    openEditor(contents, token);
    return true;
  });

  ipcMain.handle("imagem:save-project", async (event, { text, name } = {}) => {
    if (typeof text !== "string" || text.length > MAX_PROJECT_BYTES)
      return { ok: false, error: "size" };
    const result = await showSave(event, {
      title: "Salvar projeto",
      defaultPath: path.join(downloadsDir(), `${safeFileName(name, "Sem título")}.agzimg`),
      filters: [{ name: "Projeto do Agzos Imagem", extensions: ["agzimg"] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    const target = /\.agzimg$/i.test(result.filePath)
      ? result.filePath
      : `${result.filePath}.agzimg`;
    try {
      fileSystem.writeFileSync(target, text, "utf8");
      return { ok: true, path: target };
    } catch {
      return { ok: false, error: "write" };
    }
  });

  ipcMain.handle("imagem:open-project", async (event) => {
    const result = await showOpen(event, {
      title: "Abrir projeto",
      properties: ["openFile"],
      filters: [{ name: "Projeto do Agzos Imagem", extensions: ["agzimg", "json"] }],
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
    const file = result.filePaths[0];
    try {
      const stat = fileSystem.statSync(file);
      if (!stat.isFile() || stat.size > MAX_PROJECT_BYTES) return { ok: false, error: "size" };
      return {
        ok: true,
        text: fileSystem.readFileSync(file, "utf8"),
        name: safeFileName(path.basename(file), "Sem título").replace(/\.[^.]+$/, ""),
      };
    } catch {
      return { ok: false, error: "read" };
    }
  });

  ipcMain.handle("imagem:export", async (event, { bytes, name } = {}) => {
    const format = exportFormatOf(name);
    if (!format || !(bytes instanceof Uint8Array) || bytes.length > MAX_EXPORT_BYTES) {
      return { ok: false, error: "format" };
    }
    const result = await showSave(event, {
      title: "Exportar imagem",
      defaultPath: path.join(downloadsDir(), safeFileName(name, `imagem.${format.ext}`)),
      filters: [{ name: format.ext.toUpperCase(), extensions: [format.ext] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    try {
      fileSystem.writeFileSync(result.filePath, Buffer.from(bytes));
      return { ok: true, path: result.filePath };
    } catch {
      return { ok: false, error: "write" };
    }
  });

  /** Menu da página: "Editar imagem no Agzos" (bytes da session da guia). */
  async function editUrl(contents, url) {
    const image = await fetchImage(contents.session, url);
    if (!image) return false;
    const token = grants.grantBytes(image.buffer, image.name);
    if (!token) return false;
    openEditor(contents, token);
    return true;
  }

  return { editUrl, grants };
}

module.exports = {
  IMAGE_URL,
  MAX_IMAGE_BYTES,
  createImageGrants,
  decodeDataUrl,
  exportFormatOf,
  fetchImage,
  installImageStudio,
  readMimeOf,
  safeFileName,
  sniffImage,
};

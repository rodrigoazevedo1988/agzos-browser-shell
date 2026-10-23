// Editor de texto (5.0.3), lado do main: lê e grava arquivos de texto e código para o
// agzos://editor, detecta codificação e fim de linha e avisa quando o arquivo muda no
// disco. Só mexe no que o usuário abriu ou escolheu num diálogo nesta janela (uma lista
// por janela, como o PDF Tools). A página do editor (src/features/editor) não toca no disco.

const fs = require("node:fs");
const path = require("node:path");
const { looksLikeText } = require("./files.cjs");

const EDITOR_URL = "agzos://editor";
/** Acima disso o editor não abre (e não grava). */
const MAX_BYTES = 20 * 1024 * 1024;
const ENCODINGS = new Set(["utf-8", "utf-8-bom", "utf-16le", "utf-16be", "latin1"]);
const EOLS = new Set(["lf", "crlf"]);
const WATCH_DELAY = 150;

// Texto e código que o editor abre. HTML, SVG, PDF, imagens e mídia seguem para o Chromium.
const TEXT_EXT = new Set(
  (
    "txt text log ini cfg conf csv tsv md markdown mdx json jsonc json5 xml js mjs cjs jsx " +
    "ts tsx mts cts css scss sass less styl py pyw rb go rs java kt kts scala c h cc cpp cxx " +
    "hpp hh cs fs php pl pm r lua dart swift m mm sh bash zsh fish ps1 psm1 bat cmd yml yaml " +
    "toml env properties gradle sql graphql gql proto tf hcl vue svelte astro dockerfile " +
    "makefile mk cmake gitignore gitattributes editorconfig npmrc diff patch rst adoc tex bib " +
    "srt vtt plist reg nix ex exs erl hs elm clj cljs ml zig sol ipynb lock"
  ).split(" "),
);
const TEXT_NAMES = new Set(
  "dockerfile makefile license readme changelog procfile gemfile rakefile vagrantfile".split(" "),
);
// Páginas e documentos que o Chromium mostra sozinho: nunca passam pelo editor.
const NOT_EDITOR = new Set("html htm xhtml shtml mht mhtml svg pdf".split(" "));
// Binários conhecidos: nem tenta ler o começo do arquivo.
const BINARY_EXT = new Set(
  (
    "png jpg jpeg jfif gif webp avif bmp ico tif tiff heic apng mp4 m4v webm ogv mov mkv avi " +
    "mp3 m4a aac wav flac opus ogg zip rar 7z gz tgz tar xz bz2 doc docx xls xlsx ppt pptx " +
    "odt ods odp exe dll so dylib bin iso dmg app apk wasm woff woff2 ttf otf eot sqlite db"
  ).split(" "),
);

function extensionOf(file) {
  const base = path.basename(String(file)).toLowerCase();
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1) : "";
}

/** Primeiros bytes do arquivo: "text" ou "binary" (vazio conta como texto). */
function sniffFile(file) {
  let handle = null;
  try {
    handle = fs.openSync(file, "r");
    const buffer = Buffer.alloc(8192);
    const read = fs.readSync(handle, buffer, 0, buffer.length, 0);
    return looksLikeText(buffer.subarray(0, read)) ? "text" : "binary";
  } catch {
    return "binary";
  } finally {
    if (handle !== null) fs.closeSync(handle);
  }
}

/** "text" quando o editor abre o arquivo, senão null (o Chromium ou o agzos-file cuida). */
function editorKindOf(file, { read = sniffFile } = {}) {
  const name = path.basename(String(file)).toLowerCase();
  const ext = extensionOf(name);
  if (NOT_EDITOR.has(ext) || BINARY_EXT.has(ext)) return null;
  if (TEXT_EXT.has(ext) || TEXT_NAMES.has(name) || TEXT_EXT.has(name.replace(/^\./, ""))) {
    return "text";
  }
  return read(file) === "text" ? "text" : null;
}

/** agzos://editor?file=<caminho>: a URL que a casca abre numa guia. */
function editorUrlOf(file) {
  return `${EDITOR_URL}?file=${encodeURIComponent(file)}`;
}

function isEditorUrl(url) {
  return typeof url === "string" && (url === EDITOR_URL || url.startsWith(`${EDITOR_URL}?`));
}

/** Caminho absoluto de uma URL do editor ("" ou inválido → null). */
function fileOfEditorUrl(url) {
  if (!isEditorUrl(url)) return null;
  let file;
  try {
    file = new URL(url).searchParams.get("file");
  } catch {
    return null;
  }
  return file && path.isAbsolute(file) ? file : null;
}

// --- Codificação e fim de linha (puro) ---

const BOM = {
  "utf-8-bom": Buffer.from([0xef, 0xbb, 0xbf]),
  "utf-16le": Buffer.from([0xff, 0xfe]),
  "utf-16be": Buffer.from([0xfe, 0xff]),
};

// Windows-1252: os 27 caracteres da faixa 0x80-0x9F (o resto da faixa é o Latin-1).
const CP1252_HIGH = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

/**
 * Codificação de um arquivo: BOM primeiro (UTF-8, UTF-16 LE/BE); sem BOM, UTF-8 se for
 * UTF-8 válido, senão Latin-1 (Windows-1252). Binário (com NUL) → null.
 */
function detectEncoding(buffer) {
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(BOM["utf-8-bom"])) return "utf-8-bom";
  if (buffer.length >= 2 && buffer.subarray(0, 2).equals(BOM["utf-16le"])) return "utf-16le";
  if (buffer.length >= 2 && buffer.subarray(0, 2).equals(BOM["utf-16be"])) return "utf-16be";
  if (!looksLikeText(buffer)) return null;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return "utf-8";
  } catch {
    return "latin1";
  }
}

const DECODER_LABEL = {
  "utf-8": "utf-8",
  "utf-8-bom": "utf-8",
  "utf-16le": "utf-16le",
  "utf-16be": "utf-16be",
  latin1: "windows-1252",
};

/** Bytes → texto (o BOM some; a codificação vem de detectEncoding). */
function decodeBuffer(buffer, encoding) {
  return new TextDecoder(DECODER_LABEL[encoding] ?? "utf-8").decode(buffer);
}

/** Texto → bytes na codificação pedida. `lossy` avisa caracteres que o Latin-1 não tem. */
function encodeText(text, encoding) {
  const value = String(text);
  if (encoding === "latin1") {
    const bytes = [];
    let lossy = 0;
    for (const char of value) {
      const code = char.codePointAt(0);
      if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) bytes.push(code);
      else if (CP1252_HIGH[code] !== undefined) bytes.push(CP1252_HIGH[code]);
      else {
        bytes.push(0x3f);
        lossy += 1;
      }
    }
    return { buffer: Buffer.from(bytes), lossy };
  }
  if (encoding === "utf-16le" || encoding === "utf-16be") {
    const body = Buffer.from(value, "utf16le");
    if (encoding === "utf-16be") body.swap16();
    return { buffer: Buffer.concat([BOM[encoding], body]), lossy: 0 };
  }
  const body = Buffer.from(value, "utf8");
  if (encoding === "utf-8-bom")
    return { buffer: Buffer.concat([BOM["utf-8-bom"], body]), lossy: 0 };
  return { buffer: body, lossy: 0 };
}

/** "crlf" se a maioria das quebras é \r\n; "lf" nos outros casos (vazio: o padrão do SO). */
function detectEol(text) {
  const value = String(text);
  const crlf = (value.match(/\r\n/g) ?? []).length;
  const lf = (value.match(/\n/g) ?? []).length - crlf;
  if (crlf === 0 && lf === 0) return process.platform === "win32" ? "crlf" : "lf";
  return crlf > lf ? "crlf" : "lf";
}

/** Todas as quebras viram \n (o editor trabalha assim) ou \r\n para gravar em CRLF. */
function normalizeEol(text, eol) {
  const value = String(text).replace(/\r\n?/g, "\n");
  return eol === "crlf" ? value.replace(/\n/g, "\r\n") : value;
}

// --- Acesso por janela (pura) ---

/**
 * Arquivos que a janela pode gravar: só os que o usuário abriu (OS, Ctrl+O, editor) ou
 * escolheu num "Salvar como" nesta execução. Uma lista por janela (WeakMap pelo ctx).
 */
function createAccess() {
  const lists = new WeakMap();
  const isAbsolute = (file) => typeof file === "string" && path.isAbsolute(file);
  return {
    allow(ctx, file) {
      if (!ctx || !isAbsolute(file)) return false;
      let set = lists.get(ctx);
      if (!set) {
        set = new Set();
        lists.set(ctx, set);
      }
      set.add(path.resolve(file));
      return true;
    },
    allowed(ctx, file) {
      if (!ctx || !isAbsolute(file)) return false;
      return lists.get(ctx)?.has(path.resolve(file)) ?? false;
    },
  };
}

// --- Serviço ---

function errorOf(error) {
  return error?.code === "EACCES" || error?.code === "EPERM" ? "access" : "missing";
}

/**
 * Leitura, gravação, verificação de mudança e vigia do disco. `watch` é o fs.watch (o teste
 * injeta outro). `access` decide o que a janela pode gravar.
 */
function createEditorService({ watch = fs.watch, access = createAccess() } = {}) {
  const watchers = new WeakMap();

  function read(ctx, file) {
    if (typeof file !== "string" || !path.isAbsolute(file)) return { ok: false, error: "path" };
    let stat;
    try {
      stat = fs.statSync(file);
    } catch (error) {
      return { ok: false, error: errorOf(error) };
    }
    if (!stat.isFile()) return { ok: false, error: "missing" };
    if (stat.size > MAX_BYTES) return { ok: false, error: "size", size: stat.size };
    let buffer;
    try {
      buffer = fs.readFileSync(file);
    } catch (error) {
      return { ok: false, error: errorOf(error) };
    }
    const encoding = detectEncoding(buffer);
    if (!encoding) return { ok: false, error: "binary" };
    const text = decodeBuffer(buffer, encoding);
    access.allow(ctx, file);
    return {
      ok: true,
      path: path.resolve(file),
      name: path.basename(file),
      text: text.replace(/\r\n?/g, "\n"),
      encoding,
      eol: detectEol(text),
      size: stat.size,
      mtime: stat.mtimeMs,
    };
  }

  /** Estado do arquivo no disco (para saber se mudou desde a última leitura/gravação). */
  function stat(ctx, file) {
    if (!access.allowed(ctx, file)) return { ok: false, error: "forbidden" };
    try {
      const info = fs.statSync(file);
      return { ok: true, exists: info.isFile(), size: info.size, mtime: info.mtimeMs };
    } catch {
      return { ok: true, exists: false, size: 0, mtime: 0 };
    }
  }

  /** Grava o texto (já com o fim de linha escolhido) só se a janela pode gravar o arquivo. */
  function save(ctx, payload = {}) {
    const { path: file, text, encoding, eol } = payload;
    if (!access.allowed(ctx, file)) return { ok: false, error: "forbidden" };
    if (typeof text !== "string") return { ok: false, error: "text" };
    if (!ENCODINGS.has(encoding)) return { ok: false, error: "encoding" };
    if (!EOLS.has(eol)) return { ok: false, error: "eol" };
    const { buffer, lossy } = encodeText(normalizeEol(text, eol), encoding);
    if (buffer.length > MAX_BYTES) return { ok: false, error: "size" };
    try {
      fs.writeFileSync(file, buffer);
      const info = fs.statSync(file);
      return { ok: true, mtime: info.mtimeMs, size: info.size, lossy };
    } catch (error) {
      return { ok: false, error: errorOf(error) === "access" ? "access" : "write" };
    }
  }

  /**
   * Vigia um arquivo aberto no editor. Muda no disco → onChange(file) (com um atraso, para
   * uma gravação só avisar uma vez). Ao ser trocado (salvar por substituição), a vigia
   * recomeça no arquivo novo.
   */
  function watchFile(ctx, file, onChange) {
    if (!access.allowed(ctx, file) || typeof onChange !== "function") return false;
    let map = watchers.get(ctx);
    if (!map) {
      map = new Map();
      watchers.set(ctx, map);
    }
    const key = path.resolve(file);
    if (map.has(key)) return true;
    const entry = { watcher: null, timer: null, closed: false };
    map.set(key, entry);
    const open = () => {
      if (entry.closed) return;
      try {
        entry.watcher?.close();
      } catch {
        // Já fechado.
      }
      try {
        entry.watcher = watch(key, onEvent);
        entry.watcher?.on?.("error", () => {});
      } catch {
        entry.watcher = null;
      }
    };
    const onEvent = () => {
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        open();
        if (!entry.closed) onChange(key);
      }, WATCH_DELAY);
    };
    open();
    return true;
  }

  function unwatchFile(ctx, file) {
    const map = watchers.get(ctx);
    const key = typeof file === "string" ? path.resolve(file) : null;
    const entry = key && map?.get(key);
    if (!entry) return false;
    entry.closed = true;
    clearTimeout(entry.timer);
    try {
      entry.watcher?.close();
    } catch {
      // Já fechado.
    }
    map.delete(key);
    return true;
  }

  return { access, read, stat, save, watchFile, unwatchFile };
}

module.exports = {
  EDITOR_URL,
  MAX_BYTES,
  BINARY_EXT,
  TEXT_EXT,
  createAccess,
  createEditorService,
  detectEncoding,
  detectEol,
  decodeBuffer,
  editorKindOf,
  editorUrlOf,
  encodeText,
  fileOfEditorUrl,
  isEditorUrl,
  normalizeEol,
  sniffFile,
};

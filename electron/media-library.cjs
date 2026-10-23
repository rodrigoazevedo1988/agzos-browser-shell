// Biblioteca de vídeo e áudio (5.1): pastas e arquivos locais para agzos://videos e agzos://musica.
//
// As funções puras (extensões, ordem natural, Range, raízes, URL do protocolo) ficam aqui sem
// tocar no Electron; `registerMediaScheme` e `installMedia` recebem os módulos do Electron de
// quem chama. O arquivo só sai pelo protocolo agzos-media://, com um token aleatório da
// execução (na memória, não gravado): uma página da web não consegue montar a URL.

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");

const MEDIA_SCHEME = "agzos-media";
const LIST_LIMIT = 2000;
const KINDS = ["video", "audio"];

const VIDEO_EXT = ["mp4", "m4v", "webm", "mkv", "mov", "ogv", "avi"];
const AUDIO_EXT = ["mp3", "m4a", "aac", "flac", "wav", "ogg", "opus", "weba"];

const CONTENT_TYPES = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mkv: "video/x-matroska",
  mov: "video/quicktime",
  ogv: "video/ogg",
  avi: "video/x-msvideo",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  wav: "audio/wav",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  weba: "audio/webm",
};

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Extensão em minúsculas, sem o ponto ("Filme.MKV" → "mkv"). */
function extensionOf(name) {
  const base = path.basename(String(name)).toLowerCase();
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1) : "";
}

/** "video", "audio" ou null, pelo nome do arquivo. */
function mediaKindOf(name) {
  const ext = extensionOf(name);
  if (VIDEO_EXT.includes(ext)) return "video";
  if (AUDIO_EXT.includes(ext)) return "audio";
  return null;
}

/** Arquivo de mídia do tipo pedido (sem `kind`, qualquer um dos dois). */
function isMediaFile(name, kind) {
  const found = mediaKindOf(name);
  if (!found) return false;
  return kind === undefined ? true : found === kind;
}

/** Ordem natural: "Aula 2" vem antes de "Aula 10". */
function compareNatural(a, b) {
  return collator.compare(String(a), String(b));
}

function sortByName(items, key = (item) => item.name) {
  return items.sort((a, b) => compareNatural(key(a), key(b)));
}

/**
 * Cabeçalho Range → { full: true } (sem Range válido: 200 com o arquivo todo),
 * { unsatisfiable: true } (416) ou { start, end } (inclusive, 206). Só o primeiro intervalo.
 */
function parseRange(header, size) {
  if (typeof header !== "string" || !header.trim()) return { full: true };
  const first = header.trim().split(",")[0].trim();
  const match = /^bytes=(\d*)-(\d*)$/i.exec(first);
  if (!match || (match[1] === "" && match[2] === "")) return { full: true };
  let start;
  let end;
  if (match[1] === "") {
    // Sufixo: "bytes=-500" são os últimos 500 bytes.
    const suffix = Number(match[2]);
    if (!suffix) return { unsatisfiable: true };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (!Number.isSafeInteger(start) || start >= size || start > end) return { unsatisfiable: true };
  return { start, end };
}

/**
 * Raízes do seletor: início, pastas de vídeo, música, downloads e área de trabalho que existem;
 * no Windows as unidades; no Mac os volumes; no Linux /media e /mnt.
 */
function rootsOf({
  platform = process.platform,
  home = os.homedir(),
  known = {},
  exists = fs.existsSync,
  listDirs = listSubdirs,
} = {}) {
  const roots = [];
  const seen = new Set();
  // O caminho do sistema alvo (C:\ só é absoluto para path.win32, mesmo em teste no Linux).
  const pathOf = platform === "win32" ? path.win32 : path.posix;
  const add = (id, label, dir) => {
    if (typeof dir !== "string" || !dir || !pathOf.isAbsolute(dir)) return;
    const key = pathOf.resolve(dir);
    if (seen.has(key) || !exists(key)) return;
    seen.add(key);
    roots.push({ id, label, path: key });
  };
  add("home", "Início", home);
  add("videos", "Vídeos", known.videos);
  add("music", "Músicas", known.music);
  add("downloads", "Downloads", known.downloads);
  add("desktop", "Área de trabalho", known.desktop);
  if (platform === "win32") {
    for (let code = 65; code <= 90; code += 1) {
      const letter = String.fromCharCode(code);
      add(`drive-${letter}`, `${letter}:\\`, `${letter}:\\`);
    }
  } else if (platform === "darwin") {
    for (const name of listDirs("/Volumes"))
      add(`volume-${name}`, name, path.join("/Volumes", name));
  } else {
    add("media", "/media", "/media");
    add("mnt", "/mnt", "/mnt");
  }
  return roots;
}

function listSubdirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith(".") && entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * Pasta: pastas e arquivos de mídia (do tipo `kind`), ocultos fora, ordem natural, até
 * LIST_LIMIT entradas. Erro → { error } ("path", "missing", "access", "kind").
 */
function listMedia(dir, kind) {
  if (!KINDS.includes(kind)) return { error: "kind" };
  if (typeof dir !== "string" || !dir || !path.isAbsolute(dir)) return { error: "path" };
  const target = path.resolve(dir);
  let entries;
  try {
    entries = fs.readdirSync(target, { withFileTypes: true });
  } catch (error) {
    return { error: error?.code === "EACCES" || error?.code === "EPERM" ? "access" : "missing" };
  }
  const folders = [];
  const items = [];
  for (const entry of entries.slice(0, LIST_LIMIT)) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(target, entry.name);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      folders.push({ name: entry.name, path: full });
    } else if (stat.isFile() && isMediaFile(entry.name, kind)) {
      items.push({
        name: entry.name,
        path: full,
        size: stat.size,
        mtime: stat.mtimeMs,
        ext: extensionOf(entry.name),
      });
    }
  }
  sortByName(folders);
  sortByName(items);
  const parent = path.dirname(target);
  return {
    dir: target,
    parent: parent !== target ? parent : null,
    folders,
    items,
    truncated: entries.length > LIST_LIMIT,
  };
}

/** URL do protocolo para um arquivo de mídia: o caminho vai inteiro codificado num segmento. */
function mediaUrlOf(file, token) {
  if (typeof file !== "string" || !path.isAbsolute(file) || !mediaKindOf(file)) return null;
  return `${MEDIA_SCHEME}://${token}/${encodeURIComponent(file)}`;
}

/** URL agzos-media → caminho, só com o token da execução e extensão de mídia. */
function filePathOfMediaUrl(value, token) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return null;
  }
  if (url.protocol !== `${MEDIA_SCHEME}:` || !token || url.hostname !== token) return null;
  let file;
  try {
    file = decodeURIComponent(url.pathname.slice(1));
  } catch {
    return null;
  }
  if (!path.isAbsolute(file) || !mediaKindOf(file)) return null;
  return file;
}

/**
 * URL de agzos://videos ou agzos://musica para abrir um arquivo de mídia (`?file=`). Usado
 * quando o sistema entrega o arquivo ou quando uma guia aponta para ele por file://.
 */
function mediaPageUrlOf(file) {
  const kind = mediaKindOf(file);
  if (!kind || typeof file !== "string") return null;
  const page = kind === "video" ? "videos" : "musica";
  return `agzos://${page}?file=${encodeURIComponent(file)}`;
}

const SUBTITLE_LIMIT = 2 * 1024 * 1024;

/**
 * Legenda com o mesmo nome do vídeo, na mesma pasta (.vtt antes de .srt). Devolve o texto
 * (até 2 MB); a conversão de SRT para VTT é na casca.
 */
function subtitleOf(file) {
  if (typeof file !== "string" || !path.isAbsolute(file) || !mediaKindOf(file)) return null;
  const base = file.slice(0, file.length - path.extname(file).length);
  for (const ext of [".vtt", ".srt", ".VTT", ".SRT"]) {
    const candidate = base + ext;
    try {
      const stat = fs.statSync(candidate);
      if (!stat.isFile() || stat.size > SUBTITLE_LIMIT) continue;
      return {
        ext: ext.toLowerCase().slice(1),
        name: path.basename(candidate),
        text: fs.readFileSync(candidate, "utf8"),
      };
    } catch {
      // Sem esta variação: tenta a próxima.
    }
  }
  return null;
}

/** Resposta do protocolo: 200 ou 206 (Range), 416, 403, 404. HEAD não manda corpo. */
function mediaResponse({ url, method = "GET", range = null, token, fsImpl = fs }) {
  const plain = (status) => new Response(null, { status });
  const file = filePathOfMediaUrl(url, token);
  if (!file) return plain(403);
  let stat;
  try {
    stat = fsImpl.statSync(file);
  } catch {
    return plain(404);
  }
  if (!stat.isFile()) return plain(404);
  const base = {
    "Content-Type": CONTENT_TYPES[extensionOf(file)] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    // CORS liberado para o <video> de miniatura (canvas sem contaminar); o token protege.
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  const parsed = parseRange(range, stat.size);
  if (parsed.unsatisfiable) {
    return new Response(null, {
      status: 416,
      headers: { ...base, "Content-Range": `bytes */${stat.size}` },
    });
  }
  const start = parsed.full ? 0 : parsed.start;
  const end = parsed.full ? stat.size - 1 : parsed.end;
  const length = Math.max(0, end - start + 1);
  const headers = { ...base, "Content-Length": String(length) };
  if (!parsed.full) headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
  const status = parsed.full ? 200 : 206;
  if (method === "HEAD" || length === 0) return new Response(null, { status, headers });
  const stream = fsImpl.createReadStream(file, { start, end });
  return new Response(Readable.toWeb(stream), { status, headers });
}

/** Precisa rodar antes de app.whenReady(): o esquema vira "privilegiado" (stream, fetch). */
function registerMediaScheme(protocol) {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        stream: true,
        supportFetchAPI: true,
        corsEnabled: true,
        bypassCSP: false,
      },
    },
  ]);
}

/**
 * Liga o protocolo na sessão padrão (a casca) e os canais media:*. `app` dá os caminhos das
 * pastas de sistema; `session`, `dialog` e `BrowserWindow` são os módulos do Electron.
 */
function installMedia({ ipcMain, session, dialog, BrowserWindow, app, token, allow = () => true }) {
  const secret = token ?? crypto.randomBytes(16).toString("hex");
  session.defaultSession.protocol.handle(MEDIA_SCHEME, (request) =>
    mediaResponse({
      url: request.url,
      method: request.method,
      range: request.headers.get("range"),
      token: secret,
    }),
  );
  const systemPath = (name) => {
    try {
      return app.getPath(name);
    } catch {
      return null;
    }
  };
  // Só a casca das janelas do navegador (o ctx do remetente) usa a biblioteca.
  ipcMain.handle("media:roots", (event) => {
    if (!allow(event)) return [];
    return rootsOf({
      known: {
        videos: systemPath("videos"),
        music: systemPath("music"),
        downloads: systemPath("downloads"),
        desktop: systemPath("desktop"),
      },
    });
  });
  // O preload lê o token uma vez (sendSync) para montar URLs de forma síncrona.
  ipcMain.on("media:token", (event) => {
    event.returnValue = allow(event) ? secret : "";
  });
  ipcMain.handle("media:list", (event, { dir, kind } = {}) =>
    allow(event) ? listMedia(dir, kind) : { error: "access" },
  );
  ipcMain.handle("media:url", (event, { path: file } = {}) =>
    allow(event) ? mediaUrlOf(file, secret) : null,
  );
  ipcMain.handle("media:subtitle", (event, { path: file } = {}) =>
    allow(event) ? subtitleOf(file) : null,
  );
  ipcMain.handle("media:pick-folder", async (event) => {
    if (!allow(event)) return null;
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const result = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  return { token: secret };
}

module.exports = {
  CONTENT_TYPES,
  LIST_LIMIT,
  MEDIA_SCHEME,
  AUDIO_EXT,
  VIDEO_EXT,
  compareNatural,
  extensionOf,
  filePathOfMediaUrl,
  installMedia,
  isMediaFile,
  listMedia,
  mediaKindOf,
  mediaPageUrlOf,
  mediaResponse,
  mediaUrlOf,
  parseRange,
  registerMediaScheme,
  rootsOf,
  subtitleOf,
};

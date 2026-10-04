// Gerenciador de downloads (4.7): tipo do arquivo, pasta de destino, regras de catálogo
// (tipo → pasta, domínio → etiqueta, nome → subpasta), etiquetas e exportação. Tudo puro:
// o main (downloads.cjs) só aplica o resultado. A configuração fica no meta
// `downloadsConfig` do SQLite; nada sai do computador.
const path = require("node:path");

const FILE_TYPES = ["pdf", "image", "video", "audio", "archive", "other"];

const EXTENSIONS = {
  pdf: ["pdf"],
  image: ["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "bmp", "ico", "tif", "tiff", "heic"],
  video: ["mp4", "mkv", "webm", "mov", "avi", "m4v", "wmv", "flv", "mpg", "mpeg"],
  audio: ["mp3", "wav", "ogg", "oga", "flac", "m4a", "aac", "opus", "wma"],
  archive: ["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "zst", "iso", "dmg"],
};

const MAX_RULES = 50;
const MAX_TAGS = 12;
const MAX_TAG_LENGTH = 32;
const MAX_PATTERN = 200;
const TAG_COLOR = /^#[0-9a-f]{6}$/i;

/** pdf | image | video | audio | archive | other, pelo MIME e depois pela extensão. */
function fileTypeOf(filename, mime = "") {
  const type = String(mime || "").toLowerCase();
  if (type === "application/pdf") return "pdf";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  const ext = path
    .extname(String(filename || ""))
    .slice(1)
    .toLowerCase();
  for (const kind of ["pdf", "image", "video", "audio", "archive"]) {
    if (EXTENSIONS[kind].includes(ext)) return kind;
  }
  if (/(zip|x-rar|x-7z|x-tar|gzip|x-bzip|x-xz|zstd)/.test(type)) return "archive";
  return "other";
}

/** Pastas por tipo do PRD, a partir das pastas do sistema. */
function defaultTypeFolders(dirs) {
  return {
    pdf: path.join(dirs.documents, "Agzos", "PDF"),
    image: path.join(dirs.pictures, "Agzos"),
    video: path.join(dirs.videos, "Agzos"),
    audio: path.join(dirs.music, "Agzos"),
    archive: path.join(dirs.downloads, "Arquivos"),
    other: dirs.downloads,
  };
}

function cleanTag(value) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, MAX_TAG_LENGTH)
    : "";
}

/** Etiquetas sem repetir (sem diferenciar maiúsculas), no máximo 12. */
function cleanTags(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const tag = cleanTag(item);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

function absoluteDir(value) {
  return typeof value === "string" && value.length < 1024 && path.isAbsolute(value)
    ? path.normalize(value)
    : "";
}

/** Subpasta relativa sem sair da pasta de destino ("a/b", nunca "../x" nem "/x"). */
function safeSubfolder(value) {
  if (typeof value !== "string") return "";
  const parts = value
    .split(/[\\/]+/)
    .map((part) => part.replace(/[:*?"<>|\u0000-\u001f]/g, "_").trim())
    .filter((part) => part && part !== "." && part !== "..");
  return parts.slice(0, 6).join(path.sep).slice(0, 200);
}

/** Regex do usuário: texto curto e válido, senão null. */
function regexOf(pattern) {
  if (typeof pattern !== "string" || !pattern || pattern.length > MAX_PATTERN) return null;
  try {
    return new RegExp(pattern, "i");
  } catch {
    return null;
  }
}

/** Domínio do link ("www." fora), em minúsculas. */
function hostOfUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function cleanRule(rule, index) {
  if (!rule || typeof rule !== "object") return null;
  const match = ["type", "domain", "name"].includes(rule.match) ? rule.match : null;
  if (!match) return null;
  const pattern = typeof rule.pattern === "string" ? rule.pattern.trim().slice(0, MAX_PATTERN) : "";
  if (!pattern) return null;
  if (match === "name" && !regexOf(pattern)) return null;
  const tag = cleanTag(rule.tag);
  // "type" leva para uma pasta (absoluta); "name" cria subpasta; "domain" etiqueta (e
  // pode mandar para uma pasta também).
  const folder = absoluteDir(rule.folder);
  const subfolder = safeSubfolder(rule.subfolder);
  if (!tag && !folder && !subfolder) return null;
  return {
    id: typeof rule.id === "string" && /^[\w-]{1,40}$/.test(rule.id) ? rule.id : `r${index + 1}`,
    match,
    pattern,
    tag,
    folder,
    subfolder,
    enabled: rule.enabled !== false,
  };
}

/** Configuração gravada → configuração válida (o que não serve volta ao padrão). */
function parseDownloadsConfig(raw, dirs) {
  const value = raw && typeof raw === "object" ? raw : {};
  const defaults = defaultTypeFolders(dirs);
  const byType = {};
  for (const kind of FILE_TYPES) {
    byType[kind] = absoluteDir(value.byType?.[kind]) || defaults[kind];
  }
  const tagColors = {};
  if (value.tagColors && typeof value.tagColors === "object") {
    for (const [name, color] of Object.entries(value.tagColors).slice(0, 100)) {
      const tag = cleanTag(name);
      if (tag && typeof color === "string" && TAG_COLOR.test(color)) tagColors[tag] = color;
    }
  }
  const rules = Array.isArray(value.rules)
    ? value.rules.slice(0, MAX_RULES).map(cleanRule).filter(Boolean)
    : [];
  return {
    dir: absoluteDir(value.dir),
    byTypeOn: value.byTypeOn === true,
    byType,
    rules,
    tagColors,
  };
}

function ruleMatches(rule, { filename, mime, url, type }) {
  if (!rule.enabled) return false;
  if (rule.match === "type") {
    return rule.pattern
      .toLowerCase()
      .split(/[\s,;]+/)
      .filter(Boolean)
      .some((item) => {
        const token = item.replace(/^\./, "");
        if (FILE_TYPES.includes(token)) return token === type;
        if (token.includes("/")) {
          const wanted = token.endsWith("/*") ? token.slice(0, -1) : token;
          return token.endsWith("/*")
            ? String(mime).toLowerCase().startsWith(wanted)
            : String(mime).toLowerCase() === wanted;
        }
        return path.extname(filename).slice(1).toLowerCase() === token;
      });
  }
  if (rule.match === "domain") {
    const host = hostOfUrl(url);
    const wanted = rule.pattern
      .toLowerCase()
      .replace(/^\*?\.?/, "")
      .replace(/^www\./, "");
    return Boolean(host) && (host === wanted || host.endsWith(`.${wanted}`));
  }
  return Boolean(regexOf(rule.pattern)?.test(filename));
}

/**
 * Onde salvar e com que etiquetas. Ordem: pasta global (ou a do tipo, com "organizar por
 * tipo" ligado), depois cada regra que bate (a última pasta vence, subpastas e etiquetas
 * se somam).
 */
function routeDownload(config, { filename, mime = "", url = "" }, fallbackDir) {
  const type = fileTypeOf(filename, mime);
  let dir = config.dir || fallbackDir;
  if (config.byTypeOn) dir = config.byType[type] || dir;
  const tags = [];
  const subfolders = [];
  const matched = [];
  for (const rule of config.rules) {
    if (!ruleMatches(rule, { filename, mime, url, type })) continue;
    matched.push(rule.id);
    if (rule.folder) dir = rule.folder;
    if (rule.subfolder) subfolders.push(rule.subfolder);
    if (rule.tag) tags.push(rule.tag);
  }
  return {
    type,
    dir: subfolders.length ? path.join(dir, ...subfolders) : dir,
    tags: cleanTags(tags),
    rules: matched,
  };
}

const EXPORT_FIELDS = [
  "id",
  "filename",
  "url",
  "path",
  "mime",
  "type",
  "state",
  "totalBytes",
  "receivedBytes",
  "tags",
  "startedAt",
  "endedAt",
];

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  // Fórmula no Excel/Sheets (=, +, -, @) vira texto.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Linhas do histórico → arquivo JSON ou CSV (só metadados, nunca o arquivo baixado). */
function exportDownloads(rows, format) {
  const items = rows.map((row) => ({
    id: row.id,
    filename: row.filename,
    url: row.url,
    path: row.path,
    mime: row.mime,
    type: fileTypeOf(row.filename, row.mime),
    state: row.state,
    totalBytes: row.totalBytes,
    receivedBytes: row.receivedBytes,
    tags: cleanTags(row.tags),
    startedAt: row.startedAt ? new Date(row.startedAt).toISOString() : null,
    endedAt: row.endedAt ? new Date(row.endedAt).toISOString() : null,
  }));
  if (format === "csv") {
    const lines = [EXPORT_FIELDS.join(",")];
    for (const item of items) {
      lines.push(
        EXPORT_FIELDS.map((field) =>
          csvCell(field === "tags" ? item.tags.join("|") : item[field]),
        ).join(","),
      );
    }
    return `${lines.join("\r\n")}\r\n`;
  }
  return `${JSON.stringify({ app: "Agzos Browser", kind: "downloads", items }, null, 2)}\n`;
}

/** Tags gravadas no banco (JSON) → lista. */
function tagsOfColumn(value) {
  try {
    return cleanTags(JSON.parse(value || "[]"));
  } catch {
    return [];
  }
}

module.exports = {
  FILE_TYPES,
  cleanTags,
  defaultTypeFolders,
  exportDownloads,
  fileTypeOf,
  hostOfUrl,
  parseDownloadsConfig,
  routeDownload,
  safeSubfolder,
  tagsOfColumn,
};

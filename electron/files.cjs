// Arquivos locais (4.1.1): o navegador de arquivos do terminal, a abertura de qualquer
// arquivo numa guia e as skills das CLIs de IA.
//
// HTML, SVG, PDF, imagens, áudio/vídeo e texto que o Chromium já mostra abrem por file://
// (as imagens ganham o visualizador do page-preload). O resto passa por agzos-file://,
// servido aqui: código e texto viram uma página de leitura e os binários uma página de
// informações (com "abrir no app do sistema"). As URLs agzos-file levam um token do
// usuário (meta fileToken), então uma página da web não consegue montar uma.

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL, fileURLToPath } = require("node:url");

const FILE_SCHEME = "agzos-file";
/** Leitura de texto: acima disso só o começo do arquivo. */
const TEXT_LIMIT = 4 * 1024 * 1024;
const LIST_LIMIT = 2000;

const NATIVE = new Set(
  (
    "html htm xhtml shtml mht mhtml svg pdf png jpg jpeg jfif pjpeg pjp gif webp avif bmp ico " +
    "apng mp4 m4v webm ogv ogg oga mp3 m4a aac wav flac opus txt text json xml js mjs css log"
  ).split(" "),
);
const IMAGE = new Set("png jpg jpeg jfif pjpeg pjp gif webp avif bmp ico apng svg".split(" "));
const TEXT = new Set(
  (
    "md markdown mdx csv tsv ts tsx mts cts jsx cjs py pyw rb go rs java kt kts scala c h cc cpp " +
    "cxx hpp hh cs fs php pl pm r lua dart swift m mm sh bash zsh fish ps1 psm1 bat cmd yml yaml " +
    "toml ini cfg conf env properties gradle sql graphql gql proto tf hcl vue svelte astro scss " +
    "sass less styl dockerfile makefile mk cmake gitignore gitattributes editorconfig npmrc lock " +
    "patch diff rst adoc tex bib srt vtt ipynb jsonc json5 webmanifest plist reg nix ex exs erl " +
    "hs elm clj cljs ml zig v sol"
  ).split(" "),
);
const TEXT_NAMES = new Set(
  "dockerfile makefile license readme changelog procfile gemfile rakefile vagrantfile".split(" "),
);

function extensionOf(file) {
  const base = path.basename(String(file)).toLowerCase();
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1) : "";
}

/** Primeiros bytes sem NUL e quase só texto → texto. */
function looksLikeText(buffer) {
  if (!buffer.length) return true;
  let control = 0;
  for (const byte of buffer) {
    if (byte === 0) return false;
    if (byte < 9 || (byte > 13 && byte < 32)) control += 1;
  }
  return control / buffer.length < 0.02;
}

function sniff(file) {
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

/** Como uma guia mostra o arquivo: "native" (Chromium), "text" ou "binary" (agzos-file). */
function fileKind(file, { read = sniff } = {}) {
  const ext = extensionOf(file);
  if (NATIVE.has(ext)) return "native";
  const base = path.basename(String(file)).toLowerCase();
  if (TEXT.has(ext) || TEXT.has(base.replace(/^\./, "")) || TEXT_NAMES.has(base)) return "text";
  return read(file);
}

const isImage = (file) => IMAGE.has(extensionOf(file));

function fileUrlOf(file, token) {
  const url = new URL(`${FILE_SCHEME}:///`);
  url.pathname = toUrlPath(file);
  url.searchParams.set("k", token);
  return url.toString();
}

/** Caminho no formato de URL ("C:\a b" → "/C:/a%20b"). */
function toUrlPath(file) {
  return pathToFileURL(file).pathname;
}

/** URL agzos-file → caminho, só com o token certo. */
function pathOfFileUrl(value, token) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== `${FILE_SCHEME}:` || !token || url.searchParams.get("k") !== token) {
    return null;
  }
  try {
    return fileURLToPath(`file://${url.pathname}`);
  } catch {
    return null;
  }
}

/** URL para abrir um caminho numa guia. */
function urlForPath(file, token, options) {
  if (fileKind(file, options) === "native") return pathToFileURL(file).toString();
  return fileUrlOf(file, token);
}

/** file:// de um tipo que o Chromium não mostra → agzos-file; o resto fica igual. */
function viewableUrl(url, token, options) {
  if (typeof url !== "string" || !url.startsWith("file:")) return url;
  let file;
  try {
    file = fileURLToPath(url);
  } catch {
    return url;
  }
  try {
    if (fs.statSync(file).isDirectory()) return url;
  } catch {
    return url;
  }
  return urlForPath(file, token, options);
}

/** Pastas primeiro, depois arquivos, em ordem alfabética (ocultos só se pedido). */
function listDirectory(dir, { hidden = false } = {}) {
  const target = typeof dir === "string" && dir ? path.resolve(dir) : null;
  if (!target) return { ok: false, error: "path" };
  let names;
  try {
    names = fs.readdirSync(target, { withFileTypes: true });
  } catch (error) {
    return { ok: false, error: error?.code === "EACCES" ? "access" : "missing", path: target };
  }
  const entries = [];
  for (const item of names) {
    if (!hidden && item.name.startsWith(".")) continue;
    const full = path.join(target, item.name);
    let stat = null;
    try {
      stat = fs.statSync(full);
    } catch {
      stat = null;
    }
    const isDir = stat ? stat.isDirectory() : item.isDirectory();
    entries.push({
      name: item.name,
      path: full,
      dir: isDir,
      size: stat && !isDir ? stat.size : null,
      modified: stat ? stat.mtimeMs : null,
      image: !isDir && isImage(item.name),
    });
  }
  entries.sort((a, b) =>
    a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
  const parent = path.dirname(target);
  return {
    ok: true,
    path: target,
    parent: parent !== target ? parent : null,
    truncated: entries.length > LIST_LIMIT,
    entries: entries.slice(0, LIST_LIMIT),
  };
}

// --- Páginas do agzos-file ---

const escapeHtml = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit ? value.toFixed(1).replace(".", ",") : value} ${units[unit]}`;
}

const PAGE_STYLE = `
:root { color-scheme: light dark; --bg: #fbfaf8; --fg: #1f1d1b; --muted: #6b6762; --line: #e6e2dc; --accent: #d43420; }
@media (prefers-color-scheme: dark) { :root { --bg: #0e0e0e; --fg: #e8e6e3; --muted: #9a958f; --line: #2a2826; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 system-ui, sans-serif; }
header { position: sticky; top: 0; display: flex; gap: 12px; align-items: center; padding: 10px 16px; background: var(--bg); border-bottom: 1px solid var(--line); }
header h1 { font-size: 14px; margin: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
header small { color: var(--muted); white-space: nowrap; }
header button { margin-left: auto; font: inherit; padding: 5px 12px; border-radius: 8px; border: 1px solid var(--line); background: transparent; color: inherit; cursor: pointer; }
header button:hover { border-color: var(--accent); }
pre { margin: 0; padding: 12px 0; font: 13px/1.55 ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace; counter-reset: line; white-space: pre-wrap; word-break: break-word; }
pre span { display: block; padding: 0 16px 0 64px; position: relative; min-height: 1.55em; }
pre span::before { counter-increment: line; content: counter(line); position: absolute; left: 0; width: 48px; text-align: right; color: var(--muted); opacity: .6; }
.note { padding: 8px 16px; color: var(--muted); }
.info { max-width: 560px; margin: 12vh auto; padding: 24px; border: 1px solid var(--line); border-radius: 14px; }
.info dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 16px; margin: 16px 0 0; }
.info dt { color: var(--muted); }
.info dd { margin: 0; word-break: break-all; }
`;

function page(title, header, body) {
  return [
    "<!doctype html><html lang=pt-BR><head><meta charset=utf-8>",
    "<meta http-equiv=Content-Security-Policy content=\"default-src 'none'; style-src 'unsafe-inline'\">",
    `<title>${escapeHtml(title)}</title><style>${PAGE_STYLE}</style></head><body>`,
    header,
    body,
    "</body></html>",
  ].join("");
}

const openButton =
  '<button type=button data-agzos-open-external title="Abrir com o aplicativo padrão do sistema">Abrir no app do sistema</button>';

function textPage(file, buffer, size) {
  const truncated = size > buffer.length;
  const lines = buffer
    .toString("utf8")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => `<span>${escapeHtml(line)}</span>`)
    .join("");
  const name = path.basename(file);
  return page(
    name,
    `<header><h1 title="${escapeHtml(file)}">${escapeHtml(name)}</h1><small>${formatSize(size)}</small>${openButton}</header>`,
    `${truncated ? `<p class=note>Mostrando os primeiros ${formatSize(buffer.length)}.</p>` : ""}<pre>${lines}</pre>`,
  );
}

function infoPage(file, stat) {
  const name = path.basename(file);
  const ext = extensionOf(file);
  return page(
    name,
    "",
    `<div class=info><header style="position:static;padding:0;border:0"><h1>${escapeHtml(name)}</h1>${openButton}</header>` +
      "<p class=note style=padding:0>O navegador não tem visualização para este tipo de arquivo.</p>" +
      `<dl><dt>Tipo</dt><dd>${escapeHtml(ext ? ext.toUpperCase() : "sem extensão")}</dd>` +
      `<dt>Tamanho</dt><dd>${formatSize(stat.size)}</dd>` +
      `<dt>Modificado</dt><dd>${escapeHtml(new Date(stat.mtimeMs).toLocaleString("pt-BR"))}</dd>` +
      `<dt>Local</dt><dd>${escapeHtml(path.dirname(file))}</dd></dl></div>`,
  );
}

function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}

/** Resposta do agzos-file:// (protocol.handle). */
function handleFileRequest(requestUrl, token, { read = sniff } = {}) {
  const file = pathOfFileUrl(requestUrl, token);
  if (!file) return htmlResponse(page("Arquivo", "", "<p class=note>Endereço inválido.</p>"), 403);
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return htmlResponse(
      page("Arquivo", "", `<p class=note>Arquivo não encontrado: ${escapeHtml(file)}</p>`),
      404,
    );
  }
  if (stat.isDirectory()) {
    return htmlResponse(page("Pasta", "", "<p class=note>Isto é uma pasta.</p>"), 400);
  }
  if (fileKind(file, { read }) === "binary") return htmlResponse(infoPage(file, stat));
  let buffer;
  try {
    const handle = fs.openSync(file, "r");
    try {
      buffer = Buffer.alloc(Math.min(stat.size, TEXT_LIMIT));
      fs.readSync(handle, buffer, 0, buffer.length, 0);
    } finally {
      fs.closeSync(handle);
    }
  } catch {
    return htmlResponse(page("Arquivo", "", "<p class=note>Sem permissão para ler.</p>"), 403);
  }
  return htmlResponse(textPage(file, buffer, stat.size));
}

// --- Skills das CLIs de IA ---

const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

function frontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const result = {};
  if (!match) return result;
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (pair) result[pair[1].toLowerCase()] = pair[2].replace(/^["']|["']$/g, "").trim();
  }
  return result;
}

function firstLine(text) {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---/, "");
  const line = body.split(/\r?\n/).find((item) => item.trim() && !item.startsWith("#"));
  return (line ?? "").trim().slice(0, 200);
}

function readHead(file) {
  try {
    const handle = fs.openSync(file, "r");
    try {
      const buffer = Buffer.alloc(4096);
      const read = fs.readSync(handle, buffer, 0, buffer.length, 0);
      return buffer.subarray(0, read).toString("utf8");
    } finally {
      fs.closeSync(handle);
    }
  } catch {
    return null;
  }
}

function dirEntries(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Skills e comandos das CLIs (Claude Code, Codex, OpenCode, Gemini) do usuário e do
 * projeto (`cwd`). `invoke` é o que se digita no prompt da CLI.
 */
function findSkills({ home, cwd }) {
  const result = [];
  const add = (item) => {
    if (
      result.length < 300 &&
      !result.some((x) => x.tool === item.tool && x.invoke === item.invoke)
    )
      result.push(item);
  };
  const scopes = [{ base: home, scope: "user" }];
  if (cwd && path.resolve(cwd) !== path.resolve(home)) scopes.push({ base: cwd, scope: "project" });
  for (const { base, scope } of scopes) {
    // Claude Code: skills (pasta com SKILL.md) e comandos (.md).
    const skillsDir = path.join(base, ".claude", "skills");
    for (const item of dirEntries(skillsDir)) {
      if (!item.isDirectory()) continue;
      const file = path.join(skillsDir, item.name, "SKILL.md");
      const text = readHead(file);
      if (text === null) continue;
      const meta = frontmatter(text);
      add({
        tool: "claude",
        kind: "skill",
        scope,
        name: meta.name || item.name,
        description: meta.description || firstLine(text),
        invoke: `/${item.name}`,
        file,
      });
    }
    const markdownDirs = [
      { dir: path.join(base, ".claude", "commands"), tool: "claude", prefix: "/" },
      {
        dir:
          scope === "user"
            ? path.join(base, ".config", "opencode", "command")
            : path.join(base, ".opencode", "command"),
        tool: "opencode",
        prefix: "/",
      },
    ];
    if (scope === "user") {
      markdownDirs.push({
        dir: path.join(base, ".codex", "prompts"),
        tool: "codex",
        prefix: "/prompts:",
      });
    }
    for (const { dir, tool, prefix } of markdownDirs) {
      for (const item of dirEntries(dir)) {
        if (!item.isFile() || !item.name.endsWith(".md")) continue;
        const file = path.join(dir, item.name);
        const text = readHead(file) ?? "";
        const name = item.name.slice(0, -3);
        add({
          tool,
          kind: "command",
          scope,
          name,
          description: frontmatter(text).description || firstLine(text),
          invoke: `${prefix}${name}`,
          file,
        });
      }
    }
    const geminiDir = path.join(base, ".gemini", "commands");
    for (const item of dirEntries(geminiDir)) {
      if (!item.isFile() || !item.name.endsWith(".toml")) continue;
      const file = path.join(geminiDir, item.name);
      const text = readHead(file) ?? "";
      const description = /^description\s*=\s*"([^"]*)"/m.exec(text)?.[1] ?? "";
      const name = item.name.slice(0, -5);
      add({ tool: "gemini", kind: "command", scope, name, description, invoke: `/${name}`, file });
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

/** Skill nova do Claude Code (pasta + SKILL.md). Nunca sobrescreve. */
function createSkill({ home, cwd, scope, name, description, body }) {
  const id = String(name ?? "").trim();
  if (!SKILL_NAME.test(id)) return { ok: false, error: "name" };
  const text = typeof description === "string" ? description.replace(/[\r\n]+/g, " ").trim() : "";
  if (!text || text.length > 300) return { ok: false, error: "description" };
  const content = typeof body === "string" ? body.slice(0, 20000) : "";
  const base = scope === "project" && cwd ? cwd : home;
  const dir = path.join(base, ".claude", "skills", id);
  const file = path.join(dir, "SKILL.md");
  if (fs.existsSync(file)) return { ok: false, error: "exists" };
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      file,
      `---\nname: ${id}\ndescription: ${text}\n---\n\n${content.trim() || `# ${id}\n`}\n`,
      { flag: "wx" },
    );
  } catch {
    return { ok: false, error: "storage" };
  }
  return { ok: true, file };
}

/**
 * Arquivos passados pelo sistema na linha de comando (duplo clique, "Abrir com", arrastar
 * para o ícone): só argumentos que não são opções e apontam para um arquivo que existe.
 * O executável e, sem empacotar, o script do app (`electron .`) ficam de fora.
 */
function filesOfArgv(argv, { cwd = process.cwd(), skip = 1, exists = fs.existsSync, isFile } = {}) {
  const check =
    isFile ??
    ((file) => {
      try {
        return fs.statSync(file).isFile();
      } catch {
        return false;
      }
    });
  const files = [];
  const args = (Array.isArray(argv) ? argv : []).slice(skip);
  for (const [index, arg] of args.entries()) {
    if (typeof arg !== "string" || !arg || arg.startsWith("-")) continue;
    // Valor de `-r`/`--require` (script pré-carregado pelo Node/ferramentas), não arquivo.
    if (["-r", "--require"].includes(args[index - 1])) continue;
    let file = arg;
    if (/^file:\/\//i.test(file)) {
      try {
        file = require("node:url").fileURLToPath(file);
      } catch {
        continue;
      }
    }
    if (/^[a-z][a-z0-9+.-]+:/i.test(file) && !/^[a-z]:[\\/]/i.test(file)) continue;
    file = path.resolve(cwd, file);
    if (exists(file) && check(file) && !files.includes(file)) files.push(file);
  }
  return files.slice(0, 20);
}

module.exports = {
  filesOfArgv,
  FILE_SCHEME,
  createSkill,
  fileKind,
  fileUrlOf,
  findSkills,
  formatSize,
  frontmatter,
  handleFileRequest,
  isImage,
  listDirectory,
  looksLikeText,
  pathOfFileUrl,
  urlForPath,
  viewableUrl,
};

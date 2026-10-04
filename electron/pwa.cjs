// PWA instalável (4.1.1). Regras puras e a integração com o sistema:
// - a página avisa (page-preload) que tem <link rel=manifest> e service worker; o main lê
//   o manifesto e decide se dá para instalar (nome, start_url da mesma origem, ícone);
// - instalar grava o app em meta:pwaApps, o ícone em <userData>/pwa/<id>/ e um atalho do
//   sistema (menu Iniciar e área de trabalho no Windows, .desktop no Linux, .app em
//   ~/Applications no macOS) que abre o Agzos com --agzos-pwa=<id>;
// - o app abre numa janela própria, sem a barra de guias, com a partição persist:pwa-<id>
//   (cookies, storage, zoom e permissões separados da guia normal do mesmo site).

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const PWA_ARG = "--agzos-pwa=";
const MAX_APPS = 100;
const ID_RE = /^[a-f0-9]{16}$/;
const DISPLAY = new Set([
  "standalone",
  "fullscreen",
  "minimal-ui",
  "browser",
  "window-controls-overlay",
]);
const COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

function resolveUrl(value, base) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim(), base);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/** "#abc" → "#aabbcc"; outra coisa → null. */
function hexColor(value) {
  if (typeof value !== "string" || !COLOR_RE.test(value.trim())) return null;
  const text = value.trim().toLowerCase();
  return text.length === 4 ? `#${[...text.slice(1)].map((c) => c + c).join("")}` : text;
}

/** Maior lado declarado em "sizes" ("48x48 96x96", "any" = 1024). */
function iconSize(sizes) {
  if (typeof sizes !== "string") return 0;
  if (/\bany\b/i.test(sizes)) return 1024;
  return Math.max(
    0,
    ...sizes
      .split(/\s+/)
      .map((item) => /^(\d+)x(\d+)$/i.exec(item))
      .filter(Boolean)
      .map((match) => Math.min(Number(match[1]), Number(match[2]))),
  );
}

/** Id estável do app: o "id" do manifesto ou o start_url (sem o fragmento). */
function appIdOf(manifestId) {
  return crypto.createHash("sha256").update(manifestId).digest("hex").slice(0, 16);
}

/** Manifesto (JSON) → dados do app, ou null quando falta o essencial. */
function parseManifest(json, { manifestUrl, documentUrl }) {
  if (!isObject(json)) return null;
  const doc = resolveUrl(documentUrl);
  if (!doc) return null;
  const name = String(json.name ?? json.short_name ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 80);
  if (!name) return null;
  let start = resolveUrl(json.start_url, manifestUrl) ?? doc;
  if (start.origin !== doc.origin) start = doc;
  start.hash = "";
  let scope = resolveUrl(json.scope, manifestUrl);
  const startDir = new URL(".", start);
  if (!scope || scope.origin !== start.origin || !start.href.startsWith(scope.href))
    scope = startDir;
  const idUrl = resolveUrl(json.id, start.origin) ?? start;
  idUrl.hash = "";
  const icons = (Array.isArray(json.icons) ? json.icons : [])
    .filter(isObject)
    .map((icon) => ({
      src: resolveUrl(icon.src, manifestUrl)?.href ?? null,
      size: iconSize(icon.sizes),
      type: typeof icon.type === "string" ? icon.type.toLowerCase() : "",
      purpose: typeof icon.purpose === "string" ? icon.purpose.toLowerCase() : "any",
    }))
    .filter((icon) => icon.src)
    .slice(0, 30);
  return {
    id: appIdOf(idUrl.href),
    manifestId: idUrl.href,
    name,
    shortName:
      String(json.short_name ?? "")
        .trim()
        .slice(0, 40) || name,
    startUrl: start.href,
    scope: scope.href,
    origin: start.origin,
    display: DISPLAY.has(json.display) ? json.display : "browser",
    themeColor: hexColor(json.theme_color),
    backgroundColor: hexColor(json.background_color),
    icons,
  };
}

/**
 * Pode instalar? Como o Chrome atual: manifesto com nome e ícone numa página segura. O
 * service worker deixou de ser exigido (4.1.3): o Chrome também não pede mais, e Grok e
 * Gemini não têm um. `display: browser` também vale (o app abre em janela mesmo).
 */
function installability(manifest, { documentUrl }) {
  if (!manifest) return { ok: false, reason: "manifest" };
  let secure = false;
  try {
    const url = new URL(documentUrl);
    secure =
      url.protocol === "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    secure = false;
  }
  if (!secure) return { ok: false, reason: "insecure" };
  if (!manifest.icons.length) return { ok: false, reason: "icon" };
  return { ok: true };
}

/** Ícones em ordem de preferência: "any", formatos que o nativeImage abre, maiores. */
function iconCandidates(icons) {
  const score = (icon) => {
    let value = Math.min(icon.size || 64, 1024);
    if (!icon.purpose.split(/\s+/).includes("any")) value -= 2000;
    if (/svg/.test(icon.type) || /\.svg(\?|$)/i.test(icon.src)) value -= 1500;
    if (/png/.test(icon.type) || /\.png(\?|$)/i.test(icon.src)) value += 100;
    return value;
  };
  return [...icons].sort((a, b) => score(b) - score(a));
}

function scopeContains(scope, url) {
  try {
    return new URL(url).href.startsWith(scope);
  } catch {
    return false;
  }
}

// --- Ícones do sistema ---

/** .ico com PNGs dentro (Windows Vista+). `images`: [{ size, png: Buffer }]. */
function icoFromPngs(images) {
  const list = images.filter((image) => image.png?.length);
  const header = Buffer.alloc(6 + 16 * list.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(list.length, 4);
  let offset = header.length;
  list.forEach((image, index) => {
    const entry = 6 + 16 * index;
    header.writeUInt8(image.size >= 256 ? 0 : image.size, entry);
    header.writeUInt8(image.size >= 256 ? 0 : image.size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.png.length;
  });
  return Buffer.concat([header, ...list.map((image) => image.png)]);
}

const ICNS_TYPES = { 32: "ic11", 64: "ic12", 128: "ic07", 256: "ic08", 512: "ic09", 1024: "ic10" };

/** .icns com PNGs dentro (macOS 10.7+). */
function icnsFromPngs(images) {
  const chunks = images
    .filter((image) => ICNS_TYPES[image.size] && image.png?.length)
    .map((image) => {
      const head = Buffer.alloc(8);
      head.write(ICNS_TYPES[image.size], 0, "ascii");
      head.writeUInt32BE(image.png.length + 8, 4);
      return Buffer.concat([head, image.png]);
    });
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(8);
  head.write("icns", 0, "ascii");
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

/** Nome de arquivo seguro em qualquer sistema. */
function fileNameOf(name) {
  const clean = String(name)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\.+$/, "")
    .trim()
    .slice(0, 60);
  return clean || "App";
}

const desktopEscape = (text) =>
  String(text)
    .replace(/[\r\n]/g, " ")
    .replace(/\\/g, "\\\\");
const execQuote = (text) => `"${String(text).replace(/(["`$\\])/g, "\\$1")}"`;

/** Atalho do menu de aplicativos do Linux (freedesktop). */
function linuxDesktopEntry({ name, exec, args, icon, url }) {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Version=1.0",
    `Name=${desktopEscape(name)}`,
    `Comment=${desktopEscape(`App de ${url} (Agzos Browser)`)}`,
    `Exec=${[exec, ...args].map(execQuote).join(" ")}`,
    `Icon=${desktopEscape(icon)}`,
    "Terminal=false",
    "Categories=Network;WebBrowser;",
    "StartupNotify=true",
    "",
  ].join("\n");
}

const plistEscape = (text) =>
  String(text).replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char]);

/** Arquivos do .app do macOS: um lançador que abre o Agzos com o app pedido. */
function macBundleFiles({ id, name, appBundle, exec, args }) {
  const launcher = appBundle
    ? `exec /usr/bin/open -n -a ${execQuote(appBundle)} --args ${args.map(execQuote).join(" ")}`
    : `exec ${[exec, ...args].map(execQuote).join(" ")}`;
  return {
    "Contents/Info.plist": [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0"><dict>',
      `<key>CFBundleName</key><string>${plistEscape(name)}</string>`,
      `<key>CFBundleDisplayName</key><string>${plistEscape(name)}</string>`,
      `<key>CFBundleIdentifier</key><string>com.agzos.browser.pwa.${id}</string>`,
      "<key>CFBundleExecutable</key><string>launcher</string>",
      "<key>CFBundleIconFile</key><string>icon</string>",
      "<key>CFBundlePackageType</key><string>APPL</string>",
      "<key>CFBundleVersion</key><string>1</string>",
      // Sem LSUIElement: ele marcava o .app do PWA como acessório, e aí o app não
      // ganhava ícone nem presença própria no Dock — abria parecendo mais uma janela do
      // navegador. App de verdade leva ícone, nome e task separados.
      "<key>NSHighResolutionCapable</key><true/>",
      "</dict></plist>",
      "",
    ].join("\n"),
    "Contents/MacOS/launcher": `#!/bin/sh\n# Gerado pelo Agzos Browser.\n${launcher}\n`,
  };
}

/** Onde ficam os atalhos de cada sistema. */
function shortcutPaths({ platform, home, env, name, id }) {
  const file = fileNameOf(name);
  if (platform === "win32") {
    const appData = env.APPDATA || path.win32.join(home, "AppData", "Roaming");
    return {
      menu: path.win32.join(
        appData,
        "Microsoft",
        "Windows",
        "Start Menu",
        "Programs",
        "Agzos Apps",
        `${file}.lnk`,
      ),
      desktop: path.win32.join(home, "Desktop", `${file}.lnk`),
    };
  }
  if (platform === "darwin") {
    return { bundle: path.posix.join(home, "Applications", "Agzos Apps", `${file}.app`) };
  }
  const data = env.XDG_DATA_HOME || path.posix.join(home, ".local", "share");
  return { menu: path.posix.join(data, "applications", `agzos-pwa-${id}.desktop`) };
}

// --- Lista dos apps instalados (meta:pwaApps) ---

function parseApps(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const item of value) {
    if (!isObject(item) || !ID_RE.test(item.id) || seen.has(item.id)) continue;
    if (typeof item.name !== "string" || typeof item.startUrl !== "string") continue;
    if (!resolveUrl(item.startUrl)) continue;
    seen.add(item.id);
    result.push({
      id: item.id,
      name: item.name.slice(0, 80),
      startUrl: item.startUrl,
      scope: typeof item.scope === "string" ? item.scope : item.startUrl,
      origin: typeof item.origin === "string" ? item.origin : new URL(item.startUrl).origin,
      themeColor: hexColor(item.themeColor),
      backgroundColor: hexColor(item.backgroundColor),
      display: DISPLAY.has(item.display) ? item.display : "standalone",
      installedAt: Number.isFinite(item.installedAt) ? item.installedAt : 0,
      shortcuts: isObject(item.shortcuts) ? item.shortcuts : {},
      bounds: isObject(item.bounds) ? item.bounds : null,
      zoom: Number.isFinite(item.zoom) ? Math.max(-8, Math.min(8, item.zoom)) : 0,
    });
    if (result.length >= MAX_APPS) break;
  }
  return result;
}

function createPwaStore({ database }) {
  const read = () => {
    try {
      return parseApps(database?.getMeta("pwaApps"));
    } catch {
      return [];
    }
  };
  const write = (list) => {
    try {
      database?.setMeta("pwaApps", list);
    } catch (error) {
      console.error("Agzos: não foi possível gravar os apps instalados.", error);
    }
  };
  return {
    list: read,
    get: (id) => read().find((item) => item.id === id) ?? null,
    put(app) {
      write([...read().filter((item) => item.id !== app.id), app]);
    },
    update(id, patch) {
      write(read().map((item) => (item.id === id ? { ...item, ...patch } : item)));
    },
    remove(id) {
      write(read().filter((item) => item.id !== id));
    },
  };
}

/** --agzos-pwa=<id> da linha de comando (atalho do sistema). */
function pwaArgOf(argv) {
  const value = (Array.isArray(argv) ? argv : [])
    .find((item) => typeof item === "string" && item.startsWith(PWA_ARG))
    ?.slice(PWA_ARG.length);
  return value && ID_RE.test(value) ? value : null;
}

/** Grava os arquivos do .app (macOS) e marca o lançador como executável. */
function writeMacBundle(bundle, files, icns) {
  fs.rmSync(bundle, { recursive: true, force: true });
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(bundle, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  fs.chmodSync(path.join(bundle, "Contents", "MacOS", "launcher"), 0o755);
  fs.mkdirSync(path.join(bundle, "Contents", "Resources"), { recursive: true });
  fs.writeFileSync(path.join(bundle, "Contents", "Resources", "icon.icns"), icns);
}

module.exports = {
  PWA_ARG,
  appIdOf,
  createPwaStore,
  fileNameOf,
  hexColor,
  icnsFromPngs,
  icoFromPngs,
  iconCandidates,
  iconSize,
  installability,
  linuxDesktopEntry,
  macBundleFiles,
  parseApps,
  parseManifest,
  pwaArgOf,
  scopeContains,
  shortcutPaths,
  writeMacBundle,
};

// PWA como app de verdade no macOS (4.8.3). O .app do PWA é um clone APFS do próprio
// Agzos Browser.app (cp -c: os blocos são compartilhados, quase não gasta disco) com
// Info.plist próprio (identificador br.agzos.browser.pwa.<id>, nome e ícone do PWA) e
// assinatura local (4.8.4: com o certificado do Agzos quando ele está nas Chaves deste
// Mac, senão ad-hoc). O macOS vê outro app: ícone e nome próprios no Dock, no Cmd+Tab e
// no Mission Control, e ciclo de vida separado do navegador.
//
// O clone roda o mesmo código em "modo app" (pwa host): ao abrir, o main lê o marcador
// Contents/Resources/agzos-pwa.json do próprio bundle, troca o perfil para
// <userData do navegador>/PwaApps/<id> e abre só a janela do app. Montagens com symlink
// para o Frameworks do Agzos travam no início (CHECK do Chromium); por isso o clone.
//
// Nada aqui passa por shell: cada passo é execFile com caminho fixo e argumentos já
// validados (id em hex, nome sem caracteres de controle).

const path = require("node:path");

const MARKER_FILE = "agzos-pwa.json";
const MARKER_SCHEMA = 1;
const ICON_NAME = "pwa";
const BUNDLE_PREFIX = "br.agzos.browser.pwa.";
const HOST_DIR = "PwaApps";
const ID_RE = /^[a-f0-9]{16}$/;
const LSREGISTER =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

const OPEN_ARG = "--agzos-open=";

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

function httpUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/** Nome para o Dock: sem caracteres de controle, sem espaços nas pontas, até 80. */
function displayName(name) {
  const clean = String(name ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 80);
  return clean || "App";
}

const bundleIdOf = (id) => `${BUNDLE_PREFIX}${id}`;

/** /…/Agzos Browser.app de um executável dentro de Contents/MacOS. */
function appBundleOf(execPath) {
  return /^(.*?\.app)\/Contents\/MacOS\/[^/]+$/.exec(String(execPath ?? ""))?.[1] ?? null;
}

const markerPathOf = (bundle) => path.posix.join(bundle, "Contents", "Resources", MARKER_FILE);

/** Perfil do app: dentro do perfil do navegador, um por PWA (lock e banco próprios). */
function hostUserData(browserUserData, id) {
  return path.join(browserUserData, HOST_DIR, id);
}

/** Marcador gravado no clone: tudo o que o modo app precisa sem abrir o banco do navegador. */
function pwaMarker(record, { version, agzosApp, userData }) {
  return {
    schema: MARKER_SCHEMA,
    id: record.id,
    name: displayName(record.name),
    startUrl: record.startUrl,
    scope: record.scope,
    origin: record.origin,
    themeColor: record.themeColor ?? null,
    backgroundColor: record.backgroundColor ?? null,
    display: record.display ?? "standalone",
    version,
    agzosApp,
    userData,
  };
}

/** Lê e valida o marcador; qualquer coisa fora do esperado vira null (abre o navegador). */
function parseMarker(value) {
  if (!isObject(value) || value.schema !== MARKER_SCHEMA || !ID_RE.test(value.id)) return null;
  const start = httpUrl(value.startUrl);
  if (!start) return null;
  const scope = httpUrl(value.scope) ?? start;
  if (scope.origin !== start.origin) return null;
  if (typeof value.userData !== "string" || !path.isAbsolute(value.userData)) return null;
  return {
    schema: MARKER_SCHEMA,
    id: value.id,
    name: displayName(value.name),
    startUrl: start.href,
    scope: scope.href,
    origin: start.origin,
    themeColor: typeof value.themeColor === "string" ? value.themeColor : null,
    backgroundColor: typeof value.backgroundColor === "string" ? value.backgroundColor : null,
    display: typeof value.display === "string" ? value.display : "standalone",
    version: typeof value.version === "string" ? value.version : null,
    agzosApp:
      typeof value.agzosApp === "string" && value.agzosApp.endsWith(".app") ? value.agzosApp : null,
    userData: value.userData,
  };
}

function readMarker(file, fs) {
  try {
    return parseMarker(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

/** O clone precisa ser refeito: outra versão do Agzos, outro lugar dele ou outro nome. */
function needsRebuild(marker, { version, agzosApp, name }) {
  if (!marker) return true;
  return (
    marker.version !== version || marker.agzosApp !== agzosApp || marker.name !== displayName(name)
  );
}

/** --agzos-open=<url>: o app de um PWA pede ao navegador para abrir um link (só http/https). */
function openArgOf(argv) {
  const value = (Array.isArray(argv) ? argv : [])
    .find((item) => typeof item === "string" && item.startsWith(OPEN_ARG))
    ?.slice(OPEN_ARG.length);
  return httpUrl(value)?.href ?? null;
}

/**
 * O certificado fixado (SHA-1) está entre as identidades de assinatura válidas do Mac?
 * `output` é o de `security find-identity -v -p codesigning`.
 */
function hasSigningIdentity(output, sha1) {
  const want = String(sha1 ?? "").toUpperCase();
  return (
    /^[0-9A-F]{40}$/.test(want) &&
    String(output ?? "")
      .split("\n")
      .some((line) => new RegExp(`^\\s*\\d+\\)\\s+${want}\\s`, "i").test(line))
  );
}

/**
 * Argumentos do codesign para o clone: com o certificado do Agzos (o "Permitir sempre" das
 * Chaves fica valendo entre versões) ou ad-hoc nos Macs sem ele. Runtime endurecido e os
 * entitlements do app original; o identificador sai do Info.plist do clone.
 */
function cloneSignArgs(bundle, identity) {
  return [
    "--force",
    "--sign",
    identity || "-",
    "--options",
    "runtime",
    "--preserve-metadata=entitlements",
    "--timestamp=none",
    bundle,
  ];
}

/** Chaves do Info.plist do clone (CFBundleName fica: o Electron acha os helpers por ele). */
function plistEdits(marker) {
  return [
    ["CFBundleIdentifier", "string", bundleIdOf(marker.id)],
    ["CFBundleDisplayName", "string", marker.name],
    ["CFBundleIconFile", "string", ICON_NAME],
    ["LSUIElement", "bool", "NO"],
  ];
}

/**
 * Monta o .app do PWA. `run(file, args)` é execFile em promise; `fs` é o node:fs.
 * Monta ao lado do destino e só troca no fim: um app aberto segue com os arquivos
 * antigos (o macOS mantém o que já está mapeado) e nunca fica um bundle pela metade.
 */
async function buildMacPwaApp({ source, target, marker, icns, run, fs, identity = null }) {
  const tmp = `${target}.agzos-tmp`;
  const old = `${target}.agzos-old`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(old, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    try {
      await run("/bin/cp", ["-Rc", source, tmp]);
    } catch {
      // Volume sem APFS (sem clonefile): cópia comum.
      fs.rmSync(tmp, { recursive: true, force: true });
      await run("/bin/cp", ["-R", source, tmp]);
    }
    const plist = path.posix.join(tmp, "Contents", "Info.plist");
    for (const [key, type, value] of plistEdits(marker)) {
      await run("/usr/bin/plutil", ["-replace", key, `-${type}`, value, plist]);
    }
    // O PWA não aparece no "Abrir com" do Finder (só o navegador).
    await run("/usr/bin/plutil", ["-remove", "CFBundleDocumentTypes", plist]).catch(() => {});
    const resources = path.posix.join(tmp, "Contents", "Resources");
    fs.writeFileSync(path.posix.join(resources, `${ICON_NAME}.icns`), icns);
    fs.writeFileSync(path.posix.join(resources, MARKER_FILE), JSON.stringify(marker, null, 2));
    // Atributos do Finder no clone fazem o codesign recusar ("detritus not allowed").
    await run("/usr/bin/xattr", ["-cr", tmp]);
    // Sem --deep: só o executável e o selo do bundle mudam; o framework segue clonado.
    await run("/usr/bin/codesign", cloneSignArgs(tmp, identity));
    if (fs.existsSync(target)) fs.renameSync(target, old);
    fs.renameSync(tmp, target);
  } catch (error) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw error;
  }
  fs.rmSync(old, { recursive: true, force: true });
  // Ícone e nome novos no Dock sem esperar o LaunchServices perceber sozinho.
  await run(LSREGISTER, ["-f", target]).catch(() => {});
  return target;
}

module.exports = {
  BUNDLE_PREFIX,
  HOST_DIR,
  ICON_NAME,
  MARKER_FILE,
  OPEN_ARG,
  appBundleOf,
  buildMacPwaApp,
  cloneSignArgs,
  hasSigningIdentity,
  bundleIdOf,
  displayName,
  hostUserData,
  markerPathOf,
  needsRebuild,
  openArgOf,
  parseMarker,
  plistEdits,
  pwaMarker,
  readMarker,
};

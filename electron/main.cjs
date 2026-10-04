const {
  app,
  BrowserWindow,
  WebContentsView,
  Menu,
  session,
  clipboard,
  ClipboardItem,
  ipcMain,
  screen,
  shell,
  safeStorage,
  net,
  webContents,
  systemPreferences,
  dialog,
  nativeImage,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { openDatabase } = require("./db.cjs");
const {
  createAdblock,
  listsFromEnv,
  COLLECT_DOM_SOURCE,
  AUTH_PATH_SOURCE,
} = require("./adblock.cjs");
const { createDownloadManager } = require("./downloads.cjs");
const { nextZoom, zoomHostOf } = require("./zoom.cjs");
const {
  createPanelLog,
  isPanelLoginPage,
  loginReason,
  panelZoomKey,
  panelZoomStep,
  parsePanelZooms,
  unloadPanelPages,
} = require("./panel-session.cjs");
const {
  createPermissions,
  permissionTypesOf,
  checkTypesOf,
  requestOrigin,
  AUTO_ALLOWED,
} = require("./permissions.cjs");
const { fetchSuggestions } = require("./suggest.cjs");
const { createAgzosKey } = require("./agzos-key.cjs");
const { createUpdater, compareVersions, DEFAULT_FEED } = require("./updater.cjs");
const {
  createWindowStore,
  fitBounds,
  cascadeBounds,
  safeSession,
  STABLE_AFTER_MS,
} = require("./windows.cjs");
const { HOVER_CARD_HTML, cardBounds, metricRows } = require("./hover-card.cjs");
const { SWITCHER_HTML, switcherChoice, switcherBounds } = require("./switcher-layer.cjs");
const {
  createLayerView,
  sanitizeOverlay,
  pagePoint,
  wheelEvent,
  clickEvents,
  overlayDebugger,
} = require("./chrome-overlay.cjs");
const {
  CHECK_INTERVAL_MS,
  hibernateConfigOf,
  canHibernate,
  restorableHistory,
  EDITED_FORM_SOURCE,
} = require("./hibernate.cjs");
const { createGxControl, runSpeedTest } = require("./gx-control.cjs");
const { createAi, AGENT_PLAN_SYSTEM, parseAgentPlan } = require("./ai.cjs");
const { createTerminals, cwdReader, terminalKeepsBrowserKey } = require("./terminal.cjs");
const {
  cleanAliases,
  detectCommands,
  onPath,
  prepareAliases,
  sshArgs,
  sshBinary,
} = require("./terminal-launch.cjs");
const { createSecrets } = require("./terminal-secrets.cjs");
const { generateKey, keygenBinary, listKeys } = require("./ssh-keys.cjs");
const { applyGpuFlags, watchGpuCrashes, setGpuEnabled, gpuStatus } = require("./gpu-flags.cjs");
const { SESSION_ID_RE, orphanPartitionDirs, sessionIdsOf } = require("./session-tabs.cjs");
const { createPortsService } = require("./ports-service.cjs");
const { createTunnels, findCloudflared, looksLikeCloudflared } = require("./tunnel.cjs");
const { INSPECTOR_WORLD, inspectorSource } = require("./inspector.cjs");
const { READER_WORLD, cleanArticle, readerProbeSource, readerSource } = require("./reader.cjs");
const { createNetCapture, sendRequest } = require("./scratchpad.cjs");
const { POPUP_MEASURE, createExtensions, popupPlacement } = require("./extensions.cjs");
const { createTooltip } = require("./tooltip.cjs");
const { captureFileName, imageFileName, isPngDataUrl } = require("./capture.cjs");
const {
  CLI_TOOLS,
  agentProgram,
  cleanToolIds,
  installProgram,
  unixInstallScript,
  windowsInstallLines,
  withCliPath,
} = require("./cli-install.cjs");
const {
  FILE_SCHEME,
  createSkill,
  findSkills,
  handleFileRequest,
  listDirectory,
  pathOfFileUrl,
  filesOfArgv,
  urlForPath,
  viewableUrl,
} = require("./files.cjs");
const {
  createPwaStore,
  icnsFromPngs,
  icoFromPngs,
  iconCandidates,
  installability,
  linuxDesktopEntry,
  macBundleFiles,
  parseManifest,
  pwaArgOf,
  scopeContains,
  shortcutPaths,
  writeMacBundle,
} = require("./pwa.cjs");

const DUCK_AI_URL = "https://duck.ai/chat";
const PRIVATE_PARTITION = "agzos-anonima";
// Session Tabs (4.5): uma partição persistente por sessão ("persist:agzos-session-<id>").
const SESSION_PARTITION_PREFIX = "persist:agzos-session-";
const sessionTabSessions = new Set();
const HIDDEN_RECT = { x: 0, y: 0, width: 0, height: 0 };

// Exceção não tratada no main vira log: o diálogo padrão do Electron é modal e, na
// saída do app, seguraria o processo aberto.
process.on("uncaughtException", (error) => {
  console.error("Agzos: erro inesperado no processo principal.", error);
});

// Identidade do app no Windows (agrupamento na barra de tarefas, notificações). O nome
// vem do productName do package.json do pacote; mudar o nome mudaria a pasta do perfil.
if (process.platform === "win32") app.setAppUserModelId("br.agzos.browser");

// Testes e2e isolam o perfil numa pasta temporária.
if (process.env.AGZOS_USER_DATA) app.setPath("userData", process.env.AGZOS_USER_DATA);

// Aceleração de hardware (4.0): flags da GPU e do decode de vídeo antes do ready (depois
// dele o processo da GPU já subiu). Precisa do userData definido (estado em disco).
const gpuRunMode = applyGpuFlags(app);
watchGpuCrashes(app, gpuRunMode);

// Uma instância por perfil (4.1.1): o atalho de um PWA instalado ou um segundo clique no
// ícone chegam à instância aberta (second-instance) em vez de abrir outra com o mesmo
// banco. O lock é por userData (os e2e usam perfis próprios).
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.exit(0);

// macOS: o Finder entrega arquivos por evento (inclusive antes do app ficar pronto).
const pendingSystemFiles = [];
app.on("open-file", (event, file) => {
  event.preventDefault();
  if (app.isReady()) openSystemFiles([file]);
  else pendingSystemFiles.push(file);
});

const isDevelopment = process.argv.some((argument) => argument.startsWith("--dev-url="));
const developmentUrl = process.argv
  .find((argument) => argument.startsWith("--dev-url="))
  ?.slice("--dev-url=".length);

/**
 * Estado de cada janela (1.7): a casca (renderer) e as guias dela. As guias têm id por
 * janela (o renderer de cada janela numera as suas); o main acha a janela pelo
 * event.sender de cada IPC e nunca guarda uma "janela principal".
 *
 * ctx = { window, key, session, views: Map<id, { view, hiddenSince }>, activeTabId,
 *         lastRect, panelOpen, fullscreenActive, crashed: Set, rejected: Set,
 *         failed: Map<id, falha>, hibernated: Map<id, histórico>, unresponsive: Set }
 */
const contexts = new Map();
// webContents.id de cada guia → { ctx, id }. Mover a guia de janela só troca esta entrada.
const tabOfContents = new Map();
// Popups (OAuth) → janela de onde saíram (atalhos, permissões).
const popupOwner = new WeakMap();
const pendingPermissions = new Map();
let lastFocused = null;
let permissionSeq = 0;
let database = null;
let adblock = null;
let downloads = null;
let permissions = null;
let updater = null;
let windowStore = null;
let quitting = false;
// Como a execução anterior terminou (aviso de restauração e modo seguro).
let startup = { unclean: false, early: false, restoredWindows: 0 };
let startupNoticeShown = false;
// Primeiro início depois de uma atualização: { from, to } (aviso "Atualizado com sucesso").
let updatedFrom = null;
// Testes encurtam o tempo da hibernação e o intervalo de verificação.
const HIBERNATE_OVERRIDE = { afterMs: Number(process.env.AGZOS_HIBERNATE_AFTER_MS) || undefined };
let hibernateConfig = hibernateConfigOf(null, HIBERNATE_OVERRIDE);
// Zoom das abas anônimas: vale na sessão, nunca vai para o disco.
const privateZoom = new Map();

// Identidade de Chrome estável: o Google rejeita login quando o user-agent ou os
// Client Hints denunciam Electron/app embutido, ou quando os dois não batem entre si.
const CHROME_VERSION = process.versions.chrome;
const CHROME_MAJOR = CHROME_VERSION.split(".")[0];

function chromePlatform() {
  if (process.platform === "darwin") {
    return {
      token: "Macintosh; Intel Mac OS X 10_15_7",
      name: "macOS",
      // O Chrome manda sempre três partes ("15.6.0").
      version: `${process.getSystemVersion()}.0.0`.split(".").slice(0, 3).join("."),
    };
  }
  if (process.platform === "win32") {
    const build = Number(process.getSystemVersion().split(".")[2] ?? 0);
    return {
      token: "Windows NT 10.0; Win64; x64",
      name: "Windows",
      version: build >= 22000 ? "15.0.0" : "10.0.0",
    };
  }
  return { token: "X11; Linux x86_64", name: "Linux", version: "" };
}

// Mesmo algoritmo de GREASE do Chromium, para as marcas saírem idênticas às do Chrome real.
function chromeBrands(version) {
  const seed = Number(CHROME_MAJOR);
  const chars = [" ", "(", ":", "-", ".", "/", ")", ";", "=", "?", "_"];
  const greaseVersion = ["8", "99", "24"][seed % 3];
  const orders = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ];
  const order = orders[seed % 6];
  const list = [];
  list[order[0]] = {
    brand: `Not${chars[seed % 11]}A${chars[(seed + 1) % 11]}Brand`,
    version: version === CHROME_MAJOR ? greaseVersion : `${greaseVersion}.0.0.0`,
  };
  list[order[1]] = { brand: "Chromium", version };
  list[order[2]] = { brand: "Google Chrome", version };
  return list;
}

const PLATFORM = chromePlatform();
// Chrome real usa o UA reduzido (MAJOR.0.0.0); a versão completa só vai nos Client Hints.
const CLEAN_USER_AGENT = `Mozilla/5.0 (${PLATFORM.token}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36`;
const BRANDS = chromeBrands(CHROME_MAJOR);
const FULL_VERSION_LIST = chromeBrands(CHROME_VERSION);
const brandHeader = (list) =>
  list.map(({ brand, version }) => `"${brand}";v="${version}"`).join(", ");
const ARCHITECTURE = process.arch === "arm64" ? "arm" : "x86";
// O Electron não envia Client Hints; o Chrome manda estes em toda requisição HTTPS.
const LOW_ENTROPY_HINTS = {
  "sec-ch-ua": brandHeader(BRANDS),
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": `"${PLATFORM.name}"`,
};
// E estes só quando o site pede via Accept-CH (o accounts.google.com pede).
const HIGH_ENTROPY_HINTS = {
  "sec-ch-ua-arch": `"${ARCHITECTURE}"`,
  "sec-ch-ua-bitness": '"64"',
  "sec-ch-ua-full-version": `"${CHROME_VERSION}"`,
  "sec-ch-ua-full-version-list": brandHeader(FULL_VERSION_LIST),
  "sec-ch-ua-model": '""',
  "sec-ch-ua-platform-version": `"${PLATFORM.version}"`,
  "sec-ch-ua-wow64": "?0",
  "sec-ch-ua-form-factors": '"Desktop"',
};
const acceptedHints = new Map();

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function rememberAcceptedHints(details) {
  if (details.resourceType !== "mainFrame" || !details.url.startsWith("https://")) return;
  const header = Object.entries(details.responseHeaders ?? {}).find(
    ([key]) => key.toLowerCase() === "accept-ch",
  );
  if (!header) return;
  const names = header[1]
    .join(",")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name in HIGH_ENTROPY_HINTS);
  const origin = originOf(details.url);
  if (origin) acceptedHints.set(origin, new Set(names));
}

function withClientHints(details) {
  const headers = details.requestHeaders;
  if (!details.url.startsWith("https://")) return headers;
  const keys = new Map(Object.keys(headers).map((key) => [key.toLowerCase(), key]));
  const set = (name, value) => {
    headers[keys.get(name) ?? name] = value;
  };
  for (const [name, value] of Object.entries(LOW_ENTROPY_HINTS)) set(name, value);
  for (const name of acceptedHints.get(originOf(details.url)) ?? []) {
    set(name, HIGH_ENTROPY_HINTS[name]);
  }
  return headers;
}
const USER_AGENT_METADATA = {
  brands: BRANDS,
  fullVersionList: FULL_VERSION_LIST,
  platform: PLATFORM.name,
  platformVersion: PLATFORM.version,
  architecture: ARCHITECTURE,
  bitness: "64",
  model: "",
  mobile: false,
  wow64: false,
};

app.userAgentFallback = CLEAN_USER_AGENT;

// Adblock: decide cada requisição de página. A janela da casca (file://) nunca é filtrada.
function requestDecision(details) {
  if (!adblock) return null;
  try {
    const contents = details.webContents;
    if (contents && contexts.has(contents.id)) return null;
    const alive = contents && !contents.isDestroyed();
    let sourceUrl = details.referrer || "";
    try {
      if (details.frame?.url) sourceUrl = details.frame.url;
    } catch {
      // Frame já descartado: fica o referrer.
    }
    return adblock.decide({
      url: details.url,
      resourceType: details.resourceType,
      pageUrl: alive ? contents.getURL() : sourceUrl,
      sourceUrl,
      // O adblock conta por webContents (único entre janelas).
      tabId: alive && tabOfContents.has(contents.id) ? contents.id : undefined,
    });
  } catch {
    return null;
  }
}

// Navegar até um arquivo não troca a página (como no Chrome): avisa a casca para tirar a
// URL do download do histórico da aba; senão ela baixaria de novo ao restaurar a sessão.
function notifyDownloadNavigation(item, contents) {
  if (!contents || contents.isDestroyed() || !tabOfContents.has(contents.id)) return;
  const urls = item.getURLChain();
  // Ctrl+S na própria página: a página continua sendo essa URL.
  if (urls.includes(contents.getURL())) return;
  emitTab(contents, { type: "download-navigation", urls });
}

// Pipeline de rede único por session. O Electron aceita UM listener por evento de
// webRequest: um segundo onBeforeSendHeaders/onHeadersReceived substituiria os Client
// Hints e quebraria o login do Google. Todo recurso novo entra nestas funções.
// Cobre toda session, inclusive a partição em memória das abas anônimas e
// requisições que não passam pela emulação da aba (service workers).
app.on("session-created", (ses) => {
  ses.setUserAgent(CLEAN_USER_AGENT);
  ses.webRequest.onBeforeRequest((details, callback) => {
    callback(requestDecision(details) ?? {});
  });
  ses.webRequest.onHeadersReceived((details, callback) => {
    rememberAcceptedHints(details);
    callback({});
  });
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    callback({ requestHeaders: withClientHints(details) });
  });
  ses.on("will-download", (event, item, contents) => {
    downloads?.track(event, item, contents);
    notifyDownloadNavigation(item, contents);
  });
});

// Roda no mundo principal de cada página, antes dos scripts dela. O detector de
// "navegador não seguro" do Google recusa o login quando window.chrome vem sem
// app/csi/loadTimes (como no Electron) e quando Notification.permission nasce
// "granted"; aqui ficam iguais ao Chromium/Chrome. As funções se apresentam como nativas.
function chromePageShim() {
  const native = new WeakSet();
  const originalToString = Function.prototype.toString;
  const toString = function toString() {
    return native.has(this)
      ? `function ${this.name}() { [native code] }`
      : originalToString.call(this);
  };
  native.add(toString);
  Function.prototype.toString = toString;
  const nativeFn = (name, impl) => {
    Object.defineProperty(impl, "name", { value: name });
    native.add(impl);
    return impl;
  };

  if (window.chrome && !("app" in window.chrome)) {
    const start = performance.timeOrigin / 1000;
    const navigation = () => performance.getEntriesByType("navigation")[0];
    window.chrome.app = {
      isInstalled: false,
      InstallState: {
        DISABLED: "disabled",
        INSTALLED: "installed",
        NOT_INSTALLED: "not_installed",
      },
      RunningState: { CANNOT_RUN: "cannot_run", READY_TO_RUN: "ready_to_run", RUNNING: "running" },
      getDetails: nativeFn("getDetails", () => null),
      getIsInstalled: nativeFn("getIsInstalled", () => false),
      installState: nativeFn("installState", (callback) => callback?.("not_installed")),
      runningState: nativeFn("runningState", () => "cannot_run"),
    };
    window.chrome.csi = nativeFn("csi", () => ({
      startE: Math.round(performance.timeOrigin),
      onloadT: Math.round(performance.timeOrigin + (navigation()?.domContentLoadedEventEnd ?? 0)),
      pageT: performance.now(),
      tran: 15,
    }));
    window.chrome.loadTimes = nativeFn("loadTimes", () => {
      const entry = navigation();
      const protocol = entry?.nextHopProtocol || "http/1.1";
      const multiplexed = protocol === "h2" || protocol === "h3";
      return {
        requestTime: start,
        startLoadTime: start,
        commitLoadTime: start + (entry?.responseStart ?? 0) / 1000,
        finishDocumentLoadTime: start + (entry?.domContentLoadedEventEnd ?? 0) / 1000,
        finishLoadTime: start + (entry?.loadEventEnd ?? 0) / 1000,
        firstPaintTime:
          start + (performance.getEntriesByName("first-paint")[0]?.startTime ?? 0) / 1000,
        firstPaintAfterLoadTime: 0,
        navigationType: "Other",
        wasFetchedViaSpdy: multiplexed,
        wasNpnNegotiated: multiplexed,
        npnNegotiatedProtocol: multiplexed ? protocol : "unknown",
        wasAlternateProtocolAvailable: false,
        connectionInfo: protocol,
      };
    });
  }

  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    Object.defineProperty(Notification, "permission", {
      get: nativeFn("get permission", () => "default"),
      configurable: true,
    });
  }
}

const PAGE_SHIM_SOURCE = `(${chromePageShim.toString()})();`;

// Emulation.setUserAgentOverride alinha navigator.userAgent e navigator.userAgentData
// (inclusive getHighEntropyValues) antes de qualquer script da página rodar.
// Não aguardar os comandos: numa webContents que ainda não navegou eles só respondem
// depois da primeira navegação, e já valem para ela.
function applyChromeIdentity(contents) {
  contents.setUserAgent(CLEAN_USER_AGENT);
  try {
    if (!contents.debugger.isAttached()) contents.debugger.attach("1.3");
    // Sem o domínio Page habilitado, o Chromium aplica os scripts de
    // addScriptToEvaluateOnNewDocument só ao primeiro documento: numa recarga ou
    // navegação na mesma guia (google.com → accounts.google.com) window.chrome voltava
    // vazio e o Google recusava o login.
    contents.debugger.sendCommand("Page.enable").catch(() => {});
    contents.debugger
      .sendCommand("Emulation.setUserAgentOverride", {
        userAgent: CLEAN_USER_AGENT,
        userAgentMetadata: USER_AGENT_METADATA,
      })
      .catch(() => {});
    contents.debugger
      .sendCommand("Page.addScriptToEvaluateOnNewDocument", {
        source: PAGE_SHIM_SOURCE,
        runImmediately: true,
      })
      .catch(() => {});
  } catch {
    // Sem CDP ainda valem o UA limpo e os Client Hints injetados pela session.
  }
}

function isGoogleRejectedUrl(url) {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === "accounts.google.com" && /\/signin\/rejected\/?$/.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

function rejectedContinueUrl(url) {
  try {
    const target = new URL(url).searchParams.get("continue");
    if (target && /^https?:\/\//.test(target)) return target;
  } catch {
    // Cai no endereço padrão abaixo.
  }
  return "https://accounts.google.com/";
}

function send(ctx, channel, payload) {
  const window = ctx?.window;
  if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
}

/** Para todas as janelas (downloads, estatística do escudo, atualização). */
function broadcast(channel, payload, except = null) {
  for (const ctx of contexts.values()) if (ctx !== except) send(ctx, channel, payload);
}

function ctxOfEvent(event) {
  return contexts.get(event.sender.id) ?? null;
}

/** Janela dona de um webContents: a casca, uma guia ou um popup aberto por uma guia. */
function ownerCtx(contents) {
  if (!contents || contents.isDestroyed()) return lastFocused;
  return (
    contexts.get(contents.id) ??
    tabOfContents.get(contents.id)?.ctx ??
    popupOwner.get(contents) ??
    sidePanelOwner.get(contents.id) ??
    lastFocused
  );
}

/** Evento de uma guia para a casca da janela dela, com o id que a casca conhece. */
function emitTab(contents, payload) {
  const where = tabOfContents.get(contents.id);
  if (where) send(where.ctx, "agzos:tab-event", { ...payload, id: where.id });
}

function isWebUrl(url) {
  if (url.startsWith("view-source:")) return isWebUrl(url.slice("view-source:".length));
  return (
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("file://") ||
    url.startsWith(`${FILE_SCHEME}:`) ||
    // 4.5: popup e opções de uma extensão carregada abrem numa guia.
    Boolean(extensions?.isExtensionUrl(url))
  );
}

function fullRect(ctx) {
  const [width, height] = ctx.window.getContentSize();
  return { x: 0, y: 0, width, height };
}

/** Guias à vista na janela: a ativa, ou as duas da tela dividida (2.0). */
function paneIds(ctx) {
  if (ctx.split && ctx.split.includes(ctx.activeTabId)) return ctx.split;
  return ctx.activeTabId === null ? [] : [ctx.activeTabId];
}

/** Área da guia na janela: a do pane dela na tela dividida, senão a da guia ativa. */
function rectOf(ctx, id) {
  if (ctx.split && ctx.split.includes(ctx.activeTabId)) return ctx.paneRects.get(id) ?? null;
  return ctx.lastRect;
}

/** A guia aparece por cima da casca (sem painel, tela de erro, crash ou login recusado). */
function isShown(ctx, id) {
  return (
    paneIds(ctx).includes(id) &&
    !ctx.panelOpen &&
    !(ctx.sidePanelExpanded && ctx.sidePanel) &&
    !ctx.covered.has(id) &&
    !ctx.crashed.has(id) &&
    !ctx.rejected.has(id) &&
    !ctx.failed.has(id)
  );
}

function applyLayout(ctx) {
  layoutSidePanels(ctx);
  if (ctx.fullscreenActive || ctx.window.isDestroyed()) return;
  const now = Date.now();
  const panes = paneIds(ctx);
  for (const [id, entry] of ctx.views) {
    const rect = isShown(ctx, id) ? rectOf(ctx, id) : null;
    entry.view.setBounds(rect ?? HIDDEN_RECT);
    // Hibernação conta o tempo desde que a guia deixou de estar à vista.
    if (panes.includes(id)) {
      entry.hiddenSince = null;
      // GX Control: guia à vista sai da desaceleração de CPU.
      if (!entry.view.webContents.isDestroyed()) gxControl.visible(entry.view.webContents.id);
    } else entry.hiddenSince ??= now;
  }
}

/** Guia à vista cujo pane contém o ponto (coordenadas da janela). */
function paneAt(ctx, point) {
  for (const id of paneIds(ctx)) {
    if (!isShown(ctx, id)) continue;
    const contents = tabContents(ctx, id);
    const inside = contents && pagePoint(rectOf(ctx, id), point);
    if (inside) return { id, contents, point: inside };
  }
  return null;
}

function notifyTabState(contents) {
  const where = tabOfContents.get(contents.id);
  if (!where || contents.isDestroyed()) return;
  const { ctx, id } = where;
  // Preparação com about:blank (loadWithScriptlets): a casca continua mostrando o site.
  if (primingContents.has(contents)) return;
  ctx.crashed.delete(id);
  const url = contents.getURL();
  const rejected = isGoogleRejectedUrl(url);
  if (rejected !== ctx.rejected.has(id)) {
    if (rejected) ctx.rejected.add(id);
    else ctx.rejected.delete(id);
    applyLayout(ctx);
    send(ctx, "agzos:tab-event", {
      type: "login-rejected",
      id,
      rejected,
      continueUrl: rejected ? rejectedContinueUrl(url) : null,
    });
  }
  send(ctx, "agzos:tab-event", {
    type: "tab-updated",
    id,
    url,
    title: contents.getTitle(),
    canBack: contents.navigationHistory.canGoBack(),
    canForward: contents.navigationHistory.canGoForward(),
  });
}

/** Link aberto em nova guia na janela de onde ele saiu. */
function openInNewTab(contents, url) {
  // 4.5: a guia nova herda a sessão (anônima ou Session Tab) da guia de onde saiu.
  const from = tabOfContents.get(contents.id)?.id;
  send(
    ownerCtx(contents),
    "agzos:open-request",
    Number.isSafeInteger(from) ? { url, from } : { url },
  );
}

/** Download que abre o diálogo nativo "Salvar como" (Ctrl+S e menus "Salvar … como"). */
function saveAs(contents, url) {
  if (!isWebUrl(url) || url.startsWith("view-source:")) return;
  downloads?.askNext(contents);
  contents.downloadURL(url);
}

/**
 * "Salvar imagem já carregada" (4.5): o arquivo sai do recurso que a página já tem (CDP
 * Page.getResourceContent), para a pasta escolhida. Se o recurso não estiver mais na
 * memória da página, cai no "Salvar como" comum.
 */
async function saveLoadedImage(contents, url) {
  if (contents.isDestroyed() || !/^(https?:|data:image\/)/.test(url)) return;
  let content = null;
  try {
    if (!contents.debugger.isAttached()) contents.debugger.attach("1.3");
    const tree = await contents.debugger.sendCommand("Page.getResourceTree");
    const frames = [];
    const walk = (node) => {
      if (!node) return;
      frames.push(node);
      for (const child of node.childFrames ?? []) walk(child);
    };
    walk(tree?.frameTree);
    const owner =
      frames.find((node) => node.resources?.some((item) => item.url === url)) ?? frames[0];
    if (owner) {
      const result = await contents.debugger.sendCommand("Page.getResourceContent", {
        frameId: owner.frame.id,
        url,
      });
      const resource = owner.resources?.find((item) => item.url === url);
      content = {
        data: Buffer.from(result.content, result.base64Encoded ? "base64" : "utf8"),
        mime: resource?.mimeType ?? "",
      };
    }
  } catch {
    content = null;
  }
  if (!content?.data.length) {
    saveAs(contents, url);
    return;
  }
  const ctx = ownerCtx(contents);
  const remembered = database?.getMeta("imageSaveDir");
  const folder =
    typeof remembered === "string" && fs.existsSync(remembered)
      ? remembered
      : app.getPath("pictures");
  const options = {
    title: "Salvar imagem já carregada",
    defaultPath: path.join(folder, imageFileName(url, content.mime)),
  };
  const result =
    ctx && !ctx.window.isDestroyed()
      ? await dialog.showSaveDialog(ctx.window, options)
      : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return;
  try {
    fs.writeFileSync(result.filePath, content.data);
    database?.setMeta("imageSaveDir", path.dirname(result.filePath));
  } catch (error) {
    console.error("Agzos: não foi possível salvar a imagem.", error);
  }
}

function buildPageContextMenu(contents, params) {
  const template = [];
  const canBack = contents.navigationHistory.canGoBack();
  const canForward = contents.navigationHistory.canGoForward();

  template.push(
    { label: "Voltar", enabled: canBack, click: () => contents.navigationHistory.goBack() },
    { label: "Avançar", enabled: canForward, click: () => contents.navigationHistory.goForward() },
    { label: "Recarregar", click: () => contents.reload() },
    { type: "separator" },
    {
      label: "Perguntar ao DuckDuckGo",
      click: () => {
        if (params.selectionText) clipboard.writeText(params.selectionText);
        openInNewTab(contents, DUCK_AI_URL);
      },
    },
    { type: "separator" },
    {
      label: "Salvar como…",
      accelerator: "CmdOrCtrl+S",
      click: () => saveAs(contents, contents.getURL()),
    },
    { label: "Imprimir…", accelerator: "CmdOrCtrl+P", click: () => contents.print() },
  );

  const editItems = [];
  if (params.selectionText) editItems.push({ label: "Copiar", click: () => contents.copy() });
  if (params.isEditable) {
    editItems.push({ label: "Colar", click: () => contents.paste() });
    editItems.push({
      label: "Selecionar tudo",
      accelerator: "CmdOrCtrl+A",
      click: () => contents.selectAll(),
    });
  }
  if (editItems.length) {
    template.push({ type: "separator" }, ...editItems);
  }

  if (params.linkURL) {
    template.push(
      { type: "separator" },
      { label: "Abrir link em nova guia", click: () => openInNewTab(contents, params.linkURL) },
      {
        label: "Abrir link em nova janela",
        enabled: isWebUrl(params.linkURL),
        click: () =>
          createWindow({
            near: ownerCtx(contents),
            session: tabSession({
              history: [{ title: params.linkURL, url: params.linkURL, kind: "page" }],
              index: 0,
            }),
          }),
      },
      { label: "Salvar link como…", click: () => saveAs(contents, params.linkURL) },
      { label: "Copiar endereço do link", click: () => clipboard.writeText(params.linkURL) },
    );
  }

  if (params.mediaType === "video") {
    template.push(
      { type: "separator" },
      {
        label: "Picture-in-picture",
        accelerator: "CmdOrCtrl+Shift+P",
        click: () => void togglePictureInPicture(contents),
      },
    );
  }

  if (params.mediaType === "image" && isWebUrl(params.srcURL)) {
    template.push(
      { type: "separator" },
      { label: "Abrir imagem em nova guia", click: () => openInNewTab(contents, params.srcURL) },
      { label: "Salvar imagem como…", click: () => saveAs(contents, params.srcURL) },
      // 4.5: grava o que o navegador já carregou (sem baixar de novo).
      {
        label: "Salvar imagem já carregada…",
        click: () => void saveLoadedImage(contents, params.srcURL),
      },
      { label: "Copiar imagem", click: () => contents.copyImageAt(params.x, params.y) },
    );
  }

  // 4.5: ferramentas da página (mira, leitura, Scratchpad), pelos comandos da casca.
  const pageTab = tabOfContents.get(contents.id);
  if (pageTab && isWebUrl(contents.getURL())) {
    const shellAction = (action, label, accelerator) => ({
      label,
      ...(accelerator ? { accelerator } : {}),
      click: () => send(pageTab.ctx, "agzos:tabmenu-action", { action, tabId: pageTab.id }),
    });
    template.push(
      { type: "separator" },
      shellAction("page.inspect", "Mira de elemento (cores e Tailwind)", "CmdOrCtrl+Shift+C"),
      shellAction("page.reader", "Modo leitura", "CmdOrCtrl+Alt+R"),
      shellAction("scratchpad.capture", "Capturar requisições no Scratchpad"),
    );
  }

  template.push(
    { type: "separator" },
    {
      label: "Exibir código-fonte da página",
      accelerator: "CmdOrCtrl+U",
      click: () => openInNewTab(contents, `view-source:${contents.getURL()}`),
    },
  );

  if (isDevelopment) {
    template.push({ label: "Inspecionar", click: () => contents.openDevTools({ mode: "split" }) });
  }

  return Menu.buildFromTemplate(template);
}

/** Texto vindo da casca para um item de menu (nome de grupo/workspace). */
function menuText(value, fallback) {
  const text = typeof value === "string" ? value.trim().slice(0, 40) : "";
  return text || fallback;
}

function buildTabContextMenu(ctx, context) {
  const { kind, tabId, pinned, muted, audio, hasClosed, orientation, url, tabCount, active } =
    context;
  const groups = Array.isArray(context.groups) ? context.groups.slice(0, 30) : [];
  const workspaces = Array.isArray(context.workspaces) ? context.workspaces.slice(0, 30) : [];
  const action = (id, label, options = {}) => ({
    label,
    ...options,
    click: () => send(ctx, "agzos:tabmenu-action", { action: id, tabId }),
  });
  const loaded = ctx.views.has(tabId);

  if (kind === "strip") {
    return Menu.buildFromTemplate([
      action("tab.new", "Nova guia", { accelerator: "CmdOrCtrl+T" }),
      action("window.new", "Nova janela", { accelerator: "CmdOrCtrl+N" }),
      action("tab.reopen-closed", "Reabrir guia fechada", {
        accelerator: "CmdOrCtrl+Shift+T",
        enabled: Boolean(hasClosed),
      }),
      { type: "separator" },
      action("palette.open", "Buscar comandos", { accelerator: "CmdOrCtrl+K" }),
      action("split.new", "Dividir tela (nova guia ao lado)", {
        accelerator: "CmdOrCtrl+Alt+Shift+S",
      }),
      action("workspaces.open", "Workspaces…"),
      action("workspace.new", "Novo workspace…"),
      action("sidepanels.toggle", "Mostrar/ocultar painéis laterais"),
      { type: "separator" },
      orientation === "vertical"
        ? action("tabs.horizontal", "Mostrar guias horizontalmente")
        : action("tabs.vertical", "Mostrar guias verticalmente"),
    ]);
  }

  const items = [
    action("window.new", "Nova janela", { accelerator: "CmdOrCtrl+N" }),
    action("tab.new-right", "Nova guia à direita"),
    action("tab.reopen-closed", "Reabrir guia fechada", {
      accelerator: "CmdOrCtrl+Shift+T",
      enabled: Boolean(hasClosed),
    }),
    action("tab.duplicate", "Duplicar"),
    action("tab.move-to-window", "Mover para nova janela", { enabled: (tabCount ?? 1) > 1 }),
    { type: "separator" },
    // 2.0: grupos, tela dividida e workspaces.
    action("group.new", "Adicionar guia a novo grupo", { accelerator: "CmdOrCtrl+Shift+G" }),
  ];
  const otherGroups = groups.filter((group) => group?.id !== context.groupId);
  if (otherGroups.length) {
    items.push({
      label: "Adicionar ao grupo",
      submenu: otherGroups.map((group) =>
        action(`group.add:${Number(group.id)}`, menuText(group.title, "Grupo sem nome")),
      ),
    });
  }
  if (Number.isSafeInteger(context.groupId)) {
    items.push(action("group.leave", "Remover do grupo"));
  }
  items.push({ type: "separator" });
  if (context.inSplit) {
    items.push(action("split.swap", "Trocar os lados da tela dividida"));
    items.push(action("split.close", "Desfazer tela dividida"));
  } else if (!active) {
    items.push(action("split.with-tab", "Abrir em tela dividida com a guia atual"));
  } else {
    items.push(action("split.new", "Dividir tela (nova guia ao lado)"));
  }
  const otherWorkspaces = workspaces.filter((item) => item?.id !== context.workspaceId);
  items.push({
    label: "Mover para workspace",
    submenu: [
      ...otherWorkspaces.map((item) =>
        action(
          `workspace.move:${Number(item.id)}`,
          `${menuText(item.icon, "").slice(0, 4)} ${menuText(item.name, "Workspace")}`.trim(),
        ),
      ),
      ...(otherWorkspaces.length ? [{ type: "separator" }] : []),
      action("workspace.new", "Novo workspace…"),
    ],
  });
  items.push(
    { type: "separator" },
    action("tab.toggle-pin", pinned ? "Desfixar" : "Fixar"),
    action("tab.hibernate", "Hibernar guia", { enabled: Boolean(loaded && !active) }),
  );
  if (audio || muted) {
    items.push(action("tab.toggle-mute", muted ? "Ativar som do site" : "Desativar som do site"));
  }
  items.push(
    { type: "separator" },
    action("tab.reload", "Recarregar", { accelerator: "CmdOrCtrl+R" }),
    {
      label: "Copiar endereço",
      enabled: Boolean(url),
      click: () => {
        if (url) clipboard.writeText(url);
      },
    },
    { type: "separator" },
    action("tab.close", "Fechar", { accelerator: "CmdOrCtrl+W" }),
    action("tab.close-others", "Fechar outras guias"),
    action("tab.close-right", "Fechar guias à direita"),
    action("tab.close-left", "Fechar guias à esquerda"),
    { type: "separator" },
    action("tabs.bookmark-all", "Adicionar todas as guias aos favoritos…", {
      accelerator: "CmdOrCtrl+Shift+D",
    }),
    { type: "separator" },
    orientation === "vertical"
      ? action("tabs.horizontal", "Mostrar guias horizontalmente")
      : action("tabs.vertical", "Mostrar guias verticalmente"),
  );
  return Menu.buildFromTemplate(items);
}

const wiredPermissionSessions = new WeakSet();
// Guias que receberam câmera/microfone: não hibernam (a chamada cairia).
const capturingContents = new WeakSet();

function noteMediaGrant(contents, types, allowed) {
  if (allowed && contents && types.some((type) => type === "camera" || type === "microphone")) {
    capturingContents.add(contents);
  }
}

// Permissões por site (electron/permissions.cjs): decisão salva responde sozinha; sem
// decisão, a casca pergunta (barra de permissão) e "Lembrar" grava no SQLite.
function wirePermissions(ses) {
  if (wiredPermissionSessions.has(ses)) return;
  wiredPermissionSessions.add(ses);
  const isPrivate = () => ses === privateSession();
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    // Modo voz do terminal (4.1): o microfone para a própria interface do Agzos (casca ou
    // terminal flutuante), nunca para páginas.
    if (isAppInterface(contents) && permission === "media") {
      // Prévia de artifact (4.1.3) é um iframe na casca: microfone só para o quadro principal.
      if (details?.isMainFrame === false) {
        callback(false);
        return;
      }
      const media = details?.mediaTypes ?? [];
      callback(media.length > 0 && media.every((type) => type === "audio"));
      return;
    }
    const types = permissionTypesOf(permission, details);
    if (!types) {
      callback(AUTO_ALLOWED.includes(permission));
      return;
    }
    const origin = requestOrigin(details);
    const decision = permissions ? permissions.decide(origin, types, isPrivate()) : null;
    if (decision !== null || !origin) {
      noteMediaGrant(contents, types, Boolean(decision));
      callback(Boolean(decision));
      return;
    }
    const id = `perm-${++permissionSeq}`;
    pendingPermissions.set(id, { callback, origin, types, isPrivate: isPrivate(), contents });
    // A pergunta aparece na janela da guia (ou do popup) que pediu.
    send(ownerCtx(contents), "agzos:permission-request", {
      id,
      origin,
      types,
      mediaTypes: details.mediaTypes ?? [],
    });
  });
  // Só o bloqueio explícito muda o check (ver o comentário em permissions.cjs).
  ses.setPermissionCheckHandler((_contents, permission, requestingOrigin, details) => {
    const types = checkTypesOf(permission, details);
    if (!types || !permissions) return true;
    const origin = requestOrigin({ ...details, requestingOrigin });
    return !permissions.blocked(origin, types, isPrivate());
  });
}

// --- Histórico (nunca da aba anônima; ver db.cjs). ---

function recordVisit(contents, url, { sameDocument = false } = {}) {
  // O about:blank da preparação dos scriptlets fica de fora pelo filtro de http(s).
  if (!database || isPrivateContents(contents) || !/^https?:\/\//i.test(url)) return;
  try {
    const title = contents.getTitle();
    // No pushState o título ainda é o da página anterior: o page-title-updated corrige.
    const usable = !sameDocument && title && title !== url && !url.endsWith(title) ? title : "";
    database.addVisit({ url, title: usable });
  } catch (error) {
    console.error("Agzos: não foi possível registrar a visita.", error);
  }
}

function historyCall(work, fallback) {
  if (!database) return fallback;
  try {
    return work(database);
  } catch (error) {
    console.error("Agzos: erro no histórico.", error);
    return fallback;
  }
}

/** Menu nativo genérico (pastas da barra de favoritos, menu de um favorito). */
function menuTemplateOf(items, depth = 0) {
  if (!Array.isArray(items) || depth > 8) return [];
  return items.slice(0, 500).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    if (item.separator) return [{ type: "separator" }];
    const label = String(item.label ?? "").slice(0, 120) || "—";
    if (Array.isArray(item.children)) {
      const submenu = menuTemplateOf(item.children, depth + 1);
      return [
        { label, submenu: submenu.length ? submenu : [{ label: "(vazia)", enabled: false }] },
      ];
    }
    return [{ label, id: String(item.id ?? ""), enabled: item.enabled !== false }];
  });
}

function activeViewEntry(ctx) {
  return ctx?.activeTabId != null ? (ctx.views.get(ctx.activeTabId) ?? null) : null;
}

function handlePageShortcut(ctx, input, event) {
  const meta = input.control || input.meta;
  if (!meta || input.shift || input.alt) return false;
  const key = input.key.toLowerCase();
  const entry = activeViewEntry(ctx);
  if (!entry) return false;
  const contents = entry.view.webContents;
  if (key === "s") {
    event.preventDefault();
    saveAs(contents, contents.getURL());
    return true;
  }
  if (key === "p") {
    event.preventDefault();
    contents.print();
    return true;
  }
  if (key === "u") {
    event.preventDefault();
    const url = contents.getURL();
    if (isWebUrl(url)) openInNewTab(contents, `view-source:${url}`);
    return true;
  }
  return false;
}

// Atalhos que saem da página (ou da casca) para o registro de comandos do renderer.
// Espelha src/features/browser/commands.ts; commands.test.ts confere que não falta nenhum.
const FORWARDED_SHORTCUTS = new Set([
  "mod+t",
  "mod+o",
  "mod+n",
  "mod+w",
  "mod+r",
  "mod+l",
  "mod+k",
  "mod+d",
  "mod+f",
  "mod+j",
  "mod+h",
  "mod+y",
  "mod+shift+o",
  "mod+shift+b",
  "mod+shift+t",
  "mod+shift+p",
  "mod+,",
  "mod+shift+pageup",
  "mod+shift+pagedown",
  "mod+shift+d",
  "mod+shift+n",
  "mod+shift+r",
  // 4.5: Session Tab, mira de elemento, captura, modo leitura e notas.
  "mod+alt+n",
  "mod+shift+c",
  "mod+shift+s",
  "mod+alt+r",
  "mod+shift+m",
  "mod+tab",
  "mod+shift+tab",
  "mod+pagedown",
  "mod+pageup",
  "mod+1",
  "mod+2",
  "mod+3",
  "mod+4",
  "mod+5",
  "mod+6",
  "mod+7",
  "mod+8",
  "mod+9",
  "mod+[",
  "mod+]",
  "mod+shift+g",
  "mod+shift+a",
  "mod+alt+t",
  "mod+alt+shift+s",
  "mod+alt+arrowup",
  "mod+alt+arrowdown",
  "alt+arrowleft",
  "alt+arrowright",
  "mod+=",
  "mod++",
  "mod+shift+=",
  "mod+shift++",
  "mod+-",
  "mod+0",
  "f5",
  "shift+f5",
  "f11",
]);

// Com Ctrl, alguns teclados/layouts do Windows entregam um caractere de controle (ou
// nada) em `key`; aí vale a tecla física (`code`: KeyO → "o", Digit1 → "1").
function shortcutKey(input) {
  const key = String(input.key ?? "");
  if (key.length > 1 || /^[\x21-\x7e]$/.test(key)) return key.toLowerCase();
  const code = /^(?:Key([A-Z])|Digit(\d))$/.exec(String(input.code ?? ""));
  return code ? (code[1] ?? code[2]).toLowerCase() : key.toLowerCase();
}

function shortcutCombo(input) {
  const parts = [];
  if (input.control || input.meta) parts.push("mod");
  if (input.alt) parts.push("alt");
  if (input.shift) parts.push("shift");
  parts.push(shortcutKey(input));
  return parts.join("+");
}

// Ctrl+Tab: o seletor confirma ao soltar o Ctrl, então o keyup do Ctrl precisa chegar.
// Duas regras do Chromium atrapalhavam:
// 1. Tecla consumida pelo navegador (preventDefault no before-input-event) faz o
//    Chromium descartar os eventos seguintes daquela superfície até o próximo keydown
//    (RenderWidgetHostImpl::suppress_events_until_keydown_). O keyup do Tab e o do Ctrl
//    sumiam. Só funcionava quando o Windows repetia o keydown do Ctrl segurado (~0,5 s),
//    por isso "às vezes funciona, às vezes não". Depois do Ctrl+Tab consumido, a mesma
//    superfície recebe um keydown do Ctrl (que está apertado): a supressão acaba e o
//    soltar chega.
// 2. Com o foco na página, o foco fica nela e o seletor aparece numa camada por cima
//    (switcher-layer.cjs): apertar e soltar acontecem na mesma superfície.
const SWITCHER_COMBOS = new Set(["mod+tab", "mod+shift+tab"]);
// Com o seletor aberto e o foco na página, estas teclas vão para o seletor, não para ela.
const SWITCHER_KEYS = new Set([
  "Enter",
  "Escape",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
]);

/** Tira a supressão de teclas do Chromium depois de um Ctrl+Tab consumido (ver acima). */
function releaseKeySuppression(contents, input) {
  // Depois do handler: a supressão é ligada quando ele devolve "consumido".
  setImmediate(() => {
    if (contents.isDestroyed()) return;
    const modifiers = [input.control && "control", input.meta && "meta"].filter(Boolean);
    contents.sendInputEvent({
      type: "keyDown",
      keyCode: input.meta ? "Meta" : "Control",
      modifiers,
    });
  });
}

function forwardAppShortcut(ctx, input, event, { page = false, contents = null } = {}) {
  if (input.type !== "keyDown" || !ctx) return false;
  const combo = shortcutCombo(input);
  if (!FORWARDED_SHORTCUTS.has(combo)) return false;
  // No Mac o ⌘H é "Ocultar Agzos Browser" (a barra de menus trata; histórico é ⌘Y).
  if (process.platform === "darwin" && combo === "mod+h" && input.meta) return false;
  event.preventDefault();
  if (SWITCHER_COMBOS.has(combo) && contents) releaseKeySuppression(contents, input);
  const layer = page && SWITCHER_COMBOS.has(combo);
  if (!layer && !ctx.window.isDestroyed()) ctx.window.webContents.focus();
  send(ctx, "agzos:hotkey", {
    // A casca desenha o seletor na camada (a página continua à vista e com o foco).
    layer,
    key: shortcutKey(input),
    shift: Boolean(input.shift),
    alt: Boolean(input.alt),
    meta: Boolean(input.meta),
    ctrl: Boolean(input.control),
  });
  return true;
}

function wireShortcuts(contents, { page = false, zoom = null } = {}) {
  contents.on("before-input-event", (event, input) => {
    // Painel lateral (3.1.1): Ctrl +/−/0 mudam o zoom dele, não o da guia ativa.
    const zoomDirection = zoom ? panelZoomKey(input) : null;
    if (zoomDirection !== null) {
      event.preventDefault();
      zoom(zoomDirection);
      return;
    }
    // A janela é resolvida a cada tecla: a guia pode ter mudado de janela.
    const ctx = ownerCtx(contents);
    // Soltar o Ctrl/⌘ confirma o seletor do Ctrl+Tab, onde quer que esteja o foco.
    if (input.type === "keyUp" && (input.key === "Control" || input.key === "Meta")) {
      send(ctx, "agzos:modifier-up", { key: input.key });
      return;
    }
    if (input.type !== "keyDown") return;
    // Terminal (4.0) com o foco: Ctrl+W, Ctrl+R, Ctrl+L… são do shell, não do navegador.
    if (
      ctx?.terminalFocused &&
      contents === ctx.window.webContents &&
      !terminalKeepsBrowserKey(shortcutCombo(input), {
        mac: process.platform === "darwin",
        meta: Boolean(input.meta),
      })
    ) {
      return;
    }
    if (page && ctx?.switcherOpen && SWITCHER_KEYS.has(input.key)) {
      event.preventDefault();
      send(ctx, "agzos:switcher-key", { key: input.key });
      return;
    }
    // Esc com foco na página para o carregamento (e segue para a página, como no Chrome).
    if (page && input.key === "Escape" && contents.isLoading()) contents.stop();
    if (handlePageShortcut(ctx, input, event)) return;
    forwardAppShortcut(ctx, input, event, { page, contents });
  });
}

// Como no Chrome: window.open com features (width/height…) vira popup de verdade,
// mantendo window.opener e a mesma session — é o que os fluxos OAuth ("Fazer login
// com Google", Apple, Microsoft…) precisam para devolver o resultado à página de origem.
// O resto abre como nova guia.
function wirePopups(contents) {
  contents.setWindowOpenHandler(({ url, disposition }) => {
    if (disposition === "new-window") {
      return {
        action: "allow",
        overrideBrowserWindowOptions: { autoHideMenuBar: true, backgroundColor: "#FFFFFF" },
      };
    }
    if (isWebUrl(url)) openInNewTab(contents, url);
    return { action: "deny" };
  });
  contents.on("did-create-window", (child) => {
    const popup = child.webContents;
    const owner = ownerCtx(contents);
    if (owner) popupOwner.set(popup, owner);
    wirePopups(popup);
    wireShortcuts(popup);
  });
}

const COSMETIC_WORLD_ID = 1717;

/** CSS de ocultação do adblock. `base` na 1ª passada (dom-ready); depois só regras do DOM. */
async function applyCosmetics(contents, base) {
  if (!adblock || contents.isDestroyed()) return;
  const url = contents.getURL();
  // Login, site pausado ou escudo desligado: a página fica intocada (nem leitura do DOM).
  if (!/^https?:\/\//.test(url) || !adblock.appliesTo(url)) return;
  let dom = null;
  try {
    dom = await contents.executeJavaScriptInIsolatedWorld(COSMETIC_WORLD_ID, [
      { code: COLLECT_DOM_SOURCE },
    ]);
  } catch {
    // Página navegou ou foi fechada no meio: segue sem as regras do DOM.
  }
  if (contents.isDestroyed() || contents.getURL() !== url) return;
  const css = adblock.cosmeticCss(url, dom, { base });
  if (css) void contents.insertCSS(css, { cssOrigin: "user" }).catch(() => {});
}

// Miniaturas para o seletor do Ctrl+Tab: tiradas da aba visível (depois de carregar, logo
// depois de ativar e quando o seletor abre), nunca no meio da troca de aba.
const THUMBNAIL_WIDTH = 360;
const thumbnailTimers = new Map();

function isVisible(contents) {
  const where = tabOfContents.get(contents.id);
  if (!where || contents.isDestroyed()) return false;
  const { ctx, id } = where;
  return isShown(ctx, id) && !ctx.fullscreenActive && rectOf(ctx, id) !== null;
}

/** `leaving`: a aba está saindo de cena; o pedido sai antes de ela ser escondida. */
async function captureThumbnail(contents, { leaving = false } = {}) {
  if (!contents || contents.isDestroyed() || !isVisible(contents)) return;
  if (!/^https?:\/\//.test(contents.getURL())) return;
  try {
    const image = await contents.capturePage();
    if (image.isEmpty() || (!leaving && !isVisible(contents))) return;
    const small = image.resize({ width: THUMBNAIL_WIDTH, quality: "good" });
    const dataUrl = `data:image/jpeg;base64,${small.toJPEG(72).toString("base64")}`;
    emitTab(contents, { type: "thumbnail", dataUrl });
  } catch {
    // Aba fechada ou processo reiniciado no meio: fica a miniatura anterior.
  }
}

// 4.6: a página tem artigo legível? A casca mostra o caderno do modo leitura na barra de
// URL só nesse caso. Mede depois de carregar (e de novo um pouco depois, para SPAs).
const readableTimers = new Map();
const readableWired = new WeakSet();

function scheduleReadableProbe(contents) {
  const key = contents.id;
  clearTimeout(readableTimers.get(key));
  const probe = (retry) => {
    if (contents.isDestroyed() || !tabOfContents.has(contents.id)) return;
    const url = contents.getURL();
    if (!/^https?:/.test(url)) {
      emitTab(contents, { type: "readable", url, readable: false });
      return;
    }
    contents
      .executeJavaScriptInIsolatedWorld(READER_WORLD, [{ code: readerProbeSource() }], false)
      .then((readable) => {
        if (contents.isDestroyed() || contents.getURL() !== url) return;
        emitTab(contents, { type: "readable", url, readable: Boolean(readable) });
        if (!readable && retry)
          readableTimers.set(
            key,
            setTimeout(() => probe(false), 2500),
          );
      })
      .catch(() => {});
  };
  readableTimers.set(
    key,
    setTimeout(() => probe(true), 400),
  );
  if (!readableWired.has(contents)) {
    readableWired.add(contents);
    contents.once("destroyed", () => {
      clearTimeout(readableTimers.get(key));
      readableTimers.delete(key);
    });
  }
}

function scheduleThumbnail(contents, delay) {
  const key = contents.id;
  clearTimeout(thumbnailTimers.get(key));
  thumbnailTimers.set(
    key,
    setTimeout(() => {
      thumbnailTimers.delete(key);
      if (!contents.isDestroyed()) void captureThumbnail(contents);
    }, delay),
  );
}

// Scriptlets do adblock (+js, ex.: YouTube). Entram pelo mesmo canal da identidade de
// Chrome (CDP), só nas páginas com regras: nada de preload em todas as páginas, que
// mudava o ambiente das páginas de login e fazia o Google recusar o navegador.
// Scriptlets por aba: hostname → { id, pid, settled }. O Chromium descarta os scripts
// registrados enquanto uma navegação troca de processo; então há duas fases:
// - "early" (antes do loadURL / início da navegação): runImmediately, pega esta carga;
// - "settled" (did-finish-load): registro definitivo para as próximas cargas do site,
//   refeito se o processo da aba mudou.
// Cada script roda só no documento principal do site, e nunca numa página de login.
const scriptletRegistry = new WeakMap();
const MAX_SCRIPTLET_SITES = 30;

const SCRIPTLET_WORLD = "agzos-adblock";

// Guarda: só no documento principal do site, nunca numa página de login.
// Cada scriptlet no seu próprio escopo e try/catch: vários trazem a mesma dependência
// declarada como classe (ex.: `class JSONPath`), e juntos no mesmo escopo viravam um
// SyntaxError que impedia TODOS de rodar (era por isso que o YouTube seguia com anúncios).
// O escopo próprio também evita variáveis globais (scriptletGlobals) visíveis à página.
function scriptletSource(host, scripts) {
  const isolated = scripts.map((script) => `try { (function () {\n${script}\n})(); } catch (_) {}`);
  return `if (window.top === window && location.hostname === ${JSON.stringify(host)} &&
    !new RegExp(${JSON.stringify(AUTH_PATH_SOURCE)}, "i").test(location.pathname)) {
${isolated.join("\n")}
}`;
}

function removeScripts(contents, ids) {
  if (contents.isDestroyed() || !contents.debugger.isAttached()) return;
  for (const identifier of ids) {
    void contents.debugger
      .sendCommand("Page.removeScriptToEvaluateOnNewDocument", { identifier })
      .catch(() => {});
  }
}

/** Devolve uma promessa que resolve quando o registro (se houver) foi confirmado. */
function ensureScriptlets(contents, url, phase) {
  if (!adblock || contents.isDestroyed() || !contents.debugger.isAttached()) return null;
  let host;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    host = parsed.hostname;
  } catch {
    return null;
  }
  const registry = scriptletRegistry.get(contents) ?? new Map();
  scriptletRegistry.set(contents, registry);
  const pid = contents.getOSProcessId();
  const current = registry.get(host);
  if (current?.settled && current.pid === pid) return null;
  if (phase === "early" && current && !current.settled) return null;
  if (!current && registry.size >= MAX_SCRIPTLET_SITES) return null;
  const { main, isolated } = adblock.scriptletsFor(url);
  if (!main.length && !isolated.length) {
    registry.set(host, { ids: [], pid, settled: true });
    return null;
  }
  const entry = { ids: [], pid, settled: phase === "settled" };
  registry.set(host, entry);
  const runImmediately = phase === "early";
  // Mundo da página e mundo isolado (como no uBO), cada um com seu registro.
  const requests = [];
  if (main.length) {
    requests.push({ source: scriptletSource(host, main), runImmediately });
  }
  if (isolated.length) {
    requests.push({
      source: scriptletSource(host, isolated),
      worldName: SCRIPTLET_WORLD,
      runImmediately,
    });
  }
  // Os comandos saem já (sem esperar: numa guia nova só respondem depois da primeira
  // navegação). O registro anterior, se houver, sai quando o novo for confirmado.
  return Promise.all(
    requests.map((params) =>
      contents.debugger
        .sendCommand("Page.addScriptToEvaluateOnNewDocument", params)
        .then(({ identifier }) => entry.ids.push(identifier))
        .catch(() => {
          // Sem CDP a página só fica sem os scriptlets.
        }),
    ),
  ).then(() => {
    if (current?.ids?.length) removeScripts(contents, current.ids);
  });
}

let lastShieldConfig = "";

/** Aplica escudo/sites pausados; só mexe nos scriptlets quando algo mudou de fato. */
function applyShieldConfig(prefs) {
  const config = shieldConfigOf(prefs);
  const key = JSON.stringify([config.enabled, [...config.pausedHosts].sort()]);
  adblock?.setConfig(config);
  if (key === lastShieldConfig) return;
  const first = lastShieldConfig === "";
  lastShieldConfig = key;
  if (!first) resetScriptlets();
}

/**
 * Carrega a URL depois de registrar os scriptlets do site (se houver), para eles rodarem
 * antes dos scripts da página já na primeira carga. Numa guia que ainda não navegou o
 * CDP só confirma depois da navegação: aí o prazo (500 ms) é o tempo de o comando ser
 * processado. Numa guia existente a confirmação chega em milissegundos.
 */
// Guias sendo preparadas com about:blank (a casca não vê essa carga).
const primingContents = new WeakSet();

async function loadWithScriptlets(contents, target) {
  // 4.1.1: arquivo que o Chromium não mostra (código, binário) vai pelo agzos-file.
  const url = viewableUrl(target, fileToken());
  // Guia nova de um site com scriptlets (ex.: YouTube, inclusive ao restaurar a sessão):
  // o CDP de uma guia que nunca navegou não garante o registro a tempo da primeira carga,
  // e numa SPA isso deixaria a sessão inteira sem os scriptlets. Então a guia passa antes
  // por about:blank (local, instantâneo), o registro é confirmado e só depois vem o site.
  const fresh = contents.getURL() === "";
  const { main, isolated } =
    fresh && adblock ? adblock.scriptletsFor(url) : { main: [], isolated: [] };
  if (fresh && (main.length || isolated.length)) {
    primingContents.add(contents);
    await contents.loadURL("about:blank").catch(() => {});
  }
  const registering = ensureScriptlets(contents, url, "early");
  if (registering) {
    await Promise.race([registering, new Promise((resolve) => setTimeout(resolve, 1000))]);
  }
  if (contents.isDestroyed()) return;
  const loading = contents.loadURL(url).catch(() => {});
  if (primingContents.has(contents)) {
    // Assim que o site entra no histórico, o about:blank sai (o "Voltar" não para nele).
    contents.once("did-navigate", () => {
      primingContents.delete(contents);
      try {
        const history = contents.navigationHistory;
        if (history.length() > 1 && history.getEntryAtIndex(0)?.url === "about:blank") {
          history.removeEntryAtIndex(0);
        }
      } catch {
        // Sem a API: o about:blank fica no histórico, sem outro efeito.
      }
      notifyTabState(contents);
    });
  }
  await loading;
}

/** webContents de todas as guias abertas, em todas as janelas. */
function* allTabContents() {
  for (const ctx of contexts.values()) {
    for (const { view } of ctx.views.values()) yield view.webContents;
  }
}

/** Escudo, sites pausados ou listas mudaram: os scriptlets registrados saem. */
function resetScriptlets() {
  for (const contents of allTabContents()) {
    const registry = scriptletRegistry.get(contents);
    if (!registry || contents.isDestroyed()) continue;
    scriptletRegistry.delete(contents);
    for (const { ids } of registry.values()) removeScripts(contents, ids);
  }
}

/** Partição da guia: anônima, Session Tab (4.5, persistente e só dela) ou a padrão. */
function tabPartition(options) {
  if (options?.private) return PRIVATE_PARTITION;
  const id = options?.session;
  return typeof id === "string" && SESSION_ID_RE.test(id)
    ? `${SESSION_PARTITION_PREFIX}${id}`
    : undefined;
}

/** Pastas de Session Tabs fechadas (nenhuma janela salva usa): somem na abertura. */
function removeOrphanSessionPartitions(records) {
  const dir = path.join(app.getPath("userData"), "Partitions");
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of orphanPartitionDirs(names, sessionIdsOf(records))) {
    try {
      fs.rmSync(path.join(dir, name), { recursive: true, force: true });
    } catch {
      // Em uso ou sem permissão: fica para a próxima abertura.
    }
  }
}

/** Sessões das páginas: a padrão, a anônima e as das Session Tabs já abertas. */
function pageSessions() {
  return [session.defaultSession, privateSession(), ...sessionTabSessions];
}

function privateSession() {
  return session.fromPartition(PRIVATE_PARTITION);
}

function isPrivateContents(contents) {
  return contents.session === privateSession();
}

function storedZoom(contents, host) {
  if (isPrivateContents(contents) && privateZoom.has(host)) return privateZoom.get(host);
  const value = database?.getSiteSetting(host, "zoom");
  return typeof value === "number" && value > 0 ? value : 1;
}

/** Aplica o zoom lembrado do host (depois de cada navegação). */
function applyStoredZoom(contents) {
  const host = zoomHostOf(contents.getURL());
  const factor = host ? storedZoom(contents, host) : 1;
  if (Math.abs(contents.getZoomFactor() - factor) > 0.001) contents.setZoomFactor(factor);
  emitTab(contents, { type: "zoom", factor });
}

/** direction: 1 aumenta, -1 diminui, 0 volta a 100 %. Vale para todas as abas do host. */
function changeZoom(contents, direction) {
  if (!contents || contents.isDestroyed()) return;
  const factor = nextZoom(contents.getZoomFactor(), direction);
  const host = zoomHostOf(contents.getURL());
  const isPrivate = isPrivateContents(contents);
  if (host) {
    if (isPrivate) privateZoom.set(host, factor);
    else database?.setSiteSetting(host, "zoom", factor === 1 ? null : factor);
  }
  for (const other of allTabContents()) {
    if (other.isDestroyed()) continue;
    const sameHost = other === contents || (host && zoomHostOf(other.getURL()) === host);
    if (!sameHost || isPrivateContents(other) !== isPrivate) continue;
    other.setZoomFactor(factor);
    emitTab(other, { type: "zoom", factor });
  }
}

// ERR_ABORTED: navegação interrompida (Esc, outro link, download) não é erro de página.
const IGNORED_LOAD_ERRORS = new Set([-3]);

/** A página não carregou: a casca mostra a tela de erro no lugar dela. */
function markLoadFailed(contents, code, description, url) {
  const where = tabOfContents.get(contents.id);
  if (!where || IGNORED_LOAD_ERRORS.has(code)) return;
  const { ctx, id } = where;
  const failure = { code, description: String(description ?? ""), url: String(url ?? "") };
  ctx.failed.set(id, failure);
  applyLayout(ctx);
  send(ctx, "agzos:tab-event", { type: "load-failed", id, failure });
  notifyTabState(contents);
}

function clearLoadFailed(contents) {
  const where = tabOfContents.get(contents.id);
  if (!where || !where.ctx.failed.has(where.id)) return;
  where.ctx.failed.delete(where.id);
  applyLayout(where.ctx);
  send(where.ctx, "agzos:tab-event", { type: "load-failed", id: where.id, failure: null });
}

// --- Gestos (4.0) ---
// A detecção roda nas páginas (page-preload) e na casca; aqui só se descobre a superfície
// (guia, painel ou a guia ativa) e a casca decide a ação pelas preferências.
const GESTURE_NAMES = new Set([
  "swipe-right",
  "swipe-left",
  "pinch",
  "mouse-back",
  "mouse-forward",
  "draw-left",
  "draw-right",
  "draw-up-down",
  "draw-down",
  "draw-down-right",
]);
let gestureConfig = { swipe: true, pinch: true, draw: true, mouse: true };

function emitGesture(ctx, gesture, surface, extra = {}) {
  if (!ctx || !GESTURE_NAMES.has(gesture)) return;
  if (gesture.startsWith("mouse-")) ctx.lastMouseGesture = { gesture, at: Date.now() };
  send(ctx, "agzos:gesture", { gesture, surface, ...extra });
}

/**
 * Botão lateral visto pelo sistema (app-command). A página (ou a casca) também manda o
 * mesmo clique com a superfície certa; espera um pouco e só vale se ela não mandou.
 */
function windowGesture(ctx, gesture) {
  setTimeout(() => {
    const last = ctx.lastMouseGesture;
    if (last && last.gesture === gesture && Date.now() - last.at < 400) return;
    emitGesture(ctx, gesture, { kind: "active" });
  }, 120);
}

/** Superfície de quem mandou o gesto: guia, painel lateral ou a casca (guia ativa). */
function gestureSurface(contents) {
  const where = tabOfContents.get(contents.id);
  if (where) return { ctx: where.ctx, surface: { kind: "tab", id: where.id } };
  const shell = contexts.get(contents.id);
  if (shell) return { ctx: shell, surface: { kind: "active" } };
  const owner = sidePanelOwner.get(contents.id);
  if (owner) {
    for (const [app, entry] of owner.sidePanels) {
      if (entry.view.webContents === contents)
        return { ctx: owner, surface: { kind: "panel", app } };
    }
  }
  return null;
}

function gestureTargets() {
  const list = [];
  for (const ctx of contexts.values()) {
    for (const entry of ctx.views.values()) list.push(entry.view.webContents);
    for (const entry of ctx.sidePanels.values()) list.push(entry.view.webContents);
  }
  return list.filter((contents) => contents && !contents.isDestroyed());
}

function wireView(view) {
  const contents = view.webContents;
  const ctxNow = () => tabOfContents.get(contents.id)?.ctx ?? null;

  // Link para um arquivo local (listagem de pasta do file://): o mesmo desvio da carga.
  contents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file:")) return;
    const target = viewableUrl(url, fileToken());
    if (target === url) return;
    event.preventDefault();
    void contents.loadURL(target).catch(() => {});
  });
  contents.on("did-start-navigation", (details) => {
    if (!details.isMainFrame || details.isSameDocument) return;
    forgetPwa(contents);
    adblock?.resetPage(contents.id);
    ensureScriptlets(contents, details.url, "early");
  });
  contents.on("did-redirect-navigation", (details) => {
    if (details.isMainFrame) ensureScriptlets(contents, details.url, "early");
  });
  contents.on("did-finish-load", () => ensureScriptlets(contents, contents.getURL(), "settled"));
  // Tela dividida (2.0): clicar na página do outro pane faz dela a guia ativa.
  contents.on("focus", () => {
    const where = tabOfContents.get(contents.id);
    if (!where || where.id === where.ctx.activeTabId) return;
    if (where.ctx.split?.includes(where.id)) emitTab(contents, { type: "focused" });
  });
  contents.on("dom-ready", () => void applyCosmetics(contents, true));
  contents.on("did-finish-load", () => void applyCosmetics(contents, false));
  contents.on("found-in-page", (_event, result) => {
    emitTab(contents, {
      type: "find",
      active: result.activeMatchOrdinal ?? 0,
      total: result.matches ?? 0,
    });
  });
  contents.on("zoom-changed", (_event, direction) =>
    changeZoom(contents, direction === "in" ? 1 : -1),
  );
  // Falha na carga: o Chromium não dispara did-navigate (a página de erro dele fica em
  // branco); a tela de erro da casca fica até uma navegação dar certo.
  contents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    if (isMainFrame) markLoadFailed(contents, code, description, url);
  });
  contents.on("did-navigate", () => clearLoadFailed(contents));
  contents.on("did-navigate", () => applyStoredZoom(contents));
  contents.on("did-stop-loading", () => {
    scheduleThumbnail(contents, 600);
    scheduleReadableProbe(contents);
  });
  contents.on("did-navigate", (_event, url) => recordVisit(contents, url));
  contents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    if (isMainFrame) recordVisit(contents, url, { sameDocument: true });
  });
  contents.on("page-title-updated", (_event, title) => {
    if (!isPrivateContents(contents)) {
      historyCall((db) => db.updateHistoryTitle(contents.getURL(), title));
    }
  });
  contents.on("did-navigate", () => notifyTabState(contents));
  contents.on("did-navigate-in-page", () => notifyTabState(contents));
  contents.on("page-title-updated", () => notifyTabState(contents));
  contents.on("page-favicon-updated", (_event, icons) => {
    const icon = icons.at(-1) ?? null;
    if (icon && /^https?:/.test(icon) && !isPrivateContents(contents)) {
      historyCall((db) => db.updateHistoryIcon(contents.getURL(), icon));
    }
    emitTab(contents, { type: "favicon", icon });
  });
  contents.on("media-started-playing", () => emitTab(contents, { type: "audio", playing: true }));
  contents.on("media-paused", () => emitTab(contents, { type: "audio", playing: false }));
  contents.on("audio-state-changed", (_event, muted) => {
    emitTab(contents, { type: "muted", muted });
  });
  contents.on("enter-html-full-screen", () => {
    const ctx = ctxNow();
    if (!ctx) return;
    ctx.fullscreenActive = true;
    closePanelLayer(ctx, { notify: true, refocus: false });
    layoutSidePanels(ctx);
    view.setBounds(fullRect(ctx));
    send(ctx, "agzos:fullscreen", { active: true });
  });
  contents.on("leave-html-full-screen", () => {
    const ctx = ctxNow();
    if (!ctx) return;
    ctx.fullscreenActive = false;
    setTimeout(() => applyLayout(ctx), 50);
    send(ctx, "agzos:fullscreen", { active: false });
  });
  contents.on("context-menu", (event, params) => {
    event.preventDefault();
    const ctx = ctxNow();
    buildPageContextMenu(contents, params).popup(ctx ? { window: ctx.window } : {});
  });
  wirePopups(contents);
  // Página sem resposta (loop infinito): a casca oferece esperar ou encerrar.
  contents.on("unresponsive", () => {
    const where = tabOfContents.get(contents.id);
    where?.ctx.unresponsive.add(where.id);
    emitTab(contents, { type: "unresponsive", value: true });
  });
  contents.on("responsive", () => {
    const where = tabOfContents.get(contents.id);
    where?.ctx.unresponsive.delete(where.id);
    emitTab(contents, { type: "unresponsive", value: false });
  });
  contents.on("render-process-gone", (_event, details) => {
    const where = tabOfContents.get(contents.id);
    if (!where) return;
    const { ctx, id } = where;
    ctx.crashed.add(id);
    ctx.unresponsive.delete(id);
    if (!ctx.fullscreenActive) view.setBounds(HIDDEN_RECT);
    send(ctx, "agzos:tab-event", { type: "crashed", id, reason: details?.reason ?? "crashed" });
  });

  wireShortcuts(contents, { page: true });
}

let localWindowSeq = 0;

function workAreas() {
  try {
    return screen.getAllDisplays().map((display) => display.workArea);
  } catch {
    return [];
  }
}

/** Posição e maximizado da janela vão para o registro (gravado com debounce). */
function rememberBounds(ctx) {
  const { window } = ctx;
  if (window.isDestroyed() || window.isMinimized() || window.isFullScreen()) return;
  windowStore?.update(ctx.key, {
    bounds: window.getNormalBounds(),
    maximized: window.isMaximized(),
  });
}

/** Guia que já existe (movida de outra janela) entra nesta janela com o id `id`. */
function adoptView(ctx, id, moved) {
  if (moved.history) ctx.hibernated.set(id, moved.history);
  if (!moved.view) return;
  ctx.views.set(id, { view: moved.view, hiddenSince: null });
  ctx.window.contentView.addChildView(moved.view);
  raisePanelLayer(ctx);
  moved.view.setBounds(HIDDEN_RECT);
  tabOfContents.set(moved.view.webContents.id, { ctx, id });
}

/**
 * Abre uma janela. `record`: janela restaurada (chave, posição, sessão); `near`: janela
 * de onde ela saiu (abre em cascata); `session`: guias iniciais; `adopt`: guia movida.
 */
function createWindow({ record = null, near = null, session: initial = null, adopt = null } = {}) {
  let bounds = fitBounds(record?.bounds, workAreas());
  if (!bounds && near && !near.window.isDestroyed()) {
    let area = null;
    try {
      area = screen.getDisplayMatching(near.window.getBounds()).workArea;
    } catch {
      area = null;
    }
    bounds = cascadeBounds(near.window.getNormalBounds(), area);
  }
  const window = new BrowserWindow({
    title: "Agzos Browser",
    width: 1440,
    height: 960,
    ...(bounds ?? {}),
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#0E0E0E",
    // Windows e Linux (no Mac vale o .icns do bundle).
    ...(process.platform === "darwin" ? {} : { icon: path.join(__dirname, "icons", "icon.png") }),
    show: false,
    autoHideMenuBar: true,
    // Mac: sem a barra de título nativa; a faixa de abas vira a área de arrastar e os
    // botões reais (semáforo) ficam por cima dela.
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 16, y: 18 } }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const session = record ? record.session : initial;
  const key = record?.key ?? windowStore?.add({ session, bounds }) ?? `local-${++localWindowSeq}`;
  const ctx = {
    window,
    key,
    session,
    views: new Map(),
    activeTabId: null,
    lastRect: null,
    // Tela dividida (2.0): as duas guias e a área de cada pane.
    split: null,
    paneRects: new Map(),
    // Painéis laterais (2.0): app → { view }, o aberto e a área dele.
    sidePanels: new Map(),
    sidePanel: null,
    sidePanelRect: null,
    // 4.5: painel promovido para a área principal (as guias saem de cena enquanto isso).
    sidePanelExpanded: false,
    panelsReleased: false,
    panelDrag: null,
    panelOpen: false,
    fullscreenActive: false,
    crashed: new Set(),
    // 4.5: guias cobertas pela casca (modo leitura): a view sai de cena, a página fica viva.
    covered: new Set(),
    rejected: new Set(),
    failed: new Map(),
    hibernated: new Map(),
    unresponsive: new Set(),
    switcherOpen: false,
    switcherView: null,
    preview: null,
    overlay: null,
    // 4.6.1: dica da barra (view própria; o tooltip nativo cortava no Windows).
    tooltip: null,
  };
  const shellId = window.webContents.id;
  contexts.set(shellId, ctx);
  lastFocused = ctx;
  if (adopt) adoptView(ctx, adopt.id, adopt);

  window.once("ready-to-show", () => {
    if (record?.maximized) window.maximize();
    window.show();
  });
  window.on("focus", () => {
    lastFocused = ctx;
  });
  let boundsTimer = null;
  const saveBoundsSoon = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => rememberBounds(ctx), 300);
  };
  window.on("resize", () => {
    saveBoundsSoon();
    const active = ctx.activeTabId != null ? ctx.views.get(ctx.activeTabId) : null;
    if (ctx.fullscreenActive && active?.view) {
      active.view.setBounds(fullRect(ctx));
      return;
    }
    applyLayout(ctx);
    placePanelLayer(ctx);
  });
  // Arrastar, minimizar ou esconder a janela fecha o painel aberto. Só vale movimento de
  // verdade: o gerenciador de janelas manda "move" (e "blur") soltos ao mostrar a janela.
  const dismissPanel = () => closePanelLayer(ctx, { notify: true, refocus: false });
  window.on("move", () => {
    saveBoundsSoon();
    const from = ctx.overlay?.model ? ctx.overlay.position : null;
    const [x, y] = window.getPosition();
    if (from && (from[0] !== x || from[1] !== y)) dismissPanel();
  });
  window.on("minimize", dismissPanel);
  window.on("hide", dismissPanel);
  window.on("maximize", saveBoundsSoon);
  window.on("unmaximize", saveBoundsSoon);
  window.on("leave-full-screen", () => setTimeout(() => applyLayout(ctx), 50));
  // Gestos (4.0): botões laterais do mouse no Windows/Linux (WM_APPCOMMAND) e o deslizar
  // de três dedos do macOS. O page-preload também vê os botões; ver windowGesture.
  window.on("app-command", (_event, command) => {
    if (command === "browser-backward") windowGesture(ctx, "mouse-back");
    else if (command === "browser-forward") windowGesture(ctx, "mouse-forward");
  });
  window.on("swipe", (_event, direction) => {
    if (direction === "right") emitGesture(ctx, "swipe-right", { kind: "active" });
    else if (direction === "left") emitGesture(ctx, "swipe-left", { kind: "active" });
  });
  // Windows desligando: as janelas fecham uma a uma, mas todas voltam no próximo início.
  window.on("session-end", () => {
    quitting = true;
  });
  window.on("close", (event) => {
    // Painéis abertos: a página descarrega e o storage grava antes (sessão do Discord).
    if (!ctx.panelsReleased && ctx.sidePanels.size > 0) {
      event.preventDefault();
      void releaseSidePanels([ctx]).finally(() => {
        if (!window.isDestroyed()) window.close();
      });
      return;
    }
    clearTimeout(boundsTimer);
    rememberBounds(ctx);
    // Fechar uma janela entre várias descarta as guias dela (como no Chrome). A última
    // janela, ou todas ao sair do app, ficam salvas para o próximo início.
    if (!quitting && contexts.size > 1) windowStore?.remove(ctx.key);
  });
  window.on("blur", () => {
    hidePreview(ctx);
    // Alt+Tab do sistema com o seletor aberto: confirma (como soltar o Ctrl).
    if (ctx.switcherOpen) send(ctx, "agzos:modifier-up", { key: "Control" });
  });
  window.on("closed", () => {
    terminals?.killAll(ctx);
    tunnels.stopOwner(ctx.key);
    closeTerminalPip(ctx);
    if (ctx.preview && !ctx.preview.webContents.isDestroyed()) ctx.preview.webContents.close();
    if (ctx.switcherView && !ctx.switcherView.webContents.isDestroyed()) {
      ctx.switcherView.webContents.close();
    }
    if (ctx.overlay && !ctx.overlay.view.webContents.isDestroyed()) {
      ctx.overlay.view.webContents.close();
    }
    ctx.tooltip?.destroy();
    stopPanelDrag(ctx);
    for (const app of [...ctx.sidePanels.keys()]) unloadSidePanel(ctx, app);
    for (const [id, pending] of pendingOverlayCalls) {
      if (pending.ctx !== ctx) continue;
      pendingOverlayCalls.delete(id);
      clearTimeout(pending.timer);
      pending.resolve(undefined);
    }
    for (const [id, entry] of ctx.views) dropView(ctx, id, entry);
    contexts.delete(shellId);
    if (lastFocused === ctx) lastFocused = contexts.values().next().value ?? null;
    for (const [id, pending] of pendingPermissions) {
      if (ownerCtx(pending.contents) === ctx || pending.contents?.isDestroyed()) {
        pendingPermissions.delete(id);
        pending.callback(false);
      }
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    const allowed = isDevelopment
      ? developmentUrl && url.startsWith(developmentUrl)
      : url.startsWith("file://");
    if (!allowed) event.preventDefault();
  });

  // A casca caiu (renderer da janela): recarrega. As guias continuam vivas no main e a
  // casca volta com a sessão salva (state:load devolve a desta janela).
  let shellCrashes = 0;
  window.webContents.on("render-process-gone", (_event, details) => {
    if (details.reason === "clean-exit" || window.isDestroyed()) return;
    console.error(`Agzos: a casca da janela caiu (${details.reason}); recarregando.`);
    if (++shellCrashes > 3) return;
    setTimeout(() => {
      if (!window.isDestroyed()) window.webContents.reload();
    }, 250);
  });

  wireShortcuts(window.webContents);

  if (isDevelopment && developmentUrl) {
    void window.loadURL(developmentUrl);
  } else {
    void window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
  return ctx;
}

/** Fecha o WebContentsView da guia e esquece tudo dela no main. */
function dropView(ctx, id, entry = ctx.views.get(id)) {
  ctx.crashed.delete(id);
  ctx.rejected.delete(id);
  ctx.failed.delete(id);
  ctx.unresponsive.delete(id);
  ctx.views.delete(id);
  if (!entry?.view) return;
  const contents = entry.view.webContents;
  if (!ctx.window.isDestroyed()) ctx.window.contentView.removeChildView(entry.view);
  tabOfContents.delete(contents.id);
  clearTimeout(thumbnailTimers.get(contents.id));
  thumbnailTimers.delete(contents.id);
  adblock?.forgetTab(contents.id);
  if (!contents.isDestroyed()) contents.close();
}

function keyStorePath() {
  return path.join(app.getPath("userData"), "agzos-key.bin");
}

function tabContents(ctx, id) {
  const contents = ctx?.views.get(id)?.view.webContents;
  return contents && !contents.isDestroyed() ? contents : null;
}

function hasPendingPermission(contents) {
  for (const pending of pendingPermissions.values()) {
    if (pending.contents === contents) return true;
  }
  return false;
}

const FORM_WORLD_ID = 1718;

/** Formulário preenchido na página (a hibernação perderia o texto). */
async function hasEditedForm(contents) {
  try {
    return Boolean(
      await Promise.race([
        contents.executeJavaScriptInIsolatedWorld(FORM_WORLD_ID, [{ code: EDITED_FORM_SOURCE }]),
        new Promise((resolve) => setTimeout(() => resolve(true), 1500)),
      ]),
    );
  } catch {
    // Sem resposta da página: melhor não hibernar.
    return true;
  }
}

/**
 * Hiberna a guia: guarda o histórico de navegação e fecha o WebContentsView. `force` (menu
 * "Hibernar guia") pula as regras, menos a da guia visível.
 */
async function hibernateTab(ctx, id, { force = false } = {}) {
  const entry = ctx.views.get(id);
  if (!entry || paneIds(ctx).includes(id)) return false;
  const contents = entry.view.webContents;
  if (contents.isDestroyed()) return false;
  if (!force && (await hasEditedForm(contents))) return false;
  // A guia pode ter sido ativada, fechada ou movida enquanto a página respondia.
  if (ctx.views.get(id) !== entry || paneIds(ctx).includes(id) || contents.isDestroyed()) {
    return false;
  }
  let history = null;
  try {
    const navigation = contents.navigationHistory;
    history = restorableHistory(navigation.getAllEntries(), navigation.getActiveIndex());
  } catch {
    history = null;
  }
  dropView(ctx, id, entry);
  if (history) ctx.hibernated.set(id, history);
  send(ctx, "agzos:tab-event", { type: "hibernated", id });
  return true;
}

let hibernationRunning = false;

async function checkHibernation() {
  if (!hibernateConfig.enabled || hibernationRunning) return;
  hibernationRunning = true;
  try {
    const now = Date.now();
    for (const ctx of [...contexts.values()]) {
      for (const [id, entry] of [...ctx.views]) {
        const contents = entry.view.webContents;
        if (contents.isDestroyed()) continue;
        const candidate = {
          visible: paneIds(ctx).includes(id),
          hiddenSince: entry.hiddenSince,
          audible: contents.isCurrentlyAudible(),
          loading: contents.isLoading(),
          capturing:
            capturingContents.has(contents) ||
            (pipContents.has(contents) && (await pictureInPictureActive(contents))),
          pendingPermission: hasPendingPermission(contents),
          fullscreen: ctx.fullscreenActive && id === ctx.activeTabId,
          devtools: contents.isDevToolsOpened(),
        };
        if (canHibernate(candidate, { now, afterMs: hibernateConfig.afterMs })) {
          await hibernateTab(ctx, id);
        }
      }
    }
  } finally {
    hibernationRunning = false;
  }
}

// --- GX Control (3.0): uso por guia, limites de RAM/CPU/rede (ver gx-control.cjs). ---

/** Guias abertas de todas as janelas, com o que o GX Control precisa de cada uma. */
function gxTabs() {
  const now = Date.now();
  const list = [];
  for (const ctx of contexts.values()) {
    const panes = paneIds(ctx);
    for (const [id, entry] of ctx.views) {
      const contents = entry.view.webContents;
      if (contents.isDestroyed()) continue;
      const visible = panes.includes(id);
      const devtools = contents.isDevToolsOpened();
      const candidate = {
        visible,
        hiddenSince: entry.hiddenSince,
        audible: contents.isCurrentlyAudible(),
        loading: contents.isLoading(),
        capturing: capturingContents.has(contents) || pipContents.has(contents),
        pendingPermission: hasPendingPermission(contents),
        fullscreen: ctx.fullscreenActive && id === ctx.activeTabId,
        devtools,
      };
      list.push({
        key: contents.id,
        ctx,
        id,
        contents,
        visible,
        devtools,
        title: contents.getTitle(),
        eligible: canHibernate(candidate, { now, afterMs: 0 }),
      });
    }
  }
  return list;
}

// 4.5: painel de portas (o próprio app nunca aparece como "matável") e túneis HTTPS.
const portsService = createPortsService({
  execFile: require("node:child_process").execFile,
  fs,
  platform: process.platform,
  home: os.homedir(),
  protectedPids: () => [
    process.pid,
    process.ppid,
    ...app.getAppMetrics().map((metric) => metric.pid),
  ],
});

const tunnels = createTunnels({
  spawn: require("node:child_process").spawn,
  onEvent: ({ owner, port, state, url }) => {
    const ctx = [...contexts.values()].find((item) => item.key === owner);
    if (ctx) send(ctx, "agzos:tunnel", { port, state, url: url ?? null });
  },
});

// 4.5: requisições capturadas para o API Scratchpad, avisadas à janela da guia.
const netCapture = createNetCapture({
  emit: (owner, payload) => send(owner, "agzos:net-capture", payload),
});

// 4.5: extensões (criadas no ready, quando a sessão padrão existe).
let extensions = null;

function startExtensions() {
  try {
    extensions = createExtensions({
      ses: session.defaultSession,
      fs,
      store: {
        get: () => database?.getMeta("extensions") ?? [],
        set: (list) => database?.setMeta("extensions", list),
      },
      download: async (url) => {
        const response = await net.fetch(url, { redirect: "follow" });
        // 204/404: a loja não tem esse id (ou não serve para esta versão do Chromium).
        if (!response.ok || response.status === 204) {
          throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
        }
        return Buffer.from(await response.arrayBuffer());
      },
      fetchText: async (url) => {
        const response = await net.fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.text()).slice(0, 256 * 1024);
      },
      extensionsDir: path.join(app.getPath("userData"), "Extensions"),
      chromeVersion: process.versions.chrome,
    });
    void extensions
      .loadAll()
      .catch(() => {})
      .then(() => {
        // 4.6.1: procura versão nova depois da abertura e a cada 6 h; só avisa (badge).
        const check = () =>
          void extensions
            ?.checkUpdates()
            .then((count) => count && broadcast("agzos:extensions-changed", {}))
            .catch(() => {});
        setTimeout(check, 20_000).unref?.();
        setInterval(check, 6 * 60 * 60 * 1000).unref?.();
      });
  } catch (error) {
    extensions = null;
    console.error("Agzos: extensões indisponíveis.", error);
  }
}

// 4.5: Widevine. Só o Electron da castLabs (ECS, "+wvcus") tem `components`: ele baixa e
// registra o CDM oficial do Google. Só reprodução: o app nunca lê chave nem grava mídia.
const electronComponents = require("electron").components ?? null;
let widevineState = electronComponents
  ? { state: "loading", detail: "" }
  : { state: "unavailable", detail: "" };

function startWidevine() {
  if (!electronComponents) return;
  electronComponents.whenReady().then(
    () => {
      widevineState = { state: "ready", detail: "" };
    },
    (error) => {
      widevineState = { state: "error", detail: String(error?.message ?? error).slice(0, 200) };
    },
  );
}

function widevineStatus() {
  let version = null;
  try {
    const status = electronComponents?.status?.() ?? {};
    const cdm = Object.values(status).find((item) => /widevine/i.test(String(item?.title ?? "")));
    version = cdm?.version ?? null;
  } catch {
    version = null;
  }
  return { ...widevineState, version };
}

/** Toda janela atualiza a barra e o menu de extensões depois da mudança. */
async function extensionsChanged(pending) {
  const result = await pending;
  broadcast("agzos:extensions-changed", {});
  return result;
}

/** Área do ícone vinda da casca, ou o canto direito da barra se não vier. */
function validAnchor(anchor) {
  const ok = anchor && ["x", "y", "width", "height"].every((key) => Number.isFinite(anchor[key]));
  return ok
    ? {
        x: anchor.x,
        y: anchor.y,
        width: Math.max(1, anchor.width),
        height: Math.max(1, anchor.height),
      }
    : null;
}

// 4.6: pop-up de extensão. Uma janela sem moldura na sessão das guias (as APIs chrome.*
// da extensão funcionam), do tamanho que a página pede, alinhada à direita do ícone e
// abaixo dele; fecha ao perder o foco (menos com o DevTools aberto).
// 4.6.1: cada abertura é uma janela nova medida depois do load e remedida enquanto a
// página monta (pop-ups que buscam dados crescem depois); fechar destrói a janela.
let extensionPopup = null;
// Clique no ícone da extensão aberta: o blur fecha antes do clique chegar; não reabre.
let lastPopupClose = { dir: null, at: 0 };

function closeExtensionPopup() {
  const popup = extensionPopup;
  extensionPopup = null;
  if (popup && !popup.window.isDestroyed()) popup.window.destroy();
}

function openExtensionPopup(ctx, info, anchor, { inspect = false } = {}) {
  closeExtensionPopup();
  if (ctx.window.isDestroyed()) return;
  const content = ctx.window.getContentBounds();
  const area = anchor ?? { x: content.width - 48, y: 64, width: 32, height: 32 };
  const window = new BrowserWindow({
    parent: ctx.window,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // Tamanho de partida razoável (se a medida atrasar, nada de faixa de 64 px).
    width: 360,
    height: 240,
    backgroundColor: "#ffffff",
    webPreferences: {
      session: session.defaultSession,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const popup = { window, dir: info.dir };
  extensionPopup = popup;
  let size = { width: 360, height: 240 };
  const place = () => {
    if (window.isDestroyed() || ctx.window.isDestroyed()) return;
    const bounds = ctx.window.getContentBounds();
    const workArea = screen.getDisplayMatching(bounds).workArea;
    window.setBounds(popupPlacement({ anchor: area, content: bounds, workArea, ...size }));
  };
  place();
  const reveal = () => {
    if (!window.isDestroyed() && !window.isVisible()) window.show();
  };
  const measure = async () => {
    if (window.isDestroyed()) return;
    let result;
    try {
      result = await window.webContents.executeJavaScript(POPUP_MEASURE);
    } catch {
      return; // Página fechou ou navegou no meio.
    }
    if (window.isDestroyed() || !result || result.empty) return;
    const next = {
      width: Number(result.width) || size.width,
      height: Number(result.height) || size.height,
    };
    if (Math.abs(next.width - size.width) > 1 || Math.abs(next.height - size.height) > 1) {
      size = next;
      place();
    }
    reveal();
  };
  // Mede logo após o load e segue medindo: rápido nos primeiros segundos, depois devagar.
  let timer = null;
  const watch = (startedAt) => {
    clearTimeout(timer);
    if (window.isDestroyed()) return;
    void measure().then(() => {
      if (window.isDestroyed()) return;
      timer = setTimeout(() => watch(startedAt), Date.now() - startedAt < 2500 ? 120 : 600);
    });
  };
  window.webContents.on("did-finish-load", () => watch(Date.now()));
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) send(ctx, "agzos:open-request", { url });
    return { action: "deny" };
  });
  // Página que não termina o load: aparece no tamanho de partida.
  setTimeout(reveal, 1500);
  window.on("blur", () => {
    if (window.isDestroyed() || window.webContents.isDevToolsOpened()) return;
    lastPopupClose = { dir: info.dir, at: Date.now() };
    if (extensionPopup === popup) extensionPopup = null;
    window.destroy();
  });
  window.on("closed", () => {
    clearTimeout(timer);
    if (extensionPopup === popup) extensionPopup = null;
  });
  void window.loadURL(info.popup).catch(() => {});
  if (inspect) window.webContents.openDevTools({ mode: "detach" });
}

/** Origem da guia (para "acesso a este site"). */
function tabOrigin(ctx, tabId) {
  const contents = tabContents(ctx, tabId);
  try {
    const url = new URL(contents?.getURL() ?? "");
    return /^https?:$/.test(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
}

function isExecutableFile(file) {
  try {
    if (!fs.statSync(file).isFile()) return false;
    if (process.platform !== "win32") fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** cloudflared: o escolhido pelo usuário (meta cloudflaredPath), o PATH ou as pastas padrão. */
function cloudflaredBinary() {
  const configured = database?.getMeta("cloudflaredPath");
  return findCloudflared(
    {
      configured: typeof configured === "string" ? configured : null,
      env: process.env,
      platform: process.platform,
      home: os.homedir(),
    },
    isExecutableFile,
  );
}

const gxControl = createGxControl({
  cores: Math.max(1, os.cpus().length),
  metrics: () => app.getAppMetrics(),
  tabs: gxTabs,
  hibernate: (ctx, id) => hibernateTab(ctx, id),
  sessions: () => pageSessions(),
});

/** Cache de disco das sessões das páginas (bytes). */
async function gxCacheSize() {
  let total = 0;
  for (const ses of pageSessions()) {
    total += await ses.getCacheSize().catch(() => 0);
  }
  return total;
}

/**
 * Limpeza do GX Control: cache HTTP, código compilado, shaders e Cache Storage dos sites.
 * Cookies, logins e dados dos sites (localStorage, IndexedDB) ficam.
 */
async function gxClearCache() {
  const before = await gxCacheSize();
  for (const ses of pageSessions()) {
    await ses.clearCache().catch(() => {});
    await ses.clearCodeCaches({}).catch(() => {});
    await ses.clearHostResolverCache().catch(() => {});
    await ses.clearStorageData({ storages: ["shadercache", "cachestorage"] }).catch(() => {});
  }
  const after = await gxCacheSize();
  return { freedBytes: Math.max(0, before - after), cacheBytes: after };
}

/** Guia hibernada volta com o histórico (voltar/avançar e rolagem da página). */
function restoreHibernated(contents, history, url) {
  const current = history.entries[history.index];
  const { main, isolated } = adblock ? adblock.scriptletsFor(url) : { main: [], isolated: [] };
  // Site com scriptlets precisa da preparação com about:blank, que impede o restore:
  // volta só a página atual (mesmo caminho de uma guia nova).
  if (current?.url !== url || main.length || isolated.length) {
    void loadWithScriptlets(contents, url);
    return;
  }
  contents.navigationHistory.restore(history).catch(() => {
    if (!contents.isDestroyed()) void loadWithScriptlets(contents, url);
  });
}

// --- Picture-in-picture (qualquer player: YouTube, Vimeo, players embutidos em iframe). ---

// Vídeos do quadro, inclusive dentro de shadow DOM (players em web components).
const PIP_FIND_VIDEOS = `const agzosVideos = () => {
  const found = [];
  const visit = (root, depth) => {
    for (const video of root.querySelectorAll("video")) found.push(video);
    if (depth > 3) return;
    for (const element of root.querySelectorAll("*")) {
      if (element.shadowRoot) visit(element.shadowRoot, depth + 1);
    }
  };
  visit(document, 0);
  return found.filter((video) => video.readyState > 0 && video.videoWidth > 0);
};
const agzosScore = (video) => {
  const rect = video.getBoundingClientRect();
  const area = Math.max(0, rect.width) * Math.max(0, rect.height);
  return (video.paused ? 0 : 1e9) + area;
};`;

// Nota do melhor vídeo do quadro (-1 sem vídeo; 2e9 quando este quadro já está em PiP).
const PIP_SCAN_SOURCE = `(() => {
  ${PIP_FIND_VIDEOS}
  if (document.pictureInPictureElement) return 2e9;
  return agzosVideos().reduce((best, video) => Math.max(best, agzosScore(video)), -1);
})()`;

const PIP_TOGGLE_SOURCE = `(async () => {
  ${PIP_FIND_VIDEOS}
  if (document.pictureInPictureElement) {
    await document.exitPictureInPicture();
    return "off";
  }
  const video = agzosVideos().sort((a, b) => agzosScore(b) - agzosScore(a))[0];
  if (!video) return "none";
  // Alguns players desligam o PiP do navegador; o usuário pediu, então vale.
  video.disablePictureInPicture = false;
  video.removeAttribute("disablepictureinpicture");
  await video.requestPictureInPicture();
  return "on";
})()`;

// Guias com vídeo em PiP: não hibernam (a janela flutuante fecharia).
const pipContents = new WeakSet();

function liveFrames(contents) {
  try {
    return contents.mainFrame.framesInSubtree.filter((frame) => !frame.detached);
  } catch {
    return [];
  }
}

/**
 * Liga ou desliga o PiP da guia: escolhe o vídeo tocando (e maior) em todos os quadros. O
 * gesto do usuário (atalho, botão, menu) vai junto (`userGesture`), que o Chromium exige.
 */
async function togglePictureInPicture(contents) {
  if (!contents || contents.isDestroyed()) return { ok: false, active: false };
  let best = null;
  let bestScore = -1;
  for (const frame of liveFrames(contents)) {
    const score = await frame.executeJavaScript(PIP_SCAN_SOURCE).catch(() => -1);
    if (typeof score === "number" && score > bestScore) {
      best = frame;
      bestScore = score;
    }
  }
  if (!best) return { ok: false, active: false, reason: "sem-video" };
  try {
    const result = await best.executeJavaScript(PIP_TOGGLE_SOURCE, true);
    const active = result === "on";
    if (active) pipContents.add(contents);
    else pipContents.delete(contents);
    emitTab(contents, { type: "pip", active });
    return { ok: result !== "none", active };
  } catch (error) {
    console.error("Agzos: picture-in-picture falhou.", error);
    return { ok: false, active: false, reason: "erro" };
  }
}

/** O PiP ainda está aberto? (o usuário pode ter fechado a janela flutuante.) */
async function pictureInPictureActive(contents) {
  for (const frame of liveFrames(contents)) {
    const active = await frame
      .executeJavaScript("Boolean(document.pictureInPictureElement)")
      .catch(() => false);
    if (active) return true;
  }
  pipContents.delete(contents);
  return false;
}

// --- Prévia da guia (cartão ao pausar o mouse; ver hover-card.cjs). ---

function previewLayer(ctx) {
  if (ctx.preview && !ctx.preview.webContents.isDestroyed()) return ctx.preview;
  // Só a casca mexe no cartão: nada de navegar, abrir janelas ou receber foco de teclado.
  const view = createLayerView(WebContentsView);
  void view.webContents
    .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(HOVER_CARD_HTML)}`)
    .catch(() => {});
  ctx.preview = view;
  ctx.previewReady = new Promise((resolve) => {
    view.webContents.once("did-finish-load", resolve);
    view.webContents.once("destroyed", resolve);
  });
  return view;
}

/** Memória e CPU do processo da página (sites iguais podem dividir o mesmo processo). */
function tabMetrics(contents) {
  try {
    const pid = contents.getOSProcessId();
    const metric = app.getAppMetrics().find((item) => item.pid === pid);
    let shared = 0;
    for (const other of allTabContents()) {
      if (!other.isDestroyed() && other.getOSProcessId() === pid) shared += 1;
    }
    // No Windows os bytes privados são o número do Gerenciador de Tarefas.
    const memoryKB = metric?.memory?.privateBytes ?? metric?.memory?.workingSetSize ?? null;
    return {
      pid,
      memoryKB,
      cpu: metric?.cpu?.percentCPUUsage ?? null,
      shared: Math.max(1, shared),
    };
  } catch {
    return {};
  }
}

let previewSeq = 0;

async function showPreview(ctx, { id, rect, side, card }) {
  // Um overlay por vez: com painel aberto não há prévia.
  if (ctx.overlay?.model) return;
  const seq = ++previewSeq;
  ctx.previewSeq = seq;
  const view = previewLayer(ctx);
  await ctx.previewReady;
  const contents = tabContents(ctx, id);
  const model = { ...card };
  if (contents) {
    model.stats = [...metricRows(tabMetrics(contents)), ...(card.stats ?? [])];
    // Guia à vista: foto na hora (a miniatura guardada pode estar velha).
    if (id === ctx.activeTabId && isVisible(contents)) {
      try {
        const image = await contents.capturePage();
        if (!image.isEmpty()) {
          const small = image.resize({ width: 560, quality: "good" });
          model.image = `data:image/jpeg;base64,${small.toJPEG(78).toString("base64")}`;
        }
      } catch {
        // Fica a miniatura guardada.
      }
    }
  }
  if (ctx.previewSeq !== seq || view.webContents.isDestroyed() || ctx.window.isDestroyed()) return;
  let height = 0;
  try {
    height = Number(
      await view.webContents.executeJavaScript(`window.render(${JSON.stringify(model)})`),
    );
  } catch {
    return;
  }
  if (ctx.previewSeq !== seq || ctx.window.isDestroyed()) return;
  const [width, windowHeight] = ctx.window.getContentSize();
  // Por cima de tudo (guias abertas depois ficariam na frente).
  ctx.window.contentView.addChildView(view);
  view.setBounds(cardBounds(rect, { width, height: windowHeight }, height || 200, side));
}

// --- Seletor do Ctrl+Tab na camada acima da página (switcher-layer.cjs). ---

function switcherLayer(ctx) {
  if (ctx.switcherView && !ctx.switcherView.webContents.isDestroyed()) return ctx.switcherView;
  const view = createLayerView(WebContentsView);
  const contents = view.webContents;
  // Clique num cartão: agzos-switcher://N vira "confirmar a guia N".
  contents.on("will-navigate", (event, url) => {
    event.preventDefault();
    const index = switcherChoice(url);
    if (index !== null) send(ctx, "agzos:switcher-key", { key: "commit", index });
  });
  // Teclas com o foco na camada (depois de um clique) valem como na página.
  contents.on("before-input-event", (event, input) => {
    if (input.type === "keyUp" && (input.key === "Control" || input.key === "Meta")) {
      send(ctx, "agzos:modifier-up", { key: input.key });
    } else if (input.type === "keyDown" && SWITCHER_KEYS.has(input.key)) {
      event.preventDefault();
      send(ctx, "agzos:switcher-key", { key: input.key });
    } else if (input.type === "keyDown") {
      forwardAppShortcut(ctx, input, event, { page: true, contents });
    }
  });
  void contents
    .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SWITCHER_HTML)}`)
    .catch(() => {});
  ctx.switcherView = view;
  ctx.switcherReady = new Promise((resolve) => {
    contents.once("did-finish-load", resolve);
    contents.once("destroyed", resolve);
  });
  return view;
}

let switcherSeq = 0;

/** model: { cards, index, dark } desenha; { index } só muda a seleção; null esconde. */
async function renderSwitcher(ctx, model) {
  const seq = ++switcherSeq;
  ctx.switcherSeq = seq;
  if (!model) {
    const view = ctx.switcherView;
    if (!view || view.webContents.isDestroyed()) return;
    const hadFocus = view.webContents.isFocused();
    view.setBounds(HIDDEN_RECT);
    // Clicou num cartão: o foco volta para a página ativa.
    if (hadFocus) activeViewEntry(ctx)?.view.webContents.focus();
    return;
  }
  const view = switcherLayer(ctx);
  await ctx.switcherReady;
  if (ctx.switcherSeq !== seq || view.webContents.isDestroyed() || ctx.window.isDestroyed()) {
    return;
  }
  const [width, height] = ctx.window.getContentSize();
  if (!Array.isArray(model.cards)) {
    void view.webContents
      .executeJavaScript(`window.select(${Number(model.index) || 0})`)
      .catch(() => {});
    return;
  }
  let size = null;
  try {
    // Desenha com a largura da janela (com 0 px os cartões ficariam empilhados) e depois
    // encolhe para o tamanho do painel. A camada é transparente: a página segue à vista.
    view.setBounds({ x: 0, y: 0, width, height });
    const layout = { ...model, maxWidth: Math.max(240, Math.min(1040, width - 96)) };
    size = await view.webContents.executeJavaScript(`window.render(${JSON.stringify(layout)})`);
  } catch {
    return;
  }
  if (ctx.switcherSeq !== seq || ctx.window.isDestroyed() || !size) return;
  ctx.window.contentView.addChildView(view);
  view.setBounds(switcherBounds(size, { width, height }));
}

function hidePreview(ctx) {
  ctx.previewSeq = ++previewSeq;
  const view = ctx.preview;
  if (!view || view.webContents.isDestroyed()) return;
  view.setBounds(HIDDEN_RECT);
  void view.webContents.executeJavaScript("window.hide && window.hide()").catch(() => {});
}

// --- Painéis da toolbar na camada acima da página (chrome-overlay.cjs). ---

const logOverlay = overlayDebugger();
const OVERLAY_PAGE = path.join(__dirname, "..", "dist", "overlay.html");
const PAGE_PRELOAD = path.join(__dirname, "page-preload.cjs");
const OVERLAY_LOAD_TIMEOUT_MS = 10_000;
const pendingOverlayCalls = new Map();
let overlayCallSeq = 0;

/** A camada dos painéis da janela: criada na primeira abertura e reusada depois. */
function panelLayer(ctx) {
  if (ctx.overlay && !ctx.overlay.view.webContents.isDestroyed()) return ctx.overlay;
  if (!fs.existsSync(OVERLAY_PAGE)) return null;
  const view = createLayerView(WebContentsView, {
    preload: path.join(__dirname, "overlay-preload.cjs"),
    menuShortcuts: true,
  });
  view.setVisible(false);
  const contents = view.webContents;
  const layer = { view, ready: false, model: null, returnFocus: null, position: null };
  layer.loaded = new Promise((resolve) => {
    layer.markReady = resolve;
    contents.once("destroyed", () => resolve(false));
    contents.once("did-fail-load", () => resolve(false));
  });
  // Atalhos do app com o foco no painel: o painel fecha e o atalho segue para a casca
  // (Ctrl+T abre a guia, Ctrl+Tab abre o seletor). Mesmo caminho das teclas da página,
  // inclusive o Ctrl sintético que tira a supressão de teclas do Chromium.
  contents.on("before-input-event", (event, input) => {
    if (input.type === "keyUp" && (input.key === "Control" || input.key === "Meta")) {
      send(ctx, "agzos:modifier-up", { key: input.key });
      return;
    }
    if (input.type !== "keyDown" || !FORWARDED_SHORTCUTS.has(shortcutCombo(input))) return;
    closePanelLayer(ctx, { notify: true, refocus: false });
    forwardAppShortcut(ctx, input, event, { contents });
  });
  // A camada caiu: fecha o painel e descarta a camada (a próxima abertura cria outra).
  contents.on("render-process-gone", () => {
    closePanelLayer(ctx, { notify: true });
    if (ctx.overlay === layer) ctx.overlay = null;
    if (!ctx.window.isDestroyed()) ctx.window.contentView.removeChildView(view);
    if (!contents.isDestroyed()) contents.close();
  });
  void contents.loadFile(OVERLAY_PAGE).catch(() => layer.markReady(false));
  ctx.overlay = layer;
  return layer;
}

function overlayOfEvent(event) {
  for (const ctx of contexts.values()) {
    if (ctx.overlay?.view.webContents === event.sender) return ctx;
  }
  return null;
}

function renderPanelLayer(ctx) {
  const layer = ctx.overlay;
  if (!layer?.ready || layer.view.webContents.isDestroyed()) return;
  layer.view.webContents.send("agzos:overlay-render", layer.model);
}

/** Cobre a área de conteúdo da janela: o painel fica onde a casca o desenharia. */
function placePanelLayer(ctx) {
  const layer = ctx.overlay;
  if (!layer?.model || ctx.window.isDestroyed()) return;
  // Por cima de tudo (guias abertas depois ficariam na frente).
  ctx.window.contentView.addChildView(layer.view);
  layer.view.setBounds(fullRect(ctx));
  layer.view.setVisible(true);
}

/** Abre (ou troca) o painel. false: a camada não existe; a casca usa a foto (plano B). */
async function openPanelLayer(ctx, model) {
  const layer = panelLayer(ctx);
  if (!layer) {
    logOverlay("snapshot-fallback", `kind=${model.kind} reason=no-overlay-page`);
    return { ok: false };
  }
  const opening = !layer.model;
  layer.model = model;
  ctx.tooltip?.hide();
  // O popup de autofill aparece sozinho ao abrir a página de login: não tira o foco dela
  // (o usuário pode estar digitando no site).
  const passive = model.kind === "autofill";
  if (opening) {
    // Um overlay por vez: o painel ganha da prévia.
    hidePreview(ctx);
    const focused = webContents.getFocusedWebContents();
    layer.returnFocus = focused && focused !== layer.view.webContents ? focused : null;
    layer.position = ctx.window.getPosition();
  }
  // Primeira abertura carrega a camada (o bundle da casca); com o main ocupado (listas do
  // adblock montando na partida) pode levar alguns segundos. Passou disso: plano B.
  const ready = await Promise.race([
    layer.loaded,
    new Promise((resolve) => setTimeout(() => resolve(false), OVERLAY_LOAD_TIMEOUT_MS)),
  ]);
  if (layer.model !== model) return { ok: true };
  if (!ready || layer.view.webContents.isDestroyed() || ctx.window.isDestroyed()) {
    layer.model = null;
    logOverlay("snapshot-fallback", `kind=${model.kind} reason=overlay-not-ready`);
    return { ok: false };
  }
  renderPanelLayer(ctx);
  placePanelLayer(ctx);
  followFolderPointer(ctx);
  // Foco na camada ao abrir, ou quando o autofill (sem foco) vira um painel de verdade.
  if (!passive && (opening || layer.passive)) layer.view.webContents.focus();
  layer.passive = passive;
  if (opening) {
    logOverlay("live-overlay", `kind=${model.kind} window=${ctx.key}`);
  }
  return { ok: true };
}

const FOLDER_POINTER_MS = 50;

/**
 * Menu de pasta dos favoritos aberto: o main acompanha o cursor e avisa a camada, que
 * troca de pasta quando ele passa por cima de outra. Sem depender do hover da própria
 * camada: em alguns sistemas o WebContentsView transparente recém-mostrado não recebe o
 * movimento do mouse até um clique, e a troca pelo hover não acontecia.
 */
function followFolderPointer(ctx) {
  const layer = ctx.overlay;
  if (!layer || layer.model?.kind !== "folder" || layer.pointerTimer) return;
  let last = "";
  layer.pointerTimer = setInterval(() => {
    if (layer.model?.kind !== "folder" || ctx.window.isDestroyed()) {
      stopFolderPointer(layer);
      return;
    }
    const contents = layer.view.webContents;
    if (contents.isDestroyed()) return;
    const cursor = screen.getCursorScreenPoint();
    const bounds = ctx.window.getContentBounds();
    const x = Math.round(cursor.x - bounds.x);
    const y = Math.round(cursor.y - bounds.y);
    const key = `${x},${y}`;
    if (key === last) return;
    last = key;
    if (x < 0 || y < 0 || x >= bounds.width || y >= bounds.height) return;
    contents.send("agzos:overlay-pointer", { x, y });
  }, FOLDER_POINTER_MS);
}

function stopFolderPointer(layer) {
  if (!layer?.pointerTimer) return;
  clearInterval(layer.pointerTimer);
  layer.pointerTimer = null;
}

/**
 * Esconde a camada. `notify`: quem fechou foi o main/camada (a casca limpa o painel);
 * `click`: fechou por um clique fora, que segue para o que está embaixo.
 */
function closePanelLayer(ctx, { notify = false, refocus = true, click = false } = {}) {
  const layer = ctx.overlay;
  if (!layer?.model) return;
  const { kind } = layer.model;
  layer.model = null;
  layer.passive = false;
  stopFolderPointer(layer);
  const contents = layer.view.webContents;
  const hadFocus = !contents.isDestroyed() && contents.isFocused();
  layer.view.setVisible(false);
  layer.view.setBounds(HIDDEN_RECT);
  if (!contents.isDestroyed()) contents.send("agzos:overlay-render", null);
  if (notify) send(ctx, "agzos:overlay-dismissed", { kind, click });
  // Camada escondida não fica com o foco: volta para onde estava (a casca, em geral).
  if (refocus && hadFocus && !ctx.window.isDestroyed()) {
    const back = layer.returnFocus;
    if (back && !back.isDestroyed()) back.focus();
    else ctx.window.webContents.focus();
  }
  layer.returnFocus = null;
}

/**
 * O clique fora do painel vale para o que está embaixo: a página (em coordenadas dela) ou
 * a casca (guias, barra de endereço, botões). O alvo recebe o foco, como num clique real.
 */
function clickTarget(ctx, payload) {
  if (ctx.window.isDestroyed()) return null;
  const x = Number(payload?.x);
  const y = Number(payload?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const pane = paneAt(ctx, { x, y });
  const target = pane ? pane.contents : ctx.window.webContents;
  const point = pane?.point ?? { x: Math.round(x), y: Math.round(y) };
  return { target, point, where: pane ? "page" : "shell" };
}

function clickThrough({ target, point }, button) {
  if (target.isDestroyed()) return;
  target.focus();
  for (const input of clickEvents(point, button)) target.sendInputEvent(input);
}

// --- Painéis laterais (2.0): WhatsApp, Telegram… cada um no seu WebContentsView. ---

// webContents do painel → janela dona (links abrem guias nela, permissões perguntam nela).
const sidePanelOwner = new Map();

// Saída anterior (gravada ao sair): explica no log por que um app pediu login de novo.
let previousPanelExit;
let panelLog = null;
// webContents liberados para descarregar mesmo com beforeunload pedindo para ficar.
const unloadingPanels = new WeakSet();

function logPanel(message) {
  panelLog ??= createPanelLog(path.join(app.getPath("userData"), "logs"));
  panelLog(message);
}

function panelZooms() {
  return parsePanelZooms(database?.getMeta("sidePanelZoom"));
}

/** Zoom do painel (3.1.1): só nele, gravado por app, e a casca mostra o valor. */
function setPanelZoom(ctx, app, direction) {
  const entry = ctx?.sidePanels.get(app);
  if (!entry || entry.view.webContents.isDestroyed()) return;
  const contents = entry.view.webContents;
  const factor = panelZoomStep(contents.getZoomFactor(), direction);
  contents.setZoomFactor(factor);
  const zooms = panelZooms();
  if (factor === 1) delete zooms[app];
  else zooms[app] = factor;
  database?.setMeta("sidePanelZoom", zooms);
  // O mesmo app aberto em outras janelas acompanha.
  for (const other of contexts.values()) {
    const twin = other.sidePanels.get(app);
    if (other !== ctx && twin && !twin.view.webContents.isDestroyed()) {
      twin.view.webContents.setZoomFactor(factor);
    }
    send(other, "agzos:side-panel-zoom", { app, factor });
  }
}

function sidePanelView(ctx, app, url) {
  const known = ctx.sidePanels.get(app);
  if (known && !known.view.webContents.isDestroyed()) return known;
  // Mesma sessão das guias (login compartilhado), isolado. Zoom "isolated":
  // o do painel não muda o de uma guia do mesmo site, nem o de outro painel.
  // O preload das páginas entra só pelos gestos (4.0): com --agzos-surface=panel ele não
  // observa login.
  const view = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      zoomMode: "isolated",
      preload: PAGE_PRELOAD,
      additionalArguments: ["--agzos-surface=panel"],
    },
  });
  view.setBackgroundColor("#FFFFFF");
  view.setBounds(HIDDEN_RECT);
  const contents = view.webContents;
  const id = contents.id;
  contents.setZoomMode("isolated");
  const zoom = panelZooms()[app] ?? 1;
  if (zoom !== 1) contents.setZoomFactor(zoom);
  sidePanelOwner.set(id, ctx);
  contents.once("destroyed", () => sidePanelOwner.delete(id));
  // Links e janelas novas viram guias da janela (popups de login seguem como popup).
  wirePopups(contents);
  wireShortcuts(contents, {
    zoom: (direction) => setPanelZoom(ownerCtx(contents), app, direction),
  });
  // Ctrl+roda do mouse no painel.
  contents.on("zoom-changed", (_event, direction) =>
    setPanelZoom(ownerCtx(contents), app, direction === "in" ? 1 : -1),
  );
  contents.on("render-process-gone", (_event, details) => {
    if (details.reason !== "clean-exit" && !contents.isDestroyed()) contents.reload();
  });
  // Ao sair do app a página precisa descarregar (o Discord grava o token aí).
  contents.on("will-prevent-unload", (event) => {
    if (unloadingPanels.has(contents)) event.preventDefault();
  });
  const entry = { view, url, loginLogged: false };
  const checkLogin = (_event, pageUrl) => {
    if (entry.loginLogged || !isPanelLoginPage(app, pageUrl)) return;
    entry.loginLogged = true;
    logPanel(loginReason(app, previousPanelExit, contents.getUserAgent()));
  };
  contents.on("did-navigate", checkLogin);
  // O zoom posto antes da primeira carga não sobrevive a ela: confere a cada navegação.
  contents.on("did-navigate", () => {
    const factor = panelZooms()[app] ?? 1;
    if (Math.abs(contents.getZoomFactor() - factor) > 0.001) contents.setZoomFactor(factor);
  });
  contents.on("did-navigate-in-page", checkLogin);
  ctx.window.contentView.addChildView(view);
  raisePanelLayer(ctx);
  void contents.loadURL(url).catch(() => {});
  ctx.sidePanels.set(app, entry);
  send(ctx, "agzos:side-panel-zoom", { app, factor: zoom });
  return entry;
}

/**
 * Antes de fechar janela(s): descarrega as páginas dos painéis e grava cookies e storage.
 * O que já foi feito (ctx.panelsReleased) não repete.
 */
async function releaseSidePanels(ctxs) {
  const pending = ctxs.filter((ctx) => !ctx.panelsReleased);
  const entries = pending.flatMap((ctx) => [...ctx.sidePanels.entries()]);
  for (const ctx of pending) ctx.panelsReleased = true;
  if (!entries.length) return;
  await unloadPanelPages(
    entries.map(([, entry]) => entry.view.webContents),
    { allowUnload: (contents) => unloadingPanels.add(contents) },
  );
  const apps = [...new Set(entries.map(([app]) => app))];
  try {
    session.defaultSession.flushStorageData();
    await session.defaultSession.cookies.flushStore();
  } catch (error) {
    logPanel(`não foi possível gravar o storage dos painéis (${error?.message ?? error}).`);
  }
  database?.setMeta("sidePanelExit", { clean: true, at: Date.now(), apps });
}

function anyUnreleasedPanels() {
  return [...contexts.values()].some((ctx) => !ctx.panelsReleased && ctx.sidePanels.size > 0);
}

// --- Arrastar a largura do painel (3.1.1) ---
// A alça fica na casca, mas o cursor passa por cima das páginas (WebContentsView), que
// ficam com os eventos do mouse. O main acompanha o cursor e avisa a casca até soltar.

function stopPanelDrag(ctx) {
  const drag = ctx?.panelDrag;
  if (!drag) return;
  ctx.panelDrag = null;
  clearInterval(drag.timer);
  clearTimeout(drag.limit);
  for (const [contents, listener] of drag.listeners) {
    if (!contents.isDestroyed()) contents.off("before-mouse-event", listener);
  }
  send(ctx, "agzos:side-panel-drag", { done: true });
}

function startPanelDrag(ctx) {
  stopPanelDrag(ctx);
  if (ctx.window.isDestroyed()) return;
  const drag = { timer: null, limit: null, lastX: null, lastY: null, listeners: new Map() };
  ctx.panelDrag = drag;
  const tick = () => {
    if (ctx.window.isDestroyed()) return stopPanelDrag(ctx);
    const point = screen.getCursorScreenPoint();
    const content = ctx.window.getContentBounds();
    const x = Math.round(point.x - content.x);
    // y: alça do terminal (4.0), que arrasta na vertical.
    const y = Math.round(point.y - content.y);
    if (x === drag.lastX && y === drag.lastY) return;
    drag.lastX = x;
    drag.lastY = y;
    send(ctx, "agzos:side-panel-drag", { x, y });
  };
  drag.timer = setInterval(tick, 16);
  // Soltou o botão em cima de uma página (ou ela recebeu movimento sem o botão).
  const views = [
    ...[...ctx.views.values()].map((entry) => entry.view?.webContents),
    ...[...ctx.sidePanels.values()].map((entry) => entry.view.webContents),
  ].filter((contents) => contents && !contents.isDestroyed());
  for (const contents of views) {
    const listener = (event, mouse) => {
      const held = mouse.modifiers?.includes("leftbuttondown");
      if (mouse.type === "mouseUp" || (mouse.type === "mouseMove" && !held)) {
        stopPanelDrag(ctx);
        return;
      }
      if (mouse.type === "mouseMove" || mouse.type === "mouseDown") event.preventDefault();
    };
    contents.on("before-mouse-event", listener);
    drag.listeners.set(contents, listener);
  }
  drag.limit = setTimeout(() => stopPanelDrag(ctx), 60_000);
  tick();
}

function layoutSidePanels(ctx) {
  if (ctx.window.isDestroyed()) return;
  for (const [app, entry] of ctx.sidePanels) {
    const shown =
      ctx.sidePanel === app && ctx.sidePanelRect && !ctx.panelOpen && !ctx.fullscreenActive;
    entry.view.setBounds(shown ? ctx.sidePanelRect : HIDDEN_RECT);
  }
}

function unloadSidePanel(ctx, app) {
  const entry = ctx.sidePanels.get(app);
  if (!entry) return;
  ctx.sidePanels.delete(app);
  if (!ctx.window.isDestroyed()) ctx.window.contentView.removeChildView(entry.view);
  if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close();
}

/** Guia nova por cima da camada: a camada volta ao topo. */
function raisePanelLayer(ctx) {
  if (ctx.overlay?.model) ctx.window.contentView.addChildView(ctx.overlay.view);
}

function tabSession(tab) {
  return { tabs: [{ ...tab, id: 1 }], activeId: 1 };
}

// Certificados inválidos aceitos pelo usuário ("Continuar mesmo assim"): só nesta
// execução, por host e impressão digital (como no Chrome).
const allowedCertificates = new Set();
const lastCertificateError = new Map();

function certificateKey(url, fingerprint) {
  try {
    return `${new URL(url).host}|${fingerprint}`;
  } catch {
    return null;
  }
}

const MAX_SESSION_BYTES = 2 * 1024 * 1024;

// --- Agzos Key: scripts injetados na página para preencher e ler o login ----------------
// Rodam no mundo da página (executeJavaScript). Ficam como funções de verdade (lint e
// testes) e vão para a página por toString().

function fillLoginScript(data) {
  const visible = (el) =>
    el && !el.disabled && !el.readOnly && (el.offsetWidth > 0 || el.offsetHeight > 0);
  const set = (el, value) => {
    if (!el) return false;
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
    if (setter && setter.set) setter.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  };
  // Campos dentro de web components (shadow DOM aberto) também contam.
  const allInputs = () => {
    const out = [];
    const walk = (root) => {
      out.push(...root.querySelectorAll("input"));
      for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot);
    };
    walk(document);
    return out;
  };
  const inputs = allInputs().filter(visible);
  let active = document.activeElement;
  while (active && active.shadowRoot && active.shadowRoot.activeElement)
    active = active.shadowRoot.activeElement;
  // O campo de senha do formulário em foco ganha; senão o primeiro visível.
  const passwords = inputs.filter((i) => i.type === "password");
  const pass =
    (active && active.type === "password" && visible(active) ? active : null) ||
    passwords.find((i) => active && active.form && i.form === active.form) ||
    passwords.find((i) => !/new|confirm/i.test(i.autocomplete || "")) ||
    passwords[0] ||
    null;
  const scope = (pass && pass.form) || (active && active.form) || document;
  const candidates = inputs.filter(
    (i) =>
      (scope === document || i.form === scope) &&
      ["text", "email", "tel", ""].includes(i.type) &&
      !/one-time-code/i.test(i.autocomplete || ""),
  );
  const hint = (i) => `${i.name} ${i.id} ${i.autocomplete} ${i.placeholder} ${i.ariaLabel || ""}`;
  const before = pass
    ? candidates.filter((i) => i.compareDocumentPosition(pass) & Node.DOCUMENT_POSITION_FOLLOWING)
    : candidates;
  const user =
    candidates.find((i) => /username/i.test(i.autocomplete || "")) ||
    candidates.find((i) => i.type === "email") ||
    before.reverse().find((i) => /e-?mail|user|login|usu|conta|account|ident|cpf/i.test(hint(i))) ||
    before[0] ||
    (active && candidates.includes(active) ? active : null);
  let filled = false;
  if (data.username && user) filled = set(user, data.username) || filled;
  if (data.password && pass) filled = set(pass, data.password) || filled;
  // Deixa o foco na senha (Enter já entra), ou no usuário no login em etapas.
  if (pass && data.password) pass.focus();
  return { filled, password: Boolean(pass), username: Boolean(user) };
}

function fillOtpScript(code) {
  const visible = (el) => el && !el.disabled && (el.offsetWidth > 0 || el.offsetHeight > 0);
  const set = (el, value) => {
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
    if (setter && setter.set) setter.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  // Campos dentro de web components (shadow DOM aberto) também contam.
  const allInputs = () => {
    const out = [];
    const walk = (root) => {
      out.push(...root.querySelectorAll("input"));
      for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot);
    };
    walk(document);
    return out;
  };
  const inputs = allInputs().filter(
    (i) => visible(i) && ["text", "tel", "number", "password", ""].includes(i.type),
  );
  const boxes = inputs.filter((i) => i.maxLength === 1);
  if (boxes.length >= code.length) {
    boxes.slice(0, code.length).forEach((box, index) => set(box, code[index]));
    return { filled: true };
  }
  const hint = (i) => `${i.name} ${i.id} ${i.autocomplete} ${i.placeholder} ${i.ariaLabel || ""}`;
  const field =
    inputs.find((i) => /one-time-code/i.test(i.autocomplete || "")) ||
    inputs.find(
      (i) =>
        i.type !== "password" &&
        /otp|totp|2fa|mfa|token|c[oó]digo|code|verifica|authenticator/i.test(hint(i)),
    ) ||
    (document.activeElement && inputs.includes(document.activeElement)
      ? document.activeElement
      : null);
  if (!field) return { filled: false };
  set(field, code);
  return { filled: true };
}

function readLoginScript() {
  const visible = (el) => el && (el.offsetWidth > 0 || el.offsetHeight > 0);
  // Campos dentro de web components (shadow DOM aberto) também contam.
  const allInputs = () => {
    const out = [];
    const walk = (root) => {
      out.push(...root.querySelectorAll("input"));
      for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot);
    };
    walk(document);
    return out;
  };
  const inputs = allInputs().filter(visible);
  const pass = inputs.find((i) => i.type === "password" && i.value);
  const scope = (pass && pass.form) || document;
  const texts = inputs.filter(
    (i) =>
      (scope === document || i.form === scope) && ["text", "email", "tel", ""].includes(i.type),
  );
  const user =
    texts.find((i) => i.value && /username/i.test(i.autocomplete || "")) ||
    texts.find((i) => i.value && i.type === "email") ||
    texts.find(
      (i) => i.value && /e-?mail|user|login|usu|conta|account|ident|cpf/i.test(`${i.name} ${i.id}`),
    ) ||
    texts.find((i) => i.value);
  return { username: user ? user.value : "", password: pass ? pass.value : "" };
}

/** Host "do site" para comparar frames: sem www., em minúsculas. */
function frameHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/** Mesmo site (igual ou subdomínio um do outro): pode receber a credencial da guia. */
function sameSite(a, b) {
  if (!a || !b) return false;
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

/**
 * Roda o script na página e nos iframes do mesmo site; vale o primeiro que preencheu.
 * Frames de outro site (anúncio, widget) nunca recebem a credencial.
 */
async function runInLoginFrames(contents, script) {
  const top = contents.mainFrame;
  const topHost = frameHost(contents.getURL());
  const frames = [
    top,
    ...top.framesInSubtree.filter((frame) => frame !== top && !frame.detached),
  ].filter((frame) => frame === top || sameSite(frameHost(frame.url), topHost));
  for (const frame of frames) {
    try {
      const result = await frame.executeJavaScript(script, true);
      if (result && result.filled) return { ok: true, filled: true };
    } catch {
      /* frame navegando ou destruído: tenta o próximo */
    }
  }
  return { ok: true, filled: false };
}

function registerIpc() {
  // Login enviado numa página (detectado pelo page-preload.cjs): acha a janela/guia dona
  // pela webContents que mandou e repassa para a casca oferecer salvar no Agzos Key.
  ipcMain.on("agzos:page-login", (event, payload) => {
    const where = tabOfContents.get(event.sender.id);
    if (!where || !payload || typeof payload.password !== "string" || !payload.password) return;
    const { ctx, id } = where;
    send(ctx, "agzos:tab-event", {
      type: "login-detected",
      id,
      url: typeof payload.url === "string" ? payload.url : "",
      username: typeof payload.username === "string" ? payload.username : "",
      password: payload.password,
    });
  });

  // Formulário de login na página (page-preload.cjs): à vista (`focused` false) ou com o
  // usuário clicando num campo de usuário/senha/código MFA. A casca busca no cofre.
  ipcMain.on("agzos:login-form", (event, payload) => {
    const where = tabOfContents.get(event.sender.id);
    if (!where || !payload) return;
    const field = ["password", "username", "otp"].includes(payload.field) ? payload.field : null;
    if (!field) return;
    send(where.ctx, "agzos:tab-event", {
      type: "login-form",
      id: where.id,
      url: typeof payload.url === "string" ? payload.url : "",
      focused: payload.focused === true,
      field,
    });
  });

  // Autofill: a casca pede para preencher usuário/senha na guia; o main injeta nos campos
  // da página e dos iframes do mesmo site (logins embutidos), nunca em frames de terceiros.
  ipcMain.handle("tab:autofill", (event, { id, username, password } = {}) => {
    const contents = tabContents(ctxOfEvent(event), id);
    if (!contents || contents.isDestroyed()) return { ok: false };
    const data = { username: username ?? "", password: password ?? "" };
    const ctx = ctxOfEvent(event);
    return runInLoginFrames(
      contents,
      `(${fillLoginScript.toString()})(${JSON.stringify(data)})`,
    ).then((result) => {
      // Preenchido: o foco vai para a página (Enter já entra), também quando o pedido veio
      // do popup da chave, que ao fechar devolveria o foco para a casca.
      if (result.filled && !contents.isDestroyed()) {
        if (ctx?.overlay?.model) ctx.overlay.returnFocus = contents;
        else contents.focus();
      }
      return result;
    });
  });

  // Código MFA (TOTP) no campo de código da página (ou nas caixinhas de 1 dígito).
  ipcMain.handle("tab:autofill-otp", (event, { id, code } = {}) => {
    const contents = tabContents(ctxOfEvent(event), id);
    if (!contents || contents.isDestroyed() || !/^\d{4,10}$/.test(String(code ?? "")))
      return { ok: false };
    return runInLoginFrames(contents, `(${fillOtpScript.toString()})(${JSON.stringify(code)})`);
  });

  // "Salvar login" pela chave da barra de endereço: o que o usuário já digitou na página.
  ipcMain.handle("tab:login-fields", (event, { id } = {}) => {
    const contents = tabContents(ctxOfEvent(event), id);
    if (!contents || contents.isDestroyed()) return { username: "", password: "" };
    return contents
      .executeJavaScript(`(${readLoginScript.toString()})()`, true)
      .then((result) => ({
        username: typeof result?.username === "string" ? result.username : "",
        password: typeof result?.password === "string" ? result.password : "",
      }))
      .catch(() => ({ username: "", password: "" }));
  });

  ipcMain.handle("tab:attach", (event, { id, url, options }) => {
    const ctx = ctxOfEvent(event);
    if (!ctx || ctx.views.has(id)) return;
    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        preload: PAGE_PRELOAD,
        partition: tabPartition(options),
      },
    });
    if (typeof options?.session === "string" && !options?.private) {
      sessionTabSessions.add(view.webContents.session);
    }
    // Fundo base da página branco, como no Chrome: com o tema escuro (padrão desde a 4.5) um
    // fundo escuro aqui deixava sites sem cor de fundo pretos, com texto preto.
    view.setBackgroundColor("#FFFFFF");
    view.setBounds(HIDDEN_RECT);
    ctx.views.set(id, { view, hiddenSince: null });
    tabOfContents.set(view.webContents.id, { ctx, id });
    ctx.window.contentView.addChildView(view);
    raisePanelLayer(ctx);
    // Guia nova já na posição dela (na tela dividida o outro pane não passa por activate).
    applyLayout(ctx);
    wirePermissions(view.webContents.session);
    ensureFileProtocol(view.webContents.session);
    wireView(view);
    const history = ctx.hibernated.get(id);
    ctx.hibernated.delete(id);
    if (!isWebUrl(url)) return;
    if (history) {
      restoreHibernated(view.webContents, history, url);
      return;
    }
    // O comando CDP sai antes do loadURL (sem esperar: numa aba nova ele só responde
    // depois da primeira navegação, e já vale para ela).
    void loadWithScriptlets(view.webContents, url);
  });

  ipcMain.handle("tab:activate", (event, { id }) => {
    const ctx = ctxOfEvent(event);
    if (!ctx) return;
    // Foto da aba que sai, ainda visível (o seletor do Ctrl+Tab mostra o estado mais recente).
    if (ctx.activeTabId !== id && ctx.activeTabId !== null) {
      const leaving = tabContents(ctx, ctx.activeTabId);
      if (leaving) void captureThumbnail(leaving, { leaving: true });
    }
    ctx.activeTabId = id;
    applyLayout(ctx);
    const contents = tabContents(ctx, id);
    if (contents) scheduleThumbnail(contents, 800);
  });

  ipcMain.handle("tab:capture", (event, { id }) => {
    const contents = tabContents(ctxOfEvent(event), id);
    return contents ? captureThumbnail(contents) : undefined;
  });

  // Foto da página visível, em tamanho real: a casca mostra no lugar dela enquanto um
  // painel está aberto (o WebContentsView precisa sair da frente do painel).
  ipcMain.handle("tab:snapshot", async (event, { id }) => {
    const contents = tabContents(ctxOfEvent(event), id);
    if (!contents || !isVisible(contents)) return null;
    logOverlay("snapshot-fallback", "capturePage");
    try {
      const image = await contents.capturePage();
      if (image.isEmpty()) return null;
      return `data:image/jpeg;base64,${image.toJPEG(88).toString("base64")}`;
    } catch {
      return null;
    }
  });

  // Área da página na janela. Com `id` (2.0), a do pane daquela guia na tela dividida.
  ipcMain.handle("tab:bounds", (event, rect, id) => {
    const ctx = ctxOfEvent(event);
    if (!ctx || ctx.fullscreenActive) return;
    if (rect && rect.width > 0 && rect.height > 0) {
      if (Number.isSafeInteger(id)) ctx.paneRects.set(id, rect);
      // Fora da tela dividida vale a área de sempre (a guia pode estar virando a ativa).
      if (!Number.isSafeInteger(id) || !ctx.split || id === ctx.activeTabId) ctx.lastRect = rect;
    }
    applyLayout(ctx);
  });

  // Painéis laterais (2.0).
  ipcMain.handle("sidepanel:show", (event, { app, url } = {}) => {
    const ctx = ctxOfEvent(event);
    if (!ctx || typeof app !== "string" || !/^[a-z0-9-]{1,30}$/.test(app)) return;
    // 4.6.1: o side_panel de uma extensão carregada também abre aqui (id "ext-…").
    const extensionPage = /^ext-[a-p]{26}$/.test(app) && extensions?.isExtensionUrl(url);
    if (typeof url !== "string" || (!/^https:\/\//.test(url) && !extensionPage)) return;
    // Testes: uma página local no lugar do app (sem depender da internet).
    sidePanelView(ctx, app, extensionPage ? url : process.env.AGZOS_SIDE_PANEL_URL || url);
    ctx.sidePanel = app;
    layoutSidePanels(ctx);
  });

  ipcMain.handle("sidepanel:hide", (event) => {
    const ctx = ctxOfEvent(event);
    if (!ctx) return;
    // O painel sai de cena mas continua carregado (as mensagens seguem chegando).
    const entry = ctx.sidePanels.get(ctx.sidePanel);
    const hadFocus =
      entry && !entry.view.webContents.isDestroyed() && entry.view.webContents.isFocused();
    ctx.sidePanel = null;
    ctx.sidePanelExpanded = false;
    applyLayout(ctx);
    if (hadFocus && !ctx.window.isDestroyed()) ctx.window.webContents.focus();
  });

  // 4.5: painel de portas. Matar só vale para um PID da última leitura (e nunca o app).
  ipcMain.handle("ports:list", async () => {
    try {
      return { ok: true, ports: await portsService.scan() };
    } catch {
      return { ok: false, ports: [] };
    }
  });

  ipcMain.handle("ports:kill", (_event, { pid } = {}) =>
    portsService.kill(Number(pid)).catch(() => ({ ok: false, error: "gone" })),
  );

  // Túnel HTTPS: a URL pública já vai para a área de transferência.
  ipcMain.handle("tunnel:status", (event) => {
    const ctx = ctxOfEvent(event);
    return {
      binary: cloudflaredBinary(),
      tunnels: ctx ? tunnels.list(ctx.key) : [],
    };
  });

  ipcMain.handle("tunnel:start", async (event, { port } = {}) => {
    const ctx = ctxOfEvent(event);
    if (!ctx) return { ok: false, error: "window" };
    const binary = cloudflaredBinary();
    if (!binary) return { ok: false, error: "missing" };
    const result = await tunnels.start(ctx.key, Number(port), binary);
    if (result.ok && result.url) clipboard.writeText(result.url);
    return result;
  });

  ipcMain.handle("tunnel:stop", (event, { port } = {}) => {
    const ctx = ctxOfEvent(event);
    if (!ctx) return false;
    if (port === undefined || port === null) {
      tunnels.stopOwner(ctx.key);
      return true;
    }
    return tunnels.stop(ctx.key, Number(port));
  });

  // Sem cloudflared no PATH: o usuário aponta o binário (nada é baixado pelo app).
  ipcMain.handle("tunnel:pick-binary", async (event) => {
    const ctx = ctxOfEvent(event);
    if (!ctx || ctx.window.isDestroyed()) return { ok: false };
    const result = await dialog.showOpenDialog(ctx.window, {
      title: "Escolher o cloudflared",
      properties: ["openFile"],
      ...(process.platform === "win32"
        ? { filters: [{ name: "cloudflared", extensions: ["exe"] }] }
        : {}),
    });
    const file = result.canceled ? null : result.filePaths[0];
    if (!file) return { ok: false };
    if (!looksLikeCloudflared(file) || !isExecutableFile(file)) {
      return { ok: false, error: "invalid" };
    }
    database?.setMeta("cloudflaredPath", file);
    return { ok: true, binary: file };
  });

  // 4.5: mira de elemento (Ctrl+Shift+C) num mundo isolado; liga ou desliga.
  ipcMain.handle("inspector:toggle", async (event, { id } = {}) => {
    const contents = tabContents(ctxOfEvent(event), id);
    if (!contents || contents.isDestroyed() || !isWebUrl(contents.getURL())) {
      return { ok: false };
    }
    try {
      const active = await contents.executeJavaScriptInIsolatedWorld(
        INSPECTOR_WORLD,
        [{ code: inspectorSource() }],
        true,
      );
      // O foco vai para a página: o Esc e o clique chegam nela.
      contents.focus();
      return { ok: true, active: Boolean(active) };
    } catch {
      return { ok: false };
    }
  });

  // 4.5: modo leitura. O artigo sai da página (mundo isolado) já em blocos validados.
  ipcMain.handle("reader:extract", async (event, { id } = {}) => {
    const contents = tabContents(ctxOfEvent(event), id);
    if (!contents || contents.isDestroyed() || !/^https?:/.test(contents.getURL())) {
      return { ok: false, reason: "page" };
    }
    try {
      const raw = await contents.executeJavaScriptInIsolatedWorld(
        READER_WORLD,
        [{ code: readerSource() }],
        true,
      );
      const article = cleanArticle(raw);
      return article ? { ok: true, article } : { ok: false, reason: "empty" };
    } catch {
      return { ok: false, reason: "page" };
    }
  });

  // 4.5: captura de tela. "tab": a página ativa; "window": casca + páginas à vista, cada
  // camada com a área dela (a casca junta tudo num canvas). Nada fora da janela do app.
  ipcMain.handle("capture:take", async (event, { mode } = {}) => {
    const ctx = ctxOfEvent(event);
    if (!ctx || ctx.window.isDestroyed()) return { ok: false };
    const shot = async (contents) => {
      const image = await contents.capturePage();
      return image.isEmpty() ? null : image.toDataURL();
    };
    try {
      if (mode === "window") {
        const layers = [];
        const shell = await shot(ctx.window.webContents);
        const size = ctx.window.getContentBounds();
        if (shell)
          layers.push({ dataUrl: shell, x: 0, y: 0, width: size.width, height: size.height });
        const visible = [
          ...[...ctx.views.entries()]
            .filter(([id]) => isShown(ctx, id))
            .map(([id, entry]) => ({ contents: entry.view.webContents, rect: rectOf(ctx, id) })),
          ...[...ctx.sidePanels.entries()]
            .filter(([app]) => app === ctx.sidePanel && ctx.sidePanelRect && !ctx.panelOpen)
            .map(([, entry]) => ({ contents: entry.view.webContents, rect: ctx.sidePanelRect })),
        ];
        for (const item of visible) {
          if (!item.rect || item.contents.isDestroyed()) continue;
          const dataUrl = await shot(item.contents);
          if (dataUrl) layers.push({ dataUrl, ...item.rect });
        }
        return layers.length ? { ok: true, layers } : { ok: false };
      }
      const entry = activeViewEntry(ctx);
      const contents = entry?.view.webContents;
      if (!contents || contents.isDestroyed() || !isShown(ctx, ctx.activeTabId)) {
        return { ok: false, reason: "tab" };
      }
      const dataUrl = await shot(contents);
      const rect = rectOf(ctx, ctx.activeTabId);
      return dataUrl && rect
        ? { ok: true, layers: [{ dataUrl, x: 0, y: 0, width: rect.width, height: rect.height }] }
        : { ok: false };
    } catch {
      return { ok: false };
    }
  });

  // Electron 44: a área de transferência é assíncrona (ClipboardItem, como no W3C).
  ipcMain.handle("capture:copy", async (_event, { dataUrl } = {}) => {
    if (!isPngDataUrl(dataUrl)) return false;
    const data = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
    try {
      await clipboard.write([
        new ClipboardItem({ "image/png": new Blob([data], { type: "image/png" }) }),
      ]);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle("capture:save", async (event, { dataUrl } = {}) => {
    const ctx = ctxOfEvent(event);
    if (!ctx || !isPngDataUrl(dataUrl)) return { ok: false };
    const remembered = database?.getMeta("captureDir");
    const folder =
      typeof remembered === "string" && fs.existsSync(remembered)
        ? remembered
        : app.getPath("pictures");
    const result = await dialog.showSaveDialog(ctx.window, {
      title: "Salvar captura",
      defaultPath: path.join(folder, captureFileName(new Date())),
      filters: [{ name: "PNG", extensions: ["png"] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    const file = /\.png$/i.test(result.filePath) ? result.filePath : `${result.filePath}.png`;
    try {
      fs.writeFileSync(file, Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
      database?.setMeta("captureDir", path.dirname(file));
      return { ok: true, path: file };
    } catch {
      return { ok: false };
    }
  });

  // 4.5: API Scratchpad. Captura liga o Network da guia; o envio usa a sessão dela.
  ipcMain.handle("scratchpad:capture", (event, { id, on } = {}) => {
    const ctx = ctxOfEvent(event);
    const contents = tabContents(ctx, id);
    if (!ctx || !contents || contents.isDestroyed()) return { ok: false, requests: [] };
    if (!on) {
      netCapture.stop(contents);
      return { ok: true, requests: [] };
    }
    const result = netCapture.start(contents, { tabId: id, owner: ctx });
    return { ...result, requests: netCapture.requests(contents) };
  });

  ipcMain.handle("scratchpad:send", (event, { request, tabId } = {}) => {
    const ctx = ctxOfEvent(event);
    const contents = tabContents(ctx, tabId);
    const ses = contents && !contents.isDestroyed() ? contents.session : session.defaultSession;
    return sendRequest((url, init) => ses.fetch(url, init), request);
  });

  // 4.5: extensões (Configurações → Extensões).
  ipcMain.handle("extensions:list", () => ({
    supported: Boolean(extensions),
    list: extensions?.list() ?? [],
  }));

  ipcMain.handle("extensions:add-unpacked", async (event) => {
    const ctx = ctxOfEvent(event);
    if (!ctx || !extensions) return { ok: false, error: "unsupported" };
    const result = await dialog.showOpenDialog(ctx.window, {
      title: "Carregar extensão descompactada (pasta com manifest.json)",
      properties: ["openDirectory"],
    });
    const dir = result.canceled ? null : result.filePaths[0];
    if (!dir) return { ok: false, canceled: true };
    return extensionsChanged(extensions.addUnpacked(dir));
  });

  ipcMain.handle("extensions:install-store", (_event, { input } = {}) =>
    extensions
      ? extensionsChanged(extensions.installFromStore(String(input ?? "")))
      : { ok: false, error: "unsupported" },
  );

  ipcMain.handle("extensions:set-enabled", (_event, { dir, enabled } = {}) =>
    extensions
      ? extensionsChanged(extensions.setEnabled(String(dir ?? ""), Boolean(enabled)))
      : { ok: false },
  );

  ipcMain.handle("extensions:reload", (_event, { dir } = {}) =>
    extensions ? extensionsChanged(extensions.reload(String(dir ?? ""))) : { ok: false },
  );

  ipcMain.handle("extensions:remove", (_event, { dir } = {}) => {
    const result = extensions ? extensions.remove(String(dir ?? "")) : { ok: false };
    broadcast("agzos:extensions-changed", {});
    return result;
  });

  // 4.6.1: dica dos botões da barra (texto curto da casca, área do botão na janela).
  ipcMain.handle("tooltip:show", (event, { text, anchor, dark } = {}) => {
    const ctx = ctxOfEvent(event);
    const area = validAnchor(anchor);
    // Com um painel aberto a dica não aparece (nem fica por cima da camada).
    if (!ctx || !area || ctx.overlay?.model) return;
    ctx.tooltip ??= createTooltip({
      window: ctx.window,
      createView: () => createLayerView(WebContentsView),
    });
    return ctx.tooltip.show(text, area, Boolean(dark));
  });

  ipcMain.handle("tooltip:hide", (event) => {
    ctxOfEvent(event)?.tooltip?.hide();
  });

  // 4.6.1: atualizar a extensão da loja quando o usuário pede (a badge só avisa).
  ipcMain.handle("extensions:update", (_event, { dir } = {}) =>
    extensions ? extensionsChanged(extensions.update(String(dir ?? ""))) : { ok: false },
  );

  ipcMain.handle("extensions:check-updates", async () => {
    const count = (await extensions?.checkUpdates().catch(() => 0)) ?? 0;
    broadcast("agzos:extensions-changed", {});
    return { count };
  });

  // 4.6: alfinete (ícone fixo na barra).
  ipcMain.handle("extensions:pin", (_event, { dir, pinned } = {}) => {
    const result = extensions?.setPinned(String(dir ?? ""), Boolean(pinned)) ?? { ok: false };
    broadcast("agzos:extensions-changed", {});
    return result;
  });

  // 4.6: pop-up da extensão ancorado no ícone (área em coordenadas da janela).
  ipcMain.handle("extensions:popup", (event, { dir, anchor } = {}) => {
    const ctx = ctxOfEvent(event);
    const info = extensions?.info(String(dir ?? ""));
    if (!ctx || !info?.popup) return { ok: false };
    // O clique no ícone do pop-up aberto só fecha (como no Chrome).
    if (lastPopupClose.dir === info.dir && Date.now() - lastPopupClose.at < 400) {
      lastPopupClose = { dir: null, at: 0 };
      return { ok: true, closed: true };
    }
    openExtensionPopup(ctx, info, validAnchor(anchor));
    return { ok: true };
  });

  // 4.6: acesso da extensão ao site da guia (o menu é da casca, com o visual do app).
  ipcMain.handle("extensions:site-access", async (event, { dir, tabId, allowed } = {}) => {
    const ctx = ctxOfEvent(event);
    const origin = ctx ? tabOrigin(ctx, tabId) : null;
    if (!origin || !extensions) return { ok: false };
    return extensionsChanged(extensions.setSiteAccess(String(dir ?? ""), origin, Boolean(allowed)));
  });

  // 4.6: "Inspecionar pop-up": abre o pop-up com o DevTools dele.
  ipcMain.handle("extensions:inspect", (event, { dir, anchor } = {}) => {
    const ctx = ctxOfEvent(event);
    const info = extensions?.info(String(dir ?? ""));
    if (!ctx || !info?.popup) return { ok: false };
    openExtensionPopup(ctx, info, validAnchor(anchor), { inspect: true });
    return { ok: true };
  });

  // 4.5: Widevine (só no build com o CDM da castLabs; o Electron oficial não traz).
  ipcMain.handle("widevine:status", () => widevineStatus());

  // 4.5: modo leitura cobre a guia (a casca mostra o artigo); sair devolve a página.
  ipcMain.handle("tab:cover", (event, { id, covered } = {}) => {
    const ctx = ctxOfEvent(event);
    if (!ctx || !Number.isSafeInteger(id)) return;
    if (covered) ctx.covered.add(id);
    else ctx.covered.delete(id);
    applyLayout(ctx);
  });

  // 4.5: expandir leva o painel para a área das guias; recolher volta ao painel menor. A
  // casca manda a área nova pelo sidepanel:bounds (a mesma view, sem recarregar).
  ipcMain.handle("sidepanel:expand", (event, { expanded } = {}) => {
    const ctx = ctxOfEvent(event);
    if (!ctx) return;
    ctx.sidePanelExpanded = Boolean(expanded) && Boolean(ctx.sidePanel);
    applyLayout(ctx);
  });

  ipcMain.handle("sidepanel:bounds", (event, rect) => {
    const ctx = ctxOfEvent(event);
    if (!ctx) return;
    const valid = rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite);
    ctx.sidePanelRect = valid && rect.width > 0 && rect.height > 0 ? rect : null;
    layoutSidePanels(ctx);
  });

  ipcMain.handle("sidepanel:reload", (event, { app } = {}) => {
    const entry = ctxOfEvent(event)?.sidePanels.get(app);
    if (!entry || entry.view.webContents.isDestroyed()) return;
    void entry.view.webContents.loadURL(entry.url).catch(() => {});
  });

  ipcMain.handle("sidepanel:zoom", (event, { app, direction } = {}) => {
    if (![1, -1, 0].includes(direction)) return;
    setPanelZoom(ctxOfEvent(event), app, direction);
  });

  ipcMain.handle("sidepanel:zoom-get", (event, { app } = {}) => {
    const entry = ctxOfEvent(event)?.sidePanels.get(app);
    if (entry && !entry.view.webContents.isDestroyed()) {
      return entry.view.webContents.getZoomFactor();
    }
    return panelZooms()[app] ?? 1;
  });

  ipcMain.handle("sidepanel:drag", (event, { active } = {}) => {
    const ctx = ctxOfEvent(event);
    if (!ctx) return;
    if (active) startPanelDrag(ctx);
    else stopPanelDrag(ctx);
  });

  ipcMain.handle("sidepanel:unload", (event, { app } = {}) => {
    const ctx = ctxOfEvent(event);
    if (ctx) unloadSidePanel(ctx, app);
  });

  // Tela dividida (2.0): as duas guias à vista, ou null.
  ipcMain.handle("tab:split", (event, ids) => {
    const ctx = ctxOfEvent(event);
    if (!ctx) return;
    const valid =
      Array.isArray(ids) &&
      ids.length === 2 &&
      ids.every(Number.isSafeInteger) &&
      ids[0] !== ids[1];
    ctx.split = valid ? [ids[0], ids[1]] : null;
    for (const key of [...ctx.paneRects.keys()]) {
      if (!ctx.split?.includes(key)) ctx.paneRects.delete(key);
    }
    applyLayout(ctx);
  });

  ipcMain.handle("tab:navigate", (event, { id, url }) => {
    const contents = tabContents(ctxOfEvent(event), id);
    if (!contents || !isWebUrl(url)) return;
    if (contents.getURL() === url) return;
    void loadWithScriptlets(contents, url);
  });

  ipcMain.handle("tab:back", (event, { id }) => {
    const contents = tabContents(ctxOfEvent(event), id);
    if (contents?.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
  });

  ipcMain.handle("tab:forward", (event, { id }) => {
    const contents = tabContents(ctxOfEvent(event), id);
    if (contents?.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
  });

  ipcMain.handle("tab:reload", (event, { id, ignoreCache }) => {
    const ctx = ctxOfEvent(event);
    const contents = tabContents(ctx, id);
    if (!contents) return;
    // Página com erro: "Tentar novamente" carrega de novo a URL que falhou.
    const failure = ctx.failed.get(id);
    if (failure?.url && isWebUrl(failure.url) && contents.getURL() !== failure.url) {
      void loadWithScriptlets(contents, failure.url);
      return;
    }
    if (ignoreCache) contents.reloadIgnoringCache();
    else contents.reload();
  });

  ipcMain.handle("tab:zoom", (event, { id, direction }) => {
    if (![-1, 0, 1].includes(direction)) return;
    changeZoom(tabContents(ctxOfEvent(event), id), direction);
  });

  ipcMain.handle("find:start", (event, { id, text, forward, newSession }) => {
    const contents = tabContents(ctxOfEvent(event), id);
    if (!contents || typeof text !== "string" || !text) return;
    // findNext=true abre uma busca nova; false vai para o próximo/anterior resultado.
    contents.findInPage(text.slice(0, 500), {
      forward: forward !== false,
      findNext: Boolean(newSession),
    });
  });

  ipcMain.handle("find:stop", (event, { id }) => {
    tabContents(ctxOfEvent(event), id)?.stopFindInPage("clearSelection");
  });

  ipcMain.handle("window:toggle-fullscreen", (event) => {
    const window = ctxOfEvent(event)?.window;
    if (window && !window.isDestroyed()) window.setFullScreen(!window.isFullScreen());
  });

  ipcMain.handle("window:new", (event, options) => {
    const near = ctxOfEvent(event);
    const url = typeof options?.url === "string" && isWebUrl(options.url) ? options.url : null;
    createWindow({
      near,
      session: url ? tabSession({ history: [{ title: url, url, kind: "page" }], index: 0 }) : null,
    });
  });

  // "Mover para nova janela": o WebContentsView muda de janela sem recarregar a página.
  ipcMain.handle("tab:move-to-window", (event, { id, tab }) => {
    const ctx = ctxOfEvent(event);
    if (!ctx || typeof tab !== "object" || tab === null || !Array.isArray(tab.history)) {
      return { ok: false };
    }
    if (JSON.stringify(tab).length > MAX_SESSION_BYTES) return { ok: false };
    closePanelLayer(ctx, { notify: true });
    const entry = ctx.views.get(id);
    const moved = { id: 1, view: entry?.view ?? null, history: ctx.hibernated.get(id) ?? null };
    if (entry) {
      ctx.window.contentView.removeChildView(entry.view);
      ctx.views.delete(id);
      ctx.crashed.delete(id);
      ctx.rejected.delete(id);
      ctx.failed.delete(id);
      ctx.unresponsive.delete(id);
    }
    ctx.hibernated.delete(id);
    if (ctx.activeTabId === id) ctx.activeTabId = null;
    applyLayout(ctx);
    createWindow({ near: ctx, session: tabSession(tab), adopt: moved });
    return { ok: true };
  });

  // A casca avisa quais guias existem (depois de recarregar): as outras fecham.
  ipcMain.handle("tabs:known", (event, { ids }) => {
    const ctx = ctxOfEvent(event);
    if (!ctx || !Array.isArray(ids)) return;
    const known = new Set(ids.filter(Number.isSafeInteger));
    for (const [id, entry] of [...ctx.views]) if (!known.has(id)) dropView(ctx, id, entry);
    for (const id of [...ctx.hibernated.keys()]) if (!known.has(id)) ctx.hibernated.delete(id);
  });

  ipcMain.handle("tab:pip", (event, { id }) =>
    togglePictureInPicture(tabContents(ctxOfEvent(event), id)),
  );

  ipcMain.handle("tab:hibernate", async (event, { id }) => {
    const ctx = ctxOfEvent(event);
    return { ok: ctx ? await hibernateTab(ctx, id, { force: true }) : false };
  });

  // GX Control: retrato de uso (totais do app, guias desta janela), teste de velocidade e
  // limpeza de cache.
  ipcMain.handle("gx:stats", (event) => gxControl.stats(ctxOfEvent(event), os));
  ipcMain.handle("gx:speedtest", async () => {
    try {
      return { ok: true, ...(await runSpeedTest((url, init) => net.fetch(url, init))) };
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) };
    }
  });
  ipcMain.handle("gx:cache-size", () => gxCacheSize());
  ipcMain.handle("gx:clear-cache", () => gxClearCache());
  // --- Agzos AI (4.0): a chave e as chamadas à Groq ficam aqui; a casca só vê o texto. ---
  ipcMain.handle("ai:state", () => aiService().state());
  ipcMain.handle("ai:set-key", (_event, { key } = {}) => aiService().setKey(key));
  ipcMain.handle("ai:remove-key", () => aiService().removeKey());
  ipcMain.handle("ai:models", (_event, { refresh } = {}) =>
    aiService().models({ refresh: Boolean(refresh) }),
  );
  // Conversas (4.1.3): a lista vai para todas as janelas; as mensagens, só quando pedidas.
  ipcMain.handle("ai:library", () => aiService().library());
  ipcMain.handle("ai:messages", (_event, { chatId } = {}) => aiService().messages(chatId));
  ipcMain.handle("ai:library-action", (_event, action = {}) => {
    const result = aiService().libraryAction(action);
    broadcast("agzos:ai-library", result.library);
    return result;
  });
  ipcMain.handle("ai:abort", (_event, { requestId } = {}) => aiService().abort(requestId));
  ipcMain.handle("ai:chat", async (event, payload = {}) => {
    const sender = event.sender;
    const requestId = String(payload.requestId ?? "");
    const result = await aiService().chat(
      {
        requestId,
        chatId: payload.chatId,
        projectId: payload.projectId,
        model: payload.model,
        text: payload.text,
        context: payload.context,
      },
      (delta) => {
        if (!sender.isDestroyed()) sender.send("agzos:ai-delta", { requestId, delta });
      },
    );
    if (result.ok) broadcast("agzos:ai-library", aiService().library());
    return result;
  });
  // Texto selecionado na guia: só lido quando o usuário marca "enviar contexto" e envia.
  ipcMain.handle("tab:selection", (event, { id } = {}) => {
    const contents = tabContents(ctxOfEvent(event), id);
    if (!contents || contents.isDestroyed()) return "";
    return contents
      .executeJavaScript("String(window.getSelection ? window.getSelection() : '')", true)
      .then((text) => (typeof text === "string" ? text.slice(0, 8000) : ""))
      .catch(() => "");
  });
  // --- Terminal (4.0): cada janela só vê e escreve nas sessões dela. ---
  ipcMain.handle("terminal:available", () => terminalService().available());
  ipcMain.handle("terminal:open", (event, options = {}) => {
    const ctx = terminalCtx(event);
    if (!ctx) return { ok: false, error: "window" };
    return terminalService().open(ctx, options);
  });
  ipcMain.on("terminal:write", (event, { id, data } = {}) => {
    const ctx = terminalCtx(event);
    if (ctx) terminals?.write(ctx, id, data);
  });
  ipcMain.handle("terminal:resize", (event, { id, cols, rows } = {}) => {
    const ctx = terminalCtx(event);
    return ctx ? Boolean(terminals?.resize(ctx, id, cols, rows)) : false;
  });
  ipcMain.handle("terminal:kill", (event, { id } = {}) => {
    const ctx = terminalCtx(event);
    return ctx ? Boolean(terminals?.kill(ctx, id)) : false;
  });
  ipcMain.handle("terminal:focus", (event, { focused } = {}) => {
    // Só a casca: o terminal flutuante não tem atalhos do navegador para desviar.
    const ctx = ctxOfEvent(event);
    if (ctx) ctx.terminalFocused = Boolean(focused);
  });
  // Abas e pastas das sessões (para reabrir no último cwd); a casca grava a lista dela.
  ipcMain.handle("terminal:saved", () => {
    const list = database?.getMeta("terminalSessions");
    return Array.isArray(list) ? list.slice(0, 12) : [];
  });
  ipcMain.handle("terminal:save", (_event, list) => {
    if (!Array.isArray(list)) return { ok: false };
    const clean = list
      .slice(0, 12)
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        shell: typeof item.shell === "string" ? item.shell.slice(0, 40) : "",
        cwd: typeof item.cwd === "string" ? item.cwd.slice(0, 1024) : "",
      }));
    database?.setMeta("terminalSessions", clean);
    return { ok: true };
  });
  // --- Terminal 4.1: posições, aparência/aliases, chaves de API, SSH e voz. ---
  ipcMain.handle("terminal:list", (event) => {
    const ctx = terminalCtx(event);
    return ctx && terminals ? terminals.list(ctx) : [];
  });
  ipcMain.handle("terminal:open-ssh", (event, { connection, cols, rows } = {}) => {
    const ctx = terminalCtx(event);
    if (!ctx) return { ok: false, error: "window" };
    const args = sshArgs(connection);
    if (!args) return { ok: false, error: "ssh-invalid" };
    const name = typeof connection?.name === "string" ? connection.name.trim() : "";
    return terminalService().open(ctx, {
      ssh: args,
      cols,
      rows,
      title: `ssh · ${name || connection.host}`,
    });
  });
  // Preferências do terminal vindas da casca: aliases e a chave da Groq valem nas sessões
  // novas; o resto (tema, fonte) vai para o terminal flutuante.
  ipcMain.handle("terminal:config", (_event, config) => {
    if (!config || typeof config !== "object") return;
    terminalConfig = { ...config, aliases: cleanAliases(config.aliases) };
    for (const ctx of contexts.values()) {
      const pip = ctx.terminalPip;
      if (pip && !pip.isDestroyed()) pip.webContents.send("agzos:terminal-config", terminalConfig);
    }
  });
  ipcMain.handle("terminal:config-get", () => terminalConfig);
  ipcMain.handle("terminal:pip", (event, { open } = {}) => {
    const ctx = ctxOfEvent(event);
    if (!ctx) return;
    if (open) openTerminalPip(ctx);
    else closeTerminalPip(ctx);
  });
  // Botões do terminal flutuante ("encaixar embaixo/à direita", esconder) → casca.
  ipcMain.handle("terminal:dock", (event, { dock } = {}) => {
    const ctx = terminalPipOwner.get(event.sender.id);
    if (!ctx) return;
    if (dock === "bottom" || dock === "right") send(ctx, "agzos:terminal-pip", { dock });
    else send(ctx, "agzos:terminal-pip", { open: false });
  });
  ipcMain.handle("terminal:tools", (_event, { commands } = {}) =>
    detectCommands(commands, {
      platform: process.platform,
      env: cliEnv(),
      exists: fs.existsSync,
    }),
  );
  // --- 4.1.1: nome da aba, CLIs de IA, arquivos, skills e modo agente. ---
  ipcMain.handle("terminal:rename", (event, { id, title } = {}) => {
    const ctx = terminalCtx(event);
    if (!ctx || !terminals?.rename(ctx, id, title)) return false;
    sendTerminal(ctx, "agzos:terminal-title", {
      id,
      title: typeof title === "string" ? title.trim().slice(0, 60) : "",
    });
    return true;
  });
  // Instalação das CLIs: aba nova com o script (Linux/macOS) ou os comandos digitados numa
  // sessão do PowerShell (Windows). Só ids da lista fixa; o usuário vê tudo rodando.
  ipcMain.handle("terminal:install-tools", (event, { ids, cols, rows } = {}) => {
    const ctx = terminalCtx(event);
    if (!ctx) return { ok: false, error: "window" };
    const list = cleanToolIds(ids);
    if (!list.length) return { ok: false, error: "empty" };
    const service = terminalService();
    if (process.platform === "win32") {
      const result = service.open(ctx, { cols, rows, title: "Instalar CLIs de IA" });
      if (!result.ok) return result;
      const lines = windowsInstallLines(list, { home: os.homedir(), env: process.env });
      // O PowerShell guarda o que chega antes do prompt; cada linha é um comando.
      setTimeout(() => terminals?.write(ctx, result.id, `${lines.join("\r")}\r`), 700);
      return result;
    }
    const dir = path.join(app.getPath("userData"), "terminal-init");
    const file = path.join(dir, "install-clis.sh");
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        file,
        unixInstallScript(list, { home: os.homedir(), platform: process.platform }),
        { mode: 0o700 },
      );
    } catch {
      return { ok: false, error: "storage" };
    }
    return service.open(ctx, {
      cols,
      rows,
      title: "Instalar CLIs de IA",
      program: installProgram({ file }),
    });
  });
  ipcMain.handle("terminal:open-agent", (event, { tool, prompt, cwd, title, cols, rows } = {}) => {
    const ctx = terminalCtx(event);
    if (!ctx) return { ok: false, error: "window" };
    const recipe = CLI_TOOLS[tool];
    if (!recipe?.headless) return { ok: false, error: "headless" };
    const env = cliEnv();
    const binary = onPathOf(recipe.command, env);
    if (!binary) return { ok: false, error: "no-tool" };
    const program = agentProgram({ tool, prompt, binary, platform: process.platform, env });
    if (!program) return { ok: false, error: "request" };
    return terminalService().open(ctx, {
      cwd,
      cols,
      rows,
      title: typeof title === "string" && title.trim() ? title.trim().slice(0, 60) : recipe.name,
      program,
    });
  });
  ipcMain.handle("agent:groq", async (_event, { prompt } = {}) =>
    aiService().complete({ system: AGENT_GROQ_SYSTEM, user: prompt, maxTokens: 4096 }),
  );
  ipcMain.handle("agent:plan", async (_event, { goal, tools } = {}) => {
    const allowed = (Array.isArray(tools) ? tools : []).filter(
      (tool) => tool === "groq" || CLI_TOOLS[tool]?.headless,
    );
    if (!allowed.length) allowed.push("groq");
    const result = await aiService().complete({
      system: AGENT_PLAN_SYSTEM,
      user: `Ferramentas disponíveis: ${allowed.join(", ")}\n("groq" responde texto; as outras são CLIs que leem e editam arquivos na pasta do projeto.)\n\nObjetivo: ${String(goal ?? "").slice(0, 4000)}`,
      json: true,
    });
    if (!result.ok) return result;
    const steps = parseAgentPlan(result.text, allowed);
    return steps.length ? { ok: true, steps } : { ok: false, error: "plan" };
  });
  ipcMain.handle("terminal:skills", (_event, { cwd } = {}) =>
    findSkills({ home: os.homedir(), cwd: typeof cwd === "string" ? cwd : "" }),
  );
  ipcMain.handle("terminal:skill-create", (_event, options = {}) =>
    createSkill({ ...options, home: os.homedir() }),
  );
  ipcMain.handle("files:list", (event, { dir, hidden } = {}) => {
    if (!isAppInterface(event.sender)) return { ok: false, error: "access" };
    return listDirectory(typeof dir === "string" && dir ? dir : os.homedir(), {
      hidden: hidden === true,
    });
  });
  ipcMain.handle("files:home", () => os.homedir());
  ipcMain.handle("files:open", (event, { file, where } = {}) => {
    const ctx = terminalCtx(event);
    if (!ctx || typeof file !== "string" || !path.isAbsolute(file)) return false;
    if (where === "system") {
      void shell.openPath(file);
      return true;
    }
    if (where === "folder") {
      shell.showItemInFolder(file);
      return true;
    }
    openPathsInTabs(ctx, [file]);
    return true;
  });
  // Ctrl+O: escolhe arquivos e abre cada um numa guia.
  ipcMain.handle("files:pick", async (event) => {
    const ctx = ctxOfEvent(event);
    if (!ctx) return 0;
    const result = await dialog.showOpenDialog(ctx.window, {
      title: "Abrir arquivo",
      properties: ["openFile", "multiSelections"],
    });
    if (result.canceled) return 0;
    openPathsInTabs(ctx, result.filePaths);
    return result.filePaths.length;
  });
  // "Abrir no app do sistema" da página de um arquivo (agzos-file): só o arquivo dela.
  ipcMain.on("agzos:file-open-external", (event) => {
    const file = pathOfFileUrl(event.sender.getURL(), fileToken());
    if (file) void shell.openPath(file);
  });
  // Visualizador de imagem: os bytes da própria imagem da guia (exportar com anotações
  // quando o canvas não pode ler um arquivo local). Só o endereço de quem pede.
  ipcMain.handle("agzos:image-bytes", async (event) => {
    if (!tabOfContents.has(event.sender.id)) return null;
    const url = event.sender.getURL();
    try {
      if (url.startsWith("file:")) {
        const file = require("node:url").fileURLToPath(url);
        if (fs.statSync(file).size > 200 * 1024 * 1024) return null;
        return new Uint8Array(fs.readFileSync(file));
      }
      if (/^https?:/i.test(url)) {
        const response = await event.sender.session.fetch(url);
        return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
      }
    } catch {
      return null;
    }
    return null;
  });
  // --- PWA (4.1.1) ---
  ipcMain.on("agzos:pwa-detect", (event, payload = {}) => {
    if (typeof payload.manifestUrl !== "string") return;
    void detectPwa(event.sender, {
      manifestUrl: payload.manifestUrl,
      serviceWorker: payload.serviceWorker === true,
    }).catch(() => {});
  });
  ipcMain.handle("pwa:state", (event, { tabId } = {}) => {
    const contents = tabContents(ctxOfEvent(event), tabId);
    return contents ? pwaStateOf(contents) : null;
  });
  ipcMain.handle("pwa:check", (event, { tabId } = {}) =>
    checkPwa(tabContents(ctxOfEvent(event), tabId)),
  );
  ipcMain.handle("pwa:install", (event, { tabId } = {}) => {
    const ctx = ctxOfEvent(event);
    return ctx ? installPwa(ctx, tabId) : { ok: false, error: "window" };
  });
  ipcMain.handle("pwa:open", (_event, { id } = {}) => openPwaWindow(id));
  ipcMain.handle("pwa:uninstall", (event, { id } = {}) =>
    uninstallPwa(id, { parent: ctxOfEvent(event)?.window ?? null }),
  );
  ipcMain.handle("pwa:list", () =>
    (pwaStore?.list() ?? []).map((record) => ({
      id: record.id,
      name: record.name,
      startUrl: record.startUrl,
      origin: record.origin,
      installedAt: record.installedAt,
      icon: pwaIconDataUrl(record.id),
      open: Boolean(pwaWindows.get(record.id) && !pwaWindows.get(record.id).isDestroyed()),
    })),
  );
  ipcMain.handle("terminal:secrets", () => ({
    names: terminalSecrets().names(),
    encryption: terminalSecrets().encryption(),
  }));
  ipcMain.handle("terminal:secret-set", (_event, { name, value } = {}) =>
    terminalSecrets().set(name, value),
  );
  ipcMain.handle("terminal:secret-remove", (_event, { name } = {}) =>
    terminalSecrets().remove(name),
  );
  ipcMain.handle("ssh:keys", () => listKeys(path.join(os.homedir(), ".ssh")));
  ipcMain.handle("ssh:generate", (_event, { name, comment, passphrase } = {}) =>
    generateKey({
      sshDir: path.join(os.homedir(), ".ssh"),
      name,
      comment,
      passphrase,
      execFile: require("node:child_process").execFile,
      binary: keygenBinary({
        platform: process.platform,
        env: process.env,
        exists: fs.existsSync,
      }),
    }),
  );
  ipcMain.handle("ai:transcribe", (_event, { audio, mime, language } = {}) =>
    aiService().transcribe({
      audio: audio instanceof Uint8Array ? audio : audio ? new Uint8Array(audio) : null,
      mime,
      language,
    }),
  );
  // macOS pede a permissão do microfone ao sistema uma vez.
  ipcMain.handle("media:mic-access", async () => {
    if (process.platform !== "darwin") return true;
    try {
      if (systemPreferences.getMediaAccessStatus("microphone") === "granted") return true;
      return await systemPreferences.askForMediaAccess("microphone");
    } catch {
      return false;
    }
  });
  ipcMain.handle("terminal:clipboard-read", () => clipboard.readText());
  ipcMain.handle("terminal:clipboard-write", (_event, { text } = {}) => {
    if (typeof text === "string") clipboard.writeText(text);
  });
  ipcMain.handle("gestures:get", () => gestureConfig);
  ipcMain.handle("gestures:config", (_event, config) => {
    const value = config && typeof config === "object" ? config : {};
    gestureConfig = {
      swipe: value.swipe !== false,
      pinch: value.pinch !== false,
      draw: value.draw !== false,
      mouse: value.mouse !== false,
    };
    for (const contents of gestureTargets()) contents.send("agzos:gestures-config", gestureConfig);
  });
  ipcMain.on("agzos:gesture", (event, payload) => {
    const found = gestureSurface(event.sender);
    if (!found || !payload || typeof payload.gesture !== "string") return;
    const extra =
      payload.gesture === "pinch" ? { direction: payload.direction === -1 ? -1 : 1 } : {};
    emitGesture(found.ctx, payload.gesture, found.surface, extra);
  });
  // Clique direito sem gesto: o page-preload segurou o menu; repete o clique para ele abrir.
  ipcMain.on("agzos:context-menu-replay", (event, payload) => {
    const contents = event.sender;
    if (!payload || !gestureSurface(contents) || contents.isDestroyed()) return;
    const zoom = contents.getZoomFactor() || 1;
    const x = Math.round(Number(payload.x) * zoom);
    const y = Math.round(Number(payload.y) * zoom);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    contents.sendInputEvent({ type: "mouseDown", x, y, button: "right", clickCount: 1 });
    contents.sendInputEvent({ type: "mouseUp", x, y, button: "right", clickCount: 1 });
  });
  // Voltar/avançar/recarregar do painel lateral (gestos com o cursor sobre ele).
  ipcMain.handle("sidepanel:nav", (event, { app: appId, action } = {}) => {
    const contents = ctxOfEvent(event)?.sidePanels.get(appId)?.view.webContents;
    if (!contents || contents.isDestroyed()) return { ok: false };
    const history = contents.navigationHistory;
    if (action === "back" && history.canGoBack()) history.goBack();
    else if (action === "forward" && history.canGoForward()) history.goForward();
    else if (action === "reload") contents.reload();
    else return { ok: false };
    return { ok: true };
  });
  ipcMain.handle("gpu:status", () => gpuStatus(app, gpuRunMode));
  ipcMain.handle("gpu:set", (_event, { enabled } = {}) => ({
    ok: setGpuEnabled(app, enabled !== false),
  }));

  // "Encerrar página" (página sem resposta): derruba o processo; a tela de travada assume.
  ipcMain.handle("tab:kill", (event, { id }) => {
    tabContents(ctxOfEvent(event), id)?.forcefullyCrashRenderer();
  });

  ipcMain.handle("certificate:allow", (event, { id }) => {
    const contents = tabContents(ctxOfEvent(event), id);
    const key = contents ? lastCertificateError.get(contents.id) : null;
    if (!contents || !key) return { ok: false };
    allowedCertificates.add(key);
    contents.reload();
    return { ok: true };
  });

  // Só a primeira janela que perguntar mostra o aviso (uma vez por atualização).
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("app:whats-new", () => {
    const info = updatedFrom;
    updatedFrom = null;
    return info;
  });

  ipcMain.handle("window:startup", () => {
    if (startupNoticeShown || !startup.unclean) return null;
    startupNoticeShown = true;
    return { safe: startup.early, windows: startup.restoredWindows };
  });

  // Mudança no escudo vale na hora (o state:save tem debounce).
  ipcMain.handle("adblock:config", (_event, config) => {
    applyShieldConfig(config);
  });

  ipcMain.handle("adblock:stats", () =>
    adblock
      ? { available: adblock.available(), ...adblock.statsInfo() }
      : { available: false, today: 0, updatedAt: null, ready: false },
  );

  ipcMain.handle("adblock:update", async () => {
    if (!adblock) return { ok: false };
    return { ok: await adblock.update() };
  });

  ipcMain.handle("downloads:list", () => downloads?.list() ?? []);
  ipcMain.handle("downloads:dir", () => downloadsDir());
  ipcMain.handle("downloads:open-dir", () => void shell.openPath(downloadsDir()));
  ipcMain.handle("app:quit", () => app.quit());
  ipcMain.handle("download:action", (_event, { id, action }) => {
    if (!downloads || !Number.isInteger(id)) return { ok: false };
    switch (action) {
      case "pause":
        downloads.pause(id);
        return { ok: true };
      case "resume":
        downloads.resume(id);
        return { ok: true };
      case "cancel":
        downloads.cancel(id);
        return { ok: true };
      case "open": {
        const file = downloads.completedPath(id);
        if (file) void shell.openPath(file);
        return { ok: Boolean(file) };
      }
      case "show": {
        const file = downloads.anyPath(id);
        if (file && fs.existsSync(file)) shell.showItemInFolder(file);
        else void shell.openPath(downloadsDir());
        return { ok: true };
      }
      case "remove":
        return { ok: downloads.remove(id) };
      default:
        return { ok: false };
    }
  });
  ipcMain.handle("downloads:clear", () => {
    downloads?.clear();
    return downloads?.list() ?? [];
  });

  ipcMain.handle("tab:close", (event, { id }) => {
    const ctx = ctxOfEvent(event);
    if (!ctx) return;
    ctx.hibernated.delete(id);
    ctx.covered.delete(id);
    if (ctx.views.has(id)) dropView(ctx, id);
    if (ctx.activeTabId === id) ctx.activeTabId = null;
  });

  ipcMain.handle("tab:mute", (event, { id, muted }) => {
    tabContents(ctxOfEvent(event), id)?.setAudioMuted(muted);
  });

  ipcMain.handle("preview:show", (event, payload) => {
    const ctx = ctxOfEvent(event);
    if (!ctx || !payload || typeof payload.card !== "object") return;
    const rect = payload.rect;
    if (![rect?.x, rect?.y, rect?.width, rect?.height].every(Number.isFinite)) return;
    return showPreview(ctx, {
      id: payload.id,
      rect,
      side: payload.side === "right" ? "right" : "below",
      card: payload.card,
    });
  });

  ipcMain.handle("preview:hide", (event) => {
    const ctx = ctxOfEvent(event);
    if (ctx) hidePreview(ctx);
  });

  ipcMain.handle("overlay:open", (event, payload) => {
    const ctx = ctxOfEvent(event);
    const model = sanitizeOverlay(payload);
    if (!ctx || !model) return { ok: false };
    return openPanelLayer(ctx, model);
  });

  ipcMain.handle("overlay:close", (event) => {
    const ctx = ctxOfEvent(event);
    if (ctx) closePanelLayer(ctx);
  });

  // A casca respondeu a uma chamada do painel (overlay:call).
  ipcMain.handle("overlay:reply", (event, { id, result }) => {
    const pending = pendingOverlayCalls.get(id);
    if (!pending || pending.ctx !== ctxOfEvent(event)) return;
    pendingOverlayCalls.delete(id);
    clearTimeout(pending.timer);
    pending.resolve(result);
  });

  ipcMain.on("overlay:ready", (event) => {
    const ctx = overlayOfEvent(event);
    if (!ctx) return;
    ctx.overlay.ready = true;
    ctx.overlay.markReady(true);
  });

  // Função do painel (onClose, onAction…): roda na casca, que tem o estado.
  ipcMain.handle("overlay:call", (event, { name, args }) => {
    const ctx = overlayOfEvent(event);
    if (!ctx?.overlay.model || !ctx.overlay.model.fns.includes(name)) return undefined;
    const id = ++overlayCallSeq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingOverlayCalls.delete(id);
        resolve(undefined);
      }, 30_000);
      pendingOverlayCalls.set(id, { ctx, resolve, timer });
      send(ctx, "agzos:overlay-call", { id, name, args: Array.isArray(args) ? args : [] });
    });
  });

  // Esc, ou clique fora do painel (payload com o ponto): fecha e o clique segue adiante.
  ipcMain.on("overlay:dismiss", (event, payload) => {
    const ctx = overlayOfEvent(event);
    if (!ctx?.overlay?.model) return;
    const hit = payload && typeof payload === "object" ? clickTarget(ctx, payload) : null;
    // `click: "shell"`: o clique vai para a casca (se for o botão do próprio painel, ela
    // não o reabre).
    closePanelLayer(ctx, { notify: true, refocus: !hit, click: hit?.where ?? false });
    if (hit) clickThrough(hit, payload.button);
  });

  // Rolagem fora do painel: vai para a página por baixo.
  ipcMain.on("overlay:wheel", (event, payload) => {
    const ctx = overlayOfEvent(event);
    if (!ctx) return;
    const pane = paneAt(ctx, payload ?? {});
    if (!pane) return;
    const input = wheelEvent(rectOf(ctx, pane.id), payload);
    if (input) pane.contents.sendInputEvent(input);
  });

  ipcMain.handle("switcher:state", (event, { open }) => {
    const ctx = ctxOfEvent(event);
    if (ctx) ctx.switcherOpen = Boolean(open);
  });

  ipcMain.handle("switcher:render", (event, model) => {
    const ctx = ctxOfEvent(event);
    if (!ctx) return;
    const valid =
      model && typeof model === "object" && (Array.isArray(model.cards) || "index" in model);
    return renderSwitcher(ctx, valid ? model : null);
  });

  ipcMain.handle("chrome:panel", (event, { open }) => {
    const ctx = ctxOfEvent(event);
    if (!ctx) return;
    ctx.panelOpen = Boolean(open);
    applyLayout(ctx);
  });

  ipcMain.handle("tabmenu:show", (event, context) => {
    const ctx = ctxOfEvent(event);
    if (ctx) buildTabContextMenu(ctx, context ?? {}).popup({ window: ctx.window });
  });

  ipcMain.handle("permission:respond", (_event, { id, allow, remember }) => {
    const pending = pendingPermissions.get(id);
    if (!pending) return;
    pendingPermissions.delete(id);
    if (remember) {
      permissions?.remember(pending.origin, pending.types, Boolean(allow), pending.isPrivate);
    }
    noteMediaGrant(pending.contents, pending.types, Boolean(allow));
    pending.callback(Boolean(allow));
  });

  ipcMain.handle("permissions:list", () => permissions?.list() ?? []);
  ipcMain.handle("permissions:set", (_event, { origin, type, value }) => ({
    ok: Boolean(permissions?.set(origin, type, value ?? null)),
  }));
  ipcMain.handle("permissions:reset", (_event, { origin }) => ({
    ok: Boolean(permissions?.reset(origin)),
  }));

  ipcMain.handle("history:list", (_event, query) =>
    historyCall(
      (db) =>
        db.listHistory({
          text: typeof query?.text === "string" ? query.text.slice(0, 200) : "",
          before: Number.isFinite(query?.before) ? query.before : null,
          limit: Number.isInteger(query?.limit) ? query.limit : 100,
        }),
      [],
    ),
  );
  ipcMain.handle("history:search", (_event, { text, limit }) =>
    historyCall(
      (db) =>
        db.searchHistory(
          typeof text === "string" ? text.slice(0, 200) : "",
          Number.isInteger(limit) ? limit : 40,
        ),
      [],
    ),
  );
  ipcMain.handle("history:delete", (_event, { ids }) => {
    historyCall((db) => db.deleteVisits(ids));
  });
  ipcMain.handle("history:delete-url", (_event, { url }) => {
    if (typeof url === "string") historyCall((db) => db.deleteHistoryUrl(url));
  });
  ipcMain.handle("history:clear", (_event, range) => {
    historyCall((db) =>
      db.clearHistory({
        from: Number.isFinite(range?.from) ? range.from : 0,
        to: Number.isFinite(range?.to) ? range.to : Number.MAX_SAFE_INTEGER,
      }),
    );
  });

  ipcMain.handle("omnibox:suggest", (_event, { engine, text }) =>
    fetchSuggestions((url, init) => net.fetch(url, init), engine, text),
  );

  ipcMain.handle("menu:show", (event, items) => {
    const template = menuTemplateOf(items);
    const window = ctxOfEvent(event)?.window;
    if (!template.length || !window) return null;
    return new Promise((resolve) => {
      let chosen = null;
      const attachClicks = (entries) =>
        entries.map((entry) =>
          entry.submenu
            ? { ...entry, submenu: attachClicks(entry.submenu) }
            : entry.id !== undefined
              ? { ...entry, click: () => (chosen = entry.id) }
              : entry,
        );
      Menu.buildFromTemplate(attachClicks(template)).popup({
        window,
        // O click chega antes do fechamento; o setTimeout garante a ordem.
        callback: () => setTimeout(() => resolve(chosen), 0),
      });
    });
  });

  ipcMain.handle("update:state", () => updater?.state() ?? null);
  ipcMain.handle("update:check", () => updater?.check() ?? null);
  ipcMain.handle("update:install", () => ({ ok: Boolean(updater?.install({ reopen: true })) }));

  // Seções compartilhadas (preferências, favoritos, atalhos, guias fechadas) vêm do
  // SQLite; a sessão (guias) é a desta janela.
  ipcMain.handle("state:load", (event) => {
    if (!database) return { available: false, sections: {} };
    try {
      const sections = database.loadState();
      const windowSession = ctxOfEvent(event)?.session ?? null;
      if (windowSession) sections.session = windowSession;
      else delete sections.session;
      return { available: true, sections };
    } catch {
      return { available: false, sections: {} };
    }
  });

  ipcMain.handle("state:save", (event, sections) => {
    if (!sections || typeof sections !== "object" || Array.isArray(sections)) return { ok: false };
    // Escudo e hibernação seguem as preferências salvas.
    if (sections.prefs) applyPrefs(sections.prefs);
    if (!database) return { ok: false };
    const ctx = ctxOfEvent(event);
    const { session: windowSession, ...shared } = sections;
    try {
      if ("session" in sections) {
        if (JSON.stringify(windowSession ?? null).length > MAX_SESSION_BYTES) return { ok: false };
        if (ctx) {
          ctx.session = windowSession ?? null;
          windowStore?.update(ctx.key, { session: ctx.session });
        }
      }
      if (!Object.keys(shared).length) return { ok: true };
      const ok = database.saveState(shared);
      // As outras janelas passam a ver a mudança (tema, favoritos…).
      if (ok) broadcast("agzos:state-sync", shared, ctx);
      return { ok };
    } catch {
      return { ok: false };
    }
  });

  ipcMain.handle("key:load", () => {
    try {
      if (!safeStorage.isEncryptionAvailable()) return null;
      const blob = fs.readFileSync(keyStorePath());
      return JSON.parse(safeStorage.decryptString(blob).toString("utf8"));
    } catch {
      return null;
    }
  });

  ipcMain.handle("key:save", (_event, list) => {
    try {
      if (!safeStorage.isEncryptionAvailable()) return { ok: false };
      fs.writeFileSync(keyStorePath(), safeStorage.encryptString(JSON.stringify(list)));
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  ipcMain.handle("shell:openExternal", (_event, url) => {
    if (typeof url === "string" && /^https?:\/\//.test(url)) void shell.openExternal(url);
  });

  // --- Agzos Key: integração com o cofre de senhas (pareamento, unlock, sync) ---
  let agzosKey = null;
  const key = () => {
    if (!agzosKey) agzosKey = createAgzosKey({ userDataDir: app.getPath("userData"), safeStorage });
    return agzosKey;
  };
  // Envolve as chamadas: devolve { ok, error } em vez de rejeitar o IPC, para o renderer
  // tratar o erro (ex.: senha mestra errada) sem derrubar nada.
  const keyCall = (fn) =>
    Promise.resolve()
      .then(fn)
      .then((data) => ({ ok: true, data: data ?? null }))
      .catch((err) => ({ ok: false, error: err?.message || "key_error" }));

  ipcMain.handle("agzosKey:state", () => keyCall(() => key().state()));
  ipcMain.handle("agzosKey:pair", (_event, payload) =>
    keyCall(() => key().pair(payload?.pairingCode, payload?.deviceName)),
  );
  ipcMain.handle("agzosKey:unlock", (_event, payload) =>
    keyCall(() => key().unlock(payload?.masterPassword)),
  );
  ipcMain.handle("agzosKey:lock", () => keyCall(() => key().lock()));
  ipcMain.handle("agzosKey:list", () => keyCall(() => key().list()));
  ipcMain.handle("agzosKey:save", (_event, entry) => keyCall(() => key().save(entry)));
  ipcMain.handle("agzosKey:remove", (_event, payload) => keyCall(() => key().remove(payload?.id)));
  ipcMain.handle("agzosKey:unpair", () => keyCall(() => key().unpair()));
}

app.commandLine.appendSwitch("autoplay-policy", "user-gesture-required");

let terminals = null;
/** Preferências do terminal (4.1) que o main usa: aliases, Groq no ambiente, tema… */
let terminalConfig = { aliases: [], groqEnv: false };
/** Terminal flutuante (PiP) → janela dona: as sessões continuam sendo da janela. */
const terminalPipOwner = new Map();
const TERMINAL_PAGE = path.join(__dirname, "..", "dist", "terminal.html");

/** Janela das sessões: a casca ou o terminal flutuante dela. */
function terminalCtx(event) {
  return ctxOfEvent(event) ?? terminalPipOwner.get(event.sender.id) ?? null;
}

/** Interface do próprio Agzos (casca ou terminal flutuante), nunca uma página. */
function isAppInterface(contents) {
  return Boolean(contents) && (contexts.has(contents.id) || terminalPipOwner.has(contents.id));
}

/** Eventos das sessões vão para a casca e para o terminal flutuante, se aberto. */
function sendTerminal(ctx, channel, payload) {
  send(ctx, channel, payload);
  const pip = ctx?.terminalPip;
  if (pip && !pip.isDestroyed()) pip.webContents.send(channel, payload);
}

/** e2e no Linux sem chaveiro: a cifra básica do Chromium (nunca no app empacotado). */
function allowTestKeyring() {
  if (!app.isPackaged && process.env.AGZOS_TEST_BASIC_KEYRING === "1") {
    safeStorage.setUsePlainTextEncryption?.(true);
  }
}

let secrets = null;
function terminalSecrets() {
  allowTestKeyring();
  secrets ??= createSecrets({
    file: path.join(app.getPath("userData"), "terminal-secrets.bin"),
    safeStorage,
  });
  return secrets;
}

/** Terminais (4.0): o node-pty carrega na primeira sessão (falha vira "indisponível"). */
function terminalService() {
  terminals ??= createTerminals({
    loadPty: () => require("node-pty"),
    homedir: os.homedir(),
    // 4.1.1: pastas das CLIs de IA (~/.local/bin, npm global…) no PATH das sessões.
    env: cliEnv(),
    readCwd: cwdReader(process.platform, require("node:child_process").execFile),
    onData: (ctx, id, data) => sendTerminal(ctx, "agzos:terminal-data", { id, data }),
    onExit: (ctx, id, info) => sendTerminal(ctx, "agzos:terminal-exit", { id, ...info }),
    onCwd: (ctx, id, cwd) => sendTerminal(ctx, "agzos:terminal-cwd", { id, cwd }),
    prepare: (shell) =>
      prepareAliases(
        shell,
        terminalConfig.aliases,
        path.join(app.getPath("userData"), "terminal-init"),
      ),
    // Chaves de API só no ambiente dos shells (nunca na casca).
    extraEnv: () => {
      const env = terminalSecrets().env();
      if (terminalConfig.groqEnv && !env.GROQ_API_KEY) {
        const key = aiService().keyForTerminal();
        if (key) env.GROQ_API_KEY = key;
      }
      return env;
    },
    sshBinary: () =>
      sshBinary({ platform: process.platform, env: process.env, exists: fs.existsSync }),
  });
  return terminals;
}

/** Terminal flutuante (4.1): janela pequena sempre por cima, com as sessões da janela. */
function openTerminalPip(ctx) {
  const current = ctx.terminalPip;
  if (current && !current.isDestroyed()) {
    current.show();
    current.focus();
    return;
  }
  if (!fs.existsSync(TERMINAL_PAGE)) return;
  let bounds = null;
  try {
    bounds = fitBounds(
      database?.getMeta("terminalPipBounds"),
      screen.getAllDisplays().map((display) => display.workArea),
    );
  } catch {
    bounds = null;
  }
  const background =
    typeof terminalConfig.theme?.background === "string" &&
    /^#[0-9a-f]{6}$/i.test(terminalConfig.theme.background)
      ? terminalConfig.theme.background
      : "#0E0E0E";
  const pip = new BrowserWindow({
    title: "Terminal — Agzos",
    width: 760,
    height: 440,
    ...(bounds ?? {}),
    minWidth: 360,
    minHeight: 200,
    show: false,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    backgroundColor: background,
    ...(process.platform === "darwin" ? {} : { icon: path.join(__dirname, "icons", "icon.png") }),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  pip.setAlwaysOnTop(true, "floating");
  const id = pip.webContents.id;
  terminalPipOwner.set(id, ctx);
  ctx.terminalPip = pip;
  pip.once("ready-to-show", () => pip.show());
  let timer = null;
  const saveBounds = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!pip.isDestroyed()) database?.setMeta("terminalPipBounds", pip.getBounds());
    }, 300);
  };
  pip.on("resize", saveBounds);
  pip.on("move", saveBounds);
  pip.on("close", () => {
    // Fechada pelo usuário: a casca marca o terminal como escondido (as sessões ficam).
    if (!ctx.closingPip && !quitting) send(ctx, "agzos:terminal-pip", { open: false });
  });
  pip.on("closed", () => {
    clearTimeout(timer);
    terminalPipOwner.delete(id);
    ctx.closingPip = false;
    if (ctx.terminalPip === pip) ctx.terminalPip = null;
  });
  pip.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  pip.webContents.on("will-navigate", (event) => event.preventDefault());
  void pip.loadFile(TERMINAL_PAGE).catch(() => {});
}

function closeTerminalPip(ctx) {
  const pip = ctx?.terminalPip;
  if (!pip || pip.isDestroyed()) return;
  // O "close" pode chegar depois desta chamada: o aviso de "fechada pelo usuário" não vale.
  ctx.closingPip = true;
  pip.close();
}

// --- Arquivos locais (4.1.1): agzos-file://, navegador do terminal e "Abrir arquivo". ---

let fileTokenValue = null;
/** Token das URLs agzos-file (fica no banco: as guias restauradas continuam abrindo). */
function fileToken() {
  if (fileTokenValue) return fileTokenValue;
  let value = null;
  try {
    value = database?.getMeta("fileToken");
  } catch {
    value = null;
  }
  if (typeof value !== "string" || !/^[a-f0-9]{32}$/.test(value)) {
    value = require("node:crypto").randomBytes(16).toString("hex");
    try {
      database?.setMeta("fileToken", value);
    } catch {
      // Sem banco: vale só nesta execução.
    }
  }
  fileTokenValue = value;
  return value;
}

const fileProtocolSessions = new WeakSet();
function ensureFileProtocol(ses) {
  if (!ses || fileProtocolSessions.has(ses)) return;
  fileProtocolSessions.add(ses);
  try {
    ses.protocol.handle(FILE_SCHEME, (request) => handleFileRequest(request.url, fileToken()));
  } catch (error) {
    console.error("Agzos: agzos-file indisponível.", error?.message);
  }
}

/** Abre caminhos locais em guias novas da janela (HTML, PDF, imagem, código, qualquer um). */
function openPathsInTabs(ctx, files) {
  for (const file of files.slice(0, 20)) {
    if (typeof file !== "string" || !path.isAbsolute(file)) continue;
    send(ctx, "agzos:open-request", { url: urlForPath(file, fileToken()) });
  }
}

/**
 * Arquivos abertos pelo sistema (duplo clique, "Abrir com", arrastar para o ícone): cada um
 * numa guia da janela em foco. A janela recém-criada só ouve depois de carregar a casca.
 */
function openSystemFiles(files) {
  const valid = files.filter((file) => typeof file === "string" && path.isAbsolute(file));
  if (!valid.length) return;
  const ctx =
    lastFocused && !lastFocused.window.isDestroyed()
      ? lastFocused
      : ([...contexts.values()][0] ??
        (openSavedWindows() ? [...contexts.values()][0] : createWindow()));
  if (!ctx) return;
  const deliver = () => {
    openPathsInTabs(ctx, valid);
    if (ctx.window.isMinimized()) ctx.window.restore();
    ctx.window.show();
    ctx.window.focus();
  };
  const contents = ctx.window.webContents;
  if (contents.isLoading()) contents.once("did-finish-load", () => setTimeout(deliver, 800));
  else deliver();
}

/** Home das integrações com o sistema (os e2e usam uma pasta temporária). */
function integrationHome() {
  return (!app.isPackaged && process.env.AGZOS_TEST_HOME) || os.homedir();
}

/** e2e: instalar/desinstalar PWA sem o diálogo (nunca no app empacotado). */
function skipPwaConfirm() {
  return !app.isPackaged && process.env.AGZOS_TEST_PWA_CONFIRM === "1";
}

/** Ambiente com as pastas das CLIs de IA no PATH (terminais e detecção). */
function cliEnv() {
  return withCliPath(process.env, { platform: process.platform, home: os.homedir() });
}

function onPathOf(command, env) {
  return onPath(command, { platform: process.platform, env, exists: fs.existsSync });
}

// --- Modo agente (4.1.1): nós que rodam CLIs sem interação ou a Groq. ---

const AGENT_GROQ_SYSTEM = [
  "Você é um agente que executa uma etapa de um fluxo com vários agentes.",
  "Responda só com o resultado da etapa, direto e completo, em português.",
].join(" ");

// --- PWA (4.1.1) ---

let pwaStore = null;
/** webContents.id da guia → o que a página anunciou ({ manifest, check, documentUrl }). */
const pwaDetected = new Map();
/** id do app → janela aberta. */
const pwaWindows = new Map();
const pwaSessions = new WeakSet();
/** Mundo isolado da consulta do "Tentar instalar" (fora do 0 da página e do 999 do Electron). */
const PWA_PROBE_WORLD = 4131;

function pwaDir(id) {
  return path.join(app.getPath("userData"), "pwa", id);
}

function pwaLaunchArgs(id) {
  // Em desenvolvimento (electron .) o caminho do app vai antes do argumento.
  return [...(process.defaultApp ? [app.getAppPath()] : []), `--agzos-pwa=${id}`];
}

/** Estado do app da guia para a casca: instalável, já instalado ou nada. */
function pwaStateOf(contents) {
  const info = pwaDetected.get(contents.id);
  if (!info?.check.ok) return null;
  const installed = Boolean(pwaStore?.get(info.manifest.id));
  return { id: info.manifest.id, name: info.manifest.name, installed };
}

function emitPwa(contents) {
  const where = tabOfContents.get(contents.id);
  if (where) send(where.ctx, "agzos:pwa-state", { tabId: where.id, pwa: pwaStateOf(contents) });
}

function forgetPwa(contents) {
  if (!pwaDetected.delete(contents.id)) return;
  emitPwa(contents);
}

/**
 * Manifesto como o Chromium o vê (CDP Page.getAppManifest, 4.1.3): pega o <link> inserido
 * depois da carga e o pedido com as credenciais certas. Sem resposta (o Chromium ainda não
 * buscou, ou a guia sem debugger), busca o `manifestHref` na session da guia.
 */
async function readPwaManifest(contents, manifestHref) {
  if (contents.debugger.isAttached()) {
    try {
      const result = await contents.debugger.sendCommand("Page.getAppManifest");
      const url = typeof result?.url === "string" ? result.url : "";
      if (url && result.data && /^https?:/.test(url) && result.data.length < 512 * 1024) {
        return { url, json: JSON.parse(result.data) };
      }
    } catch {
      // Segue pela busca direta.
    }
  }
  if (!manifestHref) return null;
  try {
    const response = await contents.session.fetch(manifestHref, { credentials: "include" });
    if (!response.ok) return { url: manifestHref, json: null };
    const text = await response.text();
    return { url: manifestHref, json: text.length < 512 * 1024 ? JSON.parse(text) : null };
  } catch {
    return { url: manifestHref, json: null };
  }
}

/**
 * A página tem manifesto: lê e decide se dá para instalar. `force` (Configurações → Tentar
 * instalar) lê de novo mesmo sem mudança.
 */
async function detectPwa(contents, { manifestUrl, serviceWorker }, { force = false } = {}) {
  if (!tabOfContents.has(contents.id) || isPrivateContents(contents)) return null;
  const documentUrl = contents.getURL();
  let manifestHref = null;
  if (manifestUrl) {
    try {
      const url = new URL(manifestUrl, documentUrl);
      if (url.protocol === "https:" || url.protocol === "http:") manifestHref = url.href;
    } catch {
      manifestHref = null;
    }
  }
  if (!manifestHref && !force) return null;
  const previous = pwaDetected.get(contents.id);
  if (
    !force &&
    previous &&
    previous.documentUrl === documentUrl &&
    previous.manifestUrl === manifestHref &&
    previous.serviceWorker === serviceWorker
  ) {
    emitPwa(contents);
    return previous;
  }
  const read = await readPwaManifest(contents, manifestHref);
  if (contents.isDestroyed() || contents.getURL() !== documentUrl) return null;
  const manifestFinal = read?.url ?? manifestHref;
  const manifest = read?.json
    ? parseManifest(read.json, { manifestUrl: manifestFinal, documentUrl })
    : null;
  const check = installability(manifest, { documentUrl });
  const info = {
    manifest,
    check,
    documentUrl,
    manifestUrl: manifestHref,
    serviceWorker,
    session: contents.session,
  };
  pwaDetected.set(contents.id, info);
  emitPwa(contents);
  return info;
}

/** Configurações → "Tentar instalar este site como app": verifica a guia na hora. */
async function checkPwa(contents) {
  if (!contents || contents.isDestroyed()) return { ok: false, reason: "tab" };
  if (isPrivateContents(contents)) return { ok: false, reason: "private" };
  if (!/^https?:/.test(contents.getURL())) return { ok: false, reason: "page" };
  let found = { manifestUrl: null, serviceWorker: false };
  try {
    // Mundo isolado: a página não intercepta a consulta.
    const [result] = await contents.executeJavaScriptInIsolatedWorld(PWA_PROBE_WORLD, [
      {
        code: `(async () => {
          const link = document.querySelector('link[rel~="manifest"]');
          let sw = false;
          try {
            const c = navigator.serviceWorker;
            sw = Boolean(c && (c.controller || (await c.getRegistration())));
          } catch {}
          return { manifestUrl: link ? link.href : null, serviceWorker: sw };
        })()`,
      },
    ]);
    if (result && typeof result === "object") {
      found = {
        manifestUrl: typeof result.manifestUrl === "string" ? result.manifestUrl : null,
        serviceWorker: Boolean(result.serviceWorker),
      };
    }
  } catch {
    // Página sem acesso (erro, carregando): o Chromium ainda pode ter o manifesto.
  }
  const info = await detectPwa(contents, found, { force: true });
  if (!info) return { ok: false, reason: "tab" };
  if (!info.check.ok) return { ok: false, reason: info.check.reason };
  return {
    ok: true,
    id: info.manifest.id,
    name: info.manifest.name,
    installed: Boolean(pwaStore?.get(info.manifest.id)),
  };
}

/** Primeiro ícone do manifesto que o nativeImage consegue abrir. */
async function fetchPwaIcon(ses, icons) {
  for (const icon of iconCandidates(icons).slice(0, 6)) {
    try {
      const response = await ses.fetch(icon.src);
      if (!response.ok) continue;
      const buffer = Buffer.from(await response.arrayBuffer());
      const image = nativeImage.createFromBuffer(buffer);
      if (!image.isEmpty()) return image;
    } catch {
      // Próximo.
    }
  }
  return nativeImage.createFromPath(path.join(__dirname, "icons", "icon.png"));
}

const pngOf = (image, size) => image.resize({ width: size, height: size, quality: "best" }).toPNG();

/** Atalhos do sistema para o app. Devolve onde ficaram (para desinstalar). */
function writePwaShortcuts(record, image) {
  const dir = pwaDir(record.id);
  fs.mkdirSync(dir, { recursive: true });
  const png = path.join(dir, "icon.png");
  fs.writeFileSync(png, pngOf(image, 256));
  const home = integrationHome();
  const where = shortcutPaths({
    platform: process.platform,
    home,
    env: process.env,
    name: record.name,
    id: record.id,
  });
  const args = pwaLaunchArgs(record.id);
  const written = {};
  if (process.platform === "win32") {
    const ico = path.join(dir, "icon.ico");
    fs.writeFileSync(
      ico,
      icoFromPngs([16, 24, 32, 48, 64, 256].map((size) => ({ size, png: pngOf(image, size) }))),
    );
    for (const key of ["menu", "desktop"]) {
      try {
        fs.mkdirSync(path.dirname(where[key]), { recursive: true });
        const ok = shell.writeShortcutLink(where[key], "replace", {
          target: process.execPath,
          args: args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)).join(" "),
          icon: ico,
          iconIndex: 0,
          appUserModelId: `br.agzos.browser.pwa.${record.id}`,
          description: `${record.name} (Agzos Browser)`,
        });
        if (ok) written[key] = where[key];
      } catch {
        // Sem área de trabalho, por exemplo: segue com o outro atalho.
      }
    }
  } else if (process.platform === "darwin") {
    const bundle = where.bundle;
    const appBundle = /^(.*?\.app)\/Contents\/MacOS\//.exec(process.execPath)?.[1] ?? null;
    writeMacBundle(
      bundle,
      macBundleFiles({ id: record.id, name: record.name, appBundle, exec: process.execPath, args }),
      icnsFromPngs([32, 64, 128, 256, 512].map((size) => ({ size, png: pngOf(image, size) }))),
    );
    written.bundle = bundle;
  } else {
    fs.mkdirSync(path.dirname(where.menu), { recursive: true });
    fs.writeFileSync(
      where.menu,
      linuxDesktopEntry({
        name: record.name,
        exec: process.env.APPIMAGE || process.execPath,
        args,
        icon: png,
        url: record.origin,
      }),
      { mode: 0o755 },
    );
    written.menu = where.menu;
  }
  return written;
}

function removePwaShortcuts(record) {
  for (const file of Object.values(record.shortcuts ?? {})) {
    if (typeof file !== "string" || !file) continue;
    try {
      fs.rmSync(file, { recursive: true, force: true });
    } catch {
      // Já saiu.
    }
  }
}

async function installPwa(ctx, tabId) {
  const contents = tabContents(ctx, tabId);
  if (!contents) return { ok: false, error: "not-installable" };
  // Sem o aviso da página (ou com um antigo): verifica na hora antes de desistir.
  if (!pwaDetected.get(contents.id)?.check.ok) await checkPwa(contents);
  const info = pwaDetected.get(contents.id);
  if (!info?.check.ok) {
    return { ok: false, error: "not-installable", reason: info?.check.reason ?? "manifest" };
  }
  const { manifest } = info;
  if (pwaStore.get(manifest.id)) {
    openPwaWindow(manifest.id);
    return { ok: true, id: manifest.id, opened: true };
  }
  const image = await fetchPwaIcon(info.session, manifest.icons);
  if (!skipPwaConfirm()) {
    const { response } = await dialog.showMessageBox(ctx.window, {
      type: "none",
      icon: image.resize({ width: 64, height: 64 }),
      buttons: ["Instalar", "Cancelar"],
      defaultId: 0,
      cancelId: 1,
      title: "Instalar app",
      message: `Instalar ${manifest.name}?`,
      detail:
        `${manifest.origin}\n\nO app abre em janela própria, sem a barra de guias, e ganha um ` +
        "ícone no sistema. Login, zoom e permissões dele ficam separados das guias.",
    });
    if (response !== 0) return { ok: false, error: "cancelled" };
  }
  const record = {
    id: manifest.id,
    name: manifest.name,
    startUrl: manifest.startUrl,
    scope: manifest.scope,
    origin: manifest.origin,
    themeColor: manifest.themeColor,
    backgroundColor: manifest.backgroundColor,
    display: manifest.display,
    installedAt: Date.now(),
    shortcuts: {},
    bounds: null,
    zoom: 0,
  };
  try {
    record.shortcuts = writePwaShortcuts(record, image);
  } catch (error) {
    console.error("Agzos: atalho do app não gravado.", error?.message);
  }
  pwaStore.put(record);
  broadcast("agzos:pwa-changed", {});
  emitPwa(contents);
  openPwaWindow(record.id);
  return { ok: true, id: record.id };
}

async function uninstallPwa(id, { confirm = true, parent = null } = {}) {
  const record = pwaStore?.get(id);
  if (!record) return { ok: false, error: "missing" };
  if (confirm && !skipPwaConfirm()) {
    const options = {
      type: "question",
      buttons: ["Desinstalar", "Cancelar"],
      defaultId: 0,
      cancelId: 1,
      title: "Desinstalar app",
      message: `Desinstalar ${record.name}?`,
      detail: "O atalho do sistema e os dados do app (login, cache, permissões) saem.",
    };
    const { response } = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options);
    if (response !== 0) return { ok: false, error: "cancelled" };
  }
  const win = pwaWindows.get(id);
  if (win && !win.isDestroyed()) win.destroy();
  pwaWindows.delete(id);
  removePwaShortcuts(record);
  try {
    fs.rmSync(pwaDir(id), { recursive: true, force: true });
  } catch {
    // Ícone preso: sai na próxima.
  }
  const ses = session.fromPartition(`persist:pwa-${id}`);
  await ses.clearStorageData().catch(() => {});
  await ses.clearCache().catch(() => {});
  try {
    database?.deleteSiteSettings(record.origin, `pwa:${id}:`);
  } catch {
    // Sem banco.
  }
  pwaStore.remove(id);
  broadcast("agzos:pwa-changed", {});
  for (const ctx of contexts.values()) {
    for (const { view } of ctx.views.values()) {
      if (!view.webContents.isDestroyed() && pwaDetected.has(view.webContents.id)) {
        emitPwa(view.webContents);
      }
    }
  }
  return { ok: true };
}

/** Permissões do app: salvas à parte (pwa:<id>:permission:<tipo>), perguntadas na janela dele. */
function wirePwaSession(ses, id) {
  if (pwaSessions.has(ses)) return;
  pwaSessions.add(ses);
  const keyOf = (type) => `pwa:${id}:permission:${type}`;
  const saved = (origin, type) => {
    try {
      return database?.getSiteSetting(origin, keyOf(type)) ?? null;
    } catch {
      return null;
    }
  };
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    const types = permissionTypesOf(permission, details);
    if (!types) {
      callback(AUTO_ALLOWED.includes(permission));
      return;
    }
    const origin = requestOrigin(details);
    if (!origin) {
      callback(false);
      return;
    }
    const values = types.map((type) => saved(origin, type));
    if (values.includes("block")) return callback(false);
    if (values.every((value) => value === "allow")) return callback(true);
    const parent = BrowserWindow.fromWebContents(contents);
    const labels = {
      camera: "câmera",
      microphone: "microfone",
      notifications: "notificações",
      geolocation: "localização",
      "clipboard-read": "área de transferência",
      midi: "MIDI",
    };
    const options = {
      type: "question",
      buttons: ["Permitir", "Bloquear"],
      defaultId: 0,
      cancelId: 1,
      title: "Permissão",
      message: `${new URL(origin).host} quer usar: ${types.map((type) => labels[type] ?? type).join(", ")}`,
      checkboxLabel: "Lembrar a decisão neste app",
      checkboxChecked: true,
    };
    const asking = parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options);
    void asking.then(({ response, checkboxChecked }) => {
      const allow = response === 0;
      if (checkboxChecked) {
        for (const type of types) {
          try {
            database?.setSiteSetting(origin, keyOf(type), allow ? "allow" : "block");
          } catch {
            // Vale só agora.
          }
        }
      }
      callback(allow);
    });
  });
  ses.setPermissionCheckHandler((_contents, permission, requestingOrigin, details) => {
    const types = checkTypesOf(permission, details);
    if (!types) return true;
    const origin = requestOrigin({ ...details, requestingOrigin });
    return !origin || !types.some((type) => saved(origin, type) === "block");
  });
}

/** Abre um endereço numa guia do navegador (abre uma janela se só houver apps). */
function openInBrowser(url) {
  const ctx = lastFocused ?? [...contexts.values()][0] ?? null;
  if (ctx) {
    send(ctx, "agzos:open-request", { url });
    ctx.window.show();
    ctx.window.focus();
    return;
  }
  const created = openSavedWindows() ? [...contexts.values()][0] : createWindow();
  created?.window.webContents.once("did-finish-load", () =>
    setTimeout(() => send(created, "agzos:open-request", { url }), 800),
  );
}

function openPwaWindow(id, url = null) {
  const record = pwaStore?.get(id);
  if (!record) return false;
  const current = pwaWindows.get(id);
  if (current && !current.isDestroyed()) {
    if (url) void current.webContents.loadURL(url).catch(() => {});
    if (current.isMinimized()) current.restore();
    current.show();
    current.focus();
    return true;
  }
  const ses = session.fromPartition(`persist:pwa-${id}`);
  wirePwaSession(ses, id);
  let bounds = null;
  try {
    bounds = fitBounds(
      record.bounds,
      screen.getAllDisplays().map((display) => display.workArea),
    );
  } catch {
    bounds = null;
  }
  const icon = path.join(pwaDir(id), "icon.png");
  const win = new BrowserWindow({
    title: record.name,
    width: 1100,
    height: 760,
    ...(bounds ?? {}),
    minWidth: 320,
    minHeight: 240,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: record.backgroundColor ?? "#FFFFFF",
    ...(process.platform !== "darwin" && fs.existsSync(icon) ? { icon } : {}),
    webPreferences: {
      session: ses,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  if (process.platform === "win32") {
    try {
      win.setAppDetails({
        appId: `br.agzos.browser.pwa.${id}`,
        appIconPath: path.join(pwaDir(id), "icon.ico"),
        relaunchCommand: [process.execPath, ...pwaLaunchArgs(id)]
          .map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg))
          .join(" "),
        relaunchDisplayName: record.name,
      });
    } catch {
      // Versões sem a API.
    }
  }
  pwaWindows.set(id, win);
  const contents = win.webContents;
  applyChromeIdentity(contents);
  win.once("ready-to-show", () => win.show());
  // Sem tela em branco se a página demorar.
  setTimeout(() => !win.isDestroyed() && !win.isVisible() && win.show(), 3000).unref?.();
  let timer = null;
  const saveBounds = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!win.isDestroyed() && !win.isMinimized() && !win.isFullScreen()) {
        pwaStore?.update(id, { bounds: win.getNormalBounds() });
      }
    }, 400);
  };
  win.on("resize", saveBounds);
  win.on("move", saveBounds);
  win.on("closed", () => {
    clearTimeout(timer);
    if (pwaWindows.get(id) === win) pwaWindows.delete(id);
  });
  // Zoom do app (isolado das guias do mesmo site).
  const setZoom = (level) => {
    contents.setZoomLevel(level);
    pwaStore?.update(id, { zoom: level });
  };
  contents.on("did-navigate", () => contents.setZoomLevel(pwaStore?.get(id)?.zoom ?? 0));
  contents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const mod = process.platform === "darwin" ? input.meta : input.control;
    const key = input.key.toLowerCase();
    const run = (work) => {
      event.preventDefault();
      work();
    };
    if ((mod && key === "r") || key === "f5") run(() => contents.reload());
    else if (input.alt && key === "arrowleft") run(() => contents.navigationHistory.goBack());
    else if (input.alt && key === "arrowright") run(() => contents.navigationHistory.goForward());
    else if (mod && (key === "=" || key === "+"))
      run(() => setZoom(Math.min(8, contents.getZoomLevel() + 0.5)));
    else if (mod && key === "-") run(() => setZoom(Math.max(-8, contents.getZoomLevel() - 0.5)));
    else if (mod && key === "0") run(() => setZoom(0));
    else if (key === "f11") run(() => win.setFullScreen(!win.isFullScreen()));
  });
  // Links para fora do app vão para o navegador; popups (login OAuth) abrem como popup.
  contents.setWindowOpenHandler(({ url, features, disposition }) => {
    if (!/^https?:/i.test(url)) return { action: "deny" };
    if (features || disposition === "new-window") {
      return {
        action: "allow",
        overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { session: ses } },
      };
    }
    if (scopeContains(record.scope, url)) void contents.loadURL(url).catch(() => {});
    else openInBrowser(url);
    return { action: "deny" };
  });
  contents.on("context-menu", (_event, params) => {
    const items = [];
    if (params.linkURL && /^https?:/i.test(params.linkURL)) {
      items.push(
        { label: "Abrir link no Agzos Browser", click: () => openInBrowser(params.linkURL) },
        { label: "Copiar endereço do link", click: () => clipboard.writeText(params.linkURL) },
        { type: "separator" },
      );
    }
    if (params.isEditable) {
      items.push(
        { role: "cut", label: "Recortar" },
        { role: "copy", label: "Copiar" },
        { role: "paste", label: "Colar" },
        { type: "separator" },
      );
    } else if (params.selectionText) {
      items.push({ role: "copy", label: "Copiar" }, { type: "separator" });
    }
    items.push(
      {
        label: "Voltar",
        enabled: contents.navigationHistory.canGoBack(),
        click: () => contents.navigationHistory.goBack(),
      },
      {
        label: "Avançar",
        enabled: contents.navigationHistory.canGoForward(),
        click: () => contents.navigationHistory.goForward(),
      },
      { label: "Recarregar", click: () => contents.reload() },
      { type: "separator" },
      { label: "Copiar endereço da página", click: () => clipboard.writeText(contents.getURL()) },
      { label: "Abrir no Agzos Browser", click: () => openInBrowser(contents.getURL()) },
      { type: "separator" },
      {
        label: `Desinstalar ${record.name}…`,
        click: () => void uninstallPwa(id, { parent: win }),
      },
    );
    Menu.buildFromTemplate(items).popup({ window: win });
  });
  void contents.loadURL(url ?? record.startUrl).catch(() => {});
  return true;
}

function pwaIconDataUrl(id) {
  try {
    const image = nativeImage.createFromPath(path.join(pwaDir(id), "icon.png"));
    return image.isEmpty() ? null : image.resize({ width: 48, height: 48 }).toDataURL();
  } catch {
    return null;
  }
}

let ai = null;
/** Serviço da IA, criado na primeira chamada (depois do ready: safeStorage e banco). */
function aiService() {
  // A API de teste (servidor local dos e2e) só vale fora do app empacotado.
  const testUrl = app.isPackaged ? null : process.env.AGZOS_GROQ_BASE_URL;
  allowTestKeyring();
  ai ??= createAi({
    userDataDir: app.getPath("userData"),
    safeStorage,
    fetch: (url, init) => net.fetch(url, init),
    database,
    ...(testUrl ? { baseUrl: testUrl } : {}),
  });
  return ai;
}

app.on("web-contents-created", (_event, contents) => {
  // Antes da primeira navegação de qualquer guia ou popup (inclusive OAuth).
  applyChromeIdentity(contents);
  if (!app.isPackaged) return;
  contents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const key = input.key.toLowerCase();
    if (
      key === "f12" ||
      ((input.control || input.meta) && input.shift && ["i", "j", "c"].includes(key))
    ) {
      event.preventDefault();
    }
  });
  contents.on("devtools-opened", () => contents.closeDevTools());
});

function downloadsDir() {
  return process.env.AGZOS_DOWNLOADS_DIR || app.getPath("downloads");
}

function shieldConfigOf(prefs) {
  return {
    enabled: prefs?.shield !== false,
    pausedHosts: Array.isArray(prefs?.pausedHosts) ? prefs.pausedHosts : [],
  };
}

async function fetchText(url) {
  const response = await net.fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

function startServices() {
  downloads = createDownloadManager({
    database,
    downloadsDir,
    emit: (record) => broadcast("agzos:download", record),
    isPrivateSession: (ses) => ses === privateSession(),
  });
  adblock = createAdblock({
    userDataDir: app.getPath("userData"),
    database,
    fetchText,
    lists: listsFromEnv(process.env.AGZOS_FILTER_LISTS),
    // O adblock conta por webContents.id; a casca conhece o id da guia.
    emitPage: (contentsId, info) => {
      const where = tabOfContents.get(contentsId);
      if (where) send(where.ctx, "agzos:tab-event", { type: "blocked", id: where.id, ...info });
    },
    emitStats: (stats) => broadcast("agzos:adblock-stats", stats),
    onEnginesChanged: resetScriptlets,
  });
  try {
    // Escudo e hibernação já nascem com a configuração salva, antes da primeira aba.
    applyPrefs(database?.loadState().prefs);
  } catch {
    // Sem estado salvo: escudo ligado, nenhum site pausado.
  }
  adblock.start();
  permissions = createPermissions({ database });

  // AGZOS_UPDATE_URL troca o feed (testes); "off" desliga. Fora do pacote (dev, e2e) só
  // verifica com o feed definido, e nunca sozinho.
  const feed = process.env.AGZOS_UPDATE_URL;
  if (feed !== "off" && (app.isPackaged || feed)) {
    updater = createUpdater({
      feedUrl: feed || DEFAULT_FEED,
      currentVersion: app.getVersion(),
      installDir: process.env.AGZOS_UPDATE_INSTALL_DIR || null,
      // Testes: o pacote falso não tem Electron; o instalador roda no Electron atual.
      runner: process.env.AGZOS_UPDATE_INSTALL_DIR ? process.execPath : null,
      workDir: path.join(app.getPath("userData"), "atualizacoes"),
      fetchImpl: (url, init) => net.fetch(url, init),
      emit: (state) => broadcast("agzos:update", state),
      quit: () => app.quit(),
      log: (message) => console.log(`Agzos: ${message}`),
    });
    updater.start({ auto: app.isPackaged });
  }
}

/**
 * A versão em execução fica em meta:appVersion. Se ela subiu desde o último início, o app
 * foi atualizado (automática ou manualmente). Até a 1.5.0 a versão não era gravada: um
 * perfil que já tinha estado conta como atualização vinda de uma versão desconhecida.
 */
function detectUpdate() {
  if (!database) return null;
  const current = app.getVersion();
  let previous = null;
  let hadState = false;
  try {
    previous = database.getMeta("appVersion");
    hadState = "version" in database.loadState();
    if (previous !== current) database.setMeta("appVersion", current);
  } catch (error) {
    console.error("Agzos: não foi possível conferir a versão anterior.", error);
    return null;
  }
  if (typeof previous === "string") {
    return compareVersions(current, previous) > 0 ? { from: previous, to: current } : null;
  }
  return hadState ? { from: null, to: current } : null;
}

function applyPrefs(prefs) {
  applyShieldConfig(prefs);
  hibernateConfig = hibernateConfigOf(prefs, HIBERNATE_OVERRIDE);
  gxControl.configure(prefs);
}

function openStateDatabase() {
  try {
    database = openDatabase(path.join(app.getPath("userData"), "agzos.db"));
  } catch (error) {
    // Sem banco a casca cai no localStorage (ver persistence/store.ts).
    console.error("Agzos: não foi possível abrir o banco local.", error);
    database = null;
  }
}

// --- Barra de menus do Mac: o lugar de "Preferências…" (⌘,) e de Editar (⌘C/⌘V). ---

/** Comando da casca (commands.ts) na janela em foco; abre uma janela se não houver. */
function runInFocusedWindow(command) {
  const ctx = contexts.get(BrowserWindow.getFocusedWindow()?.webContents.id ?? -1) ?? lastFocused;
  if (!ctx) {
    if (!openSavedWindows()) createWindow();
    return;
  }
  send(ctx, "agzos:tabmenu-action", { action: command, tabId: null });
}

/** Página da guia ativa da janela em foco (Salvar como, Imprimir). */
function focusedPageContents() {
  const ctx = contexts.get(BrowserWindow.getFocusedWindow()?.webContents.id ?? -1) ?? lastFocused;
  return activeViewEntry(ctx)?.view.webContents ?? null;
}

function macMenuTemplate() {
  const command = (label, id, accelerator, extra = {}) => ({
    label,
    ...(accelerator ? { accelerator } : {}),
    ...extra,
    click: () => runInFocusedWindow(id),
  });
  const pageAction = (label, accelerator, work) => ({
    label,
    accelerator,
    click: () => {
      const contents = focusedPageContents();
      if (contents && !contents.isDestroyed()) work(contents);
    },
  });
  return [
    {
      label: "Agzos Browser",
      submenu: [
        { role: "about", label: "Sobre o Agzos Browser" },
        command("Novidades desta versão", "help.whats-new"),
        { type: "separator" },
        command("Configurações…", "settings.open", "Cmd+,"),
        { type: "separator" },
        { role: "services", label: "Serviços" },
        { type: "separator" },
        { role: "hide", label: "Ocultar Agzos Browser" },
        { role: "hideOthers", label: "Ocultar outros" },
        { role: "unhide", label: "Mostrar tudo" },
        { type: "separator" },
        { role: "quit", label: "Sair do Agzos Browser" },
      ],
    },
    {
      label: "Arquivo",
      submenu: [
        command("Nova guia", "tab.new", "Cmd+T"),
        command("Abrir arquivo…", "file.open", "Cmd+O"),
        {
          label: "Nova janela",
          accelerator: "Cmd+N",
          click: () => {
            const ctx = lastFocused;
            if (ctx) send(ctx, "agzos:tabmenu-action", { action: "window.new", tabId: null });
            else createWindow();
          },
        },
        command("Nova guia anônima", "tab.new-private", "Shift+Cmd+N"),
        command("Nova Session Tab", "tab.new-session", "Alt+Cmd+N"),
        command("Reabrir guia fechada", "tab.reopen-closed", "Shift+Cmd+T"),
        { type: "separator" },
        command("Abrir endereço…", "omnibox.focus", "Cmd+L"),
        { type: "separator" },
        command("Fechar guia", "tab.close", "Cmd+W"),
        { role: "close", label: "Fechar janela", accelerator: "Shift+Cmd+W" },
        { type: "separator" },
        pageAction("Salvar página como…", "Cmd+S", (contents) =>
          saveAs(contents, contents.getURL()),
        ),
        pageAction("Imprimir…", "Cmd+P", (contents) => contents.print()),
      ],
    },
    {
      label: "Editar",
      submenu: [
        { role: "undo", label: "Desfazer" },
        { role: "redo", label: "Refazer" },
        { type: "separator" },
        { role: "cut", label: "Recortar" },
        { role: "copy", label: "Copiar" },
        { role: "paste", label: "Colar" },
        { role: "pasteAndMatchStyle", label: "Colar sem formatação" },
        { role: "delete", label: "Apagar" },
        { role: "selectAll", label: "Selecionar tudo" },
        { type: "separator" },
        command("Buscar na página…", "page.find", "Cmd+F"),
      ],
    },
    {
      label: "Visualizar",
      submenu: [
        command("Recarregar", "tab.reload", "Cmd+R"),
        command("Recarregar sem cache", "tab.reload-hard", "Shift+Cmd+R"),
        { type: "separator" },
        command("Tamanho padrão", "zoom.reset", "Cmd+0"),
        command("Aumentar zoom", "zoom.in", "Cmd+Plus"),
        command("Diminuir zoom", "zoom.out", "Cmd+-"),
        { type: "separator" },
        command("Picture-in-picture", "page.pip", "Shift+Cmd+P"),
        command("Agzos AI", "ai.toggle", "Shift+Cmd+A"),
        command("Terminal", "terminal.toggle", "Alt+Cmd+T"),
        command("Modo leitura", "page.reader", "Alt+Cmd+R"),
        command("Notas desta página", "notes.toggle", "Shift+Cmd+M"),
        command("Mira de elemento", "page.inspect", "Shift+Cmd+C"),
        command("Capturar tela…", "page.capture", "Shift+Cmd+S"),
        command("Portas em uso", "ports.open"),
        command("API Scratchpad", "scratchpad.open"),
        command("Mostrar/ocultar barra de favoritos", "bookmarks.toggle-bar", "Shift+Cmd+B"),
        command("Guias na vertical", "tabs.vertical"),
        command("Guias na horizontal", "tabs.horizontal"),
        { type: "separator" },
        { role: "togglefullscreen", label: "Tela cheia" },
      ],
    },
    {
      label: "Histórico",
      submenu: [
        command("Voltar", "nav.back", "Cmd+["),
        command("Avançar", "nav.forward", "Cmd+]"),
        { type: "separator" },
        command("Mostrar todo o histórico", "history.open", "Cmd+Y"),
      ],
    },
    {
      label: "Favoritos",
      submenu: [
        command("Adicionar aos favoritos", "page.favorite", "Cmd+D"),
        command("Adicionar todas as guias…", "tabs.bookmark-all", "Shift+Cmd+D"),
        { type: "separator" },
        command("Gerenciar favoritos", "bookmarks.manager", "Shift+Cmd+O"),
      ],
    },
    {
      label: "Janela",
      submenu: [
        { role: "minimize", label: "Minimizar" },
        { role: "zoom", label: "Zoom" },
        { type: "separator" },
        command("Próxima guia", "tab.next", "Cmd+Alt+Right"),
        command("Guia anterior", "tab.previous", "Cmd+Alt+Left"),
        command("Mover guia para nova janela", "tab.move-to-window"),
        command("Hibernar outras guias", "tabs.hibernate-others"),
        { type: "separator" },
        command("Downloads", "downloads.toggle", "Cmd+J"),
        { type: "separator" },
        { role: "front", label: "Trazer tudo para a frente" },
      ],
    },
    {
      role: "help",
      label: "Ajuda",
      submenu: [
        command("Novidades desta versão", "help.whats-new"),
        command("Atalhos de teclado", "settings.open"),
        {
          label: "Site do Agzos",
          click: () => void shell.openExternal("https://agzosagency.com.br/"),
        },
      ],
    },
  ];
}

/** Abre as janelas salvas que ainda não estão abertas (início do app, Dock do Mac). */
function openSavedWindows({ safe = false } = {}) {
  const open = new Set([...contexts.values()].map((ctx) => ctx.key));
  const records = (windowStore?.list() ?? []).filter((record) => !open.has(record.key));
  for (const record of records) {
    createWindow({ record: safe ? { ...record, session: safeSession(record.session) } : record });
  }
  return records.length;
}

app.whenReady().then(() => {
  // Mac: barra de menus completa (Editar é o que faz ⌘C/⌘V funcionarem nos campos).
  // Windows e Linux: sem barra; o "⋯" da casca faz esse papel.
  if (process.platform === "darwin") {
    Menu.setApplicationMenu(Menu.buildFromTemplate(macMenuTemplate()));
    app.setAboutPanelOptions({
      applicationName: "Agzos Browser",
      applicationVersion: app.getVersion(),
      copyright: "Agzos",
    });
  } else if (!isDevelopment) Menu.setApplicationMenu(null);

  openStateDatabase();
  updatedFrom = detectUpdate();
  // Saída dos painéis: a anterior explica um login pedido de novo; esta começa "suja" até
  // os painéis descarregarem ao sair.
  previousPanelExit = database?.getMeta("sidePanelExit") ?? null;
  database?.setMeta("sidePanelExit", { clean: false, at: Date.now(), apps: [] });
  // Cookies e storage em disco de tempos em tempos (uma queda não leva a sessão junto).
  setInterval(() => {
    if (![...contexts.values()].some((ctx) => ctx.sidePanels.size)) return;
    try {
      session.defaultSession.flushStorageData();
    } catch {
      // Sessão ainda não pronta.
    }
  }, 60_000).unref();
  if (database) {
    windowStore = createWindowStore({ database });
    const previous = windowStore.beginRun();
    removeOrphanSessionPartitions(windowStore.load());
    startup = { ...previous, restoredWindows: 0 };
    // Passado um minuto aberto, um crash não é mais "logo ao abrir".
    setTimeout(
      () => windowStore?.markStable(),
      Number(process.env.AGZOS_STABLE_AFTER_MS) || STABLE_AFTER_MS,
    ).unref();
  }
  startServices();
  registerIpc();
  startExtensions();
  startWidevine();
  pwaStore = createPwaStore({ database });
  // Atalho de um PWA instalado: só a janela do app (as janelas do navegador continuam
  // salvas para a próxima vez que o navegador abrir).
  const launchPwa = pwaArgOf(process.argv);
  if (launchPwa && openPwaWindow(launchPwa)) {
    startup.restoredWindows = 0;
  } else {
    // Modo seguro vale só para a restauração do início (não para o Dock do Mac depois).
    startup.restoredWindows = openSavedWindows({ safe: startup.early });
    if (!contexts.size) createWindow();
  }
  startup = { ...startup, early: startup.early && startup.restoredWindows > 0 };
  if (!launchPwa) {
    openSystemFiles([...pendingSystemFiles, ...filesOfArgv(process.argv)]);
    pendingSystemFiles.length = 0;
  }
  setInterval(
    () => void checkHibernation(),
    Number(process.env.AGZOS_HIBERNATE_CHECK_MS) || CHECK_INTERVAL_MS,
  ).unref();
  // Segunda execução (atalho de PWA, ícone do app clicado de novo): vem para esta.
  app.on("second-instance", (_event, argv, workingDirectory) => {
    const id = pwaArgOf(argv);
    if (id && openPwaWindow(id)) return;
    const files = filesOfArgv(argv, { cwd: workingDirectory });
    if (files.length) {
      openSystemFiles(files);
      return;
    }
    const ctx = lastFocused ?? [...contexts.values()][0] ?? null;
    if (ctx && !ctx.window.isDestroyed()) {
      if (ctx.window.isMinimized()) ctx.window.restore();
      ctx.window.show();
      ctx.window.focus();
    } else if (!openSavedWindows()) createWindow();
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && !openSavedWindows()) createWindow();
  });
});

// Certificado inválido: a página falha com a tela de erro da casca, que oferece continuar.
app.on("certificate-error", (event, contents, url, error, certificate, callback, isMainFrame) => {
  const key = certificateKey(url, certificate?.fingerprint);
  if (key && allowedCertificates.has(key)) {
    event.preventDefault();
    callback(true);
    return;
  }
  if (isMainFrame && key && contents && tabOfContents.has(contents.id)) {
    lastCertificateError.set(contents.id, key);
  }
  callback(false);
});

let releasingPanels = null;
app.on("before-quit", (event) => {
  // Primeiro os painéis descarregam e o storage grava; depois a saída segue de novo.
  if (anyUnreleasedPanels()) {
    event.preventDefault();
    releasingPanels ??= releaseSidePanels([...contexts.values()]).finally(() => app.quit());
    return;
  }
  quitting = true;
  terminals?.killAll();
  downloads?.cancelAll();
  updater?.stop();
  // Atualização já baixada entra ao fechar (como no Chrome); abre na versão nova.
  try {
    updater?.installOnQuit();
  } catch (error) {
    console.error("Agzos: não foi possível instalar a atualização.", error);
  }
});

app.on("will-quit", () => {
  // 4.5: nenhum túnel sobrevive ao app.
  tunnels.stopAll();
  // Saída normal: janelas gravadas e o marcador de execução sai.
  try {
    windowStore?.endRun();
  } catch (error) {
    console.error("Agzos: não foi possível gravar as janelas.", error);
  }
  adblock?.close();
  database?.close();
  database = null;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

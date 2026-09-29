const {
  app,
  BrowserWindow,
  WebContentsView,
  Menu,
  session,
  clipboard,
  ipcMain,
  shell,
  safeStorage,
  net,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { openDatabase } = require("./db.cjs");
const { createAdblock, listsFromEnv, COLLECT_DOM_SOURCE } = require("./adblock.cjs");
const { createDownloadManager } = require("./downloads.cjs");
const { nextZoom, zoomHostOf } = require("./zoom.cjs");

const DUCK_AI_URL = "https://duck.ai/chat";
const PRIVATE_PARTITION = "agzos-anonima";
const HIDDEN_RECT = { x: 0, y: 0, width: 0, height: 0 };
const TAB_PRELOAD = path.join(__dirname, "tab-preload.cjs");

// Exceção não tratada no main vira log: o diálogo padrão do Electron é modal e, na
// saída do app, seguraria o processo aberto.
process.on("uncaughtException", (error) => {
  console.error("Agzos: erro inesperado no processo principal.", error);
});

// Testes e2e isolam o perfil numa pasta temporária.
if (process.env.AGZOS_USER_DATA) app.setPath("userData", process.env.AGZOS_USER_DATA);

const isDevelopment = process.argv.some((argument) => argument.startsWith("--dev-url="));
const developmentUrl = process.argv
  .find((argument) => argument.startsWith("--dev-url="))
  ?.slice("--dev-url=".length);

const views = new Map();
const pendingPermissions = new Map();
const rememberedMedia = new Map();
const crashedViews = new Set();
const rejectedLoginViews = new Set();
let mainWindow = null;
let activeTabId = null;
let lastRect = null;
let panelOpen = false;
let fullscreenActive = false;
let permissionSeq = 0;
let database = null;
let adblock = null;
let downloads = null;
// webContents.id → id da aba, para saber quem fez cada requisição.
const tabIdByContents = new Map();
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
    if (contents && mainWindow && contents === mainWindow.webContents) return null;
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
      tabId: alive ? tabIdByContents.get(contents.id) : undefined,
    });
  } catch {
    return null;
  }
}

// Navegar até um arquivo não troca a página (como no Chrome): avisa a casca para tirar a
// URL do download do histórico da aba; senão ela baixaria de novo ao restaurar a sessão.
function notifyDownloadNavigation(item, contents) {
  if (!contents || contents.isDestroyed()) return;
  const id = tabIdByContents.get(contents.id);
  if (id == null) return;
  const urls = item.getURLChain();
  // Ctrl+S na própria página: a página continua sendo essa URL.
  if (urls.includes(contents.getURL())) return;
  sendToChrome("agzos:tab-event", { type: "download-navigation", id, urls });
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
  // Scriptlets do adblock no início de cada página (ver tab-preload.cjs).
  try {
    ses.registerPreloadScript({ type: "frame", id: "agzos-adblock", filePath: TAB_PRELOAD });
  } catch {
    // Session sem suporte (não deveria acontecer no Electron 44): segue sem scriptlets.
  }
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

function sendToChrome(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function isWebUrl(url) {
  if (url.startsWith("view-source:")) return isWebUrl(url.slice("view-source:".length));
  return url.startsWith("http://") || url.startsWith("https://") || url.startsWith("file://");
}

function fullRect() {
  const [width, height] = mainWindow.getContentSize();
  return { x: 0, y: 0, width, height };
}

function applyLayout() {
  if (fullscreenActive) return;
  for (const [id, entry] of views) {
    const active =
      id === activeTabId && !panelOpen && !crashedViews.has(id) && !rejectedLoginViews.has(id);
    const rect = active && lastRect ? lastRect : HIDDEN_RECT;
    entry.view.setBounds(rect);
  }
}

function notifyTabState(id) {
  const entry = views.get(id);
  if (!entry || entry.view.webContents.isDestroyed()) return;
  const contents = entry.view.webContents;
  crashedViews.delete(id);
  const url = contents.getURL();
  const rejected = isGoogleRejectedUrl(url);
  if (rejected !== rejectedLoginViews.has(id)) {
    if (rejected) rejectedLoginViews.add(id);
    else rejectedLoginViews.delete(id);
    applyLayout();
    sendToChrome("agzos:tab-event", {
      type: "login-rejected",
      id,
      rejected,
      continueUrl: rejected ? rejectedContinueUrl(url) : null,
    });
  }
  sendToChrome("agzos:tab-event", {
    type: "tab-updated",
    id,
    url,
    title: contents.getTitle(),
    canBack: contents.navigationHistory.canGoBack(),
    canForward: contents.navigationHistory.canGoForward(),
  });
}

function openInNewTab(url) {
  sendToChrome("agzos:open-request", { url });
}

/** Download que abre o diálogo nativo "Salvar como" (Ctrl+S e menus "Salvar … como"). */
function saveAs(contents, url) {
  if (!isWebUrl(url) || url.startsWith("view-source:")) return;
  downloads?.askNext(contents);
  contents.downloadURL(url);
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
        openInNewTab(DUCK_AI_URL);
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
      { label: "Abrir link em nova guia", click: () => openInNewTab(params.linkURL) },
      { label: "Salvar link como…", click: () => saveAs(contents, params.linkURL) },
      { label: "Copiar endereço do link", click: () => clipboard.writeText(params.linkURL) },
    );
  }

  if (params.mediaType === "image" && isWebUrl(params.srcURL)) {
    template.push(
      { type: "separator" },
      { label: "Abrir imagem em nova guia", click: () => openInNewTab(params.srcURL) },
      { label: "Salvar imagem como…", click: () => saveAs(contents, params.srcURL) },
      { label: "Copiar imagem", click: () => contents.copyImageAt(params.x, params.y) },
    );
  }

  template.push(
    { type: "separator" },
    {
      label: "Exibir código-fonte da página",
      accelerator: "CmdOrCtrl+U",
      click: () => openInNewTab(`view-source:${contents.getURL()}`),
    },
  );

  if (isDevelopment) {
    template.push({ label: "Inspecionar", click: () => contents.openDevTools({ mode: "split" }) });
  }

  return Menu.buildFromTemplate(template);
}

function buildTabContextMenu(context) {
  const { kind, tabId, pinned, muted, audio, hasClosed, orientation, url } = context;
  const action = (id, label, options = {}) => ({
    label,
    ...options,
    click: () => sendToChrome("agzos:tabmenu-action", { action: id, tabId }),
  });

  if (kind === "strip") {
    return Menu.buildFromTemplate([
      action("tab.new", "Nova guia", { accelerator: "CmdOrCtrl+T" }),
      action("tab.reopen-closed", "Reabrir guia fechada", {
        accelerator: "CmdOrCtrl+Shift+T",
        enabled: Boolean(hasClosed),
      }),
      { type: "separator" },
      orientation === "vertical"
        ? action("tabs.horizontal", "Mostrar guias horizontalmente")
        : action("tabs.vertical", "Mostrar guias verticalmente"),
    ]);
  }

  const items = [
    action("tab.new-right", "Nova guia à direita"),
    action("tab.reopen-closed", "Reabrir guia fechada", {
      accelerator: "CmdOrCtrl+Shift+T",
      enabled: Boolean(hasClosed),
    }),
    action("tab.duplicate", "Duplicar"),
    { type: "separator" },
    action("tab.toggle-pin", pinned ? "Desfixar" : "Fixar"),
  ];
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

function allowMediaPermissions(ses) {
  ses.setPermissionRequestHandler((_contents, permission, callback, details) => {
    if (permission === "media") {
      let origin = details.requestingOrigin ?? "origem desconhecida";
      try {
        origin = new URL(details.requestingUrl ?? details.requestingOrigin).origin;
      } catch {
        origin = details.requestingOrigin ?? "origem desconhecida";
      }
      if (rememberedMedia.has(origin)) {
        callback(rememberedMedia.get(origin));
        return;
      }
      const id = `perm-${++permissionSeq}`;
      pendingPermissions.set(id, { callback, origin });
      sendToChrome("agzos:permission-request", {
        id,
        origin,
        mediaTypes: details.mediaTypes ?? [],
      });
      return;
    }
    callback(["fullscreen", "pointerLock", "clipboard-sanitized-write"].includes(permission));
  });
}

function activeViewEntry() {
  return activeTabId != null ? (views.get(activeTabId) ?? null) : null;
}

function handlePageShortcut(input, event) {
  const meta = input.control || input.meta;
  if (!meta || input.shift || input.alt) return false;
  const key = input.key.toLowerCase();
  const entry = activeViewEntry();
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
    if (isWebUrl(url)) openInNewTab(`view-source:${url}`);
    return true;
  }
  return false;
}

// Atalhos que saem da página (ou da casca) para o registro de comandos do renderer.
// Espelha src/features/browser/commands.ts; commands.test.ts confere que não falta nenhum.
const FORWARDED_SHORTCUTS = new Set([
  "mod+t",
  "mod+w",
  "mod+r",
  "mod+l",
  "mod+k",
  "mod+d",
  "mod+f",
  "mod+j",
  "mod+shift+t",
  "mod+shift+d",
  "mod+shift+n",
  "mod+shift+r",
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

function shortcutCombo(input) {
  const parts = [];
  if (input.control || input.meta) parts.push("mod");
  if (input.alt) parts.push("alt");
  if (input.shift) parts.push("shift");
  parts.push(input.key.toLowerCase());
  return parts.join("+");
}

function forwardAppShortcut(input, event) {
  if (input.type !== "keyDown") return false;
  if (!FORWARDED_SHORTCUTS.has(shortcutCombo(input))) return false;
  event.preventDefault();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.focus();
  sendToChrome("agzos:hotkey", {
    key: input.key.toLowerCase(),
    shift: Boolean(input.shift),
    alt: Boolean(input.alt),
    meta: Boolean(input.meta),
    ctrl: Boolean(input.control),
  });
  return true;
}

function wireShortcuts(contents, { page = false } = {}) {
  contents.on("before-input-event", (event, input) => {
    // Soltar o Ctrl/⌘ confirma o seletor do Ctrl+Tab, onde quer que esteja o foco.
    if (input.type === "keyUp" && (input.key === "Control" || input.key === "Meta")) {
      sendToChrome("agzos:modifier-up", { key: input.key });
      return;
    }
    if (input.type !== "keyDown") return;
    // Esc com foco na página para o carregamento (e segue para a página, como no Chrome).
    if (page && input.key === "Escape" && contents.isLoading()) contents.stop();
    if (handlePageShortcut(input, event)) return;
    forwardAppShortcut(input, event);
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
    if (isWebUrl(url)) openInNewTab(url);
    return { action: "deny" };
  });
  contents.on("did-create-window", (child) => {
    const popup = child.webContents;
    wirePopups(popup);
    wireShortcuts(popup);
  });
}

const COSMETIC_WORLD_ID = 1717;

/** CSS de ocultação do adblock. `base` na 1ª passada (dom-ready); depois só regras do DOM. */
async function applyCosmetics(contents, base) {
  if (!adblock || contents.isDestroyed()) return;
  const url = contents.getURL();
  if (!/^https?:\/\//.test(url)) return;
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

function isVisible(id) {
  return (
    id === activeTabId &&
    !panelOpen &&
    !fullscreenActive &&
    !crashedViews.has(id) &&
    !rejectedLoginViews.has(id) &&
    lastRect !== null
  );
}

/** `leaving`: a aba está saindo de cena; o pedido sai antes de ela ser escondida. */
async function captureThumbnail(id, { leaving = false } = {}) {
  const contents = views.get(id)?.view.webContents;
  if (!contents || contents.isDestroyed() || !isVisible(id)) return;
  if (!/^https?:\/\//.test(contents.getURL())) return;
  try {
    const image = await contents.capturePage();
    if (image.isEmpty() || (!leaving && !isVisible(id))) return;
    const small = image.resize({ width: THUMBNAIL_WIDTH, quality: "good" });
    const dataUrl = `data:image/jpeg;base64,${small.toJPEG(72).toString("base64")}`;
    sendToChrome("agzos:tab-event", { type: "thumbnail", id, dataUrl });
  } catch {
    // Aba fechada ou processo reiniciado no meio: fica a miniatura anterior.
  }
}

function scheduleThumbnail(id, delay) {
  clearTimeout(thumbnailTimers.get(id));
  thumbnailTimers.set(
    id,
    setTimeout(() => {
      thumbnailTimers.delete(id);
      void captureThumbnail(id);
    }, delay),
  );
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

function sendZoom(id, factor) {
  sendToChrome("agzos:tab-event", { type: "zoom", id, factor });
}

/** Aplica o zoom lembrado do host (depois de cada navegação). */
function applyStoredZoom(id, contents) {
  const host = zoomHostOf(contents.getURL());
  const factor = host ? storedZoom(contents, host) : 1;
  if (Math.abs(contents.getZoomFactor() - factor) > 0.001) contents.setZoomFactor(factor);
  sendZoom(id, factor);
}

/** direction: 1 aumenta, -1 diminui, 0 volta a 100 %. Vale para todas as abas do host. */
function changeZoom(id, direction) {
  const contents = views.get(id)?.view.webContents;
  if (!contents || contents.isDestroyed()) return;
  const factor = nextZoom(contents.getZoomFactor(), direction);
  const host = zoomHostOf(contents.getURL());
  const isPrivate = isPrivateContents(contents);
  if (host) {
    if (isPrivate) privateZoom.set(host, factor);
    else database?.setSiteSetting(host, "zoom", factor === 1 ? null : factor);
  }
  for (const [otherId, entry] of views) {
    const other = entry.view.webContents;
    if (other.isDestroyed()) continue;
    const sameHost = otherId === id || (host && zoomHostOf(other.getURL()) === host);
    if (!sameHost || isPrivateContents(other) !== isPrivate) continue;
    other.setZoomFactor(factor);
    sendZoom(otherId, factor);
  }
}

function wireView(id, view) {
  const contents = view.webContents;

  contents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) adblock?.resetPage(id);
  });
  contents.on("dom-ready", () => void applyCosmetics(contents, true));
  contents.on("did-finish-load", () => void applyCosmetics(contents, false));
  contents.on("found-in-page", (_event, result) => {
    sendToChrome("agzos:tab-event", {
      type: "find",
      id,
      active: result.activeMatchOrdinal ?? 0,
      total: result.matches ?? 0,
    });
  });
  contents.on("zoom-changed", (_event, direction) => changeZoom(id, direction === "in" ? 1 : -1));
  contents.on("did-navigate", () => applyStoredZoom(id, contents));
  contents.on("did-stop-loading", () => scheduleThumbnail(id, 600));
  contents.on("did-navigate", () => notifyTabState(id));
  contents.on("did-navigate-in-page", () => notifyTabState(id));
  contents.on("page-title-updated", () => notifyTabState(id));
  contents.on("page-favicon-updated", (_event, icons) => {
    sendToChrome("agzos:tab-event", { type: "favicon", id, icon: icons.at(-1) ?? null });
  });
  contents.on("media-started-playing", () =>
    sendToChrome("agzos:tab-event", { type: "audio", id, playing: true }),
  );
  contents.on("media-paused", () =>
    sendToChrome("agzos:tab-event", { type: "audio", id, playing: false }),
  );
  contents.on("audio-state-changed", (_event, muted) => {
    sendToChrome("agzos:tab-event", { type: "muted", id, muted });
  });
  contents.on("enter-html-full-screen", () => {
    fullscreenActive = true;
    view.setBounds(fullRect());
    sendToChrome("agzos:fullscreen", { active: true });
  });
  contents.on("leave-html-full-screen", () => {
    fullscreenActive = false;
    setTimeout(applyLayout, 50);
    sendToChrome("agzos:fullscreen", { active: false });
  });
  contents.on("context-menu", (event, params) => {
    event.preventDefault();
    buildPageContextMenu(contents, params).popup({ window: mainWindow });
  });
  wirePopups(contents);
  contents.on("render-process-gone", () => {
    crashedViews.add(id);
    if (!fullscreenActive) view.setBounds(HIDDEN_RECT);
    sendToChrome("agzos:tab-event", { type: "crashed", id });
  });

  wireShortcuts(contents, { page: true });
}

function createWindow() {
  const window = new BrowserWindow({
    title: "Agzos Browser",
    width: 1440,
    height: 960,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#0E0E0E",
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

  mainWindow = window;
  window.once("ready-to-show", () => window.show());
  window.on("resize", () => {
    if (fullscreenActive && activeTabId != null && views.has(activeTabId)) {
      views.get(activeTabId).view.setBounds(fullRect());
      return;
    }
    applyLayout();
  });
  window.on("leave-full-screen", () => setTimeout(applyLayout, 50));

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

  wireShortcuts(window.webContents);

  if (isDevelopment && developmentUrl) {
    void window.loadURL(developmentUrl);
  } else {
    void window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

function keyStorePath() {
  return path.join(app.getPath("userData"), "agzos-key.bin");
}

function registerIpc() {
  ipcMain.handle("tab:attach", (_event, { id, url, options }) => {
    if (views.has(id)) return;
    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        partition: options?.private ? PRIVATE_PARTITION : undefined,
      },
    });
    view.setBackgroundColor(options?.dark ? "#0E0E0E" : "#FFFDFD");
    views.set(id, { view });
    tabIdByContents.set(view.webContents.id, id);
    mainWindow.contentView.addChildView(view);
    allowMediaPermissions(view.webContents.session);
    wireView(id, view);
    if (isWebUrl(url)) void view.webContents.loadURL(url);
  });

  ipcMain.handle("tab:activate", (_event, { id }) => {
    // Foto da aba que sai, ainda visível (o seletor do Ctrl+Tab mostra o estado mais recente).
    if (activeTabId !== id && activeTabId !== null) {
      void captureThumbnail(activeTabId, { leaving: true });
    }
    activeTabId = id;
    applyLayout();
    scheduleThumbnail(id, 800);
  });

  ipcMain.handle("tab:capture", (_event, { id }) => captureThumbnail(id));

  // Foto da página visível, em tamanho real: a casca mostra no lugar dela enquanto um
  // painel está aberto (o WebContentsView precisa sair da frente do painel).
  ipcMain.handle("tab:snapshot", async (_event, { id }) => {
    const contents = views.get(id)?.view.webContents;
    if (!contents || contents.isDestroyed() || !isVisible(id)) return null;
    try {
      const image = await contents.capturePage();
      if (image.isEmpty()) return null;
      return `data:image/jpeg;base64,${image.toJPEG(88).toString("base64")}`;
    } catch {
      return null;
    }
  });

  ipcMain.handle("tab:bounds", (_event, rect) => {
    if (fullscreenActive) return;
    if (rect && rect.width > 0 && rect.height > 0) lastRect = rect;
    applyLayout();
  });

  ipcMain.handle("tab:navigate", (_event, { id, url }) => {
    const entry = views.get(id);
    if (!entry || !isWebUrl(url)) return;
    const contents = entry.view.webContents;
    if (contents.getURL() === url) return;
    void contents.loadURL(url);
  });

  ipcMain.handle("tab:back", (_event, { id }) => {
    const entry = views.get(id);
    if (entry?.view.webContents.navigationHistory.canGoBack())
      entry.view.webContents.navigationHistory.goBack();
  });

  ipcMain.handle("tab:forward", (_event, { id }) => {
    const entry = views.get(id);
    if (entry?.view.webContents.navigationHistory.canGoForward())
      entry.view.webContents.navigationHistory.goForward();
  });

  ipcMain.handle("tab:reload", (_event, { id, ignoreCache }) => {
    const contents = views.get(id)?.view.webContents;
    if (!contents) return;
    if (ignoreCache) contents.reloadIgnoringCache();
    else contents.reload();
  });

  ipcMain.handle("tab:zoom", (_event, { id, direction }) => {
    if (![-1, 0, 1].includes(direction)) return;
    changeZoom(id, direction);
  });

  ipcMain.handle("find:start", (_event, { id, text, forward, newSession }) => {
    const contents = views.get(id)?.view.webContents;
    if (!contents || typeof text !== "string" || !text) return;
    // findNext=true abre uma busca nova; false vai para o próximo/anterior resultado.
    contents.findInPage(text.slice(0, 500), {
      forward: forward !== false,
      findNext: Boolean(newSession),
    });
  });

  ipcMain.handle("find:stop", (_event, { id }) => {
    const contents = views.get(id)?.view.webContents;
    if (contents && !contents.isDestroyed()) contents.stopFindInPage("clearSelection");
  });

  ipcMain.handle("window:toggle-fullscreen", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    }
  });

  // Mudança no escudo vale na hora (o state:save tem debounce).
  ipcMain.handle("adblock:config", (_event, config) => {
    adblock?.setConfig(shieldConfigOf(config));
  });

  // Chamada síncrona do tab-preload: precisa responder antes dos scripts da página.
  ipcMain.on("adblock:scriptlets", (event, url) => {
    const fromShell = mainWindow && event.sender === mainWindow.webContents;
    event.returnValue =
      !adblock || fromShell || typeof url !== "string" ? [] : adblock.scriptletsFor(url);
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

  ipcMain.handle("tab:close", (_event, { id }) => {
    const entry = views.get(id);
    if (!entry) return;
    crashedViews.delete(id);
    rejectedLoginViews.delete(id);
    mainWindow.contentView.removeChildView(entry.view);
    tabIdByContents.delete(entry.view.webContents.id);
    clearTimeout(thumbnailTimers.get(id));
    thumbnailTimers.delete(id);
    adblock?.forgetTab(id);
    entry.view.webContents.close();
    views.delete(id);
    if (activeTabId === id) activeTabId = null;
  });

  ipcMain.handle("tab:mute", (_event, { id, muted }) => {
    views.get(id)?.view.webContents.setAudioMuted(muted);
  });

  ipcMain.handle("chrome:panel", (_event, { open }) => {
    panelOpen = Boolean(open);
    applyLayout();
  });

  ipcMain.handle("tabmenu:show", (_event, context) => {
    buildTabContextMenu(context ?? {}).popup({ window: mainWindow });
  });

  ipcMain.handle("permission:respond", (_event, { id, allow, remember }) => {
    const pending = pendingPermissions.get(id);
    if (!pending) return;
    pendingPermissions.delete(id);
    if (remember) rememberedMedia.set(pending.origin, Boolean(allow));
    pending.callback(Boolean(allow));
  });

  ipcMain.handle("state:load", () => {
    if (!database) return { available: false, sections: {} };
    try {
      return { available: true, sections: database.loadState() };
    } catch {
      return { available: false, sections: {} };
    }
  });

  ipcMain.handle("state:save", (_event, sections) => {
    // O escudo segue as preferências salvas (liga/desliga e sites pausados).
    if (sections && typeof sections === "object" && sections.prefs) {
      adblock?.setConfig(shieldConfigOf(sections.prefs));
    }
    if (!database) return { ok: false };
    try {
      return { ok: database.saveState(sections) };
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
}

app.commandLine.appendSwitch("autoplay-policy", "user-gesture-required");

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
    emit: (record) => sendToChrome("agzos:download", record),
    isPrivateSession: (ses) => ses === privateSession(),
  });
  adblock = createAdblock({
    userDataDir: app.getPath("userData"),
    database,
    fetchText,
    lists: listsFromEnv(process.env.AGZOS_FILTER_LISTS),
    emitPage: (id, info) => sendToChrome("agzos:tab-event", { type: "blocked", id, ...info }),
    emitStats: (stats) => sendToChrome("agzos:adblock-stats", stats),
  });
  try {
    // O escudo já nasce com a configuração salva, antes da primeira aba carregar.
    adblock.setConfig(shieldConfigOf(database?.loadState().prefs));
  } catch {
    // Sem estado salvo: escudo ligado, nenhum site pausado.
  }
  adblock.start();
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

app.whenReady().then(() => {
  if (!isDevelopment) Menu.setApplicationMenu(null);

  openStateDatabase();
  startServices();
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => downloads?.cancelAll());

app.on("will-quit", () => {
  adblock?.close();
  database?.close();
  database = null;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

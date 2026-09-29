const {
  app,
  BrowserWindow,
  WebContentsView,
  Menu,
  session,
  clipboard,
  ipcMain,
  screen,
  shell,
  safeStorage,
  net,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
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
  createPermissions,
  permissionTypesOf,
  checkTypesOf,
  requestOrigin,
  AUTO_ALLOWED,
} = require("./permissions.cjs");
const { fetchSuggestions } = require("./suggest.cjs");
const { createUpdater, compareVersions, DEFAULT_FEED } = require("./updater.cjs");
const {
  createWindowStore,
  fitBounds,
  cascadeBounds,
  safeSession,
  STABLE_AFTER_MS,
} = require("./windows.cjs");
const { HOVER_CARD_HTML, cardBounds, metricRows } = require("./hover-card.cjs");
const {
  CHECK_INTERVAL_MS,
  hibernateConfigOf,
  canHibernate,
  restorableHistory,
  EDITED_FORM_SOURCE,
} = require("./hibernate.cjs");

const DUCK_AI_URL = "https://duck.ai/chat";
const PRIVATE_PARTITION = "agzos-anonima";
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
  return url.startsWith("http://") || url.startsWith("https://") || url.startsWith("file://");
}

function fullRect(ctx) {
  const [width, height] = ctx.window.getContentSize();
  return { x: 0, y: 0, width, height };
}

/** A guia aparece por cima da casca (sem painel, tela de erro, crash ou login recusado). */
function isShown(ctx, id) {
  return (
    id === ctx.activeTabId &&
    !ctx.panelOpen &&
    !ctx.crashed.has(id) &&
    !ctx.rejected.has(id) &&
    !ctx.failed.has(id)
  );
}

function applyLayout(ctx) {
  if (ctx.fullscreenActive || ctx.window.isDestroyed()) return;
  const now = Date.now();
  for (const [id, entry] of ctx.views) {
    const shown = isShown(ctx, id);
    entry.view.setBounds(shown && ctx.lastRect ? ctx.lastRect : HIDDEN_RECT);
    // Hibernação conta o tempo desde que a guia deixou de ser a ativa.
    if (id === ctx.activeTabId) entry.hiddenSince = null;
    else entry.hiddenSince ??= now;
  }
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
  send(ownerCtx(contents), "agzos:open-request", { url });
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
      { label: "Copiar imagem", click: () => contents.copyImageAt(params.x, params.y) },
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

function buildTabContextMenu(ctx, context) {
  const { kind, tabId, pinned, muted, audio, hasClosed, orientation, url, tabCount, active } =
    context;
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
    action("tab.toggle-pin", pinned ? "Desfixar" : "Fixar"),
    action("tab.hibernate", "Hibernar guia", { enabled: Boolean(loaded && !active) }),
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

// Ctrl+Tab com o foco na página: o foco vai para a casca (a página some atrás do seletor e
// página escondida não recebe teclas), mas o Chromium não entrega à casca o "soltar o
// Ctrl" de uma tecla apertada em outra superfície, e o seletor só confirmava com Enter.
// Então a casca recebe um "Ctrl apertado" sintético: o soltar de verdade chega a ela.
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

function forwardAppShortcut(ctx, input, event, { page = false } = {}) {
  if (input.type !== "keyDown" || !ctx) return false;
  const combo = shortcutCombo(input);
  if (!FORWARDED_SHORTCUTS.has(combo)) return false;
  // No Mac o ⌘H é "Ocultar Agzos Browser" (a barra de menus trata; histórico é ⌘Y).
  if (process.platform === "darwin" && combo === "mod+h" && input.meta) return false;
  event.preventDefault();
  if (!ctx.window.isDestroyed()) {
    const shell = ctx.window.webContents;
    shell.focus();
    if (page && SWITCHER_COMBOS.has(combo)) {
      const modifiers = [input.control && "control", input.meta && "meta"].filter(Boolean);
      shell.sendInputEvent({
        type: "keyDown",
        keyCode: input.meta ? "Meta" : "Control",
        modifiers,
      });
    }
  }
  send(ctx, "agzos:hotkey", {
    key: shortcutKey(input),
    shift: Boolean(input.shift),
    alt: Boolean(input.alt),
    meta: Boolean(input.meta),
    ctrl: Boolean(input.control),
  });
  return true;
}

function wireShortcuts(contents, { page = false } = {}) {
  contents.on("before-input-event", (event, input) => {
    // A janela é resolvida a cada tecla: a guia pode ter mudado de janela.
    const ctx = ownerCtx(contents);
    // Soltar o Ctrl/⌘ confirma o seletor do Ctrl+Tab, onde quer que esteja o foco.
    if (input.type === "keyUp" && (input.key === "Control" || input.key === "Meta")) {
      send(ctx, "agzos:modifier-up", { key: input.key });
      return;
    }
    if (input.type !== "keyDown") return;
    if (page && ctx?.switcherOpen && SWITCHER_KEYS.has(input.key)) {
      event.preventDefault();
      send(ctx, "agzos:switcher-key", { key: input.key });
      return;
    }
    // Esc com foco na página para o carregamento (e segue para a página, como no Chrome).
    if (page && input.key === "Escape" && contents.isLoading()) contents.stop();
    if (handlePageShortcut(ctx, input, event)) return;
    forwardAppShortcut(ctx, input, event, { page });
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
  return isShown(ctx, id) && !ctx.fullscreenActive && ctx.lastRect !== null;
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

async function loadWithScriptlets(contents, url) {
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

function wireView(view) {
  const contents = view.webContents;
  const ctxNow = () => tabOfContents.get(contents.id)?.ctx ?? null;

  contents.on("did-start-navigation", (details) => {
    if (!details.isMainFrame || details.isSameDocument) return;
    adblock?.resetPage(contents.id);
    ensureScriptlets(contents, details.url, "early");
  });
  contents.on("did-redirect-navigation", (details) => {
    if (details.isMainFrame) ensureScriptlets(contents, details.url, "early");
  });
  contents.on("did-finish-load", () => ensureScriptlets(contents, contents.getURL(), "settled"));
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
  contents.on("did-stop-loading", () => scheduleThumbnail(contents, 600));
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
    panelOpen: false,
    fullscreenActive: false,
    crashed: new Set(),
    rejected: new Set(),
    failed: new Map(),
    hibernated: new Map(),
    unresponsive: new Set(),
    switcherOpen: false,
    preview: null,
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
  });
  window.on("move", saveBoundsSoon);
  window.on("maximize", saveBoundsSoon);
  window.on("unmaximize", saveBoundsSoon);
  window.on("leave-full-screen", () => setTimeout(() => applyLayout(ctx), 50));
  // Windows desligando: as janelas fecham uma a uma, mas todas voltam no próximo início.
  window.on("session-end", () => {
    quitting = true;
  });
  window.on("close", () => {
    clearTimeout(boundsTimer);
    rememberBounds(ctx);
    // Fechar uma janela entre várias descarta as guias dela (como no Chrome). A última
    // janela, ou todas ao sair do app, ficam salvas para o próximo início.
    if (!quitting && contexts.size > 1) windowStore?.remove(ctx.key);
  });
  window.on("blur", () => hidePreview(ctx));
  window.on("closed", () => {
    if (ctx.preview && !ctx.preview.webContents.isDestroyed()) ctx.preview.webContents.close();
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
  if (!entry || id === ctx.activeTabId) return false;
  const contents = entry.view.webContents;
  if (contents.isDestroyed()) return false;
  if (!force && (await hasEditedForm(contents))) return false;
  // A guia pode ter sido ativada, fechada ou movida enquanto a página respondia.
  if (ctx.views.get(id) !== entry || id === ctx.activeTabId || contents.isDestroyed()) {
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
          visible: id === ctx.activeTabId,
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
  const view = new WebContentsView({
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  view.setBackgroundColor("#00000000");
  view.setBounds(HIDDEN_RECT);
  // Só a casca mexe no cartão: nada de navegar, abrir janelas ou receber foco de teclado.
  view.webContents.on("will-navigate", (event) => event.preventDefault());
  view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  view.webContents.setIgnoreMenuShortcuts(true);
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

function hidePreview(ctx) {
  ctx.previewSeq = ++previewSeq;
  const view = ctx.preview;
  if (!view || view.webContents.isDestroyed()) return;
  view.setBounds(HIDDEN_RECT);
  void view.webContents.executeJavaScript("window.hide && window.hide()").catch(() => {});
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

function registerIpc() {
  ipcMain.handle("tab:attach", (event, { id, url, options }) => {
    const ctx = ctxOfEvent(event);
    if (!ctx || ctx.views.has(id)) return;
    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        partition: options?.private ? PRIVATE_PARTITION : undefined,
      },
    });
    view.setBackgroundColor(options?.dark ? "#0E0E0E" : "#FFFDFD");
    view.setBounds(HIDDEN_RECT);
    ctx.views.set(id, { view, hiddenSince: null });
    tabOfContents.set(view.webContents.id, { ctx, id });
    ctx.window.contentView.addChildView(view);
    wirePermissions(view.webContents.session);
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
    try {
      const image = await contents.capturePage();
      if (image.isEmpty()) return null;
      return `data:image/jpeg;base64,${image.toJPEG(88).toString("base64")}`;
    } catch {
      return null;
    }
  });

  ipcMain.handle("tab:bounds", (event, rect) => {
    const ctx = ctxOfEvent(event);
    if (!ctx || ctx.fullscreenActive) return;
    if (rect && rect.width > 0 && rect.height > 0) ctx.lastRect = rect;
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

  ipcMain.handle("switcher:state", (event, { open }) => {
    const ctx = ctxOfEvent(event);
    if (ctx) ctx.switcherOpen = Boolean(open);
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
  if (database) {
    windowStore = createWindowStore({ database });
    const previous = windowStore.beginRun();
    windowStore.load();
    startup = { ...previous, restoredWindows: 0 };
    // Passado um minuto aberto, um crash não é mais "logo ao abrir".
    setTimeout(
      () => windowStore?.markStable(),
      Number(process.env.AGZOS_STABLE_AFTER_MS) || STABLE_AFTER_MS,
    ).unref();
  }
  startServices();
  registerIpc();
  // Modo seguro vale só para a restauração do início (não para o Dock do Mac depois).
  startup.restoredWindows = openSavedWindows({ safe: startup.early });
  if (!contexts.size) createWindow();
  startup = { ...startup, early: startup.early && startup.restoredWindows > 0 };
  setInterval(
    () => void checkHibernation(),
    Number(process.env.AGZOS_HIBERNATE_CHECK_MS) || CHECK_INTERVAL_MS,
  ).unref();
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

app.on("before-quit", () => {
  quitting = true;
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

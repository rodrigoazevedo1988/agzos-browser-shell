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
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const DUCK_AI_URL = "https://duck.ai/chat";
const PRIVATE_PARTITION = "agzos-anonima";
const HIDDEN_RECT = { x: 0, y: 0, width: 0, height: 0 };

const isDevelopment = process.argv.some((argument) => argument.startsWith("--dev-url="));
const developmentUrl = process.argv
  .find((argument) => argument.startsWith("--dev-url="))
  ?.slice("--dev-url=".length);

const views = new Map();
const pendingPermissions = new Map();
const rememberedMedia = new Map();
const crashedViews = new Set();
let mainWindow = null;
let activeTabId = null;
let lastRect = null;
let panelOpen = false;
let fullscreenActive = false;
let permissionSeq = 0;
let cleanUserAgent = "";

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
    const active = id === activeTabId && !panelOpen && !crashedViews.has(id);
    const rect = active && lastRect ? lastRect : HIDDEN_RECT;
    entry.view.setBounds(rect);
  }
}

function notifyTabState(id) {
  const entry = views.get(id);
  if (!entry || entry.view.webContents.isDestroyed()) return;
  const contents = entry.view.webContents;
  crashedViews.delete(id);
  sendToChrome("agzos:tab-event", {
    type: "tab-updated",
    id,
    url: contents.getURL(),
    title: contents.getTitle(),
    canBack: contents.navigationHistory.canGoBack(),
    canForward: contents.navigationHistory.canGoForward(),
  });
}

function openInNewTab(url) {
  sendToChrome("agzos:open-request", { url });
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
      click: () => contents.downloadURL(contents.getURL()),
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
      { label: "Copiar endereço do link", click: () => clipboard.writeText(params.linkURL) },
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
      action("strip-new", "Nova guia", { accelerator: "CmdOrCtrl+T" }),
      action("strip-reopen", "Reabrir guia fechada", {
        accelerator: "CmdOrCtrl+Shift+T",
        enabled: Boolean(hasClosed),
      }),
      { type: "separator" },
      orientation === "vertical"
        ? action("strip-horizontal", "Mostrar guias horizontalmente")
        : action("strip-vertical", "Mostrar guias verticalmente"),
    ]);
  }

  const items = [
    action("new-tab-right", "Nova guia à direita", { accelerator: "CmdOrCtrl+T" }),
    action("reopen-closed", "Reabrir guia fechada", {
      accelerator: "CmdOrCtrl+Shift+T",
      enabled: Boolean(hasClosed),
    }),
    action("duplicate", "Duplicar"),
    { type: "separator" },
    pinned ? action("unpin", "Desfixar") : action("pin", "Fixar"),
  ];
  if (audio || muted) {
    items.push(action("mute", muted ? "Ativar som do site" : "Desativar som do site"));
  }
  items.push(
    { type: "separator" },
    action("reload", "Recarregar", { accelerator: "CmdOrCtrl+R" }),
    {
      label: "Copiar endereço",
      enabled: Boolean(url),
      click: () => {
        if (url) clipboard.writeText(url);
      },
    },
    { type: "separator" },
    action("close", "Fechar", { accelerator: "CmdOrCtrl+W" }),
    action("close-others", "Fechar outras guias"),
    action("close-right", "Fechar guias à direita"),
    action("close-left", "Fechar guias à esquerda"),
    { type: "separator" },
    action("bookmark-all", "Adicionar todas as guias aos favoritos…", {
      accelerator: "CmdOrCtrl+Shift+D",
    }),
    { type: "separator" },
    orientation === "vertical"
      ? action("tabs-horizontal", "Mostrar guias horizontalmente")
      : action("tabs-vertical", "Mostrar guias verticalmente"),
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
    contents.downloadURL(contents.getURL());
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

function forwardAppShortcut(input, event) {
  if (input.type !== "keyDown" || input.alt) return false;
  const meta = input.control || input.meta;
  if (!meta) return false;
  const key = input.key.toLowerCase();
  const isPlain = !input.shift && ["t", "w", "r", "l", "k"].includes(key);
  const isShiftT = input.shift && key === "t";
  if (!isPlain && !isShiftT) return false;
  event.preventDefault();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.focus();
  sendToChrome("agzos:hotkey", {
    key,
    shift: Boolean(input.shift),
    alt: false,
    meta: Boolean(input.meta),
    ctrl: Boolean(input.control),
  });
  return true;
}

function wireShortcuts(contents) {
  contents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (handlePageShortcut(input, event)) return;
    forwardAppShortcut(input, event);
  });
}

function wireView(id, view) {
  const contents = view.webContents;

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
  contents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) openInNewTab(url);
    return { action: "deny" };
  });
  contents.on("render-process-gone", () => {
    crashedViews.add(id);
    if (!fullscreenActive) view.setBounds(HIDDEN_RECT);
    sendToChrome("agzos:tab-event", { type: "crashed", id });
  });

  wireShortcuts(contents);
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
    mainWindow.contentView.addChildView(view);
    view.webContents.session.setUserAgent(cleanUserAgent);
    allowMediaPermissions(view.webContents.session);
    wireView(id, view);
    if (isWebUrl(url)) void view.webContents.loadURL(url);
  });

  ipcMain.handle("tab:activate", (_event, { id }) => {
    activeTabId = id;
    applyLayout();
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

  ipcMain.handle("tab:reload", (_event, { id }) => {
    views.get(id)?.view.webContents.reload();
  });

  ipcMain.handle("tab:close", (_event, { id }) => {
    const entry = views.get(id);
    if (!entry) return;
    crashedViews.delete(id);
    mainWindow.contentView.removeChildView(entry.view);
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
}

app.commandLine.appendSwitch("autoplay-policy", "user-gesture-required");

app.on("web-contents-created", (_event, contents) => {
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

app.whenReady().then(() => {
  cleanUserAgent = app.userAgentFallback
    .replace(/\sElectron\/[\d.]+/i, "")
    .replace(/\sAgzosBrowser\/[\d.]+/i, "");
  session.defaultSession.setUserAgent(cleanUserAgent);

  if (!isDevelopment) Menu.setApplicationMenu(null);

  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

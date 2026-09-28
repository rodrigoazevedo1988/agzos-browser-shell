const {
  app,
  BrowserWindow,
  WebContentsView,
  Menu,
  session,
  clipboard,
  ipcMain,
  shell,
} = require("electron");
const path = require("node:path");

const DUCK_AI_URL = "https://duck.ai/chat";

const isDevelopment = process.argv.some((argument) => argument.startsWith("--dev-url="));
const developmentUrl = process.argv
  .find((argument) => argument.startsWith("--dev-url="))
  ?.slice("--dev-url=".length);

const views = new Map();
let mainWindow = null;
let activeTabId = null;
let lastRect = null;
let panelOpen = false;

const HIDDEN_RECT = { x: 0, y: 0, width: 0, height: 0 };

function sendToChrome(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function isWebUrl(url) {
  return url.startsWith("http://") || url.startsWith("https://") || url.startsWith("file://");
}

function applyLayout() {
  for (const [id, entry] of views) {
    const rect = id === activeTabId && !panelOpen && lastRect ? lastRect : HIDDEN_RECT;
    entry.view.setBounds(rect);
  }
}

function notifyTabState(id) {
  const entry = views.get(id);
  if (!entry || entry.view.webContents.isDestroyed()) return;
  const contents = entry.view.webContents;
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

function allowMediaPermissions(ses) {
  ses.setPermissionRequestHandler((_contents, permission, callback) => {
    const allowed = ["media", "fullscreen", "pointerLock", "clipboard-sanitized-write"];
    callback(allowed.includes(permission));
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
  contents.on("enter-html-full-screen", () => sendToChrome("agzos:fullscreen", { active: true }));
  contents.on("leave-html-full-screen", () => sendToChrome("agzos:fullscreen", { active: false }));
  contents.on("context-menu", (event, params) => {
    event.preventDefault();
    buildPageContextMenu(contents, params).popup({ window: mainWindow });
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) openInNewTab(url);
    return { action: "deny" };
  });
  contents.on("render-process-gone", () => {
    views.delete(id);
    if (activeTabId === id) activeTabId = null;
  });

  contents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || input.alt) return;
    const key = input.key.toLowerCase();
    const meta = input.control || input.meta;
    const isPlain = meta && !input.shift && ["t", "w", "r", "l", "k"].includes(key);
    const isShiftT = meta && input.shift && key === "t";
    if (!isPlain && !isShiftT) return;
    event.preventDefault();
    sendToChrome("agzos:hotkey", { key, shift: Boolean(input.shift) });
  });
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
  window.on("resize", applyLayout);

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

  if (isDevelopment && developmentUrl) {
    void window.loadURL(developmentUrl);
  } else {
    void window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

function registerIpc() {
  ipcMain.handle("tab:attach", (_event, { id, url, options }) => {
    if (views.has(id)) return;
    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        partition: options?.private ? `agzos-private-${id}` : undefined,
      },
    });
    view.setBackgroundColor(options?.dark ? "#0E0E0E" : "#FFFDFD");
    views.set(id, { view });
    mainWindow.contentView.addChildView(view);
    allowMediaPermissions(view.webContents.session);
    wireView(id, view);
  });

  ipcMain.handle("tab:activate", (_event, { id }) => {
    activeTabId = id;
    applyLayout();
  });

  ipcMain.handle("tab:bounds", (_event, rect) => {
    if (rect && rect.width > 0 && rect.height > 0) lastRect = rect;
    applyLayout();
  });

  ipcMain.handle("tab:navigate", (_event, { id, url }) => {
    const entry = views.get(id);
    if (!entry || !isWebUrl(url)) return;
    void entry.view.webContents.loadURL(url);
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
}

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

app.whenReady().then(() => {
  const cleaned = app.userAgentFallback
    .replace(/\sElectron\/[\d.]+/i, "")
    .replace(/\sAgzosBrowser\/[\d.]+/i, "");
  session.defaultSession.setUserAgent(cleaned);

  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

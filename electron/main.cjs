const { app, BrowserWindow, session, shell } = require("electron");
const path = require("node:path");

const isDevelopment = process.argv.some((argument) => argument.startsWith("--dev-url="));
const developmentUrl = process.argv
  .find((argument) => argument.startsWith("--dev-url="))
  ?.slice("--dev-url=".length);

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
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once("ready-to-show", () => window.show());

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

// Permite que sites reais sejam exibidos dentro das abas do Agzos Browser no desktop.
function allowEmbedding() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    for (const key of Object.keys(headers)) {
      const name = key.toLowerCase();
      if (
        name === "x-frame-options" ||
        name === "content-security-policy" ||
        name === "content-security-policy-report-only"
      ) {
        delete headers[key];
      }
    }
    callback({ responseHeaders: headers });
  });
}

app.whenReady().then(() => {
  allowEmbedding();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

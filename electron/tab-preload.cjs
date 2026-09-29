// Preload das páginas das abas (registrado em cada session). Não expõe nada à página:
// só busca os scriptlets do adblock para esta URL e os roda no mundo da página antes dos
// scripts dela. webFrame.executeJavaScript não passa pela CSP da página (o YouTube só
// aceita scripts com nonce).
const { ipcRenderer, webFrame } = require("electron");

try {
  const url = window.location.href;
  if (/^https?:\/\//.test(url)) {
    const scripts = ipcRenderer.sendSync("adblock:scriptlets", url);
    if (Array.isArray(scripts) && scripts.length) {
      void webFrame.executeJavaScript(scripts.join("\n;\n")).catch(() => {});
    }
  }
} catch {
  // Sem scriptlets a página segue normal.
}

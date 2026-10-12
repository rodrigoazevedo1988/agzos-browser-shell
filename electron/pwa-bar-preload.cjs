// Barra do app de um PWA (4.8.5, ver pwa-chrome.cjs): manda a ação ao main e recebe o estado.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("agzosPwaBar", {
  run: (payload) => ipcRenderer.send("pwa-bar:action", payload),
  onState: (listener) => {
    ipcRenderer.on("pwa-bar:state", (_event, state) => listener(state));
    ipcRenderer.send("pwa-bar:ready");
  },
});

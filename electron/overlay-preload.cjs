// Preload da camada dos painéis (chrome-overlay.cjs): só os canais do painel.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("agzosOverlay", {
  ready: () => ipcRenderer.send("overlay:ready"),
  onRender: (callback) => {
    const listener = (_event, model) => callback(model);
    ipcRenderer.on("agzos:overlay-render", listener);
    return () => ipcRenderer.removeListener("agzos:overlay-render", listener);
  },
  call: (name, args) => ipcRenderer.invoke("overlay:call", { name, args }),
  dismiss: () => ipcRenderer.send("overlay:dismiss"),
  wheel: (payload) => ipcRenderer.send("overlay:wheel", payload),
});

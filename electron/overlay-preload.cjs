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
  dismiss: (click) => ipcRenderer.send("overlay:dismiss", click ?? null),
  wheel: (payload) => ipcRenderer.send("overlay:wheel", payload),
});

// Cursor acompanhado pelo main (menu de pasta aberto): o elemento sob ele recebe
// "agzos-pointer", e a zona de outra pasta troca o menu (ver followFolderPointer).
ipcRenderer.on("agzos:overlay-pointer", (_event, point) => {
  const x = Number(point?.x);
  const y = Number(point?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const target = document.elementFromPoint(x, y);
  if (target) target.dispatchEvent(new Event("agzos-pointer", { bubbles: true }));
});

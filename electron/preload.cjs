const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel) {
  return (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
}

contextBridge.exposeInMainWorld("agzosDesktop", {
  attachTab: (id, url, options) => ipcRenderer.invoke("tab:attach", { id, url, options }),
  activateTab: (id) => ipcRenderer.invoke("tab:activate", { id }),
  setBounds: (rect) => ipcRenderer.invoke("tab:bounds", rect),
  navigate: (id, url) => ipcRenderer.invoke("tab:navigate", { id, url }),
  goBack: (id) => ipcRenderer.invoke("tab:back", { id }),
  goForward: (id) => ipcRenderer.invoke("tab:forward", { id }),
  reload: (id) => ipcRenderer.invoke("tab:reload", { id }),
  closeTab: (id) => ipcRenderer.invoke("tab:close", { id }),
  muteTab: (id, muted) => ipcRenderer.invoke("tab:mute", { id, muted }),
  setPanelOpen: (open) => ipcRenderer.invoke("chrome:panel", { open }),
  onTabEvent: subscribe("agzos:tab-event"),
  onOpenRequest: subscribe("agzos:open-request"),
  onFullscreen: subscribe("agzos:fullscreen"),
  onHotkey: subscribe("agzos:hotkey"),
});

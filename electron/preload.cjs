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
  reload: (id, ignoreCache = false) => ipcRenderer.invoke("tab:reload", { id, ignoreCache }),
  snapshotTab: (id) => ipcRenderer.invoke("tab:snapshot", { id }),
  captureTab: (id) => ipcRenderer.invoke("tab:capture", { id }),
  zoom: (id, direction) => ipcRenderer.invoke("tab:zoom", { id, direction }),
  findStart: (id, text, options) =>
    ipcRenderer.invoke("find:start", {
      id,
      text,
      forward: options?.forward !== false,
      newSession: Boolean(options?.newSession),
    }),
  findStop: (id) => ipcRenderer.invoke("find:stop", { id }),
  toggleFullscreen: () => ipcRenderer.invoke("window:toggle-fullscreen"),
  adblockConfig: (config) => ipcRenderer.invoke("adblock:config", config),
  adblockStats: () => ipcRenderer.invoke("adblock:stats"),
  adblockUpdate: () => ipcRenderer.invoke("adblock:update"),
  downloadsList: () => ipcRenderer.invoke("downloads:list"),
  downloadAction: (id, action) => ipcRenderer.invoke("download:action", { id, action }),
  downloadsClear: () => ipcRenderer.invoke("downloads:clear"),
  closeTab: (id) => ipcRenderer.invoke("tab:close", { id }),
  muteTab: (id, muted) => ipcRenderer.invoke("tab:mute", { id, muted }),
  setPanelOpen: (open) => ipcRenderer.invoke("chrome:panel", { open }),
  showTabMenu: (context) => ipcRenderer.invoke("tabmenu:show", context),
  respondPermission: (id, allow, remember) =>
    ipcRenderer.invoke("permission:respond", { id, allow, remember }),
  stateLoad: () => ipcRenderer.invoke("state:load"),
  stateSave: (sections) => ipcRenderer.invoke("state:save", sections),
  keyLoad: () => ipcRenderer.invoke("key:load"),
  keySave: (list) => ipcRenderer.invoke("key:save", list),
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),
  onTabEvent: subscribe("agzos:tab-event"),
  onOpenRequest: subscribe("agzos:open-request"),
  onFullscreen: subscribe("agzos:fullscreen"),
  onHotkey: subscribe("agzos:hotkey"),
  onTabMenuAction: subscribe("agzos:tabmenu-action"),
  onRequestPermission: subscribe("agzos:permission-request"),
  onDownload: subscribe("agzos:download"),
  onModifierUp: subscribe("agzos:modifier-up"),
  onAdblockStats: subscribe("agzos:adblock-stats"),
});

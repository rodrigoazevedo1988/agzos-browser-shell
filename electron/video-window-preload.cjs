// Camada de controles da janela de vídeo (4.9, ver video-window.cjs): manda o comando ao
// main e recebe o estado do vídeo.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("agzosVideo", {
  run: (command) => ipcRenderer.send("video-window:run", command),
  onState: (listener) => {
    ipcRenderer.on("video-window:state", (_event, state) => listener(state));
    ipcRenderer.send("video-window:ready");
  },
});

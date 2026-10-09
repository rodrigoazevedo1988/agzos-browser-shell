// Instalação formal no Windows (4.8.4, scripts/windows-installer.nsi). O instalador cria a
// entrada em "Programas e Recursos" (HKCU, sem administrador) e os atalhos; o OTA depois
// só copia arquivos por cima da pasta. Ao abrir, o app instalado acerta a versão mostrada
// em "Programas e Recursos" e o AppUserModelID dos atalhos (notificações e agrupamento na
// barra de tarefas). A cópia portátil (sem o desinstalador ao lado) não mexe em nada.

const path = require("node:path");

const UNINSTALLER = "Desinstalar Agzos Browser.exe";
const UNINSTALL_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AgzosBrowser";
const APP_USER_MODEL_ID = "br.agzos.browser";
const VERSION_RE = /^\d+\.\d+\.\d+$/;

/** Instalado pelo instalador: o desinstalador está na pasta do executável. */
function isInstalled(execPath, exists) {
  return exists(path.win32.join(path.win32.dirname(execPath), UNINSTALLER));
}

/** Argumentos do reg.exe para gravar a versão (só x.y.z; nada vindo de fora). */
function versionRegArgs(version) {
  if (!VERSION_RE.test(String(version))) return null;
  return ["add", UNINSTALL_KEY, "/v", "DisplayVersion", "/t", "REG_SZ", "/d", version, "/f"];
}

/** Atalhos que o instalador cria. */
function shortcutPaths({ desktop, startMenu }) {
  return [
    path.win32.join(desktop, "Agzos Browser.lnk"),
    path.win32.join(startMenu, "Agzos Browser.lnk"),
  ];
}

module.exports = {
  APP_USER_MODEL_ID,
  UNINSTALLER,
  UNINSTALL_KEY,
  isInstalled,
  shortcutPaths,
  versionRegArgs,
};

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
// Registro de "Abrir com" e Programas padrão (5.0.1; mesmos nomes em scripts/windows-installer.nsi).
const APP_EXE = "AgzosBrowser.exe";
const HANDLER_PROGID = "AgzosBrowserHTML";
const URL_PROGID = "AgzosBrowserURL";
const VERB = "AgzosOpen";
const CLIENT_KEY = "HKCU\\Software\\Clients\\StartMenuInternet\\AgzosBrowser";

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

/**
 * Argumentos do reg.exe para as chaves que levam o caminho do executável ("Abrir com",
 * verbo do clique direito e ícones). O instalador grava as mesmas chaves (HKCU); aqui só
 * acertamos o caminho depois de uma atualização. Nenhum valor vem de fora além do caminho.
 */
function handlerRegArgs(execPath) {
  const exe = String(execPath ?? "");
  if (!path.win32.isAbsolute(exe) || /["<>|]/.test(exe) || !/\.exe$/i.test(exe)) return null;
  const classes = "HKCU\\Software\\Classes";
  const command = `"${exe}" "%1"`;
  const icon = `"${exe}",0`;
  const entries = [
    [`${classes}\\${HANDLER_PROGID}\\shell\\open\\command`, "", command],
    [`${classes}\\${HANDLER_PROGID}\\DefaultIcon`, "", icon],
    [`${classes}\\${URL_PROGID}\\shell\\open\\command`, "", command],
    [`${classes}\\${URL_PROGID}\\DefaultIcon`, "", icon],
    [`${classes}\\Applications\\${APP_EXE}\\shell\\open\\command`, "", command],
    [`${classes}\\Applications\\${APP_EXE}\\DefaultIcon`, "", icon],
    [`${classes}\\*\\shell\\${VERB}`, "Icon", icon],
    [`${classes}\\*\\shell\\${VERB}\\command`, "", command],
    [`${CLIENT_KEY}\\shell\\open\\command`, "", `"${exe}"`],
  ];
  return entries.map(([key, name, data]) =>
    name
      ? ["add", key, "/v", name, "/t", "REG_SZ", "/d", data, "/f"]
      : ["add", key, "/ve", "/t", "REG_SZ", "/d", data, "/f"],
  );
}

module.exports = {
  APP_USER_MODEL_ID,
  UNINSTALLER,
  UNINSTALL_KEY,
  handlerRegArgs,
  isInstalled,
  shortcutPaths,
  versionRegArgs,
};

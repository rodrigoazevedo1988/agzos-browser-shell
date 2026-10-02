// Painéis laterais (3.1.1): zoom próprio de cada painel e a sessão dos apps entre reinícios.
//
// Zoom: o Chromium guarda o zoom por host na sessão (o painel do Discord e uma guia em
// discord.com dividiriam o mesmo valor). Os painéis usam o modo "isolated" do webContents e
// o fator fica gravado por app, fora do zoom por site das guias.
//
// Sessão: o Discord tira o token do localStorage enquanto a página está aberta e só grava de
// volta no beforeunload/pagehide. Fechar o app destruía o webContents sem descarregar a
// página, e o token se perdia (login de novo a cada reinício). Antes de sair, a página de
// cada painel é descarregada (navega para about:blank, o que roda esses handlers) e o
// armazenamento da sessão é gravado em disco. O storage nunca é apagado aqui.
const fs = require("node:fs");
const path = require("node:path");

const { nextZoom } = require("./zoom.cjs");

/** Páginas de login dos apps: chegar nelas ao abrir o painel = a sessão não voltou. */
const LOGIN_PAGES = {
  discord: /^https:\/\/(?:(?:www|canary|ptb)\.)?discord\.com\/login(?:[/?#]|$)/,
};

function isPanelLoginPage(app, url) {
  const pattern = LOGIN_PAGES[app];
  return Boolean(pattern && typeof url === "string" && pattern.test(url));
}

/** Zooms gravados (meta) → só fatores válidos por id de app. */
function parsePanelZooms(value) {
  const zooms = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return zooms;
  for (const [app, factor] of Object.entries(value)) {
    if (/^[a-z0-9-]{1,30}$/.test(app) && typeof factor === "number" && factor >= 0.25) {
      if (factor <= 5 && Math.abs(factor - 1) > 0.001) zooms[app] = factor;
    }
  }
  return zooms;
}

/** Ctrl/⌘ + "=", "+", "-" ou "0" (com ou sem Shift) → direção do zoom; senão null. */
function panelZoomKey(input) {
  if (!input || input.type !== "keyDown" || input.alt) return null;
  if (!(input.control || input.meta)) return null;
  if (input.key === "=" || input.key === "+" || input.code === "NumpadAdd") return 1;
  if (input.key === "-" || input.key === "_" || input.code === "NumpadSubtract") return -1;
  if (input.key === "0" || input.code === "Numpad0") return 0;
  return null;
}

/** Próximo fator do painel (mesmos degraus do zoom das guias). */
function panelZoomStep(current, direction) {
  return nextZoom(current, direction);
}

/**
 * Por que o app pediu login de novo. `previousExit` é o que a última execução gravou ao
 * sair: `{ clean: true }` quando as páginas dos painéis foram descarregadas e o storage
 * gravado. Com saída limpa, quem recusou a sessão foi o próprio app.
 */
function loginReason(app, previousExit, userAgent) {
  if (!previousExit) {
    return `${app}: pediu login (primeira execução com o registro de sessão; sem saída anterior conhecida).`;
  }
  if (!previousExit.clean) {
    return (
      `${app}: pediu login; a última saída não descarregou os painéis (app encerrado à força, ` +
      `queda ou desligamento), então o token pode não ter sido gravado. Storage mantido.`
    );
  }
  const where = Array.isArray(previousExit.apps) && previousExit.apps.includes(app);
  return (
    `${app}: pediu login apesar da saída limpa (${where ? "painel descarregado e storage gravado" : "painel não estava aberto na saída"}); ` +
    `a sessão foi recusada pelo próprio serviço (token expirado/revogado ou política do app para ` +
    `user-agent "${userAgent}" em webview). Storage mantido; nenhum outro painel foi deslogado.`
  );
}

/**
 * Descarrega as páginas (about:blank roda beforeunload/pagehide/unload) e espera cada uma,
 * no máximo `timeoutMs`. `allowUnload(contents)` marca o webContents para o
 * will-prevent-unload não segurar a saída.
 */
function unloadPanelPages(list, { timeoutMs = 1500, allowUnload = () => {} } = {}) {
  const pages = list.filter((contents) => contents && !contents.isDestroyed());
  return Promise.all(
    pages.map(
      (contents) =>
        new Promise((resolve) => {
          const timer = setTimeout(resolve, timeoutMs);
          const done = () => {
            clearTimeout(timer);
            resolve();
          };
          allowUnload(contents);
          contents.loadURL("about:blank").then(done, done);
        }),
    ),
  );
}

/** Registro dos painéis em <userData>/logs/side-panels.log (e no console). */
function createPanelLog(directory) {
  const file = path.join(directory, "side-panels.log");
  return (message) => {
    const line = `${new Date().toISOString()} ${message}`;
    console.log(`Agzos: ${line}`);
    try {
      fs.mkdirSync(directory, { recursive: true });
      fs.appendFileSync(file, `${line}\n`);
    } catch {
      // Sem disco para o log: o console basta.
    }
  };
}

module.exports = {
  LOGIN_PAGES,
  createPanelLog,
  isPanelLoginPage,
  loginReason,
  panelZoomKey,
  panelZoomStep,
  parsePanelZooms,
  unloadPanelPages,
};

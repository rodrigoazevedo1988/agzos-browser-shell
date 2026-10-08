// 4.8 (Fase 1): DevTools do Chromium encaixado na janela, como no Chrome. Cada guia com o
// DevTools aberto ganha um WebContentsView próprio para o frontend
// (setDevToolsWebContents); a casca reserva a área do dock (direita ou embaixo) e manda o
// retângulo, e o main põe a view ali só quando a guia dona está à vista.
//
// Medido no Electron 44 (Chromium 152):
// - openDevTools com mode "right"/"bottom" e um webContents externo carrega o frontend
//   com can_dock=true: o modo dispositivo (Ctrl+Shift+M) existe e, ao sair dele, a guia
//   volta para o Client Hints do Agzos (brands com "Google Chrome"). Com mode "detach" o
//   frontend acha que está solto e esconde o modo dispositivo;
// - com o webContents externo, isDevToolsOpened() responde false: quem sabe se o dock
//   está aberto é este módulo (isOpen), e a hibernação pergunta para ele;
// - o frontend expõe DevToolsAPI.showPanel e DevToolsAPI.enterInspectElementMode, os
//   mesmos que o Chrome usa para Ctrl+Shift+J e Ctrl+Shift+C.

const DOCK_SIDES = Object.freeze(["right", "bottom", "window"]);
const DOCK_WIDTH = Object.freeze({ min: 280, max: 1600, initial: 520 });
const DOCK_HEIGHT = Object.freeze({ min: 160, max: 1200, initial: 320 });
const DEFAULT_DOCK = Object.freeze({
  side: "right",
  width: DOCK_WIDTH.initial,
  height: DOCK_HEIGHT.initial,
});
/** Workspaces lembrados (os mais recentes ficam). */
const MAX_DOCK_ENTRIES = 64;
const READY_TIMEOUT_MS = 8000;
const READY_POLL_MS = 40;
const RELEASE_TIMEOUT_MS = 1500;

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const clamp = (value, { min, max }, fallback) =>
  Number.isFinite(value) ? Math.round(Math.min(max, Math.max(min, value))) : fallback;

/** Lado e tamanho válidos; o que vier errado volta ao padrão. */
function cleanDock(value) {
  const source = isObject(value) ? value : {};
  return {
    side: DOCK_SIDES.includes(source.side) ? source.side : DEFAULT_DOCK.side,
    width: clamp(source.width, DOCK_WIDTH, DEFAULT_DOCK.width),
    height: clamp(source.height, DOCK_HEIGHT, DEFAULT_DOCK.height),
  };
}

/** Chave do workspace: o id numérico da casca, ou "default" sem workspace. */
function dockKey(workspace) {
  return Number.isSafeInteger(workspace) && workspace >= 0 ? String(workspace) : "default";
}

/** Mapa gravado (meta devtoolsDock) só com entradas válidas. */
function cleanDockMap(value) {
  if (!isObject(value)) return {};
  const clean = {};
  for (const [key, dock] of Object.entries(value).slice(-MAX_DOCK_ENTRIES)) {
    if (key === "default" || /^\d{1,12}$/.test(key)) clean[key] = cleanDock(dock);
  }
  return clean;
}

function withDock(map, workspace, dock) {
  const next = cleanDockMap(map);
  const key = dockKey(workspace);
  delete next[key];
  next[key] = cleanDock(dock);
  return cleanDockMap(next);
}

/** Script de cada ação no frontend; null se a ação não existe. */
function frontendScript(action, side) {
  switch (action) {
    case "console":
      return "DevToolsAPI.showPanel('console'); true";
    case "elements":
      return "DevToolsAPI.showPanel('elements'); true";
    case "inspect":
      return "DevToolsAPI.enterInspectElementMode(); true";
    // Ações internas do frontend (módulos ES do próprio DevTools, mesma origem).
    case "device":
      return (
        "import('./ui/legacy/legacy.js').then((UI) => UI.ActionRegistry.ActionRegistry" +
        ".instance().getAction('emulation.toggle-device-mode').execute()).then(() => true)"
      );
    case "side":
      return side === "right" || side === "bottom"
        ? "import('./ui/legacy/legacy.js').then((UI) => { UI.DockController.DockController" +
            `.instance().setDockSide(${JSON.stringify(side)}); return true; })`
        : null;
    default:
      return null;
  }
}

/** Teclas que o próprio dock trata quando o foco está no frontend. */
function dockKeyAction(input) {
  if (input?.type !== "keyDown") return null;
  const key = String(input.key ?? "").toLowerCase();
  const mod = Boolean(input.control || input.meta);
  if (key === "f12" && !mod && !input.shift && !input.alt) return "toggle";
  if (mod && input.shift && !input.alt && key === "i") return "toggle";
  if (mod && input.shift && !input.alt && key === "j") return "console";
  return null;
}

function validRect(rect) {
  if (!isObject(rect)) return null;
  const values = [rect.x, rect.y, rect.width, rect.height];
  if (!values.every((value) => Number.isFinite(value))) return null;
  if (rect.width < 1 || rect.height < 1) return null;
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

/**
 * Docks por guia. `WebContentsView` vem do Electron (ou de um falso nos testes);
 * `onChange(contents, { open, side })` avisa a casca; `onKey(contents, action)` recebe as
 * teclas do frontend (F12 fecha, Ctrl+Shift+J vai para o Console).
 */
function createDevtoolsDocks({
  WebContentsView,
  hiddenRect,
  onChange = () => {},
  onKey = () => {},
  now = () => Date.now(),
}) {
  /** contents.id da guia → { contents, view, window, side, openedAt, ready } */
  const docks = new Map();
  const wired = new WeakSet();

  const notify = (contents, open, side) => {
    try {
      onChange(contents, { open, side });
    } catch {
      // A casca pode já ter fechado.
    }
  };

  function frontendOf(dock) {
    const fe = dock?.view?.webContents;
    return fe && !fe.isDestroyed() ? fe : null;
  }

  /**
   * Tira a view e fecha o frontend. Resolve quando ele foi destruído: enquanto existir,
   * o Electron reabre o DevTools nele mesmo se o pedido for "detach" (medido).
   */
  function dispose(dock) {
    const { view, window } = dock;
    if (!view) return Promise.resolve();
    try {
      if (window && !window.isDestroyed()) window.contentView.removeChildView(view);
    } catch {
      // A janela fechou junto.
    }
    const fe = view.webContents;
    if (!fe || fe.isDestroyed()) return Promise.resolve();
    const gone = new Promise((resolve) => {
      const timer = setTimeout(resolve, RELEASE_TIMEOUT_MS);
      fe.once("destroyed", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    fe.close();
    return gone;
  }

  function forget(contents) {
    const dock = docks.get(contents.id);
    if (!dock) return;
    docks.delete(contents.id);
    dispose(dock);
    notify(contents, false, dock.side);
  }

  /**
   * Ouvintes da guia, uma vez por webContents. Um dock só fecha pelo devtools-closed
   * depois do devtools-opened dele: na troca de lado (direita → janela), o closed do
   * anterior chega depois que o novo já está no mapa.
   */
  function wire(contents) {
    if (wired.has(contents)) return;
    wired.add(contents);
    contents.on("devtools-opened", () => {
      const dock = docks.get(contents.id);
      if (dock) dock.opened = true;
    });
    contents.on("devtools-closed", () => {
      const dock = docks.get(contents.id);
      if (dock?.opened) forget(contents);
    });
    contents.once("destroyed", () => forget(contents));
  }

  /** Abre (ou só troca o lado). `window` é a BaseWindow da guia. */
  function open(contents, { side = DEFAULT_DOCK.side, window } = {}) {
    if (!contents || contents.isDestroyed()) return null;
    const wanted = DOCK_SIDES.includes(side) ? side : DEFAULT_DOCK.side;
    const known = docks.get(contents.id);
    let releasing = null;
    if (known) {
      if (known.side === wanted) return known;
      // Direita ↔ embaixo: a mesma view, o frontend só reorganiza os painéis.
      if (known.view && wanted !== "window") {
        known.side = wanted;
        void run(contents, "side");
        notify(contents, true, wanted);
        return known;
      }
      releasing = close(contents);
    }
    const dock = {
      contents,
      view: null,
      window: window ?? null,
      side: wanted,
      openedAt: now(),
      opened: false,
      ready: null,
    };
    docks.set(contents.id, dock);
    if (wanted === "window") {
      const detach = () => {
        if (docks.get(contents.id) === dock && !contents.isDestroyed()) {
          contents.openDevTools({ mode: "detach", activate: true });
        }
      };
      // Fora da pilha do "destroyed": openDevTools dentro dele derruba o main (SIGTRAP).
      if (releasing) void releasing.then(() => setTimeout(detach, 0));
      else detach();
    } else {
      const view = new WebContentsView({
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
      });
      view.setBounds(hiddenRect);
      const fe = view.webContents;
      // O web-contents-created põe a identidade do Chrome em todo webContents (debugger
      // anexado); o frontend não precisa e o debugger fica livre.
      try {
        if (fe.debugger.isAttached()) fe.debugger.detach();
      } catch {
        // Nada anexado.
      }
      fe.on("before-input-event", (event, input) => {
        const action = dockKeyAction(input);
        if (!action) return;
        event.preventDefault();
        onKey(contents, action);
      });
      fe.once("destroyed", () => {
        if (docks.get(contents.id) === dock) forget(contents);
      });
      dock.view = view;
      if (window && !window.isDestroyed()) window.contentView.addChildView(view);
      contents.setDevToolsWebContents(fe);
      contents.openDevTools({ mode: wanted, activate: false });
    }
    wire(contents);
    notify(contents, true, wanted);
    return dock;
  }

  /** Fecha; devolve a promessa de quando o frontend encaixado sumiu (null se não havia). */
  function close(contents) {
    if (!contents) return null;
    const dock = docks.get(contents.id);
    if (!dock) return null;
    docks.delete(contents.id);
    if (!contents.isDestroyed()) {
      try {
        contents.closeDevTools();
      } catch {
        // Já fechado.
      }
    }
    const released = dispose(dock);
    notify(contents, false, dock.side);
    return released;
  }

  function toggle(contents, options) {
    if (docks.has(contents?.id)) {
      close(contents);
      return false;
    }
    return Boolean(open(contents, options));
  }

  /** Espera o frontend expor a API (até READY_TIMEOUT_MS). */
  function ready(contents) {
    const dock = docks.get(contents?.id);
    if (!dock) return Promise.resolve(false);
    dock.ready ??= waitFrontend(() =>
      dock.view ? frontendOf(dock) : contents.devToolsWebContents,
    );
    return dock.ready;
  }

  async function waitFrontend(frontend) {
    const limit = now() + READY_TIMEOUT_MS;
    while (now() < limit) {
      const fe = frontend();
      if (fe && !fe.isDestroyed()) {
        try {
          if (
            await fe.executeJavaScript("Boolean(window.DevToolsAPI && window.InspectorFrontendAPI)")
          ) {
            return true;
          }
        } catch {
          // Frontend ainda carregando.
        }
      }
      await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
    }
    return false;
  }

  /** Ação no frontend (console, inspect, device, side). */
  async function run(contents, action) {
    const dock = docks.get(contents?.id);
    if (!dock) return false;
    const script = frontendScript(action, dock.side);
    if (!script) return false;
    if (!(await ready(contents))) return false;
    const fe = dock.view ? frontendOf(dock) : contents.devToolsWebContents;
    if (!fe || fe.isDestroyed()) return false;
    try {
      return Boolean(await fe.executeJavaScript(script, true));
    } catch {
      return false;
    }
  }

  /**
   * Põe na área do dock a view da guia à vista (`visible`, um webContents) e esconde as
   * outras da mesma janela. `rect` null esconde todas (aba Terminal, painel por cima).
   */
  function layout(window, { visible = null, rect = null } = {}) {
    const area = validRect(rect);
    for (const dock of docks.values()) {
      if (dock.window !== window || !dock.view) continue;
      const shown = area && visible && dock.contents === visible;
      dock.view.setBounds(shown ? area : hiddenRect);
    }
  }

  /** A guia vai para outra janela: o DevTools fecha (a view é filha da janela antiga). */
  function detachWindow(window) {
    for (const dock of [...docks.values()]) {
      if (dock.window === window) close(dock.contents);
    }
  }

  function closeAll() {
    for (const dock of [...docks.values()]) close(dock.contents);
  }

  return {
    open,
    close,
    closeAll,
    toggle,
    run,
    ready,
    layout,
    detachWindow,
    isOpen: (contents) => Boolean(contents && docks.has(contents.id)),
    sideOf: (contents) => docks.get(contents?.id)?.side ?? null,
    frontend: (contents) => frontendOf(docks.get(contents?.id)),
    views: (window) =>
      [...docks.values()]
        .filter((dock) => dock.window === window && dock.view)
        .map((dock) => dock.view),
    openedAt: (contents) => docks.get(contents?.id)?.openedAt ?? null,
  };
}

module.exports = {
  DEFAULT_DOCK,
  DOCK_HEIGHT,
  DOCK_SIDES,
  DOCK_WIDTH,
  cleanDock,
  cleanDockMap,
  createDevtoolsDocks,
  dockKey,
  dockKeyAction,
  frontendScript,
  validRect,
  withDock,
};

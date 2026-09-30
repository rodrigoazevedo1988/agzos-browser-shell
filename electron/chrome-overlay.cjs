// Camadas da casca por cima da página (1.5.4): prévia da guia, seletor do Ctrl+Tab e os
// painéis da toolbar (menu ⋯, downloads, proteção, site, cofre, favorito).
//
// Por quê: o WebContentsView da guia é desenhado acima do HTML da casca. Até a 1.5.3 um
// painel aberto escondia a guia e a casca mostrava uma foto dela (capturePage): o vídeo
// congelava enquanto o menu estava aberto. Agora o painel vive num WebContentsView
// transparente posto no topo (o mesmo padrão da prévia e do seletor), e a página segue
// pintando por baixo. A foto só volta como plano B (a camada não carregou).
//
// O painel é o mesmo componente React da casca (dist/overlay.html, mesmo bundle): a casca
// manda os dados (IPC) e as funções viram chamadas de volta para ela (overlay:call).

/** Painéis que abrem na camada. */
const OVERLAY_KINDS = new Set([
  "menu",
  "downloads",
  "privacy",
  "site",
  "key",
  "bookmark",
  "palette",
]);
const MAX_FNS = 32;
const NAME = /^[A-Za-z][A-Za-z0-9]{0,40}$/;
const CLASS_NAME = /^[a-z][a-z0-9-]{0,40}$/;

/**
 * WebContentsView transparente, isolado e sem navegação própria. `menuShortcuts: false`
 * para camadas sem campos de texto (prévia, seletor); os painéis mantêm os atalhos do
 * menu nativo (⌘C/⌘V do menu Editar no Mac).
 */
function createLayerView(WebContentsView, { preload = null, menuShortcuts = false } = {}) {
  const view = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      ...(preload ? { preload } : {}),
    },
  });
  view.setBackgroundColor("#00000000");
  view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  const contents = view.webContents;
  contents.on("will-navigate", (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  if (!menuShortcuts) contents.setIgnoreMenuShortcuts(true);
  return view;
}

/** Pedido de abertura vindo da casca, validado (null se inválido). */
function sanitizeOverlay(payload) {
  if (!payload || typeof payload !== "object") return null;
  const { kind, key, data, fns, classes } = payload;
  if (!OVERLAY_KINDS.has(kind)) return null;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return {
    kind,
    key: typeof key === "string" || typeof key === "number" ? String(key).slice(0, 64) : kind,
    data,
    fns: Array.isArray(fns)
      ? fns.filter((name) => typeof name === "string" && NAME.test(name)).slice(0, MAX_FNS)
      : [],
    classes: Array.isArray(classes)
      ? classes.filter((name) => typeof name === "string" && CLASS_NAME.test(name)).slice(0, 8)
      : [],
  };
}

/** Ponto da janela → ponto da página (null fora dela). */
function pagePoint(rect, point) {
  if (!rect || !point) return null;
  const x = Number(point.x);
  const y = Number(point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x < rect.x || y < rect.y || x >= rect.x + rect.width || y >= rect.y + rect.height) {
    return null;
  }
  return { x: Math.round(x - rect.x), y: Math.round(y - rect.y) };
}

/**
 * Rolagem com o painel aberto: vai para a página (como no Comet). O `deltaY` do DOM é
 * positivo para baixo; o do Chromium (sendInputEvent) é positivo para cima.
 */
function wheelEvent(rect, payload) {
  const point = pagePoint(rect, payload);
  if (!point) return null;
  const clamp = (value) => Math.max(-2000, Math.min(2000, Number(value) || 0));
  return {
    type: "mouseWheel",
    x: point.x,
    y: point.y,
    deltaX: -clamp(payload.deltaX),
    deltaY: -clamp(payload.deltaY),
    canScroll: true,
  };
}

const MOUSE_BUTTONS = ["left", "middle", "right"];

/**
 * Clique fora do painel (como no Comet): o painel fecha e o clique vale para o que está
 * embaixo. Eventos para sendInputEvent no ponto dado (coordenadas do alvo).
 */
function clickEvents(point, button) {
  const which = MOUSE_BUTTONS[Number(button)] ?? "left";
  const base = { x: point.x, y: point.y, button: which, clickCount: 1 };
  return [
    { type: "mouseMove", x: point.x, y: point.y },
    { type: "mouseDown", ...base },
    { type: "mouseUp", ...base },
  ];
}

/**
 * AGZOS_DEBUG_OVERLAY=1: loga a estratégia de cada painel (live-overlay | snapshot-fallback)
 * e conta em `globalThis.__agzosOverlay` (os testes leem).
 */
function overlayDebugger(env = process.env) {
  const enabled = env.AGZOS_DEBUG_OVERLAY === "1";
  const counts = { "live-overlay": 0, "snapshot-fallback": 0 };
  if (enabled) globalThis.__agzosOverlay = counts;
  return (strategy, detail = "") => {
    if (!enabled) return;
    counts[strategy] = (counts[strategy] ?? 0) + 1;
    console.log(`[agzos-overlay] strategy=${strategy}${detail ? ` ${detail}` : ""}`);
  };
}

module.exports = {
  OVERLAY_KINDS,
  createLayerView,
  sanitizeOverlay,
  pagePoint,
  wheelEvent,
  clickEvents,
  overlayDebugger,
};

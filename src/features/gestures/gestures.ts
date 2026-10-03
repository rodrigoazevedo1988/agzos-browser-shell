/**
 * Gestos (4.0): trackpad (deslizar com dois dedos, pinça), botões laterais do mouse e
 * gestos desenhados com o botão direito segurado. A detecção roda nas páginas
 * (electron/page-preload.cjs) e na casca; o mapa gesto → ação mora nas preferências.
 */
export type GestureId =
  | "swipe-right"
  | "swipe-left"
  | "pinch"
  | "mouse-back"
  | "mouse-forward"
  | "draw-left"
  | "draw-right"
  | "draw-up-down"
  | "draw-down"
  | "draw-down-right";

export type GestureAction =
  "back" | "forward" | "reload" | "tab-new" | "tab-close" | "zoom" | "none";

export type GestureSetting = { on: boolean; action: GestureAction };
export type GesturePrefs = Record<GestureId, GestureSetting>;

/** Ações que dá para escolher nos gestos de navegação (a pinça só faz zoom). */
export const NAV_ACTIONS: GestureAction[] = [
  "back",
  "forward",
  "reload",
  "tab-new",
  "tab-close",
  "none",
];

export const ACTION_LABELS: Record<GestureAction, string> = {
  back: "Voltar",
  forward: "Avançar",
  reload: "Recarregar",
  "tab-new": "Nova guia",
  "tab-close": "Fechar guia",
  zoom: "Zoom",
  none: "Nada",
};

export const GESTURES: { id: GestureId; label: string; hint: string; fixed?: boolean }[] = [
  {
    id: "swipe-right",
    label: "Deslizar dois dedos para a direita",
    hint: "Trackpad do macOS e do Windows",
  },
  {
    id: "swipe-left",
    label: "Deslizar dois dedos para a esquerda",
    hint: "Trackpad do macOS e do Windows",
  },
  {
    id: "pinch",
    label: "Pinça",
    hint: "Zoom da página ou do painel sob o cursor",
    fixed: true,
  },
  { id: "mouse-back", label: "Botão lateral de trás do mouse", hint: "XButton1" },
  { id: "mouse-forward", label: "Botão lateral da frente do mouse", hint: "XButton2" },
  { id: "draw-left", label: "Botão direito + arrastar ←", hint: "Gesto desenhado" },
  { id: "draw-right", label: "Botão direito + arrastar →", hint: "Gesto desenhado" },
  { id: "draw-up-down", label: "Botão direito + arrastar ↑↓", hint: "Gesto desenhado" },
  { id: "draw-down", label: "Botão direito + arrastar ↓", hint: "Gesto desenhado" },
  { id: "draw-down-right", label: "Botão direito + arrastar ↓→", hint: "Gesto desenhado" },
];

/**
 * Como no Chrome e no Safari: os dedos para a direita voltam (a página anterior "entra"
 * pela esquerda). Dá para inverter nas Configurações.
 */
export const DEFAULT_GESTURES: GesturePrefs = {
  "swipe-right": { on: true, action: "back" },
  "swipe-left": { on: true, action: "forward" },
  pinch: { on: true, action: "zoom" },
  "mouse-back": { on: true, action: "back" },
  "mouse-forward": { on: true, action: "forward" },
  "draw-left": { on: true, action: "back" },
  "draw-right": { on: true, action: "forward" },
  "draw-up-down": { on: true, action: "reload" },
  "draw-down": { on: true, action: "tab-new" },
  "draw-down-right": { on: true, action: "tab-close" },
};

/** Traço desenhado (direções em sequência) → gesto. */
export const STROKE_GESTURES: Record<string, GestureId> = {
  L: "draw-left",
  R: "draw-right",
  UD: "draw-up-down",
  D: "draw-down",
  DR: "draw-down-right",
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function parseGestures(value: unknown): GesturePrefs {
  const raw = isObject(value) ? value : {};
  const result = {} as GesturePrefs;
  for (const { id, fixed } of GESTURES) {
    const item = isObject(raw[id]) ? raw[id] : {};
    const fallback = DEFAULT_GESTURES[id];
    const action = item["action"];
    result[id] = {
      on: typeof item["on"] === "boolean" ? item["on"] : fallback.on,
      action:
        !fixed && typeof action === "string" && (NAV_ACTIONS as string[]).includes(action)
          ? (action as GestureAction)
          : fallback.action,
    };
  }
  return result;
}

/** O que as páginas precisam saber (o main repassa para cada guia e painel). */
export type GestureConfig = { swipe: boolean; pinch: boolean; draw: boolean; mouse: boolean };

export function gestureConfigOf(prefs: GesturePrefs): GestureConfig {
  return {
    swipe: prefs["swipe-right"].on || prefs["swipe-left"].on,
    pinch: prefs.pinch.on,
    draw: GESTURES.some(({ id }) => id.startsWith("draw-") && prefs[id].on),
    mouse: prefs["mouse-back"].on || prefs["mouse-forward"].on,
  };
}

/** Ação do gesto, ou null quando está desligado / sem ação. */
export function gestureAction(prefs: GesturePrefs, id: GestureId): GestureAction | null {
  const setting = prefs[id];
  if (!setting?.on || setting.action === "none") return null;
  return setting.action;
}

export function isGestureId(value: unknown): value is GestureId {
  return typeof value === "string" && GESTURES.some((item) => item.id === value);
}

// --- Detecção (mesma regra do page-preload; aqui para a casca e para os testes) ---

/** Distância horizontal acumulada (px) que conta como deslizar. */
export const SWIPE_DISTANCE = 160;
/** Pausa (ms) que encerra um movimento do trackpad. */
export const SWIPE_GAP_MS = 220;
/** Pinça acumulada (deltaY) por passo de zoom. */
export const PINCH_STEP = 45;
/** Segmento mínimo (px) de um traço do gesto desenhado. */
export const STROKE_SEGMENT = 36;

/**
 * Deslizar com dois dedos: soma o deltaX dos eventos de roda predominantemente
 * horizontais; ao passar do limite dispara uma vez e trava até o movimento acabar.
 * deltaX < 0 (conteúdo indo para a esquerda = dedos para a direita) → "swipe-right".
 */
export function createSwipeTracker(now: () => number = Date.now) {
  let total = 0;
  let last = 0;
  let fired = false;
  return {
    push(deltaX: number, deltaY: number): "swipe-right" | "swipe-left" | null {
      const time = now();
      if (time - last > SWIPE_GAP_MS) {
        total = 0;
        fired = false;
      }
      last = time;
      if (fired) return null;
      if (Math.abs(deltaX) <= Math.abs(deltaY) * 1.5) {
        total = 0;
        return null;
      }
      total += deltaX;
      if (Math.abs(total) < SWIPE_DISTANCE) return null;
      fired = true;
      return total < 0 ? "swipe-right" : "swipe-left";
    },
    reset() {
      total = 0;
      fired = false;
    },
  };
}

/** Pinça: Ctrl+roda com deltas finos (trackpad). Devolve 1 (aproximar), -1 ou 0. */
export function createPinchTracker() {
  let total = 0;
  return {
    push(deltaY: number): 1 | -1 | 0 {
      total += deltaY;
      if (total <= -PINCH_STEP) {
        total = 0;
        return 1;
      }
      if (total >= PINCH_STEP) {
        total = 0;
        return -1;
      }
      return 0;
    },
  };
}

/** Roda de mouse com Ctrl (passos inteiros grandes) não é pinça: o Chromium já trata. */
export function isPinchWheel(deltaY: number, deltaMode: number) {
  return deltaMode === 0 && (Math.abs(deltaY) < 50 || !Number.isInteger(deltaY));
}

/** Pontos do traço → direções ("UD", "DR"…), juntando repetidas. */
export function strokeOf(points: { x: number; y: number }[]): string {
  let result = "";
  let anchor = points[0];
  if (!anchor) return result;
  for (const point of points.slice(1)) {
    const dx = point.x - anchor.x;
    const dy = point.y - anchor.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < STROKE_SEGMENT) continue;
    const direction = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "R" : "L") : dy > 0 ? "D" : "U";
    if (!result.endsWith(direction)) result += direction;
    anchor = point;
  }
  return result;
}

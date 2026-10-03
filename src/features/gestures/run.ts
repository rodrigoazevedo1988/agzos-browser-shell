import type { GestureEvent } from "@/features/browser/desktop";
import { gestureAction, type GesturePrefs } from "./gestures";

/** O que a casca sabe fazer com um gesto (injetado para os testes). */
export type GestureDeps = {
  activeId: number;
  /** Histórico da guia ativa (vale para páginas internas também). */
  step: (delta: -1 | 1) => void;
  /** Histórico de outra guia (o outro pane da tela dividida). */
  navigate: (tabId: number, delta: -1 | 1) => void;
  zoom: (tabId: number, direction: 1 | -1) => void;
  panelZoom: (app: string, direction: 1 | -1) => void;
  panelNav: (app: string, action: "back" | "forward" | "reload") => void;
  /** Comando do registro (commands.ts) para a guia. */
  command: (id: "tab.reload" | "tab.new" | "tab.close", tabId: number) => void;
};

/** Gesto → ação, conforme as preferências e a superfície onde aconteceu. */
export function runGesture(event: GestureEvent, prefs: GesturePrefs, deps: GestureDeps) {
  const { surface } = event;
  if (event.gesture === "pinch") {
    if (!prefs.pinch.on) return false;
    const direction = event.direction === -1 ? -1 : 1;
    if (surface.kind === "panel") deps.panelZoom(surface.app, direction);
    else deps.zoom(surface.kind === "tab" ? surface.id : deps.activeId, direction);
    return true;
  }
  const action = gestureAction(prefs, event.gesture);
  if (!action || action === "zoom") return false;
  if (
    surface.kind === "panel" &&
    (action === "back" || action === "forward" || action === "reload")
  ) {
    deps.panelNav(surface.app, action);
    return true;
  }
  const tabId = surface.kind === "tab" ? surface.id : deps.activeId;
  switch (action) {
    case "back":
    case "forward": {
      const delta = action === "back" ? -1 : 1;
      if (tabId === deps.activeId) deps.step(delta);
      else deps.navigate(tabId, delta);
      return true;
    }
    case "reload":
      deps.command("tab.reload", tabId);
      return true;
    case "tab-new":
      deps.command("tab.new", tabId);
      return true;
    case "tab-close":
      deps.command("tab.close", tabId);
      return true;
    default:
      return false;
  }
}

import { type RefObject, useEffect } from "react";

import type { DesktopBridge, GestureEvent } from "@/features/browser/desktop";
import { createSwipeTracker, gestureConfigOf, type GestureId, type GesturePrefs } from "./gestures";

const EDITABLE = "input, textarea, select, [contenteditable=''], [contenteditable='true']";

/**
 * Gestos na casca (4.0): repassa a configuração para as páginas, recebe os gestos que o
 * main viu e detecta os da própria casca (botões laterais e deslizar nas páginas internas).
 * Na web, os da casca rodam direto.
 */
export function useGestures(
  desktop: DesktopBridge | null,
  prefs: GesturePrefs,
  run: RefObject<(event: GestureEvent) => void>,
) {
  const config = gestureConfigOf(prefs);
  const configKey = JSON.stringify(config);
  useEffect(() => {
    void desktop?.gesturesConfig(JSON.parse(configKey));
  }, [desktop, configKey]);

  useEffect(() => desktop?.onGesture((event) => run.current(event)), [desktop, run]);

  useEffect(() => {
    let lastKeyAt = 0;
    const typing = () =>
      Date.now() - lastKeyAt < 1500 &&
      document.activeElement instanceof Element &&
      document.activeElement.matches(EDITABLE);
    const fire = (gesture: GestureId) => {
      if (desktop) desktop.gesture(gesture);
      else run.current({ gesture, surface: { kind: "active" } });
    };
    const onKey = () => {
      lastKeyAt = Date.now();
    };
    const onMouseUp = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      event.preventDefault();
      if (!typing()) fire(event.button === 3 ? "mouse-back" : "mouse-forward");
    };
    // Deslizar só sobre a página interna (Início, Configurações…), fora de listas que rolam
    // para o lado.
    const swipe = createSwipeTracker();
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || !(event.target instanceof Element)) return;
      if (!event.target.closest(".viewport") || typing()) return;
      for (let el: Element | null = event.target; el; el = el.parentElement) {
        if (
          el.scrollWidth > el.clientWidth + 1 &&
          /auto|scroll/.test(getComputedStyle(el).overflowX)
        ) {
          swipe.reset();
          return;
        }
      }
      const gesture = swipe.push(event.deltaX, event.deltaY);
      if (gesture) fire(gesture);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mouseup", onMouseUp, true);
    window.addEventListener("wheel", onWheel, { capture: true, passive: true });
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mouseup", onMouseUp, true);
      window.removeEventListener("wheel", onWheel, true);
    };
  }, [desktop, run]);
}

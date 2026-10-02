import { useEffect, useRef } from "react";

import { playSound } from "./player";
import { createThrottle, isTypingKey, soundGain, type SoundPrefs } from "./sounds";

/**
 * Liga os sons da casca: hover em `[data-sound="hover"]` (uma vez ao entrar no elemento) e
 * teclas em campos dentro de `[data-sound="keys"]`. Um ouvinte só, no documento.
 */
export function useUiSounds(prefs: SoundPrefs) {
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  useEffect(() => {
    const allow = createThrottle();
    const onOver = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const target = event.target instanceof Element ? event.target : null;
      const item = target?.closest('[data-sound="hover"]');
      if (!item) return;
      // Só ao entrar: mover dentro do mesmo card não repete o som.
      if (event.relatedTarget instanceof Node && item.contains(event.relatedTarget)) return;
      const gain = soundGain(prefsRef.current, "hover");
      if (gain > 0 && allow("hover", performance.now())) playSound("nav", gain);
    };
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.matches("input, textarea") || !target.closest('[data-sound="keys"]')) return;
      if (!isTypingKey(event)) return;
      const gain = soundGain(prefsRef.current, "key");
      if (gain > 0 && allow("key", performance.now())) {
        playSound(prefsRef.current.soundTick, gain, 0.94 + Math.random() * 0.12);
      }
    };
    document.addEventListener("pointerover", onOver, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerover", onOver, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, []);
}

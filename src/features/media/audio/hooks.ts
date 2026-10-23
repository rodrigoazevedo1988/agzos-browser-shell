import { useEffect, useState, useSyncExternalStore } from "react";

import type { MediaLibrary } from "@/features/browser/persistence/snapshot";
import { emptyMedia } from "@/features/browser/persistence/snapshot";
import { subscribeTags, tagVersionOf } from "./library";
import { libraryNow, reloadLibrary, subscribeLibrary } from "./store";
import type { EngineState, MusicEngine } from "./engine";

const EMPTY_STATE = (): EngineState => ({
  queue: { source: [], order: [], index: -1, shuffle: false, repeat: "off" },
  track: null,
  playing: false,
  duration: 0,
  volume: 1,
  muted: false,
  crossfade: 0,
  error: null,
});
let fallbackState: EngineState | null = null;
const noop = () => () => undefined;
const zero = () => 0;

/** Estado do motor (faixa, fila, volume). Sem motor (web), um estado vazio fixo. */
export function useEngineState(engine: MusicEngine | null): EngineState {
  fallbackState ??= EMPTY_STATE();
  return useSyncExternalStore(
    engine ? engine.subscribe : noop,
    engine ? engine.getState : () => fallbackState!,
    () => fallbackState!,
  );
}

/** Posição da faixa; muda várias vezes por segundo, em canal próprio. */
export function usePosition(engine: MusicEngine | null): number {
  return useSyncExternalStore(
    engine ? engine.subscribeTime : noop,
    engine ? engine.getPosition : zero,
    zero,
  );
}

/** Muda quando algum tag (título, capa, duração) chega: a lista se redesenha. */
export function useTagVersion(): number {
  return useSyncExternalStore(subscribeTags, tagVersionOf, tagVersionOf);
}

/** Biblioteca (favoritos, pastas, playlists): carrega, acompanha gravações e foco da janela. */
export function useLibrary(): MediaLibrary {
  const [library, setLibrary] = useState<MediaLibrary>(emptyMedia);
  useEffect(() => {
    let alive = true;
    void libraryNow().then((next) => alive && setLibrary(next));
    const unsubscribe = subscribeLibrary((next) => alive && setLibrary(next));
    const focus = () => void reloadLibrary().catch(() => undefined);
    window.addEventListener("focus", focus);
    return () => {
      alive = false;
      unsubscribe();
      window.removeEventListener("focus", focus);
    };
  }, []);
  return library;
}

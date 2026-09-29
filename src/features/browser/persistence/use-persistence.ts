import { useEffect, useMemo, useRef, type Dispatch } from "react";

import type { BrowserAction } from "../store/reducer";
import type { BrowserState } from "../store/state";
import { snapshotOf, toHydratePayload, type Snapshot } from "./snapshot";
import { defaultBrowserStore, type BrowserStore } from "./store";

// No StrictMode o efeito de carga roda duas vezes: a leitura (e a migração da 1.3)
// precisa acontecer uma vez só por store.
const loads = new WeakMap<BrowserStore, Promise<Snapshot | null>>();
function loadOnce(store: BrowserStore) {
  let pending = loads.get(store);
  if (!pending) {
    pending = store.load().catch(() => null);
    loads.set(store, pending);
  }
  return pending;
}

/** Carrega o snapshot uma vez e grava as mudanças depois disso. */
export function usePersistence(
  state: BrowserState,
  dispatch: Dispatch<BrowserAction>,
  injected?: BrowserStore | null,
) {
  const store = useMemo(() => injected ?? defaultBrowserStore(), [injected]);
  const pending = useRef<ReturnType<typeof snapshotOf> | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!store) return;
    let cancelled = false;
    loadOnce(store).then((snapshot) => {
      if (!cancelled) dispatch({ type: "hydrate", payload: toHydratePayload(snapshot) });
    });
    return () => {
      cancelled = true;
    };
  }, [dispatch, store]);

  const { hydrated, tabs, activeId, prefs, links, closedTabs } = state;
  // Só as partes persistidas disparam gravação; antes do load nada é gravado.
  const snapshot = useMemo(
    () => (hydrated ? snapshotOf({ tabs, activeId, prefs, links, closedTabs }) : null),
    [hydrated, tabs, activeId, prefs, links, closedTabs],
  );

  useEffect(() => {
    if (!store || !snapshot) return;
    const flush = () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
      const next = pending.current;
      pending.current = null;
      if (next) void store.save(next).catch(() => {});
    };
    pending.current = snapshot;
    if (store.debounceMs <= 0) {
      flush();
      return;
    }
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, store.debounceMs);
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [snapshot, store]);
}

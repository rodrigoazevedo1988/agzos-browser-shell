import { desktopBridge, type DesktopBridge } from "../desktop";
import {
  SNAPSHOT_VERSION,
  clearLegacy,
  parseSnapshot,
  readLegacySnapshot,
  type Snapshot,
  type StorageLike,
} from "./snapshot";

/** Onde o estado do navegador mora. O renderer nunca fala direto com localStorage/SQLite. */
export type BrowserStore = {
  kind: "local" | "sqlite";
  /** Atraso para agrupar gravações seguidas (0 = grava na hora). */
  debounceMs: number;
  load(): Promise<Snapshot | null>;
  save(snapshot: Snapshot): Promise<void>;
};

export const STATE_KEY = "agzos-state";

export function createLocalStore(storage: StorageLike): BrowserStore {
  return {
    kind: "local",
    debounceMs: 0,
    async load() {
      let stored: unknown = null;
      try {
        stored = JSON.parse(storage.getItem(STATE_KEY) ?? "null");
      } catch {
        stored = null;
      }
      const snapshot = parseSnapshot(stored);
      if (snapshot) return snapshot;
      const legacy = readLegacySnapshot(storage);
      if (!legacy) return null;
      await this.save(legacy);
      clearLegacy(storage);
      return legacy;
    },
    async save(snapshot) {
      storage.setItem(STATE_KEY, JSON.stringify(snapshot));
    },
  };
}

/**
 * SQLite no processo principal (electron/db.cjs). Se o banco não abrir, cai no
 * localStorage do app para não perder a sessão.
 */
export function createDesktopStore(bridge: DesktopBridge, storage: StorageLike): BrowserStore {
  const fallback = createLocalStore(storage);
  let available = true;
  // Última versão gravada de cada seção: só o que mudou vai para o SQLite (trocar de aba
  // não regrava a árvore de favoritos inteira).
  const written = new Map<string, string>();
  const changedSections = (snapshot: Snapshot) => {
    const changed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(sectionsOf(snapshot))) {
      const json = JSON.stringify(value);
      if (written.get(key) === json) continue;
      changed[key] = value;
    }
    return changed;
  };
  const remember = (sections: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(sections)) written.set(key, JSON.stringify(value));
  };
  return {
    kind: "sqlite",
    debounceMs: 300,
    async load() {
      const result = await bridge.stateLoad();
      if (!result.available) {
        available = false;
        return fallback.load();
      }
      const snapshot = parseSnapshot(result.sections);
      if (snapshot) return snapshot;
      // Primeiro boot da 1.4: traz o estado que a 1.3 deixou no localStorage do app.
      const legacy = readLegacySnapshot(storage);
      if (!legacy) return null;
      const saved = await bridge.stateSave(sectionsOf(legacy));
      if (saved.ok) clearLegacy(storage);
      return legacy;
    },
    async save(snapshot) {
      if (!available) return fallback.save(snapshot);
      const sections = changedSections(snapshot);
      if (!Object.keys(sections).length) return;
      const result = await bridge.stateSave(sections);
      if (result.ok) remember(sections);
    },
  };
}

function sectionsOf(snapshot: Snapshot): Record<string, unknown> {
  return {
    version: SNAPSHOT_VERSION,
    prefs: snapshot.prefs,
    session: snapshot.session,
    links: snapshot.links,
    closedTabs: snapshot.closedTabs,
    bookmarks: snapshot.bookmarks,
  };
}

export function defaultBrowserStore(): BrowserStore | null {
  if (typeof window === "undefined") return null;
  const bridge = desktopBridge();
  return bridge
    ? createDesktopStore(bridge, window.localStorage)
    : createLocalStore(window.localStorage);
}

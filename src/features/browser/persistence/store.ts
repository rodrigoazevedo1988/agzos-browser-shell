import { parseBookmarks } from "../bookmarks";
import { desktopBridge, type DesktopBridge } from "../desktop";
import type { SyncPayload } from "../store/reducer";
import {
  SNAPSHOT_VERSION,
  clearLegacy,
  parseClosedTabs,
  parseLinks,
  parsePrefs,
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
  /** Mudanças gravadas por outra janela do app (só no desktop). */
  subscribe?(onSync: (payload: SyncPayload) => void): () => void;
};

/** Seções que outra janela gravou → o que muda nesta (valores já normalizados). */
export function syncPayloadOf(sections: Record<string, unknown>): SyncPayload {
  const payload: SyncPayload = {};
  if ("prefs" in sections) payload.prefs = parsePrefs(sections["prefs"]);
  if ("links" in sections) payload.links = parseLinks(sections["links"]);
  if ("closedTabs" in sections) payload.closedTabs = parseClosedTabs(sections["closedTabs"]);
  if ("bookmarks" in sections) {
    const bookmarks = parseBookmarks(sections["bookmarks"]);
    if (bookmarks) payload.bookmarks = bookmarks;
  }
  return payload;
}

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
      // Janela aberta com guias (guia movida, link em nova janela) antes de a primeira
      // janela gravar as preferências: vale a sessão, o resto fica no padrão.
      const sections =
        "session" in result.sections && !("version" in result.sections)
          ? { ...result.sections, version: SNAPSHOT_VERSION }
          : result.sections;
      const snapshot = parseSnapshot(sections);
      if (snapshot) {
        // O que veio do SQLite não é regravado (nem espalhado para as outras janelas):
        // uma janela nova não desfaz o que outra acabou de mudar. Sem as seções
        // compartilhadas (janela aberta antes da primeira gravação), os padrões também
        // não sobrescrevem nada.
        const loaded = sectionsOf(snapshot);
        const known = Object.keys(result.sections).length && "version" in result.sections;
        remember(
          Object.fromEntries(
            Object.entries(loaded).filter(([key]) =>
              known ? key in result.sections : key !== "session",
            ),
          ),
        );
        return snapshot;
      }
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
    subscribe(onSync) {
      return bridge.onStateSync((sections) => {
        if (!sections || typeof sections !== "object") return;
        const payload = syncPayloadOf(sections);
        // O que veio de fora já está gravado: não volta para o SQLite (nem para as outras
        // janelas, o que viraria um pingue-pongue).
        remember(payload as Record<string, unknown>);
        onSync(payload);
      });
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

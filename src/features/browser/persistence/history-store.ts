import { desktopBridge, type DesktopBridge, type HistoryQuery } from "../desktop";
import type { HistoryUrl, HistoryVisit } from "../types";
import type { StorageLike } from "./snapshot";

/**
 * Histórico global. No app o main registra as visitas (did-navigate) e guarda no SQLite;
 * na versão web (preview) a casca registra e guarda as últimas visitas no localStorage.
 */
export type HistoryStore = {
  kind: "local" | "sqlite";
  /** Só na web: no app quem registra é o main. */
  add(visit: { url: string; title: string; at?: number }): Promise<void>;
  list(query?: HistoryQuery): Promise<HistoryVisit[]>;
  search(text: string, limit?: number): Promise<HistoryUrl[]>;
  delete(ids: number[]): Promise<void>;
  deleteUrl(url: string): Promise<void>;
  clear(range?: { from?: number; to?: number }): Promise<void>;
};

export const HISTORY_KEY = "agzos-history";
const LOCAL_LIMIT = 2000;
const SAME_VISIT_MS = 30 * 1000;

const matches = (visit: { url: string; title: string }, terms: string[]) =>
  terms.every(
    (term) => visit.url.toLowerCase().includes(term) || visit.title.toLowerCase().includes(term),
  );
const termsOf = (text?: string) => (text ?? "").toLowerCase().split(/\s+/).filter(Boolean);

export function createLocalHistory(storage: StorageLike): HistoryStore {
  const read = (): HistoryVisit[] => {
    try {
      const value = JSON.parse(storage.getItem(HISTORY_KEY) ?? "[]") as unknown;
      return Array.isArray(value)
        ? value.filter(
            (item): item is HistoryVisit =>
              typeof item === "object" &&
              item !== null &&
              typeof item.id === "number" &&
              typeof item.url === "string" &&
              typeof item.title === "string" &&
              typeof item.visitedAt === "number",
          )
        : [];
    } catch {
      return [];
    }
  };
  const write = (visits: HistoryVisit[]) => {
    if (visits.length) storage.setItem(HISTORY_KEY, JSON.stringify(visits.slice(0, LOCAL_LIMIT)));
    else storage.removeItem(HISTORY_KEY);
  };
  return {
    kind: "local",
    async add({ url, title, at = Date.now() }) {
      const visits = read();
      const last = visits.find((visit) => visit.url === url);
      if (last && at - last.visitedAt < SAME_VISIT_MS) {
        last.visitedAt = at;
        if (title) last.title = title;
        write([last, ...visits.filter((visit) => visit !== last)]);
        return;
      }
      const id = visits.reduce((max, visit) => Math.max(max, visit.id), 0) + 1;
      write([{ id, url, title: title || (last?.title ?? ""), visitedAt: at }, ...visits]);
    },
    async list({ text, before, limit = 100 } = {}) {
      const terms = termsOf(text);
      return read()
        .filter((visit) => (before ? visit.visitedAt < before : true) && matches(visit, terms))
        .sort((a, b) => b.visitedAt - a.visitedAt)
        .slice(0, limit);
    },
    async search(text, limit = 40) {
      const terms = termsOf(text);
      if (!terms.length) return [];
      const byUrl = new Map<string, HistoryUrl>();
      for (const visit of read()) {
        if (!matches(visit, terms)) continue;
        const found = byUrl.get(visit.url);
        if (found) {
          found.visitCount++;
          if (visit.visitedAt > found.lastVisit) found.lastVisit = visit.visitedAt;
          if (!found.title) found.title = visit.title;
        } else {
          byUrl.set(visit.url, {
            url: visit.url,
            title: visit.title,
            visitCount: 1,
            lastVisit: visit.visitedAt,
          });
        }
      }
      return [...byUrl.values()]
        .sort((a, b) => b.visitCount - a.visitCount || b.lastVisit - a.lastVisit)
        .slice(0, limit);
    },
    async delete(ids) {
      const doomed = new Set(ids);
      write(read().filter((visit) => !doomed.has(visit.id)));
    },
    async deleteUrl(url) {
      write(read().filter((visit) => visit.url !== url));
    },
    async clear({ from = 0, to = Number.MAX_SAFE_INTEGER } = {}) {
      write(read().filter((visit) => visit.visitedAt < from || visit.visitedAt > to));
    },
  };
}

export function createDesktopHistory(bridge: DesktopBridge): HistoryStore {
  return {
    kind: "sqlite",
    async add() {
      // O main registra as visitas das abas.
    },
    list: (query) => bridge.historyList(query),
    search: (text, limit) => bridge.historySearch(text, limit),
    delete: (ids) => bridge.historyDelete(ids),
    deleteUrl: (url) => bridge.historyDeleteUrl(url),
    clear: (range) => bridge.historyClear(range),
  };
}

let shared: HistoryStore | null = null;
export function defaultHistoryStore(): HistoryStore | null {
  if (typeof window === "undefined") return null;
  if (!shared) {
    const bridge = desktopBridge();
    shared = bridge ? createDesktopHistory(bridge) : createLocalHistory(window.localStorage);
  }
  return shared;
}

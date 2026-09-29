/** "internal": páginas da própria casca (agzos://historico, agzos://favoritos). */
export type Entry = { title: string; url: string; kind: "home" | "page" | "internal" };
export type Tab = {
  id: number;
  history: Entry[];
  index: number;
  pinned?: boolean | undefined;
  private?: boolean | undefined;
  muted?: boolean | undefined;
  favicon?: string | undefined;
};
export type ClosedTab = { title: string; url: string };
export type TabOrientation = "horizontal" | "vertical";
export type Credential = { domain: string; user: string; password: string };
export type QuickLink = { name: string; url: string };
export type EngineId = "duckduckgo" | "yandex";

/** Pastas fixas da árvore de favoritos (não podem ser apagadas nem movidas). */
export const BOOKMARK_BAR = "bar";
export const BOOKMARK_OTHER = "other";
export type BookmarkRoot = typeof BOOKMARK_BAR | typeof BOOKMARK_OTHER;

/**
 * Favorito ou pasta. A árvore fica numa lista plana: cada nó aponta para a pasta onde
 * está (`parentId`) e a ordem dentro da pasta é a ordem da lista.
 */
export type BookmarkNode = {
  id: string;
  parentId: string;
  kind: "url" | "folder";
  title: string;
  /** Só nos favoritos (kind "url"), sempre com http(s)://. */
  url?: string | undefined;
  icon?: string | undefined;
  createdAt: number;
};

/** Visita registrada no histórico (SQLite no app, localStorage na web). */
export type HistoryVisit = {
  id: number;
  url: string;
  title: string;
  visitedAt: number;
  icon?: string | null | undefined;
};

/** Página do histórico com contagem de visitas (base das sugestões da omnibox). */
export type HistoryUrl = {
  url: string;
  title: string;
  visitCount: number;
  lastVisit: number;
  icon?: string | null | undefined;
};

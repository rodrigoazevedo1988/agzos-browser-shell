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
  /** Grupo de guias (2.0). */
  groupId?: number | undefined;
  /** Workspace da guia (2.0); sem valor = o workspace padrão. */
  workspaceId?: number | undefined;
  /**
   * Session Tab (4.5): cookies e localStorage numa partição só dela, com uma cor. Links
   * abertos dela e a duplicata ficam na mesma sessão.
   */
  session?: TabSession | undefined;
};

export type TabSession = { id: string; color: string };

/** Nota de uma página (4.5): markdown simples, guardada localmente pela chave da URL. */
export type PageNote = { url: string; title: string; text: string; updatedAt: number };
export const NOTES_LIMIT = 500;
export const NOTE_TEXT_LIMIT = 100_000;

/** Chave da nota: origem + caminho + busca (sem o #). Páginas internas usam a URL toda. */
export function noteKeyOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return `${parsed.origin}${parsed.pathname}${parsed.search}`;
    }
    if (parsed.protocol === "agzos:" || parsed.protocol === "file:") return url.split("#")[0]!;
    return null;
  } catch {
    return null;
  }
}

/** Cores das Session Tabs, na ordem em que são usadas. */
export const SESSION_TAB_COLORS = [
  "#2563EB",
  "#16A34A",
  "#D97706",
  "#9333EA",
  "#0891B2",
  "#DB2777",
  "#65A30D",
  "#475569",
] as const;

export const SESSION_ID_RE = /^[a-z0-9-]{4,40}$/;

/** Sessão nova: a primeira cor que nenhuma Session Tab aberta usa (depois, em rodízio). */
export function newTabSession(tabs: Pick<Tab, "session">[], id: string): TabSession {
  const used = new Map<string, number>();
  for (const tab of tabs) {
    if (tab.session) used.set(tab.session.color, (used.get(tab.session.color) ?? 0) + 1);
  }
  const color =
    SESSION_TAB_COLORS.find((item) => !used.has(item)) ??
    [...SESSION_TAB_COLORS].sort((a, b) => (used.get(a) ?? 0) - (used.get(b) ?? 0))[0]!;
  return { id, color };
}

export const TAB_GROUP_COLORS = [
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
] as const;
export type TabGroupColor = (typeof TAB_GROUP_COLORS)[number];
/** Grupo de guias, como no Chrome: nome, cor e recolhido. As guias apontam para ele. */
export type TabGroup = {
  id: number;
  title: string;
  color: TabGroupColor;
  collapsed?: boolean | undefined;
};
/** Workspace (como no Opera/Vivaldi): um conjunto de guias com nome e ícone. */
export type Workspace = { id: number; name: string; icon: string };
/** Tela dividida: duas guias lado a lado; `ratio` é a largura da primeira (0–1). */
export type SplitView = { ids: [number, number]; ratio: number };
export type ClosedTab = { title: string; url: string };
export type TabOrientation = "horizontal" | "vertical";
export type Credential = { domain: string; user: string; password: string };

/**
 * Entrada do cofre Agzos Key, já decifrada (só existe no renderer em memória). Espelha o
 * PasswordEntry do Agzos Key — ver docs/integracao-agzos-browser.md.
 */
export type VaultEntry = {
  id: string;
  type?: "login" | "secure_note" | "card" | "wifi";
  title: string;
  username?: string;
  password?: string;
  url?: string;
  notes?: string;
  category: string;
  totpSecret?: string;
  folderId?: string;
  tags?: string[];
  favorite?: boolean;
  passwordUpdatedAt?: number;
  updatedAt: number;
  deletedAt?: number | null;
};

/** Estado do pareamento/desbloqueio do Agzos Key (sem segredos). */
export type KeyState = {
  paired: boolean;
  unlocked: boolean;
  accountEmail: string | null;
  deviceId: string;
};

/** Atalho da home e card do Discador; `category` agrupa os cards (3.1.1). */
export type QuickLink = { name: string; url: string; category?: string | undefined };
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

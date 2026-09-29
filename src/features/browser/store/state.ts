import type {
  AdblockStats,
  BlockedTracker,
  CrashReason,
  DownloadRecord,
  LoadFailure,
} from "../desktop";
import type {
  BookmarkNode,
  ClosedTab,
  EngineId,
  Entry,
  QuickLink,
  Tab,
  TabOrientation,
} from "../types";

export const HOME_URL = "agzos://inicio";
export const HISTORY_URL = "agzos://historico";
export const BOOKMARKS_URL = "agzos://favoritos";
export const SETTINGS_URL = "agzos://configuracoes";
export const homeEntry: Entry = { title: "Nova aba", url: HOME_URL, kind: "home" };
export const CLOSED_TABS_LIMIT = 20;

export const defaultLinks: QuickLink[] = [
  { name: "GitHub", url: "github.com" },
  { name: "Figma", url: "figma.com" },
  { name: "Notion", url: "notion.so" },
  { name: "Linear", url: "linear.app" },
];

export type Prefs = {
  dark: boolean;
  engine: EngineId;
  shield: boolean;
  aiOpen: boolean;
  orientation: TabOrientation;
  railCollapsed: boolean;
  pausedHosts: string[];
  /** Barra de favoritos abaixo da barra de endereço. */
  bookmarksBar: boolean;
  /** Sugestões do motor de busca na omnibox (o texto digitado vai para o buscador). */
  searchSuggestions: boolean;
  /** Hibernar guias sem uso (o main fecha a página e a recria ao voltar). */
  hibernate: boolean;
  /** Minutos sem uso antes de hibernar (ver HIBERNATE_MINUTES). */
  hibernateMinutes: number;
};

/** Mesma lista de electron/hibernate.cjs (o primeiro é o padrão). */
export const HIBERNATE_MINUTES = [30, 15, 60, 120] as const;

export const defaultPrefs: Prefs = {
  dark: false,
  engine: "duckduckgo",
  shield: true,
  aiOpen: true,
  orientation: "horizontal",
  railCollapsed: false,
  pausedHosts: [],
  bookmarksBar: true,
  searchSuggestions: true,
  hibernate: true,
  hibernateMinutes: 30,
};

export type ViewNav = { canBack: boolean; canForward: boolean };
export type PageBlocked = { count: number; trackers: BlockedTracker[] };
export type FindResult = { id: number; active: number; total: number };

export type BrowserState = {
  // Persistido (ver persistence/snapshot.ts).
  tabs: Tab[];
  activeId: number;
  closedTabs: ClosedTab[];
  links: QuickLink[];
  bookmarks: BookmarkNode[];
  prefs: Prefs;
  // Só em memória.
  nextId: number;
  address: string;
  /** O usuário mexeu na barra: a página carregando não sobrescreve o texto (como no Chrome). */
  addressEdited: boolean;
  hydrated: boolean;
  viewNav: ViewNav | null;
  audioPlaying: number[];
  crashed: number[];
  /** Por que a página caiu (falta de memória, encerrada…). */
  crashReasons: Record<number, CrashReason>;
  /** Página que não carregou (sem internet, endereço inexistente, certificado…). */
  failed: Record<number, LoadFailure>;
  /** Guias sem página carregada no momento (hibernadas ou ainda não abertas). */
  hibernated: number[];
  /** Página travada (loop): a casca oferece esperar ou encerrar. */
  unresponsive: number[];
  /** Guias com vídeo em picture-in-picture. */
  pip: number[];
  loginRejected: Record<number, string>;
  requestedUrl: { id: number; url: string } | null;
  fullscreen: boolean;
  /** Bloqueios reais do adblock na página atual de cada aba (desktop). */
  blocked: Record<number, PageBlocked>;
  /** Zoom de cada aba (1 = 100 %). */
  zoom: Record<number, number>;
  find: FindResult | null;
  downloads: DownloadRecord[];
  adblock: AdblockStats | null;
  /** Abas em ordem de uso, a mais recente primeiro (Ctrl+Tab). */
  recent: number[];
  /** Seletor do Ctrl+Tab aberto: abas em ordem de uso e a selecionada. */
  switcher: { ids: number[]; index: number } | null;
  /** Miniatura (data URL) da última vez que cada aba esteve visível (desktop). */
  thumbnails: Record<number, string>;
};

export const initialState: BrowserState = {
  tabs: [{ id: 1, history: [homeEntry], index: 0 }],
  activeId: 1,
  closedTabs: [],
  links: defaultLinks,
  bookmarks: [],
  prefs: defaultPrefs,
  nextId: 2,
  address: HOME_URL,
  addressEdited: false,
  hydrated: false,
  viewNav: null,
  audioPlaying: [],
  crashed: [],
  crashReasons: {},
  failed: {},
  hibernated: [],
  unresponsive: [],
  pip: [],
  loginRejected: {},
  requestedUrl: null,
  fullscreen: false,
  blocked: {},
  zoom: {},
  find: null,
  downloads: [],
  adblock: null,
  recent: [1],
  switcher: null,
  thumbnails: {},
};

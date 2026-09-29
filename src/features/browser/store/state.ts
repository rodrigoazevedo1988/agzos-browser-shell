import type { AdblockStats, BlockedTracker, DownloadRecord } from "../desktop";
import type { ClosedTab, EngineId, Entry, QuickLink, Tab, TabOrientation } from "../types";

export const HOME_URL = "agzos://inicio";
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
};

export const defaultPrefs: Prefs = {
  dark: false,
  engine: "duckduckgo",
  shield: true,
  aiOpen: true,
  orientation: "horizontal",
  railCollapsed: false,
  pausedHosts: [],
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
  prefs: Prefs;
  // Só em memória.
  nextId: number;
  address: string;
  hydrated: boolean;
  viewNav: ViewNav | null;
  audioPlaying: number[];
  crashed: number[];
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
};

export const initialState: BrowserState = {
  tabs: [{ id: 1, history: [homeEntry], index: 0 }],
  activeId: 1,
  closedTabs: [],
  links: defaultLinks,
  prefs: defaultPrefs,
  nextId: 2,
  address: HOME_URL,
  hydrated: false,
  viewNav: null,
  audioPlaying: [],
  crashed: [],
  loginRejected: {},
  requestedUrl: null,
  fullscreen: false,
  blocked: {},
  zoom: {},
  find: null,
  downloads: [],
  adblock: null,
};

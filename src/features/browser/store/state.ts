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
  SplitView,
  Tab,
  TabGroup,
  TabOrientation,
  PageNote,
  Workspace,
} from "../types";

import { DEFAULT_LIMITS } from "../control/limits";
import { DEFAULT_SIDE_PANELS, SIDE_PANEL_WIDTH } from "../side-panels";
import { DEFAULT_SOUND_TICK, type SoundTick } from "@/features/sounds/sounds";
import { DEFAULT_GESTURES, type GesturePrefs } from "@/features/gestures/gestures";
import { TERMINAL_HEIGHT } from "@/features/terminal/model";
import { DEFAULT_TERMINAL, type TerminalSettings } from "@/features/terminal/config";

export const HOME_URL = "agzos://inicio";
export const HISTORY_URL = "agzos://historico";
export const BOOKMARKS_URL = "agzos://favoritos";
export const SETTINGS_URL = "agzos://configuracoes";
/** Discador (3.0): grade de sites ao lado da página inicial. */
export const DIAL_URL = "agzos://discador";
/** API Scratchpad (4.5): reenviar requisições capturadas da guia. */
export const SCRATCHPAD_URL = "agzos://scratchpad";
export const homeEntry: Entry = { title: "Nova aba", url: HOME_URL, kind: "home" };
export const CLOSED_TABS_LIMIT = 20;
/** Workspace de toda guia sem `workspaceId` (o primeiro, que não pode ser apagado). */
export const DEFAULT_WORKSPACE_ID = 1;
export const defaultWorkspaces: Workspace[] = [
  { id: DEFAULT_WORKSPACE_ID, name: "Pessoal", icon: "🏠" },
];

export const defaultLinks: QuickLink[] = [
  { name: "GitHub", url: "github.com" },
  { name: "Figma", url: "figma.com" },
  { name: "Notion", url: "notion.so" },
  { name: "Linear", url: "linear.app" },
];

/** Cards do Discador num perfil novo. */
export const defaultDial: QuickLink[] = [
  { name: "YouTube", url: "youtube.com" },
  { name: "Gmail", url: "mail.google.com" },
  { name: "WhatsApp", url: "web.whatsapp.com" },
  { name: "Wikipédia", url: "pt.wikipedia.org" },
  { name: "GitHub", url: "github.com" },
  { name: "ChatGPT", url: "chatgpt.com" },
  { name: "Claude", url: "claude.ai" },
  { name: "Reddit", url: "reddit.com" },
];

export type Prefs = {
  dark: boolean;
  engine: EngineId;
  shield: boolean;
  aiOpen: boolean;
  /** Barra de conversas do Agzos AI (4.1.3) aberta ao lado do chat. */
  aiSidebar: boolean;
  /** Painel de notas (4.5) aberto ao lado da página. */
  notesOpen: boolean;
  /** Tamanho da letra do modo leitura (4.5), em px. */
  readerFontSize: number;
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
  /** Barra lateral com os painéis (WhatsApp, Telegram…), 2.0. */
  sidebar: boolean;
  /** Painéis que aparecem na barra lateral (ids de side-panels.ts), na ordem. */
  sidePanels: string[];
  /** Apps que o perfil já conhece (os novos de uma versão entram uma vez na barra). */
  sidePanelsSeen: string[];
  /** GX Control (3.0): teto de memória do navegador (hiberna as guias mais pesadas). */
  ramLimitOn: boolean;
  ramLimitMB: number;
  /** GX Control: teto de CPU (%); acima dele as guias em segundo plano são desaceleradas. */
  cpuLimitOn: boolean;
  cpuLimitPercent: number;
  /** GX Control: limite de rede (kbit/s) das páginas. */
  netLimitOn: boolean;
  netDownKbps: number;
  netUpKbps: number;
  /** Largura padrão do painel lateral (px): a de quem ainda não tem largura própria. */
  sidePanelWidth: number;
  /** Largura de cada painel (3.1.1), por id do app. */
  sidePanelWidths: Record<string, number>;
  /** Sons da interface (3.1.1): geral, hover, teclado, qual tick e volume (0–100). */
  sounds: boolean;
  soundHover: boolean;
  soundKeys: boolean;
  soundTick: SoundTick;
  soundVolume: number;
  /** Cor de acento (hex). */
  accentColor: string;
  /** Papel de parede da página inicial (URL ou data-url). */
  backgroundImage: string;
  /** Intensidade do blur do papel de parede (0 a 20). */
  backgroundBlur: number;
  /** Opacidade da imagem de fundo (0 a 100). */
  backgroundOpacity: number;
  /** Efeito de glassmorphism na interface. */
  uiBlur: boolean;
  /** Barra do Agzos Key (código MFA) fixada pela tachinha: não some depois de copiar. */
  keyBarPinned: boolean;
  /** Agzos AI (4.0): modelo da Groq escolhido ("" = automático). */
  aiModel: string;
  /** Gestos de trackpad e mouse (4.0): ligado e ação de cada um. */
  gestures: GesturePrefs;
  /** Terminal (4.0): painel aberto, altura (px), shell e pasta inicial ("" = padrão). */
  terminalOpen: boolean;
  terminalHeight: number;
  terminalShell: string;
  terminalCwd: string;
  /** Terminal 4.1: posição, aparência, aliases, IA, SSH e voz. */
  terminal: TerminalSettings;
};

/** Mesma lista de electron/hibernate.cjs (o primeiro é o padrão). */
export const HIBERNATE_MINUTES = [30, 15, 60, 120] as const;

export const defaultPrefs: Prefs = {
  dark: true,
  notesOpen: false,
  readerFontSize: 19,
  engine: "duckduckgo",
  shield: true,
  aiOpen: true,
  aiSidebar: true,
  orientation: "horizontal",
  railCollapsed: false,
  pausedHosts: [],
  bookmarksBar: true,
  searchSuggestions: true,
  hibernate: true,
  hibernateMinutes: 30,
  sidebar: true,
  sidePanels: DEFAULT_SIDE_PANELS,
  sidePanelsSeen: DEFAULT_SIDE_PANELS,
  ...DEFAULT_LIMITS,
  sidePanelWidth: SIDE_PANEL_WIDTH.initial,
  sidePanelWidths: {},
  sounds: true,
  soundHover: true,
  soundKeys: true,
  soundTick: DEFAULT_SOUND_TICK,
  soundVolume: 40,
  accentColor: "#D10A11",
  backgroundImage: "",
  backgroundBlur: 0,
  backgroundOpacity: 100,
  uiBlur: true,
  keyBarPinned: false,
  aiModel: "",
  gestures: DEFAULT_GESTURES,
  terminalOpen: false,
  terminalHeight: TERMINAL_HEIGHT.initial,
  terminalShell: "",
  terminalCwd: "",
  terminal: DEFAULT_TERMINAL,
};

export type ViewNav = { canBack: boolean; canForward: boolean };
export type PageBlocked = { count: number; trackers: BlockedTracker[] };
export type FindResult = { id: number; active: number; total: number };

export type BrowserState = {
  // Persistido (ver persistence/snapshot.ts).
  tabs: Tab[];
  activeId: number;
  /** Grupos de guias (2.0). */
  groups: TabGroup[];
  /** Workspaces (2.0): a barra mostra só as guias do ativo. */
  workspaces: Workspace[];
  activeWorkspaceId: number;
  /** Tela dividida (2.0): aparece quando a guia ativa é uma das duas. */
  split: SplitView | null;
  closedTabs: ClosedTab[];
  links: QuickLink[];
  /** Cards do Discador (3.0), na ordem do usuário. */
  dial: QuickLink[];
  /** Notas por página (4.5), pela chave de noteKeyOf. */
  notes: Record<string, PageNote>;
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
  /** Última guia ativa de cada workspace (voltar a ele reabre nela). */
  workspaceActive: Record<number, number>;
};

export const initialState: BrowserState = {
  tabs: [{ id: 1, history: [homeEntry], index: 0 }],
  activeId: 1,
  groups: [],
  workspaces: defaultWorkspaces,
  activeWorkspaceId: DEFAULT_WORKSPACE_ID,
  split: null,
  closedTabs: [],
  links: defaultLinks,
  dial: defaultDial,
  notes: {},
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
  workspaceActive: {},
};

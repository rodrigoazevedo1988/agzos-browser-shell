import type { Credential } from "./types";

export type DesktopTabEvent =
  | {
      type: "tab-updated";
      id: number;
      url: string;
      title: string;
      canBack: boolean;
      canForward: boolean;
    }
  | { type: "favicon"; id: number; icon: string | null }
  | { type: "audio"; id: number; playing: boolean }
  | { type: "muted"; id: number; muted: boolean }
  | { type: "crashed"; id: number }
  | { type: "blocked"; id: number; count: number; trackers: BlockedTracker[] }
  | { type: "find"; id: number; active: number; total: number }
  | { type: "zoom"; id: number; factor: number }
  | { type: "download-navigation"; id: number; urls: string[] }
  | { type: "thumbnail"; id: number; dataUrl: string }
  | { type: "login-rejected"; id: number; rejected: boolean; continueUrl: string | null };

export type BlockedTracker = { host: string; category: string };

export type AdblockStats = {
  /** false quando o app foi montado sem o motor de filtros. */
  available?: boolean;
  today: number;
  updatedAt: number | null;
  ready: boolean;
};

export type DownloadState = "progressing" | "completed" | "cancelled" | "interrupted";

export type DownloadRecord = {
  id: number;
  url: string;
  filename: string;
  path: string;
  mime: string;
  totalBytes: number;
  receivedBytes: number;
  state: DownloadState;
  startedAt: number;
  endedAt: number | null;
  private: boolean;
  paused: boolean;
  canResume: boolean;
  /** Evento de remoção (diálogo "Salvar como" cancelado). */
  removed?: boolean;
};

export type DownloadAction = "pause" | "resume" | "cancel" | "open" | "show" | "remove";

export type DesktopRect = { x: number; y: number; width: number; height: number };

export type DesktopTabMenuContext = {
  kind: "tab" | "strip";
  tabId?: number;
  pinned?: boolean;
  muted?: boolean;
  audio?: boolean;
  hasClosed?: boolean;
  orientation?: "horizontal" | "vertical";
  url?: string;
};

export type DesktopPermissionRequest = {
  id: string;
  origin: string;
  mediaTypes: string[];
};

export type DesktopBridge = {
  attachTab(
    id: number,
    url: string,
    options?: { dark?: boolean; private?: boolean },
  ): Promise<void>;
  activateTab(id: number): Promise<void>;
  setBounds(rect: DesktopRect): Promise<void>;
  navigate(id: number, url: string): Promise<void>;
  goBack(id: number): Promise<void>;
  goForward(id: number): Promise<void>;
  reload(id: number, ignoreCache?: boolean): Promise<void>;
  /** Tira a miniatura da aba visível (seletor do Ctrl+Tab). */
  captureTab(id: number): Promise<void>;
  /** 1 aumenta, -1 diminui, 0 volta a 100 %. */
  zoom(id: number, direction: -1 | 0 | 1): Promise<void>;
  findStart(
    id: number,
    text: string,
    options?: { forward?: boolean; newSession?: boolean },
  ): Promise<void>;
  findStop(id: number): Promise<void>;
  toggleFullscreen(): Promise<void>;
  adblockConfig(config: { shield: boolean; pausedHosts: string[] }): Promise<void>;
  adblockStats(): Promise<AdblockStats>;
  adblockUpdate(): Promise<{ ok: boolean }>;
  downloadsList(): Promise<DownloadRecord[]>;
  downloadAction(id: number, action: DownloadAction): Promise<{ ok: boolean }>;
  downloadsClear(): Promise<DownloadRecord[]>;
  closeTab(id: number): Promise<void>;
  muteTab(id: number, muted: boolean): Promise<void>;
  setPanelOpen(open: boolean): Promise<void>;
  showTabMenu(context: DesktopTabMenuContext): Promise<void>;
  respondPermission(id: string, allow: boolean, remember: boolean): Promise<void>;
  stateLoad(): Promise<{ available: boolean; sections: Record<string, unknown> }>;
  stateSave(sections: Record<string, unknown>): Promise<{ ok: boolean }>;
  keyLoad(): Promise<Credential[] | null>;
  keySave(list: Credential[]): Promise<{ ok: boolean }>;
  openExternal(url: string): Promise<void>;
  onTabEvent(callback: (event: DesktopTabEvent) => void): () => void;
  onOpenRequest(callback: (payload: { url: string }) => void): () => void;
  onFullscreen(callback: (payload: { active: boolean }) => void): () => void;
  onHotkey(
    callback: (payload: {
      key: string;
      shift: boolean;
      alt: boolean;
      meta: boolean;
      ctrl: boolean;
    }) => void,
  ): () => void;
  /** `action` é um CommandId (ver commands.ts). */
  onTabMenuAction(
    callback: (payload: { action: string; tabId: number | null }) => void,
  ): () => void;
  onRequestPermission(callback: (payload: DesktopPermissionRequest) => void): () => void;
  onDownload(callback: (record: DownloadRecord) => void): () => void;
  /** Ctrl/⌘ solto (inclusive com o foco na página). */
  onModifierUp(callback: (payload: { key: string }) => void): () => void;
  onAdblockStats(callback: (stats: AdblockStats) => void): () => void;
};

type DesktopWindow = Window & { agzosDesktop?: DesktopBridge };

export function desktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  return (window as DesktopWindow).agzosDesktop ?? null;
}

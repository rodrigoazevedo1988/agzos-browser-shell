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
  | { type: "login-rejected"; id: number; rejected: boolean; continueUrl: string | null };

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
  reload(id: number): Promise<void>;
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
};

type DesktopWindow = Window & { agzosDesktop?: DesktopBridge };

export function desktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  return (window as DesktopWindow).agzosDesktop ?? null;
}

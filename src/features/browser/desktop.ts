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
  | { type: "muted"; id: number; muted: boolean };

export type DesktopRect = { x: number; y: number; width: number; height: number };

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
  onTabEvent(callback: (event: DesktopTabEvent) => void): () => void;
  onOpenRequest(callback: (payload: { url: string }) => void): () => void;
  onFullscreen(callback: (payload: { active: boolean }) => void): () => void;
  onHotkey(callback: (payload: { key: string; shift: boolean }) => void): () => void;
};

type DesktopWindow = Window & { agzosDesktop?: DesktopBridge };

export function desktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  return (window as DesktopWindow).agzosDesktop ?? null;
}

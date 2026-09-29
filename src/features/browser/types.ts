export type Entry = { title: string; url: string; kind: "home" | "page" };
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

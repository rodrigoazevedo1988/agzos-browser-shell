export type Entry = { title: string; url: string; kind: "home" | "page" };
export type Tab = {
  id: number;
  history: Entry[];
  index: number;
  pinned?: boolean;
  private?: boolean;
};
export type Credential = { domain: string; user: string; password: string };
export type QuickLink = { name: string; url: string };
export type EngineId = "duckduckgo" | "yandex";

import { describe, expect, it } from "vitest";

import type { MediaBridge, MediaListing, MediaItem, MediaRoot } from "@/features/media/bridge";
import { buildIndex } from "./library";

const item = (dir: string, name: string): MediaItem => ({
  name,
  path: `${dir}/${name}`,
  size: 10,
  mtime: 0,
  ext: "mp3",
});

/** Árvore de pastas falsa: /m (2 faixas, 1 pasta), /m/rock (1 faixa), /m/vazia. */
const tree: Record<string, { folders: string[]; items: MediaItem[] }> = {
  "/m": { folders: ["/m/rock", "/m/vazia"], items: [item("/m", "a.mp3"), item("/m", "b.mp3")] },
  "/m/rock": { folders: [], items: [item("/m/rock", "c.mp3")] },
  "/m/vazia": { folders: [], items: [] },
};

function fakeBridge(calls: string[] = []): MediaBridge {
  return {
    roots: async (): Promise<MediaRoot[]> => [],
    list: async (dir: string): Promise<MediaListing | { error: string }> => {
      calls.push(dir);
      const node = tree[dir];
      if (!node) return { error: "missing" };
      return {
        dir,
        parent: null,
        folders: node.folders.map((path) => ({ name: path.split("/").pop()!, path })),
        items: node.items,
      };
    },
    url: () => null,
    subtitle: async () => null,
    pickFolder: async () => null,
    onOpen: () => () => undefined,
  } as unknown as MediaBridge;
}

describe("buildIndex", () => {
  it("anda pelas pastas em largura e junta todas as faixas", async () => {
    const calls: string[] = [];
    const items = await buildIndex(fakeBridge(calls), ["/m"]);
    expect(items.map((entry) => entry.name)).toEqual(["a.mp3", "b.mp3", "c.mp3"]);
    expect(calls).toEqual(["/m", "/m/rock", "/m/vazia"]);
  });

  it("pasta que não lista é pulada sem derrubar a busca", async () => {
    const items = await buildIndex(fakeBridge(), ["/m/sumiu", "/m/rock"]);
    expect(items.map((entry) => entry.name)).toEqual(["c.mp3"]);
  });

  it("para quando cancelado", async () => {
    const calls: string[] = [];
    await buildIndex(fakeBridge(calls), ["/m"], { cancelled: () => true });
    expect(calls).toEqual([]);
  });

  it("não visita a mesma pasta duas vezes", async () => {
    const calls: string[] = [];
    await buildIndex(fakeBridge(calls), ["/m", "/m/rock", "/m"]);
    expect(calls.filter((dir) => dir === "/m")).toHaveLength(1);
  });
});

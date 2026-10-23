import { describe, expect, it } from "vitest";

import {
  PLAYLIST_LIMIT,
  PLAYLIST_NAME_LIMIT,
  addTracks,
  cleanPlaylistName,
  createPlaylist,
  deletePlaylist,
  moveTrack,
  parsePlaylists,
  removeTrack,
  renamePlaylist,
  type Playlist,
  type PlaylistResult,
} from "./playlists";

const NOW = 1_700_000_000_000;

function lists(result: PlaylistResult): Playlist[] {
  if (!result.ok) throw new Error(result.error);
  return result.playlists;
}

function withOne(name = "Treino"): Playlist[] {
  return lists(createPlaylist([], name, NOW, "pl-aaaa"));
}

describe("nomes", () => {
  it("tira espaços repetidos e corta no limite", () => {
    expect(cleanPlaylistName("  Rock   do\n  ano ")).toBe("Rock do ano");
    expect(cleanPlaylistName("   ")).toBeNull();
    expect(cleanPlaylistName("x".repeat(200))?.length).toBe(PLAYLIST_NAME_LIMIT);
  });

  it("criar exige nome e id novo", () => {
    expect(createPlaylist([], "  ", NOW, "pl-aaaa").ok).toBe(false);
    const once = withOne();
    expect(createPlaylist(once, "Outra", NOW, "pl-aaaa").ok).toBe(false);
    expect(lists(createPlaylist(once, "Outra", NOW, "pl-bbbb"))).toHaveLength(2);
  });

  it("não passa do limite de playlists", () => {
    const full = Array.from({ length: PLAYLIST_LIMIT }, (_, i) => ({
      id: `pl-${String(i).padStart(4, "0")}`,
      name: `L${i}`,
      tracks: [],
      createdAt: 0,
      updatedAt: 0,
    }));
    expect(createPlaylist(full, "mais uma", NOW, "pl-zzzz").ok).toBe(false);
  });
});

describe("operações", () => {
  it("renomear troca o nome e a data", () => {
    const renamed = lists(renamePlaylist(withOne(), "pl-aaaa", "Corrida", NOW + 5));
    expect(renamed[0]).toMatchObject({ name: "Corrida", updatedAt: NOW + 5 });
    expect(renamePlaylist(withOne(), "nope", "x", NOW).ok).toBe(false);
  });

  it("apagar remove só a playlist indicada", () => {
    const two = lists(createPlaylist(withOne(), "Outra", NOW, "pl-bbbb"));
    expect(lists(deletePlaylist(two, "pl-aaaa")).map((p) => p.id)).toEqual(["pl-bbbb"]);
    expect(deletePlaylist(two, "pl-zzzz").ok).toBe(false);
  });

  it("adicionar põe no fim, pula repetidas e ignora caminho vazio", () => {
    let list = withOne();
    list = lists(addTracks(list, "pl-aaaa", ["/m/a.mp3", "/m/b.mp3"], NOW));
    list = lists(addTracks(list, "pl-aaaa", ["/m/b.mp3", "/m/c.mp3", ""], NOW));
    expect(list[0]!.tracks).toEqual(["/m/a.mp3", "/m/b.mp3", "/m/c.mp3"]);
  });

  it("adicionar a uma playlist cheia dá erro", () => {
    const tracks = Array.from({ length: 2000 }, (_, i) => `/m/${i}.mp3`);
    const full = [{ id: "pl-aaaa", name: "Cheia", tracks, createdAt: 0, updatedAt: 0 }];
    expect(addTracks(full, "pl-aaaa", ["/m/extra.mp3"], NOW).ok).toBe(false);
  });

  it("remover tira pela posição, fora do limite não faz nada", () => {
    const list = addTracks(withOne(), "pl-aaaa", ["/a", "/b", "/c"], NOW);
    const removed = lists(removeTrack(lists(list), "pl-aaaa", 1, NOW));
    expect(removed[0]!.tracks).toEqual(["/a", "/c"]);
    expect(lists(removeTrack(removed, "pl-aaaa", 9, NOW))[0]!.tracks).toEqual(["/a", "/c"]);
  });

  it("mover reordena: arrastar de cima para baixo e o contrário", () => {
    const list = lists(addTracks(withOne(), "pl-aaaa", ["/a", "/b", "/c", "/d"], NOW));
    expect(lists(moveTrack(list, "pl-aaaa", 0, 2, NOW))[0]!.tracks).toEqual([
      "/b",
      "/c",
      "/a",
      "/d",
    ]);
    expect(lists(moveTrack(list, "pl-aaaa", 3, 0, NOW))[0]!.tracks).toEqual([
      "/d",
      "/a",
      "/b",
      "/c",
    ]);
    expect(moveTrack(list, "pl-aaaa", 1, 1, NOW)).toEqual({ ok: true, playlists: list });
  });
});

describe("parsePlaylists (validação do disco)", () => {
  it("descarta o que não presta e mantém o válido", () => {
    const parsed = parsePlaylists([
      {
        id: "pl-aaaa",
        name: " Boa ",
        tracks: ["/a", "/a", "", 3, "/b"],
        createdAt: 1,
        updatedAt: 2,
      },
      { id: "x", name: "id curto demais", tracks: [] },
      { id: "pl-bbbb", name: "", tracks: [] },
      { id: "pl-aaaa", name: "duplicada", tracks: [] },
      "lixo",
      null,
    ]);
    expect(parsed).toEqual([
      { id: "pl-aaaa", name: "Boa", tracks: ["/a", "/b"], createdAt: 1, updatedAt: 2 },
    ]);
  });

  it("valor que não é lista vira vazio", () => {
    expect(parsePlaylists(undefined)).toEqual([]);
    expect(parsePlaylists({ id: "pl-aaaa" })).toEqual([]);
  });

  it("faixas longas demais saem da lista", () => {
    const long = "/".concat("x".repeat(1100));
    const parsed = parsePlaylists([{ id: "pl-aaaa", name: "L", tracks: [long, "/ok"] }]);
    expect(parsed[0]!.tracks).toEqual(["/ok"]);
  });
});

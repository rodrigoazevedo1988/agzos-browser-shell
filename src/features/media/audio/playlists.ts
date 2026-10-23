// Playlists do Música: criar, renomear, apagar, adicionar, remover e reordenar faixas.
// Puro e validado. Persiste na seção `media` do BrowserStore (campo `playlists`).

export type Playlist = {
  id: string;
  name: string;
  /** Caminhos dos arquivos, na ordem da playlist. Sem repetidos. */
  tracks: string[];
  createdAt: number;
  updatedAt: number;
};

export const PLAYLIST_LIMIT = 200;
export const PLAYLIST_TRACK_LIMIT = 2000;
export const PLAYLIST_NAME_LIMIT = 80;
export const TRACK_PATH_LIMIT = 1024;
const ID_RE = /^[a-z0-9-]{4,64}$/;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Nome limpo: sem quebras, espaços duplicados nem bordas; vazio = inválido. */
export function cleanPlaylistName(raw: string): string | null {
  const name = raw.replace(/\s+/g, " ").trim().slice(0, PLAYLIST_NAME_LIMIT);
  return name ? name : null;
}

/** Id estável e curto (o chamador passa um gerador; o padrão usa o relógio e aleatório). */
export function newPlaylistId(now: number, random: () => number = Math.random): string {
  return `pl-${now.toString(36)}-${Math.floor(random() * 36 ** 4)
    .toString(36)
    .padStart(4, "0")}`;
}

/** Valida o que veio do disco: descarta o que não presta, nunca lança. */
export function parsePlaylists(value: unknown): Playlist[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: Playlist[] = [];
  for (const item of value) {
    if (out.length >= PLAYLIST_LIMIT) break;
    if (!isObject(item)) continue;
    const id = item["id"];
    const name = typeof item["name"] === "string" ? cleanPlaylistName(item["name"]) : null;
    if (typeof id !== "string" || !ID_RE.test(id) || seen.has(id) || !name) continue;
    const tracks: string[] = [];
    const tracksSeen = new Set<string>();
    if (Array.isArray(item["tracks"])) {
      for (const track of item["tracks"]) {
        if (typeof track !== "string" || !track || track.length > TRACK_PATH_LIMIT) continue;
        if (tracksSeen.has(track)) continue;
        tracksSeen.add(track);
        tracks.push(track);
        if (tracks.length >= PLAYLIST_TRACK_LIMIT) break;
      }
    }
    const createdAt = Number.isFinite(item["createdAt"]) ? (item["createdAt"] as number) : 0;
    const updatedAt = Number.isFinite(item["updatedAt"])
      ? (item["updatedAt"] as number)
      : createdAt;
    seen.add(id);
    out.push({ id, name, tracks, createdAt, updatedAt });
  }
  return out;
}

export type PlaylistResult = { ok: true; playlists: Playlist[] } | { ok: false; error: string };

const ok = (playlists: Playlist[]): PlaylistResult => ({ ok: true, playlists });
const fail = (error: string): PlaylistResult => ({ ok: false, error });

function patch(list: Playlist[], id: string, change: (p: Playlist) => Playlist): Playlist[] {
  return list.map((p) => (p.id === id ? change(p) : p));
}

export function createPlaylist(
  list: Playlist[],
  rawName: string,
  now: number,
  id: string,
): PlaylistResult {
  const name = cleanPlaylistName(rawName);
  if (!name) return fail("Dê um nome à playlist.");
  if (list.length >= PLAYLIST_LIMIT) return fail("Já são muitas playlists.");
  if (list.some((p) => p.id === id)) return fail("Id repetido.");
  return ok([...list, { id, name, tracks: [], createdAt: now, updatedAt: now }]);
}

export function renamePlaylist(
  list: Playlist[],
  id: string,
  rawName: string,
  now: number,
): PlaylistResult {
  const name = cleanPlaylistName(rawName);
  if (!name) return fail("Dê um nome à playlist.");
  if (!list.some((p) => p.id === id)) return fail("Playlist não encontrada.");
  return ok(patch(list, id, (p) => ({ ...p, name, updatedAt: now })));
}

export function deletePlaylist(list: Playlist[], id: string): PlaylistResult {
  if (!list.some((p) => p.id === id)) return fail("Playlist não encontrada.");
  return ok(list.filter((p) => p.id !== id));
}

/** Adiciona faixas ao fim; as que já estão na playlist são ignoradas. */
export function addTracks(
  list: Playlist[],
  id: string,
  paths: readonly string[],
  now: number,
): PlaylistResult {
  const target = list.find((p) => p.id === id);
  if (!target) return fail("Playlist não encontrada.");
  const have = new Set(target.tracks);
  const fresh: string[] = [];
  for (const path of paths) {
    if (!path || path.length > TRACK_PATH_LIMIT || have.has(path)) continue;
    have.add(path);
    fresh.push(path);
  }
  const room = PLAYLIST_TRACK_LIMIT - target.tracks.length;
  if (room <= 0) return fail("Essa playlist já está cheia.");
  const added = fresh.slice(0, room);
  if (!added.length) return ok(list);
  return ok(patch(list, id, (p) => ({ ...p, tracks: [...p.tracks, ...added], updatedAt: now })));
}

export function removeTrack(
  list: Playlist[],
  id: string,
  index: number,
  now: number,
): PlaylistResult {
  const target = list.find((p) => p.id === id);
  if (!target) return fail("Playlist não encontrada.");
  if (index < 0 || index >= target.tracks.length) return ok(list);
  return ok(
    patch(list, id, (p) => ({
      ...p,
      tracks: p.tracks.filter((_, i) => i !== index),
      updatedAt: now,
    })),
  );
}

/** Move a faixa `from` para a posição `to` (arrastar para reordenar). */
export function moveTrack(
  list: Playlist[],
  id: string,
  from: number,
  to: number,
  now: number,
): PlaylistResult {
  const target = list.find((p) => p.id === id);
  if (!target) return fail("Playlist não encontrada.");
  const size = target.tracks.length;
  if (from === to || from < 0 || to < 0 || from >= size || to >= size) return ok(list);
  return ok(
    patch(list, id, (p) => {
      const tracks = p.tracks.slice();
      const [item] = tracks.splice(from, 1);
      tracks.splice(to, 0, item!);
      return { ...p, tracks, updatedAt: now };
    }),
  );
}

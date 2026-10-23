// Biblioteca do Música na tela: lê e grava a seção `media` (favoritos, pastas fixadas,
// recentes e playlists) pelo updateMedia da biblioteca compartilhada, e avisa as telas
// abertas quando algo muda. Quem toca em segundo plano também grava "recentes" daqui.

import {
  emptyMedia,
  MEDIA_PATHS_LIMIT,
  type MediaLibrary,
} from "@/features/browser/persistence/snapshot";
import { loadMedia, updateMedia } from "@/features/media/library";
import type { MusicEngine, Track } from "./engine";
import { newPlaylistId, type PlaylistResult } from "./playlists";
import * as playlists from "./playlists";

type Listener = (library: MediaLibrary) => void;
const listeners = new Set<Listener>();
let loaded: Promise<MediaLibrary> | null = null;

/** Biblioteca atual (carrega na primeira vez). */
export function libraryNow(): Promise<MediaLibrary> {
  if (!loaded) {
    loaded = loadMedia();
  }
  return loaded;
}

/** Aplica `change` à biblioteca gravada e avisa todas as telas abertas. */
export async function changeLibrary(
  change: (library: MediaLibrary) => MediaLibrary,
): Promise<MediaLibrary> {
  const next = await updateMedia(change);
  listeners.forEach((listener) => listener(next));
  return next;
}

export function subscribeLibrary(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Recarrega do disco (outra janela ou a tela de vídeo podem ter gravado). */
export async function reloadLibrary(): Promise<MediaLibrary> {
  const next = await loadMedia();
  loaded = Promise.resolve(next);
  listeners.forEach((listener) => listener(next));
  return next;
}

/** Edita playlists. Devolve o erro de validação (ou null) depois de gravar. */
export async function editPlaylists(
  change: (lists: MediaLibrary["playlists"], now: number) => PlaylistResult,
): Promise<string | null> {
  let error: string | null = null;
  await changeLibrary((library) => {
    const result = change(library.playlists, Date.now());
    if (!result.ok) {
      error = result.error;
      return library;
    }
    return { ...library, playlists: result.playlists };
  });
  return error;
}

export function createPlaylistNamed(name: string): Promise<string | null> {
  const id = newPlaylistId(Date.now());
  return editPlaylists((lists, now) => playlists.createPlaylist(lists, name, now, id));
}

export function toggleFavorite(path: string): Promise<MediaLibrary> {
  return changeLibrary((library) => {
    const has = library.favorites.includes(path);
    const favorites = has
      ? library.favorites.filter((item) => item !== path)
      : [path, ...library.favorites].slice(0, MEDIA_PATHS_LIMIT);
    return { ...library, favorites };
  });
}

export function pinFolder(path: string, pinned: boolean): Promise<MediaLibrary> {
  return changeLibrary((library) => {
    const folders = library.folders.filter((item) => item !== path);
    return {
      ...library,
      folders: pinned ? [path, ...folders].slice(0, MEDIA_PATHS_LIMIT) : folders,
    };
  });
}

/** Grava o que começou a tocar nos "recentes" (ficam com os de vídeo, no mesmo limite). */
export function recordPlayed(track: Track): void {
  void changeLibrary((library) => ({
    ...library,
    recent: [
      {
        path: track.path,
        kind: "audio",
        position: 0,
        duration: track.duration ?? 0,
        at: Date.now(),
      },
      ...library.recent.filter((item) => item.path !== track.path),
    ],
  })).catch(() => undefined);
}

const recording = new WeakSet<MusicEngine>();

/** Liga o registro de recentes no motor (uma vez por motor). */
export function recordPlaysOf(engine: MusicEngine): void {
  if (recording.has(engine)) return;
  recording.add(engine);
  engine.onPlayed(recordPlayed);
}

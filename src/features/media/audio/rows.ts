// Contexto da página do Música e as ações de uma lista de faixas. Sem JSX: as telas e as
// peças usam daqui, então nada de componente é exportado junto.

import type { MediaBridge, MediaItem } from "@/features/media/bridge";
import type { MediaLibrary } from "@/features/browser/persistence/snapshot";
import type { Track } from "./engine";
import type { Playlist } from "./playlists";

/** Ações e dados que as telas recebem da página (uma só ponte, sem props soltas). */
export type MusicCtx = {
  bridge: MediaBridge;
  library: MediaLibrary;
  playingPath: string | null;
  liked: Set<string>;
  trackOf: (item: MediaItem) => Track;
  playTracks: (tracks: Track[], index: number, shuffle?: boolean) => void;
  openFolder: (path: string, label: string) => void;
  openPlaylist: (id: string) => void;
  like: (path: string) => void;
  addToPlaylist: (id: string, path: string) => void;
  playNext: (path: string) => void;
  enqueue: (path: string) => void;
  pin: (path: string, pinned: boolean) => void;
  notice: (text: string) => void;
};

export type RowActions = {
  liked: Set<string>;
  playlists: Playlist[];
  onPlay: (index: number) => void;
  onLike: (path: string) => void;
  onAddToPlaylist: (id: string, path: string) => void;
  onPlayNext: (path: string) => void;
  onEnqueue: (path: string) => void;
  /** Só na playlist: remove a faixa da posição. */
  onRemove?: (index: number) => void;
  /** Só na playlist: arrastar ou Alt+↑/↓ muda a ordem. */
  onMove?: (from: number, to: number) => void;
};

/** Ações de uma lista de faixas (a tela monta a partir do contexto da página). */
export function rowActions(ctx: MusicCtx, extra: Partial<RowActions>, tracks: Track[]): RowActions {
  return {
    liked: ctx.liked,
    playlists: ctx.library.playlists,
    onPlay: (index) => ctx.playTracks(tracks, index),
    onLike: ctx.like,
    onAddToPlaylist: ctx.addToPlaylist,
    onPlayNext: ctx.playNext,
    onEnqueue: ctx.enqueue,
    ...extra,
  };
}

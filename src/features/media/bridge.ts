// Ponte da biblioteca de mídia (window.agzosMedia, electron/preload.cjs + electron/media-library.cjs).
// O renderer só recebe caminhos e URLs agzos-media://; o arquivo é lido pelo <video>/<audio>.

import type { MediaKind } from "@/features/browser/persistence/snapshot";

export type MediaRoot = { id: string; label: string; path: string };
export type MediaFolder = { name: string; path: string };
export type MediaItem = { name: string; path: string; size: number; mtime: number; ext: string };
export type MediaListing = {
  dir: string;
  parent: string | null;
  folders: MediaFolder[];
  items: MediaItem[];
  truncated?: boolean;
};
/** Pasta que não pode ser listada: `error` ("path", "missing", "access", "kind"). */
export type MediaListError = { error: string };
export type MediaSubtitle = { ext: "srt" | "vtt"; name: string; text: string };

export type MediaBridge = {
  roots(): Promise<MediaRoot[]>;
  list(dir: string, kind: MediaKind): Promise<MediaListing | MediaListError>;
  /** Síncrono; null se o caminho não for absoluto. */
  url(path: string): string | null;
  /** Legenda de mesmo nome na pasta do vídeo (.vtt antes de .srt), ou null. */
  subtitle(path: string): Promise<MediaSubtitle | null>;
  pickFolder(): Promise<string | null>;
  onOpen(callback: (path: string) => void): () => void;
};

type MediaWindow = Window & { agzosMedia?: MediaBridge };

/** Ponte da biblioteca, ou null na web (sem o app para computador). */
export function mediaBridge(): MediaBridge | null {
  if (typeof window === "undefined") return null;
  return (window as MediaWindow).agzosMedia ?? null;
}

export function isListing(value: MediaListing | MediaListError): value is MediaListing {
  return !("error" in value);
}

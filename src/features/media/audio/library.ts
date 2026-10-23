// Ligação entre a ponte de arquivos (window.agzosMedia) e o motor: lê tags e capa pelo
// começo do arquivo (Range de 512 KB), guarda a capa como blob: na memória e indexa as
// pastas para a busca. Nada disto vai para o disco.

import {
  isListing,
  type MediaBridge,
  type MediaItem,
  type MediaListing,
} from "@/features/media/bridge";
import { TAG_READ_BYTES, parseTags, type TrackTags } from "./tags";
import type { MusicEngine, Track, TrackInfo } from "./engine";

const READ_CONCURRENCY = 3;
const COVER_CACHE_MAX = 400;
const INDEX_FOLDER_LIMIT = 400;
const INDEX_TRACK_LIMIT = 8000;

let running = 0;
const waiting: (() => void)[] = [];

/** No máximo READ_CONCURRENCY leituras ao mesmo tempo. */
function limited<T>(task: () => Promise<T>): Promise<T> {
  const run = async () => {
    running += 1;
    try {
      return await task();
    } finally {
      running -= 1;
      waiting.shift()?.();
    }
  };
  if (running < READ_CONCURRENCY) return run();
  return new Promise<void>((resolve) => waiting.push(resolve)).then(run);
}

/** Lê só o começo do arquivo (tags e capa costumam estar aí); para ao passar do limite. */
export async function readHead(url: string): Promise<Uint8Array | null> {
  const response = await fetch(url, { headers: { Range: `bytes=0-${TAG_READ_BYTES - 1}` } });
  if (!response.ok || !response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < TAG_READ_BYTES) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const room = TAG_READ_BYTES - total;
      const part = value.byteLength > room ? value.subarray(0, room) : value;
      chunks.push(part);
      total += part.byteLength;
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

const tagCache = new Map<string, Promise<TrackTags>>();
const coverUrls = new Map<string, string>();

/** Quem mostra a lista (página) quer saber quando um tag chegou. */
const tagListeners = new Set<() => void>();
let tagVersion = 0;
export const subscribeTags = (listener: () => void): (() => void) => {
  tagListeners.add(listener);
  return () => {
    tagListeners.delete(listener);
  };
};
export const tagVersionOf = (): number => tagVersion;

function rememberCover(path: string, tags: TrackTags): void {
  if (!tags.cover) return;
  if (coverUrls.size >= COVER_CACHE_MAX) {
    const oldest = coverUrls.keys().next().value;
    if (oldest !== undefined) {
      URL.revokeObjectURL(coverUrls.get(oldest)!);
      coverUrls.delete(oldest);
    }
  }
  const blob = new Blob([tags.cover.data as BlobPart], { type: tags.cover.mime });
  coverUrls.set(path, URL.createObjectURL(blob));
}

/** Tags de uma faixa (e a capa, como blob:). Falha vira tags vazias, nunca erro. */
export function tagsOf(bridge: MediaBridge, path: string): Promise<TrackTags> {
  const cached = tagCache.get(path);
  if (cached) return cached;
  const pending = limited(async () => {
    try {
      const url = bridge.url(path);
      const head = url ? await readHead(url) : null;
      return head ? parseTags(head) : {};
    } catch {
      return {};
    }
  }).then((tags) => {
    rememberCover(path, tags);
    return tags;
  });
  tagCache.set(path, pending);
  return pending;
}

export function trackFromItem(item: MediaItem): Track {
  return {
    path: item.path,
    name: item.name,
    ext: item.ext,
    size: item.size,
    title: item.name.replace(/\.[^.]+$/, ""),
  };
}

/** Lê as tags e leva o que deu para o motor (título, artista, álbum, duração, capa). */
export async function enrich(
  bridge: MediaBridge,
  engine: MusicEngine,
  item: MediaItem,
): Promise<Track> {
  const tags = await tagsOf(bridge, item.path);
  const before = engine.trackOf(item.path);
  const next: TrackInfo = {
    title: tags.title ?? item.name.replace(/\.[^.]+$/, ""),
    artist: tags.artist,
    album: tags.album,
    duration: tags.durationSec,
    cover: coverUrls.get(item.path),
  };
  // Só avisa a tela quando algo mudou: a página re-lê as faixas num efeito, e um aviso
  // sem mudança reiniciaria esse ciclo sem fim.
  const changed =
    !before ||
    before.title !== next.title ||
    before.artist !== next.artist ||
    before.album !== next.album ||
    before.duration !== next.duration ||
    before.cover !== next.cover;
  if (changed) {
    engine.remember(item.path, { ...trackFromItem(item), ...next });
    if (engine.getState().track?.path === item.path) engine.refreshSession();
    tagVersion += 1;
    tagListeners.forEach((listener) => listener());
  }
  return engine.trackOf(item.path) ?? trackFromItem(item);
}

/** Capa do álbum (a pasta): a da primeira faixa com arte embutida entre as seis primeiras. */
const folderCovers = new Map<string, Promise<string | undefined>>();

export function folderCover(bridge: MediaBridge, folder: string): Promise<string | undefined> {
  const cached = folderCovers.get(folder);
  if (cached) return cached;
  const pending = (async () => {
    const listing = await bridge.list(folder, "audio");
    if (!isListing(listing)) return undefined;
    for (const item of listing.items.slice(0, 6)) {
      const tags = await tagsOf(bridge, item.path);
      if (tags.cover) return coverUrls.get(item.path);
    }
    return undefined;
  })().catch(() => undefined);
  folderCovers.set(folder, pending);
  return pending;
}

/**
 * Índice da busca: anda pelas pastas em largura, com limite de pastas e de faixas. Não lê
 * tags; `onProgress` avisa quantas faixas já achou.
 */
export async function buildIndex(
  bridge: MediaBridge,
  roots: string[],
  options: { cancelled?: () => boolean; onProgress?: (count: number) => void } = {},
): Promise<MediaItem[]> {
  const queue = roots.slice();
  const seen = new Set<string>();
  const tracks: MediaItem[] = [];
  let folders = 0;
  while (queue.length && folders < INDEX_FOLDER_LIMIT && tracks.length < INDEX_TRACK_LIMIT) {
    if (options.cancelled?.()) break;
    const dir = queue.shift()!;
    if (seen.has(dir)) continue;
    seen.add(dir);
    folders += 1;
    const listing: MediaListing | { error: string } = await bridge.list(dir, "audio");
    if (!isListing(listing)) continue;
    tracks.push(...listing.items);
    queue.push(...listing.folders.map((folder) => folder.path));
    options.onProgress?.(tracks.length);
  }
  return tracks.slice(0, INDEX_TRACK_LIMIT);
}

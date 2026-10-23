// Endereço da página do Música (agzos://musica). `?file=<caminho>` abre um arquivo de áudio
// (o caminho vem de media-library.cjs, já validado no main).

export const MUSIC_URL = "agzos://musica";

/** Verdadeiro para agzos://musica e agzos://musica?file=… (a casca roteia pelos dois). */
export function isMusicUrl(url: string): boolean {
  return url === MUSIC_URL || url.startsWith(`${MUSIC_URL}?`);
}

/** Caminho do arquivo pedido no ?file=, ou null. */
export function musicFileOf(url: string): string | null {
  if (!url.startsWith(`${MUSIC_URL}?`)) return null;
  const query = url.slice(MUSIC_URL.length + 1);
  const value = new URLSearchParams(query).get("file");
  return value && value.length <= 4096 ? value : null;
}

export function musicPageUrl(file?: string): string {
  return file ? `${MUSIC_URL}?file=${encodeURIComponent(file)}` : MUSIC_URL;
}

/** Transições oferecidas na barra lateral (segundos). */
export const CROSSFADE_OPTIONS = [0, 2, 4, 6, 8, 12];

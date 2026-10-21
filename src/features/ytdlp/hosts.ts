/**
 * Sites que o yt-dlp atende sempre: o botão da barra destaca neles. A lista do main
 * (electron/ytdlp.cjs, KNOWN_HOSTS) é a mesma; o teste confere.
 */
export const KNOWN_VIDEO_HOSTS = [
  "youtube.com",
  "youtu.be",
  "x.com",
  "twitter.com",
  "instagram.com",
  "facebook.com",
  "fb.watch",
  "tiktok.com",
  "vimeo.com",
] as const;

export function hostOfUrl(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function isKnownVideoHost(url: string): boolean {
  const host = hostOfUrl(url);
  return KNOWN_VIDEO_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

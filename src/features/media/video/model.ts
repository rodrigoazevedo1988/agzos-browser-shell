// Regras puras da página agzos://videos: retomar de onde parou, próximo arquivo, caminho
// em migalhas, busca, SRT → VTT e as mensagens de erro do <video>. Sem DOM, testadas.

import { MEDIA_RECENT_LIMIT, type MediaRecent } from "@/features/browser/persistence/snapshot";

export const VIDEOS_URL = "agzos://videos";
/** Abaixo disso o vídeo começa do zero (não vale retomar um trecho de 2 segundos). */
export const RESUME_MIN_SECONDS = 5;
/** Depois dessa fração da duração o vídeo conta como visto (não retoma, sai de "continuar"). */
export const FINISH_RATIO = 0.95;

/** Título a partir do nome do arquivo ("Aula 01.mp4" → "Aula 01"). */
export function titleOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return (dot > 0 ? name.slice(0, dot) : name).trim() || name;
}

/** 83 → "1:23"; 3723 → "1:02:03". Valor inválido vira "0:00". */
export function formatTime(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Migalhas de uma pasta: POSIX ("/a/b") ou Windows ("C:\\a\\b"). */
export function breadcrumbOf(dir: string): { label: string; path: string }[] {
  if (!dir) return [];
  const windows = /^[A-Za-z]:/.test(dir) || (dir.includes("\\") && !dir.includes("/"));
  const sep = windows ? "\\" : "/";
  const root = windows && /^[A-Za-z]:/.test(dir) ? `${dir.slice(0, 2)}${sep}` : "/";
  const rest = dir.slice(root.length).split(/[\\/]/).filter(Boolean);
  const crumbs = [{ label: root, path: root }];
  let acc = root;
  for (const part of rest) {
    acc = acc.endsWith(sep) ? `${acc}${part}` : `${acc}${sep}${part}`;
    crumbs.push({ label: part, path: acc });
  }
  return crumbs;
}

/** Busca sem acento e sem caixa: "acao" acha "Ação". */
export function matchesSearch(name: string, query: string): boolean {
  const needle = normalizeText(query);
  return !needle || normalizeText(name).includes(needle);
}

export function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Vídeos de "continuar assistindo": começados, não terminados, mais recentes primeiro. */
export function continueItems(recent: MediaRecent[]): MediaRecent[] {
  return recent
    .filter((item) => item.kind === "video" && isInProgress(item))
    .sort((a, b) => b.at - a.at);
}

export function isInProgress(item: Pick<MediaRecent, "position" | "duration">): boolean {
  if (item.position < RESUME_MIN_SECONDS) return false;
  return item.duration <= 0 || item.position < item.duration * FINISH_RATIO;
}

/** Segundo onde retomar este arquivo (0 = do começo). */
export function resumeAt(recent: MediaRecent[], path: string): number {
  const item = recent.find((entry) => entry.path === path);
  return item && isInProgress(item) ? item.position : 0;
}

/** Índice do próximo arquivo da lista, ou null se é o último. */
export function nextIndex(paths: string[], path: string): number | null {
  const index = paths.indexOf(path);
  return index >= 0 && index + 1 < paths.length ? index + 1 : null;
}

/** Hora da linha de tempo de um SRT/VTT, com vírgula ou ponto. */
const TIMING = /(\d{1,2}:\d{2}:\d{2})[,.](\d{1,3})/g;

/**
 * SRT → WebVTT: cabeçalho WEBVTT, vírgula dos milissegundos trocada por ponto nas linhas
 * de tempo (00:00:01,500 → 00:00:01.500) e quebras de linha normalizadas. Texto que já é
 * VTT passa só com a normalização.
 */
export function srtToVtt(input: string): string {
  const text = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const body = text
    .split("\n")
    .map((line) =>
      line.includes("-->")
        ? line.replace(TIMING, (_match, time: string, ms: string) => `${time}.${ms.padEnd(3, "0")}`)
        : line,
    )
    .join("\n")
    .trim();
  if (/^WEBVTT/.test(body)) return `${body}\n`;
  return `WEBVTT\n\n${body}\n`;
}

/** Mensagem para o código de erro do <video> (MediaError.code). */
export function mediaErrorMessage(code: number | undefined): string {
  switch (code) {
    case 4:
      return "Este formato não toca no navegador do Agzos. AVI, alguns MKV e vídeos em HEVC (H.265) não funcionam aqui; converta para MP4 (H.264) para assistir.";
    case 3:
      return "Não foi possível decodificar este vídeo. O arquivo pode estar corrompido.";
    case 2:
      return "Falha ao ler o arquivo. Ele pode ter sido movido ou apagado.";
    default:
      return "Não foi possível tocar este vídeo.";
  }
}

/** agzos://videos ou agzos://videos?file=<caminho>. */
export function videosUrlOf(file: string | null): string {
  return file ? `${VIDEOS_URL}?file=${encodeURIComponent(file)}` : VIDEOS_URL;
}

/** true para agzos://videos, com ou sem ?file=. */
export function isVideosUrl(url: string): boolean {
  return url === VIDEOS_URL || url.startsWith(`${VIDEOS_URL}?`);
}

/** Arquivo pedido em agzos://videos?file=…, ou null. */
export function fileOfVideosUrl(url: string): string | null {
  if (!isVideosUrl(url)) return null;
  const query = url.slice(url.indexOf("?") + 1);
  if (query === url) return null;
  return new URLSearchParams(query).get("file") || null;
}

/** Último nome de um caminho POSIX ou Windows. */
export function nameOf(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** Pasta de um arquivo ("/a/b/c.mp4" → "/a/b"); a raiz se não há pasta. */
export function parentOf(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (index <= 0) return index === 0 ? "/" : path;
  const dir = path.slice(0, index);
  return /^[A-Za-z]:$/.test(dir) ? `${dir}\\` : dir;
}

export const VIDEO_EXTENSIONS = ["mp4", "m4v", "webm", "mkv", "mov", "ogv", "avi"];

export function isVideoName(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot >= 0 && VIDEO_EXTENSIONS.includes(name.slice(dot + 1).toLowerCase());
}

/** Lança o vídeo tocado no topo de "recentes" (uma entrada por arquivo). */
export function withRecent(recent: MediaRecent[], entry: MediaRecent): MediaRecent[] {
  return [entry, ...recent.filter((item) => item.path !== entry.path)].slice(0, MEDIA_RECENT_LIMIT);
}

/** Liga ou desliga um caminho numa lista (favoritos, pastas), sem repetir e com limite. */
export function toggleIn(list: string[], path: string, limit: number): string[] {
  if (list.includes(path)) return list.filter((item) => item !== path);
  return [path, ...list].slice(0, limit);
}

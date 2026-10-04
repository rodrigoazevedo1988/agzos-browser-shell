import type { DownloadRecord } from "@/features/browser/desktop";
import type { DownloadFileType } from "@/features/browser/desktop-v47";

/** Filtros do gerenciador (4.7). */
export type DownloadStatusFilter = "all" | "running" | "paused" | "completed" | "failed";

export type DownloadFilters = {
  status: DownloadStatusFilter;
  type: DownloadFileType | "all";
  tag: string | null;
  query: string;
};

export const STATUS_FILTERS: { id: DownloadStatusFilter; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "running", label: "Em andamento" },
  { id: "paused", label: "Pausados" },
  { id: "completed", label: "Concluídos" },
  { id: "failed", label: "Falhos" },
];

export const TYPE_LABELS: Record<DownloadFileType, string> = {
  pdf: "PDF",
  image: "Imagens",
  video: "Vídeos",
  audio: "Áudio",
  archive: "Compactados",
  other: "Outros",
};

/** Mesma regra do main (download-rules.cjs fileTypeOf), para linhas antigas sem `type`. */
export function typeOfDownload(record: Pick<DownloadRecord, "filename" | "mime" | "type">) {
  if (record.type) return record.type;
  const mime = record.mime.toLowerCase();
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  const ext = record.filename.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (/^(png|jpe?g|gif|webp|avif|svg|bmp|ico|tiff?|heic)$/.test(ext)) return "image";
  if (/^(mp4|mkv|webm|mov|avi|m4v|wmv|flv|mpe?g)$/.test(ext)) return "video";
  if (/^(mp3|wav|ogg|oga|flac|m4a|aac|opus|wma)$/.test(ext)) return "audio";
  if (/^(zip|rar|7z|tar|gz|tgz|bz2|xz|zst|iso|dmg)$/.test(ext)) return "archive";
  return "other";
}

/** Em andamento, pausado, concluído ou falho (cancelado conta como falho). */
export function statusGroupOf(record: DownloadRecord): Exclude<DownloadStatusFilter, "all"> {
  if (record.state === "progressing") return record.paused ? "paused" : "running";
  if (record.state === "completed") return "completed";
  return "failed";
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

const normalize = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Busca no histórico local: nome, URL, domínio e etiqueta; todos os termos precisam bater. */
export function matchesQuery(record: DownloadRecord, query: string): boolean {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = normalize(
    [record.filename, record.url, domainOf(record.url), ...(record.tags ?? [])].join(" "),
  );
  return terms.every((term) => haystack.includes(term));
}

export function filterDownloads(list: DownloadRecord[], filters: DownloadFilters) {
  return list.filter(
    (record) =>
      (filters.status === "all" || statusGroupOf(record) === filters.status) &&
      (filters.type === "all" || typeOfDownload(record) === filters.type) &&
      (!filters.tag ||
        (record.tags ?? []).some((tag) => tag.toLowerCase() === filters.tag!.toLowerCase())) &&
      matchesQuery(record, filters.query),
  );
}

/** Contagem por filtro de status (os números dos chips). */
export function statusCounts(list: DownloadRecord[]): Record<DownloadStatusFilter, number> {
  const counts: Record<DownloadStatusFilter, number> = {
    all: list.length,
    running: 0,
    paused: 0,
    completed: 0,
    failed: 0,
  };
  for (const record of list) counts[statusGroupOf(record)] += 1;
  return counts;
}

/** Todas as etiquetas em uso, em ordem alfabética. */
export function tagsInUse(list: DownloadRecord[]): string[] {
  const seen = new Map<string, string>();
  for (const record of list) {
    for (const tag of record.tags ?? []) {
      if (!seen.has(tag.toLowerCase())) seen.set(tag.toLowerCase(), tag);
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/** Pasta do arquivo (Windows ou POSIX), sem o nome. */
export function folderOf(filePath: string): string {
  const index = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return index > 0 ? filePath.slice(0, index) : filePath;
}

/** Tecla do gerenciador → ação no item focado (null: a tecla segue). */
export function managerKeyAction(
  event: { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean },
  record: DownloadRecord | null,
): "toggle" | "cancel" | "remove" | "restart" | "search" | "open" | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === "f") return "search";
  if (!record) return null;
  const running = record.state === "progressing";
  if (key === " ") return running ? "toggle" : null;
  if (key === "delete")
    return event.shiftKey ? (running ? null : "remove") : running ? "cancel" : null;
  if (key === "r") return record.url.startsWith("http") ? "restart" : null;
  if (key === "enter") return record.state === "completed" ? "open" : null;
  return null;
}

const TAG_PALETTE = ["#d10a11", "#e46c0a", "#c99a06", "#2f9e44", "#1c7ed6", "#7048e8", "#c2255c"];

/** Cor da etiqueta: a escolhida, ou uma fixa pelo nome (a mesma em todas as janelas). */
export function tagColorOf(tag: string, colors: Record<string, string>): string {
  if (colors[tag]) return colors[tag]!;
  let hash = 0;
  for (const char of tag.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TAG_PALETTE[hash % TAG_PALETTE.length]!;
}

/** Etiquetas sem repetir (sem diferenciar maiúsculas), curtas, no máximo 12 (como o main). */
export function cleanTagList(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const tag = item.replace(/\s+/g, " ").trim().slice(0, 32);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
  }
  return out.slice(0, 12);
}

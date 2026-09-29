import type { DownloadRecord } from "@/features/browser/desktop";

const UNITS = ["B", "KB", "MB", "GB", "TB"];

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  const value = bytes / 1024 ** exponent;
  const digits = exponent === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits).replace(".", ",")} ${UNITS[exponent]}`;
}

/** Fração concluída (0–1) ou null quando o servidor não informou o tamanho. */
export function progressOf(record: DownloadRecord): number | null {
  if (record.state === "completed") return 1;
  if (!record.totalBytes) return null;
  return Math.min(record.receivedBytes / record.totalBytes, 1);
}

export function statusOf(record: DownloadRecord): string {
  switch (record.state) {
    case "completed":
      return formatBytes(record.totalBytes || record.receivedBytes);
    case "cancelled":
      return "Cancelado";
    case "interrupted":
      return "Falhou";
    case "progressing": {
      const received = formatBytes(record.receivedBytes);
      const total = record.totalBytes ? ` de ${formatBytes(record.totalBytes)}` : "";
      return record.paused ? `Pausado · ${received}${total}` : `${received}${total}`;
    }
  }
}

/** Progresso agregado dos downloads em andamento (para o botão da barra). */
export function batchProgress(list: DownloadRecord[]): { active: number; fraction: number | null } {
  const running = list.filter((item) => item.state === "progressing");
  if (!running.length) return { active: 0, fraction: null };
  const total = running.reduce((sum, item) => sum + item.totalBytes, 0);
  if (!total || running.some((item) => !item.totalBytes)) {
    return { active: running.length, fraction: null };
  }
  const received = running.reduce((sum, item) => sum + item.receivedBytes, 0);
  return { active: running.length, fraction: Math.min(received / total, 1) };
}

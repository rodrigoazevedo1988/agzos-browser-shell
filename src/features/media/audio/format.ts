// Formatação de tempo e tamanho para a tela do Música. Função pura.

/** 0:05, 3:42, 1:02:09. Valor inválido (NaN, negativo, infinito) vira 0:00. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Duração da lista: travessão quando o arquivo não informa e ainda não tocou. */
export function formatDurationOrDash(seconds: number | null | undefined): string {
  return seconds && Number.isFinite(seconds) && seconds > 0 ? formatDuration(seconds) : "—";
}

/** Soma de duração em texto curto: "2 h 14 min", "38 min", "45 s". */
export function formatTotal(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0 min";
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

/** Último pedaço do caminho (funciona com / e \). */
export function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/**
 * Transmissão para Chromecast / Android TV (6.0) vista pela casca. A conversa com o aparelho
 * é toda do main (electron/cast.cjs); a casca só recebe um resumo das sessões de cada guia
 * e manda comandos (tocar, pausar, avançar, volume, parar).
 */
export type CastState = "idle" | "buffering" | "playing" | "paused" | "ended" | "error";

export type CastSessionInfo = {
  sessionId: string;
  deviceName: string;
  state: CastState;
  currentTime: number;
  duration?: number;
  volume?: number;
  error?: string;
  title: string;
};

export type CastTabSessions = { tabId: number; sessions: CastSessionInfo[] };

export type CastAction = "play" | "pause" | "seek" | "stop" | "volume";

export type DesktopCast = {
  castSessions(): Promise<CastTabSessions[]>;
  castControl(
    sessionId: string,
    action: CastAction,
    value?: number,
  ): Promise<{ ok: boolean; error?: string }>;
  onCastSessions(callback: (payload: CastTabSessions) => void): () => void;
};

export function castStateText(state: CastState): string {
  switch (state) {
    case "buffering":
      return "Carregando…";
    case "playing":
      return "Tocando";
    case "paused":
      return "Pausado";
    case "ended":
      return "Terminou";
    case "error":
      return "Erro";
    default:
      return "Parado";
  }
}

export function formatCastTime(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

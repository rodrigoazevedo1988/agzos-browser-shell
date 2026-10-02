/**
 * Sons da interface (3.1.1): tick de navegação no hover da barra lateral e dos cards do
 * Discador, e tick de teclado nos campos de busca, endereço e dos modais. Tudo opcional
 * (Configurações → Sons). Puro: o player fica em player.ts.
 */

export const SOUND_TICKS = [
  { id: "mecanico", label: "Mecânico" },
  { id: "suave", label: "Suave" },
  { id: "maquina", label: "Máquina de escrever" },
] as const;

export type SoundTick = (typeof SOUND_TICKS)[number]["id"];
export type SoundKind = "hover" | "key";

export const DEFAULT_SOUND_TICK: SoundTick = "mecanico";

export function parseSoundTick(value: unknown): SoundTick {
  return SOUND_TICKS.some((tick) => tick.id === value) ? (value as SoundTick) : DEFAULT_SOUND_TICK;
}

export function parseSoundVolume(value: unknown, fallback = 40): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.round(Math.min(100, Math.max(0, value)));
}

export type SoundPrefs = {
  sounds: boolean;
  soundHover: boolean;
  soundKeys: boolean;
  soundTick: SoundTick;
  soundVolume: number;
};

/** Volume final (0–1) de um som, ou 0 quando ele está desligado. */
export function soundGain(prefs: SoundPrefs, kind: SoundKind): number {
  if (!prefs.sounds || prefs.soundVolume <= 0) return 0;
  if (kind === "hover" && !prefs.soundHover) return 0;
  if (kind === "key" && !prefs.soundKeys) return 0;
  // Curva perceptiva: 40 % no controle soa como "baixo", não como a metade do máximo.
  const level = (prefs.soundVolume / 100) ** 2;
  return kind === "hover" ? level * 0.7 : level;
}

/** Intervalo mínimo entre dois sons do mesmo tipo: sem rajada ao varrer a barra. */
export const SOUND_GAP_MS: Record<SoundKind, number> = { hover: 70, key: 25 };

/** Relógio por tipo: true quando já pode tocar de novo (e marca o horário). */
export function createThrottle(gaps: Record<SoundKind, number> = SOUND_GAP_MS) {
  const last: Partial<Record<SoundKind, number>> = {};
  return (kind: SoundKind, now: number) => {
    const previous = last[kind];
    if (previous !== undefined && now - previous < gaps[kind]) return false;
    last[kind] = now;
    return true;
  };
}

/** Teclas que tocam o tick: caracteres, apagar e espaço (não Tab, setas, Ctrl+C…). */
export function isTypingKey(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  return event.key.length === 1 || event.key === "Backspace" || event.key === "Delete";
}

/** Marcas nos elementos (data-sound): quem toca o quê. */
export const HOVER_SOUND = { "data-sound": "hover" } as const;
export const KEY_SOUND = { "data-sound": "keys" } as const;

import keyMaquina from "@/assets/sounds/key-maquina.wav?inline";
import keyMecanico from "@/assets/sounds/key-mecanico.wav?inline";
import keySuave from "@/assets/sounds/key-suave.wav?inline";
import navTick from "@/assets/sounds/nav-tick.wav?inline";

import type { SoundTick } from "./sounds";

// Embutidos como data: URL (o app abre de file://, onde fetch de arquivo é bloqueado).
const SOURCES: Record<"nav" | SoundTick, string> = {
  nav: navTick,
  mecanico: keyMecanico,
  suave: keySuave,
  maquina: keyMaquina,
};

let context: AudioContext | null = null;
const buffers = new Map<string, Promise<AudioBuffer | null>>();

function audio(): AudioContext | null {
  if (typeof window === "undefined" || typeof window.AudioContext === "undefined") return null;
  context ??= new AudioContext({ latencyHint: "interactive" });
  if (context.state === "suspended") void context.resume().catch(() => {});
  return context;
}

function bufferOf(ctx: AudioContext, name: keyof typeof SOURCES) {
  let pending = buffers.get(name);
  if (!pending) {
    pending = fetch(SOURCES[name])
      .then((response) => response.arrayBuffer())
      .then((data) => ctx.decodeAudioData(data))
      .catch(() => null);
    buffers.set(name, pending);
  }
  return pending;
}

/**
 * Toca um som curto. `rate` varia de leve a altura dos ticks de teclado (soa natural ao
 * digitar). Sem áudio (servidor, teste, política de autoplay), não faz nada.
 */
export function playSound(name: "nav" | SoundTick, gain: number, rate = 1): void {
  if (gain <= 0) return;
  const ctx = audio();
  if (!ctx) return;
  void bufferOf(ctx, name).then((buffer) => {
    if (!buffer || ctx.state === "closed") return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const volume = ctx.createGain();
    volume.gain.value = gain;
    source.connect(volume).connect(ctx.destination);
    source.start();
  });
}

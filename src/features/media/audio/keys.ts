// Atalhos do Música (teclado dentro da página). Função pura: a tela decide o que fazer.

export type MusicKey = {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
};

export type MusicAction =
  | { type: "toggle" }
  | { type: "seek"; seconds: number }
  | { type: "next" }
  | { type: "prev" }
  | { type: "mute" }
  | { type: "volumeStep"; delta: number };

/** Controles de texto e botões ficam com o próprio elemento (Space ativa o botão). */
const KEEP_NATIVE = new Set(["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"]);

export function isNativeTarget(tag: string | undefined, editable: boolean): boolean {
  return editable || (tag !== undefined && KEEP_NATIVE.has(tag.toUpperCase()));
}

/** Tecla → ação (ou null). Ctrl ou ⌘ com as setas trocam de faixa; sem modificador, avança. */
export function musicAction(key: MusicKey, native: boolean): MusicAction | null {
  if (native) return null;
  const mod = Boolean(key.ctrl || key.meta);
  if (key.alt) return null;
  if (key.key === " " || key.key === "Spacebar") {
    return key.shift || mod ? null : { type: "toggle" };
  }
  if (key.key === "ArrowLeft") {
    if (mod) return { type: "prev" };
    return key.shift ? null : { type: "seek", seconds: -5 };
  }
  if (key.key === "ArrowRight") {
    if (mod) return { type: "next" };
    return key.shift ? null : { type: "seek", seconds: 5 };
  }
  if ((key.key === "m" || key.key === "M") && !mod && !key.shift) return { type: "mute" };
  if (key.key === "ArrowUp" && mod) return { type: "volumeStep", delta: 0.05 };
  if (key.key === "ArrowDown" && mod) return { type: "volumeStep", delta: -0.05 };
  return null;
}

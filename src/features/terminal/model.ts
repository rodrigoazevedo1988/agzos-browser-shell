/** Terminal (4.0): limites do painel e regras puras das sessões. */
export const TERMINAL_HEIGHT = { min: 140, max: 900, initial: 280 } as const;

export function clampTerminalHeight(value: unknown): number {
  const height = typeof value === "number" && Number.isFinite(value) ? value : NaN;
  if (Number.isNaN(height)) return TERMINAL_HEIGHT.initial;
  return Math.round(Math.min(TERMINAL_HEIGHT.max, Math.max(TERMINAL_HEIGHT.min, height)));
}

/** Altura máxima que ainda deixa `keep` px de página acima do terminal. */
export function terminalHeightLimit(available: number, keep = 160) {
  return Math.max(TERMINAL_HEIGHT.min, Math.min(TERMINAL_HEIGHT.max, available - keep));
}

/** Nome da aba da sessão: o nome do shell e a última pasta ("pwsh · projeto"). */
export function sessionTitle(shell: string, cwd: string | null) {
  const name = shell.replace(/^.*[\\/]/, "").replace(/\.exe$/i, "");
  const folder = cwd ? cwd.replace(/[\\/]+$/, "").replace(/^.*[\\/]/, "") : "";
  return folder ? `${name} · ${folder}` : name;
}

/**
 * Teclas que, com o foco no terminal, continuam sendo do navegador. O resto (Ctrl+C,
 * Ctrl+W, Ctrl+R, Ctrl+L…) vai para o shell, como num terminal de verdade.
 */
const BROWSER_COMBOS = new Set([
  "mod+tab",
  "mod+shift+tab",
  "mod+pageup",
  "mod+pagedown",
  "mod+shift+pageup",
  "mod+shift+pagedown",
  "mod+alt+t",
  "mod+shift+a",
  "mod+shift+t",
  "mod+shift+n",
  "mod+1",
  "mod+2",
  "mod+3",
  "mod+4",
  "mod+5",
  "mod+6",
  "mod+7",
  "mod+8",
  "mod+9",
  "f11",
]);

/** Mesma regra de electron/terminal.cjs (o main decide antes, com o foco no terminal). */
export function terminalKeepsBrowserKey(
  combo: string,
  { mac = false, meta = false }: { mac?: boolean; meta?: boolean } = {},
) {
  // No Mac o ⌘ nunca é do shell (o Ctrl é): ⌘T, ⌘W, ⌘L seguem para o navegador.
  if (mac && meta) return true;
  return BROWSER_COMBOS.has(combo);
}

/** Copiar/colar no terminal: Ctrl+Shift+C/V (e ⌘C/⌘V no Mac; Ctrl+V no Windows). */
export function clipboardKey(
  event: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean },
  platform: "mac" | "windows" | "linux",
  hasSelection: boolean,
): "copy" | "paste" | null {
  const key = event.key.toLowerCase();
  if (event.altKey) return null;
  if (platform === "mac") {
    if (!event.metaKey || event.ctrlKey) return null;
    return key === "c" ? "copy" : key === "v" ? "paste" : null;
  }
  if (!event.ctrlKey || event.metaKey) return null;
  if (event.shiftKey) return key === "c" ? "copy" : key === "v" ? "paste" : null;
  // Como no Windows Terminal: Ctrl+C com seleção copia (sem seleção é o ^C do shell).
  if (key === "c" && hasSelection) return "copy";
  if (key === "v" && platform === "windows") return "paste";
  return null;
}

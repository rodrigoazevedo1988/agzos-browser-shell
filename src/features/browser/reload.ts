/**
 * 5.0.3: modos de recarregar a guia. Puro (sem DOM): o botão da barra, o menu do DevTools
 * e os testes usam as mesmas regras.
 */

export type ReloadMode = "normal" | "hard" | "empty";

/** Segurar o botão de recarregar por este tempo abre o menu (como o clique direito). */
export const RELOAD_LONG_PRESS_MS = 500;

export const RELOAD_MODE_LABELS: Record<ReloadMode, string> = {
  normal: "Recarregar normalmente",
  hard: "Recarregar ignorando o cache",
  empty: "Esvaziar o cache e recarregar",
};

/** O que o main faz para cada modo (tab:reload). */
export function reloadOptionsOf(mode: ReloadMode): { ignoreCache: boolean; emptyCache: boolean } {
  return {
    ignoreCache: mode !== "normal",
    emptyCache: mode === "empty",
  };
}

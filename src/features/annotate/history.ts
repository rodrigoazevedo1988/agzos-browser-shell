/**
 * Histórico de desfazer/refazer com valores imutáveis. Usado pela captura (lista de formas)
 * e pelo Agzos Imagem (entradas com rótulo, ver image-studio/state.ts).
 */

export type History<T> = { past: T[]; present: T; future: T[] };

export const HISTORY_LIMIT = 200;

export function historyOf<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

export function commitTo<T>(history: History<T>, present: T, limit = HISTORY_LIMIT): History<T> {
  return { past: [...history.past, history.present].slice(-limit), present, future: [] };
}

export function undoOf<T>(history: History<T>): History<T> {
  const previous = history.past[history.past.length - 1];
  if (previous === undefined) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redoOf<T>(history: History<T>): History<T> {
  const [next, ...rest] = history.future;
  if (next === undefined) return history;
  return { past: [...history.past, history.present], present: next, future: rest };
}

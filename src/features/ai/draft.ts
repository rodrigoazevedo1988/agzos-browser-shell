/**
 * Texto para a caixa de mensagem do Agzos AI vindo de outro recurso (ex.: a bolha de
 * tradução, "Abrir no Agzos AI"). O painel pode ainda não estar montado: o texto fica
 * guardado até ele pegar, e um evento avisa o painel já aberto.
 */
const EVENT = "agzos:ai-draft";
let pending: string | null = null;

export function setAiDraft(text: string) {
  pending = text;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

/** Pega (e esvazia) o texto guardado. */
export function takeAiDraft(): string {
  const value = pending ?? "";
  pending = null;
  return value;
}

export function onAiDraft(callback: (text: string) => void): () => void {
  const listener = () => {
    const value = takeAiDraft();
    if (value) callback(value);
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

import type { PanelKind } from "./panels";

// Props de um painel atravessando o IPC: os dados vão como estão (structured clone) e as
// funções viram nomes. Na camada, cada nome vira uma função que chama a casca de volta.

type AnyFn = (...args: unknown[]) => unknown;

export type OverlayPayload = {
  kind: PanelKind;
  key: string;
  data: Record<string, unknown>;
  fns: string[];
  /** Classes do .browser-stage (tema, guias verticais…): o painel fica no mesmo lugar. */
  classes: string[];
};

export function splitProps(props: object) {
  const data: Record<string, unknown> = {};
  const fns: Record<string, AnyFn> = {};
  for (const [name, value] of Object.entries(props)) {
    if (typeof value === "function") fns[name] = value as AnyFn;
    else if (value !== undefined) data[name] = value;
  }
  return { data, fns };
}

export function hydrateProps(
  data: Record<string, unknown>,
  fns: readonly string[],
  call: (name: string, args: unknown[]) => Promise<unknown>,
  local: Partial<Record<string, AnyFn>> = {},
): Record<string, unknown> {
  const props: Record<string, unknown> = { ...data };
  for (const name of fns) {
    props[name] = (...args: unknown[]) => {
      local[name]?.(...args);
      return call(name, args.map(cloneableArg));
    };
  }
  return props;
}

/**
 * Argumento que atravessa o IPC. `onClick={onClose}` passa o evento do clique, que o
 * structured clone recusa (e a chamada inteira falharia): vira undefined.
 */
export function cloneableArg(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return typeof value === "function" || typeof value === "symbol" ? undefined : value;
  }
  try {
    return structuredClone(value);
  } catch {
    return undefined;
  }
}

/** Só o que o structured clone do IPC aceita volta para a camada. */
export function cloneableResult(value: unknown): unknown {
  if (value === null || ["string", "number", "boolean", "undefined"].includes(typeof value)) {
    return value;
  }
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return undefined;
  }
}

/** Ponte da camada (electron/overlay-preload.cjs). */
export type OverlayBridge = {
  ready(): void;
  onRender(callback: (model: OverlayPayload | null) => void): () => void;
  call(name: string, args: unknown[]): Promise<unknown>;
  dismiss(): void;
  wheel(payload: { x: number; y: number; deltaX: number; deltaY: number }): void;
};

export function overlayBridge(): OverlayBridge | null {
  if (typeof window === "undefined") return null;
  return (window as Window & { agzosOverlay?: OverlayBridge }).agzosOverlay ?? null;
}

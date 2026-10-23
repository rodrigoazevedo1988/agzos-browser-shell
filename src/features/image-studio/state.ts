import type { Asset, Assets, Doc, Element } from "./model";

/**
 * Estado do editor: o documento ao vivo, o histórico (entradas com rótulo; o arrasto gera
 * prévias que não entram nele até soltar) e a seleção. Redutor puro, testado sem React.
 */

export type HistoryEntry = { label: string; doc: Doc; key?: string };

export type StudioState = {
  /** Documento ao vivo; null na tela inicial. */
  doc: Doc | null;
  entries: HistoryEntry[];
  index: number;
  /** Índice da última gravação (para saber se há alterações não salvas). */
  saved: number;
  assets: Assets;
  name: string;
  selection: string[];
};

export const emptyStudio: StudioState = {
  doc: null,
  entries: [],
  index: 0,
  saved: 0,
  assets: {},
  name: "Sem título",
  selection: [],
};

export type StudioAction =
  | { type: "open"; doc: Doc; assets?: Assets; name: string; label: string }
  | { type: "start" }
  | { type: "preview"; doc: Doc }
  | { type: "commit"; label: string; doc?: Doc; key?: string }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "jump"; index: number }
  | { type: "select"; ids: string[]; mode: "replace" | "toggle" | "add" }
  | { type: "asset"; asset: Asset }
  | { type: "saved"; name?: string }
  | { type: "rename"; name: string };

/** Acrescenta uma entrada, descartando o que estava depois do índice atual. */
export function pushEntry(
  entries: HistoryEntry[],
  index: number,
  entry: HistoryEntry,
  limit = 200,
): { entries: HistoryEntry[]; index: number; dropped: number } {
  const kept = entries.slice(0, index + 1);
  const current = kept[kept.length - 1];
  if (entry.key && current?.key === entry.key) {
    // Mesmo controle, mesmo gesto (um slider): troca a entrada em vez de empilhar.
    kept[kept.length - 1] = entry;
    return { entries: kept, index: kept.length - 1, dropped: 0 };
  }
  kept.push(entry);
  const dropped = Math.max(0, kept.length - limit);
  const trimmed = dropped ? kept.slice(dropped) : kept;
  return { entries: trimmed, index: trimmed.length - 1, dropped };
}

function keepSelection(doc: Doc | null, ids: string[]): string[] {
  if (!doc) return [];
  const alive = new Set(doc.elements.map((element: Element) => element.id));
  return ids.filter((id) => alive.has(id));
}

export function studioReducer(state: StudioState, action: StudioAction): StudioState {
  switch (action.type) {
    case "open":
      return {
        ...state,
        doc: action.doc,
        entries: [{ label: action.label, doc: action.doc }],
        index: 0,
        saved: 0,
        assets: action.assets ?? {},
        name: action.name.slice(0, 120) || "Sem título",
        selection: [],
      };
    case "start":
      return { ...emptyStudio, name: state.name };
    case "preview":
      return state.doc ? { ...state, doc: action.doc } : state;
    case "commit": {
      const doc = action.doc ?? state.doc;
      if (!doc || doc === state.entries[state.index]?.doc) return { ...state, doc };
      const pushed = pushEntry(state.entries, state.index, {
        label: action.label,
        doc,
        ...(action.key ? { key: action.key } : {}),
      });
      const saved = Math.max(-1, state.saved - pushed.dropped);
      return {
        ...state,
        doc,
        entries: pushed.entries,
        index: pushed.index,
        saved: saved < 0 ? -1 : saved,
        selection: keepSelection(doc, state.selection),
      };
    }
    case "undo":
    case "redo":
    case "jump": {
      const index =
        action.type === "undo"
          ? state.index - 1
          : action.type === "redo"
            ? state.index + 1
            : action.index;
      const entry = state.entries[index];
      if (!entry || (index === state.index && state.doc === entry.doc)) return state;
      return {
        ...state,
        doc: entry.doc,
        index,
        selection: keepSelection(entry.doc, state.selection),
      };
    }
    case "select": {
      const ids =
        action.mode === "replace"
          ? action.ids
          : action.mode === "add"
            ? [...new Set([...state.selection, ...action.ids])]
            : toggle(state.selection, action.ids);
      return { ...state, selection: keepSelection(state.doc, ids) };
    }
    case "asset":
      return { ...state, assets: { ...state.assets, [action.asset.id]: action.asset } };
    case "saved":
      return {
        ...state,
        saved: state.index,
        name: action.name ? action.name.slice(0, 120) : state.name,
      };
    case "rename":
      return { ...state, name: action.name.slice(0, 120) || "Sem título" };
  }
}

function toggle(selection: string[], ids: string[]): string[] {
  const next = new Set(selection);
  for (const id of ids) {
    if (next.has(id)) next.delete(id);
    else next.add(id);
  }
  return [...next];
}

export const canUndo = (state: StudioState) => state.index > 0;
export const canRedo = (state: StudioState) => state.index < state.entries.length - 1;
export const isDirty = (state: StudioState) => state.doc !== null && state.index !== state.saved;

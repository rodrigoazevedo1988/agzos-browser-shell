import { describe, expect, it } from "vitest";

import { addElement, emptyDoc, newShape, transformAt, type Doc } from "./model";
import {
  canRedo,
  canUndo,
  emptyStudio,
  isDirty,
  pushEntry,
  studioReducer,
  type StudioState,
} from "./state";

const doc = (n: number): Doc => emptyDoc(100 + n, 100);
const opened = (): StudioState =>
  studioReducer(emptyStudio, { type: "open", doc: doc(0), name: "Teste", label: "Início" });

describe("histórico", () => {
  it("cada gravação vira uma entrada; desfazer e refazer andam por elas", () => {
    let state = opened();
    state = studioReducer(state, { type: "commit", label: "Mover", doc: doc(1) });
    state = studioReducer(state, { type: "commit", label: "Girar", doc: doc(2) });
    expect(state.entries.map((entry) => entry.label)).toEqual(["Início", "Mover", "Girar"]);
    expect(canUndo(state)).toBe(true);
    state = studioReducer(state, { type: "undo" });
    expect(state.doc?.width).toBe(101);
    expect(canRedo(state)).toBe(true);
    state = studioReducer(state, { type: "redo" });
    expect(state.doc?.width).toBe(102);
    state = studioReducer(state, { type: "jump", index: 0 });
    expect(state.doc?.width).toBe(100);
  });

  it("gravar depois de desfazer descarta o refazer", () => {
    let state = opened();
    state = studioReducer(state, { type: "commit", label: "A", doc: doc(1) });
    state = studioReducer(state, { type: "undo" });
    state = studioReducer(state, { type: "commit", label: "B", doc: doc(3) });
    expect(state.entries.map((entry) => entry.label)).toEqual(["Início", "B"]);
    expect(canRedo(state)).toBe(false);
  });

  it("prévias do arrasto não entram no histórico", () => {
    let state = opened();
    state = studioReducer(state, { type: "preview", doc: doc(5) });
    state = studioReducer(state, { type: "preview", doc: doc(6) });
    expect(state.entries).toHaveLength(1);
    expect(state.doc?.width).toBe(106);
    state = studioReducer(state, { type: "commit", label: "Mover", doc: doc(6) });
    expect(state.entries).toHaveLength(2);
  });

  it("um mesmo gesto (chave) troca a última entrada em vez de empilhar", () => {
    const first = pushEntry([{ label: "Início", doc: doc(0) }], 0, {
      label: "Brilho",
      doc: doc(1),
      key: "brilho",
    });
    const second = pushEntry(first.entries, first.index, {
      label: "Brilho",
      doc: doc(2),
      key: "brilho",
    });
    expect(second.entries).toHaveLength(2);
    expect(second.entries[1]!.doc.width).toBe(102);
  });

  it("limita o tamanho do histórico", () => {
    let entries = [{ label: "Início", doc: doc(0) }];
    let index = 0;
    for (let n = 1; n <= 5; n += 1) {
      const pushed = pushEntry(entries, index, { label: `n${n}`, doc: doc(n) }, 3);
      entries = pushed.entries;
      index = pushed.index;
    }
    expect(entries).toHaveLength(3);
    expect(entries[0]!.label).toBe("n3");
  });

  it("controla o estado de salvo (sujo só depois de mudar)", () => {
    let state = opened();
    expect(isDirty(state)).toBe(false);
    state = studioReducer(state, { type: "commit", label: "A", doc: doc(1) });
    expect(isDirty(state)).toBe(true);
    state = studioReducer(state, { type: "saved", name: "Novo" });
    expect(isDirty(state)).toBe(false);
    expect(state.name).toBe("Novo");
  });
});

describe("seleção e ativos", () => {
  it("seleciona, alterna e esquece ids que sumiram", () => {
    const shape = newShape("a", "rect", transformAt(0, 0, 10, 10), { fill: "#000", stroke: null });
    let state = opened();
    state = studioReducer(state, {
      type: "commit",
      label: "+a",
      doc: addElement(state.doc!, shape),
    });
    state = studioReducer(state, { type: "select", ids: ["a"], mode: "replace" });
    expect(state.selection).toEqual(["a"]);
    state = studioReducer(state, { type: "select", ids: ["a"], mode: "toggle" });
    expect(state.selection).toEqual([]);
    state = studioReducer(state, { type: "select", ids: ["a", "zz"], mode: "add" });
    expect(state.selection).toEqual(["a"]);
    state = studioReducer(state, { type: "undo" });
    expect(state.selection).toEqual([]);
  });

  it("sem documento, comandos de edição não fazem nada", () => {
    const state = studioReducer(emptyStudio, { type: "preview", doc: doc(1) });
    expect(state.doc).toBeNull();
    expect(studioReducer(state, { type: "start" }).doc).toBeNull();
  });
});

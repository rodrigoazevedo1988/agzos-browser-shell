import { describe, expect, it } from "vitest";

import {
  addElement,
  alignElements,
  duplicate,
  emptyDoc,
  moveElements,
  newShape,
  newText,
  patchElement,
  removeElements,
  reorder,
  resizeCanvas,
  transformAt,
  type Doc,
  type Element,
} from "./model";

const shape = (id: string, x = 0, y = 0, width = 100, height = 100): Element =>
  newShape(id, "rect", transformAt(x, y, width, height), { fill: "#ff0000", stroke: null });

function docOf(...ids: string[]): Doc {
  return ids.reduce((doc, id) => addElement(doc, shape(id)), emptyDoc(500, 500));
}
const order = (doc: Doc) => doc.elements.map((element) => element.id);

describe("camadas", () => {
  it("adiciona por cima e remove pelos ids", () => {
    const doc = docOf("a", "b", "c");
    expect(order(doc)).toEqual(["a", "b", "c"]);
    expect(order(removeElements(doc, ["b", "zz"]))).toEqual(["a", "c"]);
  });

  it("frente e trás levam a seleção ao topo e ao fundo, mantendo a ordem relativa", () => {
    const doc = docOf("a", "b", "c", "d");
    expect(order(reorder(doc, ["a", "b"], "front"))).toEqual(["c", "d", "a", "b"]);
    expect(order(reorder(doc, ["c", "d"], "back"))).toEqual(["c", "d", "a", "b"]);
  });

  it("subir e descer trocam com o vizinho não selecionado", () => {
    const doc = docOf("a", "b", "c");
    expect(order(reorder(doc, ["a"], "forward"))).toEqual(["b", "a", "c"]);
    expect(order(reorder(doc, ["c"], "backward"))).toEqual(["a", "c", "b"]);
    // Já no topo: subir não muda nada.
    expect(order(reorder(doc, ["c"], "forward"))).toEqual(["a", "b", "c"]);
  });

  it("duplica por cima com deslocamento e devolve os ids novos", () => {
    const doc = docOf("a", "b");
    let n = 0;
    const result = duplicate(doc, ["a"], () => `copy${++n}`, 10);
    expect(order(result.doc)).toEqual(["a", "b", "copy1"]);
    expect(result.ids).toEqual(["copy1"]);
    expect(result.doc.elements[2]!.transform.x).toBe(10);
  });

  it("muda propriedades sem mexer nos outros elementos", () => {
    const doc = docOf("a", "b");
    const next = patchElement(doc, "a", { opacity: 0.5, hidden: true });
    expect(next.elements[0]).toMatchObject({ opacity: 0.5, hidden: true });
    expect(next.elements[1]).toBe(doc.elements[1]);
  });
});

describe("movimento e alinhamento", () => {
  it("move só o que não está bloqueado", () => {
    const doc = patchElement(docOf("a", "b"), "b", { locked: true });
    const moved = moveElements(doc, ["a", "b"], 5, -3);
    expect(moved.elements[0]!.transform).toMatchObject({ x: 5, y: -3 });
    expect(moved.elements[1]!.transform).toMatchObject({ x: 0, y: 0 });
  });

  it("alinha à esquerda, ao centro e na base pela caixa do grupo", () => {
    let doc = emptyDoc(500, 500);
    doc = addElement(doc, shape("a", 10, 20, 100, 50));
    doc = addElement(doc, shape("b", 200, 100, 40, 80));
    const left = alignElements(doc, ["a", "b"], "left");
    expect(left.elements.map((element) => element.transform.x)).toEqual([10, 10]);
    const bottom = alignElements(doc, ["a", "b"], "bottom");
    expect(
      bottom.elements.map((element) => element.transform.y + element.transform.height),
    ).toEqual([180, 180]);
    // Um só elemento não tem com quem alinhar.
    expect(alignElements(doc, ["a"], "center")).toBe(doc);
  });
});

describe("tela", () => {
  it("muda o tamanho e pode centralizar o conteúdo", () => {
    const doc = docOf("a");
    const grown = resizeCanvas(doc, 700, 700, true);
    expect(grown.width).toBe(700);
    expect(grown.elements[0]!.transform.x).toBe(100);
    const corner = resizeCanvas(doc, 700, 700, false);
    expect(corner.elements[0]!.transform.x).toBe(0);
  });
});

describe("textos e figuras novos", () => {
  it("nascem com o padrão do editor", () => {
    const text = newText("t", transformAt(0, 0, 300, 80), "Olá\nmundo", 60, "#000000");
    expect(text).toMatchObject({ kind: "text", name: "Olá", weight: 700, align: "left" });
    expect(text.background).toBeNull();
  });
});

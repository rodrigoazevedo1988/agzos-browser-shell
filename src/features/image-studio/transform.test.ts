import { describe, expect, it } from "vitest";

import {
  applyCrop,
  boundsOf,
  corners,
  cropToAspect,
  handlePoints,
  hitTransform,
  marqueeHits,
  resizeTransform,
  rotateMember,
  rotationTo,
  scaleMember,
  snapMove,
  sourcePoint,
  toDoc,
  toLocal,
  topmostAt,
} from "./transform";
import {
  newImage,
  newShape,
  transformAt,
  type Asset,
  type Element,
  type ImageElement,
} from "./model";

const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6);
const closePoint = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  close(a.x, b.x);
  close(a.y, b.y);
};

describe("caixa girada", () => {
  it("converte ida e volta entre a caixa e o documento", () => {
    const t = { ...transformAt(100, 50, 200, 100), rotation: 37 };
    const local = { x: 13, y: 71 };
    closePoint(toLocal(t, toDoc(t, local)), local);
  });

  it("os cantos de uma caixa girada 90° trocam de lugar", () => {
    const t = { ...transformAt(0, 0, 100, 40), rotation: 90 };
    const [topLeft] = corners(t);
    // Centro (50,20); canto (0,0) gira para (70,-30)... ponto (x=-50,y=-20) → (20,-50)+centro.
    closePoint(topLeft!, { x: 70, y: -30 });
  });

  it("a caixa dos elementos inclui as rotações", () => {
    const element = newShape(
      "s",
      "rect",
      { ...transformAt(0, 0, 100, 10), rotation: 90 },
      { fill: "#000", stroke: null },
    );
    const box = boundsOf([element])!;
    close(box.width, 10);
    close(box.height, 100);
  });
});

describe("acerto (clique)", () => {
  it("acha o elemento de cima, ignora ocultos e aceita folga para linhas", () => {
    const a = newShape("a", "rect", transformAt(0, 0, 100, 100), { fill: "#000", stroke: null });
    const b = newShape("b", "rect", transformAt(50, 50, 100, 100), { fill: "#000", stroke: null });
    const topDown: Element[] = [b, a];
    expect(topmostAt(topDown, { x: 60, y: 60 })?.id).toBe("b");
    expect(topmostAt(topDown, { x: 10, y: 10 })?.id).toBe("a");
    expect(topmostAt([{ ...b, hidden: true }, a], { x: 60, y: 60 })?.id).toBe("a");
    const line = newShape("l", "line", transformAt(0, 0, 100, 0), { fill: null, stroke: "#000" });
    expect(hitTransform(line.transform, { x: 50, y: 3 }, 0)).toBe(false);
    expect(hitTransform(line.transform, { x: 50, y: 3 }, 4)).toBe(true);
  });

  it("alças ficam nas bordas e a de rotação acima do topo", () => {
    const handles = handlePoints(transformAt(0, 0, 100, 60), 1);
    expect(handles.n).toEqual({ x: 50, y: 0 });
    expect(handles.se).toEqual({ x: 100, y: 60 });
    expect(handles.rotate.y).toBeLessThan(0);
  });
});

describe("redimensionar", () => {
  it("a alça de baixo à direita move só a borda de baixo à direita", () => {
    const start = transformAt(100, 100, 200, 100);
    const next = resizeTransform(start, "se", { x: 350, y: 260 });
    expect(next).toMatchObject({ x: 100, y: 100, width: 250, height: 160 });
  });

  it("a alça do lado de cima mantém a largura e move a borda de cima", () => {
    const start = transformAt(100, 100, 200, 100);
    const next = resizeTransform(start, "n", { x: 0, y: 40 });
    expect(next).toMatchObject({ x: 100, width: 200, height: 160, y: 40 });
  });

  it("Shift nas pontas mantém a proporção", () => {
    const start = transformAt(0, 0, 200, 100);
    const next = resizeTransform(start, "se", { x: 300, y: 120 }, { keepRatio: true });
    expect(next.width / next.height).toBeCloseTo(2);
    expect(next.width).toBeCloseTo(300);
  });

  it("não deixa a caixa passar do tamanho mínimo", () => {
    const next = resizeTransform(transformAt(0, 0, 100, 100), "e", { x: -50, y: 50 });
    expect(next.width).toBe(4);
    expect(next.x).toBeCloseTo(0);
  });

  it("em caixa girada, a âncora oposta continua no mesmo ponto do documento", () => {
    const start = { ...transformAt(200, 150, 160, 80), rotation: 30 };
    const anchor = toDoc(start, { x: 0, y: 0 });
    const next = resizeTransform(start, "se", toDoc(start, { x: 240, y: 120 }));
    closePoint(toDoc(next, { x: 0, y: 0 }), anchor);
  });
});

describe("rotação e grupos", () => {
  it("o ângulo acompanha o ponteiro e o Shift prende em 15°", () => {
    expect(rotationTo({ x: 0, y: 0 }, { x: 0, y: -10 })).toBeCloseTo(0);
    expect(rotationTo({ x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(90);
    expect(rotationTo({ x: 0, y: 0 }, { x: 10, y: 1 }, true)).toBe(90);
    expect(rotationTo({ x: 0, y: 0 }, { x: 1, y: 10 }, true)).toBe(180);
  });

  it("escala e gira membros de um grupo em torno do ponto dado", () => {
    const scaled = scaleMember(transformAt(100, 100, 50, 50), { x: 0, y: 0 }, 2, 2);
    expect(scaled).toMatchObject({ width: 100, height: 100, x: 200, y: 200 });
    const turned = rotateMember(transformAt(0, 0, 10, 10), { x: 0, y: 0 }, 90);
    expect(turned.rotation).toBe(90);
    close(turned.x + 5, -5);
    close(turned.y + 5, 5);
  });
});

describe("encaixe e laço", () => {
  it("encaixa a borda ou o centro na linha de uma referência próxima", () => {
    const snap = snapMove(
      { x: 98, y: 300, width: 100, height: 100 },
      { xs: [100, 500], ys: [0, 900] },
      6,
    );
    expect(snap.dx).toBe(2);
    expect(snap.dy).toBe(0);
    expect(snap.guides).toEqual([{ axis: "x", at: 100 }]);
    expect(
      snapMove({ x: 40, y: 40, width: 10, height: 10 }, { xs: [0], ys: [0] }, 6).guides,
    ).toEqual([]);
  });

  it("laço pega o que cruza o retângulo e pula ocultos", () => {
    const a = newShape("a", "rect", transformAt(0, 0, 50, 50), { fill: "#000", stroke: null });
    const b = newShape("b", "rect", transformAt(200, 200, 50, 50), { fill: "#000", stroke: null });
    expect(marqueeHits([a, b], { x: 40, y: 40, width: 20, height: 20 })).toEqual(["a"]);
    expect(
      marqueeHits([{ ...a, hidden: true }, b], { x: 0, y: 0, width: 300, height: 300 }),
    ).toEqual(["b"]);
  });
});

describe("recorte e remoção de fundo", () => {
  const asset: Asset = {
    id: "p",
    name: "p",
    mime: "image/png",
    width: 400,
    height: 200,
    dataUrl: "data:image/png;base64,AA==",
  };
  const image = newImage("i", asset, transformAt(0, 0, 200, 100)) as ImageElement;

  it("acha o pixel da foto sob o ponto, respeitando o recorte e o espelho", () => {
    expect(sourcePoint(image, { x: 0, y: 0 }, asset)).toEqual({ x: 0, y: 0 });
    expect(sourcePoint(image, { x: 199, y: 99 }, asset)).toEqual({ x: 398, y: 198 });
    expect(sourcePoint(image, { x: 500, y: 500 }, asset)).toBeNull();
    const flipped = { ...image, transform: { ...image.transform, flipX: true } };
    expect(sourcePoint(flipped, { x: 0, y: 0 }, asset)).toEqual({ x: 399, y: 0 });
    const cropped = { ...image, crop: { x: 100, y: 50, width: 200, height: 100 } };
    expect(sourcePoint(cropped, { x: 0, y: 0 }, asset)).toEqual({ x: 100, y: 50 });
  });

  it("proporções do recorte são centralizadas e o maior possível", () => {
    expect(cropToAspect({ width: 400, height: 200 }, 1)).toEqual({
      x: 100,
      y: 0,
      width: 200,
      height: 200,
    });
    expect(cropToAspect({ width: 400, height: 200 }, null)).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 200,
    });
    expect(cropToAspect({ width: 100, height: 400 }, 16 / 9)).toMatchObject({
      width: 100,
      height: 56,
    });
  });

  it("aplicar recorte mantém a escala na tela", () => {
    const next = applyCrop(image, { x: 0, y: 0, width: 200, height: 100 }, asset);
    expect(next.crop).toEqual({ x: 0, y: 0, width: 200, height: 100 });
    expect(next.transform).toMatchObject({ width: 100, height: 50 });
    expect(applyCrop(next, null, asset).crop).toBeNull();
  });
});

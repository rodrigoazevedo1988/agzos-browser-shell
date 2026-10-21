import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  arrowHead,
  commit,
  constrain,
  emptyHistory,
  isEmptyShape,
  nextCounter,
  normRect,
  redo,
  undo,
  type Shape,
} from "./annotate";

// 4.9.7: página inteira (main) e editor da captura (casca).
const require = createRequire(import.meta.url);
const pageCapture = require(path.join(process.cwd(), "electron", "page-capture.cjs")) as {
  CAPTURE_WORLD: number;
  MAX_IMAGE_HEIGHT: number;
  planStrips: (total: number, viewport: number, maxStrips?: number) => number[];
  fitHeight: (total: number, scale: number) => { height: number; truncated: boolean };
  measureSource: () => string;
  fixedSource: (phase: "first" | "next" | "last") => string;
  restoreSource: () => string;
  scrollSource: (y: number) => string;
  capturePageStrips: (options: {
    run: (code: string) => Promise<unknown>;
    shot: (rect: unknown) => Promise<{ isEmpty: () => boolean; toDataURL: () => string }>;
  }) => Promise<{
    size: { width: number; height: number };
    truncated: boolean;
    layers: { y: number; height: number }[];
  } | null>;
};

describe("4.9.7: captura da página inteira", () => {
  it("planeja as faixas cobrindo a página, a última encostada no fim", () => {
    expect(pageCapture.planStrips(2500, 1000)).toEqual([0, 1000, 1500]);
    expect(pageCapture.planStrips(800, 1000)).toEqual([0]);
    expect(pageCapture.planStrips(3000, 1000)).toEqual([0, 1000, 2000]);
    expect(pageCapture.planStrips(100000, 1000, 5)).toHaveLength(5);
  });

  it("corta no teto do canvas conforme a escala da tela", () => {
    expect(pageCapture.fitHeight(10000, 2)).toEqual({ height: 10000, truncated: false });
    expect(pageCapture.fitHeight(40000, 2)).toEqual({
      height: Math.floor(pageCapture.MAX_IMAGE_HEIGHT / 2),
      truncated: true,
    });
  });

  it("scripts no mundo isolado próprio, sem <style> nem innerHTML, e devolvem a página", () => {
    expect(pageCapture.CAPTURE_WORLD).toBe(4136);
    const all = [
      pageCapture.measureSource(),
      pageCapture.fixedSource("next"),
      pageCapture.restoreSource(),
    ].join("\n");
    expect(all).not.toContain("innerHTML");
    expect(all).not.toContain("createElement");
    expect(pageCapture.measureSource()).toContain('"scroll-behavior", "auto", "important"');
    expect(pageCapture.fixedSource("next")).toContain("shadowRoot");
    expect(pageCapture.fixedSource("next")).toContain('const phase = "next"');
    expect(pageCapture.fixedSource("bogus" as "next")).toContain('const phase = "next"');
    expect(pageCapture.restoreSource()).toContain("removeProperty");
    expect(pageCapture.restoreSource()).toContain("state.fixed");
  });

  it("scroll sem suavidade e espera de imagens preguiçosas dentro de um teto", () => {
    expect(pageCapture.scrollSource(1000)).toContain('top: 1000, behavior: "instant"');
    expect(pageCapture.scrollSource(1000)).toContain("img.complete");
  });

  /** Página falsa: mede 2500 px, telas de 1000; `stall` faz a última rolagem não andar. */
  const fakePage = (stall = false) => {
    const calls: string[] = [];
    let scroll = 0;
    const run = async (code: string) => {
      if (code.includes("getElementsByTagName") && code.includes("overflowY")) {
        calls.push("measure");
        return { total: 2500, start: 40, clip: { x: 0, y: 0, width: 800, height: 1000 }, scale: 1 };
      }
      if (code.includes('behavior: "instant"') && code.includes("done(Math.round")) {
        const requested = Number(/top: (\d+)/.exec(code)?.[1] ?? 0);
        scroll = stall && requested === 1500 ? 1000 : requested;
        calls.push(`scroll ${requested}`);
        return scroll;
      }
      const phase = /const phase = "(\w+)"/.exec(code)?.[1];
      if (phase) {
        calls.push(`fixed ${phase}`);
        return 2;
      }
      calls.push("restore");
      return true;
    };
    const shot = async () => ({ isEmpty: () => false, toDataURL: () => `data:${scroll}` });
    return { calls, run, shot };
  };

  it("fixos do topo só na 1ª faixa, de baixo só na última, e restaura no fim", async () => {
    const page = fakePage();
    const result = await pageCapture.capturePageStrips({ run: page.run, shot: page.shot });
    expect(page.calls).toEqual([
      "measure",
      "scroll 0",
      "fixed first",
      "scroll 1000",
      "fixed next",
      "scroll 1500",
      "fixed last",
      "restore",
    ]);
    expect(result?.size).toEqual({ width: 800, height: 2500 });
    expect(result?.layers.map((layer) => layer.y)).toEqual([0, 1000, 1500]);
  });

  it("página que cabe numa tela não mexe nos fixos", async () => {
    const calls: string[] = [];
    const run = async (code: string) => {
      if (code.includes("getElementsByTagName") && code.includes("overflowY")) {
        calls.push("measure");
        return { total: 800, start: 0, clip: { x: 0, y: 0, width: 800, height: 1000 }, scale: 1 };
      }
      if (code.includes("const phase")) calls.push("fixed");
      if (code.includes("state.fixed")) {
        calls.push("restore");
        return true;
      }
      return 0;
    };
    const result = await pageCapture.capturePageStrips({
      run,
      shot: async () => ({ isEmpty: () => false, toDataURL: () => "data:" }),
    });
    expect(calls).toEqual(["measure", "restore"]);
    expect(result?.layers).toHaveLength(1);
  });

  it("para quando a página não rola mais e usa essa faixa como a última", async () => {
    const page = fakePage(true);
    const result = await pageCapture.capturePageStrips({ run: page.run, shot: page.shot });
    expect(page.calls.slice(-3)).toEqual(["scroll 1500", "fixed last", "restore"]);
    expect(result?.layers.map((layer) => layer.y)).toEqual([0, 1000, 1000]);
  });

  it("restaura o estilo mesmo quando a foto falha", async () => {
    const page = fakePage();
    const failing = await pageCapture
      .capturePageStrips({
        run: page.run,
        shot: async () => {
          throw new Error("x");
        },
      })
      .catch(() => "erro");
    expect(failing).toBe("erro");
    expect(page.calls).toEqual(["measure", "scroll 0", "fixed first", "restore"]);
  });
});

describe("4.9.7: editor da captura", () => {
  const arrow: Shape = {
    kind: "arrow",
    from: { x: 0, y: 0 },
    to: { x: 100, y: 0 },
    color: "#ef4444",
    size: 4,
  };

  it("desfaz e refaz na ordem, e um novo traço apaga o refazer", () => {
    let history = commit(emptyHistory, [arrow]);
    history = commit(history, [arrow, { ...arrow, to: { x: 0, y: 100 } }]);
    history = undo(history);
    expect(history.present).toEqual([arrow]);
    history = redo(history);
    expect(history.present).toHaveLength(2);
    history = commit(undo(history), []);
    expect(history.future).toEqual([]);
    expect(undo(emptyHistory)).toBe(emptyHistory);
  });

  it("contador continua do maior número; clique sem arrasto não vira forma", () => {
    const counter = (n: number): Shape => ({
      kind: "counter",
      at: { x: 1, y: 1 },
      n,
      color: "#fff",
      size: 4,
    });
    expect(nextCounter([])).toBe(1);
    expect(nextCounter([counter(1), arrow, counter(3)])).toBe(4);
    expect(isEmptyShape({ ...arrow, to: { x: 1, y: 0 } })).toBe(true);
    expect(
      isEmptyShape({ kind: "text", at: { x: 0, y: 0 }, text: "  ", color: "#000", size: 2 }),
    ).toBe(true);
    expect(isEmptyShape(arrow)).toBe(false);
  });

  it("ponta da seta atrás da ponta; Shift prende a 45° e deixa quadrado", () => {
    const [left, right] = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 4);
    expect(left.x).toBeLessThan(100);
    expect(right.x).toBeLessThan(100);
    expect(Math.sign(left.y)).toBe(-Math.sign(right.y));
    const snapped = constrain("line", { x: 0, y: 0 }, { x: 100, y: 8 });
    expect(Math.round(snapped.y)).toBe(0);
    const square = normRect({ x: 0, y: 0 }, constrain("rect", { x: 0, y: 0 }, { x: 50, y: 20 }));
    expect(square.width).toBe(square.height);
  });
});

import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { cloneableArg, cloneableResult, hydrateProps, splitProps } from "./bridge";

// Camada dos painéis (1.5.4): o que atravessa o IPC e as regras puras do main.
const require = createRequire(import.meta.url);
const overlay = require(
  path.join(import.meta.dirname, "../../../../electron/chrome-overlay.cjs"),
) as {
  OVERLAY_KINDS: Set<string>;
  sanitizeOverlay: (payload: unknown) => {
    kind: string;
    key: string;
    data: Record<string, unknown>;
    fns: string[];
    classes: string[];
  } | null;
  pagePoint: (
    rect: { x: number; y: number; width: number; height: number } | null,
    point: { x: number; y: number },
  ) => { x: number; y: number } | null;
  wheelEvent: (
    rect: { x: number; y: number; width: number; height: number } | null,
    payload: { x: number; y: number; deltaX: number; deltaY: number },
  ) => Record<string, unknown> | null;
  clickEvents: (point: { x: number; y: number }, button: number) => Record<string, unknown>[];
  overlayDebugger: (env: Record<string, string | undefined>) => (strategy: string) => void;
};

describe("props do painel pelo IPC", () => {
  it("separa dados e funções (undefined fica de fora)", () => {
    const onClose = () => {};
    const { data, fns } = splitProps({ zoom: 1.1, dark: true, host: undefined, onClose });
    expect(data).toEqual({ zoom: 1.1, dark: true });
    expect(Object.keys(fns)).toEqual(["onClose"]);
  });

  it("na camada cada função chama a casca com os argumentos (e roda o efeito local)", async () => {
    const call = vi.fn(async (name: string, args: unknown[]) => `${name}:${args.join(",")}`);
    const local = vi.fn();
    const props = hydrateProps({ zoom: 1 }, ["onAction", "onCopy"], call, { onCopy: local });
    expect(props["zoom"]).toBe(1);
    await expect((props["onAction"] as (a: string) => Promise<unknown>)("tab.new")).resolves.toBe(
      "onAction:tab.new",
    );
    await (props["onCopy"] as (id: string, value: string) => Promise<unknown>)("a", "senha");
    expect(local).toHaveBeenCalledWith("a", "senha");
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("evento do clique (onClick={onClose}) não derruba a chamada: vira undefined", async () => {
    const call = vi.fn(async () => undefined);
    const props = hydrateProps({}, ["onClose"], call);
    const clickEvent = { type: "click", nativeEvent: {}, preventDefault: () => {} };
    await (props["onClose"] as (event: unknown) => Promise<unknown>)(clickEvent);
    expect(call).toHaveBeenCalledWith("onClose", [undefined]);
    expect(cloneableArg({ title: "a", parentId: "b" })).toEqual({ title: "a", parentId: "b" });
    expect(cloneableArg("tab.new")).toBe("tab.new");
    expect(cloneableArg(() => 1)).toBeUndefined();
  });

  it("só volta para a camada o que o structured clone aceita", () => {
    expect(cloneableResult(undefined)).toBeUndefined();
    expect(cloneableResult(3)).toBe(3);
    expect(cloneableResult({ ok: true, fn: () => 1 })).toEqual({ ok: true });
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    expect(cloneableResult(cyclic)).toBeUndefined();
  });
});

describe("chrome-overlay.cjs", () => {
  it("aceita só os painéis conhecidos, um tipo por pedido, e limpa nomes e classes", () => {
    expect(overlay.sanitizeOverlay({ kind: "ctrl-tab", data: {} })).toBeNull();
    expect(overlay.sanitizeOverlay({ kind: "menu", data: [] })).toBeNull();
    expect(overlay.sanitizeOverlay(null)).toBeNull();
    const model = overlay.sanitizeOverlay({
      kind: "menu",
      data: { zoom: 1 },
      fns: ["onClose", "constructor.prototype", 3],
      classes: ["dark", "x y", "vertical-tabs"],
    })!;
    expect(model).toEqual({
      kind: "menu",
      key: "menu",
      data: { zoom: 1 },
      fns: ["onClose"],
      classes: ["dark", "vertical-tabs"],
    });
    expect([...overlay.OVERLAY_KINDS].sort()).toEqual(
      [
        "autofill",
        "bookmark",
        "downloads",
        "key",
        "menu",
        "privacy",
        "site",
        "palette",
        "workspaces",
        "group",
      ].sort(),
    );
  });

  it("rolagem fora do painel vai para a página, em coordenadas dela (e só dentro dela)", () => {
    const rect = { x: 0, y: 100, width: 800, height: 600 };
    expect(overlay.pagePoint(rect, { x: 10, y: 50 })).toBeNull();
    expect(overlay.pagePoint(null, { x: 10, y: 150 })).toBeNull();
    expect(overlay.pagePoint(rect, { x: 10.4, y: 150 })).toEqual({ x: 10, y: 50 });
    expect(overlay.wheelEvent(rect, { x: 400, y: 400, deltaX: 0, deltaY: 120 })).toEqual({
      type: "mouseWheel",
      x: 400,
      y: 300,
      deltaX: -0,
      deltaY: -120,
      canScroll: true,
    });
    expect(overlay.wheelEvent(rect, { x: 400, y: 400, deltaX: 0, deltaY: 1e9 })!["deltaY"]).toBe(
      -2000,
    );
  });

  it("clique fora vira mover, apertar e soltar no mesmo ponto (botão do DOM → do Chromium)", () => {
    expect(overlay.clickEvents({ x: 5, y: 7 }, 0)).toEqual([
      { type: "mouseMove", x: 5, y: 7 },
      { type: "mouseDown", x: 5, y: 7, button: "left", clickCount: 1 },
      { type: "mouseUp", x: 5, y: 7, button: "left", clickCount: 1 },
    ]);
    expect(overlay.clickEvents({ x: 1, y: 1 }, 2)[1]).toMatchObject({ button: "right" });
    expect(overlay.clickEvents({ x: 1, y: 1 }, 9)[1]).toMatchObject({ button: "left" });
  });

  it("AGZOS_DEBUG_OVERLAY=1 conta a estratégia de cada painel", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const debug = overlay.overlayDebugger({ AGZOS_DEBUG_OVERLAY: "1" });
    debug("live-overlay");
    debug("snapshot-fallback");
    debug("live-overlay");
    const counts = (globalThis as { __agzosOverlay?: Record<string, number> }).__agzosOverlay;
    expect(counts).toEqual({ "live-overlay": 2, "snapshot-fallback": 1 });
    expect(log).toHaveBeenCalledWith("[agzos-overlay] strategy=live-overlay");
    log.mockClear();
    overlay.overlayDebugger({})("live-overlay");
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});

import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { resolveInput } from "./omnibox-input";
import { browserReducer, type BrowserAction } from "./store/reducer";
import { initialState, type BrowserState } from "./store/state";
import { tabCardOf } from "./tab-preview";

const require = createRequire(import.meta.url);
const card = require(path.join(import.meta.dirname, "../../../electron/hover-card.cjs")) as {
  cardBounds: (
    tab: { x: number; y: number; width: number; height: number },
    window: { width: number; height: number },
    height: number,
    side?: string,
  ) => { x: number; y: number; width: number; height: number };
  metricRows: (metrics: Record<string, unknown>) => [string, string][];
  formatBytes: (kilobytes: number) => string | null;
  CARD_WIDTH: number;
};

function run(...actions: BrowserAction[]): BrowserState {
  return actions.reduce(browserReducer, { ...initialState, hydrated: true });
}
const page = (url: string) => ({ title: `Título ${url}`, url, kind: "page" as const });

describe("prévia da guia (1.5.2)", () => {
  it("cartão com título, site, estado e números da casca", () => {
    let state = run(
      { type: "nav/push", entry: page("https://www.youtube.com/watch?v=1") },
      { type: "tab/new" },
    );
    state = browserReducer(state, { type: "view/audio", id: 1, playing: true });
    state = browserReducer(state, { type: "view/blocked", id: 1, count: 12, trackers: [] });
    state = browserReducer(state, { type: "view/zoom", id: 1, factor: 1.25 });
    state = browserReducer(state, { type: "view/thumbnail", id: 1, dataUrl: "data:image/jpeg;x" });
    const model = tabCardOf(state, state.tabs[0]!, { desktop: true });
    expect(model).toMatchObject({
      title: "Título https://www.youtube.com/watch?v=1",
      host: "youtube.com",
      image: "data:image/jpeg;x",
      stats: [
        ["Bloqueados", "12"],
        ["Zoom", "125%"],
      ],
    });
    expect(model.chips.map((chip) => chip.label)).toEqual(["Tocando áudio"]);
  });

  it("guia hibernada: memória liberada e aviso no lugar da miniatura", () => {
    let state = run({ type: "nav/push", entry: page("https://a.com") }, { type: "tab/new" });
    state = browserReducer(state, { type: "view/hibernated", id: 1 });
    const model = tabCardOf(state, state.tabs[0]!, { desktop: true });
    expect(model.stats).toContainEqual(["Memória (RAM)", "liberada"]);
    expect(model.placeholder).toMatch(/Hibernada/);
    expect(model.chips.map((chip) => chip.label)).toContain("Hibernada");
    // Na web não há processo nem hibernação.
    expect(tabCardOf(state, state.tabs[0]!, { desktop: false }).placeholder).toBeUndefined();
  });

  it("página do Agzos e guia atual", () => {
    const state = run();
    const model = tabCardOf(state, state.tabs[0]!, { desktop: true });
    expect(model.host).toBe("Página do Agzos");
    expect(model.chips[0]!.label).toBe("Guia atual");
  });

  it("memória e CPU do processo, dividida quando o site usa o processo com outras guias", () => {
    expect(card.formatBytes(180 * 1024)).toBe("180 MB");
    expect(card.formatBytes(1.5 * 1024 * 1024)).toBe("1,5 GB");
    expect(card.formatBytes(0)).toBeNull();
    expect(card.metricRows({ memoryKB: 200 * 1024, cpu: 3.25, pid: 4242, shared: 1 })).toEqual([
      ["Memória (RAM)", "200 MB"],
      ["CPU", "3,3%"],
      ["Processo", "4242"],
    ]);
    expect(card.metricRows({ memoryKB: 200 * 1024, shared: 3 })[0]).toEqual([
      "Memória (RAM)",
      "200 MB (3 guias)",
    ]);
    expect(card.metricRows({})).toEqual([]);
  });

  it("cartão abaixo da guia (ou ao lado, nas verticais), sem sair da janela", () => {
    const window = { width: 1200, height: 800 };
    const below = card.cardBounds({ x: 100, y: 10, width: 200, height: 36 }, window, 300);
    expect(below.y).toBeGreaterThan(10);
    expect(below.width).toBe(card.CARD_WIDTH);
    const edge = card.cardBounds({ x: 1150, y: 10, width: 40, height: 36 }, window, 300);
    expect(edge.x + edge.width).toBeLessThanOrEqual(1200);
    const right = card.cardBounds({ x: 0, y: 700, width: 220, height: 36 }, window, 300, "right");
    expect(right.x).toBeGreaterThan(200);
    expect(right.y + right.height).toBeLessThanOrEqual(800);
  });
});

describe("configurações pela barra de endereço", () => {
  it("agzos://configuracoes e os apelidos em inglês", () => {
    expect(resolveInput("agzos://configuracoes", "duckduckgo")).toEqual({
      title: "Configurações",
      url: "agzos://configuracoes",
      kind: "internal",
    });
    expect(resolveInput("agzos://settings/", "duckduckgo")?.url).toBe("agzos://configuracoes");
    expect(resolveInput("agzos-settings", "duckduckgo")?.url).toBe("agzos://configuracoes");
    expect(resolveInput("agzos://history", "duckduckgo")?.url).toBe("agzos://historico");
  });
});

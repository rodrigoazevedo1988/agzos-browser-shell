import http from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { dialHref, dialLinkOf, filterDial } from "@/features/dial/dial";
import { hotTabs, levelOf, simulatedStats } from "@/features/control/model";

import { DEFAULT_LIMITS, parseLimits } from "./control/limits";
import { domainOf, faviconSources, initialOf } from "./favicon";
import { resolveInput } from "./omnibox-input";
import { parseDial, parsePrefs, parseSnapshot, snapshotOf } from "./persistence/snapshot";
import { SIDE_PANEL_APPS, withNewSidePanels } from "./side-panels";
import { browserReducer } from "./store/reducer";
import { DIAL_URL, HOME_URL, defaultDial, initialState } from "./store/state";

// 3.0: favicons, Discador, barra lateral nova e GX Control.
const require = createRequire(import.meta.url);
const gx = require(path.join(process.cwd(), "electron", "gx-control.cjs")) as {
  limitsOf: (prefs: unknown) => {
    ram: { on: boolean; mb: number };
    cpu: { on: boolean; percent: number };
    net: { on: boolean; downKbps: number; upKbps: number };
  };
  networkConditionsOf: (limits: unknown) => Record<string, number | boolean> | null;
  totalsOf: (
    metrics: unknown[],
    cores: number,
  ) => { memoryMB: number; cpuPercent: number; processes: number };
  tabUsage: (
    tabs: { key: number; pid: number }[],
    metrics: unknown[],
    cores: number,
  ) => { key: number; memoryMB: number; cpuPercent: number; shared: number }[];
  pickTabsToHibernate: (
    tabs: { key: number; memoryMB: number; eligible: boolean }[],
    options: { totalMB: number; limitMB: number; max?: number },
  ) => number[];
  throttlePlan: (
    tabs: { key: number; visible: boolean; cpuPercent: number }[],
    options: { totalPercent: number; limitPercent: number; throttled: Set<number> },
  ) => Set<number>;
  mbpsOf: (bytes: number, ms: number) => number;
  median: (values: number[]) => number | null;
  runSpeedTest: (
    fetchImpl: typeof fetch,
  ) => Promise<{ pingMs: number | null; downMbps: number; upMbps: number | null }>;
};

describe("favicons", () => {
  it("lê o domínio com ou sem esquema e monta Google → /favicon.ico", () => {
    expect(domainOf("github.com")).toBe("github.com");
    expect(domainOf("https://www.youtube.com/watch?v=1")).toBe("youtube.com");
    expect(domainOf("javascript:alert(1)")).toBeNull();
    expect(domainOf("  ")).toBeNull();
    expect(faviconSources("notion.so", 32)).toEqual([
      "https://www.google.com/s2/favicons?domain=notion.so&sz=32",
      "https://notion.so/favicon.ico",
    ]);
    expect(faviconSources("")).toEqual([]);
    expect(initialOf("figma", "figma.com")).toBe("F");
    expect(initialOf("", "linear.app")).toBe("L");
  });
});

describe("Discador", () => {
  it("é página interna, com apelidos", () => {
    expect(resolveInput("agzos://discador", "duckduckgo")).toEqual({
      title: "Discador",
      url: DIAL_URL,
      kind: "internal",
    });
    expect(resolveInput("agzos://speed-dial", "duckduckgo")?.url).toBe(DIAL_URL);
  });

  it("card novo só com endereço válido; filtro sem acento", () => {
    expect(dialLinkOf("", "https://www.Site.com/")).toEqual({
      name: "site.com",
      url: "www.Site.com",
    });
    expect(dialLinkOf("Meu", "não é site")).toBeNull();
    expect(dialLinkOf("x", "")).toBeNull();
    const links = [
      { name: "Wikipédia", url: "pt.wikipedia.org" },
      { name: "GitHub", url: "github.com" },
    ];
    expect(filterDial(links, "wikipedia")).toEqual([links[0]]);
    expect(filterDial(links, "GIT hub")).toEqual([links[1]]);
    expect(filterDial(links, " ")).toEqual(links);
    expect(dialHref(links[1]!)).toBe("https://github.com");
    expect(dialHref({ name: "a", url: "http://a.com" })).toBe("http://a.com");
  });

  it("adiciona sem repetir, remove e reordena", () => {
    let state = { ...initialState, dial: [] as typeof defaultDial };
    const a = { name: "A", url: "a.com" };
    const b = { name: "B", url: "b.com" };
    const c = { name: "C", url: "c.com" };
    for (const link of [a, b, c, a]) state = browserReducer(state, { type: "dial/add", link });
    expect(state.dial).toEqual([a, b, c]);
    state = browserReducer(state, { type: "dial/move", url: "a.com", index: 2 });
    expect(state.dial).toEqual([b, c, a]);
    state = browserReducer(state, { type: "dial/move", url: "a.com", index: 0 });
    expect(state.dial).toEqual([a, b, c]);
    // Soltar no "+" (índice depois do último) leva para o fim.
    state = browserReducer(state, { type: "dial/move", url: "b.com", index: 3 });
    expect(state.dial).toEqual([a, c, b]);
    expect(browserReducer(state, { type: "dial/move", url: "zzz", index: 0 })).toBe(state);
    state = browserReducer(state, { type: "dial/remove", url: "c.com" });
    expect(state.dial).toEqual([a, b]);
  });

  it("vai e volta no snapshot; sem a seção, os cards padrão", () => {
    const dial = [{ name: "A", url: "a.com" }];
    const snapshot = snapshotOf({ ...initialState, dial });
    expect(parseSnapshot(JSON.parse(JSON.stringify(snapshot)))?.dial).toEqual(dial);
    expect(parseDial([{ name: "A", url: "a.com" }, { name: "dup", url: "a.com" }, 3])).toEqual(
      dial,
    );
    expect(parseDial("x")).toBeNull();
    const hydrated = browserReducer(initialState, {
      type: "hydrate",
      payload: {
        prefs: initialState.prefs,
        tabs: null,
        activeId: null,
        links: null,
        closedTabs: [],
        bookmarks: null,
      },
    });
    expect(hydrated.dial).toEqual(defaultDial);
    expect(browserReducer(hydrated, { type: "sync", payload: { dial } }).dial).toEqual(dial);
  });

  it("Início ↔ Discador na mesma guia", () => {
    let state = browserReducer(initialState, {
      type: "nav/open-internal",
      entry: { title: "Discador", url: DIAL_URL, kind: "internal" },
    });
    expect(state.tabs).toHaveLength(1);
    expect(state.address).toBe(DIAL_URL);
    state = browserReducer(state, { type: "nav/home" });
    expect(state.tabs).toHaveLength(1);
    expect(state.address).toBe(HOME_URL);
    expect(state.tabs[0]!.history.map((entry) => entry.kind)).toEqual(["home", "internal", "home"]);
    // Já na inicial: nada muda.
    expect(browserReducer(state, { type: "nav/home" })).toBe(state);
  });
});

describe("barra lateral 3.0", () => {
  it("tem os apps novos, todos com nome e https", () => {
    const ids = SIDE_PANEL_APPS.map((app) => app.id);
    for (const id of [
      "whatsapp",
      "telegram",
      "messenger",
      "instagram",
      "discord",
      "x",
      "gmail",
      "chatgpt",
      "claude",
      "gemini",
      "duckai",
      "tiktok",
      "kwai",
      "youtube",
      "linkedin",
      "reddit",
      "spotify",
      "deezer",
      "pinterest",
    ]) {
      expect(ids).toContain(id);
    }
    for (const app of SIDE_PANEL_APPS) {
      expect(app.name).toBeTruthy();
      expect(app.url).toMatch(/^https:\/\//);
    }
  });

  it("perfil antigo ganha os apps novos uma vez; removido não volta", () => {
    const old = parsePrefs({ sidePanels: ["telegram", "whatsapp"] });
    expect(old.sidePanels.slice(0, 2)).toEqual(["telegram", "whatsapp"]);
    expect(old.sidePanels).toContain("claude");
    expect(old.sidePanels).toContain("discord");
    // Quem já tirou o Instagram (padrão da 2.x) não o vê de volta.
    expect(old.sidePanels).not.toContain("instagram");
    const again = parsePrefs({
      sidePanels: ["telegram"],
      sidePanelsSeen: old.sidePanelsSeen,
    });
    expect(again.sidePanels).toEqual(["telegram"]);
    expect(withNewSidePanels(["x"], ["x"]).sidePanels).toContain("youtube");
  });
});

describe("GX Control", () => {
  it("limites gravados são limitados aos intervalos", () => {
    expect(parseLimits({})).toEqual(DEFAULT_LIMITS);
    expect(parseLimits({ ramLimitOn: true, ramLimitMB: 10, cpuLimitPercent: 900 })).toMatchObject({
      ramLimitOn: true,
      ramLimitMB: 512,
      cpuLimitPercent: 100,
    });
    expect(gx.limitsOf({ cpuLimitOn: true, cpuLimitPercent: "x" }).cpu).toEqual({
      on: true,
      percent: 50,
    });
  });

  it("rede: kbit/s viram bytes/s; desligado, sem emulação", () => {
    expect(gx.networkConditionsOf(gx.limitsOf({}))).toBeNull();
    expect(
      gx.networkConditionsOf(gx.limitsOf({ netLimitOn: true, netDownKbps: 8000, netUpKbps: 800 })),
    ).toEqual({
      offline: false,
      latency: 0,
      downloadThroughput: 1_000_000,
      uploadThroughput: 100_000,
    });
  });

  it("totais e uso por guia (processo dividido entre as guias que o compartilham)", () => {
    const metrics = [
      { pid: 1, cpu: { percentCPUUsage: 40 }, memory: { workingSetSize: 200 * 1024 } },
      { pid: 2, cpu: { percentCPUUsage: 20 }, memory: { workingSetSize: 100 * 1024 } },
    ];
    expect(gx.totalsOf(metrics, 4)).toEqual({ memoryMB: 300, cpuPercent: 15, processes: 2 });
    const usage = gx.tabUsage(
      [
        { key: 10, pid: 1 },
        { key: 11, pid: 1 },
        { key: 12, pid: 2 },
        { key: 13, pid: 9 },
      ],
      metrics,
      4,
    );
    expect(
      usage.map(({ key, memoryMB, cpuPercent, shared }) => [key, memoryMB, cpuPercent, shared]),
    ).toEqual([
      [10, 100, 5, 2],
      [11, 100, 5, 2],
      [12, 100, 5, 1],
      [13, 0, 0, 1],
    ]);
  });

  it("teto de RAM hiberna as mais pesadas que podem, até cobrir o excesso", () => {
    const tabs = [
      { key: 1, memoryMB: 300, eligible: true },
      { key: 2, memoryMB: 900, eligible: false },
      { key: 3, memoryMB: 500, eligible: true },
      { key: 4, memoryMB: 100, eligible: true },
    ];
    expect(gx.pickTabsToHibernate(tabs, { totalMB: 1800, limitMB: 2000 })).toEqual([]);
    expect(gx.pickTabsToHibernate(tabs, { totalMB: 2400, limitMB: 2000 })).toEqual([3]);
    expect(gx.pickTabsToHibernate(tabs, { totalMB: 2700, limitMB: 2000 })).toEqual([3, 1]);
    expect(gx.pickTabsToHibernate(tabs, { totalMB: 9000, limitMB: 2000, max: 5 })).toEqual([
      3, 1, 4,
    ]);
  });

  it("teto de CPU desacelera só as de fundo e solta abaixo de 70 %", () => {
    const tabs = [
      { key: 1, visible: true, cpuPercent: 30 },
      { key: 2, visible: false, cpuPercent: 12 },
      { key: 3, visible: false, cpuPercent: 0.2 },
    ];
    const plan = gx.throttlePlan(tabs, {
      totalPercent: 60,
      limitPercent: 50,
      throttled: new Set(),
    });
    expect([...plan]).toEqual([2]);
    // Entre 70 % e 100 % do teto: quem já estava lenta continua.
    expect([
      ...gx.throttlePlan(tabs, { totalPercent: 40, limitPercent: 50, throttled: new Set([2]) }),
    ]).toEqual([2]);
    expect(
      gx.throttlePlan(tabs, { totalPercent: 20, limitPercent: 50, throttled: new Set([2]) }).size,
    ).toBe(0);
  });

  it("teste de velocidade mede download, upload e latência", async () => {
    expect(gx.mbpsOf(1_250_000, 1000)).toBe(10);
    expect(gx.mbpsOf(0, 1000)).toBe(0);
    expect(gx.median([30, 10, 20])).toBe(20);
    expect(gx.median([])).toBeNull();
    const server = http.createServer((request, response) => {
      if (request.url?.startsWith("/__up")) {
        request.resume();
        request.on("end", () => response.end("ok"));
        return;
      }
      const bytes = Number(new URL(request.url ?? "/", "http://x").searchParams.get("bytes"));
      response.end(Buffer.alloc(Math.min(bytes, 2_000_000)));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const base = `http://127.0.0.1:${port}`;
      const result = await gx.runSpeedTest((url, init) =>
        fetch(String(url).replace("https://speed.cloudflare.com", base), init),
      );
      expect(result.downMbps).toBeGreaterThan(0);
      expect(result.upMbps).toBeGreaterThan(0);
      expect(result.pingMs).not.toBeNull();
    } finally {
      server.close();
    }
  });

  it("Hot Tabs Killer ordena por CPU ou RAM; níveis por escrito", () => {
    const tabs = [1, 2, 3].map((id) => ({
      id,
      title: `t${id}`,
      url: "https://a.com",
      active: id === 1,
      hibernated: id === 3,
    }));
    const stats = simulatedStats(tabs, 1);
    stats.tabs = [
      { id: 1, memoryMB: 100, cpuPercent: 9, shared: 1, throttled: false },
      { id: 2, memoryMB: 400, cpuPercent: 2, shared: 1, throttled: true },
    ];
    expect(hotTabs(tabs, stats, "cpu").map((tab) => tab.id)).toEqual([1, 2, 3]);
    expect(hotTabs(tabs, stats, "ram").map((tab) => tab.id)).toEqual([2, 1, 3]);
    expect(hotTabs(tabs, stats, "ram")[0]!.throttled).toBe(true);
    expect(levelOf(50, 100)).toBe("ok");
    expect(levelOf(90, 100)).toBe("high");
    expect(levelOf(101, 100)).toBe("over");
    expect(simulatedStats(tabs, 2).tabs.find((tab) => tab.id === 3)!.memoryMB).toBe(0);
  });
});

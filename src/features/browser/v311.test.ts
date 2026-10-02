import { EventEmitter } from "node:events";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { categoriesOf, dialLinkOf, filterDial } from "@/features/dial/dial";
import {
  createThrottle,
  isTypingKey,
  parseSoundTick,
  parseSoundVolume,
  soundGain,
  type SoundPrefs,
} from "@/features/sounds/sounds";

import { parseDial, parseLinks, parsePrefs } from "./persistence/snapshot";
import {
  SIDE_PANEL_WIDTH,
  dragPanelWidth,
  panelWidthLimits,
  panelWidthOf,
  parsePanelWidths,
  sideBarFit,
} from "./side-panels";
import { browserReducer } from "./store/reducer";
import { defaultPrefs, initialState } from "./store/state";

// 3.1.1: barra lateral recolhida, modal de novo site, sons, zoom/largura por painel e a
// sessão dos painéis entre reinícios.
const require = createRequire(import.meta.url);
const panels = require(path.join(process.cwd(), "electron", "panel-session.cjs")) as {
  isPanelLoginPage: (app: string, url: string) => boolean;
  loginReason: (app: string, previous: unknown, userAgent: string) => string;
  panelZoomKey: (input: object) => 1 | -1 | 0 | null;
  panelZoomStep: (current: number, direction: number) => number;
  parsePanelZooms: (value: unknown) => Record<string, number>;
  unloadPanelPages: (
    list: unknown[],
    options?: { timeoutMs?: number; allowUnload?: (contents: unknown) => void },
  ) => Promise<void>;
  createPanelLog: (directory: string) => (message: string) => void;
};

describe("barra lateral: o que não cabe vai para o “Mais”", () => {
  const room = { fixed: 100, item: 50, gap: 6 };

  it("cabem todos: sem botão Mais", () => {
    expect(sideBarFit(5, { ...room, height: 1000 })).toBeNull();
  });

  it("não cabem: o último lugar vira o Mais", () => {
    // (700 - 100 + 6) / 56 = 10 lugares → 9 apps e o Mais.
    expect(sideBarFit(19, { ...room, height: 700 })).toBe(9);
    // Exatamente 10 apps em 10 lugares: cabem todos.
    expect(sideBarFit(10, { ...room, height: 700 })).toBeNull();
  });

  it("janela muito baixa: só o Mais", () => {
    expect(sideBarFit(19, { ...room, height: 120 })).toBe(0);
  });
});

describe("largura do painel: aumenta e diminui, por painel", () => {
  it("o máximo acompanha a janela e o mínimo continua usável", () => {
    expect(panelWidthLimits(1920)).toEqual({ min: 320, max: 1500 });
    expect(panelWidthLimits(600).max).toBe(SIDE_PANEL_WIDTH.min);
    expect(dragPanelWidth(1800, 1920)).toBe(1500);
    expect(dragPanelWidth(900, 1920)).toBe(900);
    expect(dragPanelWidth(100, 1920)).toBe(320);
  });

  it("cada painel tem a sua largura; sem ela vale a de antes da 3.1.1", () => {
    const prefs = { sidePanelWidth: 420, sidePanelWidths: { discord: 640 } };
    expect(panelWidthOf(prefs, "discord")).toBe(640);
    expect(panelWidthOf(prefs, "whatsapp")).toBe(420);
  });

  it("larguras gravadas: só apps conhecidos e números válidos", () => {
    expect(
      parsePanelWidths({ discord: 700, whatsapp: "x", desconhecido: 500, telegram: 10 }),
    ).toEqual({ discord: 700, telegram: 320 });
    expect(parsePanelWidths(null)).toEqual({});
    expect(parsePrefs({ sidePanelWidths: { chatgpt: 900 } }).sidePanelWidths).toEqual({
      chatgpt: 900,
    });
  });
});

describe("sons", () => {
  const on: SoundPrefs = {
    sounds: true,
    soundHover: true,
    soundKeys: true,
    soundTick: "mecanico",
    soundVolume: 100,
  };

  it("toggle geral, de hover e de teclado, e o volume", () => {
    expect(soundGain(on, "key")).toBe(1);
    expect(soundGain(on, "hover")).toBeCloseTo(0.7);
    expect(soundGain({ ...on, sounds: false }, "key")).toBe(0);
    expect(soundGain({ ...on, soundHover: false }, "hover")).toBe(0);
    expect(soundGain({ ...on, soundHover: false }, "key")).toBe(1);
    expect(soundGain({ ...on, soundKeys: false }, "key")).toBe(0);
    expect(soundGain({ ...on, soundVolume: 0 }, "key")).toBe(0);
    expect(soundGain({ ...on, soundVolume: 50 }, "key")).toBeCloseTo(0.25);
  });

  it("sem rajada: o mesmo tipo espera o intervalo", () => {
    const allow = createThrottle({ hover: 70, key: 25 });
    expect(allow("hover", 0)).toBe(true);
    expect(allow("hover", 30)).toBe(false);
    expect(allow("key", 30)).toBe(true);
    expect(allow("hover", 80)).toBe(true);
  });

  it("só teclas de digitar tocam", () => {
    const key = (value: string, mods = {}) => ({
      key: value,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      ...mods,
    });
    expect(isTypingKey(key("a"))).toBe(true);
    expect(isTypingKey(key(" "))).toBe(true);
    expect(isTypingKey(key("Backspace"))).toBe(true);
    expect(isTypingKey(key("Tab"))).toBe(false);
    expect(isTypingKey(key("ArrowLeft"))).toBe(false);
    expect(isTypingKey(key("c", { ctrlKey: true }))).toBe(false);
  });

  it("preferências: padrão ligado a 40 %, valores inválidos voltam ao padrão", () => {
    expect(defaultPrefs).toMatchObject({
      sounds: true,
      soundHover: true,
      soundKeys: true,
      soundTick: "mecanico",
      soundVolume: 40,
    });
    const prefs = parsePrefs({ sounds: false, soundTick: "maquina", soundVolume: 250 });
    expect(prefs).toMatchObject({ sounds: false, soundTick: "maquina", soundVolume: 100 });
    expect(parseSoundTick("piano")).toBe("mecanico");
    expect(parseSoundVolume("alto")).toBe(40);
  });

  it("os sons estão embutidos no app (WAV, curtos)", () => {
    const dir = path.join(process.cwd(), "src", "assets", "sounds");
    for (const name of ["nav-tick", "key-mecanico", "key-suave", "key-maquina"]) {
      const data = fs.readFileSync(path.join(dir, `${name}.wav`));
      expect(data.subarray(0, 4).toString()).toBe("RIFF");
      expect(data.length).toBeLessThan(16_000);
    }
    expect(fs.readFileSync(path.join(dir, "LICENSE.md"), "utf8")).toContain("CC0");
  });
});

describe("modal de novo site: categoria e favicon pelo domínio", () => {
  it("o card leva a categoria (vazia não entra)", () => {
    expect(dialLinkOf("Notícias", "https://g1.globo.com/", "Notícias")).toEqual({
      name: "Notícias",
      url: "g1.globo.com",
      category: "Notícias",
    });
    expect(dialLinkOf("", "site.com", "  ")).toEqual({ name: "site.com", url: "site.com" });
  });

  it("categorias em uso e busca pela categoria", () => {
    const links = [
      { name: "A", url: "a.com", category: "Trabalho" },
      { name: "B", url: "b.com" },
      { name: "C", url: "c.com", category: "IA" },
      { name: "D", url: "d.com", category: "Trabalho" },
    ];
    expect(categoriesOf(links)).toEqual(["Trabalho", "IA"]);
    expect(filterDial(links, "trabalho").map((link) => link.url)).toEqual(["a.com", "d.com"]);
  });

  it("a categoria sobrevive ao disco (home e Discador)", () => {
    const raw = [
      { name: "A", url: "a.com", category: "IA", extra: 1 },
      { name: "B", url: "b.com" },
    ];
    expect(parseLinks(raw)).toEqual([
      { name: "A", url: "a.com", category: "IA" },
      { name: "B", url: "b.com" },
    ]);
    expect(parseDial(raw)?.[0]).toEqual({ name: "A", url: "a.com", category: "IA" });
  });

  it("salvar na home grava o atalho (o ícone sai do domínio)", () => {
    const state = browserReducer(initialState, {
      type: "links/add",
      link: { name: "GitHub", url: "github.com", category: "Trabalho" },
    });
    expect(state.links.at(-1)).toEqual({ name: "GitHub", url: "github.com", category: "Trabalho" });
  });
});

describe("painéis no main: zoom próprio e a sessão entre reinícios", () => {
  it("Ctrl +/−/0 (e do teclado numérico) viram zoom do painel", () => {
    const key = (input: object) =>
      panels.panelZoomKey({ type: "keyDown", control: true, ...input });
    expect(key({ key: "=" })).toBe(1);
    expect(key({ key: "+", shift: true })).toBe(1);
    expect(key({ key: "-" })).toBe(-1);
    expect(key({ key: "0" })).toBe(0);
    expect(key({ key: "x", code: "NumpadAdd" })).toBe(1);
    expect(panels.panelZoomKey({ type: "keyDown", meta: true, key: "=" })).toBe(1);
    expect(panels.panelZoomKey({ type: "keyDown", key: "=" })).toBeNull();
    expect(panels.panelZoomKey({ type: "keyUp", control: true, key: "=" })).toBeNull();
    expect(key({ key: "t" })).toBeNull();
  });

  it("degraus do Chrome e zooms gravados válidos", () => {
    expect(panels.panelZoomStep(1, 1)).toBe(1.1);
    expect(panels.panelZoomStep(1.1, -1)).toBe(1);
    expect(panels.panelZoomStep(1.5, 0)).toBe(1);
    expect(panels.parsePanelZooms({ discord: 1.25, whatsapp: 1, "a b": 2, x: 9, y: "2" })).toEqual({
      discord: 1.25,
    });
  });

  it("login do Discord é reconhecido (para o registro)", () => {
    expect(panels.isPanelLoginPage("discord", "https://discord.com/login")).toBe(true);
    expect(panels.isPanelLoginPage("discord", "https://discord.com/login?redirect_to=%2Fapp")).toBe(
      true,
    );
    expect(panels.isPanelLoginPage("discord", "https://discord.com/app")).toBe(false);
    expect(panels.isPanelLoginPage("discord", "https://discord.com/loginx")).toBe(false);
    expect(panels.isPanelLoginPage("telegram", "https://web.telegram.org/a/")).toBe(false);
  });

  it("o registro explica por que a sessão não voltou", () => {
    expect(panels.loginReason("discord", { clean: false }, "UA")).toMatch(/não descarregou/);
    const refused = panels.loginReason("discord", { clean: true, apps: ["discord"] }, "Chrome/1");
    expect(refused).toMatch(/recusada pelo próprio serviço/);
    expect(refused).toMatch(/Storage mantido/);
    expect(panels.loginReason("discord", null, "UA")).toMatch(/primeira execução/);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agzos-panels-"));
    panels.createPanelLog(dir)("discord: teste");
    expect(fs.readFileSync(path.join(dir, "side-panels.log"), "utf8")).toMatch(/discord: teste\n$/);
  });

  it("ao sair, cada página descarrega (about:blank) e quem trava não segura a saída", async () => {
    const loaded: string[] = [];
    const allowed: unknown[] = [];
    const page = (hang = false) =>
      Object.assign(new EventEmitter(), {
        isDestroyed: () => false,
        loadURL: (url: string) => {
          loaded.push(url);
          return hang ? new Promise(() => {}) : Promise.resolve();
        },
      });
    const quick = page();
    const stuck = page(true);
    const gone = { isDestroyed: () => true, loadURL: () => Promise.reject(new Error("x")) };
    const started = Date.now();
    await panels.unloadPanelPages([quick, stuck, gone], {
      timeoutMs: 50,
      allowUnload: (contents) => allowed.push(contents),
    });
    expect(loaded).toEqual(["about:blank", "about:blank"]);
    expect(allowed).toEqual([quick, stuck]);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

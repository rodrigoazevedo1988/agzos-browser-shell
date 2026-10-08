import { EventEmitter } from "node:events";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const main = fs.readFileSync(path.join(root, "electron/main.cjs"), "utf8");

type Capabilities = {
  key: string;
  versions: { electron: string | null; chrome: string | null };
  cdp: { attached: boolean; runtimeEvaluate: boolean };
  printToPdf: { available: boolean; taggedPdf: boolean; documentOutline: boolean };
  cdpPrintToPdf: { available: boolean; returnAsStream: boolean; error: string | null };
  capture: { measured: boolean; maxHeight: number; safeCap: number };
};

const capabilities = require(path.join(root, "electron/capabilities.cjs")) as {
  CAPTURE_CANDIDATES: number[];
  CAPTURE_SAFE_CAP: number;
  captureLimit(results: { height: number; ok: boolean }[]): number;
  effectiveCaptureHeight(value: unknown): number;
  pdfFeatures(buffer: unknown): { pdf: boolean; tagged: boolean; outline: boolean };
  pngSize(buffer: unknown): { width: number; height: number } | null;
  probeCapabilities(options: {
    open: (url: string) => Promise<{ contents: unknown; dispose: () => void }>;
    versions: Record<string, string>;
    timeoutMs?: number;
  }): Promise<Capabilities>;
  probeCaptureHeight(
    debug: unknown,
    options?: { timeoutMs?: number },
  ): Promise<{ maxHeight: number; tried: { height: number; ok: boolean }[] }>;
  versionKey(versions: Record<string, string>): string;
};

const flags = require(path.join(root, "electron/feature-flags.cjs")) as {
  FLAG_DEFAULTS: Record<string, boolean>;
  FLAG_NAMES: string[];
  buildFlagsOf(value: unknown): Record<string, boolean>;
  parseFlagList(text: unknown): Record<string, boolean>;
  resolveFlags(sources: {
    build?: unknown;
    user?: unknown;
    env?: unknown;
  }): Record<string, boolean>;
  withUserFlag(user: unknown, name: string, value: boolean | null): Record<string, boolean>;
};

/** PNG mínimo: assinatura + IHDR com a largura e a altura pedidas. */
const png = (width: number, height: number) => {
  const buffer = Buffer.alloc(33);
  Buffer.from("89504e470d0a1a0a", "hex").copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "latin1");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
};

/** webContents falsa: responde como o Electron 44 respondeu na medição real. */
function fakeContents({ maxHeight = 65535, tagged = true } = {}) {
  let attached = false;
  const commands: string[] = [];
  return {
    commands,
    printToPDF: async (): Promise<Buffer> =>
      Buffer.from(`%PDF-1.7 ${tagged ? "/StructTreeRoot /Outlines" : ""}`, "latin1"),
    debugger: {
      isAttached: () => attached,
      attach: () => {
        attached = true;
      },
      sendCommand: async (method: string, params: { clip?: { height: number } } = {}) => {
        commands.push(method);
        if (method === "Runtime.evaluate") return { result: { value: 42 } };
        if (method === "Page.printToPDF") throw new Error("'Page.printToPDF' wasn't found");
        if (method === "Page.captureScreenshot") {
          const height = params.clip!.height;
          if (height > maxHeight) throw new Error("bitmap");
          return { data: png(16, height).toString("base64") };
        }
        return {};
      },
    },
  };
}

describe("4.8 Fase 0: capacidades medidas do runtime", () => {
  it("lê o tamanho do PNG pelo IHDR e recusa o que não é PNG", () => {
    expect(capabilities.pngSize(png(16, 32767))).toEqual({ width: 16, height: 32767 });
    expect(capabilities.pngSize(Buffer.from("não é png"))).toBeNull();
    expect(capabilities.pngSize(null)).toBeNull();
  });

  it("reconhece PDF, árvore de tags e outline", () => {
    expect(capabilities.pdfFeatures(Buffer.from("%PDF-1.7 /StructTreeRoot /Outlines"))).toEqual({
      pdf: true,
      tagged: true,
      outline: true,
    });
    expect(capabilities.pdfFeatures(Buffer.from("%PDF-1.7"))).toEqual({
      pdf: true,
      tagged: false,
      outline: false,
    });
    expect(capabilities.pdfFeatures(Buffer.from("<html>")).pdf).toBe(false);
  });

  it("o teto de captura para na primeira altura que falha", () => {
    expect(
      capabilities.captureLimit([
        { height: 16384, ok: true },
        { height: 32767, ok: false },
        { height: 65535, ok: true },
      ]),
    ).toBe(16384);
    expect(capabilities.captureLimit([{ height: 16384, ok: false }])).toBe(0);
  });

  it("o Print Engine nunca passa do teto conservador, mesmo se a medição passar", () => {
    const cap = capabilities.CAPTURE_SAFE_CAP;
    expect(capabilities.effectiveCaptureHeight({ capture: { maxHeight: 131072 } })).toBe(cap);
    expect(capabilities.effectiveCaptureHeight({ capture: { maxHeight: 16384 } })).toBe(16384);
    expect(capabilities.effectiveCaptureHeight(null)).toBe(cap);
  });

  it("a chave muda com o Electron ou o Chromium (mede de novo depois de atualizar)", () => {
    const a = capabilities.versionKey({ electron: "44.4.5", chrome: "152.0.7977.130" });
    const b = capabilities.versionKey({ electron: "44.5.1", chrome: "152.0.7977.130" });
    expect(a).not.toBe(b);
  });

  it("mede como o Electron 44: PDF taggeado sim, Page.printToPDF não", async () => {
    const contents = fakeContents();
    let disposed = false;
    const result = await capabilities.probeCapabilities({
      open: async () => ({ contents, dispose: () => (disposed = true) }),
      versions: { electron: "44.4.5", chrome: "152.0.7977.130" },
    });
    expect(result.versions).toMatchObject({ electron: "44.4.5", chrome: "152.0.7977.130" });
    expect(result.cdp).toEqual({ attached: true, runtimeEvaluate: true });
    expect(result.printToPdf).toMatchObject({
      available: true,
      taggedPdf: true,
      documentOutline: true,
    });
    expect(result.cdpPrintToPdf.available).toBe(false);
    expect(result.cdpPrintToPdf.returnAsStream).toBe(false);
    expect(result.cdpPrintToPdf.error).toContain("wasn't found");
    // A sonda do início não captura (offscreen derrubou o main): fica para a guia.
    expect(result.capture).toEqual({ measured: false, maxHeight: 0, safeCap: 32767 });
    expect(contents.commands).not.toContain("Page.captureScreenshot");
    expect(disposed).toBe(true);
  });

  it("o teto de captura na guia para na primeira altura que falha", async () => {
    const contents = fakeContents({ maxHeight: 32767 });
    const measured = await capabilities.probeCaptureHeight(contents.debugger);
    expect(measured.maxHeight).toBe(32767);
    // Falhou em 65535: não há mais tentativa depois (cada uma custaria um timeout).
    expect(measured.tried.map((item) => item.height)).toEqual([16384, 32767, 65535]);
  });

  it("uma sonda que trava vira false e as outras continuam", async () => {
    const contents = fakeContents();
    contents.printToPDF = () => new Promise<Buffer>(() => {});
    const result = await capabilities.probeCapabilities({
      open: async () => ({ contents, dispose: () => {} }),
      versions: { electron: "44.4.5", chrome: "152" },
      timeoutMs: 20,
    });
    expect(result.printToPdf.available).toBe(false);
    expect(result.cdp.runtimeEvaluate).toBe(true);
    expect(result.cdpPrintToPdf.error).toContain("wasn't found");
  });

  it("main mede numa partição em memória, fora da sessão padrão, e grava no userData", () => {
    expect(main).toContain('const CAPABILITY_PARTITION = "agzos-capabilities"');
    expect(main).not.toContain('"persist:agzos-capabilities"');
    // Offscreen derrubou o main com a camada dos menus aberta (SIGSEGV).
    expect(main.slice(main.indexOf("async function openCapabilityProbe"))).not.toMatch(
      /^\s*offscreen: true/m,
    );
    expect(main).toContain('"capabilities.json"');
    expect(main).toContain('ipcMain.handle("capabilities:get"');
  });
});

describe("4.8 Fase 0: flags por bloco", () => {
  it("os seis blocos do PRD, com o núcleo ligado e o resto desligado", () => {
    expect(flags.FLAG_DEFAULTS).toEqual({
      devtools: true,
      print_shield: true,
      scroll_stitch: false,
      copilot: false,
      rewind: false,
      kiosk: false,
    });
  });

  it("lê a lista do build e do AGZOS_FLAGS e ignora nomes e valores desconhecidos", () => {
    expect(flags.parseFlagList("devtools=0, kiosk=on,foo=1,rewind=talvez")).toEqual({
      devtools: false,
      kiosk: true,
    });
    expect(flags.parseFlagList(undefined)).toEqual({});
    expect(flags.buildFlagsOf("")).toEqual({});
    expect(flags.buildFlagsOf({ copilot: true, x: true })).toEqual({ copilot: true });
  });

  it("padrão < build < usuário < ambiente", () => {
    const resolved = flags.resolveFlags({
      build: { devtools: false, kiosk: true },
      user: { devtools: true, rewind: "sim" },
      env: { kiosk: false },
    });
    expect(resolved["devtools"]).toBe(true);
    expect(resolved["kiosk"]).toBe(false);
    expect(resolved["rewind"]).toBe(false);
  });

  it("a escolha do usuário grava só flags conhecidas; null volta ao padrão", () => {
    const user = flags.withUserFlag({ devtools: false }, "copilot", true);
    expect(user).toEqual({ devtools: false, copilot: true });
    expect(flags.withUserFlag(user, "devtools", null)).toEqual({ copilot: true });
    expect(flags.withUserFlag(user, "inexistente", true)).toEqual(user);
  });

  it("AGZOS_FLAGS não vale no pacote", () => {
    expect(main).toContain("env: app.isPackaged ? {} : parseFlagList(process.env.AGZOS_FLAGS)");
  });
});

type DockSide = "right" | "bottom" | "window";
type Dock = { side: DockSide; width: number; height: number };
type FakeContents = EventEmitter & {
  id: number;
  destroyed: boolean;
  calls: string[];
  isDestroyed(): boolean;
  setDevToolsWebContents(fe: unknown): void;
  openDevTools(options: { mode: string; activate: boolean }): void;
  closeDevTools(): void;
  devToolsWebContents: unknown;
};

const devtools = require(path.join(root, "electron/devtools-dock.cjs")) as {
  DEFAULT_DOCK: Dock;
  cleanDock(value: unknown): Dock;
  cleanDockMap(value: unknown): Record<string, Dock>;
  withDock(map: unknown, workspace: unknown, dock: unknown): Record<string, Dock>;
  dockKeyAction(input: unknown): string | null;
  frontendScript(action: string, side?: string): string | null;
  createDevtoolsDocks(options: {
    WebContentsView: unknown;
    hiddenRect: unknown;
    onChange?: (contents: FakeContents, state: { open: boolean; side: DockSide }) => void;
    onKey?: (contents: FakeContents, action: string) => void;
  }): {
    open(contents: FakeContents, options?: { side?: DockSide; window?: unknown }): unknown;
    close(contents: FakeContents): boolean;
    closeAll(): void;
    toggle(contents: FakeContents, options?: { side?: DockSide; window?: unknown }): boolean;
    layout(window: unknown, options: { visible: unknown; rect: unknown }): void;
    isOpen(contents: FakeContents): boolean;
    sideOf(contents: FakeContents): DockSide | null;
    views(window: unknown): { bounds: unknown; webContents: { closed: boolean } }[];
  };
};

const HIDDEN = { x: 0, y: 0, width: 0, height: 0 };

function fakeFrontend() {
  const emitter = new EventEmitter();
  const frontend = Object.assign(emitter, {
    closed: false,
    isDestroyed: () => false,
    close: () => {
      frontend.closed = true;
      emitter.emit("destroyed");
    },
    debugger: { isAttached: () => true, detach: () => {} },
  });
  return frontend;
}

/** WebContentsView falsa: guarda os bounds e o webContents (frontend). */
class FakeView {
  bounds: unknown = null;
  webContents = fakeFrontend();
  setBounds(rect: unknown) {
    this.bounds = rect;
  }
}

function fakeTab(id: number): FakeContents {
  const calls: string[] = [];
  return Object.assign(new EventEmitter(), {
    id,
    destroyed: false,
    calls,
    isDestroyed() {
      return this.destroyed;
    },
    setDevToolsWebContents: () => calls.push("set"),
    openDevTools: ({ mode }: { mode: string }) => calls.push(`open:${mode}`),
    closeDevTools: () => calls.push("close"),
    devToolsWebContents: null,
  }) as FakeContents;
}

function fakeWindow() {
  const children = new Set<unknown>();
  return {
    children,
    isDestroyed: () => false,
    contentView: {
      addChildView: (view: unknown) => children.add(view),
      removeChildView: (view: unknown) => children.delete(view),
    },
  };
}

describe("4.8 Fase 1: DevTools encaixado (devtools-dock.cjs)", () => {
  it("lado e tamanho válidos por workspace; o resto volta ao padrão", () => {
    expect(devtools.cleanDock({ side: "bottom", width: 9999, height: 10 })).toEqual({
      side: "bottom",
      width: 1600,
      height: 160,
    });
    expect(devtools.cleanDock({ side: "esquerda" })).toEqual(devtools.DEFAULT_DOCK);
    const map = devtools.withDock({ x: 1, "2": { side: "window" } }, 7, { side: "right" });
    expect(Object.keys(map)).toEqual(["2", "7"]);
    expect(map["2"]!.side).toBe("window");
    expect(devtools.withDock({}, null, { side: "bottom" })["default"]!.side).toBe("bottom");
  });

  it("teclas no próprio DevTools: F12 e Ctrl+Shift+I fecham, Ctrl+Shift+J vai ao Console", () => {
    const key = (key: string, extra = {}) => ({ type: "keyDown", key, ...extra });
    expect(devtools.dockKeyAction(key("F12"))).toBe("toggle");
    expect(devtools.dockKeyAction(key("I", { control: true, shift: true }))).toBe("toggle");
    expect(devtools.dockKeyAction(key("j", { meta: true, shift: true }))).toBe("console");
    // Ctrl+Shift+C e Ctrl+Shift+M ficam com o frontend (seletor e modo dispositivo).
    expect(devtools.dockKeyAction(key("c", { control: true, shift: true }))).toBeNull();
    expect(devtools.dockKeyAction(key("m", { control: true, shift: true }))).toBeNull();
    expect(devtools.dockKeyAction({ type: "keyUp", key: "F12" })).toBeNull();
  });

  it("ações no frontend usam a API que o Chrome usa (DevToolsAPI)", () => {
    expect(devtools.frontendScript("console")).toContain("DevToolsAPI.showPanel('console')");
    expect(devtools.frontendScript("inspect")).toContain("DevToolsAPI.enterInspectElementMode()");
    expect(devtools.frontendScript("device")).toContain("emulation.toggle-device-mode");
    expect(devtools.frontendScript("side", "bottom")).toContain('setDockSide("bottom")');
    expect(devtools.frontendScript("side", "window")).toBeNull();
    expect(devtools.frontendScript("eval")).toBeNull();
  });

  it("abre encaixado num WebContentsView próprio e só mostra o da guia à vista", () => {
    const events: string[] = [];
    const docks = devtools.createDevtoolsDocks({
      WebContentsView: FakeView,
      hiddenRect: HIDDEN,
      onChange: (contents, { open, side }) => events.push(`${contents.id}:${open}:${side}`),
    });
    const win = fakeWindow();
    const a = fakeTab(1);
    const b = fakeTab(2);
    docks.open(a, { side: "right", window: win });
    docks.open(b, { side: "right", window: win });
    // mode "right" (não "detach"): o frontend nasce com can_dock e modo dispositivo.
    expect(a.calls).toEqual(["set", "open:right"]);
    expect(win.children.size).toBe(2);
    const rect = { x: 10, y: 20, width: 500, height: 600 };
    docks.layout(win, { visible: a, rect });
    const [viewA, viewB] = docks.views(win);
    expect(viewA!.bounds).toEqual(rect);
    expect(viewB!.bounds).toEqual(HIDDEN);
    // Aba Terminal ou painel por cima: nenhum aparece.
    docks.layout(win, { visible: a, rect: null });
    expect(viewA!.bounds).toEqual(HIDDEN);
    expect(docks.isOpen(a)).toBe(true);
    expect(events).toEqual(["1:true:right", "2:true:right"]);
  });

  it("direita ↔ embaixo mantém a view; janela separada só abre com o frontend destruído", async () => {
    const docks = devtools.createDevtoolsDocks({ WebContentsView: FakeView, hiddenRect: HIDDEN });
    const win = fakeWindow();
    const tab = fakeTab(1);
    docks.open(tab, { side: "right", window: win });
    const [view] = docks.views(win);
    docks.open(tab, { side: "bottom", window: win });
    expect(docks.views(win)[0]).toBe(view);
    expect(tab.calls).toEqual(["set", "open:right"]);
    tab.emit("devtools-opened");
    docks.open(tab, { side: "window", window: win });
    // Com o frontend externo vivo, o Electron reabriria dentro dele: espera o destroyed.
    expect(tab.calls).toEqual(["set", "open:right", "close"]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(tab.calls).toEqual(["set", "open:right", "close", "open:detach"]);
    expect(view!.webContents.closed).toBe(true);
    expect(docks.sideOf(tab)).toBe("window");
    // O devtools-closed do dock anterior chega depois: não fecha o novo.
    tab.emit("devtools-closed");
    expect(docks.isOpen(tab)).toBe(true);
    tab.emit("devtools-opened");
    tab.emit("devtools-closed");
    expect(docks.isOpen(tab)).toBe(false);
  });

  it("fechar pelo X do frontend, fechar a guia e desligar a flag limpam o dock", () => {
    const closed: number[] = [];
    const docks = devtools.createDevtoolsDocks({
      WebContentsView: FakeView,
      hiddenRect: HIDDEN,
      onChange: (contents, { open }) => !open && closed.push(contents.id),
    });
    const win = fakeWindow();
    const [a, b, c] = [fakeTab(1), fakeTab(2), fakeTab(3)];
    for (const tab of [a, b, c]) docks.open(tab, { side: "bottom", window: win });
    a.emit("devtools-opened");
    a.emit("devtools-closed");
    b.emit("destroyed");
    expect(closed).toEqual([1, 2]);
    expect(docks.toggle(c)).toBe(false);
    docks.open(c, { side: "right", window: win });
    docks.closeAll();
    expect([docks.isOpen(a), docks.isOpen(b), docks.isOpen(c)]).toEqual([false, false, false]);
    expect(win.children.size).toBe(0);
  });

  it("main: hibernação pergunta ao dock, a flag manda e Inspecionar vai para a casca", () => {
    expect(main).toContain(
      "devtools: contents.isDevToolsOpened() || devtoolsDocks.isOpen(contents),",
    );
    expect(main).toContain("contents.isDevToolsOpened() || devtoolsDocks.isOpen(contents);");
    expect(main).toContain('if (input.type !== "keyDown" || featureFlags().devtools) return;');
    expect(main).toContain('action: "inspect-at"');
    expect(main).toContain("if (!flags.devtools) devtoolsDocks.closeAll();");
    // A guia que muda de janela fecha o DevTools antes (a view é filha da janela antiga).
    expect(main).toContain("if (entry) devtoolsDocks.close(entry.view.webContents);");
    expect(main).not.toContain('openDevTools({ mode: "split" })');
  });
});

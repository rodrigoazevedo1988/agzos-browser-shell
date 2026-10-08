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

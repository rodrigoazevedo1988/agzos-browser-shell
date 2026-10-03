import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { answerBlocks, aiErrorText, modelLabel } from "@/features/ai/model";
import {
  DEFAULT_GESTURES,
  createPinchTracker,
  createSwipeTracker,
  gestureAction,
  gestureConfigOf,
  isPinchWheel,
  parseGestures,
  strokeOf,
  STROKE_GESTURES,
} from "@/features/gestures/gestures";
import { runGesture, type GestureDeps } from "@/features/gestures/run";
import {
  clampTerminalHeight,
  clipboardKey,
  sessionTitle,
  terminalKeepsBrowserKey,
} from "@/features/terminal/model";

import { commandForKey } from "./commands";
import { parsePrefs } from "./persistence/snapshot";
import { defaultPrefs } from "./store/state";

// 4.0: aceleração de hardware, IA com a Groq, gestos e terminal.
const require = createRequire(import.meta.url);
const electronDir = path.join(process.cwd(), "electron");

type FakeApp = {
  commandLine: {
    switches: Map<string, string>;
    appendSwitch(name: string, value?: string): void;
    getSwitchValue(name: string): string;
  };
  getPath(): string;
  getVersion(): string;
  on(event: string, listener: (...args: unknown[]) => void): void;
  emit(event: string, ...args: unknown[]): void;
  getGPUFeatureStatus(): Record<string, string>;
};

function fakeApp(dir: string, version = "4.0.0"): FakeApp {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  const switches = new Map<string, string>();
  return {
    commandLine: {
      switches,
      appendSwitch: (name, value = "") => void switches.set(name, value),
      getSwitchValue: (name) => switches.get(name) ?? "",
    },
    getPath: () => dir,
    getVersion: () => version,
    on: (event, listener) => listeners.set(event, [...(listeners.get(event) ?? []), listener]),
    emit: (event, ...args) => listeners.get(event)?.forEach((listener) => listener(...args)),
    getGPUFeatureStatus: () => ({ video_decode: "enabled", rasterization: "enabled" }),
  };
}

const gpu = require(path.join(electronDir, "gpu-flags.cjs")) as {
  CRASH_LIMIT: number;
  gpuSwitches: (platform: string) => { switches: string[]; enable: string[]; disable: string[] };
  mergeFeatures: (current: string, extra: string[]) => string;
  applyGpuFlags: (
    app: FakeApp,
    options?: { platform?: string; env?: string },
  ) => { forced: boolean; reason: string | null };
  watchGpuCrashes: (app: FakeApp, mode: { forced: boolean }) => void;
  setGpuEnabled: (app: FakeApp, enabled: boolean) => boolean;
  gpuStatus: (app: FakeApp, mode: object) => { enabled: boolean; videoDecode: string | null };
};

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "agzos-v4-"));

describe("aceleração de hardware", () => {
  it("injeta as flags do PRD e junta as features com as da linha de comando", () => {
    const app = fakeApp(tmp());
    app.commandLine.appendSwitch("enable-features", "Foo");
    const mode = gpu.applyGpuFlags(app, { platform: "win32", env: undefined as never });
    expect(mode.forced).toBe(true);
    const line = app.commandLine.switches;
    for (const name of [
      "ignore-gpu-blocklist",
      "enable-gpu-rasterization",
      "enable-zero-copy",
      "enable-accelerated-video-decode",
    ]) {
      expect(line.has(name)).toBe(true);
    }
    expect(line.get("enable-features")!.split(",")).toEqual([
      "Foo",
      "VaapiVideoDecoder",
      "CanvasOopRasterization",
      "D3D11VideoDecoder",
    ]);
    expect(line.get("disable-features")).toBe("UseChromeOSDirectVideoDecoder");
  });

  it("não repete features e o macOS não ganha a pilha do Windows", () => {
    expect(gpu.mergeFeatures("A,B", ["B", "C"])).toBe("A,B,C");
    expect(gpu.gpuSwitches("darwin").enable).toEqual([
      "VaapiVideoDecoder",
      "CanvasOopRasterization",
    ]);
  });

  it("três quedas da GPU fazem o próximo início subir no modo padrão (até outra versão)", () => {
    const dir = tmp();
    const app = fakeApp(dir);
    const mode = gpu.applyGpuFlags(app, { platform: "win32" });
    gpu.watchGpuCrashes(app, mode);
    for (let i = 0; i < gpu.CRASH_LIMIT; i += 1) {
      app.emit("child-process-gone", {}, { type: "GPU", reason: "crashed" });
    }
    const next = fakeApp(dir);
    expect(gpu.applyGpuFlags(next, { platform: "win32" })).toEqual({
      forced: false,
      reason: "crash",
    });
    expect(next.commandLine.switches.size).toBe(0);
    // Versão nova tenta de novo; o usuário pode desligar de vez.
    expect(gpu.applyGpuFlags(fakeApp(dir, "4.0.1"), { platform: "win32" }).forced).toBe(true);
    gpu.setGpuEnabled(app, false);
    expect(gpu.applyGpuFlags(fakeApp(dir, "4.0.1")).reason).toBe("user");
    gpu.setGpuEnabled(app, true);
    expect(gpu.applyGpuFlags(fakeApp(dir)).forced).toBe(true);
    expect(gpu.gpuStatus(app, mode).videoDecode).toBe("enabled");
  });

  it("main.cjs aplica as flags antes do app.whenReady", () => {
    const main = fs.readFileSync(path.join(electronDir, "main.cjs"), "utf8");
    expect(main.indexOf("applyGpuFlags(app)")).toBeGreaterThan(0);
    expect(main.indexOf("applyGpuFlags(app)")).toBeLessThan(main.indexOf("app.whenReady()"));
    // Depois do userData dos testes (o estado da GPU mora lá).
    expect(main.indexOf("applyGpuFlags(app)")).toBeGreaterThan(
      main.indexOf('app.setPath("userData"'),
    );
  });
});

// --- IA ---

type AiResult = { ok: boolean; error?: string; text?: string; model?: string } & Record<
  string,
  unknown
>;
type Ai = {
  state(): { hasKey: boolean; encryption: boolean };
  setKey(key: string): Promise<AiResult>;
  removeKey(): AiResult;
  models(options?: { refresh?: boolean }): Promise<AiResult & { models?: string[] }>;
  history(): { role: string; text: string; context?: object }[];
  clearHistory(): AiResult;
  chat(
    payload: { requestId: string; model: string | null; text: string; context: object | null },
    onDelta: (delta: string) => void,
  ): Promise<AiResult & { fallbackFrom?: string | null }>;
};
const ai = require(path.join(electronDir, "ai.cjs")) as {
  createAi: (options: Record<string, unknown>) => Ai;
  chatModelsOf: (body: unknown) => string[];
  parseSse: (buffer: string, onDelta: (delta: string) => void) => { rest: string; done: boolean };
  buildMessages: (
    history: object[],
    question: string,
    context: object | null,
  ) => { role: string; content: string }[];
  errorOfStatus: (status: number, body: unknown) => string;
};

const KEY = "gsk_test_0123456789abcdefghijklmnop";

/** safeStorage de mentira: "cifra" invertendo os bytes (o arquivo não pode ter a chave). */
const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text: string) => Buffer.from(text, "utf8").reverse(),
  decryptString: (buffer: Buffer) => Buffer.from(buffer).reverse().toString("utf8"),
};

function memoryDb() {
  const meta = new Map<string, unknown>();
  return {
    getMeta: (key: string) => meta.get(key) ?? null,
    setMeta: (key: string, value: unknown) => void meta.set(key, value),
  };
}

function sse(chunks: string[]) {
  const body = chunks
    .map((text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`)
    .join("");
  return new Response(`${body}data: [DONE]\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

type Call = { url: string; init: RequestInit };
function fakeGroq(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return handler({ url, init });
  };
  return { fetch, calls };
}

const MODELS = {
  data: [
    { id: "whisper-large-v3" },
    { id: "llama-3.1-8b-instant" },
    { id: "llama-3.3-70b-versatile" },
    { id: "meta-llama/llama-guard-4-12b" },
  ],
};

describe("Agzos AI (Groq)", () => {
  it("sem chave não chama a API", async () => {
    const groq = fakeGroq(() => new Response("{}"));
    const service = ai.createAi({
      userDataDir: tmp(),
      safeStorage: fakeSafeStorage,
      fetch: groq.fetch,
      database: memoryDb(),
    });
    expect(service.state().hasKey).toBe(false);
    expect(
      await service.chat({ requestId: "1", model: null, text: "oi", context: null }, () => {}),
    ).toMatchObject({ ok: false, error: "no-key" });
    expect(await service.models()).toMatchObject({ ok: false, error: "no-key" });
    expect(groq.calls).toHaveLength(0);
  });

  it("valida a chave na Groq e grava só cifrada", async () => {
    const dir = tmp();
    const groq = fakeGroq(({ init }) => {
      const auth = (init.headers as Record<string, string>)["Authorization"];
      return auth === `Bearer ${KEY}`
        ? Response.json(MODELS)
        : Response.json({ error: { code: "invalid_api_key" } }, { status: 401 });
    });
    const service = ai.createAi({
      userDataDir: dir,
      safeStorage: fakeSafeStorage,
      fetch: groq.fetch,
      database: memoryDb(),
    });
    expect(await service.setKey("gsk_wrong_0123456789abcdefghijkl")).toMatchObject({
      ok: false,
      error: "invalid-key",
    });
    expect(service.state().hasKey).toBe(false);
    const saved = await service.setKey(`  ${KEY}\n`);
    expect(saved).toEqual({
      ok: true,
      models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
    });
    expect(service.state().hasKey).toBe(true);
    // Nenhum arquivo do perfil tem a chave em texto puro, e ela não volta em resultado nenhum.
    for (const file of fs.readdirSync(dir)) {
      expect(fs.readFileSync(path.join(dir, file)).toString("utf8")).not.toContain(KEY);
    }
    expect(JSON.stringify(saved)).not.toContain(KEY);
    expect(service.removeKey()).toEqual({ ok: true });
    expect(service.state().hasKey).toBe(false);
  });

  it("sem cofre do sistema a chave não é gravada", async () => {
    const service = ai.createAi({
      userDataDir: tmp(),
      safeStorage: { ...fakeSafeStorage, isEncryptionAvailable: () => false },
      fetch: fakeGroq(() => Response.json(MODELS)).fetch,
      database: memoryDb(),
    });
    expect(await service.setKey(KEY)).toMatchObject({ ok: false, error: "insecure" });
  });

  it("responde em streaming, guarda a conversa e manda o contexto só quando pedido", async () => {
    const db = memoryDb();
    const groq = fakeGroq(({ url }) =>
      url.endsWith("/models") ? Response.json(MODELS) : sse(["Olá", ", ", "mundo!"]),
    );
    const service = ai.createAi({
      userDataDir: tmp(),
      safeStorage: fakeSafeStorage,
      fetch: groq.fetch,
      database: db,
    });
    await service.setKey(KEY);
    const deltas: string[] = [];
    const first = await service.chat(
      { requestId: "a", model: null, text: "Oi?", context: null },
      (delta) => deltas.push(delta),
    );
    expect(deltas).toEqual(["Olá", ", ", "mundo!"]);
    expect(first).toMatchObject({
      ok: true,
      text: "Olá, mundo!",
      model: "llama-3.3-70b-versatile",
    });
    const request = JSON.parse(String(groq.calls.at(-1)!.init.body)) as {
      stream: boolean;
      messages: { role: string; content: string }[];
    };
    expect(request.stream).toBe(true);
    expect(JSON.stringify(request.messages)).not.toContain("Contexto da aba");

    await service.chat(
      {
        requestId: "b",
        model: "llama-3.1-8b-instant",
        text: "Resuma",
        context: { url: "https://ex.com/a", title: "Página A", selection: "trecho" },
      },
      () => {},
    );
    const second = JSON.parse(String(groq.calls.at(-1)!.init.body)) as {
      model: string;
      messages: { role: string; content: string }[];
    };
    expect(second.model).toBe("llama-3.1-8b-instant");
    const last = second.messages.at(-1)!.content;
    expect(last).toContain("URL: https://ex.com/a");
    expect(last).toContain("trecho");
    // A pergunta anterior vai junto (conversa); o contexto antigo não.
    expect(second.messages.map((item) => item.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user",
    ]);
    expect(service.history()).toHaveLength(4);
    expect(service.history()[2]).toMatchObject({
      context: { url: "https://ex.com/a", selection: true },
    });
    service.clearHistory();
    expect(service.history()).toEqual([]);
  });

  it("modelo indisponível cai no próximo; limite e rede viram códigos", async () => {
    let mode: "model" | "rate" | "network" = "model";
    const groq = fakeGroq(({ url, init }) => {
      if (url.endsWith("/models")) return Response.json(MODELS);
      const model = (JSON.parse(String(init.body)) as { model: string }).model;
      if (mode === "rate") {
        return Response.json({}, { status: 429, headers: { "retry-after": "7" } });
      }
      if (mode === "network") throw new TypeError("fetch failed");
      return model === "llama-3.3-70b-versatile"
        ? Response.json({ error: { code: "model_decommissioned" } }, { status: 400 })
        : sse(["ok"]);
    });
    const service = ai.createAi({
      userDataDir: tmp(),
      safeStorage: fakeSafeStorage,
      fetch: groq.fetch,
      database: memoryDb(),
    });
    await service.setKey(KEY);
    const ask = () =>
      service.chat(
        { requestId: "x", model: "llama-3.3-70b-versatile", text: "?", context: null },
        () => {},
      );
    expect(await ask()).toMatchObject({
      ok: true,
      model: "llama-3.1-8b-instant",
      fallbackFrom: "llama-3.3-70b-versatile",
    });
    mode = "rate";
    expect(await ask()).toMatchObject({ ok: false, error: "rate-limit", retryAfter: 7 });
    mode = "network";
    expect(await ask()).toMatchObject({ ok: false, error: "network" });
  });

  it("SSE em pedaços cortados e textos de erro", () => {
    const deltas: string[] = [];
    const first = ai.parseSse('data: {"choices":[{"delta":{"content":"a"}}]}\ndata: {"cho', (d) =>
      deltas.push(d),
    );
    expect(first.rest).toBe('data: {"cho');
    ai.parseSse(`${first.rest}ices":[{"delta":{"content":"b"}}]}\n`, (d) => deltas.push(d));
    expect(deltas).toEqual(["a", "b"]);
    expect(ai.errorOfStatus(401, null)).toBe("invalid-key");
    expect(ai.errorOfStatus(503, null)).toBe("server");
    expect(aiErrorText("rate-limit", 12)).toContain("12 s");
    expect(modelLabel("openai/gpt-oss-120b")).toBe("gpt oss 120b");
    expect(answerBlocks("Veja:\n```ts\nconst a = 1;\n```\nFim")).toEqual([
      { kind: "text", text: "Veja:" },
      { kind: "code", text: "const a = 1;" },
      { kind: "text", text: "Fim" },
    ]);
  });

  it("Ctrl+Shift+A abre a IA e o main repassa o atalho", () => {
    expect(commandForKey({ key: "A", ctrl: true, meta: false, shift: true, alt: false })?.id).toBe(
      "ai.toggle",
    );
    const main = fs.readFileSync(path.join(electronDir, "main.cjs"), "utf8");
    expect(main).toContain('"mod+shift+a"');
    expect(main).toContain('"mod+alt+t"');
  });
});

// --- Gestos ---

describe("gestos", () => {
  it("deslizar dispara uma vez por movimento, no sentido certo", () => {
    let now = 0;
    const tracker = createSwipeTracker(() => now);
    const results = [];
    for (let i = 0; i < 10; i += 1) {
      now += 10;
      results.push(tracker.push(-30, 2));
    }
    expect(results.filter(Boolean)).toEqual(["swipe-right"]);
    now += 500; // novo movimento
    const next = [];
    for (let i = 0; i < 6; i += 1) {
      now += 10;
      next.push(tracker.push(40, 0));
    }
    expect(next.filter(Boolean)).toEqual(["swipe-left"]);
    // Rolagem vertical não conta.
    now += 500;
    expect(Array.from({ length: 20 }, () => tracker.push(5, 40)).filter(Boolean)).toEqual([]);
  });

  it("pinça em passos e roda do mouse com Ctrl fica com o Chromium", () => {
    const pinch = createPinchTracker();
    expect([pinch.push(-20), pinch.push(-30)]).toEqual([0, 1]);
    expect([pinch.push(25), pinch.push(25)]).toEqual([0, -1]);
    expect(isPinchWheel(-3.5, 0)).toBe(true);
    expect(isPinchWheel(-100, 0)).toBe(false);
  });

  it("traços viram gestos", () => {
    const path = (points: [number, number][]) => points.map(([x, y]) => ({ x, y }));
    expect(
      STROKE_GESTURES[
        strokeOf(
          path([
            [100, 100],
            [60, 102],
            [10, 98],
          ]),
        )
      ],
    ).toBe("draw-left");
    expect(
      STROKE_GESTURES[
        strokeOf(
          path([
            [0, 100],
            [0, 40],
            [2, 0],
            [0, 60],
            [0, 120],
          ]),
        )
      ],
    ).toBe("draw-up-down");
    expect(
      STROKE_GESTURES[
        strokeOf(
          path([
            [0, 0],
            [0, 80],
            [80, 82],
          ]),
        )
      ],
    ).toBe("draw-down-right");
    // Tremida curta não é gesto (o menu de contexto abre normalmente).
    expect(
      strokeOf(
        path([
          [0, 0],
          [10, 8],
          [5, 3],
        ]),
      ),
    ).toBe("");
  });

  it("preferências: liga/desliga, troca a ação e valida o que vem do disco", () => {
    const prefs = parseGestures({
      "swipe-right": { on: true, action: "forward" },
      pinch: { on: false, action: "back" },
      "draw-down": { on: true, action: "rm -rf" },
    });
    expect(prefs["swipe-right"].action).toBe("forward");
    expect(prefs.pinch).toEqual({ on: false, action: "zoom" });
    expect(prefs["draw-down"].action).toBe("tab-new");
    expect(gestureConfigOf(prefs)).toEqual({ swipe: true, pinch: false, draw: true, mouse: true });
    expect(gestureAction(prefs, "pinch")).toBeNull();
    expect(parsePrefs({}).gestures).toEqual(DEFAULT_GESTURES);
  });

  it("cada gesto age na superfície onde aconteceu", () => {
    const calls: string[] = [];
    const deps: GestureDeps = {
      activeId: 1,
      step: (delta) => calls.push(`step ${delta}`),
      navigate: (id, delta) => calls.push(`nav ${id} ${delta}`),
      zoom: (id, direction) => calls.push(`zoom ${id} ${direction}`),
      panelZoom: (app, direction) => calls.push(`panel-zoom ${app} ${direction}`),
      panelNav: (app, action) => calls.push(`panel ${app} ${action}`),
      command: (id, tabId) => calls.push(`${id} ${tabId}`),
    };
    const g = DEFAULT_GESTURES;
    runGesture({ gesture: "swipe-right", surface: { kind: "tab", id: 1 } }, g, deps);
    runGesture({ gesture: "mouse-forward", surface: { kind: "tab", id: 2 } }, g, deps);
    runGesture({ gesture: "pinch", surface: { kind: "tab", id: 2 }, direction: -1 }, g, deps);
    runGesture(
      { gesture: "pinch", surface: { kind: "panel", app: "discord" }, direction: 1 },
      g,
      deps,
    );
    runGesture({ gesture: "mouse-back", surface: { kind: "panel", app: "discord" } }, g, deps);
    runGesture({ gesture: "draw-down-right", surface: { kind: "active" } }, g, deps);
    runGesture({ gesture: "draw-up-down", surface: { kind: "tab", id: 2 } }, g, deps);
    const off = { ...g, "swipe-left": { on: false, action: "forward" as const } };
    runGesture({ gesture: "swipe-left", surface: { kind: "active" } }, off, deps);
    expect(calls).toEqual([
      "step -1",
      "nav 2 1",
      "zoom 2 -1",
      "panel-zoom discord 1",
      "panel discord back",
      "tab.close 1",
      "tab.reload 2",
    ]);
  });

  it("o page-preload usa os mesmos limites do módulo da casca", () => {
    const preload = fs.readFileSync(path.join(electronDir, "page-preload.cjs"), "utf8");
    expect(preload).toContain("const SWIPE_DISTANCE = 160;");
    expect(preload).toContain("const PINCH_STEP = 45;");
    expect(preload).toContain("const STROKE_SEGMENT = 36;");
    for (const [stroke, id] of Object.entries(STROKE_GESTURES)) {
      expect(preload).toContain(`${stroke}: "${id}"`);
    }
  });
});

// --- Terminal ---

type Terminals = {
  available(): { ok: boolean; shells: { id: string; label: string }[] };
  open(
    owner: object,
    options: { shell?: string; cwd?: string; cols?: number; rows?: number },
  ): { ok: boolean; id: number; cwd: string; error?: string };
  write(owner: object, id: number, data: string): boolean;
  resize(owner: object, id: number, cols: number, rows: number): boolean;
  kill(owner: object, id: number): boolean;
  killAll(owner?: object): void;
};
const terminal = require(path.join(electronDir, "terminal.cjs")) as {
  availableShells: (options: {
    platform: string;
    env: Record<string, string>;
    exists: (file: string) => boolean;
  }) => { id: string; file: string; args: string[] }[];
  createTerminals: (options: Record<string, unknown>) => Terminals;
  cwdFromOutput: (text: string) => string | null;
  shellEnv: (env: Record<string, string>) => Record<string, string>;
  terminalKeepsBrowserKey: (combo: string, options: { mac: boolean; meta: boolean }) => boolean;
};

describe("terminal", () => {
  it("shells de cada sistema, o do usuário primeiro", () => {
    const win = terminal.availableShells({
      platform: "win32",
      env: { SystemRoot: "C:\\Windows", ComSpec: "C:\\Windows\\system32\\cmd.exe", PATH: "" },
      exists: (file) => file.endsWith("PowerShell\\7\\pwsh.exe"),
    });
    expect(win.map((shell) => shell.id)).toEqual(["powershell", "cmd"]);
    const winWithPwsh = terminal.availableShells({
      platform: "win32",
      env: { SystemRoot: "C:\\Windows", ProgramFiles: "C:\\Program Files", PATH: "" },
      exists: (file) => file.endsWith("pwsh.exe"),
    });
    expect(winWithPwsh.map((shell) => shell.id)).toEqual(["powershell", "pwsh", "cmd"]);
    const mac = terminal.availableShells({
      platform: "darwin",
      env: { SHELL: "/bin/bash" },
      exists: () => true,
    });
    expect(mac.map((shell) => shell.id)).toEqual(["bash", "zsh"]);
  });

  it("pasta atual pelo prompt do PowerShell/cmd e pelo OSC 7", () => {
    expect(terminal.cwdFromOutput("\r\nPS C:\\Users\\rodrigo\\proj> ")).toBe(
      "C:\\Users\\rodrigo\\proj",
    );
    expect(terminal.cwdFromOutput("dir\r\nC:\\>")).toBe("C:\\");
    expect(terminal.cwdFromOutput("\x1b]7;file://mac/Users/r/a%20b\x07$ ")).toBe("/Users/r/a b");
    expect(terminal.cwdFromOutput("saída qualquer\r\n")).toBeNull();
  });

  it("o shell não herda as variáveis do Electron", () => {
    const env = terminal.shellEnv({
      PATH: "/bin",
      ELECTRON_RUN_AS_NODE: "1",
      AGZOS_USER_DATA: "/tmp/x",
    });
    expect(env).toMatchObject({ PATH: "/bin", TERM: "xterm-256color" });
    expect(env).not.toHaveProperty("ELECTRON_RUN_AS_NODE");
    expect(env).not.toHaveProperty("AGZOS_USER_DATA");
  });

  it("teclas: o shell fica com Ctrl+C/W/R/L; o navegador com Ctrl+Tab e o ⌘ do Mac", () => {
    for (const combo of ["mod+c", "mod+w", "mod+r", "mod+l", "mod+d"]) {
      expect(terminal.terminalKeepsBrowserKey(combo, { mac: false, meta: false })).toBe(false);
      expect(terminalKeepsBrowserKey(combo)).toBe(false);
    }
    for (const combo of ["mod+tab", "mod+alt+t", "mod+1", "f11"]) {
      expect(terminal.terminalKeepsBrowserKey(combo, { mac: false, meta: false })).toBe(true);
      expect(terminalKeepsBrowserKey(combo)).toBe(true);
    }
    expect(terminal.terminalKeepsBrowserKey("mod+w", { mac: true, meta: true })).toBe(true);
    expect(terminalKeepsBrowserKey("mod+w", { mac: true, meta: false })).toBe(false);
    const key = (
      k: string,
      mods: Partial<Record<"ctrlKey" | "metaKey" | "shiftKey", boolean>>,
    ) => ({
      key: k,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      ...mods,
    });
    expect(clipboardKey(key("c", { ctrlKey: true }), "windows", false)).toBeNull();
    expect(clipboardKey(key("c", { ctrlKey: true }), "windows", true)).toBe("copy");
    expect(clipboardKey(key("v", { ctrlKey: true }), "windows", false)).toBe("paste");
    expect(clipboardKey(key("v", { ctrlKey: true }), "linux", false)).toBeNull();
    expect(clipboardKey(key("V", { ctrlKey: true, shiftKey: true }), "linux", false)).toBe("paste");
    expect(clipboardKey(key("c", { metaKey: true }), "mac", true)).toBe("copy");
    expect(clampTerminalHeight(5)).toBe(140);
    expect(sessionTitle("C:\\Windows\\System32\\pwsh.exe", "C:\\Users\\r\\proj")).toBe(
      "pwsh · proj",
    );
    expect(defaultPrefs.terminalOpen).toBe(false);
  });

  it("sessões isoladas por janela, sem comando nenhum na abertura", () => {
    const spawned: { file: string; args: string[]; options: { cwd: string }; written: string[] }[] =
      [];
    const fakePty = {
      spawn(file: string, args: string[], options: { cwd: string }) {
        const record = { file, args, options, written: [] as string[] };
        spawned.push(record);
        return {
          pid: 1,
          onData: () => {},
          onExit: () => {},
          write: (data: string) => record.written.push(data),
          resize: () => {},
          kill: () => {},
        };
      },
    };
    const service = terminal.createTerminals({
      loadPty: () => fakePty,
      platform: "linux",
      env: { SHELL: "/bin/bash" },
      homedir: os.tmpdir(),
      exists: () => true,
      onData: () => {},
      onExit: () => {},
    });
    const a = {};
    const b = {};
    const session = service.open(a, { cwd: "/nao/existe" });
    expect(session).toMatchObject({ ok: true, cwd: os.tmpdir() });
    expect(spawned[0]!.written).toEqual([]);
    expect(service.write(b, session.id, "ls\r")).toBe(false);
    expect(service.write(a, session.id, "ls\r")).toBe(true);
    expect(spawned[0]!.written).toEqual(["ls\r"]);
  });

  it("PTY real: cd persiste, Ctrl+C interrompe e o resize muda colunas/linhas", async () => {
    if (process.platform === "win32" || !fs.existsSync("/bin/bash")) return;
    let output = "";
    const exits: number[] = [];
    const service = terminal.createTerminals({
      loadPty: () => require("node-pty"),
      env: { ...process.env, PS1: "$ " },
      homedir: os.tmpdir(),
      onData: (_owner: object, _id: number, data: string) => (output += data),
      onExit: (_owner: object, id: number) => exits.push(id),
    });
    const owner = {};
    const until = async (text: string) => {
      for (let i = 0; i < 100 && !output.includes(text); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(output).toContain(text);
    };
    const session = service.open(owner, { shell: "bash", cwd: os.tmpdir(), cols: 80, rows: 24 });
    expect(session.ok).toBe(true);
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agzos-cd-")));
    service.write(owner, session.id, `cd ${dir}\r`);
    service.write(owner, session.id, "echo AQUI=$(pwd)\r");
    await until(`AQUI=${dir}`);
    service.write(owner, session.id, "sleep 30; echo FIM=$((40+2))\r");
    await new Promise((resolve) => setTimeout(resolve, 300));
    service.write(owner, session.id, "\x03");
    service.write(owner, session.id, "echo DEPOIS=$?\r");
    await until("DEPOIS=130");
    expect(output).not.toContain("FIM=42");
    service.resize(owner, session.id, 101, 33);
    service.write(owner, session.id, "echo TAM=$(stty size)\r");
    await until("TAM=33 101");
    service.killAll(owner);
    for (let i = 0; i < 40 && !exits.length; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(exits).toEqual([session.id]);
  }, 20_000);
});

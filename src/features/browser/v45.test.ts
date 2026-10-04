import { EventEmitter } from "node:events";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { describe, expect, it, vi } from "vitest";

import { layerScale, regionOf } from "@/features/capture/compose";
import { filterPorts, killErrorText, tunnelErrorText } from "@/features/dev/ports";
import { otherNotes } from "@/features/notes/model";
import {
  editorOf,
  headersToText,
  prettyBody,
  shortUrl,
  textToHeaders,
} from "@/features/scratchpad/model";

import { commandById, commands, type CommandContext } from "./commands";
import type { PortInfo } from "./desktop";
import { parseNotes, parsePrefs, parseTabs } from "./persistence/snapshot";
import { browserReducer } from "./store/reducer";
import { initialState } from "./store/state";
import { SESSION_TAB_COLORS, newTabSession, noteKeyOf, type Tab } from "./types";

// 4.5: dev no navegador (portas, túnel, Session Tabs, Scratchpad, mira), extensões,
// Widevine, captura, modo leitura, notas e temas.
const require = createRequire(import.meta.url);
const electronDir = path.join(process.cwd(), "electron");
const load = <T>(name: string) => require(path.join(electronDir, name)) as T;
const mainSource = fs.readFileSync(path.join(electronDir, "main.cjs"), "utf8");

type Entry = { port: number; address: string; pid: number | null; name: string };
const ports = load<{
  parseSs: (text: string) => Entry[];
  parseLsof: (text: string) => Entry[];
  parseNetstat: (text: string) => Entry[];
  parseTasklist: (text: string) => Map<number, string>;
  mergePorts: (entries: Entry[]) => {
    port: number;
    pid: number | null;
    pids: number[];
    name: string;
    addresses: string[];
    local: boolean;
  }[];
  projectOf: (
    cwd: string,
    helpers: {
      readJson: (file: string) => unknown;
      exists: (file: string) => boolean;
      home?: string;
    },
  ) => { name: string; dir: string } | null;
  projectDirOfCommand: (command: string) => string | null;
  canKill: (pid: number, options: { listed: Set<number>; protectedPids: Set<number> }) => boolean;
  splitAddress: (value: string) => { address: string; port: number } | null;
}>("ports.cjs");

describe("4.5: painel de portas (leitura do sistema)", () => {
  it("ss do Linux: porta, endereço, processo e PID; sem permissão vem sem PID", () => {
    const text = [
      'LISTEN 0      511          0.0.0.0:3000       0.0.0.0:*    users:(("node",pid=4242,fd=21))',
      'LISTEN 0      511             [::]:3000          [::]:*    users:(("node",pid=4242,fd=22))',
      "LISTEN 0      244        127.0.0.1:5432       0.0.0.0:*",
      'LISTEN 0      128    [::ffff:127.0.0.1]:8080   *:*  users:(("java",pid=7,fd=3),("java",pid=8,fd=3))',
      "ESTAB 0 0 1.2.3.4:5 6.7.8.9:10",
    ].join("\n");
    const entries = ports.parseSs(text);
    expect(entries).toEqual([
      { address: "0.0.0.0", port: 3000, pid: 4242, name: "node" },
      { address: "::", port: 3000, pid: 4242, name: "node" },
      { address: "127.0.0.1", port: 5432, pid: null, name: "" },
      { address: "::ffff:127.0.0.1", port: 8080, pid: 7, name: "java" },
      { address: "::ffff:127.0.0.1", port: 8080, pid: 8, name: "java" },
    ]);
    const merged = ports.mergePorts(entries);
    // Os dois java na 8080 viram uma linha (PID principal 7, com o 8 junto).
    expect(merged.map((item) => [item.port, item.pid, item.pids])).toEqual([
      [3000, 4242, [4242]],
      [5432, null, []],
      [8080, 7, [7, 8]],
    ]);
    expect(merged[0]).toMatchObject({ addresses: ["0.0.0.0", "::"], local: false });
    expect(merged[1]).toMatchObject({ local: true });
  });

  it("lsof do macOS e netstat/tasklist do Windows", () => {
    expect(
      ports.parseLsof(
        "p501\ncnode\nf23\nn*:3000\nf24\nn[::1]:3000\np77\ncpostgres\nn127.0.0.1:5432\n",
      ),
    ).toEqual([
      { address: "*", port: 3000, pid: 501, name: "node" },
      { address: "::1", port: 3000, pid: 501, name: "node" },
      { address: "127.0.0.1", port: 5432, pid: 77, name: "postgres" },
    ]);
    const netstat = [
      "Active Connections",
      "  Proto  Local Address          Foreign Address        State           PID",
      "  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       1234",
      "  TCP    [::]:5432              [::]:0                 LISTENING       88",
      "  TCP    10.0.0.2:51000         1.1.1.1:443            ESTABLISHED     99",
    ].join("\r\n");
    expect(ports.parseNetstat(netstat)).toEqual([
      { address: "0.0.0.0", port: 3000, pid: 1234, name: "" },
      { address: "::", port: 5432, pid: 88, name: "" },
    ]);
    const names = ports.parseTasklist(
      '"node.exe","1234","Console","1","45.000 K"\r\n"postgres.exe","88","Services","0","9 K"',
    );
    expect(names.get(1234)).toBe("node.exe");
    expect(names.get(88)).toBe("postgres.exe");
  });

  it("projeto: package.json mais próximo, marcadores de outras linguagens ou a pasta", () => {
    const files: Record<string, unknown> = {
      "/home/ana/leadmobi/package.json": { name: "leadmobi" },
      "/home/ana/api/go.mod": "",
    };
    const helpers = {
      readJson: (file: string) => (typeof files[file] === "object" ? files[file] : null),
      exists: (file: string) => file in files,
      home: "/home/ana",
    };
    expect(ports.projectOf("/home/ana/leadmobi/apps/web", helpers)).toEqual({
      name: "leadmobi",
      dir: "/home/ana/leadmobi",
    });
    expect(ports.projectOf("/home/ana/api/cmd", helpers)).toEqual({
      name: "api",
      dir: "/home/ana/api",
    });
    expect(ports.projectOf("/srv/coisa", helpers)).toEqual({ name: "coisa", dir: "/srv/coisa" });
    expect(ports.projectOf("/home/ana", helpers)).toBeNull();
    expect(ports.projectOf("/", helpers)).toBeNull();
    expect(
      ports.projectDirOfCommand(
        '"C:\\Program Files\\nodejs\\node.exe" C:\\dev\\loja\\node_modules\\vite\\bin\\vite.js',
      ),
    ).toBe("C:\\dev\\loja");
    expect(ports.projectDirOfCommand("python /srv/app/manage.py runserver")).toBe("/srv/app");
  });

  it("matar só vale para PID da última leitura e nunca para o próprio app", () => {
    const options = { listed: new Set([4242, 10]), protectedPids: new Set([10]) };
    expect(ports.canKill(4242, options)).toBe(true);
    expect(ports.canKill(10, options)).toBe(false);
    expect(ports.canKill(999, options)).toBe(false);
    expect(ports.canKill(1, { listed: new Set([1]), protectedPids: new Set() })).toBe(false);
  });

  it("serviço: lê a porta 3000 e mata o processo depois de listado", async () => {
    const { createPortsService } = load<{
      createPortsService: (deps: object) => {
        scan: () => Promise<
          { port: number; pid: number; project: { name: string } | null; self: boolean }[]
        >;
        kill: (
          pid: number,
          killer: (pid: number, signal: string | number) => void,
        ) => Promise<{ ok: boolean; error?: string }>;
      };
    }>("ports-service.cjs");
    const execFile = vi.fn(
      (file: string, _args: string[], _opts: object, done: (e: null, out: string) => void) => {
        done(
          null,
          file === "ss"
            ? 'LISTEN 0 511 0.0.0.0:3000 0.0.0.0:* users:(("node",pid=4242,fd=21))\nLISTEN 0 1 127.0.0.1:9000 0.0.0.0:* users:(("agzos",pid=10,fd=3))'
            : "",
        );
      },
    );
    const fakeFs = {
      readlinkSync: (file: string) =>
        file === "/proc/4242/cwd" ? "/home/ana/leadmobi" : "/opt/agzos",
      readFileSync: (file: string) => {
        if (file === "/home/ana/leadmobi/package.json") return JSON.stringify({ name: "leadmobi" });
        throw new Error("ENOENT");
      },
      statSync: () => {
        throw new Error("ENOENT");
      },
    };
    const service = createPortsService({
      execFile,
      fs: fakeFs,
      platform: "linux",
      home: "/home/ana",
      protectedPids: () => [10],
    });
    const list = await service.scan();
    expect(list[0]).toMatchObject({
      port: 3000,
      pid: 4242,
      project: { name: "leadmobi" },
      self: false,
    });
    expect(list[1]).toMatchObject({ port: 9000, self: true });
    let alive = true;
    const killer = vi.fn((_pid: number, signal: string | number) => {
      if (signal === "SIGTERM") alive = false;
      else if (signal === 0 && !alive) throw new Error("ESRCH");
    });
    await expect(service.kill(4242, killer)).resolves.toEqual({ ok: true });
    expect(killer).toHaveBeenCalledWith(4242, "SIGTERM");
    await expect(service.kill(10, killer)).resolves.toEqual({ ok: false, error: "denied" });
    // Já morto e fora da lista: não mata de novo.
    await expect(service.kill(4242, killer)).resolves.toEqual({ ok: false, error: "denied" });
  });
});

const tunnel = load<{
  tunnelUrlOf: (line: string) => string | null;
  cloudflaredCandidates: (options: object) => string[];
  findCloudflared: (options: object, isExecutable: (file: string) => boolean) => string | null;
  looksLikeCloudflared: (file: string) => boolean;
  createTunnels: (deps: object) => {
    start: (
      owner: string,
      port: number,
      binary: string,
    ) => Promise<{ ok: boolean; url?: string; error?: string }>;
    stop: (owner: string, port: number) => boolean;
    stopOwner: (owner: string) => void;
    list: (owner: string) => { port: number; url: string | null }[];
  };
}>("tunnel.cjs");

describe("4.5: túnel HTTPS (cloudflared)", () => {
  it("acha a URL do Quick Tunnel na saída e ignora a da API", () => {
    expect(
      tunnel.tunnelUrlOf(
        "2026-10-03T12:00:00Z INF |  https://calm-river-1234.trycloudflare.com  |",
      ),
    ).toBe("https://calm-river-1234.trycloudflare.com");
    expect(tunnel.tunnelUrlOf("POST https://api.trycloudflare.com/tunnel")).toBeNull();
    expect(tunnel.tunnelUrlOf("nada aqui")).toBeNull();
  });

  it("procura o binário no escolhido, no PATH e nas pastas padrão; sem ele, null", () => {
    const linux = { env: { PATH: "/usr/bin:/home/ana/bin" }, platform: "linux", home: "/home/ana" };
    expect(tunnel.cloudflaredCandidates(linux)).toContain("/opt/homebrew/bin/cloudflared");
    expect(tunnel.findCloudflared(linux, (file) => file === "/home/ana/bin/cloudflared")).toBe(
      "/home/ana/bin/cloudflared",
    );
    expect(tunnel.findCloudflared(linux, () => false)).toBeNull();
    const windows = tunnel.cloudflaredCandidates({
      env: { Path: "C:\\bin", ProgramFiles: "C:\\Program Files" },
      platform: "win32",
      configured: "D:\\tools\\cloudflared.exe",
    });
    expect(windows[0]).toBe("D:\\tools\\cloudflared.exe");
    expect(windows).toContain("C:\\Program Files\\cloudflared\\cloudflared.exe");
    expect(tunnel.looksLikeCloudflared("/usr/local/bin/cloudflared")).toBe(true);
    expect(tunnel.looksLikeCloudflared("C:\\x\\cloudflared-windows-amd64.exe")).toBe(true);
    expect(tunnel.looksLikeCloudflared("/bin/sh")).toBe(false);
  });

  it("abre, lista e encerra o túnel (o processo morre)", async () => {
    const children: (EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: () => void;
      killed: boolean;
    })[] = [];
    const spawn = vi.fn(() => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        killed: false,
        kill() {
          this.killed = true;
        },
      });
      children.push(child);
      return child;
    });
    const events: object[] = [];
    const tunnels = tunnel.createTunnels({ spawn, onEvent: (event: object) => events.push(event) });
    const pending = tunnels.start("w1", 3000, "/usr/bin/cloudflared");
    expect(spawn).toHaveBeenCalledWith(
      "/usr/bin/cloudflared",
      ["tunnel", "--no-autoupdate", "--url", "http://localhost:3000"],
      expect.any(Object),
    );
    children[0]!.stderr.emit("data", "INF Requesting new quick Tunnel on trycloudflare.com...\n");
    children[0]!.stderr.emit("data", "INF |  https://abc-def.trycloudflare.com  |\n");
    await expect(pending).resolves.toEqual({ ok: true, url: "https://abc-def.trycloudflare.com" });
    expect(tunnels.list("w1")).toEqual([{ port: 3000, url: "https://abc-def.trycloudflare.com" }]);
    tunnels.stopOwner("w1");
    expect(children[0]!.killed).toBe(true);
    expect(tunnels.list("w1")).toEqual([]);
    expect(events).toContainEqual({ owner: "w1", port: 3000, state: "closed" });
    await expect(tunnels.start("w1", 70000, "/x")).resolves.toEqual({ ok: false, error: "port" });
  });

  it("sem URL a tempo, o túnel é encerrado e avisa", async () => {
    vi.useFakeTimers();
    try {
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        kill: vi.fn(),
      });
      const tunnels = tunnel.createTunnels({ spawn: () => child, timeoutMs: 1000 });
      const pending = tunnels.start("w2", 8080, "cloudflared");
      vi.advanceTimersByTime(1001);
      await expect(pending).resolves.toEqual({ ok: false, error: "timeout" });
      expect(child.kill).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

const inspector = load<{
  rgbToHex: (value: string) => string | null;
  tailwindFor: (style: Record<string, string>) => string[];
  colorsOf: (style: Record<string, string>) => { label: string; hex: string }[];
  inspectorSource: () => string;
  INSPECTOR_WORLD: number;
}>("inspector.cjs");

const baseStyle = {
  color: "rgb(209, 10, 17)",
  backgroundColor: "rgba(0, 0, 0, 0)",
  borderTopWidth: "0px",
  borderTopColor: "rgb(0, 0, 0)",
  fontSize: "16px",
  fontWeight: "400",
  fontStyle: "normal",
  fontFamily: "Inter, sans-serif",
  textAlign: "start",
  textTransform: "none",
  paddingTop: "0px",
  paddingRight: "0px",
  paddingBottom: "0px",
  paddingLeft: "0px",
  marginTop: "0px",
  marginRight: "0px",
  marginBottom: "0px",
  marginLeft: "0px",
  borderTopLeftRadius: "0px",
  display: "block",
};

describe("4.5: mira de elemento (Ctrl+Shift+C)", () => {
  it("cores em HEX (o vermelho #D10A11), com alfa e sem os transparentes", () => {
    expect(inspector.rgbToHex("rgb(209, 10, 17)")).toBe("#D10A11");
    expect(inspector.rgbToHex("rgb(209 10 17 / 50%)")).toBe("#D10A1180");
    expect(inspector.rgbToHex("rgba(0, 0, 0, 0)")).toBeNull();
    expect(inspector.rgbToHex("red")).toBeNull();
    expect(inspector.colorsOf(baseStyle)).toEqual([{ label: "Texto", hex: "#D10A11" }]);
  });

  it("sugere classes Tailwind copiáveis (escala quando dá, valor arbitrário senão)", () => {
    expect(inspector.tailwindFor(baseStyle)).toEqual([
      "text-[#d10a11]",
      "text-base",
      "font-['Inter']",
    ]);
    const button = inspector.tailwindFor({
      ...baseStyle,
      color: "rgb(255, 255, 255)",
      backgroundColor: "rgb(209, 10, 17)",
      fontSize: "14px",
      fontWeight: "600",
      paddingTop: "8px",
      paddingBottom: "8px",
      paddingLeft: "16px",
      paddingRight: "16px",
      borderTopLeftRadius: "8px",
      borderTopWidth: "1px",
      borderTopColor: "rgb(17, 17, 17)",
      display: "inline-flex",
      fontFamily: "system-ui, sans-serif",
    });
    expect(button).toEqual([
      "text-white",
      "bg-[#d10a11]",
      "border-[#111111]",
      "text-sm",
      "font-semibold",
      "font-['system-ui']",
      "py-2",
      "px-4",
      "rounded-lg",
      "inline-flex",
    ]);
    expect(
      inspector.tailwindFor({
        ...baseStyle,
        fontSize: "13px",
        paddingTop: "13px",
        paddingRight: "13px",
        paddingBottom: "13px",
        paddingLeft: "13px",
      }),
    ).toEqual(expect.arrayContaining(["text-[13px]", "p-[13px]"]));
  });

  it("o script da página compila, roda num mundo isolado e alterna (liga/desliga)", () => {
    expect(() => new Function(inspector.inspectorSource())).not.toThrow();
    expect(inspector.INSPECTOR_WORLD).not.toBe(4131);
    expect(inspector.inspectorSource()).not.toMatch(/\.innerHTML\s*=/);
    expect(mainSource).toContain("executeJavaScriptInIsolatedWorld(\n        INSPECTOR_WORLD");
    expect(mainSource).toContain('"mod+shift+c"');
  });
});

const reader = load<{
  cleanArticle: (value: unknown) => {
    title: string;
    words: number;
    minutes: number;
    blocks: {
      kind: string;
      children?: { kind: string; href?: string; text: string }[];
      src?: string;
    }[];
  } | null;
  readerSource: () => string;
}>("reader.cjs");

describe("4.5: modo leitura", () => {
  it("só passa blocos conhecidos, links http(s) e imagens http(s)/data", () => {
    const article = reader.cleanArticle({
      title: "  Título  ",
      url: "https://blog.exemplo.com/post",
      blocks: [
        { kind: "heading", level: 1, children: [{ kind: "text", text: "Seção" }] },
        {
          kind: "paragraph",
          children: [
            { kind: "text", text: "Leia " },
            { kind: "link", text: "isto", href: "javascript:alert(1)" },
            { kind: "link", text: "aqui", href: "https://ok.com" },
            { kind: "script", text: "x" },
          ],
        },
        { kind: "image", src: "javascript:alert(1)", alt: "x" },
        { kind: "image", src: "https://img.com/a.png", alt: "a", caption: "legenda" },
        { kind: "iframe", src: "https://evil.com" },
        { kind: "list", ordered: true, items: [[{ kind: "text", text: "um dois" }], []] },
      ],
    })!;
    expect(article.title).toBe("Título");
    expect(article.blocks.map((block) => block.kind)).toEqual([
      "heading",
      "paragraph",
      "image",
      "list",
    ]);
    expect(article.blocks[0]).toMatchObject({ level: 2 });
    expect(article.blocks[1]!.children).toEqual([
      { kind: "text", text: "Leia " },
      { kind: "text", text: "isto" },
      { kind: "link", text: "aqui", href: "https://ok.com" },
      { kind: "text", text: "x" },
    ]);
    expect(article.blocks[2]!.src).toBe("https://img.com/a.png");
    expect(article.minutes).toBe(1);
    expect(reader.cleanArticle({ title: "x", blocks: [] })).toBeNull();
    expect(() => new Function(reader.readerSource())).not.toThrow();
  });
});

const scratch = load<{
  capturedOf: (
    params: object,
  ) => { method: string; url: string; headers: [string, string][]; body: string } | null;
  sanitizeRequest: (input: object) => {
    method?: string;
    url?: string;
    headers?: [string, string][];
    body?: string;
    error?: string;
  };
  sendRequest: (
    fetchFn: (
      url: string,
      init: { method: string; headers: [string, string][]; body?: string },
    ) => Promise<Response>,
    request: object,
    now?: () => number,
  ) => Promise<Record<string, unknown>>;
  createNetCapture: (deps: { emit: (owner: unknown, payload: object) => void }) => {
    start: (contents: object, options: { tabId: number; owner: unknown }) => { ok: boolean };
    stop: (contents: object) => void;
    requests: (contents: object) => object[];
  };
}>("scratchpad.cjs");

describe("4.5: API Scratchpad", () => {
  it("captura só http(s) de XHR/fetch/documento e guarda método, headers e body", () => {
    expect(
      scratch.capturedOf({
        requestId: "1.2",
        type: "Fetch",
        request: {
          method: "post",
          url: "https://api.x.com/leads",
          headers: { "content-type": "application/json" },
          postData: '{"a":1}',
        },
      }),
    ).toMatchObject({
      method: "POST",
      url: "https://api.x.com/leads",
      headers: [["content-type", "application/json"]],
      body: '{"a":1}',
    });
    expect(
      scratch.capturedOf({ type: "Image", request: { url: "https://x.com/a.png" } }),
    ).toBeNull();
    expect(
      scratch.capturedOf({ type: "XHR", request: { url: "chrome-extension://x/y" } }),
    ).toBeNull();
  });

  it("limpa a requisição: método conhecido, só http(s), sem Host/Content-Length e sem quebra de linha", () => {
    expect(scratch.sanitizeRequest({ method: "TRACE", url: "https://x.com" })).toEqual({
      error: "method",
    });
    expect(scratch.sanitizeRequest({ method: "GET", url: "file:///etc/passwd" })).toEqual({
      error: "url",
    });
    expect(
      scratch.sanitizeRequest({
        method: "get",
        url: "https://x.com/a",
        headers: [
          ["Host", "evil"],
          ["Content-Length", "9"],
          ["X-Ok", "1"],
          ["X-Bad", "a\r\nb"],
          [":authority", "x"],
        ],
        body: "ignorado no GET",
      }),
    ).toEqual({ method: "GET", url: "https://x.com/a", headers: [["X-Ok", "1"]], body: "" });
  });

  it("reenvia e resume a resposta (status, headers, corpo, tempo)", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response('{"ok":true}', {
          status: 201,
          statusText: "Created",
          headers: { "content-type": "application/json" },
        }),
    );
    let clock = 1000;
    const result = await scratch.sendRequest(
      fetchFn,
      {
        method: "POST",
        url: "https://api.x.com/leads",
        headers: [["Authorization", "Bearer t"]],
        body: "{}",
      },
      () => (clock += 25),
    );
    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.x.com/leads",
      expect.objectContaining({
        method: "POST",
        body: "{}",
        headers: [["Authorization", "Bearer t"]],
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      status: 201,
      statusText: "Created",
      body: '{"ok":true}',
      binary: false,
      ms: 25,
    });
    await expect(
      scratch.sendRequest(async () => Promise.reject(new Error("offline")), {
        url: "https://x.com",
      }),
    ).resolves.toMatchObject({ ok: false, error: "network" });
  });

  it("liga o Network no debugger da guia e repassa as requisições à janela", () => {
    const debuggerEmitter = Object.assign(new EventEmitter(), {
      isAttached: () => true,
      attach: vi.fn(),
      sendCommand: vi.fn(() => Promise.resolve()),
    });
    const contents = Object.assign(new EventEmitter(), {
      debugger: debuggerEmitter,
      isDestroyed: () => false,
    });
    const emit = vi.fn();
    const capture = scratch.createNetCapture({ emit });
    expect(capture.start(contents, { tabId: 3, owner: "janela" })).toMatchObject({ ok: true });
    expect(debuggerEmitter.sendCommand).toHaveBeenCalledWith("Network.enable", expect.any(Object));
    debuggerEmitter.emit("message", {}, "Network.requestWillBeSent", {
      requestId: "9",
      type: "XHR",
      request: { method: "GET", url: "https://x.com/api", headers: {} },
    });
    debuggerEmitter.emit("message", {}, "Network.responseReceived", {
      requestId: "9",
      response: { status: 200 },
    });
    expect(capture.requests(contents)).toHaveLength(1);
    expect(emit).toHaveBeenCalledWith(
      "janela",
      expect.objectContaining({ tabId: 3, type: "request" }),
    );
    expect(emit).toHaveBeenCalledWith("janela", { tabId: 3, type: "status", id: "9", status: 200 });
    capture.stop(contents);
    expect(debuggerEmitter.sendCommand).toHaveBeenCalledWith("Network.disable");
    expect(debuggerEmitter.listenerCount("message")).toBe(0);
  });

  it("editor: headers em texto e de volta, JSON bonito, URL curta", () => {
    const headers: [string, string][] = [
      ["Content-Type", "application/json"],
      ["X-Id", "a:b"],
    ];
    expect(textToHeaders(headersToText(headers))).toEqual(headers);
    expect(textToHeaders("# comentário\n:authority: x\nsem dois pontos\nA: 1")).toEqual([
      ["A", "1"],
    ]);
    expect(prettyBody('{"a":[1]}', "application/json")).toBe('{\n  "a": [\n    1\n  ]\n}');
    expect(prettyBody("<p>", "text/html")).toBe("<p>");
    expect(shortUrl("https://x.com/api?q=1", "https://x.com/")).toBe("/api?q=1");
    expect(shortUrl("https://cdn.y.com/a", "https://x.com/")).toBe("cdn.y.com/a");
    expect(
      editorOf({
        id: "1",
        method: "POST",
        url: "https://x.com",
        headers: [
          [":method", "POST"],
          ["A", "1"],
        ],
        body: "b",
        type: "XHR",
        at: 0,
        status: null,
      }),
    ).toEqual({ method: "POST", url: "https://x.com", headers: [["A", "1"]], body: "b" });
  });
});

/** Zip mínimo (sem CRC, que o leitor não confere) para os testes do .crx. */
function makeZip(files: { name: string; data: Buffer }[]) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const compressed = zlib.deflateRawSync(file.data);
    const name = Buffer.from(file.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, compressed);
    centrals.push(central, name);
    offset += 30 + name.length + compressed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** CRX3: "Cr24", versão 3, tamanho do cabeçalho protobuf (com a chave pública) e o zip. */
function makeCrx(zip: Buffer, publicKey: Buffer) {
  const keyField = Buffer.concat([Buffer.from([0x0a, publicKey.length]), publicKey]);
  const proof = Buffer.concat([Buffer.from([0x12, keyField.length]), keyField]);
  const head = Buffer.alloc(12);
  head.write("Cr24", 0, "latin1");
  head.writeUInt32LE(3, 4);
  head.writeUInt32LE(proof.length, 8);
  return Buffer.concat([head, proof, zip]);
}

const crx = load<{
  storeIdOf: (value: string) => string | null;
  crxDownloadUrl: (id: string, version: string) => string;
  parseCrx: (buffer: Buffer) => { zip: Buffer; publicKey: string | null };
  unzip: (buffer: Buffer) => { name: string; data: Buffer }[];
  safeEntryName: (name: string) => string | null;
}>("crx.cjs");
const STORE_ID = "cjpalhdlnbpafiamejdnhcphjbkeiagm";

describe("4.5: extensões (Chrome Web Store e descompactadas)", () => {
  it("id da loja a partir do link ou do próprio id; URL do .crx", () => {
    expect(
      crx.storeIdOf(`https://chromewebstore.google.com/detail/ublock-origin/${STORE_ID}`),
    ).toBe(STORE_ID);
    expect(crx.storeIdOf(STORE_ID)).toBe(STORE_ID);
    expect(crx.storeIdOf("https://example.com")).toBeNull();
    expect(crx.crxDownloadUrl(STORE_ID, "140.0.0.0")).toContain(`x=id%3D${STORE_ID}%26uc`);
  });

  it("CRX3 vira zip + chave pública; o zip descompacta e recusa caminho para fora", () => {
    const zip = makeZip([
      {
        name: "manifest.json",
        data: Buffer.from('{"manifest_version":3,"name":"X","version":"1"}'),
      },
      { name: "js/a.js", data: Buffer.from("console.log(1)") },
    ]);
    const parsed = crx.parseCrx(makeCrx(zip, Buffer.from("chave-publica")));
    expect(parsed.publicKey).toBe(Buffer.from("chave-publica").toString("base64"));
    const files = crx.unzip(parsed.zip);
    expect(files.map((file) => file.name)).toEqual(["manifest.json", "js/a.js"]);
    expect(files[1]!.data.toString()).toBe("console.log(1)");
    expect(() => crx.unzip(makeZip([{ name: "../fora.js", data: Buffer.from("x") }]))).toThrow(
      "zip-path",
    );
    expect(crx.safeEntryName("C:/x")).toBeNull();
    expect(crx.safeEntryName("a/./b.js")).toBe("a/b.js");
    expect(() => crx.parseCrx(Buffer.from("PK nada"))).toThrow();
  });

  it("carrega MV3 descompactada, recusa MV2, liga/desliga e remove; loja vira pasta própria", async () => {
    const { createExtensions, readManifest } = load<{
      createExtensions: (deps: object) => {
        loadAll: () => Promise<void>;
        addUnpacked: (dir: string) => Promise<{ ok: boolean; error?: string; id?: string }>;
        installFromStore: (input: string) => Promise<{ ok: boolean; error?: string }>;
        setEnabled: (dir: string, enabled: boolean) => Promise<{ ok: boolean }>;
        remove: (dir: string) => { ok: boolean };
        list: () => {
          dir: string;
          name: string;
          enabled: boolean;
          loaded: boolean;
          source: string;
          popup: string | null;
        }[];
        isExtensionUrl: (url: string) => boolean;
      };
      readManifest: (dir: string, fs: object) => { name?: string; error?: string };
    }>("extensions.cjs");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agzos-ext-"));
    const mv3 = path.join(root, "mv3");
    const mv2 = path.join(root, "mv2");
    fs.mkdirSync(path.join(mv3, "_locales", "pt_BR"), { recursive: true });
    fs.mkdirSync(mv2);
    fs.writeFileSync(
      path.join(mv3, "manifest.json"),
      JSON.stringify({
        manifest_version: 3,
        name: "__MSG_nome__",
        version: "1.2",
        default_locale: "pt_BR",
        action: { default_popup: "popup.html" },
      }),
    );
    fs.writeFileSync(
      path.join(mv3, "_locales", "pt_BR", "messages.json"),
      JSON.stringify({ nome: { message: "Minha Extensão" } }),
    );
    fs.writeFileSync(
      path.join(mv2, "manifest.json"),
      JSON.stringify({ manifest_version: 2, name: "Velha", version: "1" }),
    );
    expect(readManifest(mv3, fs)).toMatchObject({ name: "Minha Extensão" });
    expect(readManifest(mv2, fs)).toEqual({ error: "mv2" });

    const loaded = new Map<string, string>();
    const ses = {
      extensions: {
        loadExtension: vi.fn(async (dir: string) => {
          const id = dir.endsWith(STORE_ID) ? STORE_ID : "abcdefghijklmnopabcdefghijklmnop";
          loaded.set(id, dir);
          return { id };
        }),
        removeExtension: vi.fn((id: string) => loaded.delete(id)),
        getExtension: (id: string) => (loaded.has(id) ? { id } : null),
      },
    };
    let saved: unknown = [];
    const zip = makeZip([
      {
        name: "manifest.json",
        data: Buffer.from('{"manifest_version":3,"name":"Loja","version":"3"}'),
      },
    ]);
    const extensions = createExtensions({
      ses,
      fs,
      store: { get: () => saved, set: (list: unknown) => (saved = list) },
      download: async () => makeCrx(zip, Buffer.from("k")),
      extensionsDir: path.join(root, "Extensions"),
      chromeVersion: "140.0.0.0",
    });
    await expect(extensions.addUnpacked(mv2)).resolves.toEqual({ ok: false, error: "mv2" });
    await expect(extensions.addUnpacked(mv3)).resolves.toMatchObject({ ok: true });
    expect(extensions.list()[0]).toMatchObject({
      name: "Minha Extensão",
      enabled: true,
      loaded: true,
      popup: "chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html",
    });
    expect(
      extensions.isExtensionUrl("chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html"),
    ).toBe(true);
    await extensions.setEnabled(mv3, false);
    expect(extensions.list()[0]).toMatchObject({ enabled: false, loaded: false });
    await expect(
      extensions.installFromStore(`https://chromewebstore.google.com/detail/x/${STORE_ID}`),
    ).resolves.toMatchObject({ ok: true });
    const storeDir = path.join(root, "Extensions", STORE_ID);
    expect(JSON.parse(fs.readFileSync(path.join(storeDir, "manifest.json"), "utf8")).key).toBe(
      Buffer.from("k").toString("base64"),
    );
    expect((saved as unknown[]).length).toBe(2);
    extensions.remove(storeDir);
    expect(fs.existsSync(storeDir)).toBe(false);
    // A pasta descompactada é do usuário: remover da lista não apaga.
    extensions.remove(mv3);
    expect(fs.existsSync(mv3)).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("main: extensões só na sessão padrão; popup abre em guia; Widevine pelo components da castLabs", () => {
    expect(mainSource).toContain("ses: session.defaultSession");
    expect(mainSource).toContain("Boolean(extensions?.isExtensionUrl(url))");
    expect(mainSource).toContain('require("electron").components ?? null');
    const build = fs.readFileSync(path.join(process.cwd(), "scripts", "build-all.sh"), "utf8");
    expect(build).toContain("wvcus");
  });
});

const capture = load<{
  captureFileName: (date: Date) => string;
  imageFileName: (url: string, mime?: string) => string;
  isPngDataUrl: (value: unknown) => boolean;
}>("capture.cjs");

describe("4.5: captura de tela e imagem já carregada", () => {
  it("nomes de arquivo válidos no Windows e extensão pelo tipo", () => {
    expect(capture.captureFileName(new Date(2026, 9, 3, 14, 5, 9))).toBe(
      "Captura 2026-10-03 às 14.05.09.png",
    );
    expect(capture.imageFileName("https://cdn.x.com/fotos/praia.jpeg?w=800", "image/jpeg")).toBe(
      "praia.jpeg",
    );
    expect(capture.imageFileName("https://cdn.x.com/img/abc", "image/webp")).toBe("abc.webp");
    expect(capture.imageFileName("https://cdn.x.com/a.png", "image/avif")).toBe("a.avif");
    expect(capture.imageFileName("https://cdn.x.com/a:b*c?.gif", "")).toBe("a_b_c.png");
    expect(capture.imageFileName("data:image/png;base64,AAAA", "image/png")).toBe("imagem.png");
  });

  it("só aceita PNG em base64 vindo da casca", () => {
    expect(capture.isPngDataUrl("data:image/png;base64,iVBORw0KGgo=")).toBe(true);
    expect(capture.isPngDataUrl("data:image/jpeg;base64,AAAA")).toBe(false);
    expect(capture.isPngDataUrl("data:image/png;base64,<script>")).toBe(false);
    expect(capture.isPngDataUrl(42)).toBe(false);
  });

  it("região arrastada vira retângulo na imagem; clique não conta; escala HiDPI", () => {
    expect(regionOf({ x: 300, y: 200 }, { x: 100, y: 50 }, { width: 1000, height: 800 })).toEqual({
      x: 100,
      y: 50,
      width: 200,
      height: 150,
    });
    expect(regionOf({ x: 10, y: 10 }, { x: 12, y: 11 }, { width: 100, height: 100 })).toBeNull();
    expect(regionOf({ x: -50, y: 0 }, { x: 5000, y: 50 }, { width: 640, height: 480 })).toEqual({
      x: 0,
      y: 0,
      width: 640,
      height: 50,
    });
    expect(layerScale({ dataUrl: "", x: 0, y: 0, width: 1280, height: 800 }, 2560)).toBe(2);
  });

  it("main: imagem sai do recurso já carregado (CDP), captura só da janela do app", () => {
    expect(mainSource).toContain('"Page.getResourceContent"');
    expect(mainSource).toContain('label: "Salvar imagem já carregada…"');
    expect(mainSource).toContain('ipcMain.handle("capture:take"');
    expect(mainSource).not.toContain("desktopCapturer");
  });
});

const sessionTabs = load<{
  sessionIdsOf: (records: unknown) => Set<string>;
  orphanPartitionDirs: (names: string[], keep: Set<string>) => string[];
}>("session-tabs.cjs");

const tab = (id: number, extra: Partial<Tab> = {}): Tab => ({
  id,
  history: [{ title: "x", url: "https://app.leadmobi.com/", kind: "page" }],
  index: 0,
  ...extra,
});

describe("4.5: Session Tabs (sessões isoladas)", () => {
  it("cada Session Tab ganha uma cor livre; depois volta a usar a menos usada", () => {
    const first = newTabSession([], "s-1");
    expect(first).toEqual({ id: "s-1", color: SESSION_TAB_COLORS[0] });
    const second = newTabSession([{ session: first }], "s-2");
    expect(second.color).toBe(SESSION_TAB_COLORS[1]);
    const all = SESSION_TAB_COLORS.map((color, index) => ({ session: { id: `s${index}`, color } }));
    expect(newTabSession(all, "s-9").color).toBe(SESSION_TAB_COLORS[0]);
  });

  it("três Session Tabs do mesmo site ficam cada uma na sua sessão; links e duplicata herdam", () => {
    let state = { ...initialState, hydrated: true };
    for (const id of ["admin-0001", "corretor-1", "cliente-01"]) {
      state = browserReducer(state, {
        type: "tab/new",
        session: newTabSession(state.tabs, id),
      });
    }
    const sessions = state.tabs.filter((item) => item.session).map((item) => item.session!.id);
    expect(sessions).toEqual(["admin-0001", "corretor-1", "cliente-01"]);
    const admin = state.tabs.find((item) => item.session?.id === "admin-0001")!;
    state = browserReducer(state, {
      type: "tab/open-page",
      entry: { title: "x", url: "https://app.leadmobi.com/leads", kind: "page" },
      from: admin.id,
    });
    expect(state.tabs.at(-1)!.session?.id).toBe("admin-0001");
    state = browserReducer(state, { type: "tab/duplicate", id: admin.id });
    expect(state.tabs.find((item) => item.id === state.activeId)!.session?.id).toBe("admin-0001");
    // Link de guia normal abre guia normal; de guia anônima, anônima.
    const normal = state.tabs.find((item) => !item.session)!;
    state = browserReducer(state, {
      type: "tab/open-page",
      entry: { title: "y", url: "https://y.com", kind: "page" },
      from: normal.id,
    });
    expect(state.tabs.at(-1)!.session).toBeUndefined();
    state = browserReducer(state, { type: "tab/new", private: true });
    const anon = state.tabs.at(-1)!;
    state = browserReducer(state, {
      type: "tab/open-page",
      entry: { title: "z", url: "https://z.com", kind: "page" },
      from: anon.id,
    });
    expect(state.tabs.at(-1)!.private).toBe(true);
  });

  it("a sessão vai para o disco e volta validada", () => {
    const parsed = parseTabs([
      tab(1, { session: { id: "abc-1234", color: "#2563EB" } }),
      { ...tab(2), session: { id: "../../x", color: "#2563EB" } },
      { ...tab(3), session: { id: "abcd-123", color: "red;}" } },
    ]);
    expect(parsed.map((item) => item.session)).toEqual([
      { id: "abc-1234", color: "#2563EB" },
      undefined,
      undefined,
    ]);
  });

  it("partições de Session Tabs fechadas somem na abertura; as em uso ficam", () => {
    const keep = sessionTabs.sessionIdsOf([
      { session: { tabs: [{ session: { id: "abc-1234" } }, { id: 2 }] } },
      { session: null },
    ]);
    expect([...keep]).toEqual(["abc-1234"]);
    expect(
      sessionTabs.orphanPartitionDirs(
        [
          "agzos-session-abc-1234",
          "agzos-session-velha-99",
          "agzos-anonima",
          "Default",
          "agzos-session-..",
        ],
        keep,
      ),
    ).toEqual(["agzos-session-velha-99"]);
  });

  it("main: partição persistente própria; Ctrl+Alt+N abre uma", () => {
    expect(mainSource).toContain('const SESSION_PARTITION_PREFIX = "persist:agzos-session-"');
    expect(mainSource).toContain("partition: tabPartition(options)");
    expect(mainSource).toContain('"mod+alt+n"');
    const command = commandById("tab.new-session")!;
    expect(command.shortcuts).toEqual([{ key: "n", alt: true }]);
    const dispatch = vi.fn();
    command.run(
      {
        state: initialState,
        dispatch,
        desktop: {} as CommandContext["desktop"],
        ui: { focusOmnibox: vi.fn() } as unknown as CommandContext["ui"],
      },
      initialState.activeId,
      "keyboard",
    );
    const action = dispatch.mock.calls[0]![0];
    expect(action.type).toBe("tab/new");
    expect(action.session.id).toMatch(/^[a-z0-9-]{4,40}$/);
  });
});

describe("4.5: notas por página", () => {
  it("chave: origem, caminho e busca, sem o #; nova aba não tem nota", () => {
    expect(noteKeyOf("https://x.com/a?b=1#c")).toBe("https://x.com/a?b=1");
    expect(noteKeyOf("agzos://historico")).toBe("agzos://historico");
    expect(noteKeyOf("javascript:alert(1)")).toBeNull();
    expect(noteKeyOf("nada")).toBeNull();
  });

  it("grava, atualiza, apaga com texto vazio e valida o que vem do disco", () => {
    let state = { ...initialState, hydrated: true };
    state = browserReducer(state, {
      type: "notes/set",
      key: "https://x.com/a",
      url: "https://x.com/a#topo",
      title: "A",
      text: "# Ideia\n- um",
      now: 5,
    });
    expect(state.notes["https://x.com/a"]).toEqual({
      url: "https://x.com/a#topo",
      title: "A",
      text: "# Ideia\n- um",
      updatedAt: 5,
    });
    expect(parseNotes(JSON.parse(JSON.stringify(state.notes)))).toEqual(state.notes);
    state = browserReducer(state, {
      type: "notes/set",
      key: "https://x.com/a",
      url: "https://x.com/a",
      title: "A",
      text: "   ",
      now: 6,
    });
    expect(state.notes).toEqual({});
    expect(
      parseNotes({
        "https://y.com/": { url: "https://outra.com/", text: "x", title: "t", updatedAt: 1 },
        "https://z.com/": { url: "https://z.com/", text: "", title: "t", updatedAt: 1 },
        lixo: 3,
      }),
    ).toEqual({});
    const notes = {
      "https://a.com/": { url: "https://a.com/", title: "Leads", text: "supabase", updatedAt: 1 },
      "https://b.com/": { url: "https://b.com/", title: "Outra", text: "nada", updatedAt: 2 },
    };
    expect(otherNotes(notes, "https://b.com/", "").map(([key]) => key)).toEqual(["https://a.com/"]);
    expect(otherNotes(notes, null, "SUPA").map(([key]) => key)).toEqual(["https://a.com/"]);
  });
});

describe("4.5: temas e painel lateral", () => {
  it("escuro é o padrão; acento padrão #D10A11; o vermelho antigo migra", () => {
    expect(initialState.prefs.dark).toBe(true);
    expect(initialState.prefs.accentColor).toBe("#D10A11");
    expect(parsePrefs({ accentColor: "#D43420" }).accentColor).toBe("#D10A11");
    expect(parsePrefs({ accentColor: "#2563EB" }).accentColor).toBe("#2563EB");
    expect(parsePrefs({ accentColor: "url(x)" }).accentColor).toBe("#D10A11");
    expect(parsePrefs({ dark: false }).dark).toBe(false);
    expect(parsePrefs({ readerFontSize: 99 }).readerFontSize).toBe(26);
  });

  it("expandir esconde as guias atrás do painel; recolher/fechar volta (uma superfície só)", () => {
    expect(mainSource).toContain("!(ctx.sidePanelExpanded && ctx.sidePanel)");
    expect(mainSource).toContain('ipcMain.handle("sidepanel:expand"');
    const hide = mainSource.slice(mainSource.indexOf('ipcMain.handle("sidepanel:hide"'));
    expect(hide.slice(0, 600)).toContain("ctx.sidePanelExpanded = false;");
  });

  it("modo leitura cobre a guia sem descarregar a página", () => {
    expect(mainSource).toContain("!ctx.covered.has(id)");
    expect(mainSource).toContain('ipcMain.handle("tab:cover"');
  });

  it("todo comando novo com atalho tem o atalho repassado pelo main", () => {
    for (const id of [
      "page.inspect",
      "page.capture",
      "page.reader",
      "notes.toggle",
      "tab.new-session",
    ]) {
      expect(commands.some((command) => command.id === id)).toBe(true);
    }
    for (const combo of ['"mod+shift+c"', '"mod+shift+s"', '"mod+alt+r"', '"mod+shift+m"']) {
      expect(mainSource).toContain(combo);
    }
  });
});

describe("4.5: painel de portas (casca)", () => {
  const list: PortInfo[] = [
    {
      port: 3000,
      pid: 4242,
      pids: [4242],
      name: "node",
      addresses: ["::"],
      local: false,
      project: { name: "leadmobi", dir: "/x" },
      self: false,
    },
    {
      port: 5432,
      pid: 88,
      pids: [88],
      name: "postgres",
      addresses: ["127.0.0.1"],
      local: true,
      project: null,
      self: false,
    },
  ];
  it("filtra por porta (com ou sem :), processo, PID e projeto", () => {
    expect(filterPorts(list, ":3000").map((item) => item.port)).toEqual([3000]);
    expect(filterPorts(list, "postgres").map((item) => item.port)).toEqual([5432]);
    expect(filterPorts(list, "leadmobi").map((item) => item.port)).toEqual([3000]);
    expect(filterPorts(list, "88").map((item) => item.port)).toEqual([5432]);
    expect(filterPorts(list, "")).toHaveLength(2);
    expect(killErrorText("permission")).toMatch(/outro usuário/);
    expect(tunnelErrorText("missing")).toMatch(/cloudflared/);
  });
});

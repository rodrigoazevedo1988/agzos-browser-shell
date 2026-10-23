/**
 * yt-dlp 5.0.3: cadeia de novas tentativas, plano de mídia da página, atualização do binário,
 * prova do runtime de JS e diagnóstico. As funções puras são testadas direto; o serviço recebe
 * processos falsos (uma criança por tentativa) e, numa vez, um script de shell de verdade.
 */
import { EventEmitter } from "node:events";
import { spawn as realSpawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);

type Ytdlp = {
  attemptOptionsOf: (
    applied: string[],
    options: { quality?: string; ffmpeg?: boolean; referer?: string; userAgent?: string },
  ) => {
    extraArgs: string[];
    format: string[] | null;
    referer: string | null;
    userAgent: string | null;
    impersonate: boolean;
    cookies: boolean;
  };
  buildArgs: (options: Record<string, unknown>) => string[] | null;
  classifyError: (
    text: string,
    host?: string,
  ) => {
    terminal: string | null;
    unsupported: boolean;
    yt: boolean;
    ytSpecific: boolean;
    format: boolean;
  };
  createMediaLog: () => {
    note: (id: number, url: string, contentType?: string, at?: number) => boolean;
    noteResponse: (details: Record<string, unknown>, at?: number) => boolean;
    list: (id: number) => { url: string; kind: string }[];
  };
  createYtdlpService: (options: Record<string, unknown>) => Service;
  diagnosticsText: (report: Record<string, unknown>) => string;
  execCapture: (execFile: unknown) => unknown;
  fallbackFormatOf: (quality: string, ffmpeg: boolean) => string[] | null;
  friendlyError: (message: string) => string;
  hasImpersonateTarget: (text: string, name?: string) => boolean;
  headerValueOf: (headers: Record<string, string[]>, name: string) => string;
  isNodeVersionOutput: (text: string) => boolean;
  isStaleVersion: (version: string | null, now: number, days?: number) => boolean;
  mediaKind: (url: string, contentType?: string) => string | null;
  needsUpdate: (installed: string | null, latest: string | null) => boolean;
  nextAttempt: (state: Record<string, unknown>) => { id: string; label: string } | null;
  parseVersion: (text: string) => string | null;
  rankMediaCandidates: (
    entries: Record<string, unknown>[],
    options?: { pageUrl?: string; max?: number },
  ) => { url: string; kind: string }[];
  redactLine: (line: string) => string;
  shouldCheckRelease: (state: {
    managed: boolean;
    checkedAt: unknown;
    now: number;
    intervalMs?: number;
  }) => boolean;
  tagOf: (json: string) => string | null;
  versionAgeDays: (version: string | null, now: number) => number | null;
  MEDIA_PROBE_SOURCE: string;
  MAX_ATTEMPTS: number;
  LOG_LINES: number;
};

type Service = {
  status: () => Promise<{ stale: boolean; version: string | null; managed: boolean }>;
  install: (options?: { prefer?: boolean }) => Promise<{ ok: boolean; path?: string }>;
  probeRuntime: () => Promise<string | null>;
  nodeRuntime: () => string | null;
  start: (
    options: Record<string, unknown>,
  ) => Promise<{ ok: boolean; id?: number; error?: string }>;
  cancel: (id: number) => boolean;
  details: (id: number) => string | null;
  stopAll: () => void;
};

const ytdlp = require("../../../electron/ytdlp.cjs") as Ytdlp;
const DAY = 24 * 60 * 60 * 1000;
const YT_URL = "https://www.youtube.com/watch?v=abc";
const BOT = "ERROR: [youtube] abc: Sign in to confirm you’re not a bot";
const NOW = Date.UTC(2026, 9, 23);

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    pid: number | undefined;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = undefined;
  child.kill = vi.fn();
  return child;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeDownloads() {
  const handles: {
    id: number;
    update: ReturnType<typeof vi.fn>;
    finish: ReturnType<typeof vi.fn>;
  }[] = [];
  return {
    handles,
    startExternal: vi.fn(() => {
      const handle = { id: handles.length + 1, update: vi.fn(), finish: vi.fn() };
      handles.push(handle);
      return handle;
    }),
  };
}

/** Serviço com N crianças falsas (uma por tentativa), binário e pasta de destino. */
function setup(extra: Record<string, unknown> = {}, children = 4) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agzos-ytdlp-chain-"));
  const videos = path.join(dir, "Videos");
  const bin = path.join(dir, "fake-yt-dlp");
  fs.writeFileSync(bin, "");
  const kids = Array.from({ length: children }, () => fakeChild());
  let spawned = 0;
  const spawn = vi.fn(() => kids[spawned++]!);
  const downloads = fakeDownloads();
  const emit = vi.fn();
  const meta = new Map<string, unknown>([["ytdlpPath", bin]]);
  const service = ytdlp.createYtdlpService({
    spawn,
    execFile: vi.fn(),
    userDataDir: () => dir,
    platform: "linux",
    arch: "x64",
    env: { PATH: "" },
    getMeta: (key: string) => meta.get(key) ?? null,
    setMeta: (key: string, value: unknown) => meta.set(key, value),
    downloads,
    routeFor: () => ({ dir: videos, tags: [] }),
    emit,
    isExecutable: (file: string) => file === bin,
    now: () => NOW,
    ...extra,
  }) as Service;
  return { dir, videos, bin, kids, spawn, downloads, emit, service, meta };
}

const argsOf = (spawn: { mock: { calls: unknown[][] } }, index: number) =>
  spawn.mock.calls[index]![1] as string[];

describe("yt-dlp 5.0.3: cadeia de tentativas (planejamento)", () => {
  it("YouTube: clientes, sem cookies, formato; depois o limite de 4 tentativas", () => {
    const base = { host: "www.youtube.com", video: true };
    const first = ytdlp.nextAttempt({
      ...base,
      text: BOT,
      applied: [],
      attempts: 1,
      cookies: true,
    });
    expect(first?.id).toBe("yt-clients");
    const second = ytdlp.nextAttempt({
      ...base,
      text: BOT,
      applied: ["yt-clients"],
      attempts: 2,
      cookies: true,
    });
    expect(second?.id).toBe("no-cookies");
    const third = ytdlp.nextAttempt({
      ...base,
      text: BOT,
      applied: ["yt-clients", "no-cookies"],
      attempts: 3,
      cookies: false,
    });
    expect(third?.id).toBe("format");
    expect(
      ytdlp.nextAttempt({
        ...base,
        text: BOT,
        applied: ["yt-clients", "no-cookies", "format"],
        attempts: 4,
        cookies: false,
      }),
    ).toBeNull();
    expect(ytdlp.MAX_ATTEMPTS).toBe(4);
  });

  it("outro site: Referer/UA/impersonação primeiro; sem cookies não há passo de cookies", () => {
    const next = ytdlp.nextAttempt({
      text: "ERROR: [TikTok] unavailable",
      host: "tiktok.com",
      applied: [],
      attempts: 1,
      cookies: false,
      video: true,
    });
    expect(next?.id).toBe("site-headers");
    expect(
      ytdlp.nextAttempt({
        text: "ERROR: [TikTok] unavailable",
        host: "tiktok.com",
        applied: ["site-headers", "format"],
        attempts: 3,
        cookies: false,
        video: true,
      }),
    ).toBeNull();
  });

  it("erros que nenhuma tentativa resolve não geram nova tentativa", () => {
    const terminal = [
      "ERROR: [drm] This video is DRM protected",
      "ERROR: [x] The uploader has not made this video available in your country",
      "ERROR: [youtube] abc: This live event will begin in 2 hours",
      "ERROR: [youtube] abc: Private video. Sign in if you've been granted access",
      "ERROR: [x] HTTP Error 429: Too Many Requests",
    ];
    for (const text of terminal) {
      expect(
        ytdlp.nextAttempt({ text, host: "youtube.com", applied: [], attempts: 1, video: true }),
      ).toBeNull();
    }
  });

  it("Unsupported URL: o plano de mídia da página entra uma vez", () => {
    const text = "ERROR: Unsupported URL: https://site.example/player";
    expect(
      ytdlp.nextAttempt({ text, host: "site.example", applied: [], attempts: 1, video: true })?.id,
    ).toBe("media");
    expect(
      ytdlp.nextAttempt({
        text,
        host: "site.example",
        applied: ["media"],
        attempts: 2,
        video: true,
      }),
    ).toBeNull();
  });

  it("opções acumulam os passos; formato de fallback por qualidade", () => {
    const opts = ytdlp.attemptOptionsOf(["yt-clients", "no-cookies", "format"], {
      quality: "best",
      ffmpeg: true,
    });
    expect(opts.extraArgs).toEqual([
      "--extractor-args",
      "youtube:player_client=default,tv,web_safari,mweb,web_embedded",
    ]);
    expect(opts.cookies).toBe(false);
    expect(opts.format).toEqual(["-f", "b/bv*+ba/best", "--merge-output-format", "mp4"]);
    const site = ytdlp.attemptOptionsOf(["site-headers"], {
      quality: "720",
      ffmpeg: false,
      referer: "https://a.com/p",
      userAgent: "UA",
    });
    expect(site).toMatchObject({ referer: "https://a.com/p", userAgent: "UA", impersonate: true });
    expect(site.format).toBeNull();
    expect(ytdlp.fallbackFormatOf("720", true)?.[1]).toBe("b[height<=720]/bv*[height<=720]+ba/b");
    expect(ytdlp.fallbackFormatOf("720", false)).toEqual(["-f", "b"]);
    expect(ytdlp.fallbackFormatOf("audio-mp3", true)).toBeNull();
  });

  it("buildArgs põe os extras antes de --, e a URL continua por último", () => {
    const args = ytdlp.buildArgs({
      url: "https://a.com/v?x=1",
      outDir: "/tmp/v",
      quality: "best",
      ffmpeg: null,
      deno: true,
      jsRuntime: "/opt/a b/agzos",
      format: ["-f", "b/best"],
      extraArgs: ["--extractor-args", "youtube:x=y"],
      referer: "https://a.com/p",
      userAgent: "Mozilla/5.0 (X11) Chrome/146",
      impersonate: true,
    })!;
    expect(args.join(" ")).toContain("-f b/best --trim-filenames");
    expect(args.join(" ")).toContain("--js-runtimes deno --js-runtimes node:/opt/a b/agzos");
    expect(args).toContain("--impersonate");
    expect(args).toContain("Referer:https://a.com/p");
    expect(args).toContain("Mozilla/5.0 (X11) Chrome/146");
    expect(args.slice(-2)).toEqual(["--", "https://a.com/v?x=1"]);
    expect(args.indexOf("--extractor-args")).toBeLessThan(args.indexOf("--"));
  });

  it("classifyError: YouTube só pelo host ou pela tag [youtube]", () => {
    expect(ytdlp.classifyError(BOT, "m.youtube.com").yt).toBe(true);
    expect(ytdlp.classifyError("ERROR: [youtube] x: boom").yt).toBe(true);
    expect(ytdlp.classifyError("ERROR: [TikTok] boom", "tiktok.com").yt).toBe(false);
    expect(ytdlp.classifyError(BOT).ytSpecific).toBe(true);
  });
});

describe("yt-dlp 5.0.3: atualização, versões e runtime", () => {
  it("versão, tag do release e idade (60 dias para binário de usuário)", () => {
    expect(ytdlp.parseVersion("2026.08.19\n")).toBe("2026.08.19");
    expect(ytdlp.parseVersion("2026.10.22.232915")).toBe("2026.10.22.232915");
    expect(ytdlp.parseVersion("nada")).toBeNull();
    expect(ytdlp.tagOf(JSON.stringify({ tag_name: "2026.10.22" }))).toBe("2026.10.22");
    expect(ytdlp.tagOf("não é json")).toBeNull();
    expect(ytdlp.versionAgeDays("2026.08.19", NOW)).toBe(65);
    expect(ytdlp.isStaleVersion("2026.08.19", NOW)).toBe(true);
    expect(ytdlp.isStaleVersion("2026.09.01", NOW)).toBe(false);
    expect(ytdlp.isStaleVersion(null, NOW)).toBe(false);
  });

  it("checagem do release: no máximo uma vez por dia, só no gerenciado", () => {
    expect(ytdlp.shouldCheckRelease({ managed: true, checkedAt: null, now: NOW })).toBe(true);
    expect(ytdlp.shouldCheckRelease({ managed: true, checkedAt: NOW - 1000, now: NOW })).toBe(
      false,
    );
    expect(ytdlp.shouldCheckRelease({ managed: true, checkedAt: NOW - DAY, now: NOW })).toBe(true);
    expect(ytdlp.shouldCheckRelease({ managed: true, checkedAt: NOW + DAY, now: NOW })).toBe(true);
    expect(ytdlp.shouldCheckRelease({ managed: false, checkedAt: null, now: NOW })).toBe(false);
  });

  it("atualiza só com as duas versões conhecidas e diferentes", () => {
    expect(ytdlp.needsUpdate("2026.08.19", "2026.10.22")).toBe(true);
    expect(ytdlp.needsUpdate("2026.10.22", "2026.10.22")).toBe(false);
    expect(ytdlp.needsUpdate(null, "2026.10.22")).toBe(false);
    expect(ytdlp.needsUpdate("2026.08.19", null)).toBe(false);
  });

  it("prova do node: a saída de --version e o alvo chrome do curl_cffi", () => {
    expect(ytdlp.isNodeVersionOutput("v22.23.4\n")).toBe(true);
    expect(ytdlp.isNodeVersionOutput("Electron 44.0.0")).toBe(false);
    expect(ytdlp.isNodeVersionOutput("")).toBe(false);
    const list =
      "[info] Available impersonate targets\nClient  OS  Source\nChrome-133  Macos-15  curl_cffi\nSafari-18.0  Macos-15  curl_cffi\n";
    expect(ytdlp.hasImpersonateTarget(list)).toBe(true);
    expect(ytdlp.hasImpersonateTarget("Chrome-133  Macos-15  (unavailable)")).toBe(false);
    expect(ytdlp.hasImpersonateTarget("Safari-18.0  Macos-15  curl_cffi")).toBe(false);
  });

  it("serviço: versão de binário escolhido com mais de 60 dias é 'stale'; gerenciado não", async () => {
    const old = setup({
      capture: async () => ({ ok: true, stdout: "2026.08.19\n", stderr: "" }),
      isExecutable: () => true,
    });
    const status = await old.service.status();
    expect(status.version).toBe("2026.08.19");
    expect(status.stale).toBe(true);
    const managed = setup({
      capture: async () => ({ ok: true, stdout: "2026.08.19\n", stderr: "" }),
      isExecutable: () => true,
      getMeta: () => null,
    });
    const own = path.join(managed.dir, "bin", "yt-dlp");
    fs.mkdirSync(path.dirname(own), { recursive: true });
    fs.writeFileSync(own, "");
    const again = setup({
      capture: async () => ({ ok: true, stdout: "2026.08.19\n", stderr: "" }),
      isExecutable: (file: string) => file === own,
      getMeta: () => own,
      userDataDir: () => managed.dir,
    });
    expect((await again.service.status()).managed).toBe(true);
    expect((await again.service.status()).stale).toBe(false);
  });

  it("atualização: binário gerenciado com release novo baixa, confere o SHA-256 e troca o arquivo", async () => {
    const payload = Buffer.from("#!/bin/sh\necho novo\n");
    const sums = `${crypto.createHash("sha256").update(payload).digest("hex")}  yt-dlp_linux\n`;
    const fetchImpl = vi.fn(async (url: string) => {
      const body = url.endsWith("SHA2-256SUMS") ? Buffer.from(sums) : payload;
      return {
        ok: true,
        arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length),
      };
    });
    const latestTag = vi.fn(async () => "2026.10.22");
    const capture = vi.fn(async () => ({ ok: true, stdout: "2026.08.19\n", stderr: "" }));
    const { dir, service, meta } = setup({
      fetchImpl,
      latestTag,
      capture,
      isExecutable: () => true,
    });
    const managed = path.join(dir, "bin", "yt-dlp");
    fs.mkdirSync(path.dirname(managed), { recursive: true });
    fs.writeFileSync(managed, "antigo");
    meta.set("ytdlpPath", managed);
    // Primeiro download: checa, acha versão nova, baixa e troca.
    await service.start({ url: "https://vimeo.com/1", quality: "best" });
    expect(latestTag).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(managed)).toEqual(payload);
    expect(meta.get("ytdlpCheckedAt")).toBe(NOW);
    // Segundo download no mesmo dia: nada de checar de novo.
    await service.start({ url: "https://vimeo.com/2", quality: "best" });
    expect(latestTag).toHaveBeenCalledTimes(1);
    service.stopAll();
  });

  it("sem versão nova não baixa nada", async () => {
    const fetchImpl = vi.fn();
    const { dir, service, meta } = setup({
      fetchImpl,
      latestTag: async () => "2026.08.19",
      capture: async () => ({ ok: true, stdout: "2026.08.19\n", stderr: "" }),
      isExecutable: () => true,
    });
    const managed = path.join(dir, "bin", "yt-dlp");
    fs.mkdirSync(path.dirname(managed), { recursive: true });
    fs.writeFileSync(managed, "x");
    meta.set("ytdlpPath", managed);
    await service.start({ url: "https://vimeo.com/3", quality: "best" });
    expect(fetchImpl).not.toHaveBeenCalled();
    service.stopAll();
  });

  it("prova do Electron como node: uma vez por versão; falha tira o runtime", async () => {
    const capture = vi.fn(async () => ({ ok: true, stdout: "v22.23.4\n", stderr: "" }));
    const ok = setup({ jsRuntime: "/opt/Agzos Browser/agzos", probeKey: "44.0.0", capture });
    expect(await ok.service.probeRuntime()).toBe("/opt/Agzos Browser/agzos");
    expect(capture).toHaveBeenCalledWith(
      "/opt/Agzos Browser/agzos",
      ["--version"],
      expect.objectContaining({ env: expect.objectContaining({ ELECTRON_RUN_AS_NODE: "1" }) }),
    );
    expect(ok.meta.get("ytdlpNodeProbe")).toEqual({ key: "44.0.0", ok: true });
    // Mesma versão: a prova não roda de novo.
    const again = setup({ jsRuntime: "/opt/Agzos Browser/agzos", probeKey: "44.0.0", capture });
    again.meta.set("ytdlpNodeProbe", { key: "44.0.0", ok: true });
    await again.service.probeRuntime();
    expect(capture).toHaveBeenCalledTimes(1);

    const broken = setup({
      jsRuntime: "/opt/agzos",
      probeKey: "44.0.0",
      capture: async () => ({ ok: false, stdout: "", stderr: "" }),
    });
    expect(await broken.service.probeRuntime()).toBeNull();
    expect(broken.service.nodeRuntime()).toBeNull();
    expect(broken.meta.get("ytdlpNodeProbe")).toEqual({ key: "44.0.0", ok: false });
  });

  it("runtime caído: o download segue sem 'node:' (e com deno, se houver)", async () => {
    const { service, spawn } = setup({
      jsRuntime: "/opt/agzos",
      capture: async () => ({ ok: false, stdout: "", stderr: "" }),
    });
    await service.probeRuntime();
    await service.start({ url: YT_URL, quality: "best" });
    expect(argsOf(spawn, 0).join(" ")).not.toContain("node:");
    service.stopAll();
  });
});

describe("yt-dlp 5.0.3: mídia da página e candidatos", () => {
  it("tipo do recurso: manifesto e arquivo; segmentos e blob fora", () => {
    expect(ytdlp.mediaKind("https://a.com/x", "application/vnd.apple.mpegurl")).toBe("hls");
    expect(ytdlp.mediaKind("https://a.com/x", "application/dash+xml")).toBe("dash");
    expect(ytdlp.mediaKind("https://a.com/x.ts", "video/mp2t")).toBeNull();
    expect(ytdlp.mediaKind("https://a.com/seg.m4s", "video/mp4")).toBeNull();
    expect(ytdlp.mediaKind("https://a.com/x", "video/webm; codecs=vp9")).toBe("video");
    expect(ytdlp.mediaKind("https://a.com/clip.mp3")).toBe("audio");
    expect(ytdlp.mediaKind("https://a.com/pagina.html", "text/html")).toBeNull();
    expect(ytdlp.mediaKind("blob:https://a.com/1", "video/mp4")).toBeNull();
  });

  it("log por guia: o que é mídia, sem repetir o caminho, máximo de 30 e o mais novo primeiro", () => {
    const log = ytdlp.createMediaLog();
    expect(
      log.noteResponse({ webContentsId: 3, url: "https://a.com/seg1.ts", responseHeaders: {} }),
    ).toBe(false);
    log.noteResponse({
      webContentsId: 3,
      url: "https://a.com/m.m3u8?t=1",
      responseHeaders: { "Content-Type": ["application/vnd.apple.mpegurl"] },
    });
    log.noteResponse({ webContentsId: 3, url: "https://a.com/m.m3u8?t=2", responseHeaders: {} });
    expect(log.list(3)).toEqual([
      {
        url: "https://a.com/m.m3u8?t=2",
        kind: "hls",
        key: "https://a.com/m.m3u8",
        at: expect.any(Number),
      },
    ]);
    for (let i = 0; i < 40; i += 1) log.note(4, `https://a.com/v${i}.mp4`, "video/mp4");
    expect(log.list(4)).toHaveLength(30);
    expect(log.list(4)[0]!.url).toBe("https://a.com/v39.mp4");
    expect(log.note(-1, "https://a.com/v.mp4")).toBe(false);
    expect(log.note(5, "blob:https://a.com/x.mp4", "video/mp4")).toBe(false);
  });

  it("ranking: manifesto antes de arquivo, o que a página toca primeiro, sem blob, até 3", () => {
    const ranked = ytdlp.rankMediaCandidates(
      [
        { url: "https://a.com/v.mp4", source: "net" },
        { url: "https://cdn.a.com/x/master.m3u8", source: "net" },
        { url: "blob:https://a.com/1", source: "dom", playing: true },
        { url: "https://a.com/p.mp4", source: "dom", playing: true },
        { url: "https://other.net/q.webm", source: "net" },
        { url: "https://other.net/z.mp3", source: "net" },
      ],
      { pageUrl: "https://a.com/watch" },
    );
    expect(ranked.map((item) => item.url)).toEqual([
      "https://cdn.a.com/x/master.m3u8",
      "https://a.com/p.mp4",
      "https://a.com/v.mp4",
    ]);
    expect(
      ytdlp.rankMediaCandidates([{ url: "https://a.com/x.mp4", source: "net" }], { max: 1 }),
    ).toHaveLength(1);
    expect(ytdlp.rankMediaCandidates([{ url: "file:///etc/x.mp4", source: "net" }])).toEqual([]);
  });

  it("o trecho de leitura é só leitura (sem innerHTML, sem escrita)", () => {
    expect(ytdlp.MEDIA_PROBE_SOURCE).toContain("currentSrc");
    expect(ytdlp.MEDIA_PROBE_SOURCE).not.toMatch(
      /innerHTML|outerHTML|insertAdjacent|\.src\s*=|appendChild/,
    );
  });

  it("serviço: falha sem nada para tocar vira 'não reconhece o link'", async () => {
    const { kids, service, emit } = setup({ mediaFor: async () => [] });
    await service.start({ url: "https://site.example/player", tabId: 3, owner: {} });
    kids[0]!.stderr.emit(
      "data",
      Buffer.from("ERROR: Unsupported URL: https://site.example/player\n"),
    );
    kids[0]!.emit("close", 1);
    await flush();
    expect(emit).toHaveBeenCalledWith("agzos:ytdlp-error", {
      id: 1,
      message: "O yt-dlp não reconhece vídeo neste link.",
    });
    service.stopAll();
  });

  it("serviço: com mídia da página, a tentativa usa o melhor candidato com Referer e UA da guia", async () => {
    const owner = { id: "janela" };
    const mediaFor = vi.fn(async () => [
      { url: "https://a.com/clip.mp4", source: "dom", playing: false },
      { url: "https://cdn.a.com/hls/index.m3u8", source: "net" },
    ]);
    const tabAgentFor = vi.fn(() => ({
      userAgent: "Mozilla/5.0 (X11) Chrome/146 Safari/537.36",
      pageUrl: "https://a.com/watch",
    }));
    const { kids, spawn, service } = setup({ mediaFor, tabAgentFor });
    await service.start({ url: "https://a.com/watch", tabId: 9, owner });
    expect(tabAgentFor).toHaveBeenCalledWith(owner, 9);
    kids[0]!.stderr.emit("data", Buffer.from("ERROR: Unsupported URL: https://a.com/watch\n"));
    kids[0]!.emit("close", 1);
    await flush();
    expect(mediaFor).toHaveBeenCalledWith(owner, 9);
    const args = argsOf(spawn, 1);
    expect(args.at(-1)).toBe("https://cdn.a.com/hls/index.m3u8");
    expect(args).toContain("Referer:https://a.com/watch");
    expect(args).toContain("Mozilla/5.0 (X11) Chrome/146 Safari/537.36");
    service.stopAll();
  });
});

describe("yt-dlp 5.0.3: cadeia de tentativas (serviço)", () => {
  it("YouTube com bot check: clientes, depois sem cookies, depois formato; o cookie some no 'sem cookies'", async () => {
    const cookie = {
      domain: ".youtube.com",
      name: "SID",
      value: "SECRETVALUE",
      path: "/",
      secure: true,
    };
    const cookiesFor = vi.fn(async () => [cookie]);
    const { kids, spawn, service, downloads } = setup({ cookiesFor });
    await service.start({ url: YT_URL, tabId: 7, owner: {} });
    const cookieFile = (args: string[]) => args[args.indexOf("--cookies") + 1];
    const first = argsOf(spawn, 0);
    expect(first).not.toContain("--extractor-args");
    const file = cookieFile(first)!;
    expect(fs.existsSync(file)).toBe(true);

    kids[0]!.stderr.emit("data", Buffer.from(`${BOT}\n`));
    kids[0]!.emit("close", 1);
    await flush();
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(argsOf(spawn, 1)).toContain("--extractor-args");
    expect(argsOf(spawn, 1)).toContain("--cookies");

    kids[1]!.stderr.emit("data", Buffer.from(`${BOT}\n`));
    kids[1]!.emit("close", 1);
    await flush();
    expect(spawn).toHaveBeenCalledTimes(3);
    const third = argsOf(spawn, 2);
    expect(third).not.toContain("--cookies");
    expect(third).toContain("--extractor-args");
    expect(fs.existsSync(file)).toBe(false);

    kids[2]!.stderr.emit(
      "data",
      Buffer.from("ERROR: [youtube] abc: Requested format is not available\n"),
    );
    kids[2]!.emit("close", 1);
    await flush();
    expect(spawn).toHaveBeenCalledTimes(4);
    const fourth = argsOf(spawn, 3);
    expect(fourth[fourth.indexOf("-f") + 1]).toBe("b");

    kids[3]!.stderr.emit("data", Buffer.from(`${BOT}\n`));
    kids[3]!.emit("close", 1);
    await flush();
    expect(spawn).toHaveBeenCalledTimes(4);
    expect(downloads.handles[0]!.finish).toHaveBeenCalledWith("interrupted");
    // Diagnóstico: as quatro tentativas, nenhum valor de cookie.
    const report = service.details(1)!;
    expect(report).toContain("1. normal");
    expect(report).toContain("4. formato alternativo");
    expect(report).not.toContain("SECRETVALUE");
  });

  it("a segunda tentativa dá certo: download concluído com o arquivo que ela gravou", async () => {
    const { kids, videos, downloads, service } = setup({}, 2);
    fs.mkdirSync(videos, { recursive: true });
    const file = path.join(videos, "Titulo [abc].mp4");
    await service.start({ url: YT_URL, quality: "best" });
    kids[0]!.stderr.emit("data", Buffer.from(`${BOT}\n`));
    kids[0]!.emit("close", 1);
    await flush();
    fs.writeFileSync(file, "video");
    kids[1]!.stdout.emit("data", Buffer.from(`[download] Destination: ${file}\n`));
    kids[1]!.emit("close", 0);
    expect(downloads.handles[0]!.finish).toHaveBeenCalledWith("completed", file);
  });

  it("cancelar entre tentativas: nenhuma nova tentativa abre e o download fica cancelado", async () => {
    const { kids, spawn, downloads, service } = setup({});
    await service.start({ url: YT_URL, quality: "best" });
    kids[0]!.stderr.emit("data", Buffer.from(`${BOT}\n`));
    expect(service.cancel(1)).toBe(true);
    kids[0]!.emit("close", null);
    await flush();
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(downloads.handles[0]!.finish).toHaveBeenCalledWith("cancelled");
  });

  it("cabeçalho sensível na saída não entra no diagnóstico", async () => {
    const { kids, service } = setup({});
    await service.start({ url: "https://tiktok.com/@a/video/1", quality: "best" });
    kids[0]!.stderr.emit(
      "data",
      Buffer.from("Cookie: SID=SECRETVALUE\nERROR: [TikTok] unavailable\n"),
    );
    kids[0]!.emit("close", 1);
    await flush();
    // Diagnóstico só sai ao fim do download: cancela a segunda tentativa para fechar.
    service.stopAll();
    kids[1]!.emit("close", null);
    await flush();
    const report = service.details(1)!;
    expect(report).toContain("[linha omitida: cabeçalho sensível]");
    expect(report).not.toContain("SECRETVALUE");
  });

  it("primeira tentativa que não abre o processo não gera nova tentativa", async () => {
    const { kids, spawn, downloads, emit, service } = setup({});
    await service.start({ url: YT_URL, quality: "best" });
    kids[0]!.emit("error", new Error("ENOENT"));
    kids[0]!.emit("close", -1);
    await flush();
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(downloads.handles[0]!.finish).toHaveBeenCalledWith("interrupted");
    expect(emit).toHaveBeenCalled();
  });
});

describe("yt-dlp 5.0.3: mensagens e diagnóstico", () => {
  it("erros novos viram texto claro", () => {
    expect(ytdlp.friendlyError("ERROR: This video is DRM protected")).toBe(
      "Este vídeo tem DRM e não pode ser baixado.",
    );
    expect(
      ytdlp.friendlyError("The uploader has not made this video available in your country"),
    ).toMatch(/bloqueio regional/);
    expect(ytdlp.friendlyError("This live event will begin in 2 hours")).toMatch(
      /ainda não começou/,
    );
    expect(ytdlp.friendlyError("Sign in to confirm your age")).toMatch(/restrição de idade/);
    expect(ytdlp.friendlyError("Sign in to confirm you’re not a bot")).toMatch(
      /YouTube pediu login/,
    );
  });

  it("texto copiável: versão, sistema, tentativas e últimas linhas", () => {
    const text = ytdlp.diagnosticsText({
      when: "2026-10-23T00:00:00.000Z",
      version: "2026.10.22",
      origin: "instalado pelo Agzos",
      platform: "linux x64",
      electron: "44.0.0",
      runtime: "Electron como node",
      ffmpeg: true,
      host: "youtube.com",
      quality: "720",
      state: "interrupted",
      message: "O YouTube pediu login.",
      attempts: [{ label: "normal", exit: 1, error: "ERROR: [youtube] x: Sign in" }],
      lines: ["[youtube] x: Downloading webpage"],
    });
    expect(text).toContain("yt-dlp: 2026.10.22 (instalado pelo Agzos)");
    expect(text).toContain("Sistema: linux x64 · Electron 44.0.0");
    expect(text).toContain("1. normal → saída 1 · ERROR: [youtube] x: Sign in");
    expect(text).toContain("[youtube] x: Downloading webpage");
  });

  it("linha de saída: segredos saem, o resto fica", () => {
    expect(ytdlp.redactLine("Authorization: Bearer x")).toBe("[linha omitida: cabeçalho sensível]");
    expect(ytdlp.redactLine("GET https://a.com/v?token=abc&q=1")).toBe(
      "GET https://a.com/v?token=***&q=1",
    );
    expect(ytdlp.redactLine("[download] 10%")).toBe("[download] 10%");
  });

  it("cabeçalho de resposta: nome sem diferença de caixa", () => {
    expect(ytdlp.headerValueOf({ "CONTENT-TYPE": ["video/mp4"] }, "content-type")).toBe(
      "video/mp4",
    );
    expect(ytdlp.headerValueOf({}, "content-type")).toBe("");
  });

  it("execCapture: sem processo é falha, não exceção", async () => {
    const capture = ytdlp.execCapture(() => {
      throw new Error("sem binário");
    }) as (file: string, args: string[]) => Promise<{ ok: boolean }>;
    expect((await capture("/nada", ["--version"])).ok).toBe(false);
  });
});

describe("yt-dlp 5.0.3: script de shell no lugar do yt-dlp (processo de verdade)", () => {
  it.skipIf(process.platform === "win32")(
    "a primeira tentativa falha com erro de bot e a segunda grava o arquivo",
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agzos-ytdlp-real-"));
      const videos = path.join(dir, "Videos");
      fs.mkdirSync(videos, { recursive: true });
      const file = path.join(videos, "Titulo [abc].mp4");
      const bin = path.join(dir, "yt-dlp");
      // Primeira chamada: "Sign in to confirm you're not a bot". Segunda: grava o arquivo.
      // Cada chamada guarda o argv em args<N>.txt para o teste conferir.
      fs.writeFileSync(
        bin,
        [
          "#!/bin/sh",
          `DIR="${dir}"`,
          'N=$(cat "$DIR/count" 2>/dev/null || echo 0)',
          "N=$((N+1))",
          'echo $N > "$DIR/count"',
          'printf "%s\\n" "$@" > "$DIR/args$N.txt"',
          'if [ "$N" -eq 1 ]; then',
          `  echo "ERROR: [youtube] abc: Sign in to confirm you're not a bot" >&2`,
          "  exit 1",
          "fi",
          `echo "[download] Destination: ${file}"`,
          `echo video > "${file}"`,
          "exit 0",
          "",
        ].join("\n"),
        { mode: 0o755 },
      );
      fs.chmodSync(bin, 0o755);
      let finished: { state: string; file?: string | undefined } | null = null;
      const downloads = {
        startExternal: () => ({
          id: 1,
          update: () => {},
          finish: (state: string, file?: string) => {
            finished = { state, file };
          },
        }),
      };
      const service = ytdlp.createYtdlpService({
        spawn: realSpawn,
        execFile: () => {},
        userDataDir: () => dir,
        platform: "linux",
        arch: "x64",
        env: { PATH: process.env["PATH"] ?? "" },
        getMeta: () => bin,
        setMeta: () => {},
        downloads,
        routeFor: () => ({ dir: videos, tags: [] }),
        emit: () => {},
        isExecutable: (candidate: string) => candidate === bin,
      }) as Service;
      const result = await service.start({ url: YT_URL, quality: "best" });
      expect(result.ok).toBe(true);
      const deadline = Date.now() + 10000;
      while (!finished && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
      expect(finished).toEqual({ state: "completed", file });
      const second = fs.readFileSync(path.join(dir, "args2.txt"), "utf8");
      expect(second).toContain("--extractor-args");
      expect(second).toContain("youtube:player_client=default,tv,web_safari,mweb,web_embedded");
      expect(second.trimEnd().split("\n").slice(-2)).toEqual(["--", YT_URL]);
      expect(fs.existsSync(path.join(dir, "args3.txt"))).toBe(false);
    },
  );
});

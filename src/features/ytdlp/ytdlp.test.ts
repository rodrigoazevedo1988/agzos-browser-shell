import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

import { KNOWN_VIDEO_HOSTS, isKnownVideoHost as isKnownRenderer } from "./hosts";

const require = createRequire(import.meta.url);
const ytdlp = require("../../../electron/ytdlp.cjs") as {
  KNOWN_HOSTS: string[];
  assetNameOf: (platform: string, arch?: string) => string | null;
  buildArgs: (options: {
    url: string;
    outDir: string;
    quality?: string;
    ffmpeg?: string | null;
    deno?: boolean;
    jsRuntime?: string | null;
    cookies?: string | null;
  }) => string[] | null;
  cookieDomainsOf: (url: string) => string[];
  friendlyError: (message: string) => string;
  netscapeCookies: (cookies: unknown[], domains: string[]) => string | null;
  checksumOf: (sums: string, asset: string) => string | null;
  cleanUrl: (value: unknown) => string | null;
  createProgress: () => {
    newStream: () => void;
    feed: (p: { downloaded: number | null; total: number | null }) => {
      received: number;
      total: number;
    };
    finishStream: () => void;
  };
  createYtdlpService: (options: Record<string, unknown>) => {
    status: () => { binary: string | null; ffmpeg: boolean; managed: boolean };
    install: () => Promise<{ ok: boolean; error?: string; path?: string }>;
    pick: (file: string) => { ok: boolean; error?: string };
    start: (options: {
      url: string;
      quality?: string;
      private?: boolean;
      tabId?: number;
      owner?: unknown;
    }) => Promise<{
      ok: boolean;
      error?: string;
      id?: number;
    }>;
    cancel: (id: number) => boolean;
    stopAll: () => void;
    activeCount: () => number;
  };
  formatArgsOf: (quality: string, ffmpeg: boolean) => string[] | null;
  isKnownVideoHost: (url: string) => boolean;
  looksLikeYtdlp: (file: string) => boolean;
  parseOutputLine: (line: string) => { kind: string; path?: string; message?: string } | null;
  parseProgressLine: (line: string) => {
    downloaded: number | null;
    total: number | null;
    speed: number | null;
    eta: number | null;
  } | null;
  quickCheck: (value: string) => { ok: boolean; known?: boolean; error?: string };
  ytdlpCandidates: (options: Record<string, unknown>) => string[];
  sha256Of: (buffer: Buffer) => string;
};

const OUT = path.join(os.tmpdir(), "agzos-ytdlp-videos");

describe("yt-dlp: argv", () => {
  it("a URL vai depois de -- e por último, sem shell", () => {
    const url = "https://www.youtube.com/watch?v=abc&x=$(rm -rf /)";
    const args = ytdlp.buildArgs({ url, outDir: OUT, quality: "best", ffmpeg: null })!;
    expect(args.at(-1)).toBe(url);
    expect(args.at(-2)).toBe("--");
    expect(args).not.toContain("--exec");
    expect(args).toContain("--no-playlist");
    expect(args).toContain("--newline");
  });

  it("sem ffmpeg: formato único (b); com ffmpeg: bv*+ba mesclado em mp4", () => {
    expect(ytdlp.formatArgsOf("best", false)).toEqual(["-f", "b"]);
    expect(ytdlp.formatArgsOf("best", true)).toEqual([
      "-f",
      "bv*+ba/b",
      "--merge-output-format",
      "mp4",
    ]);
    expect(ytdlp.formatArgsOf("1080", false)).toEqual(["-f", "b[height<=1080]/b"]);
    expect(ytdlp.formatArgsOf("720", true)).toContain("bv*[height<=720]+ba/b[height<=720]");
  });

  it("áudio: extrai mp3 ou m4a só com ffmpeg; qualidade inválida não gera argv", () => {
    expect(ytdlp.formatArgsOf("audio-mp3", true)).toEqual([
      "-f",
      "ba/b",
      "-x",
      "--audio-format",
      "mp3",
    ]);
    expect(ytdlp.formatArgsOf("audio-m4a", false)).not.toContain("-x");
    expect(ytdlp.formatArgsOf("4k", true)).toBeNull();
    expect(ytdlp.buildArgs({ url: "https://a.b/c", outDir: OUT, quality: "4k" })).toBeNull();
  });

  it("ffmpeg encontrado vai em --ffmpeg-location; % na pasta é escapado para o yt-dlp", () => {
    const args = ytdlp.buildArgs({
      url: "https://youtu.be/x",
      outDir: "/tmp/100%/Videos",
      quality: "best",
      ffmpeg: "/usr/bin/ffmpeg",
    })!;
    const at = args.indexOf("--ffmpeg-location");
    expect(args[at + 1]).toBe("/usr/bin/ffmpeg");
    const output = args[args.indexOf("-o") + 1];
    expect(output).toBe("/tmp/100%%/Videos/%(title)s [%(id)s].%(ext)s");
  });
});

describe("yt-dlp: URL e sites", () => {
  it("só http e https, sem espaços nem controles", () => {
    expect(ytdlp.cleanUrl("https://youtu.be/abc")).toBe("https://youtu.be/abc");
    for (const bad of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "--exec=calc",
      "https://a b.com",
      "https://a.com/\n--exec",
      "",
      `https://a.com/${"x".repeat(2100)}`,
      42,
    ]) {
      expect(ytdlp.cleanUrl(bad)).toBeNull();
    }
    expect(ytdlp.quickCheck("ftp://x.y").ok).toBe(false);
  });

  it("sites conhecidos (inclusive subdomínios), sem casar sufixos parecidos", () => {
    expect(ytdlp.isKnownVideoHost("https://m.youtube.com/watch?v=1")).toBe(true);
    expect(ytdlp.isKnownVideoHost("https://youtu.be/1")).toBe(true);
    expect(ytdlp.isKnownVideoHost("https://x.com/a/status/1")).toBe(true);
    expect(ytdlp.isKnownVideoHost("https://notyoutube.com/")).toBe(false);
    expect(ytdlp.isKnownVideoHost("https://example.org/video")).toBe(false);
    expect(ytdlp.quickCheck("https://vimeo.com/1")).toEqual({
      ok: true,
      url: "https://vimeo.com/1",
      known: true,
    });
  });

  it("a lista da casca é a do main", () => {
    expect([...KNOWN_VIDEO_HOSTS].sort()).toEqual([...ytdlp.KNOWN_HOSTS].sort());
    for (const url of ["https://m.youtube.com/x", "https://example.org/y", "https://fb.watch/z"]) {
      expect(isKnownRenderer(url)).toBe(ytdlp.isKnownVideoHost(url));
    }
  });
});

describe("yt-dlp: saída e progresso", () => {
  it("linha de progresso vira números (NA vira null, estimativa substitui total)", () => {
    expect(ytdlp.parseProgressLine("AGZOSYTDLP|123|NA|456|78.5|3")).toEqual({
      downloaded: 123,
      total: 456,
      speed: 79,
      eta: 3,
    });
    expect(ytdlp.parseProgressLine("AGZOSYTDLP|NA|NA|NA|NA|NA")).toEqual({
      downloaded: null,
      total: null,
      speed: null,
      eta: null,
    });
    expect(ytdlp.parseProgressLine("[download] 10% of 5MiB")).toBeNull();
  });

  it("destinos, pós-processamento, arquivo existente e erros", () => {
    expect(ytdlp.parseOutputLine("[download] Destination: /a/b c.mp4")).toEqual({
      kind: "download",
      path: "/a/b c.mp4",
    });
    expect(ytdlp.parseOutputLine('[Merger] Merging formats into "/a/x.mp4"')).toEqual({
      kind: "post",
      path: "/a/x.mp4",
    });
    expect(ytdlp.parseOutputLine("[ExtractAudio] Destination: /a/x.mp3")).toEqual({
      kind: "post",
      path: "/a/x.mp3",
    });
    expect(ytdlp.parseOutputLine("[download] /a/x.mp4 has already been downloaded")).toEqual({
      kind: "existing",
      path: "/a/x.mp4",
    });
    expect(ytdlp.parseOutputLine("ERROR: Video unavailable")).toEqual({
      kind: "error",
      message: "Video unavailable",
    });
    expect(ytdlp.parseOutputLine("[info] something else")).toBeNull();
  });

  it("progresso de dois fluxos (vídeo e áudio) soma o que já terminou", () => {
    const progress = ytdlp.createProgress();
    expect(progress.feed({ downloaded: 100, total: 100 })).toEqual({ received: 100, total: 100 });
    progress.newStream();
    expect(progress.feed({ downloaded: 50, total: 200 })).toEqual({ received: 150, total: 300 });
  });
});

describe("yt-dlp: binário e instalação", () => {
  it("ordem: escolhido pelo usuário, PATH, pastas comuns e depois <userData>/bin", () => {
    const list = ytdlp.ytdlpCandidates({
      configured: "/opt/mine/yt-dlp",
      env: { PATH: "/usr/bin:/bin" },
      platform: "linux",
      userData: "/data/agzos",
    });
    expect(list[0]).toBe("/opt/mine/yt-dlp");
    expect(list.indexOf("/usr/bin/yt-dlp")).toBeLessThan(list.indexOf("/data/agzos/bin/yt-dlp"));
    const windows = ytdlp.ytdlpCandidates({
      env: { Path: "C:\\Tools" },
      platform: "win32",
      userData: "C:\\data",
    });
    expect(windows).toContain("C:\\Tools\\yt-dlp.exe");
    expect(windows).toContain("C:\\data\\bin\\yt-dlp.exe");
  });

  it("asset oficial por sistema e checksum do SHA2-256SUMS", () => {
    expect(ytdlp.assetNameOf("win32")).toBe("yt-dlp.exe");
    expect(ytdlp.assetNameOf("darwin")).toBe("yt-dlp_macos");
    expect(ytdlp.assetNameOf("linux")).toBe("yt-dlp_linux");
    expect(ytdlp.assetNameOf("freebsd")).toBeNull();
    const hash = "a".repeat(64);
    expect(
      ytdlp.checksumOf(`${hash}  yt-dlp_linux\n${"b".repeat(64)} *yt-dlp_macos\n`, "yt-dlp_macos"),
    ).toBe("b".repeat(64));
    expect(ytdlp.checksumOf(`${hash}  yt-dlp_linux`, "yt-dlp.exe")).toBeNull();
  });

  it("só aceita arquivo com cara de yt-dlp", () => {
    expect(ytdlp.looksLikeYtdlp("/opt/yt-dlp")).toBe(true);
    expect(ytdlp.looksLikeYtdlp("C:\\Tools\\yt-dlp.exe")).toBe(true);
    expect(ytdlp.looksLikeYtdlp("/tmp/evil.sh")).toBe(false);
  });
});

/** Espera as continuações assíncronas do serviço (próxima tentativa, checagens). */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    pid: number | undefined;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  // Sem pid: o teste não mexe em grupos de processo de verdade.
  child.pid = undefined;
  child.kill = vi.fn();
  return child;
}

function fakeDownloads() {
  const handles: {
    id: number;
    update: ReturnType<typeof vi.fn>;
    finish: ReturnType<typeof vi.fn>;
    fields: Record<string, unknown>;
  }[] = [];
  return {
    handles,
    startExternal: vi.fn((fields: Record<string, unknown>) => {
      const handle = {
        id: handles.length + 1,
        fields,
        update: vi.fn(),
        finish: vi.fn(),
      };
      handles.push(handle);
      return handle;
    }),
  };
}

function setup(extra: Record<string, unknown> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agzos-ytdlp-"));
  const videos = path.join(dir, "Videos");
  const bin = path.join(dir, "fake-yt-dlp");
  fs.writeFileSync(bin, "");
  // Uma criança por tentativa: a cadeia de novas tentativas abre um processo novo cada vez.
  const children = [fakeChild(), fakeChild(), fakeChild(), fakeChild()];
  const child = children[0]!;
  let spawned = 0;
  const spawn = vi.fn(() => children[spawned++]!);
  const downloads = fakeDownloads();
  const emit = vi.fn();
  const service = ytdlp.createYtdlpService({
    spawn,
    execFile: vi.fn(),
    userDataDir: () => dir,
    platform: "linux",
    arch: "x64",
    env: { PATH: "" },
    getMeta: () => bin,
    setMeta: vi.fn(),
    downloads,
    routeFor: () => ({ dir: videos, tags: ["youtube.com"] }),
    emit,
    isExecutable: (file: string) => file === bin,
    ...extra,
  });
  return { dir, videos, bin, child, children, spawn, downloads, emit, service };
}

describe("yt-dlp 5.0.2: YouTube, cookies e UTF-8", () => {
  it("argv leva o runtime de JS (deno ou o Electron como node) e o arquivo de cookies", () => {
    const args = ytdlp.buildArgs({
      url: "https://www.youtube.com/watch?v=a",
      outDir: "/tmp/v",
      deno: true,
      jsRuntime: "/opt/Agzos/agzos",
      cookies: "/tmp/c/cookies.txt",
    })!;
    expect(args.join(" ")).toContain("--js-runtimes deno --js-runtimes node:/opt/Agzos/agzos");
    expect(args.join(" ")).toContain("--cookies /tmp/c/cookies.txt");
    expect(args.slice(-2)).toEqual(["--", "https://www.youtube.com/watch?v=a"]);
    const plain = ytdlp.buildArgs({ url: "https://a.com/v", outDir: "/tmp/v" })!;
    expect(plain).not.toContain("--js-runtimes");
    expect(plain).not.toContain("--cookies");
  });

  it("domínios dos cookies seguem o site e os apelidos (youtu.be, fb.watch, twitter/x)", () => {
    expect(ytdlp.cookieDomainsOf("https://m.youtube.com/watch?v=a")).toEqual(["youtube.com"]);
    expect(ytdlp.cookieDomainsOf("https://youtu.be/a")).toEqual(["youtu.be", "youtube.com"]);
    expect(ytdlp.cookieDomainsOf("https://fb.watch/x")).toEqual(["fb.watch", "facebook.com"]);
    expect(ytdlp.cookieDomainsOf("https://twitter.com/u/status/1")).toEqual([
      "twitter.com",
      "x.com",
    ]);
    expect(ytdlp.cookieDomainsOf("https://www.globo.com.br/v")).toEqual(["globo.com.br"]);
  });

  it("arquivo Netscape só com os cookies do site, sem tab/quebra de linha", () => {
    const text = ytdlp.netscapeCookies(
      [
        {
          domain: ".youtube.com",
          name: "SID",
          value: "a\tb",
          path: "/",
          secure: true,
          httpOnly: true,
          expirationDate: 1900000000.5,
        },
        {
          domain: "www.youtube.com",
          hostOnly: true,
          name: "PREF",
          value: "x",
          path: "/",
          secure: false,
        },
        { domain: ".google.com", name: "NID", value: "n", path: "/" },
        { domain: ".notyoutube.com", name: "Z", value: "z", path: "/" },
      ],
      ["youtube.com"],
    )!;
    const lines = text.trim().split("\n");
    expect(lines[0]).toBe("# Netscape HTTP Cookie File");
    expect(lines).toContain("#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t1900000000\tSID\tab");
    expect(lines).toContain("www.youtube.com\tFALSE\t/\tFALSE\t0\tPREF\tx");
    expect(text).not.toContain("NID");
    expect(text).not.toContain("notyoutube");
    expect(ytdlp.netscapeCookies([], ["youtube.com"])).toBeNull();
  });

  it("erros conhecidos viram texto claro", () => {
    expect(
      ytdlp.friendlyError("[youtube] a: Sign in to confirm you’re not a bot. Use --cookies"),
    ).toMatch(/YouTube pediu login/);
    expect(ytdlp.friendlyError("Requested format is not available")).toMatch(/Vídeo \(melhor\)/);
    expect(ytdlp.friendlyError("algo novo")).toBe("algo novo");
  });

  it("processo roda em UTF-8, com o Electron como node, e apaga os cookies no fim", async () => {
    const owner = { id: "janela" };
    const cookiesFor = vi.fn(async () => [
      { domain: ".youtube.com", name: "SID", value: "s", path: "/", secure: true },
    ]);
    const { child, spawn, service } = setup({ jsRuntime: "/opt/agzos", cookiesFor });
    await service.start({ url: "https://www.youtube.com/watch?v=a", tabId: 7, owner });
    expect(cookiesFor).toHaveBeenCalledWith(owner, 7, "https://www.youtube.com/watch?v=a");
    const [, args, options] = spawn.mock.calls[0] as unknown as [
      string,
      string[],
      { env: Record<string, string> },
    ];
    expect(options.env).toMatchObject({
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8",
      ELECTRON_RUN_AS_NODE: "1",
    });
    const cookieFile = args[args.indexOf("--cookies") + 1]!;
    expect(fs.statSync(cookieFile).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(cookieFile, "utf8")).toContain("\tSID\ts");
    child.emit("close", 1);
    expect(fs.existsSync(path.dirname(cookieFile))).toBe(false);
  });
});

describe("yt-dlp: serviço", () => {
  it("download completo: progresso no gerenciador e arquivo final", async () => {
    const { child, spawn, downloads, service, videos, bin } = setup();
    const result = await service.start({ url: "https://youtu.be/abc", quality: "best" });
    expect(result).toEqual({ ok: true, id: 1 });
    expect(spawn).toHaveBeenCalledTimes(1);
    const [binary, args, options] = spawn.mock.calls[0] as unknown as [
      string,
      string[],
      { stdio: string[] },
    ];
    expect(binary).toBe(bin);
    expect(args.at(-1)).toBe("https://youtu.be/abc");
    expect(options.stdio).toEqual(["ignore", "pipe", "pipe"]);
    expect(downloads.startExternal).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "ytdlp",
        url: "https://youtu.be/abc",
        mime: "video/mp4",
        tags: ["youtube.com"],
      }),
    );
    const handle = downloads.handles[0]!;
    const file = path.join(videos, "Titulo [abc].mp4");
    fs.mkdirSync(videos, { recursive: true });
    fs.writeFileSync(file, "video");
    child.stdout.emit("data", Buffer.from(`[download] Destination: ${file}\n`));
    child.stdout.emit(
      "data",
      Buffer.from("AGZOSYTDLP|50|100|NA|1000|2\r\nAGZOSYTDLP|100|100|NA|1000|0\n"),
    );
    expect(handle.update).toHaveBeenLastCalledWith({ receivedBytes: 100, totalBytes: 100 });
    child.emit("close", 0);
    expect(handle.finish).toHaveBeenCalledWith("completed", file);
    expect(service.activeCount()).toBe(0);
  });

  it("cancelar mata o processo e remove os parciais do próprio job", async () => {
    const { child, downloads, service, videos } = setup();
    fs.mkdirSync(videos, { recursive: true });
    const file = path.join(videos, "Parcial [x].mp4");
    fs.writeFileSync(`${file}.part`, "partial");
    await service.start({ url: "https://vimeo.com/1", quality: "720" });
    child.stdout.emit("data", Buffer.from(`[download] Destination: ${file}\n`));
    expect(downloads.startExternal).toHaveBeenCalled();
    const stopped = service.cancel(1);
    expect(stopped).toBe(true);
    expect(child.kill).toHaveBeenCalled();
    child.emit("close", null);
    expect(downloads.handles[0]!.finish).toHaveBeenCalledWith("cancelled");
    expect(fs.existsSync(`${file}.part`)).toBe(false);
  });

  it("caractere UTF-8 partido entre dois pedaços não quebra o caminho do arquivo", async () => {
    const { child, downloads, service, videos } = setup();
    const file = path.join(videos, "Coração [z].mp4");
    fs.mkdirSync(videos, { recursive: true });
    fs.writeFileSync(file, "video");
    await service.start({ url: "https://vimeo.com/2", quality: "best" });
    const bytes = Buffer.from(`[download] Destination: ${file}\n`);
    const cut = bytes.indexOf(Buffer.from("ç")) + 1;
    child.stdout.emit("data", bytes.subarray(0, cut));
    child.stdout.emit("data", bytes.subarray(cut));
    child.emit("close", 0);
    expect(downloads.handles[0]!.finish).toHaveBeenCalledWith("completed", file);
  });

  it("saída 0 sem arquivo no disco não vira 'concluído'", async () => {
    const { child, downloads, service, videos } = setup();
    await service.start({ url: "https://vimeo.com/3", quality: "best" });
    child.stdout.emit(
      "data",
      Buffer.from(`[download] Destination: ${path.join(videos, "sumiu.mp4")}\n`),
    );
    child.emit("close", 0);
    expect(downloads.handles[0]!.finish).toHaveBeenCalledWith("interrupted");
  });

  it("falha do yt-dlp vira 'interrompido' e avisa a janela com a mensagem", async () => {
    const { children, spawn, downloads, emit, service } = setup();
    await service.start({ url: "https://tiktok.com/@a/video/1", quality: "best" });
    children[0]!.stderr.emit("data", Buffer.from("ERROR: [TikTok] unavailable\n"));
    children[0]!.emit("close", 1);
    // 5.0.3: erro de site comum tenta de novo (Referer/UA e depois formato) antes de desistir.
    await flush();
    expect(spawn).toHaveBeenCalledTimes(2);
    children[1]!.stderr.emit("data", Buffer.from("ERROR: [TikTok] unavailable\n"));
    children[1]!.emit("close", 1);
    await flush();
    expect(spawn).toHaveBeenCalledTimes(3);
    children[2]!.stderr.emit("data", Buffer.from("ERROR: [TikTok] unavailable\n"));
    children[2]!.emit("close", 1);
    await flush();
    expect(spawn).toHaveBeenCalledTimes(3);
    expect(downloads.handles[0]!.finish).toHaveBeenCalledWith("interrupted");
    expect(emit).toHaveBeenCalledWith("agzos:ytdlp-error", {
      id: 1,
      message: "[TikTok] unavailable",
    });
  });

  it("recusa URL ruim, qualidade inexistente e falta de binário sem abrir processo", async () => {
    const { spawn, service } = setup();
    expect(await service.start({ url: "file:///etc/passwd" })).toEqual({ ok: false, error: "url" });
    expect(await service.start({ url: "https://a.com", quality: "8k" })).toEqual({
      ok: false,
      error: "quality",
    });
    expect(spawn).not.toHaveBeenCalled();
    const none = setup({ getMeta: () => null, isExecutable: () => false, env: { PATH: "" } });
    expect(await none.service.start({ url: "https://a.com" })).toEqual({
      ok: false,
      error: "missing",
    });
    expect((await none.service.status()).binary).toBeNull();
  });

  it("instala só com o SHA-256 do release, em <userData>/bin, executável", async () => {
    const payload = Buffer.from("#!/bin/sh\necho fake\n");
    const sums = (hash: string) => `${hash}  yt-dlp_linux\n`;
    const fetchFor = (sumsText: string) =>
      vi.fn(async (url: string) => {
        const body = url.endsWith("SHA2-256SUMS") ? Buffer.from(sumsText) : payload;
        return {
          ok: true,
          arrayBuffer: async () =>
            body.buffer.slice(body.byteOffset, body.byteOffset + body.length),
        };
      });

    const bad = setup({
      isExecutable: () => false,
      getMeta: () => null,
      fetchImpl: fetchFor(sums("0".repeat(64))),
    });
    expect(await bad.service.install()).toEqual({ ok: false, error: "checksum" });
    expect(fs.existsSync(path.join(bad.dir, "bin", "yt-dlp"))).toBe(false);

    const good = setup({
      isExecutable: () => false,
      getMeta: () => null,
      fetchImpl: fetchFor(sums(ytdlp.sha256Of(payload))),
    });
    const result = await good.service.install();
    expect(result.ok).toBe(true);
    const target = path.join(good.dir, "bin", "yt-dlp");
    expect(result.path).toBe(target);
    expect(fs.readFileSync(target)).toEqual(payload);
    expect(fs.statSync(target).mode & 0o111).not.toBe(0);
  });

  it("escolher um binário exige nome de yt-dlp e arquivo executável", () => {
    const { service } = setup({ isExecutable: () => true });
    expect(service.pick("/tmp/not-it")).toEqual({ ok: false, error: "invalid" });
    expect(service.pick("relativo/yt-dlp")).toEqual({ ok: false, error: "invalid" });
    expect(service.pick("/opt/yt-dlp")).toEqual({ ok: true, binary: "/opt/yt-dlp" });
  });
});

describe("yt-dlp: gerenciador de downloads", () => {
  it("download externo entra na lista com a origem, e não é refeito como arquivo da web", async () => {
    const { createDownloadManager } = require("../../../electron/downloads.cjs") as {
      createDownloadManager: (options: Record<string, unknown>) => {
        startExternal: (fields: Record<string, unknown>) => {
          id: number;
          update: (fields: Record<string, number | string>) => void;
          finish: (state: string, file?: string) => void;
        };
        list: () => { id: number; source: string; state: string; path: string }[];
        restart: (id: number) => boolean;
      };
    };
    const rows = new Map<number, Record<string, unknown>>();
    const database = {
      addDownload: vi.fn((record: Record<string, unknown>) => {
        const id = rows.size + 1;
        rows.set(id, { ...record, id });
        return id;
      }),
      updateDownload: vi.fn((id: number, record: Record<string, unknown>) =>
        rows.set(id, { ...record, id }),
      ),
      removeDownload: vi.fn(),
      listDownloads: () => [...rows.values()],
    };
    const emit = vi.fn();
    const manager = createDownloadManager({
      database,
      downloadsDir: () => OUT,
      emit,
      isPrivateSession: () => false,
      config: () => null,
      defaultSession: () => null,
    });
    const handle = manager.startExternal({
      url: "https://youtu.be/abc",
      filename: "Vídeo de youtu.be",
      mime: "video/mp4",
      source: "ytdlp",
      cancel: vi.fn(),
    });
    handle.update({ receivedBytes: 40, totalBytes: 100 });
    handle.finish("completed", path.join(OUT, "Titulo.mp4"));
    const [row] = manager.list();
    if (!row) throw new Error("sem linha");
    expect(row).toMatchObject({
      source: "ytdlp",
      state: "completed",
      path: path.join(OUT, "Titulo.mp4"),
    });
    expect(manager.restart(row.id)).toBe(false);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ source: "ytdlp", state: "completed" }),
    );
  });
});

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { pastedImageText } from "@/features/terminal/model";
import { parsePrefs } from "./persistence/snapshot";
import { browserReducer } from "./store/reducer";
import { initialState } from "./store/state";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const main = fs.readFileSync(path.join(root, "electron/main.cjs"), "utf8");
const build = fs.readFileSync(path.join(root, "scripts/build-all.sh"), "utf8");

type Area = { x: number; y: number; width: number; height: number };

const video = require(path.join(root, "electron/video-window.cjs")) as {
  QUALITY_LABELS: Record<string, string>;
  RATES: number[];
  initialBounds(input: {
    videoWidth: number;
    videoHeight: number;
    workArea: Area;
    saved?: Partial<Area> | null;
  }): Area & { ratio: number };
  videoCommand(raw: unknown): Record<string, unknown> | null;
  overlayState(
    raw: unknown,
    title?: string,
  ): { title: string; quality: unknown; [name: string]: unknown } | null;
  controlsHtml(): string;
  pageScript(fn: (...args: never[]) => unknown, args: unknown): string;
  isolateInPage: (...args: never[]) => unknown;
};

const workArea = { x: 0, y: 0, width: 1920, height: 1040 };

describe("4.9: janela de vídeo", () => {
  it("nasce com 480 px no canto inferior direito, na proporção do vídeo", () => {
    const bounds = video.initialBounds({ videoWidth: 1280, videoHeight: 720, workArea });
    expect(bounds).toMatchObject({ width: 480, height: 270 });
    expect(bounds.x + bounds.width).toBe(1920 - 16);
    expect(bounds.y + bounds.height).toBe(1040 - 16);
    // Vídeo vertical: a altura segue a proporção (com mínimo).
    const tall = video.initialBounds({ videoWidth: 720, videoHeight: 1280, workArea });
    expect(tall.height).toBeGreaterThan(tall.width);
    // Sem tamanho do vídeo: 16:9.
    expect(video.initialBounds({ videoWidth: 0, videoHeight: 0, workArea }).ratio).toBeCloseTo(
      16 / 9,
    );
  });

  it("volta onde estava se ainda cabe na tela; senão, ao canto", () => {
    const saved = { x: 100, y: 200, width: 640, height: 360 };
    expect(
      video.initialBounds({ videoWidth: 1280, videoHeight: 720, workArea, saved }),
    ).toMatchObject({ x: 100, y: 200, width: 640, height: 360 });
    const lost = { x: 5000, y: 5000, width: 640, height: 360 };
    const moved = video.initialBounds({
      videoWidth: 1280,
      videoHeight: 720,
      workArea,
      saved: lost,
    });
    expect(moved.x + moved.width).toBe(1920 - 16);
    // Tamanho salvo maior que a tela não passa de 90% dela.
    const huge = video.initialBounds({
      videoWidth: 1280,
      videoHeight: 720,
      workArea,
      saved: { x: 0, y: 0, width: 9000 },
    });
    expect(huge.width).toBeLessThanOrEqual(1920 * 0.9);
  });

  it("só aceita comandos conhecidos, com valores limitados", () => {
    expect(video.videoCommand({ type: "toggle" })).toEqual({ type: "toggle" });
    expect(video.videoCommand({ type: "seek", by: 99999 })).toEqual({ type: "seek", by: 600 });
    expect(video.videoCommand({ type: "seek", by: "10" })).toBeNull();
    expect(video.videoCommand({ type: "seek-to", time: -1 })).toBeNull();
    expect(video.videoCommand({ type: "volume", value: 3 })).toEqual({ type: "volume", value: 1 });
    expect(video.videoCommand({ type: "rate", value: 1.5 })).toEqual({ type: "rate", value: 1.5 });
    expect(video.videoCommand({ type: "rate", value: 16 })).toBeNull();
    expect(video.videoCommand({ type: "quality", value: "hd1080" })).toEqual({
      type: "quality",
      value: "hd1080",
    });
    expect(video.videoCommand({ type: "quality", value: "constructor" })).toBeNull();
    expect(video.videoCommand({ type: "eval", code: "alert(1)" })).toBeNull();
    expect(video.videoCommand(null)).toBeNull();
  });

  it("a camada recebe só números e textos; qualidade só com níveis conhecidos", () => {
    const state = video.overlayState(
      {
        paused: false,
        time: 12.5,
        duration: Infinity,
        volume: 7,
        muted: false,
        rate: 1.25,
        quality: { levels: ["hd1080", "hd720", "<b>x</b>", "auto"], current: "hd720" },
      },
      "Vídeo".repeat(100),
    );
    expect(state).toMatchObject({ time: 12.5, duration: 0, volume: 1, rate: 1.25 });
    expect((state!.title as string).length).toBe(200);
    expect(state!.quality).toEqual({
      levels: [
        { value: "hd1080", label: "1080p" },
        { value: "hd720", label: "720p" },
        { value: "auto", label: "Automática" },
      ],
      current: "hd720",
    });
    // Um nível só (ou nenhum): sem seletor.
    expect(video.overlayState({ quality: { levels: ["auto"] } })!.quality).toBeNull();
    expect(video.overlayState(null)).toBeNull();
  });

  it("camada sem HTML do site: CSP fechada e estado por textContent", () => {
    const html = video.controlsHtml();
    expect(html).toContain("default-src 'none'");
    expect(html).toContain('$("title").textContent');
    expect(html).not.toMatch(/innerHTML\s*=\s*next\./);
    // Botões fora da área de arrasto (no macOS o clique sumia dentro dela).
    expect(html).toContain("#drag{flex:1");
    expect(html).not.toMatch(/button[^{]*\{[^}]*app-region:drag/);
    for (const rate of video.RATES) expect(html).toContain(`value="${rate}"`);
  });

  it("script da página leva os argumentos como JSON", () => {
    const source = video.pageScript(video.isolateInPage, { key: "k", childUrl: 'https://a/"x' });
    expect(source).toContain('{"key":"k","childUrl":"https://a/\\"x"}');
  });

  it("main: guia e app saem da janela e voltam; arquivos no build", () => {
    expect(main).toContain("if (videoWindow?.view === entry.view) continue;");
    // 4.9.1: apps instalados também (dono próprio, mesmo caminho).
    expect(main).toContain('if (pipMode === "agzos" && owner) return openVideoWindow');
    expect(main).toContain("pwaVideoOwners.set(contents, {");
    expect(main).toContain("if (win.isDestroyed() || videoWindow?.view === view) return;");
    expect(main).toMatch(
      /win\.on\("restore", \(\) => \{\s+\/\/[^\n]*\n\s+if \(videoWindow\?\.contents === contents\)/,
    );
    expect(main).toMatch(/function dropView[^]*?closeVideoWindow\(\{ restore: false \}\)/);
    expect(build).toContain("video-window.cjs video-window-preload.cjs");
  });

  it("4.9.3: redimensionamento suave sem loop de will-resize e sanitização de bounds", () => {
    expect(main).toContain("thickFrame: true");
    expect(main).not.toContain('win.on("will-resize"');
    expect(main).toContain("maxWidth: Math.round(display.workArea.width");
    const isoSource = video.isolateInPage.toString();
    expect(isoSource).toContain("MutationObserver");
    expect(isoSource).toContain("enforceTarget");
    expect(isoSource).toContain('window.addEventListener("resize"');
    expect(isoSource).toContain('"background-color": "#000"');

    const bounds = video.initialBounds({
      videoWidth: 1920,
      videoHeight: 1080,
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
      saved: { x: 100, y: 100, width: 1800, height: 1000 },
    });
    expect(bounds.width).toBe(480);
    expect(bounds.height).toBe(270);
  });

  it("4.9.4: irmãos do vídeo (título e canal do YouTube) somem, inclusive os inseridos depois", () => {
    const isoSource = video.isolateInPage.toString();
    expect(isoSource).toContain('const hideProps = { opacity: "0", visibility: "hidden"');
    expect(isoSource).toContain("observer?.observe(container, { childList: true })");
    expect(isoSource).toContain(
      'observer?.observe(child, { attributes: true, attributeFilter: ["style"] })',
    );
  });

  it("4.9.4: print colado no terminal vira o caminho do PNG", () => {
    expect(pastedImageText({ shell: "bash", ssh: false }, "/tmp/p/print-1.png")).toBe(
      "'/tmp/p/print-1.png'",
    );
    expect(pastedImageText({ shell: "powershell", ssh: false }, "C:\\T\\a b.png")).toBe(
      "'C:\\T\\a b.png'",
    );
    expect(pastedImageText({ shell: "program", ssh: false }, "/tmp/x.png")).toBe("/tmp/x.png");
    expect(pastedImageText({ shell: "ssh", ssh: true }, "/home/u/.cache/agzos-prints/p.png")).toBe(
      "/home/u/.cache/agzos-prints/p.png",
    );
    expect(main).toContain('ipcMain.handle("terminal:clipboard-image"');
    expect(main).toContain("clipboardImage.pasteClipboardImage({ clipboard, nativeImage })");
    expect(build).toContain("clipboard-image.cjs");
  });

  it("4.9.6: print lido pela área de transferência assíncrona (sem readImage)", async () => {
    const shot = require("../../../electron/clipboard-image.cjs") as {
      imageTypeOf: (types: string[]) => string | null;
      readClipboardPng: (electron: unknown) => Promise<Buffer | null>;
      savePrint: (png: Buffer, options: { dir: string; now: number }) => string | null;
    };
    expect(fs.readFileSync(path.join(root, "electron/clipboard-image.cjs"), "utf8")).not.toMatch(
      /clipboard\.readImage\(/,
    );
    expect(shot.imageTypeOf(["text/plain", "image/bmp", "image/png"])).toBe("image/png");
    expect(shot.imageTypeOf(["image/bmp"])).toBe("image/bmp");
    expect(shot.imageTypeOf(["text/plain"])).toBeNull();

    const bmp = Buffer.from("bmp");
    const fake = {
      clipboard: {
        read: async () => [
          { types: ["text/plain"], getType: async () => new Blob(["x"]) },
          { types: ["image/bmp"], getType: async () => new Blob([bmp]) },
        ],
      },
      nativeImage: {
        createFromBuffer: (data: Buffer) => ({
          isEmpty: () => !data.equals(bmp),
          toPNG: () => Buffer.from("convertido"),
        }),
      },
    };
    expect(String(await shot.readClipboardPng(fake))).toBe("convertido");

    const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "prints-"));
    const old = path.join(dir, "print-velho.png");
    fs.writeFileSync(old, "x");
    fs.utimesSync(old, new Date(0), new Date(0));
    fs.writeFileSync(path.join(dir, "outro.txt"), "x");
    const now = Date.now();
    const first = shot.savePrint(Buffer.from("a"), { dir, now })!;
    const second = shot.savePrint(Buffer.from("b"), { dir, now })!;
    expect(first).not.toBe(second);
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(path.join(dir, "outro.txt"))).toBe(true);
    expect(shot.savePrint(Buffer.alloc(0), { dir, now })).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("4.9.7: print colado numa sessão SSH vai para o servidor", async () => {
    const shot = require("../../../electron/clipboard-image.cjs") as {
      remotePrintCommand: (name: string) => string;
      uploadPrint: (png: Buffer, options: Record<string, unknown>) => Promise<unknown>;
    };
    const command = shot.remotePrintCommand("print-2026-10-13T20-00-00-000Z.png");
    expect(command).not.toContain('"');
    expect(command).toContain("cat > $d/print-2026-10-13T20-00-00-000Z.png");
    expect(() => shot.remotePrintCommand("x;rm -rf ~.png")).toThrow();

    const calls: { file: string; argv: string[]; stdin: Buffer }[] = [];
    const fakeExec =
      (stdout: string, stderr = "", fail = false) =>
      (
        file: string,
        argv: string[],
        _options: unknown,
        done: (error: Error | null, out: string, err: string) => void,
      ) => {
        const call: { file: string; argv: string[]; stdin: Buffer } = {
          file,
          argv,
          stdin: Buffer.alloc(0),
        };
        calls.push(call);
        return {
          stdin: {
            on: () => {},
            end: (data: Buffer) => {
              call.stdin = data;
              setTimeout(() => done(fail ? new Error("x") : null, stdout, stderr), 0);
            },
          },
        };
      };
    const png = Buffer.from("png");
    const now = Date.UTC(2026, 9, 13, 20);
    const ok = await shot.uploadPrint(png, {
      sshFile: "/usr/bin/ssh",
      args: ["-p", "2222", "-i", "/k", "u@vps"],
      now,
      execFile: fakeExec("/home/u/.cache/agzos-prints/print-2026-10-13T20-00-00-000Z.png\n"),
    });
    expect(ok).toEqual({ file: "/home/u/.cache/agzos-prints/print-2026-10-13T20-00-00-000Z.png" });
    expect(calls[0]!.argv.slice(0, 5)).toEqual([
      "-T",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
    ]);
    expect(calls[0]!.argv.slice(5, 10)).toEqual(["-p", "2222", "-i", "/k", "u@vps"]);
    expect(calls[0]!.stdin.equals(png)).toBe(true);
    const denied = await shot.uploadPrint(png, {
      sshFile: "/usr/bin/ssh",
      args: ["u@vps"],
      now,
      execFile: fakeExec("", "u@vps: Permission denied (publickey,password).", true),
    });
    expect(denied).toEqual({ error: "ssh-auth" });
    expect(await shot.uploadPrint(png, { sshFile: null, args: [], now })).toEqual({
      error: "no-ssh",
    });
    expect(main).toContain("terminals.sshOf(ctx, id)");
  });

  it("preferência e estado da casca", () => {
    expect(parsePrefs({}).pipMode).toBe("agzos");
    expect(parsePrefs({ pipMode: "nativo" }).pipMode).toBe("nativo");
    expect(parsePrefs({ pipMode: "outro" }).pipMode).toBe("agzos");
    const id = initialState.tabs[0]!.id;
    const on = browserReducer(initialState, { type: "view/video-window", id, active: true });
    expect(on.videoWindow).toEqual([id]);
    expect(
      browserReducer(on, { type: "view/video-window", id, active: false }).videoWindow,
    ).toEqual([]);
    expect(
      browserReducer(initialState, { type: "view/video-window", id: 999_999, active: true })
        .videoWindow,
    ).toEqual([]);
  });
});

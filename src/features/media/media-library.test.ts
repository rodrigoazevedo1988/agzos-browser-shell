// Biblioteca de mídia do main (electron/media-library.cjs): extensões, ordem natural, Range,
// raízes, listagem, URL do protocolo e a resposta 206/416 com um arquivo de verdade.

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const lib = createRequire(import.meta.url)(
  path.resolve(__dirname, "../../../electron/media-library.cjs"),
) as {
  compareNatural: (a: string, b: string) => number;
  filePathOfMediaUrl: (url: string, token: string) => string | null;
  installMedia: unknown;
  isMediaFile: (name: string, kind?: string) => boolean;
  listMedia: (
    dir: string,
    kind: string,
  ) => {
    error?: string;
    folders?: { name: string; path: string }[];
    items?: { name: string; path: string; ext: string }[];
    parent?: string | null;
  };
  mediaKindOf: (name: string) => string | null;
  mediaPageUrlOf: (file: string) => string | null;
  mediaResponse: (input: {
    url: string;
    method?: string;
    range?: string | null;
    token: string;
  }) => Response;
  mediaUrlOf: (file: string, token: string) => string | null;
  parseRange: (header: string | null, size: number) => Record<string, unknown>;
  rootsOf: (options: object) => { id: string; label: string; path: string }[];
  subtitleOf: (file: string) => { ext: string; name: string; text: string } | null;
};

const TOKEN = "0123456789abcdef0123456789abcdef";
let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "agzos-media-"));
  fs.mkdirSync(path.join(dir, "Série"));
  fs.mkdirSync(path.join(dir, ".oculta"));
  for (const name of [
    "Aula 10.mp4",
    "Aula 2.mp4",
    "Aula 1.MKV",
    "leia.txt",
    ".escondido.mp4",
    "faixa.flac",
  ]) {
    fs.writeFileSync(path.join(dir, name), name.includes("txt") ? "texto" : Buffer.alloc(1000, 7));
  }
  fs.writeFileSync(path.join(dir, "Aula 1.srt"), "1\n00:00:01,000 --> 00:00:02,000\nOi\n");
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("extensions", () => {
  it("recognises video and audio, ignoring case", () => {
    expect(lib.mediaKindOf("Filme.MKV")).toBe("video");
    expect(lib.mediaKindOf("musica.opus")).toBe("audio");
    expect(lib.mediaKindOf("doc.pdf")).toBeNull();
    expect(lib.isMediaFile("a.mp3", "video")).toBe(false);
    expect(lib.isMediaFile("a.mp3", "audio")).toBe(true);
  });
});

describe("natural sort", () => {
  it("puts Aula 2 before Aula 10", () => {
    const sorted = ["Aula 10", "Aula 2", "Aula 1"].sort(lib.compareNatural);
    expect(sorted).toEqual(["Aula 1", "Aula 2", "Aula 10"]);
  });
});

describe("parseRange", () => {
  it("handles open, closed and suffix ranges", () => {
    expect(lib.parseRange("bytes=0-", 100)).toEqual({ start: 0, end: 99 });
    expect(lib.parseRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(lib.parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(lib.parseRange("bytes=50-500", 100)).toEqual({ start: 50, end: 99 });
  });
  it("serves the whole file without a valid range", () => {
    expect(lib.parseRange(null, 100)).toEqual({ full: true });
    expect(lib.parseRange("items=1-2", 100)).toEqual({ full: true });
  });
  it("rejects ranges outside the file", () => {
    expect(lib.parseRange("bytes=200-", 100)).toEqual({ unsatisfiable: true });
    expect(lib.parseRange("bytes=5-2", 100)).toEqual({ unsatisfiable: true });
    expect(lib.parseRange("bytes=-0", 100)).toEqual({ unsatisfiable: true });
  });
});

describe("roots", () => {
  const exists = (wanted: string[]) => (p: string) => wanted.includes(p);
  it("lists Windows drives that exist", () => {
    const roots = lib.rootsOf({
      platform: "win32",
      home: "C:\\Users\\ana",
      known: {},
      exists: exists(["C:\\Users\\ana", "C:\\", "D:\\"]),
    });
    expect(roots.map((r) => r.label)).toEqual(["Início", "C:\\", "D:\\"]);
  });
  it("lists Mac volumes and Linux media mounts", () => {
    const mac = lib.rootsOf({
      platform: "darwin",
      home: "/Users/ana",
      known: { videos: "/Users/ana/Movies" },
      exists: exists(["/Users/ana", "/Users/ana/Movies", "/Volumes/Externo"]),
      listDirs: () => ["Externo"],
    });
    expect(mac.map((r) => r.path)).toEqual(["/Users/ana", "/Users/ana/Movies", "/Volumes/Externo"]);
    expect(mac[2]?.label).toBe("Externo");
    const linux = lib.rootsOf({
      platform: "linux",
      home: "/home/ana",
      known: {},
      exists: exists(["/home/ana", "/media", "/mnt"]),
    });
    expect(linux.map((r) => r.path)).toEqual(["/home/ana", "/media", "/mnt"]);
  });
});

describe("listing", () => {
  it("lists folders first and media files of the kind, natural sorted, hidden skipped", () => {
    const videos = lib.listMedia(dir, "video");
    expect(videos.error).toBeUndefined();
    expect(videos.folders?.map((f) => f.name)).toEqual(["Série"]);
    expect(videos.items?.map((i) => i.name)).toEqual(["Aula 1.MKV", "Aula 2.mp4", "Aula 10.mp4"]);
    expect(videos.parent).toBe(path.dirname(dir));
    const audio = lib.listMedia(dir, "audio");
    expect(audio.items?.map((i) => i.name)).toEqual(["faixa.flac"]);
  });
  it("reports missing folders and bad kinds", () => {
    expect(lib.listMedia(path.join(dir, "nope"), "video").error).toBe("missing");
    expect(lib.listMedia("relativo", "video").error).toBe("path");
    expect(lib.listMedia(dir, "image").error).toBe("kind");
  });
});

describe("protocol", () => {
  it("round-trips a path through the agzos-media URL", () => {
    const file = path.join(dir, "Aula 2.mp4");
    const url = lib.mediaUrlOf(file, TOKEN) as string;
    expect(url.startsWith(`agzos-media://${TOKEN}/`)).toBe(true);
    expect(lib.filePathOfMediaUrl(url, TOKEN)).toBe(file);
  });
  it("refuses a wrong token or a non-media file", () => {
    const url = lib.mediaUrlOf(path.join(dir, "Aula 2.mp4"), TOKEN) as string;
    expect(lib.filePathOfMediaUrl(url, "ffffffffffffffffffffffffffffffff")).toBeNull();
    expect(lib.mediaUrlOf(path.join(dir, "leia.txt"), TOKEN)).toBeNull();
    const txt = `agzos-media://${TOKEN}/${encodeURIComponent(path.join(dir, "leia.txt"))}`;
    expect(lib.filePathOfMediaUrl(txt, TOKEN)).toBeNull();
  });
  it("answers 206 with Content-Range for a Range request", async () => {
    const file = path.join(dir, "Aula 2.mp4");
    const url = lib.mediaUrlOf(file, TOKEN) as string;
    const response = lib.mediaResponse({ url, range: "bytes=0-99", token: TOKEN });
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 0-99/1000");
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(response.headers.get("Content-Type")).toBe("video/mp4");
    expect((await response.arrayBuffer()).byteLength).toBe(100);
  });
  it("answers 200 for a plain request and 416 for a bad range", () => {
    const url = lib.mediaUrlOf(path.join(dir, "Aula 2.mp4"), TOKEN) as string;
    expect(lib.mediaResponse({ url, token: TOKEN }).status).toBe(200);
    expect(lib.mediaResponse({ url, range: "bytes=5000-", token: TOKEN }).status).toBe(416);
    expect(lib.mediaResponse({ url, method: "HEAD", token: TOKEN }).status).toBe(200);
  });
  it("answers 404 for a missing file and 403 for a bad token", () => {
    const url = lib.mediaUrlOf(path.join(dir, "sumiu.mp4"), TOKEN) as string;
    expect(lib.mediaResponse({ url, token: TOKEN }).status).toBe(404);
    expect(lib.mediaResponse({ url, token: "nope" }).status).toBe(403);
  });
});

describe("hand-off to the library pages and subtitles", () => {
  it("routes video to videos and audio to musica", () => {
    expect(lib.mediaPageUrlOf("/a b/Filme.mp4")).toBe("agzos://videos?file=%2Fa%20b%2FFilme.mp4");
    expect(lib.mediaPageUrlOf("/a/faixa.mp3")).toBe("agzos://musica?file=%2Fa%2Ffaixa.mp3");
    expect(lib.mediaPageUrlOf("/a/texto.txt")).toBeNull();
  });
  it("finds the same-name subtitle, SRT or VTT", () => {
    const found = lib.subtitleOf(path.join(dir, "Aula 1.MKV"));
    expect(found?.ext).toBe("srt");
    expect(found?.text).toContain("Oi");
    expect(lib.subtitleOf(path.join(dir, "Aula 2.mp4"))).toBeNull();
  });
});

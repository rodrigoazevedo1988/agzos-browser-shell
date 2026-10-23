import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

// O módulo do main é CJS (electron/image-studio.cjs): carregado como o capture.test faz.
const require = createRequire(import.meta.url);
const studio = require(path.join(process.cwd(), "electron", "image-studio.cjs")) as {
  createImageGrants: (io: {
    readFile: (file: string) => Buffer;
    statFile: (file: string) => { isFile: () => boolean; size: number };
    random?: (size: number) => Buffer;
  }) => {
    grantFile: (file: string) => string | null;
    grantBytes: (buffer: Buffer, name?: string) => string | null;
    read: (token: string) => { name: string; mime: string; dataUrl: string } | null;
    stage: (dataUrl: string, name?: string) => string | null;
    size: () => number;
  };
  decodeDataUrl: (value: string) => Buffer | null;
  exportFormatOf: (name: string) => { ext: string; mime: string } | null;
  fetchImage: unknown;
  readMimeOf: (file: string) => string | null;
  safeFileName: (name: string, fallback?: string) => string;
  sniffImage: (buffer: Buffer) => string | null;
};

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.alloc(4),
  Buffer.from("WEBPVP8 "),
  Buffer.alloc(8),
]);

describe("reconhecimento de imagem", () => {
  it("reconhece pelo conteúdo, não pela extensão", () => {
    expect(studio.sniffImage(PNG)).toBe("image/png");
    expect(studio.sniffImage(JPEG)).toBe("image/jpeg");
    expect(studio.sniffImage(WEBP)).toBe("image/webp");
    expect(studio.sniffImage(Buffer.from("<svg xmlns=..></svg>............"))).toBeNull();
    expect(studio.sniffImage(Buffer.alloc(4))).toBeNull();
  });

  it("só lê extensões de imagem, sem SVG", () => {
    expect(studio.readMimeOf("/a/foto.JPG")).toBe("image/jpeg");
    expect(studio.readMimeOf("/a/logo.svg")).toBeNull();
    expect(studio.readMimeOf("/a/index.html")).toBeNull();
  });

  it("exporta só PNG, JPEG ou WebP", () => {
    expect(studio.exportFormatOf("arte.webp")).toEqual({ ext: "webp", mime: "image/webp" });
    expect(studio.exportFormatOf("arte.exe")).toBeNull();
    expect(studio.exportFormatOf("arte")).toBeNull();
  });

  it("nomes de arquivo ficam sem pasta e sem caracteres proibidos", () => {
    expect(studio.safeFileName("../../etc/passwd")).toBe("passwd");
    expect(studio.safeFileName('a:b*c?"d".png')).toBe("a_b_c__d_.png");
    expect(studio.safeFileName("", "padrao")).toBe("padrao");
    expect(studio.safeFileName("x".repeat(300)).length).toBe(120);
  });

  it("decodifica só PNG e JPEG em base64 de data URL", () => {
    expect(studio.decodeDataUrl(`data:image/png;base64,${PNG.toString("base64")}`)).toEqual(PNG);
    expect(studio.decodeDataUrl("data:image/svg+xml;base64,AAAA")).toBeNull();
    expect(studio.decodeDataUrl("data:image/png;base64,<x>")).toBeNull();
  });
});

describe("grants (tokens de imagem)", () => {
  const files: Record<string, Buffer> = {
    "/fotos/a.png": PNG,
    "/fotos/falsa.png": Buffer.from("<script>alert(1)</script>"),
    "/fotos/pasta.png/": Buffer.alloc(0),
  };
  const io = {
    readFile: (file: string) => {
      const found = files[file];
      if (!found) throw new Error("ENOENT");
      return found;
    },
    statFile: (file: string) => {
      const found = files[file];
      if (!found) throw new Error("ENOENT");
      return { isFile: () => !file.endsWith("/"), size: found.length };
    },
  };

  it("arquivo de imagem vira grant; o conteúdo é lido pelo token", () => {
    const grants = studio.createImageGrants(io);
    const token = grants.grantFile("/fotos/a.png");
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    const image = grants.read(token!);
    expect(image).toMatchObject({ name: "a.png", mime: "image/png" });
    expect(image!.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("recusa arquivo com extensão de imagem mas conteúdo de outra coisa, e caminho relativo", () => {
    const grants = studio.createImageGrants(io);
    expect(grants.grantFile("/fotos/falsa.png")).toBeNull();
    expect(grants.grantFile("fotos/a.png")).toBeNull();
    expect(grants.grantFile("/fotos/inexistente.png")).toBeNull();
    expect(grants.read("token-que-nao-existe")).toBeNull();
  });

  it("bytes baixados ou da captura viram grant pelo conteúdo", () => {
    const grants = studio.createImageGrants(io);
    expect(grants.grantBytes(Buffer.from("texto"))).toBeNull();
    const token = grants.stage(`data:image/png;base64,${PNG.toString("base64")}`, "Captura 1");
    expect(token).not.toBeNull();
    expect(grants.read(token!)).toMatchObject({ name: "Captura 1", mime: "image/png" });
  });

  it("guarda no máximo 32 grants e descarta o mais antigo", () => {
    let counter = 0;
    const grants = studio.createImageGrants({
      ...io,
      random: () => Buffer.from(String(counter++).padStart(32, "0"), "hex").subarray(0, 16),
    });
    const first = grants.grantBytes(PNG, "a");
    for (let index = 0; index < 32; index += 1) grants.grantBytes(PNG, `n${index}`);
    expect(grants.size()).toBe(32);
    expect(grants.read(first!)).toBeNull();
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { languageForFile, modeOf, stampOf, zoomPercent, clampFontSize } from "./language";
import { addRecent, parsePrefs, DEFAULT_PREFS } from "./prefs";
import { editorParamsOf, editorTitleOf, editorUrlOf, isEditorUrl, withEditorSession } from "./url";

// 5.0.3: editor de texto. O main (electron/editor-files.cjs) é CommonJS; o teste o carrega
// como os outros (createRequire), e a parte de renderização é pura.
const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const editor = require(path.join(root, "electron/editor-files.cjs")) as {
  createAccess: () => {
    allow: (ctx: object, file: string) => boolean;
    allowed: (ctx: object, file: string) => boolean;
  };
  createEditorService: (options?: object) => {
    read: (ctx: object, file: string) => Record<string, unknown>;
    save: (ctx: object, payload: Record<string, unknown>) => Record<string, unknown>;
    stat: (ctx: object, file: string) => Record<string, unknown>;
    watchFile: (ctx: object, file: string, onChange: (file: string) => void) => boolean;
    unwatchFile: (ctx: object, file: string) => boolean;
  };
  decodeBuffer: (buffer: Buffer, encoding: string) => string;
  detectEncoding: (buffer: Buffer) => string | null;
  detectEol: (text: string) => "lf" | "crlf";
  editorKindOf: (file: string, options?: { read?: (file: string) => string }) => string | null;
  editorUrlOf: (file: string) => string;
  encodeText: (text: string, encoding: string) => { buffer: Buffer; lossy: number };
  fileOfEditorUrl: (url: string) => string | null;
  normalizeEol: (text: string, eol: string) => string;
};

describe("codificação e fim de linha (main)", () => {
  it("reconhece BOM de UTF-8 e UTF-16 e UTF-8 sem BOM", () => {
    expect(editor.detectEncoding(Buffer.from([0xef, 0xbb, 0xbf, 0x61]))).toBe("utf-8-bom");
    expect(editor.detectEncoding(Buffer.from([0xff, 0xfe, 0x61, 0x00]))).toBe("utf-16le");
    expect(editor.detectEncoding(Buffer.from([0xfe, 0xff, 0x00, 0x61]))).toBe("utf-16be");
    expect(editor.detectEncoding(Buffer.from("olá, mundo", "utf8"))).toBe("utf-8");
  });

  it("sem BOM e fora do UTF-8 válido cai no Latin-1 (Windows-1252); binário não entra", () => {
    expect(editor.detectEncoding(Buffer.from([0x63, 0x61, 0x66, 0xe9]))).toBe("latin1");
    expect(editor.detectEncoding(Buffer.from([0x61, 0x00, 0x62]))).toBeNull();
    expect(editor.detectEncoding(Buffer.alloc(0))).toBe("utf-8");
  });

  it("decodifica e codifica de volta em cada codificação", () => {
    const sample = "Ação: 10 € — “ok”";
    for (const encoding of ["utf-8", "utf-8-bom", "utf-16le", "utf-16be"]) {
      const { buffer, lossy } = editor.encodeText(sample, encoding);
      expect(lossy).toBe(0);
      expect(editor.decodeBuffer(buffer, editor.detectEncoding(buffer) ?? encoding)).toBe(sample);
    }
    const latin = editor.encodeText("café € ok", "latin1");
    expect(latin.lossy).toBe(0);
    expect([...latin.buffer]).toEqual([0x63, 0x61, 0x66, 0xe9, 0x20, 0x80, 0x20, 0x6f, 0x6b]);
    expect(editor.decodeBuffer(latin.buffer, "latin1")).toBe("café € ok");
  });

  it("Latin-1 avisa caracteres que não cabem (viram '?')", () => {
    const { buffer, lossy } = editor.encodeText("ok ☃ ok", "latin1");
    expect(lossy).toBe(1);
    expect(buffer.toString("latin1")).toBe("ok ? ok");
  });

  it("detecta fim de linha pela maioria e normaliza para o escolhido", () => {
    expect(editor.detectEol("a\r\nb\r\nc\n")).toBe("crlf");
    expect(editor.detectEol("a\nb\r\nc\n")).toBe("lf");
    expect(editor.normalizeEol("a\r\nb\rc\n", "crlf")).toBe("a\r\nb\r\nc\r\n");
    expect(editor.normalizeEol("a\r\nb", "lf")).toBe("a\nb");
  });
});

describe("arquivos que o editor abre (main)", () => {
  it("texto e código entram; HTML, SVG, PDF e imagens ficam com o Chromium", () => {
    expect(editor.editorKindOf("/x/app.ts")).toBe("text");
    expect(editor.editorKindOf("/x/notas.md")).toBe("text");
    expect(editor.editorKindOf("/x/log.txt")).toBe("text");
    expect(editor.editorKindOf("/x/Dockerfile")).toBe("text");
    expect(editor.editorKindOf("/x/pagina.html")).toBeNull();
    expect(editor.editorKindOf("/x/desenho.svg")).toBeNull();
    expect(editor.editorKindOf("/x/manual.pdf")).toBeNull();
    expect(editor.editorKindOf("/x/foto.png")).toBeNull();
  });

  it("extensão desconhecida: lê o começo do arquivo", () => {
    expect(editor.editorKindOf("/x/dados.zzz", { read: () => "text" })).toBe("text");
    expect(editor.editorKindOf("/x/dados.zzz", { read: () => "binary" })).toBeNull();
  });

  it("URL do editor vai e volta com o caminho (inclusive com espaço e acento)", () => {
    const file = "/home/ana/Área de trabalho/nota & ideia.md";
    const url = editor.editorUrlOf(file);
    expect(url.startsWith("agzos://editor?file=")).toBe(true);
    expect(editor.fileOfEditorUrl(url)).toBe(file);
    expect(editor.fileOfEditorUrl("agzos://editor")).toBeNull();
    expect(editor.fileOfEditorUrl("agzos://editor?file=relativo.txt")).toBeNull();
  });
});

describe("allowlist por janela", () => {
  it("só grava o que a janela abriu ou escolheu; outra janela não herda", () => {
    const access = editor.createAccess();
    const windowA = {};
    const windowB = {};
    const file = path.resolve("/tmp/agzos-allow-test.txt");
    expect(access.allowed(windowA, file)).toBe(false);
    access.allow(windowA, file);
    expect(access.allowed(windowA, file)).toBe(true);
    expect(access.allowed(windowB, file)).toBe(false);
  });

  it("caminhos relativos e vazios nunca entram", () => {
    const access = editor.createAccess();
    const ctx = {};
    expect(access.allow(ctx, "relativo.txt")).toBe(false);
    expect(access.allow(ctx, "")).toBe(false);
    expect(access.allow(null as unknown as object, "/tmp/x.txt")).toBe(false);
    expect(access.allowed(ctx, "relativo.txt")).toBe(false);
  });
});

describe("serviço de leitura e gravação (main)", () => {
  let dir = "";
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "agzos-editor-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("lê, detecta codificação e fim de linha, e grava só em arquivo permitido", () => {
    const service = editor.createEditorService();
    const ctx = {};
    const file = path.join(dir, "notas.txt");
    fs.writeFileSync(file, Buffer.from("linha 1\r\nlinha 2\r\n", "utf8"));

    const read = service.read(ctx, file) as {
      ok: boolean;
      text: string;
      eol: string;
      encoding: string;
    };
    expect(read.ok).toBe(true);
    expect(read.text).toBe("linha 1\nlinha 2\n");
    expect(read.eol).toBe("crlf");
    expect(read.encoding).toBe("utf-8");

    // Gravação sem leitura ou escolha nesta janela é recusada.
    expect(service.save({}, { path: file, text: "x", encoding: "utf-8", eol: "lf" })).toEqual({
      ok: false,
      error: "forbidden",
    });
    const saved = service.save(ctx, {
      path: file,
      text: "novo\ntexto",
      encoding: "utf-8-bom",
      eol: "crlf",
    });
    expect(saved["ok"]).toBe(true);
    expect(fs.readFileSync(file).subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(fs.readFileSync(file, "utf8").slice(1)).toBe("novo\r\ntexto");
  });

  it("recusa binário e codificação ou fim de linha inválidos", () => {
    const service = editor.createEditorService();
    const ctx = {};
    const bin = path.join(dir, "dados.bin");
    fs.writeFileSync(bin, Buffer.from([0x00, 0x01, 0x02, 0x00]));
    expect(service.read(ctx, bin)).toEqual({ ok: false, error: "binary" });
    const txt = path.join(dir, "a.txt");
    fs.writeFileSync(txt, "a");
    service.read(ctx, txt);
    expect(service.save(ctx, { path: txt, text: "b", encoding: "ebcdic", eol: "lf" })).toEqual({
      ok: false,
      error: "encoding",
    });
    expect(service.save(ctx, { path: txt, text: "b", encoding: "utf-8", eol: "cr" })).toEqual({
      ok: false,
      error: "eol",
    });
  });

  it("vigia o arquivo: uma mudança avisa uma vez, e desvigiar para o aviso", async () => {
    const events: Array<{ file: string; listener: () => void }> = [];
    const fakeWatch = (file: string, listener: () => void) => {
      events.push({ file, listener });
      return { close() {}, on() {} };
    };
    const service = editor.createEditorService({ watch: fakeWatch });
    const ctx = {};
    const file = path.join(dir, "vigiado.md");
    fs.writeFileSync(file, "x");
    service.read(ctx, file);
    const seen: string[] = [];
    expect(service.watchFile(ctx, file, (changed) => seen.push(changed))).toBe(true);
    events[0]!.listener();
    events[0]!.listener();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(seen).toEqual([path.resolve(file)]);
    expect(service.unwatchFile(ctx, file)).toBe(true);
    expect(service.unwatchFile(ctx, file)).toBe(false);
  });

  it("stat informa se o arquivo ainda existe", () => {
    const service = editor.createEditorService();
    const ctx = {};
    const file = path.join(dir, "some.txt");
    fs.writeFileSync(file, "a");
    service.read(ctx, file);
    expect(service.stat(ctx, file)).toMatchObject({ ok: true, exists: true });
    fs.rmSync(file);
    expect(service.stat(ctx, file)).toMatchObject({ ok: true, exists: false });
    expect(service.stat({}, file)).toMatchObject({ ok: false, error: "forbidden" });
  });
});

describe("idioma e modo (renderização)", () => {
  it("idioma pelo nome exato e depois pela extensão", () => {
    expect(languageForFile("app.ts")).toBe("typescript");
    expect(languageForFile("APP.TSX")).toBe("typescriptreact");
    expect(languageForFile("pacote.json")).toBe("json");
    expect(languageForFile("leia-me.md")).toBe("markdown");
    expect(languageForFile("Dockerfile")).toBe("dockerfile");
    expect(languageForFile("config.ini")).toBe("ini");
    expect(languageForFile("sem-extensao")).toBe("plaintext");
    expect(languageForFile("dados.csv")).toBe("plaintext");
    expect(languageForFile("C:\\pasta\\x.py")).toBe("python");
  });

  it("usa a lista do Monaco quando ela é passada", () => {
    const list = [{ id: "custom", extensions: [".xyz"] }];
    expect(languageForFile("a.xyz", list)).toBe("custom");
    expect(languageForFile("a.ts", list)).toBe("plaintext");
  });

  it("texto simples abre no bloco de notas; código no modo código", () => {
    expect(modeOf("plaintext")).toBe("notepad");
    expect(modeOf("ini")).toBe("notepad");
    expect(modeOf("typescript")).toBe("code");
    expect(modeOf("markdown")).toBe("code");
  });

  it("zoom e data/hora como no Bloco de Notas", () => {
    expect(zoomPercent(14)).toBe(100);
    expect(zoomPercent(28)).toBe(200);
    expect(clampFontSize(99)).toBe(40);
    expect(clampFontSize(1)).toBe(8);
    expect(stampOf(new Date(2026, 9, 3, 7, 5))).toBe("07:05 03/10/2026");
  });
});

describe("URL, sessão e preferências", () => {
  it("monta, lê e titula a URL do editor", () => {
    const url = editorUrlOf({ file: "/tmp/relatorio final.txt", session: "abc123" });
    expect(isEditorUrl(url)).toBe(true);
    expect(editorParamsOf(url)).toEqual({ file: "/tmp/relatorio final.txt", session: "abc123" });
    expect(editorTitleOf(url)).toBe("relatorio final.txt");
    expect(editorTitleOf("agzos://editor")).toBe("Editor de texto");
    expect(isEditorUrl("agzos://editorial")).toBe(false);
  });

  it("garante uma sessão na URL aberta de fora, sem trocar a que já existe", () => {
    const fresh = withEditorSession("agzos://editor?file=/tmp/a.ts", () => "novasessao");
    expect(editorParamsOf(fresh)).toEqual({ file: "/tmp/a.ts", session: "novasessao" });
    const kept = withEditorSession(fresh, () => "outra");
    expect(kept).toBe(fresh);
  });

  it("preferências: valores ruins voltam ao padrão, recentes sem repetir", () => {
    expect(parsePrefs("não é json")).toEqual(DEFAULT_PREFS);
    expect(
      parsePrefs(JSON.stringify({ fontSize: 500, view: "x", fontFamily: "Comic" })),
    ).toMatchObject({
      fontSize: DEFAULT_PREFS.fontSize,
      view: "split",
      fontFamily: DEFAULT_PREFS.fontFamily,
    });
    expect(addRecent(["/a", "/b"], "/b")).toEqual(["/b", "/a"]);
    expect(
      addRecent(
        Array.from({ length: 10 }, (_, i) => `/f${i}`),
        "/novo",
      ),
    ).toHaveLength(10);
  });
});

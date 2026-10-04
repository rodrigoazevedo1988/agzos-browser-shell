import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";

import {
  addToHistory,
  emptyColorLibrary,
  formatColor,
  gradientCss,
  hexOfRgb,
  hslOfRgb,
  importColorLibrary,
  exportColorLibrary,
  parseColor,
  parseColorLibrary,
  rgbOfHex,
  rgbOfHsl,
  searchHistory,
} from "@/features/colors/color";
import type { DownloadRecord } from "./desktop";
import {
  filterDownloads,
  managerKeyAction,
  statusCounts,
  statusGroupOf,
  tagColorOf,
  tagsInUse,
  typeOfDownload,
} from "@/features/downloads/filters";
import {
  addOcrLayer,
  addWatermark,
  applyEdits,
  chunkPages,
  compressPdf,
  fillForm,
  imagesToPdf,
  isEncrypted,
  mergePdfs,
  organizePdf,
  parsePageRanges,
  pdfInfo,
  placementOf,
  protectPdf,
  splitPdf,
  unprotectPdf,
  winAnsiText,
  PdfPasswordError,
} from "@/features/pdf/engine";
import { commands } from "./commands";
import {
  FEATURE_SHORTCUTS,
  cleanCombo,
  comboLabel,
  comboOfEvent,
  comboOfHotkey,
  defaultFeaturePrefs,
  featureOfCombo,
  parseFeaturePrefs,
  themeIsDark,
} from "./feature-prefs";
import { parsePrefs } from "./persistence/snapshot";
import { resolveInput } from "./omnibox-input";
import { TOOLS } from "@/features/tools/tools";
import { createDownloadsApi } from "@/features/downloads/api";

// 4.7: gerenciador de downloads, tema da página por domínio, ColorTools e PDF Tools.
const require = createRequire(import.meta.url);
const electronDir = path.join(process.cwd(), "electron");
const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

const rules = require(path.join(electronDir, "download-rules.cjs")) as {
  fileTypeOf: (name: string, mime?: string) => string;
  defaultTypeFolders: (dirs: Record<string, string>) => Record<string, string>;
  parseDownloadsConfig: (
    raw: unknown,
    dirs: Record<string, string>,
  ) => {
    dir: string;
    byTypeOn: boolean;
    byType: Record<string, string>;
    rules: {
      id: string;
      match: string;
      pattern: string;
      tag: string;
      folder: string;
      subfolder: string;
      enabled: boolean;
    }[];
    tagColors: Record<string, string>;
  };
  routeDownload: (
    config: ReturnType<typeof rules.parseDownloadsConfig>,
    info: { filename: string; mime?: string; url?: string },
    fallback: string,
  ) => { type: string; dir: string; tags: string[]; rules: string[] };
  exportDownloads: (rows: unknown[], format: "json" | "csv") => string;
  cleanTags: (list: unknown) => string[];
  safeSubfolder: (value: unknown) => string;
};
const theme = require(path.join(electronDir, "page-theme.cjs")) as {
  registrableDomain: (host: string) => string | null;
  themeDomainOf: (url: string) => string | null;
  parseThemeMap: (raw: unknown) => Record<string, string>;
  modeOf: (map: Record<string, string>, domain: string | null) => string;
  isDarkMode: (mode: string, systemDark: boolean) => boolean;
  nextMode: (mode: string, systemDark: boolean) => string;
  DARK_CSS: string;
  BASE_CSS: string;
  pageThemeAdjustSource: () => string;
};
const colorTools = require(path.join(electronDir, "color-tools.cjs")) as {
  pickOfTitle: (
    title: string,
  ) => { cancel: boolean; color?: { r: number; g: number; b: number } } | null;
  hexOf: (rgb: { r: number; g: number; b: number }) => string;
  rgbOfBitmap: (bitmap: Uint8Array, offset?: number) => { r: number; g: number; b: number };
  colorAnalyzeSource: (limit?: number) => string;
  PICKER_PAGE: string;
};
const pdfTools = require(path.join(electronDir, "pdf-tools.cjs")) as {
  safeFileName: (name: unknown, fallback?: string) => string;
  cloudTargets: (deps: object) => { id: string; name: string; dir: string }[];
  findOffice: (deps: object) => string | null;
  createPdfTools: (deps: object) => {
    sealPassword: (password: string) => string | null;
    openPassword: (sealed: string) => string | null;
    readFile: (file: string, max: number) => { ok: boolean; error?: string };
    canOverwrite: (file: string) => boolean;
    startSession: () => { id: string };
    endSession: (id: string) => void;
    ocrAsset: (name: string) => ArrayBuffer | null;
    ocrLanguages: () => { bundled: string[]; downloaded: string[] };
  };
};

const DIRS = {
  downloads: "/home/u/Downloads",
  documents: "/home/u/Documentos",
  pictures: "/home/u/Imagens",
  videos: "/home/u/Vídeos",
  music: "/home/u/Música",
};

const record = (patch: Partial<DownloadRecord>): DownloadRecord => ({
  id: 1,
  url: "https://example.com/a.pdf",
  filename: "a.pdf",
  path: "/tmp/a.pdf",
  mime: "application/pdf",
  totalBytes: 10,
  receivedBytes: 10,
  state: "completed",
  startedAt: 1,
  endedAt: 2,
  private: false,
  paused: false,
  canResume: false,
  ...patch,
});

describe("4.7: gerenciador de downloads (regras puras do main)", () => {
  it("tipo pelo MIME e pela extensão", () => {
    expect(rules.fileTypeOf("x.bin", "application/pdf")).toBe("pdf");
    expect(rules.fileTypeOf("foto.JPG")).toBe("image");
    expect(rules.fileTypeOf("filme.mkv")).toBe("video");
    expect(rules.fileTypeOf("musica.flac")).toBe("audio");
    expect(rules.fileTypeOf("pacote.tar.gz")).toBe("archive");
    expect(rules.fileTypeOf("arquivo", "application/x-7z-compressed")).toBe("archive");
    expect(rules.fileTypeOf("notas.txt", "text/plain")).toBe("other");
  });

  it("pastas por tipo do PRD a partir das pastas do sistema", () => {
    const folders = rules.defaultTypeFolders(DIRS);
    expect(folders["pdf"]).toBe(path.join(DIRS.documents, "Agzos", "PDF"));
    expect(folders["image"]).toBe(path.join(DIRS.pictures, "Agzos"));
    expect(folders["archive"]).toBe(path.join(DIRS.downloads, "Arquivos"));
    expect(folders["other"]).toBe(DIRS.downloads);
  });

  it("configuração inválida volta ao padrão; regras ruins saem", () => {
    const config = rules.parseDownloadsConfig(
      {
        dir: "relativa/nao",
        byTypeOn: "sim",
        byType: { pdf: "/abs/pdf", image: "nao/absoluta" },
        rules: [
          { match: "domain", pattern: "github.com", tag: "código" },
          { match: "name", pattern: "([", tag: "x" },
          { match: "type", pattern: "pdf" },
          { match: "outro", pattern: "a", tag: "b" },
          { match: "name", pattern: "^Nota", subfolder: "../../etc/Notas" },
        ],
        tagColors: { código: "#00ff00", ruim: "verde" },
      },
      DIRS,
    );
    expect(config.dir).toBe("");
    expect(config.byTypeOn).toBe(false);
    expect(config.byType["pdf"]).toBe(path.normalize("/abs/pdf"));
    expect(config.byType["image"]).toBe(path.join(DIRS.pictures, "Agzos"));
    expect(config.rules.map((rule) => rule.match)).toEqual(["domain", "name"]);
    // Subpasta nunca sai da pasta de destino.
    expect(config.rules[1]!.subfolder).toBe(path.join("etc", "Notas"));
    expect(config.tagColors).toEqual({ código: "#00ff00" });
  });

  it("rota: pasta global, do tipo e das regras (etiqueta por domínio, subpasta por nome)", () => {
    const config = rules.parseDownloadsConfig(
      {
        dir: "/dl",
        byTypeOn: true,
        byType: { pdf: "/docs/pdf" },
        rules: [
          { id: "a", match: "domain", pattern: "github.com", tag: "código" },
          { id: "b", match: "name", pattern: "^NF-\\d+", subfolder: "Notas", tag: "fiscal" },
          { id: "c", match: "type", pattern: ".zip, image/*", folder: "/compactados" },
          { id: "d", match: "domain", pattern: "x.com", tag: "nunca", enabled: false },
        ],
      },
      DIRS,
    );
    expect(
      rules.routeDownload(
        config,
        { filename: "NF-123.pdf", mime: "application/pdf", url: "https://api.github.com/f" },
        "/fb",
      ),
    ).toEqual({
      type: "pdf",
      dir: path.join("/docs/pdf", "Notas"),
      tags: ["código", "fiscal"],
      rules: ["a", "b"],
    });
    expect(
      rules.routeDownload(config, { filename: "pacote.zip", url: "https://x.com/p" }, "/fb").dir,
    ).toBe("/compactados");
    expect(
      rules.routeDownload(config, { filename: "foto.png", mime: "image/png" }, "/fb").dir,
    ).toBe("/compactados");
    expect(rules.routeDownload(config, { filename: "leia.txt" }, "/fb").dir).toBe(
      path.normalize(DIRS.downloads),
    );
    const plain = rules.parseDownloadsConfig({}, DIRS);
    expect(
      rules.routeDownload(plain, { filename: "a.pdf", mime: "application/pdf" }, "/fb").dir,
    ).toBe("/fb");
  });

  it("etiquetas sem repetir, curtas e no máximo 12", () => {
    expect(rules.cleanTags([" Fiscal ", "fiscal", "", 3, "a".repeat(50)])).toEqual([
      "Fiscal",
      "a".repeat(32),
    ]);
    expect(rules.cleanTags(Array.from({ length: 20 }, (_v, i) => `t${i}`))).toHaveLength(12);
  });

  it("exportação JSON/CSV só com metadados e CSV sem fórmula", () => {
    const rows = [
      {
        id: 1,
        filename: '=HYPERLINK("x")',
        url: "https://a.com/f",
        path: "/x",
        mime: "",
        state: "completed",
        totalBytes: 5,
        receivedBytes: 5,
        tags: ["a", "b"],
        startedAt: 0,
        endedAt: null,
      },
    ];
    const csv = rules.exportDownloads(rows, "csv");
    expect(csv.split("\r\n")[0]).toBe(
      "id,filename,url,path,mime,type,state,totalBytes,receivedBytes,tags,startedAt,endedAt",
    );
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain("a|b");
    const json = JSON.parse(rules.exportDownloads(rows, "json"));
    expect(json.kind).toBe("downloads");
    expect(json.items[0].tags).toEqual(["a", "b"]);
  });

  it("filtros, contagem, busca e teclas do gerenciador", () => {
    const list = [
      record({ id: 1, filename: "contrato.pdf", tags: ["Jurídico"] }),
      record({
        id: 2,
        filename: "video.mp4",
        mime: "video/mp4",
        state: "progressing",
        paused: true,
        url: "https://cdn.site.com/v",
      }),
      record({ id: 3, filename: "foto.png", mime: "image/png", state: "progressing" }),
      record({ id: 4, filename: "x.zip", mime: "", state: "cancelled" }),
      record({ id: 5, filename: "y.bin", mime: "", state: "interrupted" }),
    ];
    expect(statusCounts(list)).toEqual({ all: 5, running: 1, paused: 1, completed: 1, failed: 2 });
    expect(statusGroupOf(list[3]!)).toBe("failed");
    expect(typeOfDownload({ filename: "x.zip", mime: "" })).toBe("archive");
    expect(
      filterDownloads(list, { status: "failed", type: "all", tag: null, query: "" }).map(
        (r) => r.id,
      ),
    ).toEqual([4, 5]);
    expect(
      filterDownloads(list, { status: "all", type: "video", tag: null, query: "" }).map(
        (r) => r.id,
      ),
    ).toEqual([2]);
    expect(
      filterDownloads(list, { status: "all", type: "all", tag: "jurídico", query: "" }).map(
        (r) => r.id,
      ),
    ).toEqual([1]);
    // Busca por domínio, etiqueta e sem acento.
    expect(
      filterDownloads(list, { status: "all", type: "all", tag: null, query: "cdn.site" }).map(
        (r) => r.id,
      ),
    ).toEqual([2]);
    expect(
      filterDownloads(list, {
        status: "all",
        type: "all",
        tag: null,
        query: "juridico contrato",
      }).map((r) => r.id),
    ).toEqual([1]);
    expect(tagsInUse(list)).toEqual(["Jurídico"]);
    expect(tagColorOf("Jurídico", {})).toBe(tagColorOf("Jurídico", {}));
    expect(tagColorOf("x", { x: "#123456" })).toBe("#123456");
    const key = (k: string, shift = false) => ({
      key: k,
      shiftKey: shift,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
    });
    expect(managerKeyAction(key(" "), list[2]!)).toBe("toggle");
    expect(managerKeyAction(key("Delete"), list[2]!)).toBe("cancel");
    expect(managerKeyAction(key("Delete", true), list[0]!)).toBe("remove");
    expect(managerKeyAction(key("Delete", true), list[2]!)).toBeNull();
    expect(managerKeyAction(key("r"), list[3]!)).toBe("restart");
    expect(managerKeyAction(key("Enter"), list[0]!)).toBe("open");
    expect(managerKeyAction(key("f"), null)).toBe("search");
    expect(managerKeyAction({ ...key("f"), ctrlKey: true }, null)).toBeNull();
  });

  it("migração 5 (etiquetas e dados do Range) e o gerenciador no main", () => {
    const db = read("electron/db.cjs");
    expect(db).toMatch(/version: 5,\s+name: "downloads_manager"/);
    expect(db).toContain("ALTER TABLE downloads ADD COLUMN tags");
    expect(db).toContain('"colors"');
    const main = read("electron/main.cjs");
    for (const channel of [
      "downloads:config",
      "downloads:set-config",
      "downloads:export",
      "downloads:import-rules",
    ]) {
      expect(main).toContain(`"${channel}"`);
    }
    const manager = read("electron/downloads.cjs");
    expect(manager).toContain("restart(id)");
    expect(manager).toContain("setDestination(id, dir)");
    expect(manager).toContain("item.getETag()");
  });

  it("Ctrl+J abre o gerenciador; agzos://downloads é uma página da casca", () => {
    expect(resolveInput("agzos://downloads", "duckduckgo")).toEqual({
      title: "Downloads",
      url: "agzos://downloads",
      kind: "internal",
    });
    expect(commands.find((item) => item.id === "downloads.toggle")!.shortcuts).toEqual([
      { key: "j" },
    ]);
    expect(TOOLS.map((tool) => tool.id)).toEqual(
      expect.arrayContaining(["downloads.toggle", "colors.panel", "pdf.open"]),
    );
  });
});

describe("4.7: tema da página por domínio", () => {
  it("domínio registrável (sufixos de dois níveis, IP e localhost)", () => {
    expect(theme.registrableDomain("www.a.example.com")).toBe("example.com");
    expect(theme.registrableDomain("loja.exemplo.com.br")).toBe("exemplo.com.br");
    expect(theme.registrableDomain("user.github.io")).toBe("user.github.io");
    expect(theme.registrableDomain("127.0.0.1")).toBe("127.0.0.1");
    expect(theme.registrableDomain("localhost")).toBe("localhost");
    expect(theme.themeDomainOf("https://news.bbc.co.uk/x")).toBe("bbc.co.uk");
    expect(theme.themeDomainOf("agzos://inicio")).toBeNull();
    expect(theme.themeDomainOf("file:///tmp/a.html")).toBeNull();
  });

  it("modo por domínio, padrão Lightning, Auto segue o sistema", () => {
    const map = theme.parseThemeMap({
      "WWW.Example.com": "dark",
      "b.com": "lightning",
      "c.com": "auto",
      "d.com": "roxo",
    });
    expect(map).toEqual({ "example.com": "dark", "c.com": "auto" });
    expect(theme.modeOf(map, "outro.com")).toBe("lightning");
    expect(theme.isDarkMode("auto", true)).toBe(true);
    expect(theme.isDarkMode("auto", false)).toBe(false);
    expect(theme.nextMode("lightning", false)).toBe("dark");
    expect(theme.nextMode("auto", true)).toBe("lightning");
  });

  it("CSS: inverte a luminância e devolve mídia, canvas, iframes e logos ao original", () => {
    expect(theme.DARK_CSS).toContain("html { filter: invert(1) hue-rotate(180deg) !important; }");
    for (const selector of [
      "img",
      "video",
      "canvas",
      "picture",
      "iframe",
      "[data-agzos-no-theme]",
      "[data-agzos-keep]",
    ]) {
      expect(theme.DARK_CSS).toContain(selector);
    }
    // Dentro do que já voltou, não inverte de novo; tela cheia fica fora.
    expect(theme.DARK_CSS).toContain(
      ":not(:is(picture, [data-agzos-no-theme], [data-agzos-keep]) *)",
    );
    expect(theme.DARK_CSS).toContain(":fullscreen");
    // O ajuste só lê estilos e marca atributos (sem innerHTML, sem rede).
    const source = theme.pageThemeAdjustSource();
    expect(source).not.toMatch(/innerHTML|fetch\(|XMLHttpRequest/);
    expect(source).toContain("4.5");
    const main = read("electron/main.cjs");
    expect(main).toContain("pageTheme.PAGE_THEME_WORLD");
    expect(main).toContain('nativeTheme.on("updated"');
  });

  it("contraste WCAG: o ajuste devolve ao original o que ficaria abaixo de AA", () => {
    // Roda o script num DOM falso mínimo: texto cinza claro em fundo branco já era ruim
    // (não volta); texto vermelho-escuro em fundo amarelo-claro piora na inversão (volta).
    const kept: string[] = [];
    const makeEl = (id: string, color: string, background: string, parent: unknown = null) => {
      const el = {
        id,
        tagName: "P",
        nodeType: 1,
        parentElement: parent,
        childNodes: [{ nodeType: 3, textContent: "texto" }],
        closest: () => null,
        setAttribute: () => kept.push(id),
        getBoundingClientRect: () => ({ width: 10, height: 10 }),
        style: { color, backgroundColor: background, backgroundImage: "none" },
      };
      return el;
    };
    const ok = makeEl("ok", "rgb(0, 0, 0)", "rgb(255, 255, 255)");
    const worse = makeEl("pior", "rgb(120, 60, 0)", "rgb(255, 245, 200)");
    const fake = {
      document: { body: { getElementsByTagName: () => [ok, worse] }, documentElement: {} },
      getComputedStyle: (el: { style: object }) => el.style,
    };
    const count = new Function(
      "document",
      "getComputedStyle",
      `return ${theme.pageThemeAdjustSource()}`,
    )(fake.document, fake.getComputedStyle);
    expect(typeof count).toBe("number");
    expect(kept).not.toContain("ok");
  });
});

describe("4.7: ColorTools", () => {
  it("conversões HEX/RGB/HSL e formatos de cópia", () => {
    expect(hexOfRgb({ r: 28, g: 126, b: 214 })).toBe("#1c7ed6");
    expect(rgbOfHex("#1C7ED6")).toEqual({ r: 28, g: 126, b: 214 });
    expect(hslOfRgb({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 100, l: 50 });
    expect(rgbOfHsl({ h: 120, s: 100, l: 25 })).toEqual({ r: 0, g: 128, b: 0 });
    expect(formatColor("#1c7ed6", "hex")).toBe("#1C7ED6");
    expect(formatColor("#1c7ed6", "rgb")).toBe("rgb(28, 126, 214)");
    expect(formatColor("#ff0000", "hsl")).toBe("hsl(0, 100%, 50%)");
    expect(parseColor("abc")).toBe("#aabbcc");
    expect(parseColor("rgb(1, 2, 3)")).toBe("#010203");
    expect(parseColor("hsl(0, 100%, 50%)")).toBe("#ff0000");
    expect(parseColor("rgb(300, 0, 0)")).toBeNull();
    expect(parseColor("azul")).toBeNull();
  });

  it("gradiente linear e radial em CSS", () => {
    expect(
      gradientCss({
        kind: "linear",
        angle: 45,
        shape: "circle",
        stops: [
          { color: "#fff", at: 100 },
          { color: "#000", at: 0 },
        ],
      }),
    ).toBe("linear-gradient(45deg, #000 0%, #fff 100%)");
    expect(
      gradientCss({
        kind: "radial",
        angle: 0,
        shape: "ellipse",
        stops: [
          { color: "#f00", at: 0 },
          { color: "#00f", at: 100 },
        ],
      }),
    ).toBe("radial-gradient(ellipse, #f00 0%, #00f 100%)");
  });

  it("histórico: sem repetir, limite sem contar as fixadas, busca, exportar e importar", () => {
    let library = emptyColorLibrary;
    library = addToHistory(library, "#111111", 1, 2);
    library = { ...library, history: library.history.map((item) => ({ ...item, pinned: true })) };
    library = addToHistory(library, "#222222", 2, 2, "site.com");
    library = addToHistory(library, "#333333", 3, 2);
    library = addToHistory(library, "#444444", 4, 2);
    expect(library.history.map((item) => item.hex)).toEqual(["#444444", "#333333", "#111111"]);
    library = addToHistory(library, "#333333", 5, 2);
    expect(library.history[0]!.hex).toBe("#333333");
    expect(searchHistory(library.history, "51,51").map((item) => item.hex)).toEqual(["#333333"]);
    const withPalette = {
      ...library,
      palettes: [{ id: "p1", name: "Marca", colors: ["#d10a11", "nada"] }],
    };
    const parsed = parseColorLibrary(JSON.parse(exportColorLibrary(withPalette)));
    expect(parsed.palettes[0]!.colors).toEqual(["#d10a11"]);
    const merged = importColorLibrary(emptyColorLibrary, exportColorLibrary(withPalette));
    expect(merged?.palettes).toHaveLength(1);
    expect(importColorLibrary(emptyColorLibrary, '{"kind":"outra"}')).toBeNull();
  });

  it("conta-gotas: resposta pelo título da camada; pixel BGRA; analisador sem rede", () => {
    expect(colorTools.pickOfTitle("agzos-pick:#1c7ed6")).toEqual({
      cancel: false,
      color: { r: 28, g: 126, b: 214 },
    });
    expect(colorTools.pickOfTitle("agzos-pick:cancel")).toEqual({ cancel: true });
    expect(colorTools.pickOfTitle("agzos-pick")).toBeNull();
    expect(colorTools.rgbOfBitmap(new Uint8Array([214, 126, 28, 255]))).toEqual({
      r: 28,
      g: 126,
      b: 214,
    });
    expect(colorTools.hexOf({ r: 28, g: 126, b: 214 })).toBe("#1c7ed6");
    const source = colorTools.colorAnalyzeSource();
    expect(source).toContain("requestIdleCallback");
    expect(source).toContain("LIMIT = 2000");
    expect(source).not.toMatch(/fetch\(|XMLHttpRequest|toDataURL|getImageData/);
    // A camada lê só a foto do compositor (nunca o canvas da página).
    expect(decodeURIComponent(colorTools.PICKER_PAGE)).toContain("getImageData");
    const main = read("electron/main.cjs");
    expect(main).toContain('label: "Copiar cor do pixel"');
    expect(main).toContain('label: "Analisar cores da página"');
    expect(main).toContain('label: "Abrir gerador de gradiente"');
  });
});

describe("4.7: atalhos configuráveis e Configurações > Recursos", () => {
  it("combos válidos, do teclado e na forma do sistema", () => {
    expect(cleanCombo("Shift+Alt+C")).toBe("alt+shift+c");
    expect(cleanCombo("shift+c")).toBeNull();
    expect(cleanCombo("c")).toBeNull();
    expect(cleanCombo("mod+mod+c")).toBeNull();
    expect(cleanCombo("")).toBe("");
    expect(
      comboOfEvent({
        key: "P",
        code: "KeyP",
        ctrlKey: true,
        metaKey: false,
        altKey: true,
        shiftKey: false,
      }),
    ).toBe("mod+alt+p");
    expect(
      comboOfEvent({
        key: "Control",
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
      }),
    ).toBeNull();
    expect(comboLabel("mod+alt+p", false)).toBe("Ctrl+Alt+P");
    expect(comboLabel("mod+alt+p", true)).toBe("⌘⌥P");
    expect(comboOfHotkey({ key: "D", shift: true, alt: true, meta: false, ctrl: false })).toBe(
      "alt+shift+d",
    );
  });

  it("padrões, sem dois recursos no mesmo combo e sem roubar o PiP", () => {
    expect(defaultFeaturePrefs.shortcuts["pdf.open"]).toBe("mod+alt+p");
    expect(defaultFeaturePrefs.shortcuts["colors.eyedropper"]).toBe("alt+shift+c");
    expect(defaultFeaturePrefs.shortcuts["page-theme.toggle"]).toBe("alt+shift+d");
    const parsed = parseFeaturePrefs({
      shortcuts: { "pdf.open": "alt+shift+c", "colors.eyedropper": "alt+shift+c" },
    });
    // O primeiro da lista fica com o combo; o outro fica sem atalho.
    expect(parsed.shortcuts["colors.eyedropper"]).toBe("alt+shift+c");
    expect(parsed.shortcuts["pdf.open"]).toBe("");
    expect(featureOfCombo(parsed.shortcuts, "alt+shift+c")).toBe("colors.eyedropper");
    // Os combos padrão não batem com atalhos fixos do navegador.
    const fixed = new Set(
      commands
        .flatMap((command) => command.shortcuts ?? [])
        .map((item) =>
          [
            item.mod === false ? "" : "mod",
            item.alt ? "alt" : "",
            item.shift ? "shift" : "",
            item.key,
          ]
            .filter(Boolean)
            .join("+"),
        ),
    );
    for (const item of FEATURE_SHORTCUTS)
      if (item.fallback) expect(fixed.has(item.fallback), item.id).toBe(false);
    for (const item of FEATURE_SHORTCUTS)
      expect(
        commands.some((command) => command.id === item.id),
        item.id,
      ).toBe(true);
  });

  it("preferências: valores ruins voltam ao padrão e o tema segue o navegador", () => {
    const prefs = parsePrefs({
      features: {
        downloadsTheme: "roxo",
        colors: { autoCopy: "cmyk", historyLimit: 9999 },
        pdf: { maxMb: 2, cloud: "sim", ai: true, dock: "modal", ocrLangs: ["por", "../x", "eng"] },
      },
    });
    expect(prefs.features.downloadsTheme).toBe("browser");
    expect(prefs.features.colors.autoCopy).toBe("hex");
    expect(prefs.features.colors.historyLimit).toBe(500);
    expect(prefs.features.pdf).toMatchObject({
      maxMb: 5,
      cloud: false,
      ai: true,
      dock: "modal",
      ocrLangs: ["por", "eng"],
    });
    expect(themeIsDark("browser", true)).toBe(true);
    expect(themeIsDark("light", true)).toBe(false);
    // Recursos que mandam dados para fora nascem desligados.
    expect(defaultFeaturePrefs.pdf.ai).toBe(false);
    expect(defaultFeaturePrefs.pdf.cloud).toBe(false);
  });

  it("o main só repassa combos com modificador vindos da casca", () => {
    const main = read("electron/main.cjs");
    expect(main).toContain('ipcMain.handle("shortcuts:extra"');
    expect(main).toContain("extraShortcuts.has(combo)");
  });
});

async function samplePdf(pages = 3, { form = false } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < pages; index++) {
    const page = doc.addPage([600, 800]);
    page.drawText(`Página ${index + 1}`, { x: 50, y: 700, size: 30, font });
  }
  if (form) {
    const pdfForm = doc.getForm();
    pdfForm
      .createTextField("nome")
      .addToPage(doc.getPage(0), { x: 50, y: 600, width: 200, height: 24 });
    pdfForm
      .createCheckBox("aceito")
      .addToPage(doc.getPage(0), { x: 50, y: 560, width: 16, height: 16 });
    const dropdown = pdfForm.createDropdown("cidade");
    dropdown.addOptions(["Recife", "Olinda"]);
    dropdown.addToPage(doc.getPage(0), { x: 50, y: 520, width: 120, height: 20 });
  }
  return doc.save();
}

describe("4.7: PDF Tools (motor local)", () => {
  it("intervalos de páginas e grupos", () => {
    expect(parsePageRanges("1-3, 5, 9-", 10)).toEqual([0, 1, 2, 4, 8, 9]);
    expect(parsePageRanges("3-1", 5)).toEqual([2, 1, 0]);
    expect(parsePageRanges("0, 99, x, 2", 5)).toEqual([1]);
    expect(chunkPages(5, 2)).toEqual([[0, 1], [2, 3], [4]]);
  });

  it("juntar, dividir e organizar (ordem, apagar, girar, recortar) mantendo o formulário", async () => {
    const a = await samplePdf(3, { form: true });
    const b = await samplePdf(2);
    const merged = await mergePdfs([{ bytes: a }, { bytes: b, pages: [1] }]);
    expect((await pdfInfo(merged)).pages).toHaveLength(4);
    const parts = await splitPdf(a, [[0], [1, 2]]);
    expect(
      await Promise.all(parts.map(async (part) => (await pdfInfo(part)).pages.length)),
    ).toEqual([1, 2]);
    const organized = await organizePdf(a, {
      order: [2, 0, 0],
      rotate: { 2: 90, 0: -90 },
      crop: { 0: { x: 0.1, y: 0.1, w: 0.8, h: 0.5 } },
    });
    const info = await pdfInfo(organized);
    expect(info.pages.map((page) => page.rotation)).toEqual([90, 270, 270]);
    // Recorte nas frações da página como aparece (já girada: 800×600 na tela).
    expect(Math.round(info.pages[1]!.width)).toBe(300);
    expect(Math.round(info.pages[1]!.height)).toBe(640);
    expect(info.fields.map((field) => field.name)).toEqual(["nome", "aceito", "cidade"]);
    await expect(organizePdf(a, { order: [] })).rejects.toThrow(/ao menos uma página/);
  });

  it("posição de caixas em páginas giradas (o desenho fica em pé)", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    expect(placementOf(page, { x: 0, y: 0, w: 0.5, h: 0.25 })).toEqual({
      x: 0,
      y: 600,
      width: 300,
      height: 200,
      rotation: 0,
    });
    page.setRotation({ type: "degrees", angle: 90 } as never);
    // Página deitada na tela (800×600): o canto de baixo à esquerda da caixa vira x=150 no PDF.
    expect(placementOf(page, { x: 0, y: 0, w: 0.5, h: 0.25 })).toEqual({
      x: 150,
      y: 0,
      width: 400,
      height: 150,
      rotation: 90,
    });
  });

  it("editar: texto, formas, marca-texto, assinatura, comentário e marca-d'água", async () => {
    const bytes = await samplePdf(1);
    const png = Uint8Array.from(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
    const edited = await applyEdits(bytes, [
      {
        kind: "text",
        page: 0,
        box: { x: 0.1, y: 0.1, w: 0.5, h: 0.1 },
        text: "Olá, ação\ncom €",
        color: "#d10a11",
        size: 14,
      },
      {
        kind: "rect",
        page: 0,
        box: { x: 0.1, y: 0.3, w: 0.2, h: 0.1 },
        color: "#000000",
        fill: false,
        width: 2,
      },
      {
        kind: "ellipse",
        page: 0,
        box: { x: 0.4, y: 0.3, w: 0.2, h: 0.1 },
        color: "#00aa00",
        fill: true,
        width: 1,
      },
      {
        kind: "line",
        page: 0,
        box: { x: 0.1, y: 0.5, w: 0.3, h: 0.01 },
        color: "#0000ff",
        width: 1,
      },
      { kind: "highlight", page: 0, box: { x: 0.1, y: 0.6, w: 0.3, h: 0.03 }, color: "#ffd43b" },
      { kind: "signature", page: 0, box: { x: 0.5, y: 0.8, w: 0.3, h: 0.1 }, png },
      {
        kind: "comment",
        page: 0,
        box: { x: 0.8, y: 0.1, w: 0.05, h: 0.03 },
        text: "Revisar",
        author: "Agzos",
      },
      {
        kind: "text",
        page: 9,
        box: { x: 0, y: 0, w: 1, h: 1 },
        text: "página que não existe",
        color: "#000000",
        size: 10,
      },
    ]);
    const doc = await PDFDocument.load(edited);
    const annots = doc.getPage(0).node.Annots();
    expect(annots?.size()).toBe(1);
    expect(Buffer.from(edited).length).toBeGreaterThan(bytes.length);
    const marked = await addWatermark(bytes, {
      text: "CONFIDENCIAL",
      size: 60,
      opacity: 0.2,
      color: "#d10a11",
      angle: 35,
      pages: [],
    });
    expect(marked.length).toBeGreaterThan(bytes.length);
    await expect(
      addWatermark(bytes, {
        text: "  ",
        size: 60,
        opacity: 0.2,
        color: "#000000",
        angle: 0,
        pages: [],
      }),
    ).rejects.toThrow();
    expect(winAnsiText("ação 😀 中")).toBe("ação ? ?");
  });

  it("senha AES-256: definir, pedir, errar, remover", async () => {
    const bytes = await fillForm(
      await samplePdf(2, { form: true }),
      { nome: "Ana", aceito: true, cidade: "Olinda", inexistente: "x" },
      false,
    );
    const locked = await protectPdf(bytes, "segredo", "dono");
    expect(Buffer.from(locked).toString("latin1")).toContain("/AESV3");
    expect(await isEncrypted(locked)).toBe(true);
    await expect(pdfInfo(locked)).rejects.toBeInstanceOf(PdfPasswordError);
    await expect(pdfInfo(locked, "errada")).rejects.toMatchObject({ wrong: true });
    const info = await pdfInfo(locked, "segredo");
    expect(info.encrypted).toBe(true);
    expect(info.fields).toEqual([
      { name: "nome", type: "text", value: "Ana", multiline: false },
      { name: "aceito", type: "checkbox", value: true },
      { name: "cidade", type: "choice", value: "Olinda", options: ["Recife", "Olinda"] },
    ]);
    const open = await unprotectPdf(locked, "segredo");
    expect(await isEncrypted(open)).toBe(false);
    expect((await pdfInfo(open)).fields[0]).toMatchObject({ value: "Ana" });
    await expect(protectPdf(bytes, "", "")).rejects.toThrow(/senha/);
  });

  it("formulário travado (flatten) e imagens → PDF", async () => {
    const flat = await fillForm(await samplePdf(1, { form: true }), { nome: "Bia" }, true);
    expect((await pdfInfo(flat)).fields).toEqual([]);
    const png = Uint8Array.from(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
    const fromImages = await imagesToPdf([
      { bytes: png, type: "png" },
      { bytes: png, type: "png" },
    ]);
    expect((await pdfInfo(fromImages)).pages).toHaveLength(2);
  });

  it("camada de texto do OCR: o texto fica no PDF (pesquisável), invisível", async () => {
    const bytes = await samplePdf(1);
    const out = await addOcrLayer(bytes, [
      {
        page: 0,
        width: 1200,
        height: 1600,
        words: [{ text: "AGZOS", x0: 100, y0: 100, x1: 400, y1: 160 }],
      },
    ]);
    const doc = await PDFDocument.load(out);
    const content = doc.getPage(0).node.Contents();
    expect(content).toBeDefined();
    expect(out.length).toBeGreaterThan(bytes.length);
  });

  it("comprimir: refaz só as imagens que ficam menores; sem ganho devolve o original", async () => {
    const bytes = await samplePdf(1);
    const none = await compressPdf(bytes, "balanced", null);
    expect(none.images).toBe(0);
    expect(none.after).toBeLessThanOrEqual(none.before);
    // PDF com um JPEG: o recompressor de teste devolve bytes menores.
    const doc = await PDFDocument.create();
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.alloc(20_000, 1),
      Buffer.from([0xff, 0xd9]),
    ]);
    const stream = doc.context.stream(jpeg, {
      Type: "XObject",
      Subtype: "Image",
      Width: 100,
      Height: 100,
      ColorSpace: "DeviceRGB",
      BitsPerComponent: 8,
      Filter: "DCTDecode",
    });
    doc.context.register(stream);
    doc.addPage();
    const withImage = await doc.save();
    const calls: number[] = [];
    const result = await compressPdf(withImage, "strong", async (image) => {
      calls.push(image.quality);
      return { bytes: new Uint8Array(500), width: 50, height: 50 };
    });
    expect(calls).toEqual([0.5]);
    expect(result.recompressed).toBe(1);
    expect(result.after).toBeLessThan(result.before);
  });
});

describe("4.7: PDF Tools no main (arquivos, nuvem, Office, senha lembrada)", () => {
  it("nomes seguros", () => {
    expect(pdfTools.safeFileName("../../etc/passwd")).toBe("passwd");
    expect(pdfTools.safeFileName('a<b>:"c".pdf')).toBe("a_b___c_.pdf");
    expect(pdfTools.safeFileName("")).toBe("documento.pdf");
  });

  it("pastas da nuvem do computador (Drive, Dropbox pelo info.json, OneDrive pelo env)", () => {
    const home = "/home/u";
    const existing = new Set([
      path.join(home, "Library", "CloudStorage"),
      path.join(home, "Library", "CloudStorage", "GoogleDrive-a@b.com", "My Drive"),
      path.join(home, ".dropbox", "info.json"),
      "/mnt/dropbox",
      "/mnt/onedrive",
    ]);
    const found = pdfTools.cloudTargets({
      home,
      env: { OneDrive: "/mnt/onedrive" },
      exists: (file: string) => existing.has(file),
      readdir: () => ["GoogleDrive-a@b.com"],
      readFile: () => JSON.stringify({ personal: { path: "/mnt/dropbox" } }),
    });
    expect(found.map((item) => [item.id, item.dir])).toEqual([
      ["gdrive", path.join(home, "Library", "CloudStorage", "GoogleDrive-a@b.com", "My Drive")],
      ["dropbox", "/mnt/dropbox"],
      ["onedrive", "/mnt/onedrive"],
    ]);
    expect(
      pdfTools.cloudTargets({
        home,
        env: {},
        exists: () => false,
        readdir: () => [],
        readFile: () => "",
      }),
    ).toEqual([]);
  });

  it("LibreOffice pelo PATH ou pelo lugar de instalação", () => {
    expect(
      pdfTools.findOffice({
        env: { PATH: "/opt/x" },
        exists: (file: string) => file === "/usr/bin/soffice",
        platform: "linux",
      }),
    ).toBe("/usr/bin/soffice");
    expect(
      pdfTools.findOffice({ env: { PATH: "" }, exists: () => false, platform: "linux" }),
    ).toBeNull();
  });

  it("senha lembrada: AES-256-GCM com chave do safeStorage; sem chaveiro não grava", () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "agzos-pdf-"));
    const safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (text: string) => Buffer.from(`enc:${text}`),
      decryptString: (data: Buffer) => data.toString().slice(4),
    };
    const tools = pdfTools.createPdfTools({
      userDataDir,
      distDir: userDataDir,
      safeStorage,
      fetchBuffer: async () => Buffer.alloc(0),
    });
    const sealed = tools.sealPassword("minha senha")!;
    expect(sealed).not.toContain("minha");
    expect(tools.openPassword(sealed)).toBe("minha senha");
    expect(tools.openPassword(`${sealed.slice(0, -4)}AAAA`)).toBeNull();
    const none = pdfTools.createPdfTools({
      userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), "agzos-pdf-")),
      distDir: userDataDir,
      safeStorage: { isEncryptionAvailable: () => false },
      fetchBuffer: async () => Buffer.alloc(0),
    });
    expect(none.sealPassword("x")).toBeNull();
  });

  it("arquivos: limite de tamanho, só sobrescreve o que foi aberto, temporários somem", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agzos-pdf-"));
    const tools = pdfTools.createPdfTools({
      userDataDir: dir,
      distDir: dir,
      safeStorage: null,
      fetchBuffer: async () => Buffer.alloc(0),
    });
    const file = path.join(dir, "a.pdf");
    fs.writeFileSync(file, Buffer.alloc(2048));
    expect(tools.readFile(file, 1024)).toEqual({ ok: false, error: "size" });
    expect(tools.canOverwrite(file)).toBe(false);
    expect(tools.readFile(file, 4096).ok).toBe(true);
    expect(tools.canOverwrite(file)).toBe(true);
    const { id } = tools.startSession();
    expect(fs.existsSync(path.join(dir, "pdf-tools-tmp", id))).toBe(true);
    tools.endSession(id);
    expect(fs.existsSync(path.join(dir, "pdf-tools-tmp", id))).toBe(false);
    tools.endSession("../../etc");
    // OCR: só os arquivos conhecidos, nunca um caminho qualquer.
    expect(tools.ocrAsset("../../package.json")).toBeNull();
    expect(tools.ocrAsset("eng.traineddata.gz")).toBeNull();
  });

  it("build: arquivos do main na lista, OCR em dist/ocr e o visualizador de PDF nas guias", () => {
    const build = read("scripts/build-all.sh");
    for (const file of [
      "download-rules.cjs",
      "page-theme.cjs",
      "color-tools.cjs",
      "pdf-tools.cjs",
    ]) {
      expect(build).toContain(file);
    }
    expect(read("electron/prepare-build.cjs")).toContain("tesseract-core-simd-lstm.wasm.js");
    expect(read("electron/main.cjs")).toContain("plugins: true");
    // Sem módulo nativo novo: PDF e OCR são JS/WASM.
    const pkg = JSON.parse(read("package.json")) as { trustedDependencies: string[] };
    expect(pkg.trustedDependencies).toEqual(["node-pty"]);
  });
});

describe("4.7: API interna agzos.downloads e PDFs grandes", () => {
  it("agzos.downloads chama o main e soma etiquetas sem repetir", async () => {
    const calls: unknown[][] = [];
    const desktop = {
      downloadsList: async () => [record({ id: 7, tags: ["Fiscal"] })],
      downloadAction: async (...args: unknown[]) => {
        calls.push(args);
        return { ok: true };
      },
      downloadsExport: async () => ({ ok: true, path: "/tmp/x.csv" }),
      onDownload: () => () => {},
    } as unknown as Parameters<typeof createDownloadsApi>[0];
    const api = createDownloadsApi(desktop);
    expect(await api.pause(7)).toBe(true);
    expect(await api.addTag(7, "fiscal")).toBe(true);
    expect(await api.addTag(7, "Contratos")).toBe(true);
    expect(await api.export([7], "csv")).toBe("/tmp/x.csv");
    expect(calls).toEqual([
      [7, "pause"],
      [7, "tags", ["Fiscal"]],
      [7, "tags", ["Fiscal", "Contratos"]],
    ]);
    expect(read("src/features/browser/chrome.tsx")).toContain(
      "downloads: createDownloadsApi(desktop)",
    );
  });

  it("PDF de 500 páginas: informação, dividir e organizar sem travar", async () => {
    const big = await samplePdf(500);
    const started = Date.now();
    expect((await pdfInfo(big)).pages).toHaveLength(500);
    const parts = await splitPdf(big, chunkPages(500, 100));
    expect(parts).toHaveLength(5);
    const reversed = await organizePdf(big, {
      order: Array.from({ length: 500 }, (_v, i) => 499 - i),
    });
    expect((await pdfInfo(reversed)).pages).toHaveLength(500);
    expect(Date.now() - started).toBeLessThan(20_000);
  });
});

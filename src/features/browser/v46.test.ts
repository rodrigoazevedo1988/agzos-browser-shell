import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { TOOLS } from "@/features/tools/tools";

import { SIDE_BAR_WIDTH, clampSideBarWidth, sideBarLayout } from "./side-panels";
import { parsePrefs } from "./persistence/snapshot";

// 4.6: ferramentas só na barra lateral, caderno do modo leitura, pop-up de extensões e
// barra lateral redimensionável.
const require = createRequire(import.meta.url);
const electronDir = path.join(process.cwd(), "electron");
const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

const extensions = require(path.join(electronDir, "extensions.cjs")) as {
  accessSummary: (manifest: object) => { summary: string; everywhere: boolean; hosts: string[] };
  patchManifest: (
    manifest: object,
    blocked: string[],
  ) => {
    content_scripts?: { exclude_matches?: string[] }[];
  };
  hostOfOrigin: (origin: string) => string | null;
  parseRecords: (value: unknown) => { pinned: boolean; blocked: string[] }[];
};
const reader = require(path.join(electronDir, "reader.cjs")) as { readerProbeSource: () => string };
const overlay = read("electron/chrome-overlay.cjs");

describe("4.6: ferramentas sem repetição", () => {
  it("página inicial e Discador não têm mais a grade; a barra lateral tem o menu", () => {
    expect(read("src/features/browser/start-page.tsx")).not.toContain("ToolsGrid");
    expect(read("src/features/dial/page.tsx")).not.toContain("ToolsGrid");
    expect(fs.existsSync(path.join(process.cwd(), "src/features/tools/tools-grid.tsx"))).toBe(
      false,
    );
    expect(read("src/features/browser/ui/side-bar.tsx")).toContain('aria-label="Ferramentas"');
    expect(read("src/features/browser/ui/toolbar.tsx")).not.toContain("onToolsMenu");
    // Menus no visual do app (camada), não nativos.
    for (const kind of ['"tools"', '"extensions"', '"extmenu"']) expect(overlay).toContain(kind);
    expect(read("src/features/tools/tools-menu.tsx")).toContain("app-menu tools-menu");
    expect(TOOLS.length).toBeGreaterThan(5);
  });
});

describe("4.6: extensões no estilo Chrome/Edge", () => {
  it("resumo de acesso como no menu do Chrome", () => {
    expect(
      extensions.accessSummary({ content_scripts: [{ matches: ["<all_urls>"] }] }),
    ).toMatchObject({
      summary: "Pode ler e alterar dados em todos os sites",
      everywhere: true,
    });
    expect(extensions.accessSummary({ host_permissions: ["https://*/*"] }).everywhere).toBe(true);
    expect(
      extensions.accessSummary({ host_permissions: ["https://a.com/*", "https://b.com/*"] })
        .summary,
    ).toBe("Pode ler e alterar dados em 2 sites");
    expect(extensions.accessSummary({ permissions: ["activeTab"] }).summary).toBe(
      "Acessa o site só quando você clica nela",
    );
    expect(extensions.accessSummary({}).summary).toBe("Não acessa dados dos sites");
  });

  it("sem acesso a um site: os content scripts não entram nele (exclude_matches)", () => {
    const patched = extensions.patchManifest(
      { content_scripts: [{ matches: ["<all_urls>"], exclude_matches: ["*://x.com/*"] }] },
      ["app.leadmobi.com"],
    );
    expect(patched.content_scripts![0]!.exclude_matches).toEqual([
      "*://x.com/*",
      "*://app.leadmobi.com/*",
    ]);
    const untouched = { content_scripts: [{ matches: ["<all_urls>"] }] };
    expect(extensions.patchManifest(untouched, [])).toBe(untouched);
    expect(extensions.hostOfOrigin("https://App.LeadMobi.com:8443")).toBe("app.leadmobi.com");
    expect(extensions.hostOfOrigin("file:///etc")).toBeNull();
  });

  it("alfinete e hosts bloqueados vão e voltam validados", () => {
    const [record] = extensions.parseRecords([
      { dir: "/ext/a", pinned: true, blocked: ["a.com", "a.com", "../x", 3] },
    ]);
    expect(record).toMatchObject({ pinned: true, blocked: ["a.com"] });
    expect(extensions.parseRecords([{ dir: "/ext/b" }])[0]).toMatchObject({
      pinned: false,
      blocked: [],
    });
  });

  it("main: pop-up ancorado (janela sem moldura que fecha ao perder o foco) e DevTools", () => {
    const main = read("electron/main.cjs");
    expect(main).toContain("enablePreferredSizeMode: true");
    expect(main).toContain('window.on("blur"');
    expect(main).toContain('openDevTools({ mode: "detach" })');
    expect(main).toContain('ipcMain.handle("extensions:site-access"');
  });
});

describe("4.6: modo leitura na barra de URL", () => {
  it("o detector de artigo compila e roda no mundo isolado do leitor", () => {
    expect(() => new Function(reader.readerProbeSource())).not.toThrow();
    expect(read("electron/main.cjs")).toContain("scheduleReadableProbe(contents)");
  });
});

describe("4.6: barra lateral redimensionável", () => {
  it("largura limitada e modos: só ícones, ícone com nome embaixo, ícone e nome lado a lado", () => {
    expect(clampSideBarWidth(10)).toBe(SIDE_BAR_WIDTH.min);
    expect(clampSideBarWidth(999)).toBe(SIDE_BAR_WIDTH.max);
    expect(clampSideBarWidth("x")).toBe(SIDE_BAR_WIDTH.initial);
    expect(sideBarLayout(48).mode).toBe("compact");
    expect(sideBarLayout(60).mode).toBe("normal");
    expect(sideBarLayout(140).mode).toBe("wide");
    // Ícones e texto crescem com a largura.
    expect(sideBarLayout(96).icon).toBeGreaterThan(sideBarLayout(60).icon);
    expect(sideBarLayout(96).font).toBeGreaterThan(sideBarLayout(60).font);
    expect(parsePrefs({ sideBarWidth: 500 }).sideBarWidth).toBe(SIDE_BAR_WIDTH.max);
    expect(parsePrefs({}).sideBarWidth).toBe(SIDE_BAR_WIDTH.initial);
  });
});

import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { makeCrx, makeZip } from "@/features/extensions/crx-fixtures";

// 4.6.1: instalar da Chrome Web Store de verdade, pop-up que não encolhe e o clique no
// ícone decidido pelo manifest.
const require = createRequire(import.meta.url);
const electronDir = path.join(process.cwd(), "electron");
const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

type Rect = { x: number; y: number; width: number; height: number };
const crx = require(path.join(electronDir, "crx.cjs")) as {
  parseCrx: (buffer: Buffer, expectedId?: string) => { zip: Buffer; publicKey: string | null };
  extensionIdOfKey: (key: Buffer) => string;
  parseUpdateCheck: (xml: string, id: string) => string | null;
  updateCheckUrl: (base: string, id: string, version: string, chrome: string) => string;
  compareVersions: (a: string, b: string) => number;
};
const extensions = require(path.join(electronDir, "extensions.cjs")) as {
  readManifest: (
    dir: string,
    fs: object,
  ) => {
    error?: string;
    kind?: string;
    popup?: string | null;
    sidePanel?: string | null;
    options?: string | null;
    manifestVersion?: number;
  };
  popupPlacement: (args: {
    anchor: Rect;
    content: Rect;
    workArea: Rect;
    width: number;
    height: number;
  }) => Rect;
  POPUP_LIMITS: { minWidth: number; minHeight: number; maxWidth: number; maxHeight: number };
  createExtensions: (deps: object) => {
    loadAll: () => Promise<void>;
    installFromStore: (input: string) => Promise<{ ok: boolean; error?: string; id?: string }>;
    checkUpdates: () => Promise<number>;
    update: (dir: string) => Promise<{ ok: boolean; error?: string }>;
    list: () => {
      dir: string;
      id: string | null;
      name: string;
      version: string;
      loaded: boolean;
      kind: string;
      update: string | null;
      pinned: boolean;
    }[];
    setPinned: (dir: string, pinned: boolean) => { ok: boolean };
  };
};

const GOOGLE_KEY = Buffer.from("chave-do-google-igual-em-toda-extensao");
const keyA = Buffer.from("autor-volume-master");
const keyB = Buffer.from("autor-uv-weather");
const idA = crx.extensionIdOfKey(keyA);
const idB = crx.extensionIdOfKey(keyB);

const manifestZip = (manifest: object) =>
  makeZip([{ name: "manifest.json", data: Buffer.from(JSON.stringify(manifest)) }]);

describe("4.6.1: CRX da Chrome Web Store", () => {
  it("o id vem da chave do autor (sha256 → a–p), não da prova do Google", () => {
    expect(idA).toMatch(/^[a-p]{32}$/);
    expect(idA).not.toBe(idB);
    const zip = manifestZip({ manifest_version: 3, name: "A", version: "1" });
    // A loja manda as duas provas; a do Google pode vir primeiro.
    const parsed = crx.parseCrx(makeCrx(zip, GOOGLE_KEY, keyA), idA);
    expect(parsed.publicKey).toBe(keyA.toString("base64"));
    expect(() => crx.parseCrx(makeCrx(zip, GOOGLE_KEY), idA)).toThrow("proof");
  });

  it("duas extensões da loja ficam com ids diferentes e voltam depois de reiniciar", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agzos-ext461-"));
    const packages: Record<string, Buffer> = {
      [idA]: makeCrx(
        manifestZip({
          manifest_version: 3,
          name: "Volume Master",
          version: "2.4.0",
          update_url: "https://clients2.google.com/service/update2/crx",
          action: { default_popup: "html/popup.html" },
        }),
        GOOGLE_KEY,
        keyA,
      ),
      [idB]: makeCrx(
        manifestZip({
          manifest_version: 3,
          name: "UV Weather",
          version: "1.0",
          action: { default_popup: "popup.html" },
        }),
        GOOGLE_KEY,
        keyB,
      ),
    };
    const loaded = new Map<string, string>();
    // O "Chromium" de mentira dá o id pela chave do manifest (como o real).
    const ses = {
      extensions: {
        loadExtension: vi.fn(async (dir: string) => {
          const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
          const id = crx.extensionIdOfKey(Buffer.from(manifest.key, "base64"));
          loaded.set(id, dir);
          return { id };
        }),
        removeExtension: (id: string) => loaded.delete(id),
        getExtension: (id: string) => (loaded.has(id) ? { id } : null),
      },
    };
    let saved: unknown = [];
    const deps = {
      ses,
      fs,
      store: { get: () => saved, set: (list: unknown) => (saved = list) },
      download: async (url: string) => {
        const id = /id%3D([a-p]{32})/.exec(url)?.[1] ?? "";
        if (!packages[id]) throw Object.assign(new Error("HTTP 404"), { status: 404 });
        return packages[id];
      },
      fetchText: async () =>
        `<gupdate><app appid="${idA}" status="ok"><updatecheck status="ok" version="2.5.0"/></app></gupdate>`,
      extensionsDir: path.join(root, "Extensions"),
      chromeVersion: "144.0.0.0",
    };
    const first = extensions.createExtensions(deps);
    await expect(
      first.installFromStore(`https://chromewebstore.google.com/detail/volume-master/${idA}?hl=pt`),
    ).resolves.toMatchObject({ ok: true, id: idA });
    await expect(first.installFromStore(idB)).resolves.toMatchObject({ ok: true, id: idB });
    await expect(first.installFromStore("a".repeat(32))).resolves.toEqual({
      ok: false,
      error: "notfound",
    });
    expect(first.list().map((item) => [item.name, item.id, item.loaded, item.kind])).toEqual([
      ["Volume Master", idA, true, "popup"],
      ["UV Weather", idB, true, "popup"],
    ]);

    // Atualização: só avisa; instalar é com o usuário.
    await expect(first.checkUpdates()).resolves.toBe(1);
    expect(first.list()[0]).toMatchObject({ version: "2.4.0", update: "2.5.0" });
    first.setPinned(first.list()[0]!.dir, true);
    packages[idA] = makeCrx(
      manifestZip({ manifest_version: 3, name: "Volume Master", version: "2.5.0" }),
      GOOGLE_KEY,
      keyA,
    );
    await expect(first.update(first.list()[0]!.dir)).resolves.toMatchObject({ ok: true });
    expect(first.list()[0]).toMatchObject({ version: "2.5.0", update: null, pinned: true });

    // "Reinicia": nova instância, mesmo SQLite (saved), Chromium vazio.
    loaded.clear();
    const second = extensions.createExtensions(deps);
    await second.loadAll();
    expect(second.list().map((item) => [item.id, item.loaded])).toEqual([
      [idA, true],
      [idB, true],
    ]);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("instalação antiga com a chave do Google é baixada de novo com a do autor", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agzos-ext461-"));
    const dir = path.join(root, "Extensions", idA);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "manifest.json"),
      JSON.stringify({
        manifest_version: 3,
        name: "Volume Master",
        version: "2.4.0",
        key: GOOGLE_KEY.toString("base64"),
      }),
    );
    let saved: unknown = [{ dir, source: "store", storeId: idA, enabled: true }];
    const manager = extensions.createExtensions({
      ses: {
        extensions: {
          loadExtension: async (target: string) => {
            const manifest = JSON.parse(
              fs.readFileSync(path.join(target, "manifest.json"), "utf8"),
            );
            return { id: crx.extensionIdOfKey(Buffer.from(manifest.key, "base64")) };
          },
          removeExtension: () => {},
          getExtension: () => ({}),
        },
      },
      fs,
      store: { get: () => saved, set: (list: unknown) => (saved = list) },
      download: async () =>
        makeCrx(
          manifestZip({ manifest_version: 3, name: "Volume Master", version: "2.4.0" }),
          GOOGLE_KEY,
          keyA,
        ),
      extensionsDir: path.join(root, "Extensions"),
      chromeVersion: "144.0.0.0",
    });
    await manager.loadAll();
    expect(manager.list()[0]!.id).toBe(idA);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("consulta de atualização no protocolo gupdate", () => {
    const url = crx.updateCheckUrl(
      "https://clients2.google.com/service/update2/crx",
      idA,
      "2.4.0",
      "144.0.0.0",
    );
    expect(url).toContain("response=updatecheck");
    expect(url).toContain(`x=id%3D${idA}%26v%3D2.4.0%26uc`);
    expect(
      crx.parseUpdateCheck(
        `<gupdate><app appid="${idA}" status="ok"><updatecheck status="noupdate"/></app></gupdate>`,
        idA,
      ),
    ).toBeNull();
    expect(
      crx.parseUpdateCheck(
        `<gupdate><app appid="${idB}"><updatecheck status="ok" version="9"/></app></gupdate>`,
        idA,
      ),
    ).toBeNull();
    expect(crx.compareVersions("2.10.0", "2.9.9")).toBeGreaterThan(0);
    expect(crx.compareVersions("1.0", "1.0.0")).toBe(0);
  });
});

describe("4.6.1: o manifest decide o clique", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agzos-kind-"));
  const make = (name: string, manifest: object) => {
    const dir = path.join(root, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
    return extensions.readManifest(dir, fs);
  };

  it("pop-up (MV3 e MV2), painel lateral, opções ou só fundo", () => {
    expect(
      make("mv3", { manifest_version: 3, name: "a", action: { default_popup: "/p.html" } }),
    ).toMatchObject({ kind: "popup", popup: "p.html", manifestVersion: 3 });
    expect(
      make("mv2", { manifest_version: 2, name: "b", browser_action: { default_popup: "p.html" } }),
    ).toMatchObject({ kind: "popup", popup: "p.html", manifestVersion: 2 });
    expect(
      make("page", { manifest_version: 2, name: "b", page_action: { default_popup: "q.html" } }),
    ).toMatchObject({ kind: "popup", popup: "q.html" });
    expect(
      make("side", {
        manifest_version: 3,
        name: "c",
        side_panel: { default_path: "panel.html" },
        options_ui: { page: "opt.html" },
      }),
    ).toMatchObject({ kind: "sidepanel", sidePanel: "panel.html", options: "opt.html" });
    expect(make("opts", { manifest_version: 3, name: "d", options_page: "o.html" })).toMatchObject({
      kind: "options",
      popup: null,
    });
    expect(
      make("bg", {
        manifest_version: 3,
        name: "e",
        background: { service_worker: "sw.js" },
        content_scripts: [{ matches: ["<all_urls>"], js: ["c.js"] }],
        commands: { go: { suggested_key: { default: "Ctrl+Shift+Y" } } },
      }),
    ).toMatchObject({ kind: "background", popup: null, sidePanel: null, options: null });
    expect(make("v1", { manifest_version: 1, name: "f" })).toEqual({ error: "manifest" });
  });

  it("menu da extensão só mostra o que existe no manifest", () => {
    const menu = read("src/features/extensions/menu.tsx");
    expect(menu).toContain("{data.hasOptions && (");
    expect(menu).toContain("{data.hasPopup && (");
    expect(menu).toContain("{data.hasSidePanel && (");
    expect(menu).toContain("está ativa.");
    const shell = read("src/features/browser/chrome.tsx");
    expect(shell).toMatch(/case "sidepanel":\s+openExtensionSidePanel\(info\)/);
    expect(shell).toContain("openExtensionMenu(dir, anchor, true)");
  });
});

describe("4.6.1: pop-up da extensão", () => {
  const content = { x: 100, y: 50, width: 1200, height: 800 };
  const workArea = { x: 0, y: 0, width: 1440, height: 900 };
  const anchor = { x: 1100, y: 60, width: 32, height: 32 };

  it("alinha à direita do ícone, abaixo dele, e respeita mínimo usável e máximo", () => {
    expect(
      extensions.popupPlacement({ anchor, content, workArea, width: 300, height: 200 }),
    ).toEqual({ x: 100 + 1132 - 300, y: 50 + 92 + 4, width: 300, height: 200 });
    // Página que ainda não montou (25 px): nunca vira uma faixa.
    const tiny = extensions.popupPlacement({ anchor, content, workArea, width: 25, height: 25 });
    expect(tiny.width).toBe(extensions.POPUP_LIMITS.minWidth);
    expect(tiny.height).toBe(extensions.POPUP_LIMITS.minHeight);
    const huge = extensions.popupPlacement({
      anchor,
      content,
      workArea,
      width: 5000,
      height: 5000,
    });
    expect(huge.width).toBe(800);
    expect(huge.height).toBeLessThanOrEqual(600);
    expect(huge.x).toBeGreaterThanOrEqual(0);
  });

  it("não passa da borda de baixo da tela nem da esquerda", () => {
    const low = extensions.popupPlacement({
      anchor: { x: 10, y: 700, width: 32, height: 32 },
      content,
      workArea,
      width: 400,
      height: 600,
    });
    expect(low.y + low.height).toBeLessThanOrEqual(900);
    expect(low.x).toBeGreaterThanOrEqual(0);
  });

  it("main: janela nova a cada abertura, destruída ao fechar, remedida enquanto monta", () => {
    const main = read("electron/main.cjs");
    const popup = main.slice(main.indexOf("function openExtensionPopup"));
    expect(popup).toContain("closeExtensionPopup();");
    expect(popup).toContain("window.destroy()");
    expect(popup).toContain("POPUP_MEASURE");
    expect(popup).not.toContain("enablePreferredSizeMode");
    expect(main).toContain("lastPopupClose");
  });
});

const tooltip = require(path.join(electronDir, "tooltip.cjs")) as {
  cleanTooltipText: (value: unknown) => string;
  tooltipPlacement: (
    anchor: Rect,
    size: { width: number; height: number },
    content: { width: number; height: number },
  ) => Rect;
};

describe("4.6.1: dica da barra pelo app", () => {
  it("texto inteiro, centrado no botão, sem sair da janela", () => {
    const content = { width: 1200, height: 800 };
    // Botão no meio: centrado e abaixo.
    expect(
      tooltip.tooltipPlacement(
        { x: 500, y: 60, width: 32, height: 32 },
        { width: 140, height: 24 },
        content,
      ),
    ).toEqual({ x: 446, y: 98, width: 140, height: 24 });
    // Encostado na direita (Downloads, extensões): encosta na borda, largura toda.
    const right = tooltip.tooltipPlacement(
      { x: 1160, y: 60, width: 32, height: 32 },
      { width: 150.4, height: 24 },
      content,
    );
    expect(right.width).toBe(151);
    expect(right.x + right.width).toBeLessThanOrEqual(1196);
    // Sem espaço embaixo: vai para cima do botão.
    expect(
      tooltip.tooltipPlacement(
        { x: 10, y: 770, width: 32, height: 24 },
        { width: 80, height: 24 },
        content,
      ).y,
    ).toBe(740);
    expect(tooltip.cleanTooltipText("  Downloads\n (Ctrl+J) ")).toBe("Downloads (Ctrl+J)");
    expect(tooltip.cleanTooltipText(42)).toBe("");
  });

  it("toolbar: atalho no jeito do sistema e dica pelo main no desktop", () => {
    const toolbar = read("src/features/browser/ui/toolbar.tsx");
    expect(toolbar).not.toContain("Ctrl/⌘");
    expect(toolbar).toContain('keys("Ctrl+J")');
    expect(toolbar).toContain("useBarTooltips(props.tooltips ?? null)");
    expect(read("scripts/build-all.sh")).toContain("tooltip.cjs");
  });
});

import { execSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Módulos puros do processo principal (electron/*.cjs).
const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const electronDir = path.join(root, "electron");

const zoom = require(path.join(electronDir, "zoom.cjs")) as {
  ZOOM_STEPS: number[];
  nextZoom: (current: number, direction: number) => number;
  zoomHostOf: (url: string) => string | null;
};
const adblockModule = require(path.join(electronDir, "adblock.cjs")) as {
  createAdblock: (options: Record<string, unknown>) => Adblock;
  requestTypeOf: (type: string) => string;
  siteHostOf: (url: string) => string | null;
  listsFromEnv: (value: string | undefined) => { ads: string[]; privacy: string[] };
  domainOf: (hostname: string) => string;
};
const { uniquePath } = require(path.join(electronDir, "downloads.cjs")) as {
  uniquePath: (dir: string, filename: string, taken?: Set<string>) => string;
};

type Adblock = {
  start(): void;
  update(): Promise<boolean>;
  shouldBlock(request: {
    url: string;
    resourceType: string;
    pageUrl?: string;
    sourceUrl?: string;
    tabId?: number;
  }): boolean;
  cosmeticCss(
    url: string,
    dom?: { classes?: string[]; ids?: string[] } | null,
    options?: { base?: boolean },
  ): string;
  statsInfo(): { today: number; ready: boolean; updatedAt: number | null };
  pageInfo(tabId: number): { count: number; trackers: { host: string; category: string }[] };
  setConfig(config: { enabled?: boolean; pausedHosts?: string[] }): void;
  resetPage(tabId: number): void;
  close(): void;
};

const dirs: string[] = [];
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agzos-main-"));
  dirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe("zoom.cjs", () => {
  it("segue os degraus do Chrome e para nos limites", () => {
    expect(zoom.nextZoom(1, 1)).toBe(1.1);
    expect(zoom.nextZoom(1.1, 1)).toBe(1.25);
    expect(zoom.nextZoom(1, -1)).toBe(0.9);
    expect(zoom.nextZoom(0.25, -1)).toBe(0.25);
    expect(zoom.nextZoom(5, 1)).toBe(5);
    expect(zoom.nextZoom(1.75, 0)).toBe(1);
    // Fator fora da lista (ex.: pinça no trackpad) vai para o degrau seguinte.
    expect(zoom.nextZoom(1.17, 1)).toBe(1.25);
    expect(zoom.nextZoom(1.17, -1)).toBe(1.1);
  });

  it("zoom é por host, só em http(s)", () => {
    expect(zoom.zoomHostOf("https://www.exemplo.com:8443/a?b")).toBe("www.exemplo.com:8443");
    expect(zoom.zoomHostOf("agzos://inicio")).toBeNull();
    expect(zoom.zoomHostOf("file:///tmp/a.html")).toBeNull();
  });
});

describe("downloads.cjs", () => {
  it("gera nome único na pasta e respeita os já reservados", () => {
    const dir = tempDir();
    expect(uniquePath(dir, "relatorio.pdf")).toBe(path.join(dir, "relatorio.pdf"));
    fs.writeFileSync(path.join(dir, "relatorio.pdf"), "");
    expect(uniquePath(dir, "relatorio.pdf")).toBe(path.join(dir, "relatorio (1).pdf"));
    const taken = new Set([path.join(dir, "relatorio (1).pdf")]);
    expect(uniquePath(dir, "relatorio.pdf", taken)).toBe(path.join(dir, "relatorio (2).pdf"));
  });

  it("não deixa o nome escapar da pasta", () => {
    const dir = tempDir();
    expect(uniquePath(dir, "../../etc/passwd")).toBe(path.join(dir, "passwd"));
    expect(uniquePath(dir, "")).toBe(path.join(dir, "download"));
    expect(uniquePath(dir, "a:b*c?.txt")).toBe(path.join(dir, "a_b_c_.txt"));
  });
});

describe("adblock.cjs (funções puras)", () => {
  it("mapeia o resourceType do Electron", () => {
    expect(adblockModule.requestTypeOf("xhr")).toBe("xmlhttprequest");
    expect(adblockModule.requestTypeOf("subFrame")).toBe("sub_frame");
    expect(adblockModule.requestTypeOf("desconhecido")).toBe("other");
  });

  it("host do site igual ao do renderer (sem www)", () => {
    expect(adblockModule.siteHostOf("https://www.g1.globo.com/x")).toBe("g1.globo.com");
    expect(adblockModule.siteHostOf("agzos://inicio")).toBeNull();
  });

  it("domínio registrável aproximado", () => {
    expect(adblockModule.domainOf("www.uol.com.br")).toBe("uol.com.br");
    expect(adblockModule.domainOf("news.bbc.co.uk")).toBe("bbc.co.uk");
    expect(adblockModule.domainOf("a.b.example.org")).toBe("example.org");
  });

  it("listas por variável de ambiente, com padrão quando inválida", () => {
    expect(adblockModule.listsFromEnv('{"ads":["http://x/a.txt"]}')).toEqual({
      ads: ["http://x/a.txt"],
      privacy: [],
    });
    expect(adblockModule.listsFromEnv("{quebrado").ads.length).toBeGreaterThan(0);
  });
});

describe("adblock.cjs (motor real)", () => {
  const vendor = path.join(electronDir, "adblocker.vendor.cjs");
  beforeAll(() => {
    if (!fs.existsSync(vendor)) execSync("bun run desktop:vendor", { cwd: root, stdio: "ignore" });
  }, 60_000);

  const lists: Record<string, string> = {
    "ads.txt": "||ads.exemplo.test^\n/banner-anuncio.\n##.caixa-anuncio\n",
    "privacy.txt": "||rastreio.exemplo.test^\n",
  };

  function create(userDataDir: string) {
    const pages: [number, number][] = [];
    const meta = new Map<string, unknown>();
    const adblock = adblockModule.createAdblock({
      userDataDir,
      database: {
        getMeta: (key: string) => meta.get(key) ?? null,
        setMeta: (key: string, value: unknown) => meta.set(key, value),
      },
      fetchText: async (url: string) => lists[url]!,
      lists: { ads: ["ads.txt"], privacy: ["privacy.txt"] },
      emitPage: (id: number, info: { count: number }) => pages.push([id, info.count]),
      emitStats: () => {},
    });
    return { adblock, pages, meta };
  }

  it("compila as listas na worker, bloqueia por categoria e respeita escudo/pausa", async () => {
    const dir = tempDir();
    const { adblock } = create(dir);
    expect(await adblock.update()).toBe(true);
    expect(fs.existsSync(path.join(dir, "adblock", "ads.bin"))).toBe(true);

    const page = "https://www.site.test/";
    const request = (url: string, resourceType = "script") => ({
      url,
      resourceType,
      pageUrl: page,
      sourceUrl: page,
      tabId: 7,
    });
    expect(adblock.shouldBlock(request("https://ads.exemplo.test/x.js"))).toBe(true);
    expect(adblock.shouldBlock(request("https://rastreio.exemplo.test/p.gif", "image"))).toBe(true);
    expect(adblock.shouldBlock(request("https://site.test/app.js"))).toBe(false);
    // Documento principal nunca é bloqueado (a aba abriria em branco).
    expect(adblock.shouldBlock(request("https://ads.exemplo.test/", "mainFrame"))).toBe(false);

    const info = adblock.pageInfo(7);
    expect(info.count).toBe(2);
    expect(info.trackers).toEqual([
      { host: "ads.exemplo.test", category: "Anúncios" },
      { host: "rastreio.exemplo.test", category: "Rastreadores" },
    ]);
    expect(adblock.statsInfo().today).toBe(2);
    // Filtro genérico por classe: casa pelas classes coletadas no DOM.
    expect(adblock.cosmeticCss(page)).not.toContain(".caixa-anuncio");
    expect(adblock.cosmeticCss(page, { classes: ["caixa-anuncio", "outra"] })).toContain(
      ".caixa-anuncio",
    );

    adblock.setConfig({ pausedHosts: ["site.test"] });
    expect(adblock.shouldBlock(request("https://ads.exemplo.test/x.js"))).toBe(false);
    expect(adblock.cosmeticCss(page, { classes: ["caixa-anuncio"] })).toBe("");
    adblock.setConfig({ enabled: false, pausedHosts: [] });
    expect(adblock.shouldBlock(request("https://ads.exemplo.test/x.js"))).toBe(false);
    adblock.setConfig({ enabled: true });
    expect(adblock.shouldBlock(request("https://ads.exemplo.test/x.js"))).toBe(true);

    adblock.resetPage(7);
    expect(adblock.pageInfo(7).count).toBe(0);
    adblock.close();
  });

  it("boot seguinte carrega o motor do cache, sem baixar as listas", async () => {
    const dir = tempDir();
    const first = create(dir);
    await first.adblock.update();
    first.adblock.close();

    let fetched = 0;
    const second = adblockModule.createAdblock({
      userDataDir: dir,
      database: null,
      fetchText: async () => {
        fetched += 1;
        return "";
      },
      lists: { ads: ["ads.txt"], privacy: ["privacy.txt"] },
      emitPage: () => {},
      emitStats: () => {},
    });
    second.start();
    expect(fetched).toBe(0);
    expect(second.statsInfo().ready).toBe(true);
    expect(
      second.shouldBlock({
        url: "https://ads.exemplo.test/x.js",
        resourceType: "script",
        pageUrl: "https://a.test/",
      }),
    ).toBe(true);
    second.close();
  });
});

describe("empacotamento", () => {
  it("todo require local do main está em ELECTRON_FILES do build-all.sh", () => {
    const script = fs.readFileSync(path.join(root, "scripts/build-all.sh"), "utf8");
    const listed = new Set(
      script
        .match(/ELECTRON_FILES=\(([^)]*)\)/)![1]!
        .trim()
        .split(/\s+/),
    );
    const pending = ["main.cjs"];
    const seen = new Set<string>();
    while (pending.length) {
      const file = pending.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const source = fs.readFileSync(path.join(electronDir, file), "utf8");
      const locals = [
        ...source.matchAll(/require\(\s*"\.\/([\w.-]+)"\s*\)/g),
        ...source.matchAll(/path\.join\(__dirname,\s*"([\w.-]+\.cjs)"\)/g),
      ].map((match) => match[1]!);
      pending.push(...locals);
    }
    seen.add("preload.cjs");
    expect([...seen].filter((file) => !listed.has(file))).toEqual([]);
  });
});

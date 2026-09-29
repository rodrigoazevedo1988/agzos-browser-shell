import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";

// Abre o app empacotado (dist/ + electron/) com um perfil temporário.
// Pré-requisito: `bun run desktop:build`. No Linux sem tela, rodar sob xvfb-run.

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let server: http.Server;
let origin = "";

const FILTERS: Record<string, string> = {
  "/filtros/anuncios.txt":
    "/anuncios/banner.js\n##.caixa-anuncio\n127.0.0.1##+js(agzos-teste)\n" +
    "/anuncios/substituto.js$script,redirect=noopjs\n",
  // Formato do resources.json do uBlock Origin (espelho do Ghostery).
  "/filtros/recursos.json": JSON.stringify({
    scriptlets: [
      {
        name: "agzos-teste.js",
        aliases: [],
        body: "function agzosTeste(){window.__agzosScriptlet = true;}",
        dependencies: [],
      },
    ],
    redirects: [
      {
        name: "noop.js",
        aliases: ["noopjs"],
        body: "window.__agzosRedirect = true;",
        contentType: "application/javascript",
      },
    ],
  }),
  "/filtros/privacidade.txt": "/pixel/rastreio.gif\n",
};

const PAGES: Record<string, string> = {
  "/com-anuncio": `<!doctype html><title>Com anúncio</title>
    <h1>Notícia</h1><div class="caixa-anuncio">ANÚNCIO</div>
    <script src="/anuncios/banner.js"></script>
    <img src="/pixel/rastreio.gif" alt="">`,
  // CSP com nonce, como o YouTube: script inline sem nonce seria recusado.
  "/scriptlet": `<!doctype html><meta http-equiv="Content-Security-Policy"
    content="script-src 'nonce-agzos'"><title>Scriptlet</title>
    <script nonce="agzos">window.viuScriptlet = window.__agzosScriptlet === true;</script>`,
  // Página de login: mesmas regras casariam, mas o Agzos não pode tocar nela.
  "/login": `<!doctype html><title>Entrar</title>
    <div class="caixa-anuncio">caixa</div>
    <script>window.viuScriptlet = window.__agzosScriptlet === true;</script>`,
  "/busca": `<!doctype html><title>Busca</title>
    <p>agzos um</p><p>outro texto</p><p>agzos dois</p><p>mais agzos três</p>`,
  "/baixar": `<!doctype html><title>Baixar</title><a href="/arquivo/relatorio.txt">relatório</a>`,
};

test.beforeAll(async () => {
  server = http.createServer((request, response) => {
    const url = request.url ?? "/";
    if (FILTERS[url]) {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end(FILTERS[url]);
      return;
    }
    if (url === "/anuncios/banner.js") {
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end("window.anuncioCarregou = true;");
      return;
    }
    if (url === "/pixel/rastreio.gif") {
      response.writeHead(200, { "content-type": "image/gif" });
      response.end();
      return;
    }
    if (url === "/arquivo/relatorio.txt") {
      response.writeHead(200, {
        "content-type": "text/plain",
        "content-disposition": 'attachment; filename="relatorio.txt"',
      });
      response.end("conteúdo do relatório agzos\n");
      return;
    }
    if (url === "/arquivo/lento.bin") {
      // 24 pedaços de 64 KB a cada 120 ms: dá tempo de pausar e retomar.
      const chunk = Buffer.alloc(64 * 1024, 7);
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": String(chunk.length * 24),
        "content-disposition": 'attachment; filename="lento.bin"',
      });
      let sent = 0;
      const timer = setInterval(() => {
        response.write(chunk);
        if (++sent === 24) {
          clearInterval(timer);
          response.end();
        }
      }, 120);
      request.on("close", () => clearInterval(timer));
      return;
    }
    // Latência de site real (a página nunca chega antes do CDP registrar os scriptlets).
    if (url === "/scriptlet") {
      setTimeout(() => {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(PAGES[url]);
      }, 150);
      return;
    }
    const html = PAGES[url];
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    if (html) {
      response.end(html);
      return;
    }
    const name = url.slice(1) || "a";
    response.end(`<!doctype html><title>Página ${name.toUpperCase()}</title><h1>${name}</h1>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

function tempProfile() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agzos-e2e-"));
}

async function launch(profile: string): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch({
    args: ["--no-sandbox", root],
    cwd: root,
    env: {
      ...process.env,
      AGZOS_USER_DATA: profile,
      AGZOS_DOWNLOADS_DIR: path.join(profile, "Downloads"),
      // Listas locais: o teste não depende da internet nem das listas reais.
      AGZOS_FILTER_LISTS: JSON.stringify({
        ads: [`${origin}/filtros/anuncios.txt`],
        privacy: [`${origin}/filtros/privacidade.txt`],
        resources: `${origin}/filtros/recursos.json`,
      }),
    },
  });
  const window = await app.firstWindow();
  await window.locator('.browser-stage[data-ready="true"]').waitFor();
  return { app, window };
}

const tabs = (window: Page) => window.locator(".browser-tab");
const omnibox = (window: Page) => window.getByLabel("Pesquisar ou digitar endereço");

async function go(window: Page, url: string) {
  await omnibox(window).fill(url);
  await omnibox(window).press("Enter");
}

/** Roda JavaScript na aba cuja URL é `url` e devolve o resultado. */
async function inTab<T>(app: ElectronApplication, url: string, code: string): Promise<T> {
  return app.evaluate(
    ({ webContents }, [target, source]) =>
      webContents
        .getAllWebContents()
        .find((contents) => contents.getURL() === target)!
        .executeJavaScript(source!),
    [url, code] as const,
  ) as Promise<T>;
}

/** Tecla com o foco dentro da página (passa pelo before-input-event da aba). */
async function keyInTab(
  app: ElectronApplication,
  url: string,
  keyCode: string,
  modifiers: string[] = [],
) {
  await app.evaluate(
    ({ webContents }, [target, key, mods]) => {
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === target)!;
      contents.focus();
      contents.sendInputEvent({
        type: "keyDown",
        keyCode: key as string,
        modifiers: mods as ("control" | "shift" | "alt")[],
      });
      contents.sendInputEvent({
        type: "keyUp",
        keyCode: key as string,
        modifiers: mods as ("control" | "shift" | "alt")[],
      });
    },
    [url, keyCode, modifiers] as const,
  );
}

const MOD = process.platform === "darwin" ? "Meta" : "Control";

/** Espera o motor de filtros ficar pronto (o rodapé do painel mostra a data das listas). */
async function waitForFilters(window: Page) {
  await window.getByRole("button", { name: /bloqueados/ }).click();
  await expect(window.getByText(/atualizadas em/)).toBeVisible({ timeout: 20_000 });
  await window.getByRole("button", { name: "Fechar proteção" }).click();
}

/** URLs de todos os WebContents de página (abas) vivos no main process. */
async function liveViews(app: ElectronApplication, needle: string) {
  return app.evaluate(
    ({ webContents }, text) =>
      webContents
        .getAllWebContents()
        .map((contents) => contents.getURL())
        .filter((url) => url.includes(text)),
    needle,
  );
}

test("navega de verdade, sincroniza título e voltar/avançar", async () => {
  const { app, window } = await launch(tempProfile());
  try {
    await go(window, `${origin}/a`);
    await expect(tabs(window).first()).toContainText("Página A");
    await go(window, `${origin}/b`);
    await expect(tabs(window).first()).toContainText("Página B");

    await window.getByRole("button", { name: "Voltar" }).click();
    await expect(tabs(window).first()).toContainText("Página A");
    await expect(omnibox(window)).toHaveValue(`${origin}/a`);
    await window.getByRole("button", { name: "Avançar" }).click();
    await expect(omnibox(window)).toHaveValue(`${origin}/b`);
  } finally {
    await app.close();
  }
});

test("identidade de Chrome segue ativa nas abas", async () => {
  const { app, window } = await launch(tempProfile());
  try {
    await go(window, `${origin}/ua`);
    await expect(tabs(window).first()).toContainText("Página UA");
    const identity = await app.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === url);
      return contents?.executeJavaScript(
        `({ ua: navigator.userAgent, app: typeof window.chrome?.app, csi: typeof window.chrome?.csi,
            brands: navigator.userAgentData?.brands?.map((b) => b.brand) ?? [] })`,
      );
    }, `${origin}/ua`);
    expect(identity.ua).not.toMatch(/Electron|agzos/i);
    expect(identity.ua).toMatch(/Chrome\/\d+\.0\.0\.0/);
    expect(identity.app).toBe("object");
    expect(identity.csi).toBe("function");
    expect(identity.brands).toContain("Google Chrome");
  } finally {
    await app.close();
  }
});

test("fechar a aba destrói o WebContentsView", async () => {
  const { app, window } = await launch(tempProfile());
  try {
    await window.getByRole("button", { name: "Nova aba", exact: true }).click();
    await go(window, `${origin}/fechar`);
    await expect(tabs(window).last()).toContainText("Página FECHAR");
    expect(await liveViews(app, "/fechar")).toHaveLength(1);
    await tabs(window)
      .last()
      .getByLabel(/^Fechar /)
      .click();
    await expect(tabs(window)).toHaveCount(1);
    await expect.poll(() => liveViews(app, "/fechar")).toHaveLength(0);
  } finally {
    await app.close();
  }
});

test("estado persiste no SQLite entre reinícios; aba anônima não", async () => {
  const profile = tempProfile();
  const first = await launch(profile);
  await go(first.window, `${origin}/salva`);
  await expect(tabs(first.window).first()).toContainText("Página SALVA");
  await first.window.getByRole("button", { name: "Nova aba anônima" }).click();
  await go(first.window, `${origin}/secreta`);
  await first.window.getByRole("button", { name: "Usar tema escuro" }).click();
  // Deixa o debounce de gravação terminar antes de fechar.
  await first.window.waitForTimeout(800);
  await first.app.close();

  expect(fs.existsSync(path.join(profile, "agzos.db"))).toBe(true);

  const second = await launch(profile);
  try {
    await expect(tabs(second.window)).toHaveCount(1);
    await expect(tabs(second.window).first()).toContainText("Página SALVA");
    await expect(second.window.locator(".browser-stage")).toHaveClass(/dark/);
    const stored = await second.app.evaluate(
      async (_electron, file) => {
        const { DatabaseSync } = process.getBuiltinModule(
          "node:sqlite",
        ) as typeof import("node:sqlite");
        const db = new DatabaseSync(file, { readOnly: true });
        const rows = db.prepare("SELECT key, value FROM kv").all() as {
          key: string;
          value: string;
        }[];
        db.close();
        return Object.fromEntries(rows.map((row) => [row.key, row.value]));
      },
      path.join(profile, "agzos.db"),
    );
    expect(
      Object.keys(stored)
        .filter((key) => !key.startsWith("meta:"))
        .sort(),
    ).toEqual(["closedTabs", "links", "prefs", "session", "version"]);
    expect(stored["session"]).toContain("/salva");
    expect(JSON.stringify(stored)).not.toContain("secreta");
  } finally {
    await second.app.close();
  }
});

test("migra o estado da 1.3 (localStorage) para o SQLite", async () => {
  const profile = tempProfile();
  const legacyTabs = [
    {
      id: 1727000000000,
      history: [{ title: "Legado", url: `${origin}/legado`, kind: "page" }],
      index: 0,
    },
  ];
  const first = await launch(profile);
  await first.window.evaluate((tabsJson) => {
    window.localStorage.setItem("agzos-tabs", tabsJson);
    window.localStorage.setItem("agzos-theme", "dark");
    window.localStorage.setItem("agzos-tab-orientation", "vertical");
  }, JSON.stringify(legacyTabs));
  await first.app.close();
  // Simula o primeiro boot da 1.4: sem banco ainda.
  for (const file of fs.readdirSync(profile)) {
    if (file.startsWith("agzos.db")) fs.rmSync(path.join(profile, file));
  }

  const second = await launch(profile);
  try {
    await expect(second.window.locator(".tabs-rail")).toBeVisible();
    await expect(tabs(second.window).first()).toContainText("Página LEGADO");
    await expect(second.window.locator(".browser-stage")).toHaveClass(/dark/);
    const leftovers = await second.window.evaluate(() =>
      Object.keys(window.localStorage).filter(
        (key) => key.startsWith("agzos-") && key !== "agzos-credentials",
      ),
    );
    expect(leftovers).toEqual([]);
  } finally {
    await second.app.close();
  }
});

test("adblock bloqueia de verdade, conta por página e pausa por site", async () => {
  const { app, window } = await launch(tempProfile());
  const url = `${origin}/com-anuncio`;
  try {
    await waitForFilters(window);
    await go(window, url);
    await expect(tabs(window).first()).toContainText("Com anúncio");
    const pill = window.getByRole("button", { name: /bloqueados/ });
    await expect(pill.locator("strong")).toHaveText("2");
    await expect
      .poll(() =>
        inTab(
          app,
          url,
          `({ script: Boolean(window.anuncioCarregou),
              caixa: getComputedStyle(document.querySelector(".caixa-anuncio")).display })`,
        ),
      )
      .toEqual({ script: false, caixa: "none" });

    await pill.click();
    const panel = window.getByRole("complementary", { name: "Rastreadores bloqueados" });
    await expect(panel).toContainText("2 bloqueados nesta página");
    await expect(panel).toContainText("Anúncios");
    await expect(panel).toContainText("Rastreadores");
    await panel.getByText("Pausar neste site").click();
    await window.getByRole("button", { name: "Fechar proteção" }).click();
    await window.getByRole("button", { name: "Recarregar" }).click();
    await expect.poll(() => inTab(app, url, "Boolean(window.anuncioCarregou)")).toBe(true);
    await expect(pill.locator("strong")).toHaveText("0");
  } finally {
    await app.close();
  }
});

test("downloads: salva na pasta, mostra progresso, pausa/retoma e persiste", async () => {
  const profile = tempProfile();
  const downloadsDir = path.join(profile, "Downloads");
  fs.mkdirSync(downloadsDir, { recursive: true });
  fs.writeFileSync(path.join(downloadsDir, "relatorio.txt"), "já existia");
  const first = await launch(profile);
  try {
    await go(first.window, `${origin}/arquivo/relatorio.txt`);
    const button = first.window.getByRole("button", { name: "Downloads", exact: true });
    await expect(button).toBeVisible();
    await first.window.keyboard.press(`${MOD}+j`);
    const panel = first.window.getByRole("complementary", { name: "Downloads" });
    // Nome já existia na pasta: vira "relatorio (1).txt".
    await expect(panel).toContainText("relatorio (1).txt");
    await expect
      .poll(() => fs.readFileSync(path.join(downloadsDir, "relatorio (1).txt"), "utf8"))
      .toContain("relatório agzos");

    await first.window.keyboard.press(`${MOD}+j`);
    await go(first.window, `${origin}/arquivo/lento.bin`);
    await first.window.keyboard.press(`${MOD}+j`);
    await expect(panel.getByRole("progressbar")).toBeVisible();
    await panel.getByRole("button", { name: "Pausar lento.bin" }).click();
    await expect(panel).toContainText("Pausado");
    await panel.getByRole("button", { name: "Retomar lento.bin" }).click();
    await expect(panel.locator('[data-state="completed"]')).toHaveCount(2, { timeout: 15_000 });
    expect(fs.statSync(path.join(downloadsDir, "lento.bin")).size).toBe(24 * 64 * 1024);
  } finally {
    await first.app.close();
  }

  const second = await launch(profile);
  try {
    await second.window.keyboard.press(`${MOD}+j`);
    const panel = second.window.getByRole("complementary", { name: "Downloads" });
    await expect(panel).toContainText("relatorio (1).txt");
    await expect(panel).toContainText("lento.bin");
    await panel.getByRole("button", { name: "Remover lento.bin" }).click();
    await expect(panel).not.toContainText("lento.bin");
    await panel.getByRole("button", { name: "Limpar concluídos" }).click();
    await expect(panel).toContainText("Os arquivos que você baixar aparecem aqui.");
    await expect(second.window.getByRole("button", { name: "Downloads", exact: true })).toHaveCount(
      0,
    );
  } finally {
    await second.app.close();
  }
});

test("Ctrl+F busca na página, com o foco na casca ou na página", async () => {
  const { app, window } = await launch(tempProfile());
  const url = `${origin}/busca`;
  try {
    await go(window, url);
    await expect(tabs(window).first()).toContainText("Busca");
    await keyInTab(app, url, "F", ["control"]);
    const input = window.getByRole("textbox", { name: "Buscar na página" });
    await expect(input).toBeFocused();
    await input.fill("agzos");
    const status = window.locator(".find-status");
    await expect(status).toHaveText("1 de 3");
    await input.press("Enter");
    await expect(status).toHaveText("2 de 3");
    await input.press("Shift+Enter");
    await expect(status).toHaveText("1 de 3");
    await input.fill("inexistente");
    await expect(status).toHaveText("Nenhum resultado");
    await input.press("Escape");
    await expect(input).toHaveCount(0);
    // Na página inicial não há o que buscar: Ctrl+F não abre a barra.
    await window.getByRole("button", { name: "Nova aba", exact: true }).click();
    await window.keyboard.press(`${MOD}+f`);
    await expect(input).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test("zoom por site com Ctrl +/−/0, indicador e persistência", async () => {
  const profile = tempProfile();
  const url = `${origin}/zoom`;
  const factor = (app: ElectronApplication) =>
    app.evaluate(
      ({ webContents }, target) =>
        webContents
          .getAllWebContents()
          .find((contents) => contents.getURL() === target)
          ?.getZoomFactor(),
      url,
    );
  const first = await launch(profile);
  try {
    await go(first.window, url);
    await expect(tabs(first.window).first()).toContainText("Página ZOOM");
    await first.window.keyboard.press(`${MOD}+=`);
    await keyInTab(first.app, url, "=", ["control"]);
    await expect(first.window.locator(".zoom-pill")).toHaveText("125%");
    await expect.poll(() => factor(first.app)).toBeCloseTo(1.25);
  } finally {
    await first.app.close();
  }

  const second = await launch(profile);
  try {
    await expect(tabs(second.window).first()).toContainText("Página ZOOM");
    await expect(second.window.locator(".zoom-pill")).toHaveText("125%");
    await expect.poll(() => factor(second.app)).toBeCloseTo(1.25);
    await second.window.locator(".zoom-pill").click();
    await expect(second.window.locator(".zoom-pill")).toHaveCount(0);
    await expect.poll(() => factor(second.app)).toBeCloseTo(1);
  } finally {
    await second.app.close();
  }
});

test("atalhos com o foco na página: Ctrl+Tab, Ctrl+1/9, Alt+←, Ctrl+T", async () => {
  const { app, window } = await launch(tempProfile());
  try {
    await go(window, `${origin}/um`);
    await expect(tabs(window).first()).toContainText("Página UM");
    await go(window, `${origin}/dois`);
    await expect(tabs(window).first()).toContainText("Página DOIS");
    await keyInTab(app, `${origin}/dois`, "Left", ["alt"]);
    await expect(omnibox(window)).toHaveValue(`${origin}/um`);

    await keyInTab(app, `${origin}/um`, "T", ["control"]);
    await expect(tabs(window)).toHaveCount(2);
    await go(window, `${origin}/tres`);
    await expect(tabs(window).last()).toContainText("Página TRES");

    // Ctrl+Tab: ordem de uso (volta para a UM), confirmado ao soltar o Ctrl.
    await keyInTab(app, `${origin}/tres`, "Tab", ["control"]);
    await keyInTab(app, `${origin}/tres`, "Control");
    await expect(window.locator(".browser-tab.active")).toContainText("Página UM");
    await keyInTab(app, `${origin}/um`, "9", ["control"]);
    await expect(window.locator(".browser-tab.active")).toContainText("Página TRES");
    await keyInTab(app, `${origin}/tres`, "1", ["control"]);
    await expect(window.locator(".browser-tab.active")).toContainText("Página UM");
  } finally {
    await app.close();
  }
});

test("fechar o app com download em andamento não trava e o registra como cancelado", async () => {
  const profile = tempProfile();
  const first = await launch(profile);
  await go(first.window, `${origin}/a`);
  await expect(tabs(first.window).first()).toContainText("Página A");
  await go(first.window, `${origin}/arquivo/lento.bin`);
  await expect(first.window.getByRole("button", { name: "Downloads", exact: true })).toBeVisible();
  const started = Date.now();
  await first.app.close();
  expect(Date.now() - started).toBeLessThan(5_000);

  const second = await launch(profile);
  try {
    await second.window.keyboard.press(`${MOD}+j`);
    const panel = second.window.getByRole("complementary", { name: "Downloads" });
    await expect(panel.locator('[data-state="cancelled"]')).toContainText("Cancelado");
  } finally {
    await second.app.close();
  }
});

test("seletor do Ctrl+Tab com miniaturas das páginas, confirmado ao soltar o Ctrl", async () => {
  const { app, window } = await launch(tempProfile());
  try {
    await go(window, `${origin}/um`);
    await expect(tabs(window).first()).toContainText("Página UM");
    await window.getByRole("button", { name: "Nova aba", exact: true }).click();
    await go(window, `${origin}/dois`);
    await expect(tabs(window).last()).toContainText("Página DOIS");
    // Ctrl pressionado + Tab, sem soltar: o seletor aparece por cima da página.
    await app.evaluate(({ webContents }, target) => {
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === target)!;
      contents.focus();
      contents.sendInputEvent({ type: "keyDown", keyCode: "Tab", modifiers: ["control"] });
    }, `${origin}/dois`);
    const switcher = window.getByRole("listbox", { name: "Alternar guias" });
    await expect(switcher).toBeVisible();
    const options = switcher.getByRole("option");
    await expect(options).toHaveCount(2);
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
    // As duas abas já estiveram visíveis: as duas têm miniatura de verdade.
    await expect(switcher.locator(".switcher-preview > img")).toHaveCount(2, { timeout: 10_000 });
    await window.keyboard.up("Control");
    await expect(switcher).toHaveCount(0);
    await expect(window.locator(".browser-tab.active")).toContainText("Página UM");
  } finally {
    await app.close();
  }
});

test("scriptlets (+js) rodam antes dos scripts da página, mesmo com CSP de nonce", async () => {
  const { app, window } = await launch(tempProfile());
  const url = `${origin}/scriptlet`;
  try {
    await waitForFilters(window);
    await go(window, url);
    await expect(tabs(window).first()).toContainText("Scriptlet");
    // Primeira carga numa guia nova: o scriptlet roda (quase sempre antes do HTML; o CDP
    // de uma guia que ainda não navegou às vezes só o aplica depois).
    await expect.poll(() => inTab(app, url, "window.__agzosScriptlet === true")).toBe(true);
    // Da carga seguinte em diante: sempre antes de qualquer script da página.
    for (let i = 0; i < 2; i++) {
      await window.getByRole("button", { name: "Recarregar" }).click();
      await window.waitForTimeout(700);
      await expect.poll(() => inTab(app, url, "window.viuScriptlet")).toBe(true);
    }
  } finally {
    await app.close();
  }
});

test("painel aberto mostra a foto da página no lugar (não fica preto)", async () => {
  const { app, window } = await launch(tempProfile());
  const url = `${origin}/foto`;
  try {
    await go(window, url);
    await expect(tabs(window).first()).toContainText("Página FOTO");
    await window.waitForTimeout(400);
    await window.getByRole("button", { name: "Configurações" }).click();
    const photo = window.locator(".view-snapshot");
    await expect(photo).toBeVisible();
    expect(await photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(100);
    // O WebContentsView saiu da frente (senão cobriria o painel).
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }, target) => {
          const win = BrowserWindow.getAllWindows()[0]!;
          const view = win.contentView.children.find(
            (child) =>
              "webContents" in child &&
              (child as { webContents: Electron.WebContents }).webContents.getURL() === target,
          );
          return view?.getBounds().width ?? -1;
        }, url),
      )
      .toBe(0);
    await window.keyboard.press("Escape");
    await expect(photo).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test("páginas de login ficam intocadas: sem scriptlet, sem CSS de ocultação", async () => {
  const { app, window } = await launch(tempProfile());
  const url = `${origin}/login`;
  try {
    await waitForFilters(window);
    await go(window, url);
    await expect(tabs(window).first()).toContainText("Entrar");
    await window.waitForTimeout(800);
    expect(
      await inTab(
        app,
        url,
        `({ scriptlet: window.viuScriptlet,
            caixa: getComputedStyle(document.querySelector(".caixa-anuncio")).display })`,
      ),
    ).toEqual({ scriptlet: false, caixa: "block" });
  } finally {
    await app.close();
  }
});

test("identidade de Chrome vale em toda carga da guia (recarga, mesma origem, outra origem)", async () => {
  // Regressão da 1.3.3–1.3.6: o shim só valia na primeira carga da guia; entrar pelo
  // "Fazer login" do google.com (navegação na mesma guia) chegava sem window.chrome.app
  // e o Google recusava o login.
  const { app, window } = await launch(tempProfile());
  const identity = (needle: string) =>
    app.evaluate(
      ({ webContents }, text) =>
        webContents
          .getAllWebContents()
          .find((contents) => contents.getURL().includes(text))!
          .executeJavaScript(
            "[typeof chrome.app, typeof chrome.csi, typeof chrome.loadTimes, " +
              "navigator.userAgentData.brands.some((b) => b.brand === 'Google Chrome')].join()",
          ),
      needle,
    );
  const expected = "object,function,function,true";
  try {
    await go(window, `${origin}/id1`);
    await expect(tabs(window).first()).toContainText("Página ID1");
    expect(await identity("/id1")).toBe(expected);

    await window.getByRole("button", { name: "Recarregar" }).click();
    await window.waitForTimeout(800);
    expect(await identity("/id1")).toBe(expected);

    await go(window, `${origin}/id2`);
    await expect(tabs(window).first()).toContainText("Página ID2");
    expect(await identity("/id2")).toBe(expected);

    const other = origin.replace("127.0.0.1", "localhost");
    await go(window, `${other}/id3`);
    await expect(tabs(window).first()).toContainText("Página ID3");
    expect(await identity("/id3")).toBe(expected);

    await window.getByRole("button", { name: "Voltar" }).click();
    await expect(tabs(window).first()).toContainText("Página ID2");
    expect(await identity("/id2")).toBe(expected);
  } finally {
    await app.close();
  }
});

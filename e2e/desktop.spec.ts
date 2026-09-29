import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
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
    "localhost##+js(agzos-teste)\n" +
    "127.0.0.1##+js(agzos-rpnt)\n" +
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
      {
        // Como o replace-node-text do uBO: reescreve um <script> inline antes de ele rodar.
        // No mundo da página os Trusted Types barrariam; no mundo isolado passa.
        name: "agzos-rpnt.js",
        aliases: [],
        body:
          // Como o uBO: cria uma política de Trusted Types para poder trocar o texto.
          "function agzosRpnt(){var tt=self.trustedTypes;var f={createScript:function(s){return s;}};" +
          "if(tt&&tt.getPropertyType&&tt.getPropertyType('script','textContent')==='TrustedScript')" +
          "{f=tt.createPolicy('agzos-'+Math.random().toString(36).slice(2),f);}" +
          "new MutationObserver(function(ms){ms.forEach(function(m){" +
          "m.addedNodes.forEach(function(n){if(n.nodeName==='SCRIPT'&&n.textContent.indexOf('ANUNCIO')>=0)" +
          "{n.textContent=f.createScript(n.textContent.replace('ANUNCIO','LIMPO'));}});});})" +
          ".observe(document,{childList:true,subtree:true});}",
        dependencies: [],
        executionWorld: "ISOLATED",
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
  "/com-link": `<!doctype html><title>Com link</title><a id="ir" href="LINK">ir</a>`,
  // Trusted Types + nonce, como o YouTube.
  "/tt": `<!doctype html><meta http-equiv="Content-Security-Policy"
    content="require-trusted-types-for 'script'; script-src 'nonce-agzos'"><title>TT</title>
    <script nonce="agzos">window.resultado = "ANUNCIO";</script>`,
  "/busca": `<!doctype html><title>Busca</title>
    <p>agzos um</p><p>outro texto</p><p>agzos dois</p><p>mais agzos três</p>`,
  "/baixar": `<!doctype html><title>Baixar</title><a href="/arquivo/relatorio.txt">relatório</a>`,
  "/formulario": `<!doctype html><title>Formulário</title><input id="nome" value="">`,
};

// /instavel derruba a conexão (ERR_EMPTY_RESPONSE) enquanto o "servidor" estiver fora.
let unstableDown = true;

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
    if (url.startsWith("/com-link?para=")) {
      const target = decodeURIComponent(url.slice("/com-link?para=".length));
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(PAGES["/com-link"]!.replace("LINK", target));
      return;
    }
    if (url === "/instavel" && unstableDown) {
      request.socket.destroy();
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

async function launch(
  profile: string,
  extraEnv: Record<string, string> = {},
): Promise<{ app: ElectronApplication; window: Page }> {
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
      ...extraEnv,
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
    ).toEqual(["bookmarks", "closedTabs", "links", "prefs", "version"]);
    // 1.7: a sessão (guias) é de cada janela e fica no registro das janelas.
    expect(stored["meta:windows"]).toContain("/salva");
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
    // Já na primeira carga de uma guia nova (a guia passa antes por about:blank).
    await expect.poll(() => inTab(app, url, "window.viuScriptlet")).toBe(true);
    // O about:blank da preparação não fica no histórico.
    await expect(window.getByRole("button", { name: "Voltar" })).toBeDisabled();
    // E nas recargas.
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

test("scriptlets ao chegar por link (navegação iniciada pela página)", async () => {
  const { app, window } = await launch(tempProfile());
  const other = origin.replace("127.0.0.1", "localhost");
  const target = `${other}/scriptlet`;
  try {
    await waitForFilters(window);
    const start = `${origin}/com-link?para=${encodeURIComponent(target)}`;
    await go(window, start);
    await expect(tabs(window).first()).toContainText("Com link");
    await inTab(app, start, "document.getElementById('ir').click(), true");
    await expect(tabs(window).first()).toContainText("Scriptlet");
    const state = await inTab(
      app,
      target,
      "JSON.stringify({ antes: window.viuScriptlet, rodou: window.__agzosScriptlet === true })",
    );
    console.log("LINK", state);
    expect(JSON.parse(state as string).rodou).toBe(true);
  } finally {
    await app.close();
  }
});

test("scriptlet do mundo isolado reescreve script inline mesmo com Trusted Types (como no YouTube)", async () => {
  const { app, window } = await launch(tempProfile());
  const url = `${origin}/tt`;
  try {
    await waitForFilters(window);
    await go(window, url);
    await expect(tabs(window).first()).toContainText("TT");
    // Da carga seguinte em diante o registro vale antes de qualquer script da página.
    await window.getByRole("button", { name: "Recarregar" }).click();
    await expect.poll(() => inTab(app, url, "window.resultado")).toBe("LIMPO");
  } finally {
    await app.close();
  }
});

/** Roda JavaScript na aba como se viesse de um clique (pedidos de permissão). */
async function withGesture<T>(app: ElectronApplication, url: string, code: string): Promise<T> {
  return app.evaluate(
    ({ webContents }, [target, source]) =>
      webContents
        .getAllWebContents()
        .find((contents) => contents.getURL() === target)!
        .executeJavaScript(source!, true),
    [url, code] as const,
  ) as Promise<T>;
}

test("1.6: histórico das navegações reais (sem a anônima), sugestão na omnibox e reinício", async () => {
  const profile = tempProfile();
  const first = await launch(profile);
  await go(first.window, `${origin}/historia-um`);
  await expect(tabs(first.window).first()).toContainText("Página HISTORIA-UM");
  await go(first.window, `${origin}/historia-dois`);
  await expect(tabs(first.window).first()).toContainText("Página HISTORIA-DOIS");
  await first.window.getByRole("button", { name: "Nova aba anônima" }).click();
  await go(first.window, `${origin}/historia-secreta`);
  await expect(tabs(first.window).last()).toContainText("Página HISTORIA-SECRETA");
  await first.app.close();

  const second = await launch(profile);
  const { window } = second;
  try {
    // Omnibox: o histórico aparece como sugestão e o título veio da página.
    await omnibox(window).fill("");
    await omnibox(window).pressSequentially("historia");
    const list = window.getByRole("listbox", { name: "Sugestões" });
    await expect(list.getByRole("option", { name: /Página HISTORIA-UM/ })).toBeVisible();
    await expect(list.getByRole("option", { name: /SECRETA/ })).toHaveCount(0);
    await omnibox(window).press("Escape");

    await window.keyboard.press("Control+h");
    const page = window.locator(".library-page");
    await expect(page.getByRole("heading", { name: "Histórico", level: 1 })).toBeVisible();
    await expect(page.locator(".library-row")).toHaveCount(2);
    await expect(page.getByText("Página HISTORIA-DOIS")).toBeVisible();
    // Clicar abre o site na aba do histórico (vira página de verdade).
    await page.getByText("Página HISTORIA-UM").click();
    await expect(tabs(window).last()).toContainText("Página HISTORIA-UM");
    await expect.poll(() => liveViews(second.app, "/historia-um")).toHaveLength(1);
  } finally {
    await second.app.close();
  }
});

test("1.6: permissão lembrada vale depois de reiniciar; bloqueio vira 'denied'", async () => {
  const profile = tempProfile();
  const url = `${origin}/notificacoes`;
  const first = await launch(profile);
  try {
    await go(first.window, url);
    await expect(tabs(first.window).first()).toContainText("Página NOTIFICACOES");
    // Sem decisão, a página continua vendo "default" (identidade de Chrome intacta).
    expect(await inTab(first.app, url, "Notification.permission")).toBe("default");
    const asked = withGesture<string>(first.app, url, "Notification.requestPermission()");
    const bar = first.window.getByRole("alertdialog", { name: "Pedido de permissão" });
    await expect(bar).toContainText("quer mostrar notificações");
    // A faixa fica acima da página nativa (antes flutuava e ficava atrás dela).
    const barBox = (await bar.boundingBox())!;
    // O WebContentsView ocupa a caixa do .native-view (setBounds).
    const frame = (await first.window.locator(".native-view").boundingBox())!;
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(frame.y + 1);
    await bar.getByRole("button", { name: "Permitir" }).click();
    expect(await asked).toBe("granted");
  } finally {
    await first.app.close();
  }

  const second = await launch(profile);
  const { window } = second;
  try {
    // A sessão volta com a página aberta.
    await expect(tabs(window).first()).toContainText("Página NOTIFICACOES");
    await expect
      .poll(() => inTab(second.app, url, "document.readyState").catch(() => ""))
      .toBe("complete");
    // Lembrado: responde sem perguntar.
    expect(await withGesture(second.app, url, "Notification.requestPermission()")).toBe("granted");
    await expect(window.getByRole("alertdialog", { name: "Pedido de permissão" })).toHaveCount(0);

    // Cadeado → Bloquear: a próxima carga vê "denied", como no Chrome.
    await window.getByRole("button", { name: "Informações do site" }).click();
    const panel = window.getByRole("complementary", { name: "Informações do site" });
    await panel.getByLabel(/^Notificações em/).selectOption("block");
    await panel.getByRole("button", { name: "Fechar informações do site" }).click();
    await window.getByRole("button", { name: "Recarregar" }).click();
    await expect.poll(() => inTab(second.app, url, "Notification.permission")).toBe("denied");
    expect(await withGesture(second.app, url, "Notification.requestPermission()")).toBe("denied");

    // Configurações lista o site e volta para "Perguntar".
    await window.getByRole("button", { name: "Configurações" }).click();
    const settings = window.getByRole("complementary", { name: "Configurações" });
    const select = settings.getByLabel(/^Notificações em 127\.0\.0\.1/);
    await expect(select).toHaveValue("block");
    await select.selectOption("ask");
    await expect(settings.getByText(/o site aparece aqui/)).toBeVisible();
  } finally {
    await second.app.close();
  }
});

test("1.6: favorito pela estrela persiste no SQLite e abre pela barra", async () => {
  const profile = tempProfile();
  const first = await launch(profile);
  await go(first.window, `${origin}/favorita`);
  await expect(tabs(first.window).first()).toContainText("Página FAVORITA");
  await first.window.keyboard.press("Control+d");
  const editor = first.window.getByRole("complementary", { name: "Favorito adicionado" });
  await editor.getByLabel("Nome do favorito").fill("Minha favorita");
  await editor.getByRole("button", { name: "Concluído" }).click();
  await first.window.waitForTimeout(800);
  await first.app.close();

  const second = await launch(profile);
  try {
    await second.window.keyboard.press("Control+t");
    const bar = second.window.getByRole("navigation", { name: "Barra de favoritos" });
    await bar.getByRole("button", { name: "Minha favorita" }).click();
    await expect(tabs(second.window).last()).toContainText("Página FAVORITA");
    await expect(second.window.getByLabel("Favoritar página")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  } finally {
    await second.app.close();
  }
});

test("1.6: atualização encontra a versão nova, confere, baixa e instala ao reiniciar", async () => {
  // Pacote "1.99.0" no formato do build-all.sh (tar.gz do Linux), servido como no VPS.
  const work = tempProfile();
  const install = path.join(work, "instalado");
  fs.mkdirSync(path.join(install, "resources", "app"), { recursive: true });
  fs.writeFileSync(path.join(install, "resources", "app", "package.json"), '{"version":"1.3.8"}');
  const pkg = path.join(work, "pacote");
  fs.mkdirSync(path.join(pkg, "resources", "app"), { recursive: true });
  fs.writeFileSync(path.join(pkg, "resources", "app", "package.json"), '{"version":"1.99.0"}');
  // O app reaberto é o executável com o mesmo nome do atual (aqui, o "electron" do teste).
  fs.writeFileSync(
    path.join(pkg, "electron"),
    `#!/bin/sh\necho reaberto > "${work}/reaberto.txt"\n`,
    { mode: 0o755 },
  );
  const archive = path.join(work, "pacote.tar.gz");
  execFileSync("tar", ["-czf", archive, "-C", pkg, "."]);
  const bytes = fs.readFileSync(archive);
  const feed = http.createServer((request, response) => {
    if (request.url === "/browser/latest.json") {
      response.end(
        JSON.stringify({
          version: "1.99.0",
          notes: "teste",
          files: {
            "linux-x64": {
              url: "v1.99.0/Agnos-Browser-linux-x64.tar.gz",
              sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
              size: bytes.length,
            },
          },
        }),
      );
      return;
    }
    if (request.url === "/browser/v1.99.0/Agnos-Browser-linux-x64.tar.gz") {
      response.end(bytes);
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise<void>((resolve) => feed.listen(0, "127.0.0.1", resolve));
  const feedUrl = `http://127.0.0.1:${(feed.address() as AddressInfo).port}/browser/latest.json`;
  const { app, window } = await launch(path.join(work, "perfil"), {
    AGZOS_UPDATE_URL: feedUrl,
    AGZOS_UPDATE_INSTALL_DIR: install,
  });
  let closed = false;
  app.on("close", () => (closed = true));
  try {
    await window.getByRole("button", { name: "Configurações" }).click();
    const settings = window.getByRole("complementary", { name: "Configurações" });
    await settings.getByRole("button", { name: "Verificar agora" }).click();
    await expect(settings.getByText(/Versão 1\.99\.0 pronta/)).toBeVisible({ timeout: 20_000 });
    await settings.getByRole("button", { name: "Fechar configurações" }).click();
    // Botão na barra: reinicia e instala.
    await window.getByRole("button", { name: "Atualizar" }).click();
    await expect.poll(() => closed, { timeout: 15_000 }).toBe(true);
    const result = path.join(work, "perfil", "atualizacoes", "resultado.txt");
    await expect.poll(() => fs.existsSync(result), { timeout: 15_000 }).toBe(true);
    expect(fs.readFileSync(result, "utf8").trim()).toBe("ok 1.99.0");
    expect(
      fs.readFileSync(path.join(install, "resources", "app", "package.json"), "utf8"),
    ).toContain("1.99.0");
    await expect.poll(() => fs.existsSync(path.join(work, "reaberto.txt"))).toBe(true);
  } finally {
    if (!closed) await app.close();
    feed.closeAllConnections();
    feed.close();
  }
});

// --- 1.7: várias janelas, restauração após crash, telas de erro e hibernação. ---

/** Cascas (uma por janela), sem as páginas das guias. */
function shells(app: ElectronApplication) {
  return app.windows().filter((page) => page.url().includes("/dist/index.html"));
}

async function waitShells(app: ElectronApplication, count: number) {
  await expect.poll(() => shells(app).length, { timeout: 15_000 }).toBe(count);
  const pages = shells(app);
  for (const page of pages) await page.locator('.browser-stage[data-ready="true"]').waitFor();
  return pages;
}

/** Id da guia (data-tab-id) cujo título contém `text`. */
async function tabIdOf(window: Page, text: string) {
  return Number(await tabs(window).filter({ hasText: text }).first().getAttribute("data-tab-id"));
}

test("1.7: Ctrl+N abre janela nova, tema sincroniza e as janelas voltam depois de reiniciar", async () => {
  const profile = tempProfile();
  const first = await launch(profile);
  await go(first.window, `${origin}/janela-um`);
  await expect(tabs(first.window).first()).toContainText("Página JANELA-UM");
  await first.window.keyboard.press(`${MOD}+n`);
  const [, second] = await waitShells(first.app, 2);
  await go(second!, `${origin}/janela-dois`);
  await expect(tabs(second!).first()).toContainText("Página JANELA-DOIS");
  // Cada janela tem as suas guias.
  await expect(tabs(first.window)).toHaveCount(1);
  await expect(tabs(first.window).first()).toContainText("Página JANELA-UM");
  // Preferência mudada numa janela vale na outra.
  await first.window.getByRole("button", { name: "Usar tema escuro" }).click();
  await expect(second!.locator(".browser-stage")).toHaveClass(/dark/);
  await first.window.waitForTimeout(900);
  await first.app.close();

  const again = await launch(profile);
  try {
    const pages = await waitShells(again.app, 2);
    const titles = await Promise.all(pages.map((page) => tabs(page).first().textContent()));
    expect(titles.join(" ")).toContain("Página JANELA-UM");
    expect(titles.join(" ")).toContain("Página JANELA-DOIS");
    for (const page of pages) await expect(page.locator(".browser-stage")).toHaveClass(/dark/);
    // Fechar uma janela entre várias descarta as guias dela (como no Chrome).
    await again.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((window) => window.getTitle().includes("JANELA-DOIS"))
        ?.close();
    });
    const [remaining] = await waitShells(again.app, 1);
    await expect(tabs(remaining!).first()).toContainText("Página JANELA-UM");
    await remaining!.waitForTimeout(700);
  } finally {
    await again.app.close();
  }
  const last = await launch(profile);
  try {
    await last.window.waitForTimeout(800);
    expect(shells(last.app)).toHaveLength(1);
    await expect(tabs(last.window).first()).toContainText("Página JANELA-UM");
  } finally {
    await last.app.close();
  }
});

test("1.7: mover guia para nova janela leva a página viva (sem recarregar)", async () => {
  const { app, window } = await launch(tempProfile());
  try {
    await go(window, `${origin}/fica`);
    await window.getByRole("button", { name: "Nova aba", exact: true }).click();
    await go(window, `${origin}/movida`);
    await expect(tabs(window).last()).toContainText("Página MOVIDA");
    await inTab(app, `${origin}/movida`, "window.marca = 42");
    const id = await tabIdOf(window, "Página MOVIDA");
    await app.evaluate(({ BrowserWindow }, tabId) => {
      BrowserWindow.getAllWindows()[0]!.webContents.send("agzos:tabmenu-action", {
        action: "tab.move-to-window",
        tabId,
      });
    }, id);
    const [, moved] = await waitShells(app, 2);
    await expect(tabs(moved!)).toHaveCount(1);
    await expect(tabs(moved!).first()).toContainText("Página MOVIDA");
    await expect(tabs(window)).toHaveCount(1);
    await expect(tabs(window).first()).toContainText("Página FICA");
    // Mesma página (o valor da variável sobreviveu) e uma só.
    expect(await inTab(app, `${origin}/movida`, "window.marca")).toBe(42);
    expect(await liveViews(app, "/movida")).toHaveLength(1);
    // Não entra em "reabrir guia fechada".
    await expect(window.getByRole("button", { name: "Reabrir guia fechada" })).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test("1.7: tela de erro quando a página não carrega, e 'Tentar novamente' recupera", async () => {
  const { app, window } = await launch(tempProfile());
  try {
    unstableDown = true;
    await go(window, `${origin}/instavel`);
    const error = window.getByRole("alert", { name: "Erro ao carregar a página" });
    await expect(error).toBeVisible();
    await expect(error).toContainText("Este site não pode ser acessado");
    await expect(error).toContainText("ERR_EMPTY_RESPONSE");
    await expect(omnibox(window)).toHaveValue(`${origin}/instavel`);
    unstableDown = false;
    await error.getByRole("button", { name: "Tentar novamente" }).click();
    await expect(tabs(window).first()).toContainText("Página INSTAVEL");
    await expect(error).toHaveCount(0);
    // Endereço inexistente: tela própria, com a opção de pesquisar.
    await go(window, "http://nao-existe.invalid/");
    await expect(error).toBeVisible();
    await expect(error.getByRole("heading")).toHaveText(
      /Não foi possível encontrar este site|Este site não pode ser acessado|Sem conexão/,
    );
  } finally {
    await app.close();
  }
});

test("1.7: certificado inválido mostra o aviso e 'Continuar' abre a página", async () => {
  const dir = tempProfile();
  const key = path.join(dir, "k.pem");
  const cert = path.join(dir, "c.pem");
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        key,
        "-out",
        cert,
        "-days",
        "2",
        "-subj",
        "/CN=localhost",
      ],
      { stdio: "ignore" },
    );
  } catch {
    test.skip(true, "openssl indisponível");
  }
  const https = await import("node:https");
  const secure = https.createServer(
    { key: fs.readFileSync(key), cert: fs.readFileSync(cert) },
    (_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><title>Página SEGURA</title>ok");
    },
  );
  await new Promise<void>((resolve) => secure.listen(0, "127.0.0.1", resolve));
  const url = `https://127.0.0.1:${(secure.address() as AddressInfo).port}/`;
  const { app, window } = await launch(tempProfile());
  try {
    await go(window, url);
    const error = window.getByRole("alert", { name: "Erro ao carregar a página" });
    await expect(error).toContainText("Sua conexão não é particular");
    await expect(error).toContainText("ERR_CERT_AUTHORITY_INVALID");
    await error.getByRole("button", { name: "Avançado" }).click();
    await error.getByRole("button", { name: /Continuar para .* \(não seguro\)/ }).click();
    await expect(tabs(window).first()).toContainText("Página SEGURA");
    await expect(error).toHaveCount(0);
  } finally {
    await app.close();
    secure.close();
  }
});

test("1.7: página encerrada mostra a tela de travada e 'Recarregar' traz de volta", async () => {
  const { app, window } = await launch(tempProfile());
  try {
    await go(window, `${origin}/derrubada`);
    await expect(tabs(window).first()).toContainText("Página DERRUBADA");
    const id = await tabIdOf(window, "Página DERRUBADA");
    await window.evaluate(
      (tabId) =>
        (
          window as unknown as { agzosDesktop: { killTab(id: number): Promise<void> } }
        ).agzosDesktop.killTab(tabId),
      id,
    );
    const crashed = window.getByRole("alert", { name: "Guia travada" });
    await expect(crashed).toBeVisible();
    await crashed.getByRole("button", { name: "Recarregar" }).click();
    await expect(crashed).toHaveCount(0);
    await expect
      .poll(() => inTab(app, `${origin}/derrubada`, "document.title"))
      .toBe("Página DERRUBADA");
  } finally {
    await app.close();
  }
});

test("1.7: guia sem uso hiberna, volta com o histórico e formulário preenchido não hiberna", async () => {
  const { app, window } = await launch(tempProfile(), {
    AGZOS_HIBERNATE_AFTER_MS: "1200",
    AGZOS_HIBERNATE_CHECK_MS: "400",
    // Sem scriptlets no 127.0.0.1: site com scriptlets volta sem o histórico (ver
    // restoreHibernated em electron/main.cjs).
    AGZOS_FILTER_LISTS: JSON.stringify({ ads: [], privacy: [`${origin}/filtros/privacidade.txt`] }),
  });
  try {
    await go(window, `${origin}/hib-um`);
    await expect(tabs(window).first()).toContainText("Página HIB-UM");
    await go(window, `${origin}/hib-dois`);
    await expect(tabs(window).first()).toContainText("Página HIB-DOIS");
    await window.getByRole("button", { name: "Nova aba", exact: true }).click();
    await go(window, `${origin}/formulario`);
    await expect(tabs(window).nth(1)).toContainText("Formulário");
    await inTab(app, `${origin}/formulario`, "document.getElementById('nome').value = 'Ana'");
    await window.getByRole("button", { name: "Nova aba", exact: true }).click();

    await expect(tabs(window).first()).toHaveClass(/hibernated/, { timeout: 10_000 });
    await expect.poll(() => liveViews(app, "/hib-dois")).toHaveLength(0);
    // Formulário com texto digitado continua vivo.
    await window.waitForTimeout(1500);
    expect(await liveViews(app, "/formulario")).toHaveLength(1);
    await expect(tabs(window).nth(1)).not.toHaveClass(/hibernated/);

    // Voltar à guia recria a página, com o histórico de navegação.
    await tabs(window).first().click();
    await expect(tabs(window).first()).not.toHaveClass(/hibernated/);
    await expect.poll(() => liveViews(app, "/hib-dois")).toHaveLength(1);
    await expect(omnibox(window)).toHaveValue(`${origin}/hib-dois`);
    await window.getByRole("button", { name: "Voltar" }).click();
    await expect(omnibox(window)).toHaveValue(`${origin}/hib-um`);
  } finally {
    await app.close();
  }
});

test("1.7: depois de um crash as janelas voltam com aviso; crash logo ao abrir usa o modo seguro", async () => {
  const profile = tempProfile();
  // Execução "estável" (passou do tempo de início) que cai: restaura normalmente.
  const first = await launch(profile, { AGZOS_STABLE_AFTER_MS: "200" });
  await go(first.window, `${origin}/antes-do-crash`);
  await expect(tabs(first.window).first()).toContainText("Página ANTES-DO-CRASH");
  await first.window.waitForTimeout(1200);
  first.app.process().kill("SIGKILL");

  const second = await launch(profile);
  await expect(second.window.getByRole("status", { name: "Sessão restaurada" })).toContainText(
    "não foi fechado corretamente",
  );
  await expect(tabs(second.window).first()).toContainText("Página ANTES-DO-CRASH");
  await expect.poll(() => liveViews(second.app, "/antes-do-crash")).toHaveLength(1);
  // Cai de novo logo ao abrir: a próxima abre sem carregar as páginas.
  await second.window.waitForTimeout(900);
  second.app.process().kill("SIGKILL");

  const third = await launch(profile);
  try {
    await expect(third.window.getByRole("status", { name: "Sessão restaurada" })).toContainText(
      "fechou logo depois de abrir",
    );
    await expect(tabs(third.window)).toHaveCount(2);
    await expect(tabs(third.window).first()).toContainText("Página ANTES-DO-CRASH");
    await expect(tabs(third.window).first()).toHaveClass(/hibernated/);
    await expect(tabs(third.window).nth(1)).toHaveAttribute("aria-selected", "true");
    await third.window.waitForTimeout(800);
    expect(await liveViews(third.app, "/antes-do-crash")).toHaveLength(0);
  } finally {
    await third.app.close();
  }

  // Saída normal: sem aviso na próxima.
  const fourth = await launch(profile);
  try {
    await fourth.window.waitForTimeout(600);
    await expect(fourth.window.getByRole("status", { name: "Sessão restaurada" })).toHaveCount(0);
  } finally {
    await fourth.app.close();
  }
});

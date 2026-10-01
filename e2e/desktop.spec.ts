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
  // Player dentro de iframe (como um vídeo embutido do YouTube), com PiP desligado pelo site.
  "/player": `<!doctype html><title>Player</title><canvas id="c" width="320" height="180"></canvas>
    <video id="v" muted playsinline disablepictureinpicture width="320" height="180"></video>
    <script>const c = document.getElementById("c"), x = c.getContext("2d"); let t = 0;
    setInterval(() => { x.fillStyle = "hsl(" + (t++ % 360) + ",80%,50%)"; x.fillRect(0, 0, 320, 180); }, 50);
    const v = document.getElementById("v"); v.srcObject = c.captureStream(20); v.play();</script>`,
  // <video autoplay loop> tocando (fonte local, sem depender da internet) + contador de
  // quadros pintados (requestAnimationFrame para quando a guia sai de cena).
  "/video-vivo": `<!doctype html><title>Vídeo vivo</title>
    <canvas id="c" width="320" height="180" hidden></canvas>
    <video id="v" autoplay loop muted playsinline width="320" height="180"></video>
    <button id="b" style="position: fixed; left: 40px; bottom: 40px; width: 200px; height: 60px"
      onclick="window.cliques = (window.cliques || 0) + 1">clique</button>
    <div style="height: 4000px">rolar</div>
    <script>const c = document.getElementById("c"), x = c.getContext("2d"); let t = 0;
    setInterval(() => { x.fillStyle = "hsl(" + (t++ % 360) + ",80%,50%)"; x.fillRect(0, 0, 320, 180); }, 40);
    const v = document.getElementById("v"); v.srcObject = c.captureStream(25); v.play();
    window.painted = 0; const tick = () => { window.painted++; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);</script>`,
  "/com-video": `<!doctype html><title>Com vídeo</title><h1>Vídeo</h1>
    <iframe src="/player" width="400" height="240"></iframe>`,
};

// /instavel derruba a conexão (ERR_EMPTY_RESPONSE) enquanto o "servidor" estiver fora.
let unstableDown = true;

// Agzos Key de mentira (AGZOS_KEY_URL): cofre Argon2id como o servidor real manda, sem
// t/m/p no authMeta. A chave é o vetor do argon2-browser do Agzos Key (64 MiB, t=3, p=4).
const KEY_PASSWORD = "senha-do-arnaldo";
const KEY_RAW = Buffer.from(
  "f43057afd6ec0bc0819d006d48f669eeb28b2625f6880a71159f8ad74982f465",
  "hex",
);
function keyEncrypt(text: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY_RAW, iv);
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return { iv: iv.toString("base64"), data: data.toString("base64") };
}
const KEY_AUTH = keyEncrypt("agzos-key-auth-check-string-v1");
const KEY_META = {
  salt: Buffer.from("000102030405060708090a0b0c0d0e0f", "hex").toString("base64"),
  authCheckIv: KEY_AUTH.iv,
  authCheckData: KEY_AUTH.data,
  kdf: "argon2id",
};
function keyApi(url: string): unknown {
  if (url === "/api/integration/pair/claim") {
    return {
      deviceToken: "t",
      accountEmail: "arnaldo@agzos.com",
      hasVault: true,
      authMeta: KEY_META,
    };
  }
  if (url === "/api/integration/vault/status") {
    return { hasVault: true, accountEmail: "arnaldo@agzos.com", authMeta: KEY_META };
  }
  if (url === "/api/integration/vault/sync") {
    const entry = {
      id: "c1",
      title: "Login local",
      url: origin,
      username: "arnaldo@agzos.com",
      password: "segredo",
      updatedAt: 1,
    };
    return {
      entries: [{ id: "c1", ...keyEncrypt(JSON.stringify(entry)), version: 1 }],
      syncedAt: 1,
    };
  }
  return null;
}

test.beforeAll(async () => {
  server = http.createServer((request, response) => {
    const url = request.url ?? "/";
    if (url.startsWith("/api/integration/")) {
      request.resume();
      request.on("end", () => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(keyApi(url) ?? {}));
      });
      return;
    }
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
async function waitForFilters(app: ElectronApplication, window: Page) {
  await window.getByRole("button", { name: /bloqueados/ }).click();
  // O painel abre na camada acima da página (dist/overlay.html).
  const layer = await overlayPage(app);
  await expect(layer.getByText(/atualizadas em/)).toBeVisible({ timeout: 20_000 });
  await layer.getByRole("button", { name: "Fechar proteção" }).click();
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

/** Camada nativa pelo título da página (agzos-preview, agzos-switcher). */
async function layerState(app: ElectronApplication, title: string) {
  return app.evaluate(async ({ BrowserWindow }, wanted) => {
    for (const window of BrowserWindow.getAllWindows()) {
      const children = window.contentView.children;
      for (const child of children) {
        const contents = (child as { webContents?: Electron.WebContents }).webContents;
        if (!contents || contents.isDestroyed() || contents.getTitle() !== wanted) continue;
        const bounds = (child as Electron.WebContentsView).getBounds();
        const info = (await contents.executeJavaScript(`({
            text: document.body.innerText,
            cards: [...document.querySelectorAll("a.card")].map((card) => ({
              title: card.innerText.trim(),
              image: Boolean(card.querySelector(".shot img")),
              selected: card.classList.contains("selected"),
            })),
          })`)) as { text: string; cards: { title: string; image: boolean; selected: boolean }[] };
        return {
          visible: bounds.width > 0 && bounds.height > 0,
          onTop: children.at(-1) === child,
          ...info,
        };
      }
    }
    return { visible: false, onTop: false, text: "", cards: [] };
  }, title);
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
    await waitForFilters(app, window);
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
    const layer = await overlayPage(app);
    const panel = layer.getByRole("complementary", { name: "Rastreadores bloqueados" });
    await expect(panel).toContainText("2 bloqueados nesta página");
    await expect(panel).toContainText("Anúncios");
    await expect(panel).toContainText("Rastreadores");
    await panel.getByText("Pausar neste site").click();
    await layer.getByRole("button", { name: "Fechar proteção" }).click();
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
    const panel = (await overlayPage(first.app)).getByRole("complementary", { name: "Downloads" });
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
    const panel = (await overlayPage(second.app)).getByRole("complementary", { name: "Downloads" });
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
    const panel = (await overlayPage(second.app)).getByRole("complementary", { name: "Downloads" });
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
    // Ctrl pressionado + Tab, sem soltar: o seletor aparece por cima da página (camada).
    await app.evaluate(({ webContents }, target) => {
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === target)!;
      contents.focus();
      contents.sendInputEvent({ type: "keyDown", keyCode: "Control", modifiers: ["control"] });
      contents.sendInputEvent({ type: "keyDown", keyCode: "Tab", modifiers: ["control"] });
    }, `${origin}/dois`);
    await expect.poll(async () => (await layerState(app, "agzos-switcher")).visible).toBe(true);
    const layer = await layerState(app, "agzos-switcher");
    expect(layer.onTop).toBe(true);
    expect(layer.cards.map((card) => card.title)).toEqual(["Página DOIS", "Página UM"]);
    expect(layer.cards.map((card) => card.selected)).toEqual([false, true]);
    // As duas abas já estiveram visíveis: as duas têm miniatura de verdade.
    expect(layer.cards.every((card) => card.image)).toBe(true);
    await keyInTab(app, `${origin}/dois`, "Control");
    await expect.poll(async () => (await layerState(app, "agzos-switcher")).visible).toBe(false);
    await expect(window.locator(".browser-tab.active")).toContainText("Página UM");
  } finally {
    await app.close();
  }
});

test("scriptlets (+js) rodam antes dos scripts da página, mesmo com CSP de nonce", async () => {
  const { app, window } = await launch(tempProfile());
  const url = `${origin}/scriptlet`;
  try {
    await waitForFilters(app, window);
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

test("sugestões da omnibox por cima da página mostram a foto dela no lugar (não fica preto)", async () => {
  // Os painéis da toolbar abrem na camada acima da página (1.5.4); a lista da omnibox
  // continua na casca: a guia sai da frente e uma foto entra no lugar.
  const { app, window } = await launch(tempProfile(), { AGZOS_DEBUG_OVERLAY: "1" });
  const url = `${origin}/foto`;
  try {
    await go(window, url);
    await expect(tabs(window).first()).toContainText("Página FOTO");
    await window.waitForTimeout(400);
    await omnibox(window).fill("agzos foto");
    await expect(window.getByRole("listbox")).toBeVisible();
    const photo = window.locator(".view-snapshot");
    await expect(photo).toBeVisible();
    expect(await photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(100);
    // O WebContentsView saiu da frente (senão cobriria a lista).
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
    expect(
      await app.evaluate(
        () => (globalThis as { __agzosOverlay?: Record<string, number> }).__agzosOverlay,
      ),
    ).toEqual({ "live-overlay": 0, "snapshot-fallback": 1 });
    await omnibox(window).press("Escape");
    await omnibox(window).blur();
    await expect(photo).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test("páginas de login ficam intocadas: sem scriptlet, sem CSS de ocultação", async () => {
  const { app, window } = await launch(tempProfile());
  const url = `${origin}/login`;
  try {
    await waitForFilters(app, window);
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
    await waitForFilters(app, window);
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
    await waitForFilters(app, window);
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
    const panel = (await overlayPage(second.app)).getByRole("complementary", {
      name: "Informações do site",
    });
    await panel.getByLabel(/^Notificações em/).selectOption("block");
    await panel.getByRole("button", { name: "Fechar informações do site" }).click();
    await window.getByRole("button", { name: "Recarregar" }).click();
    await expect.poll(() => inTab(second.app, url, "Notification.permission")).toBe("denied");
    expect(await withGesture(second.app, url, "Notification.requestPermission()")).toBe("denied");

    // Configurações lista o site e volta para "Perguntar".
    await window.keyboard.press("Control+,");
    await window
      .getByRole("navigation", { name: "Seções das configurações" })
      .getByRole("button", { name: "Privacidade e segurança" })
      .click();
    const settings = window.locator(".settings-main");
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
  const editor = (await overlayPage(first.app)).getByRole("complementary", {
    name: "Favorito adicionado",
  });
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
  // Pacote "99.0.0" (sempre acima do app) no formato do build-all.sh (tar.gz do Linux).
  const work = tempProfile();
  const install = path.join(work, "instalado");
  fs.mkdirSync(path.join(install, "resources", "app"), { recursive: true });
  fs.writeFileSync(path.join(install, "resources", "app", "package.json"), '{"version":"1.3.8"}');
  const pkg = path.join(work, "pacote");
  fs.mkdirSync(path.join(pkg, "resources", "app"), { recursive: true });
  fs.writeFileSync(path.join(pkg, "resources", "app", "package.json"), '{"version":"99.0.0"}');
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
          version: "99.0.0",
          notes: "teste",
          files: {
            "linux-x64": {
              url: "v99.0.0/Agnos-Browser-linux-x64.tar.gz",
              sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
              size: bytes.length,
            },
          },
        }),
      );
      return;
    }
    if (request.url === "/browser/v99.0.0/Agnos-Browser-linux-x64.tar.gz") {
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
    await window.keyboard.press("Control+,");
    await window
      .getByRole("navigation", { name: "Seções das configurações" })
      .getByRole("button", { name: "Sobre o Agzos" })
      .click();
    const settings = window.locator(".settings-main");
    await settings.getByRole("button", { name: "Verificar agora" }).click();
    await expect(settings.getByText(/Versão 99\.0\.0 pronta/)).toBeVisible({ timeout: 20_000 });
    // Botão na barra: reinicia e instala.
    await window.getByRole("button", { name: "Atualizar", exact: true }).click();
    await expect.poll(() => closed, { timeout: 15_000 }).toBe(true);
    const result = path.join(work, "perfil", "atualizacoes", "resultado.txt");
    await expect.poll(() => fs.existsSync(result), { timeout: 15_000 }).toBe(true);
    expect(fs.readFileSync(result, "utf8").trim()).toBe("ok 99.0.0");
    expect(
      fs.readFileSync(path.join(install, "resources", "app", "package.json"), "utf8"),
    ).toContain("99.0.0");
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
    // A guia ativa de cada janela recarrega ao abrir: o título volta quando a página carrega.
    const titles = async () =>
      (await Promise.all(pages.map((page) => tabs(page).first().textContent()))).join(" ");
    await expect.poll(titles).toContain("Página JANELA-UM");
    await expect.poll(titles).toContain("Página JANELA-DOIS");
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

test("1.5.1: depois de atualizar, aviso com a versão, as novidades e confetes (uma vez só)", async () => {
  const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  const profile = tempProfile();
  const first = await launch(profile);
  await first.window.waitForTimeout(600);
  // Nenhum aviso num perfil novo.
  await expect(first.window.getByRole("dialog")).toHaveCount(0);
  // Simula o perfil de quem estava na 1.4.2.
  await first.app.evaluate(
    (_electron, file) => {
      const { DatabaseSync } = process.getBuiltinModule(
        "node:sqlite",
      ) as typeof import("node:sqlite");
      const db = new DatabaseSync(file);
      db.prepare("UPDATE kv SET value = ? WHERE key = 'meta:appVersion'").run('"1.4.2"');
      db.close();
    },
    path.join(profile, "agzos.db"),
  );
  await first.app.close();

  const second = await launch(profile);
  try {
    const dialog = second.window.getByRole("dialog", { name: "Atualizado com sucesso!" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(`Versão 1.4.2 → ${version}`);
    await expect(dialog.locator("li").first()).toBeVisible();
    await expect(second.window.locator("canvas.confetti")).toHaveCount(1);
    await dialog.getByRole("button", { name: "Continuar navegando" }).click();
    await expect(dialog).toHaveCount(0);
    // Pelas Configurações, as novidades da versão atual (sem confetes).
    await second.window.getByRole("button", { name: "Menu do Agzos" }).click();
    await (
      await overlayPage(second.app)
    )
      .getByRole("menuitem", { name: "Novidades desta versão" })
      .click();
    const again = second.window.getByRole("dialog", { name: "Novidades desta versão" });
    await expect(again).toContainText(`Agzos Browser ${version}`);
    await expect(second.window.locator("canvas.confetti")).toHaveCount(0);
    await second.window.keyboard.press("Escape");
    await expect(again).toHaveCount(0);
  } finally {
    await second.app.close();
  }

  const third = await launch(profile);
  try {
    await third.window.waitForTimeout(800);
    await expect(third.window.getByRole("dialog")).toHaveCount(0);
  } finally {
    await third.app.close();
  }
});

test("1.5.1: picture-in-picture pega o vídeo de qualquer player (até em iframe)", async () => {
  const { app, window } = await launch(tempProfile());
  try {
    await go(window, `${origin}/com-video`);
    await expect(tabs(window).first()).toContainText("Com vídeo");
    const pipOn = () =>
      app.evaluate(async ({ webContents }, url) => {
        const contents = webContents.getAllWebContents().find((item) => item.getURL() === url);
        for (const frame of contents?.mainFrame.framesInSubtree ?? []) {
          if (await frame.executeJavaScript("Boolean(document.pictureInPictureElement)")) {
            return true;
          }
        }
        return false;
      }, `${origin}/com-video`);
    // Vídeo tocando: o botão aparece na barra.
    const button = window.getByRole("button", { name: "Picture-in-picture" });
    await expect(button).toBeVisible({ timeout: 10_000 });
    await button.click();
    await expect.poll(pipOn).toBe(true);
    await expect(window.getByRole("button", { name: "Sair do picture-in-picture" })).toBeVisible();
    // Atalho com o foco na página desliga.
    await keyInTab(app, `${origin}/com-video`, "P", ["control", "shift"]);
    await expect.poll(pipOn).toBe(false);
    await expect(window.getByRole("button", { name: "Picture-in-picture" })).toBeVisible();
  } finally {
    await app.close();
  }
});

// --- 1.5.2: prévia da guia, Ctrl+Tab ao soltar, configurações. ---

/** Cartão de prévia (camada própria acima da página): texto e se está à vista. */
async function previewCard(app: ElectronApplication) {
  return app.evaluate(async ({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      for (const child of window.contentView.children) {
        const contents = (child as { webContents?: Electron.WebContents }).webContents;
        if (!contents || contents.getTitle() !== "agzos-preview") continue;
        const bounds = (child as Electron.WebContentsView).getBounds();
        const text = (await contents.executeJavaScript("document.body.innerText")) as string;
        const onTop = window.contentView.children.at(-1) === child;
        return { visible: bounds.width > 0 && bounds.height > 0, text, onTop };
      }
    }
    return { visible: false, text: "", onTop: false };
  });
}

test("1.5.2: pausar o mouse na guia mostra a prévia por cima da página, com RAM e CPU", async () => {
  const { app, window } = await launch(tempProfile());
  try {
    await go(window, `${origin}/previa-a`);
    await expect(tabs(window).first()).toContainText("Página PREVIA-A");
    await window.waitForTimeout(700);
    await window.getByRole("button", { name: "Nova aba", exact: true }).click();
    await go(window, `${origin}/previa-b`);
    await expect(tabs(window).last()).toContainText("Página PREVIA-B");

    await tabs(window).first().hover();
    await expect.poll(async () => (await previewCard(app)).visible).toBe(true);
    const card = await previewCard(app);
    expect(card.onTop).toBe(true);
    expect(card.text).toContain("Página PREVIA-A");
    expect(card.text).toContain("127.0.0.1");
    expect(card.text).toMatch(/Memória \(RAM\)\s*\d+ MB/);
    expect(card.text).toContain("CPU");
    // Outra guia com o cartão aberto: troca na hora.
    await tabs(window).last().hover();
    await expect.poll(async () => (await previewCard(app)).text).toContain("Guia atual");
    // Mouse fora das guias: some.
    await window.mouse.move(700, 500);
    await expect.poll(async () => (await previewCard(app)).visible).toBe(false);
  } finally {
    await app.close();
  }
});

test("1.5.3: Ctrl+Tab com o foco na página: a página fica à vista e com o foco, e soltar o Ctrl confirma sempre", async () => {
  const { app, window } = await launch(tempProfile());
  try {
    await go(window, `${origin}/troca-a`);
    await expect(tabs(window).first()).toContainText("Página TROCA-A");
    await window.getByRole("button", { name: "Nova aba", exact: true }).click();
    await go(window, `${origin}/troca-b`);
    await expect(tabs(window).last()).toContainText("Página TROCA-B");
    await window.getByRole("button", { name: "Nova aba", exact: true }).click();
    await go(window, `${origin}/troca-c`);
    await expect(tabs(window).last()).toContainText("Página TROCA-C");
    const active = window.locator(".tabs .browser-tab.active");
    const switcher = () => layerState(app, "agzos-switcher");
    /** Tecla na página (o foco do sistema fica nela o tempo todo). */
    const key = (type: "keyDown" | "keyUp", keyCode: string, modifiers: string[] = []) =>
      app.evaluate(
        ({ webContents }, [kind, code, mods]) => {
          const contents = webContents.getFocusedWebContents()!;
          contents.sendInputEvent({
            type: kind as "keyDown" | "keyUp",
            keyCode: code as string,
            modifiers: mods as ("control" | "shift")[],
          });
        },
        [type, keyCode, modifiers] as const,
      );
    const focused = () =>
      app.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL() ?? "");
    const pageShown = (url: string) =>
      app.evaluate(({ BrowserWindow }, target) => {
        const child = BrowserWindow.getAllWindows()[0]!.contentView.children.find(
          (item) =>
            (item as { webContents?: Electron.WebContents }).webContents?.getURL() === target,
        ) as Electron.WebContentsView | undefined;
        return (child?.getBounds().width ?? 0) > 0;
      }, url);
    const focusPage = (url: string) =>
      app.evaluate(({ webContents }, target) => {
        webContents
          .getAllWebContents()
          .find((item) => item.getURL() === target)!
          .focus();
      }, url);

    // Várias vezes seguidas: segura o Ctrl, Tab, Tab, solta.
    for (let round = 0; round < 3; round++) {
      const from = (await active.textContent())!.match(/TROCA-[A-C]/)![0].toLowerCase();
      await focusPage(`${origin}/${from}`);
      await key("keyDown", "Control", ["control"]);
      await key("keyDown", "Tab", ["control"]);
      await key("keyUp", "Tab", ["control"]);
      await expect.poll(async () => (await switcher()).visible).toBe(true);
      await key("keyDown", "Tab", ["control"]);
      await key("keyUp", "Tab", ["control"]);
      await expect
        .poll(async () => (await switcher()).cards.findIndex((card) => card.selected))
        .toBe(2);
      // A página continua à vista e com o foco (o "soltar" chega nela).
      expect(await focused()).toContain(`/${from}`);
      expect(await pageShown(`${origin}/${from}`)).toBe(true);
      const target = (await switcher()).cards[2]!.title;
      await key("keyUp", "Control");
      await expect(active).toContainText(target);
      await expect.poll(async () => (await switcher()).visible).toBe(false);
    }

    // Enter confirma e não chega à página; clicar num cartão também confirma.
    const current = (await active.textContent())!.match(/TROCA-[A-C]/)![0].toLowerCase();
    await focusPage(`${origin}/${current}`);
    await inTab(
      app,
      `${origin}/${current}`,
      "window.enters = 0; addEventListener('keydown', (e) => { if (e.key === 'Enter') window.enters++; })",
    );
    await key("keyDown", "Control", ["control"]);
    await key("keyDown", "Tab", ["control"]);
    await expect.poll(async () => (await switcher()).visible).toBe(true);
    const chosen = (await switcher()).cards[1]!.title;
    await key("keyDown", "Enter", ["control"]);
    await expect(active).toContainText(chosen);
    expect(await inTab(app, `${origin}/${current}`, "window.enters")).toBe(0);
  } finally {
    await app.close();
  }
});

test("1.5.2: configurações completas em agzos://configuracoes (Ctrl+,) e menu do ⋯", async () => {
  const { app, window } = await launch(tempProfile());
  try {
    await window.getByRole("button", { name: "Menu do Agzos" }).click();
    const menu = (await overlayPage(app)).getByRole("menu", { name: "Menu do Agzos" });
    await expect(menu.getByRole("menuitem", { name: /Nova janela/ })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Sair" })).toBeVisible();
    await menu.getByRole("menuitem", { name: /Configurações/ }).click();
    await expect(omnibox(window)).toHaveValue("agzos://configuracoes");
    const nav = window.getByRole("navigation", { name: "Seções das configurações" });
    // Seções que só existem no app.
    await nav.getByRole("button", { name: "Desempenho" }).click();
    await expect(window.getByRole("switch", { name: "Hibernar guias sem uso" })).toBeVisible();
    await nav.getByRole("button", { name: "Downloads" }).click();
    // AGZOS_DOWNLOADS_DIR do teste: <perfil>/Downloads.
    await expect(window.locator(".settings-main")).toContainText(/agzos-e2e-.*Downloads/);
  } finally {
    await app.close();
  }
});

/** A camada dos painéis (dist/overlay.html), como página do Playwright. */
async function overlayPage(app: ElectronApplication) {
  let found: Page | undefined;
  await expect
    .poll(() => {
      found = app.windows().find((page) => page.url().endsWith("/overlay.html"));
      return Boolean(found);
    })
    .toBe(true);
  return found!;
}

/** A guia com `url` está à vista (bounds > 0) e a camada dos painéis por cima? */
async function layersOf(app: ElectronApplication, url: string) {
  return app.evaluate(({ BrowserWindow }, target) => {
    const children = BrowserWindow.getAllWindows()[0]!.contentView.children as (
      Electron.WebContentsView | Electron.View
    )[];
    const contentsOf = (child: Electron.View) =>
      (child as { webContents?: Electron.WebContents }).webContents;
    const page = children.find((child) => contentsOf(child)?.getURL() === target);
    const layer = children.find((child) => contentsOf(child)?.getURL().endsWith("/overlay.html"));
    return {
      pageWidth: page?.getBounds().width ?? 0,
      overlayVisible: Boolean(layer && layer.getVisible() && layer.getBounds().width > 0),
      overlayOnTop: Boolean(layer) && children.at(-1) === layer,
      counts: (globalThis as { __agzosOverlay?: Record<string, number> }).__agzosOverlay ?? null,
    };
  }, url);
}

test("1.5.4: menus da toolbar abrem na camada e a página (vídeo) segue pintando", async () => {
  const { app, window } = await launch(tempProfile(), { AGZOS_DEBUG_OVERLAY: "1" });
  const url = `${origin}/video-vivo`;
  try {
    await go(window, url);
    await expect(tabs(window).first()).toContainText("Vídeo vivo");
    await expect
      .poll(() => inTab<number>(app, url, "document.getElementById('v').currentTime"))
      .toBeGreaterThan(0.2);

    await window.getByRole("button", { name: "Menu do Agzos" }).click();
    const overlay = await overlayPage(app);
    const menu = overlay.getByRole("menu", { name: "Menu do Agzos" });
    await expect(menu.getByRole("menuitem", { name: /Nova janela/ })).toBeVisible();
    await expect.poll(async () => (await layersOf(app, url)).overlayVisible).toBe(true);
    const layers = await layersOf(app, url);
    // A guia não saiu de cena e nenhuma foto foi tirada.
    expect(layers.pageWidth).toBeGreaterThan(0);
    expect(layers.overlayOnTop).toBe(true);
    expect(layers.counts).toEqual({ "live-overlay": 1, "snapshot-fallback": 0 });
    await expect(window.locator(".view-snapshot")).toHaveCount(0);
    // Com o menu aberto o vídeo anda e a página pinta quadros novos.
    const t0 = await inTab<number>(app, url, "document.getElementById('v').currentTime");
    const f0 = await inTab<number>(app, url, "window.painted");
    await expect
      .poll(() => inTab<number>(app, url, "document.getElementById('v').currentTime"), {
        intervals: [50],
        timeout: 3000,
      })
      .toBeGreaterThanOrEqual(t0 + 0.8);
    expect(await inTab<number>(app, url, "window.painted")).toBeGreaterThan(f0 + 10);
    await expect(window.getByRole("button", { name: "Menu do Agzos" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    // Rolar fora do menu rola a página por baixo.
    await overlay.mouse.move(400, 600);
    await overlay.mouse.wheel(0, 600);
    await expect.poll(() => inTab<number>(app, url, "window.scrollY")).toBeGreaterThan(100);
    await expect(menu).toBeVisible();

    // Esc fecha; o foco não fica na camada escondida.
    await overlay.keyboard.press("Escape");
    await expect.poll(async () => (await layersOf(app, url)).overlayVisible).toBe(false);
    await expect(window.getByRole("button", { name: "Menu do Agzos" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(
      await app.evaluate(
        ({ webContents }) =>
          webContents.getFocusedWebContents()?.getURL().endsWith("/overlay.html") ?? false,
      ),
    ).toBe(false);

    // Downloads e proteção (adblock) também: camada, sem foto.
    await window.getByRole("button", { name: /bloqueados/ }).click();
    await expect(overlay.getByRole("button", { name: "Fechar proteção" })).toBeVisible();
    // Clique fora (como no Comet): fecha o painel e o clique vale para a página embaixo.
    const view = await app.evaluate(({ BrowserWindow }, target) => {
      const child = BrowserWindow.getAllWindows()[0]!.contentView.children.find(
        (item) => (item as { webContents?: Electron.WebContents }).webContents?.getURL() === target,
      )!;
      return child.getBounds();
    }, url);
    await overlay.mouse.click(view.x + 140, view.y + view.height - 70);
    await expect.poll(async () => (await layersOf(app, url)).overlayVisible).toBe(false);
    await expect.poll(() => inTab<number>(app, url, "window.cliques ?? 0")).toBe(1);
    expect(
      await app.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL()),
    ).toBe(url);

    // Clique fora num botão da barra: o outro painel abre direto.
    const menuButton = window.getByRole("button", { name: "Menu do Agzos" });
    await window.getByRole("button", { name: /bloqueados/ }).click();
    await expect(overlay.getByRole("button", { name: "Fechar proteção" })).toBeVisible();
    const menuBox = (await menuButton.boundingBox())!;
    await overlay.mouse.click(menuBox.x + menuBox.width / 2, menuBox.y + menuBox.height / 2);
    await expect(overlay.getByRole("menu", { name: "Menu do Agzos" })).toBeVisible();
    await expect(overlay.getByRole("button", { name: "Fechar proteção" })).toHaveCount(0);
    await expect(menuButton).toHaveAttribute("aria-expanded", "true");
    // O próprio ⋯ com o menu aberto: só fecha (o clique repassado não reabre).
    await overlay.mouse.click(menuBox.x + menuBox.width / 2, menuBox.y + menuBox.height / 2);
    await expect.poll(async () => (await layersOf(app, url)).overlayVisible).toBe(false);
    await window.waitForTimeout(300);
    await expect(menuButton).toHaveAttribute("aria-expanded", "false");

    // Menu aberto + Ctrl+T: guia nova e o menu fecha.
    await window.getByRole("button", { name: "Menu do Agzos" }).click();
    await expect(menu).toBeVisible();
    // Tecla de verdade na camada (passa pelo before-input-event, como um teclado físico).
    await app.evaluate(({ webContents }, mod) => {
      const layer = webContents
        .getAllWebContents()
        .find((contents) => contents.getURL().endsWith("/overlay.html"))!;
      const modifiers = [mod === "Meta" ? "meta" : "control"] as ("meta" | "control")[];
      layer.sendInputEvent({ type: "keyDown", keyCode: "T", modifiers });
      layer.sendInputEvent({ type: "keyUp", keyCode: "T", modifiers });
    }, MOD);
    await expect(tabs(window)).toHaveCount(2);
    await expect.poll(async () => (await layersOf(app, url)).overlayVisible).toBe(false);

    // Item do menu dispara o mesmo comando de hoje.
    await window.getByRole("button", { name: "Menu do Agzos" }).click();
    await menu.getByRole("menuitem", { name: /Nova guia anônima/ }).click();
    await expect(tabs(window)).toHaveCount(3);
    await expect.poll(async () => (await layersOf(app, url)).overlayVisible).toBe(false);

    // Clique fora numa guia: fecha o menu e troca de guia.
    await window.getByRole("button", { name: "Menu do Agzos" }).click();
    await expect(menu).toBeVisible();
    const tabBox = (await tabs(window).first().boundingBox())!;
    await overlay.mouse.click(tabBox.x + tabBox.width / 2, tabBox.y + tabBox.height / 2);
    await expect(window.locator(".browser-tab.active")).toContainText("Vídeo vivo");
    await expect.poll(async () => (await layersOf(app, url)).overlayVisible).toBe(false);

    const counts = (await layersOf(app, url)).counts!;
    expect(counts["snapshot-fallback"]).toBe(0);
    expect(counts["live-overlay"]).toBe(7);

    // A camada caiu: a próxima abertura cria outra (sem cair na foto).
    await app.evaluate(({ webContents }) => {
      webContents
        .getAllWebContents()
        .find((contents) => contents.getURL().endsWith("/overlay.html"))!
        .forcefullyCrashRenderer();
    });
    await expect
      .poll(() => app.windows().filter((page) => page.url().endsWith("/overlay.html")).length)
      .toBe(0);
    await window.getByRole("button", { name: "Menu do Agzos" }).click();
    const reborn = await overlayPage(app);
    await expect(
      reborn.getByRole("menu", { name: "Menu do Agzos" }).getByRole("menuitem", { name: "Sair" }),
    ).toBeVisible();
    expect((await layersOf(app, url)).counts!["snapshot-fallback"]).toBe(0);
  } finally {
    await app.close();
  }
});

test("1.5.4: várias janelas: o painel abre só na janela clicada, cada uma com a sua camada", async () => {
  const { app, window } = await launch(tempProfile(), { AGZOS_DEBUG_OVERLAY: "1" });
  try {
    await window.keyboard.press(`${MOD}+n`);
    const [first, second] = await waitShells(app, 2);
    const openLayers = () =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((win) =>
          win.contentView.children.some((child) => {
            const contents = (child as { webContents?: Electron.WebContents }).webContents;
            return (
              Boolean(contents?.getURL().endsWith("/overlay.html")) &&
              child.getVisible() &&
              child.getBounds().width > 0
            );
          }),
        ),
      );
    await second!.getByRole("button", { name: "Menu do Agzos" }).click();
    await expect.poll(async () => (await openLayers()).filter(Boolean).length).toBe(1);
    await expect(second!.getByRole("button", { name: "Menu do Agzos" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(first!.getByRole("button", { name: "Menu do Agzos" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    // A outra janela abre o seu próprio painel (uma camada por janela).
    await first!.getByRole("button", { name: "Menu do Agzos" }).click();
    await expect.poll(async () => (await openLayers()).filter(Boolean).length).toBeGreaterThan(0);
    await expect(first!.getByRole("button", { name: "Menu do Agzos" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    const layerCount = () =>
      app.evaluate(
        ({ webContents }) =>
          webContents
            .getAllWebContents()
            .filter((contents) => contents.getURL().endsWith("/overlay.html")).length,
      );
    await expect.poll(layerCount).toBe(2);
  } finally {
    await app.close();
  }
});

// --- 2.0: nível Opera/Vivaldi ---

/** Filhos nativos da 1ª janela com a URL e a área (bounds) de cada um. */
async function nativeChildren(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.contentView.children.map((child) => {
      const contents = (child as { webContents?: Electron.WebContents }).webContents;
      return { url: contents?.getURL() ?? "", bounds: child.getBounds() };
    }),
  );
}

/** Tecla de verdade (passa pelo before-input-event) no webContents com foco. */
async function pressInFocused(app: ElectronApplication, keyCode: string, modifiers: string[]) {
  await app.evaluate(
    ({ webContents }, [code, mods]) => {
      const contents = webContents.getFocusedWebContents()!;
      const list = mods as ("control" | "shift" | "alt" | "meta")[];
      contents.sendInputEvent({ type: "keyDown", keyCode: code as string, modifiers: list });
      contents.sendInputEvent({ type: "keyUp", keyCode: code as string, modifiers: list });
    },
    [keyCode, modifiers] as const,
  );
}

test("2.0: barra de endereço seleciona tudo no 1º clique e copia o link pelo ícone", async () => {
  const { app, window } = await launch(tempProfile());
  const url = `${origin}/copiar-link`;
  try {
    await go(window, url);
    await expect(tabs(window).first()).toContainText("Página COPIAR-LINK");
    await omnibox(window).evaluate((input: HTMLInputElement) => input.blur());
    await omnibox(window).click();
    expect(
      await omnibox(window).evaluate(
        (input: HTMLInputElement) =>
          input.selectionStart === 0 && input.selectionEnd === input.value.length,
      ),
    ).toBe(true);
    await omnibox(window).evaluate((input: HTMLInputElement) => input.blur());
    await window.getByRole("button", { name: "Copiar link" }).click();
    await expect(window.getByRole("button", { name: "Link copiado" })).toBeVisible();
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(url);
  } finally {
    await app.close();
  }
});

test("2.0: Ctrl+K abre a busca de comandos na camada; Enter executa", async () => {
  const { app, window } = await launch(tempProfile());
  try {
    await window.keyboard.press(`${MOD}+k`);
    const layer = await overlayPage(app);
    const input = layer.getByRole("combobox", { name: "Buscar comandos" });
    await expect(input).toBeVisible();
    await input.fill("guia anonima");
    await expect(layer.getByRole("option").first()).toContainText("Nova guia anônima");
    await input.press("Enter");
    await expect(tabs(window)).toHaveCount(2);
    await expect(tabs(window).last()).toHaveAttribute("aria-label", /anônima/);
  } finally {
    await app.close();
  }
});

test("2.0: grupo de guias com nome e cor; recolher esconde as guias", async () => {
  const { app, window } = await launch(tempProfile());
  try {
    await go(window, `${origin}/grupo-a`);
    await expect(tabs(window).first()).toContainText("Página GRUPO-A");
    await window.getByRole("button", { name: "Nova aba", exact: true }).click();
    await go(window, `${origin}/grupo-b`);
    await expect(tabs(window).last()).toContainText("Página GRUPO-B");
    // Clique direito na guia → "Adicionar guia a novo grupo" (atalho Ctrl+Shift+G).
    await window.keyboard.press(`${MOD}+Shift+g`);
    const layer = await overlayPage(app);
    const name = layer.getByRole("textbox", { name: "Nome do grupo" });
    await expect(name).toBeVisible();
    await name.fill("Trabalho");
    await layer.getByRole("radio", { name: "Verde" }).click();
    await name.press("Enter");
    const chip = window.locator(".tab-group-chip");
    await expect(chip).toHaveText("Trabalho");
    await expect(chip).toHaveAttribute("style", /#22c55e/);
    // Recolher: a guia ativa sai do grupo e as do grupo somem da barra.
    await window.getByRole("button", { name: "Nova aba", exact: true }).click();
    await chip.click();
    await expect(chip).toHaveAttribute("aria-expanded", "false");
    await expect(tabs(window).filter({ hasText: "GRUPO-B" })).toHaveCount(0);
    await chip.click();
    await expect(tabs(window).filter({ hasText: "GRUPO-B" })).toHaveCount(1);
  } finally {
    await app.close();
  }
});

test("2.0: workspaces separam as guias e voltam depois de reiniciar", async () => {
  const profile = tempProfile();
  const first = await launch(profile);
  try {
    await go(first.window, `${origin}/pessoal`);
    await expect(tabs(first.window).first()).toContainText("Página PESSOAL");
    await first.window.getByRole("button", { name: /^Workspace / }).click();
    const layer = await overlayPage(first.app);
    await layer.getByRole("button", { name: "Novo workspace" }).click();
    await layer.getByRole("textbox", { name: "Nome do workspace" }).fill("Estudos");
    await layer.getByRole("button", { name: "Criar workspace" }).click();
    await expect(first.window.getByRole("button", { name: "Workspace Estudos" })).toBeVisible();
    await expect(tabs(first.window)).toHaveCount(1);
    await go(first.window, `${origin}/estudos`);
    await expect(tabs(first.window).first()).toContainText("Página ESTUDOS");
    // Ctrl+K também troca de workspace.
    await first.window.keyboard.press(`${MOD}+k`);
    const search = layer.getByRole("combobox", { name: "Buscar comandos" });
    await search.fill("pessoal");
    await search.press("Enter");
    await expect(first.window.getByRole("button", { name: "Workspace Pessoal" })).toBeVisible();
    await expect(tabs(first.window)).toHaveCount(1);
    await expect(tabs(first.window).first()).toContainText("Página PESSOAL");
    await first.window.waitForTimeout(1200);
  } finally {
    await first.app.close();
  }

  const second = await launch(profile);
  try {
    await expect(second.window.getByRole("button", { name: "Workspace Pessoal" })).toBeVisible();
    await expect(tabs(second.window)).toHaveCount(1);
    await second.window.getByRole("button", { name: "Workspace Pessoal" }).click();
    const layer = await overlayPage(second.app);
    await layer
      .getByRole("button", { name: /Estudos/ })
      .first()
      .click();
    await expect(tabs(second.window).first()).toContainText("ESTUDOS");
  } finally {
    await second.app.close();
  }
});

test("2.0: tela dividida mostra duas páginas lado a lado; clicar num lado ativa a guia", async () => {
  const { app, window } = await launch(tempProfile());
  const left = `${origin}/lado-a`;
  const right = `${origin}/lado-b`;
  try {
    await go(window, left);
    await expect(tabs(window).first()).toContainText("Página LADO-A");
    await window.keyboard.press(`${MOD}+Alt+Shift+s`);
    await expect(tabs(window)).toHaveCount(2);
    await go(window, right);
    await expect(tabs(window).last()).toContainText("Página LADO-B");
    await expect
      .poll(async () => {
        const views = await nativeChildren(app);
        const a = views.find((view) => view.url === left)?.bounds;
        const b = views.find((view) => view.url === right)?.bounds;
        return Boolean(a && b && a.width > 100 && b.width > 100 && a.x + a.width <= b.x);
      })
      .toBe(true);
    const active = window.locator(".tabs .browser-tab.active");
    await expect(active).toContainText("LADO-B");
    // Foco na página da esquerda (como um clique nela): ela vira a guia ativa.
    await app.evaluate(({ webContents }, target) => {
      webContents
        .getAllWebContents()
        .find((contents) => contents.getURL() === target)!
        .focus();
    }, left);
    await expect(active).toContainText("LADO-A");
    await expect(omnibox(window)).toHaveValue(left);
    // As duas continuam à vista; outra guia desfaz a vista (a divisão fica guardada).
    const both = await nativeChildren(app);
    expect(
      both.filter((view) => [left, right].includes(view.url) && view.bounds.width > 0),
    ).toHaveLength(2);
    await window.getByRole("separator", { name: /Divisória/ }).dblclick();
    await expect
      .poll(
        async () =>
          (await nativeChildren(app)).filter(
            (view) => [left, right].includes(view.url) && view.bounds.width > 0,
          ).length,
      )
      .toBe(1);
  } finally {
    await app.close();
  }
});

test("2.0: painel lateral abre ao lado da página, fica carregado e some ao fechar", async () => {
  const panelUrl = `${origin}/painel-lateral`;
  const { app, window } = await launch(tempProfile(), { AGZOS_SIDE_PANEL_URL: panelUrl });
  const page = `${origin}/principal`;
  try {
    await go(window, page);
    await expect(tabs(window).first()).toContainText("Página PRINCIPAL");
    await window
      .getByRole("navigation", { name: "Painéis laterais" })
      .getByRole("button", { name: "WhatsApp" })
      .click();
    await expect(window.getByRole("complementary", { name: "Painel WhatsApp" })).toBeVisible();
    await expect
      .poll(async () => {
        const views = await nativeChildren(app);
        const panel = views.find((view) => view.url === panelUrl)?.bounds;
        const tab = views.find((view) => view.url === page)?.bounds;
        return Boolean(panel && tab && panel.width > 200 && panel.x + panel.width <= tab.x);
      })
      .toBe(true);
    // Fechar esconde, mas a página do painel continua viva (mensagens seguem chegando).
    await window.getByRole("button", { name: "Fechar WhatsApp" }).click();
    await expect
      .poll(
        async () => (await nativeChildren(app)).find((view) => view.url === panelUrl)?.bounds.width,
      )
      .toBe(0);
    expect(await liveViews(app, "/painel-lateral")).toHaveLength(1);
  } finally {
    await app.close();
  }
});

test("2.2.3: conta Argon2id desbloqueia e o popup de autofill fica acima da página", async () => {
  const { app, window } = await launch(tempProfile(), {
    AGZOS_DEBUG_OVERLAY: "1",
    AGZOS_KEY_URL: origin,
  });
  const url = `${origin}/video-vivo`;
  try {
    await go(window, url);
    await expect(tabs(window).first()).toContainText("Vídeo vivo");

    // Pareia e desbloqueia com a senha mestra (Argon2id p=4, na worker do main).
    await window.getByRole("button", { name: "Abrir Agzos Key" }).click();
    const overlay = await overlayPage(app);
    await overlay.getByLabel("Código de pareamento").fill("ABCD-1234");
    await overlay.getByRole("button", { name: "Conectar" }).click();
    await overlay.getByLabel("Senha mestra").fill(KEY_PASSWORD);
    await overlay.getByRole("button", { name: "Desbloquear" }).click();
    await expect(overlay.getByText("Login local")).toBeVisible({ timeout: 30_000 });
    await overlay.keyboard.press("Escape");

    // O site tem credencial: o popup de autofill sobe NA CAMADA, por cima da página.
    const popup = overlay.getByRole("complementary", { name: "Entrar com o Agzos Key" });
    await expect(popup).toBeVisible();
    await expect.poll(async () => (await layersOf(app, url)).overlayOnTop).toBe(true);
    expect((await layersOf(app, url)).overlayVisible).toBe(true);
    await expect(window.locator(".autofill-popup")).toHaveCount(0);
    await expect(window.locator(".view-snapshot")).toHaveCount(0);
    // Aparece sozinho: não rouba o foco da página.
    expect(
      await app.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL()),
    ).not.toMatch(/overlay\.html$/);

    // Fechar dispensa neste site: a camada some.
    await popup.getByRole("button", { name: "Fechar" }).click();
    await expect.poll(async () => (await layersOf(app, url)).overlayVisible).toBe(false);
  } finally {
    await app.close();
  }
});

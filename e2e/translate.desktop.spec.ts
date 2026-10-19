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

// Tradução (página inteira, bilíngue, Mostrar original, cache, trecho e campo) com uma Groq
// de mentira. Pré-requisito: `bun run desktop:build`; no Linux sem tela, sob xvfb-run.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const GROQ_KEY = "gsk_e2e_0123456789abcdefghijklmnopqrst";
let server: http.Server;
let origin = "";
const calls: { kind: string; body: string }[] = [];

const ARTICLE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Garden article</title></head>
<body>
<h1 id="title">Welcome to the garden</h1>
<p id="p1">The garden is <b>beautiful</b> in spring.</p>
<p id="p2">Water the plants every morning.</p>
<p><code id="code">npm install garden</code></p>
<p id="brand" class="notranslate">Garden Pro</p>
<p id="nope" translate="no">Keep this sentence.</p>
<input id="field" value="Good morning, friend" style="width:300px">
<div id="later"></div>
</body></html>`;

function groq(request: http.IncomingMessage, response: http.ServerResponse, url: string) {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    const json = (value: unknown, status = 200) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(value));
    };
    if (request.headers.authorization !== `Bearer ${GROQ_KEY}`) {
      json({ error: { code: "invalid_api_key", message: "Invalid" } }, 401);
      return;
    }
    if (url === "/groq/models") {
      json({ data: [{ id: "llama-3.3-70b-versatile" }] });
      return;
    }
    const parsed = JSON.parse(body) as { messages: { role: string; content: string }[] };
    const system = parsed.messages.find((item) => item.role === "system")?.content ?? "";
    const user = JSON.parse(parsed.messages.at(-1)!.content) as {
      segments?: string[][];
      text?: string;
    };
    let content: unknown;
    if (system.startsWith("AGZOS-TRANSLATE-TEXT (translate)")) {
      calls.push({ kind: "text", body });
      content = { source: "en", translation: `PT-TEXT(${user.text})` };
    } else if (system.startsWith("AGZOS-TRANSLATE-TEXT (explain)")) {
      calls.push({ kind: "explain", body });
      content = { source: "en", explanation: "EXPLICACAO do trecho." };
    } else if (system.startsWith("AGZOS-TRANSLATE-TEXT (alternatives)")) {
      calls.push({ kind: "alternatives", body });
      content = { source: "en", alternatives: [{ text: "ALT-1", note: "nota" }] };
    } else {
      calls.push({ kind: "page", body });
      content = {
        source: "en",
        translations: (user.segments ?? []).map((parts) =>
          parts.map((part) => (part ? `PT(${part})` : part)),
        ),
      };
    }
    json({ choices: [{ message: { content: JSON.stringify(content) } }] });
  });
}

test.beforeAll(async () => {
  server = http.createServer((request, response) => {
    const url = request.url ?? "/";
    if (url.startsWith("/groq/")) {
      groq(request, response, url);
      return;
    }
    if (url === "/artigo") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(ARTICLE);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function launch() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "agzos-e2e-tr-"));
  const app = await electron.launch({
    args: ["--no-sandbox", root],
    cwd: root,
    env: {
      ...process.env,
      AGZOS_USER_DATA: profile,
      AGZOS_GROQ_BASE_URL: `${origin}/groq`,
      AGZOS_TEST_BASIC_KEYRING: "1",
    },
  });
  const window = await app.firstWindow();
  await window.locator('.browser-stage[data-ready="true"]').waitFor();
  const saved = await window.evaluate(
    (key) =>
      (
        window as unknown as { agzosDesktop: { aiSetKey(key: string): Promise<{ ok: boolean }> } }
      ).agzosDesktop.aiSetKey(key),
    GROQ_KEY,
  );
  expect(saved.ok).toBe(true);
  return { app, window };
}

async function open(window: Page, url: string) {
  const omnibox = window.getByLabel("Pesquisar ou digitar endereço");
  await omnibox.fill(url);
  await omnibox.press("Enter");
  await expect(window.locator(".browser-tab").first()).toContainText("Garden article");
}

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

async function overlay(app: ElectronApplication) {
  let found: Page | undefined;
  await expect
    .poll(() => {
      found = app.windows().find((page) => page.url().endsWith("/overlay.html"));
      return Boolean(found);
    })
    .toBe(true);
  return found!;
}

/** Clique direito de verdade na guia; devolve os rótulos do menu nativo (sem abri-lo). */
async function contextMenu(app: ElectronApplication, url: string, selector: string) {
  const rect = await inTab<{ x: number; y: number }>(
    app,
    url,
    `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return { x: Math.round(r.left + 12), y: Math.round(r.top + r.height / 2) }; })()`,
  );
  await app.evaluate(({ Menu }) => {
    const host = globalThis as unknown as { __agzosMenu?: Electron.Menu | null };
    host.__agzosMenu = null;
    Menu.prototype.popup = function popup(this: Electron.Menu) {
      host.__agzosMenu = this;
    };
  });
  await app.evaluate(
    ({ webContents }, [target, x, y]) => {
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === target)!;
      const base = { x: x as number, y: y as number, button: "right" as const, clickCount: 1 };
      contents.sendInputEvent({ type: "mouseDown", ...base });
      contents.sendInputEvent({ type: "mouseUp", ...base });
    },
    [url, rect.x, rect.y] as const,
  );
  await expect
    .poll(() =>
      app.evaluate(() => Boolean((globalThis as unknown as { __agzosMenu?: unknown }).__agzosMenu)),
    )
    .toBe(true);
  return app.evaluate(() =>
    (globalThis as unknown as { __agzosMenu: Electron.Menu }).__agzosMenu.items.map(
      (item) => item.label,
    ),
  );
}

async function clickMenuItem(app: ElectronApplication, label: string) {
  await app.evaluate((_electron, wanted) => {
    const menu = (globalThis as unknown as { __agzosMenu: Electron.Menu }).__agzosMenu;
    const item = menu.items.find((entry) => entry.label === wanted)!;
    (item.click as unknown as () => void)();
  }, label);
}

const text = (app: ElectronApplication, url: string, selector: string) =>
  inTab<string>(app, url, `document.querySelector(${JSON.stringify(selector)}).textContent`);

test("tradução: página pelo ícone da barra, novos conteúdos, bilíngue, Mostrar original e cache", async () => {
  calls.length = 0;
  const page = `${origin}/artigo`;
  const { app, window } = await launch();
  try {
    await open(window, page);
    // Página em inglês, destino português: o ícone aparece na barra de URL.
    const button = window.getByRole("button", { name: "Traduzir página" });
    await expect(button).toBeVisible({ timeout: 15_000 });
    await button.click();
    const layer = await overlay(app);
    const panel = layer.getByRole("complementary", { name: "Tradução da página" });
    await expect(panel).toContainText("Esta página está em Inglês");
    await panel.getByRole("button", { name: "Traduzir para Português" }).click();

    await expect
      .poll(() => text(app, page, "#p2"), { timeout: 15_000 })
      .toBe("PT(Water the plants every morning.)");
    // Partes com formatação (negrito) continuam no mesmo nó, com os espaços originais.
    expect(await text(app, page, "#p1")).toBe("PT(The garden is) PT(beautiful) PT(in spring.)");
    expect(await text(app, page, "#title")).toBe("PT(Welcome to the garden)");
    // Código, .notranslate e translate="no" ficam como estão.
    expect(await text(app, page, "#code")).toBe("npm install garden");
    expect(await text(app, page, "#brand")).toBe("Garden Pro");
    expect(await text(app, page, "#nope")).toBe("Keep this sentence.");
    await expect(panel).toContainText("Traduzida para Português");
    const prompt = calls.find((call) => call.kind === "page")!.body;
    expect(prompt).toContain("into Brazilian Portuguese");
    expect(prompt).not.toContain("npm install garden");
    expect(prompt).not.toContain("Garden Pro");

    // Conteúdo novo (SPA) também é traduzido enquanto a página está traduzida.
    await inTab(
      app,
      page,
      `document.querySelector("#later").append(Object.assign(document.createElement("p"), { id: "fresh", textContent: "Fresh content arrives." }))`,
    );
    await expect
      .poll(() => text(app, page, "#fresh"), { timeout: 10_000 })
      .toBe("PT(Fresh content arrives.)");

    // Original no mouse: a página fica traduzida e a dica mostra o original do bloco.
    await panel.getByRole("radio", { name: "Original no mouse" }).click();
    const p2 = await inTab<{ x: number; y: number }>(
      app,
      page,
      `(() => { const r = document.querySelector("#p2").getBoundingClientRect();
        return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2) }; })()`,
    );
    await expect
      .poll(async () => {
        await app.evaluate(
          ({ webContents }, [target, x, y]) => {
            const contents = webContents
              .getAllWebContents()
              .find((item) => item.getURL() === target)!;
            contents.sendInputEvent({ type: "mouseMove", x: (x as number) + 1, y: y as number });
            contents.sendInputEvent({ type: "mouseMove", x: x as number, y: y as number });
          },
          [page, p2.x, p2.y] as const,
        );
        return inTab(
          app,
          page,
          `[document.querySelector("#p2").textContent, document.querySelector('[data-agzos-translation="tip"]')?.textContent]`,
        );
      })
      .toEqual(["PT(Water the plants every morning.)", "Water the plants every morning."]);

    // Bilíngue: o original volta e a tradução fica embaixo, num nó marcado.
    await panel.getByRole("radio", { name: "Bilíngue" }).click();
    await expect
      .poll(() =>
        inTab(
          app,
          page,
          `[document.querySelector("#p2").firstChild.nodeValue, document.querySelector("#p2 [data-agzos-translation]")?.textContent]`,
        ),
      )
      .toEqual(["Water the plants every morning.", "PT(Water the plants every morning.)"]);

    // Mostrar original: tudo volta, sem nós extras, e sem chamar a Groq.
    const before = calls.length;
    await panel.getByRole("button", { name: "Mostrar original" }).click();
    await expect.poll(() => text(app, page, "#p2")).toBe("Water the plants every morning.");
    expect(await text(app, page, "#p1")).toBe("The garden is beautiful in spring.");
    expect(
      await inTab<number>(
        app,
        page,
        `document.querySelectorAll("[data-agzos-translation]").length`,
      ),
    ).toBe(0);
    // Traduzir de novo usa o que a página guardou.
    await panel.getByRole("button", { name: "Traduzir para Português" }).click();
    await expect
      .poll(() =>
        inTab(app, page, `document.querySelector("#p2 [data-agzos-translation]")?.textContent`),
      )
      .toBe("PT(Water the plants every morning.)");
    expect(calls.length).toBe(before);

    // Recarregar e traduzir de novo: tudo sai do cache (nenhuma chamada nova).
    await panel.getByRole("button", { name: "Fechar tradução" }).click();
    await inTab(app, page, "location.reload()");
    await expect.poll(() => text(app, page, "#p2")).toBe("Water the plants every morning.");
    await expect(button).toBeVisible();
    await button.click();
    await layer
      .getByRole("complementary", { name: "Tradução da página" })
      .getByRole("button", { name: "Traduzir para Português" })
      .click();
    await expect
      .poll(() =>
        inTab(app, page, `document.querySelector("#p2 [data-agzos-translation]")?.textContent`),
      )
      .toBe("PT(Water the plants every morning.)");
    expect(calls.length).toBe(before);
  } finally {
    await app.close();
  }
});

test("tradução: trecho selecionado na bolha (explicar) e o que foi escrito no campo, com Ctrl+Z", async () => {
  calls.length = 0;
  const page = `${origin}/artigo`;
  const { app, window } = await launch();
  try {
    await open(window, page);
    await inTab(
      app,
      page,
      `(() => { const r = document.createRange(); r.selectNodeContents(document.querySelector("#p2"));
        getSelection().removeAllRanges(); getSelection().addRange(r); })()`,
    );
    const labels = await contextMenu(app, page, "#p2");
    const item = labels.find((label) => label.startsWith("Traduzir “"));
    expect(item).toBe("Traduzir “Water the plants every m…” para Português");
    await clickMenuItem(app, item!);

    const layer = await overlay(app);
    const bubble = layer.getByRole("complementary", { name: "Tradução do trecho" });
    await expect(bubble.getByLabel("Tradução", { exact: true })).toContainText(
      "PT-TEXT(Water the plants every morning.)",
      { timeout: 15_000 },
    );
    await expect(bubble).toContainText("Inglês →");
    await bubble.getByRole("button", { name: "Explicar o trecho" }).click();
    await expect(bubble.getByLabel("Explicação")).toContainText("EXPLICACAO do trecho.");
    await bubble.getByRole("button", { name: "Fechar tradução do trecho" }).click();

    // Campo editável: "Traduzir o que escrevi" troca o texto (e o Ctrl+Z desfaz).
    await inTab(app, page, `document.querySelector("#field").focus()`);
    const fieldLabels = await contextMenu(app, page, "#field");
    expect(fieldLabels).toContain("Traduzir o que escrevi para Português");
    await clickMenuItem(app, "Traduzir o que escrevi para Português");
    await expect
      .poll(() => inTab(app, page, `document.querySelector("#field").value`), { timeout: 15_000 })
      .toBe("PT-TEXT(Good morning, friend)");
    expect(
      await inTab(
        app,
        page,
        `(() => { const f = document.querySelector("#field"); f.focus(); document.execCommand("undo"); return f.value; })()`,
      ),
    ).toBe("Good morning, friend");
    await expect(window.getByText("Texto traduzido no campo. Ctrl+Z desfaz.")).toBeVisible();
  } finally {
    await app.close();
  }
});

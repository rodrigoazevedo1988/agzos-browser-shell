import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect, test } from "@playwright/test";

// Regressão da 1.3.5–1.3.7: os scriptlets eram juntados num script só e duas cópias de
// `class JSONPath` viravam SyntaxError, então nenhum rodava e o YouTube seguia com anúncios.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const UBO = "https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters";
const RESOURCES =
  "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/resources.json";

// Regras reais do uBlock Origin para o YouTube (GPLv3: baixadas na hora, não copiadas
// para o repositório), com o domínio trocado por 127.0.0.1. Sem rede, o teste é pulado.
let lists = "";
let resources = "";
test.beforeAll(async () => {
  test.setTimeout(60_000);
  try {
    const texts = await Promise.all(
      ["quick-fixes", "filters", "filters-2025", "filters-2026"].map(async (name) => {
        const response = await fetch(`${UBO}/${name}.txt`);
        if (!response.ok) throw new Error(`${name}: ${response.status}`);
        return response.text();
      }),
    );
    lists = texts
      .join("\n")
      .split("\n")
      .filter((line) => {
        const match = /^([^#!\s][^#]*)#@?#\+js/.exec(line);
        return Boolean(
          match && match[1]!.split(",").some((d) => d === "www.youtube.com" || d === "youtube.com"),
        );
      })
      .map((line) => line.replace(/^[^#]*/, "127.0.0.1"))
      .join("\n");
    const response = await fetch(RESOURCES);
    if (response.ok) resources = await response.text();
  } catch {
    // Sem rede: fica vazio e o teste é pulado.
  }
});

const PLAYER = JSON.stringify({
  responseContext: {},
  playabilityStatus: { status: "OK" },
  adPlacements: [{ adPlacementRenderer: { config: {} } }],
  adSlots: [{ adSlotRenderer: {} }],
  playerAds: [{ playerLegacyDesktopWatchAdsRenderer: {} }],
  videoDetails: { videoId: "abc" },
  streamingData: {},
});

test("regras reais do uBO para o YouTube tiram os anúncios do player já na 1ª carga", async () => {
  test.skip(!lists || !resources, "sem rede para baixar as listas do uBlock Origin");
  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === "/l.txt") return void res.end(lists);
    if (url === "/r.json") return void res.end(resources);
    if (url.startsWith("/youtubei/v1/player")) {
      res.writeHead(200, { "content-type": "application/json" });
      return void res.end(PLAYER);
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><title>Watch</title><script>
      var anuncios = (o) => ["adPlacements", "adSlots"].filter((k) => o[k] !== undefined).join() || "limpo";
      var ytInitialPlayerResponse = ${PLAYER};
      window.inicial = ["adPlacements", "adSlots", "playerAds"].filter((k) => ytInitialPlayerResponse[k] !== undefined).join() || "limpo";
      fetch("/youtubei/v1/player?prettyPrint=false", { method: "POST", body: JSON.stringify({ context: { client: { clientName: "WEB" } } }) })
        .then((r) => r.json()).then((j) => { window.viaFetch = anuncios(j); });
      const x = new XMLHttpRequest(); x.open("POST", "/youtubei/v1/player?prettyPrint=false");
      x.onload = () => { try { window.viaXhr = anuncios(JSON.parse(x.responseText)); } catch (e) { window.viaXhr = "erro " + e.message; } };
      x.send("{}");
    </script>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const app = await electron.launch({
    args: ["--no-sandbox", root],
    cwd: root,
    env: {
      ...process.env,
      AGZOS_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), "yt-")),
      AGZOS_FILTER_LISTS: JSON.stringify({
        ads: [`${origin}/l.txt`],
        privacy: [],
        resources: `${origin}/r.json`,
      }),
    },
  });
  try {
    const window = await app.firstWindow();
    await window.locator('.browser-stage[data-ready="true"]').waitFor();
    await window.getByRole("button", { name: /bloqueados/ }).click();
    await expect(window.getByText(/atualizadas em/)).toBeVisible({ timeout: 20_000 });
    await window.getByRole("button", { name: "Fechar proteção" }).click();
    const omni = window.getByLabel("Pesquisar ou digitar endereço");
    await omni.fill(`${origin}/watch?v=abc`);
    await omni.press("Enter");
    await expect(window.locator(".browser-tab.active")).toContainText("Watch");
    const read = () =>
      app.evaluate(({ webContents }) =>
        webContents
          .getAllWebContents()
          .find((c) => c.getURL().includes("/watch"))!
          .executeJavaScript(
            "JSON.stringify({ inicial: window.inicial, viaFetch: window.viaFetch, viaXhr: window.viaXhr })",
          ),
      );
    // O player pede os dados por XHR e fetch; o HTML traz o ytInitialPlayerResponse.
    const clean = { inicial: "limpo", viaFetch: "limpo", viaXhr: "limpo" };
    await expect.poll(async () => JSON.parse(await read()), { timeout: 10_000 }).toEqual(clean);
    await window.getByRole("button", { name: "Recarregar" }).click();
    await expect.poll(async () => JSON.parse(await read()), { timeout: 10_000 }).toEqual(clean);
  } finally {
    await app.close();
    server.closeAllConnections();
    server.close();
  }
});

import { expect, test, type Page } from "@playwright/test";

const omnibox = (page: Page) => page.getByLabel("Pesquisar ou digitar endereço");
const tabs = (page: Page) => page.locator(".tabs .browser-tab");
const pageErrors = new WeakMap<Page, string[]>();

// A rota é renderizada no servidor: só dá para interagir depois que o React hidrata
// e o estado salvo é carregado (data-ready).
async function hydrated(page: Page) {
  await page.locator('.browser-stage[data-ready="true"]').waitFor();
}

async function reload(page: Page) {
  await page.reload();
  await hydrated(page);
}

async function go(page: Page, value: string) {
  await omnibox(page).fill(value);
  await omnibox(page).press("Enter");
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await hydrated(page);
  await page.evaluate(() => window.localStorage.clear());
  await reload(page);
  await expect(tabs(page)).toHaveCount(1);
});

test.afterEach(({ page }) => {
  expect(pageErrors.get(page)).toEqual([]);
});

test("abre a página inicial com uma aba", async ({ page }) => {
  await expect(tabs(page).first()).toContainText("Nova aba");
  await expect(omnibox(page)).toHaveValue("agzos://inicio");
  await expect(page.getByText("Navegue com clareza. Decida com controle.")).toBeVisible();
});

test("cria e fecha abas pelo botão e pelo teclado", async ({ page }) => {
  await page.getByRole("button", { name: "Nova aba", exact: true }).first().click();
  await expect(tabs(page)).toHaveCount(2);
  await page.keyboard.press("Control+t");
  await expect(tabs(page)).toHaveCount(3);
  await page.keyboard.press("Control+w");
  await expect(tabs(page)).toHaveCount(2);
  await tabs(page)
    .last()
    .getByLabel(/^Fechar /)
    .click();
  await expect(tabs(page)).toHaveCount(1);
});

test("navega pela omnibox, volta e avança", async ({ page }) => {
  await go(page, "github.com");
  await expect(tabs(page).first()).toContainText("github.com");
  await expect(page.getByText("Este site não permite exibição aqui")).toBeVisible();
  await expect(omnibox(page)).toHaveValue("https://github.com");

  await page.getByRole("button", { name: "Voltar" }).click();
  await expect(omnibox(page)).toHaveValue("agzos://inicio");
  await expect(tabs(page).first()).toContainText("Nova aba");

  await page.getByRole("button", { name: "Avançar" }).click();
  await expect(omnibox(page)).toHaveValue("https://github.com");
});

test("texto livre vira busca no motor escolhido", async ({ page }) => {
  await go(page, "agzos browser");
  await expect(omnibox(page)).toHaveValue("https://duckduckgo.com/?q=agzos%20browser");
  await expect(tabs(page).first()).toContainText("agzos browser");
});

test("reabre a aba fechada com Ctrl+Shift+T", async ({ page }) => {
  await page.keyboard.press("Control+t");
  await go(page, "github.com");
  await page.keyboard.press("Control+w");
  await expect(tabs(page)).toHaveCount(1);
  await page.keyboard.press("Control+Shift+T");
  await expect(tabs(page)).toHaveCount(2);
  await expect(tabs(page).last()).toContainText("github.com");
});

test("menu de contexto fixa, duplica e fecha outras", async ({ page }) => {
  await go(page, "github.com");
  await page.keyboard.press("Control+t");
  await go(page, "figma.com");

  await tabs(page).last().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Fixar" }).click();
  await expect(tabs(page).first()).toContainText("figma.com");
  await expect(tabs(page).first()).toHaveClass(/pinned/);

  await tabs(page).nth(1).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Duplicar" }).click();
  await expect(tabs(page)).toHaveCount(3);

  await tabs(page).nth(1).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Fechar outras guias" }).click();
  // A fixada sobrevive.
  await expect(tabs(page)).toHaveCount(2);
});

test("aba fixada pede um segundo clique para fechar", async ({ page }) => {
  await page.keyboard.press("Control+t");
  await tabs(page)
    .last()
    .getByLabel(/^Fixar /)
    .click();
  const pinned = tabs(page).first();
  await pinned.getByLabel(/^Fechar /).click();
  await expect(tabs(page)).toHaveCount(2);
  await pinned.getByLabel(/^Fechar /).click();
  await expect(tabs(page)).toHaveCount(1);
});

test("abas verticais persistem após recarregar", async ({ page }) => {
  await page.locator(".tabs").click({ button: "right", position: { x: 600, y: 10 } });
  await page.getByRole("menuitem", { name: "Mostrar guias verticalmente" }).click();
  await expect(page.locator(".tabs-rail")).toBeVisible();
  await page.getByLabel("Alternar barra de guias").click();
  await expect(page.locator(".tabs-rail")).toHaveClass(/collapsed/);
  await reload(page);
  await expect(page.locator(".tabs-rail")).toBeVisible();
  await expect(page.locator(".tabs-rail")).toHaveClass(/collapsed/);
});

test("sessão, tema e motor persistem; aba anônima não", async ({ page }) => {
  await go(page, "github.com");
  await page.getByRole("button", { name: "Nova aba anônima" }).first().click();
  await go(page, "notion.so");
  await expect(tabs(page)).toHaveCount(2);
  await page.getByRole("button", { name: "Usar tema escuro" }).click();
  await page.getByRole("button", { name: "Configurações" }).click();
  await page.getByRole("button", { name: /Yandex/ }).click();
  await page.getByRole("button", { name: "Fechar configurações" }).click();

  await reload(page);
  await expect(tabs(page)).toHaveCount(1);
  await expect(tabs(page).first()).toContainText("github.com");
  await expect(page.locator(".browser-stage")).toHaveClass(/dark/);
  await page.keyboard.press("Control+t");
  await go(page, "agzos");
  await expect(omnibox(page)).toHaveValue("https://yandex.com/search/?text=agzos");
});

test("aba anônima nunca entra em 'reabrir guia fechada'", async ({ page }) => {
  await go(page, "github.com");
  await page.getByRole("button", { name: "Nova aba anônima" }).first().click();
  await go(page, "segredo-anonimo.example");
  await tabs(page).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Fechar outras guias" }).click();
  await expect(tabs(page)).toHaveCount(1);
  await page.keyboard.press("Control+Shift+T");
  await expect(tabs(page)).toHaveCount(1);
  const stored = await page.evaluate(() => JSON.stringify(window.localStorage));
  expect(stored).not.toContain("segredo-anonimo");
});

test("favoritar adiciona atalho na página inicial", async ({ page }) => {
  await go(page, "linear.app/team");
  await page.getByLabel("Favoritar página").click();
  await expect(page.getByLabel("Favoritar página")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Control+t");
  await expect(page.locator(".quick-links, .start-page").getByText("linear.app")).toBeVisible();
});

test("painéis abrem e fecham", async ({ page }) => {
  await page.getByRole("button", { name: "Abrir Agzos Key" }).click();
  await expect(page.getByText("github.com").first()).toBeVisible();
  await page.locator(".privacy-pill").click();
  await expect(page.locator(".key-panel")).toHaveCount(1);
  await page.getByRole("button", { name: "Alternar Agzos AI" }).click();
  await expect(page.getByText("Agzos AI", { exact: true })).toHaveCount(0);
});

test("Ctrl+W fecha aba fixada direto, como na 1.3", async ({ page }) => {
  await page.keyboard.press("Control+t");
  await tabs(page)
    .last()
    .getByLabel(/^Fixar /)
    .click();
  await tabs(page).first().click();
  await page.keyboard.press("Control+w");
  await expect(tabs(page)).toHaveCount(1);
});

test("migra as chaves da 1.3 no primeiro load", async ({ page }) => {
  await page.evaluate(() => {
    window.localStorage.clear();
    window.localStorage.setItem(
      "agzos-tabs",
      JSON.stringify([
        {
          id: 5,
          history: [{ title: "github.com", url: "https://github.com", kind: "page" }],
          index: 0,
        },
      ]),
    );
    window.localStorage.setItem("agzos-engine", "yandex");
    window.localStorage.setItem("agzos-tab-orientation", "vertical");
  });
  await page.reload();
  await page.locator('.browser-stage[data-ready="true"]').waitFor();
  await expect(page.locator(".tabs-rail")).toBeVisible();
  await expect(page.locator(".tabs-rail .browser-tab").first()).toContainText("github.com");
  const keys = await page.evaluate(() => Object.keys(window.localStorage).sort());
  expect(keys).toEqual(["agzos-credentials", "agzos-state"]);
});

test("1.5: Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+1 e Ctrl+9 trocam de guia", async ({ page }) => {
  await go(page, "github.com");
  await page.keyboard.press("Control+t");
  await go(page, "linear.app");
  await page.keyboard.press("Control+t");
  const active = page.locator(".tabs .browser-tab.active");
  await expect(active).toContainText("Nova aba");
  await page.keyboard.press("Control+Tab");
  await expect(active).toContainText("github.com");
  await page.keyboard.press("Control+Shift+Tab");
  await expect(active).toContainText("Nova aba");
  await page.keyboard.press("Control+2");
  await expect(active).toContainText("linear.app");
  await page.keyboard.press("Control+9");
  await expect(active).toContainText("Nova aba");
  await page.keyboard.press("Control+1");
  await expect(active).toContainText("github.com");
});

test("1.5: Ctrl+D favorita, Alt+← volta", async ({ page }) => {
  await go(page, "linear.app/team");
  await page.keyboard.press("Control+d");
  await expect(page.getByLabel("Favoritar página")).toHaveAttribute("aria-pressed", "true");
  await go(page, "figma.com/files");
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(omnibox(page)).toHaveValue("https://linear.app/team");
});

test("1.5: na web, privacidade e downloads explicam que o recurso é do app", async ({ page }) => {
  await expect(page.getByText(/anúncios e rastreadores bloqueados hoje/)).toBeVisible();
  await page.locator(".privacy-pill").click();
  await expect(
    page.getByText("O bloqueio real funciona no app Agzos para computador"),
  ).toBeVisible();
  await page.keyboard.press("Control+j");
  await expect(page.getByText("Downloads funcionam no app Agzos para computador.")).toBeVisible();
  // Sem downloads, o botão da barra não aparece (a barra fica igual à 1.4).
  await expect(page.getByRole("button", { name: "Downloads", exact: true })).toHaveCount(0);
});

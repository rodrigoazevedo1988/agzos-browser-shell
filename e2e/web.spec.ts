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
  // 4.5: escuro é o padrão; o claro também persiste.
  await page.getByRole("button", { name: "Usar tema claro" }).click();
  await page.getByRole("button", { name: "Menu do Agzos" }).click();
  await page.getByRole("menuitem", { name: "Configurações" }).click();
  await page.getByRole("button", { name: "Mecanismo de pesquisa" }).click();
  await page.getByRole("button", { name: /Yandex/ }).click();
  // A página de configurações abriu numa guia nova: fecha para a sessão ficar como antes.
  await page.keyboard.press("Control+w");

  await reload(page);
  await expect(tabs(page)).toHaveCount(1);
  await expect(tabs(page).first()).toContainText("github.com");
  await expect(page.locator(".browser-stage")).not.toHaveClass(/dark/);
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

test("1.6: a estrela salva na barra de favoritos, com nome e pasta editáveis", async ({ page }) => {
  await go(page, "linear.app/team");
  await page.getByLabel("Favoritar página").click();
  await expect(page.getByLabel("Favoritar página")).toHaveAttribute("aria-pressed", "true");
  const editor = page.getByRole("complementary", { name: "Favorito adicionado" });
  await expect(editor).toBeVisible();
  await editor.getByLabel("Nome do favorito").fill("Linear do time");
  await editor.getByRole("button", { name: "Concluído" }).click();
  const bar = page.getByRole("navigation", { name: "Barra de favoritos" });
  await expect(bar.getByRole("button", { name: "Linear do time" })).toBeVisible();
  // Persistido e a página inicial continua só com os atalhos.
  await reload(page);
  await expect(bar.getByRole("button", { name: "Linear do time" })).toBeVisible();
  await page.keyboard.press("Control+t");
  await expect(page.locator(".quick-links").getByText("Linear do time")).toHaveCount(0);
  // Clicar no favorito abre na aba atual.
  await bar.getByRole("button", { name: "Linear do time" }).click();
  await expect(omnibox(page)).toHaveValue("https://linear.app/team");
});

test("1.6: pastas na barra, menu da pasta e gerenciador de favoritos", async ({ page }) => {
  await go(page, "github.com");
  await page.keyboard.press("Control+t");
  await go(page, "figma.com");
  // Ctrl+Shift+D: as guias abertas viram uma pasta nova na barra.
  await page.keyboard.press("Control+Shift+D");
  const editor = page.getByRole("complementary", { name: "Editar pasta" });
  await editor.getByLabel("Nome do favorito").fill("Design");
  await editor.getByRole("button", { name: "Concluído" }).click();
  const bar = page.getByRole("navigation", { name: "Barra de favoritos" });
  await bar.getByRole("button", { name: "Design" }).click();
  await expect(page.getByRole("menuitem", { name: "github.com" })).toBeVisible();
  await page.getByRole("menuitem", { name: "figma.com" }).click();
  await expect(omnibox(page)).toHaveValue("https://figma.com");

  // Gerenciador: nova pasta, mover favorito para ela e excluir.
  await page.keyboard.press("Control+Shift+O");
  await expect(page.getByRole("heading", { name: "Favoritos", level: 1 })).toBeVisible();
  await expect(omnibox(page)).toHaveValue("agzos://favoritos");
  const manager = page.locator(".bookmarks-manager");
  await manager.getByRole("button", { name: "Design" }).first().click();
  await expect(manager.locator(".library-folder-view .library-row")).toHaveCount(2);
  await expect(manager.locator(".library-link").getByText("github.com").first()).toBeVisible();
  await manager.getByLabel("Pesquisar favoritos").fill("figma");
  await expect(manager.locator(".library-folder-view .library-row")).toHaveCount(1);
  await manager.getByLabel("Excluir figma.com").click();
  await expect(manager.locator(".library-folder-view .library-row")).toHaveCount(0);

  // Ctrl+Shift+B esconde e mostra a barra.
  await page.keyboard.press("Control+Shift+B");
  await expect(bar).toHaveCount(0);
  await page.keyboard.press("Control+Shift+B");
  await expect(bar).toBeVisible();
});

test("1.6: importa favoritos exportados pelo Chrome e exporta de volta", async ({ page }) => {
  await page.keyboard.press("Control+Shift+O");
  const manager = page.locator(".bookmarks-manager");
  await manager.getByLabel("Arquivo de favoritos").setInputFiles({
    name: "bookmarks.html",
    mimeType: "text/html",
    buffer: Buffer.from(`<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><H3 PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
  <DL><p>
    <DT><A HREF="https://news.ycombinator.com/">Hacker News</A>
    <DT><H3>Leituras</H3>
    <DL><p><DT><A HREF="https://lwn.net/">LWN</A></DL><p>
  </DL><p>
</DL><p>`),
  });
  await expect(page.getByRole("status")).toContainText("2 favoritos importados");
  await expect(manager.locator(".library-link").getByText("Hacker News")).toBeVisible();
  await expect(manager.getByRole("button", { name: /Leituras/ }).first()).toBeVisible();
  const download = page.waitForEvent("download");
  await manager.getByRole("button", { name: "Exportar" }).click();
  const file = await download;
  const html = await (await file.createReadStream()).toArray();
  expect(Buffer.concat(html).toString()).toContain('HREF="https://lwn.net/"');
});

test("1.6: histórico registra as visitas, pesquisa e apaga (aba anônima fica de fora)", async ({
  page,
}) => {
  await go(page, "github.com");
  await go(page, "linear.app/team");
  await page.getByRole("button", { name: "Nova aba anônima" }).first().click();
  await go(page, "segredo-anonimo.example");
  await page.keyboard.press("Control+h");
  await expect(page.getByRole("heading", { name: "Histórico", level: 1 })).toBeVisible();
  const history = page.locator(".library-page");
  await expect(history.locator(".library-row")).toHaveCount(2);
  await expect(history.getByText(/^Hoje/)).toBeVisible();
  await expect(history.getByText("segredo-anonimo")).toHaveCount(0);
  await history.getByLabel("Pesquisar no histórico").fill("linear");
  await expect(history.locator(".library-row")).toHaveCount(1);
  await history.getByLabel(/^Remover .* do histórico$/).click();
  await expect(history.getByText('Nada no histórico com "linear".')).toBeVisible();
  await history.getByLabel("Pesquisar no histórico").fill("");
  await history.getByLabel("Período para limpar").selectOption("all");
  await history.getByRole("button", { name: "Limpar histórico" }).click();
  await expect(history.getByText("Seu histórico está vazio.")).toBeVisible();
});

test("1.6: omnibox sugere histórico, favoritos e abas; autocompleta o domínio", async ({
  page,
}) => {
  await go(page, "github.com/agzos");
  await page.keyboard.press("Control+t");
  await go(page, "linear.app/team");
  await page.keyboard.press("Control+t");

  // Autocompletar: "git" vira "github.com" com o resto selecionado.
  await omnibox(page).fill("");
  await omnibox(page).pressSequentially("git");
  await expect(omnibox(page)).toHaveValue("github.com");
  const list = page.getByRole("listbox", { name: "Sugestões" });
  await expect(list.getByRole("option").first()).toContainText("Pesquisar no DuckDuckGo");
  // github.com/agzos está aberta em outra aba: vira "Mudar para esta guia".
  await expect(
    list.getByRole("option", { name: /github\.com.*Mudar para esta guia/ }),
  ).toBeVisible();
  // Digitar por cima da parte selecionada continua normal.
  await omnibox(page).press("Backspace");
  await expect(omnibox(page)).toHaveValue("git");

  // Aba aberta: "Mudar para esta guia" ativa a aba em vez de abrir outra.
  await omnibox(page).fill("");
  await omnibox(page).pressSequentially("linear");
  const option = list.getByRole("option", { name: /Mudar para esta guia/ });
  await expect(option).toBeVisible();
  await option.click();
  await expect(tabs(page)).toHaveCount(3);
  await expect(page.locator(".tabs .browser-tab.active")).toContainText("linear.app");

  // Setas + Enter escolhem; Esc fecha a lista.
  await omnibox(page).click();
  await omnibox(page).fill("");
  await omnibox(page).pressSequentially("agzos");
  await expect(list).toBeVisible();
  await omnibox(page).press("Escape");
  await expect(list).toHaveCount(0);
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
  expect(keys).toEqual(["agzos-credentials", "agzos-state", "agzos-vault-entries"]);
});

test("1.5: Ctrl+Tab alterna pela ordem de uso; Ctrl+PgDn/1/9 pela barra", async ({ page }) => {
  await go(page, "github.com");
  await page.keyboard.press("Control+t");
  await go(page, "linear.app");
  await page.keyboard.press("Control+t");
  const active = page.locator(".tabs .browser-tab.active");
  await expect(active).toContainText("Nova aba");
  // Toque rápido: volta para a última usada (linear), e de novo para a nova aba.
  await page.keyboard.press("Control+Tab");
  await expect(active).toContainText("linear.app");
  await page.keyboard.press("Control+Tab");
  await expect(active).toContainText("Nova aba");
  await page.keyboard.press("Control+PageDown");
  await expect(active).toContainText("github.com");
  await page.keyboard.press("Control+2");
  await expect(active).toContainText("linear.app");
  await page.keyboard.press("Control+9");
  await expect(active).toContainText("Nova aba");
  await page.keyboard.press("Control+1");
  await expect(active).toContainText("github.com");
});

test("1.5: segurando o Ctrl, o seletor mostra as abas e soltar confirma", async ({ page }) => {
  await go(page, "github.com");
  await page.keyboard.press("Control+t");
  await go(page, "linear.app");
  await page.keyboard.press("Control+t");
  await go(page, "figma.com");
  await page.keyboard.down("Control");
  await page.keyboard.press("Tab");
  const switcher = page.getByRole("listbox", { name: "Alternar guias" });
  await expect(switcher).toBeVisible();
  await expect(switcher.getByRole("option")).toHaveCount(3);
  await expect(switcher.getByRole("option", { selected: true })).toContainText("linear.app");
  await page.keyboard.press("Tab");
  await expect(switcher.getByRole("option", { selected: true })).toContainText("github.com");
  await page.keyboard.up("Control");
  await expect(switcher).toHaveCount(0);
  await expect(page.locator(".tabs .browser-tab.active")).toContainText("github.com");

  // Esc cancela e fica na aba atual.
  await page.keyboard.down("Control");
  await page.keyboard.press("Tab");
  await expect(switcher).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.up("Control");
  await expect(switcher).toHaveCount(0);
  await expect(page.locator(".tabs .browser-tab.active")).toContainText("github.com");
});

test("1.5: Ctrl+D favorita, Alt+← volta", async ({ page }) => {
  await go(page, "linear.app/team");
  await page.keyboard.press("Control+d");
  await expect(page.getByLabel("Favoritar página")).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Concluído" }).click();
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

test("UX: abas pelo teclado (setas, Home/End, Delete) e nome acessível da fixada", async ({
  page,
}) => {
  await go(page, "github.com");
  await page.keyboard.press("Control+t");
  await go(page, "linear.app");
  await page.keyboard.press("Control+t");
  await go(page, "figma.com");
  await tabs(page).first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs(page).nth(1)).toBeFocused();
  await page.keyboard.press("End");
  await expect(tabs(page).nth(2)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(tabs(page).first()).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(tabs(page).nth(2)).toBeFocused();
  await page.keyboard.press("Delete");
  await expect(tabs(page)).toHaveCount(2);
  await expect(tabs(page).nth(1)).toBeFocused();

  await tabs(page)
    .first()
    .getByLabel(/^Fixar /)
    .click({ force: true });
  await expect(page.getByRole("tab", { name: "github.com, fixada" })).toBeVisible();
});

test("UX: Esc fecha o painel aberto; clique do meio fecha a aba", async ({ page }) => {
  await page.getByRole("button", { name: "Abrir Agzos Key" }).click();
  await expect(page.locator(".key-panel")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator(".key-panel")).toHaveCount(0);

  await page.keyboard.press("Control+t");
  await expect(tabs(page)).toHaveCount(2);
  await tabs(page).last().click({ button: "middle" });
  await expect(tabs(page)).toHaveCount(1);
});

test("guias verticais: sem a faixa de cima; o ⋯ vai para a toolbar", async ({ page }) => {
  await expect(page.locator(".titlebar")).toHaveCount(1);
  await page.locator(".tabs").click({ button: "right", position: { x: 700, y: 20 } });
  await page.getByText("Mostrar guias verticalmente").click();
  await expect(page.locator(".tabs-rail")).toBeVisible();
  await expect(page.locator(".titlebar")).toHaveCount(0);
  await page.locator(".toolbar").getByRole("button", { name: "Menu do Agzos" }).click();
  await expect(page.getByRole("menu", { name: "Menu do Agzos" })).toBeVisible();
});

test("1.5.1: arrastar reordena as guias (horizontal e vertical) e Ctrl+Shift+PgUp/PgDn move", async ({
  page,
}) => {
  await go(page, "github.com");
  await page.keyboard.press("Control+t");
  await go(page, "figma.com");
  await page.keyboard.press("Control+t");
  await go(page, "linear.app");
  const titles = async (selector = ".tabs .browser-tab") =>
    (await page.locator(selector).allTextContents()).map((text) => text.trim());
  await expect.poll(() => titles()).toEqual(["github.com", "figma.com", "linear.app"]);

  // Arrasta a última para o começo.
  const last = tabs(page).last();
  const first = await tabs(page).first().boundingBox();
  const box = await last.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x - 20, box!.y + box!.height / 2, { steps: 6 });
  await page.mouse.move(first!.x + 4, first!.y + first!.height / 2, { steps: 6 });
  // Linha de onde a guia vai cair.
  await expect(tabs(page).first()).toHaveClass(/drop-before/);
  await page.mouse.up();
  await expect.poll(() => titles()).toEqual(["linear.app", "github.com", "figma.com"]);
  // O arraste não troca a guia ativa (a ativa já era a arrastada).
  await expect(page.locator(".tabs .browser-tab.active")).toContainText("linear.app");

  // Esc cancela o arraste.
  const second = await tabs(page).nth(1).boundingBox();
  await page.mouse.move(second!.x + second!.width / 2, second!.y + second!.height / 2);
  await page.mouse.down();
  await page.mouse.move(second!.x + second!.width * 3, second!.y + second!.height / 2, {
    steps: 6,
  });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect.poll(() => titles()).toEqual(["linear.app", "github.com", "figma.com"]);

  // Teclado: a guia ativa anda uma posição.
  await page.keyboard.press("Control+Shift+PageDown");
  await expect.poll(() => titles()).toEqual(["github.com", "linear.app", "figma.com"]);
  await page.keyboard.press("Control+Shift+PageUp");
  await expect.poll(() => titles()).toEqual(["linear.app", "github.com", "figma.com"]);

  // Guias verticais: arrastar para baixo.
  await tabs(page).first().click({ button: "right" });
  await page.getByText("Mostrar guias verticalmente").click();
  const rail = ".rail-tabs .browser-tab";
  await expect.poll(() => titles(rail)).toEqual(["linear.app", "github.com", "figma.com"]);
  const top = await page.locator(rail).first().boundingBox();
  const bottom = await page.locator(rail).last().boundingBox();
  await page.mouse.move(top!.x + top!.width / 2, top!.y + top!.height / 2);
  await page.mouse.down();
  await page.mouse.move(top!.x + top!.width / 2, bottom!.y + bottom!.height - 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => titles(rail)).toEqual(["github.com", "figma.com", "linear.app"]);
});

test("1.5.2: menu do ⋯ com o essencial e página de configurações com seções e busca", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Menu do Agzos" }).click();
  const menu = page.getByRole("menu", { name: "Menu do Agzos" });
  await expect(menu.getByRole("menuitem", { name: /Nova guia/ }).first()).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /Histórico/ })).toBeVisible();
  // Tema pelo menu.
  await menu.getByRole("switch", { name: "Tema escuro" }).click();
  await expect(page.locator(".browser-stage")).not.toHaveClass(/dark/);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  // Ctrl+, abre a página completa.
  await page.keyboard.press("Control+,");
  await expect(omnibox(page)).toHaveValue("agzos://configuracoes");
  const nav = page.getByRole("navigation", { name: "Seções das configurações" });
  await expect(nav.getByRole("button", { name: "Aparência" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  // 4.5: na página, o tema é Escuro/Claro.
  await page.getByRole("radio", { name: "Escuro" }).click();
  await expect(page.locator(".browser-stage")).toHaveClass(/dark/);
  await nav.getByRole("button", { name: "Atalhos de teclado" }).click();
  await expect(page.getByText("Ctrl+Shift+P", { exact: true })).toBeVisible();
  // Busca em todas as seções, palavra por palavra.
  await page.getByLabel("Pesquise nas configurações").fill("atalho fav");
  await expect(page.getByText("Adicionar aos favoritos")).toBeVisible();
  await page.getByLabel("Pesquise nas configurações").fill("escudo");
  await expect(
    page.getByRole("switch", { name: "Bloquear anúncios e rastreadores" }),
  ).toBeVisible();
  await page.getByLabel("Pesquise nas configurações").fill("xyzzy");
  await expect(page.getByText(/Nenhuma configuração/)).toBeVisible();
  // Pela barra de endereço, com o nome em inglês também.
  await page.keyboard.press("Control+t");
  await go(page, "agzos://settings");
  await expect(omnibox(page)).toHaveValue("agzos://configuracoes");
});

test("1.5.2: pausar o mouse numa guia mostra a prévia", async ({ page }) => {
  await go(page, "github.com");
  await page.keyboard.press("Control+t");
  await tabs(page).first().hover();
  const card = page.getByRole("tooltip", { name: "Prévia: github.com" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("github.com");
  await page.mouse.move(700, 600);
  await expect(card).toHaveCount(0);
});

test("2.0: Ctrl+K, grupo de guias pelo menu, workspace novo e tela dividida (versão web)", async ({
  page,
}) => {
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  // Busca de comandos: acha "Nova guia anônima" sem acento e executa com Enter.
  await page.keyboard.press(`${mod}+k`);
  const search = page.getByRole("combobox", { name: "Buscar comandos" });
  await search.fill("guia anonima");
  await search.press("Enter");
  await expect(tabs(page)).toHaveCount(2);
  await expect(search).toHaveCount(0);

  // Clique direito na guia → novo grupo; o balão pede o nome.
  await tabs(page).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Adicionar guia a novo grupo" }).click();
  const name = page.getByRole("textbox", { name: "Nome do grupo" });
  await name.fill("Leituras");
  await name.press("Enter");
  await expect(page.locator(".tab-group-chip")).toHaveText("Leituras");

  // Tela dividida: nova guia ao lado; as duas aparecem.
  await page.keyboard.press(`${mod}+Alt+Shift+s`);
  await expect(page.locator("section.viewport.split")).toBeVisible();
  await expect(page.locator(".split-pane")).toHaveCount(2);
  await page.getByRole("separator", { name: /Divisória/ }).dblclick();
  await expect(page.locator(".split-pane")).toHaveCount(0);

  // Workspace novo: a barra só mostra as guias dele; voltar mostra as outras.
  const before = await tabs(page).count();
  await page.getByRole("button", { name: /^Workspace / }).click();
  await page.getByRole("button", { name: "Novo workspace" }).click();
  await page.getByRole("textbox", { name: "Nome do workspace" }).fill("Viagem");
  await page.getByRole("button", { name: "Criar workspace" }).click();
  await expect(page.getByRole("button", { name: "Workspace Viagem" })).toBeVisible();
  await expect(tabs(page)).toHaveCount(1);
  await page.getByRole("button", { name: "Workspace Viagem" }).click();
  await page
    .getByRole("button", { name: /Pessoal/ })
    .first()
    .click();
  await expect(tabs(page)).toHaveCount(before);

  // Painel lateral na web: explica que é do app.
  await page
    .getByRole("navigation", { name: "Painéis laterais" })
    .getByRole("button", { name: "Telegram" })
    .click();
  await expect(page.getByRole("complementary", { name: "Painel Telegram" })).toContainText(
    "app Agzos para computador",
  );
});

test("3.0: Discador ao lado do Início, com busca, cards salvos e reordenáveis", async ({
  page,
}) => {
  await page.getByRole("navigation", { name: "Páginas iniciais" }).getByText("Discador").click();
  await expect(omnibox(page)).toHaveValue("agzos://discador");
  const grid = page.getByRole("list", { name: "Sites do Discador" });
  await expect(grid.getByRole("button", { name: /^YouTube/ })).toBeVisible();

  // "+": card novo, salvo depois de recarregar.
  await page.getByRole("button", { name: "Adicionar site ao Discador" }).click();
  const dialog = page.getByRole("dialog", { name: "Novo site no Discador" });
  await dialog.getByLabel("Nome").fill("Exemplo");
  await dialog.getByLabel("URL").fill("example.com");
  await dialog.getByLabel("Categoria").fill("");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(grid.getByRole("button", { name: /^Exemplo/ })).toBeVisible();

  // Ctrl+Shift+← muda o card de lugar.
  const names = () => grid.locator(".dial-open strong").allTextContents();
  const before = await names();
  await grid.getByRole("button", { name: /^Exemplo/ }).focus();
  await page.keyboard.press("Control+Shift+ArrowLeft");
  // before termina em [..., "Reddit", "Exemplo", "Adicionar"].
  await expect.poll(names).toEqual([...before.slice(0, -3), "Exemplo", before.at(-3), "Adicionar"]);

  await reload(page);
  await expect(page.getByRole("button", { name: /^Exemplo/ })).toBeVisible();

  // Busca "Geral" filtra os cards; Enter abre o primeiro na própria guia.
  await page.getByLabel("Pesquisar no Discador").fill("exem");
  await expect(grid.locator(".dial-card")).toHaveCount(1);
  await page.getByLabel("Pesquisar no Discador").press("Enter");
  await expect(omnibox(page)).toHaveValue("https://example.com");
  await expect(tabs(page)).toHaveCount(1);

  // Volta ao Discador e pesquisa na web pelo seletor.
  await go(page, "agzos://discador");
  await page.getByRole("radio", { name: "Web" }).click();
  await page.getByLabel("Pesquisar na web").last().fill("agzos browser");
  await page.getByLabel("Pesquisar na web").last().press("Enter");
  await expect(omnibox(page)).toHaveValue(/duckduckgo\.com\/\?q=agzos/);

  // Início pelo atalho do topo.
  await go(page, "agzos://discador");
  await page.getByRole("navigation", { name: "Páginas iniciais" }).getByText("Início").click();
  await expect(omnibox(page)).toHaveValue("agzos://inicio");
});

test("3.0: barra lateral com os apps novos e GX Control com Hot Tabs Killer", async ({ page }) => {
  const bar = page.getByRole("navigation", { name: "Painéis laterais" });
  for (const name of ["WhatsApp", "ChatGPT", "Claude", "Gemini"]) {
    await expect(bar.getByRole("button", { name, exact: true })).toBeAttached();
  }
  // Os que não cabem na altura ficam na caixinha do "Mais" (3.1.1).
  await bar.getByRole("button", { name: /^Mais \d+ apps?$/ }).click();
  const more = page.getByRole("menu", { name: "Mais apps da barra lateral" });
  for (const name of ["YouTube", "Pinterest"]) {
    await expect(more.getByRole("menuitem", { name, exact: true })).toBeVisible();
  }
  await page.keyboard.press("Escape");
  await expect(more).toHaveCount(0);
  await go(page, "example.com");
  await page.getByRole("button", { name: "Nova aba", exact: true }).first().click();
  await expect(tabs(page)).toHaveCount(2);

  await bar.getByRole("button", { name: "GX Control" }).click();
  const panel = page.getByRole("complementary", { name: "GX Control" });
  await expect(panel).toContainText("Demonstração");
  await expect(panel.getByRole("figure", { name: /CPU/ })).toBeVisible();
  await panel.getByRole("switch", { name: "Ligar limitador de RAM" }).click();
  await expect(panel.getByRole("slider", { name: "Teto de memória" })).toBeEnabled();

  const list = panel.getByRole("list", { name: "Guias por uso" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await list.getByRole("button", { name: /Encerrar example\.com/ }).click();
  await expect(tabs(page)).toHaveCount(1);

  // O limitador fica salvo.
  await reload(page);
  await bar.getByRole("button", { name: "GX Control" }).click();
  await expect(page.getByRole("switch", { name: "Ligar limitador de RAM" })).toHaveAttribute(
    "aria-checked",
    "true",
  );

  // Ocultar a barra pelas configurações.
  await go(page, "agzos://configuracoes");
  await page.getByRole("switch", { name: "Barra lateral" }).first().click();
  await expect(bar).toHaveCount(0);
});

test("3.1.1: barra lateral recolhe o excedente na caixinha, que fecha ao escolher ou clicar fora", async ({
  page,
}) => {
  const bar = page.getByRole("navigation", { name: "Painéis laterais" });
  const more = bar.getByRole("button", { name: /^Mais \d+ apps?$/ });
  await expect(more).toBeVisible();
  // Nada da barra fica cortado ou com rolagem: o último item visível é o "Mais".
  const overflow = await bar.evaluate((nav) => nav.scrollHeight - nav.clientHeight);
  expect(overflow).toBeLessThanOrEqual(0);

  await more.click();
  const box = page.getByRole("menu", { name: "Mais apps da barra lateral" });
  await expect(box.getByRole("menuitem", { name: "Spotify" })).toBeVisible();
  // Clicar fora fecha.
  await page.locator(".start-page").click({ position: { x: 500, y: 300 } });
  await expect(box).toHaveCount(0);

  // Escolher um app abre o painel dele e fecha a caixinha; o "Mais" fica marcado.
  await more.click();
  await box.getByRole("menuitem", { name: "Spotify" }).click();
  await expect(box).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "Painel Spotify" })).toBeVisible();
  await expect(more).toHaveClass(/\bon\b/);

  // Janela mais alta: cabem mais apps (o "Mais" esconde menos).
  const hiddenBefore = Number((await more.getAttribute("aria-label"))?.match(/\d+/)?.[0]);
  await page.setViewportSize({ width: 1440, height: 1300 });
  await expect
    .poll(async () => {
      if (!(await more.count())) return 0;
      return Number((await more.getAttribute("aria-label"))?.match(/\d+/)?.[0]);
    })
    .toBeLessThan(hiddenBefore);
});

test("3.1.1: Adicionar da home usa o modal do Discador; Início marcado; categoria no Discador", async ({
  page,
}) => {
  const nav = page.getByRole("navigation", { name: "Páginas iniciais" });
  await expect(nav.getByRole("button", { name: "Início" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("button", { name: "Discador" })).not.toHaveAttribute(
    "aria-current",
    "page",
  );

  await page.getByRole("button", { name: "Adicionar atalho" }).click();
  const dialog = page.getByRole("dialog", { name: "Novo atalho na página inicial" });
  await expect(dialog.getByLabel("Prévia do card")).toBeVisible();
  // Endereço inválido não salva.
  await dialog.getByLabel("URL").fill("não é site");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog.getByRole("alert")).toContainText("site.com");
  await dialog.getByLabel("Nome").fill("Wiki");
  await dialog.getByLabel("URL").fill("https://pt.wikipedia.org/");
  await dialog.getByLabel("Categoria").fill("Estudos");
  await expect(dialog.getByLabel("Prévia do card")).toContainText("pt.wikipedia.org");
  await expect(dialog.getByLabel("Prévia do card")).toContainText("Estudos");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toHaveCount(0);
  const shortcut = page.locator(".quick-link").filter({ hasText: "Wiki" });
  await expect(shortcut).toBeVisible();
  // O ícone é o do site (pelo domínio), com a inicial só até carregar.
  await expect(shortcut.locator("img")).toHaveAttribute("src", /pt\.wikipedia\.org/);

  // Cancelar não grava nada.
  await page.getByRole("button", { name: "Adicionar atalho" }).click();
  await page.getByRole("dialog").getByLabel("URL").fill("cancelado.com");
  await page.getByRole("dialog").getByRole("button", { name: "Cancelar" }).click();
  await expect(page.locator(".quick-link").filter({ hasText: "cancelado" })).toHaveCount(0);

  await reload(page);
  await expect(page.locator(".quick-link").filter({ hasText: "Wiki" })).toBeVisible();

  // No Discador: card com categoria e o filtro por categoria.
  await nav.getByRole("button", { name: "Discador" }).click();
  await expect(nav.getByRole("button", { name: "Discador" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.getByRole("button", { name: "Adicionar site ao Discador" }).click();
  const dialDialog = page.getByRole("dialog", { name: "Novo site no Discador" });
  await dialDialog.getByLabel("URL").fill("news.ycombinator.com");
  await dialDialog.getByLabel("Categoria").fill("Notícias");
  await dialDialog.getByRole("button", { name: "Salvar" }).click();
  const grid = page.getByRole("list", { name: "Sites do Discador" });
  await page
    .getByRole("radiogroup", { name: "Categoria" })
    .getByRole("radio", { name: "Notícias" })
    .click();
  await expect(grid.locator(".dial-card:not(.add)")).toHaveCount(1);
  await expect(grid.locator(".dial-card:not(.add)")).toContainText("news.ycombinator.com");
  // Cards do Discador e ícones da barra tocam o tick no hover (marcados para o som).
  await expect(grid.locator(".dial-card").first()).toHaveAttribute("data-sound", "hover");
});

test("3.1.1: Configurações → Sons controla hover, teclado, tick e volume", async ({ page }) => {
  // Conta os sons tocados (o AudioContext real fica no lugar, só observado).
  await page.evaluate(() => {
    const original = AudioBufferSourceNode.prototype.start;
    (window as unknown as { played: number }).played = 0;
    AudioBufferSourceNode.prototype.start = function (...args) {
      (window as unknown as { played: number }).played += 1;
      return original.apply(this, args);
    };
  });
  const played = () => page.evaluate(() => (window as unknown as { played: number }).played);
  const search = page.getByLabel("Pesquisar na web");
  await search.click();
  await search.pressSequentially("abc", { delay: 60 });
  await expect.poll(played).toBeGreaterThanOrEqual(3);

  await go(page, "agzos://configuracoes");
  await page.getByRole("button", { name: "Sons" }).first().click();
  await expect(page.getByRole("switch", { name: "Sons da interface" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.getByRole("switch", { name: "Som do teclado" }).click();
  await expect(page.getByRole("switch", { name: "Som do teclado" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await page.getByRole("combobox").filter({ hasText: "Mecânico" }).selectOption("maquina");
  await page.getByLabel("Volume dos sons").fill("80");
  await expect(page.getByText("Volume: 80%")).toBeVisible();

  // Teclado desligado: digitar não toca mais.
  await go(page, "agzos://discador");
  const before = await played();
  await page.getByLabel("Pesquisar no Discador").pressSequentially("xyz", { delay: 60 });
  await page.waitForTimeout(200);
  expect(await played()).toBe(before);

  // Tudo desligado: nem o hover da barra toca.
  await go(page, "agzos://configuracoes");
  await page.getByRole("button", { name: "Sons" }).first().click();
  await page.getByRole("switch", { name: "Sons da interface" }).click();
  await expect(page.getByRole("switch", { name: "Som ao passar o mouse" })).toBeDisabled();
  await reload(page);
  await page.getByRole("button", { name: "Sons" }).first().click();
  await expect(page.getByRole("switch", { name: "Sons da interface" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
});

test("4.0: Agzos AI na web avisa que a Groq é só no app; Ctrl+Shift+A alterna", async ({
  page,
}) => {
  const panel = page.getByRole("complementary", { name: "Agzos AI" });
  await expect(panel).toContainText("só no app desktop");
  // Sem campo de chave na web (ela nunca fica no localStorage).
  await expect(panel.getByLabel("Chave da API Groq")).toHaveCount(0);
  await page.keyboard.press("Control+Shift+A");
  await expect(panel).toHaveCount(0);
  await page.keyboard.press("Control+Shift+A");
  await expect(panel).toBeVisible();
});

test("4.0: Configurações → Gestos liga/desliga e troca a ação; botão lateral volta", async ({
  page,
}) => {
  await go(page, "agzos://configuracoes");
  await page.getByRole("button", { name: "Gestos" }).first().click();
  const swipe = page.getByRole("switch", { name: "Deslizar dois dedos para a direita" });
  await expect(swipe).toHaveAttribute("aria-checked", "true");
  await page
    .getByLabel("Ação de Botão direito + arrastar ↓", { exact: true })
    .selectOption({ label: "Recarregar" });
  await swipe.click();
  await reload(page);
  await page.getByRole("button", { name: "Gestos" }).first().click();
  await expect(swipe).toHaveAttribute("aria-checked", "false");
  await expect(page.getByLabel("Ação de Botão direito + arrastar ↓", { exact: true })).toHaveValue(
    "reload",
  );
  // A pinça só liga e desliga (a ação é sempre o zoom).
  await expect(page.getByLabel("Ação de Pinça")).toHaveCount(0);

  // Botão lateral do mouse (XButton1) numa página interna volta para a anterior.
  await expect(omnibox(page)).toHaveValue("agzos://configuracoes");
  await page.locator(".settings-page").dispatchEvent("mouseup", { button: 3, bubbles: true });
  await expect(omnibox(page)).toHaveValue("agzos://inicio");
  await page
    .locator(".start-page, .viewport")
    .first()
    .dispatchEvent("mouseup", { button: 4, bubbles: true });
  await expect(omnibox(page)).toHaveValue("agzos://configuracoes");
});

test("4.0: terminal fica fora da web (sem node-pty) e sem entrada no menu", async ({ page }) => {
  await page.keyboard.press("Control+Alt+t");
  await expect(page.getByRole("region", { name: "Terminal" })).toHaveCount(0);
  await page.getByRole("button", { name: "Menu do Agzos" }).click();
  await expect(page.getByRole("menuitem", { name: /Agzos AI/ })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /^Terminal/ })).toHaveCount(0);
});

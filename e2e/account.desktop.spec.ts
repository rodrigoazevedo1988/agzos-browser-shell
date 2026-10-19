import { spawn, type ChildProcess } from "node:child_process";
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

// Conta Agzos: o servidor de verdade (services/accounts, bun) numa porta livre com banco
// temporário, e um "Google" falso local para o login do perfil. Nada sai para a internet.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let api: ChildProcess | null = null;
let apiUrl = "";
let google: http.Server;
let googleBase = "";
const work = fs.mkdtempSync(path.join(os.tmpdir(), "agzos-account-e2e-"));

test.beforeAll(async () => {
  test.setTimeout(60_000);
  api = spawn("bun", ["src/server.ts"], {
    cwd: path.join(root, "services", "accounts"),
    env: {
      ...process.env,
      PORT: "0",
      ACCOUNTS_DB: path.join(work, "accounts.db"),
      TRUST_PROXY: "0",
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  apiUrl = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("servidor de contas não subiu")), 20_000);
    let out = "";
    api!.stdout!.on("data", (chunk) => {
      out += String(chunk);
      const match = /ouvindo em (http:\/\/[^\s]+\/browser-api\/v1)/.exec(out);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]!);
      }
    });
    api!.on("exit", () => reject(new Error("servidor de contas saiu")));
  });

  // "Google": a página de login grava um cookie na sessão do perfil; o ListAccounts só
  // responde a conta quando esse cookie chega (prova que veio da partição do perfil).
  google = http.createServer((request, response) => {
    const url = request.url ?? "/";
    if (url.startsWith("/signin")) {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "set-cookie": "SID=perfil-e2e; Path=/; HttpOnly",
      });
      response.end("<!doctype html><title>Fazer login nas Contas do Google</title><h1>Google</h1>");
      return;
    }
    if (url.startsWith("/ListAccounts")) {
      const signedIn = String(request.headers.cookie ?? "").includes("SID=perfil-e2e");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify([
          "gaia.l.a.r",
          signedIn ? [["gaia.l.a", 1, "Teste E2E", "teste.e2e@gmail.com", null, 1, 1, 0]] : [],
        ]),
      );
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve) => google.listen(0, "127.0.0.1", resolve));
  googleBase = `http://127.0.0.1:${(google.address() as AddressInfo).port}`;
});

test.afterAll(() => {
  api?.kill();
  google?.close();
});

function shells(app: ElectronApplication) {
  return app.windows().filter((page) => page.url().includes("/dist/index.html"));
}

async function launch(profile: string): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch({
    args: ["--no-sandbox", root],
    cwd: root,
    env: {
      ...process.env,
      AGZOS_USER_DATA: profile,
      AGZOS_DOWNLOADS_DIR: path.join(profile, "Downloads"),
      AGZOS_FILTER_LISTS: JSON.stringify({ ads: [], privacy: [] }),
      AGZOS_ACCOUNT_URL: apiUrl,
      AGZOS_TEST_BASIC_KEYRING: "1",
      AGZOS_TEST_GOOGLE_URL: googleBase,
      AGZOS_TEST_PROFILE_PICKER: "1",
    },
  });
  const window = await app.firstWindow();
  await window.locator('.browser-stage[data-ready="true"]').waitFor();
  return { app, window };
}

async function go(window: Page, url: string) {
  const omnibox = window.getByLabel("Pesquisar ou digitar endereço");
  await omnibox.fill(url);
  await omnibox.press("Enter");
}

test("conta Agzos: cria conta, códigos, recupera a senha, perfil Google e modal do início", async () => {
  test.setTimeout(120_000);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "agzos-e2e-"));
  const email = `ana.${Date.now()}@example.com`;
  let { app, window } = await launch(profile);
  try {
    await go(window, "agzos://conta");
    await expect(window.getByRole("heading", { name: "Conta Agzos" })).toBeVisible();

    // Criar conta: os 8 códigos aparecem uma vez.
    await window.getByRole("tab", { name: "Criar conta" }).click();
    const signup = window.getByRole("form", { name: "Criar conta" });
    await signup.getByLabel("Nome").fill("Ana Teste");
    await signup.getByLabel("E-mail").fill(email);
    await signup.getByLabel("Senha", { exact: true }).fill("senha-forte-123");
    await signup.getByLabel("Confirmar senha").fill("senha-forte-123");
    await signup.getByRole("button", { name: "Criar conta" }).click();
    const codes = window.getByTestId("recovery-codes").locator("code");
    await expect(codes).toHaveCount(8);
    const firstCode = (await codes.first().textContent())!.trim();
    expect(firstCode).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
    const continueButton = window.getByRole("button", { name: "Continuar" });
    await expect(continueButton).toBeDisabled();
    await window.getByLabel("Guardei os códigos num lugar seguro").check();
    await continueButton.click();
    await expect(window.getByRole("heading", { name: "Minha conta" })).toBeVisible();
    await expect(window.locator(".acct-me")).toContainText(email);
    // Os códigos não ficam na tela nem no arquivo da conta.
    expect(await window.content()).not.toContain(firstCode);
    const tokenFile = fs.readFileSync(path.join(profile, "agzos-account.bin"));
    expect(tokenFile.toString("latin1")).not.toContain(email);

    // Sair e recuperar a senha com um código.
    await window.getByRole("button", { name: "Sair" }).click();
    await window.getByRole("tab", { name: "Recuperar senha" }).click();
    const recover = window.getByRole("form", { name: "Recuperar senha" });
    await recover.getByLabel("E-mail").fill(email);
    await recover.getByLabel("Código de recuperação").fill(firstCode.toLowerCase());
    await recover.getByLabel("Nova senha", { exact: true }).fill("outra-senha-456");
    await recover.getByLabel("Confirmar nova senha").fill("outra-senha-456");
    await recover.getByRole("button", { name: "Redefinir senha" }).click();
    await expect(window.getByRole("status").filter({ hasText: "Senha redefinida" })).toBeVisible();

    // Entrar com a senha nova (a antiga não vale mais).
    const login = window.getByRole("form", { name: "Entrar" });
    await login.getByLabel("E-mail").fill(email);
    await login.getByLabel("Senha").fill("senha-forte-123");
    await login.getByRole("button", { name: "Entrar" }).click();
    await expect(login.getByRole("alert")).toContainText("incorretos");
    await login.getByLabel("Senha").fill("outra-senha-456");
    await login.getByRole("button", { name: "Entrar" }).click();
    await expect(window.getByRole("heading", { name: "Minha conta" })).toBeVisible();

    // Serviços Agzos: só logado; os premium aparecem travados no plano gratuito.
    await window.getByRole("button", { name: "Serviços Agzos" }).click();
    await expect(window.locator('[data-service="sync"]')).toContainText("Disponível no Premium");

    // Contas Google: perfil novo abre numa janela própria, na partição dele.
    await window.getByRole("button", { name: /^Contas Google/ }).click();
    await window.getByRole("button", { name: "Adicionar conta Google" }).click();
    await expect.poll(() => shells(app).length, { timeout: 15_000 }).toBe(2);
    await expect
      .poll(() =>
        app.evaluate(({ webContents }, base) => {
          const page = webContents
            .getAllWebContents()
            .find((contents) => contents.getURL().startsWith(`${base}/signin`));
          return page?.session.getStoragePath() ?? "";
        }, googleBase),
      )
      .toContain("agzos-profile-");
    // A conta foi lida pelo ListAccounts com o cookie do perfil, não da sessão padrão.
    const card = window.locator(".acct-profile");
    await expect(card).toContainText("teste.e2e@gmail.com", { timeout: 15_000 });
    await expect(card).toContainText("Teste E2E");
    const leaked = await app.evaluate(({ session }) =>
      session.defaultSession.cookies.get({ name: "SID" }).then((list) => list.length),
    );
    expect(leaked).toBe(0);
  } finally {
    await app.close();
  }

  // Reinício: com login e perfis, o modal "Escolha uma conta" abre e leva ao perfil.
  ({ app, window } = await launch(profile));
  try {
    const picker = window.getByRole("dialog", { name: "Escolha uma conta" });
    await expect(picker).toBeVisible({ timeout: 15_000 });
    await picker.getByRole("button", { name: /Teste E2E/ }).click();
    await expect(picker).toBeHidden();
    await expect.poll(() => shells(app).length, { timeout: 15_000 }).toBe(2);
    const profileShell = shells(app).find((page) => page !== window)!;
    await profileShell.locator('.browser-stage[data-ready="true"]').waitFor();
    await expect(profileShell.getByRole("button", { name: /^Perfil Teste E2E/ })).toBeVisible();
    // Sair da conta trava os perfis: a janela do perfil fecha.
    await go(window, "agzos://conta");
    await window.getByRole("button", { name: "Sair" }).click();
    await expect.poll(() => shells(app).length, { timeout: 15_000 }).toBe(1);
    await expect(window.locator(".acct-info")).toContainText("1 conta Google guardada");
  } finally {
    await app.close();
  }
});

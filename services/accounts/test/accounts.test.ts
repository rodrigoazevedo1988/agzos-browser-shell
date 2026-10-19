import { describe, expect, it } from "bun:test";
import { API_PREFIX, createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";
import {
  newRecoveryCode,
  normalizeEmail,
  normalizeRecoveryCode,
  passwordProblem,
} from "../src/security.ts";

function setup(config = {}) {
  let clock = 1_700_000_000_000;
  const db = openDatabase(":memory:");
  const app = createApp({ db, config, now: () => clock });
  const call = async (
    method: string,
    route: string,
    body?: unknown,
    {
      token,
      ip = "10.0.0.1",
      headers = {},
    }: { token?: string; ip?: string; headers?: Record<string, string> } = {},
  ) => {
    const init: RequestInit = {
      method,
      headers: {
        "X-Agzos-Client": "agzos-browser/test",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    };
    const response = await app.handle(
      new Request(`http://127.0.0.1${API_PREFIX}${route}`, init),
      ip,
    );
    // Respostas JSON livres: cada teste olha os campos que importam.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  };
  return { db, call, advance: (ms: number) => (clock += ms) };
}

const PASSWORD = "senha-forte-123";
const signup = (call: ReturnType<typeof setup>["call"], email = "Ana@Example.com ") =>
  call("POST", "/signup", { name: "  Ana  Souza ", email, password: PASSWORD, device: "teste" });

describe("regras puras", () => {
  it("normaliza e-mail", () => {
    expect(normalizeEmail("  Ana@EXAMPLE.com ")).toBe("ana@example.com");
    expect(normalizeEmail("sem-arroba")).toBeNull();
    expect(normalizeEmail(42)).toBeNull();
  });
  it("política de senha", () => {
    expect(passwordProblem("curta")).toContain("10");
    expect(passwordProblem("aaaaaaaaaaaa")).not.toBeNull();
    expect(passwordProblem("ana@example.com", "ana@example.com")).not.toBeNull();
    expect(passwordProblem(PASSWORD)).toBeNull();
  });
  it("códigos de recuperação aceitam hífen, minúsculas e O/I/L trocados", () => {
    const code = newRecoveryCode();
    expect(code).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
    expect(normalizeRecoveryCode(code.toLowerCase())).toBe(code.replace("-", ""));
    expect(normalizeRecoveryCode("O0IL1-23456")).toBe("00111" + "23456");
    expect(normalizeRecoveryCode("curto")).toBeNull();
  });
});

describe("contas", () => {
  it("cria conta, devolve 8 códigos uma vez e entra", async () => {
    const { call } = setup();
    const created = await signup(call);
    expect(created.status).toBe(201);
    expect(created.body["recoveryCodes"]).toHaveLength(8);
    expect(created.body["user"]).toEqual({
      name: "Ana Souza",
      email: "ana@example.com",
      plan: "free",
      createdAt: expect.any(Number),
    });
    const me = await call("GET", "/me", undefined, { token: created.body["token"] });
    expect(me.status).toBe(200);
    expect(me.body["recoveryCodesLeft"]).toBe(8);
    expect(JSON.stringify(me.body)).not.toContain('recoveryCodes"');
  });

  it("recusa e-mail repetido com mensagem genérica e senha fraca", async () => {
    const { call } = setup();
    await signup(call);
    const again = await signup(call, "ana@example.com");
    expect(again.status).toBe(409);
    expect(again.body["error"].code).toBe("signup_failed");
    const weak = await call("POST", "/signup", {
      name: "B",
      email: "b@example.com",
      password: "123",
    });
    expect(weak.status).toBe(400);
    expect(weak.body["error"].code).toBe("weak_password");
  });

  it("login errado não diz se o e-mail existe", async () => {
    const { call } = setup();
    await signup(call);
    const wrong = await call("POST", "/login", {
      email: "ana@example.com",
      password: "errada-errada",
    });
    const missing = await call("POST", "/login", {
      email: "zé@example.com",
      password: "errada-errada",
    });
    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(wrong.body).toEqual(missing.body);
  });

  it("login, refresh, logout e sessão expirada", async () => {
    const { call, advance } = setup({ sessionTtlMs: 1000 * 60 });
    await signup(call);
    const login = await call("POST", "/login", { email: "ANA@example.com", password: PASSWORD });
    expect(login.status).toBe(200);
    const token = login.body["token"];
    const refreshed = await call("POST", "/refresh", undefined, { token });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body["token"]).not.toBe(token);
    expect((await call("GET", "/me", undefined, { token })).status).toBe(401);
    const fresh = refreshed.body["token"];
    expect((await call("POST", "/logout", undefined, { token: fresh })).status).toBe(200);
    expect((await call("GET", "/me", undefined, { token: fresh })).status).toBe(401);
    const other = await call("POST", "/login", { email: "ana@example.com", password: PASSWORD });
    advance(61_000);
    expect((await call("GET", "/me", undefined, { token: other.body["token"] })).status).toBe(401);
  });

  it("bloqueia o e-mail depois de 5 senhas erradas, mesmo com a senha certa", async () => {
    const { call, advance } = setup();
    await signup(call);
    for (let i = 0; i < 5; i += 1) {
      const attempt = await call(
        "POST",
        "/login",
        { email: "ana@example.com", password: "errada-errada" },
        { ip: `10.0.1.${i}` },
      );
      expect(attempt.status).toBe(401);
    }
    const locked = await call(
      "POST",
      "/login",
      { email: "ana@example.com", password: PASSWORD },
      { ip: "10.0.2.1" },
    );
    expect(locked.status).toBe(429);
    // E-mail inexistente bloqueia igual (não revela quem tem conta).
    for (let i = 0; i < 5; i += 1) {
      await call("POST", "/login", { email: "nao@example.com", password: "errada-errada" });
    }
    const ghost = await call("POST", "/login", {
      email: "nao@example.com",
      password: "errada-errada",
    });
    expect(ghost.status).toBe(429);
    expect(ghost.body).toEqual(locked.body);
    advance(16 * 60 * 1000);
    const after = await call("POST", "/login", { email: "ana@example.com", password: PASSWORD });
    expect(after.status).toBe(200);
  });

  it("limite por IP", async () => {
    const { call } = setup();
    let last = 0;
    for (let i = 0; i < 31; i += 1) {
      last = (
        await call("POST", "/login", { email: `u${i}@example.com`, password: "errada-errada" })
      ).status;
    }
    expect(last).toBe(429);
  });

  it("recupera a senha com um código (uma vez só) e derruba as sessões", async () => {
    const { call } = setup();
    const created = await signup(call);
    const codes = created.body["recoveryCodes"] as string[];
    const recovered = await call("POST", "/password/recover", {
      email: "ana@example.com",
      recoveryCode: codes[2]!.toLowerCase(),
      newPassword: "outra-senha-456",
    });
    expect(recovered.status).toBe(200);
    expect(recovered.body["recoveryCodesLeft"]).toBe(7);
    expect((await call("GET", "/me", undefined, { token: created.body["token"] })).status).toBe(
      401,
    );
    expect(
      (await call("POST", "/login", { email: "ana@example.com", password: PASSWORD })).status,
    ).toBe(401);
    expect(
      (await call("POST", "/login", { email: "ana@example.com", password: "outra-senha-456" }))
        .status,
    ).toBe(200);
    const reused = await call("POST", "/password/recover", {
      email: "ana@example.com",
      recoveryCode: codes[2],
      newPassword: "mais-uma-senha-789",
    });
    expect(reused.status).toBe(400);
    expect(reused.body["error"].code).toBe("invalid_recovery");
  });

  it("bloqueia a recuperação depois de 5 códigos errados", async () => {
    const { call } = setup();
    const created = await signup(call);
    for (let i = 0; i < 5; i += 1) {
      await call(
        "POST",
        "/password/recover",
        { email: "ana@example.com", recoveryCode: "AAAAA-AAAAA", newPassword: "outra-senha-456" },
        { ip: `10.1.0.${i}` },
      );
    }
    const locked = await call(
      "POST",
      "/password/recover",
      {
        email: "ana@example.com",
        recoveryCode: created.body["recoveryCodes"][0],
        newPassword: "outra-senha-456",
      },
      { ip: "10.2.0.1" },
    );
    expect(locked.status).toBe(429);
  });

  it("troca a senha (mantém só esta sessão), gera códigos novos e exclui a conta", async () => {
    const { call } = setup();
    const created = await signup(call);
    const token = created.body["token"];
    const second = await call("POST", "/login", { email: "ana@example.com", password: PASSWORD });
    const bad = await call(
      "POST",
      "/password/change",
      { currentPassword: "errada-errada", newPassword: "nova-senha-000" },
      { token },
    );
    expect(bad.status).toBe(403);
    const changed = await call(
      "POST",
      "/password/change",
      { currentPassword: PASSWORD, newPassword: "nova-senha-000" },
      { token },
    );
    expect(changed.status).toBe(200);
    expect((await call("GET", "/me", undefined, { token: second.body["token"] })).status).toBe(401);
    const codes = await call(
      "POST",
      "/recovery-codes/regenerate",
      { password: "nova-senha-000" },
      { token },
    );
    expect(codes.body["recoveryCodes"]).toHaveLength(8);
    const old = await call("POST", "/password/recover", {
      email: "ana@example.com",
      recoveryCode: created.body["recoveryCodes"][0],
      newPassword: "outra-senha-456",
    });
    expect(old.status).toBe(400);
    expect(
      (await call("DELETE", "/account", { password: "errada-errada" }, { token })).status,
    ).toBe(403);
    expect(
      (await call("DELETE", "/account", { password: "nova-senha-000" }, { token })).status,
    ).toBe(200);
    expect((await call("GET", "/me", undefined, { token })).status).toBe(401);
    expect(
      (await call("POST", "/login", { email: "ana@example.com", password: "nova-senha-000" }))
        .status,
    ).toBe(401);
  });

  it("serviços: exige login e marca os premium como bloqueados no plano free", async () => {
    const { call } = setup();
    expect((await call("GET", "/services")).status).toBe(401);
    const created = await signup(call);
    const services = await call("GET", "/services", undefined, { token: created.body["token"] });
    expect(services.status).toBe(200);
    expect(services.body["plan"]).toBe("free");
    const list = services.body["services"] as { plan: string; locked: boolean }[];
    expect(list.length).toBeGreaterThan(0);
    for (const item of list) expect(item.locked).toBe(item.plan === "premium");
  });

  it("recusa origem de navegador, falta do header do cliente, corpo grande e não-JSON", async () => {
    const { call } = setup();
    const fromPage = await call(
      "POST",
      "/login",
      { email: "a@b.co", password: PASSWORD },
      { headers: { Origin: "https://evil.example" } },
    );
    expect(fromPage.status).toBe(403);
    const noClient = await call(
      "POST",
      "/login",
      { email: "a@b.co", password: PASSWORD },
      { headers: { "X-Agzos-Client": "" } },
    );
    expect(noClient.status).toBe(403);
    const big = await call("POST", "/signup", {
      name: "x".repeat(20_000),
      email: "a@b.co",
      password: PASSWORD,
    });
    expect(big.status).toBe(413);
    const text = await call("POST", "/login", undefined, {
      headers: { "Content-Type": "text/plain" },
    });
    expect(text.status).toBe(415);
    expect((await call("GET", "/health")).status).toBe(200);
    expect((await call("GET", "/nada")).status).toBe(404);
  });
});

import { describe, expect, it } from "bun:test";
import { API_PREFIX, createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";
import { AVATAR_MAX_BYTES, avatarTypeOf, avatarUploadProblem } from "../src/avatar.ts";
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
  // Corpo binário (foto de perfil): bytes crus com o Content-Type do tipo da imagem.
  const raw = async (
    method: string,
    route: string,
    bytes: Uint8Array | null,
    {
      token,
      ip = "10.0.0.1",
      type = "image/png",
      headers = {},
    }: { token?: string; ip?: string; type?: string | null; headers?: Record<string, string> } = {},
  ) => {
    const init: RequestInit = {
      method,
      headers: {
        "X-Agzos-Client": "agzos-browser/test",
        ...(type ? { "Content-Type": type } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      ...(bytes ? { body: bytes } : {}),
    };
    return app.handle(new Request(`http://127.0.0.1${API_PREFIX}${route}`, init), ip);
  };
  return { db, call, raw, advance: (ms: number) => (clock += ms) };
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

// Foto de perfil: bytes mínimos com a assinatura certa (o servidor só confere o início).
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const WEBP = new Uint8Array([
  ...new TextEncoder().encode("RIFF"),
  4,
  0,
  0,
  0,
  ...new TextEncoder().encode("WEBPVP8 "),
]);

describe("foto de perfil: regras", () => {
  it("reconhece o tipo pela assinatura, não pelo nome", () => {
    expect(avatarTypeOf(PNG)).toBe("image/png");
    expect(avatarTypeOf(JPEG)).toBe("image/jpeg");
    expect(avatarTypeOf(WEBP)).toBe("image/webp");
    expect(avatarTypeOf(new TextEncoder().encode("GIF89a..."))).toBeNull();
    expect(avatarTypeOf(new Uint8Array())).toBeNull();
  });
  it("aceita só PNG, JPEG e WebP, com o tipo declarado igual ao conteúdo", () => {
    expect(avatarUploadProblem("image/png", PNG)).toBeNull();
    expect(avatarUploadProblem("image/jpeg; charset=x", JPEG)).toBeNull();
    expect(avatarUploadProblem("image/gif", PNG)?.code).toBe("bad_type");
    expect(avatarUploadProblem(null, PNG)?.code).toBe("bad_type");
    expect(avatarUploadProblem("image/png", JPEG)?.code).toBe("bad_image");
    expect(avatarUploadProblem("image/png", new Uint8Array())?.code).toBe("bad_request");
    const huge = new Uint8Array(AVATAR_MAX_BYTES + 1);
    huge.set(PNG);
    expect(avatarUploadProblem("image/png", huge)?.code).toBe("too_large");
  });
});

describe("foto de perfil: API", () => {
  it("envia, lê de volta e aparece em /me e no login", async () => {
    const { call, raw } = setup();
    const created = await signup(call);
    const token = created.body["token"] as string;
    expect(created.body["avatarVersion"]).toBeNull();
    const sent = await raw("PUT", "/avatar", PNG, { token });
    expect(sent.status).toBe(200);
    const version = ((await sent.json()) as { avatarVersion: number }).avatarVersion;
    expect(version).toEqual(expect.any(Number));
    const photo = await raw("GET", "/avatar", null, { token });
    expect(photo.status).toBe(200);
    expect(photo.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await photo.arrayBuffer())).toEqual(PNG);
    const me = await call("GET", "/me", undefined, { token });
    expect(me.body["avatarVersion"]).toBe(version);
    expect(me.body["user"]).not.toHaveProperty("avatar");
    const login = await call("POST", "/login", { email: "ana@example.com", password: PASSWORD });
    expect(login.body["avatarVersion"]).toBe(version);
  });

  it("troca a foto com versão nova e apaga com versão nula", async () => {
    const { call, raw, advance } = setup();
    const token = (await signup(call)).body["token"] as string;
    const first = (await (await raw("PUT", "/avatar", PNG, { token })).json()) as {
      avatarVersion: number;
    };
    advance(1000);
    const second = (await (
      await raw("PUT", "/avatar", JPEG, { token, type: "image/jpeg" })
    ).json()) as {
      avatarVersion: number;
    };
    expect(second.avatarVersion).toBeGreaterThan(first.avatarVersion);
    const swapped = await raw("GET", "/avatar", null, { token });
    expect(swapped.headers.get("content-type")).toBe("image/jpeg");
    const removed = await raw("DELETE", "/avatar", null, { token, type: null });
    expect(removed.status).toBe(200);
    expect(((await removed.json()) as { avatarVersion: unknown }).avatarVersion).toBeNull();
    expect((await raw("GET", "/avatar", null, { token })).status).toBe(404);
    advance(1000);
    // Foto nova depois de apagar: a versão não volta a um número usado antes.
    const again = (await (await raw("PUT", "/avatar", PNG, { token })).json()) as {
      avatarVersion: number;
    };
    expect(again.avatarVersion).toBeGreaterThan(second.avatarVersion);
  });

  it("recusa conteúdo que não é a imagem declarada, tipo errado e corpo grande", async () => {
    const { call, raw } = setup();
    const token = (await signup(call)).body["token"] as string;
    const fake = await raw("PUT", "/avatar", JPEG, { token });
    expect(fake.status).toBe(400);
    expect(((await fake.json()) as { error: { code: string } }).error.code).toBe("bad_image");
    const gif = await raw("PUT", "/avatar", PNG, { token, type: "image/gif" });
    expect(gif.status).toBe(400);
    const big = new Uint8Array(AVATAR_MAX_BYTES + 1);
    big.set(PNG);
    const tooBig = await raw("PUT", "/avatar", big, { token });
    expect(tooBig.status).toBe(413);
    const noType = await raw("PUT", "/avatar", PNG, { token, type: null });
    expect(noType.status).toBe(400);
    expect((await raw("GET", "/avatar", null, { token })).status).toBe(404);
  });

  it("exige sessão e o header do cliente", async () => {
    const { call, raw } = setup();
    const token = (await signup(call)).body["token"] as string;
    expect((await raw("PUT", "/avatar", PNG)).status).toBe(401);
    expect((await raw("GET", "/avatar", null)).status).toBe(401);
    expect((await raw("DELETE", "/avatar", null)).status).toBe(401);
    expect(
      (await raw("PUT", "/avatar", PNG, { token, headers: { "X-Agzos-Client": "" } })).status,
    ).toBe(403);
    expect(
      (await raw("PUT", "/avatar", PNG, { token, headers: { Origin: "https://evil.example" } }))
        .status,
    ).toBe(403);
  });

  it("limita trocas por conta (30 por hora)", async () => {
    const { call, raw } = setup();
    const token = (await signup(call)).body["token"] as string;
    for (let i = 0; i < 30; i += 1) {
      expect((await raw("PUT", "/avatar", PNG, { token })).status).toBe(200);
    }
    expect((await raw("PUT", "/avatar", PNG, { token })).status).toBe(429);
    expect((await raw("DELETE", "/avatar", null, { token, type: null })).status).toBe(429);
    expect((await raw("GET", "/avatar", null, { token })).status).toBe(200);
  });

  it("apaga a foto junto com a conta e registra a migração 2", async () => {
    const { db, call, raw } = setup();
    const token = (await signup(call)).body["token"] as string;
    await raw("PUT", "/avatar", PNG, { token });
    const count = () => (db.query("SELECT COUNT(*) AS n FROM avatars").get() as { n: number }).n;
    expect(count()).toBe(1);
    const gone = await call("DELETE", "/account", { password: PASSWORD }, { token });
    expect(gone.status).toBe(200);
    expect(count()).toBe(0);
    const versions = db.query("SELECT version FROM schema_migrations ORDER BY version").all();
    expect(versions).toEqual([{ version: 1 }, { version: 2 }]);
  });
});

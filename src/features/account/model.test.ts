import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

import { resolveInput } from "@/features/browser/omnibox-input";

import {
  ACCOUNT_URL,
  PROFILE_COLORS,
  emailProblem,
  initialsOf,
  isPhotoUrl,
  passwordProblem,
  passwordStrength,
  recoveryCodesFileName,
  recoveryCodesText,
} from "./model";

const require = createRequire(import.meta.url);
const profiles = require("../../../electron/google-profiles.cjs");
const account = require("../../../electron/agzos-account.cjs");

describe("conta: regras da casca", () => {
  it("valida e-mail e senha como o servidor", () => {
    expect(emailProblem("ana@example.com")).toBeNull();
    expect(emailProblem("ana")).not.toBeNull();
    expect(passwordProblem("curta")).toContain("10");
    expect(passwordProblem("aaaaaaaaaaaa")).not.toBeNull();
    expect(passwordProblem("ana@example.com", "Ana@example.com")).not.toBeNull();
    expect(passwordProblem("senha-forte-123")).toBeNull();
    expect(passwordStrength("")).toBe(0);
    expect(passwordStrength("Senha-Forte-1234")).toBeGreaterThanOrEqual(3);
  });

  it("arquivo dos códigos", () => {
    const date = new Date("2026-10-18T12:00:00Z");
    const text = recoveryCodesText(["AAAAA-BBBBB", "CCCCC-DDDDD"], "ana@example.com", date);
    expect(text).toContain("ana@example.com");
    expect(text).toContain(" 1. AAAAA-BBBBB");
    expect(text).toContain(" 2. CCCCC-DDDDD");
    expect(recoveryCodesFileName(date)).toBe("agzos-codigos-de-recuperacao-2026-10-18.txt");
  });

  it("iniciais do avatar", () => {
    expect(initialsOf("Ana Souza")).toBe("AS");
    expect(initialsOf("ana.souza@gmail.com")).toBe("AS");
    expect(initialsOf("rodrigo")).toBe("R");
    expect(initialsOf("")).toBe("?");
  });

  it("foto da conta: só data: de imagem", () => {
    expect(isPhotoUrl("data:image/png;base64,iVBORw0KGgo=")).toBe(true);
    expect(isPhotoUrl("data:image/jpeg;base64,/9j/4AAQ")).toBe(true);
    expect(isPhotoUrl("https://example.com/a.png")).toBe(false);
    expect(isPhotoUrl("data:text/html;base64,PGI+")).toBe(false);
    expect(isPhotoUrl("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
    expect(isPhotoUrl("data:image/png;base64,AAAA<script>")).toBe(false);
    expect(isPhotoUrl(null)).toBe(false);
  });

  it("agzos://conta é uma página da casca", () => {
    expect(resolveInput(ACCOUNT_URL, "duckduckgo")).toEqual({
      title: "Conta Agzos",
      url: ACCOUNT_URL,
      kind: "internal",
    });
    expect(resolveInput("agzos://account", "duckduckgo")?.url).toBe(ACCOUNT_URL);
  });
});

describe("perfis Google (main)", () => {
  it("cores iguais nos dois lados e partição por perfil", () => {
    expect([...PROFILE_COLORS]).toEqual(profiles.COLORS);
    expect(profiles.partitionOf("abcdef1234567890")).toBe("persist:agzos-profile-abcdef1234567890");
    expect(profiles.partitionOf("../x")).toBeNull();
  });

  it("lista no meta: adiciona, atualiza, remove e marca a pasta para apagar", () => {
    const meta = new Map<string, unknown>();
    const database = {
      getMeta: (key: string) => meta.get(key),
      setMeta: (key: string, value: unknown) => meta.set(key, value),
    };
    let seq = 0;
    let clock = 1000;
    const store = profiles.createProfileStore({
      database,
      newId: () => `profile${String(++seq).padStart(4, "0")}`,
      now: () => (clock += 10),
    });
    const a = store.add({ label: "Trabalho" });
    const b = store.add({});
    expect(a.label).toBe("Trabalho");
    expect(b.label).toBe("Nova conta Google");
    expect(b.color).not.toBe(a.color);
    store.update(a.id, { lastUsed: 99_999, email: "ANA@Gmail.com", avatar: "javascript:x" });
    expect(store.get(a.id).email).toBe("ana@gmail.com");
    expect(store.get(a.id).avatar).toBeNull();
    expect(store.list()[0].id).toBe(a.id);
    expect(store.remove(b.id)).toBe(true);
    expect(store.pendingPurge()).toEqual([b.id]);
    expect(
      profiles.purgeDirs(
        [`agzos-profile-${b.id}`, `agzos-profile-${a.id}`, "x"],
        store.pendingPurge(),
      ),
    ).toEqual([`agzos-profile-${b.id}`]);
    store.clearPurge([b.id]);
    expect(store.pendingPurge()).toEqual([]);
    const again = profiles.createProfileStore({ database });
    expect(again.list().map((item: { id: string }) => item.id)).toEqual([a.id]);
  });

  it("lê a resposta do ListAccounts sem avaliar nada", () => {
    const text = JSON.stringify([
      "gaia.l.a.r",
      [
        [
          "gaia.l.a",
          1,
          "Ana Souza",
          "ana@gmail.com",
          "https://lh3.googleusercontent.com/a/x=s48-c",
          1,
          1,
          0,
        ],
      ],
    ]);
    expect(profiles.parseListAccounts(text)).toEqual([
      {
        email: "ana@gmail.com",
        name: "Ana Souza",
        photo: "https://lh3.googleusercontent.com/a/x=s48-c",
      },
    ]);
    expect(profiles.parseListAccounts('["gaia.l.a.r",[]]')).toEqual([]);
    expect(profiles.parseListAccounts("<html>")).toEqual([]);
    const evil = JSON.stringify([
      "gaia.l.a.r",
      [["gaia.l.a", 1, "X", "x@y.com", "https://evil.example/p"]],
    ]);
    expect(profiles.parseListAccounts(evil)[0].photo).toBeNull();
  });

  it("ListAccounts com várias contas: todas, sem repetir e-mail, sem as inválidas", () => {
    const text = JSON.stringify([
      "gaia.l.a.r",
      [
        ["gaia.l.a", 1, "Ana", "ana@gmail.com", null, 1, 1, 0],
        ["gaia.l.a", 2, "Bia", "BIA@gmail.com", null, 1, 1, 0],
        ["gaia.l.a", 3, "Ana de novo", "ana@gmail.com", null, 1, 1, 0],
        ["gaia.l.a", 4, "Lixo", "não é e-mail", null, 1, 1, 0],
        "não é lista",
      ],
    ]);
    expect(profiles.parseListAccounts(text).map((item: { email: string }) => item.email)).toEqual([
      "ana@gmail.com",
      "bia@gmail.com",
    ]);
  });

  it("filtro de cookies: só SID, 1PSID, 3PSID e SAPISID do Google, adição ou remoção", () => {
    const google = (name: string, domain = ".google.com") => ({ name, domain, removed: true });
    for (const name of ["SID", "__Secure-1PSID", "__Secure-3PSID", "SAPISID"]) {
      expect(profiles.isWatchedCookie(google(name))).toBe(true);
    }
    expect(profiles.isWatchedCookie(google("SIDCC"))).toBe(false);
    expect(profiles.isWatchedCookie(google("__Secure-1PSIDCC"))).toBe(false);
    expect(profiles.isWatchedCookie(google("NID"))).toBe(false);
    expect(profiles.isWatchedCookie(google("SID", "exemplo.com"))).toBe(false);
    expect(profiles.isWatchedCookie(null)).toBe(false);
    expect(profiles.hasSignedInCookie([{ name: "NID" }, { name: "SID" }])).toBe(true);
    expect(profiles.hasSignedInCookie([{ name: "__Secure-1PSID" }])).toBe(true);
    expect(profiles.hasSignedInCookie([{ name: "SAPISID" }, { name: "SIDCC" }])).toBe(false);
    expect(profiles.hasSignedInCookie(undefined)).toBe(false);
  });

  it("motivo da leitura: sem sessão é signed-out; com sessão e sem conta, read-failed", () => {
    const [one] = profiles.parseListAccounts(
      JSON.stringify(["gaia.l.a.r", [["gaia.l.a", 1, "Ana", "ana@gmail.com", null]]]),
    );
    expect(profiles.readOutcome({ signedIn: false, accounts: [one] })).toBe("signed-out");
    expect(profiles.readOutcome({ signedIn: true, accounts: [] })).toBe("read-failed");
    expect(profiles.readOutcome({ signedIn: true, accounts: [one] })).toBe("ok");
  });

  it("intervalo mínimo: leitura forçada a cada 10 s; normal só com conta, a cada 60 s", () => {
    const now = 100_000;
    // Forçada: espera o que falta desde a última leitura; passou de 10 s, lê já.
    expect(profiles.readWaitMs({ force: true, now, lastReadAt: now - 4_000 })).toBe(6_000);
    expect(profiles.readWaitMs({ force: true, now, lastReadAt: now - 10_000 })).toBe(0);
    expect(profiles.readWaitMs({ force: true, now, lastReadAt: 0 })).toBe(0);
    // Normal com conta: 60 s. Sem conta: sempre lê.
    expect(profiles.readWaitMs({ hasEmail: true, now, lastReadAt: now - 1_000 })).toBe(59_000);
    expect(profiles.readWaitMs({ hasEmail: false, now, lastReadAt: now - 1_000 })).toBe(0);
  });

  it("escolha da conta: a atual; senão a que acabou de entrar; senão a primeira", () => {
    const ana = { email: "ana@gmail.com", name: "Ana", photo: null };
    const bia = { email: "bia@gmail.com", name: "Bia", photo: null };
    // A atual ainda na lista ganha, mesmo que a outra esteja na frente.
    expect(
      profiles.chooseAccount({ accounts: [bia, ana], current: "ana@gmail.com", previous: [] }),
    ).toBe(ana);
    // Atual saiu da lista: a que não estava na leitura anterior.
    expect(
      profiles.chooseAccount({
        accounts: [ana, bia],
        current: "zé@gmail.com",
        previous: [ana.email],
      }),
    ).toBe(bia);
    // Sem atual e sem novidade: a primeira.
    expect(
      profiles.chooseAccount({
        accounts: [bia, ana],
        current: "",
        previous: [ana.email, bia.email],
      }),
    ).toBe(bia);
    expect(profiles.chooseAccount({ accounts: [], current: "ana@gmail.com" })).toBeNull();
  });

  it("título da janela do perfil: nome, travessão e o app", () => {
    expect(profiles.profileWindowTitle("Trabalho")).toBe("Trabalho — Agzos Browser");
    expect(profiles.profileWindowTitle("")).toBe("Conta Google — Agzos Browser");
  });

  it("modal do início: só logado, com perfis, fora de PWA e de teste", () => {
    const list = [{ id: "a" }];
    const base = { loggedIn: true, profiles: list, pref: null, env: {}, packaged: true };
    expect(profiles.shouldShowPicker(base)).toBe(true);
    expect(profiles.shouldShowPicker({ ...base, loggedIn: false })).toBe(false);
    expect(profiles.shouldShowPicker({ ...base, profiles: [] })).toBe(false);
    expect(profiles.shouldShowPicker({ ...base, pwaHost: true })).toBe(false);
    expect(profiles.shouldShowPicker({ ...base, pref: { showOnStart: false } })).toBe(false);
    expect(profiles.shouldShowPicker({ ...base, env: { AGZOS_USER_DATA: "/tmp/x" } })).toBe(false);
    expect(
      profiles.shouldShowPicker({
        ...base,
        packaged: false,
        env: { AGZOS_USER_DATA: "/tmp/x", AGZOS_TEST_PROFILE_PICKER: "1" },
      }),
    ).toBe(true);
  });
});

describe("conta Agzos (main)", () => {
  it("a casca só vê nome, e-mail e plano", () => {
    const state = account.publicState({
      token: "segredo",
      user: { name: "Ana", email: "ana@example.com", plan: "premium", extra: 1 },
    });
    expect(state).toEqual({
      loggedIn: true,
      name: "Ana",
      email: "ana@example.com",
      plan: "premium",
      avatar: null,
    });
    expect(JSON.stringify(state)).not.toContain("segredo");
    expect(account.publicState(null).loggedIn).toBe(false);
    expect(account.codesOf(["AAAAA-BBBBB"])).toEqual(["AAAAA-BBBBB"]);
    expect(account.codesOf(["<b>"])).toBeNull();
  });

  it("guarda o token cifrado e sai quando o servidor recusa a sessão", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agzos-account-"));
    const safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (text: string) => Buffer.from(`enc:${text}`),
      decryptString: (buffer: Buffer) => buffer.toString().slice(4),
    };
    const calls: { url: string; init: RequestInit }[] = [];
    let meStatus = 200;
    const reply = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    const fetch = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith("/login")) {
        return reply(200, {
          token: "tok_abcdefghijklmnopqrstuvwxyz",
          user: { name: "Ana", email: "ana@example.com", plan: "free" },
          recoveryCodesLeft: 8,
        });
      }
      if (url.endsWith("/me")) {
        return meStatus === 200
          ? reply(200, { user: { name: "Ana", email: "ana@example.com", plan: "free" } })
          : reply(401, { error: { code: "unauthorized", message: "Sessão expirada." } });
      }
      return reply(404, {});
    };
    const changes: unknown[] = [];
    const client = account.createAgzosAccount({
      userDataDir: dir,
      safeStorage,
      fetch,
      baseUrl: "http://127.0.0.1:1/browser-api/v1",
      onChange: (state: unknown) => changes.push(state),
    });
    const result = await client.login({ email: "ana@example.com", password: "senha-forte-123" });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain("tok_");
    expect(fs.readFileSync(path.join(dir, account.TOKEN_FILE), "utf8")).toMatch(/^enc:/);
    expect((calls[0]!.init.headers as Record<string, string>)["X-Agzos-Client"]).toMatch(
      /^agzos-browser\//,
    );
    const reloaded = account.createAgzosAccount({
      userDataDir: dir,
      safeStorage,
      fetch,
      baseUrl: "http://x",
    });
    expect(reloaded.state().loggedIn).toBe(true);
    meStatus = 401;
    await reloaded.verify();
    expect(reloaded.state().loggedIn).toBe(false);
    expect(fs.existsSync(path.join(dir, account.TOKEN_FILE))).toBe(false);
    const noKeyring = account.createAgzosAccount({
      userDataDir: dir,
      safeStorage: { isEncryptionAvailable: () => false },
      fetch,
    });
    expect((await noKeyring.login({ email: "a@b.co", password: "x" })).code).toBe("keyring");
    expect(changes.length).toBeGreaterThan(0);
  });
});

describe("foto da conta (main)", () => {
  const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const pngBytes = (fill = 7) => Buffer.from([...PNG_HEAD, ...new Array(24).fill(fill)]);
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  // Imagem com a forma do NativeImage: registra o recorte e a redução feitos.
  const fakeImage = (width: number, height: number) => {
    const log: string[] = [];
    const make = (w: number, h: number) => ({
      isEmpty: () => false,
      getSize: () => ({ width: w, height: h }),
      crop: (rect: { x: number; y: number; width: number; height: number }) => {
        log.push(`crop ${rect.x},${rect.y},${rect.width}x${rect.height}`);
        return make(rect.width, rect.height);
      },
      resize: (opts: { width: number; height: number }) => {
        log.push(`resize ${opts.width}x${opts.height}`);
        return make(opts.width, opts.height);
      },
      toPNG: () => pngBytes(),
    });
    return { image: make(width, height), log };
  };

  it("recorta pelo centro, reduz a 256 e recusa o que não é imagem", () => {
    const { image, log } = fakeImage(300, 200);
    const png = account.squareAvatarPng(image);
    expect(log).toEqual(["crop 50,0,200x200", "resize 256x256"]);
    expect(account.imageMimeOf(png)).toBe("image/png");
    expect(account.squareAvatarPng({ isEmpty: () => true })).toBeNull();
    expect(account.imageMimeOf(Buffer.from("GIF89a"))).toBeNull();
    expect(account.imageMimeOf(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
  });

  it("envia a foto, guarda em cache, troca quando o servidor muda e apaga ao sair", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agzos-avatar-"));
    const safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (text: string) => Buffer.from(`enc:${text}`),
      decryptString: (buffer: Buffer) => buffer.toString().slice(4),
    };
    const ana = { name: "Ana", email: "ana@example.com", plan: "free" };
    const server: { avatarVersion: number | null; photo: Buffer | null; calls: string[] } = {
      avatarVersion: null,
      photo: null,
      calls: [],
    };
    const fetch = async (url: string, init: RequestInit) => {
      const route = new URL(url).pathname.replace("/browser-api/v1", "");
      const method = init.method ?? "GET";
      server.calls.push(`${method} ${route}`);
      if (route === "/login") {
        return reply(200, {
          token: "tok_abcdefghijklmnopqrstuvwxyz",
          user: ana,
          recoveryCodesLeft: 8,
          avatarVersion: server.avatarVersion,
        });
      }
      if (route === "/me") {
        return reply(200, { user: ana, recoveryCodesLeft: 8, avatarVersion: server.avatarVersion });
      }
      if (route === "/avatar" && method === "PUT") {
        server.photo = Buffer.from(init.body as Uint8Array);
        server.avatarVersion = 1_700_000_000_000;
        return reply(200, { avatarVersion: server.avatarVersion });
      }
      if (route === "/avatar" && method === "GET") {
        if (!server.photo) return reply(404, { error: { code: "not_found", message: "x" } });
        return new Response(new Uint8Array(server.photo), {
          status: 200,
          headers: { "Content-Type": "image/png" },
        });
      }
      if (route === "/avatar" && method === "DELETE") {
        server.photo = null;
        server.avatarVersion = null;
        return reply(200, { ok: true, avatarVersion: null });
      }
      return reply(404, {});
    };
    const client = account.createAgzosAccount({
      userDataDir: dir,
      safeStorage,
      fetch,
      baseUrl: "http://127.0.0.1:1/browser-api/v1",
    });
    const avatarFile = path.join(dir, account.AVATAR_FILE);
    const dataUrl = (bytes: Buffer) => `data:image/png;base64,${bytes.toString("base64")}`;

    expect((await client.login({ email: ana.email, password: "senha-forte-123" })).ok).toBe(true);
    expect(client.state().avatar).toBeNull();

    const { image } = fakeImage(256, 256);
    const sent = await client.changeAvatar(image);
    expect(sent.ok).toBe(true);
    expect(sent.state.avatar).toBe(dataUrl(pngBytes()));
    expect(fs.existsSync(avatarFile)).toBe(true);
    expect(JSON.stringify(sent)).not.toContain("tok_");

    // Outro aparelho trocou a foto: o próximo /me baixa a nova.
    server.photo = pngBytes(9);
    server.avatarVersion = 1_800_000_000_000;
    const fresh = await client.me();
    expect(server.calls).toContain("GET /avatar");
    expect(fresh.state.avatar).toBe(dataUrl(pngBytes(9)));

    // Foto apagada no servidor: some daqui também.
    server.photo = null;
    server.avatarVersion = null;
    expect((await client.me()).state.avatar).toBeNull();
    expect(fs.existsSync(avatarFile)).toBe(false);

    await client.changeAvatar(fakeImage(256, 256).image);
    expect(client.state().avatar).not.toBeNull();
    await client.logout();
    expect(client.state().loggedIn).toBe(false);
    expect(client.state().avatar).toBeNull();
    expect(fs.existsSync(avatarFile)).toBe(false);
  });

  it("sem login não envia foto", async () => {
    const os = await import("node:os");
    const path = await import("node:path");
    const fs = await import("node:fs");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agzos-avatar-"));
    const client = account.createAgzosAccount({
      userDataDir: dir,
      safeStorage: { isEncryptionAvailable: () => true },
      fetch: async () => {
        throw new Error("não deveria chamar a rede");
      },
    });
    const sent = await client.changeAvatar(fakeImage(256, 256).image);
    expect(sent).toEqual({ ok: false, error: expect.any(String) });
    expect(client.state().avatar).toBeNull();
  });
});

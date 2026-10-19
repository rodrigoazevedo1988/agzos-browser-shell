import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

import { resolveInput } from "@/features/browser/omnibox-input";

import {
  ACCOUNT_URL,
  PROFILE_COLORS,
  emailProblem,
  initialsOf,
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
    expect(profiles.parseListAccounts(text)).toEqual({
      email: "ana@gmail.com",
      name: "Ana Souza",
      photo: "https://lh3.googleusercontent.com/a/x=s48-c",
    });
    expect(profiles.parseListAccounts('["gaia.l.a.r",[]]')).toBeNull();
    expect(profiles.parseListAccounts("<html>")).toBeNull();
    const evil = JSON.stringify([
      "gaia.l.a.r",
      [["gaia.l.a", 1, "X", "x@y.com", "https://evil.example/p"]],
    ]);
    expect(profiles.parseListAccounts(evil)?.photo).toBeNull();
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

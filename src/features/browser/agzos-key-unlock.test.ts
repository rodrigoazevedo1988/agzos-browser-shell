import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const electronDir = path.join(root, "electron");

const keyModule = require(path.join(electronDir, "agzos-key.cjs")) as {
  AUTH_STRING: string;
  createAgzosKey: (opts: { userDataDir: string; safeStorage: unknown }) => {
    pair: (code: string, name?: string) => Promise<unknown>;
    unlock: (password: string) => Promise<unknown>;
    list: () => Promise<{ entries: { id: string; title: string }[] }>;
    state: () => { paired: boolean; unlocked: boolean; accountEmail: string | null };
  };
  _internals: {
    pbkdf2Key: (p: string, s: string, iters?: number, hash?: string) => Buffer;
    aesGcmEncrypt: (key: Buffer, text: string) => { iv: string; data: string };
  };
};

const { AUTH_STRING, createAgzosKey, _internals } = keyModule;

/** Cifra o auth-check como o Web Crypto (tag no fim), para o deriveKey validar. */
function authCheck(password: string, iterations?: number) {
  const salt = crypto.randomBytes(16).toString("base64");
  const key = _internals.pbkdf2Key(password, salt, iterations);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(AUTH_STRING, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const meta: Record<string, unknown> = {
    salt,
    authCheckIv: iv.toString("base64"),
    authCheckData: Buffer.concat([enc, tag]).toString("base64"),
  };
  if (iterations) meta["iterations"] = iterations;
  return { meta, key };
}

/** Entrada cifrada para o servidor devolver no sync (igual ao formato do cofre). */
function encEntry(key: Buffer, entry: Record<string, unknown>) {
  const { iv, data } = _internals.aesGcmEncrypt(key, JSON.stringify(entry));
  return { id: entry["id"], iv, data, version: 1, vaultId: "personal" };
}

type Account = {
  email: string;
  password: string;
  authMeta: Record<string, unknown>;
  key: Buffer;
  entries: Record<string, unknown>[];
};

const voceAuth = authCheck("senha-da-voce");
const arnaldoAuth = authCheck("senha-do-arnaldo");
const novaAuth = authCheck("senha-nova", 310_000); // conta com iterações diferentes

// Cada conta tem sua senha, seu auth-check e suas credenciais cifradas.
const ACCOUNTS: Record<string, Account> = {
  "token-voce": {
    email: "voce@agzos.com",
    password: "senha-da-voce",
    authMeta: voceAuth.meta,
    key: voceAuth.key,
    entries: [
      {
        id: "e1",
        title: "github.com",
        username: "voce",
        password: "p1",
        category: "Trabalho",
        updatedAt: 1,
      },
      {
        id: "e2",
        title: "figma.com",
        username: "voce",
        password: "p2",
        category: "Trabalho",
        updatedAt: 2,
      },
    ],
  },
  "token-arnaldo": {
    email: "arnaldo@agzos.com",
    password: "senha-do-arnaldo",
    authMeta: arnaldoAuth.meta,
    key: arnaldoAuth.key,
    entries: [
      {
        id: "a1",
        title: "notion.so",
        username: "arnaldo",
        password: "x1",
        category: "Pessoal",
        updatedAt: 1,
      },
    ],
  },
  "token-nova": {
    email: "nova@agzos.com",
    password: "senha-nova",
    authMeta: novaAuth.meta,
    key: novaAuth.key,
    entries: [],
  },
};

const TOKEN_OF: Record<string, string> = {
  VOCE: "token-voce",
  ARNALDO: "token-arnaldo",
  NOVA: "token-nova",
};

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const auth = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const json = (obj: unknown) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      if (req.url === "/api/integration/pair/claim") {
        const { pairingCode } = JSON.parse(body || "{}");
        const token = TOKEN_OF[pairingCode] ?? "token-voce";
        const acc = ACCOUNTS[token]!;
        json({
          deviceToken: token,
          accountEmail: acc.email,
          hasVault: true,
          authMeta: acc.authMeta,
        });
        return;
      }
      if (req.url === "/api/integration/vault/status") {
        const acc = ACCOUNTS[auth];
        if (!acc) {
          res.writeHead(401);
          res.end("{}");
          return;
        }
        json({ hasVault: true, accountEmail: acc.email, authMeta: acc.authMeta });
        return;
      }
      if (req.url === "/api/integration/vault/sync") {
        const acc = ACCOUNTS[auth];
        if (!acc) {
          res.writeHead(401);
          res.end("{}");
          return;
        }
        const { since } = JSON.parse(body || "{}");
        // O servidor só devolve as entradas "desde" o cursor: com since>0 vem vazio.
        const entries = since && since > 0 ? [] : acc.entries.map((e) => encEntry(acc.key, e));
        json({ entries, deletedIds: [], syncedAt: Date.now() });
        return;
      }
      res.writeHead(404);
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${port}`;
  process.env["AGZOS_KEY_URL"] = baseUrl;
});

afterAll(() => {
  delete process.env["AGZOS_KEY_URL"];
  server.close();
});

const tmpDirs: string[] = [];
function freshClient() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agzos-key-test-"));
  tmpDirs.push(dir);
  return createAgzosKey({ userDataDir: dir, safeStorage: null });
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("Agzos Key — desbloqueio por conta", () => {
  it("cada conta desbloqueia com a sua senha mestra", async () => {
    const voce = freshClient();
    await voce.pair("VOCE");
    await expect(voce.unlock("senha-da-voce")).resolves.toEqual({ unlocked: true });

    const arnaldo = freshClient();
    await arnaldo.pair("ARNALDO");
    await expect(arnaldo.unlock("senha-do-arnaldo")).resolves.toEqual({ unlocked: true });
  });

  it("rejeita a senha errada de cada conta", async () => {
    const voce = freshClient();
    await voce.pair("VOCE");
    await expect(voce.unlock("errada")).rejects.toThrow("invalid_master_password");
  });

  it("não recusa a senha certa de outra conta pareada no mesmo cliente (regressão do Arnaldo)", async () => {
    const client = freshClient();
    // 1) Você pareia e desbloqueia: authMeta da sua conta fica em memória.
    await client.pair("VOCE");
    await client.unlock("senha-da-voce");
    // 2) O Arnaldo pareia por cima (mesmo app/dispositivo) e desbloqueia com a SENHA DELE.
    await client.pair("ARNALDO");
    await expect(client.unlock("senha-do-arnaldo")).resolves.toEqual({ unlocked: true });
    expect(client.state().accountEmail).toBe("arnaldo@agzos.com");
  });

  it("desbloqueia conta com iterações de KDF diferentes (parâmetros do authMeta)", async () => {
    const client = freshClient();
    await client.pair("NOVA");
    await expect(client.unlock("senha-nova")).resolves.toEqual({ unlocked: true });
  });
});

describe("Agzos Key — lista do cofre não some", () => {
  it("list() devolve o cofre inteiro em TODA chamada (regressão: senhas sumindo)", async () => {
    const client = freshClient();
    await client.pair("VOCE");
    await client.unlock("senha-da-voce");

    const first = await client.list();
    expect(first.entries.map((e) => e.id).sort()).toEqual(["e1", "e2"]);

    // A 2ª chamada (refresh da casca) PRECISA trazer tudo de novo, não um delta vazio.
    const second = await client.list();
    expect(second.entries.map((e) => e.id).sort()).toEqual(["e1", "e2"]);

    const third = await client.list();
    expect(third.entries).toHaveLength(2);
  });
});

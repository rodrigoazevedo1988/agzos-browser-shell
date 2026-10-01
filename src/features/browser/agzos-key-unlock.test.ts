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
    state: () => { paired: boolean; unlocked: boolean; accountEmail: string | null };
  };
  _internals: { pbkdf2Key: (p: string, s: string) => Buffer };
};

const { AUTH_STRING, createAgzosKey, _internals } = keyModule;

/** Cifra o auth-check como o Web Crypto (tag no fim), para o deriveKey validar. */
function authCheck(password: string) {
  const salt = crypto.randomBytes(16).toString("base64");
  const key = _internals.pbkdf2Key(password, salt);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(AUTH_STRING, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    salt,
    authCheckIv: iv.toString("base64"),
    authCheckData: Buffer.concat([enc, tag]).toString("base64"),
  };
}

// Duas contas, cada uma com sua senha mestra e seu auth-check.
const ACCOUNTS: Record<
  string,
  { email: string; password: string; authMeta: ReturnType<typeof authCheck> }
> = {
  "token-voce": {
    email: "voce@agzos.com",
    password: "senha-da-voce",
    authMeta: authCheck("senha-da-voce"),
  },
  "token-arnaldo": {
    email: "arnaldo@agzos.com",
    password: "senha-do-arnaldo",
    authMeta: authCheck("senha-do-arnaldo"),
  },
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
        // O código de pareamento diz qual conta (token) devolver.
        const { pairingCode } = JSON.parse(body || "{}");
        const token = pairingCode === "ARNALDO" ? "token-arnaldo" : "token-voce";
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
        // Fonte da verdade: o auth-check é SEMPRE o da conta dona do token atual.
        json({ hasVault: true, accountEmail: acc.email, authMeta: acc.authMeta });
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
});

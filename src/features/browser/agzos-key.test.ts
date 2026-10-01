import crypto from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

// A senha errada também passa pelo Argon2id real (64 MiB), que leva alguns segundos.
vi.setConfig({ testTimeout: 60_000 });

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const electronDir = path.join(root, "electron");

const keyModule = require(path.join(electronDir, "agzos-key.cjs")) as {
  AUTH_STRING: string;
  PBKDF2_ITERS: number;
  _internals: {
    pbkdf2Key: (password: string, saltB64: string) => Buffer;
    aesGcmDecrypt: (key: Buffer, ivB64: string, dataB64: string) => string;
    aesGcmEncrypt: (key: Buffer, plaintext: string) => { iv: string; data: string };
    deriveKey: (
      password: string,
      meta: { salt: string; authCheckIv: string; authCheckData: string },
    ) => Promise<Buffer>;
    decryptEntry: (key: Buffer, e: { iv: string; data: string }) => Record<string, unknown>;
    encryptEntry: (
      key: Buffer,
      entry: Record<string, unknown>,
      deviceId: string,
    ) => { id: string; iv: string; data: string; version: number; vaultId: string };
  };
};

const { AUTH_STRING, PBKDF2_ITERS, _internals } = keyModule;

/**
 * Reproduz a cifragem do Agzos Key (Web Crypto): PBKDF2 100k SHA-256 -> AES-256-GCM, com
 * o tag de autenticação de 16 bytes CONCATENADO ao fim do ciphertext. É assim que o
 * SubtleCrypto do navegador entrega os dados; o cliente do main precisa decifrar isso.
 */
function webCryptoStyleEncrypt(key: Buffer, plaintext: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag(); // tag no FIM (formato Web Crypto)
  return {
    iv: iv.toString("base64"),
    data: Buffer.concat([enc, tag]).toString("base64"),
  };
}

describe("Agzos Key — compatibilidade de cripto", () => {
  it("usa PBKDF2 com 100000 iterações", () => {
    expect(PBKDF2_ITERS).toBe(100_000);
  });

  it("decifra o que o Web Crypto cifra (tag no fim)", () => {
    const salt = crypto.randomBytes(16).toString("base64");
    const key = _internals.pbkdf2Key("senha-mestra-forte", salt);
    const { iv, data } = webCryptoStyleEncrypt(key, "mensagem secreta ✅");
    expect(_internals.aesGcmDecrypt(key, iv, data)).toBe("mensagem secreta ✅");
  });

  it("cifra num formato que decifra de volta (round-trip)", () => {
    const salt = crypto.randomBytes(16).toString("base64");
    const key = _internals.pbkdf2Key("outra-senha", salt);
    const { iv, data } = _internals.aesGcmEncrypt(key, "round-trip");
    expect(_internals.aesGcmDecrypt(key, iv, data)).toBe("round-trip");
  });

  it("valida a senha mestra pelo auth-check e rejeita a errada", async () => {
    const salt = crypto.randomBytes(16).toString("base64");
    const correctKey = _internals.pbkdf2Key("senha-certa", salt);
    const check = webCryptoStyleEncrypt(correctKey, AUTH_STRING);
    const meta = { salt, authCheckIv: check.iv, authCheckData: check.data };

    // Senha certa: deriva a chave sem erro.
    await expect(_internals.deriveKey("senha-certa", meta)).resolves.toEqual(correctKey);
    // Senha errada: auth-check falha (com PBKDF2 e com Argon2id).
    await expect(_internals.deriveKey("senha-errada", meta)).rejects.toThrow(
      "invalid_master_password",
    );
  });

  it("faz round-trip de uma entrada do cofre (encrypt -> decrypt)", () => {
    const salt = crypto.randomBytes(16).toString("base64");
    const key = _internals.pbkdf2Key("master", salt);
    const entry = {
      id: "e1",
      title: "GitHub",
      username: "eu@exemplo.com",
      password: "senha-forte",
      url: "https://github.com",
      category: "Login",
      updatedAt: 1700000000000,
    };
    const enc = _internals.encryptEntry(key, entry, "device-1");
    expect(enc.id).toBe("e1");
    expect(enc.vaultId).toBe("personal");
    expect(enc.version).toBe(1);
    const back = _internals.decryptEntry(key, enc);
    expect(back).toEqual(entry);
  });
});

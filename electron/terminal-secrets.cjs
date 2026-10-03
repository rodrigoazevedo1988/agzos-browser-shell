// Chaves de API das ferramentas de IA do terminal (4.1): ANTHROPIC_API_KEY, OPENAI_API_KEY…
// Ficam só cifradas pelo safeStorage em <userData>/terminal-secrets.bin e só entram no
// ambiente dos shells (createTerminals extraEnv). A casca vê apenas quais nomes existem.

const fs = require("node:fs");

const NAME_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const MAX_SECRETS = 40;
/** Variáveis que mudariam o comportamento do sistema ou do shell: nunca viram segredo. */
const RESERVED = new Set([
  "PATH",
  "HOME",
  "SHELL",
  "USER",
  "TERM",
  "ZDOTDIR",
  "PSMODULEPATH",
  "COMSPEC",
  "SYSTEMROOT",
  "LD_PRELOAD",
  "DYLD_INSERT_LIBRARIES",
  "NODE_OPTIONS",
]);

function validName(name) {
  return typeof name === "string" && NAME_RE.test(name) && !RESERVED.has(name.toUpperCase());
}

function createSecrets({ file, safeStorage }) {
  const available = () => {
    try {
      return Boolean(safeStorage?.isEncryptionAvailable());
    } catch {
      return false;
    }
  };

  function read() {
    if (!available()) return {};
    try {
      const value = JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  function write(values) {
    fs.writeFileSync(file, safeStorage.encryptString(JSON.stringify(values)), { mode: 0o600 });
  }

  return {
    /** Só os nomes (nunca os valores). */
    names() {
      return Object.keys(read()).filter(validName).sort();
    },
    encryption: available,
    set(name, value) {
      const secret = typeof value === "string" ? value.trim() : "";
      if (!validName(name)) return { ok: false, error: "name" };
      if (!secret || secret.length > 4096 || /[\r\n\0]/.test(secret)) {
        return { ok: false, error: "value" };
      }
      if (!available()) return { ok: false, error: "insecure" };
      const values = read();
      if (!(name in values) && Object.keys(values).length >= MAX_SECRETS) {
        return { ok: false, error: "limit" };
      }
      try {
        write({ ...values, [name]: secret });
      } catch {
        return { ok: false, error: "storage" };
      }
      return { ok: true };
    },
    remove(name) {
      const values = read();
      if (!(name in values)) return { ok: true };
      delete values[name];
      try {
        write(values);
      } catch {
        return { ok: false, error: "storage" };
      }
      return { ok: true };
    },
    /** Ambiente das sessões (main → node-pty). */
    env() {
      const result = {};
      for (const [name, value] of Object.entries(read())) {
        if (validName(name) && typeof value === "string") result[name] = value;
      }
      return result;
    },
  };
}

module.exports = { createSecrets, validName };

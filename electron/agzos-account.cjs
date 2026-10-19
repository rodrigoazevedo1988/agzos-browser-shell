// Conta Agzos: cliente da API própria (services/accounts, servida em
// https://agzosagency.com.br/browser-api/v1). Roda só no processo principal.
// - O token de sessão fica cifrado pelo safeStorage em <userData>/agzos-account.bin
//   (recusado sem chaveiro do sistema) e nunca vai para a casca, para logs ou para os
//   arquivos de estado: a casca só recebe { loggedIn, name, email, plan }.
// - Códigos de recuperação passam pela casca uma única vez (para o usuário guardar) e não
//   ficam gravados aqui.

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_BASE_URL = "https://agzosagency.com.br/browser-api/v1";
const TOKEN_FILE = "agzos-account.bin";
const TIMEOUT_MS = 15_000;
// Token com mais de 7 dias é trocado por um novo no início (validade de 30 dias).
const REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const PLANS = new Set(["free", "premium"]);

const MESSAGES = {
  keyring:
    "Este computador não tem um chaveiro do sistema disponível; o Agzos não guarda o login sem ele.",
  offline: "Não foi possível falar com o servidor do Agzos. Confira a internet e tente de novo.",
  invalid: "Resposta inválida do servidor do Agzos.",
  loggedOut: "Entre na sua conta Agzos primeiro.",
};

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value, max = 256) => (typeof value === "string" ? value.slice(0, max) : "");

/** Usuário como a casca pode ver: só nome, e-mail e plano. */
function publicUser(user) {
  if (!isObject(user)) return null;
  const email = text(user.email, 254);
  if (!email) return null;
  return {
    name: text(user.name, 80),
    email,
    plan: PLANS.has(user.plan) ? user.plan : "free",
  };
}

/** Estado para a casca (nunca o token). */
function publicState(stored, extra = {}) {
  const user = stored ? publicUser(stored.user) : null;
  return {
    loggedIn: Boolean(stored?.token && user),
    name: user?.name ?? "",
    email: user?.email ?? "",
    plan: user?.plan ?? "free",
    ...extra,
  };
}

/** Códigos de recuperação da resposta: lista de textos curtos, ou null. */
function codesOf(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) return null;
  const codes = value.filter((code) => typeof code === "string" && /^[0-9A-Z-]{6,20}$/.test(code));
  return codes.length === value.length ? codes : null;
}

/** Serviços Agzos: só os campos conhecidos, com tamanho limitado. */
function servicesOf(value) {
  if (!isObject(value) || !Array.isArray(value.services)) return null;
  return {
    plan: PLANS.has(value.plan) ? value.plan : "free",
    services: value.services
      .filter((item) => isObject(item) && typeof item.id === "string")
      .slice(0, 50)
      .map((item) => ({
        id: text(item.id, 40),
        name: text(item.name, 80),
        description: text(item.description, 300),
        plan: PLANS.has(item.plan) ? item.plan : "free",
        status: item.status === "available" ? "available" : "soon",
        locked: item.locked === true,
      })),
  };
}

function createAgzosAccount({
  userDataDir,
  safeStorage,
  fetch,
  baseUrl = DEFAULT_BASE_URL,
  device = "",
  clientVersion = "0",
  onChange = () => {},
  now = Date.now,
}) {
  const tokenFile = path.join(userDataDir, TOKEN_FILE);
  let stored = null;
  let loaded = false;

  const encryptionAvailable = () => {
    try {
      return Boolean(safeStorage?.isEncryptionAvailable());
    } catch {
      return false;
    }
  };

  function load() {
    if (loaded) return stored;
    loaded = true;
    if (!encryptionAvailable()) return null;
    try {
      const data = JSON.parse(safeStorage.decryptString(fs.readFileSync(tokenFile)));
      if (isObject(data) && typeof data.token === "string" && publicUser(data.user)) {
        stored = { token: data.token, user: data.user, savedAt: Number(data.savedAt) || 0 };
      }
    } catch {
      stored = null;
    }
    return stored;
  }

  function save(next) {
    stored = next;
    loaded = true;
    if (!next) {
      fs.rmSync(tokenFile, { force: true });
    } else {
      fs.mkdirSync(userDataDir, { recursive: true });
      fs.writeFileSync(tokenFile, safeStorage.encryptString(JSON.stringify(next)), {
        mode: 0o600,
      });
    }
    onChange(publicState(stored));
  }

  /** Chamada à API: { ok, status, data } ou { ok:false, error } (sem lançar). */
  async function request(method, route, body, { auth = false } = {}) {
    const headers = { "X-Agzos-Client": `agzos-browser/${clientVersion}` };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth) {
      const token = load()?.token;
      if (!token) return { ok: false, status: 401, error: MESSAGES.loggedOut };
      headers.Authorization = `Bearer ${token}`;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response;
    try {
      response = await fetch(`${baseUrl}${route}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
        cache: "no-store",
        redirect: "error",
      });
    } catch {
      return { ok: false, status: 0, error: MESSAGES.offline };
    } finally {
      clearTimeout(timer);
    }
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!response.ok) {
      const message = isObject(data?.error) ? text(data.error.message, 300) : "";
      // Sessão recusada pelo servidor: sai daqui também (os dados locais ficam).
      if (auth && response.status === 401) save(null);
      return {
        ok: false,
        status: response.status,
        code: isObject(data?.error) ? text(data.error.code, 40) : "",
        error: message || MESSAGES.invalid,
      };
    }
    return { ok: true, status: response.status, data: isObject(data) ? data : {} };
  }

  const failure = (result) => ({ ok: false, error: result.error, code: result.code ?? "" });

  function keep(data) {
    if (typeof data.token !== "string" || !publicUser(data.user)) return false;
    save({ token: data.token, user: data.user, savedAt: now() });
    return true;
  }

  const needsKeyring = () =>
    encryptionAvailable() ? null : { ok: false, error: MESSAGES.keyring, code: "keyring" };

  return {
    state() {
      return publicState(load(), { available: encryptionAvailable() });
    },
    isLoggedIn() {
      return publicState(load()).loggedIn;
    },

    async signup({ name, email, password } = {}) {
      const blocked = needsKeyring();
      if (blocked) return blocked;
      const result = await request("POST", "/signup", {
        name: text(name, 200),
        email: text(email, 300),
        password: text(password, 512),
        device,
      });
      if (!result.ok) return failure(result);
      const recoveryCodes = codesOf(result.data.recoveryCodes);
      if (!recoveryCodes || !keep(result.data)) return { ok: false, error: MESSAGES.invalid };
      return { ok: true, state: publicState(stored), recoveryCodes };
    },

    async login({ email, password } = {}) {
      const blocked = needsKeyring();
      if (blocked) return blocked;
      const result = await request("POST", "/login", {
        email: text(email, 300),
        password: text(password, 512),
        device,
      });
      if (!result.ok) return failure(result);
      if (!keep(result.data)) return { ok: false, error: MESSAGES.invalid };
      const left = Number(result.data.recoveryCodesLeft);
      return {
        ok: true,
        state: publicState(stored),
        recoveryCodesLeft: Number.isFinite(left) ? left : null,
      };
    },

    async logout() {
      if (load()?.token) await request("POST", "/logout", undefined, { auth: true });
      if (stored) save(null);
      return { ok: true, state: publicState(null) };
    },

    /** No início: confere a sessão (e troca o token antigo). Offline, fica como está. */
    async verify() {
      if (!load()?.token) return publicState(null);
      const result = await request("GET", "/me", undefined, { auth: true });
      if (result.ok && publicUser(result.data.user)) {
        if (now() - (stored?.savedAt ?? 0) > REFRESH_AFTER_MS) {
          const refreshed = await request("POST", "/refresh", undefined, { auth: true });
          if (refreshed.ok) keep(refreshed.data);
        } else if (stored) {
          save({ ...stored, user: result.data.user });
        }
      }
      return publicState(load());
    },

    async me() {
      const result = await request("GET", "/me", undefined, { auth: true });
      if (!result.ok) return failure(result);
      if (stored && publicUser(result.data.user)) save({ ...stored, user: result.data.user });
      const left = Number(result.data.recoveryCodesLeft);
      return {
        ok: true,
        state: publicState(stored),
        recoveryCodesLeft: Number.isFinite(left) ? left : null,
      };
    },

    async changePassword({ currentPassword, newPassword } = {}) {
      const result = await request(
        "POST",
        "/password/change",
        { currentPassword: text(currentPassword, 512), newPassword: text(newPassword, 512) },
        { auth: true },
      );
      return result.ok ? { ok: true } : failure(result);
    },

    async recover({ email, recoveryCode, newPassword } = {}) {
      const result = await request("POST", "/password/recover", {
        email: text(email, 300),
        recoveryCode: text(recoveryCode, 40),
        newPassword: text(newPassword, 512),
      });
      if (!result.ok) return failure(result);
      const left = Number(result.data.recoveryCodesLeft);
      return { ok: true, recoveryCodesLeft: Number.isFinite(left) ? left : null };
    },

    async regenerateCodes({ password } = {}) {
      const result = await request(
        "POST",
        "/recovery-codes/regenerate",
        { password: text(password, 512) },
        { auth: true },
      );
      if (!result.ok) return failure(result);
      const recoveryCodes = codesOf(result.data.recoveryCodes);
      return recoveryCodes ? { ok: true, recoveryCodes } : { ok: false, error: MESSAGES.invalid };
    },

    async deleteAccount({ password } = {}) {
      const result = await request(
        "DELETE",
        "/account",
        { password: text(password, 512) },
        { auth: true },
      );
      if (!result.ok) return failure(result);
      save(null);
      return { ok: true, state: publicState(null) };
    },

    async services() {
      const result = await request("GET", "/services", undefined, { auth: true });
      if (!result.ok) return failure(result);
      const data = servicesOf(result.data);
      return data ? { ok: true, ...data } : { ok: false, error: MESSAGES.invalid };
    },
  };
}

module.exports = {
  DEFAULT_BASE_URL,
  TOKEN_FILE,
  createAgzosAccount,
  publicState,
  publicUser,
  codesOf,
  servicesOf,
};

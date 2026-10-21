// Conta Agzos: cliente da API própria (services/accounts, servida em
// https://agzosagency.com.br/browser-api/v1). Roda só no processo principal.
// - O token de sessão fica cifrado pelo safeStorage em <userData>/agzos-account.bin
//   (recusado sem chaveiro do sistema) e nunca vai para a casca, para logs ou para os
//   arquivos de estado: a casca só recebe { loggedIn, name, email, plan }.
// - Códigos de recuperação passam pela casca uma única vez (para o usuário guardar) e não
//   ficam gravados aqui.
// - A foto de perfil é pública (não é segredo): fica em <userData>/agzos-account-avatar.png,
//   baixada do servidor quando a versão muda, e vai para a casca como data URL. A versão
//   guarda-se junto do token (cifrado). Sair da conta apaga a foto daqui.

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_BASE_URL = "https://agzosagency.com.br/browser-api/v1";
const TOKEN_FILE = "agzos-account.bin";
const AVATAR_FILE = "agzos-account-avatar.png";
// Foto: 256 × 256 PNG (no pior caso, RGB cru, fica abaixo de 300 KB). O servidor aceita até
// 512 KB; o arquivo escolhido no diálogo tem limite próprio, antes de ser decodificado.
const AVATAR_SIZE = 256;
const AVATAR_MAX_BYTES = 512 * 1024;
const AVATAR_INPUT_MAX_BYTES = 10 * 1024 * 1024;
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
  avatarRead: "Não consegui ler esta imagem. Use um arquivo PNG ou JPEG.",
};

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value, max = 256) => (typeof value === "string" ? value.slice(0, max) : "");
/** Versão da foto vinda do servidor: número, null (sem foto) ou undefined (não disse). */
const avatarVersionOf = (data) =>
  !isObject(data) || !("avatarVersion" in data)
    ? undefined
    : Number.isSafeInteger(data.avatarVersion)
      ? data.avatarVersion
      : null;

/** Tipo da imagem pela assinatura (PNG, JPEG ou WebP), ou null. */
function imageMimeOf(bytes) {
  const at = (index, expected) => expected.every((byte, offset) => bytes[index + offset] === byte);
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (at(0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return "image/webp";
  return null;
}

/**
 * Foto quadrada e pequena (PNG): recorte pelo centro e redução. `image` é um NativeImage
 * (ou qualquer objeto com a mesma forma). null se não der para ler ou se ficar grande demais.
 */
function squareAvatarPng(image) {
  if (!image || image.isEmpty()) return null;
  const { width, height } = image.getSize();
  if (!(width > 0) || !(height > 0)) return null;
  const side = Math.min(width, height);
  const square = image.crop({
    x: Math.floor((width - side) / 2),
    y: Math.floor((height - side) / 2),
    width: side,
    height: side,
  });
  const small =
    side === AVATAR_SIZE
      ? square
      : square.resize({ width: AVATAR_SIZE, height: AVATAR_SIZE, quality: "best" });
  const png = small.toPNG();
  return png.length > 0 && png.length <= AVATAR_MAX_BYTES ? png : null;
}

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
    avatar: null,
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
  const avatarFile = path.join(userDataDir, AVATAR_FILE);
  let stored = null;
  let loaded = false;
  // Foto em data: já codificada (não relê o arquivo a cada estado).
  let avatarMemo = null;

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
        stored = {
          token: data.token,
          user: data.user,
          savedAt: Number(data.savedAt) || 0,
          avatarVersion: Number.isSafeInteger(data.avatarVersion) ? data.avatarVersion : null,
        };
      }
    } catch {
      stored = null;
    }
    return stored;
  }

  function removeAvatarFile() {
    avatarMemo = null;
    fs.rmSync(avatarFile, { force: true });
  }

  function writeAvatarFile(bytes) {
    avatarMemo = null;
    fs.mkdirSync(userDataDir, { recursive: true });
    const temp = `${avatarFile}.tmp`;
    fs.writeFileSync(temp, bytes, { mode: 0o600 });
    fs.renameSync(temp, avatarFile);
  }

  /** Foto atual em data: URL, ou null (sem login, sem foto ou arquivo ilegível). */
  function avatarUrl() {
    const current = load();
    if (!current?.token || current.avatarVersion === null) return null;
    if (avatarMemo?.version === current.avatarVersion) return avatarMemo.url;
    try {
      const bytes = fs.readFileSync(avatarFile);
      const mime = imageMimeOf(bytes);
      if (!mime || bytes.length > AVATAR_MAX_BYTES) return null;
      avatarMemo = {
        version: current.avatarVersion,
        url: `data:${mime};base64,${bytes.toString("base64")}`,
      };
      return avatarMemo.url;
    } catch {
      return null;
    }
  }

  /** Estado para a casca: o de publicState mais a foto. */
  const view = (extra = {}) => publicState(load(), { avatar: avatarUrl(), ...extra });

  function save(next) {
    stored = next;
    loaded = true;
    if (!next) {
      fs.rmSync(tokenFile, { force: true });
      removeAvatarFile();
    } else {
      fs.mkdirSync(userDataDir, { recursive: true });
      fs.writeFileSync(tokenFile, safeStorage.encryptString(JSON.stringify(next)), {
        mode: 0o600,
      });
    }
    onChange(view());
  }

  /** Só troca a versão da foto guardada (com login). */
  function saveAvatarVersion(version) {
    if (!load()?.token) return;
    save({ ...stored, avatarVersion: version });
  }

  /**
   * Alinha a foto local com a versão do servidor: null apaga, número igual com arquivo
   * presente não faz nada, número diferente baixa a foto nova. Falha de rede deixa como está.
   */
  async function syncAvatar(remote) {
    const current = load();
    if (remote === undefined || !current?.token) return;
    if (remote === current.avatarVersion && (remote === null || fs.existsSync(avatarFile))) {
      return;
    }
    if (remote === null) {
      removeAvatarFile();
      saveAvatarVersion(null);
      return;
    }
    const result = await request("GET", "/avatar", undefined, { auth: true, reply: "bytes" });
    if (!result.ok) return;
    const bytes = result.bytes;
    if (!imageMimeOf(bytes) || bytes.length > AVATAR_MAX_BYTES) return;
    writeAvatarFile(Buffer.from(bytes));
    saveAvatarVersion(remote);
  }

  /**
   * Chamada à API: { ok, status, data } ou { ok:false, error } (sem lançar). `type` manda o
   * corpo cru (foto) com esse Content-Type; `reply: "bytes"` devolve a resposta como bytes.
   */
  async function request(method, route, body, { auth = false, type = null, reply = "json" } = {}) {
    const headers = { "X-Agzos-Client": `agzos-browser/${clientVersion}` };
    if (body !== undefined) headers["Content-Type"] = type ?? "application/json";
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
        ...(body !== undefined ? { body: type ? body : JSON.stringify(body) } : {}),
        signal: controller.signal,
        cache: "no-store",
        redirect: "error",
      });
    } catch {
      return { ok: false, status: 0, error: MESSAGES.offline };
    } finally {
      clearTimeout(timer);
    }
    if (response.ok && reply === "bytes") {
      try {
        const bytes = new Uint8Array(await response.arrayBuffer());
        return { ok: true, status: response.status, bytes };
      } catch {
        return { ok: false, status: 0, error: MESSAGES.offline };
      }
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
    const user = publicUser(data.user);
    if (typeof data.token !== "string" || !user) return false;
    // Outra conta neste computador: a foto da anterior não pode aparecer nela.
    const same = load()?.user?.email === user.email;
    if (!same) removeAvatarFile();
    save({
      token: data.token,
      user: data.user,
      savedAt: now(),
      avatarVersion: same ? (load()?.avatarVersion ?? null) : null,
    });
    return true;
  }

  const needsKeyring = () =>
    encryptionAvailable() ? null : { ok: false, error: MESSAGES.keyring, code: "keyring" };

  return {
    state() {
      return view({ available: encryptionAvailable() });
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
      await syncAvatar(avatarVersionOf(result.data));
      return { ok: true, state: view(), recoveryCodes };
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
      await syncAvatar(avatarVersionOf(result.data));
      const left = Number(result.data.recoveryCodesLeft);
      return {
        ok: true,
        state: view(),
        recoveryCodesLeft: Number.isFinite(left) ? left : null,
      };
    },

    async logout() {
      if (load()?.token) await request("POST", "/logout", undefined, { auth: true });
      if (stored) save(null);
      return { ok: true, state: view() };
    },

    /** No início: confere a sessão (e troca o token antigo). Offline, fica como está. */
    async verify() {
      if (!load()?.token) return view();
      const result = await request("GET", "/me", undefined, { auth: true });
      if (result.ok && publicUser(result.data.user)) {
        if (now() - (stored?.savedAt ?? 0) > REFRESH_AFTER_MS) {
          const refreshed = await request("POST", "/refresh", undefined, { auth: true });
          if (refreshed.ok) keep(refreshed.data);
        } else if (stored) {
          save({ ...stored, user: result.data.user });
        }
        await syncAvatar(avatarVersionOf(result.data));
      }
      return view();
    },

    async me() {
      const result = await request("GET", "/me", undefined, { auth: true });
      if (!result.ok) return failure(result);
      if (stored && publicUser(result.data.user)) save({ ...stored, user: result.data.user });
      await syncAvatar(avatarVersionOf(result.data));
      const left = Number(result.data.recoveryCodesLeft);
      return {
        ok: true,
        state: view(),
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
      return { ok: true, state: view() };
    },

    async services() {
      const result = await request("GET", "/services", undefined, { auth: true });
      if (!result.ok) return failure(result);
      const data = servicesOf(result.data);
      return data ? { ok: true, ...data } : { ok: false, error: MESSAGES.invalid };
    },

    /** Foto nova: `image` é um NativeImage do arquivo escolhido (o main é quem lê o disco). */
    async changeAvatar(image) {
      if (!load()?.token) return { ok: false, error: MESSAGES.loggedOut };
      const png = squareAvatarPng(image);
      if (!png) return { ok: false, error: MESSAGES.avatarRead, code: "bad_image" };
      const result = await request("PUT", "/avatar", png, { auth: true, type: "image/png" });
      if (!result.ok) return failure(result);
      const version = avatarVersionOf(result.data);
      if (typeof version !== "number") return { ok: false, error: MESSAGES.invalid };
      writeAvatarFile(png);
      saveAvatarVersion(version);
      return { ok: true, state: view() };
    },

    async removeAvatar() {
      if (!load()?.token) return { ok: false, error: MESSAGES.loggedOut };
      const result = await request("DELETE", "/avatar", undefined, { auth: true });
      if (!result.ok) return failure(result);
      removeAvatarFile();
      saveAvatarVersion(null);
      return { ok: true, state: view() };
    },
  };
}

module.exports = {
  DEFAULT_BASE_URL,
  TOKEN_FILE,
  AVATAR_FILE,
  AVATAR_INPUT_MAX_BYTES,
  AVATAR_MAX_BYTES,
  createAgzosAccount,
  imageMimeOf,
  squareAvatarPng,
  publicState,
  publicUser,
  codesOf,
  servicesOf,
};

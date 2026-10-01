// Cliente de integração do Agzos Key, no MAIN process do Electron (Node).
// Faz o pareamento, valida a senha mestra pelo auth-check, sincroniza entradas cifradas
// e as decifra em memória. A senha mestra, a chave derivada e as entradas em texto puro
// NUNCA saem deste processo: o renderer recebe só o resultado já decifrado via IPC.
//
// Cripto compatível byte a byte com o Agzos Key (Web Crypto + argon2-browser): KDF
// PBKDF2-HMAC-SHA256 100k ou Argon2id (64 MiB, t=3, p=4) -> AES-256-GCM, com o tag de autenticação de 16 bytes concatenado ao FIM do ciphertext.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_BASE_URL = "https://key.rsolutionsbr.com";
const AUTH_STRING = "agzos-key-auth-check-string-v1";
const PBKDF2_ITERS = 100_000;
const GCM_TAG_BYTES = 16;

function baseUrl() {
  const fromEnv = process.env.AGZOS_KEY_URL;
  return (fromEnv && fromEnv.replace(/\/+$/, "")) || DEFAULT_BASE_URL;
}

// --- HTTP ---------------------------------------------------------------------

async function api(pathname, body, token) {
  const res = await fetch(`${baseUrl()}${pathname}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = {};
  try {
    json = await res.json();
  } catch {
    json = {};
  }
  if (!res.ok) {
    const message = (json && (json.error || json.message)) || `http_${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return json;
}

// --- Cripto (PBKDF2 100k / AES-GCM 256, tag no fim) ---------------------------

function pbkdf2Key(password, saltB64, iterations, hash) {
  const salt = Buffer.from(saltB64, "base64");
  return crypto.pbkdf2Sync(password, salt, iterations || PBKDF2_ITERS, 32, hash || "sha256");
}

// Argon2id puro JS. Primeiro o bundle que vai no app (argon2.vendor.cjs, sem
// node_modules); no dev/teste cai no pacote @noble/hashes.
let argon2idFn = null;
function loadArgon2id() {
  if (argon2idFn) return argon2idFn;
  try {
    argon2idFn = require("./argon2.vendor.cjs").argon2id;
  } catch {
    argon2idFn = require("@noble/hashes/argon2").argon2id;
  }
  return argon2idFn;
}

// Parâmetros fixos do Agzos Key (src/lib/argon2.ts, argon2-browser): 64 MiB, 3 passes,
// paralelismo 4. O servidor NÃO manda t/m/p no authMeta; o padrão antigo daqui (p=1)
// derivava outra chave e recusava a senha mestra certa de toda conta Argon2id.
const ARGON2_DEFAULTS = { t: 3, m: 65536, p: 4 };

function argon2idParams(meta) {
  return {
    t: meta.t || meta.time || meta.timeCost || ARGON2_DEFAULTS.t,
    m: meta.m || meta.mem || meta.memory || meta.memoryCost || ARGON2_DEFAULTS.m, // KiB
    p: meta.p || meta.parallelism || meta.lanes || ARGON2_DEFAULTS.p,
  };
}

function argon2idKey(password, meta) {
  const { t, m, p } = argon2idParams(meta);
  const salt = Buffer.from(meta.salt, "base64");
  return Buffer.from(loadArgon2id()(password, salt, { t, m, p, dkLen: 32 }));
}

// Mesmo cálculo numa worker thread (leva segundos; não pode travar o main process).
// Se a worker não subir, calcula aqui mesmo.
function argon2idKeyAsync(password, meta) {
  let Worker;
  try {
    ({ Worker } = require("node:worker_threads"));
  } catch {
    return Promise.resolve(argon2idKey(password, meta));
  }
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(path.join(__dirname, "argon2-worker.cjs"), {
        workerData: { password, salt: meta.salt, ...argon2idParams(meta) },
      });
    } catch {
      resolve(argon2idKey(password, meta));
      return;
    }
    worker.once("message", (msg) => {
      if (msg && msg.key) resolve(Buffer.from(msg.key, "base64"));
      else reject(new Error((msg && msg.error) || "argon2_failed"));
    });
    worker.once("error", reject);
  });
}

function aesGcmDecrypt(keyRaw, ivB64, dataB64) {
  const iv = Buffer.from(ivB64, "base64");
  const buf = Buffer.from(dataB64, "base64");
  const tag = buf.subarray(buf.length - GCM_TAG_BYTES);
  const ciphertext = buf.subarray(0, buf.length - GCM_TAG_BYTES);
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyRaw, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

function aesGcmEncrypt(keyRaw, plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyRaw, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv: iv.toString("base64"), data: Buffer.concat([enc, tag]).toString("base64") };
}

// A chave abre o auth-check do cofre? Senha errada quebra a autenticação do GCM (erro
// cru do OpenSSL) ou, no limite, decifra para algo != AUTH_STRING.
function opensAuthCheck(key, meta) {
  try {
    return aesGcmDecrypt(key, meta.authCheckIv, meta.authCheckData) === AUTH_STRING;
  } catch {
    return false;
  }
}

function pbkdf2KeyFromMeta(password, meta) {
  const iterations = Number.isInteger(meta.iterations) ? meta.iterations : PBKDF2_ITERS;
  const hash = typeof meta.hash === "string" ? meta.hash.replace("-", "").toLowerCase() : "sha256";
  return pbkdf2Key(password, meta.salt, iterations, hash);
}

// Deriva a chave AES e valida a senha mestra pelo auth-check do cofre.
// Igual ao verifyMasterPassword do Agzos Key: tenta a KDF declarada no cofre e depois a
// outra, porque o rótulo `kdf` pode não bater com a KDF que realmente cifrou o auth-check
// (o app grava "argon2id" mesmo quando cai no PBKDF2, e cofres antigos não têm o campo).
async function deriveKey(password, meta) {
  const declared = String(meta.kdf || "pbkdf2")
    .toLowerCase()
    .startsWith("argon")
    ? "argon2id"
    : "pbkdf2";
  const order = declared === "argon2id" ? ["argon2id", "pbkdf2"] : ["pbkdf2", "argon2id"];
  for (const kdf of order) {
    let key;
    try {
      key =
        kdf === "argon2id"
          ? await argon2idKeyAsync(password, meta)
          : pbkdf2KeyFromMeta(password, meta);
    } catch {
      continue;
    }
    if (opensAuthCheck(key, meta)) return key;
  }
  throw new Error("invalid_master_password");
}

function isFolderId(id) {
  return typeof id === "string" && id.startsWith("folder_");
}

function isLogId(id) {
  return typeof id === "string" && id.startsWith("log_");
}

function decryptEntry(key, entry) {
  return JSON.parse(aesGcmDecrypt(key, entry.iv, entry.data));
}

function encryptEntry(key, plainEntry, deviceId) {
  const { iv, data } = aesGcmEncrypt(key, JSON.stringify(plainEntry));
  return {
    id: plainEntry.id,
    iv,
    data,
    updatedAt: plainEntry.updatedAt,
    version: 1,
    deviceId: deviceId || "",
    vaultId: "personal",
  };
}

// --- Estado persistido (device id, token cifrado, since) ----------------------

function createStore({ userDataDir, safeStorage }) {
  const file = path.join(userDataDir, "agzos-key-integration.json");

  function read() {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return {};
    }
  }
  function write(data) {
    fs.writeFileSync(file, JSON.stringify(data), { mode: 0o600 });
  }

  function deviceId() {
    const data = read();
    if (typeof data.deviceId === "string" && data.deviceId) return data.deviceId;
    const id = crypto.randomUUID();
    write({ ...data, deviceId: id });
    return id;
  }

  // Token guardado cifrado com safeStorage (atrelado ao SO). Nunca em texto puro.
  function saveToken(token) {
    const data = read();
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      data.tokenEnc = safeStorage.encryptString(token).toString("base64");
      delete data.token;
    } else {
      data.token = token; // ambiente sem safeStorage (dev): melhor esforço
      delete data.tokenEnc;
    }
    write(data);
  }
  function loadToken() {
    const data = read();
    if (data.tokenEnc && safeStorage && safeStorage.isEncryptionAvailable()) {
      try {
        return safeStorage.decryptString(Buffer.from(data.tokenEnc, "base64"));
      } catch {
        return null;
      }
    }
    return typeof data.token === "string" ? data.token : null;
  }

  function getSince() {
    const data = read();
    return typeof data.since === "number" ? data.since : 0;
  }
  function setSince(since) {
    write({ ...read(), since });
  }
  function setMeta(meta) {
    write({ ...read(), accountEmail: meta?.accountEmail ?? null });
  }
  function accountEmail() {
    return read().accountEmail ?? null;
  }
  function clear() {
    const data = read();
    write({ deviceId: data.deviceId }); // mantém o device id estável
  }
  function isPaired() {
    return Boolean(loadToken());
  }

  return {
    deviceId,
    saveToken,
    loadToken,
    getSince,
    setSince,
    setMeta,
    accountEmail,
    clear,
    isPaired,
  };
}

// --- Cliente de alto nível ----------------------------------------------------

function createAgzosKey({ userDataDir, safeStorage }) {
  const store = createStore({ userDataDir, safeStorage });
  // Chave AES e authMeta só em memória; descartadas ao bloquear/sair.
  let aesKey = null;
  let authMeta = null;

  function locked() {
    return aesKey === null;
  }

  // Status do pareamento, sem expor segredos.
  function state() {
    return {
      paired: store.isPaired(),
      unlocked: !locked(),
      accountEmail: store.accountEmail(),
      deviceId: store.deviceId(),
    };
  }

  // Passo 2 do pareamento: troca o código por um device token.
  async function pair(pairingCode, deviceName) {
    const deviceId = store.deviceId();
    const res = await api("/api/integration/pair/claim", {
      pairingCode: String(pairingCode || "").trim(),
      deviceId,
      deviceName: deviceName || "Agzos Browser",
    });
    if (!res.deviceToken) throw new Error("pair_failed");
    store.saveToken(res.deviceToken);
    store.setSince(0);
    store.setMeta({ accountEmail: res.accountEmail ?? null });
    authMeta = res.authMeta ?? null;
    aesKey = null; // ainda precisa da senha mestra
    return {
      paired: true,
      hasVault: Boolean(res.hasVault),
      accountEmail: res.accountEmail ?? null,
    };
  }

  // Garante um authMeta atual (muda se o usuário trocar a senha mestra OU se outra conta
  // estiver pareada agora). Sempre vem do servidor pelo token atual: é a fonte da verdade
  // da conta pareada. Nunca reaproveita um authMeta velho — era isso que fazia a senha
  // mestra certa de outra conta ser recusada (validada contra o auth-check da conta anterior).
  async function refreshStatus() {
    const token = store.loadToken();
    if (!token) throw new Error("not_paired");
    const res = await api("/api/integration/vault/status", undefined, token);
    const previousEmail = store.accountEmail();
    const nextEmail = res.accountEmail ?? null;
    // Trocou a conta pareada: descarta a chave/estado em memória da conta anterior.
    if (previousEmail && nextEmail && previousEmail !== nextEmail) {
      aesKey = null;
      store.setSince(0);
    }
    authMeta = res.authMeta ?? null;
    store.setMeta({ accountEmail: nextEmail });
    return { hasVault: Boolean(res.hasVault), accountEmail: nextEmail };
  }

  // Desbloqueia com a senha mestra; valida pelo auth-check e deriva a chave AES.
  // SEMPRE busca o auth-check atual do servidor antes de validar, para nunca checar a
  // senha de uma conta contra o auth-check de outra que ficou em memória.
  async function unlock(masterPassword) {
    if (!store.loadToken()) throw new Error("not_paired");
    await refreshStatus();
    if (!authMeta) throw new Error("no_vault");
    aesKey = await deriveKey(masterPassword, authMeta); // lança invalid_master_password
    return { unlocked: true };
  }

  function lock() {
    aesKey = null;
  }

  // Puxa TODO o cofre e devolve as entradas decifradas, filtrando apagadas.
  // Sempre com since=0: isto é "carregar o cofre inteiro", não um delta. Com um cursor
  // que avança, a 2ª chamada voltava vazia (nada mudou) e a casca zerava a lista — era
  // isso que fazia "as senhas sumirem" depois de logar.
  async function list() {
    if (locked()) throw new Error("locked");
    const token = store.loadToken();
    if (!token) throw new Error("not_paired");
    const res = await api("/api/integration/vault/sync", { since: 0, ops: [] }, token);
    if (typeof res.syncedAt === "number") store.setSince(res.syncedAt);
    // O cofre guarda no mesmo lugar senhas, pastas (folder_*) e histórico (log_*).
    // Só senhas vão para o painel: pastas viram o nome da categoria e o histórico é
    // ignorado. Antes as pastas apareciam como "Credencial" vazia e, ao apagá-las aqui,
    // sumiam do Agzos Key em todos os dispositivos.
    const entries = [];
    const folderNames = new Map();
    for (const enc of res.entries || []) {
      if (isLogId(enc.id)) continue;
      try {
        const plain = decryptEntry(aesKey, enc);
        if (plain.deletedAt) continue;
        if (isFolderId(enc.id)) {
          if (typeof plain.name === "string" && plain.name.trim()) folderNames.set(enc.id, plain.name.trim());
        } else {
          entries.push(plain);
        }
      } catch {
        // entrada ilegível (chave errada / corrompida): ignora sem derrubar a lista
      }
    }
    for (const entry of entries) {
      const folderName = entry.folderId ? folderNames.get(entry.folderId) : undefined;
      if (!entry.category && folderName) entry.category = folderName;
    }
    return { entries, deletedIds: res.deletedIds || [] };
  }

  // Cifra e envia uma entrada (INSERT/UPDATE pelo id).
  async function save(plainEntry) {
    if (locked()) throw new Error("locked");
    const token = store.loadToken();
    if (!token) throw new Error("not_paired");
    const deviceId = store.deviceId();
    const entry = { ...plainEntry, updatedAt: Date.now() };
    const payload = encryptEntry(aesKey, entry, deviceId);
    await api(
      "/api/integration/vault/sync",
      {
        since: 0,
        ops: [{ type: "UPDATE", entityId: entry.id, timestamp: entry.updatedAt, payload }],
      },
      token,
    );
    return { ok: true, id: entry.id };
  }

  // Marca a entrada como apagada no servidor.
  async function remove(id) {
    // Pastas e histórico pertencem ao Agzos Key; o browser só apaga senhas.
    if (typeof id !== "string" || !id || isFolderId(id) || isLogId(id)) throw new Error("not_a_credential");
    const token = store.loadToken();
    if (!token) throw new Error("not_paired");
    const timestamp = Date.now();
    await api(
      "/api/integration/vault/sync",
      { since: 0, ops: [{ type: "DELETE", entityId: id, timestamp }] },
      token,
    );
    return { ok: true };
  }

  // Revoga o token no servidor e limpa o estado local.
  async function unpair() {
    const token = store.loadToken();
    if (token) {
      try {
        await api("/api/integration/unpair", {}, token);
      } catch {
        // mesmo que falhe no servidor, limpamos localmente
      }
    }
    aesKey = null;
    authMeta = null;
    store.clear();
    return { ok: true };
  }

  return {
    state,
    pair,
    refreshStatus,
    unlock,
    lock,
    list,
    save,
    remove,
    unpair,
  };
}

module.exports = {
  createAgzosKey,
  // exportados para teste de compatibilidade de cripto
  _internals: {
    pbkdf2Key,
    argon2idKey,
    argon2idKeyAsync,
    aesGcmDecrypt,
    aesGcmEncrypt,
    deriveKey,
    decryptEntry,
    encryptEntry,
  },
  AUTH_STRING,
  PBKDF2_ITERS,
};

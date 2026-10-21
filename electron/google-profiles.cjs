// Contas Google (perfis): cada conta é um perfil isolado do navegador numa partição
// persistente própria ("persist:agzos-profile-<id>", pasta
// <userData>/Partitions/agzos-profile-<id>), aberta numa janela própria. A lista fica no
// meta `googleProfiles`; pastas de perfis removidos esperam em `googleProfilesPurge` e
// somem no próximo início (antes de qualquer sessão existir). Só valem com a conta Agzos
// logada: sem login, os dados ficam, mas a lista some da casca e nada abre.

// Caracteres de controle (U+0000 a U+001F e U+007F), montados sem literal na regex.
const CONTROL_CHARS = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`,
  "g",
);

const PARTITION_PREFIX = "persist:agzos-profile-";
const DIR_PREFIX = "agzos-profile-";
const PROFILE_ID_RE = /^[a-z0-9]{8,32}$/;
const MAX_PROFILES = 50;
const LABEL_MAX = 60;
const AVATAR_MAX = 120 * 1024;
const COLORS = ["#d10a11", "#2563eb", "#16a34a", "#d97706", "#7c3aed", "#db2777", "#0891b2"];
const EMAIL_RE = /^[^\s@<>"]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,24}$/i;
const AVATAR_RE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
// Páginas do Google cujo fim indica que o login pode ter mudado.
const GOOGLE_HOST_RE = /(^|\.)(google\.com|youtube\.com|gmail\.com)$/i;

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

function partitionOf(id) {
  return PROFILE_ID_RE.test(String(id)) ? `${PARTITION_PREFIX}${id}` : null;
}

function cleanLabel(value) {
  if (typeof value !== "string") return "";
  return value.replace(CONTROL_CHARS, "").replace(/\s+/g, " ").trim().slice(0, LABEL_MAX);
}

function cleanEmail(value) {
  if (typeof value !== "string") return "";
  const email = value.trim().toLowerCase();
  return EMAIL_RE.test(email) ? email : "";
}

function cleanColor(value) {
  return COLORS.includes(value) ? value : COLORS[0];
}

function cleanAvatar(value) {
  return typeof value === "string" && value.length <= AVATAR_MAX && AVATAR_RE.test(value)
    ? value
    : null;
}

function validProfile(value) {
  if (!isObject(value) || !PROFILE_ID_RE.test(String(value.id))) return null;
  const email = cleanEmail(value.email);
  return {
    id: value.id,
    label: cleanLabel(value.label) || email || "Conta Google",
    email,
    name: cleanLabel(value.name),
    color: cleanColor(value.color),
    avatar: cleanAvatar(value.avatar),
    createdAt: Number.isFinite(value.createdAt) ? value.createdAt : 0,
    lastUsed: Number.isFinite(value.lastUsed) ? value.lastUsed : 0,
  };
}

function parseProfiles(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const list = [];
  for (const item of value) {
    const profile = validProfile(item);
    if (!profile || seen.has(profile.id)) continue;
    seen.add(profile.id);
    list.push(profile);
    if (list.length >= MAX_PROFILES) break;
  }
  return list;
}

/** Mais recente primeiro (o modal do início mostra assim). */
function sortedProfiles(list) {
  return [...list].sort((a, b) => b.lastUsed - a.lastUsed || a.createdAt - b.createdAt);
}

/**
 * Resposta do ListAccounts do Google (só leitura, com os cookies do perfil):
 * `["gaia.l.a.r",[["gaia.l.a",1,"Nome","email@gmail.com","https://…foto",…],…]]`.
 * Devolve a primeira conta { email, name, photo } ou null. Nunca avalia o texto.
 */
function parseListAccounts(text) {
  if (typeof text !== "string" || text.length > 200_000) return null;
  let data = null;
  try {
    data = JSON.parse(text.replace(/^\)\]\}'\s*/, ""));
  } catch {
    return null;
  }
  const accounts = Array.isArray(data) ? data[1] : null;
  if (!Array.isArray(accounts)) return null;
  for (const entry of accounts) {
    if (!Array.isArray(entry)) continue;
    const email = cleanEmail(entry[3]);
    if (!email) continue;
    const photo =
      typeof entry[4] === "string" &&
      /^https:\/\/[a-z0-9.-]+\.googleusercontent\.com\//i.test(entry[4])
        ? entry[4]
        : null;
    return { email, name: cleanLabel(entry[2]), photo };
  }
  return null;
}

/** Pastas de perfis removidos que ainda existem no disco. */
function purgeDirs(names, purge) {
  const pending = new Set(
    (Array.isArray(purge) ? purge : []).filter((id) => PROFILE_ID_RE.test(id)),
  );
  return (Array.isArray(names) ? names : []).filter(
    (name) =>
      typeof name === "string" &&
      name.startsWith(DIR_PREFIX) &&
      pending.has(name.slice(DIR_PREFIX.length)),
  );
}

function isGoogleUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && GOOGLE_HOST_RE.test(parsed.hostname);
  } catch {
    return false;
  }
}

/** Domínio de cookie ("accounts.google.com", ".google.com") de um site do Google? */
function isGoogleCookieDomain(domain) {
  if (typeof domain !== "string") return false;
  return GOOGLE_HOST_RE.test(domain.trim().replace(/^\./, ""));
}

/**
 * Lista no meta. `database` precisa de getMeta/setMeta (db.cjs). `newId` e `now` trocam
 * nos testes.
 */
function createProfileStore({
  database,
  newId = () => require("node:crypto").randomBytes(8).toString("hex"),
  now = Date.now,
}) {
  const read = (key) => {
    try {
      return database?.getMeta(key) ?? null;
    } catch {
      return null;
    }
  };
  const write = (key, value) => {
    try {
      database?.setMeta(key, value);
    } catch (error) {
      console.error(`Agzos: não foi possível gravar ${key}.`, error);
    }
  };
  let list = parseProfiles(read("googleProfiles"));
  const persist = () => write("googleProfiles", list);

  return {
    list: () => sortedProfiles(list),
    get: (id) => list.find((item) => item.id === id) ?? null,
    add({ label = "", color } = {}) {
      if (list.length >= MAX_PROFILES) return null;
      let id;
      do id = newId();
      while (list.some((item) => item.id === id) || !PROFILE_ID_RE.test(id));
      const profile = validProfile({
        id,
        label: cleanLabel(label) || "Nova conta Google",
        color: color ?? COLORS[list.length % COLORS.length],
        createdAt: now(),
        lastUsed: now(),
      });
      list.push(profile);
      persist();
      return profile;
    },
    update(id, patch = {}) {
      const index = list.findIndex((item) => item.id === id);
      if (index < 0 || !isObject(patch)) return null;
      const current = list[index];
      const next = validProfile({
        ...current,
        ...("label" in patch ? { label: cleanLabel(patch.label) || current.label } : {}),
        ...("color" in patch ? { color: patch.color } : {}),
        ...("email" in patch ? { email: patch.email } : {}),
        ...("name" in patch ? { name: patch.name } : {}),
        ...("avatar" in patch ? { avatar: patch.avatar } : {}),
        ...("lastUsed" in patch ? { lastUsed: patch.lastUsed } : {}),
      });
      list[index] = next;
      persist();
      return next;
    },
    remove(id) {
      const before = list.length;
      list = list.filter((item) => item.id !== id);
      if (list.length === before) return false;
      persist();
      const purge = new Set(
        Array.isArray(read("googleProfilesPurge")) ? read("googleProfilesPurge") : [],
      );
      purge.add(id);
      write(
        "googleProfilesPurge",
        [...purge].filter((item) => PROFILE_ID_RE.test(item)),
      );
      return true;
    },
    pendingPurge: () => {
      const value = read("googleProfilesPurge");
      return Array.isArray(value) ? value.filter((id) => PROFILE_ID_RE.test(id)) : [];
    },
    clearPurge: (done) => {
      const left = (read("googleProfilesPurge") ?? []).filter((id) => !done.includes(id));
      write("googleProfilesPurge", left);
    },
  };
}

/** Preferência do modal do início (meta `profilePicker`). */
function pickerPrefOf(value) {
  return { showOnStart: !(isObject(value) && value.showOnStart === false) };
}

/** Modal "Escolha uma conta" no início? Nunca sem login, em PWA ou em teste (sem a flag). */
function shouldShowPicker({ loggedIn, profiles, pref, pwaHost = false, env = {}, packaged }) {
  if (!loggedIn || pwaHost || !Array.isArray(profiles) || profiles.length === 0) return false;
  if (!pickerPrefOf(pref).showOnStart) return false;
  const testing =
    Boolean(env.AGZOS_USER_DATA) || Object.keys(env).some((key) => key.startsWith("AGZOS_TEST_"));
  if (testing && !(packaged === false && env.AGZOS_TEST_PROFILE_PICKER === "1")) return false;
  return true;
}

module.exports = {
  COLORS,
  DIR_PREFIX,
  PARTITION_PREFIX,
  PROFILE_ID_RE,
  createProfileStore,
  isGoogleCookieDomain,
  isGoogleUrl,
  parseListAccounts,
  parseProfiles,
  partitionOf,
  pickerPrefOf,
  purgeDirs,
  shouldShowPicker,
  sortedProfiles,
  validProfile,
};

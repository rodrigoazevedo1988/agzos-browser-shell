// Perfis de preenchimento (Pessoal, Trabalho…), mapeamentos por site e preferências do
// autofill de formulários. Tudo num arquivo só, cifrado pelo safeStorage (DPAPI no
// Windows, Keychain no macOS, chaveiro no Linux) em <userData>/autofill-profiles.bin,
// como o cache local do Agzos Key. Nunca em texto puro no disco: sem chaveiro o
// navegador recusa gravar (error "insecure"). Nada daqui vai para logs.

const fs = require("node:fs");

const { PROFILE_TYPES, siteKey } = require("./form-intel.cjs");

const MAX_PROFILES = 20;
const MAX_SITES = 500;
const MAX_FIELDS_PER_SITE = 60;
const MAX_VALUE = 200;
const MAPPABLE = new Set([...PROFILE_TYPES, "tel-area-code", "tel-local", "username", "ignore"]);

const DEFAULT_SETTINGS = { forms: true, suggest: true, learn: true };

function emptyData() {
  return { version: 1, settings: { ...DEFAULT_SETTINGS }, profiles: [], mappings: {}, never: [] };
}

const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");

function validProfile(input) {
  if (!input || typeof input !== "object") return null;
  const id = text(input.id, 64);
  const name = text(input.name, 60);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !name) return null;
  const fields = {};
  const source = input.fields && typeof input.fields === "object" ? input.fields : {};
  for (const type of PROFILE_TYPES) {
    const value = text(source[type], MAX_VALUE);
    if (value) fields[type] = value;
  }
  return { id, name, fields, updatedAt: Number(input.updatedAt) || Date.now() };
}

/** Chave de site vinda da casca: host (com caminho só no Apps Script), nada além disso. */
function validSite(site) {
  const match = /^([a-z0-9.-]+(?::\d+)?)(\/macros\/s\/[A-Za-z0-9_-]+)?$/i.exec(text(site, 200));
  // Host em minúsculas; o id do app do Apps Script diferencia maiúsculas.
  return match ? `${match[1].toLowerCase()}${match[2] || ""}` : "";
}

function normalize(data) {
  const out = emptyData();
  if (!data || typeof data !== "object") return out;
  const settings = data.settings && typeof data.settings === "object" ? data.settings : {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (typeof settings[key] === "boolean") out.settings[key] = settings[key];
  }
  if (Array.isArray(data.profiles)) {
    out.profiles = data.profiles.map(validProfile).filter(Boolean).slice(0, MAX_PROFILES);
  }
  if (data.mappings && typeof data.mappings === "object") {
    for (const [site, fields] of Object.entries(data.mappings).slice(0, MAX_SITES)) {
      if (!validSite(site) || !fields || typeof fields !== "object") continue;
      const clean = {};
      for (const [signature, entry] of Object.entries(fields).slice(0, MAX_FIELDS_PER_SITE)) {
        const type = entry && typeof entry === "object" ? entry.type : entry;
        if (typeof signature !== "string" || signature.length > 140 || !MAPPABLE.has(type))
          continue;
        clean[signature] = { type, label: text(entry && entry.label, 80) };
      }
      if (Object.keys(clean).length) out.mappings[site] = clean;
    }
  }
  if (Array.isArray(data.never)) {
    out.never = [...new Set(data.never.map(validSite).filter(Boolean))].slice(0, MAX_SITES);
  }
  return out;
}

function createAutofillStore({ file, safeStorage }) {
  const available = () => {
    try {
      return Boolean(safeStorage && safeStorage.isEncryptionAvailable());
    } catch {
      return false;
    }
  };

  let cache = null;
  function read() {
    if (cache) return cache;
    if (!available()) return emptyData();
    try {
      cache = normalize(JSON.parse(safeStorage.decryptString(fs.readFileSync(file))));
    } catch {
      cache = emptyData();
    }
    return cache;
  }

  function write(next) {
    if (!available()) return { ok: false, error: "insecure" };
    const data = normalize(next);
    try {
      fs.writeFileSync(file, safeStorage.encryptString(JSON.stringify(data)), { mode: 0o600 });
    } catch {
      return { ok: false, error: "write" };
    }
    cache = data;
    return { ok: true };
  }

  /** Estado para a casca (Configurações e popup). Os valores dos perfis são do usuário. */
  function state() {
    const data = read();
    const mappings = [];
    for (const [site, fields] of Object.entries(data.mappings)) {
      for (const [signature, entry] of Object.entries(fields)) {
        mappings.push({ site, signature, type: entry.type, label: entry.label });
      }
    }
    return {
      available: available(),
      settings: { ...data.settings },
      profiles: data.profiles.map((profile) => ({ ...profile, fields: { ...profile.fields } })),
      mappings,
      never: [...data.never],
    };
  }

  return {
    state,
    available,
    settings: () => ({ ...read().settings }),
    profile(id) {
      return read().profiles.find((profile) => profile.id === id) || null;
    },
    /** Mapeamentos do site da página (assinatura → tipo ou "ignore"). */
    mappingsFor(url) {
      const fields = read().mappings[siteKey(url)] || {};
      const out = {};
      for (const [signature, entry] of Object.entries(fields)) out[signature] = entry.type;
      return out;
    },
    isNever(url) {
      const key = siteKey(url);
      return Boolean(key) && read().never.includes(key);
    },
    setSettings(partial) {
      const data = read();
      const settings = { ...data.settings };
      for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (partial && typeof partial[key] === "boolean") settings[key] = partial[key];
      }
      return write({ ...data, settings });
    },
    saveProfile(input) {
      const profile = validProfile({ ...input, updatedAt: Date.now() });
      if (!profile) return { ok: false, error: "invalid" };
      const data = read();
      const exists = data.profiles.some((item) => item.id === profile.id);
      if (!exists && data.profiles.length >= MAX_PROFILES) return { ok: false, error: "limit" };
      const profiles = exists
        ? data.profiles.map((item) => (item.id === profile.id ? profile : item))
        : [...data.profiles, profile];
      return write({ ...data, profiles });
    },
    removeProfile(id) {
      const data = read();
      return write({ ...data, profiles: data.profiles.filter((item) => item.id !== id) });
    },
    setMapping(site, signature, type, label) {
      const key = validSite(site);
      if (!key || typeof signature !== "string" || signature.length > 140 || !MAPPABLE.has(type))
        return { ok: false, error: "invalid" };
      const data = read();
      const fields = { ...(data.mappings[key] || {}) };
      fields[signature] = { type, label: text(label, 80) };
      return write({ ...data, mappings: { ...data.mappings, [key]: fields } });
    },
    removeMapping(site, signature) {
      const key = validSite(site);
      const data = read();
      if (!key || !data.mappings[key]) return { ok: true };
      const fields = { ...data.mappings[key] };
      delete fields[signature];
      const mappings = { ...data.mappings };
      if (Object.keys(fields).length) mappings[key] = fields;
      else delete mappings[key];
      return write({ ...data, mappings });
    },
    setNever(site, never) {
      const key = validSite(site);
      if (!key) return { ok: false, error: "invalid" };
      const data = read();
      const list = data.never.filter((item) => item !== key);
      if (never) list.push(key);
      return write({ ...data, never: list });
    },
  };
}

module.exports = { createAutofillStore, normalize, validSite, DEFAULT_SETTINGS };

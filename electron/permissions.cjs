// Permissões por site (câmera, microfone, notificações, localização…). As decisões com
// "Lembrar" ficam em site_settings (origem + "permission:<tipo>"); as da aba anônima só
// em memória, até fechar o app.
//
// Cuidado com o login do Google: o *check* de permissão continua respondendo "permitido"
// para o que o usuário não bloqueou (como o Electron sempre fez; o shim da identidade de
// Chrome mostra Notification.permission = "default"). Só o que foi bloqueado de propósito
// passa a responder "negado" — igual ao Chrome com o site bloqueado.

const PERMISSION_TYPES = [
  "camera",
  "microphone",
  "notifications",
  "geolocation",
  "clipboard-read",
  "midi",
];
const KEY_PREFIX = "permission:";
// Permitidos sem perguntar, como no Chrome.
const AUTO_ALLOWED = ["fullscreen", "pointerLock", "clipboard-sanitized-write"];

/** Tipos que um pedido do Chromium envolve; null = não é permissão perguntável. */
function permissionTypesOf(permission, details = {}) {
  switch (permission) {
    case "media": {
      const media = Array.isArray(details.mediaTypes) ? details.mediaTypes : [];
      const types = [];
      if (media.includes("video")) types.push("camera");
      if (media.includes("audio")) types.push("microphone");
      return types.length ? types : ["camera", "microphone"];
    }
    case "notifications":
    case "geolocation":
    case "clipboard-read":
      return [permission];
    case "midiSysex":
    case "midi":
      return ["midi"];
    default:
      return null;
  }
}

/** Tipos consultados por um check (enumerateDevices, Notification.permission…). */
function checkTypesOf(permission, details = {}) {
  if (permission === "media") {
    if (details.mediaType === "video") return ["camera"];
    if (details.mediaType === "audio") return ["microphone"];
    return ["camera", "microphone"];
  }
  return permissionTypesOf(permission, details);
}

/** Origem do pedido (https://site:porta), ou null se não for web. */
function requestOrigin(details = {}) {
  for (const candidate of [
    details.requestingUrl,
    details.requestingOrigin,
    details.securityOrigin,
  ]) {
    if (typeof candidate !== "string" || !candidate) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === "http:" || url.protocol === "https:") return url.origin;
    } catch {
      // tenta o próximo
    }
  }
  return null;
}

const isOrigin = (value) => {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.origin === value;
  } catch {
    return false;
  }
};

function createPermissions({ database }) {
  // Aba anônima: "origem|tipo" → "allow" | "block".
  const memory = new Map();

  function get(origin, type, isPrivate) {
    if (isPrivate) {
      const value = memory.get(`${origin}|${type}`);
      if (value) return value;
      // Como no Chrome: o bloqueio da janela normal vale na anônima; a permissão, não.
      const saved = database?.getSiteSetting(origin, KEY_PREFIX + type) ?? null;
      return saved === "block" ? "block" : null;
    }
    const value = database?.getSiteSetting(origin, KEY_PREFIX + type) ?? null;
    return value === "allow" || value === "block" ? value : null;
  }

  function set(origin, type, value, isPrivate = false) {
    if (!isOrigin(origin) || !PERMISSION_TYPES.includes(type)) return false;
    if (value !== "allow" && value !== "block" && value !== null) return false;
    if (isPrivate) {
      if (value) memory.set(`${origin}|${type}`, value);
      else memory.delete(`${origin}|${type}`);
      return true;
    }
    database?.setSiteSetting(origin, KEY_PREFIX + type, value);
    return true;
  }

  return {
    /** true/false quando já há decisão para todos os tipos; null = perguntar. */
    decide(origin, types, isPrivate) {
      if (!origin) return false;
      const values = types.map((type) => get(origin, type, isPrivate));
      if (values.includes("block")) return false;
      if (values.every((value) => value === "allow")) return true;
      return null;
    },
    /** Para o check handler: só o bloqueio explícito nega. */
    blocked(origin, types, isPrivate) {
      if (!origin) return false;
      return types.some((type) => get(origin, type, isPrivate) === "block");
    },
    remember(origin, types, allow, isPrivate) {
      for (const type of types) set(origin, type, allow ? "allow" : "block", isPrivate);
    },
    set,
    list() {
      if (!database) return [];
      return database
        .listSiteSettings(KEY_PREFIX)
        .map((row) => ({
          origin: row.host,
          type: row.key.slice(KEY_PREFIX.length),
          value: row.value,
        }))
        .filter(
          (row) =>
            PERMISSION_TYPES.includes(row.type) && (row.value === "allow" || row.value === "block"),
        );
    },
    reset(origin) {
      if (!isOrigin(origin)) return false;
      database?.deleteSiteSettings(origin, KEY_PREFIX);
      for (const key of [...memory.keys()]) if (key.startsWith(`${origin}|`)) memory.delete(key);
      return true;
    },
  };
}

module.exports = {
  createPermissions,
  permissionTypesOf,
  checkTypesOf,
  requestOrigin,
  PERMISSION_TYPES,
  AUTO_ALLOWED,
};

// 4.8 (Fase 0): uma flag por bloco do PRD v4.8, para soltar o núcleo (DevTools e
// Print Engine) com o resto desligado. Ordem de quem manda, do mais fraco ao mais forte:
// padrão do código < build (`agzosFlags` no package.json do pacote) < escolha do usuário
// (meta `featureFlags`) < AGZOS_FLAGS, que só vale fora do pacote (testes e dev).

const FLAG_DEFAULTS = Object.freeze({
  // Navegador para dev: o DevTools do Chromium fica ligado (antes era bloqueado no pacote).
  devtools: true,
  print_shield: true,
  scroll_stitch: false,
  copilot: false,
  rewind: false,
  kiosk: false,
  // 4.8.3: no macOS cada PWA instalado vira um app próprio (ícone no Dock, Cmd+Tab).
  pwa_mac_apps: true,
});

const FLAG_NAMES = Object.keys(FLAG_DEFAULTS);

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/** Só flags conhecidas com valor booleano; o resto some. */
function cleanFlags(value) {
  if (!isObject(value)) return {};
  const clean = {};
  for (const name of FLAG_NAMES) {
    if (typeof value[name] === "boolean") clean[name] = value[name];
  }
  return clean;
}

/** "devtools=0,kiosk=1" (ou "on"/"off"/"true"/"false") → { devtools: false, kiosk: true }. */
function parseFlagList(text) {
  if (typeof text !== "string") return {};
  const flags = {};
  for (const part of text.split(",")) {
    const [rawName, rawValue = ""] = part.split("=");
    const name = rawName?.trim().toLowerCase();
    const value = rawValue.trim().toLowerCase();
    if (!name || !FLAG_NAMES.includes(name)) continue;
    if (["1", "on", "true", "yes"].includes(value)) flags[name] = true;
    else if (["0", "off", "false", "no"].includes(value)) flags[name] = false;
  }
  return flags;
}

/** Valor do build: string no formato de parseFlagList ou objeto { flag: boolean }. */
function buildFlagsOf(value) {
  return typeof value === "string" ? parseFlagList(value) : cleanFlags(value);
}

function resolveFlags({ build = {}, user = {}, env = {} } = {}) {
  return { ...FLAG_DEFAULTS, ...cleanFlags(build), ...cleanFlags(user), ...cleanFlags(env) };
}

/** Grava a escolha do usuário para uma flag; null volta ao padrão do build. */
function withUserFlag(user, name, value) {
  const next = cleanFlags(user);
  if (!FLAG_NAMES.includes(name)) return next;
  if (typeof value === "boolean") next[name] = value;
  else delete next[name];
  return next;
}

module.exports = {
  FLAG_DEFAULTS,
  FLAG_NAMES,
  buildFlagsOf,
  cleanFlags,
  parseFlagList,
  resolveFlags,
  withUserFlag,
};

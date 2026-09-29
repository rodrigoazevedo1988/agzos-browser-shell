// Bloqueio real de anúncios e rastreadores (NAV-001). Dois motores do
// @ghostery/adblocker: "ads" (EasyList, EasyList Brasil e as listas do uBlock Origin, com
// CSS de ocultação e scriptlets) e "privacy" (EasyPrivacy + privacidade do uBO). As listas
// são baixadas no primeiro uso e a cada 7 dias, compiladas numa worker thread e guardadas
// em cache em userData/adblock/.
const fs = require("node:fs");
const path = require("node:path");
const { Worker } = require("node:worker_threads");

const VENDOR_FILE = path.join(__dirname, "adblocker.vendor.cjs");
const WORKER_FILE = path.join(__dirname, "adblock-worker.cjs");
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const RETRY_MS = 30 * 60 * 1000;
const EMIT_DELAY_MS = 200;
const MAX_HOSTS_PER_PAGE = 200;

// Espelho das listas do uBlock Origin mantido pelo Ghostery (mesmo formato que o motor
// entende). As listas do uBO trazem os scriptlets do YouTube (json-prune de adPlacements
// etc.): anúncio de vídeo vem do mesmo servidor do vídeo e não dá para barrar só por rede.
const UBO = "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets";
const DEFAULT_LISTS = {
  ads: [
    "https://raw.githubusercontent.com/easylist/easylist/gh-pages/easylist.txt",
    "https://raw.githubusercontent.com/easylistbrasil/easylistbrasil/filtro/easylistbrasil.txt",
    `${UBO}/ublock-origin/filters.txt`,
    `${UBO}/ublock-origin/filters-2020.txt`,
    `${UBO}/ublock-origin/filters-2021.txt`,
    `${UBO}/ublock-origin/filters-2022.txt`,
    `${UBO}/ublock-origin/filters-2023.txt`,
    `${UBO}/ublock-origin/filters-2024.txt`,
    `${UBO}/ublock-origin/quick-fixes.txt`,
    `${UBO}/ublock-origin/unbreak.txt`,
    `${UBO}/ublock-origin/badware.txt`,
    `${UBO}/peter-lowe/serverlist.txt`,
  ],
  privacy: [
    "https://raw.githubusercontent.com/easylist/easylist/gh-pages/easyprivacy.txt",
    `${UBO}/ublock-origin/privacy.txt`,
  ],
  // Código dos scriptlets e dos redirecionamentos (+js(...), $redirect=...).
  resources: `${UBO}/ublock-origin/resources.json`,
};
const CATEGORY_LABEL = { ads: "Anúncios", privacy: "Rastreadores" };
// Verifica rastreadores primeiro: o mesmo host costuma estar nas duas listas.
const CATEGORY_ORDER = ["privacy", "ads"];

// resourceType do Electron → tipo de requisição do motor.
const REQUEST_TYPES = {
  mainFrame: "main_frame",
  subFrame: "sub_frame",
  stylesheet: "stylesheet",
  script: "script",
  image: "image",
  font: "font",
  object: "object",
  xhr: "xmlhttprequest",
  ping: "ping",
  cspReport: "csp_report",
  media: "media",
  webSocket: "websocket",
  other: "other",
};

function requestTypeOf(resourceType) {
  return REQUEST_TYPES[resourceType] ?? "other";
}

/** Mesmo formato de `hostOf` do renderer (sem "www."): é a chave de "pausar neste site". */
function siteHostOf(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// Login nunca passa pelo filtro: o antifraude do Google usa a própria telemetria
// (play.google.com/log, google.com/gen_204…) para avaliar o navegador, e sem ela recusa
// o login ("navegador não seguro"). Vale para a página de login e para quem ela chama.
const AUTH_HOSTS = [
  "accounts.google.com",
  "accounts.youtube.com",
  "myaccount.google.com",
  "appleid.apple.com",
  "idmsa.apple.com",
  "login.microsoftonline.com",
  "login.live.com",
  "account.live.com",
];

function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function isAuthHost(hostname) {
  return (
    hostname !== null &&
    AUTH_HOSTS.some((auth) => hostname === auth || hostname.endsWith(`.${auth}`))
  );
}

/** Página de login ou requisição para um serviço de conta: nunca bloqueia. */
function isAuthFlow(pageUrl, requestUrl) {
  return isAuthHost(hostnameOf(pageUrl)) || isAuthHost(hostnameOf(requestUrl));
}

function isAllowedSite(config, pageUrl) {
  if (!config.enabled) return true;
  if (isAuthHost(hostnameOf(pageUrl))) return true;
  const host = siteHostOf(pageUrl);
  return host !== null && config.pausedHosts.has(host);
}

function listsFromEnv(value) {
  if (!value) return DEFAULT_LISTS;
  try {
    const parsed = JSON.parse(value);
    const pick = (key) =>
      Array.isArray(parsed[key]) ? parsed[key].filter((url) => typeof url === "string") : [];
    const resources = typeof parsed.resources === "string" ? parsed.resources : null;
    return { ads: pick("ads"), privacy: pick("privacy"), resources };
  } catch {
    return DEFAULT_LISTS;
  }
}

function today() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function createAdblock({ userDataDir, database, fetchText, emitPage, emitStats, lists }) {
  let vendor = null;
  try {
    vendor = require(VENDOR_FILE);
  } catch {
    // Sem o bundle (dev sem `desktop:build`): a casca funciona, só não bloqueia.
  }

  const listUrls = lists ?? DEFAULT_LISTS;
  const listsKey = JSON.stringify(listUrls);
  const cacheDir = path.join(userDataDir, "adblock");
  const metaFile = path.join(cacheDir, "meta.json");
  const engines = {};
  const config = { enabled: true, pausedHosts: new Set() };
  // tabId → { hosts: Map<"categoria|host", { host, category }>, count }
  const pages = new Map();
  const pendingEmits = new Map();
  let updatedAt = null;
  let updating = null;
  let retryTimer = null;
  let stats = { day: today(), count: 0 };
  let statsTimer = null;

  const storedStats = database?.getMeta("adblockStats");
  if (storedStats && storedStats.day === today() && Number.isFinite(storedStats.count)) {
    stats = { day: storedStats.day, count: storedStats.count };
  }

  function loadCache() {
    if (!vendor) return false;
    try {
      const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
      if (meta.engineVersion !== vendor.ENGINE_VERSION || meta.listsKey !== listsKey) return false;
      const loaded = {};
      for (const category of CATEGORY_ORDER) {
        const file = path.join(cacheDir, `${category}.bin`);
        if (!fs.existsSync(file)) continue;
        loaded[category] = vendor.FiltersEngine.deserialize(new Uint8Array(fs.readFileSync(file)));
      }
      Object.assign(engines, loaded);
      updatedAt = meta.updatedAt;
      return true;
    } catch {
      return false;
    }
  }

  function compile(texts, resources) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(WORKER_FILE, { workerData: { lists: texts, resources } });
      worker.once("message", resolve);
      worker.once("error", reject);
      worker.once("exit", (code) => {
        if (code !== 0) reject(new Error(`worker saiu com código ${code}`));
      });
    });
  }

  async function update() {
    if (!vendor) return false;
    if (updating) return updating;
    updating = (async () => {
      try {
        const texts = {};
        for (const category of CATEGORY_ORDER) {
          const urls = listUrls[category] ?? [];
          texts[category] = await Promise.all(urls.map((url) => fetchText(url)));
        }
        const resources = listUrls.resources ? await fetchText(listUrls.resources) : null;
        const compiled = await compile(texts, resources);
        fs.mkdirSync(cacheDir, { recursive: true });
        for (const category of CATEGORY_ORDER) {
          if (!compiled[category]) continue;
          const bytes = new Uint8Array(compiled[category]);
          fs.writeFileSync(path.join(cacheDir, `${category}.bin`), bytes);
          engines[category] = vendor.FiltersEngine.deserialize(bytes);
        }
        updatedAt = Date.now();
        fs.writeFileSync(
          metaFile,
          JSON.stringify({ engineVersion: vendor.ENGINE_VERSION, listsKey, updatedAt }),
        );
        emitStats(statsInfo());
        return true;
      } catch (error) {
        console.error("Agzos: não foi possível atualizar as listas de filtros.", error);
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => void update(), RETRY_MS);
        retryTimer.unref?.();
        return false;
      } finally {
        updating = null;
      }
    })();
    return updating;
  }

  function start() {
    const cached = loadCache();
    if (!cached || !updatedAt || Date.now() - updatedAt > MAX_AGE_MS) void update();
  }

  function flushStats() {
    statsTimer = null;
    database?.setMeta("adblockStats", stats);
  }

  function countBlocked(tabId, url, category) {
    if (stats.day !== today()) stats = { day: today(), count: 0 };
    stats.count += 1;
    if (!statsTimer) {
      statsTimer = setTimeout(flushStats, 2000);
      statsTimer.unref?.();
    }
    if (tabId == null) return;
    const page = pages.get(tabId) ?? { hosts: new Map(), count: 0 };
    pages.set(tabId, page);
    page.count += 1;
    const host = siteHostOf(url) ?? "desconhecido";
    const key = `${category}|${host}`;
    if (!page.hosts.has(key) && page.hosts.size < MAX_HOSTS_PER_PAGE) {
      page.hosts.set(key, { host, category: CATEGORY_LABEL[category] });
    }
    scheduleEmit(tabId);
  }

  function pageInfo(tabId) {
    const page = pages.get(tabId);
    return {
      count: page?.count ?? 0,
      trackers: page ? [...page.hosts.values()] : [],
    };
  }

  function scheduleEmit(tabId) {
    if (pendingEmits.has(tabId)) return;
    pendingEmits.set(
      tabId,
      setTimeout(() => {
        pendingEmits.delete(tabId);
        emitPage(tabId, pageInfo(tabId));
        emitStats(statsInfo());
      }, EMIT_DELAY_MS),
    );
  }

  function statsInfo() {
    if (stats.day !== today()) stats = { day: today(), count: 0 };
    return { today: stats.count, updatedAt, ready: Object.keys(engines).length > 0 };
  }

  /**
   * Decide uma requisição. `pageUrl` é a URL da aba (allowlist); `tabId` só serve para a
   * contagem. Devolve true se deve ser cancelada.
   */
  function decide({ url, resourceType, pageUrl, sourceUrl, tabId }) {
    if (resourceType === "mainFrame") return null;
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      if (!url.startsWith("ws://") && !url.startsWith("wss://")) return null;
    }
    if (!vendor || isAllowedSite(config, pageUrl ?? sourceUrl ?? "")) return null;
    if (isAuthFlow(sourceUrl ?? "", url)) return null;
    const request = vendor.Request.fromRawDetails({
      url,
      type: requestTypeOf(resourceType),
      sourceUrl: sourceUrl || pageUrl || "",
    });
    for (const category of CATEGORY_ORDER) {
      const engine = engines[category];
      if (!engine) continue;
      const result = engine.match(request);
      if (!result.match) continue;
      countBlocked(tabId, url, category);
      // $redirect também cancela: o Chromium recusa redirecionar subrecursos para data:
      // (o substituto do uBO precisaria de um protocolo próprio).
      return { cancel: true };
    }
    return null;
  }

  /** Scriptlets (+js) da página, para rodar no mundo da página antes dos scripts dela. */
  function scriptletsFor(pageUrl) {
    const engine = engines.ads;
    if (!engine || !vendor || !/^https?:\/\//.test(pageUrl) || isAllowedSite(config, pageUrl)) {
      return [];
    }
    try {
      const hostname = new URL(pageUrl).hostname;
      const { scripts } = engine.getCosmeticsFilters({
        url: pageUrl,
        hostname,
        domain: domainOf(hostname),
        getBaseRules: false,
        getInjectionRules: true,
        getExtendedRules: false,
        getRulesFromHostname: true,
        getRulesFromDOM: false,
      });
      return Array.isArray(scripts) ? scripts : [];
    } catch {
      return [];
    }
  }

  /**
   * CSS de ocultação para a página (vazio se o escudo não vale aqui). `dom` traz as
   * classes/ids/links da página: os filtros genéricos (`##.anuncio`) casam por eles.
   * `base: false` pede só as regras do DOM (segunda passada, depois do load).
   */
  function cosmeticCss(pageUrl, dom = null, { base = true } = {}) {
    const engine = engines.ads;
    if (!engine || !vendor || isAllowedSite(config, pageUrl)) return "";
    try {
      const hostname = new URL(pageUrl).hostname;
      const list = (value) =>
        Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
      const { styles } = engine.getCosmeticsFilters({
        url: pageUrl,
        hostname,
        domain: domainOf(hostname),
        classes: list(dom?.classes),
        ids: list(dom?.ids),
        hrefs: list(dom?.hrefs),
        getBaseRules: base,
        getInjectionRules: false,
        getExtendedRules: false,
        getRulesFromHostname: base,
        getRulesFromDOM: dom !== null,
      });
      return styles || "";
    } catch {
      return "";
    }
  }

  return {
    start,
    update,
    decide,
    shouldBlock: (details) => decide(details) !== null,
    scriptletsFor,
    cosmeticCss,
    statsInfo,
    pageInfo,
    available: () => vendor !== null,
    setConfig({ enabled, pausedHosts }) {
      if (typeof enabled === "boolean") config.enabled = enabled;
      if (Array.isArray(pausedHosts)) {
        config.pausedHosts = new Set(pausedHosts.filter((host) => typeof host === "string"));
      }
    },
    /** Navegação nova na aba: a contagem por página recomeça. */
    resetPage(tabId) {
      pages.delete(tabId);
      clearTimeout(pendingEmits.get(tabId));
      pendingEmits.delete(tabId);
      emitPage(tabId, pageInfo(tabId));
    },
    forgetTab(tabId) {
      pages.delete(tabId);
      clearTimeout(pendingEmits.get(tabId));
      pendingEmits.delete(tabId);
    },
    close() {
      clearTimeout(retryTimer);
      if (statsTimer) {
        clearTimeout(statsTimer);
        flushStats();
      }
    },
  };
}

// Roda num mundo isolado da página (a página não enxerga nem altera). Limites evitam
// custo alto em páginas enormes.
const COLLECT_DOM_SOURCE = `(() => {
  const classes = new Set(), ids = new Set(), hrefs = new Set();
  const nodes = document.querySelectorAll("[class],[id],a[href]");
  for (let i = 0; i < nodes.length && i < 20000; i++) {
    const node = nodes[i];
    if (node.id) ids.add(node.id);
    if (typeof node.className === "string") {
      for (const name of node.className.split(/\\s+/)) if (name) classes.add(name);
    }
    if (node.tagName === "A" && hrefs.size < 2000) hrefs.add(node.href);
  }
  return { classes: [...classes].slice(0, 10000), ids: [...ids].slice(0, 5000), hrefs: [...hrefs] };
})()`;

// Domínio registrável aproximado (sem lista de sufixos públicos): basta para os
// filtros cosméticos por domínio, que casam também por hostname.
function domainOf(hostname) {
  const parts = hostname.split(".");
  if (parts.length <= 2) return hostname;
  const secondLevel = parts.at(-2);
  const twoPartSuffix = ["com", "net", "org", "gov", "edu", "co"].includes(secondLevel);
  return parts.slice(twoPartSuffix ? -3 : -2).join(".");
}

module.exports = {
  createAdblock,
  requestTypeOf,
  siteHostOf,
  isAllowedSite,
  isAuthFlow,
  listsFromEnv,
  domainOf,
  DEFAULT_LISTS,
  COLLECT_DOM_SOURCE,
};

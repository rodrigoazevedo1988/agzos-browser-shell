// Extensões (4.5): Manifest V3 descompactadas (uma pasta escolhida pelo usuário) e da
// Chrome Web Store (o .crx vira pasta em <userData>/Extensions/<id>). Carregadas só na
// sessão das guias normais; guias anônimas e Session Tabs ficam sem extensão, como a aba
// anônima do Chrome. O storage de cada extensão mora na origem chrome-extension://<id>,
// separado do storage dos sites. A lista fica no SQLite (meta "extensions").

const path = require("node:path");
const { crxDownloadUrl, parseCrx, storeIdOf, unzip } = require("./crx.cjs");

const LIMIT = 60;
const ID_RE = /^[a-p]{32}$/;
const HOST_RE = /^[a-z0-9.-]{1,253}$/i;

/** Origem da aba (https://app.site.com:8080) → host usado no bloqueio (app.site.com). */
function hostOfOrigin(origin) {
  try {
    const url = new URL(origin);
    return /^https?:$/.test(url.protocol) && HOST_RE.test(url.hostname)
      ? url.hostname.toLowerCase()
      : null;
  } catch {
    return null;
  }
}

/**
 * Manifest da cópia de execução: os content scripts não entram nos hosts bloqueados
 * (`exclude_matches`). É o que dá para garantir no Electron (scripts injetados pela
 * extensão via chrome.scripting não passam por aqui).
 */
function patchManifest(manifest, blocked) {
  if (!blocked.length || !Array.isArray(manifest.content_scripts)) return manifest;
  const excludes = blocked.map((host) => `*://${host}/*`);
  return {
    ...manifest,
    content_scripts: manifest.content_scripts.map((entry) => ({
      ...entry,
      exclude_matches: [
        ...new Set([
          ...(Array.isArray(entry.exclude_matches) ? entry.exclude_matches : []),
          ...excludes,
        ]),
      ],
    })),
  };
}

/** Resumo das permissões de site, como no menu do Chrome. */
function accessSummary(manifest) {
  const hosts = [
    ...(Array.isArray(manifest.host_permissions) ? manifest.host_permissions : []),
    ...(Array.isArray(manifest.content_scripts)
      ? manifest.content_scripts.flatMap((entry) =>
          Array.isArray(entry.matches) ? entry.matches : [],
        )
      : []),
  ].filter((item) => typeof item === "string");
  const permissions = (Array.isArray(manifest.permissions) ? manifest.permissions : []).filter(
    (item) => typeof item === "string",
  );
  const everywhere = hosts.some(
    (item) => item === "<all_urls>" || /^(\*|https?):\/\/\*\//.test(item),
  );
  const sites = [...new Set(hosts.filter((item) => item !== "<all_urls>"))];
  let summary;
  if (everywhere) summary = "Pode ler e alterar dados em todos os sites";
  else if (sites.length) {
    summary = `Pode ler e alterar dados em ${sites.length === 1 ? "1 site" : `${sites.length} sites`}`;
  } else if (permissions.includes("activeTab")) summary = "Acessa o site só quando você clica nela";
  else summary = "Não acessa dados dos sites";
  return { summary, everywhere, hosts: sites.slice(0, 50), permissions: permissions.slice(0, 50) };
}

/** Ícone do manifest mais perto de 32 px (action.default_icon ou icons). */
function iconPathOf(manifest) {
  for (const set of [manifest.action?.default_icon, manifest.icons]) {
    if (typeof set === "string") return set;
    if (!set || typeof set !== "object") continue;
    const sizes = Object.keys(set)
      .map(Number)
      .filter((size) => Number.isFinite(size) && typeof set[size] === "string")
      .sort((a, b) => Math.abs(a - 32) - Math.abs(b - 32));
    if (sizes.length) return set[sizes[0]];
  }
  return null;
}

const IMAGE_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function parseRecords(value) {
  const seen = new Set();
  const list = [];
  for (const item of Array.isArray(value) ? value : []) {
    if (!item || typeof item !== "object" || typeof item.dir !== "string" || !item.dir) continue;
    if (!path.isAbsolute(item.dir) || seen.has(item.dir)) continue;
    seen.add(item.dir);
    list.push({
      dir: item.dir,
      id: typeof item.id === "string" && ID_RE.test(item.id) ? item.id : null,
      name: typeof item.name === "string" ? item.name.slice(0, 120) : "",
      version: typeof item.version === "string" ? item.version.slice(0, 40) : "",
      enabled: item.enabled !== false,
      source: item.source === "store" ? "store" : "unpacked",
      storeId: typeof item.storeId === "string" && ID_RE.test(item.storeId) ? item.storeId : null,
      // 4.6: fixada na barra e hosts onde ela não tem acesso.
      pinned: item.pinned === true,
      blocked: [
        ...new Set(
          (Array.isArray(item.blocked) ? item.blocked : []).filter(
            (host) => typeof host === "string" && HOST_RE.test(host),
          ),
        ),
      ].slice(0, 200),
    });
    if (list.length >= LIMIT) break;
  }
  return list;
}

/** Texto do manifest com __MSG_nome__ resolvido pela língua padrão da extensão. */
function localized(value, messages) {
  if (typeof value !== "string") return "";
  const match = /^__MSG_(\w+)__$/.exec(value);
  if (!match) return value;
  const key = Object.keys(messages).find((item) => item.toLowerCase() === match[1].toLowerCase());
  return key && typeof messages[key]?.message === "string" ? messages[key].message : value;
}

/** Pasta → informações do manifest, ou { error } quando não serve. */
function readManifest(dir, fs) {
  let manifest;
  try {
    manifest = JSON.parse(
      fs.readFileSync(path.join(dir, "manifest.json"), "utf8").replace(/^﻿/, ""),
    );
  } catch {
    return { error: "manifest" };
  }
  if (!manifest || typeof manifest !== "object") return { error: "manifest" };
  if (manifest.manifest_version !== 3) return { error: "mv2" };
  let messages = {};
  if (
    typeof manifest.default_locale === "string" &&
    /^[\w-]{2,10}$/.test(manifest.default_locale)
  ) {
    try {
      messages = JSON.parse(
        fs.readFileSync(
          path.join(dir, "_locales", manifest.default_locale, "messages.json"),
          "utf8",
        ),
      );
    } catch {
      messages = {};
    }
  }
  const access = accessSummary(manifest);
  let icon = null;
  const iconPath = iconPathOf(manifest);
  if (iconPath && !iconPath.includes("..")) {
    const type = IMAGE_TYPES[path.extname(iconPath).toLowerCase()];
    try {
      const data = type ? fs.readFileSync(path.join(dir, iconPath.replace(/^\//, ""))) : null;
      if (data && data.length < 512 * 1024) icon = `data:${type};base64,${data.toString("base64")}`;
    } catch {
      icon = null;
    }
  }
  const page = (value) =>
    typeof value === "string" && /^[\w./-]{1,200}$/.test(value) && !value.includes("..")
      ? value
      : null;
  return {
    name: localized(manifest.name, messages).slice(0, 120) || path.basename(dir),
    version: typeof manifest.version === "string" ? manifest.version.slice(0, 40) : "",
    description: localized(manifest.description, messages).slice(0, 300),
    popup: page(manifest.action?.default_popup),
    options: page(manifest.options_page ?? manifest.options_ui?.page),
    icon,
    access,
    manifest,
  };
}

/**
 * `ses`: sessão das guias; `store`: { get(), set(list) } (meta do SQLite);
 * `download(url)` → Buffer do .crx; `extensionsDir`: onde os da loja ficam.
 */
function createExtensions({
  ses,
  fs,
  store,
  download,
  extensionsDir,
  chromeVersion,
  runtimeDir = path.join(path.dirname(extensionsDir), "ExtensionsRuntime"),
  hash = (text) => require("node:crypto").createHash("sha1").update(text).digest("hex"),
}) {
  let records = parseRecords(store.get());
  const errors = new Map();
  const save = () => store.set(records);
  const api = () => ses.extensions ?? ses;

  async function load(record) {
    errors.delete(record.dir);
    const info = readManifest(record.dir, fs);
    if (info.error) {
      errors.set(record.dir, info.error);
      return null;
    }
    Object.assign(record, { name: info.name, version: info.version });
    // 4.6: carrega de uma cópia do app (caminho fixo por extensão: o id não muda) com o
    // manifest ajustado para os sites bloqueados. A pasta do usuário fica intocada.
    let target;
    try {
      target = runtimeOf(record);
      fs.rmSync(target, { recursive: true, force: true });
      fs.cpSync(record.dir, target, {
        recursive: true,
        filter: (source) =>
          !/[\\/](\.git|node_modules)([\\/]|$)/.test(source.slice(record.dir.length)),
      });
      fs.writeFileSync(
        path.join(target, "manifest.json"),
        JSON.stringify(patchManifest(info.manifest, record.blocked), null, 2),
      );
    } catch (error) {
      errors.set(record.dir, String(error?.message ?? "copy").slice(0, 200));
      return null;
    }
    try {
      const extension = await api().loadExtension(target, { allowFileAccess: false });
      record.id = extension.id;
      return extension;
    } catch (error) {
      errors.set(record.dir, String(error?.message ?? "load").slice(0, 200));
      return null;
    }
  }

  function runtimeOf(record) {
    return path.join(runtimeDir, hash(record.dir).slice(0, 20));
  }

  function unload(record) {
    if (record.id && api().getExtension(record.id)) api().removeExtension(record.id);
  }

  function list() {
    return records.map((record) => {
      const info = readManifest(record.dir, fs);
      const loaded = Boolean(record.id && api().getExtension(record.id));
      return {
        dir: record.dir,
        id: record.id,
        name: record.name || info.name || path.basename(record.dir),
        version: record.version || info.version || "",
        description: info.description ?? "",
        enabled: record.enabled,
        loaded,
        source: record.source,
        error: errors.get(record.dir) ?? null,
        popup: loaded && info.popup ? `chrome-extension://${record.id}/${info.popup}` : null,
        options: loaded && info.options ? `chrome-extension://${record.id}/${info.options}` : null,
        icon: info.icon ?? null,
        pinned: record.pinned,
        access: info.access ?? { summary: "", everywhere: false, hosts: [], permissions: [] },
        blocked: [...record.blocked],
      };
    });
  }

  const find = (dir) => records.find((record) => record.dir === dir);

  async function add(dir, extra = {}) {
    const info = readManifest(dir, fs);
    if (info.error) return { ok: false, error: info.error };
    if (find(dir)) return { ok: false, error: "exists" };
    if (records.length >= LIMIT) return { ok: false, error: "limit" };
    const record = {
      dir,
      id: null,
      name: info.name,
      version: info.version,
      enabled: true,
      source: "unpacked",
      storeId: null,
      pinned: false,
      blocked: [],
      ...extra,
    };
    records.push(record);
    const loaded = await load(record);
    save();
    return loaded ? { ok: true, id: record.id } : { ok: false, error: errors.get(dir) ?? "load" };
  }

  return {
    list,
    /** Na abertura do app: carrega as ligadas. */
    async loadAll() {
      for (const record of records) if (record.enabled) await load(record);
      save();
    },
    addUnpacked: (dir) => add(dir),
    /** Id ou URL da Web Store → baixa, descompacta e carrega. */
    async installFromStore(input) {
      const storeId = storeIdOf(input);
      if (!storeId) return { ok: false, error: "id" };
      const existing = records.find((record) => record.storeId === storeId);
      if (existing) return { ok: false, error: "exists" };
      let crx;
      try {
        crx = parseCrx(await download(crxDownloadUrl(storeId, chromeVersion)));
      } catch {
        return { ok: false, error: "download" };
      }
      let files;
      try {
        files = unzip(crx.zip);
      } catch {
        return { ok: false, error: "package" };
      }
      const dir = path.join(extensionsDir, storeId);
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        for (const file of files) {
          const target = path.join(dir, file.name);
          if (!target.startsWith(dir + path.sep)) return { ok: false, error: "package" };
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, file.data);
        }
        // Com a chave da loja, o id da extensão é o mesmo do Chrome.
        if (crx.publicKey) {
          const file = path.join(dir, "manifest.json");
          const manifest = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
          if (!manifest.key) {
            manifest.key = crx.publicKey;
            fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
          }
        }
      } catch {
        return { ok: false, error: "write" };
      }
      const result = await add(dir, { source: "store", storeId });
      if (!result.ok) {
        records = records.filter((record) => record.dir !== dir);
        save();
        fs.rmSync(dir, { recursive: true, force: true });
      }
      return result;
    },
    async setEnabled(dir, enabled) {
      const record = find(dir);
      if (!record) return { ok: false };
      record.enabled = Boolean(enabled);
      if (record.enabled) await load(record);
      else unload(record);
      save();
      return { ok: true };
    },
    async reload(dir) {
      const record = find(dir);
      if (!record) return { ok: false };
      unload(record);
      if (record.enabled) await load(record);
      save();
      return { ok: true };
    },
    remove(dir) {
      const record = find(dir);
      if (!record) return { ok: false };
      unload(record);
      records = records.filter((item) => item !== record);
      fs.rmSync(runtimeOf(record), { recursive: true, force: true });
      // Só a pasta que o app criou (loja) é apagada; a descompactada é do usuário.
      if (record.source === "store" && record.dir.startsWith(extensionsDir + path.sep)) {
        fs.rmSync(record.dir, { recursive: true, force: true });
      }
      errors.delete(dir);
      save();
      return { ok: true };
    },
    /** 4.6: fixa ou desafixa o ícone na barra. */
    setPinned(dir, pinned) {
      const record = find(dir);
      if (!record) return { ok: false };
      record.pinned = Boolean(pinned);
      save();
      return { ok: true };
    },
    /**
     * 4.6: acesso ao site da aba ativa. `allowed: false` tira os content scripts da
     * extensão daquele host (a extensão recarrega com o manifest ajustado).
     */
    async setSiteAccess(dir, origin, allowed) {
      const record = find(dir);
      const host = hostOfOrigin(origin);
      if (!record || !host) return { ok: false };
      const blocked = new Set(record.blocked);
      if (allowed) blocked.delete(host);
      else blocked.add(host);
      record.blocked = [...blocked];
      if (record.enabled) {
        unload(record);
        await load(record);
      }
      save();
      return { ok: true };
    },
    info: (dir) => list().find((item) => item.dir === dir) ?? null,
    /** chrome-extension://<id>/… de uma extensão carregada. */
    isExtensionUrl(url) {
      const match = /^chrome-extension:\/\/([a-p]{32})\//.exec(String(url ?? ""));
      return Boolean(match && api().getExtension(match[1]));
    },
  };
}

module.exports = {
  accessSummary,
  createExtensions,
  hostOfOrigin,
  parseRecords,
  patchManifest,
  readManifest,
};

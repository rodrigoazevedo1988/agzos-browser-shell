// Extensões (4.5): Manifest V3 descompactadas (uma pasta escolhida pelo usuário) e da
// Chrome Web Store (o .crx vira pasta em <userData>/Extensions/<id>). Carregadas só na
// sessão das guias normais; guias anônimas e Session Tabs ficam sem extensão, como a aba
// anônima do Chrome. O storage de cada extensão mora na origem chrome-extension://<id>,
// separado do storage dos sites. A lista fica no SQLite (meta "extensions").

const path = require("node:path");
const { crxDownloadUrl, parseCrx, storeIdOf, unzip } = require("./crx.cjs");

const LIMIT = 60;
const ID_RE = /^[a-p]{32}$/;

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
  };
}

/**
 * `ses`: sessão das guias; `store`: { get(), set(list) } (meta do SQLite);
 * `download(url)` → Buffer do .crx; `extensionsDir`: onde os da loja ficam.
 */
function createExtensions({ ses, fs, store, download, extensionsDir, chromeVersion }) {
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
    try {
      const extension = await api().loadExtension(record.dir, { allowFileAccess: false });
      record.id = extension.id;
      return extension;
    } catch (error) {
      errors.set(record.dir, String(error?.message ?? "load").slice(0, 200));
      return null;
    }
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
      // Só a pasta que o app criou (loja) é apagada; a descompactada é do usuário.
      if (record.source === "store" && record.dir.startsWith(extensionsDir + path.sep)) {
        fs.rmSync(record.dir, { recursive: true, force: true });
      }
      errors.delete(dir);
      save();
      return { ok: true };
    },
    /** chrome-extension://<id>/… de uma extensão carregada. */
    isExtensionUrl(url) {
      const match = /^chrome-extension:\/\/([a-p]{32})\//.exec(String(url ?? ""));
      return Boolean(match && api().getExtension(match[1]));
    },
  };
}

module.exports = { createExtensions, parseRecords, readManifest };

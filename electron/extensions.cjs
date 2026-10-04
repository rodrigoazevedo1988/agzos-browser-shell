// Extensões (4.5): Manifest V3 descompactadas (uma pasta escolhida pelo usuário) e da
// Chrome Web Store (o .crx vira pasta em <userData>/Extensions/<id>). Carregadas só na
// sessão das guias normais; guias anônimas e Session Tabs ficam sem extensão, como a aba
// anônima do Chrome. O storage de cada extensão mora na origem chrome-extension://<id>,
// separado do storage dos sites. A lista fica no SQLite (meta "extensions").

const path = require("node:path");
const {
  compareVersions,
  crxDownloadUrl,
  extensionIdOfKey,
  parseCrx,
  parseUpdateCheck,
  storeIdOf,
  unzip,
  updateCheckUrl,
} = require("./crx.cjs");

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

/** Botão da barra: `action` (MV3) ou `browser_action`/`page_action` (MV2). */
function actionOf(manifest) {
  for (const key of ["action", "browser_action", "page_action"]) {
    if (manifest[key] && typeof manifest[key] === "object") return manifest[key];
  }
  return {};
}

/**
 * 4.6.1: o que o clique no ícone faz, lido do manifest (como no Chrome): o pop-up dela, o
 * painel lateral, as opções ou nada (só fundo, content script ou atalho).
 */
function clickKind({ popup, sidePanel, options }) {
  if (popup) return "popup";
  if (sidePanel) return "sidepanel";
  if (options) return "options";
  return "background";
}

/** Ícone do manifest mais perto de 32 px (o do botão ou icons). */
function iconPathOf(manifest) {
  for (const set of [actionOf(manifest).default_icon, manifest.icons]) {
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

// 4.6.1: limites do pop-up. O máximo é o do Chrome; o mínimo é usável (nunca uma faixa).
const POPUP_LIMITS = { minWidth: 180, minHeight: 64, maxWidth: 800, maxHeight: 600 };

/**
 * Onde o pop-up fica: alinhado à direita do ícone e logo abaixo dele, dentro da área útil
 * da tela. `anchor` é relativo ao conteúdo da janela (`content`, em coordenadas da tela).
 */
function popupPlacement({ anchor, content, workArea, width, height }) {
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const area = workArea ?? content;
  const w = Math.round(
    clamp(width, POPUP_LIMITS.minWidth, Math.min(POPUP_LIMITS.maxWidth, area.width)),
  );
  const y = Math.round(content.y + anchor.y + anchor.height + 4);
  const room = Math.max(POPUP_LIMITS.minHeight, area.y + area.height - y - 8);
  const h = Math.round(
    clamp(height, POPUP_LIMITS.minHeight, Math.min(POPUP_LIMITS.maxHeight, room)),
  );
  const x = Math.round(
    clamp(content.x + anchor.x + anchor.width - w, area.x, area.x + area.width - w),
  );
  return { x, y, width: w, height: h };
}

/**
 * Medida da página do pop-up (roda nela): largura natural do conteúdo e altura nessa
 * largura, sem contar a altura da própria janela (senão ele nunca encolhe).
 */
const POPUP_MEASURE = `(() => {
  const root = document.documentElement, body = document.body;
  if (!body) return null;
  const saved = [root.style.width, root.style.height, root.style.minHeight];
  root.style.width = "max-content";
  const width = Math.ceil(root.getBoundingClientRect().width);
  root.style.width = saved[0];
  root.style.height = "auto";
  root.style.minHeight = "0";
  const style = getComputedStyle(body);
  const height = Math.ceil(Math.max(
    root.getBoundingClientRect().height,
    body.getBoundingClientRect().height + parseFloat(style.marginTop) + parseFloat(style.marginBottom),
  ));
  root.style.height = saved[1];
  root.style.minHeight = saved[2];
  return { width, height, empty: !body.children.length && !body.textContent.trim() };
})()`;

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
  // MV2 ainda carrega no Electron (com aviso); MV1 e o resto não.
  if (manifest.manifest_version !== 3 && manifest.manifest_version !== 2) {
    return { error: "manifest" };
  }
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
  const pages = {
    popup: page(actionOf(manifest).default_popup?.replace(/^\//, "")),
    sidePanel: page(manifest.side_panel?.default_path?.replace(/^\//, "")),
    options: page((manifest.options_ui?.page ?? manifest.options_page)?.replace(/^\//, "")),
  };
  return {
    name: localized(manifest.name, messages).slice(0, 120) || path.basename(dir),
    version: typeof manifest.version === "string" ? manifest.version.slice(0, 40) : "",
    description: localized(manifest.description, messages).slice(0, 300),
    manifestVersion: manifest.manifest_version,
    ...pages,
    kind: clickKind(pages),
    updateUrl:
      typeof manifest.update_url === "string" && /^https:\/\//.test(manifest.update_url)
        ? manifest.update_url
        : null,
    icon,
    access,
    manifest,
  };
}

/**
 * `ses`: sessão das guias; `store`: { get(), set(list) } (meta do SQLite);
 * `download(url)` → Buffer do .crx (erro com `status` quando o servidor responde mal);
 * `fetchText(url)` → texto (consulta de atualização); `extensionsDir`: onde os da loja ficam.
 */
function createExtensions({
  ses,
  fs,
  store,
  download,
  fetchText = null,
  extensionsDir,
  chromeVersion,
  runtimeDir = path.join(path.dirname(extensionsDir), "ExtensionsRuntime"),
  hash = (text) => require("node:crypto").createHash("sha1").update(text).digest("hex"),
}) {
  let records = parseRecords(store.get());
  const errors = new Map();
  // 4.6.1: versão nova encontrada (dir → versão). Só avisa; atualizar é com o usuário.
  const updates = new Map();
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

  /**
   * Baixa o .crx da loja e descompacta em `dir`. Erros que o usuário vê: "notfound" (id
   * que a loja não tem), "proof" (pacote sem a assinatura do autor), "download", "package".
   */
  async function fetchStore(storeId, dir) {
    let data;
    try {
      data = await download(crxDownloadUrl(storeId, chromeVersion));
    } catch (error) {
      return { ok: false, error: [204, 404].includes(error?.status) ? "notfound" : "download" };
    }
    if (!data?.length) return { ok: false, error: "notfound" };
    let crx;
    try {
      crx = parseCrx(data, storeId);
    } catch (error) {
      return { ok: false, error: error?.message === "proof" ? "proof" : "package" };
    }
    let files;
    try {
      files = unzip(crx.zip);
    } catch {
      return { ok: false, error: "package" };
    }
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      for (const file of files) {
        const target = path.join(dir, file.name);
        if (!target.startsWith(dir + path.sep)) {
          fs.rmSync(dir, { recursive: true, force: true });
          return { ok: false, error: "package" };
        }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, file.data);
      }
      // Com a chave do autor, o id da extensão é o mesmo do Chrome (e um não pisa no outro).
      const file = path.join(dir, "manifest.json");
      const manifest = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
      if (crx.publicKey) {
        manifest.key = crx.publicKey;
        fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
      }
    } catch {
      fs.rmSync(dir, { recursive: true, force: true });
      return { ok: false, error: "write" };
    }
    return { ok: true };
  }

  /**
   * Até a 4.6.0 a chave gravada era a do Google (a mesma em toda extensão da loja): todas
   * ficavam com o mesmo id e uma tomava o lugar da outra. Baixa de novo com a chave certa;
   * sem rede, carrega sem a chave (id próprio pelo caminho) até a próxima abertura.
   */
  async function repairStoreKey(record) {
    if (record.source !== "store" || !record.storeId) return;
    const info = readManifest(record.dir, fs);
    const key = info.manifest?.key;
    if (
      typeof key !== "string" ||
      extensionIdOfKey(Buffer.from(key, "base64")) === record.storeId
    ) {
      return;
    }
    const staging = `${record.dir}.update`;
    const fetched = await fetchStore(record.storeId, staging);
    try {
      if (fetched.ok) {
        fs.rmSync(record.dir, { recursive: true, force: true });
        fs.renameSync(staging, record.dir);
      } else {
        delete info.manifest.key;
        fs.writeFileSync(
          path.join(record.dir, "manifest.json"),
          JSON.stringify(info.manifest, null, 2),
        );
      }
    } catch {
      // Fica como estava; a próxima abertura tenta de novo.
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
        sidePanel:
          loaded && info.sidePanel ? `chrome-extension://${record.id}/${info.sidePanel}` : null,
        kind: info.kind ?? "background",
        manifestVersion: info.manifestVersion ?? null,
        update: updates.get(record.dir) ?? null,
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
      for (const record of records) {
        if (record.enabled) await repairStoreKey(record);
        if (record.enabled) await load(record);
      }
      save();
    },
    addUnpacked: (dir) => add(dir),
    /** Id ou URL da Web Store → baixa, descompacta e carrega. */
    async installFromStore(input) {
      const storeId = storeIdOf(input);
      if (!storeId) return { ok: false, error: "id" };
      const existing = records.find((record) => record.storeId === storeId);
      if (existing) return { ok: false, error: "exists" };
      const dir = path.join(extensionsDir, storeId);
      const fetched = await fetchStore(storeId, dir);
      if (!fetched.ok) return fetched;
      const result = await add(dir, { source: "store", storeId });
      if (!result.ok) {
        records = records.filter((record) => record.dir !== dir);
        save();
        fs.rmSync(dir, { recursive: true, force: true });
      }
      return result;
    },
    /**
     * 4.6.1: consulta a update_url de cada extensão com id conhecido (loja ou "key" no
     * manifest). Não instala nada: guarda a versão nova para a badge e o "Atualizar".
     */
    async checkUpdates() {
      if (!fetchText) return 0;
      for (const record of records) {
        const info = readManifest(record.dir, fs);
        const id = record.storeId ?? (info.manifest?.key ? record.id : null);
        if (info.error || !info.updateUrl || !id) continue;
        try {
          const offered = parseUpdateCheck(
            await fetchText(updateCheckUrl(info.updateUrl, id, info.version, chromeVersion)),
            id,
          );
          if (offered && compareVersions(offered, info.version) > 0) {
            updates.set(record.dir, offered);
          } else updates.delete(record.dir);
        } catch {
          // Sem rede: tenta na próxima rodada.
        }
      }
      return updates.size;
    },
    /** 4.6.1: baixa a versão nova da loja e recarrega (fixada e acessos continuam). */
    async update(dir) {
      const record = find(dir);
      if (!record || record.source !== "store" || !record.storeId) {
        return { ok: false, error: "id" };
      }
      const staging = `${record.dir}.update`;
      const fetched = await fetchStore(record.storeId, staging);
      if (!fetched.ok) return fetched;
      unload(record);
      try {
        fs.rmSync(record.dir, { recursive: true, force: true });
        fs.renameSync(staging, record.dir);
      } catch {
        fs.rmSync(staging, { recursive: true, force: true });
        return { ok: false, error: "write" };
      }
      updates.delete(record.dir);
      const loaded = record.enabled ? await load(record) : null;
      save();
      return record.enabled && !loaded
        ? { ok: false, error: errors.get(dir) ?? "load" }
        : { ok: true, id: record.id };
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
  POPUP_LIMITS,
  POPUP_MEASURE,
  popupPlacement,
  accessSummary,
  actionOf,
  clickKind,
  createExtensions,
  hostOfOrigin,
  parseRecords,
  patchManifest,
  readManifest,
};

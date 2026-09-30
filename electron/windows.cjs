// Janelas do navegador (1.7): a sessão (guias) e a posição de cada janela ficam no SQLite
// (kv "meta:windows") e são gravadas a cada mudança, não só ao sair: depois de um crash o
// app volta com todas as janelas. O marcador "meta:running" diz se a última execução
// terminou direito.

const HOME_ENTRY = { title: "Nova aba", url: "agzos://inicio", kind: "home" };
const MAX_WINDOWS = 20;
// Execução que caiu antes disso travou logo ao abrir (provavelmente ao restaurar): a
// próxima abre em modo seguro, sem carregar as páginas.
const STABLE_AFTER_MS = 60 * 1000;
const MIN_VISIBLE = { width: 120, height: 60 };

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

function validBounds(bounds) {
  if (!isObject(bounds)) return null;
  const { x, y, width, height } = bounds;
  if (![x, y, width, height].every(Number.isFinite) || width < 200 || height < 150) return null;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function validSession(session) {
  if (!isObject(session) || !Array.isArray(session.tabs)) return null;
  return {
    tabs: session.tabs,
    activeId: Number.isSafeInteger(session.activeId) ? session.activeId : null,
    // 2.0: a casca valida o conteúdo (persistence/snapshot.ts); aqui só a forma.
    ...(Array.isArray(session.groups) ? { groups: session.groups } : {}),
    ...(Array.isArray(session.workspaces) ? { workspaces: session.workspaces } : {}),
    ...(isObject(session.split) ? { split: session.split } : {}),
  };
}

function parseRecords(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const records = [];
  for (const item of value) {
    if (!isObject(item) || typeof item.key !== "string" || !item.key || seen.has(item.key)) {
      continue;
    }
    seen.add(item.key);
    records.push({
      key: item.key,
      bounds: validBounds(item.bounds),
      maximized: item.maximized === true,
      session: validSession(item.session),
    });
    if (records.length >= MAX_WINDOWS) break;
  }
  return records;
}

/**
 * Posição salva só vale se uma parte razoável da janela cai numa tela atual (monitor
 * desconectado, resolução menor): senão a janela abre no lugar padrão.
 */
function fitBounds(bounds, workAreas) {
  const rect = validBounds(bounds);
  if (!rect || !Array.isArray(workAreas)) return null;
  const visible = workAreas.some((area) => {
    const width = Math.min(rect.x + rect.width, area.x + area.width) - Math.max(rect.x, area.x);
    const height = Math.min(rect.y + rect.height, area.y + area.height) - Math.max(rect.y, area.y);
    return width >= MIN_VISIBLE.width && height >= MIN_VISIBLE.height;
  });
  return visible ? rect : null;
}

/** Janela nova ao lado da atual (como no Chrome), sem sair da tela. */
function cascadeBounds(bounds, workArea, offset = 30) {
  const rect = validBounds(bounds);
  if (!rect) return null;
  const next = { ...rect, x: rect.x + offset, y: rect.y + offset };
  if (workArea) {
    if (next.x + next.width > workArea.x + workArea.width) next.x = workArea.x;
    if (next.y + next.height > workArea.y + workArea.height) next.y = workArea.y;
  }
  return next;
}

/**
 * Modo seguro: as guias voltam, mas a ativa passa a ser uma "Nova aba" (nenhuma página
 * carrega sozinha; as outras só carregam quando o usuário abrir).
 */
function safeSession(session) {
  const valid = validSession(session);
  if (!valid || !valid.tabs.length) return valid;
  const ids = valid.tabs.map((tab) => (Number.isSafeInteger(tab?.id) ? tab.id : 0));
  const id = Math.max(0, ...ids) + 1;
  return {
    ...valid,
    tabs: [...valid.tabs, { id, history: [HOME_ENTRY], index: 0 }],
    activeId: id,
    split: null,
  };
}

function tabCount(records) {
  return records.reduce((sum, record) => sum + (record.session?.tabs.length ?? 0), 0);
}

/**
 * `database` precisa de getMeta/setMeta/loadState (db.cjs). `schedule` troca o
 * setTimeout nos testes.
 */
function createWindowStore({
  database,
  now = Date.now,
  delayMs = 400,
  schedule = (work, ms) => setTimeout(work, ms),
  cancel = (timer) => clearTimeout(timer),
}) {
  let records = [];
  let timer = null;
  let sequence = 0;

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
      return true;
    } catch (error) {
      console.error(`Agzos: não foi possível gravar ${key}.`, error);
      return false;
    }
  };

  function flush() {
    if (timer !== null) cancel(timer);
    timer = null;
    return write("windows", records);
  }

  function scheduleSave() {
    if (timer !== null) cancel(timer);
    timer = schedule(() => {
      timer = null;
      flush();
    }, delayMs);
    timer?.unref?.();
  }

  function newKey() {
    const taken = new Set(records.map((record) => record.key));
    let key;
    do key = `w${now().toString(36)}${(sequence++).toString(36)}`;
    while (taken.has(key));
    return key;
  }

  return {
    /**
     * Janelas da última execução. Antes da 1.7 a sessão ficava na seção "session" do
     * renderer (uma janela só): ela vira a primeira janela.
     */
    load() {
      records = parseRecords(read("windows"));
      if (!records.length) {
        let legacy = null;
        try {
          legacy = validSession(database?.loadState().session);
        } catch {
          legacy = null;
        }
        if (legacy?.tabs.length) {
          records = [{ key: newKey(), bounds: null, maximized: false, session: legacy }];
          flush();
        }
      }
      return records.map((record) => ({ ...record }));
    },
    list() {
      return records.map((record) => ({ ...record }));
    },
    get(key) {
      const record = records.find((item) => item.key === key);
      return record ? { ...record } : null;
    },
    /** Registra uma janela (nova ou restaurada) e devolve a chave dela. */
    add({ key, bounds = null, maximized = false, session = null } = {}) {
      const record = {
        key: key && !records.some((item) => item.key === key) ? key : newKey(),
        bounds: validBounds(bounds),
        maximized: Boolean(maximized),
        session: validSession(session),
      };
      records.push(record);
      scheduleSave();
      return record.key;
    },
    update(key, patch) {
      const record = records.find((item) => item.key === key);
      if (!record) return false;
      if ("session" in patch) record.session = validSession(patch.session);
      if ("bounds" in patch) record.bounds = validBounds(patch.bounds) ?? record.bounds;
      if ("maximized" in patch) record.maximized = Boolean(patch.maximized);
      scheduleSave();
      return true;
    },
    remove(key) {
      const before = records.length;
      records = records.filter((item) => item.key !== key);
      if (records.length !== before) scheduleSave();
    },
    flush,

    /**
     * Começa uma execução. Devolve como a anterior terminou: `unclean` quando o app não
     * fechou direito (crash, energia, processo encerrado) e `early` quando caiu logo
     * depois de abrir.
     */
    beginRun() {
      const previous = read("running");
      const result = {
        unclean: isObject(previous),
        early: isObject(previous) && previous.stable !== true,
      };
      write("running", { startedAt: now(), stable: false });
      return result;
    },
    markStable() {
      const current = read("running");
      if (isObject(current)) write("running", { ...current, stable: true });
    },
    /** Saída normal: o marcador sai (a próxima execução não mostra o aviso). */
    endRun() {
      flush();
      write("running", null);
    },
  };
}

module.exports = {
  createWindowStore,
  fitBounds,
  cascadeBounds,
  safeSession,
  tabCount,
  parseRecords,
  STABLE_AFTER_MS,
  MAX_WINDOWS,
};

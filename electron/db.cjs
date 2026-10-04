// Banco local do navegador (userData/agzos.db). Usa o SQLite embutido no Node do
// Electron (node:sqlite): sem módulo nativo, então o build que copia só electron/*.cjs
// continua funcionando. Novas tabelas entram como migrations no fim da lista.
const MIGRATIONS = [
  {
    version: 1,
    name: "kv",
    sql: `CREATE TABLE kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
  },
  {
    version: 2,
    name: "downloads",
    sql: `CREATE TABLE downloads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      filename TEXT NOT NULL,
      path TEXT NOT NULL,
      mime TEXT NOT NULL DEFAULT '',
      total_bytes INTEGER NOT NULL DEFAULT 0,
      received_bytes INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER
    )`,
  },
  {
    version: 3,
    name: "site_settings",
    sql: `CREATE TABLE site_settings (
      host TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (host, key)
    )`,
  },
  {
    version: 4,
    name: "history",
    sql: `CREATE TABLE history_urls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL DEFAULT '',
      icon TEXT,
      visit_count INTEGER NOT NULL DEFAULT 0,
      last_visit INTEGER NOT NULL
    );
    CREATE TABLE history_visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url_id INTEGER NOT NULL,
      visited_at INTEGER NOT NULL
    );
    CREATE INDEX history_visits_time ON history_visits (visited_at);
    CREATE INDEX history_visits_url ON history_visits (url_id);
    CREATE INDEX history_urls_last ON history_urls (last_visit)`,
  },
  {
    // 4.7: etiquetas e o que o Chromium precisa para retomar com Range (ETag,
    // Last-Modified e a cadeia de redirecionamentos).
    version: 5,
    name: "downloads_manager",
    sql: `ALTER TABLE downloads ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE downloads ADD COLUMN etag TEXT NOT NULL DEFAULT '';
    ALTER TABLE downloads ADD COLUMN last_modified TEXT NOT NULL DEFAULT '';
    ALTER TABLE downloads ADD COLUMN url_chain TEXT NOT NULL DEFAULT '[]'`,
  },
];

// Como o Chrome: o histórico guarda 90 dias.
const HISTORY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
// Recarga, pushState repetido: a mesma página em menos de 30 s é a mesma visita.
const SAME_VISIT_MS = 30 * 1000;
const HISTORY_PAGE_LIMIT = 200;

/** Termos da busca para LIKE, com %, _ e \ escapados. */
function likeTerms(text) {
  return String(text ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .map((term) => `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`);
}

function historyFilter(terms, columns) {
  if (!terms.length) return { where: "", params: [] };
  const clause = terms
    .map(() => `(${columns.map((column) => `lower(${column}) LIKE ? ESCAPE '\\'`).join(" OR ")})`)
    .join(" AND ");
  return {
    where: clause,
    params: terms.flatMap((term) => columns.map(() => term)),
  };
}

const DOWNLOAD_STATES = ["progressing", "completed", "cancelled", "interrupted"];
// 4.7: o gerenciador busca no histórico local (nome, URL, domínio, etiqueta).
const DOWNLOAD_LIMIT = 2000;

// Seções do snapshot da casca que o renderer pode ler e gravar (ver persistence/snapshot.ts).
const STATE_SECTIONS = [
  "version",
  "prefs",
  "session",
  "links",
  "closedTabs",
  "bookmarks",
  "dial",
  // 4.5: notas por página.
  "notes",
  // 4.7: ColorTools (histórico e paletas).
  "colors",
];
const MAX_STATE_BYTES = 2 * 1024 * 1024;

function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  )`);
  const applied = new Set(
    db
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map((row) => row.version),
  );
  const record = db.prepare(
    "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
  );
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.exec("BEGIN");
    try {
      db.exec(migration.sql);
      record.run(migration.version, migration.name, Date.now());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

function openDatabase(file) {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  migrate(db);

  const select = db.prepare("SELECT key, value FROM kv");
  const upsert = db.prepare(
    `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );

  const upsertSetting = db.prepare(
    `INSERT INTO site_settings (host, key, value, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(host, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  const selectSetting = db.prepare("SELECT value FROM site_settings WHERE host = ? AND key = ?");
  const deleteSetting = db.prepare("DELETE FROM site_settings WHERE host = ? AND key = ?");
  const insertDownload = db.prepare(
    `INSERT INTO downloads (url, filename, path, mime, total_bytes, received_bytes, state, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const updateDownload = db.prepare(
    `UPDATE downloads SET filename = ?, path = ?, total_bytes = ?, received_bytes = ?, state = ?,
       ended_at = ?, tags = ?, etag = ?, last_modified = ?, url_chain = ? WHERE id = ?`,
  );
  const jsonList = (value) => {
    try {
      const list = JSON.parse(value || "[]");
      return Array.isArray(list) ? list.filter((item) => typeof item === "string") : [];
    } catch {
      return [];
    }
  };

  // Download que estava em andamento quando o app fechou não tem como continuar.
  db.prepare(
    "UPDATE downloads SET state = 'interrupted', ended_at = ? WHERE state = 'progressing'",
  ).run(Date.now());

  const selectUrl = db.prepare("SELECT id, title FROM history_urls WHERE url = ?");
  const insertUrl = db.prepare(
    "INSERT INTO history_urls (url, title, icon, visit_count, last_visit) VALUES (?, ?, ?, 1, ?)",
  );
  const bumpUrl = db.prepare(
    `UPDATE history_urls SET visit_count = visit_count + 1, last_visit = ?,
       title = CASE WHEN ? != '' THEN ? ELSE title END,
       icon = COALESCE(?, icon)
     WHERE id = ?`,
  );
  const lastVisitOf = db.prepare(
    "SELECT id, visited_at FROM history_visits WHERE url_id = ? ORDER BY visited_at DESC LIMIT 1",
  );
  const insertVisit = db.prepare("INSERT INTO history_visits (url_id, visited_at) VALUES (?, ?)");
  const touchVisit = db.prepare("UPDATE history_visits SET visited_at = ? WHERE id = ?");

  /** Recalcula contagem e última visita depois de apagar visitas; tira as páginas sem visita. */
  function recountHistory() {
    db.exec(`UPDATE history_urls SET
        visit_count = (SELECT COUNT(*) FROM history_visits v WHERE v.url_id = history_urls.id),
        last_visit = COALESCE(
          (SELECT MAX(visited_at) FROM history_visits v WHERE v.url_id = history_urls.id),
          last_visit)`);
    db.exec("DELETE FROM history_urls WHERE visit_count = 0");
  }

  function transaction(work) {
    db.exec("BEGIN");
    try {
      const result = work();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  transaction(() => {
    db.prepare("DELETE FROM history_visits WHERE visited_at < ?").run(
      Date.now() - HISTORY_RETENTION_MS,
    );
    recountHistory();
  });

  return {
    schemaVersion() {
      return db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version;
    },
    loadState() {
      const sections = {};
      for (const row of select.all()) {
        if (!STATE_SECTIONS.includes(row.key)) continue;
        try {
          sections[row.key] = JSON.parse(row.value);
        } catch {
          // Linha corrompida: o renderer usa o padrão daquela seção.
        }
      }
      return sections;
    },
    saveState(sections) {
      if (typeof sections !== "object" || sections === null || Array.isArray(sections)) {
        return false;
      }
      const entries = [];
      let size = 0;
      for (const key of STATE_SECTIONS) {
        if (!(key in sections)) continue;
        const value = JSON.stringify(sections[key] ?? null);
        size += value.length;
        entries.push([key, value]);
      }
      if (!entries.length || size > MAX_STATE_BYTES) return false;
      const now = Date.now();
      db.exec("BEGIN");
      try {
        for (const [key, value] of entries) upsert.run(key, value, now);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return true;
    },
    /** Valores internos do main (fora das seções do renderer). */
    getMeta(key) {
      const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(`meta:${key}`);
      if (!row) return null;
      try {
        return JSON.parse(row.value);
      } catch {
        return null;
      }
    },
    setMeta(key, value) {
      upsert.run(`meta:${key}`, JSON.stringify(value), Date.now());
    },
    getSiteSetting(host, key) {
      const row = selectSetting.get(host, key);
      if (!row) return null;
      try {
        return JSON.parse(row.value);
      } catch {
        return null;
      }
    },
    setSiteSetting(host, key, value) {
      if (value === null || value === undefined) deleteSetting.run(host, key);
      else upsertSetting.run(host, key, JSON.stringify(value), Date.now());
    },
    /** Valores de um tipo (prefixo da chave) em todos os sites, ex.: "permission:". */
    listSiteSettings(keyPrefix) {
      return db
        .prepare(
          `SELECT host, key, value, updated_at AS updatedAt FROM site_settings
           WHERE substr(key, 1, ?) = ? ORDER BY host, key`,
        )
        .all(keyPrefix.length, keyPrefix)
        .flatMap((row) => {
          try {
            return [{ ...row, value: JSON.parse(row.value) }];
          } catch {
            return [];
          }
        });
    },
    deleteSiteSettings(host, keyPrefix) {
      db.prepare("DELETE FROM site_settings WHERE host = ? AND substr(key, 1, ?) = ?").run(
        host,
        keyPrefix.length,
        keyPrefix,
      );
    },
    /**
     * Registra a visita (nunca chamada para aba anônima). A mesma página de novo em menos
     * de 30 s conta como a mesma visita. Devolve o id da visita.
     */
    addVisit({ url, title = "", icon = null, at = Date.now() }) {
      return transaction(() => {
        const existing = selectUrl.get(url);
        if (!existing) {
          const inserted = insertUrl.run(url, title, icon, at);
          return Number(insertVisit.run(Number(inserted.lastInsertRowid), at).lastInsertRowid);
        }
        const last = lastVisitOf.get(existing.id);
        if (last && at - last.visited_at < SAME_VISIT_MS) {
          touchVisit.run(at, last.id);
          db.prepare(
            `UPDATE history_urls SET last_visit = ?,
               title = CASE WHEN ? != '' THEN ? ELSE title END, icon = COALESCE(?, icon)
             WHERE id = ?`,
          ).run(at, title, title, icon, existing.id);
          return Number(last.id);
        }
        bumpUrl.run(at, title, title, icon, existing.id);
        return Number(insertVisit.run(existing.id, at).lastInsertRowid);
      });
    },
    updateHistoryTitle(url, title) {
      if (title) db.prepare("UPDATE history_urls SET title = ? WHERE url = ?").run(title, url);
    },
    updateHistoryIcon(url, icon) {
      if (icon) db.prepare("UPDATE history_urls SET icon = ? WHERE url = ?").run(icon, url);
    },
    /** Visitas da mais nova para a mais antiga; `before` pagina ("carregar mais"). */
    listHistory({ text = "", before = null, limit = 100 } = {}) {
      const filter = historyFilter(likeTerms(text), ["u.url", "u.title"]);
      const where = [filter.where, before ? "v.visited_at < ?" : ""].filter(Boolean);
      return db
        .prepare(
          `SELECT v.id, u.url, u.title, u.icon, v.visited_at AS visitedAt
           FROM history_visits v JOIN history_urls u ON u.id = v.url_id
           ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
           ORDER BY v.visited_at DESC, v.id DESC LIMIT ?`,
        )
        .all(
          ...filter.params,
          ...(before ? [before] : []),
          Math.min(Math.max(1, limit), HISTORY_PAGE_LIMIT),
        );
    },
    /** Páginas que casam com o texto, para a omnibox (a ordem final é feita na casca). */
    searchHistory(text, limit = 40) {
      const terms = likeTerms(text);
      if (!terms.length) return [];
      const filter = historyFilter(terms, ["url", "title"]);
      return db
        .prepare(
          `SELECT url, title, icon, visit_count AS visitCount, last_visit AS lastVisit
           FROM history_urls WHERE ${filter.where}
           ORDER BY visit_count DESC, last_visit DESC LIMIT ?`,
        )
        .all(...filter.params, Math.min(Math.max(1, limit), 100));
    },
    deleteVisits(ids) {
      const valid = (Array.isArray(ids) ? ids : []).filter(Number.isInteger).slice(0, 1000);
      if (!valid.length) return;
      transaction(() => {
        const remove = db.prepare("DELETE FROM history_visits WHERE id = ?");
        for (const id of valid) remove.run(id);
        recountHistory();
      });
    },
    /** Tira a página inteira do histórico (Shift+Delete na sugestão da omnibox). */
    deleteHistoryUrl(url) {
      transaction(() => {
        const row = selectUrl.get(url);
        if (!row) return;
        db.prepare("DELETE FROM history_visits WHERE url_id = ?").run(row.id);
        db.prepare("DELETE FROM history_urls WHERE id = ?").run(row.id);
      });
    },
    /** Apaga as visitas entre `from` e `to` (ms); sem limites, apaga tudo. */
    clearHistory({ from = 0, to = Number.MAX_SAFE_INTEGER } = {}) {
      transaction(() => {
        db.prepare("DELETE FROM history_visits WHERE visited_at >= ? AND visited_at <= ?").run(
          from,
          to,
        );
        recountHistory();
      });
    },
    listDownloads() {
      return db
        .prepare(
          `SELECT id, url, filename, path, mime, total_bytes AS totalBytes,
             received_bytes AS receivedBytes, state, started_at AS startedAt, ended_at AS endedAt,
             tags, etag, last_modified AS lastModified, url_chain AS urlChain
           FROM downloads ORDER BY id DESC LIMIT ?`,
        )
        .all(DOWNLOAD_LIMIT)
        .map((row) => ({ ...row, tags: jsonList(row.tags), urlChain: jsonList(row.urlChain) }));
    },
    addDownload(record) {
      const result = insertDownload.run(
        record.url,
        record.filename,
        record.path,
        record.mime ?? "",
        record.totalBytes ?? 0,
        record.receivedBytes ?? 0,
        DOWNLOAD_STATES.includes(record.state) ? record.state : "progressing",
        record.startedAt ?? Date.now(),
      );
      return Number(result.lastInsertRowid);
    },
    updateDownload(id, record) {
      updateDownload.run(
        record.filename,
        record.path,
        record.totalBytes ?? 0,
        record.receivedBytes ?? 0,
        DOWNLOAD_STATES.includes(record.state) ? record.state : "interrupted",
        record.endedAt ?? null,
        JSON.stringify(Array.isArray(record.tags) ? record.tags : []),
        String(record.etag ?? ""),
        String(record.lastModified ?? ""),
        JSON.stringify(Array.isArray(record.urlChain) ? record.urlChain : []),
        id,
      );
    },
    removeDownload(id) {
      db.prepare("DELETE FROM downloads WHERE id = ?").run(id);
    },
    clearDownloads() {
      db.prepare("DELETE FROM downloads WHERE state != 'progressing'").run();
    },
    close() {
      db.close();
    },
  };
}

module.exports = { openDatabase, MIGRATIONS, STATE_SECTIONS, HISTORY_RETENTION_MS };

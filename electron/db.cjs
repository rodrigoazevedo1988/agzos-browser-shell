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
];

const DOWNLOAD_STATES = ["progressing", "completed", "cancelled", "interrupted"];
const DOWNLOAD_LIMIT = 200;

// Seções do snapshot da casca que o renderer pode ler e gravar (ver persistence/snapshot.ts).
const STATE_SECTIONS = ["version", "prefs", "session", "links", "closedTabs"];
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
       ended_at = ? WHERE id = ?`,
  );

  // Download que estava em andamento quando o app fechou não tem como continuar.
  db.prepare(
    "UPDATE downloads SET state = 'interrupted', ended_at = ? WHERE state = 'progressing'",
  ).run(Date.now());

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
    listDownloads() {
      return db
        .prepare(
          `SELECT id, url, filename, path, mime, total_bytes AS totalBytes,
             received_bytes AS receivedBytes, state, started_at AS startedAt, ended_at AS endedAt
           FROM downloads ORDER BY id DESC LIMIT ?`,
        )
        .all(DOWNLOAD_LIMIT);
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

module.exports = { openDatabase, MIGRATIONS, STATE_SECTIONS };

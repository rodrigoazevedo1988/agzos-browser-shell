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
];

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
    close() {
      db.close();
    },
  };
}

module.exports = { openDatabase, MIGRATIONS, STATE_SECTIONS };

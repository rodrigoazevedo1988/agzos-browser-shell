// Banco das Contas Agzos (bun:sqlite, WAL). Mudança de esquema entra como uma nova
// entrada de MIGRATIONS; nunca edite uma migração já aplicada.
import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";

export const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        plan TEXT NOT NULL DEFAULT 'free',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        failed_logins INTEGER NOT NULL DEFAULT 0,
        login_locked_until INTEGER NOT NULL DEFAULT 0,
        failed_recoveries INTEGER NOT NULL DEFAULT 0,
        recovery_locked_until INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        device TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX sessions_user ON sessions(user_id);
      CREATE TABLE recovery_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        used_at INTEGER
      );
      CREATE INDEX recovery_codes_user ON recovery_codes(user_id);
    `,
  },
];

export function openDatabase(file: string): Database {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file, { create: true, strict: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  migrate(db);
  if (file !== ":memory:") {
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      // Sistema de arquivos sem permissões POSIX.
    }
  }
  return db;
}

export function migrate(db: Database): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);",
  );
  const applied = new Set(
    db
      .query("SELECT version FROM schema_migrations")
      .all()
      .map((row) => (row as { version: number }).version),
  );
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      db.query("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
        migration.version,
        Date.now(),
      );
    })();
  }
}

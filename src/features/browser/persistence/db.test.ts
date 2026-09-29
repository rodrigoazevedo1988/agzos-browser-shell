import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

type Database = {
  schemaVersion(): number;
  loadState(): Record<string, unknown>;
  saveState(sections: unknown): boolean;
  close(): void;
};

const require = createRequire(import.meta.url);
const { openDatabase, MIGRATIONS } = require("../../../../electron/db.cjs") as {
  openDatabase: (file: string) => Database;
  MIGRATIONS: { version: number }[];
};

const dirs: string[] = [];
function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agzos-db-"));
  dirs.push(dir);
  return path.join(dir, "agzos.db");
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("electron/db.cjs", () => {
  it("aplica as migrations uma vez e reabre sem reaplicar", () => {
    const file = tempFile();
    const first = openDatabase(file);
    expect(first.schemaVersion()).toBe(MIGRATIONS.at(-1)!.version);
    first.close();
    const again = openDatabase(file);
    expect(again.schemaVersion()).toBe(MIGRATIONS.at(-1)!.version);
    again.close();
  });

  it("grava e lê só as seções conhecidas, persistindo entre aberturas", () => {
    const file = tempFile();
    const db = openDatabase(file);
    expect(db.loadState()).toEqual({});
    expect(
      db.saveState({ version: 1, prefs: { dark: true }, session: { tabs: [] }, intruso: "x" }),
    ).toBe(true);
    expect(db.saveState({ prefs: { dark: false } })).toBe(true);
    db.close();
    const reopened = openDatabase(file);
    expect(reopened.loadState()).toEqual({
      version: 1,
      prefs: { dark: false },
      session: { tabs: [] },
    });
    reopened.close();
  });

  it("recusa payload inválido ou grande demais", () => {
    const db = openDatabase(tempFile());
    expect(db.saveState(null)).toBe(false);
    expect(db.saveState([1, 2])).toBe(false);
    expect(db.saveState({ intruso: 1 })).toBe(false);
    expect(db.saveState({ session: "x".repeat(3 * 1024 * 1024) })).toBe(false);
    expect(db.loadState()).toEqual({});
    db.close();
  });
});

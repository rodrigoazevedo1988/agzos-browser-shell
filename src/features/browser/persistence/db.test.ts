import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

type DownloadRow = {
  id: number;
  url: string;
  filename: string;
  path: string;
  state: string;
  receivedBytes: number;
  totalBytes: number;
  endedAt: number | null;
};

type Database = {
  schemaVersion(): number;
  loadState(): Record<string, unknown>;
  saveState(sections: unknown): boolean;
  getMeta(key: string): unknown;
  setMeta(key: string, value: unknown): void;
  getSiteSetting(host: string, key: string): unknown;
  setSiteSetting(host: string, key: string, value: unknown): void;
  listDownloads(): DownloadRow[];
  addDownload(record: Partial<DownloadRow>): number;
  updateDownload(id: number, record: Partial<DownloadRow>): void;
  removeDownload(id: number): void;
  clearDownloads(): void;
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

  it("migrations v2 e v3 criam downloads e site_settings", () => {
    const db = openDatabase(tempFile());
    expect(MIGRATIONS.map((migration) => migration.version)).toEqual([1, 2, 3]);
    db.setSiteSetting("exemplo.com", "zoom", 1.25);
    expect(db.getSiteSetting("exemplo.com", "zoom")).toBe(1.25);
    db.setSiteSetting("exemplo.com", "zoom", null);
    expect(db.getSiteSetting("exemplo.com", "zoom")).toBeNull();
    db.close();
  });

  it("meta do main não vaza para o estado do renderer", () => {
    const db = openDatabase(tempFile());
    db.setMeta("adblockStats", { day: "2026-09-29", count: 3 });
    expect(db.getMeta("adblockStats")).toEqual({ day: "2026-09-29", count: 3 });
    expect(db.loadState()).toEqual({});
    db.close();
  });

  it("downloads: grava, atualiza, remove e marca como interrompido o que ficou pela metade", () => {
    const file = tempFile();
    const db = openDatabase(file);
    const base = { url: "https://x.test/a.pdf", filename: "a.pdf", path: "/tmp/a.pdf" };
    const done = db.addDownload({ ...base, state: "progressing" });
    const running = db.addDownload({ ...base, filename: "b.zip", state: "progressing" });
    db.updateDownload(done, { ...base, state: "completed", receivedBytes: 10, totalBytes: 10 });
    expect(db.listDownloads().map((row) => row.id)).toEqual([running, done]);
    db.close();

    const reopened = openDatabase(file);
    const rows = reopened.listDownloads();
    expect(rows.find((row) => row.id === running)?.state).toBe("interrupted");
    expect(rows.find((row) => row.id === done)?.state).toBe("completed");
    reopened.removeDownload(done);
    expect(reopened.listDownloads().map((row) => row.id)).toEqual([running]);
    reopened.clearDownloads();
    expect(reopened.listDownloads()).toEqual([]);
    reopened.close();
  });
});

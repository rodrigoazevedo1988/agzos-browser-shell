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
  listSiteSettings(prefix: string): { host: string; key: string; value: unknown }[];
  deleteSiteSettings(host: string, prefix: string): void;
  addVisit(visit: { url: string; title?: string; icon?: string | null; at?: number }): number;
  updateHistoryTitle(url: string, title: string): void;
  listHistory(query?: { text?: string; before?: number | null; limit?: number }): {
    id: number;
    url: string;
    title: string;
    visitedAt: number;
  }[];
  searchHistory(
    text: string,
    limit?: number,
  ): { url: string; title: string; visitCount: number; lastVisit: number }[];
  deleteVisits(ids: number[]): void;
  deleteHistoryUrl(url: string): void;
  clearHistory(range?: { from?: number; to?: number }): void;
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
    expect(MIGRATIONS.map((migration) => migration.version)).toEqual([1, 2, 3, 4, 5]);
    db.setSiteSetting("exemplo.com", "zoom", 1.25);
    expect(db.getSiteSetting("exemplo.com", "zoom")).toBe(1.25);
    db.setSiteSetting("exemplo.com", "zoom", null);
    expect(db.getSiteSetting("exemplo.com", "zoom")).toBeNull();
    db.close();
  });

  it("permissões por site: lista por prefixo e apaga só as do site", () => {
    const db = openDatabase(tempFile());
    db.setSiteSetting("https://a.test", "permission:notifications", "allow");
    db.setSiteSetting("https://a.test", "permission:geolocation", "block");
    db.setSiteSetting("https://b.test", "permission:camera", "allow");
    db.setSiteSetting("a.test", "zoom", 1.5);
    expect(db.listSiteSettings("permission:").map((row) => [row.host, row.key, row.value])).toEqual(
      [
        ["https://a.test", "permission:geolocation", "block"],
        ["https://a.test", "permission:notifications", "allow"],
        ["https://b.test", "permission:camera", "allow"],
      ],
    );
    db.deleteSiteSettings("https://a.test", "permission:");
    expect(db.listSiteSettings("permission:")).toHaveLength(1);
    expect(db.getSiteSetting("a.test", "zoom")).toBe(1.5);
    db.close();
  });

  it("histórico: visitas, mesma visita em 30 s, busca, paginação e limpeza", () => {
    const file = tempFile();
    const db = openDatabase(file);
    const t0 = Date.now() - 60 * 60 * 1000;
    const first = db.addVisit({ url: "https://a.test/", title: "Alfa", at: t0 });
    // Recarga logo em seguida: mesma visita, título novo.
    expect(db.addVisit({ url: "https://a.test/", title: "Alfa 2", at: t0 + 5_000 })).toBe(first);
    const second = db.addVisit({ url: "https://a.test/", at: t0 + 120_000 });
    db.addVisit({ url: "https://b.test/docs", title: "Beta 100% útil", at: t0 + 200_000 });
    db.updateHistoryTitle("https://b.test/docs", "Beta 100% útil (docs)");

    const all = db.listHistory();
    expect(all.map((row) => row.url)).toEqual([
      "https://b.test/docs",
      "https://a.test/",
      "https://a.test/",
    ]);
    expect(all[1]!.id).toBe(second);
    expect(all[1]!.title).toBe("Alfa 2");
    // % na busca é literal.
    expect(db.listHistory({ text: "100%" }).map((row) => row.url)).toEqual(["https://b.test/docs"]);
    expect(db.listHistory({ text: "alfa a.test" })).toHaveLength(2);
    expect(db.listHistory({ before: t0 + 120_000 }).map((row) => row.id)).toEqual([first]);

    const found = db.searchHistory("a.test");
    expect(found[0]).toMatchObject({ url: "https://a.test/", visitCount: 2 });
    expect(db.searchHistory("   ")).toEqual([]);

    db.deleteVisits([second]);
    expect(db.searchHistory("alfa")[0]!.visitCount).toBe(1);
    db.deleteHistoryUrl("https://a.test/");
    expect(db.searchHistory("alfa")).toEqual([]);
    db.clearHistory({ from: t0 });
    expect(db.listHistory()).toEqual([]);
    db.close();
  });

  it("histórico: mais velho que 90 dias sai ao abrir o banco", () => {
    const file = tempFile();
    const db = openDatabase(file);
    db.addVisit({ url: "https://velho.test/", at: Date.now() - 91 * 24 * 60 * 60 * 1000 });
    db.addVisit({ url: "https://novo.test/" });
    db.close();
    const reopened = openDatabase(file);
    expect(reopened.listHistory().map((row) => row.url)).toEqual(["https://novo.test/"]);
    expect(reopened.searchHistory("velho")).toEqual([]);
    reopened.close();
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

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { CHANGELOG, changesBetween, compareVersions } from "./changelog";

const packageVersion = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "../../../package.json"), "utf8"),
).version as string;

describe("novidades (changelog)", () => {
  it("compara versões por número, não por texto", () => {
    expect(compareVersions("1.4.10", "1.4.9")).toBe(1);
    expect(compareVersions("1.5.0", "1.5.0")).toBe(0);
    expect(compareVersions("1.4.2", "1.5.0")).toBe(-1);
    expect(compareVersions("2.0", "1.9.9")).toBe(1);
  });

  it("mostra as versões puladas, da mais nova para a mais antiga", () => {
    expect(changesBetween("1.4.1", "1.5.0").map((entry) => entry.version)).toEqual([
      "1.5.0",
      "1.4.2",
    ]);
    expect(changesBetween("1.4.0", "1.5.1").map((entry) => entry.version)).toEqual([
      "1.5.1",
      "1.5.0",
      "1.4.2",
    ]);
  });

  it("sem a versão anterior (vinda da 1.5.0 ou antes), só a atual", () => {
    expect(changesBetween(null, "1.5.1").map((entry) => entry.version)).toEqual(["1.5.1"]);
    expect(changesBetween(null, "9.9.9")).toEqual([]);
  });

  it("lista em ordem, sem versão repetida e sem item vazio", () => {
    const versions = CHANGELOG.map((entry) => entry.version);
    expect(new Set(versions).size).toBe(versions.length);
    for (let index = 1; index < versions.length; index++) {
      expect(compareVersions(versions[index - 1]!, versions[index]!)).toBe(1);
    }
    for (const entry of CHANGELOG) {
      expect(entry.items.length).toBeGreaterThan(0);
      expect(entry.items.every((item) => item.trim().length > 0)).toBe(true);
    }
  });

  it("a versão do package.json tem novidades escritas", () => {
    expect(versions()).toContain(packageVersion);
  });
});

function versions() {
  return CHANGELOG.map((entry) => entry.version);
}

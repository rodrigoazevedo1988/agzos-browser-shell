import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const main = fs.readFileSync(path.join(root, "electron/main.cjs"), "utf8");
const build = fs.readFileSync(path.join(root, "scripts/build-all.sh"), "utf8");

const splash = require(path.join(root, "electron/splash.cjs")) as {
  MIN_MS: number;
  MAX_MS: number;
  shouldShowSplash(input?: {
    env?: Record<string, string | undefined>;
    argv?: string[];
    pwaHost?: unknown;
    disabled?: boolean;
  }): boolean;
  closeAt(input: {
    shownAt: number;
    readyAt?: number | null;
    minMs?: number;
    maxMs?: number;
  }): number;
  splashHtml(input?: { minMs?: number }): string;
};

describe("vinheta de abertura", () => {
  const argv = ["/opt/agzos/agzos", "."];

  it("aparece só no início normal do navegador", () => {
    expect(splash.shouldShowSplash({ env: {}, argv })).toBe(true);
    expect(splash.shouldShowSplash({ env: {}, argv, pwaHost: { id: "x" } })).toBe(false);
    expect(splash.shouldShowSplash({ env: {}, argv: [...argv, "--agzos-pwa=abc"] })).toBe(false);
    expect(
      splash.shouldShowSplash({ env: {}, argv: [...argv, "--agzos-open=https://a.com"] }),
    ).toBe(false);
    expect(splash.shouldShowSplash({ env: { AGZOS_NO_SPLASH: "1" }, argv })).toBe(false);
    expect(splash.shouldShowSplash({ env: { AGZOS_USER_DATA: "/tmp/p" }, argv })).toBe(false);
    expect(splash.shouldShowSplash({ env: { AGZOS_TEST_HOME: "/tmp/h" }, argv })).toBe(false);
    expect(splash.shouldShowSplash({ env: {}, argv, disabled: true })).toBe(false);
  });

  it("some com a casca pronta e o mínimo cumprido, nunca depois do teto", () => {
    const { MIN_MS, MAX_MS } = splash;
    expect(MIN_MS).toBeGreaterThanOrEqual(1500);
    expect(MIN_MS).toBeLessThanOrEqual(2200);
    expect(MAX_MS).toBeLessThanOrEqual(4000);
    // Casca pronta cedo: espera o mínimo da animação.
    expect(splash.closeAt({ shownAt: 1000, readyAt: 1200 })).toBe(1000 + MIN_MS);
    // Casca pronta depois do mínimo: some quando ela fica pronta.
    expect(splash.closeAt({ shownAt: 1000, readyAt: 1000 + MIN_MS + 300 })).toBe(
      1000 + MIN_MS + 300,
    );
    // Casca lenta ou nunca pronta: o teto.
    expect(splash.closeAt({ shownAt: 1000, readyAt: 1000 + MAX_MS + 999 })).toBe(1000 + MAX_MS);
    expect(splash.closeAt({ shownAt: 1000 })).toBe(1000 + MAX_MS);
  });

  it("página autocontida, sem URL remota, com movimento reduzido", () => {
    const html = splash.splashHtml();
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org\/2000\/svg)/);
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("prefers-reduced-motion");
    expect(html).toContain("Agzos <span>Browser</span>");
  });

  it("main liga a vinheta e o build a empacota", () => {
    expect(main).toContain('require("./splash.cjs")');
    expect(main).toContain("splashScreen?.follow(");
    expect(build).toMatch(/ELECTRON_FILES=\([^)]*\bsplash\.cjs\b/);
  });
});

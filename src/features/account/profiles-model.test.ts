import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

import type { GoogleProfile } from "./bridge";
import { gridNextIndex, newlyConnected } from "./profiles-model";

const require = createRequire(import.meta.url);
const profiles = require("../../../electron/google-profiles.cjs");

function profile(id: string, email = ""): GoogleProfile {
  return {
    id,
    label: `Perfil ${id}`,
    email,
    name: "",
    color: "#2563eb",
    avatar: null,
    createdAt: 1,
    lastUsed: 1,
  };
}

describe("newlyConnected", () => {
  it("não avisa no primeiro estado", () => {
    expect(newlyConnected(null, [profile("a", "ana@example.com")])).toEqual([]);
  });

  it("avisa quando um perfil sem e-mail ganha conta", () => {
    const before = [profile("a"), profile("b", "bia@example.com")];
    const after = [profile("a", "ana@example.com"), profile("b", "bia@example.com")];
    expect(newlyConnected(before, after).map((item) => item.email)).toEqual(["ana@example.com"]);
  });

  it("avisa quando a conta de um perfil muda", () => {
    const before = [profile("a", "ana@example.com")];
    const after = [profile("a", "outra@example.com")];
    expect(newlyConnected(before, after)).toHaveLength(1);
  });

  it("não avisa perfil novo sem e-mail nem o mesmo e-mail de sempre", () => {
    const before = [profile("a", "ana@example.com")];
    const after = [profile("a", "ana@example.com"), profile("c")];
    expect(newlyConnected(before, after)).toEqual([]);
  });

  it("não avisa perfil novo já com conta (lista anterior não tinha o perfil)", () => {
    expect(newlyConnected([profile("a")], [profile("a"), profile("z", "z@example.com")])).toEqual(
      [],
    );
  });
});

describe("gridNextIndex", () => {
  it("anda uma posição nas setas laterais, sem sair da grade", () => {
    expect(gridNextIndex({ key: "ArrowRight", index: 0, columns: 3, count: 4 })).toBe(1);
    expect(gridNextIndex({ key: "ArrowLeft", index: 1, columns: 3, count: 4 })).toBe(0);
    expect(gridNextIndex({ key: "ArrowLeft", index: 0, columns: 3, count: 4 })).toBeNull();
    expect(gridNextIndex({ key: "ArrowRight", index: 3, columns: 3, count: 4 })).toBeNull();
  });

  it("pula uma linha inteira nas setas verticais", () => {
    expect(gridNextIndex({ key: "ArrowDown", index: 1, columns: 3, count: 7 })).toBe(4);
    expect(gridNextIndex({ key: "ArrowDown", index: 5, columns: 3, count: 7 })).toBeNull();
    expect(gridNextIndex({ key: "ArrowUp", index: 4, columns: 3, count: 7 })).toBe(1);
    expect(gridNextIndex({ key: "ArrowUp", index: 1, columns: 3, count: 7 })).toBeNull();
  });

  it("Home e End vão às pontas e outras teclas não movem", () => {
    expect(gridNextIndex({ key: "End", index: 0, columns: 2, count: 5 })).toBe(4);
    expect(gridNextIndex({ key: "Home", index: 3, columns: 2, count: 5 })).toBe(0);
    expect(gridNextIndex({ key: "Enter", index: 0, columns: 2, count: 5 })).toBeNull();
  });

  it("aguenta colunas inválidas e grades vazias", () => {
    expect(gridNextIndex({ key: "ArrowDown", index: 0, columns: 0, count: 3 })).toBe(1);
    expect(gridNextIndex({ key: "ArrowRight", index: 0, columns: 1, count: 0 })).toBeNull();
  });
});

describe("isGoogleCookieDomain", () => {
  it("reconhece cookies dos domínios do Google e recusa os outros", () => {
    expect(profiles.isGoogleCookieDomain(".google.com")).toBe(true);
    expect(profiles.isGoogleCookieDomain("accounts.google.com")).toBe(true);
    expect(profiles.isGoogleCookieDomain(".youtube.com")).toBe(true);
    expect(profiles.isGoogleCookieDomain("notgoogle.com")).toBe(false);
    expect(profiles.isGoogleCookieDomain("google.com.evil.example")).toBe(false);
    expect(profiles.isGoogleCookieDomain("example.com")).toBe(false);
    expect(profiles.isGoogleCookieDomain(undefined)).toBe(false);
  });
});

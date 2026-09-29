import { describe, expect, it } from "vitest";

import { resolveInput } from "./omnibox-input";

describe("resolveInput", () => {
  it.each([
    ["github.com", "https://github.com", "github.com"],
    ["  linear.app/team?x=1 ", "https://linear.app/team?x=1", "linear.app"],
    ["https://example.com/a", "https://example.com/a", "example.com"],
    ["HTTP://Example.com", "HTTP://Example.com", "Example.com"],
    ["localhost:5173/app", "http://localhost:5173/app", "localhost:5173"],
    ["127.0.0.1:8080", "http://127.0.0.1:8080", "127.0.0.1:8080"],
    ["sub.dominio.com.br:8443", "https://sub.dominio.com.br:8443", "sub.dominio.com.br:8443"],
  ])("%s é endereço", (input, url, title) => {
    expect(resolveInput(input, "duckduckgo")).toEqual({ title, url, kind: "page" });
  });

  it.each(["agzos browser", "como usar node.js hoje", "python"])("%s é busca", (input) => {
    expect(resolveInput(input, "duckduckgo")?.url).toBe(
      `https://duckduckgo.com/?q=${encodeURIComponent(input)}`,
    );
  });

  it("usa o motor escolhido", () => {
    expect(resolveInput("agzos", "yandex")?.url).toBe("https://yandex.com/search/?text=agzos");
  });

  it("vazio não navega", () => {
    expect(resolveInput("   ", "duckduckgo")).toBeNull();
  });
});

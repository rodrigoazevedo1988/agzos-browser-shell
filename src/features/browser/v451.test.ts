import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { TOOLS, shortcutText } from "@/features/tools/tools";

import { commandById, commands } from "./commands";

// 4.5.1: entradas visíveis das ferramentas (página inicial, Discador, barra).
const mainSource = fs.readFileSync(path.join(process.cwd(), "electron", "main.cjs"), "utf8");

describe("4.5.1: ferramentas com entrada visível", () => {
  it("toda ferramenta da grade é um comando de verdade, com o mesmo atalho", () => {
    for (const tool of TOOLS) {
      const command = commandById(tool.id);
      expect(command, tool.id).toBeDefined();
      if (tool.shortcut) expect(command!.shortcuts?.length, tool.id).toBeGreaterThan(0);
    }
    expect(TOOLS.map((tool) => tool.id)).toEqual(
      expect.arrayContaining(["tab.new-session", "ports.open", "scratchpad.open", "page.inspect"]),
    );
  });

  it("mira e modo leitura ficam habilitados no app (a casca explica fora de um site)", () => {
    const ctx = { desktop: {} } as never;
    expect(commands.find((item) => item.id === "page.inspect")!.enabled!(ctx, 1)).toBe(true);
    expect(commands.find((item) => item.id === "page.reader")!.enabled!(ctx, 1)).toBe(true);
  });

  it("atalhos com os símbolos do Mac", () => {
    expect(shortcutText("Ctrl+Shift+C", true)).toBe("⌘⇧C");
    expect(shortcutText("Ctrl+Alt+N", false)).toBe("Ctrl+Alt+N");
  });

  it("página sem cor de fundo fica branca (como no Chrome), mesmo no tema escuro", () => {
    expect(mainSource).toContain('view.setBackgroundColor("#FFFFFF");');
    expect(mainSource).not.toContain('"#0E0E0E" : "#FFFDFD"');
  });
});

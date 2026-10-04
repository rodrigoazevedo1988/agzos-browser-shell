import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Como em v471.test.ts: main.cjs carrega o Electron no import, então conferimos a fonte.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const main = fs.readFileSync(path.join(root, "electron/main.cjs"), "utf8");
const pagePreload = fs.readFileSync(path.join(root, "electron/page-preload.cjs"), "utf8");

const bodyOf = (source: string, start: string) => {
  const from = source.slice(source.indexOf(start));
  return from.slice(0, from.indexOf("\n}\n") + 2);
};

describe("4.7.2: tela cheia da página não fica presa (PiP no macOS)", () => {
  it("o leave-html-full-screen e a janela usam a mesma saída", () => {
    const leave = main.slice(main.indexOf('contents.on("leave-html-full-screen"'));
    expect(leave.slice(0, 200)).toContain("leaveHtmlFullscreen(ctx)");
    const windowLeave = main.slice(main.indexOf('window.on("leave-full-screen"'));
    expect(windowLeave.slice(0, 200)).toContain("leaveHtmlFullscreen(ctx)");
  });

  it("a saída devolve o layout e avisa a casca, só quando estava em tela cheia", () => {
    const body = bodyOf(main, "function leaveHtmlFullscreen(ctx)");
    expect(body).toContain("if (!ctx.fullscreenActive");
    expect(body).toContain("ctx.fullscreenActive = false");
    expect(body).toContain("applyLayout(ctx)");
    expect(body).toContain('send(ctx, "agzos:fullscreen", { active: false })');
  });

  it("a página avisa quando não tem mais elemento em tela cheia", () => {
    expect(pagePreload).toContain('"fullscreenchange"');
    expect(pagePreload).toContain('send("agzos:page-fullscreen", { active: false })');
    const listener = main.slice(main.indexOf('ipcMain.on("agzos:page-fullscreen"'));
    // Só a guia ativa da janela pode tirar a janela da tela cheia.
    expect(listener.slice(0, 400)).toContain("where.ctx.activeTabId");
    expect(listener.slice(0, 400)).toContain("leaveHtmlFullscreen(where.ctx)");
  });
});

describe("4.7.2: atalho do PWA traz a janela do app para a frente", () => {
  it("ativa o app no macOS antes de focar a janela", () => {
    const body = bodyOf(main, "function bringPwaForward(win)");
    expect(body).toContain("app.focus({ steal: true })");
    expect(body.indexOf("app.focus")).toBeLessThan(body.indexOf("win.focus()"));
  });

  it("vale para a janela nova e para a que já estava aberta", () => {
    const open = bodyOf(main, "function openPwaWindow(");
    expect(open).toContain("bringPwaForward(current)");
    expect(open).toContain('win.once("ready-to-show", () => bringPwaForward(win))');
  });
});

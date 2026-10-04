import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// main.cjs carrega o Electron no import, então não dá para exercitá-lo em unidade: estes
// testes conferem a *fonte* das ligações que quebraram. São regressões de montagem (a
// ordem em que algo é registrado), que voltam em qualquer refactor sem deixar aviso.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const main = fs.readFileSync(path.join(root, "electron/main.cjs"), "utf8");
const pagePreload = fs.readFileSync(path.join(root, "electron/page-preload.cjs"), "utf8");
// Sem os comentários: eles explicam por que a chamada saiu, e não podem contar como
// "a chamada está de volta".
const mainCode = main
  .split("\n")
  .map((line) => line.replace(/\/\/.*$/, ""))
  .join("\n");

const require = createRequire(import.meta.url);
const terminals = require(path.join(root, "electron/terminal.cjs")) as {
  createTerminals?: unknown;
};

describe("4.7.1: PiP de vídeo não trava mais a interface", () => {
  it("não sonda a aba durante a verificação de hibernação", () => {
    // A sondagem era um executeJavaScript por frame, a cada minuto, dentro do laço de
    // hibernação: segurava o processo principal e a barra lateral e a navegação travavam.
    const hibernation = mainCode.slice(mainCode.indexOf("async function checkHibernation"));
    const body = hibernation.slice(0, hibernation.indexOf("\nasync function"));
    expect(body).not.toContain("pictureInPictureActive");
    expect(body).not.toMatch(/await[\s\S]{0,200}executeJavaScript/);
    expect(body).toContain("pipContents.has(contents)");
  });

  it("mantém o estado de PiP por evento da página, não por sondagem", () => {
    expect(pagePreload).toContain("enterpictureinpicture");
    expect(pagePreload).toContain("leavepictureinpicture");
    expect(main).toContain('ipcMain.on("agzos:pip"');
  });

  it("cobre o PiP ligado pelo player da página, não só pelo atalho", () => {
    // Quem escuta o evento é a página, então o botão do próprio site também é registrado.
    const listener = main.slice(main.indexOf('ipcMain.on("agzos:pip"'));
    expect(listener.slice(0, 400)).toContain("pipContents.add(event.sender)");
    expect(listener.slice(0, 400)).toContain("pipContents.delete(event.sender)");
  });
});

describe("4.7.1: terminal solto é uma janela normal", () => {
  it("não nasce sempre na frente de tudo", () => {
    // alwaysOnTop grudava o terminal sobre as abas, o menu ⋯ e o que aparecesse por cima.
    const pip = mainCode.slice(mainCode.indexOf("const pip = new BrowserWindow("));
    const window = pip.slice(0, pip.indexOf("});") + 3);
    expect(window).not.toContain("alwaysOnTop");
    expect(mainCode).not.toContain("setAlwaysOnTop");
  });
});

describe("4.7.1: o atalho do PWA abre o app, não o navegador", () => {
  it("escuta second-instance antes do app ficar pronto", () => {
    // O lock é adquirido no carregamento do módulo, mas o app só fica pronto bem depois.
    // Com o ouvente registrado só dentro do whenReady, o clique no ícone nesse meio-tempo
    // se perdia e o usuário acabava no navegador — único sintoma visível.
    const lock = main.indexOf("requestSingleInstanceLock()");
    const listen = main.indexOf('app.on("second-instance"');
    const ready = main.indexOf("app.whenReady()");
    expect(lock).toBeGreaterThan(-1);
    expect(listen).toBeGreaterThan(lock);
    expect(listen).toBeLessThan(ready);
  });

  it("guarda o argv até poder abrir a janela do app", () => {
    expect(main).toContain("pendingSecondInstances");
    expect(main).toContain("pendingSecondInstances.splice(0)");
  });

  it("não cai no navegador quando o atalho traz um id de PWA", () => {
    // Cair no navegador é indistinguível de "o PWA abriu dentro do browser", que era
    // exatamente a dúvida do usuário. Com o id na mão, ou abre o app ou registra o erro.
    const handler = main.slice(main.indexOf("handleSecondInstance = (argv"));
    const body = handler.slice(0, handler.indexOf("for (const [pendingArgv"));
    expect(body).toContain("openPwaWindow(id)");
    expect(body).toContain("sem app salvo");
    const afterPwa = body.slice(body.indexOf("openPwaWindow(id)"));
    expect(afterPwa).toContain("return");
  });
});

describe("4.7.1: módulos puros continuam carregando", () => {
  it("terminal.cjs segue exportando o que o main usa", () => {
    expect(typeof terminals.createTerminals).toBe("function");
  });
});

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const main = fs.readFileSync(path.join(root, "electron/main.cjs"), "utf8");
const build = fs.readFileSync(path.join(root, "scripts/build-all.sh"), "utf8");

type MenuItem = {
  action?: string;
  label?: string;
  type?: string;
  checked?: boolean;
  submenu?: MenuItem[];
};

const chrome = require(path.join(root, "electron/pwa-chrome.cjs")) as {
  BAR_HEIGHT: number;
  appMenuSpec(state: Record<string, unknown>): MenuItem[];
  barAction(payload: unknown): Record<string, unknown> | null;
  barColors(color: unknown, dark?: boolean): { background: string; foreground: string };
  barHtml(): string;
  hostLabel(url: string): string;
  permissionAction(action: string): { type: string; value: string } | null;
  webOrigin(url: string): string | null;
  zoomPercent(level: number): number;
  windowFrame(
    platform: string,
    colors?: { background: string; foreground: string },
  ): { options: Record<string, unknown>; insetLeft: number; insetRight: number };
};

const picker = require(path.join(root, "electron/display-picker.cjs")) as {
  orderSources(
    sources: { id: string; name: string }[],
    ownTitle?: string,
  ): { id: string; name: string }[];
  parsePick(title: string, count: number): "cancel" | { index: number; audio: boolean } | null;
  pickerHtml(): string;
  pickerPayload(
    sources: { id: string; name: string; thumb?: string }[],
    options?: { audio?: boolean },
  ): { audio: boolean; sources: { index: number; kind: string; name: string; thumb: string }[] };
};

const pwa = require(path.join(root, "electron/pwa.cjs")) as {
  parseApps(value: unknown): { autoPip: boolean }[];
};

const actions = (items: MenuItem[]): string[] =>
  items.flatMap((item) => [
    ...(item.action ? [item.action] : []),
    ...(item.submenu ? actions(item.submenu) : []),
  ]);

describe("4.8.5: barra do app nos PWAs (pwa-chrome.cjs)", () => {
  it("texto claro em cor escura, escuro em cor clara; sem cor, neutro do tema", () => {
    expect(chrome.barColors("#c00")).toMatchObject({
      background: "#cc0000",
      foreground: "#ffffff",
    });
    expect(chrome.barColors("#ffeb3b").foreground).toBe("#202124");
    expect(chrome.barColors(null).background).toBe("#f1f3f4");
    expect(chrome.barColors("vermelho", true).background).toBe("#202124");
  });

  it("menu ⋮ traz as funções do navegador, PiP e as permissões da origem", () => {
    const spec = chrome.appMenuSpec({
      name: "YouTube",
      origin: "https://www.youtube.com",
      permissions: { camera: "block" },
      canUninstall: true,
    });
    const ids = actions(spec);
    for (const id of [
      "copy-url",
      "open-browser",
      "pip",
      "auto-pip",
      "zoom-in",
      "zoom-out",
      "zoom-reset",
      "find",
      "print",
      "fullscreen",
      "devtools",
      "uninstall",
      "perm:camera:allow",
      "perm:microphone:ask",
    ]) {
      expect(ids).toContain(id);
    }
    const permissions = spec.find((item) => item.label === "Permissões de youtube.com");
    const camera = permissions?.submenu?.find((item) => item.label === "Câmera");
    expect(camera?.submenu?.find((item) => item.checked)?.action).toBe("perm:camera:block");
    const microphone = permissions?.submenu?.find((item) => item.label === "Microfone");
    expect(microphone?.submenu?.find((item) => item.checked)?.action).toBe("perm:microphone:ask");
    // PiP ao minimizar vem desligado por padrão.
    expect(spec.find((item) => item.action === "auto-pip")?.checked).toBe(false);
    const on = chrome.appMenuSpec({ name: "YouTube", autoPip: true });
    expect(on.find((item) => item.action === "auto-pip")?.checked).toBe(true);
  });

  it("modo app (sem desinstalar) e DevTools desligado pela flag somem do menu", () => {
    const ids = actions(chrome.appMenuSpec({ devtools: false, canUninstall: false }));
    expect(ids).not.toContain("uninstall");
    expect(ids).not.toContain("devtools");
    expect(ids.some((id) => id.startsWith("perm:"))).toBe(false);
  });

  it("aceita só ações e permissões conhecidas da barra", () => {
    expect(chrome.barAction({ action: "menu", x: 10.4, y: "x" })).toEqual({
      action: "menu",
      x: 10,
      y: chrome.BAR_HEIGHT,
    });
    expect(chrome.barAction({ action: "find", text: "a".repeat(900), next: 1 })).toMatchObject({
      action: "find",
      forward: true,
      next: true,
    });
    expect(
      (chrome.barAction({ action: "find", text: "a".repeat(900) })!["text"] as string).length,
    ).toBe(500);
    expect(chrome.barAction({ action: "eval" })).toBeNull();
    expect(chrome.barAction("reload")).toBeNull();
    expect(chrome.permissionAction("perm:camera:allow")).toEqual({
      type: "camera",
      value: "allow",
    });
    expect(chrome.permissionAction("perm:usb:allow")).toBeNull();
    expect(chrome.permissionAction("perm:camera:always")).toBeNull();
  });

  it("a barra do app é a barra de título: sem a faixa nativa repetindo o título", () => {
    const mac = chrome.windowFrame("darwin");
    expect(mac.options).toMatchObject({ titleBarStyle: "hidden" });
    expect(mac.options).not.toHaveProperty("titleBarOverlay");
    expect(mac.insetLeft).toBeGreaterThan(60);
    expect(mac.insetRight).toBe(0);
    const win = chrome.windowFrame("win32", { background: "#cc0000", foreground: "#ffffff" });
    expect(win.options).toEqual({
      titleBarStyle: "hidden",
      titleBarOverlay: { color: "#cc0000", symbolColor: "#ffffff", height: chrome.BAR_HEIGHT },
    });
    expect(win.insetLeft).toBe(0);
    // Sem env(titlebar-area-*) (o Windows não entrega sempre), a barra deixa livre o espaço dos
    // botões nativos; senão o ⋮ e o PiP ficam por baixo deles.
    expect(win.insetRight).toBeGreaterThan(100);
    expect(chrome.barHtml()).toContain("calc(100% - var(--inset-right,0px))");
    const html = chrome.barHtml();
    // Arrastam só o espaço dos semáforos e o título; nenhum botão fica dentro de área de
    // arrasto (no macOS o clique sumia).
    expect(html).toContain("#lights{flex:none;width:var(--inset-left,0px)");
    expect(html).toContain("#info{-webkit-app-region:drag}");
    expect(html).not.toMatch(/#bar\{[^}]*app-region/);
    expect(html).toMatch(/<div id="info"><span id="title"><\/span><\/div>/);
    expect(html).toContain("env(titlebar-area-width");
    expect(main).toContain("...frame.options,");
    expect(main).toContain("win.setTitleBarOverlay(");
  });

  it("host, origem e zoom", () => {
    expect(chrome.hostLabel("https://www.youtube.com/watch?v=1")).toBe("youtube.com");
    expect(chrome.hostLabel("about:blank")).toBe("");
    expect(chrome.webOrigin("https://meet.google.com/abc")).toBe("https://meet.google.com");
    expect(chrome.webOrigin("file:///etc/passwd")).toBeNull();
    expect(chrome.zoomPercent(0)).toBe(100);
    expect(chrome.zoomPercent(1)).toBe(120);
  });

  it("a página da barra não monta HTML com dado do site", () => {
    const html = chrome.barHtml();
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain('$("title").textContent');
    expect(html).not.toMatch(/innerHTML\s*=\s*state/);
  });

  it("PiP ao minimizar é gravado no registro do app e vem desligado por padrão", () => {
    const base = { id: "0123456789abcdef", name: "App", startUrl: "https://app.test/" };
    expect(pwa.parseApps([base])[0]!.autoPip).toBe(false);
    expect(pwa.parseApps([{ ...base, autoPip: false }])[0]!.autoPip).toBe(false);
    expect(pwa.parseApps([{ ...base, autoPip: true }])[0]!.autoPip).toBe(true);
    // Só `true` liga: outro valor salvo não conta como ligado.
    expect(pwa.parseApps([{ ...base, autoPip: "true" }])[0]!.autoPip).toBe(false);
  });

  it("a janela do PWA tem a barra e o site num WebContentsView", () => {
    expect(main).toContain('preload: path.join(__dirname, "pwa-bar-preload.cjs")');
    expect(main).toContain('partition: "agzos-pwa-bar"');
    expect(main).toMatch(/win\.contentView\.addChildView\(view\)/);
    expect(build).toMatch(/ELECTRON_FILES=\([^)]*\bpwa-chrome\.cjs\b/);
    expect(build).toMatch(/ELECTRON_FILES=\([^)]*\bpwa-bar-preload\.cjs\b/);
  });
});

describe("4.8.5: compartilhar tela e câmera (display-picker.cjs)", () => {
  it("telas antes das janelas, sem a janela do seletor", () => {
    const ordered = picker.orderSources(
      [
        { id: "window:1:0", name: "Editor" },
        { id: "screen:0:0", name: "Tela 1" },
        { id: "window:2:0", name: "Compartilhar tela" },
        { id: "screen:1:0", name: "Tela 2" },
      ],
      "Compartilhar tela",
    );
    expect(ordered.map((source) => source.id)).toEqual(["screen:0:0", "screen:1:0", "window:1:0"]);
  });

  it("a página recebe só nome, tipo e miniatura data:image", () => {
    const payload = picker.pickerPayload(
      [
        { id: "screen:0:0", name: "Tela", thumb: "data:image/png;base64,AA" },
        { id: "window:9:0", name: "Site", thumb: "https://evil.test/x.png" },
      ],
      { audio: true },
    );
    expect(payload.audio).toBe(true);
    expect(payload.sources).toEqual([
      { index: 0, kind: "screen", name: "Tela", thumb: "data:image/png;base64,AA" },
      { index: 1, kind: "window", name: "Site", thumb: "" },
    ]);
  });

  it("resposta pelo título: índice válido, áudio e cancelar", () => {
    expect(picker.parsePick("agzos-pick:1:1", 3)).toEqual({ index: 1, audio: true });
    expect(picker.parsePick("agzos-pick:0:0", 3)).toEqual({ index: 0, audio: false });
    expect(picker.parsePick("agzos-pick:cancel", 3)).toBe("cancel");
    expect(picker.parsePick("agzos-pick:3:0", 3)).toBeNull();
    expect(picker.parsePick("Compartilhar tela", 3)).toBeNull();
    expect(picker.parsePick("agzos-pick:-1:0", 3)).toBeNull();
  });

  it("o seletor monta o DOM sem innerHTML", () => {
    const html = picker.pickerHtml();
    expect(html).not.toContain("innerHTML");
    expect(html).toContain("textContent");
  });

  it("toda sessão de guia e de PWA responde getDisplayMedia; câmera passa pelo macOS", () => {
    expect(main).toMatch(
      /function wirePermissions\(ses\) \{[\s\S]{0,200}wireDisplayCapture\(ses\)/,
    );
    expect(main).toMatch(
      /function wirePwaSession\(ses, id\) \{[\s\S]{0,200}wireDisplayCapture\(ses\)/,
    );
    expect(main).toContain("setDisplayMediaRequestHandler(");
    expect(main).toContain('useSystemPicker: process.platform === "darwin"');
    expect(main).toContain("systemPreferences.askForMediaAccess(type)");
    expect(build).toContain('data["NSCameraUsageDescription"]');
    expect(build).toMatch(/ELECTRON_FILES=\([^)]*\bdisplay-picker\.cjs\b/);
  });
});

describe("4.8.6: PWA do Mac sem clone se recupera sozinho", () => {
  it("monta o clone que falta ao abrir o app e a cada início; falha vira aviso", () => {
    expect(main).toContain("function ensureMacPwaApp(record)");
    expect(main).toMatch(/if \(!target\) \{[\s\S]{0,200}ensureMacPwaApp\(record\)/);
    expect(main).toMatch(
      /function openPwaWindow\(id, url = null\) \{[\s\S]{0,500}ensureMacPwaApp\(record\)\.then/,
    );
    expect(main).toMatch(/catch \(error\) \{\s*warnMacPwa\(record, error\);/);
    expect(main).toContain("pwaStore?.update(record.id, { shortcuts: { bundle: built.bundle } })");
  });
});

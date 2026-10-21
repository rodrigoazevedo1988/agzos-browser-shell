import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// 5.0.1: "Abrir com Agzos Browser" (Windows, Linux e macOS). Argv de links e arquivos, o
// .desktop do Linux e o registro do Windows.

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const files = require(path.join(root, "electron/files.cjs")) as {
  filesOfArgv: (argv: unknown, options?: { cwd?: string; skip?: number }) => string[];
  linuxBrowserDesktopEntry: (options: { exec: string; icon: string }) => string;
  urlsOfArgv: (argv: unknown, options?: { skip?: number }) => string[];
};
const winInstall = require(path.join(root, "electron/win-install.cjs")) as {
  handlerRegArgs: (execPath: string | undefined) => string[][] | null;
  UNINSTALL_KEY: string;
};

describe("5.0.1 argv de links http(s)", () => {
  it("pega só http(s), ignora opções, outros esquemas e o executável", () => {
    const argv = [
      "/opt/agzos/agzos",
      "--no-sandbox",
      "--agzos-open=https://ignorado.example",
      "https://exemplo.com/a?b=1",
      "HTTP://Exemplo.com/caixa",
      "https://exemplo.com/a?b=1",
      "mailto:alguem@exemplo.com",
      "agzos-file://arquivo",
      "ftp://exemplo.com",
      "https://",
      "file:///tmp/nota.html",
    ];
    expect(files.urlsOfArgv(argv)).toEqual([
      "https://exemplo.com/a?b=1",
      "http://exemplo.com/caixa",
    ]);
    expect(files.urlsOfArgv(null)).toEqual([]);
  });

  it("limita a 20 links e não mexe nos caminhos de arquivo", () => {
    const many = Array.from({ length: 30 }, (_, index) => `https://site${index}.example`);
    expect(files.urlsOfArgv(["agzos", ...many])).toHaveLength(20);
    expect(files.urlsOfArgv(["agzos", "/tmp/pagina.html"])).toEqual([]);
  });

  it("filesOfArgv continua sem tratar links como arquivo", () => {
    expect(files.filesOfArgv(["agzos", "https://exemplo.com"], { cwd: "/" })).toEqual([]);
  });
});

describe("5.0.1 atalho do Linux", () => {
  const text = files.linuxBrowserDesktopEntry({
    exec: '/opt/agzos browser/agzos "x"',
    icon: "/opt/agzos browser/resources/icon.png",
  });

  it("traz MimeType com páginas, links, PDF e SVG e Exec com %U", () => {
    expect(text).toContain(
      "MimeType=text/html;application/xhtml+xml;x-scheme-handler/http;x-scheme-handler/https;application/pdf;image/svg+xml;\n",
    );
    expect(text).toContain('Exec="/opt/agzos browser/agzos \\"x\\"" %U\n');
    expect(text.startsWith("[Desktop Entry]\nType=Application\n")).toBe(true);
    expect(text).toContain("Icon=/opt/agzos browser/resources/icon.png\n");
  });

  it("escapa % e aspas no caminho do executável", () => {
    const odd = files.linuxBrowserDesktopEntry({ exec: "/x/100%/agzos", icon: "/i.png" });
    expect(odd).toContain('Exec="/x/100%%/agzos" %U');
  });
});

describe("5.0.1 registro do Windows (reg.exe, só HKCU)", () => {
  const exe = "C:\\Users\\u\\AppData\\Local\\Programs\\Agzos Browser\\AgzosBrowser.exe";

  it("regrava só o caminho do executável nas chaves de Abrir com", () => {
    const args = winInstall.handlerRegArgs(exe);
    expect(args).not.toBeNull();
    for (const item of args ?? []) {
      expect(item[0]).toBe("add");
      expect(item[1]!.startsWith("HKCU\\")).toBe(true);
      expect(item.at(-1)).toBe("/f");
    }
    expect(args).toContainEqual([
      "add",
      "HKCU\\Software\\Classes\\AgzosBrowserHTML\\shell\\open\\command",
      "/ve",
      "/t",
      "REG_SZ",
      "/d",
      `"${exe}" "%1"`,
      "/f",
    ]);
    expect(args).toContainEqual([
      "add",
      "HKCU\\Software\\Classes\\*\\shell\\AgzosOpen\\command",
      "/ve",
      "/t",
      "REG_SZ",
      "/d",
      `"${exe}" "%1"`,
      "/f",
    ]);
    expect(args).toContainEqual([
      "add",
      "HKCU\\Software\\Classes\\*\\shell\\AgzosOpen",
      "/v",
      "Icon",
      "/t",
      "REG_SZ",
      "/d",
      `"${exe}",0`,
      "/f",
    ]);
  });

  it("não grava nada para caminho que não é um .exe absoluto", () => {
    expect(winInstall.handlerRegArgs("AgzosBrowser.exe")).toBeNull();
    expect(winInstall.handlerRegArgs('C:\\x\\a"b.exe')).toBeNull();
    expect(winInstall.handlerRegArgs("C:\\x\\app.bat")).toBeNull();
    expect(winInstall.handlerRegArgs(undefined)).toBeNull();
  });

  it("o instalador (NSIS) cria e remove as mesmas chaves, sem HKLM", () => {
    const nsi = fs.readFileSync(path.join(root, "scripts/windows-installer.nsi"), "utf8");
    expect(nsi).toContain('!define HANDLER_PROGID "AgzosBrowserHTML"');
    expect(nsi).toContain('!define VERB_KEY "Software\\Classes\\*\\shell\\AgzosOpen"');
    expect(nsi).toContain('"Abrir com ${APP_NAME}"');
    expect(nsi).toContain('WriteRegStr HKCU "${CAPS_KEY}\\URLAssociations" "https"');
    expect(nsi).toContain("SHChangeNotify(i 0x08000000");
    expect(nsi).toContain('DeleteRegKey HKCU "${VERB_KEY}"');
    expect(nsi).toContain('DeleteRegKey HKCU "${APPLICATIONS_KEY}"');
    expect(nsi).not.toMatch(/HKLM|HKEY_LOCAL_MACHINE/);
  });
});

describe("5.0.1 macOS e argv no main", () => {
  it("o Info.plist declara links http(s) e os tipos de arquivo; o clone do PWA perde os dois", () => {
    const build = fs.readFileSync(path.join(root, "scripts/build-all.sh"), "utf8");
    expect(build).toContain('"CFBundleURLSchemes": ["http", "https"]');
    expect(build).toContain('"public.html"');
    expect(build).toContain('"com.adobe.pdf"');
    const pwaMac = fs.readFileSync(path.join(root, "electron/pwa-mac.cjs"), "utf8");
    expect(pwaMac).toContain('"CFBundleURLTypes"');
  });

  it("main liga open-url, argv de links e second-instance ao mesmo caminho", () => {
    const main = fs.readFileSync(path.join(root, "electron/main.cjs"), "utf8");
    expect(main).toContain('app.on("open-url"');
    expect(main).toContain("urlsOfArgv(argv)");
    expect(main).toContain("urlsOfArgv(process.argv)");
    expect(main).toContain("function openSystemLinks(");
    expect(main).toContain("winInstall.handlerRegArgs(process.execPath)");
    expect(main).toContain("syncLinuxDesktopEntry");
  });
});

import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// Módulos da 1.6 no processo principal: permissões, sugestões do buscador e atualização.
const require = createRequire(import.meta.url);
const electronDir = path.join(import.meta.dirname, "../../../electron");

type Permissions = {
  decide(origin: string | null, types: string[], isPrivate: boolean): boolean | null;
  blocked(origin: string | null, types: string[], isPrivate: boolean): boolean;
  remember(origin: string, types: string[], allow: boolean, isPrivate: boolean): void;
  set(origin: string, type: string, value: string | null, isPrivate?: boolean): boolean;
  list(): { origin: string; type: string; value: string }[];
  reset(origin: string): boolean;
};
const permissionsModule = require(path.join(electronDir, "permissions.cjs")) as {
  createPermissions: (options: { database: unknown }) => Permissions;
  permissionTypesOf: (permission: string, details?: object) => string[] | null;
  checkTypesOf: (permission: string, details?: object) => string[] | null;
  requestOrigin: (details: object) => string | null;
};
const { openDatabase } = require(path.join(electronDir, "db.cjs")) as {
  openDatabase: (file: string) => { close(): void };
};
const suggest = require(path.join(electronDir, "suggest.cjs")) as {
  suggestUrl: (engine: string, text: string) => string | null;
  parseSuggestions: (body: unknown) => string[];
};
type UpdateState = { status: string; version: string | null; error: string | null };
const updaterModule = require(path.join(electronDir, "updater.cjs")) as {
  compareVersions: (a: string, b: string) => number;
  platformKey: (platform: string, arch: string) => string | null;
  parseManifest: (
    json: unknown,
    feed: string,
    key: string | null,
  ) => { version: string; asset: { url: string } | null };
  installTarget: (
    execPath: string,
    platform: string,
    options?: { exists: (file: string) => boolean },
  ) => { kind: string; dir: string; relaunch: string } | null;
  installerRunner: (
    platform: string,
    staged: string,
    execPath: string,
    options?: { exists?: (file: string) => boolean; read?: (file: string) => string },
  ) => string;
  createUpdater: (options: Record<string, unknown>) => {
    state(): UpdateState;
    check(): Promise<UpdateState>;
    install(options: { reopen: boolean }): boolean;
    installOnQuit(): boolean;
  };
};

const dirs: string[] = [];
const tempDir = (prefix: string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("permissões por site", () => {
  it("traduz os pedidos do Chromium em tipos", () => {
    const { permissionTypesOf, checkTypesOf, requestOrigin } = permissionsModule;
    expect(permissionTypesOf("media", { mediaTypes: ["video", "audio"] })).toEqual([
      "camera",
      "microphone",
    ]);
    expect(permissionTypesOf("media", { mediaTypes: ["audio"] })).toEqual(["microphone"]);
    expect(permissionTypesOf("notifications")).toEqual(["notifications"]);
    expect(permissionTypesOf("midiSysex")).toEqual(["midi"]);
    expect(permissionTypesOf("fullscreen")).toBeNull();
    expect(checkTypesOf("media", { mediaType: "video" })).toEqual(["camera"]);
    expect(requestOrigin({ requestingUrl: "https://meet.test:8443/sala?x=1" })).toBe(
      "https://meet.test:8443",
    );
    expect(
      requestOrigin({ requestingUrl: "file:///x", requestingOrigin: "chrome://x" }),
    ).toBeNull();
  });

  it("decisão lembrada vale depois de reabrir; sem decisão pergunta; bloqueio vale na anônima", () => {
    const file = path.join(tempDir("agzos-perm-"), "agzos.db");
    let database = openDatabase(file);
    let permissions = permissionsModule.createPermissions({ database });
    const site = "https://meet.test";
    expect(permissions.decide(site, ["camera", "microphone"], false)).toBeNull();
    permissions.remember(site, ["camera", "microphone"], true, false);
    permissions.remember("https://spam.test", ["notifications"], false, false);
    database.close();

    database = openDatabase(file);
    permissions = permissionsModule.createPermissions({ database });
    expect(permissions.decide(site, ["camera", "microphone"], false)).toBe(true);
    // Só câmera permitida, microfone não decidido: pergunta de novo.
    permissions.set(site, "microphone", null);
    expect(permissions.decide(site, ["camera", "microphone"], false)).toBeNull();
    expect(permissions.decide("https://spam.test", ["notifications"], false)).toBe(false);
    // O check só nega o que foi bloqueado (o resto continua como sempre, pelo login do Google).
    expect(permissions.blocked("https://spam.test", ["notifications"], false)).toBe(true);
    expect(permissions.blocked("https://accounts.google.com", ["notifications"], false)).toBe(
      false,
    );
    // Anônima: herda o bloqueio, não a permissão, e não grava no disco.
    expect(permissions.decide("https://spam.test", ["notifications"], true)).toBe(false);
    expect(permissions.decide(site, ["camera"], true)).toBeNull();
    permissions.remember("https://anon.test", ["geolocation"], true, true);
    expect(permissions.decide("https://anon.test", ["geolocation"], true)).toBe(true);
    expect(permissions.list().map((row) => row.origin)).not.toContain("https://anon.test");

    expect(permissions.set("javascript:alert(1)", "camera", "allow")).toBe(false);
    expect(permissions.set(site, "usb", "allow")).toBe(false);
    expect(permissions.reset(site)).toBe(true);
    expect(permissions.list()).toEqual([
      { origin: "https://spam.test", type: "notifications", value: "block" },
    ]);
    database.close();
  });
});

describe("sugestões do buscador", () => {
  it("monta a URL e lê o formato OpenSearch", () => {
    expect(suggest.suggestUrl("duckduckgo", " agzos browser ")).toBe(
      "https://duckduckgo.com/ac/?q=agzos%20browser&type=list",
    );
    expect(suggest.suggestUrl("yandex", "x")).toContain("suggest.yandex.com");
    expect(suggest.suggestUrl("outro", "x")).toBeNull();
    expect(suggest.suggestUrl("duckduckgo", "  ")).toBeNull();
    expect(
      suggest.parseSuggestions(["agz", ["agzos", "Agzos", "agzos browser", 3, ["agzos agency"]]]),
    ).toEqual(["agzos", "agzos browser", "agzos agency"]);
    expect(suggest.parseSuggestions({})).toEqual([]);
  });
});

describe("atualização automática", () => {
  const { compareVersions, platformKey, parseManifest, installTarget, installerRunner } =
    updaterModule;

  it("compara versões e escolhe o pacote da plataforma", () => {
    expect(compareVersions("1.4.0", "1.3.8")).toBeGreaterThan(0);
    expect(compareVersions("1.3.10", "1.3.9")).toBeGreaterThan(0);
    expect(compareVersions("v1.3.8", "1.3.8")).toBe(0);
    expect(compareVersions("lixo", "1.0.0")).toBe(0);
    expect(platformKey("win32", "x64")).toBe("win32-x64");
    expect(platformKey("darwin", "arm64")).toBe("darwin-arm64");
    expect(platformKey("linux", "arm64")).toBeNull();
  });

  it("manifesto: HTTPS, pacote no mesmo servidor e SHA-256 válido", () => {
    const feed = "https://agzosagency.com.br/browser/latest.json";
    const file = { url: "v1.4.0/Agzos-Browser-linux-x64.tar.gz", sha256: "a".repeat(64), size: 10 };
    const manifest = parseManifest(
      { version: "1.4.0", files: { "linux-x64": file } },
      feed,
      "linux-x64",
    );
    expect(manifest.asset?.url).toBe(
      "https://agzosagency.com.br/browser/v1.4.0/Agzos-Browser-linux-x64.tar.gz",
    );
    expect(parseManifest({ version: "1.4.0", files: {} }, feed, "linux-x64").asset).toBeNull();
    const bad =
      (json: unknown, url = feed) =>
      () =>
        parseManifest(json, url, "linux-x64");
    expect(
      bad({ version: "1.4.0", files: { "linux-x64": { ...file, url: "https://mal.test/x" } } }),
    ).toThrow(/fora do servidor/);
    expect(bad({ version: "1.4.0", files: { "linux-x64": { ...file, sha256: "x" } } })).toThrow(
      /SHA-256/,
    );
    expect(bad({ version: "1.4.0" }, "http://agzosagency.com.br/latest.json")).toThrow(/HTTPS/);
    expect(bad({ version: "um" })).toThrow(/Versão/);
  });

  it("onde instalar: .app inteiro no Mac; nunca de dentro do DMG ou fora da instalação", () => {
    const exists = () => true;
    expect(
      installTarget("/Applications/Agzos Browser.app/Contents/MacOS/Electron", "darwin", {
        exists,
      }),
    ).toMatchObject({ kind: "bundle", dir: "/Applications/Agzos Browser.app" });
    expect(
      installTarget("/Volumes/Agzos Browser/Agzos Browser.app/Contents/MacOS/Electron", "darwin", {
        exists,
      }),
    ).toBeNull();
    expect(
      installTarget(
        "/private/var/folders/x/AppTranslocation/1/d/Agzos Browser.app/Contents/MacOS/Electron",
        "darwin",
        { exists },
      ),
    ).toBeNull();
    expect(installTarget("/home/u/agzos/agzos-browser", "linux", { exists })).toMatchObject({
      kind: "folder",
      dir: "/home/u/agzos",
    });
    // Sem resources/app/package.json (ex.: Electron de desenvolvimento): não atualiza.
    expect(
      installTarget("/x/node_modules/electron/dist/electron", "linux", { exists: () => false }),
    ).toBeNull();
  });

  it("o instalador roda no executável da versão nova (o atual vai ser sobrescrito)", () => {
    const exists = () => true;
    expect(installerRunner("win32", "C:\\novo", "C:\\Agzos\\AgzosBrowser.exe", { exists })).toBe(
      "C:\\novo\\AgzosBrowser.exe",
    );
    // Mac: o nome vem do Info.plist do .app novo (a 1.4.1 renomeou "Electron").
    const plist = "<dict><key>CFBundleExecutable</key>\n<string>Agzos Browser</string></dict>";
    expect(
      installerRunner("darwin", "/t/novo/Agzos Browser.app", "/A.app/Contents/MacOS/Electron", {
        exists,
        read: () => plist,
      }),
    ).toBe("/t/novo/Agzos Browser.app/Contents/MacOS/Agzos Browser");
    // Pacote sem o executável: cai no atual.
    expect(
      installerRunner("linux", "/t/novo", "/opt/agzos/agzos-browser", { exists: () => false }),
    ).toBe("/opt/agzos/agzos-browser");
  });

  it("instalador: espera o app fechar, copia por cima, reabre e registra no log", async () => {
    const root = tempDir("agzos-inst-");
    const staged = path.join(root, "novo");
    const target = path.join(root, "instalado");
    fs.mkdirSync(path.join(staged, "resources", "app"), { recursive: true });
    fs.mkdirSync(path.join(target, "resources", "app"), { recursive: true });
    fs.writeFileSync(path.join(staged, "resources", "app", "package.json"), "novo");
    fs.writeFileSync(path.join(target, "resources", "app", "package.json"), "velho");
    fs.writeFileSync(path.join(target, "do-usuario.txt"), "fica");
    fs.writeFileSync(
      path.join(staged, "agzos-browser"),
      `#!/bin/sh\necho "$ELECTRON_RUN_AS_NODE" > "${root}/reaberto.txt"\n`,
      { mode: 0o755 },
    );
    const app = spawn("sleep", ["30"]);
    const config = path.join(root, "instalar.json");
    fs.writeFileSync(
      config,
      JSON.stringify({
        pid: app.pid,
        staged,
        target,
        kind: "folder",
        relaunch: path.join(target, "agzos-browser"),
        reopen: true,
        version: "9.9.9",
        result: path.join(root, "resultado.txt"),
        log: path.join(root, "instalar.log"),
      }),
    );
    const installer = spawn(
      process.execPath,
      [path.join(electronDir, "install-update.cjs"), config],
      {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      },
    );
    try {
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(fs.existsSync(path.join(root, "resultado.txt"))).toBe(false);
      app.kill();
      await new Promise((resolve) => installer.on("exit", resolve));
      expect(fs.readFileSync(path.join(root, "resultado.txt"), "utf8").trim()).toBe("ok 9.9.9");
      expect(fs.readFileSync(path.join(target, "resources", "app", "package.json"), "utf8")).toBe(
        "novo",
      );
      expect(fs.readFileSync(path.join(target, "do-usuario.txt"), "utf8")).toBe("fica");
      // Reaberto como app normal (sem o modo Node).
      await expect.poll(() => fs.existsSync(path.join(root, "reaberto.txt"))).toBe(true);
      expect(fs.readFileSync(path.join(root, "reaberto.txt"), "utf8").trim()).toBe("");
      expect(fs.readFileSync(path.join(root, "instalar.log"), "utf8")).toMatch(/app fechado/);
    } finally {
      app.kill();
      installer.kill();
    }
  });

  it("falha da instalação anterior fica visível, mesmo depois de verificar de novo", async () => {
    const workDir = tempDir("agzos-falha-");
    fs.writeFileSync(path.join(workDir, "resultado.txt"), "failed EBUSY arquivo em uso\n");
    const updater = updaterModule.createUpdater({
      feedUrl: "https://agzosagency.com.br/browser/latest.json",
      currentVersion: "1.4.0",
      platform: "linux",
      arch: "x64",
      execPath: "/nao/existe/agzos-browser",
      workDir,
      fetchImpl: async () => new Response(JSON.stringify({ version: "1.4.0" })),
    });
    expect(updater.state()).toMatchObject({
      installError: "A última atualização não foi instalada (EBUSY arquivo em uso).",
      logFile: path.join(workDir, "instalar.log"),
    });
    expect(await updater.check()).toMatchObject({
      status: "up-to-date",
      installError: expect.stringContaining("EBUSY"),
    });
  });

  it("de ponta a ponta no Linux: verifica, baixa, confere, extrai e instala por cima ao fechar", async () => {
    // Instalação "antiga" e pacote "novo" (tar.gz como o do build-all.sh).
    const root = tempDir("agzos-upd-");
    const install = path.join(root, "instalado");
    fs.mkdirSync(path.join(install, "resources", "app"), { recursive: true });
    fs.writeFileSync(path.join(install, "resources", "app", "package.json"), '{"version":"1.3.8"}');
    fs.writeFileSync(path.join(install, "meu-arquivo.txt"), "fica");
    const pkg = path.join(root, "pacote");
    fs.mkdirSync(path.join(pkg, "resources", "app"), { recursive: true });
    fs.writeFileSync(path.join(pkg, "resources", "app", "package.json"), '{"version":"1.4.0"}');
    fs.writeFileSync(
      path.join(pkg, "agzos-browser"),
      `#!/bin/sh\necho reaberto > "${root}/reaberto.txt"\n`,
      {
        mode: 0o755,
      },
    );
    const archive = path.join(root, "Agzos-Browser-linux-x64.tar.gz");
    execFileSync("tar", ["-czf", archive, "-C", pkg, "."]);
    const bytes = fs.readFileSync(archive);
    let sha = crypto.createHash("sha256").update(bytes).digest("hex");

    const server = http.createServer((request, response) => {
      if (request.url === "/latest.json") {
        response.end(
          JSON.stringify({
            version: "1.4.0",
            files: {
              "linux-x64": { url: "v1.4.0/pacote.tar.gz", sha256: sha, size: bytes.length },
            },
          }),
        );
      } else if (request.url === "/v1.4.0/pacote.tar.gz") {
        response.end(bytes);
      } else {
        response.statusCode = 404;
        response.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const feedUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/latest.json`;
    // Processo que faz o papel do app aberto: o script espera ele sair.
    const app = spawn("sleep", ["30"]);
    const states: string[] = [];
    const make = () =>
      updaterModule.createUpdater({
        feedUrl,
        currentVersion: "1.3.8",
        platform: "linux",
        arch: "x64",
        execPath: path.join(install, "agzos-browser"),
        workDir: path.join(root, "trabalho"),
        fetchImpl: fetch,
        emit: (state: UpdateState) => states.push(state.status),
        pid: app.pid,
        // O pacote do teste não tem Electron: o instalador roda neste Node.
        runner: process.execPath,
      });
    try {
      // SHA-256 errado: recusa.
      const realSha = sha;
      sha = "0".repeat(64);
      let updater = make();
      expect((await updater.check()).error).toMatch(/SHA-256/);
      sha = realSha;

      updater = make();
      const state = await updater.check();
      expect(state).toMatchObject({ status: "ready", version: "1.4.0" });
      expect(states).toContain("downloading");
      expect(updater.installOnQuit()).toBe(true);
      // Nada muda enquanto o "app" está aberto.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(
        fs.readFileSync(path.join(install, "resources", "app", "package.json"), "utf8"),
      ).toContain("1.3.8");
      app.kill();
      const result = path.join(root, "trabalho", "resultado.txt");
      for (let i = 0; i < 100 && !fs.existsSync(result); i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(fs.readFileSync(result, "utf8").trim()).toBe("ok 1.4.0");
      expect(
        fs.readFileSync(path.join(install, "resources", "app", "package.json"), "utf8"),
      ).toContain("1.4.0");
      // Arquivo do usuário na pasta continua lá; sem "reabrir", não reabre.
      expect(fs.readFileSync(path.join(install, "meu-arquivo.txt"), "utf8")).toBe("fica");
      expect(fs.existsSync(path.join(root, "reaberto.txt"))).toBe(false);

      // Já na versão nova: nada a fazer.
      const current = updaterModule.createUpdater({
        feedUrl,
        currentVersion: "1.4.0",
        platform: "linux",
        arch: "x64",
        execPath: path.join(install, "agzos-browser"),
        workDir: path.join(root, "trabalho"),
        fetchImpl: fetch,
      });
      expect((await current.check()).status).toBe("up-to-date");
    } finally {
      app.kill();
      server.closeAllConnections();
      server.close();
    }
  }, 30_000);
});

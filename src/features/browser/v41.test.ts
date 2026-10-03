import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_TERMINAL,
  DEFAULT_TOOLS,
  fontStack,
  parseTerminalSettings,
  terminalAction,
  terminalWidthLimit,
} from "@/features/terminal/config";

import { parsePrefs } from "./persistence/snapshot";

// 4.1: terminal em três posições, aparência, aliases, SSH, chaves de API e modo voz.
const require = createRequire(import.meta.url);
const electronDir = path.join(process.cwd(), "electron");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "agzos-v41-"));

type Shell = { id: string; label: string; file: string; args: string[] };
const launch = require(path.join(electronDir, "terminal-launch.cjs")) as {
  cleanAliases: (list: unknown) => { name: string; command: string }[];
  initFiles: (
    shell: string,
    aliases: { name: string; command: string }[],
  ) => Record<string, string>;
  launchWithAliases: (shell: Shell, dir: string) => { args: string[]; env: Record<string, string> };
  prepareAliases: (
    shell: Shell,
    aliases: unknown,
    baseDir: string,
    options?: { env: Record<string, string> },
  ) => { args: string[]; env: Record<string, string> };
  sshArgs: (connection: unknown) => string[] | null;
  detectCommands: (
    commands: string[],
    options: { platform: string; env: Record<string, string>; exists: (file: string) => boolean },
  ) => Record<string, boolean>;
  sshBinary: (options: {
    platform: string;
    env: Record<string, string>;
    exists: (file: string) => boolean;
  }) => string | null;
};

describe("aliases do terminal", () => {
  it("só aliases válidos, sem repetir nome nem quebrar linha", () => {
    expect(
      launch.cleanAliases([
        { name: "gs", command: "git status" },
        { name: "gs", command: "outro" },
        { name: "rm -rf", command: "x" },
        { name: "ok", command: "a\necho injetado" },
        { name: "ll", command: "ls -la" },
      ]),
    ).toEqual([
      { name: "gs", command: "git status" },
      { name: "ll", command: "ls -la" },
    ]);
  });

  it("cada shell recebe o seu arquivo, carregando os do usuário antes", () => {
    const aliases = [{ name: "oi", command: "echo 'olá'" }];
    const bash = launch.initFiles("bash", aliases)["bashrc"]!;
    expect(bash.indexOf('. "$HOME/.bash_profile"')).toBeLessThan(bash.indexOf("alias oi="));
    expect(bash).toContain("alias oi='echo '\\''olá'\\'''");
    const zsh = launch.initFiles("zsh", aliases);
    expect(Object.keys(zsh).sort()).toEqual([".zlogin", ".zprofile", ".zshenv", ".zshrc"]);
    expect(zsh[".zshrc"]).toContain('. "$ZDOTDIR/.zshrc"');
    expect(zsh[".zshrc"]).toContain("alias oi=");
    expect(launch.initFiles("powershell", aliases)["aliases.ps1"]).toContain(
      "function global:oi { echo 'olá' @args }",
    );
    expect(launch.initFiles("cmd", aliases)["aliases.doskey"]).toBe("oi=echo 'olá' $*");
  });

  it("sem aliases o shell sobe como antes (nada é executado)", () => {
    const shell = { id: "bash", label: "bash", file: "/bin/bash", args: ["-l"] };
    expect(launch.prepareAliases(shell, [], tmp())).toEqual({ args: ["-l"], env: {} });
    const dir = tmp();
    const zsh = { id: "zsh", label: "zsh", file: "/bin/zsh", args: ["-l"] };
    expect(
      launch.prepareAliases(zsh, [{ name: "a", command: "b" }], dir, { env: { HOME: "/h" } }),
    ).toEqual({ args: ["-l"], env: { ZDOTDIR: path.join(dir, "zsh"), AGZOS_USER_ZDOTDIR: "/h" } });
    const ps = launch.launchWithAliases(
      { id: "pwsh", label: "PowerShell 7", file: "pwsh.exe", args: ["-NoLogo"] },
      "C:\\Agzos\\init",
    );
    expect(ps.args).toEqual(["-NoLogo", "-NoExit", "-Command", ". 'C:\\Agzos\\init\\aliases.ps1'"]);
  });

  it("bash de verdade: o alias funciona e o .bashrc do usuário continua valendo", async () => {
    if (process.platform === "win32" || !fs.existsSync("/bin/bash")) return;
    const home = tmp();
    fs.writeFileSync(path.join(home, ".bashrc"), "export DO_USUARIO=sim\n");
    const terminal = require(path.join(electronDir, "terminal.cjs")) as {
      createTerminals: (options: Record<string, unknown>) => {
        open(owner: object, options: object): { ok: boolean; id: number };
        write(owner: object, id: number, data: string): boolean;
        list(owner: object): { id: number; history: string }[];
        killAll(): void;
      };
    };
    let output = "";
    const service = terminal.createTerminals({
      loadPty: () => require("node-pty"),
      env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", HOME: home, SHELL: "/bin/bash" },
      homedir: home,
      onData: (_owner: object, _id: number, data: string) => (output += data),
      onExit: () => {},
      prepare: (shell: Shell) =>
        launch.prepareAliases(
          shell,
          [{ name: "saudacao", command: "echo OLA-$DO_USUARIO" }],
          tmp(),
        ),
      extraEnv: () => ({ ANTHROPIC_API_KEY: "sk-teste" }),
    });
    const owner = {};
    const session = service.open(owner, { shell: "bash", cwd: home });
    expect(session.ok).toBe(true);
    service.write(owner, session.id, "saudacao; echo CHAVE=$ANTHROPIC_API_KEY\r");
    for (let i = 0; i < 100 && !output.includes("CHAVE=sk-teste"); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(output).toContain("OLA-sim");
    expect(output).toContain("CHAVE=sk-teste");
    // A saída recente volta quando o terminal troca de lugar.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(service.list(owner)[0]!.history).toContain("OLA-sim");
    service.killAll();
  }, 15_000);
});

describe("SSH", () => {
  it("argumentos seguros: nada de opção vinda do host ou do usuário", () => {
    expect(launch.sshArgs({ host: "exemplo.com", user: "root", port: 22 })).toEqual([
      "root@exemplo.com",
    ]);
    expect(launch.sshArgs({ host: "10.0.0.2", port: 2222, key: "/home/r/.ssh/id" })).toEqual([
      "-p",
      "2222",
      "-i",
      "/home/r/.ssh/id",
      "10.0.0.2",
    ]);
    expect(launch.sshArgs({ host: "-oProxyCommand=touch /tmp/x" })).toBeNull();
    expect(launch.sshArgs({ host: "ok.com", user: "-oX" })).toBeNull();
    expect(launch.sshArgs({ host: "a b" })).toBeNull();
    expect(launch.sshArgs({ host: "ok.com", port: 70000 })).toBeNull();
  });

  it("acha o ssh do sistema e os comandos das ferramentas no PATH", () => {
    expect(
      launch.sshBinary({
        platform: "win32",
        env: { SystemRoot: "C:\\Windows" },
        exists: (file) => file === "C:\\Windows\\System32\\OpenSSH\\ssh.exe",
      }),
    ).toBe("C:\\Windows\\System32\\OpenSSH\\ssh.exe");
    expect(
      launch.detectCommands(["claude --resume", "opencode", "rm;x"], {
        platform: "win32",
        env: { PATH: "C:\\npm", PATHEXT: ".EXE;.CMD" },
        exists: (file) => file.toLowerCase() === "c:\\npm\\claude.cmd",
      }),
    ).toEqual({ claude: true, opencode: false });
  });

  const ssh = require(path.join(electronDir, "ssh-keys.cjs")) as {
    listKeys: (
      dir: string,
    ) => { name: string; type: string; publicKey: string; privatePath: string | null }[];
    generateKey: (
      options: Record<string, unknown>,
    ) => Promise<{ ok: boolean; error?: string; key?: { name: string } }>;
  };

  it("lista só chaves públicas válidas e gera ed25519 sem sobrescrever", async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "velha.pub"), "ssh-rsa AAAAB3Nza teste@pc\n");
    fs.writeFileSync(path.join(dir, "velha"), "PRIVADA");
    fs.writeFileSync(path.join(dir, "lixo.pub"), "não é chave");
    expect(ssh.listKeys(dir)).toEqual([
      {
        name: "velha",
        type: "ssh-rsa",
        comment: "teste@pc",
        publicKey: "ssh-rsa AAAAB3Nza teste@pc",
        privatePath: path.join(dir, "velha"),
      },
    ]);
    expect(JSON.stringify(ssh.listKeys(dir))).not.toContain("PRIVADA");
    expect(await ssh.generateKey({ sshDir: dir, name: "velha", execFile, binary: "x" })).toEqual({
      ok: false,
      error: "exists",
    });
    expect(await ssh.generateKey({ sshDir: dir, name: "../fora", execFile, binary: "x" })).toEqual({
      ok: false,
      error: "name",
    });
    if (!fs.existsSync("/usr/bin/ssh-keygen")) return;
    const made = await ssh.generateKey({
      sshDir: dir,
      name: "nova",
      comment: "agzos",
      passphrase: "",
      execFile,
      binary: "/usr/bin/ssh-keygen",
    });
    expect(made).toMatchObject({
      ok: true,
      key: { name: "nova", type: "ssh-ed25519", comment: "agzos" },
    });
  });
});

describe("chaves de API dos terminais", () => {
  const secrets = require(path.join(electronDir, "terminal-secrets.cjs")) as {
    createSecrets: (options: Record<string, unknown>) => {
      names(): string[];
      set(name: string, value: string): { ok: boolean; error?: string };
      remove(name: string): { ok: boolean };
      env(): Record<string, string>;
    };
  };
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(text, "utf8").reverse(),
    decryptString: (buffer: Buffer) => Buffer.from(buffer).reverse().toString("utf8"),
  };

  it("guarda cifrado, devolve só os nomes e recusa variáveis do sistema", () => {
    const file = path.join(tmp(), "terminal-secrets.bin");
    const store = secrets.createSecrets({ file, safeStorage });
    expect(store.set("ANTHROPIC_API_KEY", "sk-ant-segredo")).toEqual({ ok: true });
    expect(store.set("PATH", "/tmp")).toMatchObject({ ok: false, error: "name" });
    expect(store.set("LD_PRELOAD", "x")).toMatchObject({ ok: false, error: "name" });
    expect(store.set("minha", "x")).toMatchObject({ ok: false, error: "name" });
    expect(store.names()).toEqual(["ANTHROPIC_API_KEY"]);
    expect(fs.readFileSync(file).toString("utf8")).not.toContain("sk-ant-segredo");
    expect(store.env()).toEqual({ ANTHROPIC_API_KEY: "sk-ant-segredo" });
    store.remove("ANTHROPIC_API_KEY");
    expect(store.names()).toEqual([]);
    const insecure = secrets.createSecrets({
      file: path.join(tmp(), "x.bin"),
      safeStorage: { ...safeStorage, isEncryptionAvailable: () => false },
    });
    expect(insecure.set("OPENAI_API_KEY", "x")).toMatchObject({ ok: false, error: "insecure" });
  });
});

describe("modo voz (Whisper da Groq)", () => {
  const ai = require(path.join(electronDir, "ai.cjs")) as {
    createAi: (options: Record<string, unknown>) => {
      setKey(key: string): Promise<{ ok: boolean }>;
      transcribe(options: {
        audio: Uint8Array | null;
        mime: string;
        language: string;
      }): Promise<{ ok: boolean; text?: string; error?: string }>;
    };
  };
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(text, "utf8").reverse(),
    decryptString: (buffer: Buffer) => Buffer.from(buffer).reverse().toString("utf8"),
  };

  it("manda o áudio em multipart com o modelo e o idioma e devolve o texto", async () => {
    const calls: { url: string; headers: Record<string, string>; body: Buffer }[] = [];
    const fetch = async (url: string, init: { headers: Record<string, string>; body?: Buffer }) => {
      calls.push({ url, headers: init.headers, body: Buffer.from(init.body ?? "") });
      if (url.endsWith("/models"))
        return Response.json({ data: [{ id: "llama-3.3-70b-versatile" }] });
      return Response.json({ text: " listar os arquivos " });
    };
    const service = ai.createAi({ userDataDir: tmp(), safeStorage, fetch, database: null });
    expect(
      await service.transcribe({ audio: new Uint8Array([1]), mime: "audio/webm", language: "pt" }),
    ).toMatchObject({ ok: false, error: "no-key" });
    expect(calls).toHaveLength(0);
    await service.setKey("gsk_teste_0123456789abcdefghij");
    const result = await service.transcribe({
      audio: new Uint8Array([1, 2, 3]),
      mime: "audio/webm;codecs=opus",
      language: "pt",
    });
    expect(result).toEqual({ ok: true, text: "listar os arquivos" });
    const call = calls.at(-1)!;
    expect(call.url).toMatch(/\/audio\/transcriptions$/);
    expect(call.headers["Content-Type"]).toMatch(/^multipart\/form-data; boundary=/);
    const body = call.body.toString("latin1");
    expect(body).toContain('name="model"\r\n\r\nwhisper-large-v3-turbo');
    expect(body).toContain('name="language"\r\n\r\npt');
    expect(body).toContain('filename="voz.webm"');
    expect(
      await service.transcribe({ audio: null, mime: "audio/webm", language: "" }),
    ).toMatchObject({
      ok: false,
      error: "request",
    });
  });
});

describe("preferências do terminal 4.1", () => {
  it("valida o que vem do disco e mantém os padrões", () => {
    expect(parsePrefs({}).terminal).toEqual(DEFAULT_TERMINAL);
    const parsed = parseTerminalSettings({
      dock: "window",
      width: 99999,
      theme: { background: "#112233", foreground: "vermelho" },
      fontFamily: 'Fira"Code',
      fontSize: 3,
      aliases: [
        { name: "x y", command: "z" },
        { name: "ok", command: "ls" },
      ],
      ssh: [
        { host: "-o", user: "a" },
        { host: "srv.com", port: 99999 },
      ],
      tools: [
        { name: "Claude", command: "claude\nrm" },
        { name: "Aider", command: "aider" },
      ],
      voice: { language: "fr", enter: true },
    });
    expect(parsed.dock).toBe("window");
    expect(parsed.width).toBe(1200);
    expect(parsed.theme).toEqual({
      background: "#112233",
      foreground: "#e8e6e3",
      cursor: "#d43420",
    });
    expect(parsed.fontFamily).toBe("FiraCode");
    expect(parsed.fontSize).toBe(9);
    expect(parsed.aliases).toEqual([{ name: "ok", command: "ls" }]);
    expect(parsed.ssh.map((item) => [item.host, item.port])).toEqual([["srv.com", 22]]);
    expect(parsed.tools.map((item) => item.command)).toEqual(["aider"]);
    expect(parsed.voice).toEqual({ language: "pt", enter: true });
    expect(DEFAULT_TOOLS.map((tool) => tool.command)).toEqual(
      expect.arrayContaining(["claude", "opencode", "kiro-cli", "agy", "freebuff"]),
    );
    expect(fontStack("")).toMatch(/^ui-monospace/);
    expect(terminalWidthLimit(1000)).toBe(640);
  });

  it("atalhos do terminal (Ctrl no Windows/Linux, ⌘ no Mac)", () => {
    const key = (
      k: string,
      mods: Partial<Record<"ctrlKey" | "metaKey" | "shiftKey" | "altKey", boolean>>,
    ) => ({
      key: k,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      ...mods,
    });
    expect(terminalAction(key("E", { ctrlKey: true, shiftKey: true }), false)).toBe("new");
    expect(terminalAction(key("M", { ctrlKey: true, shiftKey: true }), false)).toBe("voice");
    expect(terminalAction(key("ArrowRight", { ctrlKey: true, shiftKey: true }), false)).toBe(
      "next",
    );
    expect(terminalAction(key("=", { ctrlKey: true }), false)).toBe("font-up");
    // Ctrl+C, Ctrl+W, Ctrl+R continuam sendo do shell.
    expect(terminalAction(key("c", { ctrlKey: true }), false)).toBeNull();
    expect(terminalAction(key("w", { ctrlKey: true }), false)).toBeNull();
    expect(terminalAction(key("e", { metaKey: true, shiftKey: true }), true)).toBe("new");
    expect(terminalAction(key("e", { ctrlKey: true, shiftKey: true }), true)).toBeNull();
  });

  it("o main entrega as sessões ao terminal flutuante e só a interface do app usa o microfone", () => {
    const main = fs.readFileSync(path.join(electronDir, "main.cjs"), "utf8");
    expect(main).toContain("function sendTerminal(");
    expect(main).toContain('isAppInterface(contents) && permission === "media"');
    const build = fs.readFileSync(path.join(process.cwd(), "scripts", "build-all.sh"), "utf8");
    expect(build).toContain("NSMicrophoneUsageDescription");
    expect(fs.readFileSync(path.join(electronDir, "vite.config.mjs"), "utf8")).toContain(
      'terminal: path.join(directory, "renderer", "terminal.html")',
    );
  });
});

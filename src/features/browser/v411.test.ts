import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import {
  autoLayout,
  plainOutput,
  planToGraph,
  promptWithContext,
  readyNodes,
  skipAfterFailure,
  type NodeRun,
} from "@/features/terminal/agents";
import {
  DEFAULT_TERMINAL,
  parseAgentGraph,
  parseTerminalSettings,
  reaches,
  terminalAction,
  type AgentGraph,
} from "@/features/terminal/config";
import { cdCommand, quotePath } from "@/features/terminal/model";

import { fileUrlOfPath, resolveInput } from "./omnibox-input";

// 4.1.1: abas com nome, CLIs no PATH, modo ls, snippets/skills/agente, arquivos no
// navegador, visualizador de imagem e PWA instalável.
const require = createRequire(import.meta.url);
const electronDir = path.join(process.cwd(), "electron");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "agzos-v411-"));

const cli = require(path.join(electronDir, "cli-install.cjs")) as {
  CLI_TOOLS: Record<string, { command: string; headless: unknown }>;
  cleanToolIds: (ids: unknown) => string[];
  cliPathDirs: (options: {
    platform: string;
    env: Record<string, string>;
    home: string;
  }) => string[];
  withCliPath: (
    env: Record<string, string>,
    options: { platform: string; home: string },
  ) => Record<string, string>;
  unixInstallScript: (ids: string[], options: { home: string; platform: string }) => string;
  windowsInstallLines: (
    ids: string[],
    options: { home: string; env?: Record<string, string> },
  ) => string[];
  installProgram: (options: { file: string }) => { file: string; args: string[] };
  agentProgram: (options: {
    tool: string;
    prompt: string;
    binary: string | null;
    platform: string;
    env: Record<string, string>;
  }) => { file: string; args: string[] | string } | null;
  cmdSafe: (text: string) => string;
};

const files = require(path.join(electronDir, "files.cjs")) as {
  filesOfArgv: (
    argv: unknown,
    options?: {
      cwd?: string;
      skip?: number;
      exists?: (f: string) => boolean;
      isFile?: (f: string) => boolean;
    },
  ) => string[];
  fileKind: (file: string, options?: { read?: (file: string) => string }) => string;
  looksLikeText: (buffer: Buffer) => boolean;
  fileUrlOf: (file: string, token: string) => string;
  pathOfFileUrl: (url: string, token: string) => string | null;
  urlForPath: (file: string, token: string) => string;
  viewableUrl: (url: string, token: string) => string;
  listDirectory: (
    dir: string,
    options?: { hidden?: boolean },
  ) =>
    | {
        ok: true;
        path: string;
        parent: string | null;
        entries: { name: string; dir: boolean; size: number | null; image: boolean }[];
      }
    | { ok: false; error: string };
  handleFileRequest: (url: string, token: string) => Response;
  findSkills: (options: { home: string; cwd: string }) => {
    tool: string;
    kind: string;
    scope: string;
    name: string;
    description: string;
    invoke: string;
  }[];
  createSkill: (options: {
    home: string;
    cwd: string;
    scope: string;
    name: string;
    description: string;
    body: string;
  }) => { ok: boolean; error?: string; file?: string };
};

type Manifest = {
  id: string;
  name: string;
  startUrl: string;
  scope: string;
  origin: string;
  display: string;
  themeColor: string | null;
  icons: { src: string; size: number; type: string; purpose: string }[];
};
const pwa = require(path.join(electronDir, "pwa.cjs")) as {
  parseManifest: (
    json: unknown,
    options: { manifestUrl: string; documentUrl: string },
  ) => Manifest | null;
  installability: (
    manifest: Manifest | null,
    options: { serviceWorker: boolean; documentUrl: string },
  ) => { ok: boolean; reason?: string };
  iconCandidates: (icons: Manifest["icons"]) => Manifest["icons"];
  iconSize: (sizes: unknown) => number;
  icoFromPngs: (images: { size: number; png: Buffer }[]) => Buffer;
  icnsFromPngs: (images: { size: number; png: Buffer }[]) => Buffer;
  pwaArgOf: (argv: string[]) => string | null;
  scopeContains: (scope: string, url: string) => boolean;
  shortcutPaths: (options: {
    platform: string;
    home: string;
    env: Record<string, string>;
    name: string;
    id: string;
  }) => Record<string, string>;
  linuxDesktopEntry: (options: {
    name: string;
    exec: string;
    args: string[];
    icon: string;
    url: string;
  }) => string;
  macBundleFiles: (options: {
    id: string;
    name: string;
    appBundle: string | null;
    exec: string;
    args: string[];
  }) => Record<string, string>;
  fileNameOf: (name: string) => string;
  createPwaStore: (options: { database: unknown }) => {
    list: () => { id: string; name: string }[];
    get: (id: string) => { id: string; zoom: number } | null;
    put: (app: unknown) => void;
    update: (id: string, patch: unknown) => void;
    remove: (id: string) => void;
  };
};

const ai = require(path.join(electronDir, "ai.cjs")) as {
  parseAgentPlan: (
    text: string,
    tools: string[],
  ) => { id: string; title: string; tool: string; prompt: string; after: string[] }[];
};

const terminal = require(path.join(electronDir, "terminal.cjs")) as {
  createTerminals: (options: Record<string, unknown>) => {
    open: (
      owner: unknown,
      options: Record<string, unknown>,
    ) => { ok: boolean; id?: number; label?: string };
    rename: (owner: unknown, id: number, title: unknown) => boolean;
    list: (owner: unknown) => { id: number; title: string | null; label: string }[];
  };
};

describe("CLIs de IA no PATH", () => {
  it("as pastas das CLIs entram no fim do PATH, sem repetir", () => {
    const env = cli.withCliPath(
      { PATH: "/usr/bin:/home/r/.local/bin" },
      { platform: "linux", home: "/home/r" },
    );
    const parts = env["PATH"]!.split(":");
    expect(parts[0]).toBe("/usr/bin");
    expect(parts.filter((dir) => dir === "/home/r/.local/bin")).toHaveLength(1);
    expect(parts).toContain("/home/r/.npm-global/bin");
    expect(parts).toContain("/home/r/.opencode/bin");
    const win = cli.withCliPath(
      { Path: "C:\\Windows", APPDATA: "C:\\Users\\r\\AppData\\Roaming" },
      { platform: "win32", home: "C:\\Users\\r" },
    );
    expect(win["Path"]).toContain("C:\\Users\\r\\AppData\\Roaming\\npm");
    expect(win["Path"]!.startsWith("C:\\Windows;")).toBe(true);
    const mac = cli.cliPathDirs({ platform: "darwin", env: {}, home: "/Users/r" });
    expect(mac).toContain("/opt/homebrew/bin");
  });

  it("instala kiro-cli e codex (e as outras) só com receitas fixas", () => {
    expect(cli.cleanToolIds(["kiro", "codex", "kiro", "rm -rf /", 3])).toEqual(["kiro", "codex"]);
    const script = cli.unixInstallScript(["kiro", "codex"], { home: "/home/r", platform: "linux" });
    expect(script).toContain(
      "agzos_install 'Kiro CLI' 'kiro-cli' script 'https://cli.kiro.dev/install'",
    );
    expect(script).toContain("agzos_install 'Codex' 'codex' npm '@openai/codex'");
    expect(script).toContain("Agzos Browser: CLIs de IA");
    expect(script).toContain("$HOME/.local/bin");
    // bash -n: o script gerado é bash válido.
    const dir = tmp();
    const file = path.join(dir, "install.sh");
    fs.writeFileSync(file, script);
    expect(() => execFileSync("bash", ["-n", file])).not.toThrow();
    expect(cli.installProgram({ file })).toEqual({ file: "/bin/bash", args: [file] });

    const lines = cli.windowsInstallLines(["codex", "kiro", "claude"], { home: "C:\\Users\\r" });
    expect(lines.some((line) => line.includes("npm install -g '@openai/codex'"))).toBe(true);
    expect(lines.some((line) => line.includes("Instalação manual: https://kiro.dev/cli/"))).toBe(
      true,
    );
    expect(lines.some((line) => line.includes("irm 'https://claude.ai/install.ps1' | iex"))).toBe(
      true,
    );
    expect(lines.at(-1)).toContain("SetEnvironmentVariable('Path'");
    expect(lines.every((line) => !/[\r\n]/.test(line))).toBe(true);
  });

  it("nó de agente: a CLI recebe o prompt como argumento, sem shell", () => {
    expect(
      cli.agentProgram({
        tool: "claude",
        prompt: "liste $(rm -rf ~) os arquivos",
        binary: "/home/r/.local/bin/claude",
        platform: "linux",
        env: {},
      }),
    ).toEqual({
      file: "/home/r/.local/bin/claude",
      args: ["-p", "liste $(rm -rf ~) os arquivos"],
    });
    expect(
      cli.agentProgram({
        tool: "codex",
        prompt: "x",
        binary: "/b/codex",
        platform: "linux",
        env: {},
      })?.args,
    ).toEqual(["exec", "x"]);
    // Shim .cmd do npm: cmd.exe com o prompt sem aspas nem %.
    const shim = cli.agentProgram({
      tool: "codex",
      prompt: 'faça "isso" & del %USERPROFILE%',
      binary: "C:\\Users\\r\\AppData\\Roaming\\npm\\codex.cmd",
      platform: "win32",
      env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
    });
    expect(shim?.file).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(shim?.args).toBe(
      '/d /s /c ""C:\\Users\\r\\AppData\\Roaming\\npm\\codex.cmd" "exec" "faça isso & del USERPROFILE""',
    );
    expect(
      cli.agentProgram({ tool: "agy", prompt: "x", binary: "/b/agy", platform: "linux", env: {} }),
    ).toBeNull();
    expect(
      cli.agentProgram({ tool: "claude", prompt: " ", binary: "/b/c", platform: "linux", env: {} }),
    ).toBeNull();
  });
});

describe("terminal: nome da aba e programas do main", () => {
  function fakePty() {
    const spawned: { file: string; args: unknown }[] = [];
    return {
      spawned,
      module: {
        spawn(file: string, args: unknown) {
          spawned.push({ file, args });
          return { pid: 1, onData() {}, onExit() {}, write() {}, resize() {}, kill() {} };
        },
      },
    };
  }

  it("renomeia a aba (vale para todas as vistas) e roda programas do main", () => {
    const pty = fakePty();
    const terminals = terminal.createTerminals({
      loadPty: () => pty.module,
      platform: "linux",
      env: { PATH: "/usr/bin", SHELL: "/bin/bash" },
      homedir: os.tmpdir(),
      exists: (file: string) => file === "/bin/bash",
      onData() {},
      onExit() {},
    });
    const owner = {};
    const session = terminals.open(owner, { cols: 80, rows: 24 });
    expect(terminals.rename(owner, session.id!, "  build\nfront  ")).toBe(true);
    expect(terminals.list(owner)[0]!.title).toBe("build front");
    expect(terminals.rename({}, session.id!, "outro dono")).toBe(false);
    expect(terminals.rename(owner, session.id!, "")).toBe(true);
    expect(terminals.list(owner)[0]!.title).toBeNull();
    const program = terminals.open(owner, {
      title: "Instalar CLIs de IA",
      program: { file: "/bin/bash", args: ["/tmp/x.sh"] },
    });
    expect(program.label).toBe("Instalar CLIs de IA");
    expect(pty.spawned.at(-1)).toEqual({ file: "/bin/bash", args: ["/tmp/x.sh"] });
  });

  it("F2 renomeia, Ctrl+Shift+O abre os arquivos e Ctrl+Shift+G o modo agente", () => {
    const key = (
      k: string,
      extra: Partial<Record<"ctrlKey" | "shiftKey" | "metaKey" | "altKey", boolean>> = {},
    ) => ({
      key: k,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      ...extra,
    });
    expect(terminalAction(key("F2"), false)).toBe("rename");
    expect(terminalAction(key("F2", { shiftKey: true }), false)).toBeNull();
    expect(terminalAction(key("O", { ctrlKey: true, shiftKey: true }), false)).toBe("files");
    expect(terminalAction(key("G", { metaKey: true, shiftKey: true }), true)).toBe("agent");
  });

  it("cd e caminhos entre aspas no shell certo", () => {
    expect(cdCommand("bash", "/tmp/it's")).toBe("\x15cd -- '/tmp/it'\\''s'\r");
    expect(cdCommand("powershell", "C:\\O'Neil")).toBe("Set-Location -LiteralPath 'C:\\O''Neil'\r");
    expect(cdCommand("cmd", 'C:\\a "b"')).toBe('cd /d "C:\\a b"\r');
    expect(cdCommand("ssh", "/tmp")).toBeNull();
    expect(quotePath("zsh", "/a b")).toBe("'/a b'");
  });
});

describe("arquivos no navegador", () => {
  it("decide por tipo: o Chromium mostra, texto ou binário", () => {
    for (const name of ["a.html", "b.SVG", "c.pdf", "d.png", "e.mp4", "f.json"]) {
      expect(files.fileKind(name)).toBe("native");
    }
    for (const name of ["a.ts", "b.py", "c.md", "Dockerfile", ".gitignore", "x.csv"]) {
      expect(files.fileKind(name)).toBe("text");
    }
    expect(files.fileKind("arquivo.xyz", { read: () => "binary" })).toBe("binary");
    expect(files.looksLikeText(Buffer.from("olá\nmundo\t!"))).toBe(true);
    expect(files.looksLikeText(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01]))).toBe(false);
  });

  it("agzos-file só abre com o token do usuário", () => {
    const dir = tmp();
    const file = path.join(dir, "código fonte.ts");
    fs.writeFileSync(file, "const a = '<b>';\n");
    const url = files.fileUrlOf(file, "abc");
    expect(url.startsWith("agzos-file:///")).toBe(true);
    expect(files.pathOfFileUrl(url, "abc")).toBe(file);
    expect(files.pathOfFileUrl(url, "outro")).toBeNull();
    expect(files.pathOfFileUrl(url.replace("k=abc", ""), "abc")).toBeNull();
    expect(files.urlForPath(file, "abc")).toBe(url);
    const html = path.join(dir, "a.html");
    fs.writeFileSync(html, "<p>oi</p>");
    expect(files.urlForPath(html, "abc")).toBe(pathToFileURL(html).toString());
    // file:// de código → agzos-file; pasta e HTML ficam como estão.
    expect(files.viewableUrl(pathToFileURL(file).toString(), "abc")).toBe(url);
    expect(files.viewableUrl(pathToFileURL(html).toString(), "abc")).toBe(
      pathToFileURL(html).toString(),
    );
    expect(files.viewableUrl(pathToFileURL(dir).toString(), "abc")).toBe(
      pathToFileURL(dir).toString(),
    );
    expect(files.viewableUrl("https://x.com/a.ts", "abc")).toBe("https://x.com/a.ts");
  });

  it("página de texto escapada, binário com detalhes e token errado recusado", async () => {
    const dir = tmp();
    const code = path.join(dir, "a.ts");
    fs.writeFileSync(code, "<script>alert(1)</script>\nlinha 2\n");
    const text = files.handleFileRequest(files.fileUrlOf(code, "t"), "t");
    expect(text.status).toBe(200);
    expect(text.headers.get("Content-Type")).toContain("text/html");
    const body = await text.text();
    expect(body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(body).not.toContain("<script>");
    expect(body).toContain("default-src 'none'");
    expect(body).toContain("data-agzos-open-external");
    const bin = path.join(dir, "dados.bin");
    fs.writeFileSync(bin, Buffer.from([0, 1, 2, 3, 0, 255]));
    const info = await files.handleFileRequest(files.fileUrlOf(bin, "t"), "t").text();
    expect(info).toContain("não tem visualização");
    expect(files.handleFileRequest(files.fileUrlOf(code, "t"), "x").status).toBe(403);
    expect(
      files.handleFileRequest(files.fileUrlOf(path.join(dir, "nada.ts"), "t"), "t").status,
    ).toBe(404);
  });

  it("lista pastas primeiro, sem ocultos (a não ser que peça)", () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(path.join(dir, "b.txt"), "12345");
    fs.writeFileSync(path.join(dir, "a.png"), "x");
    fs.writeFileSync(path.join(dir, ".env"), "x");
    const listing = files.listDirectory(dir);
    if (!listing.ok) throw new Error("listing");
    expect(listing.entries.map((item) => item.name)).toEqual(["src", "a.png", "b.txt"]);
    expect(listing.entries[2]!.size).toBe(5);
    expect(listing.entries[1]!.image).toBe(true);
    expect(listing.parent).toBe(path.dirname(dir));
    const all = files.listDirectory(dir, { hidden: true });
    expect(all.ok && all.entries.some((item) => item.name === ".env")).toBe(true);
    expect(files.listDirectory(path.join(dir, "nao-existe")).ok).toBe(false);
  });

  it("skills: Claude Code, comandos do Codex/OpenCode/Gemini e skill nova", () => {
    const home = tmp();
    const project = tmp();
    fs.mkdirSync(path.join(home, ".claude", "skills", "revisar"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".claude", "skills", "revisar", "SKILL.md"),
      "---\nname: revisar\ndescription: Revisa o código\n---\n# Revisar\n",
    );
    fs.mkdirSync(path.join(home, ".codex", "prompts"), { recursive: true });
    fs.writeFileSync(path.join(home, ".codex", "prompts", "deploy.md"), "Faz o deploy\n");
    fs.mkdirSync(path.join(project, ".gemini", "commands"), { recursive: true });
    fs.writeFileSync(
      path.join(project, ".gemini", "commands", "teste.toml"),
      'description = "Roda os testes"\nprompt = "x"\n',
    );
    fs.mkdirSync(path.join(project, ".claude", "commands"), { recursive: true });
    fs.writeFileSync(
      path.join(project, ".claude", "commands", "lint.md"),
      "---\ndescription: Lint\n---\n",
    );
    const found = files.findSkills({ home, cwd: project });
    const by = (invoke: string) => found.find((item) => item.invoke === invoke);
    expect(by("/revisar")).toMatchObject({
      tool: "claude",
      kind: "skill",
      scope: "user",
      description: "Revisa o código",
    });
    expect(by("/prompts:deploy")).toMatchObject({ tool: "codex", description: "Faz o deploy" });
    expect(by("/teste")).toMatchObject({
      tool: "gemini",
      scope: "project",
      description: "Roda os testes",
    });
    expect(by("/lint")).toMatchObject({ tool: "claude", kind: "command", scope: "project" });

    const created = files.createSkill({
      home,
      cwd: project,
      scope: "project",
      name: "nova-skill",
      description: "Faz algo\nem duas linhas",
      body: "Passos",
    });
    expect(created.ok).toBe(true);
    expect(fs.readFileSync(created.file!, "utf8")).toContain(
      "description: Faz algo em duas linhas",
    );
    expect(
      files.createSkill({
        home,
        cwd: project,
        scope: "project",
        name: "nova-skill",
        description: "x",
        body: "",
      }).error,
    ).toBe("exists");
    expect(
      files.createSkill({
        home,
        cwd: "",
        scope: "user",
        name: "../fora",
        description: "x",
        body: "",
      }).error,
    ).toBe("name");
  });

  it("omnibox: caminhos e file:// abrem como arquivo", () => {
    expect(fileUrlOfPath("/home/r/meu arquivo.pdf")).toBe("file:///home/r/meu%20arquivo.pdf");
    expect(fileUrlOfPath("C:\\Users\\r\\a b.html")).toBe("file:///C:/Users/r/a%20b.html");
    expect(fileUrlOfPath("file:///tmp/x.svg")).toBe("file:///tmp/x.svg");
    expect(fileUrlOfPath("//servidor")).toBeNull();
    expect(fileUrlOfPath("busca qualquer")).toBeNull();
    expect(resolveInput("/tmp/foto.png", "duckduckgo")).toEqual({
      title: "foto.png",
      url: "file:///tmp/foto.png",
      kind: "page",
    });
  });
});

describe("modo agente", () => {
  const graph: AgentGraph = {
    nodes: [
      { id: "a", title: "Pesquisar", tool: "groq", prompt: "pesquise", x: 0, y: 0 },
      { id: "b", title: "Código", tool: "claude", prompt: "implemente", x: 0, y: 0 },
      { id: "c", title: "Testes", tool: "codex", prompt: "teste", x: 0, y: 0 },
      { id: "d", title: "Revisão", tool: "groq", prompt: "revise", x: 0, y: 0 },
    ],
    edges: [
      { from: "a", to: "b" },
      { from: "a", to: "c" },
      { from: "b", to: "d" },
      { from: "c", to: "d" },
    ],
  };
  const waiting = (): Record<string, NodeRun> =>
    Object.fromEntries(graph.nodes.map((node) => [node.id, { status: "waiting", output: "" }]));

  it("roda em ordem, com as independentes em paralelo", () => {
    const runs = waiting();
    expect(readyNodes(graph, runs).map((node) => node.id)).toEqual(["a"]);
    runs["a"] = { status: "done", output: "achados" };
    expect(readyNodes(graph, runs).map((node) => node.id)).toEqual(["b", "c"]);
    runs["b"] = { status: "done", output: "feito" };
    expect(readyNodes(graph, runs).map((node) => node.id)).toEqual(["c"]);
  });

  it("a saída das etapas ligadas entra no prompt", () => {
    const runs = waiting();
    runs["b"] = { status: "done", output: "código pronto" };
    runs["c"] = { status: "done", output: "testes ok" };
    const prompt = promptWithContext(graph.nodes[3]!, graph, runs);
    expect(prompt.startsWith("revise\n\n# Resultado das etapas anteriores")).toBe(true);
    expect(prompt).toContain("## Código\ncódigo pronto");
    expect(prompt).toContain("## Testes\ntestes ok");
    expect(promptWithContext(graph.nodes[0]!, graph, runs)).toBe("pesquise");
  });

  it("falha numa etapa pula as que dependem dela", () => {
    const runs = waiting();
    runs["a"] = { status: "done", output: "" };
    runs["b"] = { status: "error", output: "" };
    const next = skipAfterFailure(graph, runs);
    expect(next["d"]!.status).toBe("skipped");
    expect(next["c"]!.status).toBe("waiting");
  });

  it("sem ciclos: nem no disco nem ao ligar", () => {
    expect(reaches(graph.edges, "a", "d")).toBe(true);
    expect(reaches(graph.edges, "d", "a")).toBe(false);
    const parsed = parseAgentGraph({
      nodes: [...graph.nodes, { id: "a", title: "repetido" }, { title: "sem id" }],
      edges: [
        ...graph.edges,
        { from: "d", to: "a" },
        { from: "a", to: "a" },
        { from: "x", to: "a" },
      ],
    });
    expect(parsed.nodes).toHaveLength(4);
    expect(parsed.edges).toHaveLength(4);
    expect(parseTerminalSettings({}).agent).toEqual({ nodes: [], edges: [] });
    expect(DEFAULT_TERMINAL.cliSetup).toBe("pending");
    expect(parseTerminalSettings({ cliSetup: "done", showHidden: true })).toMatchObject({
      cliSetup: "done",
      showHidden: true,
    });
  });

  it("plano da IA vira canvas organizado em colunas", () => {
    const steps = ai.parseAgentPlan(
      JSON.stringify({
        steps: [
          { id: "s1", title: "Ler", tool: "groq", prompt: "leia", after: [] },
          { id: "s2", title: "Fazer", tool: "inexistente", prompt: "faça", after: ["s1", "s9"] },
          { id: "s3", title: "Sem prompt", tool: "claude", prompt: "" },
          { id: "s4", title: "Ciclo", tool: "claude", prompt: "x", after: ["s4", "s2"] },
        ],
      }),
      ["groq", "claude"],
    );
    expect(steps.map((step) => step.id)).toEqual(["s1", "s2", "s4"]);
    expect(steps[1]).toMatchObject({ tool: "groq", after: ["s1"] });
    expect(steps[2]!.after).toEqual(["s2"]);
    expect(ai.parseAgentPlan("não é json", ["groq"])).toEqual([]);
    const planned = planToGraph(steps);
    expect(planned.edges).toHaveLength(2);
    const xs = planned.nodes.map((node) => node.x);
    expect(xs[0]).toBeLessThan(xs[1]!);
    expect(xs[1]).toBeLessThan(xs[2]!);
    expect(autoLayout(planned).nodes[0]!.y).toBe(40);
  });

  it("saída do terminal sem cores nem redesenho", () => {
    expect(plainOutput("\x1b[32mok\x1b[0m\r\ncarregando 10%\rcarregando 100%\n\n\n\nfim")).toBe(
      "ok\ncarregando 100%\n\nfim",
    );
  });
});

describe("PWA instalável", () => {
  const manifestUrl = "https://app.exemplo.com/manifest.json";
  const documentUrl = "https://app.exemplo.com/inbox?x=1";

  it("lê o manifesto: start_url da mesma origem, escopo e id estáveis", () => {
    const manifest = pwa.parseManifest(
      {
        name: "Exemplo Mail",
        short_name: "Mail",
        start_url: "/inbox/?source=pwa#x",
        scope: "/",
        display: "standalone",
        theme_color: "#ABC",
        icons: [
          { src: "/i/192.png", sizes: "192x192", type: "image/png" },
          { src: "/i/mask.png", sizes: "512x512", purpose: "maskable" },
          { src: "/i/a.svg", sizes: "any", type: "image/svg+xml" },
        ],
      },
      { manifestUrl, documentUrl },
    )!;
    expect(manifest).toMatchObject({
      name: "Exemplo Mail",
      startUrl: "https://app.exemplo.com/inbox/?source=pwa",
      scope: "https://app.exemplo.com/",
      origin: "https://app.exemplo.com",
      display: "standalone",
      themeColor: "#aabbcc",
    });
    expect(manifest.id).toMatch(/^[a-f0-9]{16}$/);
    expect(pwa.iconCandidates(manifest.icons)[0]!.src).toBe("https://app.exemplo.com/i/192.png");
    // start_url de outra origem cai na página; sem nome não instala.
    expect(
      pwa.parseManifest(
        { name: "X", start_url: "https://outro.com/" },
        { manifestUrl, documentUrl },
      )!.startUrl,
    ).toBe(documentUrl);
    expect(pwa.parseManifest({ icons: [] }, { manifestUrl, documentUrl })).toBeNull();
    expect(pwa.iconSize("48x48 96x96")).toBe(96);
  });

  it("instalável só com página segura, ícone e service worker", () => {
    const manifest = pwa.parseManifest(
      { name: "A", icons: [{ src: "/a.png", sizes: "192x192" }] },
      { manifestUrl, documentUrl },
    );
    expect(pwa.installability(manifest, { serviceWorker: true, documentUrl }).ok).toBe(true);
    expect(pwa.installability(manifest, { serviceWorker: false, documentUrl }).reason).toBe(
      "service-worker",
    );
    expect(
      pwa.installability(manifest, { serviceWorker: true, documentUrl: "http://site.com/" }).reason,
    ).toBe("insecure");
    expect(
      pwa.installability(pwa.parseManifest({ name: "A" }, { manifestUrl, documentUrl }), {
        serviceWorker: true,
        documentUrl,
      }).reason,
    ).toBe("icon");
    expect(pwa.scopeContains("https://app.exemplo.com/", "https://app.exemplo.com/a")).toBe(true);
    expect(pwa.scopeContains("https://app.exemplo.com/app/", "https://app.exemplo.com/b")).toBe(
      false,
    );
  });

  it("ícones .ico e .icns com PNG dentro", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const ico = pwa.icoFromPngs([
      { size: 16, png },
      { size: 256, png },
    ]);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(2);
    expect(ico.readUInt8(6)).toBe(16);
    expect(ico.readUInt8(6 + 16)).toBe(0);
    expect(ico.readUInt32LE(6 + 12)).toBe(6 + 32);
    expect(ico.length).toBe(6 + 32 + png.length * 2);
    const icns = pwa.icnsFromPngs([
      { size: 128, png },
      { size: 99, png },
    ]);
    expect(icns.toString("ascii", 0, 4)).toBe("icns");
    expect(icns.readUInt32BE(4)).toBe(icns.length);
    expect(icns.toString("ascii", 8, 12)).toBe("ic07");
  });

  it("atalhos do sistema por plataforma", () => {
    const id = "0123456789abcdef";
    expect(pwa.pwaArgOf(["agzos", `--agzos-pwa=${id}`])).toBe(id);
    expect(pwa.pwaArgOf(["agzos", "--agzos-pwa=../../x"])).toBeNull();
    expect(
      pwa.shortcutPaths({
        platform: "win32",
        home: "C:\\Users\\r",
        env: {},
        name: 'Mail: "A/B"',
        id,
      })["menu"],
    ).toBe(
      "C:\\Users\\r\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Agzos Apps\\Mail AB.lnk",
    );
    expect(
      pwa.shortcutPaths({ platform: "darwin", home: "/Users/r", env: {}, name: "Mail", id })[
        "bundle"
      ],
    ).toBe("/Users/r/Applications/Agzos Apps/Mail.app");
    expect(
      pwa.shortcutPaths({ platform: "linux", home: "/home/r", env: {}, name: "Mail", id })["menu"],
    ).toBe(`/home/r/.local/share/applications/agzos-pwa-${id}.desktop`);
    const entry = pwa.linuxDesktopEntry({
      name: "Mail\nX",
      exec: "/opt/Agzos Browser/agzos",
      args: [`--agzos-pwa=${id}`],
      icon: "/x/icon.png",
      url: "https://app.exemplo.com",
    });
    expect(entry).toContain(`Exec="/opt/Agzos Browser/agzos" "--agzos-pwa=${id}"`);
    expect(entry).toContain("Name=Mail X");
    const bundle = pwa.macBundleFiles({
      id,
      name: "Mail & Co",
      appBundle: "/Applications/Agzos Browser.app",
      exec: "",
      args: [`--agzos-pwa=${id}`],
    });
    expect(bundle["Contents/MacOS/launcher"]).toContain(
      `exec /usr/bin/open -n -a "/Applications/Agzos Browser.app" --args "--agzos-pwa=${id}"`,
    );
    expect(bundle["Contents/Info.plist"]).toContain("<string>Mail &amp; Co</string>");
    expect(pwa.fileNameOf("...")).toBe("App");
  });

  it("lista dos apps instalados (meta:pwaApps)", () => {
    const meta = new Map<string, unknown>();
    const store = pwa.createPwaStore({
      database: {
        getMeta: (key: string) => meta.get(key),
        setMeta: (key: string, value: unknown) => meta.set(key, value),
      },
    });
    const id = "0123456789abcdef";
    store.put({ id, name: "Mail", startUrl: "https://a.com/", scope: "https://a.com/", zoom: 99 });
    store.put({ id: "nao-e-id", name: "X", startUrl: "https://b.com/" });
    expect(store.list().map((item) => item.id)).toEqual([id]);
    expect(store.get(id)!.zoom).toBe(8);
    store.update(id, { zoom: 1 });
    expect(store.get(id)!.zoom).toBe(1);
    store.remove(id);
    expect(store.list()).toEqual([]);
  });
});

describe("4.1.1 fix: arquivos abertos pelo sistema", () => {
  it("pega só arquivos existentes, resolvidos pela pasta de quem chamou", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agzos-argv-"));
    const page = path.join(dir, "a b.html");
    fs.writeFileSync(page, "<p>oi</p>");
    fs.mkdirSync(path.join(dir, "pasta"));
    const argv = [
      "/opt/agzos/agzos",
      "--no-sandbox",
      "--agzos-pwa=0123456789abcdef",
      "-r",
      page,
      "pasta",
      "a b.html",
      pathToFileURL(page).href,
      "https://exemplo.com",
      "nao-existe.txt",
    ];
    expect(files.filesOfArgv(argv, { cwd: dir })).toEqual([page]);
    expect(files.filesOfArgv(null)).toEqual([]);
  });

  it("aceita caminho do Windows e ignora o executável", () => {
    const seen = new Set(["C:\\Users\\eu\\nota.pdf"]);
    const result = files.filesOfArgv(["C:\\Agzos\\Agzos.exe", "C:\\Users\\eu\\nota.pdf"], {
      cwd: "C:\\",
      exists: (file) => seen.has(file) || file.endsWith("nota.pdf"),
      isFile: () => true,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("nota.pdf");
  });
});

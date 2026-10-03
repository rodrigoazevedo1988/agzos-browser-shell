import type { SshConnection } from "@/features/browser/desktop";

/**
 * Preferências do terminal da 4.1 (prefs.terminal): posição, aparência, aliases, comandos
 * rápidos, ferramentas de IA, conexões SSH e modo voz. As chaves de API ficam fora daqui
 * (cofre do main); estas preferências não têm segredo nenhum.
 */
export type TerminalDockMode = "bottom" | "right" | "window";
export type TerminalCursor = "block" | "bar" | "underline";
export type TerminalTheme = { background: string; foreground: string; cursor: string };
export type TerminalAlias = { name: string; command: string };
export type TerminalSnippet = { id: string; name: string; command: string; run: boolean };
export type TerminalTool = { id: string; name: string; command: string; on: boolean };
export type VoiceLanguage = "pt" | "en" | "es" | "auto";
/** Nó do modo agente (4.1.1): uma etapa feita por uma CLI de IA ou pela Groq. */
export type AgentNode = {
  id: string;
  title: string;
  tool: string;
  prompt: string;
  x: number;
  y: number;
};
/** Ligação: a saída de `from` entra no prompt de `to`. */
export type AgentEdge = { from: string; to: string };
export type AgentGraph = { nodes: AgentNode[]; edges: AgentEdge[] };

export type TerminalSettings = {
  dock: TerminalDockMode;
  /** Largura (px) do terminal à direita. */
  width: number;
  themeId: string;
  theme: TerminalTheme;
  fontFamily: string;
  fontSize: number;
  cursor: TerminalCursor;
  aliases: TerminalAlias[];
  snippets: TerminalSnippet[];
  tools: TerminalTool[];
  ssh: SshConnection[];
  voice: { language: VoiceLanguage; enter: boolean };
  /** Exporta a chave da Groq do Agzos AI como GROQ_API_KEY nas sessões. */
  groqEnv: boolean;
  /** 4.1.1: a preparação das CLIs de IA já foi oferecida ao abrir o terminal. */
  cliSetup: "pending" | "done";
  /** Arquivos ocultos no navegador de arquivos do terminal. */
  showHidden: boolean;
  /** Canvas do modo agente. */
  agent: AgentGraph;
};

export const TERMINAL_WIDTH = { min: 320, max: 1200, initial: 520 } as const;
export const FONT_SIZE = { min: 9, max: 28, initial: 13 } as const;

export const THEME_PRESETS: { id: string; label: string; theme: TerminalTheme }[] = [
  {
    id: "agzos",
    label: "Agzos escuro",
    theme: { background: "#0e0e0e", foreground: "#e8e6e3", cursor: "#d43420" },
  },
  {
    id: "claro",
    label: "Claro",
    theme: { background: "#fbfaf8", foreground: "#1f1d1b", cursor: "#d43420" },
  },
  {
    id: "dracula",
    label: "Dracula",
    theme: { background: "#282a36", foreground: "#f8f8f2", cursor: "#ff79c6" },
  },
  {
    id: "solarized",
    label: "Solarized escuro",
    theme: { background: "#002b36", foreground: "#93a1a1", cursor: "#b58900" },
  },
  {
    id: "monokai",
    label: "Monokai",
    theme: { background: "#272822", foreground: "#f8f8f2", cursor: "#a6e22e" },
  },
  {
    id: "meia-noite",
    label: "Meia-noite",
    theme: { background: "#0b1021", foreground: "#c9d1f5", cursor: "#7aa2f7" },
  },
];

export const FONT_FAMILIES = [
  "Cascadia Mono",
  "JetBrains Mono",
  "Fira Code",
  "SF Mono",
  "Menlo",
  "Consolas",
  "Ubuntu Mono",
  "Courier New",
];

/** Família escolhida com as reservas de sempre (a fonte pode não existir no sistema). */
export function fontStack(family: string) {
  const name = family.replace(/["\\]/g, "").trim();
  const base = 'ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace';
  return name ? `"${name}", ${base}` : base;
}

/** Ferramentas de IA de linha de comando do lançador (comando editável). */
export const DEFAULT_TOOLS: TerminalTool[] = [
  { id: "claude", name: "Claude Code", command: "claude", on: true },
  { id: "opencode", name: "OpenCode", command: "opencode", on: true },
  { id: "kiro", name: "Kiro CLI", command: "kiro-cli", on: true },
  { id: "agy", name: "Antigravity", command: "agy", on: true },
  { id: "freebuff", name: "Freebuff", command: "freebuff", on: true },
  { id: "codex", name: "Codex", command: "codex", on: true },
  { id: "gemini", name: "Gemini CLI", command: "gemini", on: true },
];

/** CLIs de IA da instalação inicial (ids de electron/cli-install.cjs). */
export const CLI_SETUP: { id: string; name: string; command: string; note?: string }[] = [
  { id: "claude", name: "Claude Code", command: "claude" },
  { id: "codex", name: "Codex", command: "codex", note: "npm" },
  { id: "kiro", name: "Kiro CLI", command: "kiro-cli" },
  { id: "opencode", name: "OpenCode", command: "opencode" },
  { id: "gemini", name: "Gemini CLI", command: "gemini", note: "npm" },
  { id: "freebuff", name: "Freebuff", command: "freebuff", note: "npm" },
  { id: "agy", name: "Antigravity", command: "agy", note: "instalação manual (app)" },
];

/** Variáveis de API mais usadas por essas ferramentas (dá para pôr qualquer outra). */
export const API_PROVIDERS: { name: string; label: string }[] = [
  { name: "ANTHROPIC_API_KEY", label: "Anthropic (Claude Code, OpenCode)" },
  { name: "OPENAI_API_KEY", label: "OpenAI (Codex, OpenCode)" },
  { name: "GEMINI_API_KEY", label: "Google Gemini (Gemini CLI)" },
  { name: "OPENROUTER_API_KEY", label: "OpenRouter" },
  { name: "GROQ_API_KEY", label: "Groq" },
  { name: "DEEPSEEK_API_KEY", label: "DeepSeek" },
  { name: "XAI_API_KEY", label: "xAI (Grok)" },
  { name: "MISTRAL_API_KEY", label: "Mistral" },
];

export const VOICE_LANGUAGES: { id: VoiceLanguage; label: string }[] = [
  { id: "pt", label: "Português" },
  { id: "en", label: "Inglês" },
  { id: "es", label: "Espanhol" },
  { id: "auto", label: "Detectar automaticamente" },
];

export const DEFAULT_TERMINAL: TerminalSettings = {
  dock: "bottom",
  width: TERMINAL_WIDTH.initial,
  themeId: "agzos",
  theme: THEME_PRESETS[0]!.theme,
  fontFamily: "",
  fontSize: FONT_SIZE.initial,
  cursor: "block",
  aliases: [],
  snippets: [
    { id: "git-status", name: "git status", command: "git status", run: true },
    { id: "git-log", name: "Últimos commits", command: "git log --oneline -15", run: true },
  ],
  tools: DEFAULT_TOOLS,
  ssh: [],
  voice: { language: "pt", enter: false },
  groqEnv: false,
  cliSetup: "pending",
  showHidden: false,
  agent: { nodes: [], edges: [] },
};

/** Atalhos com o foco no terminal (⌘ no lugar do Ctrl no Mac). */
export type TerminalAction =
  | "new"
  | "close"
  | "next"
  | "previous"
  | "voice"
  | "launcher"
  | "font-up"
  | "font-down"
  | "font-reset"
  | "rename"
  | "files"
  | "agent";

export const TERMINAL_SHORTCUTS: { action: TerminalAction; keys: string; label: string }[] = [
  { action: "new", keys: "Ctrl+Shift+E", label: "Nova sessão" },
  { action: "close", keys: "Ctrl+Shift+W", label: "Fechar a sessão" },
  { action: "next", keys: "Ctrl+Shift+→", label: "Próxima sessão" },
  { action: "previous", keys: "Ctrl+Shift+←", label: "Sessão anterior" },
  { action: "voice", keys: "Ctrl+Shift+M", label: "Modo voz (gravar/parar)" },
  { action: "launcher", keys: "Ctrl+Shift+K", label: "Lançador: IA, SSH e comandos rápidos" },
  { action: "font-up", keys: "Ctrl+=", label: "Aumentar a fonte" },
  { action: "font-down", keys: "Ctrl+-", label: "Diminuir a fonte" },
  { action: "font-reset", keys: "Ctrl+0", label: "Fonte no tamanho padrão" },
  { action: "rename", keys: "F2", label: "Renomear a aba" },
  { action: "files", keys: "Ctrl+Shift+O", label: "Arquivos (modo ls lateral)" },
  { action: "agent", keys: "Ctrl+Shift+G", label: "Modo agente (canvas)" },
];

/** Tecla → atalho do terminal (null: segue para o shell). */
export function terminalAction(
  event: {
    key: string;
    code?: string;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
  },
  mac: boolean,
): TerminalAction | null {
  const mod = mac ? event.metaKey : event.ctrlKey;
  if (event.key === "F2" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
    return "rename";
  }
  if (!mod || event.altKey || (mac ? event.ctrlKey : event.metaKey)) return null;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (event.shiftKey) {
    switch (key) {
      case "e":
        return "new";
      case "w":
        return "close";
      case "ArrowRight":
        return "next";
      case "ArrowLeft":
        return "previous";
      case "m":
        return "voice";
      case "k":
        return "launcher";
      case "o":
        return "files";
      case "g":
        return "agent";
      default:
        return null;
    }
  }
  if (key === "=" || key === "+") return "font-up";
  if (key === "-") return "font-down";
  if (key === "0") return "font-reset";
  return null;
}

/** Como aparece no Mac (⌘ e ⇧). */
export function shortcutText(keys: string, mac: boolean) {
  return mac ? keys.replace("Ctrl+", "⌘").replace("Shift+", "⇧") : keys;
}

// --- Validação (o que vem do disco) ---

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.slice(0, max) : "";
const COLOR = /^#[0-9a-f]{6}$/i;
const ALIAS_NAME = /^[A-Za-z_][A-Za-z0-9_.-]{0,40}$/;
const oneLine = (value: string) => !/[\r\n]/.test(value);

function idOf(value: unknown, index: number) {
  const id = text(value, 60).trim();
  return id || `item-${index + 1}`;
}

export function parseTheme(value: unknown): TerminalTheme {
  const raw = isObject(value) ? value : {};
  const base = DEFAULT_TERMINAL.theme;
  const color = (key: keyof TerminalTheme) =>
    typeof raw[key] === "string" && COLOR.test(raw[key] as string)
      ? (raw[key] as string)
      : base[key];
  return {
    background: color("background"),
    foreground: color("foreground"),
    cursor: color("cursor"),
  };
}

export function parseTerminalSettings(value: unknown): TerminalSettings {
  const raw = isObject(value) ? value : {};
  const number = (key: string, min: number, max: number, fallback: number) => {
    const item = raw[key];
    return typeof item === "number" && Number.isFinite(item)
      ? Math.round(Math.min(max, Math.max(min, item)))
      : fallback;
  };
  const list = (key: string) => (Array.isArray(raw[key]) ? (raw[key] as unknown[]) : null);

  const aliases: TerminalAlias[] = [];
  for (const item of list("aliases") ?? []) {
    if (!isObject(item)) continue;
    const name = text(item["name"], 41).trim();
    const command = text(item["command"], 500).trim();
    if (!ALIAS_NAME.test(name) || !command || !oneLine(command)) continue;
    if (aliases.some((alias) => alias.name === name)) continue;
    aliases.push({ name, command });
  }

  const snippetList = list("snippets");
  const snippets: TerminalSnippet[] = snippetList
    ? snippetList.flatMap((item, index) => {
        if (!isObject(item)) return [];
        const name = text(item["name"], 60).trim();
        const command = text(item["command"], 2000);
        if (!name || !command.trim()) return [];
        return [{ id: idOf(item["id"], index), name, command, run: item["run"] === true }];
      })
    : DEFAULT_TERMINAL.snippets;

  const toolList = list("tools");
  const tools: TerminalTool[] = toolList
    ? toolList.flatMap((item, index) => {
        if (!isObject(item)) return [];
        const name = text(item["name"], 60).trim();
        const command = text(item["command"], 300).trim();
        if (!name || !command || !oneLine(command)) return [];
        return [{ id: idOf(item["id"], index), name, command, on: item["on"] !== false }];
      })
    : DEFAULT_TOOLS;

  const ssh: SshConnection[] = (list("ssh") ?? []).flatMap((item, index) => {
    if (!isObject(item)) return [];
    const host = text(item["host"], 253).trim();
    if (!host || host.startsWith("-")) return [];
    const port = typeof item["port"] === "number" ? Math.round(item["port"]) : 22;
    return [
      {
        id: idOf(item["id"], index),
        name: text(item["name"], 60).trim(),
        user: text(item["user"], 64).trim(),
        host,
        port: port >= 1 && port <= 65535 ? port : 22,
        key: text(item["key"], 1024).trim(),
      },
    ];
  });

  const voice = isObject(raw["voice"]) ? raw["voice"] : {};
  const language = ["pt", "en", "es", "auto"].includes(voice["language"] as string)
    ? (voice["language"] as VoiceLanguage)
    : DEFAULT_TERMINAL.voice.language;

  return {
    cliSetup: raw["cliSetup"] === "done" ? "done" : "pending",
    showHidden: raw["showHidden"] === true,
    agent: parseAgentGraph(raw["agent"]),
    dock: raw["dock"] === "right" || raw["dock"] === "window" ? raw["dock"] : "bottom",
    width: number("width", TERMINAL_WIDTH.min, TERMINAL_WIDTH.max, TERMINAL_WIDTH.initial),
    themeId: text(raw["themeId"], 40) || DEFAULT_TERMINAL.themeId,
    theme: parseTheme(raw["theme"]),
    fontFamily: text(raw["fontFamily"], 80).replace(/["\\]/g, ""),
    fontSize: number("fontSize", FONT_SIZE.min, FONT_SIZE.max, FONT_SIZE.initial),
    cursor: raw["cursor"] === "bar" || raw["cursor"] === "underline" ? raw["cursor"] : "block",
    aliases,
    snippets,
    tools,
    ssh,
    voice: { language, enter: voice["enter"] === true },
    groqEnv: raw["groqEnv"] === true,
  };
}

const NODE_LIMIT = 40;

/** Canvas do modo agente vindo do disco: nós válidos e ligações entre eles, sem ciclo. */
export function parseAgentGraph(value: unknown): AgentGraph {
  const raw = isObject(value) ? value : {};
  const nodes: AgentNode[] = [];
  for (const item of Array.isArray(raw["nodes"]) ? (raw["nodes"] as unknown[]) : []) {
    if (!isObject(item) || nodes.length >= NODE_LIMIT) continue;
    const id = text(item["id"], 40).trim();
    if (!id || nodes.some((node) => node.id === id)) continue;
    const coord = (key: string) =>
      typeof item[key] === "number" && Number.isFinite(item[key])
        ? Math.round(Math.max(-5000, Math.min(5000, item[key] as number)))
        : 0;
    nodes.push({
      id,
      title: text(item["title"], 60).trim() || "Etapa",
      tool: text(item["tool"], 40).trim() || "groq",
      prompt: text(item["prompt"], 8000),
      x: coord("x"),
      y: coord("y"),
    });
  }
  const ids = new Set(nodes.map((node) => node.id));
  const edges: AgentEdge[] = [];
  for (const item of Array.isArray(raw["edges"]) ? (raw["edges"] as unknown[]) : []) {
    if (!isObject(item)) continue;
    const from = text(item["from"], 40);
    const to = text(item["to"], 40);
    if (!ids.has(from) || !ids.has(to) || from === to) continue;
    if (edges.some((edge) => edge.from === from && edge.to === to)) continue;
    if (reaches(edges, to, from)) continue;
    edges.push({ from, to });
  }
  return { nodes, edges };
}

/** Há caminho de `start` até `target` seguindo as ligações? (evita ciclo) */
export function reaches(edges: AgentEdge[], start: string, target: string): boolean {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === target) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const edge of edges) if (edge.from === id) stack.push(edge.to);
  }
  return false;
}

/** Largura máxima à direita que ainda deixa `keep` px de página. */
export function terminalWidthLimit(available: number, keep = 360) {
  return Math.max(TERMINAL_WIDTH.min, Math.min(TERMINAL_WIDTH.max, available - keep));
}

export function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

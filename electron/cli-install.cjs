// CLIs de IA do terminal (4.1.1): como instalar cada uma em cada sistema, quais pastas
// entram no PATH dos terminais e como rodar uma em modo não interativo (agentes).
// Nada aqui roda sozinho: a instalação é um script visível numa aba do terminal que o
// usuário pediu (Instalar), e as receitas são fixas (nunca texto vindo da casca).

const path = require("node:path");

/**
 * Receitas: `script` (instalador oficial por curl/irm), `npm` (pacote global) ou `manual`
 * (link). `headless` monta os argumentos de uma execução sem interação (nó de agente).
 */
const CLI_TOOLS = {
  claude: {
    name: "Claude Code",
    command: "claude",
    unix: { kind: "script", value: "https://claude.ai/install.sh" },
    win: { kind: "script", value: "https://claude.ai/install.ps1" },
    headless: (prompt) => ["-p", prompt],
  },
  codex: {
    name: "Codex",
    command: "codex",
    unix: { kind: "npm", value: "@openai/codex" },
    win: { kind: "npm", value: "@openai/codex" },
    headless: (prompt) => ["exec", prompt],
  },
  kiro: {
    name: "Kiro CLI",
    command: "kiro-cli",
    unix: { kind: "script", value: "https://cli.kiro.dev/install" },
    win: { kind: "manual", value: "https://kiro.dev/cli/" },
    headless: (prompt) => ["chat", "--no-interactive", prompt],
  },
  opencode: {
    name: "OpenCode",
    command: "opencode",
    unix: { kind: "script", value: "https://opencode.ai/install" },
    win: { kind: "npm", value: "opencode-ai" },
    headless: (prompt) => ["run", prompt],
  },
  gemini: {
    name: "Gemini CLI",
    command: "gemini",
    unix: { kind: "npm", value: "@google/gemini-cli" },
    win: { kind: "npm", value: "@google/gemini-cli" },
    headless: (prompt) => ["-p", prompt],
  },
  freebuff: {
    name: "Freebuff",
    command: "freebuff",
    unix: { kind: "npm", value: "freebuff" },
    win: { kind: "npm", value: "freebuff" },
    headless: null,
  },
  agy: {
    name: "Antigravity",
    command: "agy",
    unix: { kind: "manual", value: "https://antigravity.google/download" },
    win: { kind: "manual", value: "https://antigravity.google/download" },
    headless: null,
  },
};

const TOOL_IDS = Object.keys(CLI_TOOLS);

/** Pastas onde esses instaladores deixam os comandos (entram no PATH dos terminais). */
function cliPathDirs({ platform, env, home }) {
  if (platform === "win32") {
    const join = path.win32.join;
    const appData = env.APPDATA || join(home, "AppData", "Roaming");
    const local = env.LOCALAPPDATA || join(home, "AppData", "Local");
    return [
      join(appData, "npm"),
      join(home, ".local", "bin"),
      join(home, ".bun", "bin"),
      join(home, ".opencode", "bin"),
      join(local, "Programs", "Antigravity", "bin"),
      join(env.ProgramFiles || "C:\\Program Files", "nodejs"),
    ];
  }
  const join = path.posix.join;
  const dirs = [
    join(home, ".local", "bin"),
    join(home, ".npm-global", "bin"),
    join(home, ".opencode", "bin"),
    join(home, ".bun", "bin"),
    join(home, ".claude", "local"),
    join(home, ".antigravity", "antigravity", "bin"),
    "/usr/local/bin",
  ];
  if (platform === "darwin") dirs.push("/opt/homebrew/bin", "/opt/homebrew/sbin");
  return dirs;
}

/** PATH com as pastas das CLIs no fim (o do usuário continua mandando). */
function withCliPath(env, { platform, home }) {
  const key = platform === "win32" && !("PATH" in env) && "Path" in env ? "Path" : "PATH";
  const separator = platform === "win32" ? ";" : ":";
  const current = String(env[key] ?? "")
    .split(separator)
    .filter(Boolean);
  const seen = new Set(current.map((dir) => (platform === "win32" ? dir.toLowerCase() : dir)));
  const extra = cliPathDirs({ platform, env, home }).filter((dir) => {
    const id = platform === "win32" ? dir.toLowerCase() : dir;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return { ...env, [key]: [...current, ...extra].join(separator) };
}

const shQuote = (text) => `'${String(text).replace(/'/g, "'\\''")}'`;
const psQuote = (text) => `'${String(text).replace(/'/g, "''")}'`;

/** Só ids conhecidos, sem repetir. */
function cleanToolIds(ids) {
  return [...new Set(Array.isArray(ids) ? ids : [])].filter((id) => TOOL_IDS.includes(id));
}

/** Script bash (Linux e macOS) que instala as ferramentas e põe as pastas no PATH. */
function unixInstallScript(ids, { home, platform }) {
  const dirs = cliPathDirs({ platform, env: {}, home }).filter((dir) => dir.startsWith(home));
  const pathLine = `export PATH="$PATH:${dirs.map((dir) => dir.replace(home, "$HOME")).join(":")}"`;
  const steps = cleanToolIds(ids).map((id) => {
    const tool = CLI_TOOLS[id];
    return `agzos_install ${shQuote(tool.name)} ${shQuote(tool.command)} ${tool.unix.kind} ${shQuote(tool.unix.value)}`;
  });
  return [
    "#!/usr/bin/env bash",
    "# Gerado pelo Agzos Browser: instala as CLIs de IA escolhidas e põe as pastas no PATH.",
    pathLine,
    "agzos_ok=(); agzos_fail=()",
    'have() { command -v "$1" >/dev/null 2>&1; }',
    "agzos_npm() {",
    '  if ! have npm && [ "$(uname)" = Darwin ] && have brew; then brew install node; fi',
    "  if ! have npm; then",
    '    echo "  npm não encontrado: instale o Node.js LTS (https://nodejs.org) e rode de novo."',
    "    return 1",
    "  fi",
    '  local prefix; prefix="$(npm prefix -g 2>/dev/null)"',
    '  if [ -n "$prefix" ] && [ ! -w "$prefix" ]; then',
    '    echo "  npm global sem permissão de escrita: usando ~/.npm-global"',
    '    npm config set prefix "$HOME/.npm-global"',
    "  fi",
    '  npm install -g "$1"',
    "}",
    "agzos_install() {",
    '  local name="$1" cmd="$2" kind="$3" value="$4"',
    "  printf '\\n\\033[1m== %s ==\\033[0m\\n' \"$name\"",
    '  if have "$cmd"; then echo "  já instalado: $(command -v "$cmd")"; agzos_ok+=("$name"); return; fi',
    '  case "$kind" in',
    "    script)",
    '      if have curl; then curl -fsSL "$value" | bash',
    '      else echo "  curl não encontrado (necessário para o instalador oficial)."; fi ;;',
    '    npm) agzos_npm "$value" ;;',
    '    manual) echo "  instalação manual: $value" ;;',
    "  esac",
    "  hash -r",
    '  if have "$cmd"; then agzos_ok+=("$name"); else agzos_fail+=("$name"); fi',
    "}",
    ...steps,
    "# PATH dos próximos shells (bash e zsh), uma vez só.",
    'for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do',
    '  case "$rc" in *"$(basename "${SHELL:-bash}")"rc) ;; *) [ -f "$rc" ] || continue ;; esac',
    '  grep -q "Agzos Browser: CLIs de IA" "$rc" 2>/dev/null && continue',
    `  printf '\\n# Agzos Browser: CLIs de IA no PATH\\n%s\\n' ${shQuote(pathLine)} >> "$rc"`,
    "done",
    "echo",
    'echo "Instaladas: ${agzos_ok[*]:-nenhuma}"',
    '[ ${#agzos_fail[@]} -gt 0 ] && echo "Não instaladas: ${agzos_fail[*]}"',
    'read -r -p "Pronto. Enter fecha esta aba. " _',
    "",
  ].join("\n");
}

/**
 * Windows: linhas digitadas numa sessão interativa do PowerShell (como o usuário faria),
 * uma por ferramenta, mais a do PATH do usuário (registro).
 */
function windowsInstallLines(ids, { home, env = {} }) {
  const dirs = cliPathDirs({ platform: "win32", env, home });
  const list = `@(${dirs.map(psQuote).join(",")})`;
  const lines = [
    `$env:Path = (@($env:Path -split ';' | ? { $_ }) + ${list}) -join ';'`,
    "$agzosNpm = { if (-not (Get-Command npm -ea 0) -and (Get-Command winget -ea 0)) { winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements; $env:Path += ';' + (Join-Path $env:ProgramFiles 'nodejs') }; [bool](Get-Command npm -ea 0) }",
  ];
  for (const id of cleanToolIds(ids)) {
    const tool = CLI_TOOLS[id];
    const { kind, value } = tool.win;
    const title = `Write-Host ${psQuote(`== ${tool.name} ==`)} -ForegroundColor Cyan`;
    const have = `Get-Command ${psQuote(tool.command)} -ea 0`;
    let action;
    if (kind === "script") action = `irm ${psQuote(value)} | iex`;
    else if (kind === "npm") {
      action = `if (& $agzosNpm) { npm install -g ${psQuote(value)} } else { Write-Host 'npm não encontrado: instale o Node.js LTS (https://nodejs.org).' }`;
    } else action = `Write-Host ${psQuote(`Instalação manual: ${value}`)}`;
    lines.push(`${title}; if (${have}) { Write-Host 'já instalado' } else { ${action} }`);
  }
  lines.push(
    `$agzosUser = @([Environment]::GetEnvironmentVariable('Path','User') -split ';' | ? { $_ }); foreach ($d in ${list}) { if ((Test-Path $d) -and ($agzosUser -notcontains $d)) { $agzosUser += $d } }; [Environment]::SetEnvironmentVariable('Path', ($agzosUser -join ';'), 'User'); Write-Host 'Pronto: PATH do usuário atualizado.'`,
  );
  return lines;
}

/** Programa da aba de instalação no Linux/macOS: o script gravado em `file`. */
function installProgram({ file }) {
  return { file: "/bin/bash", args: [file] };
}

/** Texto do prompt seguro dentro de aspas duplas do cmd.exe (shims .cmd do npm). */
function cmdSafe(text) {
  return String(text)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/["%!^]/g, "")
    .trim();
}

/**
 * Programa de um nó de agente: a CLI com o prompt como argumento, sem shell no meio.
 * `binary` é o caminho achado no PATH. Shim .cmd/.bat do npm no Windows vai pelo cmd.exe
 * com o prompt limpo de aspas e % (não vira outro comando).
 */
function agentProgram({ tool, prompt, binary, platform, env }) {
  const recipe = CLI_TOOLS[tool];
  const text = String(prompt ?? "").slice(0, 8000);
  if (!recipe?.headless || !binary || !text.trim()) return null;
  const args = recipe.headless(text);
  if (platform === "win32" && /\.(cmd|bat)$/i.test(binary)) {
    const comspec = env.ComSpec || "C:\\Windows\\System32\\cmd.exe";
    const line = [binary, ...args].map((arg) => `"${cmdSafe(arg)}"`).join(" ");
    return { file: comspec, args: `/d /s /c "${line}"` };
  }
  return { file: binary, args };
}

module.exports = {
  CLI_TOOLS,
  TOOL_IDS,
  agentProgram,
  cleanToolIds,
  cliPathDirs,
  cmdSafe,
  installProgram,
  unixInstallScript,
  windowsInstallLines,
  withCliPath,
};

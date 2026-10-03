// Terminal 4.1: como cada sessão sobe. Regras puras (testáveis) para:
// - aliases do usuário, que entram por arquivos de inicialização gerados pelo Agzos
//   (bash --rcfile, ZDOTDIR do zsh, -NoExit do PowerShell, doskey do cmd). Os arquivos do
//   usuário continuam valendo: os nossos carregam os dele antes dos aliases;
// - sessões SSH (o próprio ssh é o processo do PTY);
// - quais comandos (ferramentas de IA) existem no PATH.
// Sem aliases a sessão sobe exatamente como na 4.0.

const fs = require("node:fs");
const path = require("node:path");

const ALIAS_NAME = /^[A-Za-z_][A-Za-z0-9_.-]{0,40}$/;
const MAX_ALIASES = 100;

/** Só aliases válidos: nome simples e comando de uma linha. */
function cleanAliases(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const result = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const command = typeof item.command === "string" ? item.command.trim() : "";
    if (!ALIAS_NAME.test(name) || !command || command.length > 500 || /[\r\n]/.test(command)) {
      continue;
    }
    if (seen.has(name)) continue;
    seen.add(name);
    result.push({ name, command });
    if (result.length >= MAX_ALIASES) break;
  }
  return result;
}

const shQuote = (text) => `'${String(text).replace(/'/g, "'\\''")}'`;
const psQuote = (text) => `'${String(text).replace(/'/g, "''")}'`;

/** Arquivos de inicialização de cada shell (nome do arquivo → conteúdo). */
function initFiles(shellId, aliases) {
  const aliasLines = aliases.map(({ name, command }) => `alias ${name}=${shQuote(command)}`);
  if (shellId === "bash") {
    return {
      bashrc: [
        "# Gerado pelo Agzos Browser: carrega os seus arquivos e depois os aliases do terminal.",
        "[ -f /etc/profile ] && . /etc/profile",
        'if [ -f "$HOME/.bash_profile" ]; then . "$HOME/.bash_profile"',
        'elif [ -f "$HOME/.bash_login" ]; then . "$HOME/.bash_login"',
        'elif [ -f "$HOME/.profile" ]; then . "$HOME/.profile"',
        'elif [ -f "$HOME/.bashrc" ]; then . "$HOME/.bashrc"; fi',
        ...aliasLines,
        "",
      ].join("\n"),
    };
  }
  if (shellId === "zsh") {
    // ZDOTDIR aponta para a pasta do Agzos; cada arquivo carrega o do usuário com o ZDOTDIR
    // dele (e devolve o nosso depois). Os aliases entram no fim do .zshrc.
    const forward = (file, extra = []) =>
      [
        "# Gerado pelo Agzos Browser.",
        'agzos_zdotdir="$ZDOTDIR"',
        'ZDOTDIR="${AGZOS_USER_ZDOTDIR:-$HOME}"',
        `[[ -f "$ZDOTDIR/${file}" ]] && . "$ZDOTDIR/${file}"`,
        'AGZOS_USER_ZDOTDIR="$ZDOTDIR"',
        'ZDOTDIR="$agzos_zdotdir"',
        ...extra,
        "",
      ].join("\n");
    return {
      ".zshenv": forward(".zshenv"),
      ".zprofile": forward(".zprofile"),
      ".zshrc": forward(".zshrc", aliasLines),
      ".zlogin": forward(".zlogin"),
    };
  }
  if (shellId === "powershell" || shellId === "pwsh") {
    // Função em vez de Set-Alias: o alias do PowerShell não aceita argumentos.
    return {
      "aliases.ps1": [
        "# Gerado pelo Agzos Browser: aliases do terminal.",
        ...aliases.map(
          ({ name, command }) =>
            `Remove-Item -Path ${psQuote(`Alias:${name}`)} -Force -ErrorAction SilentlyContinue\n` +
            `function global:${name} { ${command} @args }`,
        ),
        "",
      ].join("\r\n"),
    };
  }
  if (shellId === "cmd") {
    return {
      "aliases.doskey": aliases.map(({ name, command }) => `${name}=${command} $*`).join("\r\n"),
    };
  }
  return {};
}

/**
 * Argumentos e variáveis extras para subir o shell com os aliases. `dir` é a pasta onde
 * os arquivos de initFiles foram gravados. Shell desconhecido: sem mudança.
 */
function launchWithAliases(shell, dir) {
  switch (shell.id) {
    case "bash":
      return { args: ["--rcfile", path.join(dir, "bashrc"), "-i"], env: {} };
    case "zsh":
      return { args: shell.args, env: { ZDOTDIR: dir } };
    case "powershell":
    case "pwsh":
      return {
        args: [
          ...shell.args,
          "-NoExit",
          "-Command",
          `. ${psQuote(path.win32.join(dir, "aliases.ps1"))}`,
        ],
        env: {},
      };
    case "cmd":
      return {
        args: ["/K", `doskey /macrofile="${path.win32.join(dir, "aliases.doskey")}"`],
        env: {},
      };
    default:
      return { args: shell.args, env: {} };
  }
}

/** Grava os arquivos de inicialização (só quando mudam) e devolve como subir o shell. */
function prepareAliases(shell, aliases, baseDir, { env = process.env } = {}) {
  const list = cleanAliases(aliases);
  const files = list.length ? initFiles(shell.id, list) : {};
  if (!Object.keys(files).length) return { args: shell.args, env: {} };
  const dir = path.join(baseDir, shell.id);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, name);
    let current = null;
    try {
      current = fs.readFileSync(file, "utf8");
    } catch {
      current = null;
    }
    if (current !== content) fs.writeFileSync(file, content, { mode: 0o600 });
  }
  const launch = launchWithAliases(shell, dir);
  if (shell.id === "zsh") launch.env.AGZOS_USER_ZDOTDIR = env.ZDOTDIR || env.HOME || "";
  return launch;
}

// --- SSH ---

const HOST_RE = /^[A-Za-z0-9_.:[\]-]{1,253}$/;
const USER_RE = /^[A-Za-z0-9_.@-]{1,64}$/;

/** Conexão salva → argumentos do ssh (nunca uma opção vinda do host ou do usuário). */
function sshArgs(connection) {
  const host = String(connection?.host ?? "").trim();
  const user = String(connection?.user ?? "").trim();
  const port = Number(connection?.port ?? 22);
  if (!HOST_RE.test(host) || host.startsWith("-")) return null;
  if (user && (!USER_RE.test(user) || user.startsWith("-"))) return null;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const args = [];
  if (port !== 22) args.push("-p", String(port));
  const key = typeof connection?.key === "string" ? connection.key.trim() : "";
  if (key) args.push("-i", key);
  args.push(user ? `${user}@${host}` : host);
  return args;
}

function onPath(name, { platform, env, exists }) {
  const dirs = String(env.PATH ?? env.Path ?? "")
    .split(platform === "win32" ? ";" : ":")
    .filter(Boolean);
  const join = platform === "win32" ? path.win32.join : path.posix.join;
  const extensions =
    platform === "win32"
      ? [
          "",
          ...String(env.PATHEXT || ".COM;.EXE;.BAT;.CMD;.PS1")
            .toLowerCase()
            .split(";"),
        ]
      : [""];
  for (const dir of dirs) {
    for (const ext of extensions) {
      const file = join(dir, name + ext);
      if (exists(file)) return file;
    }
  }
  return null;
}

/** Binário do ssh do sistema (OpenSSH do Windows 10+, /usr/bin/ssh). */
function sshBinary({ platform, env, exists }) {
  if (platform === "win32") {
    const root = env.SystemRoot || env.windir || "C:\\Windows";
    const builtin = path.win32.join(root, "System32", "OpenSSH", "ssh.exe");
    if (exists(builtin)) return builtin;
    return onPath("ssh", { platform, env, exists });
  }
  for (const file of ["/usr/bin/ssh", "/usr/local/bin/ssh", "/opt/homebrew/bin/ssh"]) {
    if (exists(file)) return file;
  }
  return onPath("ssh", { platform, env, exists });
}

const COMMAND_RE = /^[A-Za-z0-9_.@/-]{1,80}$/;

/** Primeira palavra do comando ("claude --resume" → "claude"). */
function commandName(command) {
  const first = String(command ?? "")
    .trim()
    .split(/\s+/)[0];
  return first && COMMAND_RE.test(first) ? first : null;
}

/** Quais comandos existem no PATH (ferramentas de IA do lançador). */
function detectCommands(commands, { platform, env, exists }) {
  const result = {};
  for (const command of Array.isArray(commands) ? commands.slice(0, 40) : []) {
    const name = commandName(command);
    if (name) result[name] = onPath(name, { platform, env, exists }) !== null;
  }
  return result;
}

module.exports = {
  cleanAliases,
  commandName,
  detectCommands,
  initFiles,
  launchWithAliases,
  onPath,
  prepareAliases,
  sshArgs,
  sshBinary,
};

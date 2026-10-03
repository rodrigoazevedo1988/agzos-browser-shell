// Terminal (4.0): shells de verdade num PTY (node-pty) no processo principal; a casca
// desenha com xterm.js e só troca bytes pelo IPC. Nenhum comando é executado sozinho: abrir
// uma sessão só inicia o shell interativo na pasta pedida.
//
// O node-pty é o único módulo nativo do app (N-API, então o mesmo binário serve ao
// Electron). scripts/build-all.sh copia o lib/ e o binário de cada plataforma para
// resources/app/node_modules/node-pty.

const fs = require("node:fs");
const path = require("node:path");

/** Sessões por janela (proteção contra laço abrindo shells). */
const MAX_SESSIONS = 12;
/** Junta a saída do PTY em lotes (menos mensagens de IPC com saída rápida). */
const FLUSH_MS = 8;
const CWD_CHECK_MS = 400;
/** Saída recente de cada sessão (4.1): repetida quando o terminal troca de lugar. */
const HISTORY_LIMIT = 256 * 1024;

// Teclas que, com o foco no terminal, continuam sendo do navegador (mesma lista de
// src/features/terminal/model.ts). O resto (Ctrl+C, Ctrl+W, Ctrl+R…) vai para o shell.
const BROWSER_COMBOS = new Set([
  "mod+tab",
  "mod+shift+tab",
  "mod+pageup",
  "mod+pagedown",
  "mod+shift+pageup",
  "mod+shift+pagedown",
  "mod+alt+t",
  "mod+shift+a",
  "mod+shift+t",
  "mod+shift+n",
  "mod+1",
  "mod+2",
  "mod+3",
  "mod+4",
  "mod+5",
  "mod+6",
  "mod+7",
  "mod+8",
  "mod+9",
  "f11",
]);

/** No Mac o ⌘ é sempre do navegador (o Ctrl é do shell). */
function terminalKeepsBrowserKey(combo, { mac = false, meta = false } = {}) {
  if (mac && meta) return true;
  return BROWSER_COMBOS.has(combo);
}

function onPath(name, env, exists) {
  const dirs = String(env.PATH ?? env.Path ?? "")
    .split(path.delimiter)
    .filter(Boolean);
  return dirs.map((dir) => path.join(dir, name)).find((file) => exists(file)) ?? null;
}

/**
 * Shells disponíveis na plataforma, o padrão primeiro.
 * Windows: Windows PowerShell, PowerShell 7 (se instalado) e o Prompt de Comando.
 */
function availableShells({ platform, env, exists }) {
  if (platform === "win32") {
    const root = env.SystemRoot || env.windir || "C:\\Windows";
    const list = [
      {
        id: "powershell",
        label: "Windows PowerShell",
        file: path.win32.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
        args: ["-NoLogo"],
      },
    ];
    const pwsh =
      onPath("pwsh.exe", env, exists) ??
      [env.ProgramFiles, env["ProgramFiles(x86)"]]
        .filter(Boolean)
        .map((dir) => path.win32.join(dir, "PowerShell", "7", "pwsh.exe"))
        .find((file) => exists(file)) ??
      null;
    if (pwsh) list.push({ id: "pwsh", label: "PowerShell 7", file: pwsh, args: ["-NoLogo"] });
    list.push({
      id: "cmd",
      label: "Prompt de Comando",
      file: env.ComSpec || path.win32.join(root, "System32", "cmd.exe"),
      args: [],
    });
    return list;
  }
  const candidates =
    platform === "darwin"
      ? [
          { id: "zsh", label: "zsh", file: "/bin/zsh" },
          { id: "bash", label: "bash", file: "/bin/bash" },
        ]
      : [
          { id: "bash", label: "bash", file: "/bin/bash" },
          { id: "zsh", label: "zsh", file: "/usr/bin/zsh" },
        ];
  // -l: shell de login (carrega o PATH do perfil do usuário, como o Terminal do macOS).
  const list = candidates
    .filter((shell) => exists(shell.file))
    .map((shell) => ({ ...shell, args: ["-l"] }));
  // O shell do usuário ($SHELL) vai na frente.
  const preferred = list.findIndex((shell) => shell.file === env.SHELL);
  if (preferred > 0) list.unshift(...list.splice(preferred, 1));
  if (!list.length) list.push({ id: "sh", label: "sh", file: "/bin/sh", args: [] });
  return list;
}

/** Ambiente do shell: o do app, sem as variáveis que mudam o comportamento do Electron. */
function shellEnv(env) {
  const result = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string") continue;
    if (/^(ELECTRON_|AGZOS_|CHROME_)/.test(key)) continue;
    result[key] = value;
  }
  result.TERM = "xterm-256color";
  result.COLORTERM = "truecolor";
  result.TERM_PROGRAM = "Agzos";
  return result;
}

const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

/**
 * Pasta atual pelo que o shell escreveu: OSC 7 (zsh/bash configurados, PowerShell com
 * prompt moderno) ou o próprio prompt do PowerShell/cmd ("PS C:\pasta> ", "C:\pasta>").
 */
function cwdFromOutput(text) {
  let found = null;
  const osc = /\x1b\]7;file:\/\/[^/\x07\x1b]*([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
  for (let match = osc.exec(text); match; match = osc.exec(text)) {
    try {
      let value = decodeURIComponent(match[1]);
      // file:///C:/pasta → C:\pasta
      if (/^\/[A-Za-z]:\//.test(value)) value = value.slice(1).replace(/\//g, "\\");
      found = value;
    } catch {
      // Sequência malformada.
    }
  }
  if (found) return found;
  const plain = text.replace(ANSI_RE, "");
  const lines = plain.split(/\r?\n|\r/).filter((line) => line.trim());
  const last = lines[lines.length - 1] ?? "";
  const prompt = /^(?:PS )?([A-Za-z]:\\[^<>|"?*\r\n]*?)>\s*$/.exec(last);
  if (!prompt) return null;
  // "C:\pasta\" → "C:\pasta" (a raiz "C:\" fica como está).
  return prompt[1].length > 3 ? prompt[1].replace(/\\$/, "") : prompt[1];
}

function isDirectory(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function clampSize(value, min, max, fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function createTerminals({
  loadPty,
  platform = process.platform,
  env = process.env,
  homedir,
  exists = (file) => fs.existsSync(file),
  readCwd = null,
  onData,
  onExit,
  onCwd = () => {},
  // 4.1: como subir o shell com os aliases ({ args, env }) e as variáveis extras (chaves
  // de API) que só os terminais recebem.
  prepare = (shell) => ({ args: shell.args, env: {} }),
  extraEnv = () => ({}),
  sshBinary = () => null,
}) {
  const sessions = new Map();
  let seq = 0;
  let pty = null;
  let ptyError = null;

  function ptyModule() {
    if (pty || ptyError) return pty;
    try {
      pty = loadPty();
    } catch (error) {
      ptyError = error;
      console.error("Agzos: terminal indisponível (node-pty não carregou).", error?.message);
    }
    return pty;
  }

  const shells = () => availableShells({ platform, env, exists });

  function setCwd(session, cwd) {
    if (!cwd || cwd === session.cwd) return;
    session.cwd = cwd;
    onCwd(session.owner, session.id, cwd);
  }

  function flush(session) {
    session.timer = null;
    if (!session.buffer) return;
    const data = session.buffer;
    session.buffer = "";
    onData(session.owner, session.id, data);
  }

  /** Pasta do processo (Linux: /proc; macOS: lsof). No Windows vale o prompt. */
  function checkCwd(session) {
    session.cwdTimer = null;
    if (!readCwd || session.exited) return;
    void Promise.resolve(readCwd(session.pty.pid))
      .then((cwd) => {
        if (cwd && !session.exited) setCwd(session, cwd);
      })
      .catch(() => {});
  }

  return {
    available() {
      return { ok: Boolean(ptyModule()), shells: shells().map(({ id, label }) => ({ id, label })) };
    },

    /**
     * Abre uma sessão. `shell`: id da lista (ou vazio = padrão); `cwd` inválido → início.
     * `ssh`: argumentos já validados (terminal-launch.cjs sshArgs) para uma sessão SSH.
     */
    open(owner, { shell, cwd, cols, rows, ssh = null, title = null } = {}) {
      const module = ptyModule();
      if (!module) return { ok: false, error: "unavailable" };
      const owned = [...sessions.values()].filter((item) => item.owner === owner).length;
      if (owned >= MAX_SESSIONS) return { ok: false, error: "limit" };
      const list = shells();
      let chosen = list.find((item) => item.id === shell) ?? list[0];
      let launch;
      if (ssh) {
        const file = sshBinary();
        if (!file) return { ok: false, error: "no-ssh" };
        chosen = { id: "ssh", label: "ssh", file, args: ssh };
        launch = { args: ssh, env: {} };
      } else {
        try {
          launch = prepare(chosen);
        } catch {
          launch = { args: chosen.args, env: {} };
        }
      }
      const dir = typeof cwd === "string" && cwd && isDirectory(cwd) ? cwd : homedir;
      let child;
      try {
        child = module.spawn(chosen.file, launch.args, {
          name: "xterm-256color",
          cols: clampSize(cols, 2, 1000, 80),
          rows: clampSize(rows, 1, 500, 24),
          cwd: dir,
          env: { ...shellEnv(env), ...extraEnv(), ...launch.env },
        });
      } catch {
        return { ok: false, error: "spawn" };
      }
      const id = ++seq;
      const session = {
        id,
        owner,
        shell: chosen.id,
        pty: child,
        cwd: dir,
        buffer: "",
        timer: null,
        cwdTimer: null,
        exited: false,
        tail: "",
        history: "",
        label: typeof title === "string" && title ? title.slice(0, 80) : chosen.label,
      };
      sessions.set(id, session);
      child.onData((data) => {
        session.buffer += data;
        session.history += data;
        if (session.history.length > HISTORY_LIMIT * 1.25) {
          // Corta numa quebra de linha (não no meio de uma sequência de cor).
          const cut = session.history.length - HISTORY_LIMIT;
          const line = session.history.indexOf("\n", cut);
          session.history = session.history.slice(line >= 0 ? line + 1 : cut);
        }
        // Prompt do Windows: a pasta vem na saída.
        session.tail = (session.tail + data).slice(-2048);
        const cwdNow = cwdFromOutput(session.tail);
        if (cwdNow) setCwd(session, cwdNow);
        session.timer ??= setTimeout(() => flush(session), FLUSH_MS);
      });
      child.onExit(({ exitCode, signal }) => {
        session.exited = true;
        clearTimeout(session.timer);
        clearTimeout(session.cwdTimer);
        flush(session);
        sessions.delete(id);
        onExit(session.owner, id, { exitCode, signal: signal ?? null });
      });
      return { ok: true, id, shell: chosen.id, label: session.label, cwd: dir };
    },

    write(owner, id, data) {
      const session = sessions.get(id);
      if (!session || session.owner !== owner || typeof data !== "string") return false;
      session.pty.write(data);
      // Enter: a pasta pode ter mudado (cd); confere logo depois.
      if (data.includes("\r") && !session.cwdTimer) {
        session.cwdTimer = setTimeout(() => checkCwd(session), CWD_CHECK_MS);
      }
      return true;
    },

    resize(owner, id, cols, rows) {
      const session = sessions.get(id);
      if (!session || session.owner !== owner) return false;
      try {
        session.pty.resize(clampSize(cols, 2, 1000, 80), clampSize(rows, 1, 500, 24));
      } catch {
        return false;
      }
      return true;
    },

    kill(owner, id) {
      const session = sessions.get(id);
      if (!session || session.owner !== owner) return false;
      try {
        session.pty.kill();
      } catch {
        // Já saiu.
      }
      return true;
    },

    /** Janela fechada ou app saindo: encerra os shells dela (ou todos). */
    killAll(owner = null) {
      for (const session of [...sessions.values()]) {
        if (owner !== null && session.owner !== owner) continue;
        try {
          session.pty.kill();
        } catch {
          // Já saiu.
        }
      }
    },

    /** Sessões vivas da janela com a saída recente (o terminal mudou de lugar). */
    list(owner) {
      return [...sessions.values()]
        .filter((session) => session.owner === owner)
        .map(({ id, shell, label, cwd, history, buffer }) => ({
          id,
          shell,
          label,
          cwd,
          // O que ainda está no lote vai junto (sem chegar duas vezes depois).
          history: history.slice(0, history.length - buffer.length),
        }));
    },

    sessionsOf(owner) {
      return [...sessions.values()]
        .filter((session) => session.owner === owner)
        .map(({ id, shell, cwd }) => ({ id, shell, cwd }));
    },
  };
}

/** Pasta atual de um processo: /proc no Linux, lsof no macOS; null no Windows. */
function cwdReader(platform, execFile) {
  if (platform === "linux") {
    return (pid) => fs.promises.readlink(`/proc/${pid}/cwd`).catch(() => null);
  }
  if (platform === "darwin") {
    return (pid) =>
      new Promise((resolve) => {
        execFile(
          "/usr/sbin/lsof",
          ["-a", "-d", "cwd", "-p", String(pid), "-Fn"],
          { timeout: 2000 },
          (error, stdout) => {
            if (error) return resolve(null);
            const line = String(stdout)
              .split("\n")
              .find((item) => item.startsWith("n"));
            resolve(line ? line.slice(1) : null);
          },
        );
      });
  }
  return null;
}

module.exports = {
  MAX_SESSIONS,
  availableShells,
  createTerminals,
  cwdFromOutput,
  cwdReader,
  shellEnv,
  terminalKeepsBrowserKey,
};

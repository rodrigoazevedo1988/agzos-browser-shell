// Túnel HTTPS (4.5): "Expor porta" sobe um Quick Tunnel do Cloudflare (`cloudflared tunnel
// --url http://localhost:<porta>`) num processo filho do app e devolve a URL pública
// temporária (*.trycloudflare.com). Sem binário, o app pede o cloudflared: nada é baixado
// nem inventado. Os túneis morrem com o painel, a janela ou o app.

const path = require("node:path");

const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i;
const START_TIMEOUT_MS = 45_000;

/** Linha da saída do cloudflared → URL pública do túnel (ou null). */
function tunnelUrlOf(line) {
  const match = URL_RE.exec(String(line ?? ""));
  // "api.trycloudflare.com" é o endereço do serviço, não o do túnel.
  return match && !/^https:\/\/api\./i.test(match[0]) ? match[0].toLowerCase() : null;
}

/** Nome do executável neste sistema. */
function binaryName(platform) {
  return platform === "win32" ? "cloudflared.exe" : "cloudflared";
}

/**
 * Onde procurar o cloudflared: o caminho que o usuário escolheu, o PATH e as pastas em
 * que os instaladores oficiais (Homebrew, .deb/.rpm, MSI, winget) o colocam.
 */
function cloudflaredCandidates({ configured = null, env = {}, platform, home = "" }) {
  const name = binaryName(platform);
  const sep = platform === "win32" ? ";" : ":";
  const join = platform === "win32" ? path.win32.join : path.posix.join;
  const list = [];
  if (typeof configured === "string" && configured) list.push(configured);
  for (const dir of String(env.PATH ?? env.Path ?? "").split(sep)) {
    if (dir) list.push(join(dir, name));
  }
  if (platform === "win32") {
    const programFiles = [env["ProgramFiles"], env["ProgramFiles(x86)"]].filter(Boolean);
    for (const base of programFiles) list.push(join(base, "cloudflared", name));
    if (env.LOCALAPPDATA) {
      list.push(join(env.LOCALAPPDATA, "Microsoft", "WinGet", "Links", name));
    }
  } else {
    list.push(
      "/opt/homebrew/bin/cloudflared",
      "/usr/local/bin/cloudflared",
      "/usr/bin/cloudflared",
    );
    if (home) list.push(join(home, ".local", "bin", name), join(home, "bin", name));
  }
  return [...new Set(list)];
}

/** Primeiro candidato que existe e é executável (`isExecutable(file)`). */
function findCloudflared(options, isExecutable) {
  return cloudflaredCandidates(options).find((file) => isExecutable(file)) ?? null;
}

/** Arquivo escolhido pelo usuário: precisa se chamar cloudflared (com ou sem versão). */
function looksLikeCloudflared(file) {
  const name =
    String(file ?? "")
      .split(/[\\/]/)
      .pop() ?? "";
  return /^cloudflared[\w.-]*(\.exe)?$/i.test(name);
}

/**
 * Túneis abertos, por dono (janela) e porta. `spawn` é o child_process.spawn; `onEvent`
 * recebe { owner, port, state, url?, error? }.
 */
function createTunnels({ spawn, onEvent = () => {}, timeoutMs = START_TIMEOUT_MS }) {
  const open = new Map();
  const keyOf = (owner, port) => `${owner}:${port}`;

  function stop(owner, port) {
    const key = keyOf(owner, port);
    const entry = open.get(key);
    if (!entry) return false;
    open.delete(key);
    clearTimeout(entry.timer);
    try {
      entry.child.kill();
    } catch {
      // Já saiu.
    }
    onEvent({ owner, port, state: "closed" });
    return true;
  }

  function start(owner, port, binary) {
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      return Promise.resolve({ ok: false, error: "port" });
    }
    const existing = open.get(keyOf(owner, port));
    if (existing?.url) return Promise.resolve({ ok: true, url: existing.url });
    if (existing) return existing.ready;
    let child;
    try {
      child = spawn(binary, ["tunnel", "--no-autoupdate", "--url", `http://localhost:${port}`], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch {
      return Promise.resolve({ ok: false, error: "spawn" });
    }
    const entry = { child, url: null, timer: null, ready: null };
    open.set(keyOf(owner, port), entry);
    entry.ready = new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(entry.timer);
        resolve(result);
      };
      const read = (chunk) => {
        if (entry.url) return;
        for (const line of String(chunk).split(/\r?\n/)) {
          const url = tunnelUrlOf(line);
          if (!url) continue;
          entry.url = url;
          onEvent({ owner, port, state: "open", url });
          finish({ ok: true, url });
          return;
        }
      };
      child.stdout?.on("data", read);
      child.stderr?.on("data", read);
      child.on("error", () => {
        if (open.get(keyOf(owner, port)) === entry) open.delete(keyOf(owner, port));
        finish({ ok: false, error: "spawn" });
      });
      child.on("exit", () => {
        if (open.get(keyOf(owner, port)) !== entry) return;
        open.delete(keyOf(owner, port));
        clearTimeout(entry.timer);
        onEvent({ owner, port, state: "closed" });
        finish({ ok: false, error: "exited" });
      });
      entry.timer = setTimeout(() => {
        stop(owner, port);
        finish({ ok: false, error: "timeout" });
      }, timeoutMs);
    });
    return entry.ready;
  }

  return {
    start,
    stop,
    /** Fecha todos os túneis de um dono (painel fechado, janela fechada). */
    stopOwner(owner) {
      for (const key of [...open.keys()]) {
        if (key.startsWith(`${owner}:`)) stop(owner, Number(key.slice(key.indexOf(":") + 1)));
      }
    },
    stopAll() {
      for (const key of [...open.keys()]) {
        const index = key.indexOf(":");
        stop(key.slice(0, index), Number(key.slice(index + 1)));
      }
    },
    list(owner) {
      return [...open.entries()]
        .filter(([key]) => key.startsWith(`${owner}:`))
        .map(([key, entry]) => ({ port: Number(key.slice(key.indexOf(":") + 1)), url: entry.url }));
    },
  };
}

module.exports = {
  binaryName,
  cloudflaredCandidates,
  createTunnels,
  findCloudflared,
  looksLikeCloudflared,
  tunnelUrlOf,
};

// Painel de portas (4.5): o que está escutando TCP no PC (3000, 5432…), de qual processo
// e, quando dá para inferir, de qual projeto. Regras puras de leitura da saída do `ss`
// (Linux), `lsof` (macOS) e `netstat`/`tasklist` (Windows); o main roda os comandos.

const path = require("node:path");

const PORT_MAX = 65535;

const validPort = (value) => Number.isInteger(value) && value > 0 && value <= PORT_MAX;
const validPid = (value) => Number.isInteger(value) && value > 0;

/** "0.0.0.0:3000", "[::]:5432", "*:80", "127.0.0.1.8080" (BSD) → { address, port }. */
function splitAddress(value) {
  const text = String(value ?? "").trim();
  const match = /^(.*)[:.](\d{1,5})$/.exec(text);
  if (!match) return null;
  const port = Number(match[2]);
  if (!validPort(port)) return null;
  const address = match[1].replace(/^\[|\]$/g, "").replace(/%.*$/, "") || "*";
  return { address, port };
}

/** Linux: `ss -ltnpH` (sem cabeçalho). Processos de outro usuário vêm sem `users:`. */
function parseSs(text) {
  const entries = [];
  for (const line of String(text ?? "").split("\n")) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 4 || columns[0] !== "LISTEN") continue;
    const local = splitAddress(columns[3]);
    if (!local) continue;
    const users = /users:\(\((.*)\)\)/.exec(line)?.[1] ?? "";
    const processes = [...users.matchAll(/"([^"]*)",pid=(\d+)/g)].map((match) => ({
      name: match[1],
      pid: Number(match[2]),
    }));
    if (!processes.length) entries.push({ ...local, pid: null, name: "" });
    for (const item of processes) entries.push({ ...local, ...item });
  }
  return entries;
}

/** macOS: `lsof -nP -iTCP -sTCP:LISTEN -F pcn` (campos p=pid, c=comando, n=endereço). */
function parseLsof(text) {
  const entries = [];
  let pid = null;
  let name = "";
  for (const line of String(text ?? "").split("\n")) {
    const field = line[0];
    const value = line.slice(1).trim();
    if (field === "p") {
      pid = Number(value);
      name = "";
    } else if (field === "c") {
      name = value;
    } else if (field === "n" && validPid(pid)) {
      const local = splitAddress(value.split("->")[0]);
      if (local) entries.push({ ...local, pid, name });
    }
  }
  return entries;
}

/** Windows: `netstat -ano -p TCP` e `-p TCPv6`; só as linhas LISTENING. */
function parseNetstat(text) {
  const entries = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 5 || !/^TCP/i.test(columns[0])) continue;
    if (!/^(LISTENING|ABH[ÖO]REN|ESCUCHA|EN ÉCOUTE|EM ESCUTA)$/i.test(columns[3])) continue;
    const local = splitAddress(columns[1]);
    const pid = Number(columns[4]);
    if (local && validPid(pid)) entries.push({ ...local, pid, name: "" });
  }
  return entries;
}

/** Windows: `tasklist /fo csv /nh` → pid → nome do executável. */
function parseTasklist(text) {
  const names = new Map();
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const cells = [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((match) => match[1]);
    const pid = Number(cells[1]);
    if (cells[0] && validPid(pid)) names.set(pid, cells[0]);
  }
  return names;
}

/**
 * Entradas cruas → uma linha por porta e processo, com os endereços juntos (IPv4 e IPv6
 * da mesma porta viram uma só), ordenadas pela porta.
 */
function mergePorts(entries) {
  // Mesmo processo com vários filhos na mesma porta (nginx, smtpd): uma linha só, com
  // todos os PIDs; o menor (em geral o processo-pai) fica como o principal.
  const byKey = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || !validPort(entry.port)) continue;
    const pid = validPid(entry.pid) ? entry.pid : null;
    const name = String(entry.name ?? "").slice(0, 120);
    const key = pid === null ? `${entry.port}:?` : `${entry.port}:${name || pid}`;
    const current = byKey.get(key) ?? {
      port: entry.port,
      pid: null,
      pids: [],
      name,
      addresses: [],
    };
    if (pid !== null && !current.pids.includes(pid)) current.pids.push(pid);
    if (!current.name && name) current.name = name;
    const address = String(entry.address ?? "*");
    if (!current.addresses.includes(address)) current.addresses.push(address);
    byKey.set(key, current);
  }
  return [...byKey.values()]
    .map((item) => {
      const pids = [...item.pids].sort((a, b) => a - b);
      return { ...item, pids, pid: pids[0] ?? null, local: item.addresses.every(isLoopback) };
    })
    .sort((a, b) => a.port - b.port || (a.pid ?? 0) - (b.pid ?? 0));
}

function isLoopback(address) {
  return /^(127\.|::1$|localhost$)/.test(address);
}

/**
 * Projeto de um processo: o `name` do package.json mais próximo da pasta de trabalho
 * (subindo até 6 níveis) ou a pasta de um Cargo.toml/pyproject/go.mod…, senão o nome da
 * própria pasta. `readJson(file)` devolve o JSON ou null; `exists(file)`, se o arquivo existe.
 */
function projectOf(cwd, { readJson, exists, home = "" }) {
  if (typeof cwd !== "string" || !path.isAbsolute(cwd)) return null;
  const root = path.parse(cwd).root;
  if (cwd === root || cwd === home) return null;
  let dir = cwd;
  for (let depth = 0; depth < 6 && dir !== root && dir !== home; depth += 1) {
    const json = readJson(path.join(dir, "package.json"));
    if (json && typeof json.name === "string" && json.name.trim()) {
      return { name: json.name.trim().slice(0, 80), dir, code: true };
    }
    for (const marker of ["Cargo.toml", "pyproject.toml", "go.mod", "composer.json", "Gemfile"]) {
      if (exists(path.join(dir, marker))) return { name: path.basename(dir), dir, code: true };
    }
    dir = path.dirname(dir);
  }
  return { name: path.basename(cwd), dir: cwd, code: false };
}

/** Linha de comando → pasta provável do projeto (Windows, onde não há cwd de outro processo). */
function projectDirOfCommand(command) {
  const text = String(command ?? "");
  const modules = /([A-Za-z]:[\\/][^"]*?|\/[^"\s]*?)[\\/]node_modules[\\/]/.exec(text);
  if (modules) return modules[1];
  const script = /([A-Za-z]:[\\/][^"\s]+|\/[^"\s]+)\.(?:m?js|cjs|ts|py|rb|php)\b/.exec(text);
  if (script) return path.dirname(script[1].replace(/\\/g, "/"));
  return null;
}

/** Pode matar: só um PID da última leitura e nunca o próprio app. */
function canKill(pid, { listed, protectedPids }) {
  return validPid(pid) && pid > 1 && listed.has(pid) && !protectedPids.has(pid);
}

module.exports = {
  canKill,
  mergePorts,
  parseLsof,
  parseNetstat,
  parseSs,
  parseTasklist,
  projectDirOfCommand,
  projectOf,
  splitAddress,
};

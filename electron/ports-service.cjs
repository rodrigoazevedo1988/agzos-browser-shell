// Painel de portas (4.5): roda os comandos do sistema e junta porta, processo e projeto.
// A leitura da saída fica em ports.cjs; aqui só o "como perguntar" de cada sistema.

const {
  canKill,
  mergePorts,
  parseLsof,
  parseNetstat,
  parseSs,
  parseTasklist,
  projectDirOfCommand,
  projectOf,
} = require("./ports.cjs");

const RUN_TIMEOUT_MS = 6000;

function createPortsService({ execFile, fs, platform, home = "", protectedPids = () => [] }) {
  const run = (file, args) =>
    new Promise((resolve) => {
      try {
        execFile(
          file,
          args,
          { timeout: RUN_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
          (error, stdout) => resolve(error && !stdout ? null : String(stdout ?? "")),
        );
      } catch {
        resolve(null);
      }
    });

  const readJson = (file) => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return null;
    }
  };
  const exists = (file) => {
    try {
      return fs.statSync(file).isFile();
    } catch {
      return false;
    }
  };

  // PID principal de cada linha da última leitura → todos os PIDs dela.
  let groups = new Map();

  async function rawEntries() {
    if (platform === "win32") {
      const [v4, v6, tasks] = await Promise.all([
        run("netstat", ["-ano", "-p", "TCP"]),
        run("netstat", ["-ano", "-p", "TCPv6"]),
        run("tasklist", ["/fo", "csv", "/nh"]),
      ]);
      const names = parseTasklist(tasks ?? "");
      return [...parseNetstat(v4 ?? ""), ...parseNetstat(v6 ?? "")].map((entry) => ({
        ...entry,
        name: names.get(entry.pid) ?? "",
      }));
    }
    if (platform === "linux") {
      const ss = await run("ss", ["-ltnpH"]);
      if (ss !== null) return parseSs(ss);
    }
    const lsof = await run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"]);
    return parseLsof(lsof ?? "");
  }

  /** Pasta de trabalho de cada processo (onde o sistema deixa ler). */
  async function cwdsOf(pids) {
    const cwds = new Map();
    if (!pids.length) return cwds;
    if (platform === "linux") {
      for (const pid of pids) {
        try {
          cwds.set(pid, fs.readlinkSync(`/proc/${pid}/cwd`));
        } catch {
          // Processo de outro usuário.
        }
      }
      return cwds;
    }
    if (platform === "darwin") {
      const out = await run("lsof", ["-a", "-d", "cwd", "-p", pids.join(","), "-F", "pn"]);
      let pid = null;
      for (const line of String(out ?? "").split("\n")) {
        if (line[0] === "p") pid = Number(line.slice(1));
        else if (line[0] === "n" && pid) cwds.set(pid, line.slice(1));
      }
      return cwds;
    }
    // Windows: sem cwd de outro processo; a linha de comando dá uma pista da pasta.
    const filter = pids.map((pid) => `ProcessId=${pid}`).join(" or ");
    const out = await run("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Get-CimInstance Win32_Process -Filter '${filter}' | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress`,
    ]);
    let rows = [];
    try {
      const parsed = JSON.parse(out ?? "[]");
      rows = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      rows = [];
    }
    for (const row of rows) {
      const dir = projectDirOfCommand(row?.CommandLine);
      if (dir && Number.isInteger(row?.ProcessId)) cwds.set(row.ProcessId, dir);
    }
    return cwds;
  }

  async function scan() {
    const ports = mergePorts(await rawEntries());
    const pids = [...new Set(ports.map((item) => item.pid).filter(Boolean))];
    // Linux: o `ss` sem permissão não mostra o nome; o /proc mostra para os processos do usuário.
    if (platform === "linux") {
      for (const item of ports) {
        if (item.name || !item.pid) continue;
        try {
          item.name = fs.readFileSync(`/proc/${item.pid}/comm`, "utf8").trim();
        } catch {
          // Sem acesso.
        }
      }
    }
    const cwds = await cwdsOf(pids);
    const own = new Set(protectedPids());
    groups = new Map(ports.filter((item) => item.pid).map((item) => [item.pid, item.pids]));
    // Projetos de código (package.json, Cargo.toml…) primeiro: o servidor de dev aparece no
    // topo, antes dos serviços do sistema.
    return ports
      .map((item) => {
        const cwd = item.pid ? cwds.get(item.pid) : undefined;
        const project = cwd ? projectOf(cwd, { readJson, exists, home }) : null;
        return {
          ...item,
          project: project ? { name: project.name, dir: project.dir } : null,
          dev: Boolean(project?.code),
          self: item.pids.some((pid) => own.has(pid)),
        };
      })
      .sort((a, b) => Number(b.dev) - Number(a.dev) || a.port - b.port);
  }

  /**
   * Encerra o processo da linha (e os filhos listados com ele): SIGTERM; o que não sair em
   * 1,5 s leva SIGKILL.
   */
  async function kill(pid, killer = process.kill.bind(process)) {
    const group = groups.get(pid) ?? [];
    const listed = new Set(group);
    const protectedSet = new Set(protectedPids());
    if (
      !group.length ||
      !group.every((item) => canKill(item, { listed, protectedPids: protectedSet }))
    ) {
      return { ok: false, error: "denied" };
    }
    const alive = (item) => {
      try {
        killer(item, 0);
        return true;
      } catch {
        return false;
      }
    };
    let sent = 0;
    let error = null;
    for (const item of group) {
      try {
        killer(item, "SIGTERM");
        sent += 1;
      } catch (failure) {
        error = failure?.code === "EPERM" ? "permission" : (error ?? "gone");
      }
    }
    if (!sent) return { ok: false, error: error ?? "gone" };
    for (let waited = 0; waited < 1500; waited += 100) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (!group.some(alive)) {
        groups.delete(pid);
        return { ok: true };
      }
    }
    for (const item of group.filter(alive)) {
      try {
        killer(item, "SIGKILL");
      } catch {
        // Saiu entre uma checagem e outra.
      }
    }
    groups.delete(pid);
    return { ok: true, forced: true };
  }

  return { scan, kill };
}

module.exports = { createPortsService };

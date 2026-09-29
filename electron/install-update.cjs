// Instalador da atualização. Roda FORA do app, depois que ele fecha, pelo executável da
// versão nova já baixada e conferida (ELECTRON_RUN_AS_NODE=1: o Electron vira um Node
// comum). Sem PowerShell nem shell: no Windows, script oculto do PowerShell mexendo em
// .exe é o tipo de coisa que o antivírus bloqueia em silêncio.
//
// Uso: <executável> install-update.cjs <config.json>
// config: { pid, staged, target, kind: "folder"|"bundle", relaunch, reopen, version,
//           result, log }

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");

const WAIT_EXIT_MS = 120 * 1000;
const COPY_ATTEMPTS = 60;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: existe, mas é de outro usuário.
    return error.code === "EPERM";
  }
}

/** Copia a pasta por cima, arquivo por arquivo (nada que já existe no destino é apagado). */
function copyOver(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyOver(source, target);
    } else if (entry.isSymbolicLink()) {
      fs.rmSync(target, { force: true });
      fs.symlinkSync(fs.readlinkSync(source), target);
    } else {
      fs.copyFileSync(source, target);
      fs.chmodSync(target, fs.statSync(source).mode);
    }
  }
}

/** Troca o .app inteiro (Mac), voltando o antigo se a troca falhar. */
function swapBundle(staged, target) {
  const backup = `${target}.agzos-antigo`;
  fs.rmSync(backup, { recursive: true, force: true });
  fs.renameSync(target, backup);
  try {
    fs.renameSync(staged, target);
  } catch (error) {
    if (!fs.existsSync(target)) fs.renameSync(backup, target);
    throw error;
  }
  fs.rmSync(backup, { recursive: true, force: true });
  try {
    execFileSync("xattr", ["-dr", "com.apple.quarantine", target], { stdio: "ignore" });
  } catch {
    // Sem quarentena para tirar.
  }
}

async function main() {
  const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const log = (message) => {
    try {
      fs.appendFileSync(config.log, `${new Date().toISOString()} ${message}\n`);
    } catch {
      // Sem log, segue.
    }
  };
  const finish = (text) => {
    fs.writeFileSync(config.result, `${text}\n`);
    log(text);
  };

  log(`início: ${config.version} de ${config.staged} para ${config.target} (pid ${config.pid})`);
  const deadline = Date.now() + WAIT_EXIT_MS;
  while (alive(config.pid)) {
    if (Date.now() > deadline) {
      finish("failed o app não fechou em 2 minutos");
      return;
    }
    await sleep(200);
  }
  log("app fechado");

  // Processos filhos (GPU, abas) podem segurar arquivos por alguns segundos no Windows.
  let lastError = null;
  for (let attempt = 1; attempt <= COPY_ATTEMPTS; attempt++) {
    try {
      if (config.kind === "bundle") swapBundle(config.staged, config.target);
      else copyOver(config.staged, config.target);
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      log(`tentativa ${attempt}: ${error.code ?? ""} ${error.message}`);
      if (config.kind === "bundle") break;
      await sleep(1000);
    }
  }
  if (lastError) finish(`failed ${lastError.code ?? ""} ${lastError.message}`.trim());
  else finish(`ok ${config.version}`);

  if (config.reopen) {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const [command, args] =
      process.platform === "darwin" ? ["open", [config.relaunch]] : [config.relaunch, []];
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      env,
      cwd: path.dirname(config.relaunch),
    });
    child.on("error", (error) => log(`reabrir: ${error.message}`));
    child.unref();
    log(`reaberto: ${config.relaunch}`);
    await sleep(500);
  }
}

main().catch((error) => {
  try {
    const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
    fs.writeFileSync(config.result, `failed ${error.message}\n`);
    fs.appendFileSync(config.log, `${new Date().toISOString()} erro: ${error.stack}\n`);
  } catch {
    // Nada a fazer.
  }
  process.exitCode = 1;
});

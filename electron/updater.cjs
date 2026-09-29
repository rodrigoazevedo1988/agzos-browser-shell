// Atualização automática. O release-browser.sh publica um latest.json ao lado dos
// pacotes; o app baixa o pacote da própria plataforma, confere o SHA-256, extrai numa
// pasta de trabalho e, ao fechar (ou em "Reiniciar e atualizar"), um script separado
// espera o app sair, copia a versão nova por cima da instalação e, se pedido, reabre.
//
// Sem electron-updater/Squirrel: os pacotes são portáteis (zip, tar.gz, .app) e não
// assinados; o Squirrel do Mac exige Developer ID.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile, spawn } = require("node:child_process");

const DEFAULT_FEED = "https://agzosagency.com.br/browser/latest.json";
const CHECK_DELAY_MS = 30 * 1000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const MAX_PACKAGE_BYTES = 1024 * 1024 * 1024;
// A pasta de instalação precisa ter isto para o updater aceitar copiar por cima dela.
const APP_MARKER = path.join("resources", "app", "package.json");

function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(value ?? "").trim());
  return match ? match.slice(1).map(Number) : null;
}

/** >0 se a for mais nova que b, <0 se mais velha, 0 se igual (ou inválida). */
function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return 0;
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}

function platformKey(platform, arch) {
  if (platform === "win32" && arch === "x64") return "win32-x64";
  if (platform === "linux" && arch === "x64") return "linux-x64";
  if (platform === "darwin" && (arch === "arm64" || arch === "x64")) return `darwin-${arch}`;
  return null;
}

/**
 * Lê o latest.json. O pacote precisa estar na mesma origem do feed (um feed adulterado
 * não aponta para outro servidor) e o feed precisa ser HTTPS (HTTP só em 127.0.0.1).
 */
function parseManifest(json, feedUrl, key) {
  if (!json || typeof json !== "object") throw new Error("Manifesto inválido");
  const version = String(json.version ?? "");
  if (!parseVersion(version)) throw new Error("Versão inválida no manifesto");
  const feed = new URL(feedUrl);
  const localHttp = feed.protocol === "http:" && ["127.0.0.1", "localhost"].includes(feed.hostname);
  if (feed.protocol !== "https:" && !localHttp) throw new Error("Feed de atualização sem HTTPS");
  const file = key && json.files && typeof json.files === "object" ? json.files[key] : null;
  let asset = null;
  if (file && typeof file === "object") {
    const url = new URL(String(file.url ?? ""), feed);
    const sha256 = String(file.sha256 ?? "").toLowerCase();
    const size = Number(file.size);
    if (url.origin !== feed.origin) throw new Error("Pacote fora do servidor de atualização");
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error("SHA-256 inválido no manifesto");
    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_PACKAGE_BYTES) {
      throw new Error("Tamanho inválido no manifesto");
    }
    asset = { url: url.href, sha256, size, name: path.basename(url.pathname) };
  }
  return {
    version,
    notes: typeof json.notes === "string" ? json.notes.slice(0, 2000) : "",
    releasedAt: typeof json.releasedAt === "string" ? json.releasedAt : null,
    page: typeof json.page === "string" ? json.page : new URL("./", feed).href,
    asset,
  };
}

/**
 * Onde a versão nova entra e o que reabrir. Mac: o próprio .app (substituído inteiro).
 * Windows/Linux: a pasta do executável (a versão nova é copiada por cima). null quando
 * não dá para atualizar sozinho: app rodando de dentro do DMG ou em quarentena
 * ("App Translocation"), ou pasta que não parece a instalação do Agzos (ex.: dev).
 */
function installTarget(execPath, platform, { exists = fs.existsSync } = {}) {
  if (platform === "darwin") {
    const index = execPath.indexOf(".app/");
    if (index < 0) return null;
    const bundle = execPath.slice(0, index + 4);
    if (bundle.startsWith("/Volumes/") || bundle.includes("/AppTranslocation/")) return null;
    if (!exists(path.join(bundle, "Contents", "Resources", "app", "package.json"))) return null;
    return { kind: "bundle", dir: bundle, relaunch: bundle };
  }
  const dir = path.dirname(execPath);
  if (!exists(path.join(dir, APP_MARKER))) return null;
  return { kind: "folder", dir, relaunch: execPath };
}

const shQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;
const psQuote = (value) => `'${String(value).replace(/'/g, "''")}'`;

/** Script que roda depois que o app fecha. `result` recebe "ok <versão>" ou "failed …". */
function helperScript(platform, { pid, staged, target, relaunch, result, version, reopen }) {
  if (platform === "win32") {
    return {
      name: "instalar-atualizacao.ps1",
      content: [
        "$ErrorActionPreference = 'Continue'",
        `$staged = ${psQuote(staged)}`,
        `$target = ${psQuote(target)}`,
        `$result = ${psQuote(result)}`,
        `try { Wait-Process -Id ${Number(pid)} -Timeout 120 -ErrorAction SilentlyContinue } catch {}`,
        "Start-Sleep -Milliseconds 700",
        // Copia por cima (sem /MIR: nada que já estava na pasta é apagado).
        "robocopy $staged $target /E /R:15 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null",
        "$code = $LASTEXITCODE",
        `if ($code -lt 8) { Set-Content -Path $result -Value ${psQuote(`ok ${version}`)}; Remove-Item -Recurse -Force $staged -ErrorAction SilentlyContinue } else { Set-Content -Path $result -Value "failed robocopy $code" }`,
        reopen ? `Start-Process -FilePath ${psQuote(relaunch)}` : "",
        "",
      ].join("\r\n"),
    };
  }
  const wait = [
    "i=0",
    `while kill -0 ${Number(pid)} 2>/dev/null; do`,
    "  i=$((i + 1))",
    '  if [ "$i" -gt 1200 ]; then echo "failed timeout" > "$RESULT"; exit 1; fi',
    "  sleep 0.1",
    "done",
    "sleep 0.3",
  ];
  const head = [
    "#!/bin/sh",
    `STAGED=${shQuote(staged)}`,
    `TARGET=${shQuote(target)}`,
    `RESULT=${shQuote(result)}`,
    ...wait,
  ];
  if (platform === "darwin") {
    return {
      name: "instalar-atualizacao.sh",
      content: [
        ...head,
        'BACKUP="$TARGET.agzos-antigo"',
        'rm -rf "$BACKUP"',
        'if mv "$TARGET" "$BACKUP" && mv "$STAGED" "$TARGET"; then',
        '  rm -rf "$BACKUP"',
        '  xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null',
        `  echo ${shQuote(`ok ${version}`)} > "$RESULT"`,
        "else",
        '  if [ ! -e "$TARGET" ] && [ -d "$BACKUP" ]; then mv "$BACKUP" "$TARGET"; fi',
        '  echo "failed mv" > "$RESULT"',
        "fi",
        reopen ? 'open "$TARGET"' : "",
        "",
      ].join("\n"),
    };
  }
  return {
    name: "instalar-atualizacao.sh",
    content: [
      ...head,
      // Copia por cima (nada que já estava na pasta é apagado).
      'if cp -a "$STAGED/." "$TARGET/"; then',
      `  echo ${shQuote(`ok ${version}`)} > "$RESULT"`,
      '  rm -rf "$STAGED"',
      "else",
      '  echo "failed cp" > "$RESULT"',
      "fi",
      reopen ? `nohup ${shQuote(relaunch)} >/dev/null 2>&1 &` : "",
      "",
    ].join("\n"),
  };
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (error) =>
      error ? reject(error) : resolve(),
    );
  });
}

async function extractArchive(platform, archive, dest) {
  fs.mkdirSync(dest, { recursive: true });
  if (platform === "darwin") return run("ditto", ["-x", "-k", archive, dest]);
  if (platform === "linux") return run("tar", ["-xzf", archive, "-C", dest]);
  // Windows 10+ traz o bsdtar (lê zip); sem ele, o Expand-Archive do PowerShell.
  const tar = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
  try {
    await run(tar, ["-xf", archive, "-C", dest]);
  } catch {
    await run("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Expand-Archive -LiteralPath ${psQuote(archive)} -DestinationPath ${psQuote(dest)} -Force`,
    ]);
  }
}

function createUpdater({
  feedUrl = DEFAULT_FEED,
  currentVersion,
  platform = process.platform,
  arch = process.arch,
  execPath = process.execPath,
  installDir = null,
  workDir,
  fetchImpl,
  emit = () => {},
  quit = () => {},
  log = () => {},
  pid = process.pid,
}) {
  const key = platformKey(platform, arch);
  const target = installDir
    ? { kind: "folder", dir: installDir, relaunch: path.join(installDir, path.basename(execPath)) }
    : installTarget(execPath, platform);
  const resultFile = path.join(workDir, "resultado.txt");
  let state = { status: "idle", currentVersion, version: null, progress: null, error: null };
  let staged = null;
  let pending = null;
  let installing = false;
  let timers = [];

  const set = (patch) => {
    state = { ...state, ...patch };
    emit(state);
  };

  // Resultado da instalação anterior (o script escreveu antes de reabrir o app).
  try {
    const previous = fs.readFileSync(resultFile, "utf8").trim();
    fs.rmSync(resultFile, { force: true });
    if (previous.startsWith("failed")) {
      state.error = "A última atualização não pôde ser instalada. Baixe a versão nova no site.";
      log(`update: instalação anterior falhou (${previous})`);
    }
  } catch {
    // Sem instalação anterior.
  }
  // Sobras de downloads antigos.
  try {
    for (const name of fs.readdirSync(workDir)) {
      if (parseVersion(name) && compareVersions(name, currentVersion) <= 0) {
        fs.rmSync(path.join(workDir, name), { recursive: true, force: true });
      }
    }
  } catch {
    // Pasta ainda não existe.
  }

  async function download(manifest) {
    const { asset, version } = manifest;
    const dir = path.join(workDir, version);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const archive = path.join(dir, asset.name);
    set({ status: "downloading", version, progress: 0, error: null });
    const response = await fetchImpl(asset.url, { cache: "no-store" });
    if (!response.ok || !response.body)
      throw new Error(`Download falhou (HTTP ${response.status})`);
    const hash = crypto.createHash("sha256");
    const out = fs.createWriteStream(archive);
    let received = 0;
    let lastEmit = 0;
    try {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        if (received > asset.size) throw new Error("Pacote maior que o anunciado");
        hash.update(value);
        if (!out.write(value)) await new Promise((resolve) => out.once("drain", resolve));
        const now = Date.now();
        if (now - lastEmit > 250) {
          lastEmit = now;
          set({ progress: received / asset.size });
        }
      }
    } finally {
      await new Promise((resolve) => out.end(resolve));
    }
    if (received !== asset.size) throw new Error("Download incompleto");
    if (hash.digest("hex") !== asset.sha256)
      throw new Error("Pacote corrompido (SHA-256 não confere)");
    const extracted = path.join(dir, "novo");
    await extractArchive(platform, archive, extracted);
    fs.rmSync(archive, { force: true });
    const root =
      target.kind === "bundle"
        ? path.join(
            extracted,
            fs.readdirSync(extracted).find((name) => name.endsWith(".app")) ?? "",
          )
        : extracted;
    const marker =
      target.kind === "bundle"
        ? path.join(root, "Contents", "Resources", "app", "package.json")
        : path.join(root, APP_MARKER);
    if (!fs.existsSync(marker)) throw new Error("Pacote sem o app do Agzos");
    staged = root;
    pending = manifest;
    set({ status: "ready", progress: 1 });
  }

  async function check() {
    if (["checking", "downloading"].includes(state.status) || installing) return state;
    if (state.status === "ready") return state;
    set({ status: "checking", error: null });
    try {
      const response = await fetchImpl(feedUrl, { cache: "no-store" });
      if (!response.ok) throw new Error(`Servidor de atualização respondeu ${response.status}`);
      const manifest = parseManifest(JSON.parse(await response.text()), feedUrl, key);
      set({ checkedAt: Date.now(), notes: manifest.notes, page: manifest.page });
      if (compareVersions(manifest.version, currentVersion) <= 0) {
        set({ status: "up-to-date", version: manifest.version });
        return state;
      }
      if (!manifest.asset || !target) {
        set({
          status: "unsupported",
          version: manifest.version,
          error: !target
            ? platform === "darwin"
              ? "Mova o Agzos Browser para a pasta Aplicativos para receber atualizações automáticas."
              : "Esta instalação não pode ser atualizada sozinha. Baixe a versão nova no site."
            : "Ainda não há pacote desta versão para o seu sistema.",
        });
        return state;
      }
      await download(manifest);
    } catch (error) {
      log(`update: ${error?.message ?? error}`);
      set({ status: "error", progress: null, error: error?.message ?? String(error) });
    }
    return state;
  }

  /** Dispara o script de instalação. Com `reopen`, fecha o app e reabre na versão nova. */
  function install({ reopen }) {
    if (!staged || !pending || !target || installing) return false;
    installing = true;
    const script = helperScript(platform, {
      pid,
      staged,
      target: target.dir,
      relaunch: target.relaunch,
      result: resultFile,
      version: pending.version,
      reopen,
    });
    const file = path.join(workDir, script.name);
    fs.writeFileSync(file, script.content, { mode: 0o755 });
    const [command, args] =
      platform === "win32"
        ? [
            "powershell.exe",
            ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", file],
          ]
        : ["/bin/sh", [file]];
    const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    log(`update: instalando ${pending.version} em ${target.dir}`);
    if (reopen) quit();
    return true;
  }

  return {
    state: () => state,
    check,
    install,
    /** Chamado no before-quit: a versão já baixada entra quando o app fecha. */
    installOnQuit() {
      return state.status === "ready" ? install({ reopen: false }) : false;
    },
    start({ auto }) {
      if (!auto) return;
      timers.push(setTimeout(() => void check(), CHECK_DELAY_MS));
      timers.push(setInterval(() => void check(), CHECK_EVERY_MS));
    },
    stop() {
      for (const timer of timers) clearTimeout(timer);
      timers = [];
    },
  };
}

module.exports = {
  createUpdater,
  compareVersions,
  platformKey,
  parseManifest,
  installTarget,
  helperScript,
  DEFAULT_FEED,
};

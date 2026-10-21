// Download de vídeos com o yt-dlp (5.0): YouTube, X, Instagram, Facebook, TikTok, Vimeo e
// tudo o que o yt-dlp aceita. O app só roda o binário com argv (nunca por shell), a URL vai
// depois de "--" e o progresso sai pelo gerenciador de downloads (downloads.cjs).
// Binário: o escolhido pelo usuário (meta ytdlpPath), o PATH e <userData>/bin. Sem nenhum,
// "Instalar" baixa o asset oficial do GitHub e confere o SHA2-256SUMS do mesmo release.
// Funções puras no topo; o serviço recebe tudo por injeção (spawn, fetch, banco, downloads).

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { StringDecoder } = require("node:string_decoder");
const { registrableDomain } = require("./page-theme.cjs");

const RELEASE_BASE = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/";
const SUMS_NAME = "SHA2-256SUMS";
const MAX_INSTALL_BYTES = 120 * 1024 * 1024;
const MAX_URL_LENGTH = 2048;
const MAX_JOBS = 4;
const PROGRESS_TAG = "AGZOSYTDLP";

// Sites que o yt-dlp atende sempre (a barra destaca o botão neles).
const KNOWN_HOSTS = [
  "youtube.com",
  "youtu.be",
  "x.com",
  "twitter.com",
  "instagram.com",
  "facebook.com",
  "fb.watch",
  "tiktok.com",
  "vimeo.com",
];

const QUALITY_KEYS = ["best", "1080", "720", "audio-mp3", "audio-m4a"];

/** Nome do executável neste sistema. */
function binaryNameOf(platform) {
  return platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
}

/** Asset do release oficial para a plataforma (null quando não há). */
function assetNameOf(platform, arch = "x64") {
  if (platform === "win32") return "yt-dlp.exe";
  if (platform === "darwin") return "yt-dlp_macos";
  if (platform === "linux") return arch === "arm64" ? "yt-dlp_linux_aarch64" : "yt-dlp_linux";
  return null;
}

/** Pastas comuns de instalação fora do PATH (o Finder não herda o PATH do shell). */
const EXTRA_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];

/**
 * Onde procurar um executável: o caminho escolhido, o PATH, as pastas comuns e a pasta do
 * app (<userData>/bin), nessa ordem. `name` é o executável (yt-dlp ou ffmpeg).
 */
function candidatesOf(name, { configured = null, env = {}, platform, userData = "" }) {
  const sep = platform === "win32" ? ";" : ":";
  const join = platform === "win32" ? path.win32.join : path.posix.join;
  const list = [];
  if (typeof configured === "string" && configured) list.push(configured);
  for (const dir of String(env.PATH ?? env.Path ?? "").split(sep)) {
    if (dir) list.push(join(dir, name));
  }
  if (platform !== "win32") for (const dir of EXTRA_DIRS) list.push(join(dir, name));
  if (userData) list.push(join(userData, "bin", name));
  return [...new Set(list)];
}

function ytdlpCandidates(options) {
  return candidatesOf(binaryNameOf(options.platform), options);
}

/** Primeiro candidato que existe e é executável (`isExecutable(file)`). */
function findYtdlp(options, isExecutable) {
  return ytdlpCandidates(options).find((file) => isExecutable(file)) ?? null;
}

/** ffmpeg no PATH (ou nas pastas comuns); sem ele o yt-dlp não junta vídeo e áudio. */
function findFfmpeg({ env = {}, platform }, isExecutable) {
  const name = platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  return candidatesOf(name, { env, platform }).find((file) => isExecutable(file)) ?? null;
}

/** Arquivo escolhido pelo usuário: precisa se chamar yt-dlp (com ou sem versão). */
function looksLikeYtdlp(file) {
  const name =
    String(file ?? "")
      .split(/[\\/]/)
      .pop() ?? "";
  return /^yt-dlp[\w.-]*(\.exe)?$/i.test(name);
}

/** Linha "<sha256>  <arquivo>" do SHA2-256SUMS → hash do asset (ou null). */
function checksumOf(sums, asset) {
  for (const line of String(sums ?? "").split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(line.trim());
    if (match && match[2].trim() === asset) return match[1].toLowerCase();
  }
  return null;
}

function sha256Of(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/** URL que o usuário pode baixar: http(s), sem espaços nem controles. Devolve a forma normal. */
function cleanUrl(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > MAX_URL_LENGTH || /[\u0000-\u001f\u007f\s]/.test(text)) return null;
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname) return null;
  return url.href;
}

function hostOfUrl(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** Site da lista de sempre (youtube.com, m.youtube.com, youtu.be…). */
function isKnownVideoHost(value) {
  const host = hostOfUrl(value);
  return KNOWN_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/** Checagem rápida antes de qualquer processo: { ok, known } ou { ok: false, error: "url" }. */
function quickCheck(value) {
  const url = cleanUrl(value);
  if (!url) return { ok: false, error: "url" };
  return { ok: true, url, known: isKnownVideoHost(url) };
}

/** Seletor de formato e pós-processamento de cada qualidade (sem ffmpeg: arquivo único). */
function formatArgsOf(quality, ffmpeg) {
  switch (quality) {
    case "best":
      return ffmpeg ? ["-f", "bv*+ba/b", "--merge-output-format", "mp4"] : ["-f", "b"];
    case "1080":
      return ffmpeg
        ? ["-f", "bv*[height<=1080]+ba/b[height<=1080]", "--merge-output-format", "mp4"]
        : ["-f", "b[height<=1080]/b"];
    case "720":
      return ffmpeg
        ? ["-f", "bv*[height<=720]+ba/b[height<=720]", "--merge-output-format", "mp4"]
        : ["-f", "b[height<=720]/b"];
    case "audio-mp3":
      return ffmpeg ? ["-f", "ba/b", "-x", "--audio-format", "mp3"] : ["-f", "ba/b"];
    case "audio-m4a":
      return ffmpeg
        ? ["-f", "ba[ext=m4a]/ba/b", "-x", "--audio-format", "m4a"]
        : ["-f", "ba[ext=m4a]/ba/b"];
    default:
      return null;
  }
}

/**
 * argv do yt-dlp para uma URL. Sem shell: cada item é um argumento. A URL vai por último,
 * depois de "--", para nunca ser lida como opção. Devolve null se a qualidade não existe.
 */
function buildArgs({
  url,
  outDir,
  quality = "best",
  ffmpeg = null,
  jsRuntime = null,
  cookies = null,
}) {
  const format = formatArgsOf(quality, Boolean(ffmpeg));
  if (!format || typeof url !== "string" || !outDir) return null;
  // "%" na pasta é máscara do yt-dlp: escapa só ela; o nome vem do próprio yt-dlp.
  const template = path.join(outDir.replace(/%/g, "%%"), "%(title)s [%(id)s].%(ext)s");
  const args = [
    "--ignore-config",
    "--no-playlist",
    "--newline",
    "--no-colors",
    "--progress-template",
    `download:${PROGRESS_TAG}|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s`,
    ...format,
    "--trim-filenames",
    "180",
    "-o",
    template,
  ];
  if (ffmpeg) args.push("--ffmpeg-location", ffmpeg);
  // YouTube exige um runtime de JS para os desafios do player. O deno do usuário vale se
  // existir; senão o próprio Electron roda como node (ELECTRON_RUN_AS_NODE no ambiente).
  if (jsRuntime) args.push("--js-runtimes", "deno", "--js-runtimes", `node:${jsRuntime}`);
  // Cookies da guia (arquivo temporário): login no YouTube, Instagram, Facebook, X…
  if (cookies) args.push("--cookies", cookies);
  args.push("--", url);
  return args;
}

// Sites que usam os cookies de outro domínio (link curto ou domínio antigo).
const COOKIE_ALIASES = {
  "youtu.be": ["youtube.com"],
  "fb.watch": ["facebook.com"],
  "twitter.com": ["x.com"],
  "x.com": ["twitter.com"],
};

/** Domínios registráveis cujos cookies o yt-dlp precisa para a URL. */
function cookieDomainsOf(url) {
  const host = hostOfUrl(url);
  const base = host ? registrableDomain(host) : null;
  if (!base) return [];
  return [...new Set([base, ...(COOKIE_ALIASES[base] ?? [])])];
}

const cookieField = (value) => String(value ?? "").replace(/[\t\r\n]/g, "");

/**
 * Cookies do Electron → arquivo Netscape (o formato do --cookies). Só os dos domínios
 * pedidos; os de sessão vão com validade 0.
 */
function netscapeCookies(cookies, domains) {
  const wanted = (domains ?? []).map((domain) => String(domain).toLowerCase());
  const lines = ["# Netscape HTTP Cookie File", ""];
  for (const cookie of Array.isArray(cookies) ? cookies : []) {
    const raw = cookieField(cookie?.domain).toLowerCase();
    const bare = raw.replace(/^\./, "");
    if (!bare || !cookie?.name) continue;
    if (!wanted.some((domain) => bare === domain || bare.endsWith(`.${domain}`))) continue;
    const domain = cookie.hostOnly ? bare : `.${bare}`;
    const expiry = Number.isFinite(cookie.expirationDate) ? Math.floor(cookie.expirationDate) : 0;
    lines.push(
      [
        `${cookie.httpOnly ? "#HttpOnly_" : ""}${domain}`,
        cookie.hostOnly ? "FALSE" : "TRUE",
        cookieField(cookie.path) || "/",
        cookie.secure ? "TRUE" : "FALSE",
        String(Math.max(0, expiry)),
        cookieField(cookie.name),
        cookieField(cookie.value),
      ].join("\t"),
    );
  }
  return lines.length > 2 ? `${lines.join("\n")}\n` : null;
}

/** Erro do yt-dlp → texto curto para o usuário, quando há um conhecido. */
function friendlyError(message) {
  const text = String(message ?? "");
  if (/confirm you.?re not a bot|Sign in to confirm/i.test(text))
    return "O YouTube pediu login. Entre na sua conta do YouTube nesta guia e tente de novo.";
  if (/login required|log in|logged-in|cookies/i.test(text))
    return "Este site pede login. Entre na sua conta nesta guia e tente de novo.";
  if (/private video|Video unavailable|This video is unavailable/i.test(text))
    return "O vídeo é privado ou não está disponível.";
  if (/Unsupported URL/i.test(text)) return "O yt-dlp não reconhece vídeo neste link.";
  if (/Requested format is not available/i.test(text))
    return 'Essa qualidade não existe para este vídeo. Tente "Vídeo (melhor)".';
  if (/HTTP Error 429|Too Many Requests/i.test(text))
    return "O site limitou os downloads por agora. Tente de novo em alguns minutos.";
  return text;
}

const numberOrNull = (text) => {
  if (text === undefined || text === "" || text === "NA" || text === "None") return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
};

/** Linha de progresso (--progress-template) → números, ou null se não for dela. */
function parseProgressLine(line) {
  const text = String(line ?? "").trim();
  if (!text.startsWith(`${PROGRESS_TAG}|`)) return null;
  const [, downloaded, total, estimate, speed, eta] = text.split("|");
  return {
    downloaded: numberOrNull(downloaded),
    total: numberOrNull(total) ?? numberOrNull(estimate),
    speed: numberOrNull(speed),
    eta: numberOrNull(eta),
  };
}

/**
 * Linhas de saída que importam: destino de cada arquivo, pós-processamento, arquivo que já
 * existia e erro. Qualquer outra coisa devolve null.
 */
function parseOutputLine(line) {
  const text = String(line ?? "").trim();
  let match = /^\[download\] Destination: (.+)$/.exec(text);
  if (match) return { kind: "download", path: match[1] };
  match = /^\[download\] (.+) has already been downloaded/.exec(text);
  if (match) return { kind: "existing", path: match[1] };
  match = /^\[Merger\] Merging formats into "(.+)"$/.exec(text);
  if (match) return { kind: "post", path: match[1] };
  match = /^\[ExtractAudio\] Destination: (.+)$/.exec(text);
  if (match) return { kind: "post", path: match[1] };
  if (
    /^\[(Merger|ExtractAudio|VideoConvertor|VideoRemuxer|FixupM4a|FixupM3u8|EmbedThumbnail|Metadata)\]/.test(
      text,
    )
  ) {
    return { kind: "post", path: "" };
  }
  if (text.startsWith("ERROR:"))
    return { kind: "error", message: text.slice(6).trim().slice(0, 300) };
  return null;
}

/**
 * Progresso total de um download que pode ter vários fluxos (vídeo e áudio, mesclados): cada
 * fluxo começa de zero, então o acumulado soma os que já terminaram.
 */
function createProgress() {
  let base = 0;
  let downloaded = 0;
  let total = 0;
  const next = () => {
    base += total || downloaded;
    downloaded = 0;
    total = 0;
  };
  return {
    newStream() {
      if (downloaded > 0) next();
    },
    feed(progress) {
      if (progress.downloaded !== null && progress.downloaded < downloaded) next();
      if (progress.downloaded !== null) downloaded = progress.downloaded;
      if (progress.total !== null) total = progress.total;
      return {
        received: base + downloaded,
        total: total ? base + total : 0,
      };
    },
    finishStream() {
      if (total) downloaded = total;
    },
  };
}

/** Nome e MIME que o download-rules usa para escolher a pasta (vídeo ou áudio). */
const ytdlpFileName = (quality) => (quality.startsWith("audio") ? "audio.mp3" : "video.mp4");
const ytdlpMime = (quality) => (quality.startsWith("audio") ? "audio/mpeg" : "video/mp4");

/** Caminho dentro da pasta de destino (o serviço só remove o que o próprio job criou). */
function isInside(dir, file) {
  const rel = path.relative(dir, file);
  return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** Arquivo existente e executável (no Windows, existir basta). */
function defaultExecutable(file) {
  try {
    if (!fs.statSync(file).isFile()) return false;
    if (process.platform !== "win32") fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Serviço do yt-dlp. Dependências (todas opcionais nos testes):
 *  spawn, execFile       child_process
 *  userDataDir()         pasta de dados do app (bin/ fica dentro)
 *  platform, arch, env, home
 *  getMeta(key) / setMeta(key, value)   meta "ytdlpPath"
 *  downloads.startExternal({...})       gerenciador (lista, progresso, cancelar)
 *  routeFor({url, filename, mime})      { dir, tags } da regra de downloads
 *  fetchImpl(url)                       Response (fetch) para instalar
 *  emit(channel, payload)               aviso para todas as janelas (erros)
 *  enabled()                            flag ytdlp
 */
function createYtdlpService({
  spawn,
  execFile = () => {},
  userDataDir = () => "",
  platform = process.platform,
  arch = process.arch,
  env = process.env,
  home = "",
  getMeta = () => null,
  setMeta = () => {},
  downloads,
  routeFor = () => ({ dir: "", tags: [] }),
  fetchImpl = globalThis.fetch,
  emit = () => {},
  isExecutable = defaultExecutable,
  enabled = () => true,
  now = Date.now,
  fsImpl = fs,
  jsRuntime = null,
  cookiesFor = async () => null,
  tempDir = () => os.tmpdir(),
}) {
  // id do download → job (processo vivo).
  const jobs = new Map();
  let installing = false;

  const managedPath = () => path.join(userDataDir(), "bin", binaryNameOf(platform));
  const binaryPath = () => {
    const configured = getMeta("ytdlpPath");
    return findYtdlp(
      {
        configured: typeof configured === "string" ? configured : null,
        env,
        platform,
        userData: userDataDir(),
      },
      isExecutable,
    );
  };
  const ffmpegPath = () => findFfmpeg({ env, platform }, isExecutable);

  async function fetchBytes(url) {
    const response = await fetchImpl(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length > MAX_INSTALL_BYTES) throw new Error("size");
    return data;
  }

  function removePartials(job) {
    for (const file of job.created) {
      if (!isInside(job.outDir, file)) continue;
      for (const suffix of ["", ".part", ".ytdl"]) {
        try {
          fsImpl.rmSync(`${file}${suffix}`, { force: true });
        } catch {
          // Arquivo travado: fica para o usuário apagar.
        }
      }
    }
  }

  function killTree(child) {
    if (!child) return;
    if (platform === "win32") {
      execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], () => {});
      return;
    }
    // Processo do grupo (o ffmpeg que o yt-dlp abriu também sai).
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      try {
        child.kill("SIGTERM");
      } catch {
        // Já saiu.
      }
    }
  }

  /** Cookies da guia num arquivo temporário (pasta 0700, arquivo 0600); null sem cookies. */
  async function writeCookies(url, owner, tabId) {
    let text = null;
    try {
      text = netscapeCookies(await cookiesFor(owner, tabId, url), cookieDomainsOf(url));
    } catch {
      text = null;
    }
    if (!text) return null;
    try {
      const dir = fsImpl.mkdtempSync(path.join(tempDir(), "agzos-ytdlp-"));
      fsImpl.writeFileSync(path.join(dir, "cookies.txt"), text, { mode: 0o600 });
      return dir;
    } catch {
      return null;
    }
  }

  function dropCookies(dir) {
    if (!dir) return;
    try {
      fsImpl.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Pasta temporária: o sistema limpa depois.
    }
  }

  function settle(job, code) {
    if (job.done) return;
    job.done = true;
    jobs.delete(job.id);
    dropCookies(job.cookieDir);
    const finished =
      !job.killed && code === 0 && Boolean(job.lastPath) && fsImpl.existsSync(job.lastPath);
    if (!finished) removePartials(job);
    if (job.killed) {
      job.handle.finish("cancelled");
      return;
    }
    if (finished) {
      job.handle.finish("completed", job.lastPath);
      return;
    }
    job.handle.finish("interrupted");
    emit("agzos:ytdlp-error", {
      id: job.id,
      message: friendlyError(job.error) || "O yt-dlp não conseguiu baixar este link.",
    });
  }

  function onLine(job, line) {
    const progress = parseProgressLine(line);
    if (progress) {
      const sum = job.progress.feed(progress);
      job.handle.update({ receivedBytes: sum.received, totalBytes: sum.total });
      return;
    }
    const output = parseOutputLine(line);
    if (!output) return;
    if (output.kind === "error") {
      job.error = output.message;
      return;
    }
    if (output.kind === "download") {
      job.progress.newStream();
      job.created.add(output.path);
      job.lastPath = output.path;
      job.handle.update({ filename: path.basename(output.path) });
      return;
    }
    if (output.kind === "post") {
      job.progress.finishStream();
      if (output.path) {
        job.created.add(output.path);
        job.lastPath = output.path;
        job.handle.update({ filename: path.basename(output.path) });
      }
      return;
    }
    if (output.kind === "existing") {
      job.lastPath = output.path;
      job.handle.update({ filename: path.basename(output.path) });
    }
  }

  // Cada saída (stdout e stderr) tem o seu decoder e a sua linha parcial: o decoder guarda o
  // caractere UTF-8 cortado entre dois pedaços (títulos com acento).
  function consume(job, stream, chunk) {
    stream.buffer += stream.decoder.write(chunk);
    const lines = stream.buffer.split(/\r\n|\n|\r/);
    stream.buffer = lines.pop() ?? "";
    for (const line of lines) onLine(job, line);
  }

  function flush(job, stream) {
    stream.buffer += stream.decoder.end();
    if (stream.buffer) onLine(job, stream.buffer);
    stream.buffer = "";
  }

  /** Para o download: mata o processo; o "close" marca como cancelado e limpa os parciais. */
  function stop(job) {
    if (job.done) return false;
    job.killed = true;
    killTree(job.child);
    return true;
  }

  return {
    /** Estado para a barra e o menu: caminhos, se é o instalado e se há ffmpeg. */
    status() {
      const binary = binaryPath();
      return {
        enabled: enabled(),
        binary,
        managed: Boolean(binary) && binary === managedPath(),
        ffmpeg: Boolean(ffmpegPath()),
        installing,
        jobs: jobs.size,
      };
    },

    /** Baixa o yt-dlp oficial, confere o SHA2-256SUMS do mesmo release e instala. */
    async install() {
      if (!enabled()) return { ok: false, error: "off" };
      if (installing) return { ok: false, error: "busy" };
      const asset = assetNameOf(platform, arch);
      if (!asset) return { ok: false, error: "platform" };
      installing = true;
      try {
        const sums = (await fetchBytes(`${RELEASE_BASE}${SUMS_NAME}`)).toString("utf8");
        const expected = checksumOf(sums, asset);
        if (!expected) return { ok: false, error: "checksum" };
        const data = await fetchBytes(`${RELEASE_BASE}${asset}`);
        if (sha256Of(data) !== expected) return { ok: false, error: "checksum" };
        const target = managedPath();
        fsImpl.mkdirSync(path.dirname(target), { recursive: true });
        const temp = `${target}.${process.pid}.${now()}.tmp`;
        fsImpl.writeFileSync(temp, data, { mode: 0o755 });
        if (platform !== "win32") fsImpl.chmodSync(temp, 0o755);
        try {
          fsImpl.renameSync(temp, target);
        } catch (error) {
          fsImpl.rmSync(temp, { force: true });
          // Windows: o .exe em uso não é substituído (um download ainda roda com ele).
          if (error?.code === "EPERM" || error?.code === "EBUSY")
            return { ok: false, error: "in-use" };
          throw error;
        }
        return { ok: true, path: target };
      } catch {
        return { ok: false, error: "download" };
      } finally {
        installing = false;
      }
    },

    /** O usuário escolheu um yt-dlp no computador. */
    pick(file) {
      if (!enabled()) return { ok: false, error: "off" };
      if (typeof file !== "string" || !path.isAbsolute(file))
        return { ok: false, error: "invalid" };
      if (!looksLikeYtdlp(file) || !isExecutable(file)) return { ok: false, error: "invalid" };
      setMeta("ytdlpPath", file);
      return { ok: true, binary: file };
    },

    /** Inicia o download de uma URL na qualidade pedida. */
    async start({
      url,
      quality = "best",
      private: isPrivate = false,
      tabId = null,
      owner = null,
    } = {}) {
      if (!enabled()) return { ok: false, error: "off" };
      const clean = cleanUrl(url);
      if (!clean) return { ok: false, error: "url" };
      if (!QUALITY_KEYS.includes(quality)) return { ok: false, error: "quality" };
      const binary = binaryPath();
      if (!binary) return { ok: false, error: "missing" };
      if (jobs.size >= MAX_JOBS) return { ok: false, error: "busy" };
      const ffmpeg = ffmpegPath();
      const route = routeFor({
        url: clean,
        filename: ytdlpFileName(quality),
        mime: ytdlpMime(quality),
      });
      const outDir = route.dir;
      if (!outDir) return { ok: false, error: "dir" };
      try {
        fsImpl.mkdirSync(outDir, { recursive: true });
      } catch {
        return { ok: false, error: "dir" };
      }
      const cookieDir = await writeCookies(clean, owner, tabId);
      const args = buildArgs({
        url: clean,
        outDir,
        quality,
        ffmpeg,
        jsRuntime,
        cookies: cookieDir ? path.join(cookieDir, "cookies.txt") : null,
      });
      if (!args) {
        dropCookies(cookieDir);
        return { ok: false, error: "quality" };
      }

      let child;
      try {
        child = spawn(binary, args, {
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
          // Grupo próprio no Mac/Linux: cancelar mata também o ffmpeg.
          detached: platform !== "win32",
          env: {
            ...env,
            // Saída em UTF-8 em todo sistema (no Windows viria no code page e quebraria
            // o caminho de títulos com acento).
            PYTHONUTF8: "1",
            PYTHONIOENCODING: "utf-8",
            ...(jsRuntime ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
          },
        });
      } catch {
        dropCookies(cookieDir);
        return { ok: false, error: "spawn" };
      }
      const host = hostOfUrl(clean) || "site";
      const job = {
        id: 0,
        child,
        outDir,
        handle: null,
        progress: createProgress(),
        created: new Set(),
        lastPath: "",
        error: "",
        killed: false,
        done: false,
        cookieDir,
      };
      job.handle = downloads.startExternal({
        url: clean,
        filename: `${quality.startsWith("audio") ? "Áudio" : "Vídeo"} de ${host}`,
        mime: ytdlpMime(quality),
        tags: route.tags,
        source: "ytdlp",
        private: isPrivate,
        cancel: () => stop(job),
      });
      job.id = job.handle.id;
      jobs.set(job.id, job);
      const out = { decoder: new StringDecoder("utf8"), buffer: "" };
      const err = { decoder: new StringDecoder("utf8"), buffer: "" };
      child.stdout?.on("data", (chunk) => consume(job, out, chunk));
      child.stderr?.on("data", (chunk) => consume(job, err, chunk));
      child.on("error", () => {
        job.error = job.error || "Não foi possível abrir o yt-dlp.";
        settle(job, -1);
      });
      child.on("close", (code) => {
        flush(job, out);
        flush(job, err);
        settle(job, code);
      });
      return { ok: true, id: job.id };
    },

    /** Cancela um download do yt-dlp (o gerenciador chama pelo id). */
    cancel(id) {
      const job = jobs.get(id);
      return job ? stop(job) : false;
    },

    /** Saída do app: mata todos os processos. */
    stopAll() {
      for (const job of [...jobs.values()]) stop(job);
    },

    /** Só para os testes e o diagnóstico. */
    activeCount: () => jobs.size,
  };
}

/** Registra os canais `ytdlp:*` (só a casca, por janela). */
function registerYtdlpIpc(ipcMain, service, { ctxOf = () => null, pick = async () => null } = {}) {
  ipcMain.handle("ytdlp:status", (event) => (ctxOf(event) ? service.status() : null));
  ipcMain.handle("ytdlp:install", (event) => (ctxOf(event) ? service.install() : { ok: false }));
  ipcMain.handle("ytdlp:pick", async (event) => {
    if (!ctxOf(event)) return { ok: false };
    const file = await pick(event);
    return file ? service.pick(file) : { ok: false };
  });
  ipcMain.handle("ytdlp:start", (event, payload = {}) => {
    const owner = ctxOf(event);
    if (!owner) return { ok: false, error: "window" };
    return service.start({
      owner,
      url: payload.url,
      quality: payload.quality,
      private: Boolean(payload.private),
      tabId: Number.isSafeInteger(payload.tabId) ? payload.tabId : null,
    });
  });
}

module.exports = {
  KNOWN_HOSTS,
  QUALITY_KEYS,
  PROGRESS_TAG,
  MAX_JOBS,
  assetNameOf,
  binaryNameOf,
  buildArgs,
  checksumOf,
  cleanUrl,
  cookieDomainsOf,
  createProgress,
  createYtdlpService,
  findFfmpeg,
  findYtdlp,
  formatArgsOf,
  friendlyError,
  isKnownVideoHost,
  looksLikeYtdlp,
  netscapeCookies,
  parseOutputLine,
  parseProgressLine,
  quickCheck,
  registerYtdlpIpc,
  sha256Of,
  ytdlpCandidates,
};

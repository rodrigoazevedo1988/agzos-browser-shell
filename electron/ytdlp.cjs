// Download de vídeos com o yt-dlp (5.0): YouTube, X, Instagram, Facebook, TikTok, Vimeo e
// tudo o que o yt-dlp aceita. O app só roda o binário com argv (nunca por shell), a URL vai
// depois de "--" e o progresso sai pelo gerenciador de downloads (downloads.cjs).
// Binário: o escolhido pelo usuário (meta ytdlpPath), o PATH e <userData>/bin. Sem nenhum,
// "Instalar" baixa o asset oficial do GitHub e confere o SHA2-256SUMS do mesmo release.
// 5.0.3: atualização do binário gerenciado (uma checagem por dia), cadeia de tentativas
// quando um site recusa, mídia tocada na página como plano B, diagnóstico copiável e a prova
// do Electron como runtime de JS.
// Funções puras no topo; o serviço recebe tudo por injeção (spawn, fetch, banco, downloads).

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { StringDecoder } = require("node:string_decoder");
const { registrableDomain } = require("./page-theme.cjs");

const RELEASE_BASE = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/";
const RELEASE_API = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";
const SUMS_NAME = "SHA2-256SUMS";
const MAX_INSTALL_BYTES = 120 * 1024 * 1024;
const MAX_URL_LENGTH = 2048;
const MAX_JOBS = 4;
const MAX_ATTEMPTS = 4;
const LOG_LINES = 80;
const REPORTS_KEPT = 20;
const PROGRESS_TAG = "AGZOSYTDLP";
const DAY_MS = 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = DAY_MS;
const STALE_DAYS = 60;
// Mundo isolado da leitura de mídia da página (4131 a 4135 são de outros recursos).
const MEDIA_WORLD_ID = 4136;
const YT_CLIENTS_ARG = "youtube:player_client=default,tv,web_safari,mweb,web_embedded";

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
 * app (<userData>/bin), nessa ordem. `name` é o executável (yt-dlp, ffmpeg ou deno).
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

/** Executável no PATH (ou nas pastas comuns). */
function findExecutable(baseName, { env = {}, platform }, isExecutable) {
  const name = platform === "win32" ? `${baseName}.exe` : baseName;
  return candidatesOf(name, { env, platform }).find((file) => isExecutable(file)) ?? null;
}

/** ffmpeg no PATH (ou nas pastas comuns); sem ele o yt-dlp não junta vídeo e áudio. */
function findFfmpeg(options, isExecutable) {
  return findExecutable("ffmpeg", options, isExecutable);
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

const isYoutubeHost = (host) =>
  /(^|\.)youtube\.com$/.test(host) || host === "youtu.be" || host.endsWith(".youtu.be");

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
 * Formato da última tentativa (plano d). Vídeo com ffmpeg: "b/bv*+ba/best" (720 e 1080 mantêm
 * o teto da qualidade escolhida); sem ffmpeg: "b". Áudio não tem fallback (devolve null).
 */
function fallbackFormatOf(quality, ffmpeg) {
  if (quality.startsWith("audio")) return null;
  if (!ffmpeg) return ["-f", "b"];
  const cap = quality === "720" ? "[height<=720]" : quality === "1080" ? "[height<=1080]" : "";
  const format = cap ? `b${cap}/bv*${cap}+ba/b` : "b/bv*+ba/best";
  return ["-f", format, "--merge-output-format", "mp4"];
}

/** Pasta de cabeçalhos/UA só vale com valor limpo (sem controles, tamanho razoável). */
function cleanHeaderValue(value, max = 300) {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  return text && text.length <= max ? text : null;
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
  deno = false,
  cookies = null,
  format = null,
  extraArgs = [],
  referer = null,
  userAgent = null,
  impersonate = false,
}) {
  const formatArgs = format ?? formatArgsOf(quality, Boolean(ffmpeg));
  if (!formatArgs || typeof url !== "string" || !outDir) return null;
  // "%" na pasta é máscara do yt-dlp: escapa só ela; o nome vem do próprio yt-dlp.
  const template = path.join(outDir.replace(/%/g, "%%"), "%(title)s [%(id)s].%(ext)s");
  const args = [
    "--ignore-config",
    "--no-playlist",
    "--newline",
    "--no-colors",
    "--progress-template",
    `download:${PROGRESS_TAG}|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s`,
    ...formatArgs,
    "--trim-filenames",
    "180",
    "-o",
    template,
  ];
  if (ffmpeg) args.push("--ffmpeg-location", ffmpeg);
  // Runtime de JS para os desafios do YouTube: o deno do sistema e/ou o próprio Electron como
  // node (ELECTRON_RUN_AS_NODE no ambiente, só depois da prova de que funciona).
  if (deno) args.push("--js-runtimes", "deno");
  if (jsRuntime) args.push("--js-runtimes", `node:${jsRuntime}`);
  // Cookies da guia (arquivo temporário): login no YouTube, Instagram, Facebook, X…
  if (cookies) args.push("--cookies", cookies);
  if (impersonate) args.push("--impersonate", "chrome");
  const cleanReferer = cleanUrl(referer);
  if (cleanReferer) args.push("--add-headers", `Referer:${cleanReferer}`);
  const agent = cleanHeaderValue(userAgent);
  if (agent) args.push("--user-agent", agent);
  args.push(...extraArgs);
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

/* ---------- Erros: classificação, texto para o usuário e plano de nova tentativa ---------- */

/** Motivos que nenhuma nova tentativa resolve (com a mensagem para o usuário). */
function terminalMessageOf(text) {
  if (/\bDRM\b|DRM protected|drm-protected/i.test(text))
    return "Este vídeo tem DRM e não pode ser baixado.";
  if (
    /(?:not\s+)?available in your country|blocked (?:it )?in your country|geo[- ]?restrict|geo[- ]?block/i.test(
      text,
    )
  )
    return "Este vídeo não está disponível no seu país (bloqueio regional).";
  if (
    /will begin in|premieres in|live event has not started|upcoming live|not started yet/i.test(
      text,
    )
  )
    return "A transmissão ainda não começou. Tente depois do horário marcado.";
  if (/private video|members[- ]only|This video is private|Join this channel/i.test(text))
    return "O vídeo é privado ou exclusivo para membros.";
  if (/private video|Video unavailable|This video is unavailable/i.test(text))
    return "O vídeo é privado ou não está disponível.";
  if (/has been removed|removed by the uploader/i.test(text)) return "O vídeo foi removido.";
  if (/HTTP Error 429|Too Many Requests/i.test(text))
    return "O site limitou os downloads por agora. Tente de novo em alguns minutos.";
  return null;
}

/** O que o texto do erro significa para a cadeia de tentativas. */
function classifyError(text, host = "") {
  const message = String(text ?? "");
  const yt = isYoutubeHost(String(host)) || /\[youtube/i.test(message);
  return {
    terminal: terminalMessageOf(message),
    unsupported: /Unsupported URL/i.test(message),
    yt,
    ytSpecific:
      /confirm you.?re not a bot|Sign in|nsig|PO Token|player|HTTP Error 403|Forbidden|Requested format is not available|confirm your age|age[- ]restricted/i.test(
        message,
      ),
    format: /Requested format is not available|No video formats found|requested format/i.test(
      message,
    ),
  };
}

/** Erro do yt-dlp → texto curto para o usuário, quando há um conhecido. */
function friendlyError(message) {
  const text = String(message ?? "");
  if (/confirm your age|age[- ]restricted/i.test(text))
    return "Este vídeo tem restrição de idade. Entre na sua conta do YouTube nesta guia e tente de novo.";
  const terminal = terminalMessageOf(text);
  if (terminal) return terminal;
  if (/confirm you.?re not a bot|Sign in to confirm/i.test(text))
    return "O YouTube pediu login. Entre na sua conta do YouTube nesta guia e tente de novo.";
  if (/login required|log in|logged-in|cookies/i.test(text))
    return "Este site pede login. Entre na sua conta nesta guia e tente de novo.";
  if (/Unsupported URL/i.test(text)) return "O yt-dlp não reconhece vídeo neste link.";
  if (/Requested format is not available/i.test(text))
    return 'Essa qualidade não existe para este vídeo. Tente "Vídeo (melhor)".';
  return text;
}

const STEP_LABEL = {
  "yt-clients": "clientes do YouTube",
  "site-headers": "Referer, navegador e UA da guia",
  "no-cookies": "sem cookies",
  format: "formato alternativo",
  media: "mídia tocada na página",
};

/**
 * Próximo passo depois de uma tentativa que falhou, ou null. Ordem: clientes do YouTube (só
 * para erros do YouTube), Referer/UA/impersonação (outros sites), sem cookies, formato. Cada
 * passo entra uma vez e os anteriores continuam valendo. Sem o plano B de mídia, um
 * "Unsupported URL" vira a mídia que a página tocou.
 */
function nextAttempt({
  text = "",
  host = "",
  applied = [],
  attempts = 1,
  cookies = false,
  video = false,
}) {
  if (attempts >= MAX_ATTEMPTS) return null;
  const c = classifyError(text, host);
  if (c.terminal) return null;
  const has = (id) => applied.includes(id);
  const step = (id) => ({ id, label: STEP_LABEL[id] });
  if (c.unsupported) return has("media") ? null : step("media");
  if (c.yt && c.ytSpecific && !has("yt-clients")) return step("yt-clients");
  if (!c.yt && !has("site-headers")) return step("site-headers");
  if (cookies && !has("no-cookies")) return step("no-cookies");
  if (video && !has("format")) return step("format");
  return null;
}

/** Opções de uma tentativa a partir dos passos já aplicados (acumulados). */
function attemptOptionsOf(applied = [], { quality = "best", ffmpeg = false, referer, userAgent }) {
  const has = (id) => applied.includes(id);
  return {
    extraArgs: has("yt-clients") ? ["--extractor-args", YT_CLIENTS_ARG] : [],
    format: has("format") ? fallbackFormatOf(quality, ffmpeg) : null,
    referer: has("site-headers") ? referer || null : null,
    userAgent: has("site-headers") ? userAgent || null : null,
    // Só o pedido: quem decide se o navegador impersonado existe é o serviço (uma vez).
    impersonate: has("site-headers"),
    cookies: !has("no-cookies"),
  };
}

/* ---------- Versões, atualização e runtime ---------- */

/** Versão do yt-dlp (AAAA.MM.DD, às vezes com .HHMMSS) a partir da saída de --version. */
function parseVersion(text) {
  const match = /(\d{4}\.\d{2}\.\d{2}(?:\.\d+)?)/.exec(String(text ?? ""));
  return match ? match[1] : null;
}

/** Tag do release mais recente (JSON da API do GitHub). */
function tagOf(json) {
  try {
    return parseVersion(JSON.parse(String(json ?? ""))?.tag_name);
  } catch {
    return null;
  }
}

function versionDateOf(version) {
  const match = /^(\d{4})\.(\d{2})\.(\d{2})/.exec(String(version ?? ""));
  if (!match) return null;
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(time) ? time : null;
}

/** Idade da versão em dias (null sem versão reconhecível). */
function versionAgeDays(version, now) {
  const time = versionDateOf(version);
  if (time === null) return null;
  return Math.floor((now - time) / DAY_MS);
}

/** Versão de usuário (escolhida ou do PATH) com mais de `days` dias. */
function isStaleVersion(version, now, days = STALE_DAYS) {
  const age = versionAgeDays(version, now);
  return age !== null && age > days;
}

/**
 * Checa o release só no binário gerenciado, no máximo uma vez por intervalo. Relógio que voltou
 * também conta como vencido.
 */
function shouldCheckRelease({ managed, checkedAt, now, intervalMs = CHECK_INTERVAL_MS }) {
  if (!managed) return false;
  const last = Number(checkedAt);
  if (!Number.isFinite(last) || last <= 0) return true;
  if (now < last) return true;
  return now - last >= intervalMs;
}

/** Atualiza só quando as duas versões são conhecidas e diferentes. */
function needsUpdate(installed, latest) {
  const a = parseVersion(installed);
  const b = parseVersion(latest);
  return Boolean(a && b && a !== b);
}

/** O `--version` de um node válido: "v22.23.4". */
function isNodeVersionOutput(text) {
  return /^v\d+\.\d+\.\d+/m.test(String(text ?? "").trim());
}

/** Saída de --list-impersonate-targets: há um alvo "chrome" disponível (curl_cffi). */
function hasImpersonateTarget(text, name = "chrome") {
  const wanted = new RegExp(`^\\s*${name}\\b`, "i");
  return String(text ?? "")
    .split(/\r?\n/)
    .some((line) => wanted.test(line) && !/unavailable/i.test(line));
}

/* ---------- Mídia da página (plano B para sites que o yt-dlp não reconhece) ---------- */

const MEDIA_PROBE_SOURCE = `(() => {
  const found = [];
  const seen = new Set();
  const add = (url, playing) => {
    if (typeof url !== "string" || !/^https?:/i.test(url) || seen.has(url) || found.length >= 20) return;
    seen.add(url);
    found.push({ url, playing: Boolean(playing) });
  };
  for (const media of document.querySelectorAll("video, audio")) {
    const playing = !media.paused && !media.ended;
    add(media.currentSrc || media.src, playing);
    for (const source of media.querySelectorAll("source[src]")) add(source.src, playing);
  }
  return found;
})()`;

/** Tipo do recurso pelo MIME e pelo caminho; segmentos (.ts, .m4s) não contam. */
function mediaKind(url, contentType = "") {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return null;
  const type = String(contentType ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (type === "application/vnd.apple.mpegurl" || type === "application/x-mpegurl") return "hls";
  if (type === "application/dash+xml") return "dash";
  if (type === "video/mp2t" || type === "video/iso.segment") return null;
  let pathname;
  try {
    pathname = new URL(url).pathname.toLowerCase();
  } catch {
    return null;
  }
  if (/\.(ts|m4s|m4f|cmfv|cmfa)$/.test(pathname)) return null;
  if (/^video\//.test(type)) return "video";
  if (/^audio\//.test(type)) return "audio";
  if (pathname.endsWith(".m3u8")) return "hls";
  if (pathname.endsWith(".mpd")) return "dash";
  if (/\.(mp4|webm|mov|m4v|mkv)$/.test(pathname)) return "video";
  if (/\.(m4a|mp3|ogg|oga|opus|aac|wav)$/.test(pathname)) return "audio";
  return null;
}

/** Chave do recurso: origem + caminho (sem a query, que muda a cada carregamento). */
function resourceKeyOf(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

/** Valor de um cabeçalho de resposta (objeto do webRequest: nomes e valores em array). */
function headerValueOf(headers, name) {
  if (!headers || typeof headers !== "object") return "";
  const wanted = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() !== wanted) continue;
    const value = headers[key];
    return String(Array.isArray(value) ? (value[0] ?? "") : (value ?? ""));
  }
  return "";
}

/**
 * Respostas de mídia por guia (webContentsId), limitadas: `perTab` URLs por guia e `tabs`
 * guias (a mais antiga sai). Mesma URL sem query substitui a antiga.
 */
function createMediaLog({ perTab = 30, tabs = 100 } = {}) {
  const logs = new Map();
  const note = (id, url, contentType = "", at = Date.now()) => {
    if (!Number.isSafeInteger(id) || id < 0) return false;
    if (typeof url !== "string" || url.length > MAX_URL_LENGTH || !/^https?:\/\//i.test(url))
      return false;
    const kind = mediaKind(url, contentType);
    if (!kind) return false;
    let list = logs.get(id);
    if (list) {
      logs.delete(id);
    } else {
      list = [];
      if (logs.size >= tabs) logs.delete(logs.keys().next().value);
    }
    logs.set(id, list);
    const key = resourceKeyOf(url);
    const index = list.findIndex((item) => item.key === key);
    if (index >= 0) list.splice(index, 1);
    list.push({ url, kind, key, at });
    if (list.length > perTab) list.splice(0, list.length - perTab);
    return true;
  };
  return {
    /** Chamado pelo onHeadersReceived da session (main.cjs), só com o que o webRequest traz. */
    noteResponse(details, at) {
      if (!details) return false;
      return note(
        details.webContentsId,
        details.url,
        headerValueOf(details.responseHeaders, "content-type"),
        at,
      );
    },
    note,
    /** Mais recente primeiro. */
    list(id) {
      return (logs.get(id) ?? []).slice().reverse();
    },
    forget(id) {
      logs.delete(id);
    },
  };
}

const KIND_SCORE = { hls: 100, dash: 90, video: 60, audio: 30 };

/**
 * Candidatos de mídia para o yt-dlp, do melhor para o pior: manifesto (m3u8/mpd) antes de
 * arquivo; o que a página está tocando (dom) ganha; mesmo site da página ganha um pouco.
 * blob: e data: não entram. Devolve { url, kind }.
 */
function rankMediaCandidates(entries, { pageUrl = "", max = 3 } = {}) {
  const pageSite = registrableDomain(hostOfUrl(pageUrl));
  const best = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const url = cleanUrl(entry?.url);
    if (!url) continue;
    const kind =
      entry.kind && KIND_SCORE[entry.kind]
        ? entry.kind
        : (mediaKind(url, entry.contentType ?? "") ?? (entry.source === "dom" ? "video" : null));
    if (!kind || !KIND_SCORE[kind]) continue;
    let score = KIND_SCORE[kind];
    if (entry.source === "dom") score += 15;
    if (entry.playing) score += 10;
    if (pageSite && registrableDomain(hostOfUrl(url)) === pageSite) score += 5;
    const key = resourceKeyOf(url);
    const at = Number(entry.at) || 0;
    const current = best.get(key);
    if (!current || score > current.score || (score === current.score && at > current.at)) {
      best.set(key, { url, kind, score, at });
    }
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score || b.at - a.at)
    .slice(0, max)
    .map(({ url, kind }) => ({ url, kind }));
}

/* ---------- Diagnóstico ---------- */

/** Linha de saída sem o que não pode sair (cabeçalhos de cookie/autorização, tokens na URL). */
function redactLine(line) {
  const text = String(line ?? "").slice(0, 500);
  if (/\b(cookie|set-cookie|authorization|proxy-authorization)\b\s*[:=]/i.test(text))
    return "[linha omitida: cabeçalho sensível]";
  return text.replace(
    /([?&][^=&\s]*(?:token|sig|signature|key|auth|session|cookie|hmac)[^=&\s]*=)[^&\s]+/gi,
    "$1***",
  );
}

/** Texto copiável: versão, sistema, tentativas e as últimas linhas (já sem segredos). */
function diagnosticsText(report) {
  const lines = [
    "Diagnóstico do Agzos (yt-dlp)",
    `Quando: ${report.when}`,
    `yt-dlp: ${report.version ?? "versão não identificada"} (${report.origin})`,
    `Sistema: ${report.platform} · Electron ${report.electron ?? "?"}`,
    `Runtime de JS: ${report.runtime} · ffmpeg: ${report.ffmpeg ? "sim" : "não"}`,
    `Site: ${report.host || "?"} · Qualidade: ${report.quality} · Resultado: ${report.state}`,
  ];
  if (report.message) lines.push(`Erro: ${report.message}`);
  lines.push("", "Tentativas:");
  if (!report.attempts.length) lines.push("(nenhuma)");
  report.attempts.forEach((attempt, index) => {
    const error = attempt.error ? ` · ${attempt.error}` : "";
    lines.push(`${index + 1}. ${attempt.label} → saída ${attempt.exit}${error}`);
  });
  lines.push("", "Últimas linhas:");
  lines.push(...(report.lines.length ? report.lines : ["(sem saída)"]));
  return lines.join("\n");
}

/* ---------- Progresso, saída e arquivos ---------- */

/** Progresso (--progress-template) → números, ou null se não for dela. */
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

/** Promessa com prazo: quem não responde a tempo vira null (nunca trava o download). */
function withTimeout(promise, ms) {
  let timer = null;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([Promise.resolve(promise).catch(() => null), late]).finally(() =>
    clearTimeout(timer),
  );
}

/**
 * Executa um programa com argv (sem shell) e devolve { ok, stdout, stderr }. `execFile` é o do
 * child_process; o serviço nunca quebra por causa de um processo que não roda.
 */
function execCapture(execFile) {
  return (file, args, { timeout = 20000, env = {} } = {}) =>
    new Promise((resolve) => {
      try {
        execFile(
          file,
          args,
          { timeout, windowsHide: true, maxBuffer: 1024 * 1024, env },
          (error, stdout, stderr) =>
            resolve({ ok: !error, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") }),
        );
      } catch {
        resolve({ ok: false, stdout: "", stderr: "" });
      }
    });
}

/**
 * Serviço do yt-dlp. Dependências (todas opcionais nos testes):
 *  spawn, execFile       child_process
 *  userDataDir()         pasta de dados do app (bin/ fica dentro)
 *  platform, arch, env, home
 *  getMeta(key) / setMeta(key, value)   metas ytdlpPath, ytdlpCheckedAt, ytdlpNodeProbe
 *  downloads.startExternal({...})       gerenciador (lista, progresso, cancelar)
 *  routeFor({url, filename, mime})      { dir, tags } da regra de downloads
 *  fetchImpl(url)                       Response (fetch) para instalar
 *  emit(channel, payload)               aviso para todas as janelas (erros)
 *  enabled()                            flag ytdlp
 *  jsRuntime                            caminho do Electron (node) a provar
 *  probeKey                             versão do Electron: a prova roda uma vez por versão
 *  capture(file, args, {timeout, env})  execCapture(execFile): --version, impersonação
 *  latestTag()                          tag do release mais recente (null se não souber)
 *  tabAgentFor(owner, tabId)            { userAgent, pageUrl } da guia
 *  mediaFor(owner, tabId)               [{ url, playing, source, kind, at }] da página
 */
function createYtdlpService({
  spawn,
  execFile = () => {},
  userDataDir = () => "",
  platform = process.platform,
  arch = process.arch,
  env = process.env,
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
  probeKey = "",
  cookiesFor = async () => null,
  tempDir = () => os.tmpdir(),
  capture = null,
  latestTag = null,
  tabAgentFor = () => null,
  mediaFor = null,
}) {
  // id do download → job (processo vivo ou tentativa em andamento).
  const jobs = new Map();
  // Diagnóstico de downloads terminados (o botão "Copiar detalhes" lê daqui).
  const reports = new Map();
  const versions = new Map();
  const impersonation = new Map();
  let installing = false;
  let service = null;
  // Runtime de JS: começa como o Electron; `probeRuntime` confirma (ou tira) depois.
  let nodeRuntime = jsRuntime || null;

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
  const denoPath = () => findExecutable("deno", { env, platform }, isExecutable);

  const mtimeOf = (file) => {
    try {
      return fsImpl.statSync(file).mtimeMs;
    } catch {
      return null;
    }
  };

  /** Versão do binário (cache por caminho e data de modificação). */
  async function versionOf(file) {
    const mtime = mtimeOf(file);
    if (!file || mtime === null || !capture) return null;
    const hit = versions.get(file);
    if (hit && hit.mtime === mtime) return hit.version;
    const result = await capture(file, ["--version"], { timeout: 30000, env: utf8Env() });
    const version = result?.ok ? parseVersion(result.stdout) : null;
    if (version) versions.set(file, { mtime, version });
    return version;
  }

  /** O binário conhece o alvo "chrome" (curl_cffi)? Consultado uma vez por versão do arquivo. */
  async function canImpersonate(file) {
    const mtime = mtimeOf(file);
    if (!file || mtime === null || !capture) return false;
    const hit = impersonation.get(file);
    if (hit && hit.mtime === mtime) return hit.ok;
    const result = await capture(file, ["--list-impersonate-targets"], {
      timeout: 30000,
      env: utf8Env(),
    });
    const ok = Boolean(result?.ok) && hasImpersonateTarget(`${result.stdout}\n${result.stderr}`);
    impersonation.set(file, { mtime, ok });
    return ok;
  }

  function utf8Env(extra = {}) {
    return { ...env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8", ...extra };
  }

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

  /** Atualização do binário gerenciado: checa o release no máximo uma vez por dia. */
  async function refreshManaged(binary) {
    if (!latestTag || !binary) return;
    const managed = binary === managedPath();
    if (!shouldCheckRelease({ managed, checkedAt: getMeta("ytdlpCheckedAt"), now: now() })) return;
    // Marca antes: falha de rede não vira uma checagem a cada download.
    setMeta("ytdlpCheckedAt", now());
    const latest = await withTimeout(latestTag(), 8000);
    if (!latest) return;
    const installed = await versionOf(binary);
    if (!needsUpdate(installed, latest)) return;
    await service.install();
  }

  /** Pega o próximo trecho de mídia que a página tocou (null se não há). */
  async function pickMedia(job) {
    if (!mediaFor) return null;
    const entries = await withTimeout(mediaFor(job.owner, job.tabId), 5000);
    const ranked = rankMediaCandidates(entries ?? [], { pageUrl: job.pageUrl || job.url });
    return ranked.find((item) => item.url !== job.url) ?? null;
  }

  /** argv da próxima tentativa (com o que já foi aplicado). */
  async function prepareArgs(job) {
    const opts = attemptOptionsOf(job.applied, {
      quality: job.quality,
      ffmpeg: Boolean(job.ffmpeg),
      referer: job.pageUrl,
      userAgent: job.userAgent,
    });
    const impersonate = opts.impersonate ? await canImpersonate(job.binary) : false;
    return buildArgs({
      url: job.url,
      outDir: job.outDir,
      quality: job.quality,
      ffmpeg: job.ffmpeg,
      jsRuntime: job.node,
      deno: job.deno,
      cookies: job.cookiesOn && job.cookieDir ? path.join(job.cookieDir, "cookies.txt") : null,
      format: opts.format,
      extraArgs: opts.extraArgs,
      referer: opts.referer,
      userAgent: opts.userAgent,
      impersonate,
    });
  }

  function spawnChild(job, args) {
    return spawn(job.binary, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      // Grupo próprio no Mac/Linux: cancelar mata também o ffmpeg.
      detached: platform !== "win32",
      env: utf8Env(job.node ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    });
  }

  function remember(job, state) {
    const text = diagnosticsText({
      when: new Date(now()).toISOString(),
      version: job.version,
      origin: job.origin,
      platform: `${platform} ${arch}`,
      electron: process.versions?.electron ?? null,
      runtime: job.node ? "Electron como node" : job.deno ? "deno" : "nenhum",
      ffmpeg: Boolean(job.ffmpeg),
      host: job.host,
      quality: job.quality,
      state,
      message: job.error,
      attempts: job.attempts,
      lines: job.lines,
    });
    reports.delete(job.id);
    reports.set(job.id, text);
    if (reports.size > REPORTS_KEPT) reports.delete(reports.keys().next().value);
  }

  /** Fim do download: uma vez só. Cancelado, concluído ou interrompido (com aviso). */
  function settle(job, state) {
    if (job.done) return;
    job.done = true;
    jobs.delete(job.id);
    dropCookies(job.cookieDir);
    job.cookieDir = null;
    const finished = state === "completed";
    if (!finished) removePartials(job);
    remember(job, state);
    if (state === "cancelled") {
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

  function resetAttempt(job) {
    job.progress = createProgress();
    job.created = new Set();
    job.lastPath = "";
    job.error = "";
    job.attemptText = "";
  }

  function onLine(job, line) {
    const progress = parseProgressLine(line);
    if (progress) {
      const sum = job.progress.feed(progress);
      job.handle.update({ receivedBytes: sum.received, totalBytes: sum.total });
      return;
    }
    const kept = redactLine(line);
    job.lines.push(kept);
    if (job.lines.length > LOG_LINES) job.lines.splice(0, job.lines.length - LOG_LINES);
    if (/^(ERROR|WARNING):/.test(kept.trim()) && job.attemptText.length < 4000) {
      job.attemptText += `${kept.trim()}\n`;
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

  /** Fim de uma tentativa: sucesso, cancelamento, ou o próximo passo da cadeia. */
  async function finishAttempt(job, attempt, child, out, err, code) {
    if (attempt.closed) return;
    attempt.closed = true;
    if (job.child === child) job.child = null;
    flush(job, out);
    flush(job, err);
    if (job.done) return;
    const firstError = job.attemptText.split("\n").find((line) => line.startsWith("ERROR:"));
    job.attempts.push({
      label: attempt.label,
      exit: code,
      error: firstError ? firstError.slice(0, 300) : "",
    });
    if (job.killed) {
      settle(job, "cancelled");
      return;
    }
    if (code === 0 && job.lastPath && fsImpl.existsSync(job.lastPath)) {
      settle(job, "completed");
      return;
    }
    // Saída 0 sem arquivo, ou o processo nem abriu: não há o que tentar de novo.
    if (job.spawnFailed || code === 0) {
      settle(job, "interrupted");
      return;
    }
    const next = nextAttempt({
      text: job.attemptText,
      host: job.host,
      applied: job.applied,
      attempts: job.attempts.length,
      cookies: job.cookiesOn,
      video: job.video,
    });
    if (!next) {
      settle(job, "interrupted");
      return;
    }
    removePartials(job);
    resetAttempt(job);
    if (next.id === "media") {
      const picked = await pickMedia(job).catch(() => null);
      if (job.killed) {
        settle(job, "cancelled");
        return;
      }
      if (!picked) {
        job.error = "Unsupported URL";
        settle(job, "interrupted");
        return;
      }
      job.url = picked.url;
      job.applied.push("media", "site-headers");
    } else {
      job.applied.push(next.id);
      if (next.id === "no-cookies") {
        job.cookiesOn = false;
        dropCookies(job.cookieDir);
        job.cookieDir = null;
      }
    }
    await launch(job, next.label);
  }

  /** Abre a próxima tentativa do job (uma spawn por tentativa). */
  async function launch(job, label) {
    let args = null;
    try {
      args = await prepareArgs(job);
    } catch {
      args = null;
    }
    if (job.killed) {
      settle(job, "cancelled");
      return;
    }
    if (!args) {
      settle(job, "interrupted");
      return;
    }
    job.handle.update({ receivedBytes: 0, totalBytes: 0 });
    let child;
    try {
      child = spawnChild(job, args);
    } catch {
      job.error = "Não foi possível abrir o yt-dlp.";
      job.spawnFailed = true;
      settle(job, "interrupted");
      return;
    }
    job.attemptLabel = label ?? "normal";
    attach(job, child);
  }

  /** Liga a saída e o fim do processo a uma tentativa. */
  function attach(job, child) {
    const attempt = { label: job.attemptLabel ?? "normal", closed: false };
    job.child = child;
    const out = { decoder: new StringDecoder("utf8"), buffer: "" };
    const err = { decoder: new StringDecoder("utf8"), buffer: "" };
    child.stdout?.on("data", (chunk) => consume(job, out, chunk));
    child.stderr?.on("data", (chunk) => consume(job, err, chunk));
    child.on("error", () => {
      job.error = job.error || "Não foi possível abrir o yt-dlp.";
      job.spawnFailed = true;
      void finishAttempt(job, attempt, child, out, err, -1);
    });
    child.on("close", (code) => {
      void finishAttempt(job, attempt, child, out, err, code);
    });
  }

  /** Para o download: mata o processo; a cadeia para e o "close" marca como cancelado. */
  function stop(job) {
    if (job.done) return false;
    job.killed = true;
    killTree(job.child);
    return true;
  }

  service = {
    /** Estado para a barra e o menu: caminhos, versão, se é o instalado e se há ffmpeg. */
    async status() {
      const binary = binaryPath();
      const managed = Boolean(binary) && binary === managedPath();
      const version = binary ? await versionOf(binary) : null;
      return {
        enabled: enabled(),
        binary,
        managed,
        ffmpeg: Boolean(ffmpegPath()),
        installing,
        jobs: jobs.size,
        version,
        // Binário escolhido ou do PATH com mais de 60 dias: a casca oferece o do Agzos.
        stale: !managed && isStaleVersion(version, now()),
        ageDays: versionAgeDays(version, now()),
      };
    },

    /** Baixa o yt-dlp oficial, confere o SHA2-256SUMS do mesmo release e instala. */
    async install({ prefer = false } = {}) {
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
        versions.delete(target);
        // "Usar o yt-dlp do Agzos": o caminho gravado passa a ser o gerenciado.
        if (prefer) setMeta("ytdlpPath", target);
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
      versions.delete(file);
      return { ok: true, binary: file };
    },

    /**
     * Prova o Electron como runtime de JS (`<execPath> --version` com ELECTRON_RUN_AS_NODE). Uma
     * vez por versão do Electron (meta ytdlpNodeProbe); se falhar, o runtime some e vale o deno.
     */
    async probeRuntime() {
      if (!jsRuntime) {
        nodeRuntime = null;
        return null;
      }
      if (!capture) return nodeRuntime;
      const cached = getMeta("ytdlpNodeProbe");
      if (cached && typeof cached === "object" && cached.key === probeKey) {
        nodeRuntime = cached.ok ? jsRuntime : null;
        return nodeRuntime;
      }
      const result = await capture(jsRuntime, ["--version"], {
        timeout: 15000,
        env: utf8Env({ ELECTRON_RUN_AS_NODE: "1" }),
      });
      const ok = Boolean(result?.ok) && isNodeVersionOutput(result.stdout);
      setMeta("ytdlpNodeProbe", { key: probeKey, ok });
      nodeRuntime = ok ? jsRuntime : null;
      return nodeRuntime;
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
      // Antes do download: o binário gerenciado se atualiza no máximo uma vez por dia.
      await refreshManaged(binary).catch(() => {});
      const agent = tabAgentFor(owner, tabId) ?? {};
      const cookieDir = await writeCookies(clean, owner, tabId);
      const job = {
        id: 0,
        child: null,
        binary: binaryPath() ?? binary,
        url: clean,
        host: hostOfUrl(clean),
        pageUrl: cleanUrl(agent.pageUrl) || clean,
        userAgent: cleanHeaderValue(agent.userAgent),
        owner,
        tabId,
        quality,
        video: !quality.startsWith("audio"),
        ffmpeg,
        node: nodeRuntime,
        deno: Boolean(denoPath()),
        outDir,
        handle: null,
        progress: createProgress(),
        created: new Set(),
        lastPath: "",
        error: "",
        attemptText: "",
        attemptLabel: "normal",
        attempts: [],
        applied: [],
        lines: [],
        killed: false,
        done: false,
        spawnFailed: false,
        cookieDir,
        cookiesOn: Boolean(cookieDir),
        version: await versionOf(binary),
        origin: managedPath() === binary ? "instalado pelo Agzos" : "escolhido ou do sistema",
      };
      let child;
      try {
        const args = await prepareArgs(job);
        if (!args) throw new Error("quality");
        child = spawnChild(job, args);
      } catch (error) {
        dropCookies(cookieDir);
        return { ok: false, error: error?.message === "quality" ? "quality" : "spawn" };
      }
      const host = job.host || "site";
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
      attach(job, child);
      return { ok: true, id: job.id };
    },

    /** Diagnóstico copiável de um download do yt-dlp (null se não há mais). */
    details(id) {
      return reports.get(Number(id)) ?? null;
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
    /** Runtime de JS em uso agora (o Electron, se a prova passou). */
    nodeRuntime: () => nodeRuntime,
  };
  return service;
}

/** Registra os canais `ytdlp:*` (só a casca, por janela). */
function registerYtdlpIpc(ipcMain, service, { ctxOf = () => null, pick = async () => null } = {}) {
  ipcMain.handle("ytdlp:status", (event) => (ctxOf(event) ? service.status() : null));
  ipcMain.handle("ytdlp:install", (event, payload) =>
    ctxOf(event) ? service.install({ prefer: Boolean(payload?.prefer) }) : { ok: false },
  );
  ipcMain.handle("ytdlp:details", (event, id) => (ctxOf(event) ? service.details(id) : null));
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
  MAX_ATTEMPTS,
  LOG_LINES,
  MEDIA_WORLD_ID,
  MEDIA_PROBE_SOURCE,
  assetNameOf,
  attemptOptionsOf,
  binaryNameOf,
  buildArgs,
  checksumOf,
  classifyError,
  cleanUrl,
  cookieDomainsOf,
  createMediaLog,
  createProgress,
  createYtdlpService,
  diagnosticsText,
  execCapture,
  fallbackFormatOf,
  findFfmpeg,
  findYtdlp,
  formatArgsOf,
  friendlyError,
  hasImpersonateTarget,
  headerValueOf,
  isKnownVideoHost,
  isNodeVersionOutput,
  isStaleVersion,
  looksLikeYtdlp,
  mediaKind,
  needsUpdate,
  netscapeCookies,
  nextAttempt,
  parseOutputLine,
  parseProgressLine,
  parseVersion,
  quickCheck,
  rankMediaCandidates,
  redactLine,
  registerYtdlpIpc,
  shouldCheckRelease,
  sha256Of,
  tagOf,
  versionAgeDays,
  ytdlpCandidates,
};

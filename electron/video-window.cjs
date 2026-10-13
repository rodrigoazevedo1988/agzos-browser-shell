// Janela de vídeo (4.9): o Picture-in-Picture do Agzos. O PiP do Chromium só tem os botões
// dele e o Electron 44 não tem Document Picture-in-Picture (testado: documentPictureInPicture
// é undefined), então a página da guia vai para uma janela pequena, sempre por cima, que
// mostra só o vídeo, com uma camada de controles nossa por cima. Aqui ficam as regras puras,
// os scripts que rodam no mundo da página (o player do site só existe lá) e o HTML da camada.

const BAR_TIMEOUT_MS = 2000;
const INITIAL_WIDTH = 480;
const MIN_WIDTH = 240;
const MIN_HEIGHT = 135;
const MARGIN = 16;
const SEEK_LIMIT = 600;
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/** Níveis do player do YouTube (getAvailableQualityLevels) e o rótulo mostrado. */
const QUALITY_LABELS = {
  auto: "Automática",
  highres: "4320p",
  hd2880: "2880p",
  hd2160: "2160p (4K)",
  hd1440: "1440p",
  hd1080: "1080p",
  hd720: "720p",
  large: "480p",
  medium: "360p",
  small: "240p",
  tiny: "144p",
};

/**
 * Posição e tamanho da janela: a última usada (se ainda cabe numa tela) com a altura da
 * proporção do vídeo novo; senão 480 px de largura no canto inferior direito da área de
 * trabalho da janela de origem.
 */
function initialBounds({ videoWidth, videoHeight, workArea, saved = null }) {
  const ratio = videoWidth > 0 && videoHeight > 0 ? videoWidth / videoHeight : 16 / 9;
  const maxWidth = Math.max(MIN_WIDTH, Math.round(workArea.width * 0.9));
  const width = Math.min(
    maxWidth,
    Math.max(MIN_WIDTH, Math.round(Number(saved?.width) || INITIAL_WIDTH)),
  );
  const height = Math.max(MIN_HEIGHT, Math.round(width / ratio));
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    const x = Math.round(saved.x);
    const y = Math.round(saved.y);
    const inside =
      x >= workArea.x - width / 2 &&
      y >= workArea.y &&
      x + width / 2 <= workArea.x + workArea.width &&
      y + MIN_HEIGHT <= workArea.y + workArea.height;
    if (inside) return { x, y, width, height, ratio };
  }
  return {
    x: workArea.x + workArea.width - width - MARGIN,
    y: workArea.y + workArea.height - height - MARGIN,
    width,
    height,
    ratio,
  };
}

/** Comando da camada de controles, validado; null se não for um comando conhecido. */
function videoCommand(raw) {
  if (!raw || typeof raw !== "object") return null;
  const number = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  switch (raw.type) {
    case "toggle":
    case "mute":
    case "back":
    case "close":
      return { type: raw.type };
    case "seek": {
      const by = number(raw.by);
      return by === null
        ? null
        : { type: "seek", by: Math.max(-SEEK_LIMIT, Math.min(SEEK_LIMIT, by)) };
    }
    case "seek-to": {
      const time = number(raw.time);
      return time === null || time < 0 ? null : { type: "seek-to", time };
    }
    case "volume": {
      const value = number(raw.value);
      return value === null ? null : { type: "volume", value: Math.max(0, Math.min(1, value)) };
    }
    case "rate": {
      const value = number(raw.value);
      return RATES.includes(value) ? { type: "rate", value } : null;
    }
    case "quality":
      return typeof raw.value === "string" && Object.hasOwn(QUALITY_LABELS, raw.value)
        ? { type: "quality", value: raw.value }
        : null;
    default:
      return null;
  }
}

/** Estado que a camada recebe: só números, booleanos e textos curtos (nada do HTML do site). */
function overlayState(raw, title = "") {
  if (!raw || typeof raw !== "object") return null;
  const finite = (value, fallback = 0) =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  let quality = null;
  if (raw.quality && Array.isArray(raw.quality.levels)) {
    const levels = raw.quality.levels.filter(
      (level) => typeof level === "string" && Object.hasOwn(QUALITY_LABELS, level),
    );
    if (levels.length > 1) {
      quality = {
        levels: levels.map((value) => ({ value, label: QUALITY_LABELS[value] })),
        current: levels.includes(raw.quality.current) ? raw.quality.current : "auto",
      };
    }
  }
  return {
    title: String(title ?? "").slice(0, 200),
    paused: raw.paused === true,
    time: Math.max(0, finite(raw.time)),
    duration: Math.max(0, finite(raw.duration)),
    volume: Math.max(0, Math.min(1, finite(raw.volume, 1))),
    muted: raw.muted === true,
    rate: finite(raw.rate, 1),
    quality,
  };
}

// --- Scripts do mundo da página. `key` é sorteada por janela de vídeo: a propriedade fica
// na window do quadro, não enumerável, e guarda o <video> e os estilos trocados. ---

/**
 * Deixa à vista só o alvo: o <video> deste quadro (childUrl null) ou o <iframe> que carrega
 * childUrl (player embutido). Estilos por CSSOM com !important: o CSP do site não bloqueia
 * e cada valor anterior fica guardado para voltar igual. Os ancestrais perdem transform,
 * filter e contain (que prenderiam o position: fixed) e sobem para o topo.
 */
function isolateInPage({ key, childUrl }) {
  const deep = (root, selector, depth = 0, out = []) => {
    out.push(...root.querySelectorAll(selector));
    if (depth < 4) {
      for (const element of root.querySelectorAll("*")) {
        if (element.shadowRoot) deep(element.shadowRoot, selector, depth + 1, out);
      }
    }
    return out;
  };
  const area = (element) => {
    const rect = element.getBoundingClientRect();
    return Math.max(0, rect.width) * Math.max(0, rect.height);
  };
  let target = null;
  if (childUrl === null) {
    const weight = (video) => (video.paused ? 0 : 1e12) + area(video);
    target =
      deep(document, "video")
        .filter((video) => video.readyState > 0 && video.videoWidth > 0)
        .sort((a, b) => weight(b) - weight(a))[0] ?? null;
  } else {
    const child = new URL(childUrl);
    const urlOf = (frame) => {
      try {
        return new URL(frame.src, location.href);
      } catch {
        return null;
      }
    };
    const weight = (frame) => (urlOf(frame)?.pathname === child.pathname ? 1e12 : 0) + area(frame);
    target =
      deep(document, "iframe")
        .filter((frame) => urlOf(frame)?.origin === child.origin)
        .sort((a, b) => weight(b) - weight(a))[0] ?? null;
  }
  if (!target) return null;
  if (window[key])
    return childUrl === null ? { width: target.videoWidth, height: target.videoHeight } : {};
  if (childUrl === null && document.pictureInPictureElement) {
    document.exitPictureInPicture().catch(() => {});
  }
  const saved = [];
  const set = (element, props) => {
    const before = {};
    for (const [name, value] of Object.entries(props)) {
      before[name] = [
        element.style.getPropertyValue(name),
        element.style.getPropertyPriority(name),
      ];
      element.style.setProperty(name, value, "important");
    }
    saved.push([element, before]);
  };
  const targetProps = {
    position: "fixed",
    top: "0",
    left: "0",
    right: "auto",
    bottom: "auto",
    width: "100vw",
    height: "100vh",
    "max-width": "none",
    "max-height": "none",
    "min-width": "0",
    "min-height": "0",
    margin: "0",
    padding: "0",
    border: "0",
    "border-radius": "0",
    transform: "none",
    "z-index": "2147483647",
    visibility: "visible",
    opacity: "1",
    "background-color": "#000",
    ...(childUrl === null ? { "object-fit": "contain" } : {}),
  };
  set(target, targetProps);

  // Mantém o vídeo cobrindo 100vw × 100vh mesmo quando o site (YouTube, Twitch etc.)
  // roda listeners de resize e tenta sobrescrever top, left, width ou height inline.
  const enforceTarget = () => {
    if (!target.isConnected) return;
    for (const [name, value] of Object.entries(targetProps)) {
      if (
        target.style.getPropertyValue(name) !== value ||
        target.style.getPropertyPriority(name) !== "important"
      ) {
        target.style.setProperty(name, value, "important");
      }
    }
  };
  let mutating = false;
  const observer = new MutationObserver(() => {
    if (mutating) return;
    mutating = true;
    enforceTarget();
    mutating = false;
  });
  observer.observe(target, { attributes: true, attributeFilter: ["style", "class"] });
  window.addEventListener("resize", enforceTarget, { passive: true });
  target.addEventListener("resize", enforceTarget, { passive: true });
  target.addEventListener("loadedmetadata", enforceTarget, { passive: true });

  let element = target;
  for (;;) {
    let parent = element.parentNode;
    if (parent && parent.nodeType === 11) parent = parent.host;
    if (!parent || parent.nodeType !== 1) break;
    element = parent;
    set(element, {
      transform: "none",
      filter: "none",
      "backdrop-filter": "none",
      perspective: "none",
      contain: "none",
      container: "none",
      "container-type": "normal",
      "will-change": "auto",
      "clip-path": "none",
      mask: "none",
      "z-index": "2147483647",
      visibility: "visible",
      opacity: "1",
    });
  }
  set(document.documentElement, {
    overflow: "hidden",
    background: "#000",
    "background-color": "#000",
  });
  if (document.body) {
    set(document.body, {
      overflow: "hidden",
      background: "#000",
      "background-color": "#000",
    });
  }
  const cleanup = () => {
    observer.disconnect();
    window.removeEventListener("resize", enforceTarget);
    target.removeEventListener("resize", enforceTarget);
    target.removeEventListener("loadedmetadata", enforceTarget);
  };
  Object.defineProperty(window, key, {
    value: { video: childUrl === null ? target : null, saved, cleanup, enforce: enforceTarget },
    configurable: true,
  });
  return childUrl === null ? { width: target.videoWidth, height: target.videoHeight } : {};
}

/** Devolve os estilos de antes, na ordem inversa. */
function restoreInPage({ key }) {
  const store = window[key];
  if (!store) return false;
  if (typeof store.cleanup === "function") {
    try {
      store.cleanup();
    } catch {}
  }
  for (const [element, before] of store.saved.reverse()) {
    for (const [name, [value, priority]] of Object.entries(before)) {
      if (value) element.style.setProperty(name, value, priority);
      else element.style.removeProperty(name);
    }
  }
  delete window[key];
  return true;
}

/** Estado do vídeo (e dos níveis de qualidade, quando o player é o do YouTube). */
function stateInPage({ key }) {
  let video = window[key]?.video;
  if (!video || !video.isConnected) {
    const deep = (root, selector, depth = 0, out = []) => {
      out.push(...root.querySelectorAll(selector));
      if (depth < 4) {
        for (const el of root.querySelectorAll("*")) {
          if (el.shadowRoot) deep(el.shadowRoot, selector, depth + 1, out);
        }
      }
      return out;
    };
    const found = deep(document, "video").find(
      (v) => v.readyState > 0 && v.videoWidth > 0 && !v.paused,
    );
    if (found && window[key]) {
      window[key].video = found;
      video = found;
      window[key].enforce?.();
    } else {
      return null;
    }
  }
  let quality = null;
  const player = document.getElementById("movie_player");
  if (player && typeof player.getAvailableQualityLevels === "function") {
    try {
      quality = {
        levels: player.getAvailableQualityLevels(),
        current: player.getPlaybackQuality(),
      };
    } catch {
      quality = null;
    }
  }
  return {
    paused: video.paused,
    time: video.currentTime,
    duration: Number.isFinite(video.duration) ? video.duration : 0,
    volume: video.volume,
    muted: video.muted,
    rate: video.playbackRate,
    quality,
    videoWidth: video.videoWidth || 0,
    videoHeight: video.videoHeight || 0,
  };
}

/** Aplica um comando já validado por videoCommand. */
function commandInPage({ key, command }) {
  const video = window[key]?.video;
  if (!video) return false;
  switch (command.type) {
    case "toggle":
      if (video.paused) video.play().catch(() => {});
      else video.pause();
      break;
    case "pause":
      video.pause();
      break;
    case "mute":
      video.muted = !video.muted;
      break;
    case "seek":
      video.currentTime = Math.max(0, video.currentTime + command.by);
      break;
    case "seek-to":
      video.currentTime = command.time;
      break;
    case "volume":
      video.volume = command.value;
      if (command.value > 0) video.muted = false;
      break;
    case "rate":
      video.playbackRate = command.value;
      break;
    case "quality": {
      const player = document.getElementById("movie_player");
      try {
        player?.setPlaybackQualityRange?.(command.value, command.value);
        player?.setPlaybackQuality?.(command.value);
      } catch {
        return false;
      }
      break;
    }
    default:
      return false;
  }
  return true;
}

const pageScript = (fn, args) => `(${fn.toString()})(${JSON.stringify(args)})`;

/** Ícones (traço, 24×24) da camada. */
const ICONS = {
  play: '<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>',
  pause:
    '<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>',
  back10: '<path d="M11 17l-5-5 5-5"/><path d="M18 17l-5-5 5-5"/>',
  fwd10: '<path d="M13 17l5-5-5-5"/><path d="M6 17l5-5-5-5"/>',
  volume:
    '<path d="M11 5L6 9H3v6h3l5 4z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>',
  muted:
    '<path d="M11 5L6 9H3v6h3l5 4z" fill="currentColor"/><path d="M16 9l6 6"/><path d="M22 9l-6 6"/>',
  tab: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 14l3-3 3 3"/><path d="M12 11v7"/>',
  close: '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',
};

/** Página da camada de controles (data: URL; o estado chega por agzosVideo.onState). */
function controlsHtml() {
  const icon = (name) =>
    `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  const rates = RATES.map(
    (rate) => `<option value="${rate}">${String(rate).replace(".", ",")}×</option>`,
  ).join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>Janela de vídeo</title>
<style>
*{box-sizing:border-box}
html,body{margin:0;height:100%;overflow:hidden;background:transparent;color:#fff;
font:12px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;user-select:none}
body.idle{cursor:none}
.ui{position:absolute;left:0;right:0;transition:opacity .2s;opacity:1}
body.idle .ui{opacity:0;pointer-events:none}
#top{top:0;display:flex;align-items:center;gap:2px;height:32px;padding:0 4px;
background:linear-gradient(rgba(0,0,0,.65),rgba(0,0,0,0))}
#drag{flex:1;align-self:stretch;display:flex;align-items:center;min-width:0;padding:0 6px;-webkit-app-region:drag}
#title{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;opacity:.9}
#stage{position:absolute;top:32px;bottom:64px;left:0;right:0}
#bottom{bottom:0;padding:18px 8px 6px;background:linear-gradient(rgba(0,0,0,0),rgba(0,0,0,.75))}
#row{display:flex;align-items:center;gap:2px;margin-top:4px}
button{all:unset;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;
border-radius:6px;color:inherit;cursor:default;flex:none}
button:hover{background:rgba(255,255,255,.18)}
button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid #fff;outline-offset:-2px}
svg{width:18px;height:18px}
button span{display:inline-flex}
#time{padding:0 6px;font-variant-numeric:tabular-nums;white-space:nowrap}
#spacer{flex:1}
input[type=range]{accent-color:#fff;margin:0;cursor:default}
#seek{width:100%;height:14px;display:block}
#volume{width:70px}
select{background:rgba(0,0,0,.55);color:#fff;border:1px solid rgba(255,255,255,.35);border-radius:6px;
height:24px;padding:0 4px;font:inherit;margin-left:4px;cursor:default}
[hidden]{display:none!important}
.narrow #volume,.narrow #time{display:none}
</style></head><body>
<div id="top" class="ui">
<div id="drag"><span id="title"></span></div>
<button id="back" title="Voltar para a guia (Esc)" aria-label="Voltar para a guia">${icon("tab")}</button>
<button id="close" title="Fechar e pausar" aria-label="Fechar e pausar">${icon("close")}</button>
</div>
<div id="stage" aria-hidden="true"></div>
<div id="bottom" class="ui">
<input id="seek" type="range" min="0" max="0" step="0.1" value="0" aria-label="Posição do vídeo">
<div id="row">
<button id="play" title="Reproduzir (Espaço)" aria-label="Reproduzir"><span id="playIcon">${icon("play")}</span><span id="pauseIcon" hidden>${icon("pause")}</span></button>
<button id="rew" title="Voltar 10 s (←)" aria-label="Voltar 10 segundos">${icon("back10")}</button>
<button id="fwd" title="Avançar 10 s (→)" aria-label="Avançar 10 segundos">${icon("fwd10")}</button>
<span id="time">0:00 / 0:00</span>
<span id="spacer"></span>
<button id="mute" title="Sem som (M)" aria-label="Sem som"><span id="soundIcon">${icon("volume")}</span><span id="mutedIcon" hidden>${icon("muted")}</span></button>
<input id="volume" type="range" min="0" max="1" step="0.05" value="1" aria-label="Volume">
<select id="rate" title="Velocidade" aria-label="Velocidade">${rates}</select>
<select id="quality" title="Qualidade" aria-label="Qualidade" hidden></select>
</div>
</div>
<script>
(() => {
  const api = window.agzosVideo;
  const $ = (id) => document.getElementById(id);
  const run = (type, extra) => api && api.run(Object.assign({ type }, extra || {}));
  let state = { paused: true, time: 0, duration: 0, volume: 1, muted: false, rate: 1 };
  let seeking = false;
  let idleTimer = 0;
  const clock = (seconds) => {
    const total = Math.max(0, Math.floor(seconds || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = String(total % 60).padStart(2, "0");
    return h ? h + ":" + String(m).padStart(2, "0") + ":" + s : m + ":" + s;
  };
  const wake = () => {
    document.body.classList.remove("idle");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!seeking && !document.querySelector("select:focus")) document.body.classList.add("idle");
    }, ${BAR_TIMEOUT_MS});
  };
  document.addEventListener("mousemove", wake);
  document.addEventListener("mousedown", wake);
  document.addEventListener("mouseleave", () => {
    if (!seeking) document.body.classList.add("idle");
  });
  $("stage").onclick = () => run("toggle");
  $("play").onclick = () => run("toggle");
  $("rew").onclick = () => run("seek", { by: -10 });
  $("fwd").onclick = () => run("seek", { by: 10 });
  $("mute").onclick = () => run("mute");
  $("back").onclick = () => run("back");
  $("close").onclick = () => run("close");
  $("seek").oninput = () => {
    seeking = true;
    $("time").textContent = clock(Number($("seek").value)) + " / " + clock(state.duration);
  };
  $("seek").onchange = () => {
    run("seek-to", { time: Number($("seek").value) });
    seeking = false;
  };
  $("volume").oninput = () => run("volume", { value: Number($("volume").value) });
  $("rate").onchange = () => run("rate", { value: Number($("rate").value) });
  $("quality").onchange = () => run("quality", { value: $("quality").value });
  document.addEventListener("keydown", (event) => {
    if (event.target && event.target.tagName === "SELECT") return;
    const key = event.key;
    let handled = true;
    if (key === " " || key === "k" || key === "K") run("toggle");
    else if (key === "ArrowLeft" || key === "j" || key === "J") run("seek", { by: -10 });
    else if (key === "ArrowRight" || key === "l" || key === "L") run("seek", { by: 10 });
    else if (key === "ArrowUp") run("volume", { value: Math.min(1, (state.muted ? 0 : state.volume) + 0.1) });
    else if (key === "ArrowDown") run("volume", { value: Math.max(0, state.volume - 0.1) });
    else if (key === "m" || key === "M") run("mute");
    else if (key === "Escape") run("back");
    else handled = false;
    if (handled) {
      event.preventDefault();
      wake();
    }
  });
  const resize = () => document.body.classList.toggle("narrow", innerWidth < 380);
  addEventListener("resize", resize);
  resize();
  api && api.onState((next) => {
    if (!next) return;
    state = next;
    document.title = next.title || "Janela de vídeo";
    $("title").textContent = next.title || "";
    $("playIcon").hidden = !next.paused;
    $("pauseIcon").hidden = next.paused;
    $("play").title = next.paused ? "Reproduzir (Espaço)" : "Pausar (Espaço)";
    $("play").setAttribute("aria-label", next.paused ? "Reproduzir" : "Pausar");
    const silent = next.muted || next.volume === 0;
    $("soundIcon").hidden = silent;
    $("mutedIcon").hidden = !silent;
    $("mute").setAttribute("aria-label", silent ? "Ligar o som" : "Sem som");
    $("volume").value = String(next.muted ? 0 : next.volume);
    if (!seeking) {
      $("seek").max = String(next.duration || 0);
      $("seek").value = String(next.time || 0);
      $("time").textContent = clock(next.time) + " / " + clock(next.duration);
    }
    $("seek").disabled = !next.duration;
    $("rate").value = String(next.rate);
    const quality = $("quality");
    if (next.quality) {
      const wanted = next.quality.levels.map((level) => level.value).join(",");
      if (quality.dataset.levels !== wanted) {
        quality.dataset.levels = wanted;
        quality.replaceChildren(...next.quality.levels.map((level) => {
          const option = document.createElement("option");
          option.value = level.value;
          option.textContent = level.label;
          return option;
        }));
      }
      if (document.activeElement !== quality) quality.value = next.quality.current;
      quality.hidden = false;
    } else quality.hidden = true;
  });
  wake();
})();
</script></body></html>`;
}

module.exports = {
  QUALITY_LABELS,
  RATES,
  commandInPage,
  controlsHtml,
  initialBounds,
  isolateInPage,
  overlayState,
  pageScript,
  restoreInPage,
  stateInPage,
  videoCommand,
};

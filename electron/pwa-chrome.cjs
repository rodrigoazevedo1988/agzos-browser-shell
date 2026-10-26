// Barra do app (4.8.5): as funções do navegador dentro da janela de um PWA, como no Chrome.
// Regras puras: cores da barra a partir do theme_color, a página da barra (sem dados do
// site: o main manda o estado pelo preload) e o menu ⋮ como dados (o main liga as ações).

const BAR_HEIGHT = 34;

/** Tipos de permissão que o menu do app mostra, na ordem e com o nome da tela. */
const PERMISSION_TYPES = [
  ["camera", "Câmera"],
  ["microphone", "Microfone"],
  ["notifications", "Notificações"],
  ["geolocation", "Localização"],
  ["clipboard-read", "Área de transferência"],
];
const PERMISSION_VALUES = [
  ["ask", "Perguntar"],
  ["allow", "Permitir"],
  ["block", "Bloquear"],
];

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function rgbOf(hex) {
  if (typeof hex !== "string" || !HEX_RE.test(hex.trim())) return null;
  let text = hex.trim().slice(1);
  if (text.length === 3) text = [...text].map((c) => c + c).join("");
  return [0, 2, 4].map((at) => parseInt(text.slice(at, at + 2), 16));
}

/** Luminância relativa (WCAG) de uma cor rgb. */
function luminance([r, g, b]) {
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * Cores da barra: o theme_color do app (ou o da página) com texto claro ou escuro, o que
 * contrastar mais. Sem cor válida, cinza neutro do tema do sistema.
 */
function barColors(themeColor, dark = false) {
  const rgb = rgbOf(themeColor);
  if (!rgb) {
    return dark
      ? { background: "#202124", foreground: "#e8eaed", hover: "rgba(255,255,255,0.12)" }
      : { background: "#f1f3f4", foreground: "#202124", hover: "rgba(0,0,0,0.08)" };
  }
  const light = luminance(rgb);
  // Contraste com branco (1.05/(L+.05)) contra preto ((L+.05)/.05): escolhe o maior.
  const whiteText = 1.05 / (light + 0.05) >= (light + 0.05) / 0.05;
  const background = `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  return whiteText
    ? { background, foreground: "#ffffff", hover: "rgba(255,255,255,0.18)" }
    : { background, foreground: "#202124", hover: "rgba(0,0,0,0.10)" };
}

/**
 * A barra do app é a barra de título (como no PWA do Chrome): sem a faixa nativa com o
 * mesmo título em cima. No macOS os semáforos entram na barra, à esquerda; no Windows e
 * no Linux os botões nativos ficam por cima dela, à direita (titleBarOverlay), e a página
 * da barra reserva o espaço pelo env(titlebar-area-*).
 */
function windowFrame(platform, colors = barColors(null)) {
  if (platform === "darwin") {
    return {
      options: {
        titleBarStyle: "hidden",
        trafficLightPosition: { x: 12, y: Math.round((BAR_HEIGHT - 16) / 2) },
      },
      insetLeft: 78,
      insetRight: 0,
    };
  }
  return {
    options: { titleBarStyle: "hidden", titleBarOverlay: titleBarOverlay(colors) },
    insetLeft: 0,
    insetRight: OVERLAY_BUTTONS_WIDTH,
  };
}

/** Largura dos botões nativos (minimizar, maximizar, fechar) à direita, no Windows/Linux. */
const OVERLAY_BUTTONS_WIDTH = 138;

/** Cores dos botões nativos (Windows/Linux) iguais às da barra. */
function titleBarOverlay(colors) {
  return { color: colors.background, symbolColor: colors.foreground, height: BAR_HEIGHT };
}

/** Host para mostrar (sem "www."), ou "" se não for web. */
function hostLabel(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Origem web (https://site:porta) do endereço, ou null. */
function webOrigin(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

/** Nível de zoom do Chromium (0 = 100%) em porcentagem inteira. */
function zoomPercent(level) {
  const value = Number(level);
  return Math.round(100 * 1.2 ** (Number.isFinite(value) ? value : 0));
}

/**
 * Menu ⋮ do app como dados. Cada item com `action` vira um clique no main; `checked` marca
 * caixa/rádio. `permissions` é { tipo: "ask" | "allow" | "block" } da origem mostrada.
 */
function appMenuSpec(state = {}) {
  const items = [
    { action: "copy-url", label: "Copiar URL" },
    { action: "open-browser", label: "Abrir no Agzos Browser" },
    { type: "separator" },
    {
      action: "pip",
      label: state.pip ? "Sair do Picture-in-Picture" : "Picture-in-Picture",
      accelerator: "CmdOrCtrl+Shift+P",
    },
    {
      action: "auto-pip",
      label: "Picture-in-Picture ao minimizar",
      type: "checkbox",
      checked: state.autoPip === true,
    },
    { type: "separator" },
    {
      label: `Zoom (${zoomPercent(state.zoom)}%)`,
      submenu: [
        { action: "zoom-in", label: "Aumentar", accelerator: "CmdOrCtrl+=" },
        { action: "zoom-out", label: "Diminuir", accelerator: "CmdOrCtrl+-" },
        { action: "zoom-reset", label: "Tamanho original", accelerator: "CmdOrCtrl+0" },
      ],
    },
    { action: "find", label: "Localizar…", accelerator: "CmdOrCtrl+F" },
    { action: "print", label: "Imprimir…", accelerator: "CmdOrCtrl+P" },
    {
      action: "fullscreen",
      label: "Tela cheia",
      type: "checkbox",
      checked: Boolean(state.fullScreen),
      accelerator: "F11",
    },
    { type: "separator" },
  ];
  if (state.origin) {
    const host = hostLabel(state.origin);
    items.push({
      label: `Permissões de ${host}`,
      submenu: PERMISSION_TYPES.map(([type, label]) => ({
        label,
        submenu: PERMISSION_VALUES.map(([value, text]) => ({
          action: `perm:${type}:${value}`,
          label: text,
          type: "radio",
          checked: (state.permissions?.[type] ?? "ask") === value,
        })),
      })),
    });
  }
  if (state.devtools !== false) {
    items.push({
      action: "devtools",
      label: "Ferramentas do desenvolvedor",
      accelerator: "CmdOrCtrl+Shift+I",
    });
  }
  if (state.canUninstall) {
    items.push(
      { type: "separator" },
      { action: "uninstall", label: `Desinstalar ${state.name ?? "app"}…` },
    );
  }
  return items;
}

/** Ação de permissão do menu ("perm:camera:block") → { type, value } ou null. */
function permissionAction(action) {
  const match = /^perm:([a-z-]+):(ask|allow|block)$/.exec(String(action ?? ""));
  if (!match || !PERMISSION_TYPES.some(([type]) => type === match[1])) return null;
  return { type: match[1], value: match[2] };
}

const BAR_ACTIONS = new Set([
  "back",
  "forward",
  "reload",
  "stop",
  "menu",
  "pip",
  "zoom-reset",
  "open-browser",
  "find",
  "find-close",
]);

/** Valida o que a barra manda (ação conhecida, coordenadas e texto da busca). */
function barAction(payload) {
  if (!payload || typeof payload !== "object" || !BAR_ACTIONS.has(payload.action)) return null;
  const action = { action: payload.action };
  if (payload.action === "menu") {
    const x = Number(payload.x);
    const y = Number(payload.y);
    action.x = Number.isFinite(x) ? Math.max(0, Math.round(x)) : 0;
    action.y = Number.isFinite(y) ? Math.max(0, Math.round(y)) : BAR_HEIGHT;
  }
  if (payload.action === "find") {
    action.text = typeof payload.text === "string" ? payload.text.slice(0, 500) : "";
    action.forward = payload.forward !== false;
    action.next = Boolean(payload.next);
  }
  return action;
}

const ICONS = {
  back: '<path d="M15 6l-6 6 6 6"/>',
  forward: '<path d="M9 6l6 6-6 6"/>',
  reload: '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/>',
  stop: '<path d="M6 6l12 12M18 6L6 18"/>',
  pip: '<rect x="3" y="5" width="18" height="14" rx="2"/><rect x="12" y="12" width="7" height="5" rx="1"/>',
  more: '<circle cx="12" cy="5.5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="18.5" r="1.4"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
};

/**
 * Página da barra. Sem dado do site no HTML: o estado chega por agzosPwaBar.onState e vira
 * texto (textContent), nunca HTML. Os ícones são fixos.
 */
function barHtml() {
  const icon = (name) =>
    `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>Agzos</title>
<style>
:root{--bg:#f1f3f4;--fg:#202124;--hover:rgba(0,0,0,.08);color-scheme:light dark}
*{box-sizing:border-box}
html,body{margin:0;height:${BAR_HEIGHT}px;overflow:hidden;background:var(--bg);color:var(--fg);
font:13px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;user-select:none}
#bar{display:flex;align-items:center;gap:2px;height:${BAR_HEIGHT}px;padding:0 4px;
width:env(titlebar-area-width,calc(100% - var(--inset-right,0px)))}
/* Só o espaço dos semáforos e o do título arrastam a janela; os botões ficam fora de
   qualquer área de arrasto (no macOS um no-drag dentro de drag engolia o clique). */
#lights{flex:none;width:var(--inset-left,0px);align-self:stretch;-webkit-app-region:drag}
#info{-webkit-app-region:drag}
button{all:unset;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;
border-radius:6px;color:inherit;cursor:default;flex:none}
button:hover:not(:disabled){background:var(--hover)}
button:focus-visible{outline:2px solid currentColor;outline-offset:-2px}
button:disabled{opacity:.35}
svg{width:16px;height:16px}
#more svg{fill:currentColor;stroke:none}
#info{flex:1;min-width:0;display:flex;align-items:center;gap:8px;padding:0 6px}
#title{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-weight:500}
#host{flex:none;padding:3px 8px;border-radius:10px;background:var(--hover);cursor:default}
[hidden]{display:none!important}
#reload span{display:inline-flex}
#zoom{width:auto;padding:0 8px;font-variant-numeric:tabular-nums}
#find{flex:1;display:flex;align-items:center;gap:2px;min-width:0;padding:0 4px}
#find input{flex:1;min-width:60px;height:24px;border:1px solid var(--hover);border-radius:6px;
padding:0 8px;background:rgba(255,255,255,.9);color:#202124;font:inherit;outline:none}
#find input:focus{border-color:currentColor}
#count{min-width:48px;text-align:center;opacity:.8;font-variant-numeric:tabular-nums}
.on{background:var(--hover)}
</style></head><body>
<div id="bar" role="toolbar" aria-label="Barra do app">
<div id="lights"></div>
<button id="back" title="Voltar" aria-label="Voltar">${icon("back")}</button>
<button id="forward" title="Avançar" aria-label="Avançar">${icon("forward")}</button>
<button id="reload" title="Recarregar" aria-label="Recarregar"><span id="reloadIcon">${icon("reload")}</span><span id="stopIcon" hidden>${icon("stop")}</span></button>
<div id="info"><span id="title"></span></div>
<span id="host" hidden title="Fora do app: clique para abrir no navegador"></span>
<div id="find" hidden role="search">
<input id="query" type="text" placeholder="Localizar na página" aria-label="Localizar na página" spellcheck="false">
<span id="count" aria-live="polite"></span>
<button id="prev" title="Anterior" aria-label="Anterior">${icon("up")}</button>
<button id="next" title="Próximo" aria-label="Próximo">${icon("down")}</button>
<button id="close" title="Fechar busca" aria-label="Fechar busca">${icon("close")}</button>
</div>
<button id="zoom" hidden title="Voltar ao tamanho original"></button>
<button id="pip" title="Picture-in-Picture (Ctrl+Shift+P)" aria-label="Picture-in-Picture">${icon("pip")}</button>
<button id="more" title="Funções do navegador" aria-label="Funções do navegador" aria-haspopup="menu">${icon("more")}</button>
</div>
<script>
(() => {
  const api = window.agzosPwaBar;
  const $ = (id) => document.getElementById(id);
  const run = (action, extra) => api && api.run(Object.assign({ action }, extra || {}));
  let state = {};
  let findOpen = false;
  $("back").onclick = () => run("back");
  $("forward").onclick = () => run("forward");
  $("reload").onclick = () => run(state.loading ? "stop" : "reload");
  $("pip").onclick = () => run("pip");
  $("zoom").onclick = () => run("zoom-reset");
  $("host").onclick = () => run("open-browser");
  $("more").onclick = () => {
    const box = $("more").getBoundingClientRect();
    run("menu", { x: box.left, y: box.bottom });
  };
  const search = (forward, next) =>
    run("find", { text: $("query").value, forward, next });
  $("query").oninput = () => search(true, false);
  $("query").onkeydown = (event) => {
    if (event.key === "Enter") search(!event.shiftKey, true);
    else if (event.key === "Escape") run("find-close");
  };
  $("prev").onclick = () => search(false, true);
  $("next").onclick = () => search(true, true);
  $("close").onclick = () => run("find-close");
  api && api.onState((next) => {
    state = next || {};
    const root = document.documentElement.style;
    root.setProperty("--bg", state.colors && state.colors.background || "#f1f3f4");
    root.setProperty("--fg", state.colors && state.colors.foreground || "#202124");
    root.setProperty("--hover", state.colors && state.colors.hover || "rgba(0,0,0,.08)");
    root.setProperty("--inset-left", (state.fullScreen ? 0 : Number(state.insetLeft) || 0) + "px");
    root.setProperty("--inset-right", (state.fullScreen ? 0 : Number(state.insetRight) || 0) + "px");
    $("back").disabled = !state.canGoBack;
    $("forward").disabled = !state.canGoForward;
    $("reloadIcon").hidden = Boolean(state.loading);
    $("stopIcon").hidden = !state.loading;
    $("reload").title = state.loading ? "Parar" : "Recarregar";
    $("title").textContent = state.title || state.name || "";
    $("host").textContent = state.host || "";
    $("host").hidden = !state.offScope || !state.host;
    $("zoom").hidden = !state.zoom || state.zoom === 100;
    $("zoom").textContent = (state.zoom || 100) + "%";
    $("pip").classList.toggle("on", Boolean(state.pip));
    $("pip").setAttribute("aria-pressed", String(Boolean(state.pip)));
    const find = state.find || {};
    $("info").hidden = Boolean(find.open);
    $("find").hidden = !find.open;
    $("count").textContent = find.open && $("query").value
      ? (find.matches ? find.active + "/" + find.matches : "0/0")
      : "";
    if (find.open && !findOpen) {
      $("query").focus();
      $("query").select();
    }
    findOpen = Boolean(find.open);
  });
})();
</script></body></html>`;
}

module.exports = {
  BAR_HEIGHT,
  titleBarOverlay,
  windowFrame,
  PERMISSION_TYPES,
  appMenuSpec,
  barAction,
  barColors,
  barHtml,
  hostLabel,
  permissionAction,
  webOrigin,
  zoomPercent,
};

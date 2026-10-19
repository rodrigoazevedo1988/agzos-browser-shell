// Abertura (splash): a vinheta do logo do Agzos ao abrir o navegador, no espírito da do
// Opera GX. Nunca segura a janela principal: ela abre e aparece como sempre, e a vinheta
// fica por cima até a casca estar pronta e o tempo mínimo da animação passar (com um teto,
// se a casca demorar). Só no primeiro início normal: nada no modo app de PWA, no atalho
// de PWA, em segunda instância nem nos testes. A página é um data: autocontido (sem URL
// remota, sem Node, contextIsolation e sandbox), com o símbolo do logo embutido.

const MIN_MS = 1700;
const MAX_MS = 4000;
const FADE_MS = 280;
const WIDTH = 560;
const HEIGHT = 340;

/** Argumentos de quem abre outra coisa que não o navegador (atalho de PWA, link de PWA). */
const NON_BROWSER_ARGS = ["--agzos-pwa=", "--agzos-open="];

/**
 * Mostra a vinheta? Não no modo app de PWA, não em lançamentos de PWA ou de link vindo do
 * app de um PWA, não com AGZOS_NO_SPLASH e não quando um teste roda (AGZOS_USER_DATA ou
 * qualquer AGZOS_TEST_*: o Playwright pegaria a vinheta como primeira janela).
 */
function shouldShowSplash({ env = {}, argv = [], pwaHost = null, disabled = false } = {}) {
  if (pwaHost || disabled) return false;
  if (env.AGZOS_NO_SPLASH || env.AGZOS_USER_DATA) return false;
  if (Object.keys(env).some((key) => key.startsWith("AGZOS_TEST_"))) return false;
  return !argv.some(
    (arg) => typeof arg === "string" && NON_BROWSER_ARGS.some((p) => arg.startsWith(p)),
  );
}

/**
 * Quando começar a sumir (ms desde a época): a casca pronta e o mínimo da animação
 * cumprido; sem casca pronta, o teto. Nunca passa do teto.
 */
function closeAt({ shownAt, readyAt = null, minMs = MIN_MS, maxMs = MAX_MS }) {
  const ceiling = shownAt + maxMs;
  if (readyAt == null) return ceiling;
  return Math.min(Math.max(readyAt, shownAt + minMs), ceiling);
}

// Símbolo do logo (public/favicon.svg), em vermelho Agzos.
const MARK = `<svg viewBox="0 0 305 287" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<path d="M277.023 143.111C277.023 215.939 226.055 281.111 154.356 281.111C230.571 281.111 299.001 219.326 299.001 143.111C299.001 66.8958 230.571 5.11111 154.356 5.11111C226.055 5.11111 277.023 70.2832 277.023 143.111Z" fill="#D10A11"/>
<path class="trace" d="M154.356 281.111C226.055 281.111 277.023 215.939 277.023 143.111C277.023 70.2832 226.055 5.11111 154.356 5.11111M154.356 281.111C82.2746 281.111 23.3547 228.886 17.1477 158.417M154.356 281.111C230.571 281.111 299.001 219.326 299.001 143.111C299.001 66.8958 230.571 5.11111 154.356 5.11111M154.356 5.11111C114.617 5.11111 78.8014 21.908 53.6211 48.7894C52.4194 50.0723 53.3452 52.1333 55.1031 52.1333H82.0964H213.358C215.066 52.1333 216.021 54.1032 214.963 55.444L84.7081 220.556C83.6504 221.897 84.6054 223.867 86.3132 223.867H229.203C230.798 223.867 231.779 222.122 230.95 220.76L150.442 88.41C149.693 87.178 147.938 87.0881 147.067 88.2371L109.1 138.304M109.1 138.304C104.186 134.506 97.1244 135.41 93.3265 140.323C89.5286 145.237 90.4328 152.299 95.3462 156.097C100.26 159.894 107.322 158.99 111.12 154.077C114.917 149.163 114.013 142.101 109.1 138.304ZM17.1477 158.417C23.3424 157.979 28.0099 152.603 27.5728 146.409C27.1357 140.214 21.7596 135.546 15.5648 135.983C9.3701 136.421 4.7026 141.797 5.13968 147.991C5.57677 154.186 10.9529 158.854 17.1477 158.417Z" stroke="#D10A11" stroke-width="10.2222" pathLength="1"/>
</svg>`;

/** A página da vinheta: CSS para o logo e a barra, um canvas leve para as partículas. */
function splashHtml({ minMs = MIN_MS } = {}) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">
<title>Agzos Browser</title>
<style>
:root{--red:#d10a11;--hot:#ff2a3a;--bg:#07070a;--dur:${minMs}ms}
*{box-sizing:border-box;margin:0}
html,body{height:100%;background:var(--bg);overflow:hidden;cursor:default;user-select:none;
font-family:"Segoe UI",system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif;color:#f2f2f4}
body{display:grid;place-items:center;transition:opacity ${FADE_MS}ms ease}
html.out body{opacity:0}
.frame{position:fixed;inset:0;border:1px solid rgba(209,10,17,.35);
background:radial-gradient(ellipse at 50% 42%,rgba(209,10,17,.20),transparent 62%),
linear-gradient(180deg,#0c0c11,#050507)}
.grid{position:fixed;inset:-40% -10% 0;opacity:.18;transform:perspective(320px) rotateX(62deg);
transform-origin:50% 100%;background-image:linear-gradient(rgba(255,42,58,.6) 1px,transparent 1px),
linear-gradient(90deg,rgba(255,42,58,.6) 1px,transparent 1px);background-size:34px 34px;
animation:grid 1.6s linear infinite;-webkit-mask-image:linear-gradient(transparent 40%,#000)}
@keyframes grid{to{background-position:0 34px}}
canvas{position:fixed;inset:0;width:100%;height:100%}
.scan{position:fixed;left:0;right:0;height:38%;top:-40%;
background:linear-gradient(180deg,transparent,rgba(255,42,58,.12) 70%,rgba(255,90,100,.45) 99%,transparent);
animation:scan calc(var(--dur) * .8) cubic-bezier(.6,0,.3,1) .15s forwards}
@keyframes scan{to{top:110%}}
.lines{position:fixed;inset:0;pointer-events:none;
background:repeating-linear-gradient(0deg,rgba(0,0,0,.22) 0 1px,transparent 1px 3px)}
main{position:relative;display:grid;justify-items:center;gap:18px}
.mark{width:112px;height:106px;position:relative;
animation:in calc(var(--dur) * .45) cubic-bezier(.2,1.4,.4,1) both,
pulse 1.1s ease-in-out calc(var(--dur) * .45) infinite alternate}
.mark svg{width:100%;height:100%;overflow:visible;
filter:drop-shadow(0 0 6px var(--red)) drop-shadow(0 0 22px rgba(209,10,17,.75))}
.mark .trace{stroke-dasharray:1;stroke-dashoffset:1;animation:trace calc(var(--dur) * .5) ease-out .1s forwards}
.mark::after{content:"";position:absolute;inset:-34px;border-radius:50%;
border:2px solid rgba(255,42,58,.55);opacity:0;animation:ring calc(var(--dur) * .5) ease-out calc(var(--dur) * .3) forwards}
@keyframes in{from{transform:scale(.35) rotate(-12deg);opacity:0;filter:blur(8px)}
60%{opacity:1;filter:blur(0)}to{transform:scale(1) rotate(0);opacity:1}}
@keyframes trace{to{stroke-dashoffset:0}}
@keyframes pulse{to{filter:brightness(1.35)}}
@keyframes ring{0%{opacity:.9;transform:scale(.6)}100%{opacity:0;transform:scale(1.5)}}
h1{font-size:26px;font-weight:800;letter-spacing:.32em;text-transform:uppercase;padding-left:.32em;white-space:nowrap;
text-shadow:0 0 12px rgba(255,42,58,.65);animation:word calc(var(--dur) * .3) ease-out calc(var(--dur) * .22) both}
h1 span{color:var(--hot)}
@keyframes word{from{opacity:0;transform:scaleX(1.35);filter:blur(6px)}to{opacity:1;transform:none}}
.bar{width:220px;height:3px;border-radius:3px;background:rgba(255,255,255,.08);overflow:hidden;
box-shadow:0 0 10px rgba(209,10,17,.35)}
.bar i{display:block;height:100%;width:100%;transform-origin:0 50%;transform:scaleX(0);
background:linear-gradient(90deg,var(--red),var(--hot),#fff);box-shadow:0 0 12px var(--hot);
animation:fill var(--dur) cubic-bezier(.3,.6,.2,1) forwards}
@keyframes fill{to{transform:scaleX(1)}}
@media (prefers-reduced-motion:reduce){
*,*::before,*::after{animation:none!important}
.mark .trace{stroke-dashoffset:0}.bar i{transform:scaleX(1)}.scan,canvas{display:none}
body{transition-duration:120ms}}
</style></head><body>
<div class="frame"></div><div class="grid"></div><canvas id="fx"></canvas><div class="scan"></div>
<main><div class="mark">${MARK}</div><h1>Agzos <span>Browser</span></h1><div class="bar"><i></i></div></main>
<div class="lines"></div>
<script>
(() => {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const c = document.getElementById("fx"), g = c.getContext("2d");
  const r = devicePixelRatio || 1;
  c.width = innerWidth * r; c.height = innerHeight * r; g.scale(r, r);
  const w = innerWidth, h = innerHeight;
  const ps = Array.from({ length: 46 }, () => ({
    x: Math.random() * w, y: h * (0.4 + Math.random() * 0.7),
    v: 0.3 + Math.random() * 1.1, s: 0.6 + Math.random() * 1.8, a: Math.random(),
  }));
  const end = performance.now() + 5000;
  const tick = (t) => {
    g.clearRect(0, 0, w, h);
    for (const p of ps) {
      p.y -= p.v; p.a += 0.02;
      if (p.y < -4) { p.y = h + 4; p.x = Math.random() * w; }
      g.globalAlpha = 0.35 + Math.abs(Math.sin(p.a)) * 0.55;
      g.fillStyle = p.s > 1.8 ? "#ff6670" : "#d10a11";
      g.fillRect(p.x, p.y, p.s, p.s * 2.4);
    }
    if (t < end) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();
</script></body></html>`;
}

/**
 * Abre a vinheta e devolve { follow(window), close() }. `follow` liga a vinheta à janela
 * principal: some quando ela estiver pronta (ready-to-show) e o mínimo passar; sem
 * janela, some na hora. O teto vale sempre, mesmo se `follow` nunca vier.
 */
function openSplash({ BrowserWindow, icon, minMs = MIN_MS, maxMs = MAX_MS, now = Date.now }) {
  let win = null;
  try {
    win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      center: true,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: false,
      show: false,
      title: "Agzos Browser",
      backgroundColor: "#07070a",
      ...(icon ? { icon } : {}),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        devTools: false,
        spellcheck: false,
      },
    });
  } catch {
    return { follow() {}, close() {}, closed: Promise.resolve() };
  }
  // Resolve quando a vinheta some de vez (o modal "Escolha uma conta" espera por isso).
  const closed = new Promise((resolve) => win.once("closed", () => resolve()));
  const shownAt = now();
  let readyAt = null;
  let timer = null;
  let closing = false;
  const alive = () => win && !win.isDestroyed();
  const contents = win.webContents;
  contents.on("will-navigate", (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.once("ready-to-show", () => {
    if (alive() && !closing) win.showInactive();
  });
  void win
    .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml({ minMs }))}`)
    .catch(() => {});

  const close = () => {
    if (closing) return;
    closing = true;
    clearTimeout(timer);
    if (!alive()) return;
    if (!win.isVisible()) {
      win.destroy();
      return;
    }
    void contents
      .executeJavaScript("document.documentElement.classList.add('out')", true)
      .catch(() => {});
    setTimeout(() => {
      if (alive()) win.destroy();
    }, FADE_MS + 40).unref?.();
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(close, Math.max(0, closeAt({ shownAt, readyAt, minMs, maxMs }) - now()));
    timer.unref?.();
  };
  schedule();

  return {
    follow(main) {
      if (!main || main.isDestroyed()) {
        close();
        return;
      }
      const ready = () => {
        readyAt = now();
        if (!closing) schedule();
      };
      if (main.isVisible()) ready();
      else main.once("ready-to-show", ready);
      main.once("closed", close);
    },
    close,
    closed,
  };
}

module.exports = { MIN_MS, MAX_MS, FADE_MS, shouldShowSplash, closeAt, splashHtml, openSplash };

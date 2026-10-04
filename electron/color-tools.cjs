// ColorTools (4.7). Conta-gotas: o main tira a foto da área da guia (compositor) e mostra
// numa camada por cima dela, com lupa e HEX/RGB/HSL ao vivo; o clique escolhe, Esc
// cancela. A camada é uma página data: do próprio app (sem preload): ela avisa o main
// pelo título ("agzos-pick:#rrggbb" ou "agzos-pick:cancel"). Analisador: script no mundo
// isolado COLOR_WORLD que só lê estilos computados, em blocos no requestIdleCallback.
// Nada vai para servidor; canvas de outra origem nunca é lido (a foto é do compositor).

const COLOR_WORLD = 4135;
const ANALYZE_LIMIT = 2000;

function hexOf({ r, g, b }) {
  return `#${[r, g, b].map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
}

/** Pixel BGRA (NativeImage.toBitmap) → { r, g, b }. */
function rgbOfBitmap(bitmap, offset = 0) {
  return { r: bitmap[offset + 2], g: bitmap[offset + 1], b: bitmap[offset] };
}

/** Título que a camada usa para responder (null: não é resposta). */
function pickOfTitle(title) {
  const match = /^agzos-pick:(?:(cancel)|#([0-9a-f]{6}))$/i.exec(String(title || ""));
  if (!match) return null;
  if (match[1]) return { cancel: true };
  const value = parseInt(match[2], 16);
  return {
    cancel: false,
    color: { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 },
  };
}

const PICKER_PAGE =
  "data:text/html;charset=utf-8," +
  encodeURIComponent(`<!doctype html><meta charset="utf-8"><title>agzos-pick</title><style>
html,body{margin:0;height:100%;overflow:hidden;cursor:crosshair;background:#000;user-select:none}
#shot{position:fixed;inset:0;width:100%;height:100%}
#loupe{position:fixed;width:132px;height:132px;border-radius:50%;overflow:hidden;pointer-events:none;
box-shadow:0 0 0 2px #fff,0 0 0 3px rgba(0,0,0,.45),0 8px 24px rgba(0,0,0,.35);display:none}
#zoom{width:132px;height:132px;image-rendering:pixelated}
#cross{position:absolute;left:61px;top:61px;width:10px;height:10px;box-sizing:border-box;border:1.5px solid #fff;outline:1px solid rgba(0,0,0,.6)}
#info{position:fixed;padding:7px 9px;border-radius:8px;pointer-events:none;display:none;
font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:rgba(24,24,27,.94);color:#fafafa;
border:1px solid rgba(255,255,255,.14);white-space:nowrap}
.light #info{background:rgba(250,250,250,.97);color:#18181b;border-color:rgba(0,0,0,.12)}
#sw{display:inline-block;width:12px;height:12px;border-radius:3px;vertical-align:-2px;margin-right:6px;border:1px solid rgba(127,127,127,.6)}
#hint{position:fixed;left:50%;top:12px;transform:translateX(-50%);padding:6px 12px;border-radius:999px;
font:12px system-ui,-apple-system,"Segoe UI",sans-serif;background:rgba(24,24,27,.9);color:#fafafa;pointer-events:none}
</style><body><canvas id="shot"></canvas><div id="loupe"><canvas id="zoom" width="132" height="132"></canvas><div id="cross"></div></div>
<div id="info"><span id="sw"></span><b id="hex"></b><br><span id="rgb"></span><br><span id="hsl"></span></div>
<div id="hint">Clique para copiar a cor · Esc cancela</div>
<script>
const shot = document.getElementById("shot"), zoom = document.getElementById("zoom");
const loupe = document.getElementById("loupe"), info = document.getElementById("info");
const ctx = shot.getContext("2d", { willReadFrequently: true }), zctx = zoom.getContext("2d");
let ready = false, scale = 1, last = null;
const hex = (c) => "#" + [c[0], c[1], c[2]].map((v) => v.toString(16).padStart(2, "0")).join("");
const hsl = (c) => { const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255; const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2; const d = max - min;
  if (d) { s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; }
  return "hsl(" + Math.round(h) + ", " + Math.round(s * 100) + "%, " + Math.round(l * 100) + "%)"; };
window.__agzosLoad = (url, s, light) => new Promise((done) => {
  document.body.className = light ? "light" : "";
  scale = s; const img = new Image();
  img.onload = () => { shot.width = img.naturalWidth; shot.height = img.naturalHeight; ctx.drawImage(img, 0, 0); ready = true; done(true); };
  img.onerror = () => done(false); img.src = url; });
const sample = (x, y) => { const px = Math.min(shot.width - 1, Math.max(0, Math.round(x * scale))), py = Math.min(shot.height - 1, Math.max(0, Math.round(y * scale)));
  return ctx.getImageData(px, py, 1, 1).data; };
addEventListener("mousemove", (e) => { if (!ready) return; const c = sample(e.clientX, e.clientY); last = c;
  zctx.imageSmoothingEnabled = false; zctx.clearRect(0, 0, 132, 132);
  zctx.drawImage(shot, Math.round(e.clientX * scale) - 6, Math.round(e.clientY * scale) - 6, 13, 13, 0, 0, 132, 132);
  const W = innerWidth, H = innerHeight; const lx = e.clientX + 150 > W ? e.clientX - 150 : e.clientX + 18; const ly = e.clientY + 150 > H ? e.clientY - 150 : e.clientY + 18;
  loupe.style.display = info.style.display = "block"; loupe.style.left = lx + "px"; loupe.style.top = ly + "px";
  info.style.left = lx + "px"; info.style.top = (ly + 138 + 70 > H ? ly - 70 : ly + 138) + "px";
  document.getElementById("sw").style.background = hex(c); document.getElementById("hex").textContent = hex(c).toUpperCase();
  document.getElementById("rgb").textContent = "rgb(" + c[0] + ", " + c[1] + ", " + c[2] + ")"; document.getElementById("hsl").textContent = hsl(c); });
addEventListener("mousedown", (e) => { if (!ready || e.button !== 0) return; e.preventDefault(); const c = sample(e.clientX, e.clientY); document.title = "agzos-pick:" + hex(c); });
addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); document.title = "agzos-pick:cancel"; }
  if (e.key === "Enter" && last) { e.preventDefault(); document.title = "agzos-pick:" + hex(last); } });
addEventListener("contextmenu", (e) => { e.preventDefault(); document.title = "agzos-pick:cancel"; });
addEventListener("blur", () => { setTimeout(() => { if (!document.hasFocus()) document.title = "agzos-pick:cancel"; }, 150); });
</script></body>`);

/**
 * Abre o conta-gotas por cima de `bounds` (área da guia na janela). `capture()` devolve a
 * NativeImage da guia; `createView()` a WebContentsView da camada. Resolve com a cor ou
 * null (Esc, clique direito, perdeu o foco).
 */
function openColorPicker({ window, bounds, capture, createView, scaleFactor = 1, light = false }) {
  return new Promise((resolve) => {
    let view = null;
    let finished = false;
    const finish = (color) => {
      if (finished) return;
      finished = true;
      if (view && !view.webContents.isDestroyed()) {
        try {
          window.contentView.removeChildView(view);
        } catch {
          // Janela fechando.
        }
        view.webContents.close();
      }
      resolve(color);
    };
    void (async () => {
      let image;
      try {
        image = await capture();
      } catch {
        image = null;
      }
      if (!image || image.isEmpty() || window.isDestroyed()) {
        finish(null);
        return;
      }
      view = createView();
      view.setBackgroundColor("#00000000");
      view.setBounds(bounds);
      window.contentView.addChildView(view);
      const contents = view.webContents;
      contents.on("page-title-updated", (_event, title) => {
        const pick = pickOfTitle(title);
        if (pick) finish(pick.cancel ? null : pick.color);
      });
      contents.on("render-process-gone", () => finish(null));
      window.once("closed", () => finish(null));
      try {
        await contents.loadURL(PICKER_PAGE);
        const size = image.getSize();
        const scale = bounds.width ? size.width / bounds.width : scaleFactor;
        const ok = await contents.executeJavaScript(
          `window.__agzosLoad(${JSON.stringify(image.toDataURL())}, ${Number(scale) || 1}, ${light ? "true" : "false"})`,
        );
        if (!ok) {
          finish(null);
          return;
        }
        contents.focus();
      } catch {
        finish(null);
      }
    })();
  });
}

/**
 * Analisador (mundo isolado): cores computadas dos elementos visíveis (até 2000), em
 * blocos no requestIdleCallback; agrupa por frequência e guarda um seletor aproximado.
 */
function colorAnalyzeSource(limit = ANALYZE_LIMIT) {
  return `new Promise((resolve) => {
  const LIMIT = ${Number(limit) || ANALYZE_LIMIT};
  const colors = new Map();
  const parse = (value) => {
    const m = /rgba?\\(([\\d.]+)[ ,]+([\\d.]+)[ ,]+([\\d.]+)(?:[ ,/]+([\\d.]+%?))?\\)/.exec(value || "");
    if (!m) return null;
    let a = m[4] === undefined ? 1 : parseFloat(m[4]);
    if (m[4] && m[4].endsWith("%")) a = a / 100;
    if (a < 0.2) return null;
    return "#" + [m[1], m[2], m[3]].map((v) => Math.round(+v).toString(16).padStart(2, "0")).join("");
  };
  const selectorOf = (el) => {
    if (el.id && /^[\\w-]+$/.test(el.id)) return el.tagName.toLowerCase() + "#" + el.id;
    const classes = [...el.classList].filter((name) => /^[\\w-]+$/.test(name)).slice(0, 2);
    return el.tagName.toLowerCase() + classes.map((name) => "." + name).join("");
  };
  const add = (hex, el, role) => {
    if (!hex) return;
    const entry = colors.get(hex) || { hex, count: 0, selector: selectorOf(el), roles: [] };
    entry.count += 1;
    if (!entry.roles.includes(role)) entry.roles.push(role);
    colors.set(hex, entry);
  };
  const W = innerWidth, H = innerHeight;
  const nodes = document.body ? [...document.body.getElementsByTagName("*")] : [];
  let index = 0, scanned = 0;
  const idle = window.requestIdleCallback || ((fn) => setTimeout(() => fn({ timeRemaining: () => 8 }), 1));
  const step = (deadline) => {
    while (index < nodes.length && scanned < LIMIT && deadline.timeRemaining() > 1) {
      const el = nodes[index++];
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.bottom < 0 || rect.right < 0 || rect.top > H || rect.left > W) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none" || +style.opacity === 0) continue;
      scanned += 1;
      let text = false;
      for (const child of el.childNodes) if (child.nodeType === 3 && child.textContent.trim()) { text = true; break; }
      if (text) add(parse(style.color), el, "text");
      add(parse(style.backgroundColor), el, "background");
      if (parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle !== "none") add(parse(style.borderTopColor), el, "border");
    }
    if (index < nodes.length && scanned < LIMIT) idle(step);
    else resolve({ scanned, colors: [...colors.values()].sort((a, b) => b.count - a.count).slice(0, 80) });
  };
  idle(step);
})`;
}

module.exports = {
  ANALYZE_LIMIT,
  COLOR_WORLD,
  PICKER_PAGE,
  colorAnalyzeSource,
  hexOf,
  openColorPicker,
  pickOfTitle,
  rgbOfBitmap,
};

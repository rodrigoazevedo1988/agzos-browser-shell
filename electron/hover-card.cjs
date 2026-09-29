// Prévia da guia ao pausar o mouse (como a do Windows na barra de tarefas). No desktop a
// página nativa (WebContentsView) cobre tudo que a casca desenha sobre ela, então o
// cartão mora na sua própria camada: um WebContentsView transparente por janela, posto por
// cima de tudo quando aparece. Esta página é estática (data: URL, sem preload, sandbox);
// o main só chama window.render(modelo) e ela devolve a altura do cartão.

const CARD_WIDTH = 300;
const CARD_GAP = 6;
const SHADOW = 18;

const HOVER_CARD_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>agzos-preview</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; background: transparent; overflow: hidden; }
  body { padding: ${SHADOW}px; font: 12px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; }
  .card { width: ${CARD_WIDTH - SHADOW * 2}px; border-radius: 12px; overflow: hidden;
    background: #fffdfd; color: #1d1a1a; border: 1px solid rgba(0,0,0,.09);
    box-shadow: 0 12px 34px rgba(0,0,0,.24); opacity: 0; transform: translateY(-3px);
    transition: opacity .12s ease, transform .12s ease; }
  .card.show { opacity: 1; transform: none; }
  .dark .card { background: #1b1818; color: #f3eeee; border-color: rgba(255,255,255,.1); }
  .shot { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; object-position: top;
    background: #eee; border-bottom: 1px solid rgba(0,0,0,.08); }
  .dark .shot { background: #262222; border-color: rgba(255,255,255,.08); }
  .empty { display: grid; place-items: center; color: #8a8080; font-size: 11px; }
  .body { padding: 10px 12px 11px; }
  .title { font-weight: 650; font-size: 12.5px; display: -webkit-box; -webkit-line-clamp: 2;
    -webkit-box-orient: vertical; overflow: hidden; }
  .host { color: #8a8080; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .stats { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; margin-top: 8px;
    padding-top: 8px; border-top: 1px solid rgba(0,0,0,.08); }
  .dark .stats { border-color: rgba(255,255,255,.08); }
  .stats dt { color: #8a8080; }
  .stats dd { margin: 0; font-weight: 600; text-align: right; font-variant-numeric: tabular-nums; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
  .chip { padding: 1px 7px; border-radius: 999px; font-size: 10.5px; font-weight: 600;
    background: rgba(212,40,43,.1); color: #c42528; }
  .dark .chip { background: rgba(240,80,80,.16); color: #ff8a8a; }
  .chip.muted { background: rgba(0,0,0,.06); color: #6c6262; }
  .dark .chip.muted { background: rgba(255,255,255,.08); color: #bdb3b3; }
</style></head><body><div class="card" id="card"></div>
<script>
  const card = document.getElementById("card");
  const text = (tag, className, value) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = value;
    return element;
  };
  window.render = (model) => {
    document.documentElement.className = model.dark ? "dark" : "";
    card.className = "card";
    card.replaceChildren();
    if (model.image) {
      const image = document.createElement("img");
      image.className = "shot";
      image.src = model.image;
      image.alt = "";
      card.append(image);
    } else if (model.placeholder) {
      card.append(text("div", "shot empty", model.placeholder));
    }
    const body = document.createElement("div");
    body.className = "body";
    body.append(text("div", "title", model.title || "Sem título"));
    if (model.host) body.append(text("div", "host", model.host));
    if (model.stats && model.stats.length) {
      const stats = document.createElement("dl");
      stats.className = "stats";
      for (const [label, value] of model.stats) {
        stats.append(text("dt", "", label), text("dd", "", value));
      }
      body.append(stats);
    }
    if (model.chips && model.chips.length) {
      const chips = document.createElement("div");
      chips.className = "chips";
      for (const chip of model.chips) chips.append(text("span", chip.muted ? "chip muted" : "chip", chip.label));
      body.append(chips);
    }
    card.append(body);
    requestAnimationFrame(() => card.classList.add("show"));
    const images = [...card.querySelectorAll("img")];
    return Promise.all(images.map((image) => image.complete ? null : new Promise((done) => {
      image.onload = image.onerror = done;
    }))).then(() => Math.ceil(document.body.getBoundingClientRect().height));
  };
  window.hide = () => card.classList.remove("show");
</script></body></html>`;

function formatBytes(kilobytes) {
  if (!Number.isFinite(kilobytes) || kilobytes <= 0) return null;
  const megabytes = kilobytes / 1024;
  if (megabytes >= 1024) return `${(megabytes / 1024).toFixed(1).replace(".", ",")} GB`;
  return `${Math.round(megabytes)} MB`;
}

/**
 * Onde o cartão aparece: abaixo da guia (faixa horizontal) ou ao lado (barra vertical),
 * sem sair da janela. `tab` e `window` em coordenadas da janela.
 */
function cardBounds(tab, windowSize, height, side = "below") {
  const width = CARD_WIDTH;
  let x;
  let y;
  if (side === "right") {
    x = tab.x + tab.width + CARD_GAP - SHADOW;
    y = tab.y - SHADOW;
  } else {
    x = tab.x - SHADOW;
    y = tab.y + tab.height + CARD_GAP - SHADOW;
  }
  x = Math.max(0, Math.min(Math.round(x), windowSize.width - width));
  y = Math.max(0, Math.min(Math.round(y), windowSize.height - height));
  return { x, y, width, height: Math.min(Math.round(height), windowSize.height) };
}

/**
 * Linhas de números do cartão a partir das métricas do processo (app.getAppMetrics).
 * `shared`: quantas guias usam o mesmo processo (sites iguais dividem o processo).
 */
function metricRows({ memoryKB = null, cpu = null, pid = null, shared = 1 } = {}) {
  const rows = [];
  const memory = formatBytes(memoryKB);
  if (memory) rows.push(["Memória (RAM)", shared > 1 ? `${memory} (${shared} guias)` : memory]);
  if (Number.isFinite(cpu))
    rows.push(["CPU", `${cpu < 10 ? cpu.toFixed(1).replace(".", ",") : Math.round(cpu)}%`]);
  if (Number.isInteger(pid) && pid > 0) rows.push(["Processo", String(pid)]);
  return rows;
}

module.exports = {
  HOVER_CARD_HTML,
  CARD_WIDTH,
  cardBounds,
  metricRows,
  formatBytes,
};

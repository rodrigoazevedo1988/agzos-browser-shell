// Seletor do Ctrl+Tab desenhado numa camada própria, por cima da página (1.5.3).
//
// Por quê: com o foco na página, o seletor da casca obrigava a levar o foco para a casca
// (a página sumia atrás dele, e página escondida não recebe teclas). O Chromium não entrega
// o "soltar o Ctrl" a uma superfície diferente da que recebeu o "apertar", então às vezes
// só o Enter confirmava. Aqui a página continua visível e com o foco: apertar e soltar o
// Ctrl acontecem nela, e o main repassa (before-input-event) para a casca.
//
// A camada é um WebContentsView transparente com esta página estática (data:, sandbox,
// sem preload). Clicar num cartão navega para agzos-switcher://N, que o main intercepta.

const LAYER_MARGIN = 24;

const SWITCHER_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>agzos-switcher</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; background: transparent; overflow: hidden; }
  body { padding: ${LAYER_MARGIN}px; font: 12px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif; }
  .panel { display: inline-flex; flex-wrap: wrap; box-sizing: border-box; justify-content: center; gap: 14px; padding: 18px;
    border-radius: 14px; background: rgba(255,253,253,.96); color: #1d1a1a;
    border: 1px solid rgba(0,0,0,.08); box-shadow: 0 22px 65px rgba(0,0,0,.28); }
  .dark .panel { background: rgba(27,24,24,.96); color: #f3eeee; border-color: rgba(255,255,255,.1); }
  a.card { display: flex; flex-direction: column; gap: 7px; width: 184px; padding: 7px;
    border-radius: 10px; border: 2px solid transparent; color: inherit; text-decoration: none; }
  a.card.selected { border-color: #d4282b; background: rgba(212,40,43,.07); }
  .shot { width: 100%; aspect-ratio: 16 / 10; border-radius: 7px; overflow: hidden;
    background: rgba(0,0,0,.06); display: grid; place-items: center; font-size: 26px;
    font-weight: 700; color: #8a8080; }
  .dark .shot { background: rgba(255,255,255,.07); }
  .shot img { width: 100%; height: 100%; object-fit: cover; object-position: top; }
  .title { display: flex; align-items: center; gap: 6px; min-width: 0; font-weight: 600; }
  .title img { width: 14px; height: 14px; flex: none; }
  .title span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style></head><body><div class="panel" id="panel" role="listbox" aria-label="Alternar guias"></div>
<script>
  const panel = document.getElementById("panel");
  const make = (tag, className) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    return element;
  };
  window.render = (model) => {
    document.documentElement.className = model.dark ? "dark" : "";
    panel.style.maxWidth = model.maxWidth + "px";
    panel.replaceChildren();
    model.cards.forEach((card, position) => {
      const link = make("a", "card");
      link.href = "agzos-switcher://" + position;
      link.setAttribute("role", "option");
      const shot = make("div", "shot");
      if (card.image) {
        const image = make("img");
        image.src = card.image;
        image.alt = "";
        shot.append(image);
      } else {
        shot.textContent = card.letter || "";
      }
      const title = make("div", "title");
      if (card.icon) {
        const icon = make("img");
        icon.src = card.icon;
        icon.alt = "";
        icon.onerror = () => icon.remove();
        title.append(icon);
      }
      const label = make("span");
      label.textContent = card.title;
      title.append(label);
      link.append(shot, title);
      panel.append(link);
    });
    window.select(model.index);
    // Mede o painel (a camada é desenhada do tamanho da janela e depois encolhe).
    const box = panel.getBoundingClientRect();
    return {
      width: Math.ceil(box.width) + ${LAYER_MARGIN} * 2,
      height: Math.ceil(box.height) + ${LAYER_MARGIN} * 2,
    };
  };
  window.select = (index) => {
    [...panel.children].forEach((card, position) => {
      card.classList.toggle("selected", position === index);
      card.setAttribute("aria-selected", String(position === index));
    });
    panel.children[index]?.scrollIntoView({ block: "nearest" });
  };
</script></body></html>`;

/** Cartão escolhido pelo clique (agzos-switcher://N), ou null. */
function switcherChoice(url) {
  const match = /^agzos-switcher:\/\/(\d+)\/?$/.exec(String(url ?? ""));
  return match ? Number(match[1]) : null;
}

/** Centraliza a camada na janela, sem passar das bordas. */
function switcherBounds(size, windowSize) {
  const width = Math.min(Math.round(size.width), windowSize.width);
  const height = Math.min(Math.round(size.height), windowSize.height);
  return {
    x: Math.max(0, Math.round((windowSize.width - width) / 2)),
    y: Math.max(0, Math.round((windowSize.height - height) / 2)),
    width,
    height,
  };
}

module.exports = { SWITCHER_HTML, LAYER_MARGIN, switcherChoice, switcherBounds };

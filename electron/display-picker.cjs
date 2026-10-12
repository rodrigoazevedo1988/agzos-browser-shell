// Compartilhar tela (4.8.5): getDisplayMedia (Meet, Teams, Zoom, Discord…) precisa de quem
// escolha a fonte; sem setDisplayMediaRequestHandler o Electron recusa. Regras puras: a
// página do seletor e a leitura da resposta, que volta pelo título (sem preload nem IPC).

const PICK_PREFIX = "agzos-pick:";

/** Telas primeiro, depois janelas; sem a própria janela do seletor. */
function orderSources(sources, ownTitle = "") {
  const list = Array.isArray(sources) ? sources : [];
  const kind = (source) => (String(source?.id ?? "").startsWith("screen:") ? 0 : 1);
  return list
    .filter((source) => source && typeof source.id === "string" && source.name !== ownTitle)
    .map((source, index) => ({ source, index }))
    .sort((a, b) => kind(a.source) - kind(b.source) || a.index - b.index)
    .map(({ source }) => source);
}

/** Dados que a página recebe: só nome, tipo e miniatura (data:image). */
function pickerPayload(sources, { audio = false } = {}) {
  return {
    audio: Boolean(audio),
    sources: sources.map((source, index) => ({
      index,
      kind: String(source.id).startsWith("screen:") ? "screen" : "window",
      name: String(source.name ?? "").slice(0, 200) || (index === 0 ? "Tela" : "Janela"),
      thumb:
        typeof source.thumb === "string" && source.thumb.startsWith("data:image/")
          ? source.thumb
          : "",
    })),
  };
}

/** Título da página → { index, audio } escolhido, "cancel", ou null (ainda escolhendo). */
function parsePick(title, count) {
  const text = String(title ?? "");
  if (!text.startsWith(PICK_PREFIX)) return null;
  const rest = text.slice(PICK_PREFIX.length);
  if (rest === "cancel") return "cancel";
  const match = /^(\d{1,4}):([01])$/.exec(rest);
  if (!match) return null;
  const index = Number(match[1]);
  if (index >= count) return null;
  return { index, audio: match[2] === "1" };
}

/** Página do seletor; os dados chegam por render(payload) e viram texto, nunca HTML. */
function pickerHtml() {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>Compartilhar tela</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#202124;--muted:#5f6368;--card:#f1f3f4;--accent:#1a73e8;--line:#dadce0}
@media (prefers-color-scheme:dark){:root{--bg:#202124;--fg:#e8eaed;--muted:#9aa0a6;--card:#2d2e31;--accent:#8ab4f8;--line:#3c4043}}
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:var(--bg);color:var(--fg);font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
body{display:flex;flex-direction:column}
header{padding:16px 20px 8px}
h1{margin:0;font-size:17px;font-weight:600}
p{margin:4px 0 0;color:var(--muted)}
main{flex:1;overflow:auto;padding:8px 20px}
h2{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:12px 0 8px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}
.card{all:unset;display:flex;flex-direction:column;gap:6px;padding:8px;border-radius:10px;background:var(--card);border:2px solid transparent;cursor:default}
.card:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.card[aria-pressed=true]{border-color:var(--accent)}
.card img,.card .blank{width:100%;aspect-ratio:16/9;object-fit:contain;border-radius:6px;background:#000}
.card span{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:13px}
footer{display:flex;align-items:center;gap:8px;padding:12px 20px;border-top:1px solid var(--line)}
label{display:flex;align-items:center;gap:6px;margin-right:auto}
label[hidden]{display:none}
footer .spacer{margin-right:auto}
button.action{all:unset;padding:8px 16px;border-radius:8px;cursor:default;font-weight:500}
#cancel{color:var(--accent)}
#share{background:var(--accent);color:var(--bg)}
#share:disabled{opacity:.4}
button.action:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
</style></head><body>
<header><h1>Compartilhar tela</h1><p>Escolha o que o site vai ver.</p></header>
<main id="list"></main>
<footer>
<label id="audioRow" hidden><input id="audio" type="checkbox" checked> Compartilhar o áudio do sistema</label>
<span class="spacer" id="spacer"></span>
<button class="action" id="cancel">Cancelar</button>
<button class="action" id="share" disabled>Compartilhar</button>
</footer>
<script>
(() => {
  const answer = (text) => { document.title = ${JSON.stringify(PICK_PREFIX)} + text; };
  let chosen = -1;
  const cards = [];
  const pick = (index) => {
    chosen = index;
    for (const card of cards) card.setAttribute("aria-pressed", String(Number(card.dataset.index) === index));
    document.getElementById("share").disabled = chosen < 0;
  };
  const share = () => {
    if (chosen < 0) return;
    answer(chosen + ":" + (document.getElementById("audio").checked && !document.getElementById("audioRow").hidden ? "1" : "0"));
  };
  document.getElementById("cancel").onclick = () => answer("cancel");
  document.getElementById("share").onclick = share;
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") answer("cancel");
  });
  window.render = (payload) => {
    const list = document.getElementById("list");
    list.textContent = "";
    document.getElementById("audioRow").hidden = !payload.audio;
    document.getElementById("spacer").hidden = Boolean(payload.audio);
    for (const [kind, heading] of [["screen", "Tela inteira"], ["window", "Janelas"]]) {
      const items = payload.sources.filter((source) => source.kind === kind);
      if (!items.length) continue;
      const title = document.createElement("h2");
      title.textContent = heading;
      const grid = document.createElement("div");
      grid.className = "grid";
      for (const source of items) {
        const card = document.createElement("button");
        card.className = "card";
        card.dataset.index = String(source.index);
        card.setAttribute("aria-pressed", "false");
        if (source.thumb) {
          const img = document.createElement("img");
          img.alt = "";
          img.src = source.thumb;
          card.append(img);
        } else {
          const blank = document.createElement("div");
          blank.className = "blank";
          card.append(blank);
        }
        const name = document.createElement("span");
        name.textContent = source.name;
        card.title = source.name;
        card.append(name);
        card.onclick = () => pick(source.index);
        card.ondblclick = () => { pick(source.index); share(); };
        card.onkeydown = (event) => { if (event.key === "Enter") { pick(source.index); share(); } };
        cards.push(card);
        grid.append(card);
      }
      list.append(title, grid);
    }
    if (payload.sources.length) pick(0);
    if (cards[0]) cards[0].focus();
  };
})();
</script></body></html>`;
}

module.exports = { PICK_PREFIX, orderSources, parsePick, pickerHtml, pickerPayload };

// Dica da barra (4.6.1). O tooltip nativo do Chromium vinha cortado ("Downloads (Ctrl…")
// no Windows; este é do app: uma view pequena e transparente por cima da página, do
// tamanho do texto, posicionada dentro da janela. Não recebe clique (some antes).

const TOOLTIP_PAGE =
  "data:text/html;charset=utf-8," +
  encodeURIComponent(
    `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:transparent;overflow:hidden}
#t{display:inline-block;max-width:420px;padding:5px 9px;border-radius:7px;white-space:nowrap;
font:12px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;box-sizing:border-box;
background:rgba(250,250,250,.97);color:#18181b;border:1px solid rgba(0,0,0,.12)}
.dark #t{background:rgba(39,39,42,.97);color:#fafafa;border-color:rgba(255,255,255,.14)}
</style><body><span id="t"></span></body>`,
  );

const MAX_TEXT = 200;

/** Texto que a casca pode mandar (uma linha, curta). */
function cleanTooltipText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT) : "";
}

/**
 * Abaixo do botão, centrado nele, sem sair da área da janela (`content`: largura e
 * altura do conteúdo). Perto da borda direita encosta nela em vez de cortar.
 */
function tooltipPlacement(anchor, size, content) {
  const margin = 4;
  const width = Math.min(Math.ceil(size.width), Math.max(0, content.width - margin * 2));
  const height = Math.ceil(size.height);
  const centered = anchor.x + anchor.width / 2 - width / 2;
  const x = Math.round(Math.min(Math.max(margin, centered), content.width - width - margin));
  let y = Math.round(anchor.y + anchor.height + 6);
  if (y + height > content.height - margin) y = Math.round(anchor.y - height - 6);
  return { x, y: Math.max(margin, y), width, height };
}

const MEASURE = `(() => { const t = document.getElementById("t");
  const r = t.getBoundingClientRect(); return { width: r.width, height: r.height }; })()`;

/** Uma dica por janela: `show(text, anchor, dark)` e `hide()`. */
function createTooltip({ window, createView }) {
  let view = null;
  let seq = 0;

  function ensure() {
    if (view && !view.webContents.isDestroyed()) return view;
    view = createView();
    view.setVisible(false);
    void view.webContents.loadURL(TOOLTIP_PAGE).catch(() => {});
    return view;
  }

  async function show(text, anchor, dark) {
    const clean = cleanTooltipText(text);
    if (!clean || window.isDestroyed()) return hide();
    const current = ensure();
    const id = ++seq;
    if (current.webContents.isLoading()) {
      await new Promise((resolve) => current.webContents.once("did-finish-load", resolve));
    }
    let size;
    try {
      // Largura folgada para medir (o texto não quebra), depois o tamanho exato.
      current.setBounds({ x: 0, y: 0, width: 460, height: 60 });
      size = await current.webContents.executeJavaScript(
        `document.body.className = ${JSON.stringify(dark ? "dark" : "")};
         document.getElementById("t").textContent = ${JSON.stringify(clean)}; ${MEASURE}`,
      );
    } catch {
      return undefined;
    }
    if (id !== seq || window.isDestroyed() || current.webContents.isDestroyed()) return undefined;
    const content = window.getContentBounds();
    current.setBounds(tooltipPlacement(anchor, size, content));
    // Por cima das guias e dos painéis.
    window.contentView.addChildView(current);
    current.setVisible(true);
    return undefined;
  }

  function hide() {
    seq += 1;
    if (view && !view.webContents.isDestroyed()) view.setVisible(false);
  }

  function destroy() {
    if (view && !view.webContents.isDestroyed()) view.webContents.close();
    view = null;
  }

  return { show, hide, destroy };
}

module.exports = { cleanTooltipText, createTooltip, tooltipPlacement };

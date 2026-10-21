// Captura da página inteira (4.9.7, 5.0.1). O main rola a guia de tela em tela e fotografa cada
// faixa (capturePage, a foto do compositor); a casca costura as faixas num PNG. Os scripts
// rodam no mundo isolado CAPTURE_WORLD: só leem a página, rolam e mexem no estilo inline
// (CSSOM !important, guardado por elemento e devolvido no fim, mesmo com erro). Fixos e sticky
// no topo aparecem só na 1ª faixa; os de baixo, só na última. A rolagem suave fica desligada
// e cada faixa espera a pintura e as imagens preguiçosas visíveis. Nada de <style> nem
// innerHTML (a CSP do site e o isolamento ficam intactos).

const CAPTURE_WORLD = 4136;
/** Altura máxima do PNG costurado, em pixels da imagem (limite do canvas do Chromium). */
const MAX_IMAGE_HEIGHT = 32767;
/** Faixas por captura: uma página de 200 telas já é um rolo de papel. */
const MAX_STRIPS = 200;
/** Espera depois de rolar: a pintura do quadro assentar. */
const SETTLE_MS = 160;
/** Espera máxima por imagens preguiçosas visíveis; depois disso a faixa sai como está. */
const LAZY_MS = 1000;
/** Elementos percorridos por varredura, sombras abertas incluídas. */
const MAX_ELEMENTS = 20000;
/**
 * Estilo inline dado a fixo/sticky escondido. visibility esconde o próprio elemento; opacity
 * pega a subárvore inteira (filho com visibility próprio também some); transition none corta
 * o fade de saída, senão a faixa pegaria o meio da animação.
 */
const HIDE_STYLE = { visibility: "hidden", opacity: "0", transition: "none" };

/**
 * Posições de rolagem (px CSS) para cobrir `total` com telas de `viewport`. A última
 * encosta no fim (sobrepõe a anterior; a costura desenha por cima, com o mesmo conteúdo).
 */
function planStrips(total, viewport, maxStrips = MAX_STRIPS) {
  const height = Math.max(1, Math.floor(viewport));
  const end = Math.max(0, Math.floor(total) - height);
  const positions = [];
  for (let y = 0; y < end && positions.length < maxStrips - 1; y += height) positions.push(y);
  if (positions.length < maxStrips) positions.push(end);
  return [...new Set(positions)];
}

/** Altura que cabe no PNG (px CSS) e se a página foi cortada. */
function fitHeight(total, scale) {
  const max = Math.floor(MAX_IMAGE_HEIGHT / Math.max(1, Number(scale) || 1));
  const height = Math.max(1, Math.floor(total));
  return { height: Math.min(height, max), truncated: height > max };
}

// Estado da captura fica no global do mundo isolado (o mesmo entre as chamadas).
const STATE = "window.__agzosPageCapture";

/**
 * Mede o que rola: o documento ou, em apps que rolam dentro de um elemento (SPAs com
 * layout de 100vh), o maior elemento visível com rolagem vertical. Desliga a rolagem suave
 * do documento antes de qualquer rolagem e guarda o valor antigo para o restoreSource.
 */
function measureSource() {
  return `(() => {
  const root = document.documentElement;
  const state = ${STATE} = { el: null, start: 0, fixed: new Map(),
    root: [root.style.getPropertyValue("scroll-behavior"), root.style.getPropertyPriority("scroll-behavior")] };
  root.style.setProperty("scroll-behavior", "auto", "important");
  const doc = document.scrollingElement || root;
  const view = { w: root.clientWidth || innerWidth, h: innerHeight };
  let target = null;
  if (doc.scrollHeight <= doc.clientHeight + 2) {
    let best = 0;
    const all = document.body ? document.body.getElementsByTagName("*") : [];
    for (let i = 0; i < all.length && i < 20000; i += 1) {
      const el = all[i];
      if (el.scrollHeight <= el.clientHeight + 2 || el.clientHeight < 120) continue;
      const style = getComputedStyle(el);
      if (!/(auto|scroll|overlay)/.test(style.overflowY)) continue;
      const area = el.clientWidth * el.clientHeight;
      if (area > best) { best = area; target = el; }
    }
  }
  if (target) {
    const rect = target.getBoundingClientRect();
    const x = Math.max(0, Math.round(rect.left + target.clientLeft));
    const y = Math.max(0, Math.round(rect.top + target.clientTop));
    state.el = target;
    state.start = target.scrollTop;
    return { element: true, total: target.scrollHeight, start: target.scrollTop,
      clip: { x, y, width: Math.min(target.clientWidth, view.w - x), height: Math.min(target.clientHeight, view.h - y) },
      scale: devicePixelRatio || 1 };
  }
  state.start = doc.scrollTop;
  return { element: false, total: Math.max(doc.scrollHeight, view.h), start: doc.scrollTop,
    clip: { x: 0, y: 0, width: view.w, height: view.h }, scale: devicePixelRatio || 1 };
})()`;
}

/**
 * Rola até `y`, espera dois quadros + `settle` ms e, se ainda houver imagem preguiçosa
 * visível sem carregar, espera até `lazy` ms por ela. Devolve a posição real.
 */
function scrollSource(y, settle = SETTLE_MS, lazy = LAZY_MS) {
  return `new Promise((done) => {
  const state = ${STATE};
  if (!state) return done(null);
  const target = state.el || document.scrollingElement || document.documentElement;
  if (state.el) state.el.scrollTo({ top: ${Number(y) || 0}, behavior: "instant" });
  else window.scrollTo({ top: ${Number(y) || 0}, behavior: "instant" });
  const pending = () => [...document.images].some((img) => {
    if (img.complete) return false;
    const r = img.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  });
  const started = Date.now();
  const settled = () => done(Math.round(target.scrollTop));
  const wait = () => (!pending() || Date.now() - started > ${Number(lazy) || 0})
    ? settled() : setTimeout(wait, 50);
  requestAnimationFrame(() => requestAnimationFrame(() =>
    setTimeout(wait, ${Number(settle) || 0})));
})`;
}

/**
 * Aplica a fase aos fixos e sticky (menos o rolador e quem o contém): "first" mostra os do
 * topo e esconde os de baixo; "next" esconde todos; "last" mostra os de baixo. Varre também
 * as sombras abertas e pega os fixos que surgiram depois (lazy). O estilo inline original de
 * cada um é guardado na primeira vez que aparece; o restoreSource devolve esse valor.
 */
function fixedSource(phase) {
  const safe = phase === "first" || phase === "last" ? phase : "next";
  return `new Promise((done) => {
  const state = ${STATE};
  if (!state) return done(0);
  const phase = ${JSON.stringify(safe)};
  const hideStyle = ${JSON.stringify(HIDE_STYLE)};
  const props = Object.keys(hideStyle);
  let budget = ${MAX_ELEMENTS};
  let hidden = 0;
  const found = (el) => {
    if (state.el && (el === state.el || el.contains(state.el))) return;
    let entry = state.fixed.get(el);
    if (!entry) {
      const style = getComputedStyle(el);
      if (style.position !== "fixed" && style.position !== "sticky") return;
      if (!el.getClientRects().length || style.visibility === "hidden" || style.visibility === "collapse") return;
      entry = {
        bottom: style.top === "auto" && style.bottom !== "auto",
        saved: props.map((prop) => [prop, el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)]),
      };
      state.fixed.set(el, entry);
    }
    const hiding = phase === "next" || (phase === "first" ? entry.bottom : !entry.bottom);
    if (hiding) hidden += 1;
    props.forEach((prop, index) => {
      if (hiding) el.style.setProperty(prop, hideStyle[prop], "important");
      else {
        const [, value, priority] = entry.saved[index];
        if (value) el.style.setProperty(prop, value, priority);
        else el.style.removeProperty(prop);
      }
    });
  };
  const visit = (root) => {
    for (const el of root.querySelectorAll("*")) {
      if (budget <= 0) return;
      budget -= 1;
      found(el);
      if (el.shadowRoot) visit(el.shadowRoot);
    }
  };
  visit(document);
  requestAnimationFrame(() => requestAnimationFrame(() => done(hidden)));
})`;
}

/** Devolve estilos inline (fixos, rolagem suave) e a rolagem do usuário; apaga o estado. */
function restoreSource() {
  return `(() => {
  const state = ${STATE};
  if (!state) return false;
  const put = (el, prop, value, priority) => {
    if (value) el.style.setProperty(prop, value, priority);
    else el.style.removeProperty(prop);
  };
  for (const [el, entry] of state.fixed) {
    for (const [prop, value, priority] of entry.saved) put(el, prop, value, priority);
  }
  put(document.documentElement, "scroll-behavior", state.root[0], state.root[1]);
  if (state.el) state.el.scrollTo({ top: state.start, behavior: "instant" });
  else window.scrollTo({ top: state.start, behavior: "instant" });
  ${STATE} = null;
  return true;
})()`;
}

/**
 * Captura inteira de `contents`. `run(code)` roda no mundo isolado; `shot(rect)` devolve a
 * NativeImage da área (px CSS da view). Resolve com as faixas para a casca costurar.
 * Tudo entre o measure e o restore fica no try: qualquer erro ainda devolve o estilo.
 */
async function capturePageStrips({ run, shot }) {
  const strips = [];
  let info = null;
  let height = 0;
  let truncated = false;
  try {
    info = await run(measureSource());
    if (!info || !info.clip || info.clip.width < 2 || info.clip.height < 2) return null;
    ({ height, truncated } = fitHeight(info.total, info.scale));
    const positions = planStrips(height, info.clip.height);
    for (let index = 0; index < positions.length; index += 1) {
      const actual = await run(scrollSource(positions[index]));
      if (typeof actual !== "number") break;
      // Página que não rola mais (fim alcançado antes do previsto): esta faixa é a última.
      const stalled = index > 0 && actual <= strips[strips.length - 1].y;
      const last = stalled || index === positions.length - 1;
      if (positions.length > 1) {
        await run(fixedSource(index === 0 ? "first" : last ? "last" : "next"));
      }
      const image = await shot(info.clip);
      if (!image || image.isEmpty()) break;
      strips.push({ dataUrl: image.toDataURL(), y: actual });
      if (stalled) break;
    }
  } finally {
    await run(restoreSource()).catch(() => {});
  }
  if (!strips.length) return null;
  const { width } = info.clip;
  return {
    size: { width, height },
    truncated,
    layers: strips.map((strip) => ({
      dataUrl: strip.dataUrl,
      x: 0,
      y: strip.y,
      width,
      height: info.clip.height,
    })),
  };
}

module.exports = {
  CAPTURE_WORLD,
  MAX_IMAGE_HEIGHT,
  MAX_STRIPS,
  capturePageStrips,
  fitHeight,
  fixedSource,
  measureSource,
  planStrips,
  restoreSource,
  scrollSource,
};

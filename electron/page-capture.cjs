// Captura da página inteira (4.9.7). O main rola a guia de tela em tela e fotografa cada
// faixa (capturePage, a foto do compositor); a casca costura as faixas num PNG. Os scripts
// rodam no mundo isolado CAPTURE_WORLD: só leem a página, rolam e escondem por estilo
// inline (CSSOM !important, guardado e devolvido no fim) o que é fixo ou sticky depois da
// primeira faixa, para o cabeçalho não se repetir a cada tela. Nada de <style> nem
// innerHTML (a CSP do site e o isolamento ficam intactos).

const CAPTURE_WORLD = 4136;
/** Altura máxima do PNG costurado, em pixels da imagem (limite do canvas do Chromium). */
const MAX_IMAGE_HEIGHT = 32767;
/** Faixas por captura: uma página de 200 telas já é um rolo de papel. */
const MAX_STRIPS = 200;
/** Espera depois de rolar: imagens preguiçosas e animações de entrada assentarem. */
const SETTLE_MS = 160;

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
 * layout de 100vh), o maior elemento visível com rolagem vertical.
 */
function measureSource() {
  return `(() => {
  const doc = document.scrollingElement || document.documentElement;
  const view = { w: document.documentElement.clientWidth || innerWidth, h: innerHeight };
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
    ${STATE} = { el: target, start: target.scrollTop, hidden: [] };
    return { element: true, total: target.scrollHeight, start: target.scrollTop,
      clip: { x, y, width: Math.min(target.clientWidth, view.w - x), height: Math.min(target.clientHeight, view.h - y) },
      scale: devicePixelRatio || 1 };
  }
  ${STATE} = { el: null, start: doc.scrollTop, hidden: [] };
  return { element: false, total: Math.max(doc.scrollHeight, view.h), start: doc.scrollTop,
    clip: { x: 0, y: 0, width: view.w, height: view.h }, scale: devicePixelRatio || 1 };
})()`;
}

/** Rola até `y` e espera dois quadros + SETTLE_MS; devolve a posição real. */
function scrollSource(y, settle = SETTLE_MS) {
  return `new Promise((done) => {
  const state = ${STATE};
  if (!state) return done(null);
  const target = state.el || document.scrollingElement || document.documentElement;
  if (state.el) state.el.scrollTo({ top: ${Number(y) || 0}, behavior: "instant" });
  else window.scrollTo({ top: ${Number(y) || 0}, behavior: "instant" });
  requestAnimationFrame(() => requestAnimationFrame(() =>
    setTimeout(() => done(Math.round(target.scrollTop)), ${Number(settle) || 0})));
})`;
}

/**
 * Esconde fixos e sticky (menos o próprio rolador e quem o contém): saem da 2ª faixa em
 * diante. O valor inline anterior volta no restoreSource.
 */
function hideFixedSource() {
  return `new Promise((done) => {
  const state = ${STATE};
  if (!state) return done(0);
  const all = document.body ? document.body.getElementsByTagName("*") : [];
  for (let i = 0; i < all.length && i < 20000; i += 1) {
    const el = all[i];
    if (state.el && (el === state.el || el.contains(state.el))) continue;
    const position = getComputedStyle(el).position;
    if (position !== "fixed" && position !== "sticky") continue;
    state.hidden.push([el, el.style.getPropertyValue("visibility"), el.style.getPropertyPriority("visibility")]);
    el.style.setProperty("visibility", "hidden", "important");
  }
  requestAnimationFrame(() => requestAnimationFrame(() => done(state.hidden.length)));
})`;
}

/** Devolve estilos e a rolagem do usuário; apaga o estado. */
function restoreSource() {
  return `(() => {
  const state = ${STATE};
  if (!state) return false;
  for (const [el, value, priority] of state.hidden) {
    if (value) el.style.setProperty("visibility", value, priority);
    else el.style.removeProperty("visibility");
  }
  if (state.el) state.el.scrollTo({ top: state.start, behavior: "instant" });
  else window.scrollTo({ top: state.start, behavior: "instant" });
  ${STATE} = null;
  return true;
})()`;
}

/**
 * Captura inteira de `contents`. `run(code)` roda no mundo isolado; `shot(rect)` devolve a
 * NativeImage da área (px CSS da view). Resolve com as faixas para a casca costurar.
 */
async function capturePageStrips({ run, shot }) {
  const info = await run(measureSource());
  if (!info || !info.clip || info.clip.width < 2 || info.clip.height < 2) return null;
  const { height, truncated } = fitHeight(info.total, info.scale);
  const positions = planStrips(height, info.clip.height);
  const strips = [];
  try {
    for (let index = 0; index < positions.length; index += 1) {
      const actual = await run(scrollSource(positions[index]));
      if (typeof actual !== "number") break;
      if (index === 1) await run(hideFixedSource());
      const image = await shot(info.clip);
      if (!image || image.isEmpty()) break;
      strips.push({ dataUrl: image.toDataURL(), y: actual });
      // Página que não rola mais (fim alcançado antes do previsto): para aqui.
      if (index > 0 && actual <= strips[strips.length - 2].y) break;
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
  hideFixedSource,
  measureSource,
  planStrips,
  restoreSource,
  scrollSource,
};

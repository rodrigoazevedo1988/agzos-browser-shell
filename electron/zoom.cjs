// Degraus de zoom do Chrome (em fator). Puro: usado pelo main e pelos testes.
const ZOOM_STEPS = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5,
];

function nextZoom(current, direction) {
  const factor = Number.isFinite(current) && current > 0 ? current : 1;
  if (direction === 0) return 1;
  if (direction > 0) return ZOOM_STEPS.find((step) => step > factor + 0.001) ?? ZOOM_STEPS.at(-1);
  return [...ZOOM_STEPS].reverse().find((step) => step < factor - 0.001) ?? ZOOM_STEPS[0];
}

/** Zoom é por host, como no Chrome ("www." incluído no host). */
function zoomHostOf(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.host;
  } catch {
    return null;
  }
}

/**
 * Avisos "zoom-changed" com o mesmo sentido que chegam dentro deste intervalo (ms) são o
 * mesmo passo de Ctrl+roda: o Electron 44 avisa cada roda de mouse duas vezes, no mesmo
 * instante. Roda de mouse de verdade não chega assim tão junto.
 */
const WHEEL_ZOOM_REPEAT_MS = 10;

/**
 * Filtro por página: devolve true só para o primeiro aviso de cada passo. A pinça do
 * trackpad não passa por aqui (não gera zoom-changed; o preload manda o gesto).
 */
function createWheelZoomGate(now = Date.now) {
  let last = null;
  return (direction) => {
    const time = now();
    if (last && last.direction === direction && time - last.time < WHEEL_ZOOM_REPEAT_MS) {
      return false;
    }
    last = { direction, time };
    return true;
  };
}

module.exports = { ZOOM_STEPS, WHEEL_ZOOM_REPEAT_MS, createWheelZoomGate, nextZoom, zoomHostOf };

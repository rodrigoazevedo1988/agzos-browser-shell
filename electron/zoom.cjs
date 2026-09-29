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

module.exports = { ZOOM_STEPS, nextZoom, zoomHostOf };

import type { Point, Rect } from "../annotate/geometry";
import type { Crop, Doc, Element, ImageElement, Transform } from "./model";

/**
 * Geometria dos elementos: a caixa gira em torno do centro, as alças redimensionam pelo lado
 * oposto (que fica parado), a rotação segue o ponteiro (com passos de 15° no Shift), os
 * grupos escalam juntos e o encaixe (snap) alinha bordas e centros. Tudo puro.
 */

export type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "rotate";

export const RESIZE_HANDLES: HandleId[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const rad = (degrees: number) => (degrees * Math.PI) / 180;

export function centerOf(t: Transform): Point {
  return { x: t.x + t.width / 2, y: t.y + t.height / 2 };
}

/** Ponto na caixa (0..w, 0..h, sem girar) → ponto do documento. */
export function toDoc(t: Transform, local: Point): Point {
  const c = centerOf(t);
  const dx = local.x - t.width / 2;
  const dy = local.y - t.height / 2;
  const cos = Math.cos(rad(t.rotation));
  const sin = Math.sin(rad(t.rotation));
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/** Ponto do documento → coordenadas da caixa (sem girar). */
export function toLocal(t: Transform, point: Point): Point {
  const c = centerOf(t);
  const dx = point.x - c.x;
  const dy = point.y - c.y;
  const cos = Math.cos(rad(-t.rotation));
  const sin = Math.sin(rad(-t.rotation));
  return {
    x: dx * cos - dy * sin + t.width / 2,
    y: dx * sin + dy * cos + t.height / 2,
  };
}

/** Os quatro cantos da caixa girada, no sentido horário a partir do de cima à esquerda. */
export function corners(t: Transform): Point[] {
  return [
    toDoc(t, { x: 0, y: 0 }),
    toDoc(t, { x: t.width, y: 0 }),
    toDoc(t, { x: t.width, y: t.height }),
    toDoc(t, { x: 0, y: t.height }),
  ];
}

export function boundsOfPoints(points: Point[]): Rect {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { x: left, y: top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

/** Caixa que envolve os elementos (já girados). Null sem elementos. */
export function boundsOf(elements: Element[]): Rect | null {
  if (!elements.length) return null;
  return boundsOfPoints(elements.flatMap((element) => corners(element.transform)));
}

/** O ponto cai na caixa (com folga `tolerance`, em pixels do documento). */
export function hitTransform(t: Transform, point: Point, tolerance = 0): boolean {
  const local = toLocal(t, point);
  return (
    local.x >= -tolerance &&
    local.x <= t.width + tolerance &&
    local.y >= -tolerance &&
    local.y <= t.height + tolerance
  );
}

/** Elemento de cima que está sob o ponto (lista de cima para baixo; ocultos não contam). */
export function topmostAt(topDown: Element[], point: Point, tolerance = 0): Element | null {
  for (const element of topDown) {
    if (element.hidden) continue;
    const slop = Math.max(tolerance, element.kind === "shape" ? element.strokeWidth / 2 : 0);
    if (hitTransform(element.transform, point, slop)) return element;
  }
  return null;
}

/** Alças da seleção de um elemento; `zoom` mantém o tamanho na tela constante. */
export function handlePoints(t: Transform, zoom = 1): Record<HandleId, Point> {
  const w = t.width;
  const h = t.height;
  const at = (x: number, y: number) => toDoc(t, { x, y });
  return {
    nw: at(0, 0),
    n: at(w / 2, 0),
    ne: at(w, 0),
    e: at(w, h / 2),
    se: at(w, h),
    s: at(w / 2, h),
    sw: at(0, h),
    w: at(0, h / 2),
    rotate: at(w / 2, -28 / zoom),
  };
}

/** Lado do documento que a alça move: 0 = esquerda/topo, 1 = direita/base, 0.5 = meio. */
export function handleAxes(handle: Exclude<HandleId, "rotate">) {
  const x = handle.includes("e") ? 1 : handle.includes("w") ? 0 : 0.5;
  const y = handle.includes("s") ? 1 : handle.includes("n") ? 0 : 0.5;
  return { x, y };
}

export type ResizeOptions = { keepRatio?: boolean; min?: number };

/**
 * Redimensiona pela alça: o lado oposto fica no lugar, o ponteiro fixa a outra borda. Com
 * `keepRatio` (ou corner + Shift) a proporção da caixa original é mantida.
 */
export function resizeTransform(
  start: Transform,
  handle: Exclude<HandleId, "rotate">,
  pointer: Point,
  options: ResizeOptions = {},
): Transform {
  const min = options.min ?? 4;
  const { x: hx, y: hy } = handleAxes(handle);
  const w0 = start.width;
  const h0 = start.height;
  const anchorLocal = { x: (1 - hx) * w0, y: (1 - hy) * h0 };
  const anchor = toDoc(start, anchorLocal);
  // Ponteiro no eixo da caixa (sem girar), com a origem na âncora.
  const cos = Math.cos(rad(-start.rotation));
  const sin = Math.sin(rad(-start.rotation));
  const vx = pointer.x - anchor.x;
  const vy = pointer.y - anchor.y;
  const ux = vx * cos - vy * sin;
  const uy = vx * sin + vy * cos;

  let width = hx === 0.5 ? w0 : Math.max(min, hx === 1 ? ux : -ux);
  let height = hy === 0.5 ? h0 : Math.max(min, hy === 1 ? uy : -uy);
  const corner = hx !== 0.5 && hy !== 0.5;
  if (options.keepRatio && corner && w0 > 0 && h0 > 0) {
    const scale = Math.max(width / w0, height / h0);
    width = Math.max(min, w0 * scale);
    height = Math.max(min, h0 * scale);
  }

  const anchorNew = { x: (1 - hx) * width, y: (1 - hy) * height };
  const half = { x: width / 2, y: height / 2 };
  const dx = anchorNew.x - half.x;
  const dy = anchorNew.y - half.y;
  const rc = Math.cos(rad(start.rotation));
  const rs = Math.sin(rad(start.rotation));
  // Centro novo: a âncora continua no mesmo ponto do documento.
  const center = {
    x: anchor.x - (dx * rc - dy * rs),
    y: anchor.y - (dx * rs + dy * rc),
  };
  return { ...start, x: center.x - width / 2, y: center.y - height / 2, width, height };
}

/** Ângulo (graus) que aponta o ponteiro a partir do centro, com a alça de rotação em cima. */
export function rotationTo(center: Point, pointer: Point, snap = false): number {
  let angle = (Math.atan2(pointer.y - center.y, pointer.x - center.x) * 180) / Math.PI + 90;
  if (snap) angle = Math.round(angle / 15) * 15;
  return ((angle % 360) + 360) % 360;
}

/** Escala um elemento de um grupo em torno da âncora (mantém o giro). */
export function scaleMember(t: Transform, anchor: Point, sx: number, sy: number): Transform {
  const c = centerOf(t);
  const nc = { x: anchor.x + (c.x - anchor.x) * sx, y: anchor.y + (c.y - anchor.y) * sy };
  const width = t.width * sx;
  const height = t.height * sy;
  return { ...t, x: nc.x - width / 2, y: nc.y - height / 2, width, height };
}

/** Gira um elemento de um grupo em torno do centro do grupo. */
export function rotateMember(t: Transform, center: Point, degrees: number): Transform {
  const c = centerOf(t);
  const dx = c.x - center.x;
  const dy = c.y - center.y;
  const cos = Math.cos(rad(degrees));
  const sin = Math.sin(rad(degrees));
  const nc = { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
  const rotation = (((t.rotation + degrees) % 360) + 360) % 360;
  return { ...t, x: nc.x - t.width / 2, y: nc.y - t.height / 2, rotation };
}

export type Guide = { axis: "x" | "y"; at: number };
export type Snap = { dx: number; dy: number; guides: Guide[] };

/**
 * Encaixe ao mover: as bordas e o centro da caixa vão para a linha de alguma referência
 * (bordas do documento e dos outros elementos) quando estão a até `threshold` px dela.
 */
export function snapMove(
  box: Rect,
  targets: { xs: number[]; ys: number[] },
  threshold: number,
): Snap {
  const own = {
    xs: [box.x, box.x + box.width / 2, box.x + box.width],
    ys: [box.y, box.y + box.height / 2, box.y + box.height],
  };
  const best = (values: number[], refs: number[]) => {
    let found: { delta: number; at: number } | null = null;
    for (const value of values) {
      for (const ref of refs) {
        const delta = ref - value;
        if (Math.abs(delta) <= threshold && (!found || Math.abs(delta) < Math.abs(found.delta))) {
          found = { delta, at: ref };
        }
      }
    }
    return found;
  };
  const sx = best(own.xs, targets.xs);
  const sy = best(own.ys, targets.ys);
  const guides: Guide[] = [];
  if (sx) guides.push({ axis: "x", at: sx.at });
  if (sy) guides.push({ axis: "y", at: sy.at });
  return { dx: sx?.delta ?? 0, dy: sy?.delta ?? 0, guides };
}

/** Linhas de encaixe: bordas e centro do documento e dos elementos que não se movem. */
export function snapTargets(doc: Doc, exclude: readonly string[]): { xs: number[]; ys: number[] } {
  const xs = [0, doc.width / 2, doc.width];
  const ys = [0, doc.height / 2, doc.height];
  for (const element of doc.elements) {
    if (element.hidden || exclude.includes(element.id)) continue;
    const box = boundsOfPoints(corners(element.transform));
    xs.push(box.x, box.x + box.width / 2, box.x + box.width);
    ys.push(box.y, box.y + box.height / 2, box.y + box.height);
  }
  return { xs, ys };
}

/** Elementos (visíveis) cuja caixa cruza o retângulo do laço de seleção. */
export function marqueeHits(elements: Element[], area: Rect): string[] {
  const right = area.x + area.width;
  const bottom = area.y + area.height;
  return elements
    .filter((element) => {
      if (element.hidden) return false;
      const box = boundsOfPoints(corners(element.transform));
      return (
        box.x <= right &&
        box.x + box.width >= area.x &&
        box.y <= bottom &&
        box.y + box.height >= area.y
      );
    })
    .map((element) => element.id);
}

/**
 * Ponto do documento → pixel da foto original (para a pipeta da remoção de fundo). Null
 * quando o ponto cai fora da imagem.
 */
export function sourcePoint(
  element: ImageElement,
  point: Point,
  source: { width: number; height: number },
): Point | null {
  const t = element.transform;
  let local = toLocal(t, point);
  if (t.flipX) local = { ...local, x: t.width - local.x };
  if (t.flipY) local = { ...local, y: t.height - local.y };
  const u = local.x / t.width;
  const v = local.y / t.height;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  const crop: Crop = element.crop ?? { x: 0, y: 0, width: source.width, height: source.height };
  return {
    x: Math.min(source.width - 1, Math.max(0, Math.floor(crop.x + u * crop.width))),
    y: Math.min(source.height - 1, Math.max(0, Math.floor(crop.y + v * crop.height))),
  };
}

/**
 * Maior recorte da foto com a proporção pedida (centralizado). Sem proporção, a foto toda.
 */
export function cropToAspect(
  source: { width: number; height: number },
  ratio: number | null,
): Crop {
  if (!ratio) return { x: 0, y: 0, width: source.width, height: source.height };
  let width = source.width;
  let height = source.height;
  if (source.width / source.height > ratio) width = Math.round(source.height * ratio);
  else height = Math.round(source.width / ratio);
  return {
    x: Math.round((source.width - width) / 2),
    y: Math.round((source.height - height) / 2),
    width,
    height,
  };
}

/**
 * Aplica um recorte à imagem mantendo a escala em que ela está na tela (o canto de cima à
 * esquerda não muda).
 */
export function applyCrop(
  element: ImageElement,
  crop: Crop | null,
  source: { width: number; height: number },
): ImageElement {
  const current = element.crop ?? { x: 0, y: 0, width: source.width, height: source.height };
  const next = crop ?? { x: 0, y: 0, width: source.width, height: source.height };
  const scale = current.width > 0 ? element.transform.width / current.width : 1;
  const whole =
    next.x === 0 && next.y === 0 && next.width === source.width && next.height === source.height;
  return {
    ...element,
    crop: crop === null || whole ? null : next,
    transform: {
      ...element.transform,
      width: Math.max(4, Math.round(next.width * scale)),
      height: Math.max(4, Math.round(next.height * scale)),
    },
  };
}

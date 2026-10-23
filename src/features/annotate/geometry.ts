/**
 * Geometria compartilhada pelo editor da captura (src/features/capture) e pelo Agzos Imagem
 * (src/features/image-studio): pontos, retângulos e as ajudas de arrasto (Shift). Pura.
 */

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };

/** Dois pontos → retângulo com largura e altura positivas. */
export function normRect(from: Point, to: Point): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}

/** Pontas da seta: os dois cantos do triângulo na ponta `to`. */
export function arrowHead(from: Point, to: Point, size: number): [Point, Point] {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const length = Math.max(10, size * 4);
  const spread = Math.PI / 7;
  return [
    {
      x: to.x - length * Math.cos(angle - spread),
      y: to.y - length * Math.sin(angle - spread),
    },
    {
      x: to.x - length * Math.cos(angle + spread),
      y: to.y - length * Math.sin(angle + spread),
    },
  ];
}

/** Linha presa a múltiplos de `step` (45° por padrão), mantendo o comprimento. */
export function snapAngle(from: Point, to: Point, step = Math.PI / 4): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  const length = Math.hypot(dx, dy);
  return { x: from.x + length * Math.cos(angle), y: from.y + length * Math.sin(angle) };
}

/** Quadrado: o lado maior manda, o sentido do arrasto é mantido. */
export function squareEnd(from: Point, to: Point): Point {
  const side = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  return {
    x: from.x + Math.sign(to.x - from.x || 1) * side,
    y: from.y + Math.sign(to.y - from.y || 1) * side,
  };
}

/** Forma sem tamanho (só um clique). */
export function isTinyRect(rect: Rect, min = 2): boolean {
  return rect.width < min && rect.height < min;
}

import type { Point, Rect } from "./geometry";
import { arrowHead, normRect } from "./geometry";

/**
 * Desenho compartilhado: setas, contador, texto com contorno, pixelar e desfocar. Recebe o
 * contexto do canvas; não guarda estado.
 */

export function readableOn(hex: string) {
  const value = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? "#111827" : "#ffffff";
}

/** Fonte do texto das anotações, proporcional à espessura. */
export function annotationFont(size: number) {
  return `600 ${Math.round(12 + size * 3)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
}

/** Haste + ponta de uma seta, com a cor atual do contexto. */
export function strokeArrow(
  context: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  size: number,
) {
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.stroke();
  const [left, right] = arrowHead(from, to, size);
  context.beginPath();
  context.moveTo(to.x, to.y);
  context.lineTo(left.x, left.y);
  context.lineTo(right.x, right.y);
  context.closePath();
  context.fill();
}

/** Elipse inscrita no retângulo. */
export function ellipsePath(context: CanvasRenderingContext2D, rect: Rect) {
  context.beginPath();
  context.ellipse(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
    rect.width / 2,
    rect.height / 2,
    0,
    0,
    Math.PI * 2,
  );
}

/** Bolinha com número (contador), centrada em `at`. */
export function drawCounter(
  context: CanvasRenderingContext2D,
  at: Point,
  n: number,
  color: string,
  size: number,
) {
  const radius = Math.round(10 + size * 2);
  context.beginPath();
  context.arc(at.x, at.y, radius, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();
  context.lineWidth = Math.max(2, radius / 6);
  context.strokeStyle = "#ffffff";
  context.stroke();
  context.fillStyle = readableOn(color);
  context.font = `700 ${Math.round(radius * 1.1)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(String(n), at.x, at.y + 1);
}

/** Linhas de texto com contorno fino na cor oposta: lê-se sobre qualquer fundo. */
export function drawOutlinedLines(
  context: CanvasRenderingContext2D,
  lines: string[],
  at: Point,
  lineHeight: number,
  color: string,
  outlineWidth: number,
) {
  context.textBaseline = "top";
  lines.forEach((line, index) => {
    context.lineWidth = outlineWidth;
    context.strokeStyle = readableOn(color) === "#ffffff" ? "#ffffffcc" : "#000000aa";
    context.strokeText(line, at.x, at.y + index * lineHeight);
    context.fillText(line, at.x, at.y + index * lineHeight);
  });
}

/** Pixelar ou desfocar uma região: refaz a área a partir da foto original (`base`). */
export function obscureRegion(
  context: CanvasRenderingContext2D,
  base: CanvasImageSource,
  rect: Rect,
  kind: "pixelate" | "blur",
  size: number,
) {
  const area = normRect(
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
  );
  const x = Math.round(area.x);
  const y = Math.round(area.y);
  const width = Math.round(area.width);
  const height = Math.round(area.height);
  if (width < 1 || height < 1) return;
  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();
  if (kind === "blur") {
    context.filter = `blur(${Math.max(4, size * 2)}px)`;
    context.drawImage(base, x, y, width, height, x, y, width, height);
  } else {
    const block = Math.max(6, size * 3);
    const small = document.createElement("canvas");
    small.width = Math.max(1, Math.ceil(width / block));
    small.height = Math.max(1, Math.ceil(height / block));
    small.getContext("2d")?.drawImage(base, x, y, width, height, 0, 0, small.width, small.height);
    context.imageSmoothingEnabled = false;
    context.drawImage(small, 0, 0, small.width, small.height, x, y, width, height);
  }
  context.restore();
}

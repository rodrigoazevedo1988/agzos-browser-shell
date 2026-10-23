import {
  isTinyRect,
  normRect,
  snapAngle,
  squareEnd,
  type Point,
  type Rect,
} from "../annotate/geometry";
import {
  commitTo,
  historyOf,
  redoOf,
  undoOf,
  type History as SharedHistory,
} from "../annotate/history";
import {
  annotationFont,
  drawCounter,
  drawOutlinedLines,
  ellipsePath,
  obscureRegion,
  strokeArrow,
} from "../annotate/paint";

export { arrowHead, normRect } from "../annotate/geometry";

/**
 * Editor da captura (4.9.7, no estilo do Flameshot): as anotações são formas em pixels da
 * imagem, desenhadas por cima da foto só ao exportar ou na tela de edição. Tudo aqui é
 * puro (menos o desenho, que recebe o contexto do canvas). A geometria, o histórico e o
 * desenho comuns vêm de src/features/annotate (também usados pelo Agzos Imagem).
 */

export type { Point } from "../annotate/geometry";

export type Tool =
  | "crop"
  | "pen"
  | "marker"
  | "line"
  | "arrow"
  | "rect"
  | "rect-fill"
  | "ellipse"
  | "text"
  | "counter"
  | "pixelate"
  | "blur";

export type Shape =
  | { kind: "pen" | "marker"; points: Point[]; color: string; size: number }
  | { kind: "line" | "arrow"; from: Point; to: Point; color: string; size: number }
  | {
      kind: "rect" | "rect-fill" | "ellipse" | "pixelate" | "blur";
      from: Point;
      to: Point;
      color: string;
      size: number;
    }
  | { kind: "text"; at: Point; text: string; color: string; size: number }
  | { kind: "counter"; at: Point; n: number; color: string; size: number };

export const CAPTURE_COLORS = [
  "#ef4444",
  "#f97316",
  "#facc15",
  "#22c55e",
  "#3b82f6",
  "#a855f7",
  "#ffffff",
  "#111827",
] as const;

/** Espessura: 1–40 px da imagem. */
export const CAPTURE_SIZE = { min: 1, max: 40, initial: 4 } as const;

/** Ferramentas que nascem de um arrasto entre dois pontos. */
export function isDragTool(tool: Tool) {
  return (
    tool === "line" ||
    tool === "arrow" ||
    tool === "rect" ||
    tool === "rect-fill" ||
    tool === "ellipse" ||
    tool === "pixelate" ||
    tool === "blur"
  );
}

/** Forma sem tamanho (só um clique): não entra no histórico. */
export function isEmptyShape(shape: Shape) {
  switch (shape.kind) {
    case "pen":
    case "marker":
      return shape.points.length < 2;
    case "text":
      return !shape.text.trim();
    case "counter":
      return false;
    default:
      return isTinyRect(normRect(shape.from, shape.to));
  }
}

/** Próximo número do contador (1, 2, 3… sem pular depois de desfazer). */
export function nextCounter(shapes: Shape[]) {
  return (
    shapes.reduce((max, shape) => (shape.kind === "counter" ? Math.max(max, shape.n) : max), 0) + 1
  );
}

/** Shift no arrasto: linha/seta presa a 45°, retângulo/elipse quadrados. */
export function constrain(tool: Tool, from: Point, to: Point): Point {
  return tool === "line" || tool === "arrow" ? snapAngle(from, to) : squareEnd(from, to);
}

// --- Histórico (desfazer/refazer) ---

export type History = SharedHistory<Shape[]>;

export const emptyHistory: History = historyOf<Shape[]>([]);

export function commit(history: History, shapes: Shape[]): History {
  return commitTo(history, shapes);
}

export function undo(history: History): History {
  return undoOf(history);
}

export function redo(history: History): History {
  return redoOf(history);
}

// --- Desenho ---

/** Fonte do texto e do contador, proporcional à espessura. */
export function textFont(size: number) {
  return annotationFont(size);
}

export function drawShape(
  context: CanvasRenderingContext2D,
  shape: Shape,
  base: CanvasImageSource,
) {
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = shape.color;
  context.fillStyle = shape.color;
  context.lineWidth = shape.size;
  switch (shape.kind) {
    case "pen":
    case "marker": {
      if (shape.kind === "marker") {
        // Marca-texto: traço largo, translúcido, que não escurece onde se cruza.
        context.globalAlpha = 0.38;
        context.globalCompositeOperation = "multiply";
        context.lineWidth = shape.size * 4;
        context.lineCap = "square";
      }
      context.beginPath();
      shape.points.forEach((point, index) =>
        index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y),
      );
      context.stroke();
      break;
    }
    case "line":
      context.beginPath();
      context.moveTo(shape.from.x, shape.from.y);
      context.lineTo(shape.to.x, shape.to.y);
      context.stroke();
      break;
    case "arrow":
      strokeArrow(context, shape.from, shape.to, shape.size);
      break;
    case "rect":
    case "rect-fill": {
      const rect = normRect(shape.from, shape.to);
      if (shape.kind === "rect-fill") {
        context.globalAlpha = 0.85;
        context.fillRect(rect.x, rect.y, rect.width, rect.height);
      } else context.strokeRect(rect.x, rect.y, rect.width, rect.height);
      break;
    }
    case "ellipse":
      ellipsePath(context, normRect(shape.from, shape.to));
      context.stroke();
      break;
    case "pixelate":
    case "blur":
      obscureRegion(context, base, normRect(shape.from, shape.to), shape.kind, shape.size);
      break;
    case "text":
      context.font = textFont(shape.size);
      drawOutlinedLines(
        context,
        shape.text.split("\n"),
        shape.at,
        Math.round((12 + shape.size * 3) * 1.25),
        shape.color,
        Math.max(2, shape.size / 2),
      );
      break;
    case "counter":
      drawCounter(context, shape.at, shape.n, shape.color, shape.size);
      break;
  }
  context.restore();
}

/** Foto + anotações → canvas (recortado, se houver região). */
export function renderCapture(
  base: HTMLImageElement,
  shapes: Shape[],
  crop: Rect | null,
): HTMLCanvasElement {
  const full = document.createElement("canvas");
  full.width = base.naturalWidth;
  full.height = base.naturalHeight;
  const context = full.getContext("2d")!;
  context.drawImage(base, 0, 0);
  for (const shape of shapes) drawShape(context, shape, base);
  if (!crop) return full;
  const out = document.createElement("canvas");
  out.width = crop.width;
  out.height = crop.height;
  out
    .getContext("2d")!
    .drawImage(full, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  return out;
}

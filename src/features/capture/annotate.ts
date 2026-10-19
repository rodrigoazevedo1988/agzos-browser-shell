import type { Rect } from "./compose";

/**
 * Editor da captura (4.9.7, no estilo do Flameshot): as anotações são formas em pixels da
 * imagem, desenhadas por cima da foto só ao exportar ou na tela de edição. Tudo aqui é
 * puro (menos o desenho, que recebe o contexto do canvas).
 */

export type Point = { x: number; y: number };

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

/** Dois pontos → retângulo com largura e altura positivas. */
export function normRect(from: Point, to: Point): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
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
    default: {
      const rect = normRect(shape.from, shape.to);
      return rect.width < 2 && rect.height < 2;
    }
  }
}

/** Próximo número do contador (1, 2, 3… sem pular depois de desfazer). */
export function nextCounter(shapes: Shape[]) {
  return (
    shapes.reduce((max, shape) => (shape.kind === "counter" ? Math.max(max, shape.n) : max), 0) + 1
  );
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

/** Shift no arrasto: linha/seta presa a 45°, retângulo/elipse quadrados. */
export function constrain(tool: Tool, from: Point, to: Point): Point {
  if (tool === "line" || tool === "arrow") {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const step = Math.PI / 4;
    const angle = Math.round(Math.atan2(dy, dx) / step) * step;
    const length = Math.hypot(dx, dy);
    return { x: from.x + length * Math.cos(angle), y: from.y + length * Math.sin(angle) };
  }
  const side = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  return {
    x: from.x + Math.sign(to.x - from.x || 1) * side,
    y: from.y + Math.sign(to.y - from.y || 1) * side,
  };
}

// --- Histórico (desfazer/refazer) ---

export type History = { past: Shape[][]; present: Shape[]; future: Shape[][] };

export const emptyHistory: History = { past: [], present: [], future: [] };

export function commit(history: History, shapes: Shape[]): History {
  return { past: [...history.past, history.present].slice(-200), present: shapes, future: [] };
}

export function undo(history: History): History {
  const previous = history.past[history.past.length - 1];
  if (!previous) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redo(history: History): History {
  const [next, ...rest] = history.future;
  if (!next) return history;
  return { past: [...history.past, history.present], present: next, future: rest };
}

// --- Desenho ---

/** Fonte do texto e do contador, proporcional à espessura. */
export function textFont(size: number) {
  return `600 ${Math.round(12 + size * 3)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
}

function readableOn(hex: string) {
  const value = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? "#111827" : "#ffffff";
}

/** Pixelar ou desfocar: refaz a área a partir da foto original (`base`). */
function obscure(
  context: CanvasRenderingContext2D,
  base: CanvasImageSource,
  rect: Rect,
  kind: "pixelate" | "blur",
  size: number,
) {
  const x = Math.round(rect.x);
  const y = Math.round(rect.y);
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);
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
    case "arrow": {
      context.beginPath();
      context.moveTo(shape.from.x, shape.from.y);
      context.lineTo(shape.to.x, shape.to.y);
      context.stroke();
      if (shape.kind === "arrow") {
        const [left, right] = arrowHead(shape.from, shape.to, shape.size);
        context.beginPath();
        context.moveTo(shape.to.x, shape.to.y);
        context.lineTo(left.x, left.y);
        context.lineTo(right.x, right.y);
        context.closePath();
        context.fill();
      }
      break;
    }
    case "rect":
    case "rect-fill": {
      const rect = normRect(shape.from, shape.to);
      if (shape.kind === "rect-fill") {
        context.globalAlpha = 0.85;
        context.fillRect(rect.x, rect.y, rect.width, rect.height);
      } else context.strokeRect(rect.x, rect.y, rect.width, rect.height);
      break;
    }
    case "ellipse": {
      const rect = normRect(shape.from, shape.to);
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
      context.stroke();
      break;
    }
    case "pixelate":
    case "blur":
      obscure(context, base, normRect(shape.from, shape.to), shape.kind, shape.size);
      break;
    case "text": {
      context.font = textFont(shape.size);
      context.textBaseline = "top";
      const lineHeight = Math.round((12 + shape.size * 3) * 1.25);
      shape.text.split("\n").forEach((line, index) => {
        // Contorno fino na cor oposta: o texto se lê sobre qualquer fundo.
        context.lineWidth = Math.max(2, shape.size / 2);
        context.strokeStyle = readableOn(shape.color) === "#ffffff" ? "#ffffffcc" : "#000000aa";
        context.strokeText(line, shape.at.x, shape.at.y + index * lineHeight);
        context.fillText(line, shape.at.x, shape.at.y + index * lineHeight);
      });
      break;
    }
    case "counter": {
      const radius = Math.round(10 + shape.size * 2);
      context.beginPath();
      context.arc(shape.at.x, shape.at.y, radius, 0, Math.PI * 2);
      context.fill();
      context.lineWidth = Math.max(2, radius / 6);
      context.strokeStyle = "#ffffff";
      context.stroke();
      context.fillStyle = readableOn(shape.color);
      context.font = `700 ${Math.round(radius * 1.1)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(String(shape.n), shape.at.x, shape.at.y + 1);
      break;
    }
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

import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import type { Point, Rect } from "../annotate/geometry";
import { parseHex } from "./filters";
import { newId } from "./assets";
import {
  boundsOf,
  corners,
  handleAxes,
  handlePoints,
  marqueeHits,
  resizeTransform,
  rotateMember,
  rotationTo,
  RESIZE_HANDLES,
  scaleMember,
  snapMove,
  snapTargets,
  sourcePoint,
  toDoc,
  topmostAt,
  type Guide,
  type HandleId,
} from "./transform";
import {
  findElement,
  moveElements,
  newShape,
  newText,
  transformAt,
  type Assets,
  type Doc,
  type Element,
  type ImageElement,
  type Transform,
} from "./model";
import { fittedTextHeight, renderDoc, type ImageCache } from "./render";
import { FONT_CHOICES } from "./text";
import type { Tool } from "./tools";

export type View = { zoom: number; panX: number; panY: number; fit: boolean };
type Crop = { id: string; x: number; y: number; width: number; height: number };

export type StageProps = {
  doc: Doc;
  assets: Assets;
  cache: ImageCache;
  selection: string[];
  tool: Tool;
  view: View;
  /** Recorte pendente da foto selecionada (painel): contorno sobre a foto. */
  crop: Crop | null;
  editingId: string | null;
  /** Muda quando uma foto termina de carregar: repinta. */
  paintKey: number;
  onView(view: View): void;
  onSelect(ids: string[], mode: "replace" | "toggle" | "add"): void;
  onPreview(doc: Doc): void;
  onCommit(label: string, doc: Doc): void;
  onCreate(element: Element, label: string): void;
  onPick(id: string, color: string): void;
  onEdit(id: string | null): void;
  onToolDone(): void;
};

type Gesture =
  | { kind: "pan"; x: number; y: number; panX: number; panY: number }
  | { kind: "move"; start: Point; base: Doc; ids: string[]; box: Rect; moved: boolean }
  | {
      kind: "resize";
      handle: Exclude<HandleId, "rotate">;
      base: Doc;
      ids: string[];
      group: boolean;
      start: Transform;
      moved: boolean;
    }
  | {
      kind: "rotate";
      base: Doc;
      ids: string[];
      center: Point;
      startAngle: number;
      group: boolean;
      moved: boolean;
    }
  | { kind: "marquee"; start: Point; now: Point; additive: boolean }
  | { kind: "draw"; tool: DrawTool; start: Point; now: Point };

type DrawTool = "rect" | "round" | "ellipse" | "line" | "arrow" | "star" | "polygon";
const DRAW_TOOLS = new Set<string>([
  "rect",
  "round",
  "ellipse",
  "line",
  "arrow",
  "star",
  "polygon",
]);
const LINE_TOOLS = new Set<string>(["line", "arrow"]);
const SQUARE_TOOLS = new Set<string>(["rect", "round", "ellipse"]);
const DEFAULT_COLOR = "#D10A11";

const LABELS: Record<DrawTool, string> = {
  rect: "Adicionar retângulo",
  round: "Adicionar retângulo arredondado",
  ellipse: "Adicionar elipse",
  line: "Adicionar linha",
  arrow: "Adicionar seta",
  star: "Adicionar estrela",
  polygon: "Adicionar polígono",
};

const outlineOf = (transform: Transform) =>
  corners(transform)
    .map((p) => `${p.x},${p.y}`)
    .join(" ");

function normalize(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

function centerOf(t: Transform): Point {
  return { x: t.x + t.width / 2, y: t.y + t.height / 2 };
}

function isTyping(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/** Forma em criação a partir do arrasto (Shift prende ângulo ou quadrado). */
function draftFor(
  tool: DrawTool,
  start: Point,
  now: Point,
  shift: boolean,
  zoom: number,
  final: boolean,
): Element {
  let end = now;
  if (shift && SQUARE_TOOLS.has(tool)) {
    const side = Math.max(Math.abs(now.x - start.x), Math.abs(now.y - start.y));
    end = {
      x: start.x + Math.sign(now.x - start.x || 1) * side,
      y: start.y + Math.sign(now.y - start.y || 1) * side,
    };
  } else if (shift && LINE_TOOLS.has(tool)) {
    const step = Math.PI / 4;
    const angle = Math.round(Math.atan2(now.y - start.y, now.x - start.x) / step) * step;
    const length = Math.hypot(now.x - start.x, now.y - start.y);
    end = { x: start.x + length * Math.cos(angle), y: start.y + length * Math.sin(angle) };
  }
  const box = normalize(start, end);
  const isLine = LINE_TOOLS.has(tool);
  // Clique sem arrasto: uma forma de tamanho padrão nasce centrada no ponto.
  const click = final && box.width < 3 / zoom && box.height < 3 / zoom;
  const width = click ? 240 : box.width;
  const height = click ? (isLine ? 0 : 240) : box.height;
  const x = click ? start.x - width / 2 : box.x;
  const y = click ? start.y - height / 2 : box.y;
  const transform: Transform = {
    x,
    y,
    width,
    height,
    rotation: 0,
    flipX: isLine && end.x < start.x,
    flipY: isLine && end.y < start.y,
  };
  const shape = tool === "round" ? "round" : tool;
  const element = newShape(
    final ? newId("s") : "draft",
    shape,
    transform,
    isLine ? { fill: null, stroke: DEFAULT_COLOR } : { fill: DEFAULT_COLOR, stroke: null },
  );
  if (isLine) element.strokeWidth = 8;
  return element;
}

function replaceTransform(doc: Doc, id: string, transform: Transform): Doc {
  return {
    ...doc,
    elements: doc.elements.map((element) =>
      element.id === id ? ({ ...element, transform } as Element) : element,
    ),
  };
}

function mapTransforms(doc: Doc, ids: string[], change: (t: Transform) => Transform): Doc {
  return {
    ...doc,
    elements: doc.elements.map((element) =>
      ids.includes(element.id) && !element.locked
        ? ({ ...element, transform: change(element.transform) } as Element)
        : element,
    ),
  };
}

/** Contorno do recorte pendente, na mesma transformação da foto. */
function cropOutline(element: ImageElement, crop: Crop, assets: Assets): string {
  const asset = assets[element.asset];
  const current = element.crop ?? {
    x: 0,
    y: 0,
    width: asset?.width ?? crop.width,
    height: asset?.height ?? crop.height,
  };
  const sx = current.width ? element.transform.width / current.width : 1;
  const sy = current.height ? element.transform.height / current.height : 1;
  const local = (x: number, y: number) => ({ x: (x - current.x) * sx, y: (y - current.y) * sy });
  return [
    local(crop.x, crop.y),
    local(crop.x + crop.width, crop.y),
    local(crop.x + crop.width, crop.y + crop.height),
    local(crop.x, crop.y + crop.height),
  ]
    .map((p) => {
      const d = toDoc(element.transform, p);
      return `${d.x},${d.y}`;
    })
    .join(" ");
}

/** Cor (hex) do pixel da foto, para a remoção de fundo. */
function sampleColor(image: HTMLImageElement, x: number, y: number): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, x, y, 1, 1, 0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
  const hex =
    `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
  return parseHex(hex) ? hex : null;
}

export function Stage(props: StageProps) {
  const { doc, assets, cache, selection, tool, view, crop, editingId, paintKey } = props;
  const latest = useRef(props);
  latest.current = props;
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const liveDoc = useRef<Doc>(doc);
  liveDoc.current = doc;
  const spaceDown = useRef(false);
  const [draft, setDraft] = useState<Element | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const W = doc.width;
  const H = doc.height;
  const { zoom, panX, panY } = view;
  const originX = size.width / 2 - (W * zoom) / 2 + panX;
  const originY = size.height / 2 - (H * zoom) / 2 + panY;

  // Área de edição: medida e acompanhada.
  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      setSize({ width: box.width, height: box.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Modo "ajustar": encaixa o documento na área sempre que ela muda de tamanho.
  useEffect(() => {
    const current = latest.current.view;
    if (!current.fit || !size.width || !size.height) return;
    const next = Math.max(0.05, Math.min((size.width - 64) / W, (size.height - 64) / H, 4));
    if (Math.abs(next - current.zoom) > 0.0005 || current.panX || current.panY) {
      latest.current.onView({ zoom: next, panX: 0, panY: 0, fit: true });
    }
  }, [W, H, size.width, size.height, view.fit]);

  // Pintura do documento (um quadro por mudança).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const frame = requestAnimationFrame(() => {
      const scale = Math.min((window.devicePixelRatio || 1) * zoom, 8192 / Math.max(W, H));
      canvas.width = Math.max(1, Math.round(W * scale));
      canvas.height = Math.max(1, Math.round(H * scale));
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
      renderDoc(context, doc, { assets, cache });
    });
    return () => cancelAnimationFrame(frame);
  }, [doc, assets, cache, zoom, W, H, paintKey]);

  // Espaço segura o modo mão (fora de campos de texto).
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code === "Space" && !isTyping(event.target)) spaceDown.current = true;
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") spaceDown.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // Roda: Ctrl zooma no cursor (sem zoom da página); sem Ctrl, rola. Passivo = false para
  // poder cancelar o zoom do navegador.
  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const current = latest.current;
      const v = current.view;
      if (event.ctrlKey || event.metaKey) {
        const box = element.getBoundingClientRect();
        const cursorX = event.clientX - box.left;
        const cursorY = event.clientY - box.top;
        const next = Math.min(8, Math.max(0.05, v.zoom * Math.exp(-event.deltaY * 0.0015)));
        const ox = box.width / 2 - (current.doc.width * v.zoom) / 2 + v.panX;
        const oy = box.height / 2 - (current.doc.height * v.zoom) / 2 + v.panY;
        const docX = (cursorX - ox) / v.zoom;
        const docY = (cursorY - oy) / v.zoom;
        current.onView({
          zoom: next,
          fit: false,
          panX: cursorX - docX * next - box.width / 2 + (current.doc.width * next) / 2,
          panY: cursorY - docY * next - box.height / 2 + (current.doc.height * next) / 2,
        });
        return;
      }
      current.onView({
        ...v,
        fit: false,
        panX: v.panX - event.deltaX,
        panY: v.panY - event.deltaY,
      });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  const toDocPoint = (clientX: number, clientY: number): Point => {
    const box = stageRef.current?.getBoundingClientRect();
    const left = box?.left ?? 0;
    const top = box?.top ?? 0;
    return { x: (clientX - left - originX) / zoom, y: (clientY - top - originY) / zoom };
  };

  /** Caixa da seleção: a do elemento (girada) ou a do grupo (sem giro). */
  const selectionBox = (): { transform: Transform; group: boolean } | null => {
    const chosen = doc.elements.filter((element) => selection.includes(element.id));
    if (!chosen.length) return null;
    if (chosen.length === 1) return { transform: chosen[0]!.transform, group: false };
    const box = boundsOf(chosen);
    return box
      ? { transform: transformAt(box.x, box.y, box.width, box.height), group: true }
      : null;
  };

  const handleAt = (point: Point): HandleId | null => {
    const box = selectionBox();
    if (!box) return null;
    const single = box.group
      ? undefined
      : doc.elements.find((element) => selection.includes(element.id));
    if (single?.locked) return null;
    const points = handlePoints(box.transform, zoom);
    const tolerance = 9 / zoom;
    const near = (at: Point) => Math.hypot(at.x - point.x, at.y - point.y) < tolerance;
    if (!box.group && near(points.rotate)) return "rotate";
    return RESIZE_HANDLES.find((id) => near(points[id])) ?? null;
  };

  const beginMove = (point: Point, ids: string[]) => {
    const base = liveDoc.current;
    const chosen = base.elements.filter((element) => ids.includes(element.id) && !element.locked);
    const box = boundsOf(chosen) ?? { x: 0, y: 0, width: 0, height: 0 };
    gesture.current = { kind: "move", start: point, base, ids, box, moved: false };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    stageRef.current?.focus({ preventScroll: true });
    const point = toDocPoint(event.clientX, event.clientY);
    if (event.button === 1 || spaceDown.current || tool === "hand") {
      gesture.current = { kind: "pan", x: event.clientX, y: event.clientY, panX, panY };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (editingId) latest.current.onEdit(null);
    const top = doc.elements.slice().reverse();
    if (tool === "pick") {
      const hit = topmostAt(top, point);
      if (hit?.kind === "image") {
        const asset = assets[hit.asset];
        const image = asset ? cache.get(asset) : null;
        const source = image
          ? sourcePoint(hit, point, { width: image.naturalWidth, height: image.naturalHeight })
          : null;
        const color = image && source ? sampleColor(image, source.x, source.y) : null;
        if (color) latest.current.onPick(hit.id, color);
      }
      latest.current.onToolDone();
      return;
    }
    if (tool === "text") {
      const element = newText(
        newId("t"),
        transformAt(point.x, point.y, 480, 120),
        "Texto",
        96,
        "#0E0E0E",
      );
      element.transform.height = fittedTextHeight(element);
      latest.current.onCreate(element, "Adicionar texto");
      latest.current.onToolDone();
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    if (DRAW_TOOLS.has(tool)) {
      gesture.current = { kind: "draw", tool: tool as DrawTool, start: point, now: point };
      return;
    }
    const handle = handleAt(point);
    const box = selectionBox();
    if (handle && box) {
      if (handle === "rotate") {
        const center = centerOf(box.transform);
        gesture.current = {
          kind: "rotate",
          base: liveDoc.current,
          ids: [...selection],
          center,
          startAngle: rotationTo(center, point),
          group: box.group,
          moved: false,
        };
      } else {
        gesture.current = {
          kind: "resize",
          handle,
          base: liveDoc.current,
          ids: [...selection],
          group: box.group,
          start: box.transform,
          moved: false,
        };
      }
      return;
    }
    const hit = topmostAt(top, point, 4 / zoom);
    if (hit) {
      if (event.shiftKey) {
        if (selection.includes(hit.id)) {
          latest.current.onSelect([hit.id], "toggle");
          gesture.current = null;
          return;
        }
        latest.current.onSelect([hit.id], "add");
        beginMove(point, [...selection, hit.id]);
        return;
      }
      if (selection.includes(hit.id)) beginMove(point, [...selection]);
      else {
        latest.current.onSelect([hit.id], "replace");
        beginMove(point, [hit.id]);
      }
      return;
    }
    if (!event.shiftKey) latest.current.onSelect([], "replace");
    gesture.current = { kind: "marquee", start: point, now: point, additive: event.shiftKey };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    const point = toDocPoint(event.clientX, event.clientY);
    if (!current) return;
    const { onPreview, onView } = latest.current;
    if (current.kind === "pan") {
      onView({
        ...latest.current.view,
        fit: false,
        panX: current.panX + event.clientX - current.x,
        panY: current.panY + event.clientY - current.y,
      });
      return;
    }
    if (current.kind === "marquee") {
      current.now = point;
      setMarquee(normalize(current.start, point));
      return;
    }
    if (current.kind === "draw") {
      current.now = point;
      setDraft(draftFor(current.tool, current.start, point, event.shiftKey, zoom, false));
      return;
    }
    if (current.kind === "move") {
      const dx = point.x - current.start.x;
      const dy = point.y - current.start.y;
      if (!current.moved && Math.hypot(dx, dy) * zoom < 3) return;
      current.moved = true;
      const snap = event.altKey
        ? { dx: 0, dy: 0, guides: [] as Guide[] }
        : snapMove(
            { ...current.box, x: current.box.x + dx, y: current.box.y + dy },
            snapTargets(current.base, current.ids),
            6 / zoom,
          );
      setGuides(snap.guides);
      onPreview(moveElements(current.base, current.ids, dx + snap.dx, dy + snap.dy));
      return;
    }
    if (current.kind === "resize") {
      current.moved = true;
      const corner = current.handle.length === 2;
      const next = resizeTransform(current.start, current.handle, point, {
        keepRatio: event.shiftKey && corner,
      });
      if (!current.group) {
        const id = current.ids[0];
        if (id) onPreview(replaceTransform(current.base, id, next));
        return;
      }
      // Grupo: escala cada membro em torno da âncora oposta à alça.
      const box = current.start;
      const axes = handleAxes(current.handle);
      const anchor = { x: box.x + (1 - axes.x) * box.width, y: box.y + (1 - axes.y) * box.height };
      const sx = box.width ? next.width / box.width : 1;
      const sy = box.height ? next.height / box.height : 1;
      onPreview(mapTransforms(current.base, current.ids, (t) => scaleMember(t, anchor, sx, sy)));
      return;
    }
    if (current.kind === "rotate") {
      current.moved = true;
      const angle = rotationTo(current.center, point, event.shiftKey);
      if (!current.group) {
        const id = current.ids[0];
        const element = current.base.elements.find((item) => item.id === id);
        if (element)
          onPreview(
            replaceTransform(current.base, element.id, { ...element.transform, rotation: angle }),
          );
        return;
      }
      const delta = angle - current.startAngle;
      onPreview(
        mapTransforms(current.base, current.ids, (t) => rotateMember(t, current.center, delta)),
      );
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    gesture.current = null;
    setGuides([]);
    if (!current) return;
    if (current.kind === "marquee") {
      const area = normalize(current.start, current.now);
      setMarquee(null);
      if (area.width > 2 / zoom || area.height > 2 / zoom) {
        const hits = marqueeHits(liveDoc.current.elements, area);
        latest.current.onSelect(hits, current.additive ? "add" : "replace");
      }
      return;
    }
    if (current.kind === "draw") {
      const element = draftFor(
        current.tool,
        current.start,
        current.now,
        event.shiftKey,
        zoom,
        true,
      );
      setDraft(null);
      latest.current.onCreate(element, LABELS[current.tool]);
      latest.current.onToolDone();
      return;
    }
    if (current.kind === "pan" || !current.moved) return;
    const label =
      current.kind === "move" ? "Mover" : current.kind === "rotate" ? "Girar" : "Redimensionar";
    latest.current.onCommit(label, liveDoc.current);
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const hit = topmostAt(
      doc.elements.slice().reverse(),
      toDocPoint(event.clientX, event.clientY),
      4 / zoom,
    );
    if (hit?.kind === "text") {
      latest.current.onSelect([hit.id], "replace");
      latest.current.onEdit(hit.id);
    }
  };

  const box = selectionBox();
  const points = box ? handlePoints(box.transform, zoom) : null;
  const editing = editingId ? findElement(doc, editingId) : undefined;
  const cropped = crop ? findElement(doc, crop.id) : undefined;
  const cursor =
    gesture.current?.kind === "pan" || tool === "hand"
      ? "grab"
      : tool === "select"
        ? "default"
        : "crosshair";

  return (
    <div
      ref={stageRef}
      className={`ims-stage${doc.background ? "" : " is-transparent"}`}
      tabIndex={-1}
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      role="application"
      aria-label="Área de edição"
    >
      <div
        className="ims-doc"
        style={{ left: originX, top: originY, width: W * zoom, height: H * zoom }}
      >
        <canvas ref={canvasRef} className="ims-canvas" width={W} height={H} />
        <svg
          className="ims-overlay"
          viewBox={`0 0 ${W} ${H}`}
          width={W * zoom}
          height={H * zoom}
          aria-hidden="true"
        >
          {doc.elements
            .filter((element) => selection.includes(element.id) && !element.hidden)
            .map((element) => (
              <polygon
                key={element.id}
                points={outlineOf(element.transform)}
                className="ims-sel"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          {box && points && (
            <g>
              {box.group && (
                <polygon
                  points={outlineOf(box.transform)}
                  className="ims-sel ims-sel-group"
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {!box.group && (
                <line
                  x1={points.n.x}
                  y1={points.n.y}
                  x2={points.rotate.x}
                  y2={points.rotate.y}
                  className="ims-stem"
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {RESIZE_HANDLES.map((id) => (
                <rect
                  key={id}
                  x={points[id].x - 4 / zoom}
                  y={points[id].y - 4 / zoom}
                  width={8 / zoom}
                  height={8 / zoom}
                  className="ims-handle"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {!box.group && (
                <circle
                  cx={points.rotate.x}
                  cy={points.rotate.y}
                  r={5 / zoom}
                  className="ims-rotate"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </g>
          )}
          {cropped?.kind === "image" && crop && (
            <polygon
              points={cropOutline(cropped, crop, assets)}
              className="ims-crop"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {guides.map((guide) =>
            guide.axis === "x" ? (
              <line
                key={`x${guide.at}`}
                x1={guide.at}
                y1={0}
                x2={guide.at}
                y2={H}
                className="ims-guide"
                vectorEffect="non-scaling-stroke"
              />
            ) : (
              <line
                key={`y${guide.at}`}
                x1={0}
                y1={guide.at}
                x2={W}
                y2={guide.at}
                className="ims-guide"
                vectorEffect="non-scaling-stroke"
              />
            ),
          )}
          {draft && (
            <polygon
              points={outlineOf(draft.transform)}
              className="ims-draft"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {marquee && (
          <div
            className="ims-marquee"
            style={{
              left: marquee.x * zoom,
              top: marquee.y * zoom,
              width: marquee.width * zoom,
              height: marquee.height * zoom,
            }}
          />
        )}
        {editing?.kind === "text" && (
          <TextEditor
            key={editing.id}
            element={editing}
            zoom={zoom}
            onChange={(value) => {
              const next = { ...editing, text: value, transform: { ...editing.transform } };
              next.transform.height = fittedTextHeight(next);
              latest.current.onPreview({
                ...liveDoc.current,
                elements: liveDoc.current.elements.map((item) =>
                  item.id === next.id ? next : item,
                ),
              });
            }}
            onDone={() => {
              latest.current.onEdit(null);
              latest.current.onCommit("Editar texto", liveDoc.current);
            }}
          />
        )}
      </div>
    </div>
  );
}

function TextEditor({
  element,
  zoom,
  onChange,
  onDone,
}: {
  element: Extract<Element, { kind: "text" }>;
  zoom: number;
  onChange(value: string): void;
  onDone(): void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const t = element.transform;
  const stack =
    FONT_CHOICES.find((choice) => choice.family === element.font)?.stack ??
    `"${element.font}", sans-serif`;
  return (
    <textarea
      ref={ref}
      className="ims-text-edit"
      aria-label="Texto do elemento"
      value={element.text}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onDone}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape" || (event.key === "Enter" && (event.ctrlKey || event.metaKey))) {
          event.preventDefault();
          event.stopPropagation();
          onDone();
        }
      }}
      style={{
        left: t.x * zoom,
        top: t.y * zoom,
        width: t.width * zoom,
        minHeight: t.height * zoom,
        transform: `rotate(${t.rotation}deg)`,
        font: `${element.weight} ${element.size * zoom}px ${stack}`,
        lineHeight: element.lineHeight,
        color: element.color,
        textAlign: element.align,
      }}
    />
  );
}

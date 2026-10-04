import {
  ChevronLeft,
  ChevronRight,
  Circle,
  Highlighter,
  ImagePlus,
  MessageSquare,
  MousePointer2,
  PenLine,
  Minus,
  Square,
  Stamp,
  Trash2,
  Type,
} from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { cn } from "@/lib/utils";

import { pdfCall } from "./client";
import type { EditItem, FractionBox, Watermark } from "./engine";
import { parsePageRanges } from "./engine";
import { PageCanvas } from "./viewer";
import type { ToolContext } from "./state";

type Mode =
  "select" | "text" | "rect" | "ellipse" | "line" | "highlight" | "comment" | "image" | "signature";

const MODES: { id: Mode; label: string; icon: typeof Type }[] = [
  { id: "select", label: "Selecionar e mover", icon: MousePointer2 },
  { id: "text", label: "Texto", icon: Type },
  { id: "rect", label: "Retângulo", icon: Square },
  { id: "ellipse", label: "Elipse", icon: Circle },
  { id: "line", label: "Linha", icon: Minus },
  { id: "highlight", label: "Marca-texto", icon: Highlighter },
  { id: "comment", label: "Comentário", icon: MessageSquare },
  { id: "image", label: "Imagem", icon: ImagePlus },
  { id: "signature", label: "Assinatura desenhada", icon: PenLine },
];

type Draft = EditItem & { id: number };

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Arquivo de imagem → PNG (o motor embute PNG). */
async function imageToPng(file: File): Promise<{ png: Uint8Array; ratio: number }> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("imagem");
  return { png: new Uint8Array(await blob.arrayBuffer()), ratio: canvas.height / canvas.width };
}

export function EditTool(ctx: ToolContext & { author: string }) {
  const pageCount = ctx.doc.info.pages.length;
  const [page, setPage] = useState(0);
  const [mode, setMode] = useState<Mode>("text");
  const [items, setItems] = useState<Draft[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [color, setColor] = useState("#d10a11");
  const [size, setSize] = useState(14);
  const [stroke, setStroke] = useState(2);
  const [fill, setFill] = useState(false);
  const [pendingImage, setPendingImage] = useState<{
    png: Uint8Array;
    ratio: number;
    kind: "image" | "signature";
  } | null>(null);
  const [signing, setSigning] = useState(false);
  const [mark, setMark] = useState<Watermark & { range: string }>({
    text: "CONFIDENCIAL",
    size: 64,
    opacity: 0.18,
    color: "#d10a11",
    angle: 35,
    pages: [],
    range: "",
  });
  const [width, setWidth] = useState(640);
  const holder = useRef<HTMLDivElement | null>(null);
  const drawing = useRef<{ id: number; x: number; y: number; move?: { box: FractionBox } } | null>(
    null,
  );
  const seq = useRef(1);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Largura da página = largura da área (até 900 px).
  useEffect(() => {
    const node = holder.current;
    if (!node) return;
    const observer = new ResizeObserver(() =>
      setWidth(Math.max(280, Math.min(900, Math.floor(node.clientWidth - 32)))),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Delete apaga o item escolhido.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (selected === null || (event.target as HTMLElement).closest("input, textarea")) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        setItems((list) => list.filter((item) => item.id !== selected));
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const point = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height),
    };
  };

  const newItem = (box: FractionBox): Draft | null => {
    const id = seq.current++;
    switch (mode) {
      case "text":
        return { id, kind: "text", page, box, text: "Texto", color, size };
      case "rect":
      case "ellipse":
        return { id, kind: mode, page, box, color, fill, width: stroke };
      case "line":
        return { id, kind: "line", page, box, color, width: stroke };
      case "highlight":
        return { id, kind: "highlight", page, box, color: "#ffd43b" };
      case "comment":
        return { id, kind: "comment", page, box, text: "", author: ctx.author };
      case "image":
      case "signature":
        if (!pendingImage) return null;
        return { id, kind: pendingImage.kind, page, box, png: pendingImage.png };
      default:
        return null;
    }
  };

  const onDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-item]");
    const at = point(event);
    if (target) {
      const id = Number(target.dataset["item"]);
      const item = items.find((entry) => entry.id === id);
      setSelected(id);
      if (item && mode === "select") {
        event.currentTarget.setPointerCapture(event.pointerId);
        drawing.current = { id, x: at.x, y: at.y, move: { box: item.box } };
      }
      return;
    }
    if (mode === "select") {
      setSelected(null);
      return;
    }
    if ((mode === "image" || mode === "signature") && !pendingImage) {
      if (mode === "image") fileRef.current?.click();
      else setSigning(true);
      return;
    }
    const item = newItem({ x: at.x, y: at.y, w: 0, h: 0 });
    if (!item) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = { id: item.id, x: at.x, y: at.y };
    setItems((list) => [...list, item]);
    setSelected(item.id);
  };

  const onMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drawing.current;
    if (!current) return;
    const at = point(event);
    setItems((list) =>
      list.map((item) => {
        if (item.id !== current.id) return item;
        if (current.move) {
          const box = current.move.box;
          return {
            ...item,
            box: {
              ...box,
              x: clamp01(Math.min(1 - box.w, box.x + at.x - current.x)),
              y: clamp01(Math.min(1 - box.h, box.y + at.y - current.y)),
            },
          };
        }
        let w = Math.abs(at.x - current.x);
        let h = Math.abs(at.y - current.y);
        // Imagem/assinatura mantêm a proporção.
        if ((item.kind === "image" || item.kind === "signature") && pendingImage) {
          const pageInfo = ctx.doc.info.pages[page]!;
          const rotated = pageInfo.rotation % 180 !== 0;
          const aspect =
            (rotated ? pageInfo.width : pageInfo.height) /
            (rotated ? pageInfo.height : pageInfo.width);
          h = (w * pendingImage.ratio) / aspect;
        }
        if (item.kind === "line") {
          // Linha: a caixa vai do começo ao fim (de cima à esquerda para baixo à direita).
          w = Math.max(w, 0.001);
          h = Math.max(h, 0.001);
        }
        return {
          ...item,
          box: { x: Math.min(at.x, current.x), y: Math.min(at.y, current.y), w, h },
        };
      }),
    );
  };

  const onUp = () => {
    const current = drawing.current;
    drawing.current = null;
    if (!current || current.move) return;
    // Clique sem arrastar: tamanho padrão.
    setItems((list) =>
      list.map((item) => {
        if (item.id !== current.id) return item;
        if (item.box.w > 0.01 || item.box.h > 0.01) return item;
        const defaults: Record<string, [number, number]> = {
          text: [0.4, 0.06],
          comment: [0.04, 0.03],
          rect: [0.2, 0.1],
          ellipse: [0.2, 0.1],
          line: [0.25, 0.001],
          highlight: [0.3, 0.025],
          image: [0.3, 0.2],
          signature: [0.3, 0.1],
        };
        const [w, h] = defaults[item.kind] ?? [0.2, 0.1];
        return {
          ...item,
          box: { ...item.box, w: Math.min(w, 1 - item.box.x), h: Math.min(h, 1 - item.box.y) },
        };
      }),
    );
    if (mode === "image" || mode === "signature") {
      setPendingImage(null);
      setMode("select");
    }
  };

  const update = (id: number, patch: Partial<Draft>) =>
    setItems((list) =>
      list.map((item) => (item.id === id ? ({ ...item, ...patch } as Draft) : item)),
    );

  const apply = async () => {
    if (!items.length) return;
    const payload = items.map(({ id: _id, ...item }) => item as EditItem);
    const result = await ctx.run("Aplicando as edições", () =>
      pdfCall<Uint8Array>("edit", [ctx.doc.bytes, payload, ctx.doc.password ?? undefined]),
    );
    if (!result) return;
    await ctx.replace(result, { label: `${items.length} edições aplicadas` });
    setItems([]);
    setSelected(null);
  };

  const applyWatermark = async () => {
    const pages = mark.range.trim() ? parsePageRanges(mark.range, pageCount) : [];
    const result = await ctx.run("Aplicando a marca-d'água", () =>
      pdfCall<Uint8Array>("watermark", [
        ctx.doc.bytes,
        { ...mark, pages },
        ctx.doc.password ?? undefined,
      ]),
    );
    if (result) await ctx.replace(result, { label: "Marca-d'água aplicada" });
  };

  const selectedItem = items.find((item) => item.id === selected) ?? null;
  const pageItems = items.filter((item) => item.page === page);

  return (
    <div className="pdf-edit">
      <div className="pdf-edit-bar" role="toolbar" aria-label="Ferramentas do editor">
        {MODES.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              className={cn("pdf-mode", mode === item.id && "on")}
              aria-pressed={mode === item.id}
              title={item.label}
              aria-label={item.label}
              onClick={() => {
                setMode(item.id);
                if (item.id === "image") fileRef.current?.click();
                if (item.id === "signature") setSigning(true);
              }}
            >
              <Icon />
            </button>
          );
        })}
        <span className="pdf-sep" />
        <label className="pdf-inline" title="Cor">
          <input
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            aria-label="Cor"
          />
        </label>
        <label className="pdf-inline">
          Tamanho
          <input
            type="number"
            min={6}
            max={96}
            value={size}
            onChange={(event) => setSize(Number(event.target.value) || 14)}
          />
        </label>
        <label className="pdf-inline">
          Traço
          <input
            type="number"
            min={0.5}
            max={12}
            step={0.5}
            value={stroke}
            onChange={(event) => setStroke(Number(event.target.value) || 1)}
          />
        </label>
        <label className="pdf-inline">
          <input
            type="checkbox"
            checked={fill}
            onChange={(event) => setFill(event.target.checked)}
          />{" "}
          Preencher
        </label>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            void imageToPng(file).then(
              (image) => {
                setPendingImage({ ...image, kind: "image" });
                setMode("image");
                ctx.notify("Clique ou arraste na página para pôr a imagem.");
              },
              () => ctx.notify("Não foi possível ler essa imagem."),
            );
          }}
        />
      </div>
      <div className="pdf-edit-main">
        <div className="pdf-edit-stage" ref={holder}>
          <div className="pdf-pager">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
              aria-label="Página anterior"
            >
              <ChevronLeft />
            </button>
            <span>
              Página {page + 1} de {pageCount}
            </span>
            <button
              type="button"
              disabled={page >= pageCount - 1}
              onClick={() => setPage(page + 1)}
              aria-label="Próxima página"
            >
              <ChevronRight />
            </button>
          </div>
          <PageCanvas doc={ctx.render} index={page} width={width}>
            <div
              className={cn("pdf-overlay", `mode-${mode}`)}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              aria-label="Área de edição da página"
            >
              {pageItems.map((item) => (
                <div
                  key={item.id}
                  data-item={item.id}
                  className={cn("pdf-item", `k-${item.kind}`, selected === item.id && "on")}
                  style={
                    {
                      left: `${item.box.x * 100}%`,
                      top: `${item.box.y * 100}%`,
                      width: `${item.box.w * 100}%`,
                      height: `${Math.max(item.box.h * 100, 0.2)}%`,
                      ...("color" in item ? { "--item": item.color } : {}),
                      ...(item.kind === "text"
                        ? {
                            fontSize:
                              (item.size * width) /
                              (ctx.doc.info.pages[page]!.rotation % 180
                                ? ctx.doc.info.pages[page]!.height
                                : ctx.doc.info.pages[page]!.width),
                          }
                        : {}),
                    } as React.CSSProperties
                  }
                >
                  {item.kind === "text" && <span>{item.text}</span>}
                  {(item.kind === "image" || item.kind === "signature") && (
                    <PngPreview png={item.png} />
                  )}
                  {item.kind === "comment" && <MessageSquare />}
                </div>
              ))}
            </div>
          </PageCanvas>
        </div>
        <aside className="pdf-edit-side">
          <h3>Itens nesta página</h3>
          {pageItems.length === 0 && (
            <p className="pdf-muted">Escolha uma ferramenta e clique ou arraste na página.</p>
          )}
          <ul className="pdf-items">
            {pageItems.map((item) => (
              <li key={item.id} className={cn(selected === item.id && "on")}>
                <button type="button" onClick={() => setSelected(item.id)}>
                  {MODES.find((entry) => entry.id === item.kind)?.label ?? item.kind}
                </button>
                <button
                  type="button"
                  aria-label="Apagar item"
                  onClick={() => setItems((list) => list.filter((entry) => entry.id !== item.id))}
                >
                  <Trash2 />
                </button>
              </li>
            ))}
          </ul>
          {selectedItem && (selectedItem.kind === "text" || selectedItem.kind === "comment") && (
            <label className="pdf-field">
              {selectedItem.kind === "text" ? "Texto" : "Comentário"}
              <textarea
                rows={4}
                value={selectedItem.text}
                onChange={(event) => update(selectedItem.id, { text: event.target.value })}
                autoFocus
              />
            </label>
          )}
          {selectedItem?.kind === "text" && (
            <label className="pdf-field">
              Tamanho da letra
              <input
                type="number"
                min={6}
                max={96}
                value={selectedItem.size}
                onChange={(event) =>
                  update(selectedItem.id, { size: Number(event.target.value) || 12 })
                }
              />
            </label>
          )}
          <button
            type="button"
            className="pdf-primary"
            disabled={!items.length}
            onClick={() => void apply()}
          >
            Aplicar{" "}
            {items.length ? `${items.length} ${items.length === 1 ? "item" : "itens"}` : "edições"}
          </button>
          <details className="pdf-watermark">
            <summary>
              <Stamp aria-hidden="true" /> Marca-d'água
            </summary>
            <label className="pdf-field">
              Texto
              <input
                value={mark.text}
                maxLength={120}
                onChange={(event) => setMark({ ...mark, text: event.target.value })}
              />
            </label>
            <div className="pdf-grid2">
              <label className="pdf-field">
                Tamanho
                <input
                  type="number"
                  min={8}
                  max={200}
                  value={mark.size}
                  onChange={(event) => setMark({ ...mark, size: Number(event.target.value) || 48 })}
                />
              </label>
              <label className="pdf-field">
                Ângulo
                <input
                  type="number"
                  min={-90}
                  max={90}
                  value={mark.angle}
                  onChange={(event) => setMark({ ...mark, angle: Number(event.target.value) || 0 })}
                />
              </label>
              <label className="pdf-field">
                Opacidade
                <input
                  type="range"
                  min={5}
                  max={100}
                  value={Math.round(mark.opacity * 100)}
                  onChange={(event) =>
                    setMark({ ...mark, opacity: Number(event.target.value) / 100 })
                  }
                />
              </label>
              <label className="pdf-field">
                Cor
                <input
                  type="color"
                  value={mark.color}
                  onChange={(event) => setMark({ ...mark, color: event.target.value })}
                />
              </label>
            </div>
            <label className="pdf-field">
              Páginas (vazio = todas)
              <input
                value={mark.range}
                placeholder="1-3, 5"
                onChange={(event) => setMark({ ...mark, range: event.target.value })}
              />
            </label>
            <button type="button" className="pdf-button" onClick={() => void applyWatermark()}>
              Aplicar marca-d'água
            </button>
          </details>
        </aside>
      </div>
      {signing && (
        <SignaturePad
          onCancel={() => {
            setSigning(false);
            setMode("select");
          }}
          onDone={(png, ratio) => {
            setSigning(false);
            setPendingImage({ png, ratio, kind: "signature" });
            setMode("signature");
            ctx.notify("Clique ou arraste na página para pôr a assinatura.");
          }}
        />
      )}
    </div>
  );
}

function PngPreview({ png }: { png: Uint8Array }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const next = URL.createObjectURL(new Blob([png as BlobPart], { type: "image/png" }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [png]);
  return url ? <img src={url} alt="" draggable={false} /> : null;
}

/** Assinatura desenhada à mão (mouse, caneta ou dedo) → PNG transparente. */
export function SignaturePad({
  onDone,
  onCancel,
}: {
  onDone: (png: Uint8Array, ratio: number) => void;
  onCancel: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);
  const [ink, setInk] = useState("#111827");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = 560 * ratio;
    canvas.height = 200 * ratio;
    canvas.getContext("2d")?.scale(ratio, ratio);
  }, []);

  const pos = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const finish = async () => {
    const canvas = canvasRef.current;
    if (!canvas || empty) return;
    // Recorta o que foi desenhado (sem a margem vazia).
    const context = canvas.getContext("2d")!;
    const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
    let minX = width,
      minY = height,
      maxX = 0,
      maxY = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3]! > 0) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    const pad = 6;
    const w = Math.max(1, maxX - minX + pad * 2);
    const h = Math.max(1, maxY - minY + pad * 2);
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    out.getContext("2d")!.drawImage(canvas, minX - pad, minY - pad, w, h, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"));
    if (blob) onDone(new Uint8Array(await blob.arrayBuffer()), h / w);
  };

  return (
    <div className="pdf-modal" role="dialog" aria-modal="true" aria-label="Desenhar assinatura">
      <div className="pdf-modal-card">
        <h3>Assinatura desenhada</h3>
        <p className="pdf-muted">Desenhe com o mouse, a caneta ou o dedo.</p>
        <canvas
          ref={canvasRef}
          className="pdf-signature"
          style={{ width: 560, height: 200 }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            last.current = pos(event);
          }}
          onPointerMove={(event) => {
            if (!last.current) return;
            const context = event.currentTarget.getContext("2d");
            if (!context) return;
            const next = pos(event);
            context.strokeStyle = ink;
            context.lineWidth = 2.4 * (event.pressure ? 0.6 + event.pressure : 1);
            context.lineCap = "round";
            context.lineJoin = "round";
            context.beginPath();
            context.moveTo(last.current.x, last.current.y);
            context.lineTo(next.x, next.y);
            context.stroke();
            last.current = next;
            setEmpty(false);
          }}
          onPointerUp={() => (last.current = null)}
        />
        <div className="pdf-row">
          <label className="pdf-inline">
            Cor
            <input type="color" value={ink} onChange={(event) => setInk(event.target.value)} />
          </label>
          <button
            type="button"
            className="pdf-button"
            onClick={() => {
              const canvas = canvasRef.current;
              canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
              setEmpty(true);
            }}
          >
            Limpar
          </button>
          <span className="pdf-grow" />
          <button type="button" className="pdf-button" onClick={onCancel}>
            Cancelar
          </button>
          <button
            type="button"
            className="pdf-primary"
            disabled={empty}
            onClick={() => void finish()}
          >
            Usar assinatura
          </button>
        </div>
      </div>
    </div>
  );
}

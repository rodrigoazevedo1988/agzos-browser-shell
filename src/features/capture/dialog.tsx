import {
  AppWindow,
  ArrowUpRight,
  Camera,
  Circle,
  Copy,
  Crop,
  Download,
  Droplets,
  Grid3x3,
  Hash,
  Highlighter,
  Minus,
  PanelTop,
  Pencil,
  Redo2,
  ScrollText,
  Square,
  SquareDashed,
  Trash2,
  Type,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent } from "react";

import { Button } from "@/components/ui/button";
import type { DesktopBridge } from "@/features/browser/desktop";
import { cn } from "@/lib/utils";

import {
  CAPTURE_COLORS,
  CAPTURE_SIZE,
  commit,
  constrain,
  drawShape,
  emptyHistory,
  isDragTool,
  isEmptyShape,
  nextCounter,
  redo,
  renderCapture,
  textFont,
  undo,
  type History,
  type Point,
  type Shape,
  type Tool,
} from "./annotate";
import { regionOf, type Rect } from "./compose";

export type CaptureSources = {
  tab: string | null;
  window: string | null;
  /** 4.9.7: página inteira (rolada e costurada); null até ser pedida. */
  page: string | null;
  /** Fonte aberta primeiro (padrão: a guia). */
  initial?: Source;
};
type Source = "tab" | "window" | "page";

const TOOLS: { id: Tool; label: string; icon: LucideIcon; key: string }[] = [
  { id: "crop", label: "Recortar região", icon: Crop, key: "s" },
  { id: "pen", label: "Lápis", icon: Pencil, key: "p" },
  { id: "marker", label: "Marca-texto", icon: Highlighter, key: "m" },
  { id: "line", label: "Linha", icon: Minus, key: "l" },
  { id: "arrow", label: "Seta", icon: ArrowUpRight, key: "a" },
  { id: "rect", label: "Retângulo", icon: SquareDashed, key: "r" },
  { id: "rect-fill", label: "Retângulo preenchido", icon: Square, key: "f" },
  { id: "ellipse", label: "Elipse", icon: Circle, key: "c" },
  { id: "text", label: "Texto", icon: Type, key: "t" },
  { id: "counter", label: "Contador numerado", icon: Hash, key: "n" },
  { id: "pixelate", label: "Pixelar", icon: Grid3x3, key: "x" },
  { id: "blur", label: "Desfocar", icon: Droplets, key: "b" },
];

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image"));
    image.src = src;
  });
}

/**
 * Captura de tela (4.5) com editor (4.9.7, no estilo do Flameshot): guia, janela do app ou
 * a página inteira; recorte, lápis, marca-texto, linha, seta, retângulos, elipse, texto,
 * contador, pixelar e desfocar, com cor, espessura, desfazer e refazer. As formas ficam
 * em pixels da imagem e só se fundem à foto ao copiar ou salvar.
 */
export function CaptureDialog({
  desktop,
  sources,
  onFullPage,
  onEdit,
  onClose,
}: {
  desktop: DesktopBridge | null;
  sources: CaptureSources;
  /** 5.0.3: manda a imagem (PNG) para o Agzos Imagem. */
  onEdit?: (png: string) => void;
  /** Pede a página inteira (o diálogo fecha durante a rolagem e volta com ela). */
  onFullPage?: () => void;
  onClose: () => void;
}) {
  const [source, setSource] = useState<Source>(
    sources.initial && sources[sources.initial] ? sources.initial : sources.tab ? "tab" : "window",
  );
  const [tool, setTool] = useState<Tool>("arrow");
  const [color, setColor] = useState<string>(CAPTURE_COLORS[0]);
  const [size, setSize] = useState<number>(CAPTURE_SIZE.initial);
  // Histórico e recorte por fonte: trocar de fonte não perde o que foi desenhado.
  const [histories, setHistories] = useState<Record<Source, History>>({
    tab: emptyHistory,
    window: emptyHistory,
    page: emptyHistory,
  });
  const [crops, setCrops] = useState<Record<Source, Rect | null>>({
    tab: null,
    window: null,
    page: null,
  });
  const [draft, setDraft] = useState<Shape | null>(null);
  const [cropDrag, setCropDrag] = useState<{ from: Point; to: Point } | null>(null);
  const [textEdit, setTextEdit] = useState<{ at: Point; value: string } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [base, setBase] = useState<HTMLImageElement | null>(null);
  const [, setLayoutTick] = useState(0);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const image = sources[source];
  const history = histories[source];
  const shapes = history.present;
  const crop = crops[source];

  const setHistory = (next: History) => setHistories((all) => ({ ...all, [source]: next }));
  const setCrop = (next: Rect | null) => setCrops((all) => ({ ...all, [source]: next }));

  // Foto da fonte atual → <img> decodificada (base do desenho e do pixelar).
  useEffect(() => {
    let alive = true;
    setBase(null);
    if (image)
      void loadImage(image)
        .then((loaded) => alive && setBase(loaded))
        .catch(() => {});
    return () => {
      alive = false;
    };
  }, [image]);

  // Canvas de baixo: foto + formas confirmadas.
  useEffect(() => {
    const canvas = baseRef.current;
    if (!canvas || !base) return;
    canvas.width = base.naturalWidth;
    canvas.height = base.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(base, 0, 0);
    for (const shape of shapes) drawShape(context, shape, base);
    setLayoutTick((tick) => tick + 1);
  }, [base, shapes]);

  // Canvas de cima: só a forma sendo desenhada (limpo a cada movimento).
  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas || !base) return;
    if (canvas.width !== base.naturalWidth) canvas.width = base.naturalWidth;
    if (canvas.height !== base.naturalHeight) canvas.height = base.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (draft) drawShape(context, draft, base);
  }, [base, draft]);

  useEffect(() => {
    if (textEdit) textRef.current?.focus();
  }, [textEdit]);

  // Pixels da imagem por pixel da tela (a prévia aparece reduzida).
  const displayScale = () => {
    const canvas = baseRef.current;
    if (!canvas || !canvas.width) return 1;
    return canvas.getBoundingClientRect().width / canvas.width;
  };
  const toImage = (event: { clientX: number; clientY: number }): Point | null => {
    const canvas = baseRef.current;
    if (!canvas) return null;
    const box = canvas.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    return {
      x: ((event.clientX - box.left) * canvas.width) / box.width,
      y: ((event.clientY - box.top) * canvas.height) / box.height,
    };
  };

  const commitText = () => {
    if (!textEdit) return;
    const shape: Shape = { kind: "text", at: textEdit.at, text: textEdit.value, color, size };
    setTextEdit(null);
    if (!isEmptyShape(shape)) setHistory(commit(history, [...shapes, shape]));
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !base) return;
    const point = toImage(event);
    if (!point) return;
    if (textEdit) {
      commitText();
      return;
    }
    if (tool === "text") {
      event.preventDefault();
      setTextEdit({ at: point, value: "" });
      return;
    }
    if (tool === "counter") {
      setHistory(
        commit(history, [
          ...shapes,
          { kind: "counter", at: point, n: nextCounter(shapes), color, size },
        ]),
      );
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === "crop") {
      setCropDrag({ from: point, to: point });
      return;
    }
    if (tool === "pen" || tool === "marker") {
      setDraft({ kind: tool, points: [point], color, size });
      return;
    }
    if (isDragTool(tool)) {
      setDraft({ kind: tool, from: point, to: point, color, size } as Shape);
    }
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const point = toImage(event);
    if (!point) return;
    if (cropDrag) {
      setCropDrag({ ...cropDrag, to: point });
      return;
    }
    if (!draft) return;
    if (draft.kind === "pen" || draft.kind === "marker") {
      setDraft({ ...draft, points: [...draft.points, point] });
    } else if ("from" in draft) {
      setDraft({ ...draft, to: event.shiftKey ? constrain(tool, draft.from, point) : point });
    }
  };
  const onPointerUp = () => {
    if (cropDrag) {
      const canvas = baseRef.current;
      setCropDrag(null);
      if (canvas)
        setCrop(
          regionOf(cropDrag.from, cropDrag.to, { width: canvas.width, height: canvas.height }),
        );
      return;
    }
    if (!draft) return;
    setDraft(null);
    if (!isEmptyShape(draft)) setHistory(commit(history, [...shapes, draft]));
  };

  const result = () => (base ? renderCapture(base, shapes, crop).toDataURL("image/png") : null);
  const copy = async () => {
    const png = result();
    if (!png || !desktop) return;
    const ok = await desktop.captureCopy(png);
    setStatus(ok ? "Imagem copiada." : "Não foi possível copiar.");
  };
  const edit = () => {
    const png = result();
    if (png) onEdit?.(png);
  };
  const save = async () => {
    const png = result();
    if (!png || !desktop) return;
    const saved = await desktop.captureSave(png);
    if (saved.ok) setStatus(`Salva em ${saved.path}`);
    else if (!saved.canceled) setStatus("Não foi possível salvar.");
  };

  const choose = (next: Source) => {
    if (next === "page" && !sources.page) {
      onFullPage?.();
      return;
    }
    setTextEdit(null);
    setDraft(null);
    setSource(next);
    setStatus(null);
  };

  // Atalhos (como no Flameshot): letra escolhe a ferramenta; Ctrl+Z/Y, Ctrl+C, Ctrl+S.
  const keys = useRef({ copy, save, history, textEdit, crop, onClose });
  keys.current = { copy, save, history, textEdit, crop, onClose };
  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      const current = keys.current;
      if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement)
        return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (event.key === "Escape") {
        event.preventDefault();
        if (current.crop) setCrops((all) => ({ ...all, [source]: null }));
        else current.onClose();
      } else if (mod && key === "z" && !event.shiftKey) {
        event.preventDefault();
        setHistories((all) => ({ ...all, [source]: undo(all[source]) }));
      } else if (mod && (key === "y" || (key === "z" && event.shiftKey))) {
        event.preventDefault();
        setHistories((all) => ({ ...all, [source]: redo(all[source]) }));
      } else if (mod && key === "c") {
        event.preventDefault();
        void current.copy();
      } else if (mod && key === "s") {
        event.preventDefault();
        void current.save();
      } else if (!mod && !event.altKey) {
        const match = TOOLS.find((item) => item.key === key);
        if (match) {
          event.preventDefault();
          setTool(match.id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [source]);

  // Recorte na prévia (px CSS): o resto escurece, como no Flameshot.
  const scale = displayScale();
  const cropBox = cropDrag
    ? regionOf(cropDrag.from, cropDrag.to, {
        width: baseRef.current?.width ?? 0,
        height: baseRef.current?.height ?? 0,
      })
    : crop;
  const marquee = cropBox
    ? {
        left: cropBox.x * scale,
        top: cropBox.y * scale,
        width: cropBox.width * scale,
        height: cropBox.height * scale,
      }
    : null;

  return (
    <div className="capture-backdrop" role="presentation">
      <div
        ref={dialogRef}
        className="capture-dialog capture-editor"
        role="dialog"
        aria-modal="true"
        aria-label="Captura de tela"
        tabIndex={-1}
      >
        <header className="capture-head">
          <Camera aria-hidden="true" />
          <strong>Captura de tela</strong>
          <div className="capture-sources" role="radiogroup" aria-label="O que capturar">
            <button
              type="button"
              role="radio"
              aria-checked={source === "tab"}
              disabled={!sources.tab}
              onClick={() => choose("tab")}
            >
              <PanelTop aria-hidden="true" /> Guia
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={source === "page"}
              disabled={!sources.page && !onFullPage}
              onClick={() => choose("page")}
              title="Rola a página toda e junta num PNG só"
            >
              <ScrollText aria-hidden="true" /> Página inteira
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={source === "window"}
              disabled={!sources.window}
              onClick={() => choose("window")}
            >
              <AppWindow aria-hidden="true" /> Janela do app
            </button>
          </div>
          <Button variant="ghost" size="icon" aria-label="Fechar captura" onClick={onClose}>
            <X />
          </Button>
        </header>
        <div className="capture-tools" role="toolbar" aria-label="Ferramentas de anotação">
          {TOOLS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className="capture-tool"
                aria-pressed={tool === item.id}
                aria-label={item.label}
                title={`${item.label} (${item.key.toUpperCase()})`}
                onClick={() => setTool(item.id)}
              >
                <Icon aria-hidden="true" />
              </button>
            );
          })}
          <span className="capture-sep" aria-hidden="true" />
          <div className="capture-colors" role="radiogroup" aria-label="Cor">
            {CAPTURE_COLORS.map((swatch) => (
              <button
                key={swatch}
                type="button"
                role="radio"
                aria-checked={color === swatch}
                aria-label={`Cor ${swatch}`}
                className="capture-swatch"
                style={{ background: swatch }}
                onClick={() => setColor(swatch)}
              />
            ))}
            <label className="capture-swatch capture-custom" title="Outra cor">
              <input
                type="color"
                value={color}
                aria-label="Outra cor"
                onChange={(event) => setColor(event.target.value)}
              />
            </label>
          </div>
          <label className="capture-size">
            <span>Espessura</span>
            <input
              type="range"
              min={CAPTURE_SIZE.min}
              max={CAPTURE_SIZE.max}
              value={size}
              onChange={(event) => setSize(Number(event.target.value))}
            />
            <span className="capture-size-value">{size}</span>
          </label>
          <span className="capture-sep" aria-hidden="true" />
          <button
            type="button"
            className="capture-tool"
            aria-label="Desfazer"
            title="Desfazer (Ctrl+Z)"
            disabled={!history.past.length}
            onClick={() => setHistory(undo(history))}
          >
            <Undo2 aria-hidden="true" />
          </button>
          <button
            type="button"
            className="capture-tool"
            aria-label="Refazer"
            title="Refazer (Ctrl+Shift+Z)"
            disabled={!history.future.length}
            onClick={() => setHistory(redo(history))}
          >
            <Redo2 aria-hidden="true" />
          </button>
          <button
            type="button"
            className="capture-tool"
            aria-label="Limpar anotações"
            title="Limpar anotações"
            disabled={!shapes.length && !crop}
            onClick={() => {
              if (shapes.length) setHistory(commit(history, []));
              setCrop(null);
            }}
          >
            <Trash2 aria-hidden="true" />
          </button>
        </div>
        <div
          className={cn("capture-stage", source === "page" && "tall", `tool-${tool}`)}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            setDraft(null);
            setCropDrag(null);
          }}
        >
          {image ? (
            <div className="capture-frame">
              <canvas
                ref={baseRef}
                className="capture-canvas"
                role="img"
                aria-label="Prévia da captura"
              />
              <canvas ref={overlayRef} className="capture-canvas capture-overlay" />
              {marquee && (
                <span
                  className="capture-marquee"
                  style={marquee}
                  aria-label={cropBox ? `Região ${cropBox.width} × ${cropBox.height}` : undefined}
                />
              )}
              {textEdit && (
                <textarea
                  ref={textRef}
                  className="capture-text"
                  aria-label="Texto da anotação"
                  value={textEdit.value}
                  rows={Math.max(1, textEdit.value.split("\n").length)}
                  style={{
                    left: textEdit.at.x * scale,
                    top: textEdit.at.y * scale,
                    color,
                    font: textFont(size),
                    fontSize: `${Math.max(10, (12 + size * 3) * scale)}px`,
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                  onChange={(event) => setTextEdit({ ...textEdit, value: event.target.value })}
                  onBlur={commitText}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      event.stopPropagation();
                      setTextEdit(null);
                    } else if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      commitText();
                    }
                  }}
                />
              )}
            </div>
          ) : (
            <p className="capture-empty">Nada para capturar aqui.</p>
          )}
        </div>
        <footer className="capture-foot">
          <span className="capture-hint" role="status">
            {status ??
              (cropBox
                ? `Região de ${cropBox.width} × ${cropBox.height} px · Esc tira o recorte`
                : tool === "crop"
                  ? "Arraste na imagem para recortar uma região."
                  : tool === "text"
                    ? "Clique onde o texto começa · Enter confirma · Shift+Enter quebra a linha"
                    : "Shift prende linhas a 45° e deixa formas quadradas.")}
          </span>
          <Button variant="outline" disabled={!base} onClick={() => void copy()}>
            <Copy /> Copiar
          </Button>
          {onEdit && desktop && (
            <Button variant="outline" disabled={!base} onClick={edit}>
              <Pencil /> Editar no Agzos Imagem
            </Button>
          )}
          <Button disabled={!base} onClick={() => void save()}>
            <Download /> Salvar PNG…
          </Button>
        </footer>
      </div>
    </div>
  );
}

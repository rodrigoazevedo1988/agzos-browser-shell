import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDown,
  ArrowUp,
  Copy,
  Download,
  FolderOpen,
  HelpCircle,
  History as HistoryIcon,
  ImagePlus,
  Layers,
  LayoutTemplate,
  Maximize,
  Palette,
  Plus,
  Redo2,
  Save,
  Shapes,
  SlidersHorizontal,
  Trash2,
  Type,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useReducer,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { Button } from "@/components/ui/button";
import type { DesktopBridge } from "@/features/browser/desktop";
import { cn } from "@/lib/utils";

import {
  alignOp,
  canvasOp,
  deleteOp,
  duplicateOp,
  imageOp,
  nudgeOp,
  pasteOp,
  reorderOp,
} from "./actions";
import { assetFromDataUrl, newId } from "./assets";
import { brandSymbolSrc, logoOf, rasterizeSvg, type BrandLogo } from "./brand";
import { ExportDialog } from "./export";
import { type ImageSource, studioIO } from "./io";
import {
  addElement,
  emptyDoc,
  findElement,
  mapElements,
  newShape,
  newSticker,
  transformAt,
  type Asset,
  type Doc,
  type Element,
  type ShapeKind,
} from "./model";
import { LeftPanel, type LeftTab } from "./panels";
import { parseProject, serializeProject } from "./project";
import { ImageCache, exportDoc } from "./render";
import { ShortcutsDialog } from "./shortcuts";
import { canRedo, canUndo, emptyStudio, isDirty, studioReducer } from "./state";
import { StartScreen } from "./start";
import { Inspector } from "./inspector";
import { Stage, type View } from "./stage";
import { buildTemplate, textPreset } from "./templates";
import { TOOL_BY_KEY, TOOL_LIST, type Tool } from "./tools";
import type { CropDraft } from "./crop";
import "./studio.css";

/**
 * Agzos Imagem (5.0.3): editor de imagens em camadas (agzos://imagem). A tela é a página
 * inteira: barra de topo, painel de conteúdo à esquerda, o documento no meio e propriedades
 * à direita. Toda mudança passa pelo redutor (state.ts) e pelas operações (actions.ts).
 */

export type ImageStudioProps = {
  desktop: DesktopBridge | null;
  dark: boolean;
  /** Grant de uma imagem a abrir (captura, página de arquivo, menu da página). */
  grant?: string | null;
};

const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];
const PASTE_OFFSET = 24;
const LEFT_TABS: { id: LeftTab; label: string; short: string; icon: typeof Shapes }[] = [
  { id: "modelos", label: "Modelos e tamanhos", short: "Modelos", icon: LayoutTemplate },
  { id: "elementos", label: "Formas e figurinhas", short: "Elementos", icon: Shapes },
  { id: "texto", label: "Texto e fontes", short: "Texto", icon: Type },
  { id: "imagens", label: "Suas imagens", short: "Imagens", icon: ImagePlus },
  { id: "marca", label: "Marca Agzos", short: "Marca", icon: Palette },
  { id: "camadas", label: "Camadas", short: "Camadas", icon: Layers },
  { id: "historico", label: "Histórico", short: "Histórico", icon: HistoryIcon },
];
const ALIGNS = [
  { id: "left" as const, label: "Alinhar à esquerda", icon: AlignStartVertical },
  { id: "center" as const, label: "Centralizar na horizontal", icon: AlignCenterVertical },
  { id: "right" as const, label: "Alinhar à direita", icon: AlignEndVertical },
  { id: "top" as const, label: "Alinhar ao topo", icon: AlignStartHorizontal },
  { id: "middle" as const, label: "Centralizar na vertical", icon: AlignCenterHorizontal },
  { id: "bottom" as const, label: "Alinhar à base", icon: AlignEndHorizontal },
];

/** Cor de um elemento (forma: preenchimento; texto: cor). Figurinhas e fotos não mudam. */
function recolor(element: Element, hex: string): Element {
  if (element.kind === "shape") {
    return element.shape === "line" || element.shape === "arrow"
      ? { ...element, stroke: hex }
      : { ...element, fill: hex };
  }
  if (element.kind === "text") return { ...element, color: hex };
  return element;
}

export function ImageStudioPage({ desktop, dark, grant }: ImageStudioProps) {
  const [state, dispatch] = useReducer(studioReducer, emptyStudio);
  const [view, setView] = useState<View>({ zoom: 1, panX: 0, panY: 0, fit: true });
  const [tool, setTool] = useState<Tool>("select");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [crop, setCrop] = useState<CropDraft | null>(null);
  const [leftTab, setLeftTab] = useState<LeftTab>("modelos");
  // Abaixo de 720 px o painel da esquerda vira gaveta, aberta pelo trilho.
  const [leftOpen, setLeftOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const [paintKey, setPaintKey] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [copied, setCopied] = useState<Element[]>([]);
  const io = useMemo(() => studioIO(desktop), [desktop]);
  const cache = useMemo(() => new ImageCache(() => setPaintKey((key) => key + 1)), []);
  const doc = state.doc;
  const dirty = isDirty(state);
  const selected = doc ? state.selection.filter((id) => findElement(doc, id)) : [];

  // Abertura pelo grant (captura, página de arquivo, menu da página).
  useEffect(() => {
    if (!grant) return;
    let alive = true;
    void io.readGrant(grant).then(async (image: ImageSource | null) => {
      if (!alive) return;
      if (!image) {
        setStatus("Esta imagem não está mais disponível. Abra de novo.");
        return;
      }
      const asset = await assetFromDataUrl(image.name, image.dataUrl);
      if (!alive) return;
      if (!asset) {
        setStatus("Formato de imagem não aceito.");
        return;
      }
      const empty = emptyDoc(asset.width, asset.height, null);
      const placed = imageOp(empty, asset);
      dispatch({
        type: "open",
        doc: {
          ...placed.doc,
          elements: placed.doc.elements.map(
            (element) =>
              ({ ...element, transform: transformAt(0, 0, asset.width, asset.height) }) as Element,
          ),
        },
        assets: { [asset.id]: asset },
        name: image.name.replace(/\.[^.]+$/, "") || "Sem título",
        label: "Imagem aberta",
      });
      setView({ zoom: 1, panX: 0, panY: 0, fit: true });
    });
    return () => {
      alive = false;
    };
  }, [grant, io]);

  const commit = (label: string, next: Doc, key?: string) =>
    dispatch({ type: "commit", label, doc: next, ...(key ? { key } : {}) });

  /** Ids que podem mudar (bloqueados ficam). */
  const editable = (ids: string[]) =>
    doc ? ids.filter((id) => !findElement(doc, id)?.locked) : [];

  const patchSelected = (label: string, change: (element: Element) => Element, key?: string) => {
    if (!doc) return;
    const ids = editable(selected);
    if (ids.length) commit(label, mapElements(doc, ids, change), key);
  };

  const addAsset = async (source: ImageSource | null) => {
    if (!source) return;
    const asset = await assetFromDataUrl(source.name, source.dataUrl);
    if (!asset) {
      setStatus("Formato de imagem não aceito.");
      return;
    }
    if (!doc) {
      const base = emptyDoc(asset.width, asset.height, null);
      const placed = imageOp(base, asset);
      dispatch({
        type: "open",
        doc: base,
        assets: { [asset.id]: asset },
        name: source.name.replace(/\.[^.]+$/, "") || "Sem título",
        label: "Imagem aberta",
      });
      dispatch({ type: "commit", label: "Adicionar imagem", doc: placed.doc });
      dispatch({ type: "select", ids: [placed.id], mode: "replace" });
      setView({ zoom: 1, panX: 0, panY: 0, fit: true });
      return;
    }
    dispatch({ type: "asset", asset });
    const placed = imageOp(doc, asset);
    commit("Adicionar imagem", placed.doc);
    dispatch({ type: "select", ids: [placed.id], mode: "replace" });
  };

  const addImageAsset = (asset: Asset) => {
    if (!doc) return;
    const placed = imageOp(doc, asset);
    commit("Adicionar imagem", placed.doc);
    dispatch({ type: "select", ids: [placed.id], mode: "replace" });
  };

  const openProject = async () => {
    const picked = await io.openProject();
    if (!picked) return;
    const parsed = parseProject(picked.text);
    if (!parsed.ok) {
      setStatus(parsed.error);
      return;
    }
    dispatch({
      type: "open",
      doc: parsed.doc,
      assets: parsed.assets,
      name: parsed.name,
      label: "Projeto aberto",
    });
    setView({ zoom: 1, panX: 0, panY: 0, fit: true });
    setStatus(`Projeto “${parsed.name}” aberto.`);
  };

  const saveProject = async () => {
    if (!doc) return;
    const text = serializeProject({ name: state.name, doc, assets: state.assets });
    if (await io.saveProject(text, state.name)) {
      dispatch({ type: "saved" });
      setStatus("Projeto salvo.");
    }
  };

  const copyImage = async () => {
    if (!doc) return;
    const blob = await exportDoc(doc, state.assets, cache, {
      format: "png",
      quality: 100,
      scale: 1,
    });
    setStatus((await io.copyPng(blob)) ? "Imagem copiada." : "Não foi possível copiar.");
  };

  const addShape = (shape: ShapeKind) => {
    if (!doc) return;
    const line = shape === "line" || shape === "arrow";
    const width = line ? 420 : 320;
    const height = line ? 0 : 320;
    const element = newShape(
      newId("s"),
      shape,
      transformAt((doc.width - width) / 2, (doc.height - height) / 2, width, height),
      line ? { fill: null, stroke: "#0E0E0E" } : { fill: "#D10A11", stroke: null },
    );
    if (line) element.strokeWidth = 10;
    commit("Adicionar forma", addElement(doc, element));
    dispatch({ type: "select", ids: [element.id], mode: "replace" });
  };

  const addSticker = (glyph: string) => {
    if (!doc) return;
    const size = 220;
    const sticker = newSticker(
      newId("g"),
      transformAt((doc.width - size) / 2, (doc.height - size) / 2, size, size),
      glyph,
      "Figurinha",
    );
    commit("Adicionar figurinha", addElement(doc, sticker));
    dispatch({ type: "select", ids: [sticker.id], mode: "replace" });
  };

  const addText = (element: Element) => {
    if (!doc) return;
    commit("Adicionar texto", addElement(doc, element));
    dispatch({ type: "select", ids: [element.id], mode: "replace" });
  };

  const addLogo = async (id: BrandLogo) => {
    const logo = logoOf(id);
    try {
      const png = await rasterizeSvg(logo.svg, logo.width * 2);
      await addAsset({ name: `Logo Agzos (${logo.label.toLowerCase()})`, dataUrl: png.dataUrl });
    } catch {
      setStatus("Não foi possível colocar o logo.");
    }
  };

  const remove = () => {
    if (!doc || !selected.length) return;
    commit("Excluir", deleteOp(doc, selected));
    dispatch({ type: "select", ids: [], mode: "replace" });
  };

  const duplicateSelected = () => {
    if (!doc || !selected.length) return;
    const result = duplicateOp(doc, selected);
    commit("Duplicar", result.doc);
    dispatch({ type: "select", ids: result.ids, mode: "replace" });
  };

  const paste = () => {
    if (!doc || !copied.length) return;
    const result = pasteOp(doc, copied, PASTE_OFFSET);
    commit("Colar", result.doc);
    dispatch({ type: "select", ids: result.ids, mode: "replace" });
  };

  const zoomBy = (direction: 1 | -1) => {
    const current = view.zoom;
    const next =
      direction > 0
        ? (ZOOM_STEPS.find((step) => step > current + 1e-6) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]!)
        : ([...ZOOM_STEPS].reverse().find((step) => step < current - 1e-6) ?? ZOOM_STEPS[0]!);
    setView({ zoom: next, panX: 0, panY: 0, fit: false });
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    )
      return;
    if (!doc) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const handled = (action: () => void) => {
      event.preventDefault();
      event.stopPropagation();
      action();
    };
    if (mod) {
      if (key === "z" && !event.shiftKey) return handled(() => dispatch({ type: "undo" }));
      if ((key === "z" && event.shiftKey) || key === "y")
        return handled(() => dispatch({ type: "redo" }));
      if (key === "d") return handled(duplicateSelected);
      if (key === "c")
        return handled(() =>
          setCopied(doc.elements.filter((element) => selected.includes(element.id))),
        );
      if (key === "v") return handled(paste);
      if (key === "a")
        return handled(() =>
          dispatch({
            type: "select",
            ids: doc.elements.map((element) => element.id),
            mode: "replace",
          }),
        );
      if (key === "s") return handled(() => void saveProject());
      if (key === "o") return handled(() => void openProject());
      if (key === "e") return handled(() => setExportOpen(true));
      if (key === "]")
        return handled(() =>
          commit(
            "Trazer para a frente",
            reorderOp(doc, selected, event.shiftKey ? "front" : "forward"),
          ),
        );
      if (key === "[")
        return handled(() =>
          commit(
            "Enviar para trás",
            reorderOp(doc, selected, event.shiftKey ? "back" : "backward"),
          ),
        );
      if (key === "0") return handled(() => setView({ zoom: 1, panX: 0, panY: 0, fit: true }));
      if (key === "1") return handled(() => setView({ zoom: 1, panX: 0, panY: 0, fit: false }));
      if (key === "=" || key === "+") return handled(() => zoomBy(1));
      if (key === "-") return handled(() => zoomBy(-1));
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") return handled(remove);
    if (event.key === "Escape") {
      return handled(() => {
        if (crop) setCrop(null);
        else if (tool !== "select") setTool("select");
        else dispatch({ type: "select", ids: [], mode: "replace" });
      });
    }
    if (event.key.startsWith("Arrow") && selected.length) {
      const step = event.shiftKey ? 10 : 1;
      const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
      const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      return handled(() => commit("Mover", nudgeOp(doc, editable(selected), dx, dy), "nudge"));
    }
    if (event.key === "?") return handled(() => setHelpOpen(true));
    const next = TOOL_BY_KEY[key];
    if (!event.altKey && next) handled(() => setTool(next));
  };

  const rootClass = cn(
    "ims-root",
    dark ? "dark" : "agz-light",
    inspectorOpen && "inspector-open",
    leftOpen && "left-open",
  );

  if (!doc) {
    return (
      <div className={rootClass}>
        <StartScreen
          onPreset={(width, height) => {
            dispatch({
              type: "open",
              doc: emptyDoc(width, height, "#FFFFFF"),
              name: "Sem título",
              label: "Novo design",
            });
            setView({ zoom: 1, panX: 0, panY: 0, fit: true });
          }}
          onTemplate={(id) => {
            const next = buildTemplate(id, () => newId("e"));
            if (!next) return;
            dispatch({ type: "open", doc: next, name: "Modelo", label: "Modelo aplicado" });
            setView({ zoom: 1, panX: 0, panY: 0, fit: true });
          }}
          onOpenImage={() => void io.openImage().then(addAsset)}
          onOpenProject={() => void openProject()}
        />
        {status && (
          <p className="ims-status" role="status">
            {status}
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      className={rootClass}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      role="region"
      aria-label="Agzos Imagem"
    >
      <header className="ims-top">
        <div className="ims-brand">
          <img src={brandSymbolSrc} alt="" aria-hidden="true" width={22} height={22} />
          <strong>Agzos Imagem</strong>
        </div>
        <input
          className="ims-name"
          aria-label="Nome do projeto"
          value={state.name}
          onChange={(event) => dispatch({ type: "rename", name: event.target.value })}
        />
        <div className="ims-group">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirmNew((open) => !open)}
            aria-expanded={confirmNew}
          >
            <Plus />
            <span className="ims-label">Novo</span>
          </Button>
          {confirmNew && (
            <span className="ims-confirm" role="group" aria-label="Começar outro design">
              {dirty ? "Descartar alterações?" : "Começar outro design?"}
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  setConfirmNew(false);
                  dispatch({ type: "start" });
                }}
              >
                Sim
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmNew(false)}>
                Não
              </Button>
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void io.openImage().then(addAsset)}
            title="Adicionar uma imagem ao documento"
          >
            <ImagePlus />
            <span className="ims-label">Imagem</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void openProject()}
            title="Abrir projeto .agzimg (Ctrl+O)"
          >
            <FolderOpen />
            <span className="ims-label">Abrir</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => dispatch({ type: "undo" })}
            disabled={!canUndo(state)}
            aria-label="Desfazer"
            title="Desfazer (Ctrl+Z)"
          >
            <Undo2 />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => dispatch({ type: "redo" })}
            disabled={!canRedo(state)}
            aria-label="Refazer"
            title="Refazer (Ctrl+Shift+Z)"
          >
            <Redo2 />
          </Button>
        </div>
        <div className="ims-group ims-zoom" role="group" aria-label="Zoom">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => zoomBy(-1)}
            aria-label="Diminuir zoom"
            title="Diminuir (Ctrl+−)"
          >
            <ZoomOut />
          </Button>
          <button
            type="button"
            className="ims-zoom-value"
            onClick={() => setView({ zoom: 1, panX: 0, panY: 0, fit: true })}
            title="Ajustar à tela (Ctrl+0)"
          >
            {Math.round(view.zoom * 100)}%
          </button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => zoomBy(1)}
            aria-label="Aumentar zoom"
            title="Aumentar (Ctrl++)"
          >
            <ZoomIn />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setView({ zoom: 1, panX: 0, panY: 0, fit: true })}
            aria-label="Ajustar à tela"
            title="Ajustar à tela (Ctrl+0)"
          >
            <Maximize />
          </Button>
        </div>
        <div className="ims-group ims-end">
          <span className="ims-status-inline" role="status">
            {status ?? (dirty ? "Alterações não salvas" : "")}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setHelpOpen(true)}
            aria-label="Atalhos de teclado"
            title="Atalhos (?)"
          >
            <HelpCircle />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void saveProject()}
            title="Salvar projeto (Ctrl+S)"
          >
            <Save />
            <span className="ims-label">Salvar</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void copyImage()}
            title="Copiar imagem (PNG)"
          >
            <Copy />
            <span className="ims-label">Copiar</span>
          </Button>
          <Button size="sm" onClick={() => setExportOpen(true)} title="Exportar (Ctrl+E)">
            <Download />
            <span className="ims-label">Exportar</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="ims-inspector-toggle"
            onClick={() => setInspectorOpen((open) => !open)}
            aria-label="Propriedades"
            aria-pressed={inspectorOpen}
          >
            <SlidersHorizontal />
          </Button>
        </div>
      </header>

      <div className="ims-body">
        <nav className="ims-rail" aria-label="Painéis">
          {LEFT_TABS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className="ims-rail-button"
                aria-pressed={leftTab === item.id && leftOpen}
                onClick={() => {
                  setLeftOpen(!(leftTab === item.id && leftOpen));
                  setLeftTab(item.id);
                }}
                title={item.label}
              >
                <Icon aria-hidden="true" />
                <span>{item.short}</span>
              </button>
            );
          })}
        </nav>
        <aside
          className="ims-left"
          aria-label={LEFT_TABS.find((item) => item.id === leftTab)?.label}
        >
          <button
            type="button"
            className="ims-left-close"
            onClick={() => setLeftOpen(false)}
            aria-label="Fechar painel"
          >
            <X />
          </button>
          <LeftPanel
            tab={leftTab}
            doc={doc}
            state={state}
            onPreset={(width, height) =>
              commit("Tamanho da tela", canvasOp(doc, width, height, false))
            }
            onTemplate={(id) => {
              const next = buildTemplate(id, () => newId("e"));
              if (next) commit("Aplicar modelo", next);
            }}
            onShape={addShape}
            onSticker={addSticker}
            onText={addText}
            onAddAsset={addImageAsset}
            onUpload={() => void io.openImage().then(addAsset)}
            onLogo={(id) => void addLogo(id)}
            onColor={(hex) => {
              if (selected.length) patchSelected("Cor", (element) => recolor(element, hex));
              else commit("Cor do fundo", { ...doc, background: hex });
            }}
            onFont={(family) =>
              patchSelected("Fonte", (element) =>
                element.kind === "text" ? { ...element, font: family } : element,
              )
            }
            onSelect={(ids, mode) => dispatch({ type: "select", ids, mode })}
            onToggle={(id, field) =>
              commit(
                field === "hidden" ? "Ocultar camada" : "Bloquear camada",
                mapElements(
                  doc,
                  [id],
                  (element) => ({ ...element, [field]: !element[field] }) as Element,
                ),
              )
            }
            onRename={(id, name) =>
              dispatch({
                type: "preview",
                doc: mapElements(doc, [id], (element) => ({ ...element, name }) as Element),
              })
            }
            onRenameDone={() => commit("Renomear camada", doc)}
            onReorder={(elements) => commit("Reordenar camadas", { ...doc, elements })}
            onJump={(index) => dispatch({ type: "jump", index })}
          />
        </aside>

        <main className="ims-stage-wrap">
          <div className="ims-tools" role="toolbar" aria-label="Ferramentas">
            {TOOL_LIST.map((item) => (
              <button
                key={item.id}
                type="button"
                className="ims-tool"
                aria-pressed={tool === item.id}
                aria-label={item.label}
                title={`${item.label} (${item.key})`}
                onClick={() => setTool(item.id)}
              >
                <span aria-hidden="true">{TOOL_GLYPH[item.id]}</span>
              </button>
            ))}
          </div>
          <Stage
            doc={doc}
            assets={state.assets}
            cache={cache}
            selection={selected}
            tool={tool}
            view={view}
            crop={
              crop
                ? { id: crop.id, x: crop.x, y: crop.y, width: crop.width, height: crop.height }
                : null
            }
            editingId={editingId}
            paintKey={paintKey}
            onView={setView}
            onSelect={(ids, mode) => dispatch({ type: "select", ids, mode })}
            onPreview={(next) => dispatch({ type: "preview", doc: next })}
            onCommit={(label, next) => commit(label, next)}
            onCreate={(element, label) => {
              commit(label, addElement(doc, element));
              dispatch({ type: "select", ids: [element.id], mode: "replace" });
              if (element.kind === "text") setEditingId(element.id);
            }}
            onPick={(id, color) =>
              commit(
                "Remover fundo",
                mapElements(doc, [id], (element) =>
                  element.kind === "image"
                    ? { ...element, keyColor: { color, tolerance: 18 } }
                    : element,
                ),
              )
            }
            onEdit={setEditingId}
            onToolDone={() => setTool("select")}
          />
          {selected.length > 0 && (
            <div className="ims-quick" role="toolbar" aria-label="Ações da seleção">
              {selected.length > 1 &&
                ALIGNS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Button
                      key={item.id}
                      variant="ghost"
                      size="icon"
                      aria-label={item.label}
                      title={item.label}
                      onClick={() => commit("Alinhar", alignOp(doc, editable(selected), item.id))}
                    >
                      <Icon />
                    </Button>
                  );
                })}
              {selected.length > 1 && <span className="ims-sep" />}
              <Button
                variant="ghost"
                size="icon"
                aria-label="Trazer para a frente"
                title="Trazer para a frente"
                onClick={() => commit("Trazer para a frente", reorderOp(doc, selected, "forward"))}
              >
                <ArrowUp />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Enviar para trás"
                title="Enviar para trás"
                onClick={() => commit("Enviar para trás", reorderOp(doc, selected, "backward"))}
              >
                <ArrowDown />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Duplicar"
                title="Duplicar (Ctrl+D)"
                onClick={duplicateSelected}
              >
                <Copy />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Excluir"
                title="Excluir (Delete)"
                onClick={remove}
              >
                <Trash2 />
              </Button>
            </div>
          )}
        </main>

        <aside className="ims-right" aria-label="Propriedades">
          <Inspector
            doc={doc}
            assets={state.assets}
            selection={selected}
            crop={crop}
            setCrop={setCrop}
            tool={tool}
            onTool={setTool}
            onDoc={(label, next, key) => commit(label, next, key)}
            onPatch={patchSelected}
            onCanvas={(width, height, center) =>
              commit("Tamanho da tela", canvasOp(doc, width, height, center))
            }
            onBackground={(color) => commit("Cor do fundo", { ...doc, background: color })}
            onAdjustImage={(_id, change, key) =>
              patchSelected(
                key.startsWith("key:")
                  ? "Remover fundo"
                  : key.startsWith("reset:")
                    ? "Restaurar ajustes"
                    : "Ajustes",
                change,
                key,
              )
            }
            onApplyCrop={(element, next) =>
              commit(
                "Recortar",
                mapElements(doc, [element.id], () => next),
              )
            }
            onAction={(action) => {
              if (action === "delete") remove();
              if (action === "duplicate") duplicateSelected();
              if (action === "front")
                commit("Trazer para a frente", reorderOp(doc, selected, "front"));
              if (action === "back") commit("Enviar para trás", reorderOp(doc, selected, "back"));
            }}
            onEditText={setEditingId}
            onAlign={(align) => commit("Alinhar", alignOp(doc, editable(selected), align))}
          />
        </aside>
      </div>

      {exportOpen && (
        <ExportDialog
          doc={doc}
          assets={state.assets}
          cache={cache}
          io={io}
          name={state.name}
          onStatus={setStatus}
          onClose={() => setExportOpen(false)}
        />
      )}
      {helpOpen && <ShortcutsDialog onClose={() => setHelpOpen(false)} />}
      {tool === "pick" && (
        <div className="ims-hint" role="status">
          Clique na foto para escolher a cor de fundo a remover · Esc cancela
        </div>
      )}
    </div>
  );
}

const TOOL_GLYPH: Record<Tool, string> = {
  select: "↖",
  hand: "✋",
  text: "T",
  rect: "▭",
  round: "▢",
  ellipse: "◯",
  line: "╱",
  arrow: "➚",
  star: "★",
  polygon: "⬡",
  pick: "⌖",
};

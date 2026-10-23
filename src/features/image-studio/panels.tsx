import { Eye, EyeOff, Lock, LockOpen, Upload } from "lucide-react";
import { useState, type DragEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { BRAND_LOGOS, BRAND_COLORS, type BrandLogo } from "./brand";
import type { Asset, Doc, Element } from "./model";
import { SHAPE_NAMES, SHAPE_KINDS } from "./model";
import { STICKERS, PRESETS, TEMPLATES, textPreset } from "./templates";
import { newId } from "./assets";
import type { HistoryEntry, StudioState } from "./state";
import { fontFamilies, stackOf } from "./text";

export type LeftTab =
  "modelos" | "elementos" | "texto" | "imagens" | "marca" | "camadas" | "historico";
export type ShapeName = (typeof SHAPE_KINDS)[number];

export type LeftProps = {
  tab: LeftTab;
  doc: Doc;
  state: StudioState;
  onPreset(width: number, height: number): void;
  onTemplate(id: string): void;
  onShape(shape: ShapeName): void;
  onSticker(glyph: string): void;
  onText(element: Element): void;
  onAddAsset(asset: Asset): void;
  onUpload(): void;
  onLogo(logo: BrandLogo): void;
  onColor(hex: string): void;
  onSelect(ids: string[], mode: "replace" | "toggle" | "add"): void;
  onToggle(id: string, field: "hidden" | "locked"): void;
  onRename(id: string, name: string): void;
  onRenameDone(): void;
  onReorder(elements: Element[]): void;
  onJump(index: number): void;
  onFont(family: string): void;
};

export function LeftPanel(props: LeftProps) {
  const { tab } = props;
  switch (tab) {
    case "modelos":
      return <Models {...props} />;
    case "elementos":
      return <Elements {...props} />;
    case "texto":
      return <TextTab {...props} />;
    case "imagens":
      return <Images {...props} />;
    case "marca":
      return <Brand {...props} />;
    case "camadas":
      return <Layers {...props} />;
    case "historico":
      return <History {...props} />;
  }
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ims-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Models({ doc, onPreset, onTemplate }: LeftProps) {
  return (
    <div className="ims-panel">
      <Section title="Tamanhos prontos">
        <ul className="ims-list">
          {PRESETS.map((preset) => (
            <li key={preset.id}>
              <button
                type="button"
                className="ims-row"
                onClick={() => onPreset(preset.width, preset.height)}
              >
                <span>{preset.label}</span>
                <small>
                  {preset.width} × {preset.height}
                </small>
              </button>
            </li>
          ))}
        </ul>
        <p className="ims-hint-text">
          Troca o tamanho da tela atual ({doc.width} × {doc.height}). Desfazer volta.
        </p>
      </Section>
      <Section title="Modelos">
        <ul className="ims-list">
          {TEMPLATES.map((template) => (
            <li key={template.id}>
              <button type="button" className="ims-row" onClick={() => onTemplate(template.id)}>
                <span>{template.label}</span>
                <small>{template.hint}</small>
              </button>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function Elements({ onShape, onSticker }: LeftProps) {
  const shapes: { id: ShapeName; label: string }[] = SHAPE_KINDS.map((id) => ({
    id,
    label: SHAPE_NAMES[id],
  }));
  return (
    <div className="ims-panel">
      <Section title="Formas">
        <div className="ims-grid">
          {shapes.map((shape) => (
            <button
              key={shape.id}
              type="button"
              className="ims-tile"
              onClick={() => onShape(shape.id)}
              title={shape.label}
            >
              <ShapeGlyph kind={shape.id} />
              <small>{shape.label}</small>
            </button>
          ))}
        </div>
      </Section>
      <Section title="Figurinhas e emojis">
        <div className="ims-emoji">
          {STICKERS.map((glyph) => (
            <button
              key={glyph}
              type="button"
              onClick={() => onSticker(glyph)}
              aria-label={`Adicionar ${glyph}`}
            >
              {glyph}
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
}

function ShapeGlyph({ kind }: { kind: ShapeName }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 2 };
  const shapes: Record<ShapeName, ReactNode> = {
    rect: <rect x="4" y="6" width="24" height="20" {...common} />,
    round: <rect x="4" y="6" width="24" height="20" rx="7" {...common} />,
    ellipse: <ellipse cx="16" cy="16" rx="12" ry="10" {...common} />,
    line: <line x1="4" y1="26" x2="28" y2="6" {...common} />,
    arrow: <path d="M4 26 L26 8 M18 8 H26 V16" {...common} />,
    star: (
      <polygon
        points="16,3 19.5,12 29,12.4 21.6,18.3 24.2,28 16,22.6 7.8,28 10.4,18.3 3,12.4 12.5,12"
        {...common}
      />
    ),
    polygon: <polygon points="16,4 27,11 27,22 16,28 5,22 5,11" {...common} />,
  };
  return (
    <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
      {shapes[kind]}
    </svg>
  );
}

function TextTab({ doc, onText, onFont, state, onColor }: LeftProps) {
  return (
    <div className="ims-panel">
      <Section title="Adicionar texto">
        <div className="ims-stack">
          <Button variant="outline" onClick={() => onText(textPreset(newId("t"), doc, "title"))}>
            Adicionar título
          </Button>
          <Button variant="outline" onClick={() => onText(textPreset(newId("t"), doc, "subtitle"))}>
            Adicionar subtítulo
          </Button>
          <Button variant="outline" onClick={() => onText(textPreset(newId("t"), doc, "body"))}>
            Adicionar texto
          </Button>
        </div>
      </Section>
      <Section title="Fontes (aplica ao texto selecionado)">
        <ul className="ims-list">
          {fontFamilies().map((family) => (
            <li key={family}>
              <button
                type="button"
                className="ims-row"
                style={{ fontFamily: stackOf(family) }}
                onClick={() => onFont(family)}
              >
                <span>{family}</span>
                <small>Aa Bb Cc</small>
              </button>
            </li>
          ))}
        </ul>
        <p className="ims-hint-text">
          {state.selection.length
            ? "Escolha uma fonte para o texto selecionado."
            : "Selecione um texto para trocar a fonte."}
        </p>
      </Section>
      <Section title="Cor de texto">
        <div className="ims-swatches">
          {BRAND_COLORS.map((color) => (
            <button
              key={color.hex}
              type="button"
              className="ims-swatch"
              style={{ background: color.hex }}
              aria-label={color.name}
              title={color.name}
              onClick={() => onColor(color.hex)}
            />
          ))}
        </div>
      </Section>
    </div>
  );
}

function Images({ state, onAddAsset, onUpload }: LeftProps) {
  const assets = Object.values(state.assets);
  return (
    <div className="ims-panel">
      <Section title="Suas imagens">
        <Button className="ims-wide" onClick={onUpload}>
          <Upload /> Enviar imagem
        </Button>
        {assets.length === 0 && (
          <p className="ims-hint-text">Nenhuma imagem neste projeto ainda.</p>
        )}
        <div className="ims-grid">
          {assets.map((asset) => (
            <button
              key={asset.id}
              type="button"
              className="ims-thumb"
              onClick={() => onAddAsset(asset)}
              title={`Adicionar ${asset.name}`}
            >
              <img src={asset.dataUrl} alt="" />
              <small>{asset.name}</small>
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Brand({ onLogo, onColor }: LeftProps) {
  return (
    <div className="ims-panel">
      <Section title="Logos">
        <div className="ims-grid">
          {BRAND_LOGOS.map((logo) => (
            <button
              key={logo.id}
              type="button"
              className="ims-tile"
              onClick={() => onLogo(logo.id)}
            >
              <span
                className="ims-logo-preview"
                dangerouslySetInnerHTML={{
                  __html: logo.svg.replace(/<svg /, '<svg width="48" height="48" '),
                }}
              />
              <small>{logo.label}</small>
            </button>
          ))}
        </div>
      </Section>
      <Section title="Paleta">
        <div className="ims-swatches">
          {BRAND_COLORS.map((color) => (
            <button
              key={color.hex}
              type="button"
              className="ims-swatch"
              style={{ background: color.hex }}
              aria-label={`Aplicar ${color.name}`}
              title={color.name}
              onClick={() => onColor(color.hex)}
            />
          ))}
        </div>
        <p className="ims-hint-text">Aplica à seleção (forma ou texto) ou ao fundo, sem seleção.</p>
      </Section>
    </div>
  );
}

function Layers({ doc, state, onSelect, onToggle, onRename, onRenameDone, onReorder }: LeftProps) {
  const [dragging, setDragging] = useState<string | null>(null);
  const top = [...doc.elements].reverse();
  const drop = (target: string) => {
    if (!dragging || dragging === target) return;
    const order = [...top];
    const from = order.findIndex((element) => element.id === dragging);
    const to = order.findIndex((element) => element.id === target);
    const [moved] = order.splice(from, 1);
    if (!moved) return;
    order.splice(to, 0, moved);
    onReorder([...order].reverse());
    setDragging(null);
  };
  return (
    <div className="ims-panel">
      <Section title="Camadas (de cima para baixo)">
        {top.length === 0 && <p className="ims-hint-text">Nada no documento ainda.</p>}
        <ul className="ims-layers">
          {top.map((element) => (
            <li
              key={element.id}
              className={cn(
                "ims-layer",
                state.selection.includes(element.id) && "is-selected",
                dragging === element.id && "is-dragging",
              )}
              draggable
              onDragStart={(event: DragEvent) => {
                setDragging(element.id);
                event.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                drop(element.id);
              }}
              onDragEnd={() => setDragging(null)}
            >
              <button
                type="button"
                className="ims-layer-main"
                onClick={(event) => onSelect([element.id], event.shiftKey ? "toggle" : "replace")}
              >
                <span className="ims-kind">{KIND_LABEL[element.kind]}</span>
                <input
                  aria-label={`Nome da camada ${element.name}`}
                  value={element.name}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => onRename(element.id, event.target.value)}
                  onBlur={onRenameDone}
                />
              </button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={element.hidden ? "Mostrar" : "Ocultar"}
                aria-pressed={element.hidden}
                onClick={() => onToggle(element.id, "hidden")}
              >
                {element.hidden ? <EyeOff /> : <Eye />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={element.locked ? "Desbloquear" : "Bloquear"}
                aria-pressed={element.locked}
                onClick={() => onToggle(element.id, "locked")}
              >
                {element.locked ? <Lock /> : <LockOpen />}
              </Button>
            </li>
          ))}
        </ul>
        <p className="ims-hint-text">Arraste uma camada para mudar a ordem.</p>
      </Section>
    </div>
  );
}

const KIND_LABEL: Record<Element["kind"], string> = {
  image: "Foto",
  shape: "Forma",
  text: "Texto",
  sticker: "Figurinha",
};

function History({ state, onJump }: LeftProps) {
  return (
    <div className="ims-panel">
      <Section title="Histórico">
        <ol className="ims-history">
          {state.entries.map((entry: HistoryEntry, index: number) => (
            <li key={`${index}-${entry.label}`}>
              <button
                type="button"
                className={cn("ims-row", index === state.index && "is-current")}
                onClick={() => onJump(index)}
                aria-current={index === state.index}
              >
                <span>{index === 0 ? "Início" : entry.label}</span>
                <small>
                  {index > 0 && index === state.saved
                    ? "salvo"
                    : index === state.index
                      ? "atual"
                      : ""}
                </small>
              </button>
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}

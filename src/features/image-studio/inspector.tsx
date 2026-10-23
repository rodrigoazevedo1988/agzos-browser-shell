import {
  ArrowDown,
  ArrowUp,
  Copy,
  Crop,
  FlipHorizontal,
  FlipVertical,
  Lock,
  Pipette,
  RotateCcw,
  RotateCw,
  Trash2,
} from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

import { ADJUST_RANGES, isHexColor } from "./filters";
import { applyCrop, cropToAspect } from "./transform";
import type { CropDraft } from "./crop";
import {
  BLENDS,
  DEFAULT_ADJUST,
  ADJUST_KEYS,
  type Adjust,
  type Asset,
  type Assets,
  type Doc,
  type Element,
  type ImageElement,
  type ShapeElement,
  type TextElement,
  type Transform,
} from "./model";
import { FONT_WEIGHTS, fontFamilies } from "./text";
import type { Tool } from "./tools";

/** Painel de propriedades: tela (sem seleção) ou o elemento selecionado. */

export type InspectorProps = {
  doc: Doc;
  assets: Assets;
  selection: string[];
  crop: CropDraft | null;
  setCrop(crop: CropDraft | null): void;
  tool: Tool;
  onTool(tool: Tool): void;
  onDoc(label: string, next: Doc, key?: string): void;
  onPatch(label: string, change: (element: Element) => Element, key?: string): void;
  onCanvas(width: number, height: number, center: boolean): void;
  onBackground(color: string | null): void;
  onAdjustImage(id: string, change: (element: Element) => Element, key: string): void;
  onApplyCrop(element: ImageElement, next: ImageElement): void;
  onAction(action: "delete" | "duplicate" | "front" | "back" | "lock" | "hide"): void;
  onEditText(id: string): void;
  onAlign(align: "left" | "center" | "right" | "top" | "middle" | "bottom"): void;
};

export function Inspector(props: InspectorProps) {
  const { doc, selection } = props;
  const chosen = doc.elements.filter((element) => selection.includes(element.id));
  if (!chosen.length) return <CanvasPanel {...props} />;
  if (chosen.length > 1) return <MultiPanel {...props} chosen={chosen} />;
  return <ElementPanel {...props} element={chosen[0]!} />;
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ims-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="ims-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function CanvasPanel({ doc, onCanvas, onBackground }: InspectorProps) {
  return (
    <div className="ims-panel">
      <Group title="Tela">
        <div className="ims-pair">
          <NumberField
            label="Largura"
            value={doc.width}
            min={16}
            max={10000}
            onChange={(width) => onCanvas(width, doc.height, false)}
          />
          <NumberField
            label="Altura"
            value={doc.height}
            min={16}
            max={10000}
            onChange={(height) => onCanvas(doc.width, height, false)}
          />
        </div>
        <div className="ims-stack">
          <Button variant="outline" size="sm" onClick={() => onCanvas(doc.width, doc.height, true)}>
            Centralizar conteúdo nesta tela
          </Button>
        </div>
      </Group>
      <Group title="Fundo">
        <div className="ims-pair">
          <Field label="Cor">
            <input
              type="color"
              value={doc.background ?? "#ffffff"}
              onChange={(event) => onBackground(event.target.value)}
              aria-label="Cor do fundo"
            />
          </Field>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onBackground(doc.background ? null : "#FFFFFF")}
          >
            {doc.background ? "Transparente" : "Usar cor"}
          </Button>
        </div>
      </Group>
      <p className="ims-hint-text">Selecione um elemento para ver as propriedades dele.</p>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min = -20000,
  max = 20000,
  step = 1,
}: {
  label: string;
  value: number;
  onChange(value: number): void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
        }}
      />
    </Field>
  );
}

function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  onStart,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange(value: number): void;
  onStart(): void;
}) {
  return (
    <label className="ims-range">
      <span>
        {label}
        <output>{Math.round(value * 100) / 100}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={onStart}
        onKeyDown={onStart}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

/** Chave única por gesto de slider: arrastar um controle vira uma só entrada no histórico. */
function useGestureKey(seed: string) {
  return `${seed}:${Date.now()}`;
}

function ElementPanel(props: InspectorProps & { element: Element }) {
  const { element } = props;
  const t = element.transform;
  const key = `${element.id}`;
  const setTransform = (label: string, patch: Partial<Transform>, gesture?: string) =>
    props.onPatch(
      label,
      (current) => ({ ...current, transform: { ...current.transform, ...patch } }) as Element,
      gesture ? `${gesture}:${key}` : undefined,
    );
  const gesture = (name: string) => `${name}:${key}`;
  return (
    <div className="ims-panel">
      <Group title="Posição e tamanho">
        <div className="ims-pair">
          <NumberField
            label="X"
            value={t.x}
            onChange={(x) => setTransform("Mover", { x }, gesture("x"))}
          />
          <NumberField
            label="Y"
            value={t.y}
            onChange={(y) => setTransform("Mover", { y }, gesture("y"))}
          />
          <NumberField
            label="Largura"
            value={t.width}
            min={0}
            max={20000}
            onChange={(width) => setTransform("Redimensionar", { width }, gesture("w"))}
          />
          <NumberField
            label="Altura"
            value={t.height}
            min={0}
            max={20000}
            onChange={(height) => setTransform("Redimensionar", { height }, gesture("h"))}
          />
          <NumberField
            label="Giro (°)"
            value={t.rotation}
            min={-360}
            max={360}
            onChange={(rotation) =>
              setTransform("Girar", { rotation: ((rotation % 360) + 360) % 360 }, gesture("r"))
            }
          />
          <Field label="Opacidade">
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(element.opacity * 100)}
              onPointerDown={() => undefined}
              onChange={(event) =>
                props.onPatch(
                  "Opacidade",
                  (current) =>
                    ({ ...current, opacity: Number(event.target.value) / 100 }) as Element,
                  gesture("o"),
                )
              }
            />
          </Field>
        </div>
        <div className="ims-stack">
          <label className="ims-field">
            <span>Mistura</span>
            <select
              value={element.blend}
              onChange={(event) =>
                props.onPatch(
                  "Mistura",
                  (current) => ({ ...current, blend: event.target.value }) as Element,
                )
              }
            >
              {BLENDS.map((blend) => (
                <option key={blend} value={blend}>
                  {blend}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="ims-tools-row">
          <IconAction
            label="Girar à esquerda"
            onClick={() => setTransform("Girar", { rotation: (t.rotation + 270) % 360 })}
          >
            <RotateCcw />
          </IconAction>
          <IconAction
            label="Girar à direita"
            onClick={() => setTransform("Girar", { rotation: (t.rotation + 90) % 360 })}
          >
            <RotateCw />
          </IconAction>
          <IconAction
            label="Espelhar na horizontal"
            onClick={() => setTransform("Espelhar", { flipX: !t.flipX })}
          >
            <FlipHorizontal />
          </IconAction>
          <IconAction
            label="Espelhar na vertical"
            onClick={() => setTransform("Espelhar", { flipY: !t.flipY })}
          >
            <FlipVertical />
          </IconAction>
        </div>
        <div className="ims-tools-row">
          <IconAction label="Trazer para a frente" onClick={() => props.onAction("front")}>
            <ArrowUp />
          </IconAction>
          <IconAction label="Enviar para trás" onClick={() => props.onAction("back")}>
            <ArrowDown />
          </IconAction>
          <IconAction label="Duplicar" onClick={() => props.onAction("duplicate")}>
            <Copy />
          </IconAction>
          <IconAction
            label={element.locked ? "Desbloquear" : "Bloquear"}
            onClick={() =>
              props.onPatch(
                "Bloquear",
                (current) => ({ ...current, locked: !current.locked }) as Element,
              )
            }
          >
            <Lock />
          </IconAction>
          <IconAction label="Excluir" onClick={() => props.onAction("delete")}>
            <Trash2 />
          </IconAction>
        </div>
      </Group>
      {element.kind === "image" && <ImageSection {...props} element={element} />}
      {element.kind === "shape" && <ShapeSection {...props} element={element} />}
      {element.kind === "text" && <TextSection {...props} element={element} />}
    </div>
  );
}

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <Button variant="ghost" size="icon" aria-label={label} title={label} onClick={onClick}>
      {children}
    </Button>
  );
}

function MultiPanel(props: InspectorProps & { chosen: Element[] }) {
  const { chosen } = props;
  const aligns: { id: "left" | "center" | "right" | "top" | "middle" | "bottom"; label: string }[] =
    [
      { id: "left", label: "Alinhar à esquerda" },
      { id: "center", label: "Centralizar na horizontal" },
      { id: "right", label: "Alinhar à direita" },
      { id: "top", label: "Alinhar ao topo" },
      { id: "middle", label: "Centralizar na vertical" },
      { id: "bottom", label: "Alinhar à base" },
    ];
  return (
    <div className="ims-panel">
      <Group title={`${chosen.length} elementos`}>
        <div className="ims-tools-row">
          {aligns.map((item) => (
            <Button key={item.id} variant="ghost" size="sm" onClick={() => props.onAlign(item.id)}>
              {item.label.split(" ")[0]}
            </Button>
          ))}
        </div>
        <div className="ims-tools-row">
          <IconAction label="Duplicar" onClick={() => props.onAction("duplicate")}>
            <Copy />
          </IconAction>
          <IconAction label="Excluir" onClick={() => props.onAction("delete")}>
            <Trash2 />
          </IconAction>
        </div>
        <p className="ims-hint-text">
          Arraste a seleção para mover tudo junto. Alças redimensionam o grupo.
        </p>
      </Group>
    </div>
  );
}

function ImageSection(props: InspectorProps & { element: ImageElement }) {
  const { element, assets, crop } = props;
  const asset: Asset | undefined = assets[element.asset];
  if (!asset) return <Group title="Foto">Foto sem arquivo no projeto.</Group>;
  const current = element.crop ?? { x: 0, y: 0, width: asset.width, height: asset.height };
  const draft = crop && crop.id === element.id ? crop : null;
  const startCrop = (ratio: number | null) => {
    const next = cropToAspect(asset, ratio);
    props.setCrop({ id: element.id, ...next, ratio });
  };
  const apply = () => {
    if (!draft) return;
    props.onApplyCrop(
      element,
      applyCrop(
        element,
        { x: draft.x, y: draft.y, width: draft.width, height: draft.height },
        asset,
      ),
    );
    props.setCrop(null);
  };
  const adjust = element.adjust;
  const setAdjust = (name: keyof Adjust, value: number) =>
    props.onAdjustImage(
      element.id,
      (current) =>
        ({ ...current, adjust: { ...(current as ImageElement).adjust, [name]: value } }) as Element,
      `adj:${element.id}:${name}`,
    );
  return (
    <>
      <Group title="Recorte">
        <div className="ims-aspects">
          {[
            { label: "Original", ratio: asset.width / asset.height },
            { label: "1:1", ratio: 1 },
            { label: "4:5", ratio: 4 / 5 },
            { label: "16:9", ratio: 16 / 9 },
            { label: "9:16", ratio: 9 / 16 },
            { label: "3:2", ratio: 3 / 2 },
            { label: "Livre", ratio: null },
          ].map((item) => (
            <Button
              key={item.label}
              variant="outline"
              size="sm"
              onClick={() => startCrop(item.ratio)}
            >
              {item.label}
            </Button>
          ))}
        </div>
        {draft && (
          <>
            <div className="ims-pair">
              <NumberField
                label="X"
                value={draft.x}
                min={0}
                max={asset.width}
                onChange={(x) => props.setCrop({ ...draft, x })}
              />
              <NumberField
                label="Y"
                value={draft.y}
                min={0}
                max={asset.height}
                onChange={(y) => props.setCrop({ ...draft, y })}
              />
              <NumberField
                label="Largura"
                value={draft.width}
                min={1}
                max={asset.width}
                onChange={(width) => props.setCrop({ ...draft, width })}
              />
              <NumberField
                label="Altura"
                value={draft.height}
                min={1}
                max={asset.height}
                onChange={(height) => props.setCrop({ ...draft, height })}
              />
            </div>
            <div className="ims-tools-row">
              <Button size="sm" onClick={apply}>
                <Crop /> Aplicar recorte
              </Button>
              <Button variant="ghost" size="sm" onClick={() => props.setCrop(null)}>
                Cancelar
              </Button>
            </div>
          </>
        )}
        {!draft && (
          <p className="ims-hint-text">
            Recorte atual: {Math.round(current.width)} × {Math.round(current.height)} px da foto
            original.
          </p>
        )}
      </Group>
      <Group title="Ajustes (não destrutivos)">
        {ADJUST_KEYS.map((name) => {
          const range = ADJUST_RANGES[name];
          return (
            <RangeField
              key={name}
              label={range.label}
              value={adjust[name]}
              min={range.min}
              max={range.max}
              onStart={() => undefined}
              onChange={(value) => setAdjust(name, value)}
            />
          );
        })}
        <div className="ims-stack">
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              props.onAdjustImage(
                element.id,
                (current) => ({ ...current, adjust: { ...DEFAULT_ADJUST } }) as Element,
                `reset:${element.id}`,
              )
            }
          >
            Restaurar ajustes
          </Button>
        </div>
      </Group>
      <Group title="Remover fundo por cor">
        {element.keyColor ? (
          <>
            <div className="ims-pair">
              <Field label="Cor do fundo">
                <input
                  type="color"
                  value={element.keyColor.color}
                  onChange={(event) =>
                    props.onAdjustImage(
                      element.id,
                      (current) =>
                        ({
                          ...current,
                          keyColor: {
                            ...(current as ImageElement).keyColor!,
                            color: event.target.value,
                          },
                        }) as Element,
                      `key:${element.id}:c`,
                    )
                  }
                  aria-label="Cor a remover"
                />
              </Field>
            </div>
            <RangeField
              label="Tolerância"
              value={element.keyColor.tolerance}
              min={0}
              max={100}
              onStart={() => undefined}
              onChange={(tolerance) =>
                props.onAdjustImage(
                  element.id,
                  (current) =>
                    ({
                      ...current,
                      keyColor: { ...(current as ImageElement).keyColor!, tolerance },
                    }) as Element,
                  `key:${element.id}:t`,
                )
              }
            />
            <div className="ims-tools-row">
              <Button variant="outline" size="sm" onClick={() => props.onTool("pick")}>
                <Pipette /> Escolher cor na foto
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  props.onAdjustImage(
                    element.id,
                    (current) => ({ ...current, keyColor: null }) as Element,
                    `key:${element.id}:off`,
                  )
                }
              >
                Desligar
              </Button>
            </div>
          </>
        ) : (
          <div className="ims-tools-row">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                props.onAdjustImage(
                  element.id,
                  (current) =>
                    ({ ...current, keyColor: { color: "#FFFFFF", tolerance: 18 } }) as Element,
                  `key:${element.id}:on`,
                )
              }
            >
              Ligar remoção de fundo
            </Button>
            <Button variant="outline" size="sm" onClick={() => props.onTool("pick")}>
              <Pipette /> Escolher na foto
            </Button>
          </div>
        )}
      </Group>
    </>
  );
}

function ColorField({
  label,
  value,
  onChange,
  allowNone = true,
}: {
  label: string;
  value: string | null;
  onChange(value: string | null): void;
  allowNone?: boolean;
}) {
  return (
    <div className="ims-pair">
      <Field label={label}>
        <input
          type="color"
          value={isHexColor(value) ? value!.slice(0, 7) : "#000000"}
          onChange={(event) => onChange(event.target.value)}
          aria-label={label}
          disabled={value === null}
        />
      </Field>
      {allowNone && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange(value === null ? "#D10A11" : null)}
        >
          {value === null ? "Ligar" : "Sem cor"}
        </Button>
      )}
    </div>
  );
}

function ShapeSection(props: InspectorProps & { element: ShapeElement }) {
  const { element } = props;
  const patch = (label: string, change: Partial<ShapeElement>, key?: string) =>
    props.onPatch(label, (current) => ({ ...current, ...change }) as Element, key);
  const line = element.shape === "line" || element.shape === "arrow";
  return (
    <Group title="Forma">
      <ColorField
        label={line ? "Cor" : "Preenchimento"}
        value={line ? element.stroke : element.fill}
        allowNone={!line}
        onChange={(value) =>
          line
            ? patch("Cor", { stroke: value }, `fill:${element.id}`)
            : patch("Preenchimento", { fill: value }, `fill:${element.id}`)
        }
      />
      {!line && (
        <ColorField
          label="Contorno"
          value={element.stroke}
          onChange={(value) =>
            patch(
              "Contorno",
              {
                stroke: value,
                strokeWidth: value && !element.strokeWidth ? 6 : element.strokeWidth,
              },
              `stroke:${element.id}`,
            )
          }
        />
      )}
      <RangeField
        label="Espessura"
        value={element.strokeWidth}
        min={0}
        max={80}
        onStart={() => undefined}
        onChange={(value) => patch("Espessura", { strokeWidth: value }, `sw:${element.id}`)}
      />
      {element.shape === "round" && (
        <RangeField
          label="Raio dos cantos"
          value={element.radius}
          min={0}
          max={600}
          onStart={() => undefined}
          onChange={(value) => patch("Raio", { radius: value }, `rad:${element.id}`)}
        />
      )}
      {(element.shape === "star" || element.shape === "polygon") && (
        <RangeField
          label={element.shape === "star" ? "Pontas" : "Lados"}
          value={element.sides}
          min={3}
          max={element.shape === "star" ? 12 : 12}
          onStart={() => undefined}
          onChange={(value) => patch("Lados", { sides: value }, `sides:${element.id}`)}
        />
      )}
    </Group>
  );
}

function TextSection(props: InspectorProps & { element: TextElement }) {
  const { element } = props;
  const patch = (label: string, change: Partial<TextElement>, key?: string) =>
    props.onPatch(label, (current) => ({ ...current, ...change }) as Element, key);
  return (
    <>
      <Group title="Texto">
        <label className="ims-field">
          <span>Conteúdo</span>
          <textarea
            value={element.text}
            rows={3}
            onChange={(event) =>
              patch("Editar texto", { text: event.target.value }, `txt:${element.id}`)
            }
            onFocus={() => undefined}
          />
        </label>
        <Button variant="outline" size="sm" onClick={() => props.onEditText(element.id)}>
          Editar na tela
        </Button>
        <div className="ims-pair">
          <label className="ims-field">
            <span>Fonte</span>
            <select
              value={element.font}
              onChange={(event) => patch("Fonte", { font: event.target.value })}
            >
              {fontFamilies().map((family) => (
                <option key={family} value={family}>
                  {family}
                </option>
              ))}
            </select>
          </label>
          <label className="ims-field">
            <span>Peso</span>
            <select
              value={element.weight}
              onChange={(event) => patch("Peso", { weight: Number(event.target.value) })}
            >
              {FONT_WEIGHTS.map((weight) => (
                <option key={weight} value={weight}>
                  {weight}
                </option>
              ))}
            </select>
          </label>
          <NumberField
            label="Tamanho"
            value={element.size}
            min={4}
            max={2000}
            onChange={(size) => patch("Tamanho", { size }, `size:${element.id}`)}
          />
          <NumberField
            label="Entrelinha"
            value={element.lineHeight}
            min={0.5}
            max={4}
            step={0.05}
            onChange={(lineHeight) => patch("Entrelinha", { lineHeight }, `lh:${element.id}`)}
          />
        </div>
        <div className="ims-tools-row">
          {(["left", "center", "right"] as const).map((align) => (
            <Button
              key={align}
              variant={element.align === align ? "default" : "outline"}
              size="sm"
              onClick={() => patch("Alinhamento", { align })}
            >
              {align === "left" ? "Esquerda" : align === "center" ? "Centro" : "Direita"}
            </Button>
          ))}
        </div>
        <ColorField
          label="Cor"
          value={element.color}
          allowNone={false}
          onChange={(value) =>
            patch("Cor do texto", { color: value ?? element.color }, `tc:${element.id}`)
          }
        />
      </Group>
      <Group title="Sombra">
        <ColorField
          label="Sombra"
          value={element.shadow?.color ?? null}
          onChange={(value) =>
            patch("Sombra", { shadow: value ? { color: value, blur: 12, x: 4, y: 4 } : null })
          }
        />
        {element.shadow && (
          <RangeField
            label="Desfoque"
            value={element.shadow.blur}
            min={0}
            max={80}
            onStart={() => undefined}
            onChange={(blur) =>
              patch("Sombra", { shadow: { ...element.shadow!, blur } }, `sh:${element.id}`)
            }
          />
        )}
      </Group>
      <Group title="Contorno">
        <ColorField
          label="Contorno"
          value={element.outline?.color ?? null}
          onChange={(value) =>
            patch("Contorno", { outline: value ? { color: value, width: 6 } : null })
          }
        />
        {element.outline && (
          <RangeField
            label="Espessura"
            value={element.outline.width}
            min={0}
            max={60}
            onStart={() => undefined}
            onChange={(width) =>
              patch("Contorno", { outline: { ...element.outline!, width } }, `ol:${element.id}`)
            }
          />
        )}
      </Group>
      <Group title="Fundo do texto">
        <ColorField
          label="Fundo"
          value={element.background?.color ?? null}
          onChange={(value) =>
            patch("Fundo do texto", {
              background: value ? { color: value, padding: 24, radius: 16 } : null,
            })
          }
        />
        {element.background && (
          <>
            <RangeField
              label="Respiro"
              value={element.background.padding}
              min={0}
              max={200}
              onStart={() => undefined}
              onChange={(padding) =>
                patch(
                  "Fundo do texto",
                  { background: { ...element.background!, padding } },
                  `bp:${element.id}`,
                )
              }
            />
            <RangeField
              label="Cantos"
              value={element.background.radius}
              min={0}
              max={200}
              onStart={() => undefined}
              onChange={(radius) =>
                patch(
                  "Fundo do texto",
                  { background: { ...element.background!, radius } },
                  `br:${element.id}`,
                )
              }
            />
          </>
        )}
      </Group>
    </>
  );
}

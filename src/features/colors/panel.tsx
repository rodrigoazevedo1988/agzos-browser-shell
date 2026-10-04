import {
  Copy,
  Download,
  History,
  Palette as PaletteIcon,
  Pin,
  PinOff,
  Pipette,
  Plus,
  ScanSearch,
  Settings2,
  SwatchBook,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import type { PageColor } from "@/features/browser/desktop-v47";
import type { AutoCopy } from "@/features/browser/feature-prefs";
import { cn } from "@/lib/utils";

import {
  formatColor,
  gradientCss,
  parseColor,
  readableOn,
  searchHistory,
  type ColorLibrary,
  type Gradient,
} from "./color";

export type ColorTab = "picker" | "page" | "gradient" | "palettes" | "history";

const TABS: { id: ColorTab; label: string; icon: typeof Pipette }[] = [
  { id: "picker", label: "Conta-gotas", icon: Pipette },
  { id: "page", label: "Cores da página", icon: ScanSearch },
  { id: "gradient", label: "Gradiente", icon: SwatchBook },
  { id: "palettes", label: "Paletas", icon: PaletteIcon },
  { id: "history", label: "Histórico", icon: History },
];

const SIZE = {
  width: 360,
  height: 500,
  minWidth: 320,
  minHeight: 380,
  maxWidth: 720,
  maxHeight: 860,
};

export type ColorToolsPanelProps = {
  tab: ColorTab;
  current: string | null;
  autoCopy: AutoCopy;
  /** Tema do painel (claro/escuro/navegador), já resolvido. */
  dark: boolean;
  /** Atalho do conta-gotas (texto pronto, ex.: "Alt+Shift+C"). */
  pickShortcut: string;
  canPick: boolean;
  pageColors: PageColor[] | null;
  scanned: number;
  analyzing: boolean;
  library: ColorLibrary;
  gradient: Gradient;
  right: number;
  top: number;
  onTab: (tab: ColorTab) => void;
  onPick: () => void;
  onAnalyze: () => void;
  onSelect: (hex: string) => void;
  onCopy: (text: string) => void;
  onGradient: (gradient: Gradient) => void;
  onLibrary: (library: ColorLibrary) => void;
  onAutoCopy: (format: AutoCopy) => void;
  onExport: () => void;
  onImport: (text: string) => void;
  onSettings: () => void;
  onClose: () => void;
};

/** ColorTools (4.7): popover ancorado no conta-gotas da barra, redimensionável. */
export function ColorToolsPanel(props: ColorToolsPanelProps) {
  const [size, setSize] = useState({ width: SIZE.width, height: SIZE.height });
  const drag = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  // Alça no canto inferior esquerdo (o painel fica preso à direita, no botão).
  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, ...size };
  };
  const moveResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start) return;
    setSize({
      width: Math.round(
        Math.min(SIZE.maxWidth, Math.max(SIZE.minWidth, start.width + (start.x - event.clientX))),
      ),
      height: Math.round(
        Math.min(
          SIZE.maxHeight,
          Math.max(SIZE.minHeight, start.height + (event.clientY - start.y)),
          window.innerHeight - props.top - 12,
        ),
      ),
    });
  };

  return (
    <aside
      className={cn("app-menu color-tools", props.dark ? "dark" : "agz-light")}
      style={{ right: props.right, top: props.top, width: size.width, height: size.height }}
      aria-label="ColorTools"
      onKeyDown={(event) => {
        if (event.key === "Escape") props.onClose();
      }}
    >
      <header className="ct-head">
        <strong>ColorTools</strong>
        <div className="ct-tabs" role="tablist" aria-label="Ferramentas de cor">
          {TABS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={props.tab === item.id}
                className={cn(props.tab === item.id && "on")}
                title={item.label}
                aria-label={item.label}
                onClick={() => props.onTab(item.id)}
              >
                <Icon />
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="ct-icon"
          title="Configurações do ColorTools"
          aria-label="Configurações do ColorTools"
          onClick={props.onSettings}
        >
          <Settings2 />
        </button>
        <button
          type="button"
          className="ct-icon"
          title="Fechar"
          aria-label="Fechar ColorTools"
          onClick={props.onClose}
        >
          <X />
        </button>
      </header>
      <div className="ct-body">
        {props.tab === "picker" && <PickerTab {...props} />}
        {props.tab === "page" && <PageTab {...props} />}
        {props.tab === "gradient" && <GradientTab {...props} />}
        {props.tab === "palettes" && <PalettesTab {...props} />}
        {props.tab === "history" && <HistoryTab {...props} />}
      </div>
      <div
        className="ct-resize"
        role="separator"
        aria-label="Redimensionar"
        onPointerDown={startResize}
        onPointerMove={moveResize}
        onPointerUp={() => (drag.current = null)}
      />
    </aside>
  );
}

function Swatch({
  hex,
  label,
  onClick,
  selected,
}: {
  hex: string;
  label?: string;
  onClick: () => void;
  selected?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn("ct-swatch", selected && "on")}
      style={{ background: hex, color: readableOn(hex) }}
      title={label ?? hex.toUpperCase()}
      aria-label={label ?? `Cor ${hex.toUpperCase()}`}
      onClick={onClick}
    />
  );
}

function FormatRows({ hex, onCopy }: { hex: string; onCopy: (text: string) => void }) {
  return (
    <div className="ct-formats">
      {(["hex", "rgb", "hsl"] as const).map((format) => {
        const text = formatColor(hex, format);
        return (
          <button
            key={format}
            type="button"
            className="ct-format"
            onClick={() => onCopy(text)}
            title={`Copiar ${text}`}
          >
            <span>{format.toUpperCase()}</span>
            <code>{text}</code>
            <Copy aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

function PickerTab(props: ColorToolsPanelProps) {
  const [text, setText] = useState("");
  const typed = parseColor(text);
  return (
    <div className="ct-picker">
      <button
        type="button"
        className="ct-pick-button"
        disabled={!props.canPick}
        onClick={props.onPick}
        title={props.canPick ? undefined : "Abra um site para usar o conta-gotas"}
      >
        <Pipette aria-hidden="true" />
        <span>
          <strong>Pegar cor da página</strong>
          <small>
            {props.canPick
              ? `Clique num ponto da guia · Esc cancela${props.pickShortcut ? ` · ${props.pickShortcut}` : ""}`
              : "Abra um site para usar o conta-gotas"}
          </small>
        </span>
      </button>
      {props.current ? (
        <>
          <div
            className="ct-current"
            style={{ background: props.current, color: readableOn(props.current) }}
          >
            {props.current.toUpperCase()}
          </div>
          <FormatRows hex={props.current} onCopy={props.onCopy} />
        </>
      ) : (
        <p className="ct-empty">A cor escolhida aparece aqui, em HEX, RGB e HSL.</p>
      )}
      <label className="ct-field">
        <span>Digitar uma cor</span>
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && typed) props.onSelect(typed);
          }}
          placeholder="#d10a11, rgb(…) ou hsl(…)"
          aria-invalid={Boolean(text) && !typed}
        />
        {typed && (
          <button type="button" onClick={() => props.onSelect(typed)}>
            Usar
          </button>
        )}
      </label>
      <label className="ct-field">
        <span>Copiar ao escolher</span>
        <select
          value={props.autoCopy}
          onChange={(event) => props.onAutoCopy(event.target.value as AutoCopy)}
        >
          <option value="hex">HEX</option>
          <option value="rgb">RGB</option>
          <option value="hsl">HSL</option>
          <option value="off">Não copiar</option>
        </select>
      </label>
    </div>
  );
}

function PageTab(props: ColorToolsPanelProps) {
  const colors = props.pageColors;
  return (
    <div className="ct-page">
      <div className="ct-row">
        <button
          type="button"
          className="ct-button"
          disabled={!props.canPick || props.analyzing}
          onClick={props.onAnalyze}
        >
          <ScanSearch aria-hidden="true" />
          {props.analyzing ? "Analisando…" : colors ? "Analisar de novo" : "Analisar página"}
        </button>
        {colors && colors.length > 0 && (
          <button
            type="button"
            className="ct-button"
            onClick={() =>
              props.onLibrary({
                ...props.library,
                palettes: [
                  ...props.library.palettes,
                  {
                    id: `p${Date.now().toString(36)}`,
                    name: `Página ${new Date().toLocaleDateString("pt-BR")}`,
                    colors: colors.slice(0, 24).map((item) => item.hex),
                  },
                ],
              })
            }
          >
            <Plus aria-hidden="true" /> Salvar como paleta
          </button>
        )}
      </div>
      {!props.canPick && <p className="ct-empty">Abra um site para analisar as cores dele.</p>}
      {colors && (
        <p className="ct-note">
          {colors.length} cores em {props.scanned} elementos visíveis.
        </p>
      )}
      {colors && (
        <ul className="ct-list" aria-label="Cores da página">
          {colors.map((item) => (
            <li key={item.hex}>
              <Swatch hex={item.hex} onClick={() => props.onSelect(item.hex)} />
              <button
                type="button"
                className="ct-list-main"
                onClick={() => props.onSelect(item.hex)}
              >
                <code>{item.hex.toUpperCase()}</code>
                <small title={item.selector}>
                  {item.roles
                    .map((role) => ({ text: "texto", background: "fundo", border: "borda" })[role])
                    .join(", ")}{" "}
                  · {item.selector}
                </small>
              </button>
              <span className="ct-count">{item.count}×</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GradientTab(props: ColorToolsPanelProps) {
  const { gradient } = props;
  const css = gradientCss(gradient);
  const set = (patch: Partial<Gradient>) => props.onGradient({ ...gradient, ...patch });
  return (
    <div className="ct-gradient">
      <div className="ct-gradient-preview" style={{ background: css }} />
      <div className="ct-row">
        <div className="ct-seg" role="radiogroup" aria-label="Tipo de gradiente">
          {(["linear", "radial"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={gradient.kind === kind}
              className={cn(gradient.kind === kind && "on")}
              onClick={() => set({ kind })}
            >
              {kind === "linear" ? "Linear" : "Radial"}
            </button>
          ))}
        </div>
        {gradient.kind === "linear" ? (
          <label className="ct-inline">
            Ângulo
            <input
              type="number"
              min={0}
              max={360}
              value={gradient.angle}
              onChange={(event) => set({ angle: Number(event.target.value) || 0 })}
            />
          </label>
        ) : (
          <select
            aria-label="Forma"
            value={gradient.shape}
            onChange={(event) => set({ shape: event.target.value as Gradient["shape"] })}
          >
            <option value="circle">Círculo</option>
            <option value="ellipse">Elipse</option>
          </select>
        )}
      </div>
      <ul className="ct-stops" aria-label="Paradas">
        {gradient.stops.map((stop, index) => (
          <li key={index}>
            <input
              type="color"
              value={stop.color}
              aria-label={`Cor da parada ${index + 1}`}
              onChange={(event) =>
                set({
                  stops: gradient.stops.map((item, i) =>
                    i === index ? { ...item, color: event.target.value } : item,
                  ),
                })
              }
            />
            <input
              type="range"
              min={0}
              max={100}
              value={stop.at}
              aria-label={`Posição da parada ${index + 1}`}
              onChange={(event) =>
                set({
                  stops: gradient.stops.map((item, i) =>
                    i === index ? { ...item, at: Number(event.target.value) } : item,
                  ),
                })
              }
            />
            <span className="ct-count">{stop.at}%</span>
            <button
              type="button"
              className="ct-icon"
              disabled={gradient.stops.length <= 2}
              aria-label={`Tirar a parada ${index + 1}`}
              onClick={() => set({ stops: gradient.stops.filter((_item, i) => i !== index) })}
            >
              <Trash2 />
            </button>
          </li>
        ))}
      </ul>
      <div className="ct-row">
        <button
          type="button"
          className="ct-button"
          disabled={gradient.stops.length >= 8}
          onClick={() =>
            set({ stops: [...gradient.stops, { color: props.current ?? "#ffffff", at: 50 }] })
          }
        >
          <Plus aria-hidden="true" /> Parada
        </button>
        <button
          type="button"
          className="ct-button primary"
          onClick={() => props.onCopy(`background: ${css};`)}
        >
          <Copy aria-hidden="true" /> Copiar CSS
        </button>
      </div>
      <code className="ct-css">background: {css};</code>
    </div>
  );
}

function PalettesTab(props: ColorToolsPanelProps) {
  const { library } = props;
  const fileRef = useRef<HTMLInputElement | null>(null);
  const update = (palettes: ColorLibrary["palettes"]) => props.onLibrary({ ...library, palettes });
  return (
    <div className="ct-palettes">
      <div className="ct-row">
        <button
          type="button"
          className="ct-button"
          onClick={() =>
            update([
              ...library.palettes,
              {
                id: `p${Date.now().toString(36)}`,
                name: `Paleta ${library.palettes.length + 1}`,
                colors: props.current ? [props.current] : [],
              },
            ])
          }
        >
          <Plus aria-hidden="true" /> Nova paleta
        </button>
        <button
          type="button"
          className="ct-button"
          onClick={props.onExport}
          title="Exportar histórico e paletas (JSON)"
        >
          <Download aria-hidden="true" /> Exportar
        </button>
        <button type="button" className="ct-button" onClick={() => fileRef.current?.click()}>
          <Upload aria-hidden="true" /> Importar
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file || file.size > 1024 * 1024) return;
            void file.text().then(props.onImport);
          }}
        />
      </div>
      {library.palettes.length === 0 && (
        <p className="ct-empty">Nenhuma paleta salva. Crie uma ou salve as cores da página.</p>
      )}
      {library.palettes.map((palette) => (
        <section key={palette.id} className="ct-palette">
          <div className="ct-row">
            <input
              className="ct-name"
              value={palette.name}
              aria-label="Nome da paleta"
              maxLength={60}
              onChange={(event) =>
                update(
                  library.palettes.map((item) =>
                    item.id === palette.id ? { ...item, name: event.target.value } : item,
                  ),
                )
              }
            />
            <button
              type="button"
              className="ct-icon"
              disabled={!props.current || palette.colors.includes(props.current)}
              title={props.current ? `Adicionar ${props.current.toUpperCase()}` : "Escolha uma cor"}
              aria-label="Adicionar a cor atual"
              onClick={() =>
                props.current &&
                update(
                  library.palettes.map((item) =>
                    item.id === palette.id
                      ? { ...item, colors: [...item.colors, props.current!] }
                      : item,
                  ),
                )
              }
            >
              <Plus />
            </button>
            <button
              type="button"
              className="ct-icon"
              aria-label={`Apagar ${palette.name}`}
              onClick={() => update(library.palettes.filter((item) => item.id !== palette.id))}
            >
              <Trash2 />
            </button>
          </div>
          <div className="ct-swatches">
            {palette.colors.map((hex) => (
              <Swatch
                key={hex}
                hex={hex}
                selected={props.current === hex}
                label={`${hex.toUpperCase()}: clique para copiar`}
                onClick={() => {
                  props.onSelect(hex);
                }}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function HistoryTab(props: ColorToolsPanelProps) {
  const [query, setQuery] = useState("");
  const { library } = props;
  const list = useMemo(() => {
    const found = searchHistory(library.history, query);
    return [...found.filter((item) => item.pinned), ...found.filter((item) => !item.pinned)];
  }, [library.history, query]);
  const setHistory = (history: ColorLibrary["history"]) => props.onLibrary({ ...library, history });
  return (
    <div className="ct-history">
      <div className="ct-row">
        <input
          className="ct-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar HEX, RGB ou site"
          aria-label="Buscar no histórico de cores"
        />
        <button
          type="button"
          className="ct-button"
          disabled={!library.history.some((item) => !item.pinned)}
          onClick={() => setHistory(library.history.filter((item) => item.pinned))}
        >
          <Trash2 aria-hidden="true" /> Limpar
        </button>
      </div>
      {list.length === 0 && (
        <p className="ct-empty">
          {query ? "Nada com essa busca." : "As cores que você pegar ficam aqui."}
        </p>
      )}
      <ul className="ct-list" aria-label="Histórico de cores">
        {list.map((item) => (
          <li key={item.hex}>
            <Swatch hex={item.hex} onClick={() => props.onSelect(item.hex)} />
            <button type="button" className="ct-list-main" onClick={() => props.onSelect(item.hex)}>
              <code>{item.hex.toUpperCase()}</code>
              <small>
                {new Date(item.at).toLocaleString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {item.source ? ` · ${item.source}` : ""}
              </small>
            </button>
            <button
              type="button"
              className="ct-icon"
              aria-label={item.pinned ? `Desafixar ${item.hex}` : `Fixar ${item.hex}`}
              aria-pressed={item.pinned}
              title={item.pinned ? "Desafixar" : "Fixar"}
              onClick={() =>
                setHistory(
                  library.history.map((entry) =>
                    entry.hex === item.hex ? { ...entry, pinned: !entry.pinned } : entry,
                  ),
                )
              }
            >
              {item.pinned ? <PinOff /> : <Pin />}
            </button>
            <button
              type="button"
              className="ct-icon"
              aria-label={`Tirar ${item.hex} do histórico`}
              onClick={() => setHistory(library.history.filter((entry) => entry.hex !== item.hex))}
            >
              <X />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

import { ArrowDown, ArrowUp, FilePlus2, RotateCcw, RotateCw, Trash2, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";

import { pdfCall } from "./client";
import { chunkPages, parsePageRanges, type FractionBox } from "./engine";
import { derivedName, formatSize, type ToolContext } from "./state";
import { LazyThumb } from "./viewer";

type Slot = { source: number; rotate: number; removed: boolean };

/** Organizar: arrastar para reordenar, girar, apagar e recortar (margens). */
export function OrganizeTool(ctx: ToolContext) {
  const count = ctx.doc.info.pages.length;
  const initial = useMemo(
    () => Array.from({ length: count }, (_v, source) => ({ source, rotate: 0, removed: false })),
    [count],
  );
  const [slots, setSlots] = useState<Slot[]>(initial);
  const [picked, setPicked] = useState<Set<number>>(() => new Set());
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [margins, setMargins] = useState({ top: 0, right: 0, bottom: 0, left: 0 });

  const changed = slots.some(
    (slot, index) => slot.source !== index || slot.rotate % 360 !== 0 || slot.removed,
  );
  const cropping = Object.values(margins).some((value) => value > 0);

  const move = (from: number, to: number) => {
    if (from === to) return;
    setSlots((list) => {
      const next = [...list];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item!);
      return next;
    });
  };
  const rotateSelected = (delta: number) =>
    setSlots((list) =>
      list.map((slot, index) =>
        picked.size === 0 || picked.has(index) ? { ...slot, rotate: slot.rotate + delta } : slot,
      ),
    );

  const apply = async () => {
    const kept = slots.filter((slot) => !slot.removed);
    if (!kept.length) {
      ctx.notify("O PDF precisa de ao menos uma página.");
      return;
    }
    const rotate: Record<number, number> = {};
    for (const slot of kept) if (slot.rotate % 360) rotate[slot.source] = slot.rotate;
    const crop: Record<number, FractionBox> = {};
    if (cropping) {
      const box = {
        x: margins.left / 100,
        y: margins.top / 100,
        w: 1 - (margins.left + margins.right) / 100,
        h: 1 - (margins.top + margins.bottom) / 100,
      };
      if (box.w <= 0.05 || box.h <= 0.05) {
        ctx.notify("As margens de recorte comem a página inteira.");
        return;
      }
      const targets = picked.size
        ? [...picked].map((index) => slots[index]!.source)
        : kept.map((slot) => slot.source);
      for (const source of targets) crop[source] = box;
    }
    const result = await ctx.run("Organizando as páginas", () =>
      pdfCall<Uint8Array>("organize", [
        ctx.doc.bytes,
        { order: kept.map((slot) => slot.source), rotate, crop },
        ctx.doc.password ?? undefined,
      ]),
    );
    if (!result) return;
    await ctx.replace(result, { label: "Páginas organizadas" });
  };

  return (
    <div className="pdf-organize">
      <div className="pdf-row">
        <button type="button" className="pdf-button" onClick={() => rotateSelected(-90)}>
          <RotateCcw aria-hidden="true" /> Girar à esquerda
        </button>
        <button type="button" className="pdf-button" onClick={() => rotateSelected(90)}>
          <RotateCw aria-hidden="true" /> Girar à direita
        </button>
        <button
          type="button"
          className="pdf-button"
          disabled={!picked.size}
          onClick={() =>
            setSlots((list) =>
              list.map((slot, index) =>
                picked.has(index) ? { ...slot, removed: !slot.removed } : slot,
              ),
            )
          }
        >
          <Trash2 aria-hidden="true" /> Apagar/voltar selecionadas
        </button>
        <button
          type="button"
          className="pdf-button"
          disabled={!changed}
          onClick={() => setSlots(initial)}
        >
          <Undo2 aria-hidden="true" /> Desfazer
        </button>
        <span className="pdf-muted">
          {picked.size
            ? `${picked.size} selecionadas (os botões valem para elas)`
            : "Sem seleção: os botões valem para todas"}
        </span>
      </div>
      <details className="pdf-crop">
        <summary>Recortar (margens em %)</summary>
        <div className="pdf-grid4">
          {(["top", "right", "bottom", "left"] as const).map((side) => (
            <label key={side} className="pdf-field">
              {{ top: "Cima", right: "Direita", bottom: "Baixo", left: "Esquerda" }[side]}
              <input
                type="number"
                min={0}
                max={45}
                value={margins[side]}
                onChange={(event) =>
                  setMargins({
                    ...margins,
                    [side]: Math.min(45, Math.max(0, Number(event.target.value) || 0)),
                  })
                }
              />
            </label>
          ))}
        </div>
      </details>
      <ol className="pdf-thumbs" aria-label="Páginas">
        {slots.map((slot, index) => (
          <li
            key={`${slot.source}-${index}`}
            className={cn(
              "pdf-thumb",
              picked.has(index) && "picked",
              slot.removed && "removed",
              dragFrom === index && "dragging",
            )}
            draggable
            onDragStart={(event) => {
              setDragFrom(index);
              event.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (dragFrom !== null) move(dragFrom, index);
              setDragFrom(null);
            }}
            onDragEnd={() => setDragFrom(null)}
          >
            <button
              type="button"
              className="pdf-thumb-pick"
              aria-pressed={picked.has(index)}
              aria-label={`Selecionar a página ${slot.source + 1}`}
              onClick={(event) =>
                setPicked((current) => {
                  const next = new Set(
                    event.shiftKey || event.ctrlKey || event.metaKey ? current : [],
                  );
                  if (current.has(index) && (event.shiftKey || event.ctrlKey || event.metaKey))
                    next.delete(index);
                  else next.add(index);
                  return next;
                })
              }
            >
              <LazyThumb doc={ctx.render} index={slot.source} width={120} rotate={slot.rotate} />
            </button>
            <div className="pdf-thumb-bar">
              <span>{slot.source + 1}</span>
              <button
                type="button"
                aria-label="Mover para trás"
                disabled={index === 0}
                onClick={() => move(index, index - 1)}
              >
                <ArrowUp />
              </button>
              <button
                type="button"
                aria-label="Mover para frente"
                disabled={index === slots.length - 1}
                onClick={() => move(index, index + 1)}
              >
                <ArrowDown />
              </button>
              <button
                type="button"
                aria-label={slot.removed ? "Voltar a página" : "Apagar a página"}
                onClick={() =>
                  setSlots((list) =>
                    list.map((item, i) =>
                      i === index ? { ...item, removed: !item.removed } : item,
                    ),
                  )
                }
              >
                <Trash2 />
              </button>
            </div>
          </li>
        ))}
      </ol>
      <div className="pdf-footer">
        <button
          type="button"
          className="pdf-primary"
          disabled={!changed && !cropping}
          onClick={() => void apply()}
        >
          Aplicar
        </button>
      </div>
    </div>
  );
}

type MergeItem = {
  id: number;
  name: string;
  bytes: Uint8Array;
  pages: number;
  range: string;
  password?: string;
};

/** Juntar: o PDF aberto e outros, na ordem, com páginas escolhidas de cada. */
export function MergeTool(ctx: ToolContext) {
  const [items, setItems] = useState<MergeItem[]>(() => [
    {
      id: 0,
      name: ctx.doc.name,
      bytes: ctx.doc.bytes,
      pages: ctx.doc.info.pages.length,
      range: "",
      ...(ctx.doc.password ? { password: ctx.doc.password } : {}),
    },
  ]);
  const add = async () => {
    const result = await ctx.desktop.pdfOpenDialog(ctx.prefs.maxMb);
    if (!result.ok || !result.files) {
      if (result.error === "size")
        ctx.notify(`${result.name ?? "Arquivo"} passa de ${ctx.prefs.maxMb} MB.`);
      return;
    }
    const added: MergeItem[] = [];
    for (const file of result.files) {
      if (!/\.pdf$/i.test(file.name)) {
        ctx.notify(`${file.name} não é PDF (use Converter para imagens e documentos).`);
        continue;
      }
      const bytes = new Uint8Array(file.bytes);
      try {
        const info = await pdfCall<{ pages: unknown[] }>("info", [bytes]);
        added.push({
          id: Date.now() + added.length,
          name: file.name,
          bytes,
          pages: info.pages.length,
          range: "",
        });
      } catch {
        ctx.notify(`${file.name}: PDF com senha ou danificado (abra-o e tire a senha antes).`);
      }
    }
    setItems((list) => [...list, ...added]);
  };
  const merge = async () => {
    const inputs = items.map((item) => ({
      bytes: item.bytes,
      ...(item.password ? { password: item.password } : {}),
      ...(item.range.trim() ? { pages: parsePageRanges(item.range, item.pages) } : {}),
    }));
    const result = await ctx.run("Juntando os PDFs", () => pdfCall<Uint8Array>("merge", [inputs]));
    if (result)
      await ctx.replace(result, { label: `${items.length} PDFs juntados`, password: null });
  };
  return (
    <div className="pdf-merge">
      <p className="pdf-muted">
        A ordem da lista é a ordem do PDF final. Deixe "páginas" vazio para usar todas.
      </p>
      <ol className="pdf-merge-list">
        {items.map((item, index) => (
          <li key={item.id}>
            <span className="pdf-merge-name" title={item.name}>
              {item.name}
              <small>
                {item.pages} páginas · {formatSize(item.bytes.length)}
              </small>
            </span>
            <input
              aria-label={`Páginas de ${item.name}`}
              placeholder="Todas (ex.: 1-3, 7)"
              value={item.range}
              onChange={(event) =>
                setItems((list) =>
                  list.map((entry) =>
                    entry.id === item.id ? { ...entry, range: event.target.value } : entry,
                  ),
                )
              }
            />
            <button
              type="button"
              aria-label="Subir"
              disabled={index === 0}
              onClick={() => setItems((list) => swap(list, index, index - 1))}
            >
              <ArrowUp />
            </button>
            <button
              type="button"
              aria-label="Descer"
              disabled={index === items.length - 1}
              onClick={() => setItems((list) => swap(list, index, index + 1))}
            >
              <ArrowDown />
            </button>
            <button
              type="button"
              aria-label={`Tirar ${item.name}`}
              disabled={items.length === 1}
              onClick={() => setItems((list) => list.filter((entry) => entry.id !== item.id))}
            >
              <Trash2 />
            </button>
          </li>
        ))}
      </ol>
      <div className="pdf-row">
        <button type="button" className="pdf-button" onClick={() => void add()}>
          <FilePlus2 aria-hidden="true" /> Adicionar PDFs
        </button>
        <span className="pdf-grow" />
        <button
          type="button"
          className="pdf-primary"
          disabled={items.length < 2}
          onClick={() => void merge()}
        >
          Juntar {items.length} PDFs
        </button>
      </div>
    </div>
  );
}

function swap<T>(list: T[], a: number, b: number): T[] {
  const next = [...list];
  [next[a], next[b]] = [next[b]!, next[a]!];
  return next;
}

/** Dividir: a cada N páginas, por intervalos ("1-3; 4-6") ou extrair um intervalo. */
export function SplitTool(ctx: ToolContext) {
  const total = ctx.doc.info.pages.length;
  const [mode, setMode] = useState<"every" | "ranges" | "extract">("every");
  const [every, setEvery] = useState(1);
  const [ranges, setRanges] = useState("");
  const groups = useMemo(() => {
    if (mode === "every") return chunkPages(total, every);
    if (mode === "extract") {
      const pages = parsePageRanges(ranges, total);
      return pages.length ? [pages] : [];
    }
    return ranges
      .split(";")
      .map((part) => parsePageRanges(part, total))
      .filter((group) => group.length);
  }, [mode, every, ranges, total]);
  const split = async () => {
    const result = await ctx.run("Dividindo o PDF", () =>
      pdfCall<Uint8Array[]>("split", [ctx.doc.bytes, groups, ctx.doc.password ?? undefined]),
    );
    if (!result) return;
    if (result.length === 1 && mode === "extract") {
      await ctx.exportFile(derivedName(ctx.doc.name, `páginas ${ranges.trim()}`), result[0]!, [
        "pdf",
      ]);
      return;
    }
    await ctx.saveMany(
      result.map((bytes, index) => ({
        name: derivedName(
          ctx.doc.name,
          `parte ${String(index + 1).padStart(String(result.length).length, "0")}`,
        ),
        bytes,
      })),
    );
  };
  return (
    <div className="pdf-split">
      <div className="pdf-seg" role="radiogroup" aria-label="Como dividir">
        {(
          [
            ["every", "A cada N páginas"],
            ["ranges", "Por intervalos"],
            ["extract", "Extrair páginas"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={mode === id}
            className={cn(mode === id && "on")}
            onClick={() => setMode(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === "every" ? (
        <label className="pdf-field">
          Páginas por arquivo
          <input
            type="number"
            min={1}
            max={total}
            value={every}
            onChange={(event) => setEvery(Math.max(1, Number(event.target.value) || 1))}
          />
        </label>
      ) : (
        <label className="pdf-field">
          {mode === "ranges"
            ? "Intervalos (um arquivo por grupo, separados por ;)"
            : "Páginas para um PDF novo"}
          <input
            value={ranges}
            placeholder={mode === "ranges" ? "1-3; 4-10; 11-" : "2, 5-7"}
            onChange={(event) => setRanges(event.target.value)}
          />
        </label>
      )}
      <p className="pdf-muted">
        {groups.length
          ? `${groups.length} ${groups.length === 1 ? "arquivo" : "arquivos"}: ${groups
              .slice(0, 6)
              .map((group) =>
                group.length > 1
                  ? `${group[0]! + 1}–${group[group.length - 1]! + 1}`
                  : `${group[0]! + 1}`,
              )
              .join(", ")}${groups.length > 6 ? "…" : ""}`
          : "Nenhuma página nesse intervalo."}
      </p>
      <div className="pdf-footer">
        <button
          type="button"
          className="pdf-primary"
          disabled={!groups.length}
          onClick={() => void split()}
        >
          Dividir e salvar
        </button>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

import type { StudioIO } from "./io";
import type { Asset, Doc } from "./model";
import { exportDoc, exportSize, EXPORT_MIME, type ExportFormat, type ImageCache } from "./render";
import { X } from "lucide-react";

const FORMATS: { id: ExportFormat; label: string; ext: string }[] = [
  { id: "png", label: "PNG", ext: "png" },
  { id: "jpeg", label: "JPEG", ext: "jpg" },
  { id: "webp", label: "WebP", ext: "webp" },
];

/** Exportar: formato, qualidade (JPEG e WebP), escala 1× ou 2× e a prévia do tamanho final. */
export function ExportDialog({
  doc,
  assets,
  cache,
  io,
  name,
  onStatus,
  onClose,
}: {
  doc: Doc;
  assets: Record<string, Asset>;
  cache: ImageCache;
  io: StudioIO;
  name: string;
  onStatus(text: string | null): void;
  onClose(): void;
}) {
  useEffect(() => {
    // Esc fecha; em fase de captura, antes dos atalhos da casca e do editor.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const [format, setFormat] = useState<ExportFormat>("png");
  const [quality, setQuality] = useState(92);
  const [scale, setScale] = useState(1);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const size = exportSize(doc, scale);
  const lossy = format !== "png";
  const fileName = `${name.replace(/[<>:"/\\|?*]/g, "_") || "imagem"}${scale > 1 ? "@2x" : ""}.${FORMATS.find((item) => item.id === format)?.ext ?? "png"}`;

  useEffect(() => {
    let alive = true;
    void exportDoc(doc, assets, cache, { format: "png", quality: 100, scale: 1 })
      .then((blob) => {
        if (!alive) return;
        setPreview(URL.createObjectURL(blob));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [doc, assets, cache]);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const run = async (action: "copy" | "save") => {
    setBusy(true);
    try {
      const blob = await exportDoc(doc, assets, cache, { format, quality, scale });
      if (action === "copy") {
        const copied = await io.copyPng(
          await exportDoc(doc, assets, cache, { format: "png", quality: 100, scale }),
        );
        onStatus(copied ? "Imagem copiada." : "Não foi possível copiar.");
      } else {
        const saved = await io.exportFile(blob, fileName);
        onStatus(saved ? `Exportada: ${fileName}` : null);
        if (saved) onClose();
      }
    } catch {
      onStatus("Não foi possível exportar esta imagem.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ims-modal-backdrop" role="presentation" onPointerDown={onClose}>
      <div
        className="ims-modal ims-export"
        role="dialog"
        aria-modal="true"
        aria-label="Exportar imagem"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header>
          <strong>Exportar</strong>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar">
            <X />
          </Button>
        </header>
        <div className="ims-export-body">
          <div className="ims-export-preview">
            {preview ? <img src={preview} alt="Prévia da exportação" /> : <span>Preparando…</span>}
          </div>
          <div className="ims-export-form">
            <fieldset className="ims-segment">
              <legend>Formato</legend>
              {FORMATS.map((item) => (
                <label key={item.id}>
                  <input
                    type="radio"
                    name="ims-format"
                    checked={format === item.id}
                    onChange={() => setFormat(item.id)}
                  />
                  <span>{item.label}</span>
                </label>
              ))}
            </fieldset>
            <fieldset className="ims-segment">
              <legend>Escala</legend>
              {[1, 2].map((value) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="ims-scale"
                    checked={scale === value}
                    onChange={() => setScale(value)}
                  />
                  <span>{value}×</span>
                </label>
              ))}
            </fieldset>
            <label className="ims-range">
              <span>
                Qualidade
                <output>{lossy ? `${quality}%` : "sem perdas"}</output>
              </span>
              <input
                type="range"
                min={10}
                max={100}
                value={quality}
                disabled={!lossy}
                onChange={(event) => setQuality(Number(event.target.value))}
              />
            </label>
            <p className="ims-hint-text">
              {size.width} × {size.height} px · {EXPORT_MIME[format]}
              {size.scale < scale ? " (reduzida para caber no limite do canvas)" : ""}
              {format === "jpeg" && !doc.background
                ? " · fundo branco (JPEG não tem transparência)"
                : ""}
            </p>
            <div className="ims-tools-row">
              <Button variant="outline" disabled={busy} onClick={() => void run("copy")}>
                Copiar PNG
              </Button>
              <Button disabled={busy} onClick={() => void run("save")}>
                Salvar {fileName}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import { AppWindow, Camera, Copy, Crop, Download, PanelTop, X } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent } from "react";

import { Button } from "@/components/ui/button";
import type { DesktopBridge } from "@/features/browser/desktop";
import { cn } from "@/lib/utils";

import { cropPng, regionOf, type Rect } from "./compose";

export type CaptureSources = { tab: string | null; window: string | null };
type Source = keyof CaptureSources;

/**
 * Captura de tela (4.5): a foto da guia e a da janela do app já foram tiradas antes do
 * diálogo abrir. Aqui escolhe-se a fonte, opcionalmente uma região, e copia ou salva o PNG.
 * Nada fora da janela do Agzos é capturado.
 */
export function CaptureDialog({
  desktop,
  sources,
  onClose,
}: {
  desktop: DesktopBridge | null;
  sources: CaptureSources;
  onClose: () => void;
}) {
  const [source, setSource] = useState<Source>(sources.tab ? "tab" : "window");
  const [selecting, setSelecting] = useState(false);
  const [region, setRegion] = useState<Rect | null>(null);
  const [drag, setDrag] = useState<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const image = sources[source];

  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const choose = (next: Source) => {
    setSource(next);
    setRegion(null);
    setStatus(null);
  };

  // Ponto do ponteiro → pixels da imagem (a prévia aparece reduzida).
  const toImage = (event: PointerEvent<HTMLElement>) => {
    const element = imageRef.current;
    if (!element) return null;
    const box = element.getBoundingClientRect();
    const scaleX = element.naturalWidth / box.width;
    const scaleY = element.naturalHeight / box.height;
    return {
      x: (event.clientX - box.left) * scaleX,
      y: (event.clientY - box.top) * scaleY,
      cx: event.clientX - box.left,
      cy: event.clientY - box.top,
    };
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!selecting || event.button !== 0) return;
    const point = toImage(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag(point);
    setRegion(null);
  };
  const [cursor, setCursor] = useState<{ cx: number; cy: number } | null>(null);
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const point = toImage(event);
    if (point) setCursor({ cx: point.cx, cy: point.cy });
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const point = toImage(event);
    const element = imageRef.current;
    setDrag(null);
    setCursor(null);
    if (!point || !element) return;
    setRegion(
      regionOf(drag, point, { width: element.naturalWidth, height: element.naturalHeight }),
    );
  };

  const result = async () => {
    if (!image) return null;
    return region ? cropPng(image, region) : image;
  };

  const copy = async () => {
    const png = await result();
    if (!png || !desktop) return;
    const ok = await desktop.captureCopy(png);
    setStatus(ok ? "Imagem copiada." : "Não foi possível copiar.");
  };
  const save = async () => {
    const png = await result();
    if (!png || !desktop) return;
    const saved = await desktop.captureSave(png);
    if (saved.ok) setStatus(`Salva em ${saved.path}`);
    else if (!saved.canceled) setStatus("Não foi possível salvar.");
  };

  // Retângulo da seleção na prévia (px CSS).
  const box = imageRef.current?.getBoundingClientRect();
  const previewScale = box && imageRef.current ? box.width / imageRef.current.naturalWidth : 1;
  const marquee =
    drag && cursor
      ? {
          left: Math.min(drag.cx, cursor.cx),
          top: Math.min(drag.cy, cursor.cy),
          width: Math.abs(cursor.cx - drag.cx),
          height: Math.abs(cursor.cy - drag.cy),
        }
      : region
        ? {
            left: region.x * previewScale,
            top: region.y * previewScale,
            width: region.width * previewScale,
            height: region.height * previewScale,
          }
        : null;

  return (
    <div className="capture-backdrop" role="presentation">
      <div
        ref={dialogRef}
        className="capture-dialog"
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
              aria-checked={source === "window"}
              disabled={!sources.window}
              onClick={() => choose("window")}
            >
              <AppWindow aria-hidden="true" /> Janela do app
            </button>
          </div>
          <Button
            variant={selecting ? "default" : "outline"}
            size="sm"
            aria-pressed={selecting}
            onClick={() => {
              setSelecting((value) => !value);
              setRegion(null);
            }}
          >
            <Crop /> Região
          </Button>
          <Button variant="ghost" size="icon" aria-label="Fechar captura" onClick={onClose}>
            <X />
          </Button>
        </header>
        <div
          className={cn("capture-stage", selecting && "selecting")}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            setDrag(null);
            setCursor(null);
          }}
        >
          {image ? (
            <div className="capture-frame">
              <img ref={imageRef} src={image} alt="Prévia da captura" draggable={false} />
              {marquee && (
                <span
                  className="capture-marquee"
                  style={marquee}
                  aria-label={region ? `Região ${region.width} × ${region.height}` : undefined}
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
              (selecting
                ? region
                  ? `Região de ${region.width} × ${region.height} px`
                  : "Arraste na imagem para escolher a região."
                : "Só o que está dentro da janela do Agzos é capturado.")}
          </span>
          <Button variant="outline" disabled={!image} onClick={() => void copy()}>
            <Copy /> Copiar
          </Button>
          <Button disabled={!image} onClick={() => void save()}>
            <Download /> Salvar PNG…
          </Button>
        </footer>
      </div>
    </div>
  );
}

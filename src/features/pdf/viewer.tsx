import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

import { renderPage, thumbnail } from "./render";

/** Página desenhada no tamanho da caixa (largura), com camada por cima (editor). */
export function PageCanvas({
  doc,
  index,
  width,
  children,
  onSize,
}: {
  doc: PDFDocumentProxy;
  index: number;
  width: number;
  children?: ReactNode;
  onSize?: (size: { width: number; height: number }) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    void (async () => {
      const page = await doc.getPage(index + 1);
      const base = page.getViewport({ scale: 1 });
      const ratio = window.devicePixelRatio || 1;
      const scale = (width / base.width) * ratio;
      // Desenha fora da tela e troca de uma vez (sem piscar em branco).
      const off = document.createElement("canvas");
      const drawn = await renderPage(doc, index, off, scale);
      if (cancelled) return;
      canvas.width = drawn.width;
      canvas.height = drawn.height;
      canvas.getContext("2d")?.drawImage(off, 0, 0);
      const shown = { width, height: Math.round((drawn.height / drawn.width) * width) };
      setSize(shown);
      onSize?.(shown);
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, index, width]);
  return (
    <div
      className="pdf-page"
      style={{ width, height: size?.height ?? Math.round(width * 1.414) }}
      data-page={index + 1}
    >
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%" }}
        aria-label={`Página ${index + 1}`}
      />
      {children}
    </div>
  );
}

/** Miniatura que só desenha quando aparece na tela (PDFs de 500 páginas). */
export function LazyThumb({
  doc,
  index,
  width,
  rotate = 0,
}: {
  doc: PDFDocumentProxy;
  index: number;
  width: number;
  rotate?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        void thumbnail(doc, index, width * (window.devicePixelRatio || 1))
          .then((url) => !cancelled && setSrc(url))
          .catch(() => {});
      },
      { rootMargin: "300px" },
    );
    observer.observe(node);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [doc, index, width]);
  return (
    <div
      ref={ref}
      className="pdf-thumb-image"
      style={{ width, minHeight: Math.round(width * 1.3) }}
    >
      {src ? (
        <img src={src} alt={`Página ${index + 1}`} style={{ transform: `rotate(${rotate}deg)` }} />
      ) : (
        <span className="pdf-thumb-placeholder">{index + 1}</span>
      )}
    </div>
  );
}

/** Lista de páginas que só desenha as visíveis (o resto fica com a altura reservada). */
export function PageList({
  doc,
  count,
  width,
  renderOverlay,
}: {
  doc: PDFDocumentProxy;
  count: number;
  width: number;
  renderOverlay?: (index: number) => ReactNode;
}) {
  const [visible, setVisible] = useState<Set<number>>(() => new Set([0, 1]));
  const holders = useRef(new Map<number, HTMLDivElement>());
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        setVisible((current) => {
          const next = new Set(current);
          let changed = false;
          for (const entry of entries) {
            const index = Number((entry.target as HTMLElement).dataset["index"]);
            if (entry.isIntersecting && !next.has(index)) {
              next.add(index);
              changed = true;
            } else if (!entry.isIntersecting && next.has(index)) {
              next.delete(index);
              changed = true;
            }
          }
          return changed ? next : current;
        });
      },
      { rootMargin: "800px 0px" },
    );
    for (const node of holders.current.values()) observer.observe(node);
    return () => observer.disconnect();
  }, [count, doc]);
  return (
    <div className="pdf-pages">
      {Array.from({ length: count }, (_value, index) => (
        <div
          key={index}
          data-index={index}
          ref={(node) => {
            if (node) holders.current.set(index, node);
            else holders.current.delete(index);
          }}
          className="pdf-page-holder"
          style={{ minHeight: Math.round(width * 1.3) }}
        >
          {visible.has(index) ? (
            <PageCanvas doc={doc} index={index} width={width}>
              {renderOverlay?.(index)}
            </PageCanvas>
          ) : (
            <div
              className="pdf-page pdf-page-empty"
              style={{ width, height: Math.round(width * 1.3) }}
            >
              {index + 1}
            </div>
          )}
          <span className="pdf-page-number">
            {index + 1} / {count}
          </span>
        </div>
      ))}
    </div>
  );
}

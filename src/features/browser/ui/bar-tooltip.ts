import { useCallback, useEffect, useRef, type PointerEvent } from "react";

export type BarTooltips = {
  show: (text: string, anchor: { x: number; y: number; width: number; height: number }) => void;
  hide: () => void;
};

const DELAY_MS = 450;

/**
 * 4.6.1: dicas da barra pelo app (no desktop). O `title` do botão vira `data-tip` na
 * primeira passada do mouse (o tooltip nativo, que cortava, não aparece) e a dica sai
 * numa view do main, inteira e dentro da janela. Sem `tooltips` (web), fica o nativo.
 */
export function useBarTooltips(tooltips: BarTooltips | null) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = useRef<Element | null>(null);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (current.current) tooltips?.hide();
    current.current = null;
  }, [tooltips]);

  useEffect(() => hide, [hide]);

  const onPointerOver = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (!tooltips) return;
      const target = (event.target as Element).closest("[title], [data-tip]");
      if (!target || !event.currentTarget.contains(target) || target === current.current) return;
      const title = target.getAttribute("title");
      if (title) {
        target.setAttribute("data-tip", title);
        target.removeAttribute("title");
      }
      hide();
      current.current = target;
      timer.current = setTimeout(() => {
        const text = target.getAttribute("data-tip");
        if (!text || current.current !== target || !target.isConnected) return;
        const box = target.getBoundingClientRect();
        tooltips.show(text, { x: box.left, y: box.top, width: box.width, height: box.height });
      }, DELAY_MS);
    },
    [tooltips, hide],
  );

  const onPointerOut = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const next = event.relatedTarget as Element | null;
      if (current.current && next && current.current.contains(next)) return;
      hide();
    },
    [hide],
  );

  return { onPointerOver, onPointerOut, onPointerDown: hide, onWheel: hide };
}

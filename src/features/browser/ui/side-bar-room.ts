/** Caixa de um elemento fixo da barra lateral: altura e margens verticais (px). */
export type SideBarBox = { height: number; marginTop: number; marginBottom: number };

/**
 * Altura livre para os apps da barra lateral (5.0.1). `sideBarFit` conta o espaço entre os
 * itens e cada fixo; aqui entram também as margens verticais (o divisor tem 2 px em cima e
 * embaixo, que a medida antiga ignorava). Função pura: a barra mede o DOM e passa os números.
 */
export function sideBarRoom(
  nav: { clientHeight: number; paddingTop: number; paddingBottom: number; gap: number },
  fixed: SideBarBox[],
  item: number,
): { height: number; fixed: number; item: number; gap: number } {
  const gap = Math.max(0, nav.gap);
  const height = Math.max(0, nav.clientHeight - nav.paddingTop - nav.paddingBottom);
  const fixedHeight = fixed.reduce(
    (sum, box) => sum + box.height + box.marginTop + box.marginBottom + gap,
    0,
  );
  return { height, fixed: fixedHeight, item, gap };
}

import { describe, expect, it } from "vitest";

import { sideBarFit } from "../side-panels";
import { sideBarRoom, type SideBarBox } from "./side-bar-room";

// Barra como no DOM: Control, Portas e Ferramentas (48 px), divisor (1 px com 2 px de
// margem em cima e embaixo) e "+" (34 px) fixos; gap de 6 px e padding de 10 px.
const FIXED: SideBarBox[] = [
  { height: 48, marginTop: 0, marginBottom: 0 },
  { height: 48, marginTop: 0, marginBottom: 0 },
  { height: 48, marginTop: 0, marginBottom: 0 },
  { height: 1, marginTop: 2, marginBottom: 2 },
  { height: 34, marginTop: 0, marginBottom: 0 },
];
const NAV = { paddingTop: 10, paddingBottom: 10, gap: 6 };

describe("sideBarRoom", () => {
  it("desconta padding e conta margens e o gap de cada fixo", () => {
    const room = sideBarRoom({ ...NAV, clientHeight: 500 }, FIXED, 46);
    expect(room).toEqual({ height: 480, fixed: 179 + 4 + 5 * 6, item: 46, gap: 6 });
  });

  it("cabe o que o espaço deixa com o botão Mais no fim", () => {
    // 480 px: 4 apps + Mais = 467 px de conteúdo; 5 apps + Mais passaria de 480.
    const room = sideBarRoom({ ...NAV, clientHeight: 500 }, FIXED, 46);
    expect(sideBarFit(10, room)).toBe(4);
  });

  it("sem altura nenhuma não mostra apps (nunca negativo)", () => {
    const room = sideBarRoom({ ...NAV, clientHeight: 0 }, FIXED, 46);
    expect(room.height).toBe(0);
    expect(sideBarFit(3, room)).toBe(0);
  });

  it("miolo baixo (420 px, notebook a 125 %) mostra alguns apps e o Mais", () => {
    const room = sideBarRoom({ ...NAV, clientHeight: 440 }, FIXED, 46);
    const fit = sideBarFit(19, room);
    expect(fit).not.toBeNull();
    expect(fit).toBeGreaterThan(0);
    // Conteúdo: fixos + (fit + Mais) itens + espaços entre todos os filhos.
    const children = 5 + (fit ?? 0) + 1;
    const used = 183 + (fit ?? 0) * 46 + 46 + (children - 1) * 6;
    expect(used).toBeLessThanOrEqual(room.height);
  });

  it("sem espaço de sobra não mostra Mais", () => {
    const room = sideBarRoom({ ...NAV, clientHeight: 1000 }, FIXED, 46);
    expect(sideBarFit(5, room)).toBeNull();
  });
});

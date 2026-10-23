import { describe, expect, it } from "vitest";

import { reloadOptionsOf, RELOAD_MODE_LABELS } from "./reload";

// 5.0.3: modos do Recarregar (botão com Shift, menu do DevTools).
describe("modos de recarregar", () => {
  it("normal usa o cache; sem cache e esvaziar pulam o cache da carga", () => {
    expect(reloadOptionsOf("normal")).toEqual({ ignoreCache: false, emptyCache: false });
    expect(reloadOptionsOf("hard")).toEqual({ ignoreCache: true, emptyCache: false });
    expect(reloadOptionsOf("empty")).toEqual({ ignoreCache: true, emptyCache: true });
  });

  it("rótulos do menu são os do Chrome", () => {
    expect(Object.values(RELOAD_MODE_LABELS)).toEqual([
      "Recarregar normalmente",
      "Recarregar ignorando o cache",
      "Esvaziar o cache e recarregar",
    ]);
  });
});

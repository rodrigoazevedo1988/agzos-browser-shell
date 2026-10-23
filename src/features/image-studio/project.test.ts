import { describe, expect, it } from "vitest";

import { parseProject, serializeProject, PROJECT_FORMAT } from "./project";
import {
  addElement,
  emptyDoc,
  newImage,
  newShape,
  newText,
  transformAt,
  type Asset,
  type Assets,
  type Doc,
} from "./model";

const png = "data:image/png;base64,iVBORw0KGgo=";
const asset: Asset = {
  id: "photo",
  name: "foto.png",
  mime: "image/png",
  width: 40,
  height: 20,
  dataUrl: png,
};
const unused: Asset = { ...asset, id: "unused" };

function sample(): { doc: Doc; assets: Assets } {
  let doc = emptyDoc(800, 600, "#F4F2EF");
  doc = addElement(doc, newImage("i", asset, transformAt(10, 10, 400, 200)));
  doc = addElement(
    doc,
    newShape("s", "star", transformAt(50, 50, 100, 100), { fill: "#D10A11", stroke: null }),
  );
  doc = addElement(doc, newText("t", transformAt(20, 300, 500, 200), "Olá, mundo", 96, "#0E0E0E"));
  return { doc, assets: { photo: asset, unused } };
}

describe("projeto .agzimg", () => {
  it("ida e volta preserva o documento e leva só as fotos usadas", () => {
    const { doc, assets } = sample();
    const text = serializeProject({ name: "Capa", doc, assets }, new Date("2026-10-23T12:00:00Z"));
    const json = JSON.parse(text);
    expect(json).toMatchObject({ format: PROJECT_FORMAT, version: 1, name: "Capa" });
    expect(json.assets.map((item: Asset) => item.id)).toEqual(["photo"]);
    const back = parseProject(text);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.name).toBe("Capa");
    expect(back.doc).toEqual(doc);
    expect(Object.keys(back.assets)).toEqual(["photo"]);
  });

  it("recusa JSON quebrado, outro formato e outra versão", () => {
    expect(parseProject("{nope")).toMatchObject({ ok: false });
    expect(parseProject(JSON.stringify({ format: "outro", version: 1 }))).toMatchObject({
      ok: false,
    });
    expect(parseProject(JSON.stringify({ format: PROJECT_FORMAT, version: 9 }))).toMatchObject({
      ok: false,
    });
    expect(parseProject("[]")).toMatchObject({ ok: false });
  });

  it("valida o documento: tamanho, cor de fundo e lista de elementos", () => {
    const base = JSON.parse(serializeProject({ ...sample(), name: "x" }));
    const bad = (mutate: (value: Record<string, unknown>) => void) => {
      const copy = JSON.parse(JSON.stringify(base));
      mutate(copy);
      return parseProject(JSON.stringify(copy));
    };
    expect(bad((value) => ((value["doc"] as Record<string, unknown>)["width"] = 0))).toMatchObject({
      ok: false,
    });
    expect(
      bad((value) => ((value["doc"] as Record<string, unknown>)["background"] = "azul")),
    ).toMatchObject({ ok: false });
    expect(
      bad((value) => ((value["doc"] as Record<string, unknown>)["elements"] = "x")),
    ).toMatchObject({ ok: false });
  });

  it("valida os elementos: tipo, ids repetidos e cores", () => {
    const base = JSON.parse(serializeProject({ ...sample(), name: "x" }));
    const withElements = (elements: unknown[]) => {
      const copy = JSON.parse(JSON.stringify(base));
      copy.doc.elements = elements;
      return parseProject(JSON.stringify(copy));
    };
    const [image, star] = base.doc.elements;
    expect(withElements([{ ...star, kind: "video" }])).toMatchObject({ ok: false });
    expect(withElements([star, star])).toMatchObject({ ok: false });
    expect(withElements([{ ...star, fill: "javascript:alert(1)" }])).toMatchObject({ ok: false });
    expect(withElements([{ ...image, asset: "fantasma" }])).toMatchObject({ ok: false });
  });

  it("valida as fotos: formato permitido e base64 de verdade", () => {
    const base = JSON.parse(serializeProject({ ...sample(), name: "x" }));
    const withAsset = (patch: Record<string, unknown>) => {
      const copy = JSON.parse(JSON.stringify(base));
      copy.assets = [{ ...copy.assets[0], ...patch }];
      return parseProject(JSON.stringify(copy));
    };
    expect(withAsset({ mime: "image/svg+xml" })).toMatchObject({ ok: false });
    expect(withAsset({ dataUrl: "data:image/png;base64,<script>" })).toMatchObject({ ok: false });
    expect(withAsset({ dataUrl: "http://x/y.png" })).toMatchObject({ ok: false });
  });

  it("limita valores e descarta campos desconhecidos", () => {
    const base = JSON.parse(serializeProject({ ...sample(), name: "x" }));
    const copy = JSON.parse(JSON.stringify(base));
    copy.doc.elements[1].opacity = 7;
    copy.doc.elements[1].extra = "lixo";
    copy.doc.elements[1].transform.rotation = 730;
    const back = parseProject(JSON.stringify(copy));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const star = back.doc.elements[1]!;
    expect(star.opacity).toBe(1);
    expect(star.transform.rotation).toBe(10);
    expect("extra" in star).toBe(false);
  });
});

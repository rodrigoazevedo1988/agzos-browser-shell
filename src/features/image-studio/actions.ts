import type { Asset, Doc, Element } from "./model";
import {
  addElement,
  alignElements,
  duplicate,
  moveElements,
  newImage,
  type Align,
  type Reorder,
  reorder,
  removeElements,
  resizeCanvas,
  fitInside,
  centered,
} from "./model";
import { newId } from "./assets";

/**
 * Operações do editor sobre o documento (pura): cada uma devolve o documento novo e um rótulo
 * para o histórico. A tela só chama estas funções e grava o resultado.
 */

export type Op = { label: string; doc: Doc; ids?: string[] };

/** Foto nova no documento: cabe com folga e fica centralizada. */
export function imageOp(doc: Doc, asset: Asset): { doc: Doc; id: string } {
  const size = fitInside(asset.width, asset.height, {
    width: doc.width * 0.8,
    height: doc.height * 0.8,
  });
  const id = newId("e");
  return { doc: addElement(doc, newImage(id, asset, centered(doc, size), asset.name)), id };
}

export function alignOp(doc: Doc, ids: string[], align: Align): Doc {
  return alignElements(doc, ids, align);
}

export function reorderOp(doc: Doc, ids: string[], direction: Reorder): Doc {
  return reorder(doc, ids, direction);
}

export function deleteOp(doc: Doc, ids: string[]): Doc {
  return removeElements(doc, ids);
}

export function duplicateOp(doc: Doc, ids: string[]): { doc: Doc; ids: string[] } {
  return duplicate(doc, ids, () => newId("e"));
}

export function nudgeOp(doc: Doc, ids: string[], dx: number, dy: number): Doc {
  return moveElements(doc, ids, dx, dy);
}

export function canvasOp(doc: Doc, width: number, height: number, center: boolean): Doc {
  return resizeCanvas(doc, width, height, center);
}

/** Elementos copiados (com ids novos ao colar), deslocados para não cair em cima. */
export function pasteOp(doc: Doc, copied: Element[], offset: number): { doc: Doc; ids: string[] } {
  const ids: string[] = [];
  let next = doc;
  for (const element of copied) {
    const id = newId("e");
    ids.push(id);
    next = addElement(next, {
      ...element,
      id,
      transform: {
        ...element.transform,
        x: element.transform.x + offset,
        y: element.transform.y + offset,
      },
    } as Element);
  }
  return { doc: next, ids };
}

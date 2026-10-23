/** Recorte pendente de uma foto (no painel de propriedades, antes de aplicar). */
export type CropDraft = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  ratio: number | null;
};

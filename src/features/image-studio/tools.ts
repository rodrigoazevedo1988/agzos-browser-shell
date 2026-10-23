/** Ferramentas da barra lateral do editor (a ativa decide o que um arrasto faz). */
export type Tool =
  | "select"
  | "hand"
  | "text"
  | "rect"
  | "round"
  | "ellipse"
  | "line"
  | "arrow"
  | "star"
  | "polygon"
  | "pick";

export const TOOL_LIST: { id: Tool; label: string; key: string }[] = [
  { id: "select", label: "Selecionar e mover", key: "V" },
  { id: "hand", label: "Mover a tela (ou segure Espaço)", key: "H" },
  { id: "text", label: "Texto", key: "T" },
  { id: "rect", label: "Retângulo", key: "R" },
  { id: "round", label: "Retângulo arredondado", key: "U" },
  { id: "ellipse", label: "Elipse", key: "O" },
  { id: "line", label: "Linha", key: "L" },
  { id: "arrow", label: "Seta", key: "A" },
  { id: "star", label: "Estrela", key: "S" },
  { id: "polygon", label: "Polígono", key: "P" },
  { id: "pick", label: "Remover fundo: escolher a cor na foto", key: "K" },
];

/** Tecla → ferramenta (sem Ctrl/Alt). */
export const TOOL_BY_KEY: Record<string, Tool> = Object.fromEntries(
  TOOL_LIST.map((tool) => [tool.key.toLowerCase(), tool.id]),
);

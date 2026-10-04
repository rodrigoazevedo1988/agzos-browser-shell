import {
  BookOpen,
  Braces,
  Camera,
  Crosshair,
  Download,
  FileText,
  Layers,
  Pipette,
  Network,
  NotebookPen,
  Puzzle,
  type LucideIcon,
} from "lucide-react";

/**
 * Ferramentas da 4.5, com entrada visível na página inicial, no Discador e no botão
 * "Ferramentas" da barra (além dos atalhos de teclado). `id` é o comando que roda.
 */
export type ToolId =
  | "tab.new-session"
  | "ports.open"
  | "scratchpad.open"
  | "page.inspect"
  | "page.capture"
  | "page.reader"
  | "notes.toggle"
  | "extensions.open"
  | "downloads.toggle"
  | "colors.panel"
  | "pdf.open";

export type Tool = {
  id: ToolId;
  label: string;
  hint: string;
  icon: LucideIcon;
  /** Atalho mostrado no cartão (Windows/Linux; no Mac, Ctrl vira ⌘). */
  shortcut?: string;
  /** Precisa de uma página da web aberta (usa a última guia de site). */
  needsPage?: boolean;
};

export const TOOLS: Tool[] = [
  {
    id: "tab.new-session",
    label: "Nova Session Tab",
    hint: "Guia com login separado (cookies só dela)",
    icon: Layers,
    shortcut: "Ctrl+Alt+N",
  },
  {
    id: "ports.open",
    label: "Portas em uso",
    hint: "Ver e matar processos, expor por túnel HTTPS",
    icon: Network,
  },
  {
    id: "scratchpad.open",
    label: "API Scratchpad",
    hint: "Capturar e reenviar requisições",
    icon: Braces,
  },
  {
    id: "page.inspect",
    label: "Mira de elemento",
    hint: "Cores HEX, fonte e classes Tailwind",
    icon: Crosshair,
    shortcut: "Ctrl+Shift+C",
    needsPage: true,
  },
  {
    id: "page.capture",
    label: "Capturar tela",
    hint: "Guia, região ou janela em PNG",
    icon: Camera,
    shortcut: "Ctrl+Shift+S",
  },
  {
    id: "page.reader",
    label: "Modo leitura",
    hint: "Só o artigo, com letra grande",
    icon: BookOpen,
    shortcut: "Ctrl+Alt+R",
    needsPage: true,
  },
  {
    id: "notes.toggle",
    label: "Notas",
    hint: "Uma nota por página, em markdown",
    icon: NotebookPen,
    shortcut: "Ctrl+Shift+M",
  },
  {
    id: "extensions.open",
    label: "Extensões",
    hint: "Carregar, ligar e abrir extensões",
    icon: Puzzle,
  },
  // 4.7
  {
    id: "downloads.toggle",
    label: "Downloads",
    hint: "Pausar, etiquetar, regras e pastas por tipo",
    icon: Download,
    shortcut: "Ctrl+J",
  },
  {
    id: "colors.panel",
    label: "ColorTools",
    hint: "Conta-gotas, paleta da página e gradiente",
    icon: Pipette,
  },
  {
    id: "pdf.open",
    label: "PDF Tools",
    hint: "Editar, juntar, comprimir, senha e OCR",
    icon: FileText,
    shortcut: "Ctrl+Alt+P",
  },
];

export function shortcutText(shortcut: string, mac: boolean) {
  return mac
    ? shortcut.replace("Ctrl+", "⌘").replace("Alt+", "⌥").replace("Shift+", "⇧")
    : shortcut;
}

import {
  BookOpen,
  Braces,
  Camera,
  Clapperboard,
  ImagePlus,
  Crosshair,
  Download,
  FileCode,
  FileText,
  Languages,
  Layers,
  Music2,
  Pipette,
  Network,
  NotebookPen,
  Puzzle,
  ScrollText,
  Wrench,
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
  | "devtools.toggle"
  | "page.capture"
  | "page.capture-full"
  | "page.reader"
  | "page.translate"
  | "notes.toggle"
  | "extensions.open"
  | "downloads.toggle"
  | "colors.panel"
  | "pdf.open"
  | "videos.open"
  | "music.open"
  | "editor.open"
  | "imagem.open";

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
  // 4.8
  {
    id: "devtools.toggle",
    label: "DevTools",
    hint: "Elementos, Console, Rede e modo dispositivo",
    icon: Wrench,
    shortcut: "F12",
    needsPage: true,
  },
  {
    id: "page.capture",
    label: "Capturar tela",
    hint: "Guia, região ou janela, com setas, formas e texto",
    icon: Camera,
    shortcut: "Ctrl+Shift+S",
  },
  {
    id: "page.capture-full",
    label: "Capturar a página inteira",
    hint: "Rola a página toda e junta num PNG só",
    icon: ScrollText,
    shortcut: "Ctrl+Alt+Shift+F",
    needsPage: true,
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
    id: "page.translate",
    label: "Traduzir página",
    hint: "Substituir, bilíngue ou original no mouse",
    icon: Languages,
    shortcut: "Alt+Shift+T",
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
  {
    id: "imagem.open",
    label: "Agzos Imagem",
    hint: "Camadas, textos, formas, ajustes e exportação",
    icon: ImagePlus,
    shortcut: "Ctrl+Alt+I",
  },
  {
    id: "videos.open",
    label: "Vídeos",
    hint: "Biblioteca de filmes e séries das suas pastas",
    icon: Clapperboard,
  },
  {
    id: "music.open",
    label: "Músicas",
    hint: "Biblioteca de áudio, playlists e tocando em segundo plano",
    icon: Music2,
  },
  {
    id: "editor.open",
    label: "Editor de texto",
    hint: "Texto, código e Markdown com visualização",
    icon: FileCode,
  },
];

export function shortcutText(shortcut: string, mac: boolean) {
  return mac
    ? shortcut.replace("Ctrl+", "⌘").replace("Alt+", "⌥").replace("Shift+", "⇧")
    : shortcut;
}

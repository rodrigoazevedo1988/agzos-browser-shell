/**
 * Painéis laterais (2.0), como no Opera: mensageiros e redes abertos ao lado da página,
 * cada um no seu WebContentsView (a sessão é a mesma das guias: login compartilhado).
 */
export type SidePanelApp = {
  id: string;
  name: string;
  url: string;
  /** Cor da marca (fundo do ícone na barra lateral). */
  color: string;
};

export const SIDE_PANEL_APPS: SidePanelApp[] = [
  { id: "whatsapp", name: "WhatsApp", url: "https://web.whatsapp.com/", color: "#25D366" },
  { id: "telegram", name: "Telegram", url: "https://web.telegram.org/a/", color: "#229ED9" },
  { id: "messenger", name: "Messenger", url: "https://www.messenger.com/", color: "#0A7CFF" },
  { id: "instagram", name: "Instagram", url: "https://www.instagram.com/", color: "#E1306C" },
  { id: "discord", name: "Discord", url: "https://discord.com/app", color: "#5865F2" },
  { id: "x", name: "X", url: "https://x.com/", color: "#111111" },
  { id: "gmail", name: "Gmail", url: "https://mail.google.com/", color: "#EA4335" },
  { id: "chatgpt", name: "ChatGPT", url: "https://chatgpt.com/", color: "#10A37F" },
  // 3.0: IAs, vídeo, redes e música (como a barra do Opera GX).
  { id: "claude", name: "Claude", url: "https://claude.ai/", color: "#D97757" },
  { id: "gemini", name: "Gemini", url: "https://gemini.google.com/", color: "#4E7CF6" },
  { id: "duckai", name: "Duck.ai", url: "https://duck.ai/", color: "#DE5833" },
  { id: "tiktok", name: "TikTok", url: "https://www.tiktok.com/", color: "#111111" },
  { id: "kwai", name: "Kwai", url: "https://www.kwai.com/", color: "#FF7A00" },
  { id: "youtube", name: "YouTube", url: "https://www.youtube.com/", color: "#FF0000" },
  { id: "linkedin", name: "LinkedIn", url: "https://www.linkedin.com/", color: "#0A66C2" },
  { id: "reddit", name: "Reddit", url: "https://www.reddit.com/", color: "#FF4500" },
  { id: "spotify", name: "Spotify", url: "https://open.spotify.com/", color: "#1DB954" },
  { id: "deezer", name: "Deezer", url: "https://www.deezer.com/", color: "#A238FF" },
  { id: "pinterest", name: "Pinterest", url: "https://www.pinterest.com/", color: "#E60023" },
];

/** Os que aparecem na barra lateral num perfil novo: todos, na ordem acima. */
export const DEFAULT_SIDE_PANELS = SIDE_PANEL_APPS.map((app) => app.id);

/**
 * Barra padrão até a 2.x. Perfis gravados antes da 3.0 (sem `sidePanelsSeen`) só conheciam
 * estes: os outros (Discord, X, Gmail, ChatGPT e os da 3.0) entram na barra uma vez.
 */
export const SIDE_PANELS_BEFORE_3 = ["whatsapp", "telegram", "messenger", "instagram"];

/**
 * Largura do painel: `min` é o mínimo usável; o máximo depende da janela (3.1.1), ver
 * `panelWidthLimits`. `max` só limita o valor gravado.
 */
export const SIDE_PANEL_WIDTH = { min: 320, max: 4000, initial: 400 } as const;

/**
 * Largura da barra lateral (4.6): o usuário arrasta a borda. Os ícones e os nomes se
 * adaptam: estreita só ícones, média ícone com o nome embaixo, larga ícone e nome lado a lado.
 */
export const SIDE_BAR_WIDTH = { min: 48, max: 160, initial: 60 } as const;

export function clampSideBarWidth(width: unknown): number {
  const value =
    typeof width === "number" && Number.isFinite(width) ? width : SIDE_BAR_WIDTH.initial;
  return Math.round(Math.min(SIDE_BAR_WIDTH.max, Math.max(SIDE_BAR_WIDTH.min, value)));
}

export type SideBarMode = "compact" | "normal" | "wide";

/** Modo e medidas da barra para a largura dada (px). */
export function sideBarLayout(width: number): {
  mode: SideBarMode;
  icon: number;
  image: number;
  font: number;
} {
  const value = clampSideBarWidth(width);
  const mode: SideBarMode = value < 58 ? "compact" : value < 104 ? "normal" : "wide";
  const icon = Math.round(Math.min(34, Math.max(24, value * (mode === "wide" ? 0.22 : 0.44))));
  return {
    mode,
    icon,
    image: Math.round(icon * 0.68),
    font: mode === "wide" ? 12.5 : Math.round(Math.min(11.5, Math.max(9.5, value / 6.6)) * 10) / 10,
  };
}

/** Barra lateral (60 px) e o mínimo de página que fica à vista ao lado do painel. */
const SIDE_BAR_PX = 60;
const MIN_PAGE_PX = 360;

/** Limites do arraste para a janela atual: do mínimo usável até sobrar a página mínima. */
export function panelWidthLimits(windowWidth: number): { min: number; max: number } {
  const room = Number.isFinite(windowWidth) ? windowWidth - SIDE_BAR_PX - MIN_PAGE_PX : 0;
  return { min: SIDE_PANEL_WIDTH.min, max: Math.max(SIDE_PANEL_WIDTH.min, Math.round(room)) };
}

/** Largura no arraste: dentro dos limites da janela. */
export function dragPanelWidth(width: number, windowWidth: number): number {
  const { min, max } = panelWidthLimits(windowWidth);
  return Math.round(Math.min(max, Math.max(min, width)));
}

/** Larguras por painel gravadas → só apps conhecidos e valores válidos. */
export function parsePanelWidths(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const known = new Set(SIDE_PANEL_APPS.map((app) => app.id));
  const widths: Record<string, number> = {};
  for (const [id, width] of Object.entries(value)) {
    if (known.has(id) && typeof width === "number" && Number.isFinite(width) && width > 0) {
      widths[id] = clampPanelWidth(width);
    }
  }
  return widths;
}

/** Largura de um painel: a dele, senão a última usada (de antes da 3.1.1). */
export function panelWidthOf(
  prefs: { sidePanelWidths: Record<string, number>; sidePanelWidth: number },
  id: string,
): number {
  return prefs.sidePanelWidths[id] ?? prefs.sidePanelWidth;
}

export function sidePanelApp(id: string | null | undefined): SidePanelApp | undefined {
  return SIDE_PANEL_APPS.find((app) => app.id === id);
}

/** Lista gravada → só ids conhecidos, sem repetir, na ordem do usuário. */
export function parseSidePanels(value: unknown): string[] {
  if (!Array.isArray(value)) return DEFAULT_SIDE_PANELS;
  const known = new Set(SIDE_PANEL_APPS.map((app) => app.id));
  return [...new Set(value.filter((id): id is string => typeof id === "string" && known.has(id)))];
}

/**
 * Apps novos de uma versão entram no fim da barra uma vez (quem tirou um app não o vê de
 * volta). `seen` são os apps que o perfil já conhecia; sem ele, os de antes da 3.0.
 */
export function withNewSidePanels(
  panels: string[],
  seen: unknown,
): { sidePanels: string[]; sidePanelsSeen: string[] } {
  const known = Array.isArray(seen)
    ? new Set(seen.filter((id): id is string => typeof id === "string"))
    : new Set(SIDE_PANELS_BEFORE_3);
  const fresh = SIDE_PANEL_APPS.map((app) => app.id).filter(
    (id) => !known.has(id) && !panels.includes(id),
  );
  return {
    sidePanels: [...panels, ...fresh],
    sidePanelsSeen: SIDE_PANEL_APPS.map((app) => app.id),
  };
}

export function clampPanelWidth(width: unknown): number {
  const value = typeof width === "number" && Number.isFinite(width) ? width : 0;
  if (!value) return SIDE_PANEL_WIDTH.initial;
  return Math.round(Math.min(SIDE_PANEL_WIDTH.max, Math.max(SIDE_PANEL_WIDTH.min, value)));
}

/**
 * Quantos apps cabem na altura da barra (3.1.1); null quando cabem todos. Sem caber, o
 * último lugar vira o botão "Mais" e o resto vai para a caixinha flutuante.
 */
export function sideBarFit(
  count: number,
  room: { height: number; fixed: number; item: number; gap: number },
): number | null {
  const slots = Math.floor((room.height - room.fixed + room.gap) / (room.item + room.gap));
  if (count <= slots) return null;
  return Math.max(0, slots - 1);
}

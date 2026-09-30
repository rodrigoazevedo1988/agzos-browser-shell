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
];

/** Os que aparecem na barra lateral num perfil novo. */
export const DEFAULT_SIDE_PANELS = ["whatsapp", "telegram", "messenger", "instagram"];

export const SIDE_PANEL_WIDTH = { min: 320, max: 720, initial: 400 } as const;

export function sidePanelApp(id: string | null | undefined): SidePanelApp | undefined {
  return SIDE_PANEL_APPS.find((app) => app.id === id);
}

/** Lista gravada → só ids conhecidos, sem repetir, na ordem do usuário. */
export function parseSidePanels(value: unknown): string[] {
  if (!Array.isArray(value)) return DEFAULT_SIDE_PANELS;
  const known = new Set(SIDE_PANEL_APPS.map((app) => app.id));
  return [...new Set(value.filter((id): id is string => typeof id === "string" && known.has(id)))];
}

export function clampPanelWidth(width: unknown): number {
  const value = typeof width === "number" && Number.isFinite(width) ? width : 0;
  if (!value) return SIDE_PANEL_WIDTH.initial;
  return Math.round(Math.min(SIDE_PANEL_WIDTH.max, Math.max(SIDE_PANEL_WIDTH.min, value)));
}

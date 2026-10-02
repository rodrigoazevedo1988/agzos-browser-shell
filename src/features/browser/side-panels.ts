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

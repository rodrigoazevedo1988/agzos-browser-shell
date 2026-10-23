/**
 * agzos://editor (5.0.3): endereço do editor. `file` é o caminho aberto (quando há); `s` é a
 * sessão do editor, que sobrevive a trocar de guia (os buffers não se perdem ao sair dela).
 */
export const EDITOR_URL = "agzos://editor";

export function isEditorUrl(url: string): boolean {
  return url === EDITOR_URL || url.startsWith(`${EDITOR_URL}?`);
}

export function editorUrlOf(options: { file?: string | null; session?: string | null }): string {
  const params = new URLSearchParams();
  if (options.session) params.set("s", options.session);
  if (options.file) params.set("file", options.file);
  const query = params.toString();
  return query ? `${EDITOR_URL}?${query}` : EDITOR_URL;
}

export function editorParamsOf(url: string): { file: string | null; session: string | null } {
  if (!isEditorUrl(url)) return { file: null, session: null };
  const params = new URLSearchParams(url.slice(EDITOR_URL.length + 1));
  const file = params.get("file");
  const session = params.get("s");
  return {
    file: file && (file.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(file)) ? file : null,
    session: session && /^[a-z0-9]{4,32}$/.test(session) ? session : null,
  };
}

/** Garante uma sessão na URL (a casca usa isto em toda abertura vinda do sistema). */
export function withEditorSession(url: string, newSession: () => string): string {
  if (!isEditorUrl(url) || editorParamsOf(url).session) return url;
  const { file } = editorParamsOf(url);
  return editorUrlOf({ file, session: newSession() });
}

/** Título da guia: o nome do arquivo aberto, ou "Editor de texto". */
export function editorTitleOf(url: string): string {
  const { file } = editorParamsOf(url);
  if (!file) return "Editor de texto";
  return file.split(/[\\/]/).filter(Boolean).pop() ?? "Editor de texto";
}

export function newEditorSession(): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return random
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase()
    .slice(0, 16);
}

/** Terminal (4.0): limites do painel e regras puras das sessões. */
export const TERMINAL_HEIGHT = { min: 140, max: 900, initial: 280 } as const;

export function clampTerminalHeight(value: unknown): number {
  const height = typeof value === "number" && Number.isFinite(value) ? value : NaN;
  if (Number.isNaN(height)) return TERMINAL_HEIGHT.initial;
  return Math.round(Math.min(TERMINAL_HEIGHT.max, Math.max(TERMINAL_HEIGHT.min, height)));
}

/** Altura máxima que ainda deixa `keep` px de página acima do terminal. */
export function terminalHeightLimit(available: number, keep = 160) {
  return Math.max(TERMINAL_HEIGHT.min, Math.min(TERMINAL_HEIGHT.max, available - keep));
}

/** Nome da aba da sessão: o nome do shell e a última pasta ("pwsh · projeto"). */
export function sessionTitle(shell: string, cwd: string | null) {
  const name = shell.replace(/^.*[\\/]/, "").replace(/\.exe$/i, "");
  const folder = cwd ? cwd.replace(/[\\/]+$/, "").replace(/^.*[\\/]/, "") : "";
  return folder ? `${name} · ${folder}` : name;
}

/**
 * Teclas que, com o foco no terminal, continuam sendo do navegador. O resto (Ctrl+C,
 * Ctrl+W, Ctrl+R, Ctrl+L…) vai para o shell, como num terminal de verdade.
 */
const BROWSER_COMBOS = new Set([
  "mod+tab",
  "mod+shift+tab",
  "mod+pageup",
  "mod+pagedown",
  "mod+shift+pageup",
  "mod+shift+pagedown",
  "mod+alt+t",
  "mod+shift+a",
  "mod+shift+t",
  "mod+shift+n",
  "mod+1",
  "mod+2",
  "mod+3",
  "mod+4",
  "mod+5",
  "mod+6",
  "mod+7",
  "mod+8",
  "mod+9",
  "f11",
]);

/** Mesma regra de electron/terminal.cjs (o main decide antes, com o foco no terminal). */
export function terminalKeepsBrowserKey(
  combo: string,
  { mac = false, meta = false }: { mac?: boolean; meta?: boolean } = {},
) {
  // No Mac o ⌘ nunca é do shell (o Ctrl é): ⌘T, ⌘W, ⌘L seguem para o navegador.
  if (mac && meta) return true;
  return BROWSER_COMBOS.has(combo);
}

/** Copiar/colar no terminal: Ctrl+Shift+C/V (e ⌘C/⌘V no Mac; Ctrl+V no Windows). */
export function clipboardKey(
  event: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean },
  platform: "mac" | "windows" | "linux",
  hasSelection: boolean,
): "copy" | "paste" | null {
  const key = event.key.toLowerCase();
  if (event.altKey) return null;
  if (platform === "mac") {
    if (!event.metaKey || event.ctrlKey) return null;
    return key === "c" ? "copy" : key === "v" ? "paste" : null;
  }
  if (!event.ctrlKey || event.metaKey) return null;
  if (event.shiftKey) return key === "c" ? "copy" : key === "v" ? "paste" : null;
  // Como no Windows Terminal: Ctrl+C com seleção copia (sem seleção é o ^C do shell).
  if (key === "c" && hasSelection) return "copy";
  if (key === "v" && platform === "windows") return "paste";
  return null;
}

/** Caminho entre aspas para o shell da sessão (4.1.1: inserir caminho, cd). */
export function quotePath(shell: string, file: string) {
  if (shell === "cmd") return `"${file.replace(/"/g, "")}"`;
  // bash, zsh, sh e PowerShell: aspas simples (no PowerShell '' escapa a aspa).
  if (shell === "powershell" || shell === "pwsh") return `'${file.replace(/'/g, "''")}'`;
  return `'${file.replace(/'/g, "'\\''")}'`;
}

/**
 * Texto colado quando a área de transferência tem só uma imagem (print): o caminho do PNG
 * que o main salvou. Agentes (Claude Code, Codex) anexam caminho de imagem colado; num
 * agente aberto direto (program) vai sem aspas, como ao arrastar o arquivo. SSH (4.9.7): o
 * caminho remoto (~/.cache/agzos-prints/print-….png) vai sem aspas, porque não se sabe se
 * do outro lado está um shell ou o Claude Code.
 */
export function pastedImageText(session: { shell: string; ssh: boolean }, file: string) {
  if (session.ssh || session.shell === "ssh" || session.shell === "program") return file;
  return quotePath(session.shell, file);
}

/** Aviso quando o print não chega à máquina da sessão SSH. */
export function pasteErrorText(error: "no-ssh" | "ssh-auth" | "ssh-upload") {
  if (error === "no-ssh") return "Não achei o ssh deste computador para enviar o print.";
  if (error === "ssh-auth") {
    return "O print não foi enviado: o servidor pediu senha. Use uma chave SSH na conexão (Configurações do terminal → SSH) para colar imagens.";
  }
  return "Não foi possível enviar o print para o servidor.";
}

/**
 * Comando que entra na pasta (modo ls lateral). Nos shells POSIX o Ctrl+U antes limpa o
 * que estava digitado. SSH: null (a pasta é local, a sessão é remota).
 */
export function cdCommand(shell: string, dir: string): string | null {
  if (shell === "ssh" || shell === "program") return null;
  if (shell === "cmd") return `cd /d ${quotePath(shell, dir)}\r`;
  if (shell === "powershell" || shell === "pwsh") {
    return `Set-Location -LiteralPath ${quotePath(shell, dir)}\r`;
  }
  return `\x15cd -- ${quotePath(shell, dir)}\r`;
}

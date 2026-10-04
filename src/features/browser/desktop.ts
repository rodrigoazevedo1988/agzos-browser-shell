import type { GestureConfig, GestureId } from "@/features/gestures/gestures";
import type { OverlayPayload } from "./overlay/bridge";
import type { PanelKind } from "./overlay/panels";
import type { TabCard } from "./tab-preview";
import type { Credential, HistoryUrl, HistoryVisit, KeyState, Tab, VaultEntry } from "./types";

export type PermissionType =
  "camera" | "microphone" | "notifications" | "geolocation" | "clipboard-read" | "midi";
export type PermissionValue = "allow" | "block";

/** Resultado das chamadas do Agzos Key: erro tratável (ex.: senha mestra errada). */
export type KeyResult<T> = { ok: true; data: T } | { ok: false; error: string };
export type SitePermission = { origin: string; type: PermissionType; value: PermissionValue };

export type UpdateStatus =
  "idle" | "checking" | "up-to-date" | "downloading" | "ready" | "error" | "unsupported";
export type UpdateState = {
  status: UpdateStatus;
  currentVersion: string;
  /** Versão mais nova publicada (quando já verificou). */
  version: string | null;
  progress: number | null;
  error: string | null;
  notes?: string;
  page?: string;
  /** A última instalação falhou (continua visível mesmo depois de baixar de novo). */
  installError?: string | null;
  /** Log do instalador (para mandar ao suporte). */
  logFile?: string;
  checkedAt?: number;
};

/** Item do menu nativo (menu:show). `children` vira submenu. */
export type NativeMenuItem =
  | { separator: true }
  | { id: string; label: string; enabled?: boolean }
  | { label: string; children: NativeMenuItem[] };

export type HistoryQuery = { text?: string; before?: number | null; limit?: number };

export type DesktopTabEvent =
  | {
      type: "tab-updated";
      id: number;
      url: string;
      title: string;
      canBack: boolean;
      canForward: boolean;
    }
  | { type: "favicon"; id: number; icon: string | null }
  | { type: "audio"; id: number; playing: boolean }
  | { type: "muted"; id: number; muted: boolean }
  | { type: "crashed"; id: number; reason?: CrashReason }
  /** null: a página voltou a carregar (a tela de erro sai). */
  | { type: "load-failed"; id: number; failure: LoadFailure | null }
  /** O main fechou o WebContentsView da guia (hibernação). */
  | { type: "hibernated"; id: number }
  | { type: "unresponsive"; id: number; value: boolean }
  | { type: "pip"; id: number; active: boolean }
  | { type: "blocked"; id: number; count: number; trackers: BlockedTracker[] }
  | { type: "find"; id: number; active: number; total: number }
  | { type: "zoom"; id: number; factor: number }
  | { type: "download-navigation"; id: number; urls: string[] }
  | { type: "thumbnail"; id: number; dataUrl: string }
  | { type: "login-rejected"; id: number; rejected: boolean; continueUrl: string | null }
  /** Login enviado numa página (page-preload): oferecer salvar no Agzos Key. */
  | { type: "login-detected"; id: number; url: string; username: string; password: string }
  /** Formulário de login na página; `focused`: o usuário clicou num campo dele. */
  | {
      type: "login-form";
      id: number;
      url: string;
      focused: boolean;
      field: "password" | "username" | "otp";
    }
  /** Tela dividida: o usuário clicou na página do outro pane. */
  | { type: "focused"; id: number };

export type BlockedTracker = { host: string; category: string };

/** Falha de carga da página (código de erro de rede do Chromium, ex.: -105). */
export type LoadFailure = { code: number; description: string; url: string };

/** Motivo do render-process-gone. */
export type CrashReason =
  | "crashed"
  | "oom"
  | "killed"
  | "abnormal-exit"
  | "launch-failed"
  | "integrity-failure"
  | "clean-exit"
  | "memory-eviction";

/** Como a execução anterior terminou (aviso de restauração). */
export type StartupInfo = { safe: boolean; windows: number };

export type AdblockStats = {
  /** false quando o app foi montado sem o motor de filtros. */
  available?: boolean;
  today: number;
  updatedAt: number | null;
  ready: boolean;
};

export type DownloadState = "progressing" | "completed" | "cancelled" | "interrupted";

export type DownloadRecord = {
  id: number;
  url: string;
  filename: string;
  path: string;
  mime: string;
  totalBytes: number;
  receivedBytes: number;
  state: DownloadState;
  startedAt: number;
  endedAt: number | null;
  private: boolean;
  paused: boolean;
  canResume: boolean;
  /** Evento de remoção (diálogo "Salvar como" cancelado). */
  removed?: boolean;
};

export type DownloadAction = "pause" | "resume" | "cancel" | "open" | "show" | "remove";

export type DesktopRect = { x: number; y: number; width: number; height: number };

export type DesktopTabMenuContext = {
  kind: "tab" | "strip";
  tabId?: number;
  pinned?: boolean;
  muted?: boolean;
  audio?: boolean;
  hasClosed?: boolean;
  orientation?: "horizontal" | "vertical";
  url?: string;
  /** Quantas guias a janela tem ("Mover para nova janela" some com uma só). */
  tabCount?: number;
  /** Guia ativa (não pode ser hibernada). */
  active?: boolean;
  /** 2.0: grupo da guia, grupos existentes, workspaces e tela dividida. */
  groupId?: number | null;
  groups?: { id: number; title: string }[];
  workspaceId?: number;
  workspaces?: { id: number; name: string; icon: string }[];
  /** A guia está na tela dividida à vista. */
  inSplit?: boolean;
};

export type DesktopPermissionRequest = {
  id: string;
  origin: string;
  types: PermissionType[];
  mediaTypes: string[];
};

/** Retrato do GX Control: totais do navegador e cada guia viva desta janela. */
export type GxStats = {
  cpuPercent: number;
  memoryMB: number;
  processes: number;
  cores: number;
  systemMemoryMB: number;
  freeMemoryMB: number;
  tabs: {
    id: number;
    memoryMB: number;
    cpuPercent: number;
    /** Guias que dividem o mesmo processo (o uso é repartido entre elas). */
    shared: number;
    /** Desacelerada pelo limitador de CPU. */
    throttled: boolean;
  }[];
  lastAction: { type: "hibernated"; title: string; at: number } | null;
};

export type SpeedTestResult =
  | { ok: true; pingMs: number | null; downMbps: number; upMbps: number | null; at: number }
  | { ok: false; error: string };

/** Agzos AI (4.0): erros em código curto (a casca escolhe o texto). */
export type AiError =
  | "no-key"
  | "invalid-key"
  | "insecure"
  | "storage"
  | "rate-limit"
  | "network"
  | "model-unavailable"
  | "server"
  | "request"
  | "aborted";
export type AiFailure = { ok: false; error: AiError; retryAfter?: number | null; partial?: string };
export type AiState = { hasKey: boolean; encryption: boolean; weakStorage: boolean };
export type AiContext = { url: string; title: string; selection: string };
export type AiHistoryItem = {
  role: "user" | "assistant";
  text: string;
  at: number;
  context?: { url: string; title: string; selection: boolean };
  model?: string;
};
/** Conversas do Agzos AI (4.1.3): a lista vem sem as mensagens. */
export type AiProject = { id: string; name: string; archived: boolean; createdAt: number };
export type AiChatSummary = {
  id: string;
  title: string;
  titled: boolean;
  projectId: string | null;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
  count: number;
};
export type AiLibrary = {
  projects: AiProject[];
  chats: AiChatSummary[];
  openIds: string[];
  /** null = conversa nova, ainda sem mensagem. */
  activeId: string | null;
  persona: { instructions: string };
};
export type AiLibraryAction =
  | { type: "chat-new"; projectId?: string | null }
  | { type: "chat-open"; id: string }
  | { type: "chat-close"; id: string }
  | {
      type: "chat-update";
      id: string;
      title?: string;
      projectId?: string | null;
      archived?: boolean;
    }
  | { type: "chat-delete"; id: string }
  | { type: "project-new"; name: string }
  | { type: "project-update"; id: string; name?: string; archived?: boolean }
  | { type: "tabs"; openIds: string[]; activeId: string | null }
  | { type: "persona"; instructions: string };
export type AiChatResult =
  | {
      ok: true;
      chatId: string | null;
      text: string;
      model: string;
      fallbackFrom: string | null;
      aborted: boolean;
    }
  | AiFailure;

export type TerminalShell = { id: string; label: string };
export type LiveTerminal = {
  id: number;
  shell: string;
  label: string;
  /** Nome dado pelo usuário à aba (4.1.1). */
  title?: string | null;
  cwd: string;
  history: string;
};
export type TerminalOpenResult =
  | { ok: true; id: number; shell: string; label: string; cwd: string }
  | { ok: false; error: string };
/** Item do navegador de arquivos do terminal (4.1.1). */
export type FileEntry = {
  name: string;
  path: string;
  dir: boolean;
  size: number | null;
  modified: number | null;
  image: boolean;
};
export type FileListing =
  | { ok: true; path: string; parent: string | null; truncated: boolean; entries: FileEntry[] }
  | { ok: false; error: string; path?: string };
/** Skill ou comando de uma CLI de IA (Claude Code, Codex, OpenCode, Gemini). */
export type CliSkill = {
  tool: string;
  kind: "skill" | "command";
  scope: "user" | "project";
  name: string;
  description: string;
  invoke: string;
  file: string;
};
export type AgentPlanStep = {
  id: string;
  title: string;
  tool: string;
  prompt: string;
  after: string[];
};
/** PWA da guia: instalável (ou já instalado). */
export type PwaTabState = { id: string; name: string; installed: boolean } | null;
/** Por que o site não instala (4.1.3): sem manifesto, sem HTTPS, sem ícone… */
export type PwaReason = "manifest" | "insecure" | "icon" | "private" | "page" | "tab";
export type PwaCheck =
  { ok: true; id: string; name: string; installed: boolean } | { ok: false; reason: PwaReason };
export type InstalledPwa = {
  id: string;
  name: string;
  startUrl: string;
  origin: string;
  installedAt: number;
  icon: string | null;
  open: boolean;
};
export type SshConnection = {
  id: string;
  name: string;
  user: string;
  host: string;
  port: number;
  /** Caminho da chave privada (ssh -i), opcional. */
  key: string;
};
export type SshKey = {
  name: string;
  type: string;
  comment: string;
  publicKey: string;
  privatePath: string | null;
};
/** O que o main e o terminal flutuante precisam das preferências do terminal. */
export type TerminalRuntimeConfig = import("@/features/terminal/config").TerminalSettings & {
  shell: string;
  cwd: string;
};
/** Sessão lembrada: shell e a última pasta. */
export type SavedTerminal = { shell: string; cwd: string };

/** Gesto vindo do main, com a superfície onde aconteceu. */
export type GestureEvent = {
  gesture: GestureId;
  surface: { kind: "tab"; id: number } | { kind: "panel"; app: string } | { kind: "active" };
  /** Pinça: 1 aproxima, -1 afasta. */
  direction?: 1 | -1;
};

/** Aceleração de hardware (4.0): pedido, modo desta execução e status do Chromium. */
export type GpuStatus = {
  enabled: boolean;
  forced: boolean;
  reason: "env" | "user" | "crash" | null;
  videoDecode: string | null;
  rasterization: string | null;
};

// --- 4.5 ---
/** Processo escutando uma porta TCP (painel de portas). */
export type PortInfo = {
  port: number;
  /** PID principal (o menor da linha); `pids` traz os filhos na mesma porta. */
  pid: number | null;
  pids: number[];
  name: string;
  addresses: string[];
  /** Só em 127.0.0.1/::1 (não aparece na rede). */
  local: boolean;
  project: { name: string; dir: string } | null;
  /** Projeto de código (package.json, Cargo.toml…): vem primeiro na lista. */
  dev: boolean;
  /** Processo do próprio Agzos (não dá para matar). */
  self: boolean;
};
export type PortKillResult = {
  ok: boolean;
  forced?: boolean;
  error?: "denied" | "permission" | "gone";
};
export type TunnelStatus = {
  binary: string | null;
  tunnels: { port: number; url: string | null }[];
};
export type TunnelResult = {
  ok: boolean;
  url?: string;
  error?: "missing" | "port" | "spawn" | "exited" | "timeout" | "window";
};
export type TunnelEvent = { port: number; state: "open" | "closed"; url: string | null };
export type ReaderInline = {
  kind: "text" | "strong" | "em" | "code" | "link";
  text: string;
  href?: string;
};
export type ReaderBlock =
  | { kind: "heading"; level: number; children: ReaderInline[] }
  | { kind: "paragraph" | "quote"; children: ReaderInline[] }
  | { kind: "list"; ordered: boolean; items: ReaderInline[][] }
  | { kind: "code"; text: string }
  | { kind: "image"; src: string; alt: string; caption: string };
export type ReaderArticle = {
  title: string;
  byline: string;
  site: string;
  lang: string;
  url: string;
  words: number;
  minutes: number;
  blocks: ReaderBlock[];
};
export type CaptureLayer = { dataUrl: string; x: number; y: number; width: number; height: number };
export type CapturedRequest = {
  id: string;
  method: string;
  url: string;
  headers: [string, string][];
  body: string;
  type: string;
  at: number;
  status: number | null;
};
export type NetCaptureEvent =
  | { tabId: number; type: "request"; request: CapturedRequest }
  | { tabId: number; type: "status"; id: string; status: number | null };
export type ScratchpadRequest = {
  method: string;
  url: string;
  headers: [string, string][];
  body: string;
};
export type ScratchpadResponse =
  | {
      ok: true;
      status: number;
      statusText: string;
      headers: [string, string][];
      body: string;
      binary: boolean;
      size: number;
      truncated: boolean;
      ms: number;
    }
  | { ok: false; error: "method" | "url" | "network"; message?: string };
export type ExtensionInfo = {
  dir: string;
  id: string | null;
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  loaded: boolean;
  source: "unpacked" | "store";
  error: string | null;
  popup: string | null;
  options: string | null;
};
export type ExtensionResult = { ok: boolean; error?: string; canceled?: boolean; id?: string };
export type WidevineStatus = {
  state: "unavailable" | "loading" | "ready" | "error";
  detail: string;
  version: string | null;
};

export type DesktopBridge = {
  attachTab(
    id: number,
    url: string,
    options?: { dark?: boolean; private?: boolean; session?: string },
  ): Promise<void>;
  activateTab(id: number): Promise<void>;
  /** Área da página; com `id` (2.0), a do pane daquela guia na tela dividida. */
  setBounds(rect: DesktopRect, id?: number): Promise<void>;
  /** Tela dividida à vista (as duas guias) ou null. */
  setSplit(ids: [number, number] | null): Promise<void>;
  /** Painéis laterais (2.0): o app aberto, a área dele, recarregar e descarregar. */
  sidePanelShow(app: string, url: string): Promise<void>;
  sidePanelHide(): Promise<void>;
  sidePanelBounds(rect: DesktopRect): Promise<void>;
  sidePanelReload(app: string): Promise<void>;
  sidePanelUnload(app: string): Promise<void>;
  /** Zoom só do painel (3.1.1): 1 aumenta, -1 diminui, 0 volta a 100 %. */
  sidePanelZoom(app: string, direction: 1 | -1 | 0): Promise<void>;
  sidePanelZoomGet(app: string): Promise<number>;
  /** Arraste da largura: o main acompanha o cursor por cima das páginas. */
  sidePanelDrag(active: boolean): Promise<void>;
  onSidePanelZoom(callback: (payload: { app: string; factor: number }) => void): () => void;
  /** Posição do cursor na janela durante o arraste (x: painel lateral; y: terminal). */
  onSidePanelDrag(
    callback: (payload: { x?: number; y?: number; done?: boolean }) => void,
  ): () => void;
  navigate(id: number, url: string): Promise<void>;
  goBack(id: number): Promise<void>;
  goForward(id: number): Promise<void>;
  reload(id: number, ignoreCache?: boolean): Promise<void>;
  /** Foto em tamanho real da aba visível (fica no lugar dela com painel aberto). */
  snapshotTab(id: number): Promise<string | null>;
  /** Tira a miniatura da aba visível (seletor do Ctrl+Tab). */
  captureTab(id: number): Promise<void>;
  /** 1 aumenta, -1 diminui, 0 volta a 100 %. */
  zoom(id: number, direction: -1 | 0 | 1): Promise<void>;
  findStart(
    id: number,
    text: string,
    options?: { forward?: boolean; newSession?: boolean },
  ): Promise<void>;
  findStop(id: number): Promise<void>;
  toggleFullscreen(): Promise<void>;
  adblockConfig(config: { shield: boolean; pausedHosts: string[] }): Promise<void>;
  adblockStats(): Promise<AdblockStats>;
  adblockUpdate(): Promise<{ ok: boolean }>;
  downloadsList(): Promise<DownloadRecord[]>;
  downloadAction(id: number, action: DownloadAction): Promise<{ ok: boolean }>;
  downloadsClear(): Promise<DownloadRecord[]>;
  downloadsDir(): Promise<string>;
  openDownloadsDir(): Promise<void>;
  /** Fecha o app (todas as janelas voltam no próximo início). */
  quitApp(): Promise<void>;
  closeTab(id: number): Promise<void>;
  muteTab(id: number, muted: boolean): Promise<void>;
  setPanelOpen(open: boolean): Promise<void>;
  showTabMenu(context: DesktopTabMenuContext): Promise<void>;
  respondPermission(id: string, allow: boolean, remember: boolean): Promise<void>;
  stateLoad(): Promise<{ available: boolean; sections: Record<string, unknown> }>;
  stateSave(sections: Record<string, unknown>): Promise<{ ok: boolean }>;
  keyLoad(): Promise<Credential[] | null>;
  keySave(list: Credential[]): Promise<{ ok: boolean }>;
  /** Integração do Agzos Key: as chamadas rodam no main (token/crypto nunca no renderer). */
  agzosKeyState(): Promise<KeyResult<KeyState>>;
  agzosKeyPair(
    pairingCode: string,
    deviceName?: string,
  ): Promise<KeyResult<{ paired: boolean; hasVault: boolean; accountEmail: string | null }>>;
  agzosKeyUnlock(masterPassword: string): Promise<KeyResult<{ unlocked: boolean }>>;
  agzosKeyLock(): Promise<KeyResult<null>>;
  agzosKeyList(): Promise<KeyResult<{ entries: VaultEntry[]; deletedIds: string[] }>>;
  agzosKeySave(entry: VaultEntry): Promise<KeyResult<{ ok: boolean; id: string }>>;
  agzosKeyRemove(id: string): Promise<KeyResult<{ ok: boolean }>>;
  agzosKeyUnpair(): Promise<KeyResult<{ ok: boolean }>>;
  /** Preenche usuário/senha nos campos de login da guia (autofill do cofre). */
  autofill(
    id: number,
    username: string,
    password: string,
  ): Promise<{ ok: boolean; filled?: boolean }>;
  /** Preenche o código MFA (TOTP) no campo de código da guia. */
  autofillOtp(id: number, code: string): Promise<{ ok: boolean; filled?: boolean }>;
  /** Usuário/senha já digitados na guia (para "salvar login" pela chave da barra). */
  loginFields(id: number): Promise<{ username: string; password: string }>;
  openExternal(url: string): Promise<void>;
  permissionsList(): Promise<SitePermission[]>;
  /** value null volta para "perguntar". */
  permissionsSet(
    origin: string,
    type: PermissionType,
    value: PermissionValue | null,
  ): Promise<{ ok: boolean }>;
  permissionsReset(origin: string): Promise<{ ok: boolean }>;
  historyList(query?: HistoryQuery): Promise<HistoryVisit[]>;
  historySearch(text: string, limit?: number): Promise<HistoryUrl[]>;
  historyDelete(ids: number[]): Promise<void>;
  historyDeleteUrl(url: string): Promise<void>;
  historyClear(range?: { from?: number; to?: number }): Promise<void>;
  /** Sugestões do motor de busca (feitas pelo main). */
  suggest(engine: string, text: string): Promise<string[]>;
  /** Menu nativo; devolve o id escolhido ou null. */
  showMenu(items: NativeMenuItem[]): Promise<string | null>;
  /** Janela nova (vazia, ou com `url` numa guia). */
  newWindow(options?: { url?: string }): Promise<void>;
  /** Leva a guia (e a página viva) para uma janela nova. */
  moveTabToWindow(id: number, tab: Tab): Promise<{ ok: boolean }>;
  /** Guias que a casca conhece: o main fecha as outras (casca recarregada). */
  syncTabs(ids: number[]): Promise<void>;
  hibernateTab(id: number): Promise<{ ok: boolean }>;
  /** Liga/desliga o picture-in-picture do vídeo da guia (qualquer player). */
  pictureInPicture(id: number): Promise<{ ok: boolean; active: boolean; reason?: string }>;
  /** Encerra a página que não responde. */
  killTab(id: number): Promise<void>;
  /** GX Control (3.0): uso do app e das guias desta janela. */
  gxStats(): Promise<GxStats>;
  /** Teste de velocidade da internet (latência, download e upload). */
  gxSpeedTest(): Promise<SpeedTestResult>;
  /** Bytes do cache de disco das páginas. */
  gxCacheSize(): Promise<number>;
  /** Limpa cache e dados temporários (cookies e logins ficam). */
  gxClearCache(): Promise<{ freedBytes: number; cacheBytes: number }>;
  /** Agzos AI: a chave vai uma vez para o main (safeStorage) e nunca volta. */
  aiState(): Promise<AiState>;
  aiSetKey(key: string): Promise<{ ok: true; models: string[] } | AiFailure>;
  aiRemoveKey(): Promise<{ ok: boolean }>;
  aiModels(refresh?: boolean): Promise<{ ok: true; models: string[] } | AiFailure>;
  aiLibrary(): Promise<AiLibrary>;
  aiMessages(chatId: string | null): Promise<AiHistoryItem[]>;
  aiLibraryAction(
    action: AiLibraryAction,
  ): Promise<{ ok: boolean; library: AiLibrary; id: string | null }>;
  aiChat(payload: {
    requestId: string;
    /** null = conversa nova (criada com a primeira resposta, no projeto `projectId`). */
    chatId: string | null;
    projectId: string | null;
    model: string | null;
    text: string;
    context: AiContext | null;
  }): Promise<AiChatResult>;
  aiAbort(requestId: string): Promise<{ ok: boolean }>;
  onAiDelta(callback: (payload: { requestId: string; delta: string }) => void): () => void;
  /** As conversas mudaram (resposta nova, outra janela, renomear, arquivar…). */
  onAiLibrary(callback: (library: AiLibrary) => void): () => void;
  /** Texto selecionado na guia (só lido quando o usuário manda o contexto). */
  tabSelection(id: number): Promise<string>;
  /** Terminal (4.0): shells num PTY do main (node-pty). */
  terminalAvailable(): Promise<{ ok: boolean; shells: TerminalShell[] }>;
  terminalOpen(options: {
    shell?: string;
    cwd?: string;
    cols: number;
    rows: number;
  }): Promise<
    | { ok: true; id: number; shell: string; label: string; cwd: string }
    | { ok: false; error: string }
  >;
  terminalWrite(id: number, data: string): void;
  terminalResize(id: number, cols: number, rows: number): Promise<boolean>;
  terminalKill(id: number): Promise<boolean>;
  /** O terminal ganhou/perdeu o foco (o main deixa Ctrl+W, Ctrl+R… para o shell). */
  terminalFocus(focused: boolean): Promise<void>;
  terminalSaved(): Promise<SavedTerminal[]>;
  terminalSave(list: SavedTerminal[]): Promise<{ ok: boolean }>;
  /** 4.1: sessões vivas da janela com a saída recente (o terminal mudou de lugar). */
  terminalList(): Promise<LiveTerminal[]>;
  terminalOpenSsh(
    connection: SshConnection,
    cols: number,
    rows: number,
  ): Promise<
    | { ok: true; id: number; shell: string; label: string; cwd: string }
    | { ok: false; error: string }
  >;
  /** Preferências do terminal para o main (aliases, Groq) e o terminal flutuante. */
  terminalConfig(config: TerminalRuntimeConfig): Promise<void>;
  terminalConfigGet(): Promise<TerminalRuntimeConfig | null>;
  /** Abre/fecha o terminal flutuante (PiP) desta janela. */
  terminalPip(open: boolean): Promise<void>;
  /** No terminal flutuante: encaixar de volta na janela ou esconder. */
  terminalDock(dock: "bottom" | "right" | "hide"): Promise<void>;
  /** Quais comandos existem no PATH do app. */
  terminalTools(commands: string[]): Promise<Record<string, boolean>>;
  /** Chaves de API dos terminais: só os nomes voltam. */
  terminalSecrets(): Promise<{ names: string[]; encryption: boolean }>;
  terminalSecretSet(name: string, value: string): Promise<{ ok: boolean; error?: string }>;
  terminalSecretRemove(name: string): Promise<{ ok: boolean; error?: string }>;
  sshKeys(): Promise<SshKey[]>;
  sshGenerate(options: {
    name: string;
    comment: string;
    passphrase: string;
  }): Promise<{ ok: true; key: SshKey } | { ok: false; error: string }>;
  /** Modo voz: áudio → texto pelo Whisper da Groq (a chave do Agzos AI). */
  aiTranscribe(
    audio: Uint8Array,
    mime: string,
    language: string,
  ): Promise<{ ok: true; text: string } | AiFailure>;
  /** macOS: pede o microfone ao sistema (nos outros, true). */
  micAccess(): Promise<boolean>;
  onTerminalConfig(callback: (config: TerminalRuntimeConfig) => void): () => void;
  /** Terminal flutuante fechado pelo usuário ou encaixado de volta. */
  onTerminalPip(
    callback: (payload: { open?: boolean; dock?: "bottom" | "right" }) => void,
  ): () => void;
  clipboardRead(): Promise<string>;
  clipboardWrite(text: string): Promise<void>;
  onTerminalData(callback: (payload: { id: number; data: string }) => void): () => void;
  onTerminalExit(
    callback: (payload: { id: number; exitCode: number; signal: number | null }) => void,
  ): () => void;
  onTerminalCwd(callback: (payload: { id: number; cwd: string }) => void): () => void;
  /** 4.1.1: nome da aba do terminal (vazio volta ao nome do shell). */
  terminalRename(id: number, title: string): Promise<boolean>;
  onTerminalTitle(callback: (payload: { id: number; title: string }) => void): () => void;
  /** Aba nova que instala as CLIs escolhidas (ids de CLI_TOOLS) e põe no PATH. */
  terminalInstallTools(ids: string[], cols: number, rows: number): Promise<TerminalOpenResult>;
  /** Nó de agente: a CLI roda sem interação numa aba própria. */
  terminalOpenAgent(options: {
    tool: string;
    prompt: string;
    cwd: string;
    title: string;
    cols: number;
    rows: number;
  }): Promise<TerminalOpenResult>;
  terminalSkills(cwd: string): Promise<CliSkill[]>;
  terminalSkillCreate(options: {
    name: string;
    description: string;
    body: string;
    scope: "user" | "project";
    cwd: string;
  }): Promise<{ ok: true; file: string } | { ok: false; error: string }>;
  /** Nó "Agzos AI" do modo agente (Groq, sem histórico). */
  agentGroq(prompt: string): Promise<{ ok: true; text: string; model: string } | AiFailure>;
  /** Objetivo → etapas com ferramenta e dependências (planejado pela Groq). */
  agentPlan(
    goal: string,
    tools: string[],
  ): Promise<{ ok: true; steps: AgentPlanStep[] } | AiFailure | { ok: false; error: "plan" }>;
  filesList(dir: string, hidden?: boolean): Promise<FileListing>;
  filesHome(): Promise<string>;
  /** Abre o arquivo numa guia, no app do sistema ou mostra na pasta. */
  filesOpen(file: string, where: "tab" | "system" | "folder"): Promise<boolean>;
  /** Ctrl+O: escolher arquivos e abrir em guias. */
  filesPick(): Promise<number>;
  pwaState(tabId: number): Promise<PwaTabState>;
  /** Verifica a guia na hora (Configurações → Tentar instalar este site como app). */
  pwaCheck(tabId: number): Promise<PwaCheck>;
  // --- 4.5 ---
  /** Atalho lateral promovido à área principal (true) ou de volta ao painel menor. */
  sidePanelExpand(expanded: boolean): Promise<void>;
  /** Modo leitura: a view da guia sai de cena (a página continua carregada). */
  tabCover(id: number, covered: boolean): Promise<void>;
  portsList(): Promise<{ ok: boolean; ports: PortInfo[] }>;
  portsKill(pid: number): Promise<PortKillResult>;
  tunnelStatus(): Promise<TunnelStatus>;
  tunnelStart(port: number): Promise<TunnelResult>;
  /** Sem porta: fecha todos os túneis desta janela. */
  tunnelStop(port?: number): Promise<boolean>;
  tunnelPickBinary(): Promise<{ ok: boolean; binary?: string; error?: "invalid" }>;
  onTunnel(callback: (event: TunnelEvent) => void): () => void;
  inspectorToggle(id: number): Promise<{ ok: boolean; active?: boolean }>;
  readerExtract(
    id: number,
  ): Promise<{ ok: true; article: ReaderArticle } | { ok: false; reason: "page" | "empty" }>;
  captureTake(
    mode: "tab" | "window",
  ): Promise<{ ok: boolean; layers?: CaptureLayer[]; reason?: "tab" }>;
  captureCopy(dataUrl: string): Promise<boolean>;
  captureSave(dataUrl: string): Promise<{ ok: boolean; path?: string; canceled?: boolean }>;
  scratchpadCapture(
    id: number,
    on: boolean,
  ): Promise<{ ok: boolean; requests: CapturedRequest[]; error?: string }>;
  scratchpadSend(request: ScratchpadRequest, tabId: number | null): Promise<ScratchpadResponse>;
  onNetCapture(callback: (event: NetCaptureEvent) => void): () => void;
  extensionsList(): Promise<{ supported: boolean; list: ExtensionInfo[] }>;
  extensionsAddUnpacked(): Promise<ExtensionResult>;
  extensionsInstallStore(input: string): Promise<ExtensionResult>;
  extensionsSetEnabled(dir: string, enabled: boolean): Promise<{ ok: boolean }>;
  extensionsReload(dir: string): Promise<{ ok: boolean }>;
  extensionsRemove(dir: string): Promise<{ ok: boolean }>;
  widevineStatus(): Promise<WidevineStatus>;
  pwaInstall(
    tabId: number,
  ): Promise<{ ok: boolean; id?: string; error?: string; reason?: PwaReason }>;
  pwaOpen(id: string): Promise<boolean>;
  pwaUninstall(id: string): Promise<{ ok: boolean; error?: string }>;
  pwaList(): Promise<InstalledPwa[]>;
  onPwaState(callback: (payload: { tabId: number; pwa: PwaTabState }) => void): () => void;
  onPwaChanged(callback: () => void): () => void;
  /** Gestos (4.0): o que as páginas detectam (repassado a cada guia e painel). */
  gesturesConfig(config: GestureConfig): Promise<void>;
  /** Gesto visto na casca (botão lateral numa página interna, deslizar). */
  gesture(gesture: GestureId): void;
  onGesture(callback: (payload: GestureEvent) => void): () => void;
  sidePanelNav(app: string, action: "back" | "forward" | "reload"): Promise<{ ok: boolean }>;
  gpuStatus(): Promise<GpuStatus>;
  /** Liga/desliga a aceleração forçada (vale ao reiniciar). */
  gpuSet(enabled: boolean): Promise<{ ok: boolean }>;
  /** "Continuar mesmo assim" num certificado inválido (só nesta execução). */
  allowCertificate(id: number): Promise<{ ok: boolean }>;
  /** Aviso de restauração depois de um fechamento inesperado (só a 1ª janela recebe). */
  windowStartup(): Promise<StartupInfo | null>;
  /** Primeiro início depois de uma atualização (só a primeira janela recebe). */
  whatsNew(): Promise<{ from: string | null; to: string } | null>;
  appVersion(): Promise<string>;
  /** Outra janela gravou seções compartilhadas (preferências, favoritos…). */
  onStateSync(callback: (sections: Record<string, unknown>) => void): () => void;
  updateState(): Promise<UpdateState | null>;
  updateCheck(): Promise<UpdateState | null>;
  updateInstall(): Promise<{ ok: boolean }>;
  onUpdate(callback: (state: UpdateState) => void): () => void;
  onTabEvent(callback: (event: DesktopTabEvent) => void): () => void;
  /** `from`: guia de onde o link saiu (null quando veio de outro lugar). */
  onOpenRequest(callback: (payload: { url: string; from?: number }) => void): () => void;
  onFullscreen(callback: (payload: { active: boolean }) => void): () => void;
  onHotkey(
    callback: (payload: {
      key: string;
      shift: boolean;
      alt: boolean;
      meta: boolean;
      ctrl: boolean;
      /** Ctrl+Tab com o foco na página: o seletor vai para a camada acima dela. */
      layer?: boolean;
    }) => void,
  ): () => void;
  /** `action` é um CommandId (ver commands.ts). */
  onTabMenuAction(
    callback: (payload: { action: string; tabId: number | null }) => void,
  ): () => void;
  onRequestPermission(callback: (payload: DesktopPermissionRequest) => void): () => void;
  onDownload(callback: (record: DownloadRecord) => void): () => void;
  /** Ctrl/⌘ solto (inclusive com o foco na página). */
  onModifierUp(callback: (payload: { key: string }) => void): () => void;
  /** Cartão de prévia da guia (camada acima da página); o main soma memória e CPU. */
  showTabPreview(payload: {
    id: number;
    rect: { x: number; y: number; width: number; height: number };
    side: "below" | "right";
    card: TabCard;
  }): Promise<void>;
  hideTabPreview(): Promise<void>;
  /** O seletor do Ctrl+Tab abriu/fechou (o main desvia Enter/Esc/setas da página). */
  setSwitcherOpen(open: boolean): Promise<void>;
  /** Tecla do seletor apertada com o foco na página. */
  onSwitcherKey(callback: (payload: { key: string; index?: number }) => void): () => void;
  /** Seletor na camada acima da página: cartões (ao abrir), só o índice, ou null (fecha). */
  renderSwitcher(
    model:
      | {
          cards: { title: string; image?: string; icon?: string; letter: string }[];
          index: number;
          dark: boolean;
        }
      | { index: number }
      | null,
  ): Promise<void>;
  onAdblockStats(callback: (stats: AdblockStats) => void): () => void;
  /** Painel da toolbar na camada acima da página (abre, troca ou atualiza). */
  overlayOpen(payload: OverlayPayload): Promise<{ ok: boolean }>;
  overlayClose(): Promise<void>;
  /** Resposta a uma função do painel chamada na camada. */
  overlayReply(id: number, result: unknown): Promise<void>;
  onOverlayCall(
    callback: (payload: { id: number; name: string; args: unknown[] }) => void,
  ): () => void;
  /** A camada fechou o painel (clique fora, Esc, atalho, janela arrastada). */
  onOverlayDismissed(
    callback: (payload: { kind?: PanelKind; click?: "shell" | "page" | false }) => void,
  ): () => void;
};

type DesktopWindow = Window & { agzosDesktop?: DesktopBridge };

export function desktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  return (window as DesktopWindow).agzosDesktop ?? null;
}

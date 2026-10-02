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

export type DesktopBridge = {
  attachTab(
    id: number,
    url: string,
    options?: { dark?: boolean; private?: boolean },
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
  onSidePanelDrag(callback: (payload: { x?: number; done?: boolean }) => void): () => void;
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
  onOpenRequest(callback: (payload: { url: string }) => void): () => void;
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

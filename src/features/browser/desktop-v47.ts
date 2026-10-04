/**
 * 4.7: ponte do gerenciador de downloads, do tema por domínio, do ColorTools e do PDF
 * Tools (electron/preload.cjs). Fica à parte de desktop.ts só pelo tamanho.
 */
export type DownloadFileType = "pdf" | "image" | "video" | "audio" | "archive" | "other";

export type DownloadRule = {
  id: string;
  /** "type": extensão, MIME ou tipo; "domain": site do link; "name": regex no nome. */
  match: "type" | "domain" | "name";
  pattern: string;
  tag: string;
  /** Pasta absoluta (troca o destino). */
  folder: string;
  /** Subpasta dentro do destino. */
  subfolder: string;
  enabled: boolean;
};

export type DownloadsConfig = {
  /** Pasta padrão ("" = a do sistema). */
  dir: string;
  byTypeOn: boolean;
  byType: Record<DownloadFileType, string>;
  rules: DownloadRule[];
  tagColors: Record<string, string>;
};

export type PageThemeMode = "lightning" | "dark" | "auto";

/** Estado do tema da página da guia (o botão da barra de URL). */
export type PageThemeInfo = {
  /** Domínio registrável ("example.com"); null em páginas sem tema (agzos://, file://). */
  domain: string | null;
  mode: PageThemeMode;
  /** O CSS escuro está aplicado agora. */
  dark: boolean;
};

export type Rgb = { r: number; g: number; b: number };

export type PageColor = {
  hex: string;
  count: number;
  /** Seletor aproximado do primeiro elemento com a cor. */
  selector: string;
  /** Onde aparece: texto, fundo, borda. */
  roles: ("text" | "background" | "border")[];
};

export type PdfFile = {
  name: string;
  /** Caminho no disco (vazio quando veio de uma URL). */
  path: string;
  bytes: ArrayBuffer;
  size: number;
};

export type PdfCloudTarget = { id: "gdrive" | "dropbox" | "onedrive"; name: string; dir: string };

export type V47TabEvent =
  /** O tema da página mudou (navegação, clique no botão ou sistema). */
  | { type: "page-theme"; id: number; theme: PageThemeInfo }
  /** Contraste abaixo do WCAG AA no escuro: trechos que voltaram ao original. */
  | { type: "page-theme-reverted"; id: number; count: number }
  /** A guia mostra um PDF (ícone PDF na barra de URL). */
  | { type: "pdf"; id: number; url: string; pdf: boolean };

export type DesktopV47 = {
  downloadAction(
    id: number,
    action: "restart" | "tags" | "destination",
    value?: unknown,
  ): Promise<{ ok: boolean; pending?: boolean; path?: string; error?: string; canceled?: boolean }>;
  downloadsConfig(): Promise<{
    config: DownloadsConfig;
    defaults: Record<DownloadFileType, string>;
    base: string;
  }>;
  downloadsSetConfig(config: DownloadsConfig): Promise<DownloadsConfig>;
  downloadsPickDir(title?: string): Promise<string | null>;
  downloadsExport(payload: {
    ids?: number[];
    format?: "json" | "csv";
    what?: "rules";
  }): Promise<{ ok: boolean; path?: string; canceled?: boolean }>;
  downloadsImportRules(): Promise<{ ok: boolean; config?: DownloadsConfig; error?: string }>;
  onDownloadsConfig(callback: (config: DownloadsConfig) => void): () => void;

  pageThemeGet(tabId: number): Promise<PageThemeInfo>;
  pageThemeSet(tabId: number, mode: PageThemeMode): Promise<PageThemeInfo>;
  pageThemeList(): Promise<Record<string, PageThemeMode>>;
  pageThemeForget(domain: string | null): Promise<Record<string, PageThemeMode>>;
  /** Configurações: modo de um domínio (Lightning tira da lista). */
  pageThemeSetDomain(domain: string, mode: PageThemeMode): Promise<Record<string, PageThemeMode>>;

  /** Conta-gotas na guia: a cor clicada, ou null (Esc). */
  colorPick(tabId: number, options: { dark: boolean }): Promise<Rgb | null>;
  colorAnalyze(tabId: number): Promise<{ ok: boolean; colors: PageColor[]; scanned: number }>;
  clipboardWrite(text: string): Promise<void>;
  /** Diálogo "Salvar como" para exportações (texto ou bytes). */
  saveFile(payload: {
    name: string;
    data: string | ArrayBuffer;
    filters?: { name: string; extensions: string[] }[];
  }): Promise<{ ok: boolean; path?: string; canceled?: boolean }>;
  /** Atalhos configuráveis (ColorTools, PDF Tools, tema): o main repassa com foco na página. */
  setExtraShortcuts(combos: string[]): Promise<void>;

  pdfOpenDialog(
    maxMb: number,
  ): Promise<{ ok: boolean; files?: PdfFile[]; error?: string; name?: string; canceled?: boolean }>;
  pdfReadPath(
    path: string,
    maxMb: number,
  ): Promise<{ ok: boolean; file?: PdfFile; error?: string }>;
  pdfFromUrl(
    url: string,
    tabId: number | undefined,
    maxMb: number,
  ): Promise<{ ok: boolean; file?: PdfFile; error?: string }>;
  pdfSave(payload: {
    bytes: ArrayBuffer;
    name: string;
    path?: string;
    /** "same": grava por cima do original; "export": diálogo Salvar como. */
    mode: "same" | "export";
    filters?: { name: string; extensions: string[] }[];
  }): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>;
  /** Grava um arquivo numa pasta escolhida em downloadsPickDir (nome livre ganha " (1)"). */
  pdfSaveInto(payload: {
    dir: string;
    name: string;
    bytes: ArrayBuffer;
  }): Promise<{ ok: boolean; path?: string }>;
  pdfSessionStart(): Promise<{ id: string }>;
  pdfSessionEnd(id: string): Promise<void>;
  pdfOcrAsset(name: string): Promise<ArrayBuffer | null>;
  pdfOcrDownload(lang: string): Promise<{ ok: boolean; error?: string }>;
  pdfOcrLanguages(): Promise<{ bundled: string[]; downloaded: string[]; downloadable: string[] }>;
  pdfOffice(): Promise<{ available: boolean; path: string | null }>;
  pdfOfficeConvert(payload: {
    bytes: ArrayBuffer;
    name: string;
    to: "pdf" | "docx" | "odt" | "xlsx" | "pptx";
  }): Promise<{ ok: boolean; bytes?: ArrayBuffer; name?: string; error?: string }>;
  pdfCloudTargets(): Promise<PdfCloudTarget[]>;
  pdfCloudSave(payload: {
    bytes: ArrayBuffer;
    name: string;
    target: PdfCloudTarget["id"];
  }): Promise<{ ok: boolean; path?: string; error?: string }>;
  pdfSummarize(payload: {
    requestId: string;
    text: string;
    language: string;
  }): Promise<{ ok: boolean; text?: string; error?: string }>;
  pdfAbort(requestId: string): Promise<void>;
  pdfPasswordGet(fingerprint: string): Promise<string | null>;
  pdfPasswordRemember(fingerprint: string, password: string): Promise<{ ok: boolean }>;
  pdfPasswordForget(fingerprint: string | null): Promise<void>;
  /** Pedido de fora (menu de contexto, barra, downloads) para abrir no PDF Tools. */
  onPdfOpen(
    callback: (payload: { url?: string; path?: string; tabId?: number }) => void,
  ): () => void;
  onPdfProgress(callback: (payload: { requestId: string; fraction: number }) => void): () => void;
  /** Ação de ColorTools pedida pelo menu de contexto da página. */
  onColorAction(
    callback: (payload: { action: "copied" | "analyze" | "gradient"; hex?: string }) => void,
  ): () => void;
};

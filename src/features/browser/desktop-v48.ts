/**
 * 4.8 (Fase 0): flags por bloco do PRD v4.8 e capacidades medidas do runtime
 * (electron/feature-flags.cjs, electron/capabilities.cjs).
 */
export type FeatureFlagName =
  "devtools" | "print_shield" | "scroll_stitch" | "copilot" | "rewind" | "kiosk" | "pwa_mac_apps";

export type FeatureFlags = Record<FeatureFlagName, boolean>;

export type RuntimeCapabilities = {
  schema: number;
  key: string;
  measuredAt: string;
  versions: {
    electron: string | null;
    chrome: string | null;
    node: string | null;
    v8: string | null;
  };
  cdp: { attached: boolean; runtimeEvaluate: boolean };
  printToPdf: {
    available: boolean;
    taggedPdf: boolean;
    documentOutline: boolean;
    error: string | null;
  };
  cdpPrintToPdf: { available: boolean; returnAsStream: boolean; error: string | null };
  /** Medido na guia na tela (Fase 3); até lá maxHeight 0 e vale safeCap. */
  capture: { measured: boolean; maxHeight: number; safeCap: number };
};

/** 4.8 (Fase 1): onde o DevTools fica: encaixado à direita, embaixo ou numa janela. */
export type DevtoolsSide = "right" | "bottom" | "window";

export type DevtoolsDock = { side: DevtoolsSide; width: number; height: number };

/** Ações do DevTools de uma guia ("inspect-at" usa x/y da página). */
export type DevtoolsAction =
  "toggle" | "open" | "close" | "console" | "elements" | "inspect" | "device" | "inspect-at";

export type DevtoolsResult = {
  ok: boolean;
  open: boolean;
  side: DevtoolsSide | null;
  reason?: "tab" | "disabled" | "action";
};

type Rect = { x: number; y: number; width: number; height: number };

export type DesktopV48 = {
  featureFlags(): Promise<FeatureFlags>;
  /** null volta ao padrão do build. */
  setFeatureFlag(name: FeatureFlagName, value: boolean | null): Promise<FeatureFlags>;
  /** Medidas na primeira vez (alguns segundos); null se a sonda falhou. */
  runtimeCapabilities(): Promise<RuntimeCapabilities | null>;
  onFeatureFlags(callback: (flags: FeatureFlags) => void): () => void;
  devtools(
    id: number,
    action: DevtoolsAction,
    options?: { side?: DevtoolsSide; x?: number; y?: number },
  ): Promise<DevtoolsResult>;
  /** Área do dock na janela; null esconde. */
  devtoolsBounds(rect: Rect | null): Promise<void>;
  /** Lado e tamanho por workspace ("default" sem workspace). */
  devtoolsDocks(): Promise<Record<string, DevtoolsDock>>;
  setDevtoolsDock(
    workspace: number | null,
    dock: DevtoolsDock,
  ): Promise<Record<string, DevtoolsDock>>;
  onDevtools(
    callback: (event: { id: number; open: boolean; side: DevtoolsSide }) => void,
  ): () => void;
  /** Pedido vindo do main: menu "Inspecionar", mira ou tecla no próprio DevTools. */
  onDevtoolsRequest(
    callback: (event: { id: number; action: DevtoolsAction; x?: number; y?: number }) => void,
  ): () => void;
};

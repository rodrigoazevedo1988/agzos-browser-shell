/**
 * 4.8 (Fase 0): flags por bloco do PRD v4.8 e capacidades medidas do runtime
 * (electron/feature-flags.cjs, electron/capabilities.cjs).
 */
export type FeatureFlagName =
  "devtools" | "print_shield" | "scroll_stitch" | "copilot" | "rewind" | "kiosk";

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

export type DesktopV48 = {
  featureFlags(): Promise<FeatureFlags>;
  /** null volta ao padrão do build. */
  setFeatureFlag(name: FeatureFlagName, value: boolean | null): Promise<FeatureFlags>;
  /** Medidas na primeira vez (alguns segundos); null se a sonda falhou. */
  runtimeCapabilities(): Promise<RuntimeCapabilities | null>;
  onFeatureFlags(callback: (flags: FeatureFlags) => void): () => void;
};

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "../../src/styles.css";
import { overlayBridge } from "../../src/features/browser/overlay/bridge";
import { OverlayHost } from "../../src/features/browser/overlay/host";

// Camada dos painéis da toolbar (electron/chrome-overlay.cjs).
const root = document.getElementById("root");
const bridge = overlayBridge();

if (!root || !bridge) {
  throw new Error("Overlay root or bridge was not found.");
}

createRoot(root).render(
  <StrictMode>
    <OverlayHost bridge={bridge} />
  </StrictMode>,
);

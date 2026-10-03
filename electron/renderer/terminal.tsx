import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "../../src/styles.css";
import { desktopBridge } from "../../src/features/browser/desktop";
import { FloatingTerminal } from "../../src/features/terminal/floating";

// Terminal flutuante (4.1). As preferências vêm da casca pelo main (terminal:config).
const root = document.getElementById("root");
const bridge = desktopBridge();
if (!root || !bridge) throw new Error("Terminal root or bridge was not found.");

createRoot(root).render(
  <StrictMode>
    <FloatingTerminal desktop={bridge} />
  </StrictMode>,
);

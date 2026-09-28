import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "../../src/styles.css";
import { AgzosBrowser } from "../../src/routes/index";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Desktop renderer root was not found.");
}

createRoot(root).render(
  <StrictMode>
    <AgzosBrowser />
  </StrictMode>,
);
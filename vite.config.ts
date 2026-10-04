// Versão web da casca (TanStack Start). O app desktop usa electron/vite.config.mjs.
import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // O Electron carrega o bundle por file://: os caminhos dos assets precisam ser relativos.
  base: "./",
  server: { host: "::", port: 8080 },
  // Mesmo pipeline de CSS do build anterior (Tailwind 4 + lightningcss).
  css: { transformer: "lightningcss" },
  resolve: {
    alias: { "@": path.join(root, "src") },
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
    ],
  },
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ],
  },
  plugins: [
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tailwindcss(),
    // Entrada do servidor em src/server.ts (o wrapper de erros do SSR).
    tanstackStart({ server: { entry: "server" } }),
    viteReact(),
  ],
});

import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const directory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(directory, "renderer"),
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.join(directory, "..", "src"),
    },
  },
  build: {
    outDir: path.join(directory, "..", "dist"),
    emptyOutDir: true,
  },
});

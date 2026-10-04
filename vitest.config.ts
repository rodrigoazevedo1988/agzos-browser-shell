import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

// Config própria: a do app (TanStack Start) carrega plugins de servidor que o teste não precisa.
export default defineConfig({
  resolve: { alias: { "@": path.join(root, "src") } },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});

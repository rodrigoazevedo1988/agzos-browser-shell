import { createFileRoute } from "@tanstack/react-router";

import { AgzosBrowser } from "@/features/browser/chrome";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Agzos Browser — Navegue com controle" },
      {
        name: "description",
        content: "Interface do Agzos Browser com IA, privacidade e cofre integrados.",
      },
      { property: "og:title", content: "Agzos Browser — Navegue com controle" },
      {
        property: "og:description",
        content: "Interface do Agzos Browser com IA, privacidade e cofre integrados.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AgzosBrowser,
});

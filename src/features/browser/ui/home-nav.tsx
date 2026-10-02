import { House, LayoutGrid } from "lucide-react";

import { cn } from "@/lib/utils";

/** "Início · Discador" no topo das duas páginas (3.0): troca na mesma guia. */
export function HomeNav({
  current,
  onHome,
  onDial,
}: {
  current: "home" | "dial";
  onHome: () => void;
  onDial: () => void;
}) {
  return (
    <nav className="home-nav" aria-label="Páginas iniciais">
      <button
        type="button"
        className={cn(current === "home" && "on")}
        aria-current={current === "home" ? "page" : undefined}
        onClick={onHome}
      >
        <House aria-hidden="true" />
        Início
      </button>
      <button
        type="button"
        className={cn(current === "dial" && "on")}
        aria-current={current === "dial" ? "page" : undefined}
        onClick={onDial}
      >
        <LayoutGrid aria-hidden="true" />
        Discador
      </button>
    </nav>
  );
}

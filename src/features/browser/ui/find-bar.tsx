import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

import type { FindResult } from "../store/state";

export type FindOptions = { forward: boolean; newSession: boolean };

/**
 * Barra de busca na página (Ctrl+F). Fica entre a toolbar e a página: o WebContentsView
 * é desenhado por cima de qualquer overlay da casca, então a página encolhe.
 */
export function FindBar({
  result,
  focusSignal,
  onSearch,
  onClose,
}: {
  result: FindResult;
  /** Muda a cada Ctrl+F: foca e seleciona o texto. */
  focusSignal: number;
  onSearch: (text: string, options: FindOptions) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusSignal]);

  const step = (forward: boolean) => {
    if (text) onSearch(text, { forward, newSession: false });
  };

  const status = !text
    ? ""
    : result.total === 0
      ? "Nenhum resultado"
      : `${result.active} de ${result.total}`;

  return (
    <div className="find-bar" role="search" aria-label="Buscar na página">
      <Search aria-hidden="true" />
      <input
        ref={inputRef}
        value={text}
        placeholder="Buscar na página"
        aria-label="Buscar na página"
        onChange={(event) => {
          const value = event.target.value;
          setText(value);
          onSearch(value, { forward: true, newSession: true });
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            step(!event.shiftKey);
          } else if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      />
      <span className="find-status" aria-live="polite">
        {status}
      </span>
      <Button
        variant="ghost"
        size="icon"
        title="Resultado anterior (Shift+Enter)"
        aria-label="Resultado anterior"
        disabled={!text || result.total === 0}
        onClick={() => step(false)}
      >
        <ChevronUp />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        title="Próximo resultado (Enter)"
        aria-label="Próximo resultado"
        disabled={!text || result.total === 0}
        onClick={() => step(true)}
      >
        <ChevronDown />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        title="Fechar (Esc)"
        aria-label="Fechar busca"
        onClick={onClose}
      >
        <X />
      </Button>
    </div>
  );
}

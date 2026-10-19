import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { languageLabel, searchLanguages } from "./languages";

/** Escolha de idioma com busca (lista de ~30 idiomas). `auto` adiciona "Detectar". */
export function LanguagePicker({
  value,
  label,
  auto = false,
  detected,
  onChange,
}: {
  value: string;
  label: string;
  auto?: boolean;
  /** Idioma detectado (mostrado ao lado de "Detectar"). */
  detected?: string | undefined;
  onChange: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  const list = searchLanguages(query);
  const current =
    value === "auto"
      ? detected
        ? `Detectar (${languageLabel(detected)})`
        : "Detectar idioma"
      : languageLabel(value);
  const choose = (code: string) => {
    onChange(code);
    setOpen(false);
    setQuery("");
  };
  return (
    <div className={cn("tr-picker", open && "open")}>
      <button
        type="button"
        className="tr-picker-button"
        aria-label={`${label}: ${current}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span>{current}</span>
        <ChevronDown />
      </button>
      {open && (
        <div className="tr-picker-list">
          <label className="tr-search">
            <Search />
            <input
              ref={input}
              type="search"
              value={query}
              placeholder="Buscar idioma"
              aria-label={`Buscar ${label.toLowerCase()}`}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  setOpen(false);
                } else if (event.key === "Enter" && list[0]) {
                  event.preventDefault();
                  choose(list[0].code);
                }
              }}
            />
          </label>
          <ul role="listbox" aria-label={label}>
            {auto && !query && (
              <li>
                <button
                  type="button"
                  role="option"
                  aria-selected={value === "auto"}
                  onClick={() => choose("auto")}
                >
                  Detectar idioma
                  {value === "auto" && <Check />}
                </button>
              </li>
            )}
            {list.map((item) => (
              <li key={item.code}>
                <button
                  type="button"
                  role="option"
                  aria-selected={value === item.code}
                  onClick={() => choose(item.code)}
                >
                  {item.label}
                  {value === item.code && <Check />}
                </button>
              </li>
            ))}
            {!list.length && <li className="tr-empty">Nenhum idioma com esse nome.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

import { AppWindow, Globe, History, Search, Star, X } from "lucide-react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";

import { cn } from "@/lib/utils";

import {
  buildSuggestions,
  inlineCompletion,
  type Suggestion,
  type SuggestionKind,
} from "../omnibox-suggest";
import type { HistoryStore } from "../persistence/history-store";
import type { BookmarkNode, EngineId, HistoryUrl, Tab } from "../types";

const ICONS: Record<SuggestionKind, typeof Globe> = {
  go: Globe,
  search: Search,
  remote: Search,
  history: History,
  bookmark: Star,
  tab: AppWindow,
};

export type OmniboxFieldProps = {
  value: string;
  /** Endereço da aba (Esc volta para ele). */
  currentUrl: string;
  engine: EngineId;
  privateTab: boolean;
  remoteSuggestions: boolean;
  bookmarks: BookmarkNode[];
  /** Outras abas abertas (a ativa e as anônimas ficam de fora). */
  tabs: Tab[];
  history: HistoryStore | null;
  suggest: ((text: string) => Promise<string[]>) | null;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onSwitchTab: (id: number) => void;
  onOpenChange: (open: boolean) => void;
};

const EMPTY: HistoryUrl[] = [];

/** Favicon do site; se não carregar (ou não houver), o ícone do tipo de sugestão. */
function OptionIcon({
  icon,
  fallback: Fallback,
}: {
  icon?: string | null | undefined;
  fallback: typeof Globe;
}) {
  const [broken, setBroken] = useState(false);
  if (icon && !broken) return <img src={icon} alt="" onError={() => setBroken(true)} />;
  return <Fallback aria-hidden="true" />;
}
const NO_REMOTE: string[] = [];

export const OmniboxField = forwardRef<HTMLInputElement, OmniboxFieldProps>(
  function OmniboxField(props, ref) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    useImperativeHandle(ref, () => inputRef.current!, []);
    // Texto que o usuário digitou (sem o autocompletar); null = não está editando.
    const [typed, setTyped] = useState<string | null>(null);
    const [history, setHistory] = useState<HistoryUrl[]>(EMPTY);
    const [remote, setRemote] = useState<string[]>(NO_REMOTE);
    const [selected, setSelected] = useState(-1);
    const allowComplete = useRef(false);
    const pendingSelection = useRef<[number, number] | null>(null);
    const { history: store, suggest, remoteSuggestions, privateTab } = props;

    useEffect(() => {
      if (!typed?.trim()) {
        setHistory(EMPTY);
        setRemote(NO_REMOTE);
        return;
      }
      let cancelled = false;
      const text = typed.trim();
      const local = window.setTimeout(() => {
        void store
          ?.search(text, 30)
          .then((list) => !cancelled && setHistory(list))
          .catch(() => {});
      }, 50);
      // O texto só vai para o buscador com a opção ligada e fora da aba anônima.
      const online =
        suggest && remoteSuggestions && !privateTab
          ? window.setTimeout(() => {
              void suggest(text)
                .then((list) => !cancelled && setRemote(list))
                .catch(() => {});
            }, 180)
          : null;
      return () => {
        cancelled = true;
        window.clearTimeout(local);
        if (online !== null) window.clearTimeout(online);
      };
    }, [typed, store, suggest, remoteSuggestions, privateTab]);

    const suggestions = useMemo(
      () =>
        typed
          ? buildSuggestions({
              input: typed,
              engine: props.engine,
              history,
              bookmarks: props.bookmarks,
              tabs: props.tabs,
              remote: remoteSuggestions && !privateTab ? remote : NO_REMOTE,
              now: Date.now(),
            })
          : [],
      [
        typed,
        props.engine,
        history,
        props.bookmarks,
        props.tabs,
        remote,
        remoteSuggestions,
        privateTab,
      ],
    );
    const open = typed !== null && suggestions.length > 0;

    const onOpenChange = props.onOpenChange;
    useEffect(() => onOpenChange(open), [open, onOpenChange]);

    // Autocompletar na barra, com o resto selecionado (digitar por cima substitui).
    const { onChange } = props;
    useEffect(() => {
      const input = inputRef.current;
      if (!typed || !allowComplete.current || !input || document.activeElement !== input) return;
      if (input.value !== typed || input.selectionStart !== typed.length) return;
      const completed = inlineCompletion(typed, suggestions);
      if (!completed) return;
      pendingSelection.current = [typed.length, completed.length];
      onChange(completed);
    }, [typed, suggestions, onChange]);

    useLayoutEffect(() => {
      const range = pendingSelection.current;
      const input = inputRef.current;
      if (!range || !input || input.value.length !== range[1]) return;
      pendingSelection.current = null;
      input.setSelectionRange(range[0], range[1]);
    });

    const close = () => {
      setTyped(null);
      setSelected(-1);
    };

    const pick = (suggestion: Suggestion) => {
      close();
      inputRef.current?.blur();
      if (suggestion.kind === "tab" && suggestion.tabId !== undefined) {
        props.onChange(props.currentUrl);
        props.onSwitchTab(suggestion.tabId);
        return;
      }
      props.onSubmit(
        suggestion.kind === "search" || suggestion.kind === "remote"
          ? suggestion.title
          : suggestion.url,
      );
    };

    const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
      const native = event.nativeEvent as InputEvent;
      allowComplete.current = !native.inputType?.startsWith("delete");
      setTyped(event.target.value);
      setSelected(-1);
      props.onChange(event.target.value);
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (!open) return;
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        setSelected((index) => {
          const next = index + delta;
          if (next < -1) return suggestions.length - 1;
          return next >= suggestions.length ? -1 : next;
        });
      } else if (event.key === "Enter" && open && selected >= 0 && suggestions[selected]) {
        event.preventDefault();
        pick(suggestions[selected]!);
      } else if (event.key === "Enter") {
        // O formulário da toolbar abre o texto; a lista fecha junto.
        close();
      } else if (event.key === "Escape") {
        // 1º Esc fecha a lista, 2º volta ao endereço da aba; sem nada disso, segue (fecha
        // o painel aberto).
        if (open) {
          event.preventDefault();
          close();
        } else if (props.value !== props.currentUrl) {
          event.preventDefault();
          props.onChange(props.currentUrl);
          inputRef.current?.select();
        }
      } else if (event.key === "Delete" && event.shiftKey && open && selected >= 0) {
        const target = suggestions[selected];
        if (!target?.removable) return;
        event.preventDefault();
        void store?.deleteUrl(target.url);
        setHistory((list) => list.filter((item) => item.url !== target.url));
      }
    };

    return (
      <>
        <input
          ref={inputRef}
          data-sound="keys"
          value={props.value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onMouseDown={(event) => {
            // 1º clique seleciona o endereço todo (como no Chrome/Comet); com o campo já
            // focado, o clique posiciona o cursor normalmente.
            const input = event.currentTarget;
            if (document.activeElement === input || event.button !== 0) return;
            event.preventDefault();
            input.focus();
            input.select();
          }}
          onBlur={close}
          aria-label="Pesquisar ou digitar endereço"
          placeholder="Pesquisar ou digitar endereço"
          role="combobox"
          aria-autocomplete="both"
          aria-expanded={open}
          aria-controls="omnibox-suggestions"
          aria-activedescendant={open && selected >= 0 ? `omnibox-option-${selected}` : undefined}
          autoComplete="off"
          spellCheck={false}
        />
        {open && (
          <ul
            id="omnibox-suggestions"
            className="omnibox-suggestions"
            role="listbox"
            aria-label="Sugestões"
            // Clique na lista não pode tirar o foco do campo antes do click.
            onMouseDown={(event) => event.preventDefault()}
          >
            {suggestions.map((suggestion, index) => {
              const Icon = ICONS[suggestion.kind];
              return (
                <li
                  key={`${suggestion.kind}-${suggestion.url}-${index}`}
                  id={`omnibox-option-${index}`}
                  role="option"
                  aria-selected={index === selected}
                  className={cn("omnibox-option", index === selected && "selected")}
                  data-kind={suggestion.kind}
                  onMouseEnter={() => setSelected(index)}
                  onClick={() => pick(suggestion)}
                >
                  <OptionIcon icon={suggestion.icon} fallback={Icon} />
                  <span className="omnibox-option-title">{suggestion.title}</span>
                  <span className="omnibox-option-detail">{suggestion.detail}</span>
                  {suggestion.removable && (
                    <button
                      type="button"
                      className="omnibox-option-remove"
                      aria-label={`Remover ${suggestion.title} do histórico`}
                      title="Remover do histórico (Shift+Delete)"
                      onClick={(event) => {
                        event.stopPropagation();
                        void store?.deleteUrl(suggestion.url);
                        setHistory((list) => list.filter((item) => item.url !== suggestion.url));
                      }}
                    >
                      <X />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </>
    );
  },
);

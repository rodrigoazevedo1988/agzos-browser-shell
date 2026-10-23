import { useEffect, useRef, useState } from "react";

/** Item de menu: `sep` separa grupos; `checked` mostra a marca (radio ou alternância). */
export type MenuItem =
  | { sep: true }
  | {
      sep?: false;
      label: string;
      shortcut?: string;
      disabled?: boolean;
      checked?: boolean;
      run: () => void;
    };

export type MenuDef = { id: string; label: string; items: MenuItem[] };

/** Barra de menus do editor (Arquivo, Editar, Formatar, Exibir, Ferramentas). */
export function MenuBar({ menus }: { menus: MenuDef[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const bar = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!bar.current?.contains(event.target as Node)) setOpen(null);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(null);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", key, true);
    };
  }, [open]);

  return (
    <div className="ed-menubar" role="menubar" ref={bar}>
      {menus.map((menu) => (
        <div className="ed-menu" key={menu.id}>
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open === menu.id}
            className="ed-menu-button"
            data-open={open === menu.id || undefined}
            onMouseEnter={() => open && setOpen(menu.id)}
            onClick={() => setOpen(open === menu.id ? null : menu.id)}
          >
            {menu.label}
          </button>
          {open === menu.id && (
            <div className="ed-dropdown" role="menu">
              {menu.items.map((item, index) =>
                item.sep ? (
                  <div className="ed-sep" role="separator" key={`s${index}`} />
                ) : (
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={item.checked === undefined ? undefined : item.checked}
                    key={`${index}-${item.label}`}
                    className="ed-item"
                    disabled={item.disabled}
                    onClick={() => {
                      setOpen(null);
                      item.run();
                    }}
                  >
                    <span className="ed-check" aria-hidden="true">
                      {item.checked ? "✓" : ""}
                    </span>
                    <span className="ed-label">{item.label}</span>
                    {item.shortcut && <kbd>{item.shortcut}</kbd>}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export type AskChoice = "save" | "discard" | "cancel";
export type AskState = {
  title: string;
  text: string;
  buttons: { label: string; value: AskChoice; primary?: boolean }[];
  resolve: (value: AskChoice) => void;
};

/** Pergunta modal (fechar com alterações não gravadas). Esc cancela. */
export function AskDialog({ ask }: { ask: AskState }) {
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        ask.resolve("cancel");
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [ask]);
  return (
    <div className="ed-overlay" role="presentation">
      <div
        className="ed-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="ed-ask-title"
      >
        <h2 id="ed-ask-title">{ask.title}</h2>
        <p>{ask.text}</p>
        <div className="ed-dialog-actions">
          {ask.buttons.map((button) => (
            <button
              type="button"
              key={button.value}
              className={button.primary ? "ed-primary" : undefined}
              onClick={() => ask.resolve(button.value)}
              autoFocus={button.primary}
            >
              {button.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

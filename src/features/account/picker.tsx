import { Plus, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import "./account.css";
import { ProfileAvatar } from "./avatar";
import type { AccountBridge, GoogleProfile } from "./bridge";
import { gridNextIndex } from "./profiles-model";

/** Quantos cards cabem numa linha: os que têm o mesmo topo que o primeiro. */
function columnsOf(items: (HTMLElement | null)[]): number {
  const visible = items.filter((item): item is HTMLElement => item !== null);
  const first = visible[0];
  if (!first) return 1;
  const top = first.offsetTop;
  let columns = 0;
  for (const item of visible) {
    if (item.offsetTop !== top) break;
    columns += 1;
  }
  return Math.max(1, columns);
}

/**
 * Modal "Escolha uma conta" do início (depois da vinheta, só com a conta Agzos logada), no
 * estilo do "Quem está usando o Chrome": um card por perfil, um "Adicionar" e a saída sem
 * perfil. Escolher abre a janela do perfil; "Continuar sem perfil" fica nesta janela.
 * Setas, Home/End movem o foco entre os cards; Esc fecha.
 */
export function ProfilePicker({
  bridge,
  profiles,
  onClose,
}: {
  bridge: AccountBridge;
  profiles: GoogleProfile[];
  onClose: () => void;
}) {
  const [skipNext, setSkipNext] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Um card por perfil e o "Adicionar" no fim.
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const addIndex = profiles.length;

  const finish = () => {
    if (skipNext) void bridge.setPickerOnStart(false);
    onClose();
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  useEffect(() => {
    cardRefs.current[0]?.focus();
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") finishRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pick = (profile: GoogleProfile) => {
    void bridge.openProfile(profile.id);
    finish();
  };
  const add = () => {
    setAdding(true);
    setError(null);
    void bridge
      .addProfile()
      .then((result) => {
        if (result.ok) finish();
        else setError(result.error);
      })
      .finally(() => setAdding(false));
  };

  const onGridKey = (event: KeyboardEvent<HTMLUListElement>) => {
    const cards = cardRefs.current;
    const index = cards.findIndex((card) => card !== null && card === document.activeElement);
    if (index < 0) return;
    const next = gridNextIndex({
      key: event.key,
      index,
      columns: columnsOf(cards),
      count: profiles.length + 1,
    });
    if (next === null) return;
    event.preventDefault();
    cards[next]?.focus();
  };

  return (
    <div className="acct-picker-backdrop" onClick={finish}>
      <section
        className="acct-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="acct-picker-title"
        aria-describedby="acct-picker-desc"
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="acct-picker-x" aria-label="Fechar" onClick={finish}>
          <X />
        </button>
        <header className="acct-picker-head">
          <h2 id="acct-picker-title">Escolha uma conta</h2>
          <p id="acct-picker-desc" className="acct-muted">
            Cada conta Google abre no próprio perfil, numa janela só dela.
          </p>
        </header>
        <div className="acct-picker-body">
          <ul className="acct-picker-grid" aria-label="Contas" onKeyDown={onGridKey}>
            {profiles.map((profile, index) => (
              <li key={profile.id}>
                <button
                  type="button"
                  ref={(element) => {
                    cardRefs.current[index] = element;
                  }}
                  className="acct-pcard"
                  style={{ "--accent": profile.color } as React.CSSProperties}
                  onClick={() => pick(profile)}
                  data-profile={profile.id}
                >
                  <span className="acct-pcard-avatar">
                    <ProfileAvatar profile={profile} size={96} />
                  </span>
                  <span className="acct-pcard-name">{profile.label}</span>
                  <span className="acct-pcard-mail">
                    {profile.email || "Conta ainda não conectada"}
                  </span>
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                ref={(element) => {
                  cardRefs.current[addIndex] = element;
                }}
                className="acct-pcard acct-pcard-add"
                onClick={add}
                disabled={adding}
                data-add="true"
              >
                <span className="acct-pcard-avatar" aria-hidden="true">
                  <Plus />
                </span>
                <span className="acct-pcard-name">Adicionar</span>
                <span className="acct-pcard-mail">Entrar com outra conta Google</span>
              </button>
            </li>
          </ul>
          {error && (
            <p className="acct-picker-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="acct-picker-foot">
          <label className="acct-check">
            <input
              type="checkbox"
              checked={skipNext}
              onChange={(event) => setSkipNext(event.target.checked)}
            />
            Não mostrar ao iniciar
          </label>
          <button type="button" className="acct-link" onClick={finish}>
            Continuar sem perfil
          </button>
        </footer>
      </section>
    </div>
  );
}

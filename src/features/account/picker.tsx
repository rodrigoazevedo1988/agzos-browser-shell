import { ArrowRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import "./account.css";
import { ProfileAvatar } from "./avatar";
import type { AccountBridge, GoogleProfile } from "./bridge";

/**
 * Modal "Escolha uma conta" do início (depois da vinheta, só com a conta Agzos logada):
 * escolher abre a janela do perfil; "Continuar sem perfil" fica nesta janela.
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
  const firstRef = useRef<HTMLButtonElement | null>(null);

  const finish = () => {
    if (skipNext) void bridge.setPickerOnStart(false);
    onClose();
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") finishRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const pick = (profile: GoogleProfile) => {
    void bridge.openProfile(profile.id);
    finish();
  };

  return (
    <div className="acct-picker-backdrop" onClick={finish}>
      <section
        className="acct-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="acct-picker-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="acct-picker-x" aria-label="Fechar" onClick={finish}>
          <X />
        </button>
        <h2 id="acct-picker-title">Escolha uma conta</h2>
        <p className="acct-muted">Cada conta Google abre no próprio perfil, numa janela só dela.</p>
        <ul className="acct-picker-list">
          {profiles.map((profile, index) => (
            <li key={profile.id}>
              <button
                type="button"
                ref={index === 0 ? firstRef : undefined}
                className="acct-picker-row"
                onClick={() => pick(profile)}
                data-profile={profile.id}
              >
                <ProfileAvatar profile={profile} size={38} />
                <span className="acct-picker-text">
                  <strong>{profile.label}</strong>
                  <span>{profile.email || "Conta ainda não conectada"}</span>
                </span>
                <ArrowRight aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        <div className="acct-picker-foot">
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
        </div>
      </section>
    </div>
  );
}

import { Camera, Trash2 } from "lucide-react";
import { useState } from "react";

import "./photo.css";
import type { AccountBridge, AccountState, GoogleProfile } from "./bridge";
import { initialsOf, isPhotoUrl } from "./model";

/** Foto da conta Google (data: do main) ou as iniciais na cor do perfil. */
export function ProfileAvatar({ profile, size = 40 }: { profile: GoogleProfile; size?: number }) {
  return (
    <span
      className="acct-avatar"
      style={{ width: size, height: size, fontSize: size * 0.38, background: profile.color }}
      aria-hidden="true"
    >
      {profile.avatar ? (
        <img src={profile.avatar} alt="" width={size} height={size} />
      ) : (
        initialsOf(profile.name || profile.label || profile.email)
      )}
    </span>
  );
}

/** Foto da Conta Agzos, ou as iniciais de `label` quando não há foto. */
export function PersonAvatar({
  photo,
  label,
  size = 40,
}: {
  photo: string | null | undefined;
  label: string;
  size?: number;
}) {
  const src = isPhotoUrl(photo) ? photo : null;
  return (
    <span
      className="acct-avatar acct-avatar-self"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {src ? <img src={src} alt="" width={size} height={size} /> : initialsOf(label)}
    </span>
  );
}

/**
 * Avatar da conta com "Alterar foto" e "Remover foto" num overlay ao passar o mouse (ou
 * ao focar um dos botões, para o teclado). A troca passa pelo diálogo do main.
 */
export function AccountPhotoEditor({
  bridge,
  state,
  size = 44,
  onNotice,
}: {
  bridge: AccountBridge;
  state: AccountState;
  size?: number;
  onNotice: (text: string) => void;
}) {
  const [busy, setBusy] = useState<"change" | "remove" | null>(null);
  const hasPhoto = isPhotoUrl(state.avatar);

  const change = async () => {
    setBusy("change");
    try {
      const result = await bridge.changeAvatar();
      if (result.ok) onNotice("Foto de perfil atualizada.");
      else if (!result.canceled) onNotice(result.error ?? "Não foi possível trocar a foto.");
    } catch {
      onNotice("Não foi possível trocar a foto. Tente de novo.");
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("remove");
    try {
      const result = await bridge.removeAvatar();
      if (result.ok) onNotice("Foto de perfil removida.");
      else onNotice(result.error);
    } catch {
      onNotice("Não foi possível remover a foto. Tente de novo.");
    } finally {
      setBusy(null);
    }
  };

  const label = state.name || state.email;
  return (
    <div className={`acct-photo${busy ? " is-busy" : ""}`} style={{ width: size, height: size }}>
      <PersonAvatar photo={state.avatar} label={label} size={size} />
      <div className="acct-photo-overlay" aria-busy={busy !== null}>
        <button
          type="button"
          aria-label="Alterar foto"
          title="Alterar foto"
          disabled={busy !== null}
          onClick={() => void change()}
        >
          <Camera aria-hidden="true" />
        </button>
        {hasPhoto && (
          <button
            type="button"
            aria-label="Remover foto"
            title="Remover foto"
            disabled={busy !== null}
            onClick={() => void remove()}
          >
            <Trash2 aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}

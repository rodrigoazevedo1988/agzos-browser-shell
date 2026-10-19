import { UserRound } from "lucide-react";

import "./account.css";
import { ProfileAvatar } from "./avatar";
import type { AccountState, GoogleProfile } from "./bridge";
import { initialsOf } from "./model";

/**
 * Botão da conta na barra: sem login, um ícone; logado, as iniciais; numa janela de
 * perfil Google, a foto/cor do perfil (para saber em qual conta está). Abre agzos://conta.
 */
export function AccountButton({
  state,
  windowProfile,
  onOpen,
}: {
  state: AccountState | null;
  windowProfile: GoogleProfile | null;
  onOpen: () => void;
}) {
  if (!state) return null;
  const label = windowProfile
    ? `Perfil ${windowProfile.label}${windowProfile.email ? ` (${windowProfile.email})` : ""} — Conta Agzos`
    : state.loggedIn
      ? `Conta Agzos: ${state.name || state.email}`
      : "Entrar na Conta Agzos";
  return (
    <button
      type="button"
      className="acct-bar-button"
      title={label}
      aria-label={label}
      data-account={state.loggedIn ? "on" : "off"}
      onClick={onOpen}
    >
      {windowProfile ? (
        <ProfileAvatar profile={windowProfile} size={22} />
      ) : state.loggedIn ? (
        <span className="acct-avatar acct-avatar-self" style={{ width: 22, height: 22 }}>
          {initialsOf(state.name || state.email)}
        </span>
      ) : (
        <UserRound aria-hidden="true" />
      )}
    </button>
  );
}

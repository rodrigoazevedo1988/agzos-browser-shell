import { UserRound } from "lucide-react";

import "./account.css";
import { PersonAvatar, ProfileAvatar } from "./avatar";
import type { AccountState, GoogleProfile } from "./bridge";

/**
 * Botão da conta na barra: sem login, um ícone; logado, a foto (ou as iniciais); numa janela
 * de perfil Google, a foto/cor do perfil (para saber em qual conta está). Abre agzos://conta.
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
        <PersonAvatar photo={state.avatar} label={state.name || state.email} size={22} />
      ) : (
        <UserRound aria-hidden="true" />
      )}
    </button>
  );
}

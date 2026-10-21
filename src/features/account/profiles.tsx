import {
  Check,
  CircleCheck,
  ExternalLink,
  Mail,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import "./account.css";
import { ProfileAvatar } from "./avatar";
import type { AccountBridge, AccountState, GoogleProfile } from "./bridge";
import { PROFILE_COLORS } from "./model";
import { newlyConnected } from "./profiles-model";

type Notice = (text: string) => void;

/** Lista de contas Google na página agzos://conta (criar, abrir, entrar, renomear, remover). */
export function GoogleAccounts({
  bridge,
  state,
  onNotice,
}: {
  bridge: AccountBridge;
  state: AccountState;
  onNotice: Notice;
}) {
  const [adding, setAdding] = useState(false);
  const add = () => {
    setAdding(true);
    void bridge
      .addProfile()
      .then((result) => {
        if (!result.ok) onNotice(result.error);
        else onNotice("Entre na conta Google na janela nova.");
      })
      .finally(() => setAdding(false));
  };
  const connected = state.profiles.filter((profile) => profile.email).length;
  return (
    <>
      <div className="acct-head">
        <div>
          <h2 className="acct-title">Contas Google</h2>
          <p className="acct-muted">
            Cada conta é um perfil isolado: cookies, logins e dados separados, numa janela própria.
            {state.profiles.length > 0 &&
              ` ${connected} de ${state.profiles.length} com conta Google conectada.`}
          </p>
        </div>
        <Button type="button" onClick={add} disabled={adding}>
          <Plus /> Adicionar conta Google
        </Button>
      </div>
      {state.profiles.length === 0 ? (
        <section className="acct-card acct-empty">
          <Users aria-hidden="true" />
          <p>Nenhuma conta Google ainda. Adicione quantas quiser: trabalho, pessoal, clientes…</p>
        </section>
      ) : (
        <ul className="acct-profiles">
          {state.profiles.map((profile) => (
            <ProfileCard key={profile.id} bridge={bridge} profile={profile} onNotice={onNotice} />
          ))}
        </ul>
      )}
      <label className="acct-check acct-card">
        <input
          type="checkbox"
          checked={state.pickerOnStart}
          onChange={(event) => void bridge.setPickerOnStart(event.target.checked)}
        />
        Mostrar “Escolha uma conta” ao iniciar o navegador
      </label>
    </>
  );
}

function ProfileCard({
  bridge,
  profile,
  onNotice,
}: {
  bridge: AccountBridge;
  profile: GoogleProfile;
  onNotice: Notice;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(profile.label);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const connected = Boolean(profile.email);
  const lastUsed = profile.lastUsed
    ? new Date(profile.lastUsed).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
    : "";

  const rename = (event: FormEvent) => {
    event.preventDefault();
    void bridge.updateProfile(profile.id, { label }).then(() => setEditing(false));
  };
  const detect = useCallback(() => {
    setBusy(true);
    void bridge
      .detectProfile(profile.id)
      .then((result) =>
        onNotice(
          result.ok ? "Conta detectada." : "Não achamos uma conta Google logada neste perfil.",
        ),
      )
      .finally(() => setBusy(false));
  }, [bridge, profile.id, onNotice]);

  return (
    <li
      className="acct-card acct-profile"
      data-profile={profile.id}
      style={{ "--accent": profile.color } as CSSProperties}
    >
      <div className="acct-profile-top">
        <ProfileAvatar profile={profile} size={56} />
        <div className="acct-profile-text">
          {editing ? (
            <form onSubmit={rename} className="acct-row">
              <Input
                autoFocus
                maxLength={60}
                value={label}
                aria-label="Nome do perfil"
                onChange={(event) => setLabel(event.target.value)}
              />
              <Button type="submit" size="icon" aria-label="Salvar nome">
                <Check />
              </Button>
            </form>
          ) : (
            <>
              <strong>{profile.label}</strong>
              <span className="acct-profile-email" title={profile.email || undefined}>
                {connected ? profile.email : "Conta ainda não conectada"}
              </span>
            </>
          )}
        </div>
      </div>
      <div className="acct-profile-meta">
        {connected ? (
          <span className="acct-pill acct-pill-ok">
            <CircleCheck aria-hidden="true" /> Conta conectada
          </span>
        ) : (
          <span className="acct-pill">
            <Mail aria-hidden="true" /> Sem conta Google
          </span>
        )}
        {lastUsed && <span className="acct-profile-used">Usado em {lastUsed}</span>}
      </div>
      <div className="acct-profile-color">
        <span className="acct-profile-label" id={`swatch-${profile.id}`}>
          Cor
        </span>
        <div className="acct-swatches" role="radiogroup" aria-labelledby={`swatch-${profile.id}`}>
          {PROFILE_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={profile.color === color}
              aria-label={`Cor ${color}`}
              style={{ background: color }}
              onClick={() => void bridge.updateProfile(profile.id, { color })}
            />
          ))}
        </div>
      </div>
      {removing ? (
        <div className="acct-confirm">
          <p>Remover este perfil apaga cookies, logins e dados dele neste computador.</p>
          <div className="acct-row">
            <Button
              type="button"
              variant="destructive"
              onClick={() =>
                void bridge.removeProfile(profile.id).then(() => onNotice("Perfil removido."))
              }
            >
              <Trash2 /> Remover
            </Button>
            <Button type="button" variant="ghost" onClick={() => setRemoving(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <div className="acct-row acct-actions">
          <Button type="button" onClick={() => void bridge.openProfile(profile.id)}>
            <ExternalLink /> Abrir
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void bridge.signInProfile(profile.id)}
          >
            {connected ? "Trocar conta" : "Entrar no Google"}
          </Button>
          {!connected && (
            <Button type="button" variant="ghost" disabled={busy} onClick={detect}>
              <RefreshCw /> Detectar
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Renomear"
            title="Renomear"
            onClick={() => {
              setLabel(profile.label);
              setEditing(!editing);
            }}
          >
            <Pencil />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Remover"
            title="Remover"
            onClick={() => setRemoving(true)}
          >
            <Trash2 />
          </Button>
        </div>
      )}
    </li>
  );
}

/**
 * Aviso "Conta conectada: e-mail" quando um perfil ganha conta Google (o main relê a conta
 * depois do login dentro da janela do perfil e empurra o estado a todas as janelas).
 */
export function ConnectNotice({ bridge }: { bridge: AccountBridge | null }) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (!bridge) return;
    let previous: GoogleProfile[] | null = null;
    let timer = 0;
    const show = (message: string) => {
      setText(message);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setText(null), 6000);
    };
    const off = bridge.onState((next) => {
      const found = newlyConnected(previous, next.profiles);
      previous = next.profiles;
      const last = found[found.length - 1];
      if (last) show(`Conta conectada: ${last.email}`);
    });
    void bridge
      .state()
      .then((next: AccountState) => {
        if (previous === null) previous = next.profiles;
      })
      .catch(() => {});
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, [bridge]);

  if (!text) return null;
  return (
    <div className="acct-toast" role="status" aria-live="polite">
      <CircleCheck aria-hidden="true" />
      <span>{text}</span>
      <button type="button" aria-label="Fechar aviso" onClick={() => setText(null)}>
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}

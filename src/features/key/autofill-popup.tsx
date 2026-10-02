import {
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  Lock,
  LogIn,
  Plus,
  Search,
  User,
  Wand2,
  X,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import type { VaultEntry } from "@/features/browser/types";
import { searchLogins } from "@/features/browser/vault";

import { generatePassword } from "./password";
import { TotpCode } from "./totp-code";

export type AutofillStatus = "ready" | "locked" | "unpaired" | "loading";

export type QuickLogin = { title: string; username: string; password: string };

/**
 * Popup do Agzos Key para o site aberto. Abre sozinho quando o usuário clica num campo de
 * login (`suggest`) ou pela chave da barra de endereço (`site`). Lista os logins do cofre
 * para o site (preencher, copiar, código MFA), busca no cofre inteiro (o login escolhido
 * passa a ter a URL do site) e salva um login novo na hora — tudo no Agzos Key.
 */
export function AutofillPopup({
  host,
  status,
  mode = "suggest",
  entries,
  vault = [],
  capture = null,
  copied,
  canFill,
  missed = null,
  onCopy,
  onFill,
  onSave,
  onUnlock,
  onOpenVault,
  onClose,
}: {
  /** Site aberto (sem www.). */
  host: string;
  status: AutofillStatus;
  mode?: "suggest" | "site";
  /** Logins que servem para o site. */
  entries: VaultEntry[];
  /** Cofre inteiro (logins), para a busca. */
  vault?: VaultEntry[];
  /** O que o usuário já digitou na página (pré-preenche "salvar login"). */
  capture?: { username: string; password: string } | null;
  copied: string | null;
  /** Só no desktop dá para preencher a página de verdade. */
  canFill: boolean;
  /** Login que não achou campos para preencher na página (o popup avisa). */
  missed?: string | null;
  onCopy: (id: string, value: string) => void;
  /** Preenche (e, se o login não tem URL, guarda a do site no cofre). */
  onFill: (entry: VaultEntry) => void;
  onSave: (login: QuickLogin) => void;
  onUnlock: () => void;
  onOpenVault: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(
    mode === "site" && status === "ready" && entries.length === 0,
  );
  const results = useMemo(
    () =>
      query.trim()
        ? searchLogins(vault, query).filter((entry) => !entries.some((m) => m.id === entry.id))
        : [],
    [vault, query, entries],
  );

  const head = (
    <div className="autofill-head">
      <span className="key-mark">
        <KeyRound aria-hidden="true" />
      </span>
      <div className="autofill-title">
        <strong>Agzos Key</strong>
        <small>{host}</small>
      </div>
      <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar">
        <X />
      </Button>
    </div>
  );

  if (status !== "ready") {
    return (
      <aside className="autofill-popup" data-mode={mode} aria-label="Entrar com o Agzos Key">
        {head}
        <div className="autofill-locked">
          <Lock aria-hidden="true" />
          <p>
            {status === "unpaired"
              ? "Conecte o Agzos Key para preencher os logins deste site."
              : status === "loading"
                ? "Abrindo o cofre…"
                : "Desbloqueie o Agzos Key para preencher os logins deste site."}
          </p>
          {status !== "loading" && (
            <Button size="sm" onClick={onUnlock}>
              {status === "unpaired" ? "Conectar" : "Desbloquear"}
            </Button>
          )}
        </div>
      </aside>
    );
  }

  const item = (entry: VaultEntry, linking: boolean) => (
    <div className="autofill-item" key={entry.id}>
      <div className="autofill-info">
        <strong>{entry.username || entry.title}</strong>
        <small>
          {linking ? (
            <>
              <Link2 aria-hidden="true" /> {entry.title} · vincular a {host}
            </>
          ) : (
            entry.title
          )}
        </small>
        {missed === entry.id && (
          <small className="autofill-miss" role="status">
            Não achei campos de login nesta página. Abra a tela de login ou copie o usuário e a
            senha ao lado.
          </small>
        )}
        {entry.totpSecret && (
          <TotpCode
            secret={entry.totpSecret}
            onCopy={(code) => onCopy(`afa-${entry.id}`, code)}
            copied={copied === `afa-${entry.id}`}
          />
        )}
      </div>
      <div className="autofill-actions">
        {canFill && (
          <Button
            size="sm"
            className="autofill-fill"
            onClick={() => onFill(entry)}
            title={linking ? `Preencher e guardar ${host} neste login` : "Preencher login"}
            aria-label={`Preencher login de ${entry.title}`}
          >
            <LogIn /> Preencher
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onCopy(`afu-${entry.id}`, entry.username ?? "")}
          title="Copiar usuário"
          aria-label={`Copiar usuário de ${entry.title}`}
        >
          {copied === `afu-${entry.id}` ? <Check /> : <User />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onCopy(`afp-${entry.id}`, entry.password ?? "")}
          title="Copiar senha"
          aria-label={`Copiar senha de ${entry.title}`}
        >
          {copied === `afp-${entry.id}` ? <Check /> : <Copy />}
        </Button>
      </div>
    </div>
  );

  return (
    <aside className="autofill-popup" data-mode={mode} aria-label="Entrar com o Agzos Key">
      {head}
      {saving ? (
        <QuickSave
          host={host}
          capture={capture}
          onSave={(login) => {
            onSave(login);
            setSaving(false);
          }}
          onCancel={() => setSaving(false)}
        />
      ) : (
        <>
          <div className="autofill-list">
            {entries.length === 0 && !query && (
              <p className="autofill-empty">Nenhum login salvo para {host}.</p>
            )}
            {entries.map((entry) => item(entry, !entry.url?.trim()))}
            {results.map((entry) => item(entry, !entry.url?.trim()))}
            {query && results.length === 0 && (
              <p className="autofill-empty">Nada encontrado no cofre.</p>
            )}
          </div>
          <label className="autofill-search">
            <Search aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar outro login no cofre"
              aria-label="Buscar login no cofre"
            />
          </label>
          <div className="autofill-foot">
            <button type="button" onClick={() => setSaving(true)}>
              <Plus aria-hidden="true" /> Salvar login deste site
            </button>
            <button type="button" onClick={onOpenVault}>
              Abrir o cofre
            </button>
          </div>
        </>
      )}
    </aside>
  );
}

function QuickSave({
  host,
  capture,
  onSave,
  onCancel,
}: {
  host: string;
  capture: { username: string; password: string } | null;
  onSave: (login: QuickLogin) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(host);
  const [username, setUsername] = useState(capture?.username ?? "");
  const [password, setPassword] = useState(capture?.password ?? "");
  const [show, setShow] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!password && !username) return;
    onSave({ title: title.trim() || host, username: username.trim(), password });
  };

  return (
    <form className="autofill-save" onSubmit={submit}>
      <label className="key-field">
        <span>Nome</span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label className="key-field">
        <span>Usuário ou e-mail</span>
        <input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoFocus={!username}
          aria-label="Usuário"
        />
      </label>
      <label className="key-field">
        <span>Senha</span>
        <div className="key-password">
          <input
            type={show ? "text" : "password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-label="Senha"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setShow((value) => !value)}
            aria-label={show ? "Ocultar senha" : "Mostrar senha"}
          >
            {show ? <EyeOff /> : <Eye />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => {
              setPassword(generatePassword());
              setShow(true);
            }}
            title="Gerar senha forte"
            aria-label="Gerar senha forte"
          >
            <Wand2 />
          </Button>
        </div>
      </label>
      <div className="key-form-actions">
        <Button size="sm" type="submit" disabled={!password && !username}>
          Salvar no Agzos Key
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
          Voltar
        </Button>
      </div>
    </form>
  );
}

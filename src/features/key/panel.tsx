import {
  Check,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  Lock,
  LockOpen,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Unlink,
  Wand2,
  X,
} from "lucide-react";
import { FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import type { KeyState, VaultEntry } from "@/features/browser/types";

function generatePassword() {
  const chars = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*";
  const values = new Uint32Array(18);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => chars[value % chars.length]).join("");
}

/** Rótulo do item (título, ou domínio da URL, ou usuário). */
function labelOf(entry: VaultEntry): string {
  return entry.title || entry.url?.replace(/^https?:\/\//, "") || entry.username || "Credencial";
}

export type KeyPanelProps = {
  state: KeyState;
  entries: VaultEntry[];
  loading: boolean;
  error: string | null;
  copied: string | null;
  onCopy: (id: string, value: string) => void;
  onPair: (code: string) => void;
  onUnlock: (password: string) => void;
  onLock: () => void;
  onUnpair: () => void;
  onAdd: (entry: VaultEntry) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
  onClearError: () => void;
};

function PanelFrame({
  children,
  onClose,
  subtitle,
}: {
  children: React.ReactNode;
  onClose: () => void;
  subtitle: string;
}) {
  return (
    <aside className="key-panel" aria-label="Agzos Key">
      <div className="panel-heading">
        <div className="panel-title">
          <span className="key-mark">
            <KeyRound />
          </span>
          <div>
            <strong>Agzos Key</strong>
            <small>{subtitle}</small>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar cofre">
          <X />
        </Button>
      </div>
      {children}
    </aside>
  );
}

export function KeyPanel(props: KeyPanelProps) {
  const { state, entries, loading, error, copied } = props;

  // 1) Não pareado: pedir o código de pareamento (gerado na sessão do Agzos Key).
  if (!state.paired) {
    return (
      <PanelFrame onClose={props.onClose} subtitle="Conectar ao cofre">
        <PairForm loading={loading} error={error} onPair={props.onPair} />
      </PanelFrame>
    );
  }

  // 2) Pareado mas bloqueado: pedir a senha mestra.
  if (!state.unlocked) {
    return (
      <PanelFrame onClose={props.onClose} subtitle={state.accountEmail ?? "Cofre bloqueado"}>
        <UnlockForm
          loading={loading}
          error={error}
          onUnlock={props.onUnlock}
          onUnpair={props.onUnpair}
        />
      </PanelFrame>
    );
  }

  // 3) Desbloqueado: lista das credenciais.
  return (
    <PanelFrame onClose={props.onClose} subtitle={state.accountEmail ?? "Cofre sincronizado"}>
      <Vault {...props} entries={entries} copied={copied} />
    </PanelFrame>
  );
}

function PairForm({
  loading,
  error,
  onPair,
}: {
  loading: boolean;
  error: string | null;
  onPair: (code: string) => void;
}) {
  const [code, setCode] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (code.trim()) onPair(code.trim());
  }
  return (
    <form className="key-form key-connect" onSubmit={submit}>
      <p className="key-hint">
        Abra o Agzos Key, gere um código de pareamento e cole aqui para conectar este navegador ao
        seu cofre.
      </p>
      <label>
        <span>Código de pareamento</span>
        <input
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          placeholder="XXXX-XXXX"
          aria-label="Código de pareamento"
          autoFocus
        />
      </label>
      {error && (
        <small className="form-error" role="alert">
          Não foi possível parear. Verifique o código e tente de novo.
        </small>
      )}
      <Button size="sm" type="submit" disabled={loading || !code.trim()}>
        <Link2 /> {loading ? "Conectando…" : "Conectar"}
      </Button>
    </form>
  );
}

function UnlockForm({
  loading,
  error,
  onUnlock,
  onUnpair,
}: {
  loading: boolean;
  error: string | null;
  onUnlock: (password: string) => void;
  onUnpair: () => void;
}) {
  const [password, setPassword] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (password) onUnlock(password);
  }
  return (
    <form className="key-form key-unlock" onSubmit={submit}>
      <p className="key-hint">
        Digite sua senha mestra para desbloquear o cofre neste dispositivo.
      </p>
      <label>
        <span>Senha mestra</span>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="••••••••"
          aria-label="Senha mestra"
          autoFocus
        />
      </label>
      {error && (
        <small className="form-error" role="alert">
          Senha mestra incorreta.
        </small>
      )}
      <div className="key-form-actions">
        <Button size="sm" type="submit" disabled={loading || !password}>
          <LockOpen /> {loading ? "Abrindo…" : "Desbloquear"}
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={onUnpair}>
          <Unlink /> Desconectar
        </Button>
      </div>
    </form>
  );
}

function Vault(props: KeyPanelProps) {
  const { entries, copied } = props;
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");

  const filtered = entries.filter((item) =>
    `${labelOf(item)} ${item.username ?? ""}`.toLowerCase().includes(query.toLowerCase()),
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !password.trim()) return;
    const clean = title.trim().replace(/^https?:\/\//, "");
    const entry: VaultEntry = {
      id: crypto.randomUUID(),
      title: clean,
      username: user.trim(),
      password,
      category: "Login",
      updatedAt: Date.now(),
    };
    if (/\./.test(clean)) entry.url = `https://${clean}`;
    props.onAdd(entry);
    setTitle("");
    setUser("");
    setPassword("");
    setAdding(false);
  }

  return (
    <>
      <div className="key-search">
        <Search />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar credencial"
          aria-label="Buscar credencial"
        />
      </div>
      <div className="key-domain">
        <span>Credenciais salvas</span>
        <ChevronDown />
      </div>
      <div className="credential-list">
        {filtered.length === 0 && <p className="key-empty">Nenhuma credencial encontrada.</p>}
        {filtered.map((item) => (
          <div className="credential" key={item.id}>
            <div className="domain-icon">{labelOf(item).charAt(0).toUpperCase()}</div>
            <div className="credential-copy">
              <strong>{labelOf(item)}</strong>
              <span>{visible === item.id ? (item.password ?? "") : (item.username ?? "")}</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setVisible((value) => (value === item.id ? null : item.id))}
              title="Mostrar senha"
              aria-label={`Mostrar senha de ${labelOf(item)}`}
            >
              {visible === item.id ? <EyeOff /> : <Eye />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => props.onCopy(item.id, item.password ?? "")}
              title={`Copiar senha de ${labelOf(item)}`}
              aria-label={`Copiar senha de ${labelOf(item)}`}
            >
              {copied === item.id ? <Check /> : <Copy />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => props.onRemove(item.id)}
              title="Excluir"
              aria-label={`Excluir credencial de ${labelOf(item)}`}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
      </div>
      {adding ? (
        <form className="key-form" onSubmit={submit}>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="site.com ou nome"
            aria-label="Título ou domínio"
          />
          <input
            value={user}
            onChange={(event) => setUser(event.target.value)}
            placeholder="usuário ou e-mail"
            aria-label="Usuário"
          />
          <div className="key-password">
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="senha"
              aria-label="Senha"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setPassword(generatePassword())}
              title="Gerar senha forte"
              aria-label="Gerar senha forte"
            >
              <Wand2 />
            </Button>
          </div>
          <div className="key-form-actions">
            <Button size="sm" type="submit">
              Salvar
            </Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setAdding(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      ) : (
        <div className="settings-actions key-actions">
          <Button variant="outline" size="sm" className="text-xs" onClick={() => setAdding(true)}>
            <Plus /> Nova credencial
          </Button>
          <Button variant="ghost" size="sm" className="text-xs" onClick={props.onLock}>
            <Lock /> Bloquear
          </Button>
        </div>
      )}
      <div className="key-footer">
        <ShieldCheck />
        <span>Sincronizado e cifrado de ponta a ponta</span>
      </div>
    </>
  );
}

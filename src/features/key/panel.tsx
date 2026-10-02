import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  FolderPlus,
  KeyRound,
  Link2,
  Lock,
  LockOpen,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Star,
  Trash2,
  Unlink,
  Wand2,
  X,
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import type { KeyState, VaultEntry } from "@/features/browser/types";
import { isValidTotpSecret, normalizeTotpSecret } from "@/features/browser/totp";
import { categoryOf, groupByCategory, knownCategories } from "@/features/browser/vault";

import { generatePassword } from "./password";
import { TotpCode } from "./totp-code";

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

  // 3) Desbloqueado: lista das credenciais agrupadas por categoria.
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
          {error === "unsupported_kdf"
            ? "Este cofre usa uma proteção (Argon2) ainda não suportada aqui. Atualize o Agzos Key ou use o app do cofre."
            : "Senha mestra incorreta."}
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

type EditorValue = {
  id?: string;
  title: string;
  username: string;
  password: string;
  category: string;
  totpSecret: string;
  favorite: boolean;
};

function Vault(props: KeyPanelProps) {
  const { entries, copied } = props;
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState<string | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [editor, setEditor] = useState<EditorValue | null>(null);

  const categories = useMemo(() => knownCategories(entries), [entries]);

  const filtered = entries.filter((item) => {
    const matchesQuery = `${labelOf(item)} ${item.username ?? ""} ${categoryOf(item)}`
      .toLowerCase()
      .includes(query.toLowerCase());
    const matchesFilter = !filter || categoryOf(item) === filter;
    return matchesQuery && matchesFilter;
  });
  const groups = useMemo(() => groupByCategory(filtered), [filtered]);

  function startAdd() {
    setEditor({
      title: "",
      username: "",
      password: "",
      category: filter ?? "Pessoal",
      totpSecret: "",
      favorite: false,
    });
  }
  function startEdit(entry: VaultEntry) {
    setEditor({
      id: entry.id,
      title: entry.title,
      username: entry.username ?? "",
      password: entry.password ?? "",
      category: categoryOf(entry),
      totpSecret: entry.totpSecret ?? "",
      favorite: Boolean(entry.favorite),
    });
  }

  function save(value: EditorValue) {
    const clean = value.title.trim().replace(/^https?:\/\//, "");
    if (!clean) return;
    const existing = value.id ? entries.find((item) => item.id === value.id) : undefined;
    const entry: VaultEntry = {
      ...existing,
      id: value.id ?? crypto.randomUUID(),
      type: "login",
      title: clean,
      username: value.username.trim(),
      password: value.password,
      category: value.category.trim() || "Pessoal",
      favorite: value.favorite,
      updatedAt: Date.now(),
    };
    const totp = normalizeTotpSecret(value.totpSecret);
    if (totp) entry.totpSecret = totp;
    else delete entry.totpSecret;
    if (/\./.test(clean)) entry.url = existing?.url ?? `https://${clean}`;
    props.onAdd(entry);
    setEditor(null);
  }

  if (editor) {
    return (
      <CredentialEditor
        value={editor}
        categories={categories}
        onChange={setEditor}
        onSave={save}
        onCancel={() => setEditor(null)}
      />
    );
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

      <div className="key-filters" role="tablist" aria-label="Filtrar por categoria">
        <button
          type="button"
          role="tab"
          aria-selected={filter === null}
          className={`key-chip ${filter === null ? "active" : ""}`}
          onClick={() => setFilter(null)}
        >
          Todas
        </button>
        {categories.map((category) => (
          <button
            key={category}
            type="button"
            role="tab"
            aria-selected={filter === category}
            className={`key-chip ${filter === category ? "active" : ""}`}
            onClick={() => setFilter((value) => (value === category ? null : category))}
          >
            {category}
          </button>
        ))}
      </div>

      <div className="credential-list">
        {groups.length === 0 && <p className="key-empty">Nenhuma credencial encontrada.</p>}
        {groups.map((group) => {
          const isCollapsed = collapsed[group.category];
          return (
            <section className="key-group" key={group.category}>
              <button
                type="button"
                className="key-group-head"
                aria-expanded={!isCollapsed}
                onClick={() =>
                  setCollapsed((value) => ({ ...value, [group.category]: !value[group.category] }))
                }
              >
                {isCollapsed ? <ChevronRight /> : <ChevronDown />}
                <span>{group.category}</span>
                <small>{group.items.length}</small>
              </button>
              {!isCollapsed &&
                group.items.map((item) => (
                  <div className="credential" key={item.id}>
                    <div className="domain-icon">{labelOf(item).charAt(0).toUpperCase()}</div>
                    <div className="credential-copy">
                      <strong>
                        {item.favorite && (
                          <Star className="credential-star" aria-label="Favorito" />
                        )}
                        {labelOf(item)}
                      </strong>
                      <span>
                        {visible === item.id ? (item.password ?? "") : (item.username ?? "")}
                      </span>
                      {item.totpSecret && (
                        <TotpCode
                          secret={item.totpSecret}
                          onCopy={(code) => props.onCopy(`totp-${item.id}`, code)}
                          copied={copied === `totp-${item.id}`}
                        />
                      )}
                    </div>
                    <div className="credential-actions">
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
                        onClick={() => startEdit(item)}
                        title="Editar"
                        aria-label={`Editar credencial de ${labelOf(item)}`}
                      >
                        <Pencil />
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
                  </div>
                ))}
            </section>
          );
        })}
      </div>

      <div className="settings-actions key-actions">
        <Button variant="outline" size="sm" className="text-xs" onClick={startAdd}>
          <Plus /> Nova credencial
        </Button>
        <Button variant="ghost" size="sm" className="text-xs" onClick={props.onLock}>
          <Lock /> Bloquear
        </Button>
      </div>

      <div className="key-footer">
        <ShieldCheck />
        <span>Sincronizado e cifrado de ponta a ponta</span>
      </div>
    </>
  );
}

function CredentialEditor({
  value,
  categories,
  onChange,
  onSave,
  onCancel,
}: {
  value: EditorValue;
  categories: string[];
  onChange: (value: EditorValue) => void;
  onSave: (value: EditorValue) => void;
  onCancel: () => void;
}) {
  const [newCategory, setNewCategory] = useState("");
  const totpInvalid = value.totpSecret.trim() !== "" && !isValidTotpSecret(value.totpSecret);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (totpInvalid) return;
    onSave(value);
  }

  return (
    <form className="key-form key-editor" onSubmit={submit}>
      <p className="key-editor-title">{value.id ? "Editar credencial" : "Nova credencial"}</p>
      <label className="key-field">
        <span>Site ou nome</span>
        <input
          value={value.title}
          onChange={(event) => onChange({ ...value, title: event.target.value })}
          placeholder="site.com ou nome"
          aria-label="Título ou domínio"
          autoFocus
        />
      </label>
      <label className="key-field">
        <span>Usuário ou e-mail</span>
        <input
          value={value.username}
          onChange={(event) => onChange({ ...value, username: event.target.value })}
          placeholder="usuário ou e-mail"
          aria-label="Usuário"
        />
      </label>
      <label className="key-field">
        <span>Senha</span>
        <div className="key-password">
          <input
            value={value.password}
            onChange={(event) => onChange({ ...value, password: event.target.value })}
            placeholder="senha"
            aria-label="Senha"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onChange({ ...value, password: generatePassword() })}
            title="Gerar senha forte"
            aria-label="Gerar senha forte"
          >
            <Wand2 />
          </Button>
        </div>
      </label>

      <label className="key-field">
        <span>Categoria</span>
        <div className="key-category-row">
          <select
            value={value.category}
            onChange={(event) => onChange({ ...value, category: event.target.value })}
            aria-label="Categoria"
          >
            {[...new Set([value.category, ...categories])].map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
          <input
            value={newCategory}
            onChange={(event) => setNewCategory(event.target.value)}
            placeholder="nova categoria"
            aria-label="Nova categoria"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={!newCategory.trim()}
            onClick={() => {
              const name = newCategory.trim();
              if (name) {
                onChange({ ...value, category: name });
                setNewCategory("");
              }
            }}
            title="Usar nova categoria"
            aria-label="Usar nova categoria"
          >
            <FolderPlus />
          </Button>
        </div>
      </label>

      <label className="key-field">
        <span>Chave MFA (TOTP) — opcional</span>
        <input
          value={value.totpSecret}
          onChange={(event) => onChange({ ...value, totpSecret: event.target.value })}
          placeholder="segredo Base32 ou otpauth://"
          aria-label="Chave MFA"
          aria-invalid={totpInvalid}
        />
      </label>
      {totpInvalid && (
        <small className="form-error" role="alert">
          Chave MFA inválida (esperado Base32 ou URI otpauth://).
        </small>
      )}

      <label className="key-check">
        <input
          type="checkbox"
          checked={value.favorite}
          onChange={(event) => onChange({ ...value, favorite: event.target.checked })}
        />
        <span>Marcar como favorito</span>
      </label>

      <div className="key-form-actions">
        <Button size="sm" type="submit" disabled={!value.title.trim() || totpInvalid}>
          Salvar
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

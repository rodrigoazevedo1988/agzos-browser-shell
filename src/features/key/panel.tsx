import {
  Check,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import type { Credential } from "@/features/browser/types";

function generatePassword() {
  const chars = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*";
  const values = new Uint32Array(18);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => chars[value % chars.length]).join("");
}

export function KeyPanel({
  credentials,
  copied,
  onCopy,
  onAdd,
  onRemove,
  onClose,
}: {
  credentials: Credential[];
  copied: string | null;
  onCopy: (id: string, value: string) => void;
  onAdd: (item: Credential) => void;
  onRemove: (domain: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [domain, setDomain] = useState("");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");

  const filtered = credentials.filter((item) =>
    `${item.domain} ${item.user}`.toLowerCase().includes(query.toLowerCase()),
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!domain.trim() || !password.trim()) return;
    onAdd({ domain: domain.trim().replace(/^https?:\/\//, ""), user: user.trim(), password });
    setDomain("");
    setUser("");
    setPassword("");
    setAdding(false);
  }

  return (
    <aside className="key-panel" aria-label="Agzos Key">
      <div className="panel-heading">
        <div className="panel-title">
          <span className="key-mark">
            <KeyRound />
          </span>
          <div>
            <strong>Agzos Key</strong>
            <small>Cofre local</small>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar cofre">
          <X />
        </Button>
      </div>
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
          <div className="credential" key={item.domain}>
            <div className="domain-icon">{item.domain.charAt(0).toUpperCase()}</div>
            <div className="credential-copy">
              <strong>{item.domain}</strong>
              <span>{visible === item.domain ? item.password : item.user}</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setVisible((value) => (value === item.domain ? null : item.domain))}
              title="Mostrar senha"
              aria-label={`Mostrar senha de ${item.domain}`}
            >
              {visible === item.domain ? <EyeOff /> : <Eye />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onCopy(item.domain, item.password)}
              title={`Copiar senha de ${item.domain}`}
              aria-label={`Copiar senha de ${item.domain}`}
            >
              {copied === item.domain ? <Check /> : <Copy />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onRemove(item.domain)}
              title="Excluir"
              aria-label={`Excluir credencial de ${item.domain}`}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
      </div>
      {adding ? (
        <form className="key-form" onSubmit={submit}>
          <input
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
            placeholder="site.com"
            aria-label="Domínio"
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
        <div className="settings-actions">
          <Button variant="outline" size="sm" className="text-xs" onClick={() => setAdding(true)}>
            <Plus /> Nova credencial
          </Button>
        </div>
      )}
      <div className="key-footer">
        <ShieldCheck />
        <span>Criptografado neste dispositivo</span>
      </div>
    </aside>
  );
}

import {
  Check,
  Copy,
  Crown,
  Download,
  ExternalLink,
  KeyRound,
  LayoutGrid,
  Lock,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import { Children, useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import "./account.css";
import { ProfileAvatar } from "./avatar";
import type { AccountBridge, AccountState, AgzosService, GoogleProfile } from "./bridge";
import {
  PROFILE_COLORS,
  emailProblem,
  initialsOf,
  passwordProblem,
  passwordStrength,
  planLabel,
  recoveryCodesFileName,
  recoveryCodesText,
} from "./model";

/** O que a página usa do desktop (copiar e "Salvar como"). */
export type AccountDesktop = {
  clipboardWrite(text: string): Promise<void>;
  saveFile(payload: {
    name: string;
    data: string | ArrayBuffer;
    filters?: { name: string; extensions: string[] }[];
  }): Promise<{ ok: boolean; path?: string; canceled?: boolean }>;
};

type Notice = (text: string) => void;

/** agzos://conta: entrar, criar conta, recuperar senha e a área logada. */
export function AccountPage({
  bridge,
  state,
  desktop,
  onNotice,
}: {
  bridge: AccountBridge | null;
  state: AccountState | null;
  desktop: AccountDesktop | null;
  onNotice: Notice;
}) {
  // Códigos recém-gerados (cadastro ou "gerar novos"): ficam na tela até o usuário
  // confirmar que guardou. Nunca são gravados.
  const [codes, setCodes] = useState<string[] | null>(null);

  if (!bridge) {
    return (
      <div className="acct-page">
        <section className="acct-card acct-narrow">
          <Brand />
          <p className="acct-muted">
            A Conta Agzos e as contas Google ficam no Agzos Browser para computador.
          </p>
        </section>
      </div>
    );
  }
  if (!state) return <p className="library-empty">Carregando a conta…</p>;

  if (codes) {
    return (
      <div className="acct-page">
        <RecoveryCodes
          codes={codes}
          email={state.email}
          desktop={desktop}
          onNotice={onNotice}
          onDone={() => setCodes(null)}
        />
      </div>
    );
  }

  return (
    <div className="acct-page">
      {state.loggedIn ? (
        <LoggedIn bridge={bridge} state={state} onCodes={setCodes} onNotice={onNotice} />
      ) : (
        <LoggedOut bridge={bridge} state={state} onCodes={setCodes} />
      )}
    </div>
  );
}

function Brand({ subtitle }: { subtitle?: string }) {
  return (
    <header className="acct-brand">
      <span className="acct-brand-mark" aria-hidden="true">
        <ShieldCheck />
      </span>
      <div>
        <h1>Conta Agzos</h1>
        <p>{subtitle ?? "Agzos Group"}</p>
      </div>
    </header>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string | null;
  children: ReactNode;
}) {
  // Só o campo fica dentro do <label>: a dica e a barra de força não entram no nome dele.
  const [input, ...extra] = Children.toArray(children);
  return (
    <div className="acct-field">
      <label>
        <span>{label}</span>
        {input}
      </label>
      {extra}
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p className="acct-error" role="alert">
      {error}
    </p>
  ) : null;
}

function Strength({ password }: { password: string }) {
  const score = passwordStrength(password);
  const labels = ["", "Fraca", "Razoável", "Boa", "Forte"];
  return (
    <span className="acct-strength" data-score={score} aria-live="polite">
      <i />
      <i />
      <i />
      <i />
      <em>{labels[score]}</em>
    </span>
  );
}

// --- Fora da conta ---

type Mode = "login" | "signup" | "recover";

function LoggedOut({
  bridge,
  state,
  onCodes,
}: {
  bridge: AccountBridge;
  state: AccountState;
  onCodes: (codes: string[]) => void;
}) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [done, setDone] = useState<string | null>(null);

  return (
    <section className="acct-card acct-narrow">
      <Brand subtitle="Uma conta para os serviços do Agzos Group" />
      {state.available === false && (
        <p className="acct-warn">
          Este computador não tem um chaveiro do sistema disponível. O Agzos não guarda o login da
          conta sem ele.
        </p>
      )}
      {state.lockedProfiles > 0 && (
        <p className="acct-info">
          <Lock aria-hidden="true" />
          {state.lockedProfiles === 1
            ? "1 conta Google guardada. Entre para usá-la."
            : `${state.lockedProfiles} contas Google guardadas. Entre para usá-las.`}
        </p>
      )}
      <div className="acct-tabs" role="tablist" aria-label="Conta Agzos">
        {(
          [
            ["login", "Entrar"],
            ["signup", "Criar conta"],
            ["recover", "Recuperar senha"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            className={mode === id ? "active" : ""}
            onClick={() => {
              setMode(id);
              setDone(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {done && (
        <p className="acct-success" role="status">
          {done}
        </p>
      )}
      {mode === "login" && (
        <LoginForm
          bridge={bridge}
          email={email}
          setEmail={setEmail}
          onForgot={() => setMode("recover")}
        />
      )}
      {mode === "signup" && (
        <SignupForm bridge={bridge} email={email} setEmail={setEmail} onCodes={onCodes} />
      )}
      {mode === "recover" && (
        <RecoverForm
          bridge={bridge}
          email={email}
          setEmail={setEmail}
          onDone={(left) => {
            setMode("login");
            setDone(
              `Senha redefinida. Entre com a senha nova.${
                left !== null ? ` Restam ${left} códigos de recuperação.` : ""
              }`,
            );
          }}
        />
      )}
    </section>
  );
}

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (work: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    try {
      setError(await work());
    } catch {
      setError("Algo deu errado. Tente de novo.");
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

function LoginForm({
  bridge,
  email,
  setEmail,
  onForgot,
}: {
  bridge: AccountBridge;
  email: string;
  setEmail: (value: string) => void;
  onForgot: () => void;
}) {
  const [password, setPassword] = useState("");
  const { busy, error, run } = useSubmit();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const result = await bridge.login({ email: email.trim(), password });
      if (!result.ok) return result.error;
      setPassword("");
      return null;
    });
  };
  return (
    <form className="acct-form" onSubmit={submit} aria-label="Entrar">
      <Field label="E-mail">
        <Input
          type="email"
          name="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </Field>
      <Field label="Senha">
        <Input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </Field>
      <ErrorLine error={error} />
      <Button type="submit" disabled={busy}>
        {busy ? "Entrando…" : "Entrar"}
      </Button>
      <button type="button" className="acct-link" onClick={onForgot}>
        Esqueci a senha
      </button>
    </form>
  );
}

function SignupForm({
  bridge,
  email,
  setEmail,
  onCodes,
}: {
  bridge: AccountBridge;
  email: string;
  setEmail: (value: string) => void;
  onCodes: (codes: string[]) => void;
}) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const { busy, error, run } = useSubmit();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      if (!name.trim()) return "Informe seu nome.";
      const problem = emailProblem(email) ?? passwordProblem(password, email);
      if (problem) return problem;
      if (password !== confirm) return "As senhas não são iguais.";
      const result = await bridge.signup({ name: name.trim(), email: email.trim(), password });
      if (!result.ok) return result.error;
      onCodes(result.recoveryCodes);
      return null;
    });
  };
  return (
    <form className="acct-form" onSubmit={submit} aria-label="Criar conta">
      <Field label="Nome">
        <Input
          name="name"
          autoComplete="name"
          maxLength={80}
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <Field label="E-mail">
        <Input
          type="email"
          name="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </Field>
      <Field label="Senha" hint="Pelo menos 10 caracteres. Uma frase longa vale mais que símbolos.">
        <Input
          type="password"
          name="new-password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <Strength password={password} />
      </Field>
      <Field label="Confirmar senha">
        <Input
          type="password"
          name="confirm-password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
        />
      </Field>
      <ErrorLine error={error} />
      <Button type="submit" disabled={busy}>
        {busy ? "Criando…" : "Criar conta"}
      </Button>
      <p className="acct-muted acct-small">
        Nesta versão a senha não é recuperada por e-mail: ao criar a conta você recebe 8 códigos de
        recuperação de uso único.
      </p>
    </form>
  );
}

function RecoverForm({
  bridge,
  email,
  setEmail,
  onDone,
}: {
  bridge: AccountBridge;
  email: string;
  setEmail: (value: string) => void;
  onDone: (codesLeft: number | null) => void;
}) {
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const { busy, error, run } = useSubmit();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const problem = emailProblem(email) ?? passwordProblem(password, email);
      if (problem) return problem;
      if (password !== confirm) return "As senhas não são iguais.";
      const result = await bridge.recover({
        email: email.trim(),
        recoveryCode: code.trim(),
        newPassword: password,
      });
      if (!result.ok) return result.error;
      onDone(result.recoveryCodesLeft);
      return null;
    });
  };
  return (
    <form className="acct-form" onSubmit={submit} aria-label="Recuperar senha">
      <p className="acct-muted acct-small">
        Use um dos códigos de recuperação que você guardou ao criar a conta. Cada código vale uma
        vez; ao redefinir, todas as sessões abertas saem.
      </p>
      <Field label="E-mail">
        <Input
          type="email"
          name="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </Field>
      <Field label="Código de recuperação">
        <Input
          name="recovery-code"
          autoComplete="one-time-code"
          placeholder="XXXXX-XXXXX"
          spellCheck={false}
          required
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
      </Field>
      <Field label="Nova senha">
        <Input
          type="password"
          name="new-password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <Strength password={password} />
      </Field>
      <Field label="Confirmar nova senha">
        <Input
          type="password"
          name="confirm-password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
        />
      </Field>
      <ErrorLine error={error} />
      <Button type="submit" disabled={busy}>
        {busy ? "Redefinindo…" : "Redefinir senha"}
      </Button>
    </form>
  );
}

// --- Códigos de recuperação (uma vez) ---

function RecoveryCodes({
  codes,
  email,
  desktop,
  onNotice,
  onDone,
}: {
  codes: string[];
  email: string;
  desktop: AccountDesktop | null;
  onNotice: Notice;
  onDone: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const text = recoveryCodesText(codes, email);
  const copy = () => {
    const write = desktop
      ? desktop.clipboardWrite(text)
      : (navigator.clipboard?.writeText(text) ?? Promise.reject(new Error("clipboard")));
    void write.then(
      () => onNotice("Códigos copiados."),
      () => onNotice("Não foi possível copiar."),
    );
  };
  const download = () => {
    if (!desktop) return;
    void desktop
      .saveFile({
        name: recoveryCodesFileName(),
        data: text,
        filters: [{ name: "Texto", extensions: ["txt"] }],
      })
      .then((result) => result.ok && onNotice("Códigos salvos."));
  };
  return (
    <section className="acct-card acct-narrow" aria-labelledby="acct-codes-title">
      <span className="acct-brand-mark" aria-hidden="true">
        <KeyRound />
      </span>
      <h2 id="acct-codes-title">Guarde seus códigos de recuperação</h2>
      <p className="acct-muted">
        Eles são a única forma de redefinir a senha nesta versão. Cada código vale uma vez. Esta é a
        única vez em que eles aparecem.
      </p>
      <ol className="acct-codes" data-testid="recovery-codes">
        {codes.map((code) => (
          <li key={code}>
            <code>{code}</code>
          </li>
        ))}
      </ol>
      <div className="acct-row">
        <Button type="button" variant="outline" onClick={copy}>
          <Copy /> Copiar
        </Button>
        <Button type="button" variant="outline" onClick={download} disabled={!desktop}>
          <Download /> Baixar .txt
        </Button>
      </div>
      <label className="acct-check">
        <input
          type="checkbox"
          checked={saved}
          onChange={(event) => setSaved(event.target.checked)}
        />
        Guardei os códigos num lugar seguro
      </label>
      <Button type="button" disabled={!saved} onClick={onDone}>
        Continuar
      </Button>
    </section>
  );
}

// --- Área logada ---

type Section = "account" | "google" | "services" | "premium";
const SECTIONS: { id: Section; label: string; icon: typeof UserRound }[] = [
  { id: "account", label: "Minha conta", icon: UserRound },
  { id: "google", label: "Contas Google", icon: Users },
  { id: "services", label: "Serviços Agzos", icon: LayoutGrid },
  { id: "premium", label: "Premium", icon: Crown },
];

function LoggedIn({
  bridge,
  state,
  onCodes,
  onNotice,
}: {
  bridge: AccountBridge;
  state: AccountState;
  onCodes: (codes: string[]) => void;
  onNotice: Notice;
}) {
  const [section, setSection] = useState<Section>("account");
  return (
    <div className="acct-shell">
      <aside className="acct-side">
        <div className="acct-me">
          <span className="acct-avatar acct-avatar-self" style={{ width: 44, height: 44 }}>
            {initialsOf(state.name || state.email)}
          </span>
          <div>
            <strong>{state.name}</strong>
            <span>{state.email}</span>
          </div>
        </div>
        <span className={`acct-plan acct-plan-${state.plan}`}>Plano {planLabel(state.plan)}</span>
        <nav aria-label="Conta Agzos">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={section === id ? "active" : ""}
              aria-current={section === id ? "page" : undefined}
              onClick={() => setSection(id)}
            >
              <Icon aria-hidden="true" />
              {label}
              {id === "google" && state.profiles.length > 0 && <em>{state.profiles.length}</em>}
            </button>
          ))}
        </nav>
      </aside>
      <main className="acct-main">
        {section === "account" && (
          <MyAccount bridge={bridge} state={state} onCodes={onCodes} onNotice={onNotice} />
        )}
        {section === "google" && (
          <GoogleAccounts bridge={bridge} state={state} onNotice={onNotice} />
        )}
        {section === "services" && (
          <Services bridge={bridge} onPremium={() => setSection("premium")} />
        )}
        {section === "premium" && <Premium plan={state.plan} />}
      </main>
    </div>
  );
}

function MyAccount({
  bridge,
  state,
  onCodes,
  onNotice,
}: {
  bridge: AccountBridge;
  state: AccountState;
  onCodes: (codes: string[]) => void;
  onNotice: Notice;
}) {
  const [codesLeft, setCodesLeft] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    void bridge.me().then((result) => alive && result.ok && setCodesLeft(result.recoveryCodesLeft));
    return () => {
      alive = false;
    };
  }, [bridge]);

  return (
    <>
      <h2 className="acct-title">Minha conta</h2>
      <section className="acct-card">
        <dl className="acct-facts">
          <div>
            <dt>Nome</dt>
            <dd>{state.name}</dd>
          </div>
          <div>
            <dt>E-mail</dt>
            <dd>{state.email}</dd>
          </div>
          <div>
            <dt>Plano</dt>
            <dd>{planLabel(state.plan)}</dd>
          </div>
          <div>
            <dt>Códigos de recuperação</dt>
            <dd>{codesLeft === null ? "—" : `${codesLeft} de 8 disponíveis`}</dd>
          </div>
        </dl>
        <Button
          type="button"
          variant="outline"
          onClick={() => void bridge.logout().then(() => onNotice("Você saiu da Conta Agzos."))}
        >
          <LogOut /> Sair
        </Button>
      </section>
      <ChangePassword bridge={bridge} email={state.email} onNotice={onNotice} />
      <PasswordAction
        title="Gerar novos códigos de recuperação"
        description="Os códigos antigos deixam de valer. Os novos aparecem uma vez só."
        button="Gerar novos códigos"
        icon={<RefreshCw />}
        onConfirm={async (password) => {
          const result = await bridge.regenerateCodes({ password });
          if (!result.ok) return result.error;
          onCodes(result.recoveryCodes);
          return null;
        }}
      />
      <PasswordAction
        title="Excluir conta"
        description="Apaga a Conta Agzos no servidor. As contas Google guardadas neste computador ficam travadas até você entrar em outra conta."
        button="Excluir conta"
        danger
        confirmWord="EXCLUIR"
        icon={<Trash2 />}
        onConfirm={async (password) => {
          const result = await bridge.deleteAccount({ password });
          if (!result.ok) return result.error;
          onNotice("Conta excluída.");
          return null;
        }}
      />
    </>
  );
}

function ChangePassword({
  bridge,
  email,
  onNotice,
}: {
  bridge: AccountBridge;
  email: string;
  onNotice: Notice;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const { busy, error, run } = useSubmit();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const problem = passwordProblem(next, email);
      if (problem) return problem;
      if (next !== confirm) return "As senhas não são iguais.";
      const result = await bridge.changePassword({ currentPassword: current, newPassword: next });
      if (!result.ok) return result.error;
      setCurrent("");
      setNext("");
      setConfirm("");
      onNotice("Senha trocada. As outras sessões saíram.");
      return null;
    });
  };
  return (
    <section className="acct-card">
      <h3>Trocar senha</h3>
      <form className="acct-form acct-grid" onSubmit={submit} aria-label="Trocar senha">
        <Field label="Senha atual">
          <Input
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
        </Field>
        <Field label="Nova senha">
          <Input
            type="password"
            autoComplete="new-password"
            required
            value={next}
            onChange={(event) => setNext(event.target.value)}
          />
          <Strength password={next} />
        </Field>
        <Field label="Confirmar nova senha">
          <Input
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </Field>
        <ErrorLine error={error} />
        <div>
          <Button type="submit" disabled={busy}>
            {busy ? "Salvando…" : "Trocar senha"}
          </Button>
        </div>
      </form>
    </section>
  );
}

/** Ação que pede a senha (e, se perigosa, uma palavra digitada) antes de rodar. */
function PasswordAction({
  title,
  description,
  button,
  icon,
  danger = false,
  confirmWord,
  onConfirm,
}: {
  title: string;
  description: string;
  button: string;
  icon: ReactNode;
  danger?: boolean;
  confirmWord?: string;
  onConfirm: (password: string) => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [word, setWord] = useState("");
  const { busy, error, setError, run } = useSubmit();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      if (confirmWord && word.trim().toUpperCase() !== confirmWord) {
        return `Digite ${confirmWord} para confirmar.`;
      }
      const problem = await onConfirm(password);
      if (!problem) {
        setPassword("");
        setWord("");
        setOpen(false);
      }
      return problem;
    });
  };
  return (
    <section className={`acct-card${danger ? " acct-danger" : ""}`}>
      <h3>{title}</h3>
      <p className="acct-muted">{description}</p>
      {open ? (
        <form className="acct-form acct-grid" onSubmit={submit} aria-label={title}>
          <Field label="Sua senha">
            <Input
              type="password"
              autoComplete="current-password"
              required
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          {confirmWord && (
            <Field label={`Digite ${confirmWord}`}>
              <Input value={word} onChange={(event) => setWord(event.target.value)} />
            </Field>
          )}
          <ErrorLine error={error} />
          <div className="acct-row">
            <Button type="submit" variant={danger ? "destructive" : "default"} disabled={busy}>
              {icon} {button}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
            >
              Cancelar
            </Button>
          </div>
        </form>
      ) : (
        <div>
          <Button
            type="button"
            variant={danger ? "destructive" : "outline"}
            onClick={() => setOpen(true)}
          >
            {icon} {button}
          </Button>
        </div>
      )}
    </section>
  );
}

// --- Contas Google ---

function GoogleAccounts({
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
  return (
    <>
      <div className="acct-head">
        <div>
          <h2 className="acct-title">Contas Google</h2>
          <p className="acct-muted">
            Cada conta é um perfil isolado: cookies, logins e dados separados, numa janela própria.
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
    <li className="acct-card acct-profile" data-profile={profile.id}>
      <div className="acct-profile-head">
        <ProfileAvatar profile={profile} size={44} />
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
              <span>{profile.email || "Conta ainda não conectada"}</span>
            </>
          )}
        </div>
      </div>
      <div className="acct-swatches" role="radiogroup" aria-label="Cor do perfil">
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
          {!profile.email && (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => void bridge.signInProfile(profile.id)}
              >
                Entrar no Google
              </Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={detect}>
                <RefreshCw /> Detectar
              </Button>
            </>
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

// --- Serviços Agzos ---

function Services({ bridge, onPremium }: { bridge: AccountBridge; onPremium: () => void }) {
  const [services, setServices] = useState<AgzosService[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void bridge.services().then((result) => {
      if (!alive) return;
      if (result.ok) setServices(result.services);
      else setError(result.error);
    });
    return () => {
      alive = false;
    };
  }, [bridge]);

  return (
    <>
      <h2 className="acct-title">Serviços Agzos</h2>
      <p className="acct-muted">
        A central dos acessos do Agzos Group, só para quem tem conta. Os serviços chegam na próxima
        versão.
      </p>
      <ErrorLine error={error} />
      {!services && !error && <p className="acct-muted">Carregando…</p>}
      {services && (
        <ul className="acct-services">
          {services.map((service) => (
            <li
              key={service.id}
              className={`acct-card acct-service${service.locked ? " locked" : ""}`}
              data-service={service.id}
            >
              <div className="acct-service-head">
                <strong>{service.name}</strong>
                {service.plan === "premium" && (
                  <span className="acct-badge">
                    <Crown aria-hidden="true" /> Premium
                  </span>
                )}
              </div>
              <p>{service.description}</p>
              <div className="acct-service-foot">
                {service.locked ? (
                  <button type="button" className="acct-link" onClick={onPremium}>
                    <Lock aria-hidden="true" /> Disponível no Premium
                  </button>
                ) : (
                  <span className="acct-soon">
                    {service.status === "available" ? "Disponível" : "Em breve"}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Premium({ plan }: { plan: string }) {
  return (
    <>
      <h2 className="acct-title">Premium</h2>
      <section className="acct-card acct-premium">
        <span className="acct-brand-mark" aria-hidden="true">
          <Sparkles />
        </span>
        <h3>{plan === "premium" ? "Você é Premium" : "Agzos Premium está chegando"}</h3>
        <p className="acct-muted">
          Funções exclusivas para quem tem Conta Agzos. Nada muda no navegador gratuito: o Premium
          soma, não tira.
        </p>
        <ul>
          <li>Sincronização de favoritos, guias e configurações entre computadores</li>
          <li>Cópia cifrada do Agzos Key na nuvem</li>
          <li>Agzos AI com mais modelos, sem chave própria</li>
          <li>Suporte prioritário</li>
        </ul>
        <Button type="button" disabled>
          Em breve
        </Button>
      </section>
    </>
  );
}

import { Check, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { desktopBridge, type SshConnection, type SshKey } from "@/features/browser/desktop";
import { Toggle } from "@/features/ui/toggle";
import {
  API_PROVIDERS,
  FONT_FAMILIES,
  FONT_SIZE,
  TERMINAL_SHORTCUTS,
  THEME_PRESETS,
  VOICE_LANGUAGES,
  fontStack,
  newId,
  shortcutText,
  type TerminalCursor,
  type TerminalDockMode,
  type TerminalSettings,
  type TerminalTheme,
  type VoiceLanguage,
} from "./config";

type Props = {
  settings: TerminalSettings;
  onChange: (patch: Partial<TerminalSettings>) => void;
};

export function TerminalDockSetting({ settings, onChange }: Props) {
  return (
    <label className="settings-select">
      <span>Posição</span>
      <select
        value={settings.dock}
        onChange={(event) => onChange({ dock: event.target.value as TerminalDockMode })}
      >
        <option value="bottom">Embaixo da página</option>
        <option value="right">À direita da página</option>
        <option value="window">Janela flutuante (PiP), sempre por cima</option>
      </select>
    </label>
  );
}

const COLOR_LABELS: Record<keyof TerminalTheme, string> = {
  background: "Fundo",
  foreground: "Texto",
  cursor: "Cursor",
};

export function TerminalThemeSetting({ settings, onChange }: Props) {
  return (
    <div className="settings-block terminal-theme-setting">
      <label className="settings-select">
        <span>Tema</span>
        <select
          value={
            THEME_PRESETS.some((item) => item.id === settings.themeId) ? settings.themeId : "custom"
          }
          onChange={(event) => {
            const preset = THEME_PRESETS.find((item) => item.id === event.target.value);
            if (preset) onChange({ themeId: preset.id, theme: preset.theme });
          }}
        >
          {THEME_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
          <option value="custom" disabled>
            Personalizado
          </option>
        </select>
      </label>
      <div className="terminal-colors">
        {(Object.keys(COLOR_LABELS) as (keyof TerminalTheme)[]).map((key) => (
          <label key={key}>
            <input
              type="color"
              value={settings.theme[key]}
              aria-label={`Cor: ${COLOR_LABELS[key]} do terminal`}
              onChange={(event) =>
                onChange({
                  themeId: "custom",
                  theme: { ...settings.theme, [key]: event.target.value },
                })
              }
            />
            {COLOR_LABELS[key]}
          </label>
        ))}
        <span
          className="terminal-preview"
          style={{
            background: settings.theme.background,
            color: settings.theme.foreground,
            fontFamily: fontStack(settings.fontFamily),
            fontSize: settings.fontSize,
          }}
          aria-hidden="true"
        >
          ~/projeto $ ls
          <i style={{ background: settings.theme.cursor }} />
        </span>
      </div>
    </div>
  );
}

export function TerminalFontSetting({ settings, onChange }: Props) {
  const known = FONT_FAMILIES.includes(settings.fontFamily);
  return (
    <div className="settings-block">
      <label className="settings-select">
        <span>Fonte</span>
        <select
          value={!settings.fontFamily ? "" : known ? settings.fontFamily : "outra"}
          onChange={(event) =>
            onChange({
              fontFamily:
                event.target.value === "outra" ? settings.fontFamily || " " : event.target.value,
            })
          }
        >
          <option value="">Padrão do sistema</option>
          {FONT_FAMILIES.map((family) => (
            <option key={family} value={family}>
              {family}
            </option>
          ))}
          <option value="outra">Outra…</option>
        </select>
      </label>
      {settings.fontFamily && !known && (
        <label className="settings-select settings-text">
          <span>Nome da fonte instalada</span>
          <input
            type="text"
            spellCheck={false}
            defaultValue={settings.fontFamily.trim()}
            onBlur={(event) => onChange({ fontFamily: event.target.value.trim() })}
          />
        </label>
      )}
      <label className="settings-select">
        <span>Tamanho: {settings.fontSize}px</span>
        <input
          type="range"
          min={FONT_SIZE.min}
          max={FONT_SIZE.max}
          value={settings.fontSize}
          aria-label="Tamanho da fonte do terminal"
          onChange={(event) => onChange({ fontSize: Number(event.target.value) })}
        />
      </label>
      <label className="settings-select">
        <span>Cursor</span>
        <select
          value={settings.cursor}
          onChange={(event) => onChange({ cursor: event.target.value as TerminalCursor })}
        >
          <option value="block">Bloco</option>
          <option value="bar">Barra</option>
          <option value="underline">Sublinhado</option>
        </select>
      </label>
    </div>
  );
}

export function TerminalVoiceSetting({ settings, onChange }: Props) {
  const desktop = desktopBridge();
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  useEffect(() => {
    void desktop?.aiState().then((state) => setHasKey(state.hasKey));
  }, [desktop]);
  return (
    <div className="settings-block">
      <p className="settings-note">
        O botão do microfone (ou {shortcutText("Ctrl+Shift+M", isMacPlatform())}) grava, transcreve
        com o Whisper da Groq e cola o texto no prompt da sessão.{" "}
        {hasKey === false && <strong>Configure a chave da Groq em Agzos AI para usar.</strong>}
      </p>
      <label className="settings-select">
        <span>Idioma da fala</span>
        <select
          value={settings.voice.language}
          onChange={(event) =>
            onChange({
              voice: { ...settings.voice, language: event.target.value as VoiceLanguage },
            })
          }
        >
          {VOICE_LANGUAGES.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <Toggle
        label="Executar depois de transcrever"
        hint="Desligado: o texto fica no prompt para você revisar e apertar Enter"
        checked={settings.voice.enter}
        onChange={(enter) => onChange({ voice: { ...settings.voice, enter } })}
      />
    </div>
  );
}

function isMacPlatform() {
  return typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
}

export function TerminalShortcutList() {
  const mac = isMacPlatform();
  return (
    <div className="settings-block">
      {TERMINAL_SHORTCUTS.map((item) => (
        <div key={item.action} className="settings-shortcut">
          <span>{item.label}</span>
          <kbd>{shortcutText(item.keys, mac)}</kbd>
        </div>
      ))}
      <div className="settings-shortcut">
        <span>Copiar / colar</span>
        <kbd>{mac ? "⌘C / ⌘V" : "Ctrl+Shift+C / Ctrl+Shift+V"}</kbd>
      </div>
      <div className="settings-shortcut">
        <span>Abrir/fechar o terminal</span>
        <kbd>{mac ? "⌘⌥T" : "Ctrl+Alt+T"}</kbd>
      </div>
    </div>
  );
}

// --- Listas editáveis ---

export function TerminalAliasSetting({ settings, onChange }: Props) {
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const valid = /^[A-Za-z_][A-Za-z0-9_.-]{0,40}$/.test(name.trim()) && command.trim() !== "";
  function add(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    const clean = name.trim();
    onChange({
      aliases: [
        ...settings.aliases.filter((item) => item.name !== clean),
        { name: clean, command: command.trim() },
      ],
    });
    setName("");
    setCommand("");
  }
  return (
    <div className="settings-block">
      <p className="settings-note">
        Valem nas sessões novas de bash, zsh, PowerShell e cmd (seus arquivos de perfil continuam
        carregando antes).
      </p>
      <ul className="terminal-list" aria-label="Aliases">
        {settings.aliases.map((alias) => (
          <li key={alias.name}>
            <code>{alias.name}</code>
            <span>{alias.command}</span>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Remover alias ${alias.name}`}
              onClick={() =>
                onChange({ aliases: settings.aliases.filter((item) => item !== alias) })
              }
            >
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
      <form className="terminal-add" onSubmit={add}>
        <input
          aria-label="Nome do alias"
          placeholder="gs"
          value={name}
          spellCheck={false}
          onChange={(event) => setName(event.target.value)}
        />
        <input
          aria-label="Comando do alias"
          placeholder="git status"
          value={command}
          spellCheck={false}
          onChange={(event) => setCommand(event.target.value)}
        />
        <Button type="submit" size="sm" disabled={!valid}>
          <Plus /> Adicionar alias
        </Button>
      </form>
    </div>
  );
}

export function TerminalSnippetSetting({ settings, onChange }: Props) {
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [run, setRun] = useState(false);
  function add(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !command.trim()) return;
    onChange({
      snippets: [...settings.snippets, { id: newId("cmd"), name: name.trim(), command, run }],
    });
    setName("");
    setCommand("");
    setRun(false);
  }
  return (
    <div className="settings-block">
      <p className="settings-note">
        Aparecem no lançador do terminal ({shortcutText("Ctrl+Shift+K", isMacPlatform())}).
      </p>
      <ul className="terminal-list" aria-label="Comandos rápidos">
        {settings.snippets.map((snippet) => (
          <li key={snippet.id}>
            <strong>{snippet.name}</strong>
            <code>{snippet.command}</code>
            <label className="terminal-inline-check">
              <input
                type="checkbox"
                checked={snippet.run}
                onChange={(event) =>
                  onChange({
                    snippets: settings.snippets.map((item) =>
                      item === snippet ? { ...item, run: event.target.checked } : item,
                    ),
                  })
                }
              />
              executar
            </label>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Remover comando ${snippet.name}`}
              onClick={() =>
                onChange({ snippets: settings.snippets.filter((item) => item !== snippet) })
              }
            >
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
      <form className="terminal-add" onSubmit={add}>
        <input
          aria-label="Nome do comando rápido"
          placeholder="Subir o projeto"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <input
          aria-label="Comando"
          placeholder="bun run dev"
          value={command}
          spellCheck={false}
          onChange={(event) => setCommand(event.target.value)}
        />
        <label className="terminal-inline-check">
          <input type="checkbox" checked={run} onChange={(event) => setRun(event.target.checked)} />
          executar
        </label>
        <Button type="submit" size="sm" disabled={!name.trim() || !command.trim()}>
          <Plus /> Adicionar
        </Button>
      </form>
    </div>
  );
}

export function TerminalToolsSetting({ settings, onChange }: Props) {
  const desktop = desktopBridge();
  const [found, setFound] = useState<Record<string, boolean>>({});
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const key = settings.tools.map((tool) => tool.command).join("\n");
  useEffect(() => {
    void desktop?.terminalTools(key.split("\n").filter(Boolean)).then(setFound);
  }, [desktop, key]);
  return (
    <div className="settings-block">
      <p className="settings-note">
        O lançador abre uma sessão nova e roda o comando. As chaves de API abaixo entram no ambiente
        dessas sessões.
      </p>
      <ul className="terminal-list" aria-label="Ferramentas de IA">
        {settings.tools.map((tool) => {
          const installed = found[tool.command.split(/\s+/)[0]!];
          return (
            <li key={tool.id}>
              <input
                type="checkbox"
                aria-label={`Mostrar ${tool.name} no lançador`}
                checked={tool.on}
                onChange={(event) =>
                  onChange({
                    tools: settings.tools.map((item) =>
                      item === tool ? { ...item, on: event.target.checked } : item,
                    ),
                  })
                }
              />
              <strong>{tool.name}</strong>
              <input
                className="terminal-tool-command"
                aria-label={`Comando de ${tool.name}`}
                defaultValue={tool.command}
                spellCheck={false}
                onBlur={(event) => {
                  const value = event.target.value.trim();
                  if (value && value !== tool.command) {
                    onChange({
                      tools: settings.tools.map((item) =>
                        item === tool ? { ...item, command: value } : item,
                      ),
                    });
                  }
                }}
              />
              <small className={installed ? "found" : "missing"}>
                {installed === undefined ? "" : installed ? "instalado" : "não encontrado"}
              </small>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Remover ${tool.name}`}
                onClick={() => onChange({ tools: settings.tools.filter((item) => item !== tool) })}
              >
                <Trash2 />
              </Button>
            </li>
          );
        })}
      </ul>
      <form
        className="terminal-add"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim() || !command.trim()) return;
          onChange({
            tools: [
              ...settings.tools,
              { id: newId("tool"), name: name.trim(), command: command.trim(), on: true },
            ],
          });
          setName("");
          setCommand("");
        }}
      >
        <input
          aria-label="Nome da ferramenta"
          placeholder="Aider"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <input
          aria-label="Comando da ferramenta"
          placeholder="aider"
          value={command}
          spellCheck={false}
          onChange={(event) => setCommand(event.target.value)}
        />
        <Button type="submit" size="sm" disabled={!name.trim() || !command.trim()}>
          <Plus /> Adicionar
        </Button>
      </form>
    </div>
  );
}

const SECRET_ERRORS: Record<string, string> = {
  name: "Nome inválido: use LETRAS_MAIUSCULAS e _ (ex.: ANTHROPIC_API_KEY).",
  value: "Chave vazia ou com quebra de linha.",
  insecure: "O sistema não oferece armazenamento cifrado agora; a chave não foi salva.",
  limit: "Limite de chaves atingido.",
  storage: "Não foi possível gravar a chave.",
};

export function TerminalApiKeysSetting({ settings, onChange }: Props) {
  const desktop = desktopBridge();
  const [names, setNames] = useState<string[] | null>(null);
  const [name, setName] = useState(API_PROVIDERS[0]!.name);
  const [custom, setCustom] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const refresh = () => void desktop?.terminalSecrets().then((info) => setNames(info.names));
  useEffect(refresh, [desktop]);
  if (!desktop || names === null) return null;
  const target = name === "custom" ? custom.trim().toUpperCase() : name;
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!desktop) return;
    const result = await desktop.terminalSecretSet(target, value);
    if (!result.ok) {
      setError(SECRET_ERRORS[result.error ?? ""] ?? "Não foi possível salvar.");
      return;
    }
    setValue("");
    setCustom("");
    setError(null);
    refresh();
  }
  const labelOf = (secret: string) =>
    API_PROVIDERS.find((provider) => provider.name === secret)?.label ?? secret;
  return (
    <div className="settings-block">
      <p className="settings-note">
        Cifradas pelo cofre do sistema e colocadas só no ambiente dos terminais (nunca voltam para a
        tela). Valem nas sessões novas.
      </p>
      <ul className="terminal-list" aria-label="Chaves de API dos terminais">
        {names.map((secret) => (
          <li key={secret}>
            <KeyRound className="terminal-list-icon" />
            <code>{secret}</code>
            <span>{labelOf(secret)}</span>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Remover ${secret}`}
              onClick={() => void desktop.terminalSecretRemove(secret).then(refresh)}
            >
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
      <form className="terminal-add" onSubmit={(event) => void save(event)}>
        <select
          aria-label="Provedor da chave"
          value={name}
          onChange={(event) => setName(event.target.value)}
        >
          {API_PROVIDERS.map((provider) => (
            <option key={provider.name} value={provider.name}>
              {provider.label}
            </option>
          ))}
          <option value="custom">Outra variável…</option>
        </select>
        {name === "custom" && (
          <input
            aria-label="Nome da variável"
            placeholder="MINHA_API_KEY"
            value={custom}
            spellCheck={false}
            onChange={(event) => setCustom(event.target.value)}
          />
        )}
        <input
          type="password"
          autoComplete="off"
          aria-label={`Valor de ${target || "a variável"}`}
          placeholder="Cole a chave"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <Button type="submit" size="sm" disabled={!value.trim() || !target}>
          <KeyRound /> Salvar
        </Button>
      </form>
      {error && <p className="ai-error">{error}</p>}
      <Toggle
        label="Usar a chave da Groq do Agzos AI como GROQ_API_KEY"
        hint="Sem precisar colar de novo; só nos terminais"
        checked={settings.groqEnv}
        onChange={(groqEnv) => onChange({ groqEnv })}
      />
    </div>
  );
}

const SSH_ERRORS: Record<string, string> = {
  name: "Nome inválido (letras, números, ponto, - e _).",
  exists: "Já existe uma chave com esse nome em ~/.ssh.",
  value: "Comentário ou frase-senha com quebra de linha.",
  "no-keygen": "O ssh-keygen não foi encontrado neste sistema.",
  keygen: "O ssh-keygen não conseguiu gerar a chave.",
  storage: "Não foi possível criar a pasta ~/.ssh.",
};

export function SshKeysSetting() {
  const desktop = desktopBridge();
  const [keys, setKeys] = useState<SshKey[] | null>(null);
  const [name, setName] = useState("id_ed25519_agzos");
  const [comment, setComment] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const refresh = () => void desktop?.sshKeys().then(setKeys);
  useEffect(refresh, [desktop]);
  if (!desktop || keys === null) return null;
  async function generate(event: FormEvent) {
    event.preventDefault();
    if (!desktop) return;
    setBusy(true);
    const result = await desktop.sshGenerate({ name: name.trim(), comment, passphrase });
    setBusy(false);
    if (!result.ok) {
      setError(SSH_ERRORS[result.error] ?? "Não foi possível gerar a chave.");
      return;
    }
    setPassphrase("");
    setError(null);
    refresh();
  }
  return (
    <div className="settings-block">
      <ul className="terminal-list" aria-label="Chaves SSH">
        {!keys.length && <li className="empty">Nenhuma chave em ~/.ssh.</li>}
        {keys.map((key) => (
          <li key={key.name}>
            <KeyRound className="terminal-list-icon" />
            <strong>{key.name}</strong>
            <span>
              {key.type.replace(/^ssh-/, "")}
              {key.comment ? ` · ${key.comment}` : ""}
            </span>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Copiar a chave pública ${key.name}`}
              onClick={() =>
                void desktop.clipboardWrite(key.publicKey).then(() => {
                  setCopied(key.name);
                  setTimeout(() => setCopied(null), 1500);
                })
              }
            >
              {copied === key.name ? <Check /> : <Copy />}
              {copied === key.name ? "Copiada" : "Copiar pública"}
            </Button>
          </li>
        ))}
      </ul>
      <form className="terminal-add" onSubmit={(event) => void generate(event)}>
        <input
          aria-label="Nome do arquivo da chave"
          value={name}
          spellCheck={false}
          onChange={(event) => setName(event.target.value)}
        />
        <input
          aria-label="Comentário da chave"
          placeholder="e-mail ou máquina"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />
        <input
          type="password"
          autoComplete="new-password"
          aria-label="Frase-senha da chave (opcional)"
          placeholder="frase-senha (opcional)"
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
        />
        <Button type="submit" size="sm" disabled={busy || !name.trim()}>
          <Plus /> {busy ? "Gerando…" : "Gerar ed25519"}
        </Button>
      </form>
      {error && <p className="ai-error">{error}</p>}
    </div>
  );
}

export function SshConnectionsSetting({ settings, onChange }: Props) {
  const desktop = desktopBridge();
  const [keys, setKeys] = useState<SshKey[]>([]);
  const empty: SshConnection = { id: "", name: "", user: "", host: "", port: 22, key: "" };
  const [draft, setDraft] = useState(empty);
  useEffect(() => {
    void desktop?.sshKeys().then(setKeys);
  }, [desktop]);
  const valid =
    /^[A-Za-z0-9_.:[\]-]{1,253}$/.test(draft.host.trim()) && !draft.host.startsWith("-");
  return (
    <div className="settings-block">
      <ul className="terminal-list" aria-label="Conexões SSH">
        {settings.ssh.map((connection) => (
          <li key={connection.id}>
            <strong>{connection.name || connection.host}</strong>
            <code>
              {connection.user ? `${connection.user}@` : ""}
              {connection.host}
              {connection.port !== 22 ? `:${connection.port}` : ""}
            </code>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Remover conexão ${connection.name || connection.host}`}
              onClick={() => onChange({ ssh: settings.ssh.filter((item) => item !== connection) })}
            >
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
      <form
        className="terminal-add"
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid) return;
          onChange({
            ssh: [
              ...settings.ssh,
              {
                ...draft,
                id: newId("ssh"),
                host: draft.host.trim(),
                user: draft.user.trim(),
                name: draft.name.trim(),
              },
            ],
          });
          setDraft(empty);
        }}
      >
        <input
          aria-label="Nome da conexão"
          placeholder="Servidor"
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
        <input
          aria-label="Usuário SSH"
          placeholder="usuário"
          value={draft.user}
          spellCheck={false}
          onChange={(event) => setDraft({ ...draft, user: event.target.value })}
        />
        <input
          aria-label="Host SSH"
          placeholder="exemplo.com"
          value={draft.host}
          spellCheck={false}
          onChange={(event) => setDraft({ ...draft, host: event.target.value })}
        />
        <input
          aria-label="Porta SSH"
          type="number"
          min={1}
          max={65535}
          value={draft.port}
          onChange={(event) => setDraft({ ...draft, port: Number(event.target.value) || 22 })}
        />
        <select
          aria-label="Chave da conexão"
          value={draft.key}
          onChange={(event) => setDraft({ ...draft, key: event.target.value })}
        >
          <option value="">Chave padrão do ssh</option>
          {keys
            .filter((key) => key.privatePath)
            .map((key) => (
              <option key={key.name} value={key.privatePath!}>
                {key.name}
              </option>
            ))}
        </select>
        <Button type="submit" size="sm" disabled={!valid}>
          <Plus /> Adicionar
        </Button>
      </form>
    </div>
  );
}

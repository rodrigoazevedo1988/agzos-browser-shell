import { Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { desktopBridge, type DesktopBridge } from "@/features/browser/desktop";
import {
  EMPTY_AUTOFILL,
  PROFILE_FIELDS,
  filledCount,
  newProfileId,
  profileSummary,
  typeLabel,
  type AutofillProfile,
  type AutofillResult,
  type AutofillState,
} from "@/features/key/form-fill";
import { Toggle } from "@/features/ui/toggle";

const ERRORS: Record<string, string> = {
  insecure: "Sem chaveiro do sistema: nada é gravado (os perfis nunca ficam em texto puro).",
  limit: "Limite de perfis atingido (20).",
  invalid: "Confira o nome do perfil.",
  write: "Não deu para gravar o arquivo de perfis.",
};

/**
 * Configurações do autofill de formulários (Agzos Key): liga/desliga, perfis de
 * preenchimento (Pessoal, Trabalho…), campos aprendidos por site e sites em que o Agzos
 * nunca preenche. Os perfis ficam cifrados no main (electron/autofill-store.cjs).
 */
export function FormAutofillSettings({ desktop: given }: { desktop?: DesktopBridge | null }) {
  const desktop = useMemo(() => (given === undefined ? desktopBridge() : given), [given]);
  const [state, setState] = useState<AutofillState | null>(null);
  const [editing, setEditing] = useState<AutofillProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!desktop) return;
    void desktop
      .autofillState()
      .then(setState)
      .catch(() => setState(EMPTY_AUTOFILL));
    return desktop.onAutofillChanged(setState);
  }, [desktop]);

  if (!desktop) {
    return (
      <p className="sf-note">
        O preenchimento de formulários funciona no app para computador: os perfis ficam cifrados no
        chaveiro do sistema.
      </p>
    );
  }
  if (!state) return null;

  const done = (result: AutofillResult) => {
    setError(result.ok ? null : (ERRORS[result.error ?? ""] ?? "Não deu para salvar."));
    return result.ok;
  };
  const settings = state.settings;
  const sites = [...new Set(state.mappings.map((item) => item.site))].sort();

  return (
    <div className="sf-body">
      {!state.available && <p className="sf-note">{ERRORS["insecure"]}</p>}
      <Toggle
        label="Preencher formulários em geral"
        hint="Endereço, contato, cadastro e documentos (CPF, CNPJ, CEP…), além dos logins."
        checked={settings.forms}
        onChange={(value) => void desktop.autofillSettings({ forms: value }).then(done)}
      />
      <Toggle
        label="Sugerir ao clicar num campo"
        hint="O Agzos Key oferece os perfis quando você clica num campo de formulário."
        checked={settings.suggest}
        disabled={!settings.forms}
        onChange={(value) => void desktop.autofillSettings({ suggest: value }).then(done)}
      />
      <Toggle
        label="Aprender com as correções"
        hint="Corrigiu um campo preenchido? O Agzos pergunta se deve lembrar o tipo certo dele no site."
        checked={settings.learn}
        disabled={!settings.forms}
        onChange={(value) => void desktop.autofillSettings({ learn: value }).then(done)}
      />

      <h4 className="m-0 mt-2 text-sm font-semibold">Perfis de preenchimento</h4>
      {state.profiles.length === 0 && !editing && (
        <p className="sf-note">
          Nenhum perfil ainda. Crie um para preencher formulários num clique.
        </p>
      )}
      {state.profiles.length > 0 && (
        <ul className="sf-rules" aria-label="Perfis de preenchimento">
          {state.profiles.map((profile) => (
            <li key={profile.id}>
              <span>
                <strong>{profile.name}</strong>
                <small>
                  {profileSummary(profile) || "Sem dados"} · {filledCount(profile)} campos
                </small>
              </span>
              <span className="settings-buttons">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Editar o perfil ${profile.name}`}
                  onClick={() => setEditing(profile)}
                >
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Apagar o perfil ${profile.name}`}
                  onClick={() => void desktop.autofillRemoveProfile(profile.id).then(done)}
                >
                  <Trash2 />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <ProfileEditor
          key={editing.id}
          profile={editing}
          onCancel={() => setEditing(null)}
          onSave={(profile) =>
            void desktop.autofillSaveProfile(profile).then((result) => {
              if (done(result)) setEditing(null);
            })
          }
        />
      ) : (
        <div>
          <Button
            size="sm"
            variant="outline"
            disabled={!state.available}
            onClick={() =>
              setEditing({
                id: newProfileId(),
                name: state.profiles.length === 0 ? "Pessoal" : "Trabalho",
                fields: {},
                updatedAt: Date.now(),
              })
            }
          >
            <Plus /> Novo perfil
          </Button>
        </div>
      )}
      {error && (
        <p className="sf-note" role="alert">
          {error}
        </p>
      )}

      <h4 className="m-0 mt-2 text-sm font-semibold">Campos aprendidos por site</h4>
      {sites.length === 0 ? (
        <p className="sf-note">
          Quando você corrige um campo preenchido e escolhe “Lembrar”, o mapeamento aparece aqui.
        </p>
      ) : (
        <ul className="sf-rules" aria-label="Campos aprendidos por site">
          {state.mappings.map((item) => (
            <li key={`${item.site}|${item.signature}`}>
              <span>
                <strong>{item.site}</strong>
                <small>
                  {item.label || item.signature} → {typeLabel(item.type)}
                </small>
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Esquecer ${item.label || item.signature} em ${item.site}`}
                onClick={() =>
                  void desktop.autofillRemoveMapping(item.site, item.signature).then(done)
                }
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {state.never.length > 0 && (
        <>
          <h4 className="m-0 mt-2 text-sm font-semibold">Nunca preencher formulários em</h4>
          <ul className="sf-rules" aria-label="Sites sem preenchimento de formulários">
            {state.never.map((site) => (
              <li key={site}>
                <span>
                  <strong>{site}</strong>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void desktop.autofillSetNever(site, false).then(done)}
                >
                  Permitir
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ProfileEditor({
  profile,
  onSave,
  onCancel,
}: {
  profile: AutofillProfile;
  onSave: (profile: AutofillProfile) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(profile.name);
  const [fields, setFields] = useState(profile.fields);
  const groups = [...new Set(PROFILE_FIELDS.map((field) => field.group))];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    onSave({ ...profile, name: name.trim(), fields, updatedAt: Date.now() });
  };

  return (
    <form className="sf-card flex flex-col gap-3" onSubmit={submit} aria-label="Editar perfil">
      <label className="key-field">
        <span>Nome do perfil</span>
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} />
      </label>
      {groups.map((group) => (
        <fieldset key={group} className="m-0 border-0 p-0">
          <legend className="mb-1 text-xs font-semibold text-muted-foreground">{group}</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {PROFILE_FIELDS.filter((field) => field.group === group).map((field) => (
              <label className="key-field" key={field.type}>
                <span>{field.label}</span>
                <input
                  value={fields[field.type] ?? ""}
                  placeholder={field.placeholder}
                  maxLength={200}
                  autoComplete="off"
                  onChange={(event) =>
                    setFields((current) => ({ ...current, [field.type]: event.target.value }))
                  }
                />
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <div className="key-form-actions">
        <Button size="sm" type="submit" disabled={!name.trim()}>
          Salvar perfil
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

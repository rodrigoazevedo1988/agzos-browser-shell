import { Ban, ClipboardList, Settings2, Wand2, X } from "lucide-react";

import { Button } from "@/components/ui/button";

import { formKindLabel, typeLabel } from "./form-fill";

/** Dados do formulário clicado (atravessam o IPC até a camada: só texto e números). */
export type FormFillInfo = {
  kind: string;
  field: string | null;
  fillable: number;
  /** Perfis: id, nome e um resumo curto (nunca os valores todos). */
  profiles: { id: string; name: string; summary: string }[];
  /** Preencher não achou campos (a página mudou): o cartão avisa. */
  missed: boolean;
  /** Sem chaveiro no sistema: perfis não podem ser gravados. */
  available: boolean;
};

/**
 * Cartão "Preencher formulário" do popup do Agzos Key: aparece quando o usuário clica num
 * campo de um formulário de dados (endereço, contato, cadastro) e oferece os perfis.
 */
export function FormFillCard({
  host,
  form,
  onFillProfile,
  onNeverSite,
  onOpenSettings,
  onClose,
}: {
  host: string;
  form: FormFillInfo;
  onFillProfile?: ((id: string) => void) | undefined;
  onNeverSite?: (() => void) | undefined;
  onOpenSettings?: (() => void) | undefined;
  onClose: () => void;
}) {
  return (
    <aside className="autofill-popup form-fill" data-mode="form" aria-label="Preencher formulário">
      <div className="autofill-head">
        <span className="key-mark">
          <ClipboardList aria-hidden="true" />
        </span>
        <div className="autofill-title">
          <strong>Preencher {formKindLabel(form.kind).toLowerCase()}</strong>
          <small>
            {host}
            {form.field ? ` · ${typeLabel(form.field)}` : ""}
            {form.fillable > 1 ? ` · ${form.fillable} campos` : ""}
          </small>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar">
          <X />
        </Button>
      </div>
      <div className="autofill-list">
        {form.profiles.length === 0 ? (
          <p className="autofill-empty">
            {form.available
              ? "Nenhum perfil de preenchimento ainda. Crie um em Configurações (Pessoal, Trabalho…)."
              : "O sistema não tem um chaveiro disponível: os perfis não podem ser guardados com segurança."}
          </p>
        ) : (
          form.profiles.map((profile) => (
            <div className="autofill-item" key={profile.id}>
              <div className="autofill-info">
                <strong>{profile.name}</strong>
                {profile.summary && <small>{profile.summary}</small>}
              </div>
              <div className="autofill-actions">
                <Button
                  size="sm"
                  className="autofill-fill"
                  onClick={() => onFillProfile?.(profile.id)}
                  aria-label={`Preencher com o perfil ${profile.name}`}
                >
                  <Wand2 /> Preencher
                </Button>
              </div>
            </div>
          ))
        )}
        {form.missed && (
          <small className="autofill-miss" role="status">
            Não achei campos para preencher. O formulário pode ter mudado: clique num campo dele e
            tente de novo.
          </small>
        )}
      </div>
      <div className="autofill-foot">
        <button type="button" onClick={() => onNeverSite?.()}>
          <Ban aria-hidden="true" /> Nunca neste site
        </button>
        <button type="button" onClick={() => onOpenSettings?.()}>
          <Settings2 aria-hidden="true" /> Perfis e campos
        </button>
      </div>
    </aside>
  );
}

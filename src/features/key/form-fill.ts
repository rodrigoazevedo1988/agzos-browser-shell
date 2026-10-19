// Autofill de formulários em geral (perfis de preenchimento): tipos, rótulos e a ponte
// com o main. O motor semântico fica em electron/form-intel.cjs (roda nas páginas) e os
// perfis, cifrados, em electron/autofill-store.cjs.

/** Campos que um perfil guarda (mesma ordem de PROFILE_TYPES em form-intel.cjs). */
export const PROFILE_FIELDS = [
  { type: "given-name", label: "Nome", group: "Pessoa", placeholder: "Maria" },
  { type: "family-name", label: "Sobrenome", group: "Pessoa", placeholder: "Silva" },
  { type: "name", label: "Nome completo", group: "Pessoa", placeholder: "Maria Silva" },
  { type: "email", label: "E-mail", group: "Pessoa", placeholder: "maria@exemplo.com" },
  { type: "tel", label: "Telefone", group: "Pessoa", placeholder: "(11) 91234-5678" },
  { type: "cpf", label: "CPF", group: "Documentos", placeholder: "000.000.000-00" },
  { type: "cnpj", label: "CNPJ", group: "Documentos", placeholder: "00.000.000/0000-00" },
  { type: "rg", label: "RG", group: "Documentos", placeholder: "12.345.678-9" },
  { type: "birth-date", label: "Nascimento", group: "Documentos", placeholder: "31/12/1990" },
  { type: "company", label: "Empresa", group: "Trabalho", placeholder: "Agzos Ltda." },
  { type: "job-title", label: "Cargo", group: "Trabalho", placeholder: "Analista" },
  { type: "website", label: "Site", group: "Trabalho", placeholder: "https://exemplo.com" },
  { type: "postal-code", label: "CEP", group: "Endereço", placeholder: "01310-100" },
  { type: "street", label: "Rua / logradouro", group: "Endereço", placeholder: "Av. Paulista" },
  { type: "address-number", label: "Número", group: "Endereço", placeholder: "1000" },
  { type: "address-complement", label: "Complemento", group: "Endereço", placeholder: "Apto 12" },
  { type: "neighborhood", label: "Bairro", group: "Endereço", placeholder: "Bela Vista" },
  { type: "city", label: "Cidade", group: "Endereço", placeholder: "São Paulo" },
  { type: "state", label: "UF", group: "Endereço", placeholder: "SP" },
  { type: "country", label: "País", group: "Endereço", placeholder: "Brasil" },
] as const;

export type ProfileFieldType = (typeof PROFILE_FIELDS)[number]["type"];
/** Tipos que um campo pode ter num mapeamento por site ("ignore": nunca preencher). */
export type MappingType = ProfileFieldType | "tel-area-code" | "tel-local" | "username" | "ignore";

export type AutofillProfile = {
  id: string;
  name: string;
  fields: Partial<Record<ProfileFieldType, string>>;
  updatedAt: number;
};
export type AutofillSettings = {
  /** Preencher formulários em geral (endereço, contato, cadastro). */
  forms: boolean;
  /** Sugerir os perfis ao clicar num campo. */
  suggest: boolean;
  /** Aprender quando o usuário corrige um campo preenchido. */
  learn: boolean;
};
export type AutofillMapping = { site: string; signature: string; type: MappingType; label: string };
export type AutofillState = {
  /** O sistema tem chaveiro: sem ele nada é gravado (nunca em texto puro). */
  available: boolean;
  settings: AutofillSettings;
  profiles: AutofillProfile[];
  mappings: AutofillMapping[];
  never: string[];
};
export type AutofillResult = { ok: boolean; error?: string };

export type FormFillTabEvent =
  /** O usuário clicou num campo de formulário de dados (a casca oferece os perfis). */
  | {
      type: "form-field";
      id: number;
      url: string;
      kind: string;
      field: string | null;
      fillable: number;
    }
  /** O usuário corrigiu um campo preenchido: lembrar o tipo certo neste site? */
  | {
      type: "form-learn";
      id: number;
      site: string;
      signature: string;
      label: string;
      from: string | null;
      to: MappingType;
    };

export type DesktopFormFill = {
  fillProfile(
    id: number,
    profileId: string,
  ): Promise<{ ok: boolean; filled?: boolean; count?: number; error?: string }>;
  autofillState(): Promise<AutofillState>;
  autofillSettings(partial: Partial<AutofillSettings>): Promise<AutofillResult>;
  autofillSaveProfile(profile: AutofillProfile): Promise<AutofillResult>;
  autofillRemoveProfile(id: string): Promise<AutofillResult>;
  autofillSetMapping(
    site: string,
    signature: string,
    type: MappingType,
    label: string,
  ): Promise<AutofillResult>;
  autofillRemoveMapping(site: string, signature: string): Promise<AutofillResult>;
  autofillSetNever(site: string, never: boolean): Promise<AutofillResult>;
  onAutofillChanged(callback: (state: AutofillState) => void): () => void;
};

const EXTRA_LABELS: Record<string, string> = {
  "tel-area-code": "DDD",
  "tel-local": "Telefone sem DDD",
  username: "Usuário do login",
  ignore: "Não preencher",
};

/** Rótulo em português de um tipo canônico. */
export function typeLabel(type: string | null | undefined): string {
  if (!type) return "Campo";
  return PROFILE_FIELDS.find((field) => field.type === type)?.label ?? EXTRA_LABELS[type] ?? type;
}

const KIND_LABELS: Record<string, string> = {
  address: "Endereço",
  contact: "Contato",
  signup: "Cadastro",
  generic: "Formulário",
  "login-step": "Login",
  login: "Login",
};

/** Nome do tipo de formulário (endereço, contato, cadastro…). */
export function formKindLabel(kind: string | null | undefined): string {
  return KIND_LABELS[kind ?? ""] ?? "Formulário";
}

/** Resumo curto do perfil para a lista (nome, e-mail, cidade). */
export function profileSummary(profile: AutofillProfile): string {
  const fields = profile.fields;
  const name =
    fields.name || [fields["given-name"], fields["family-name"]].filter(Boolean).join(" ");
  return [
    name,
    fields.email,
    fields.city && fields.state ? `${fields.city}/${fields.state}` : fields.city,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Campos preenchidos do perfil. */
export function filledCount(profile: AutofillProfile): number {
  return Object.values(profile.fields).filter((value) => value && value.trim()).length;
}

export const EMPTY_AUTOFILL: AutofillState = {
  available: true,
  settings: { forms: true, suggest: true, learn: true },
  profiles: [],
  mappings: [],
  never: [],
};

/** Id novo de perfil (letras, dígitos e hífen: o main só aceita isso). */
export function newProfileId(): string {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Chave do site para mapeamentos e "nunca preencher" (igual a siteKey em form-intel.cjs):
 * host sem www.; no Apps Script, o app (script.google.com/macros/s/<id>).
 */
export function siteKeyOf(url: string | null | undefined): string {
  try {
    const parsed = new URL(url ?? "");
    if (!/^https?:$/.test(parsed.protocol)) return "";
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "script.google.com") {
      const match = /^\/(?:a\/macros\/[^/]+|macros)\/s\/([^/]+)/.exec(parsed.pathname);
      if (match) return `${host}/macros/s/${match[1]}`;
    }
    return host;
  } catch {
    return "";
  }
}

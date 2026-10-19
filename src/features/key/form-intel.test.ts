import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { appsScriptApp, matchesForUrl } from "@/features/browser/vault";
import type { VaultEntry } from "@/features/browser/types";

import { siteKeyOf } from "./form-fill";

// Motor semântico do autofill (electron/form-intel.cjs): a parte pura, sem DOM.
const require = createRequire(import.meta.url);
const electronDir = path.join(import.meta.dirname, "../../../electron");
type Signals = Record<string, unknown>;
type Verdict = { type: string | null; score: number; confidence: number; password: boolean };
type Field = Verdict & { inputType: string; signals: Signals };
const intel = require(path.join(electronDir, "form-intel.cjs")) as {
  FORM_INTEL_SOURCE: string;
  PROFILE_TYPES: string[];
  norm: (text: string) => string;
  classifyField: (signals: Signals) => Verdict;
  resolveForm: (
    fields: Field[],
    context?: { buttons?: string[]; text?: string },
  ) => {
    kind: string;
    roles: (string | null)[];
    username: number;
    password: number;
    newPassword: number;
    confirm: number;
  };
  profileValues: (fields: Record<string, string>) => Record<string, string>;
  formatValue: (type: string, value: string, field?: Record<string, unknown>) => string;
  matchOption: (type: string, value: string, options: { value: string; text: string }[]) => number;
  fieldSignature: (signals: Signals) => string;
  frameAllowed: (top: string, frame: string, extra?: { top: string; frame: string }[]) => boolean;
  siteKey: (url: string) => string;
  typeForValue: (values: Record<string, string>, raw: string) => string | null;
  isSubmitLabel: (text: string) => boolean;
};
const { createAutofillStore } = require(path.join(electronDir, "autofill-store.cjs")) as {
  createAutofillStore: (options: { file: string; safeStorage: unknown }) => {
    state: () => {
      available: boolean;
      settings: Record<string, boolean>;
      profiles: { id: string; name: string; fields: Record<string, string> }[];
      mappings: { site: string; signature: string; type: string; label: string }[];
      never: string[];
    };
    saveProfile: (profile: unknown) => { ok: boolean; error?: string };
    removeProfile: (id: string) => { ok: boolean };
    setMapping: (site: string, sig: string, type: string, label: string) => { ok: boolean };
    removeMapping: (site: string, sig: string) => { ok: boolean };
    mappingsFor: (url: string) => Record<string, string>;
    setNever: (site: string, never: boolean) => { ok: boolean };
    isNever: (url: string) => boolean;
    setSettings: (partial: Record<string, boolean>) => { ok: boolean };
    profile: (id: string) => { fields: Record<string, string> } | null;
  };
};

const type = (signals: Signals) =>
  intel.classifyField({ tag: "input", type: "text", ...signals }).type;

/** Campo já classificado, como o analyze() do DOM entrega para o resolveForm. */
const field = (signals: Signals): Field => {
  const full = { tag: "input", type: "text", ...signals };
  return { ...intel.classifyField(full), inputType: String(full.type), signals: full };
};

describe("normalização", () => {
  it("tira acento, quebra camelCase e separadores", () => {
    expect(intel.norm("Data de Nascimento*")).toBe("data de nascimento");
    expect(intel.norm("txtNomeCompleto")).toBe("txt nome completo");
    expect(intel.norm("user_email-2")).toBe("user email 2");
    expect(intel.norm("Endereço (Rua/Av.)")).toBe("endereco rua av");
  });
});

describe("classificação de campos (PT-BR, EN, ES)", () => {
  it.each([
    [{ label: "CPF" }, "cpf"],
    [{ placeholder: "000.000.000-00", name: "cpf_cliente" }, "cpf"],
    [{ label: "CNPJ da empresa" }, "cnpj"],
    [{ label: "Nome completo" }, "name"],
    [{ label: "Nome" }, "name"],
    [{ name: "firstName" }, "given-name"],
    [{ label: "Sobrenome" }, "family-name"],
    [{ label: "Last name" }, "family-name"],
    [{ label: "E-mail" }, "email"],
    [{ type: "email" }, "email"],
    [{ label: "Correo electrónico" }, "email"],
    [{ label: "Celular / WhatsApp" }, "tel"],
    [{ type: "tel" }, "tel"],
    [{ label: "DDD", maxLength: 2 }, "tel-area-code"],
    [{ label: "Data de nascimento" }, "birth-date"],
    [{ name: "dtNasc" }, "birth-date"],
    [{ type: "date", label: "Nascimento" }, "birth-date"],
    [{ label: "CEP", maxLength: 9 }, "postal-code"],
    [{ label: "Zip code" }, "postal-code"],
    [{ label: "Endereço" }, "street"],
    [{ label: "Logradouro" }, "street"],
    [{ label: "Número" }, "address-number"],
    [{ label: "Nº" }, "address-number"],
    [{ label: "Complemento" }, "address-complement"],
    [{ label: "Bairro" }, "neighborhood"],
    [{ label: "Cidade" }, "city"],
    [{ label: "Município" }, "city"],
    [{ label: "UF", maxLength: 2 }, "state"],
    [{ label: "País" }, "country"],
    [{ label: "Empresa" }, "company"],
    [{ label: "Razão social" }, "company"],
    [{ label: "Cargo" }, "job-title"],
    [{ type: "url" }, "website"],
    [{ label: "Usuário" }, "username"],
    [{ label: "Matrícula" }, "username"],
    [{ autocomplete: "username" }, "username"],
    [{ autocomplete: "one-time-code", maxLength: 6 }, "otp"],
    [{ label: "Código de verificação", maxLength: 6, inputmode: "numeric" }, "otp"],
    [{ label: "Número do cartão" }, "cc-number"],
    [{ label: "CVV" }, "cc-csc"],
    [{ type: "search" }, "search"],
    [{ placeholder: "Pesquisar" }, "search"],
  ])("%j → %s", (signals, expected) => {
    expect(type(signals)).toBe(expected);
  });

  it("autocomplete manda, mesmo com rótulo vago", () => {
    expect(type({ autocomplete: "shipping postal-code", label: "Campo 3" })).toBe("postal-code");
    expect(type({ autocomplete: "section-x address-level2" })).toBe("city");
    expect(type({ autocomplete: "bday" })).toBe("birth-date");
    // "off" e lixo aleatório (autocomplete="nope") não contam.
    expect(type({ autocomplete: "off", label: "CPF" })).toBe("cpf");
    expect(type({ autocomplete: "nope", label: "Bairro" })).toBe("neighborhood");
  });

  it("palavras que derrubam o tipo", () => {
    expect(type({ label: "Estado civil" })).not.toBe("state");
    expect(type({ label: "Nome de usuário" })).toBe("username");
    expect(type({ label: "Nome da empresa" })).toBe("company");
    expect(type({ label: "Número do pedido" })).not.toBe("address-number");
    expect(type({ label: "Endereço de e-mail" })).toBe("email");
    expect(type({ label: "Código promocional" })).not.toBe("otp");
    expect(type({ label: "Observações" })).toBeNull();
  });

  it("select de UF e de país pelas opções", () => {
    const ufs = [
      "Selecione",
      "AC",
      "AL",
      "AP",
      "AM",
      "BA",
      "CE",
      "DF",
      "ES",
      "GO",
      "MA",
      "MT",
      "MS",
      "MG",
      "PA",
      "PB",
      "PR",
      "PE",
      "PI",
      "RJ",
      "RN",
      "RS",
      "RO",
      "RR",
      "SC",
      "SP",
      "SE",
      "TO",
    ];
    expect(
      intel.classifyField({ tag: "select", type: "select", name: "x1", options: ufs }).type,
    ).toBe("state");
  });

  it("senha: password, mascarada por CSS ou texto com cara de senha", () => {
    expect(intel.classifyField({ tag: "input", type: "password" })).toMatchObject({
      type: "current-password",
      password: true,
    });
    // Começa como type=text e vira password depois (ou -webkit-text-security).
    expect(intel.classifyField({ tag: "input", type: "text", masked: true })).toMatchObject({
      password: true,
    });
    expect(type({ label: "Senha" })).toBe("current-password");
    expect(type({ name: "txtSenha" })).toBe("current-password");
    expect(type({ id: "userPassword" })).toBe("current-password");
    expect(type({ label: "Esqueci minha senha" })).not.toBe("current-password");
    expect(type({ type: "password", label: "Confirme a senha" })).toBe("confirm-password");
    expect(type({ type: "password", label: "Nova senha" })).toBe("new-password");
    expect(type({ type: "password", autocomplete: "new-password" })).toBe("new-password");
    expect(type({ type: "password", label: "CVV" })).toBe("cc-csc");
    expect(type({ type: "password", autocomplete: "one-time-code", maxLength: 6 })).toBe("otp");
  });
});

describe("formulários", () => {
  it("login clássico: e-mail + senha", () => {
    const form = intel.resolveForm(
      [field({ type: "email", name: "email" }), field({ type: "password", name: "senha" })],
      { buttons: ["Entrar"] },
    );
    expect(form).toMatchObject({ kind: "login", username: 0, password: 1 });
  });

  it("login do Apps Script: sem <form>, rótulos soltos, botão div e senha em texto", () => {
    const form = intel.resolveForm(
      [
        field({ id: "inputUser", nearby: "Login" }),
        field({ id: "inputPass", nearby: "Senha", type: "password" }),
      ],
      { buttons: ["ACESSAR"] },
    );
    expect(form).toMatchObject({ kind: "login", username: 0, password: 1 });
    // Campos sem nome nenhum: o texto antes da senha é o usuário.
    const bare = intel.resolveForm([field({}), field({ type: "password" })]);
    expect(bare).toMatchObject({ kind: "login", username: 0, password: 1 });
    // Senha sem máscara (type=text) com rótulo "Senha".
    const unmasked = intel.resolveForm([field({ label: "CPF" }), field({ label: "Senha" })]);
    expect(unmasked).toMatchObject({ kind: "login", username: 0, password: 1 });
  });

  it("login por CPF com busca no topo da página", () => {
    const form = intel.resolveForm([
      field({ type: "search", placeholder: "Buscar no site" }),
      field({ label: "CPF", maxLength: 14 }),
      field({ type: "password", label: "Senha" }),
    ]);
    expect(form.username).toBe(1);
    expect(form.roles[1]).toBe("username");
    expect(form.kind).toBe("login");
  });

  it("login em etapas: só o e-mail e Próximo", () => {
    const form = intel.resolveForm([field({ type: "email", autocomplete: "username" })], {
      buttons: ["Próximo"],
    });
    expect(form).toMatchObject({ kind: "login-step", username: 0 });
    // Newsletter (só e-mail, botão Assinar) não é login.
    const news = intel.resolveForm([field({ type: "email" })], { buttons: ["Assinar"] });
    expect(news.kind).not.toBe("login-step");
  });

  it("cadastro e troca de senha", () => {
    const signup = intel.resolveForm(
      [
        field({ label: "Nome completo" }),
        field({ type: "email" }),
        field({ type: "password", label: "Senha" }),
        field({ type: "password", label: "Repita a senha" }),
      ],
      { buttons: ["Criar conta"] },
    );
    expect(signup.kind).toBe("signup");
    expect(signup.roles.slice(2)).toEqual(["new-password", "confirm-password"]);
    const change = intel.resolveForm([
      field({ type: "password", label: "Senha atual" }),
      field({ type: "password", label: "Nova senha" }),
      field({ type: "password", label: "Confirmar nova senha" }),
    ]);
    expect(change.kind).toBe("password-change");
    expect(change.roles).toEqual(["current-password", "new-password", "confirm-password"]);
  });

  it("endereço e contato", () => {
    const address = intel.resolveForm([
      field({ label: "CEP" }),
      field({ label: "Rua" }),
      field({ label: "Número" }),
      field({ label: "Bairro" }),
      field({ label: "Cidade" }),
      field({ label: "UF", maxLength: 2 }),
    ]);
    expect(address.kind).toBe("address");
    expect(address.roles).toEqual([
      "postal-code",
      "street",
      "address-number",
      "neighborhood",
      "city",
      "state",
    ]);
    const contact = intel.resolveForm([
      field({ label: "Seu nome" }),
      field({ type: "email" }),
      field({ label: "Telefone" }),
      { ...field({ tag: "textarea", type: "textarea", label: "Mensagem" }) },
    ]);
    expect(contact.kind).toBe("contact");
  });

  it("botões de envio em PT/EN/ES", () => {
    for (const label of ["Entrar", "ACESSAR", "Sign in", "Continuar", "Iniciar sesión", "Logar"])
      expect(intel.isSubmitLabel(label)).toBe(true);
    expect(intel.isSubmitLabel("Esqueci minha senha")).toBe(false);
  });
});

describe("valores e máscaras", () => {
  const values = intel.profileValues({
    name: "Maria Souza Lima",
    email: "maria@exemplo.com",
    tel: "+55 11 91234-5678",
    cpf: "12345678909",
    "postal-code": "01310100",
    state: "São Paulo",
    "birth-date": "31/12/1990",
  });

  it("deriva nome, sobrenome, DDD e UF", () => {
    expect(values["given-name"]).toBe("Maria");
    expect(values["family-name"]).toBe("Souza Lima");
    expect(values["tel-area-code"]).toBe("11");
    expect(values["tel-local"]).toBe("912345678");
    expect(values["state"]).toBe("SP");
  });

  it("formata CPF, CNPJ, CEP e telefone conforme o campo", () => {
    expect(intel.formatValue("cpf", "12345678909")).toBe("123.456.789-09");
    expect(intel.formatValue("cpf", "123.456.789-09", { maxLength: 11 })).toBe("12345678909");
    expect(intel.formatValue("cnpj", "11222333000181")).toBe("11.222.333/0001-81");
    expect(intel.formatValue("postal-code", "01310100")).toBe("01310-100");
    expect(intel.formatValue("postal-code", "01310-100", { maxLength: 8 })).toBe("01310100");
    expect(intel.formatValue("tel", "11912345678")).toBe("(11) 91234-5678");
    expect(intel.formatValue("tel", "1133334444")).toBe("(11) 3333-4444");
    expect(intel.formatValue("tel", "(11) 91234-5678", { maxLength: 11 })).toBe("11912345678");
    expect(intel.formatValue("tel", "11912345678", { placeholder: "+55 (11) 99999-9999" })).toBe(
      "+55 (11) 91234-5678",
    );
  });

  it("datas: ISO no input date, DD/MM/AAAA no texto, MM/DD com placeholder americano", () => {
    expect(intel.formatValue("birth-date", "31/12/1990", { inputType: "date" })).toBe("1990-12-31");
    expect(intel.formatValue("birth-date", "1990-12-31")).toBe("31/12/1990");
    expect(intel.formatValue("birth-date", "1990-12-31", { placeholder: "MM/DD/YYYY" })).toBe(
      "12/31/1990",
    );
    expect(intel.formatValue("birth-date", "1990-12-31", { maxLength: 8 })).toBe("31121990");
  });

  it("maxlength e UF", () => {
    expect(intel.formatValue("name", "Maria Souza Lima", { maxLength: 5 })).toBe("Maria");
    expect(intel.formatValue("state", "SP", { maxLength: 2 })).toBe("SP");
  });

  it("opção do select por valor, texto, UF ↔ nome e apelido de país", () => {
    const states = [
      { value: "", text: "Selecione" },
      { value: "25", text: "São Paulo" },
      { value: "19", text: "Rio de Janeiro" },
    ];
    expect(intel.matchOption("state", "SP", states)).toBe(1);
    expect(
      intel.matchOption("state", "RJ", [
        { value: "", text: "-" },
        { value: "x", text: "RJ - Rio de Janeiro" },
      ]),
    ).toBe(1);
    expect(
      intel.matchOption("country", "Brasil", [
        { value: "US", text: "United States" },
        { value: "BR", text: "Brazil" },
      ]),
    ).toBe(1);
    expect(intel.matchOption("city", "Campinas", states)).toBe(-1);
  });

  it("aprende pelo valor digitado (texto ou só dígitos)", () => {
    expect(intel.typeForValue(values, "maria@exemplo.com")).toBe("email");
    expect(intel.typeForValue(values, "123.456.789-09")).toBe("cpf");
    expect(intel.typeForValue(values, "qualquer coisa")).toBeNull();
  });

  it("assinatura estável do campo", () => {
    expect(intel.fieldSignature({ tag: "input", type: "text", name: "txtCpf" })).toBe(
      "input:text:txt cpf",
    );
    expect(intel.fieldSignature({ tag: "select", type: "select", label: "Estado" })).toBe(
      "select:select:estado",
    );
  });
});

describe("sites e frames", () => {
  it("frames do mesmo site e o HTML do Apps Script podem; terceiros não", () => {
    const top = "https://script.google.com/macros/s/AKfycbx123/exec";
    expect(
      intel.frameAllowed(
        top,
        "https://n-abc123def-0lu-script.googleusercontent.com/userCodeAppPanel",
      ),
    ).toBe(true);
    expect(intel.frameAllowed("https://mail.google.com/", "https://accounts.google.com/x")).toBe(
      true,
    );
    expect(intel.frameAllowed("https://banco.com.br/", "https://login.banco.com.br/")).toBe(true);
    expect(intel.frameAllowed("https://loja.com/", "https://ads.exemplo.net/")).toBe(false);
    // googleusercontent fora do Apps Script, ou embutido num site qualquer: não.
    expect(
      intel.frameAllowed("https://loja.com/", "https://n-x-script.googleusercontent.com/"),
    ).toBe(false);
    expect(intel.frameAllowed("https://a.github.io/", "https://b.github.io/")).toBe(false);
    // Pares extras (só nos testes e2e).
    expect(
      intel.frameAllowed("http://127.0.0.1:9/", "http://localhost:9/", [
        { top: "127.0.0.1", frame: "localhost" },
      ]),
    ).toBe(true);
  });

  it("chave do site: o app do Apps Script, não o Google inteiro", () => {
    expect(intel.siteKey("https://script.google.com/macros/s/AKfy_1/exec?x=1")).toBe(
      "script.google.com/macros/s/AKfy_1",
    );
    expect(intel.siteKey("https://script.google.com/a/macros/empresa.com/s/AKfy_2/exec")).toBe(
      "script.google.com/macros/s/AKfy_2",
    );
    expect(intel.siteKey("https://www.loja.com.br/cadastro")).toBe("loja.com.br");
    expect(siteKeyOf("https://script.google.com/macros/s/AKfy_1/exec")).toBe(
      intel.siteKey("https://script.google.com/macros/s/AKfy_1/exec"),
    );
  });

  it("logins do cofre de um app do Apps Script não se misturam com o Google", () => {
    const entry = (id: string, url: string): VaultEntry => ({
      id,
      title: id,
      url,
      username: "u",
      password: "p",
      category: "Pessoal",
      updatedAt: 1,
    });
    const entries = [
      entry("google", "https://accounts.google.com"),
      entry("app1", "https://script.google.com/macros/s/APP1/exec"),
      entry("app2", "https://script.google.com/macros/s/APP2/exec"),
    ];
    expect(appsScriptApp("https://script.google.com/macros/s/APP1/exec?page=x")).toBe("APP1");
    expect(
      matchesForUrl(entries, "https://script.google.com/macros/s/APP1/exec").map((e) => e.id),
    ).toEqual(["app1"]);
    expect(matchesForUrl(entries, "https://mail.google.com/").map((e) => e.id)).toEqual(["google"]);
  });

  it("o fonte do motor monta sozinho (é assim que o page-preload o carrega)", () => {
    const built = new Function(`return (${intel.FORM_INTEL_SOURCE})();`)() as typeof intel;
    expect(built.classifyField({ tag: "input", type: "text", label: "CEP" }).type).toBe(
      "postal-code",
    );
  });
});

describe("perfis cifrados (autofill-store)", () => {
  const fakeStorage = (available = true) => ({
    isEncryptionAvailable: () => available,
    encryptString: (text: string) => Buffer.from(`enc:${Buffer.from(text).toString("base64")}`),
    decryptString: (buffer: Buffer) =>
      Buffer.from(buffer.toString().replace(/^enc:/, ""), "base64").toString(),
  });
  const tempFile = () =>
    path.join(fs.mkdtempSync(path.join(os.tmpdir(), "agzos-autofill-")), "autofill-profiles.bin");

  it("grava cifrado, valida e lê de volta", () => {
    const file = tempFile();
    const store = createAutofillStore({ file, safeStorage: fakeStorage() });
    expect(
      store.saveProfile({
        id: "p1",
        name: "Pessoal",
        fields: { cpf: "123.456.789-09", email: "a@b.c", hack: "x" },
      }).ok,
    ).toBe(true);
    expect(fs.readFileSync(file, "utf8")).not.toContain("123.456.789-09");
    const again = createAutofillStore({ file, safeStorage: fakeStorage() });
    expect(again.state().profiles).toEqual([
      expect.objectContaining({
        id: "p1",
        name: "Pessoal",
        fields: { cpf: "123.456.789-09", email: "a@b.c" },
      }),
    ]);
    expect(store.saveProfile({ id: "../x", name: "x" }).ok).toBe(false);
  });

  it("mapeamentos por site, nunca neste site e preferências", () => {
    const store = createAutofillStore({ file: tempFile(), safeStorage: fakeStorage() });
    const url = "https://script.google.com/macros/s/APP1/exec";
    expect(store.setMapping(intel.siteKey(url), "input:text:campo 1", "cpf", "Documento").ok).toBe(
      true,
    );
    expect(store.setMapping("loja.com", "input:text:x", "senha-invalida", "").ok).toBe(false);
    expect(store.mappingsFor(url)).toEqual({ "input:text:campo 1": "cpf" });
    expect(store.mappingsFor("https://script.google.com/macros/s/APP2/exec")).toEqual({});
    store.removeMapping(intel.siteKey(url), "input:text:campo 1");
    expect(store.state().mappings).toEqual([]);
    store.setNever("loja.com.br", true);
    expect(store.isNever("https://www.loja.com.br/checkout")).toBe(true);
    store.setSettings({ learn: false, forms: "sim" as unknown as boolean });
    expect(store.state().settings).toEqual({ forms: true, suggest: true, learn: false });
  });

  it("sem chaveiro: recusa gravar (nunca texto puro)", () => {
    const file = tempFile();
    const store = createAutofillStore({ file, safeStorage: fakeStorage(false) });
    expect(store.saveProfile({ id: "p1", name: "Pessoal", fields: {} })).toEqual({
      ok: false,
      error: "insecure",
    });
    expect(fs.existsSync(file)).toBe(false);
    expect(store.state().available).toBe(false);
  });
});

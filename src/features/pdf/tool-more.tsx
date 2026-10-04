import {
  Copy,
  Download,
  FileImage,
  FileText,
  KeyRound,
  LockOpen,
  ScanText,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

import { pdfCall } from "./client";
import {
  parsePageRanges,
  type CompressLevel,
  type CompressResult,
  type FormValues,
  type OcrPage,
} from "./engine";
import { OCR_LANGUAGES, createOcr } from "./ocr";
import { documentText, pageImage, renderPage } from "./render";
import { derivedName, formatSize, type ToolContext } from "./state";

const LEVELS: { id: CompressLevel; label: string; hint: string }[] = [
  { id: "weak", label: "Fraca", hint: "Qualidade quase igual, ganho menor" },
  { id: "balanced", label: "Equilibrada", hint: "Boa para enviar por e-mail" },
  { id: "strong", label: "Forte", hint: "Menor arquivo, imagens mais simples" },
];

export function CompressTool(ctx: ToolContext) {
  const [level, setLevel] = useState<CompressLevel>("balanced");
  const [result, setResult] = useState<CompressResult | null>(null);
  const compress = async () => {
    const out = await ctx.run("Comprimindo", ({ progress }) =>
      pdfCall<CompressResult>(
        "compress",
        [ctx.doc.bytes, level, ctx.doc.password ?? undefined],
        (fraction) => progress(fraction),
      ),
    );
    if (!out) return;
    setResult(out);
    if (out.after < out.before) {
      await ctx.replace(out.bytes, {
        label: `Comprimido: ${formatSize(out.before)} → ${formatSize(out.after)}`,
        // Comprimir um PDF com senha devolve sem senha (defina de novo em Senha).
        password: null,
      });
    } else {
      ctx.notify("Esse PDF já está compacto: o tamanho não diminuiu.");
    }
  };
  return (
    <div className="pdf-compress">
      <div className="pdf-cards" role="radiogroup" aria-label="Nível de compressão">
        {LEVELS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={level === item.id}
            className={cn("pdf-card", level === item.id && "on")}
            onClick={() => setLevel(item.id)}
          >
            <strong>{item.label}</strong>
            <small>{item.hint}</small>
          </button>
        ))}
      </div>
      <p className="pdf-muted">
        Tamanho atual: {formatSize(ctx.doc.bytes.length)}. Texto e desenhos não mudam; só as
        imagens.
      </p>
      {result && (
        <p className="pdf-result" role="status">
          Antes: <strong>{formatSize(result.before)}</strong> · Depois:{" "}
          <strong>{formatSize(result.after)}</strong>
          {result.before > 0 &&
            ` (${Math.round((1 - result.after / result.before) * 100)}% menor)`}{" "}
          · {result.recompressed} de {result.images} imagens refeitas
        </p>
      )}
      <div className="pdf-footer">
        <button type="button" className="pdf-primary" onClick={() => void compress()}>
          Comprimir
        </button>
      </div>
    </div>
  );
}

export function ConvertTool(ctx: ToolContext) {
  const total = ctx.doc.info.pages.length;
  const [range, setRange] = useState("");
  const [format, setFormat] = useState<"image/png" | "image/jpeg">("image/png");
  const [dpi, setDpi] = useState(150);
  const [office, setOffice] = useState<{ available: boolean } | null>(null);
  useEffect(() => {
    void ctx.desktop.pdfOffice().then(setOffice);
  }, [ctx.desktop]);
  const pages = () =>
    range.trim() ? parsePageRanges(range, total) : Array.from({ length: total }, (_v, i) => i);

  const toImages = async () => {
    const list = pages();
    const files = await ctx.run("Gerando as imagens", async ({ progress, signal }) => {
      const out: { name: string; bytes: Uint8Array }[] = [];
      for (const [step, index] of list.entries()) {
        if (signal.cancelled) return null;
        out.push({
          name: derivedName(
            ctx.doc.name,
            `página ${index + 1}`,
            format === "image/png" ? "png" : "jpg",
          ),
          bytes: await pageImage(ctx.render, index, dpi, format),
        });
        progress((step + 1) / list.length);
      }
      return out;
    });
    if (files) await ctx.saveMany(files);
  };

  const toText = async () => {
    const text = await ctx.run("Lendo o texto", ({ progress, signal }) =>
      documentText(ctx.render, pages(), progress, signal),
    );
    if (text === null) return;
    if (!text.replace(/--- Página \d+ ---/g, "").trim()) {
      ctx.notify("Esse PDF não tem texto (é escaneado?). Use o OCR primeiro.");
      return;
    }
    await ctx.exportFile(derivedName(ctx.doc.name, "", "txt"), new TextEncoder().encode(text), [
      "txt",
    ]);
  };

  const imagesToPdf = async () => {
    const picked = await ctx.desktop.pdfOpenDialog(ctx.prefs.maxMb);
    if (!picked.ok || !picked.files) return;
    const images = picked.files
      .filter((file) => /\.(png|jpe?g)$/i.test(file.name))
      .map((file) => ({
        bytes: new Uint8Array(file.bytes),
        type: /\.png$/i.test(file.name) ? "png" : "jpeg",
      }));
    if (!images.length) {
      ctx.notify("Escolha imagens PNG ou JPEG.");
      return;
    }
    const bytes = await ctx.run("Montando o PDF", () => pdfCall<Uint8Array>("images", [images]));
    if (bytes) await ctx.openBytes(`Imagens (${images.length}).pdf`, bytes);
  };

  const officeConvert = async (direction: "toPdf" | "fromPdf", target: "docx" | "odt" = "docx") => {
    if (!office?.available) return;
    if (direction === "fromPdf") {
      const out = await ctx.run("Convertendo pelo LibreOffice", () =>
        ctx.desktop.pdfOfficeConvert({
          bytes: ctx.doc.bytes.slice().buffer,
          name: ctx.doc.name,
          to: target,
        }),
      );
      if (!out) return;
      if (!out.ok || !out.bytes) {
        ctx.notify("O LibreOffice não conseguiu converter este PDF.");
        return;
      }
      await ctx.exportFile(
        out.name ?? derivedName(ctx.doc.name, "", target),
        new Uint8Array(out.bytes),
        [target],
      );
      return;
    }
    const picked = await ctx.desktop.pdfOpenDialog(ctx.prefs.maxMb);
    const file = picked.files?.find((item) =>
      /\.(docx?|odt|rtf|xlsx?|ods|pptx?|odp)$/i.test(item.name),
    );
    if (!file) {
      if (picked.ok)
        ctx.notify("Escolha um documento do Office (Word, Excel, PowerPoint ou LibreOffice).");
      return;
    }
    const out = await ctx.run("Convertendo pelo LibreOffice", () =>
      ctx.desktop.pdfOfficeConvert({ bytes: file.bytes, name: file.name, to: "pdf" }),
    );
    if (!out) return;
    if (!out.ok || !out.bytes) {
      ctx.notify("O LibreOffice não conseguiu converter esse documento.");
      return;
    }
    await ctx.openBytes(out.name ?? derivedName(file.name, ""), new Uint8Array(out.bytes));
  };

  return (
    <div className="pdf-convert">
      <section className="pdf-section">
        <h3>
          <FileImage aria-hidden="true" /> PDF → imagens
        </h3>
        <div className="pdf-grid3">
          <label className="pdf-field">
            Formato
            <select
              value={format}
              onChange={(event) => setFormat(event.target.value as typeof format)}
            >
              <option value="image/png">PNG</option>
              <option value="image/jpeg">JPEG</option>
            </select>
          </label>
          <label className="pdf-field">
            Resolução
            <select value={dpi} onChange={(event) => setDpi(Number(event.target.value))}>
              <option value={72}>72 dpi (tela)</option>
              <option value={150}>150 dpi</option>
              <option value={300}>300 dpi (impressão)</option>
            </select>
          </label>
          <label className="pdf-field">
            Páginas
            <input
              value={range}
              placeholder={`Todas (1-${total})`}
              onChange={(event) => setRange(event.target.value)}
            />
          </label>
        </div>
        <button type="button" className="pdf-button" onClick={() => void toImages()}>
          Gerar imagens
        </button>
      </section>
      <section className="pdf-section">
        <h3>
          <FileText aria-hidden="true" /> PDF → texto
        </h3>
        <p className="pdf-muted">
          Grava um .txt com o texto das páginas acima (PDF escaneado precisa de OCR antes).
        </p>
        <button type="button" className="pdf-button" onClick={() => void toText()}>
          Exportar texto
        </button>
      </section>
      <section className="pdf-section">
        <h3>
          <FileImage aria-hidden="true" /> Imagens → PDF
        </h3>
        <p className="pdf-muted">Uma página por imagem (PNG ou JPEG), na ordem escolhida.</p>
        <button type="button" className="pdf-button" onClick={() => void imagesToPdf()}>
          Escolher imagens
        </button>
      </section>
      <section className="pdf-section">
        <h3>Office (Word, Excel, PowerPoint)</h3>
        {office === null ? (
          <p className="pdf-muted">Procurando o LibreOffice…</p>
        ) : office.available ? (
          <>
            <p className="pdf-muted">Pelo LibreOffice deste computador, sem enviar nada.</p>
            <div className="pdf-row">
              <button
                type="button"
                className="pdf-button"
                onClick={() => void officeConvert("fromPdf", "docx")}
              >
                PDF → Word (.docx)
              </button>
              <button
                type="button"
                className="pdf-button"
                onClick={() => void officeConvert("fromPdf", "odt")}
              >
                PDF → .odt
              </button>
              <button
                type="button"
                className="pdf-button"
                onClick={() => void officeConvert("toPdf")}
              >
                Documento → PDF
              </button>
            </div>
          </>
        ) : (
          <p className="pdf-warning" role="note">
            Conversão Office precisa do LibreOffice instalado neste computador (gratuito,
            libreoffice.org). Sem ele, use "PDF → texto" ou "PDF → imagens".
          </p>
        )}
      </section>
    </div>
  );
}

export function SecurityTool(ctx: ToolContext) {
  const [user, setUser] = useState("");
  const [owner, setOwner] = useState("");
  const [repeat, setRepeat] = useState("");
  const protectedNow = ctx.doc.info.encrypted;
  const protect = async () => {
    if (user.length < 4) {
      ctx.notify("Use uma senha com 4 caracteres ou mais.");
      return;
    }
    if (user !== repeat) {
      ctx.notify("As senhas não são iguais.");
      return;
    }
    const bytes = await ctx.run("Cifrando (AES-256)", () =>
      pdfCall<Uint8Array>("protect", [ctx.doc.bytes, user, owner, ctx.doc.password ?? undefined]),
    );
    if (!bytes) return;
    await ctx.replace(bytes, { label: "Senha definida (AES-256)", password: user });
    setUser("");
    setRepeat("");
    setOwner("");
  };
  const unprotect = async () => {
    if (!ctx.doc.password) return;
    const bytes = await ctx.run("Tirando a senha", () =>
      pdfCall<Uint8Array>("unprotect", [ctx.doc.bytes, ctx.doc.password]),
    );
    if (bytes) await ctx.replace(bytes, { label: "Senha removida", password: null });
  };
  return (
    <div className="pdf-security">
      {protectedNow && (
        <section className="pdf-section">
          <h3>
            <LockOpen aria-hidden="true" /> Remover a senha
          </h3>
          <p className="pdf-muted">Este PDF tem senha. O arquivo salvo abre sem pedir nada.</p>
          <button type="button" className="pdf-button" onClick={() => void unprotect()}>
            Remover senha
          </button>
        </section>
      )}
      <section className="pdf-section">
        <h3>
          <KeyRound aria-hidden="true" /> {protectedNow ? "Trocar a senha" : "Definir senha"}
        </h3>
        <p className="pdf-muted">
          AES-256. A senha não é gravada pelo app (só se você marcar "lembrar" ao abrir).
        </p>
        <label className="pdf-field">
          Senha para abrir
          <input
            type="password"
            value={user}
            autoComplete="new-password"
            onChange={(event) => setUser(event.target.value)}
          />
        </label>
        <label className="pdf-field">
          Repita a senha
          <input
            type="password"
            value={repeat}
            autoComplete="new-password"
            onChange={(event) => setRepeat(event.target.value)}
          />
        </label>
        <label className="pdf-field">
          Senha do dono (opcional: libera editar e imprimir)
          <input
            type="password"
            value={owner}
            autoComplete="new-password"
            onChange={(event) => setOwner(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="pdf-primary"
          disabled={!user}
          onClick={() => void protect()}
        >
          Proteger com senha
        </button>
      </section>
    </div>
  );
}

export function FormTool(ctx: ToolContext & { onSign: () => void }) {
  const fields = ctx.doc.info.fields;
  const [values, setValues] = useState<FormValues>(() =>
    Object.fromEntries(
      fields
        .filter((field) => field.type !== "unsupported")
        .map((field) => [field.name, field.value as string | boolean]),
    ),
  );
  const [flatten, setFlatten] = useState(false);
  if (!fields.length) {
    return (
      <div className="pdf-form">
        <p className="pdf-muted">
          Este PDF não tem formulário (campos AcroForm). Use Editar para escrever ou assinar por
          cima.
        </p>
        <button type="button" className="pdf-button" onClick={ctx.onSign}>
          Assinar no editor
        </button>
      </div>
    );
  }
  const fill = async () => {
    const bytes = await ctx.run("Preenchendo o formulário", () =>
      pdfCall<Uint8Array>("form", [ctx.doc.bytes, values, flatten, ctx.doc.password ?? undefined]),
    );
    if (bytes)
      await ctx.replace(bytes, {
        label: flatten ? "Formulário preenchido e travado" : "Formulário preenchido",
      });
  };
  return (
    <div className="pdf-form">
      <ul className="pdf-fields">
        {fields.map((field) => (
          <li key={field.name}>
            {field.type === "checkbox" ? (
              <label className="pdf-check">
                <input
                  type="checkbox"
                  checked={values[field.name] === true}
                  onChange={(event) => setValues({ ...values, [field.name]: event.target.checked })}
                />
                {field.name}
              </label>
            ) : field.type === "choice" ? (
              <label className="pdf-field">
                {field.name}
                <select
                  value={String(values[field.name] ?? "")}
                  onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
                >
                  <option value="">—</option>
                  {field.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            ) : field.type === "text" ? (
              <label className="pdf-field">
                {field.name}
                {field.multiline ? (
                  <textarea
                    rows={3}
                    value={String(values[field.name] ?? "")}
                    onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
                  />
                ) : (
                  <input
                    value={String(values[field.name] ?? "")}
                    onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
                  />
                )}
              </label>
            ) : (
              <span className="pdf-muted">
                {field.name}: tipo de campo não suportado (assinatura digital?)
              </span>
            )}
          </li>
        ))}
      </ul>
      <label className="pdf-check">
        <input
          type="checkbox"
          checked={flatten}
          onChange={(event) => setFlatten(event.target.checked)}
        />
        Travar o formulário (os valores viram parte da página)
      </label>
      <div className="pdf-row">
        <button type="button" className="pdf-button" onClick={ctx.onSign}>
          Assinatura desenhada
        </button>
        <span className="pdf-grow" />
        <button type="button" className="pdf-primary" onClick={() => void fill()}>
          Preencher
        </button>
      </div>
    </div>
  );
}

export function OcrTool(ctx: ToolContext & { onLangs: (langs: string[]) => void }) {
  const total = ctx.doc.info.pages.length;
  const [langs, setLangs] = useState<string[]>(ctx.prefs.ocrLangs);
  const [available, setAvailable] = useState<{ bundled: string[]; downloaded: string[] } | null>(
    null,
  );
  const [range, setRange] = useState("");
  const [text, setText] = useState("");
  const refresh = () => void ctx.desktop.pdfOcrLanguages().then(setAvailable);
  useEffect(refresh, [ctx.desktop]);
  const has = (code: string) =>
    Boolean(available?.bundled.includes(code) || available?.downloaded.includes(code));

  const download = async (code: string, label: string) => {
    const ok = await ctx.confirm(
      `Baixar ${label} para o OCR?`,
      "O arquivo do idioma (de 1 a 10 MB) vem do jsDelivr (pacote @tesseract.js-data). Só o idioma é baixado; nenhum PDF sai do computador.",
    );
    if (!ok) return;
    const result = await ctx.run(`Baixando ${label}`, () => ctx.desktop.pdfOcrDownload(code));
    if (result?.ok) {
      ctx.notify(`${label} pronto para o OCR.`);
      refresh();
    } else if (result) ctx.notify("Não foi possível baixar o idioma (sem internet?).");
  };

  const runOcr = async () => {
    const chosen = langs.filter(has);
    if (!chosen.length) {
      ctx.notify("Escolha ao menos um idioma disponível.");
      return;
    }
    ctx.onLangs(chosen);
    const pages = range.trim()
      ? parsePageRanges(range, total)
      : Array.from({ length: total }, (_v, i) => i);
    const out = await ctx.run("OCR", async ({ progress, signal }) => {
      progress(null, "Ligando o OCR");
      const ocr = await createOcr(ctx.desktop, chosen);
      try {
        const results: OcrPage[] = [];
        const texts: string[] = [];
        for (const [step, index] of pages.entries()) {
          if (signal.cancelled) return null;
          progress(
            step / pages.length,
            `OCR: página ${index + 1} (${step + 1} de ${pages.length})`,
          );
          const canvas = document.createElement("canvas");
          const page = await ctx.render.getPage(index + 1);
          const base = page.getViewport({ scale: 1 });
          // ~200 dpi, sem passar de 3000 px no lado maior.
          const scale = Math.min(200 / 72, 3000 / Math.max(base.width, base.height));
          await renderPage(ctx.render, index, canvas, scale);
          const recognized = await ocr.recognize(canvas);
          results.push({
            page: index,
            width: recognized.width,
            height: recognized.height,
            words: recognized.words,
          });
          texts.push(`--- Página ${index + 1} ---\n${recognized.text.trim()}`);
        }
        progress(1, "Montando o PDF pesquisável");
        const bytes = await pdfCall<Uint8Array>("ocrLayer", [
          ctx.doc.bytes,
          results,
          ctx.doc.password ?? undefined,
        ]);
        return {
          bytes,
          text: texts.join("\n\n"),
          words: results.reduce((sum, item) => sum + item.words.length, 0),
        };
      } finally {
        await ocr.terminate();
      }
    });
    if (!out) return;
    setText(out.text);
    await ctx.replace(out.bytes, { label: `OCR: ${out.words} palavras reconhecidas` });
  };

  return (
    <div className="pdf-ocr">
      <p className="pdf-muted">
        Reconhece o texto das páginas escaneadas e põe uma camada invisível: o PDF fica pesquisável
        e copiável. Roda neste computador.
      </p>
      <fieldset className="pdf-langs">
        <legend>Idiomas</legend>
        {OCR_LANGUAGES.map((lang) => (
          <span key={lang.code} className="pdf-lang">
            <label className="pdf-check">
              <input
                type="checkbox"
                disabled={!has(lang.code)}
                checked={langs.includes(lang.code) && has(lang.code)}
                onChange={(event) =>
                  setLangs((list) =>
                    event.target.checked
                      ? [...list, lang.code]
                      : list.filter((code) => code !== lang.code),
                  )
                }
              />
              {lang.label}
            </label>
            {available && !has(lang.code) && (
              <button
                type="button"
                className="pdf-link"
                onClick={() => void download(lang.code, lang.label)}
              >
                <Download aria-hidden="true" /> Baixar
              </button>
            )}
          </span>
        ))}
      </fieldset>
      <label className="pdf-field">
        Páginas
        <input
          value={range}
          placeholder={`Todas (1-${total})`}
          onChange={(event) => setRange(event.target.value)}
        />
      </label>
      <div className="pdf-footer">
        <button type="button" className="pdf-primary" onClick={() => void runOcr()}>
          <ScanText aria-hidden="true" /> Executar OCR
        </button>
      </div>
      {text && (
        <section className="pdf-section">
          <div className="pdf-row">
            <h3>Texto reconhecido</h3>
            <span className="pdf-grow" />
            <button
              type="button"
              className="pdf-button"
              onClick={() =>
                void ctx.desktop.clipboardWrite(text).then(() => ctx.notify("Texto copiado."))
              }
            >
              <Copy aria-hidden="true" /> Copiar
            </button>
          </div>
          <pre className="pdf-text">{text}</pre>
        </section>
      )}
    </div>
  );
}

const SUMMARY_LANGS = ["português", "inglês", "espanhol"];

export function SummaryTool(ctx: ToolContext) {
  const total = ctx.doc.info.pages.length;
  const [language, setLanguage] = useState("português");
  const [range, setRange] = useState("");
  const [summary, setSummary] = useState("");
  if (!ctx.prefs.ai) {
    return (
      <div className="pdf-summary">
        <p className="pdf-warning" role="note">
          O resumo usa o Agzos AI (Groq): o texto das páginas sai do computador. Ele fica desligado
          até você ligar em Configurações › Recursos › PDF Tools.
        </p>
        <button type="button" className="pdf-button" onClick={ctx.openSettings}>
          Abrir Configurações
        </button>
      </div>
    );
  }
  if (!ctx.online) {
    return (
      <div className="pdf-summary">
        <p className="pdf-warning" role="status">
          Resumo com IA indisponível offline. Editar, comprimir, dividir, juntar, girar e OCR
          continuam funcionando.
        </p>
      </div>
    );
  }
  const summarize = async () => {
    const pages = range.trim()
      ? parsePageRanges(range, total)
      : Array.from({ length: total }, (_v, i) => i);
    const ok = await ctx.confirm(
      "Enviar o texto para o Agzos AI?",
      `O texto de ${pages.length} ${pages.length === 1 ? "página" : "páginas"} de "${ctx.doc.name}" vai para a Groq (provedor do Agzos AI) para gerar o resumo. O arquivo em si não é enviado.`,
    );
    if (!ok) return;
    const requestId = `pdf-${Date.now().toString(36)}`;
    const out = await ctx.run("Resumo com IA", async ({ progress, signal }) => {
      progress(0, "Lendo o texto");
      const text = await documentText(
        ctx.render,
        pages,
        (fraction) => progress(fraction * 0.3, "Lendo o texto"),
        signal,
      );
      if (signal.cancelled) return null;
      if (!text.replace(/--- Página \d+ ---/g, "").trim())
        return { ok: false, error: "empty" } as const;
      const off = ctx.desktop.onPdfProgress((payload) => {
        if (payload.requestId === requestId) progress(0.3 + payload.fraction * 0.7, "Resumindo");
      });
      const watch = window.setInterval(() => {
        if (signal.cancelled) void ctx.desktop.pdfAbort(requestId);
      }, 300);
      try {
        progress(0.3, "Resumindo");
        return await ctx.desktop.pdfSummarize({ requestId, text, language });
      } finally {
        off();
        window.clearInterval(watch);
      }
    });
    if (!out) return;
    if (out.ok && out.text) setSummary(out.text);
    else if (out.error === "empty") ctx.notify("Essas páginas não têm texto. Rode o OCR antes.");
    else if (out.error === "no-key")
      ctx.notify("Configure a chave do Agzos AI em Configurações › Agzos AI.");
    else if (out.error !== "cancelled")
      ctx.notify("O resumo falhou (sem internet ou limite da IA).");
  };
  return (
    <div className="pdf-summary">
      <div className="pdf-grid2">
        <label className="pdf-field">
          Idioma do resumo
          <select value={language} onChange={(event) => setLanguage(event.target.value)}>
            {SUMMARY_LANGS.map((item) => (
              <option key={item} value={item}>
                {item[0]!.toUpperCase() + item.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label className="pdf-field">
          Páginas
          <input
            value={range}
            placeholder={`Todas (1-${total})`}
            onChange={(event) => setRange(event.target.value)}
          />
        </label>
      </div>
      <div className="pdf-footer">
        <button type="button" className="pdf-primary" onClick={() => void summarize()}>
          <Sparkles aria-hidden="true" /> Resumir
        </button>
      </div>
      {summary && (
        <section className="pdf-section">
          <div className="pdf-row">
            <h3>Resumo</h3>
            <span className="pdf-grow" />
            <button
              type="button"
              className="pdf-button"
              onClick={() =>
                void ctx.desktop.clipboardWrite(summary).then(() => ctx.notify("Resumo copiado."))
              }
            >
              <Copy aria-hidden="true" /> Copiar
            </button>
          </div>
          <pre className="pdf-text">{summary}</pre>
        </section>
      )}
    </div>
  );
}

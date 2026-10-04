import {
  CircleHelp,
  Cloud,
  FileText,
  FolderOpen,
  Loader2,
  Save,
  Share,
  Undo2,
  WifiOff,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

import type { DesktopBridge } from "@/features/browser/desktop";
import type { PdfCloudTarget } from "@/features/browser/desktop-v47";
import type { FeaturePrefs } from "@/features/browser/feature-prefs";
import { cn } from "@/lib/utils";

import { PdfToolError, pdfCall, pdfCancelAll } from "./client";
import type { PdfInfo } from "./engine";
import { openForRender, thumbnail } from "./render";
import {
  PDF_TOOLS,
  derivedName,
  formatSize,
  sha256Hex,
  type JobControl,
  type PdfDoc,
  type PdfToolId,
  type ToolContext,
} from "./state";
import { EditTool } from "./tool-edit";
import {
  CompressTool,
  ConvertTool,
  FormTool,
  OcrTool,
  SecurityTool,
  SummaryTool,
} from "./tool-more";
import { MergeTool, OrganizeTool, SplitTool } from "./tool-pages";

export type PdfOpenRequest = { url?: string; path?: string; tabId?: number; at: number };

type Busy = { label: string; fraction: number | null; control: JobControl };
type Ask = { title: string; text: string; resolve: (ok: boolean) => void };
type PasswordAsk = {
  name: string;
  wrong: boolean;
  resolve: (value: { password: string; remember: boolean } | null) => void;
};

const UNDO_LIMIT = 8;

/**
 * agzos://pdf (4.7): PDF Tools local (paridade com o que o Smallpdf faz, sem a marca e
 * sem enviar arquivo). O motor roda no worker; o main só lê e grava arquivos.
 */
export function PdfToolsPage({
  desktop,
  prefs,
  dark,
  request,
  onOpenHelp,
  onOpenSettings,
  onNotice,
  onOpenAiSettings,
}: {
  desktop: DesktopBridge | null;
  prefs: FeaturePrefs["pdf"];
  dark: boolean;
  request: PdfOpenRequest | null;
  onOpenHelp: () => void;
  onOpenSettings: () => void;
  onOpenAiSettings: () => void;
  onNotice: (text: string) => void;
  onLangs?: (langs: string[]) => void;
}) {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [render, setRender] = useState<PDFDocumentProxy | null>(null);
  const [tool, setTool] = useState<PdfToolId>("organize");
  const [busy, setBusy] = useState<Busy | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [passwordAsk, setPasswordAsk] = useState<PasswordAsk | null>(null);
  const [undo, setUndo] = useState<{ doc: PdfDoc; label: string }[]>([]);
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [cloud, setCloud] = useState<PdfCloudTarget[] | null>(null);
  const [toolDialog, setToolDialog] = useState(false);
  const lastRequest = useRef<number | null>(null);

  // Sandbox de temporários do perfil: some ao fechar a ferramenta.
  useEffect(() => {
    if (!desktop) return;
    let id: string | null = null;
    void desktop.pdfSessionStart().then((session) => (id = session.id));
    return () => {
      pdfCancelAll();
      if (id) void desktop.pdfSessionEnd(id);
    };
  }, [desktop]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  // Desenho do documento atual (o pdf.js tem a cópia dele). Só reabre quando os bytes ou
  // a senha mudam, e o anterior só fecha depois que o novo está pronto: a ferramenta
  // aberta nunca usa um documento fechado nem perde o que mostra.
  const bytes = doc?.bytes ?? null;
  const password = doc?.password ?? null;
  const shown = useRef<PDFDocumentProxy | null>(null);
  useEffect(() => {
    if (!bytes) {
      const previous = shown.current;
      shown.current = null;
      setRender(null);
      void previous?.loadingTask.destroy();
      return;
    }
    let cancelled = false;
    void openForRender(bytes, password ?? undefined)
      .then((proxy) => {
        if (cancelled) {
          void proxy.loadingTask.destroy();
          return;
        }
        const previous = shown.current;
        shown.current = proxy;
        setRender(proxy);
        void previous?.loadingTask.destroy();
      })
      .catch(() => !cancelled && onNotice("Não foi possível desenhar este PDF."));
    return () => {
      cancelled = true;
    };
  }, [bytes, password, onNotice]);
  useEffect(
    () => () => {
      void shown.current?.loadingTask.destroy();
      shown.current = null;
    },
    [],
  );

  const askPassword = (name: string, wrong: boolean) =>
    new Promise<{ password: string; remember: boolean } | null>((resolve) =>
      setPasswordAsk({ name, wrong, resolve }),
    );

  const confirm = useCallback(
    (title: string, text: string) =>
      new Promise<boolean>((resolve) => setAsk({ title, text, resolve })),
    [],
  );

  /** Abre bytes: pede senha se precisar (ou usa a lembrada). */
  const load = useCallback(
    async (name: string, path: string, bytes: Uint8Array) => {
      if (!desktop) return;
      if (bytes.length > prefs.maxMb * 1024 * 1024) {
        onNotice(
          `${name} passa do limite de ${prefs.maxMb} MB (Configurações › Recursos › PDF Tools).`,
        );
        return;
      }
      if (!new TextDecoder("latin1").decode(bytes.subarray(0, 1024)).includes("%PDF")) {
        onNotice(`${name} não é um PDF.`);
        return;
      }
      const fingerprint = await sha256Hex(bytes);
      let password: string | null = await desktop.pdfPasswordGet(fingerprint).catch(() => null);
      let remember = false;
      let wrong = false;
      for (;;) {
        try {
          const info = await pdfCall<PdfInfo>("info", [bytes, password ?? undefined]);
          if (remember && password) void desktop.pdfPasswordRemember(fingerprint, password);
          setDoc({ name, path, bytes, password, info, fingerprint, dirty: false });
          setUndo([]);
          return;
        } catch (error) {
          if (!(error instanceof PdfToolError) || !error.password) {
            onNotice(`Não foi possível abrir ${name}: arquivo danificado ou não suportado.`);
            return;
          }
          // Senha lembrada que não serve mais: esquece.
          if (password && error.password === "wrong") void desktop.pdfPasswordForget(fingerprint);
          const answer = await askPassword(name, wrong || error.password === "wrong");
          if (!answer) return;
          password = answer.password;
          remember = answer.remember;
          wrong = true;
        }
      }
    },
    [desktop, prefs.maxMb, onNotice],
  );

  const openBytes = useCallback(
    async (name: string, bytes: Uint8Array) => {
      await load(name, "", bytes);
    },
    [load],
  );

  const openDialog = async () => {
    if (!desktop) return;
    const result = await desktop.pdfOpenDialog(prefs.maxMb);
    if (!result.ok || !result.files?.length) {
      if (result.error === "size")
        onNotice(`${result.name ?? "O arquivo"} passa de ${prefs.maxMb} MB.`);
      return;
    }
    const pdfs = result.files.filter((file) => /\.pdf$/i.test(file.name));
    const first = pdfs[0];
    if (!first) {
      onNotice("Escolha um PDF (imagens e documentos ficam em Converter).");
      return;
    }
    await load(first.name, first.path, new Uint8Array(first.bytes));
    if (pdfs.length > 1) {
      setTool("merge");
      onNotice("Vários PDFs: abra Juntar e adicione os outros.");
    }
  };

  // Pedido de fora: link .pdf, guia em PDF, download concluído.
  useEffect(() => {
    if (!desktop || !request || request.at === lastRequest.current) return;
    lastRequest.current = request.at;
    void (async () => {
      const result = request.path
        ? await desktop.pdfReadPath(request.path, prefs.maxMb)
        : request.url
          ? await desktop.pdfFromUrl(request.url, request.tabId, prefs.maxMb)
          : null;
      if (!result) return;
      if (!result.ok || !result.file) {
        onNotice(
          result.error === "size"
            ? `O PDF passa de ${prefs.maxMb} MB.`
            : result.error === "notpdf"
              ? "Esse endereço não devolveu um PDF."
              : "Não foi possível abrir o PDF.",
        );
        return;
      }
      await load(result.file.name, result.file.path, new Uint8Array(result.file.bytes));
    })();
  }, [desktop, request, prefs.maxMb, load, onNotice]);

  useEffect(() => {
    if (!desktop || !prefs.cloud) {
      setCloud(null);
      return;
    }
    void desktop.pdfCloudTargets().then(setCloud);
  }, [desktop, prefs.cloud]);

  const run = useCallback(
    async <T,>(label: string, job: (control: JobControl) => Promise<T>): Promise<T | null> => {
      const control: JobControl = {
        signal: { cancelled: false },
        progress: (fraction, next) =>
          setBusy((current) =>
            current && current.control === control
              ? { ...current, fraction, label: next ?? current.label }
              : current,
          ),
      };
      setBusy({ label, fraction: null, control });
      try {
        const result = await job(control);
        return control.signal.cancelled ? null : result;
      } catch (error) {
        if (!control.signal.cancelled) {
          onNotice(error instanceof Error && error.message ? error.message : "A operação falhou.");
        }
        return null;
      } finally {
        setBusy((current) => (current?.control === control ? null : current));
      }
    },
    [onNotice],
  );

  const replace = useCallback(
    async (bytes: Uint8Array, change: { label: string; password?: string | null }) => {
      if (!doc) return;
      const password = change.password === undefined ? doc.password : change.password;
      let info: PdfInfo;
      try {
        info = await pdfCall<PdfInfo>("info", [bytes, password ?? undefined]);
      } catch {
        onNotice("O resultado não abriu: nada foi trocado.");
        return;
      }
      setUndo((list) => [{ doc, label: change.label }, ...list].slice(0, UNDO_LIMIT));
      setDoc({ ...doc, bytes, password, info, dirty: true });
      onNotice(`${change.label}. Salve ou exporte quando terminar.`);
    },
    [doc, onNotice],
  );

  const save = async (mode: "same" | "export") => {
    if (!desktop || !doc) return;
    const result = await desktop.pdfSave({
      bytes: doc.bytes.slice().buffer,
      name: mode === "same" ? doc.name : derivedName(doc.name, doc.dirty ? "editado" : ""),
      ...(doc.path ? { path: doc.path } : {}),
      mode,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (result.ok && result.path) {
      const name = result.path.split(/[\\/]/).pop() ?? doc.name;
      setDoc({ ...doc, dirty: false, path: result.path, name });
      onNotice(`Salvo em ${result.path}`);
    } else if (result.error) onNotice("Não foi possível gravar o arquivo.");
  };

  const exportFile = useCallback(
    async (name: string, bytes: Uint8Array, extensions: string[]) => {
      if (!desktop) return;
      const result = await desktop.pdfSave({
        bytes: bytes.slice().buffer,
        name,
        mode: "export",
        filters: [{ name: extensions[0]!.toUpperCase(), extensions }],
      });
      if (result.ok) onNotice(`Salvo em ${result.path}`);
    },
    [desktop, onNotice],
  );

  const saveMany = useCallback(
    async (files: { name: string; bytes: Uint8Array }[]) => {
      if (!desktop || !files.length) return;
      const dir = await desktop.downloadsPickDir("Onde salvar os arquivos");
      if (!dir) return;
      let saved = 0;
      for (const file of files) {
        const result = await desktop.pdfSaveInto({
          dir,
          name: file.name,
          bytes: file.bytes.slice().buffer,
        });
        if (result.ok) saved += 1;
      }
      onNotice(`${saved} ${saved === 1 ? "arquivo salvo" : "arquivos salvos"} em ${dir}`);
    },
    [desktop, onNotice],
  );

  const saveCloud = async (target: PdfCloudTarget) => {
    if (!desktop || !doc) return;
    const ok = await confirm(
      `Salvar em ${target.name}?`,
      `"${doc.name}" vai para a pasta "Agzos PDF" do ${target.name} neste computador (${target.dir}). O app do ${target.name} envia para a nuvem.`,
    );
    if (!ok) return;
    const result = await desktop.pdfCloudSave({
      bytes: doc.bytes.slice().buffer,
      name: doc.name,
      target: target.id,
    });
    onNotice(
      result.ok ? `Salvo em ${result.path}` : `Não foi possível gravar na pasta do ${target.name}.`,
    );
  };

  if (!desktop) {
    return (
      <div className="pdf-tools-page">
        <p className="library-empty">O PDF Tools funciona no app Agzos para computador.</p>
      </div>
    );
  }

  const ctx: ToolContext | null =
    doc && render
      ? {
          desktop,
          doc,
          render,
          prefs,
          online,
          run,
          replace,
          openBytes,
          notify: onNotice,
          saveMany,
          exportFile,
          confirm,
          openSettings: onOpenSettings,
        }
      : null;

  const toolMeta = PDF_TOOLS.find((item) => item.id === tool)!;
  const panel = ctx ? (
    tool === "edit" ? (
      <EditTool key={doc!.fingerprint + doc!.bytes.length} {...ctx} author="Agzos" />
    ) : tool === "organize" ? (
      <OrganizeTool key={doc!.bytes.length + doc!.info.pages.length} {...ctx} />
    ) : tool === "merge" ? (
      <MergeTool {...ctx} />
    ) : tool === "split" ? (
      <SplitTool {...ctx} />
    ) : tool === "compress" ? (
      <CompressTool {...ctx} />
    ) : tool === "convert" ? (
      <ConvertTool {...ctx} />
    ) : tool === "security" ? (
      <SecurityTool {...ctx} />
    ) : tool === "form" ? (
      <FormTool key={doc!.bytes.length} {...ctx} onSign={() => setTool("edit")} />
    ) : tool === "ocr" ? (
      <OcrTool {...ctx} onLangs={() => {}} />
    ) : (
      <SummaryTool {...ctx} openSettings={ctx.prefs.ai ? onOpenAiSettings : onOpenSettings} />
    )
  ) : null;

  return (
    <div className={cn("pdf-tools-page", dark ? "dark" : "agz-light", `dock-${prefs.dock}`)}>
      <header className="pdf-head">
        <div className="pdf-title">
          <FileText aria-hidden="true" />
          <div>
            <h1>PDF Tools</h1>
            <p>
              {doc
                ? `${doc.name}${doc.dirty ? " · não salvo" : ""} · ${doc.info.pages.length} ${doc.info.pages.length === 1 ? "página" : "páginas"} · ${formatSize(doc.bytes.length)}${doc.password ? " · com senha" : ""}`
                : "Editar, juntar, dividir, comprimir, senha e OCR sem sair do computador."}
            </p>
          </div>
        </div>
        <div className="pdf-actions">
          {!online && (
            <span
              className="pdf-offline"
              title="Sem internet: resumo com IA e nuvem ficam indisponíveis"
            >
              <WifiOff aria-hidden="true" /> Offline
            </span>
          )}
          <button type="button" className="pdf-button" onClick={() => void openDialog()}>
            <FolderOpen aria-hidden="true" /> Abrir
          </button>
          {doc && (
            <>
              <button
                type="button"
                className="pdf-button"
                disabled={!undo.length}
                title={undo[0] ? `Desfazer: ${undo[0].label}` : "Nada para desfazer"}
                onClick={() => {
                  const [last, ...rest] = undo;
                  if (!last) return;
                  setDoc(last.doc);
                  setUndo(rest);
                }}
              >
                <Undo2 aria-hidden="true" /> Desfazer
              </button>
              <button
                type="button"
                className="pdf-button"
                disabled={!doc.path || !doc.dirty}
                title={
                  doc.path ? `Gravar por cima de ${doc.path}` : "Veio de um link: use Exportar"
                }
                onClick={() => void save("same")}
              >
                <Save aria-hidden="true" /> Salvar
              </button>
              <button type="button" className="pdf-primary" onClick={() => void save("export")}>
                <Share aria-hidden="true" /> Exportar
              </button>
              {prefs.cloud &&
                online &&
                cloud?.map((target) => (
                  <button
                    key={target.id}
                    type="button"
                    className="pdf-button"
                    onClick={() => void saveCloud(target)}
                  >
                    <Cloud aria-hidden="true" /> {target.name}
                  </button>
                ))}
            </>
          )}
          <button
            type="button"
            className="pdf-icon"
            title="Ajuda do PDF Tools"
            aria-label="Ajuda do PDF Tools"
            onClick={onOpenHelp}
          >
            <CircleHelp />
          </button>
        </div>
      </header>

      {!doc ? (
        <div className="pdf-empty">
          <button type="button" className="pdf-drop" onClick={() => void openDialog()}>
            <FileText aria-hidden="true" />
            <strong>Abrir um PDF</strong>
            <small>
              Até {prefs.maxMb} MB. Também abre pelo link de um PDF (clique direito › "Abrir com PDF
              Tools"), pelo ícone PDF na barra de endereço e pelos downloads.
            </small>
          </button>
          <ul className="pdf-tool-grid">
            {PDF_TOOLS.map((item) => (
              <li key={item.id}>
                <strong>{item.label}</strong>
                <small>{item.hint}</small>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="pdf-body">
          <nav className="pdf-nav" aria-label="Ferramentas do PDF">
            {PDF_TOOLS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={cn("pdf-nav-item", tool === item.id && "on")}
                aria-current={tool === item.id ? "page" : undefined}
                onClick={() => {
                  setTool(item.id);
                  if (prefs.dock === "modal") setToolDialog(true);
                }}
              >
                <strong>{item.label}</strong>
                <small>{!item.offline && !online ? "Indisponível offline" : item.hint}</small>
              </button>
            ))}
          </nav>
          <main className="pdf-main" aria-label={toolMeta.label}>
            {!render ? (
              <p className="pdf-muted">Desenhando o PDF…</p>
            ) : prefs.dock === "modal" && !toolDialog ? (
              <ModalPreview
                render={render}
                count={doc.info.pages.length}
                onOpen={() => setToolDialog(true)}
              />
            ) : prefs.dock === "modal" ? (
              <div
                className="pdf-modal"
                role="dialog"
                aria-modal="true"
                aria-label={toolMeta.label}
              >
                <div className="pdf-modal-card wide">
                  <div className="pdf-row">
                    <h2>{toolMeta.label}</h2>
                    <span className="pdf-grow" />
                    <button
                      type="button"
                      className="pdf-icon"
                      aria-label="Fechar"
                      onClick={() => setToolDialog(false)}
                    >
                      <X />
                    </button>
                  </div>
                  {panel}
                </div>
              </div>
            ) : (
              <>
                <h2 className="pdf-tool-title">{toolMeta.label}</h2>
                {panel}
              </>
            )}
          </main>
        </div>
      )}

      {busy && (
        <div className="pdf-busy" role="status" aria-live="polite">
          <Loader2 className="spin" aria-hidden="true" />
          <div>
            <strong>{busy.label}</strong>
            <div className="download-progress">
              <i
                style={{ width: `${Math.round((busy.fraction ?? 0.35) * 100)}%` }}
                className={cn(busy.fraction === null && "indeterminate")}
              />
            </div>
          </div>
          <button
            type="button"
            className="pdf-button"
            onClick={() => {
              busy.control.signal.cancelled = true;
              pdfCancelAll();
              setBusy(null);
              onNotice("Cancelado.");
            }}
          >
            Cancelar
          </button>
        </div>
      )}

      {ask && (
        <div className="pdf-modal" role="alertdialog" aria-modal="true" aria-label={ask.title}>
          <div className="pdf-modal-card">
            <h3>{ask.title}</h3>
            <p>{ask.text}</p>
            <div className="pdf-row">
              <span className="pdf-grow" />
              <button
                type="button"
                className="pdf-button"
                onClick={() => (ask.resolve(false), setAsk(null))}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="pdf-primary"
                autoFocus
                onClick={() => (ask.resolve(true), setAsk(null))}
              >
                Continuar
              </button>
            </div>
          </div>
        </div>
      )}

      {passwordAsk && <PasswordDialog ask={passwordAsk} onDone={() => setPasswordAsk(null)} />}
    </div>
  );
}

function PasswordDialog({ ask, onDone }: { ask: PasswordAsk; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  return (
    <div className="pdf-modal" role="dialog" aria-modal="true" aria-label="Senha do PDF">
      <form
        className="pdf-modal-card"
        onSubmit={(event) => {
          event.preventDefault();
          if (!password) return;
          ask.resolve({ password, remember });
          onDone();
        }}
      >
        <h3>"{ask.name}" tem senha</h3>
        {ask.wrong && <p className="pdf-warning">Senha incorreta. Tente de novo.</p>}
        <label className="pdf-field">
          Senha
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label className="pdf-check">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
          />
          Lembrar neste computador (cifrada com AES-256, chave no chaveiro do sistema)
        </label>
        <div className="pdf-row">
          <span className="pdf-grow" />
          <button
            type="button"
            className="pdf-button"
            onClick={() => (ask.resolve(null), onDone())}
          >
            Cancelar
          </button>
          <button type="submit" className="pdf-primary" disabled={!password}>
            Abrir
          </button>
        </div>
      </form>
    </div>
  );
}

function ModalPreview({
  render,
  count,
  onOpen,
}: {
  render: PDFDocumentProxy;
  count: number;
  onOpen: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void thumbnail(render, 0, 420).then((next) => alive && setUrl(next));
    return () => {
      alive = false;
    };
  }, [render]);
  return (
    <button type="button" className="pdf-preview" onClick={onOpen}>
      {url && <img src={url} alt="Primeira página" />}
      <span>{count} páginas · clique numa ferramenta à esquerda</span>
    </button>
  );
}

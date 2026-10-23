/**
 * agzos://editor (5.0.3): editor de texto e código com Monaco. Modo bloco de notas para texto
 * simples (.txt, .log, .ini, .csv) e modo código para o resto (com Markdown ao lado). Arquivos
 * vêm do main (editor-files.cjs); a página só guarda o texto e pede leitura e gravação.
 */
import type * as Monaco from "monaco-editor";
import {
  type DragEvent,
  useCallback,
  useDeferredValue,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";

import { Markdown } from "@/features/ai/markdown-view";
import type { DesktopBridge } from "@/features/browser/desktop";
import { cn } from "@/lib/utils";

import type { EditorRead } from "./bridge";
import {
  BASE_FONT_SIZE,
  ENCODING_LABELS,
  EOL_LABELS,
  FORMATTABLE,
  baseNameOf,
  clampFontSize,
  languageForFile,
  modeOf,
  stampOf,
  zoomPercent,
  type Encoding,
  type Eol,
} from "./language";
import { AskDialog, MenuBar, type AskChoice, type AskState, type MenuDef } from "./menus";
import { addRecent, FONTS, readPrefs, writePrefs, type EditorPrefs } from "./prefs";
import { changeSession, docOf, sessionOf, type Doc, type EditorSession } from "./session";
import { DARK_THEME, LIGHT_THEME, languagesOf, loadMonaco } from "./monaco";
import { editorParamsOf, newEditorSession } from "./url";
import "./editor.css";

type Api = typeof Monaco;
type Editor = Monaco.editor.IStandaloneCodeEditor;

export type EditorPageProps = {
  desktop: DesktopBridge | null;
  url: string;
  dark: boolean;
  onNotice: (text: string) => void;
};

/** Contador dos modelos (cada URI do Monaco é única nesta execução). */
let modelSeq = 0;

const ERROR_TEXT: Record<string, string> = {
  binary: "Este arquivo é binário. O editor abre só texto e código.",
  size: "Arquivo maior que 20 MB: o editor não abre.",
  missing: "Arquivo não encontrado.",
  access: "Sem permissão para ler este arquivo.",
  path: "Caminho inválido.",
};

const SAVE_TEXT: Record<string, string> = {
  access: "Sem permissão para gravar este arquivo.",
  size: "O texto é grande demais para gravar.",
};

const isWindows = () => typeof navigator !== "undefined" && /Win/i.test(navigator.platform);

/** Opções do Monaco por modo: bloco de notas enxuto; código com minimapa e guias. */
function optionsOf(mode: "notepad" | "code", prefs: EditorPrefs): Monaco.editor.IEditorOptions {
  const base: Monaco.editor.IEditorOptions = {
    fontFamily: prefs.fontFamily,
    fontSize: prefs.fontSize,
    wordWrap: prefs.wrap ? "on" : "off",
    automaticLayout: true,
    smoothScrolling: true,
    cursorBlinking: "smooth",
    scrollBeyondLastLine: false,
    padding: { top: 8, bottom: 8 },
    renderWhitespace: "selection",
    multiCursorModifier: "alt",
    mouseWheelZoom: false,
    occurrencesHighlight: "singleFile",
    links: true,
  };
  if (mode === "notepad") {
    return {
      ...base,
      minimap: { enabled: false },
      stickyScroll: { enabled: false },
      lineNumbers: "off",
      glyphMargin: false,
      folding: false,
      guides: { indentation: false, bracketPairs: false },
      bracketPairColorization: { enabled: false },
      renderLineHighlight: "line",
    };
  }
  return {
    ...base,
    minimap: { enabled: prefs.minimap, renderCharacters: true, maxColumn: 120 },
    stickyScroll: { enabled: true },
    lineNumbers: "on",
    glyphMargin: false,
    folding: true,
    guides: { indentation: true, bracketPairs: true },
    bracketPairColorization: { enabled: true, independentColorPoolPerBracketType: true },
    renderLineHighlight: "all",
  };
}

/** Atalhos do editor: só valem com o foco dentro da página (não atrapalham a barra). */
function shortcutOf(event: KeyboardEvent): string | null {
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (!mod && !event.altKey) {
    if (key === "F5" && !event.shiftKey) return "datetime";
    if (key === "F1") return "palette";
    return null;
  }
  if (event.altKey) return null;
  if (key === "Tab") return event.shiftKey ? "prevDoc" : "nextDoc";
  if (event.shiftKey) {
    if (key === "s") return "saveAs";
    if (key === "z") return "redo";
    return null;
  }
  switch (key) {
    case "n":
      return "new";
    case "o":
      return "open";
    case "s":
      return "save";
    case "w":
      return "close";
    case "f":
      return "find";
    case "h":
      return "replace";
    case "g":
      return "goto";
    case "y":
      return "redo";
    case "=":
    case "+":
      return "zoomIn";
    case "-":
    case "_":
      return "zoomOut";
    case "0":
      return "zoomReset";
    default:
      return null;
  }
}

/** Posição do cursor e tamanho da seleção (barra de status). */
type Cursor = { line: number; column: number; selected: number };

/** Atualiza o "alterado" de um documento a partir da versão do modelo. */
function syncDirty(session: EditorSession, id: number) {
  const doc = docOf(session, id);
  if (!doc) return;
  const dirty = doc.model.getAlternativeVersionId() !== doc.savedVersion || doc.metaChanged;
  if (dirty !== doc.dirty) doc.dirty = dirty;
  session.notify?.();
}

export function EditorPage({ desktop, url, dark, onNotice }: EditorPageProps) {
  const params = editorParamsOf(url);
  const [fallbackSession] = useState(newEditorSession);
  const sessionId = params.session ?? fallbackSession;
  const session = sessionOf(sessionId);
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const [api, setApi] = useState<Api | null>(null);
  const [prefs, setPrefs] = useState<EditorPrefs>(readPrefs);
  const [cursor, setCursor] = useState<Cursor>({ line: 1, column: 1, selected: 0 });
  const [ask, setAsk] = useState<AskState | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const syncing = useRef(false);
  // Os callbacks das assinaturas (eventos do main, teclado) leem sempre o valor atual.
  const latest = useRef({ desktop, api, prefs, onNotice, dark, ask });
  latest.current = { desktop, api, prefs, onNotice, dark, ask };

  const updatePrefs = useCallback((change: (value: EditorPrefs) => EditorPrefs) => {
    setPrefs((value) => {
      const next = change(value);
      writePrefs(next);
      return next;
    });
  }, []);

  useEffect(() => {
    session.notify = rerender;
    return () => {
      if (session.notify === rerender) session.notify = null;
    };
  }, [session]);

  useEffect(() => {
    let alive = true;
    void loadMonaco().then((loaded) => {
      if (alive) setApi(() => loaded);
    });
    return () => {
      alive = false;
    };
  }, []);

  const active = docOf(session, session.activeId);
  const activeMode = active?.mode ?? "code";
  const markdown = active?.language === "markdown";
  const showPreview = markdown && prefs.view !== "editor";

  /** Documento novo a partir do texto (modelo do Monaco com o idioma do nome). */
  const createDoc = useCallback(
    (
      monaco: Api,
      init: {
        path: string | null;
        name: string;
        text: string;
        encoding: Encoding;
        eol: Eol;
        mtime: number | null;
      },
    ): Doc => {
      const id = session.nextId;
      changeSession(session, (state) => {
        state.nextId += 1;
      });
      const language = languageForFile(init.name, languagesOf(monaco));
      const model = monaco.editor.createModel(
        init.text,
        language,
        monaco.Uri.parse(`inmemory://agzos-editor/${sessionId}/${id}-${++modelSeq}`),
      );
      model.updateOptions({ tabSize: 4, insertSpaces: true });
      if (init.eol === "crlf") model.setEOL(monaco.editor.EndOfLineSequence.CRLF);
      const doc: Doc = {
        id,
        path: init.path,
        name: init.name,
        encoding: init.encoding,
        eol: init.eol,
        language,
        mode: modeOf(language),
        dirty: false,
        savedVersion: model.getAlternativeVersionId(),
        metaChanged: false,
        mtime: init.mtime,
        changedOnDisk: false,
        missing: false,
        model,
        listener: null,
      };
      doc.listener = model.onDidChangeContent(() => syncDirty(session, id));
      changeSession(session, (state) => {
        state.docs.push(doc);
        state.activeId = id;
      });
      return doc;
    },
    [session, sessionId],
  );

  const newUntitled = useCallback(() => {
    const monaco = latest.current.api;
    if (!monaco) return;
    createDoc(monaco, {
      path: null,
      name: "Sem título",
      text: "",
      encoding: "utf-8",
      eol: isWindows() ? "crlf" : "lf",
      mtime: null,
    });
  }, [createDoc]);

  const watch = useCallback((file: string) => {
    void latest.current.desktop?.editorWatch(file);
  }, []);
  const unwatch = useCallback((file: string) => {
    void latest.current.desktop?.editorUnwatch(file);
  }, []);

  const openPaths = useCallback(
    async (paths: string[]) => {
      const { desktop: bridge, api: monaco } = latest.current;
      if (!bridge || !monaco) return;
      for (const file of paths.slice(0, 20)) {
        const open = session.docs.find((doc) => doc.path === file);
        if (open) {
          changeSession(session, (state) => {
            state.activeId = open.id;
          });
          continue;
        }
        const result: EditorRead = await bridge.editorRead(file);
        if (!result.ok) {
          latest.current.onNotice(ERROR_TEXT[result.error] ?? "Não foi possível abrir o arquivo.");
          if (result.error === "missing") {
            updatePrefs((value) => ({
              ...value,
              recent: value.recent.filter((item) => item !== file),
            }));
          }
          continue;
        }
        // Um "Sem título" vazio e limpo sai do lugar do primeiro arquivo aberto.
        const blank = session.docs.length === 1 ? session.docs[0] : undefined;
        if (blank && !blank.path && !blank.dirty && blank.model.getValue() === "") {
          blank.listener?.dispose();
          blank.model.dispose();
          changeSession(session, (state) => {
            state.docs = [];
          });
        }
        createDoc(monaco, {
          path: result.path,
          name: result.name,
          text: result.text,
          encoding: result.encoding,
          eol: result.eol,
          mtime: result.mtime,
        });
        watch(result.path);
        updatePrefs((value) => ({ ...value, recent: addRecent(value.recent, result.path) }));
      }
    },
    [createDoc, session, updatePrefs, watch],
  );

  /** Pergunta modal; a resposta vem da escolha do usuário. */
  const askUser = useCallback(
    (title: string, text: string, buttons: AskState["buttons"]) =>
      new Promise<AskChoice>((resolve) => {
        setAsk({
          title,
          text,
          buttons,
          resolve: (value) => {
            setAsk(null);
            resolve(value);
          },
        });
      }),
    [],
  );

  const markSaved = useCallback(
    (doc: Doc, mtime?: number) => {
      changeSession(session, () => {
        doc.savedVersion = doc.model.getAlternativeVersionId();
        doc.metaChanged = false;
        doc.dirty = false;
        doc.changedOnDisk = false;
        doc.missing = false;
        if (mtime !== undefined) doc.mtime = mtime;
      });
    },
    [session],
  );

  const downloadDoc = useCallback(
    (doc: Doc) => {
      const blob = new Blob([doc.model.getValue()], { type: "text/plain;charset=utf-8" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = doc.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      markSaved(doc);
    },
    [markSaved],
  );

  /** "Salvar como": escolhe o caminho no diálogo do sistema (o main libera a gravação). */
  const saveAs = useCallback(
    async (doc: Doc): Promise<boolean> => {
      const { desktop: bridge, api: monaco } = latest.current;
      if (!bridge) {
        downloadDoc(doc);
        return true;
      }
      const result = await bridge.editorSaveAs({
        name: doc.name,
        text: doc.model.getValue(),
        encoding: doc.encoding,
        eol: doc.eol,
      });
      if (!result.ok) {
        if (result.error !== "canceled") {
          latest.current.onNotice(SAVE_TEXT[result.error] ?? "Não foi possível gravar o arquivo.");
        }
        return false;
      }
      const file = result.file;
      if (!file) return false;
      const previous = doc.path;
      if (previous) unwatch(previous);
      changeSession(session, () => {
        doc.path = file;
        doc.name = baseNameOf(file);
        if (monaco) {
          doc.language = languageForFile(doc.name, languagesOf(monaco));
          monaco.editor.setModelLanguage(doc.model, doc.language);
        }
        doc.mode = modeOf(doc.language);
      });
      watch(file);
      markSaved(doc, result.mtime);
      updatePrefs((value) => ({ ...value, recent: addRecent(value.recent, file) }));
      if (result.lossy)
        latest.current.onNotice("Alguns caracteres não cabem em Latin-1 e viraram '?'.");
      return true;
    },
    [downloadDoc, markSaved, session, unwatch, updatePrefs, watch],
  );

  /** Gravar: no mesmo arquivo; sem arquivo, o "Salvar como". */
  const saveDoc = useCallback(
    async (doc: Doc, forceAs = false): Promise<boolean> => {
      const bridge = latest.current.desktop;
      if (!bridge) {
        downloadDoc(doc);
        return true;
      }
      if (!doc.path || forceAs) return saveAs(doc);
      const result = await bridge.editorSave({
        file: doc.path,
        text: doc.model.getValue(),
        encoding: doc.encoding,
        eol: doc.eol,
      });
      if (result.ok) {
        markSaved(doc, result.mtime);
        if (result.lossy)
          latest.current.onNotice("Alguns caracteres não cabem em Latin-1 e viraram '?'.");
        return true;
      }
      if (result.error === "forbidden") return saveAs(doc);
      latest.current.onNotice(SAVE_TEXT[result.error] ?? "Não foi possível gravar o arquivo.");
      return false;
    },
    [downloadDoc, markSaved, saveAs],
  );

  const closeDoc = useCallback(
    async (id: number) => {
      const doc = docOf(session, id);
      if (!doc) return;
      if (doc.dirty) {
        const choice = await askUser(
          "Fechar sem salvar?",
          `${doc.name} tem alterações que ainda não foram gravadas.`,
          [
            { label: "Salvar", value: "save", primary: true },
            { label: "Não salvar", value: "discard" },
            { label: "Cancelar", value: "cancel" },
          ],
        );
        if (choice === "cancel") return;
        if (choice === "save" && !(await saveDoc(doc))) return;
      }
      if (doc.path) unwatch(doc.path);
      doc.listener?.dispose();
      doc.model.dispose();
      session.views.delete(id);
      changeSession(session, (state) => {
        const index = state.docs.findIndex((item) => item.id === id);
        state.docs.splice(index, 1);
        if (state.activeId === id) {
          state.activeId = (state.docs[index] ?? state.docs[index - 1] ?? null)?.id ?? null;
        }
      });
      if (session.docs.length === 0) newUntitled();
    },
    [askUser, newUntitled, saveDoc, session, unwatch],
  );

  const activate = (id: number) => changeSession(session, (state) => (state.activeId = id));

  /** Recarrega do disco (descarta o que estava na tela). */
  const reloadDoc = useCallback(
    async (doc: Doc) => {
      const { desktop: bridge, api: monaco } = latest.current;
      if (!bridge || !doc.path || !monaco) return;
      const result = await bridge.editorRead(doc.path);
      if (!result.ok) {
        changeSession(session, () => {
          doc.missing = true;
        });
        return;
      }
      doc.model.setValue(result.text);
      doc.model.setEOL(
        result.eol === "crlf"
          ? monaco.editor.EndOfLineSequence.CRLF
          : monaco.editor.EndOfLineSequence.LF,
      );
      changeSession(session, () => {
        doc.encoding = result.encoding;
        doc.eol = result.eol;
      });
      markSaved(doc, result.mtime);
    },
    [markSaved, session],
  );

  // Mudança no disco (fs.watch no main): sem alterações, recarrega; com alterações, pergunta.
  useEffect(() => {
    if (!desktop) return;
    return desktop.onEditorChanged(({ file }) => {
      const doc = session.docs.find((item) => item.path === file);
      const bridge = latest.current.desktop;
      if (!doc || !bridge) return;
      void bridge.editorStat(file).then((stat) => {
        if (!stat.ok) return;
        if (!stat.exists) {
          changeSession(session, () => {
            doc.missing = true;
          });
          return;
        }
        if (doc.mtime !== null && stat.mtime === doc.mtime) return;
        if (!doc.dirty) void reloadDoc(doc);
        else
          changeSession(session, () => {
            doc.changedOnDisk = true;
          });
      });
    });
  }, [desktop, reloadDoc, session]);

  // Editor do Monaco: cria uma vez (quando o Monaco carrega) e entrega os modelos da sessão.
  useEffect(() => {
    const host = hostRef.current;
    if (!api || !host) return;
    const editor = api.editor.create(host, {
      model: null,
      theme: latest.current.dark ? DARK_THEME : LIGHT_THEME,
      ...optionsOf("code", latest.current.prefs),
    });
    editorRef.current = editor;
    const updateCursor = () => {
      const position = editor.getPosition();
      const selection = editor.getSelection();
      const model = editor.getModel();
      setCursor({
        line: position?.lineNumber ?? 1,
        column: position?.column ?? 1,
        selected:
          selection && model && !selection.isEmpty() ? model.getValueLengthInRange(selection) : 0,
      });
    };
    const subscriptions = [
      editor.onDidChangeCursorPosition(updateCursor),
      editor.onDidChangeCursorSelection(updateCursor),
      editor.onDidScrollChange(() => {
        const preview = previewRef.current;
        if (!preview || syncing.current) return;
        const layout = editor.getLayoutInfo().height;
        const room = Math.max(1, editor.getScrollHeight() - layout);
        syncing.current = true;
        preview.scrollTop =
          (editor.getScrollTop() / room) * (preview.scrollHeight - preview.clientHeight);
        requestAnimationFrame(() => (syncing.current = false));
      }),
    ];
    // Ctrl+roda do mouse muda o zoom do editor (e não o da página).
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();
      updatePrefs((value) => ({
        ...value,
        fontSize: clampFontSize(value.fontSize + (event.deltaY < 0 ? 1 : -1)),
      }));
    };
    host.addEventListener("wheel", wheel, { capture: true, passive: false });
    if (session.docs.length === 0) {
      if (params.file) void openPaths([params.file]);
      else newUntitled();
    }
    return () => {
      host.removeEventListener("wheel", wheel, { capture: true });
      for (const subscription of subscriptions) subscription.dispose();
      const model = editor.getModel();
      const doc = session.docs.find((item) => item.model === model);
      const view = editor.saveViewState();
      if (doc && view) session.views.set(doc.id, view);
      editor.dispose();
      editorRef.current = null;
    };
    // A sessão e os callbacks são estáveis; o editor só nasce quando o Monaco carrega.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  // Documento ativo no editor: troca o modelo e volta à posição que ele tinha.
  useEffect(() => {
    const editor = editorRef.current;
    if (!api || !editor) return;
    const doc = docOf(session, session.activeId);
    if (!doc) {
      editor.setModel(null);
      return;
    }
    if (editor.getModel() === doc.model) return;
    const previous = editor.getModel();
    const previousDoc = session.docs.find((item) => item.model === previous);
    const view = editor.saveViewState();
    if (previousDoc && view) session.views.set(previousDoc.id, view);
    editor.setModel(doc.model);
    const saved = session.views.get(doc.id);
    if (saved) editor.restoreViewState(saved);
    editor.focus();
    const position = editor.getPosition();
    const selection = editor.getSelection();
    setCursor({
      line: position?.lineNumber ?? 1,
      column: position?.column ?? 1,
      selected: selection && !selection.isEmpty() ? doc.model.getValueLengthInRange(selection) : 0,
    });
  }, [api, session, session.activeId, active, rerender]);

  // Opções e tema seguem o modo do documento e as preferências.
  useEffect(() => {
    const editor = editorRef.current;
    if (!api || !editor) return;
    editor.updateOptions(optionsOf(activeMode, prefs));
  }, [api, activeMode, prefs]);

  useEffect(() => {
    if (api) api.editor.setTheme(dark ? DARK_THEME : LIGHT_THEME);
  }, [api, dark]);

  // Preview do Markdown: o texto vem adiado para a digitação não travar.
  const source = active && showPreview ? active.model.getValue() : "";
  const previewText = useDeferredValue(source);

  // Atalhos: captura na fase de captura, com o foco dentro da página (a barra segue igual).
  const runRef = useRef<(id: string) => void>(() => {});
  runRef.current = (id: string) => {
    const editor = editorRef.current;
    const current = latest.current;
    const doc = docOf(session, session.activeId);
    const action = (name: string) => editor?.getAction(name)?.run();
    switch (id) {
      case "new":
        newUntitled();
        return;
      case "open":
        if (current.desktop) {
          void current.desktop.editorOpen().then(({ paths }) => openPaths(paths));
        } else {
          fileInput.current?.click();
        }
        return;
      case "save":
        if (doc) void saveDoc(doc);
        return;
      case "saveAs":
        if (doc) void saveAs(doc);
        return;
      case "close":
        if (doc) void closeDoc(doc.id);
        return;
      case "find":
        void action("actions.find");
        return;
      case "replace":
        void action("editor.action.startFindReplaceAction");
        return;
      case "goto":
        void action("editor.action.gotoLine");
        return;
      case "palette":
        void action("editor.action.quickCommand");
        return;
      case "redo":
        editor?.trigger("editor", "redo", null);
        return;
      case "datetime":
        if (editor) {
          const range = editor.getSelection();
          if (range)
            editor.executeEdits("datetime", [
              { range, text: stampOf(new Date()), forceMoveMarkers: true },
            ]);
          editor?.pushUndoStop();
        }
        return;
      case "zoomIn":
        updatePrefs((value) => ({ ...value, fontSize: clampFontSize(value.fontSize + 1) }));
        return;
      case "zoomOut":
        updatePrefs((value) => ({ ...value, fontSize: clampFontSize(value.fontSize - 1) }));
        return;
      case "zoomReset":
        updatePrefs((value) => ({ ...value, fontSize: BASE_FONT_SIZE }));
        return;
      case "nextDoc":
      case "prevDoc": {
        const list = session.docs;
        if (list.length < 2) return;
        const index = list.findIndex((item) => item.id === session.activeId);
        const step = id === "nextDoc" ? 1 : -1;
        activate(list[(index + step + list.length) % list.length]!.id);
        return;
      }
      default:
        return;
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const root = rootRef.current;
      if (!root || !root.contains(document.activeElement)) return;
      const id = shortcutOf(event);
      if (!id) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      runRef.current(id);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    const bridge = latest.current.desktop;
    const files = Array.from(event.dataTransfer.files);
    if (bridge) {
      const paths = files.map((file) => bridge.filePathOf(file)).filter((item) => item !== "");
      void openPaths(paths);
      return;
    }
    void openWebFiles(files);
  };

  /** Sem o app (web): os arquivos são lidos pelo navegador e gravados como download. */
  async function openWebFiles(files: File[]) {
    const monaco = latest.current.api;
    if (!monaco) return;
    for (const file of files.slice(0, 20)) {
      const raw = await file.text();
      const text = raw.replace(/\r\n?/g, "\n");
      createDoc(monaco, {
        path: null,
        name: file.name,
        text,
        encoding: "utf-8",
        eol: raw.includes("\r\n") ? "crlf" : "lf",
        mtime: null,
      });
    }
  }

  const updateLanguage = (language: string) => {
    if (!active || !api) return;
    api.editor.setModelLanguage(active.model, language);
    changeSession(session, () => {
      active.language = language;
      active.mode = modeOf(language);
    });
  };

  const setEncoding = (encoding: Encoding) => {
    if (!active) return;
    changeSession(session, () => {
      active.encoding = encoding;
      active.metaChanged = true;
      active.dirty = true;
    });
  };

  const setEol = (eol: Eol) => {
    if (!active || !api) return;
    active.model.setEOL(
      eol === "crlf" ? api.editor.EndOfLineSequence.CRLF : api.editor.EndOfLineSequence.LF,
    );
    changeSession(session, () => {
      active.eol = eol;
      active.metaChanged = true;
      active.dirty = true;
    });
  };

  const formatDocument = () => {
    if (!active || !editorRef.current) return;
    if (!FORMATTABLE.has(active.language)) {
      latest.current.onNotice(
        "Este idioma não tem formatador: use o modo código com JSON, CSS, HTML ou TypeScript.",
      );
      return;
    }
    void editorRef.current.getAction("editor.action.formatDocument")?.run();
  };

  const edit = (name: string) => () => {
    const editor = editorRef.current;
    if (!editor) return;
    if (name === "undo" || name === "redo") editor.trigger("editor", name, null);
    else void editor.getAction(name)?.run();
  };

  const menus: MenuDef[] = [
    {
      id: "file",
      label: "Arquivo",
      items: [
        { label: "Novo", shortcut: "Ctrl+N", run: newUntitled },
        { label: "Abrir…", shortcut: "Ctrl+O", run: () => runRef.current("open") },
        { label: "Salvar", shortcut: "Ctrl+S", run: () => active && void saveDoc(active) },
        {
          label: "Salvar como…",
          shortcut: "Ctrl+Shift+S",
          run: () => active && void saveAs(active),
        },
        { sep: true },
        ...(prefs.recent.length
          ? prefs.recent.slice(0, 8).map((file) => ({
              label: `Recente: ${baseNameOf(file)}`,
              run: () => void openPaths([file]),
            }))
          : [{ label: "Nenhum arquivo recente", disabled: true, run: () => {} }]),
        { sep: true },
        {
          label: "Fechar arquivo",
          shortcut: "Ctrl+W",
          run: () => active && void closeDoc(active.id),
        },
      ],
    },
    {
      id: "edit",
      label: "Editar",
      items: [
        { label: "Desfazer", shortcut: "Ctrl+Z", run: edit("undo") },
        { label: "Refazer", shortcut: "Ctrl+Y", run: edit("redo") },
        { sep: true },
        { label: "Recortar", shortcut: "Ctrl+X", run: edit("editor.action.clipboardCutAction") },
        { label: "Copiar", shortcut: "Ctrl+C", run: edit("editor.action.clipboardCopyAction") },
        { label: "Colar", shortcut: "Ctrl+V", run: edit("editor.action.clipboardPasteAction") },
        { sep: true },
        { label: "Localizar…", shortcut: "Ctrl+F", run: () => runRef.current("find") },
        { label: "Substituir…", shortcut: "Ctrl+H", run: () => runRef.current("replace") },
        { label: "Ir para a linha…", shortcut: "Ctrl+G", run: () => runRef.current("goto") },
        { sep: true },
        { label: "Selecionar tudo", shortcut: "Ctrl+A", run: edit("editor.action.selectAll") },
        { label: "Data e hora", shortcut: "F5", run: () => runRef.current("datetime") },
      ],
    },
    {
      id: "format",
      label: "Formatar",
      items: [
        {
          label: "Quebra automática",
          checked: prefs.wrap,
          run: () => updatePrefs((value) => ({ ...value, wrap: !value.wrap })),
        },
        { sep: true },
        ...FONTS.map((font) => ({
          label: `Fonte: ${font.label}`,
          checked: prefs.fontFamily === font.value,
          run: () => updatePrefs((value) => ({ ...value, fontFamily: font.value })),
        })),
        { sep: true },
        { label: "Aumentar fonte", shortcut: "Ctrl+=", run: () => runRef.current("zoomIn") },
        { label: "Diminuir fonte", shortcut: "Ctrl+-", run: () => runRef.current("zoomOut") },
        { label: "Tamanho padrão", shortcut: "Ctrl+0", run: () => runRef.current("zoomReset") },
        { sep: true },
        {
          label: "Formatar documento",
          shortcut: "Shift+Alt+F",
          disabled: !active || !FORMATTABLE.has(active.language),
          run: formatDocument,
        },
      ],
    },
    {
      id: "view",
      label: "Exibir",
      items: [
        {
          label: "Barra de status",
          checked: prefs.statusBar,
          run: () => updatePrefs((value) => ({ ...value, statusBar: !value.statusBar })),
        },
        {
          label: "Minimapa",
          checked: prefs.minimap,
          run: () => updatePrefs((value) => ({ ...value, minimap: !value.minimap })),
        },
        { sep: true },
        {
          label: "Modo de código",
          checked: activeMode === "code",
          disabled: !active,
          run: () =>
            active &&
            changeSession(session, () => {
              active.mode = active.mode === "code" ? "notepad" : "code";
            }),
        },
        ...(markdown
          ? [
              { sep: true as const },
              {
                label: "Markdown: editor e visualização",
                checked: prefs.view === "split",
                run: () => updatePrefs((value) => ({ ...value, view: "split" })),
              },
              {
                label: "Markdown: só o editor",
                checked: prefs.view === "editor",
                run: () => updatePrefs((value) => ({ ...value, view: "editor" })),
              },
              {
                label: "Markdown: só a visualização",
                checked: prefs.view === "preview",
                run: () => updatePrefs((value) => ({ ...value, view: "preview" })),
              },
            ]
          : []),
        { sep: true },
        { label: "Paleta de comandos", shortcut: "F1", run: () => runRef.current("palette") },
      ],
    },
    {
      id: "tools",
      label: "Ferramentas",
      items: [
        ...(Object.keys(ENCODING_LABELS) as Encoding[]).map((encoding) => ({
          label: `Codificação: ${ENCODING_LABELS[encoding]}`,
          checked: active?.encoding === encoding,
          disabled: !active,
          run: () => setEncoding(encoding),
        })),
        { sep: true },
        ...(Object.keys(EOL_LABELS) as Eol[]).map((eol) => ({
          label: `Fim de linha: ${EOL_LABELS[eol]}`,
          checked: active?.eol === eol,
          disabled: !active,
          run: () => setEol(eol),
        })),
      ],
    },
  ];

  const hasDocs = session.docs.length > 0;

  return (
    <div
      className={cn("ed-root", dark && "ed-dark")}
      ref={rootRef}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      data-mode={activeMode}
    >
      <MenuBar menus={menus} />
      <div className="ed-tabs" role="tablist" aria-label="Arquivos abertos">
        {session.docs.map((doc) => (
          <div
            key={doc.id}
            className="ed-tab"
            role="tab"
            aria-selected={doc.id === session.activeId}
            data-active={doc.id === session.activeId || undefined}
            tabIndex={0}
            onClick={() => activate(doc.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter") activate(doc.id);
            }}
            title={doc.path ?? doc.name}
          >
            <span className="ed-tab-name">{doc.name}</span>
            {doc.dirty && (
              <span className="ed-dirty" aria-label="Alterado">
                ●
              </span>
            )}
            <button
              type="button"
              className="ed-tab-close"
              aria-label={`Fechar ${doc.name}`}
              onClick={(event) => {
                event.stopPropagation();
                void closeDoc(doc.id);
              }}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className="ed-tab-new"
          aria-label="Novo arquivo"
          onClick={newUntitled}
        >
          +
        </button>
      </div>
      {active?.missing && (
        <div className="ed-banner" role="status">
          <span>{active.name} foi apagado ou movido no disco.</span>
          <button type="button" onClick={() => void saveAs(active)}>
            Salvar como…
          </button>
          <button
            type="button"
            onClick={() =>
              changeSession(session, () => {
                active.missing = false;
              })
            }
          >
            Manter aberto
          </button>
        </div>
      )}
      {active?.changedOnDisk && !active.missing && (
        <div className="ed-banner" role="status">
          <span>{active.name} mudou no disco e tem alterações não gravadas.</span>
          <button
            type="button"
            onClick={() => {
              changeSession(session, () => {
                active.changedOnDisk = false;
              });
              void reloadDoc(active);
            }}
          >
            Recarregar (descarta)
          </button>
          <button
            type="button"
            onClick={() =>
              changeSession(session, () => {
                active.changedOnDisk = false;
              })
            }
          >
            Manter a minha versão
          </button>
        </div>
      )}
      <div className={cn("ed-body", `ed-view-${showPreview ? prefs.view : "editor"}`)}>
        <div className="ed-editor" ref={hostRef} hidden={showPreview && prefs.view === "preview"} />
        {showPreview && (
          <div
            className="ed-preview md"
            ref={previewRef}
            onScroll={(event) => {
              const editor = editorRef.current;
              const preview = event.currentTarget;
              if (!editor || syncing.current) return;
              const room = Math.max(1, editor.getScrollHeight() - editor.getLayoutInfo().height);
              const ratio =
                preview.scrollTop / Math.max(1, preview.scrollHeight - preview.clientHeight);
              syncing.current = true;
              editor.setScrollTop(ratio * room);
              requestAnimationFrame(() => (syncing.current = false));
            }}
          >
            <Markdown
              text={previewText}
              artifactPrefix={null}
              onLink={(href) => void latest.current.desktop?.openExternal(href)}
              onArtifact={() => {}}
            />
          </div>
        )}
        {!api && <p className="ed-loading">Carregando o editor…</p>}
        {api && !hasDocs && <p className="ed-loading">Nenhum arquivo aberto.</p>}
      </div>
      {prefs.statusBar && (
        <div className="ed-status" role="status">
          <span className="ed-pos">
            Ln {cursor.line}, Col {cursor.column}
            {cursor.selected > 0 ? ` · ${cursor.selected} selecionados` : ""}
          </span>
          <span className="ed-spacer" />
          {active && (
            <>
              <select
                aria-label="Codificação"
                value={active.encoding}
                onChange={(event) => setEncoding(event.currentTarget.value as Encoding)}
              >
                {(Object.keys(ENCODING_LABELS) as Encoding[]).map((encoding) => (
                  <option key={encoding} value={encoding}>
                    {ENCODING_LABELS[encoding]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="ed-eol"
                aria-label="Fim de linha"
                onClick={() => setEol(active.eol === "crlf" ? "lf" : "crlf")}
              >
                {EOL_LABELS[active.eol]}
              </button>
              <select
                aria-label="Linguagem"
                value={active.language}
                onChange={(event) => updateLanguage(event.currentTarget.value)}
              >
                {(api ? languagesOf(api) : []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.id}
                  </option>
                ))}
              </select>
            </>
          )}
          <button
            type="button"
            className="ed-zoom"
            title="Tamanho padrão (Ctrl+0)"
            onClick={() => runRef.current("zoomReset")}
          >
            {zoomPercent(prefs.fontSize)}%
          </button>
          {active && <span className="ed-mode">{activeMode === "code" ? "Código" : "Texto"}</span>}
        </div>
      )}
      {ask && <AskDialog ask={ask} />}
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          void openWebFiles(files);
        }}
      />
    </div>
  );
}

/**
 * Estado dos arquivos abertos no editor (5.0.3). Fica num mapa do módulo, pela sessão da
 * URL: a guia pode sair do editor (a página desmonta) e voltar sem perder os buffers. Não
 * vai para o disco: só os arquivos gravados existem fora daqui.
 */
import type * as Monaco from "monaco-editor";

import type { Encoding, Eol } from "./language";

export type EditorMode = "notepad" | "code";

export type Doc = {
  id: number;
  path: string | null;
  name: string;
  encoding: Encoding;
  eol: Eol;
  language: string;
  /** Modo escolhido (Exibir > Modo de código); começa pelo idioma. */
  mode: EditorMode;
  /** Texto mudou desde a última leitura/gravação (ou a codificação/fim de linha mudou). */
  dirty: boolean;
  /** Versão do modelo quando foi gravado pela última vez. */
  savedVersion: number;
  /** Mudanças de codificação/fim de linha ainda não gravadas. */
  metaChanged: boolean;
  /** Última data de modificação conhecida no disco (null: sem arquivo). */
  mtime: number | null;
  /** Arquivo mudou no disco com alterações não gravadas (a barra pergunta). */
  changedOnDisk: boolean;
  missing: boolean;
  model: Monaco.editor.ITextModel;
  listener: Monaco.IDisposable | null;
};

export type EditorSession = {
  docs: Doc[];
  activeId: number | null;
  nextId: number;
  /** Posição do cursor e da rolagem de cada documento (não é estado de render). */
  views: Map<number, Monaco.editor.ICodeEditorViewState>;
  /** Re-render da página quando o estado muda (só a página montada escuta). */
  notify: (() => void) | null;
};

const sessions = new Map<string, EditorSession>();

export function sessionOf(id: string): EditorSession {
  let session = sessions.get(id);
  if (!session) {
    session = { docs: [], activeId: null, nextId: 1, views: new Map(), notify: null };
    sessions.set(id, session);
  }
  return session;
}

export function docOf(session: EditorSession, id: number | null): Doc | null {
  return session.docs.find((doc) => doc.id === id) ?? null;
}

/** Ajusta o estado e avisa a página montada (se houver). */
export function changeSession(session: EditorSession, change: (session: EditorSession) => void) {
  change(session);
  session.notify?.();
}

import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { Workspace } from "../types";

/** Ícones sugeridos para um workspace novo (qualquer emoji serve). */
export const WORKSPACE_ICONS = ["🏠", "💼", "📚", "🎮", "🛒", "🎵", "✈️", "💡", "🧪", "❤️"];

/** Botão do workspace atual, no começo da barra de guias. */
export function WorkspaceButton({
  workspace,
  open,
  compact = false,
  onClick,
  onContextMenu,
}: {
  workspace: Workspace;
  open: boolean;
  compact?: boolean;
  onClick: () => void;
  onContextMenu?: (event: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      className={cn("workspace-button", open && "on", compact && "compact")}
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={`Workspace: ${workspace.name} (trocar ou criar)`}
      aria-label={`Workspace ${workspace.name}`}
      aria-haspopup="dialog"
      aria-expanded={open}
      data-no-drag
    >
      <span className="workspace-icon" aria-hidden="true">
        {workspace.icon}
      </span>
      {!compact && <span className="workspace-name">{workspace.name}</span>}
    </button>
  );
}

/**
 * Workspaces (como no Opera/Vivaldi): cada um tem as suas guias. Trocar, criar, renomear
 * e apagar (as guias do apagado fecham; o primeiro não pode ser apagado).
 */
export function WorkspacePanel({
  workspaces,
  activeId,
  counts,
  onSwitch,
  onCreate,
  onUpdate,
  onRemove,
  onClose,
  startCreating = false,
}: {
  workspaces: Workspace[];
  activeId: number;
  /** Guias abertas em cada workspace. */
  counts: Record<number, number>;
  onSwitch: (id: number) => void;
  onCreate: (name: string, icon: string) => void;
  onUpdate: (id: number, name: string, icon: string) => void;
  onRemove: (id: number) => void;
  onClose: () => void;
  /** Abre já no formulário de um workspace novo. */
  startCreating?: boolean;
}) {
  const [editing, setEditing] = useState<number | "new" | null>(startCreating ? "new" : null);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState(WORKSPACE_ICONS[1]!);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const firstRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (editing !== null) inputRef.current?.focus();
    else firstRef.current?.focus();
  }, [editing]);

  const startEdit = (target: Workspace | "new") => {
    if (target === "new") {
      setName("");
      setIcon(WORKSPACE_ICONS[(workspaces.length + 1) % WORKSPACE_ICONS.length]!);
      setEditing("new");
    } else {
      setName(target.name);
      setIcon(target.icon);
      setEditing(target.id);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const clean = name.trim();
    if (!clean) return;
    if (editing === "new") {
      onCreate(clean, icon);
      onClose();
    } else if (editing !== null) {
      onUpdate(editing, clean, icon);
      setEditing(null);
    }
  };

  return (
    <aside className="key-panel workspace-panel" aria-label="Workspaces">
      <div className="panel-heading">
        <div className="panel-title">
          <div>
            <strong>Workspaces</strong>
            <small>Cada um com as suas guias</small>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar workspaces">
          <X />
        </Button>
      </div>
      <ul className="workspace-list">
        {workspaces.map((workspace, index) => (
          <li key={workspace.id} className={cn(workspace.id === activeId && "active")}>
            <button
              ref={index === 0 ? firstRef : undefined}
              type="button"
              className="workspace-row"
              onClick={() => {
                onSwitch(workspace.id);
                onClose();
              }}
              aria-current={workspace.id === activeId}
            >
              <span className="workspace-icon" aria-hidden="true">
                {workspace.icon}
              </span>
              <span className="workspace-name">{workspace.name}</span>
              <small>
                {counts[workspace.id] ?? 0} {counts[workspace.id] === 1 ? "guia" : "guias"}
              </small>
              {workspace.id === activeId && <Check aria-label="atual" />}
            </button>
            <button
              type="button"
              className="icon-action"
              onClick={() => startEdit(workspace)}
              aria-label={`Renomear ${workspace.name}`}
              title="Renomear"
            >
              <Pencil />
            </button>
            {index > 0 && (
              <button
                type="button"
                className="icon-action danger"
                onClick={() => onRemove(workspace.id)}
                aria-label={`Apagar ${workspace.name}`}
                title="Apagar (fecha as guias dele)"
              >
                <Trash2 />
              </button>
            )}
          </li>
        ))}
      </ul>
      {editing !== null ? (
        <form className="workspace-form" onSubmit={submit}>
          <input
            ref={inputRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Nome do workspace"
            aria-label="Nome do workspace"
            maxLength={40}
          />
          <div className="workspace-icons" role="radiogroup" aria-label="Ícone">
            {WORKSPACE_ICONS.map((item) => (
              <button
                key={item}
                type="button"
                role="radio"
                aria-checked={item === icon}
                className={cn(item === icon && "on")}
                onClick={() => setIcon(item)}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="settings-actions">
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" disabled={!name.trim()}>
              {editing === "new" ? "Criar workspace" : "Salvar"}
            </Button>
          </div>
        </form>
      ) : (
        <button type="button" className="workspace-new" onClick={() => startEdit("new")}>
          <Plus /> Novo workspace
        </button>
      )}
    </aside>
  );
}

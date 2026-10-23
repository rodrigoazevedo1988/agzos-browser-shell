import { Home, Library, ListMusic, Pin, Plus, Search, X, FolderPlus } from "lucide-react";
import { useState, type FormEvent } from "react";

import type { MediaLibrary } from "@/features/browser/persistence/snapshot";
import { baseName } from "./format";
import { CROSSFADE_OPTIONS } from "./model";

export type MusicView =
  { kind: "home" } | { kind: "search" } | { kind: "folders" } | { kind: "playlist"; id: string };

/** Barra lateral: navegação, pastas fixadas, playlists e a transição entre músicas. */
export function Sidebar({
  view,
  library,
  crossfade,
  onView,
  onOpenFolder,
  onUnpin,
  onAddFolder,
  onCreatePlaylist,
  onCrossfade,
}: {
  view: MusicView;
  library: MediaLibrary;
  crossfade: number;
  onView: (view: MusicView) => void;
  onOpenFolder: (path: string) => void;
  onUnpin: (path: string) => void;
  onAddFolder: () => void;
  onCreatePlaylist: (name: string) => Promise<string | null>;
  onCrossfade: (seconds: number) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const isNav = (kind: MusicView["kind"]) => view.kind === kind;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const problem = await onCreatePlaylist(name);
    if (problem) {
      setError(problem);
      return;
    }
    setName("");
    setError(null);
    setCreating(false);
  };

  return (
    <nav className="mx-side" aria-label="Músicas">
      <div className="mx-brand">
        <span className="mx-logo" aria-hidden="true">
          <ListMusic />
        </span>
        <span className="mx-side-label">Músicas</span>
      </div>

      <ul className="mx-side-nav">
        <li>
          <button
            type="button"
            aria-label="Início"
            aria-current={isNav("home") ? "page" : undefined}
            onClick={() => onView({ kind: "home" })}
          >
            <Home aria-hidden="true" />
            <span className="mx-side-label">Início</span>
          </button>
        </li>
        <li>
          <button
            type="button"
            aria-label="Buscar"
            aria-current={isNav("search") ? "page" : undefined}
            onClick={() => onView({ kind: "search" })}
          >
            <Search aria-hidden="true" />
            <span className="mx-side-label">Buscar</span>
          </button>
        </li>
        <li>
          <button
            type="button"
            aria-label="Biblioteca"
            aria-current={isNav("folders") ? "page" : undefined}
            onClick={() => onView({ kind: "folders" })}
          >
            <Library aria-hidden="true" />
            <span className="mx-side-label">Biblioteca</span>
          </button>
        </li>
      </ul>

      <div className="mx-side-section">
        <p className="mx-side-title mx-side-label">Fixadas</p>
        {library.folders.length ? (
          <ul className="mx-side-list">
            {library.folders.map((path) => (
              <li key={path} className="mx-side-row">
                <button
                  type="button"
                  title={path}
                  aria-label={`Abrir ${baseName(path)}`}
                  onClick={() => onOpenFolder(path)}
                >
                  <Pin aria-hidden="true" />
                  <span className="mx-side-label">{baseName(path)}</span>
                </button>
                <button
                  type="button"
                  className="mx-side-x"
                  aria-label={`Desafixar ${baseName(path)}`}
                  onClick={() => onUnpin(path)}
                >
                  <X aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <button
          type="button"
          className="mx-side-add"
          aria-label="Adicionar pasta"
          onClick={onAddFolder}
        >
          <FolderPlus aria-hidden="true" />
          <span className="mx-side-label">Adicionar pasta</span>
        </button>
      </div>

      <div className="mx-side-section">
        <div className="mx-side-head">
          <p className="mx-side-title mx-side-label">Playlists</p>
          <button
            type="button"
            className="mx-side-x"
            aria-label="Nova playlist"
            aria-expanded={creating}
            onClick={() => setCreating((value) => !value)}
          >
            <Plus aria-hidden="true" />
          </button>
        </div>
        {creating ? (
          <form className="mx-side-form" onSubmit={submit}>
            <input
              aria-label="Nome da nova playlist"
              value={name}
              maxLength={80}
              placeholder="Nome da playlist"
              autoFocus
              onChange={(event) => setName(event.currentTarget.value)}
            />
            <button type="submit" className="mx-btn">
              Criar
            </button>
            {error ? (
              <p role="alert" className="mx-form-error">
                {error}
              </p>
            ) : null}
          </form>
        ) : null}
        {library.playlists.length ? (
          <ul className="mx-side-list">
            {library.playlists.map((list) => (
              <li key={list.id}>
                <button
                  type="button"
                  aria-current={
                    view.kind === "playlist" && view.id === list.id ? "page" : undefined
                  }
                  onClick={() => onView({ kind: "playlist", id: list.id })}
                  title={`${list.name} · ${list.tracks.length} músicas`}
                  aria-label={list.name}
                >
                  <ListMusic aria-hidden="true" />
                  <span className="mx-side-label">{list.name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <label className="mx-side-foot">
        <span>Transição</span>
        <select
          value={crossfade}
          onChange={(event) => onCrossfade(Number(event.currentTarget.value))}
        >
          {CROSSFADE_OPTIONS.map((seconds) => (
            <option key={seconds} value={seconds}>
              {seconds === 0 ? "Sem transição" : `${seconds} s`}
            </option>
          ))}
        </select>
      </label>
    </nav>
  );
}

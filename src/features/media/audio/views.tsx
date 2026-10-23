import { ChevronRight, FolderOpen, Pencil, Pin, PinOff, Play, Shuffle, Trash2 } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";

import type { MediaBridge, MediaListing, MediaRoot, MediaItem } from "@/features/media/bridge";
import type { MediaLibrary } from "@/features/browser/persistence/snapshot";
import { baseName, formatTotal } from "./format";
import type { Track } from "./engine";
import { FolderCard, TrackCard, TrackTable } from "./parts";
import { rowActions, type MusicCtx } from "./rows";
import type { Playlist } from "./playlists";

/** Soma das durações, só quando todas as faixas já têm a sua (senão a soma engana). */
function totalOf(tracks: Track[]): number {
  if (!tracks.length || !tracks.every((track) => track.duration)) return 0;
  return tracks.reduce((sum, track) => sum + (track.duration ?? 0), 0);
}

function Section({
  title,
  empty,
  count,
  children,
}: {
  title: string;
  empty: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="mx-section">
      <h2>{title}</h2>
      {count > 0 ? children : <p className="mx-empty-line">{empty}</p>}
    </section>
  );
}

/** Lista do início: recentes, pastas fixadas, playlists e as pastas do computador. */
export function HomeView({
  ctx,
  roots,
  recent,
}: {
  ctx: MusicCtx;
  roots: MediaRoot[] | null;
  recent: Track[];
}) {
  const pinned = ctx.library.folders;
  return (
    <div className="mx-view">
      <header className="mx-hero">
        <p className="mx-kicker">Biblioteca local</p>
        <h1>Músicas</h1>
        <p className="mx-lead">
          Toque as músicas das pastas do seu computador, sem enviar nada para lugar nenhum.
        </p>
      </header>

      <Section
        title="Tocados recentemente"
        empty="Nada tocado ainda. Escolha uma pasta para começar."
        count={recent.length}
      >
        <div className="mx-grid">
          {recent.slice(0, 12).map((track, index) => (
            <TrackCard
              key={track.path}
              track={track}
              onPlay={() => ctx.playTracks(recent, index)}
            />
          ))}
        </div>
      </Section>

      <Section title="Pastas fixadas" empty="Fixe uma pasta para vê-la aqui." count={pinned.length}>
        <div className="mx-grid">
          {pinned.map((path) => (
            <FolderCard
              key={path}
              bridge={ctx.bridge}
              name={baseName(path)}
              path={path}
              onOpen={() => ctx.openFolder(path, baseName(path))}
            />
          ))}
        </div>
      </Section>

      <Section
        title="Playlists"
        empty="Crie uma playlist na barra lateral."
        count={ctx.library.playlists.length}
      >
        <div className="mx-grid">
          {ctx.library.playlists.map((list) => (
            <button
              key={list.id}
              type="button"
              className="mx-card"
              onClick={() => ctx.openPlaylist(list.id)}
            >
              <span className="mx-card-art mx-card-art-list">
                <Play aria-hidden="true" />
              </span>
              <strong>{list.name}</strong>
              <span>{list.tracks.length} músicas</span>
            </button>
          ))}
        </div>
      </Section>

      <Section
        title="Pastas do computador"
        empty={roots === null ? "Procurando pastas…" : "Nenhuma pasta de música encontrada."}
        count={roots?.length ?? 0}
      >
        <div className="mx-grid">
          {(roots ?? []).map((root) => (
            <button
              key={root.id}
              type="button"
              className="mx-card"
              onClick={() => ctx.openFolder(root.path, root.label)}
            >
              <span className="mx-card-art">
                <FolderOpen aria-hidden="true" />
              </span>
              <strong>{root.label}</strong>
              <span className="mx-path">{root.path}</span>
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
}

/** Busca no índice das pastas (nome, título, artista e álbum; todas as palavras batem). */
export function SearchView({
  ctx,
  index,
  indexing,
  query,
  onQuery,
}: {
  ctx: MusicCtx;
  index: MediaItem[] | null;
  indexing: boolean;
  query: string;
  onQuery: (value: string) => void;
}) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches: Track[] = [];
  if (index && terms.length) {
    for (const item of index) {
      const track = ctx.trackOf(item);
      const haystack =
        `${track.title} ${track.artist ?? ""} ${track.album ?? ""} ${item.name}`.toLowerCase();
      if (terms.every((term) => haystack.includes(term))) matches.push(track);
      if (matches.length >= 300) break;
    }
  }
  return (
    <div className="mx-view">
      <header className="mx-hero">
        <h1>Buscar</h1>
        <label className="mx-search">
          <span className="mx-sr">Buscar músicas</span>
          <input
            type="search"
            autoFocus
            value={query}
            placeholder="Título, artista, álbum ou nome do arquivo"
            onChange={(event) => onQuery(event.currentTarget.value)}
          />
        </label>
        {indexing ? <p className="mx-lead">Lendo as pastas…</p> : null}
      </header>
      {terms.length === 0 ? (
        <p className="mx-empty-line">
          Digite para procurar em todas as pastas fixadas e do computador.
        </p>
      ) : matches.length === 0 && !indexing ? (
        <p className="mx-empty-line">Nada com “{query.trim()}”.</p>
      ) : (
        <TrackTable
          label="Resultados da busca"
          tracks={matches}
          playingPath={ctx.playingPath}
          actions={rowActions(ctx, {}, matches)}
        />
      )}
    </div>
  );
}

export type Trail = { label: string; path: string }[];

/** Navegação por pastas: migalhas, subpastas como álbuns e as faixas da pasta. */
export function FolderView({
  ctx,
  trail,
  roots,
  listing,
  error,
  onTrail,
}: {
  ctx: MusicCtx;
  trail: Trail;
  roots: MediaRoot[] | null;
  listing: MediaListing | null;
  error: string | null;
  onTrail: (trail: Trail) => void;
}) {
  const here = trail[trail.length - 1];
  if (!here) {
    return (
      <div className="mx-view">
        <Crumbs trail={trail} onTrail={onTrail} />
        <h1>Pastas</h1>
        {roots === null ? <p className="mx-empty-line">Procurando pastas…</p> : null}
        {roots && roots.length === 0 ? (
          <p className="mx-empty-line">
            Nenhuma pasta de música. Use “Adicionar pasta” na barra lateral.
          </p>
        ) : null}
        <div className="mx-grid">
          {(roots ?? []).map((root) => (
            <button
              key={root.id}
              type="button"
              className="mx-card"
              onClick={() => ctx.openFolder(root.path, root.label)}
            >
              <span className="mx-card-art">
                <FolderOpen aria-hidden="true" />
              </span>
              <strong>{root.label}</strong>
              <span className="mx-path">{root.path}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }
  const tracks = listing ? listing.items.map(ctx.trackOf) : [];
  const pinned = ctx.library.folders.includes(here.path);
  const total = totalOf(tracks);
  return (
    <div className="mx-view">
      <Crumbs trail={trail} onTrail={onTrail} />
      <header className="mx-album-head">
        <div className="mx-album-art" aria-hidden="true">
          {tracks.find((track) => track.cover)?.cover ? (
            <img src={tracks.find((track) => track.cover)!.cover} alt="" />
          ) : (
            <FolderOpen />
          )}
        </div>
        <div>
          <p className="mx-kicker">Pasta</p>
          <h1>{here.label}</h1>
          <p className="mx-lead">
            {listing
              ? `${tracks.length} músicas${total ? ` · ${formatTotal(total)}` : ""}`
              : "Carregando…"}
          </p>
          <div className="mx-actions">
            <button
              type="button"
              className="mx-btn"
              disabled={!tracks.length}
              onClick={() => ctx.playTracks(tracks, 0)}
            >
              <Play aria-hidden="true" /> Tocar tudo
            </button>
            <button
              type="button"
              className="mx-btn-ghost"
              disabled={!tracks.length}
              onClick={() => ctx.playTracks(tracks, 0, true)}
            >
              <Shuffle aria-hidden="true" /> Embaralhar
            </button>
            <button
              type="button"
              className="mx-btn-ghost"
              onClick={() => ctx.pin(here.path, !pinned)}
            >
              {pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
              {pinned ? "Desafixar" : "Fixar na barra"}
            </button>
          </div>
        </div>
      </header>
      {error ? (
        <p className="mx-empty-line" role="alert">
          {error}
        </p>
      ) : null}
      {listing?.folders.length ? (
        <section className="mx-section">
          <h2>Pastas</h2>
          <div className="mx-grid">
            {listing.folders.map((folder) => (
              <FolderCard
                key={folder.path}
                bridge={ctx.bridge}
                name={folder.name}
                path={folder.path}
                onOpen={() => onTrail([...trail, { label: folder.name, path: folder.path }])}
              />
            ))}
          </div>
        </section>
      ) : null}
      {listing ? (
        tracks.length ? (
          <TrackTable
            label={`Músicas em ${here.label}`}
            tracks={tracks}
            playingPath={ctx.playingPath}
            actions={rowActions(ctx, {}, tracks)}
          />
        ) : (
          <p className="mx-empty-line">Nenhum áudio nesta pasta.</p>
        )
      ) : null}
      {listing?.truncated ? (
        <p className="mx-lead">Mostrando as primeiras músicas desta pasta.</p>
      ) : null}
    </div>
  );
}

function Crumbs({ trail, onTrail }: { trail: Trail; onTrail: (trail: Trail) => void }) {
  return (
    <nav className="mx-crumbs" aria-label="Caminho da pasta">
      <button
        type="button"
        onClick={() => onTrail([])}
        aria-current={trail.length ? undefined : "page"}
      >
        Pastas
      </button>
      {trail.map((step, index) => (
        <span key={step.path} className="mx-crumb">
          <ChevronRight aria-hidden="true" />
          <button
            type="button"
            onClick={() => onTrail(trail.slice(0, index + 1))}
            aria-current={index === trail.length - 1 ? "page" : undefined}
          >
            {step.label}
          </button>
        </span>
      ))}
    </nav>
  );
}

/** Playlist: tocar, embaralhar, renomear, apagar e reordenar/remover faixas. */
export function PlaylistView({
  ctx,
  list,
  tracks,
  onRename,
  onDelete,
  onRemove,
  onMove,
}: {
  ctx: MusicCtx;
  list: Playlist;
  tracks: Track[];
  onRename: (name: string) => void;
  onDelete: () => void;
  onRemove: (index: number) => void;
  onMove: (from: number, to: number) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(list.name);
  const [confirming, setConfirming] = useState(false);
  const total = totalOf(tracks);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onRename(name);
    setRenaming(false);
  };
  return (
    <div className="mx-view">
      <header className="mx-album-head">
        <div className="mx-album-art" aria-hidden="true">
          <Play />
        </div>
        <div>
          <p className="mx-kicker">Playlist</p>
          {renaming ? (
            <form onSubmit={submit} className="mx-inline-form">
              <input
                aria-label="Nome da playlist"
                value={name}
                maxLength={80}
                autoFocus
                onChange={(event) => setName(event.currentTarget.value)}
              />
              <button type="submit" className="mx-btn">
                Salvar
              </button>
              <button type="button" className="mx-btn-ghost" onClick={() => setRenaming(false)}>
                Cancelar
              </button>
            </form>
          ) : (
            <h1>{list.name}</h1>
          )}
          <p className="mx-lead">
            {tracks.length} músicas{total ? ` · ${formatTotal(total)}` : ""}
          </p>
          <div className="mx-actions">
            <button
              type="button"
              className="mx-btn"
              disabled={!tracks.length}
              onClick={() => ctx.playTracks(tracks, 0)}
            >
              <Play aria-hidden="true" /> Tocar
            </button>
            <button
              type="button"
              className="mx-btn-ghost"
              disabled={!tracks.length}
              onClick={() => ctx.playTracks(tracks, 0, true)}
            >
              <Shuffle aria-hidden="true" /> Embaralhar
            </button>
            <button
              type="button"
              className="mx-btn-ghost"
              onClick={() => {
                setName(list.name);
                setRenaming(true);
              }}
            >
              <Pencil aria-hidden="true" /> Renomear
            </button>
            {confirming ? (
              <button type="button" className="mx-btn-danger" onClick={onDelete}>
                <Trash2 aria-hidden="true" /> Apagar playlist
              </button>
            ) : (
              <button type="button" className="mx-btn-ghost" onClick={() => setConfirming(true)}>
                <Trash2 aria-hidden="true" /> Apagar
              </button>
            )}
          </div>
        </div>
      </header>
      {tracks.length ? (
        <TrackTable
          label={`Músicas da playlist ${list.name}`}
          tracks={tracks}
          playingPath={ctx.playingPath}
          actions={rowActions(ctx, { onRemove, onMove }, tracks)}
        />
      ) : (
        <p className="mx-empty-line">
          Playlist vazia. Use o menu ⋯ de qualquer música para adicionar.
        </p>
      )}
    </div>
  );
}

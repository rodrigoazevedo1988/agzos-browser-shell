import {
  FolderOpen,
  GripVertical,
  Heart,
  ListPlus,
  MoreHorizontal,
  Play,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";

import type { MediaBridge } from "@/features/media/bridge";
import type { Playlist } from "./playlists";
import type { Track } from "./engine";
import { formatDuration, formatDurationOrDash } from "./format";
import { Cover } from "./player";
import { folderCover } from "./library";
import { rowActions, type RowActions } from "./rows";

/** Cartão de pasta (álbum): a capa vem da primeira faixa com arte, lida quando aparece. */
export function FolderCard({
  bridge,
  name,
  path,
  subtitle,
  onOpen,
}: {
  bridge: MediaBridge;
  name: string;
  path: string;
  subtitle?: string;
  onOpen: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [cover, setCover] = useState<string | undefined>();

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let alive = true;
    const load = () => {
      void folderCover(bridge, path).then((url) => alive && setCover(url));
    };
    if (typeof IntersectionObserver === "undefined") {
      load();
      return () => {
        alive = false;
      };
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        load();
      }
    });
    observer.observe(node);
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, [bridge, path]);

  return (
    <button type="button" ref={ref} className="mx-card" onClick={onOpen} title={path}>
      <span className="mx-card-art">
        {cover ? <img src={cover} alt="" draggable={false} /> : <FolderOpen aria-hidden="true" />}
        <span className="mx-card-play" aria-hidden="true">
          <Play />
        </span>
      </span>
      <strong>{name}</strong>
      <span>{subtitle ?? "Pasta"}</span>
    </button>
  );
}

/** Cartão de faixa (recentes): capa, título e artista; toca a lista a partir dela. */
export function TrackCard({ track, onPlay }: { track: Track; onPlay: () => void }) {
  return (
    <button type="button" className="mx-card" onClick={onPlay} title={track.path}>
      <span className="mx-card-art">
        <Cover track={track} className="mx-card-img" />
        <span className="mx-card-play" aria-hidden="true">
          <Play />
        </span>
      </span>
      <strong>{track.title}</strong>
      <span>{track.artist ?? track.name}</span>
    </button>
  );
}

/** Lista de faixas em tabela: #, título e artista, álbum, duração e ações. */
export function TrackTable({
  tracks,
  playingPath,
  label,
  actions,
}: {
  tracks: Track[];
  playingPath: string | null;
  label: string;
  actions: RowActions;
}) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  return (
    <div className="mx-table-wrap">
      <table className="mx-table" aria-label={label}>
        <thead>
          <tr>
            <th scope="col" className="mx-col-no">
              #
            </th>
            <th scope="col">Título</th>
            <th scope="col" className="mx-col-album">
              Álbum
            </th>
            <th scope="col" className="mx-col-dur">
              Duração
            </th>
            <th scope="col" className="mx-col-act">
              <span className="mx-sr">Ações</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {tracks.map((track, index) => {
            const active = track.path === playingPath;
            const liked = actions.liked.has(track.path);
            const move = (to: number) => {
              if (actions.onMove && to >= 0 && to < tracks.length) actions.onMove(index, to);
            };
            const onKey = (event: KeyboardEvent<HTMLTableRowElement>) => {
              if (event.altKey && event.key === "ArrowUp") {
                event.preventDefault();
                move(index - 1);
              } else if (event.altKey && event.key === "ArrowDown") {
                event.preventDefault();
                move(index + 1);
              }
            };
            return (
              <tr
                key={`${track.path}-${index}`}
                className={active ? "is-active" : undefined}
                draggable={Boolean(actions.onMove)}
                onDragStart={() => setDragFrom(index)}
                onDragOver={(event: DragEvent) => actions.onMove && event.preventDefault()}
                onDrop={(event: DragEvent) => {
                  event.preventDefault();
                  if (dragFrom !== null && dragFrom !== index) actions.onMove?.(dragFrom, index);
                  setDragFrom(null);
                }}
                onKeyDown={onKey}
              >
                <td className="mx-col-no">
                  <button
                    type="button"
                    className="mx-row-play"
                    aria-label={`Tocar ${track.title}`}
                    onClick={() => actions.onPlay(index)}
                  >
                    <span className="mx-no">{index + 1}</span>
                    <Play aria-hidden="true" />
                  </button>
                  {actions.onMove ? <GripVertical className="mx-grip" aria-hidden="true" /> : null}
                </td>
                <td>
                  <div className="mx-title-cell">
                    <Cover track={track} className="mx-thumb" />
                    <span className="mx-title-text">
                      <strong>{track.title}</strong>
                      <small>{track.artist ?? track.name}</small>
                    </span>
                  </div>
                </td>
                <td className="mx-col-album">{track.album ?? ""}</td>
                <td className="mx-col-dur">{formatDurationOrDash(track.duration)}</td>
                <td className="mx-col-act">
                  <div className="mx-row-actions">
                    <button
                      type="button"
                      className={`mx-icon-btn ${liked ? "is-on" : ""}`}
                      aria-label={
                        liked ? `Tirar ${track.title} dos favoritos` : `Favoritar ${track.title}`
                      }
                      aria-pressed={liked}
                      onClick={() => actions.onLike(track.path)}
                    >
                      <Heart aria-hidden="true" fill={liked ? "currentColor" : "none"} />
                    </button>
                    <RowMenu track={track} actions={actions} />
                    {actions.onRemove ? (
                      <button
                        type="button"
                        className="mx-icon-btn"
                        aria-label={`Remover ${track.title} da playlist`}
                        onClick={() => actions.onRemove?.(index)}
                      >
                        <Trash2 aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Menu da linha: tocar a seguir, fila e playlists. Fecha com Esc ou clique fora. */
function RowMenu({ track, actions }: { track: Track; actions: RowActions }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const done = (action: () => void) => () => {
    action();
    setOpen(false);
  };

  return (
    <div className="mx-menu-wrap" ref={wrap}>
      <button
        type="button"
        className="mx-icon-btn"
        aria-label={`Mais ações de ${track.title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => event.key === "Escape" && setOpen(false)}
      >
        <MoreHorizontal aria-hidden="true" />
      </button>
      {open ? (
        <div className="mx-menu" role="menu" aria-label={`Ações de ${track.title}`}>
          <button
            type="button"
            role="menuitem"
            onClick={done(() => actions.onPlayNext(track.path))}
          >
            <ListPlus aria-hidden="true" /> Tocar a seguir
          </button>
          <button type="button" role="menuitem" onClick={done(() => actions.onEnqueue(track.path))}>
            <ListPlus aria-hidden="true" /> Adicionar à fila
          </button>
          <p className="mx-menu-title">Adicionar à playlist</p>
          {actions.playlists.length ? (
            actions.playlists.map((list) => {
              const has = list.tracks.includes(track.path);
              return (
                <button
                  key={list.id}
                  type="button"
                  role="menuitem"
                  disabled={has}
                  onClick={done(() => actions.onAddToPlaylist(list.id, track.path))}
                >
                  {has ? "✓ " : ""}
                  {list.name}
                </button>
              );
            })
          ) : (
            <p className="mx-menu-empty">Crie uma playlist na barra lateral.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

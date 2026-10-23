// agzos://musica: Música no estilo de streaming, em vermelho do Agzos. O motor de reprodução
// é um singleton fora da React (a música segue ao trocar de página); esta tela só mostra e
// manda comandos. Biblioteca vem da ponte window.agzosMedia (só no app para computador).

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Music2 } from "lucide-react";

import {
  mediaBridge,
  isListing,
  type MediaBridge,
  type MediaItem,
  type MediaListing,
  type MediaRoot,
} from "@/features/media/bridge";

import "./music.css";
import { baseName } from "./format";
import { enrich, trackFromItem, buildIndex } from "./library";
import { musicAction, isNativeTarget } from "./keys";
import { musicFileOf } from "./model";
import { musicEngine, type Track } from "./engine";
import { useEngineState, useLibrary, useTagVersion } from "./hooks";
import { addTracks, deletePlaylist, moveTrack, removeTrack, renamePlaylist } from "./playlists";
import {
  createPlaylistNamed,
  editPlaylists,
  pinFolder,
  recordPlaysOf,
  toggleFavorite,
} from "./store";
import { Sidebar, type MusicView } from "./sidebar";
import { HomeView, FolderView, PlaylistView, SearchView, type Trail } from "./views";
import type { MusicCtx } from "./rows";
import { ExpandedView, NowPlaying, QueuePanel } from "./player";

export type MusicPageProps = {
  url: string;
  onNotice: (text: string) => void;
  /** Segundos de transição (preferência em Configurações > Recursos, por `features.music`). */
  crossfade: number;
  onCrossfade: (seconds: number) => void;
};

/** agzos://musica. Na web (sem a ponte do app) mostra só o aviso. */
export function MusicPage(props: MusicPageProps) {
  const bridge = useMemo(() => mediaBridge(), []);
  if (!bridge) {
    return (
      <div className="mx-root mx-unavailable">
        <Music2 aria-hidden="true" />
        <h1>Músicas</h1>
        <p>
          A biblioteca de músicas lê as pastas do seu computador, então ela funciona só no app para
          computador.
        </p>
      </div>
    );
  }
  return <MusicApp {...props} bridge={bridge} />;
}

function fallbackTrack(path: string): Track {
  const name = baseName(path);
  return { path, name, ext: "", size: 0, title: name.replace(/\.[^.]+$/, "") };
}

/** Itens da listagem sem arquivo lido ainda: só o caminho basta para ler as tags. */
function itemOfPath(path: string): MediaItem {
  return { name: baseName(path), path, size: 0, mtime: 0, ext: "" };
}

function MusicApp({
  bridge,
  url,
  onNotice,
  crossfade,
  onCrossfade,
}: MusicPageProps & { bridge: MediaBridge }) {
  const engine = useMemo(() => musicEngine(), []);
  const library = useLibrary();
  const state = useEngineState(engine);
  useTagVersion();
  const [view, setView] = useState<MusicView>({ kind: "home" });
  const [trail, setTrail] = useState<Trail>([]);
  const [roots, setRoots] = useState<MediaRoot[] | null>(null);
  const [listing, setListing] = useState<MediaListing | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<MediaItem[] | null>(null);
  const [indexing, setIndexing] = useState(false);
  // A fila começa fechada: a página divide a janela com a casca (painel lateral, abas).
  const [queueOpen, setQueueOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const handledFile = useRef<string | null>(null);

  // Motor: resolve caminhos pela ponte, grava recentes e segue a transição escolhida.
  useEffect(() => {
    if (!engine) return;
    engine.setUrlResolver((path) => bridge.url(path));
    recordPlaysOf(engine);
  }, [engine, bridge]);
  useEffect(() => {
    engine?.setCrossfade(crossfade);
  }, [engine, crossfade]);

  // Pastas de música do computador (raízes) uma vez.
  useEffect(() => {
    let alive = true;
    void bridge
      .roots()
      .then((list) => alive && setRoots(list))
      .catch(() => alive && setRoots([]));
    return () => {
      alive = false;
    };
  }, [bridge]);

  // Listagem da pasta atual.
  useEffect(() => {
    const here = trail[trail.length - 1];
    if (!here) {
      setListing(null);
      setListError(null);
      return;
    }
    let alive = true;
    setListing(null);
    setListError(null);
    void bridge.list(here.path, "audio").then((result) => {
      if (!alive) return;
      if (isListing(result)) setListing(result);
      else setListError("Não foi possível abrir esta pasta.");
    });
    return () => {
      alive = false;
    };
  }, [bridge, trail]);

  // Tags (título, artista, capa, duração) das faixas visíveis, sem passar de 200 por vez.
  const visibleItems = useMemo(() => listing?.items ?? [], [listing]);
  useEffect(() => {
    if (!engine || !visibleItems.length) return;
    let alive = true;
    for (const item of visibleItems.slice(0, 200)) {
      if (!alive) break;
      void enrich(bridge, engine, item);
    }
    return () => {
      alive = false;
    };
  }, [bridge, engine, visibleItems]);

  // Índice da busca: monta na primeira vez que a busca abre.
  useEffect(() => {
    if (view.kind !== "search" || index !== null || roots === null) return;
    let cancelled = false;
    setIndexing(true);
    void buildIndex(
      bridge,
      roots.map((root) => root.path),
      { cancelled: () => cancelled },
    ).then((items) => {
      if (cancelled) return;
      setIndex(items);
      setIndexing(false);
    });
    return () => {
      cancelled = true;
    };
  }, [bridge, view.kind, index, roots]);

  // Arquivo aberto de fora (agzos://musica?file=…): toca e lê as tags.
  useEffect(() => {
    const file = musicFileOf(url);
    if (!engine || !file || handledFile.current === file) return;
    handledFile.current = file;
    const item = itemOfPath(file);
    engine.playList([trackFromItem(item)], 0);
    void enrich(bridge, engine, item);
  }, [bridge, engine, url]);

  // Playlists: faixas sem tags lidas ainda ganham título e duração.
  const openList =
    view.kind === "playlist" ? library.playlists.find((list) => list.id === view.id) : undefined;
  const playlistPaths = useMemo(() => openList?.tracks ?? [], [openList]);
  useEffect(() => {
    if (!engine || !playlistPaths.length) return;
    let alive = true;
    for (const path of playlistPaths.slice(0, 200)) {
      if (!alive) break;
      if (!engine.trackOf(path)?.duration) void enrich(bridge, engine, itemOfPath(path));
    }
    return () => {
      alive = false;
    };
  }, [bridge, engine, playlistPaths]);

  const trackOf = (item: MediaItem): Track => engine?.trackOf(item.path) ?? trackFromItem(item);
  const pathTrack = (path: string): Track => engine?.trackOf(path) ?? fallbackTrack(path);
  const liked = useMemo(() => new Set(library.favorites), [library.favorites]);
  const playingPath = state.track?.path ?? null;

  const playTracks = (tracks: Track[], start: number, shuffle = false) => {
    if (!engine || !tracks.length) return;
    const at = shuffle ? Math.floor(Math.random() * tracks.length) : start;
    engine.playList(tracks, at, shuffle ? { shuffle: true } : {});
  };

  const openFolder = (path: string, label: string) => {
    setView({ kind: "folders" });
    setTrail([{ label, path }]);
  };

  const notify = (text: string) => onNotice(text);

  const playlistAction = async (change: Parameters<typeof editPlaylists>[0]) => {
    const problem = await editPlaylists(change);
    if (problem) notify(problem);
    return problem;
  };

  const ctx: MusicCtx = {
    bridge,
    library,
    playingPath,
    liked,
    trackOf,
    playTracks,
    openFolder,
    openPlaylist: (id) => setView({ kind: "playlist", id }),
    like: (path) => void toggleFavorite(path),
    addToPlaylist: (id, path) =>
      void playlistAction((lists, now) => {
        const result = addTracks(lists, id, [path], now);
        if (result.ok) {
          const name = lists.find((list) => list.id === id)?.name ?? "playlist";
          notify(`Adicionada a ${name}.`);
        }
        return result;
      }),
    playNext: (path) => engine?.playNext([path]),
    enqueue: (path) => engine?.enqueue([path]),
    pin: (path, pinned) =>
      void pinFolder(path, pinned).then(() =>
        notify(pinned ? "Pasta fixada na barra." : "Pasta desafixada."),
      ),
    notice: notify,
  };

  const addFolder = async () => {
    const picked = await bridge.pickFolder();
    if (!picked) return;
    await pinFolder(picked, true);
    openFolder(picked, baseName(picked));
  };

  const openCurrentPlaylist = (): { id: string; tracks: Track[] } | null => {
    if (view.kind !== "playlist") return null;
    const list = library.playlists.find((item) => item.id === view.id);
    return list ? { id: list.id, tracks: list.tracks.map(pathTrack) } : null;
  };
  const currentList = openCurrentPlaylist();

  // Playlist sumiu (apagada em outra janela): volta ao início.
  useEffect(() => {
    if (view.kind === "playlist" && !library.playlists.some((list) => list.id === view.id)) {
      setView({ kind: "home" });
    }
  }, [library.playlists, view]);

  const recentTracks = library.recent
    .filter((item) => item.kind === "audio")
    .map((item) => pathTrack(item.path));

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!engine) return;
    const target = event.target as HTMLElement;
    const native = isNativeTarget(target.tagName, target.isContentEditable);
    if (event.key === "Escape" && expanded) {
      setExpanded(false);
      return;
    }
    const action = musicAction(
      {
        key: event.key,
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        shift: event.shiftKey,
        alt: event.altKey,
      },
      native,
    );
    if (!action) return;
    event.preventDefault();
    switch (action.type) {
      case "toggle":
        engine.toggle();
        break;
      case "seek":
        engine.seekBy(action.seconds);
        break;
      case "next":
        engine.next();
        break;
      case "prev":
        engine.prev();
        break;
      case "mute":
        engine.toggleMute();
        break;
      case "volumeStep":
        engine.setVolume(state.volume + action.delta);
        break;
    }
  };

  const playlistsView = currentList ? (
    <PlaylistView
      ctx={ctx}
      list={library.playlists.find((item) => item.id === currentList.id)!}
      tracks={currentList.tracks}
      onRename={(name) =>
        void playlistAction((lists, now) => renamePlaylist(lists, currentList.id, name, now))
      }
      onDelete={() => {
        void playlistAction((lists) => deletePlaylist(lists, currentList.id));
        setView({ kind: "home" });
      }}
      onRemove={(at) =>
        void playlistAction((lists, now) => removeTrack(lists, currentList.id, at, now))
      }
      onMove={(from, to) =>
        void playlistAction((lists, now) => moveTrack(lists, currentList.id, from, to, now))
      }
    />
  ) : null;

  const main = (() => {
    if (view.kind === "search") {
      return (
        <SearchView ctx={ctx} index={index} indexing={indexing} query={query} onQuery={setQuery} />
      );
    }
    if (view.kind === "folders") {
      return (
        <FolderView
          ctx={ctx}
          trail={trail}
          roots={roots}
          listing={listing}
          error={listError}
          onTrail={setTrail}
        />
      );
    }
    if (view.kind === "playlist") return playlistsView;
    return <HomeView ctx={ctx} roots={roots} recent={recentTracks} />;
  })();

  return (
    <div className="mx-root" ref={rootRef} onKeyDown={onKey}>
      <div className="mx-body">
        <Sidebar
          view={view}
          library={library}
          crossfade={crossfade}
          onView={(next) => setView(next)}
          onOpenFolder={(path) => openFolder(path, baseName(path))}
          onUnpin={(path) => void pinFolder(path, false)}
          onAddFolder={() => void addFolder()}
          onCreatePlaylist={createPlaylistNamed}
          onCrossfade={onCrossfade}
        />
        <main className="mx-main" aria-label="Conteúdo">
          {main}
        </main>
        {queueOpen && engine ? (
          <QueuePanel
            engine={engine}
            state={state}
            trackOf={pathTrack}
            onClose={() => setQueueOpen(false)}
          />
        ) : null}
      </div>
      <NowPlaying
        engine={engine}
        state={state}
        liked={Boolean(state.track && liked.has(state.track.path))}
        onLike={() => state.track && void toggleFavorite(state.track.path)}
        queueOpen={queueOpen}
        onQueue={() => setQueueOpen((value) => !value)}
        onExpand={() => setExpanded((value) => !value)}
        expanded={expanded}
      />
      {expanded ? (
        <ExpandedView engine={engine} state={state} onClose={() => setExpanded(false)} />
      ) : null}
    </div>
  );
}

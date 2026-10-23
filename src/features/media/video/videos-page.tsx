// agzos://videos (5.1): biblioteca de vídeos em estilo streaming. Destaque com o último vídeo,
// trilhos de "Continuar assistindo", "Favoritos" e uma linha por pasta filha, seletor de
// pastas (raízes e pastas fixadas), busca e o player por cima.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Film,
  FolderOpen,
  FolderPlus,
  Play,
  Search,
  Star,
  X,
} from "lucide-react";

import {
  isListing,
  mediaBridge,
  type MediaBridge,
  type MediaItem,
  type MediaListing,
  type MediaRoot,
} from "../bridge";
import { loadMedia, updateMedia } from "../library";
import {
  emptyMedia,
  MEDIA_PATHS_LIMIT,
  type MediaLibrary,
  type MediaRecent,
} from "@/features/browser/persistence/snapshot";
import { Player } from "./player";
import { thumbnailOf } from "./thumbs";
import {
  breadcrumbOf,
  continueItems,
  formatTime,
  fileOfVideosUrl,
  isInProgress,
  isVideoName,
  matchesSearch,
  nameOf,
  parentOf,
  resumeAt,
  titleOf,
  toggleIn,
  withRecent,
} from "./model";
import "./videos.css";

const SUB_ROWS_LIMIT = 60;

type Playing = { item: MediaItem; queue: MediaItem[] };

const itemOf = (path: string): MediaItem => {
  const name = nameOf(path);
  const dot = name.lastIndexOf(".");
  return { name, path, size: 0, mtime: 0, ext: dot > 0 ? name.slice(dot + 1).toLowerCase() : "" };
};

const errorText = (code: string) =>
  code === "access"
    ? "Sem permissão para abrir esta pasta."
    : code === "missing"
      ? "Esta pasta não existe mais."
      : "Não consegui abrir esta pasta.";

export function VideosPage({ url }: { url: string }) {
  const bridge = mediaBridge();
  if (!bridge) {
    return (
      <div className="vp-page vp-empty">
        <Film size={40} aria-hidden="true" />
        <h1>Vídeos é do app para computador</h1>
        <p>
          A biblioteca lê as pastas do seu computador, então só funciona no Agzos Browser instalado.
        </p>
      </div>
    );
  }
  return <VideosLibrary bridge={bridge} url={url} />;
}

function VideosLibrary({ bridge, url }: { bridge: MediaBridge; url: string }) {
  const [roots, setRoots] = useState<MediaRoot[]>([]);
  const [library, setLibrary] = useState<MediaLibrary>(emptyMedia);
  const [ready, setReady] = useState(false);
  const [dir, setDir] = useState<string | null>(null);
  const [listing, setListing] = useState<MediaListing | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [subRows, setSubRows] = useState<Record<string, MediaItem[]>>({});
  const [query, setQuery] = useState("");
  const [playing, setPlaying] = useState<Playing | null>(null);
  const requestedFile = useRef(fileOfVideosUrl(url));

  // Raízes e biblioteca salva.
  useEffect(() => {
    let cancelled = false;
    void Promise.all([bridge.roots(), loadMedia()]).then(([found, saved]) => {
      if (cancelled) return;
      setRoots(found);
      setLibrary(saved);
      setReady(true);
      const file = requestedFile.current;
      const start =
        (file && parentOf(file)) ||
        found.find((root) => root.id === "videos")?.path ||
        found[0]?.path ||
        null;
      setDir(start);
    });
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  // Pasta atual: arquivos e, em segundo plano, uma linha por subpasta.
  useEffect(() => {
    if (!dir) return;
    let cancelled = false;
    setListError(null);
    void bridge.list(dir, "video").then((result) => {
      if (cancelled) return;
      if (!isListing(result)) {
        setListing(null);
        setListError(errorText(result.error));
        return;
      }
      setListing(result);
      const folders = result.folders.slice(0, SUB_ROWS_LIMIT);
      void Promise.all(
        folders.map((folder) =>
          bridge
            .list(folder.path, "video")
            .then((found) => [folder.path, isListing(found) ? found.items : []] as const),
        ),
      ).then((pairs) => {
        if (!cancelled) setSubRows(Object.fromEntries(pairs));
      });
    });
    return () => {
      cancelled = true;
    };
  }, [bridge, dir]);

  // Arquivo pedido por agzos://videos?file=…: abre o player com a pasta dele como fila.
  useEffect(() => {
    const file = requestedFile.current;
    if (!file || !listing || listing.dir !== dir) return;
    requestedFile.current = null;
    const queue = listing.items.some((entry) => entry.path === file)
      ? listing.items
      : [itemOf(file)];
    setPlaying({ item: queue.find((entry) => entry.path === file) ?? itemOf(file), queue });
  }, [listing, dir]);

  const continueList = useMemo(
    () => continueItems(library.recent).map((entry) => itemOf(entry.path)),
    [library.recent],
  );
  const favoriteList = useMemo(
    () => library.favorites.filter((path) => isVideoName(nameOf(path))).map(itemOf),
    [library.favorites],
  );
  const progressOf = useCallback(
    (path: string): MediaRecent | undefined => library.recent.find((entry) => entry.path === path),
    [library.recent],
  );
  const favoriteSet = useMemo(() => new Set(library.favorites), [library.favorites]);

  const play = useCallback((item: MediaItem, queue: MediaItem[]) => {
    setPlaying({ item, queue });
  }, []);

  // Progresso do player: grava o vídeo em "recentes" (a cada 5s e ao sair do player).
  const onProgress = useCallback((file: string, position: number, duration: number) => {
    void updateMedia((current) => ({
      ...current,
      recent: withRecent(current.recent, {
        path: file,
        kind: "video",
        position,
        duration,
        at: Date.now(),
      }),
    })).then(setLibrary);
  }, []);

  const toggleFavorite = (path: string) => {
    void updateMedia((current) => ({
      ...current,
      favorites: toggleIn(current.favorites, path, MEDIA_PATHS_LIMIT),
    })).then(setLibrary);
  };

  const pinFolder = async () => {
    const picked = await bridge.pickFolder();
    if (!picked) return;
    void updateMedia((current) => ({
      ...current,
      folders: toggleIn(
        current.folders.filter((path) => path !== picked),
        picked,
        50,
      ),
    })).then((next) => {
      setLibrary(next);
      setDir(picked);
    });
  };

  const unpinFolder = (path: string) => {
    void updateMedia((current) => ({
      ...current,
      folders: current.folders.filter((item) => item !== path),
    })).then(setLibrary);
  };

  const hasNeedle = query.trim().length > 0;
  const allItems = useMemo(() => {
    const seen = new Map<string, MediaItem>();
    for (const item of [
      ...(listing?.items ?? []),
      ...Object.values(subRows).flat(),
      ...continueList,
      ...favoriteList,
    ]) {
      if (!seen.has(item.path)) seen.set(item.path, item);
    }
    return [...seen.values()];
  }, [listing, subRows, continueList, favoriteList]);
  const matches = useMemo(
    () => (hasNeedle ? allItems.filter((item) => matchesSearch(titleOf(item.name), query)) : []),
    [allItems, hasNeedle, query],
  );

  const hero = continueList[0]
    ? { item: continueList[0], queue: continueList, label: "Continuar assistindo" }
    : listing?.items[0]
      ? { item: listing.items[0], queue: listing.items, label: "Destaque" }
      : null;

  const currentRoot = roots.find((root) => dir === root.path || dir?.startsWith(root.path));
  const crumbs = dir ? breadcrumbOf(dir) : [];
  const playingEntry = playing ? progressOf(playing.item.path) : undefined;

  return (
    <div className="vp-stage">
      <div className="vp-page">
        <nav className="vp-top" aria-label="Pastas">
          <div className="vp-roots">
            {roots.map((root) => (
              <button
                key={root.id}
                type="button"
                className={currentRoot?.id === root.id ? "vp-chip is-on" : "vp-chip"}
                onClick={() => setDir(root.path)}
                aria-pressed={currentRoot?.id === root.id}
              >
                {root.label}
              </button>
            ))}
            {library.folders.map((path) => (
              <span
                key={path}
                className={dir === path ? "vp-chip is-on is-pinned" : "vp-chip is-pinned"}
              >
                <button type="button" onClick={() => setDir(path)} title={path}>
                  {nameOf(path)}
                </button>
                <button
                  type="button"
                  className="vp-chip-x"
                  onClick={() => unpinFolder(path)}
                  aria-label={`Desafixar ${nameOf(path)}`}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            ))}
            <button type="button" className="vp-chip" onClick={() => void pinFolder()}>
              <FolderPlus size={14} aria-hidden="true" /> Adicionar pasta
            </button>
          </div>
          <label className="vp-search">
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Buscar vídeos"
              aria-label="Buscar vídeos"
            />
          </label>
        </nav>

        <div className="vp-crumbs" aria-label="Caminho da pasta">
          <button
            type="button"
            className="vp-icon"
            onClick={() => listing?.parent && setDir(listing.parent)}
            disabled={!listing?.parent}
            aria-label="Pasta acima"
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          {crumbs.map((crumb, index) => (
            <span key={crumb.path} className="vp-crumb">
              {index > 1 ? <span aria-hidden="true">/</span> : null}
              <button
                type="button"
                onClick={() => setDir(crumb.path)}
                aria-current={index === crumbs.length - 1 ? "page" : undefined}
              >
                {crumb.label}
              </button>
            </span>
          ))}
        </div>

        {!ready ? <p className="vp-note">Carregando a biblioteca…</p> : null}
        {listError ? (
          <div className="vp-note vp-error-note" role="alert">
            <p>{listError}</p>
            <button
              type="button"
              className="vp-pill"
              onClick={() => setDir(roots[0]?.path ?? null)}
            >
              Voltar para o início
            </button>
          </div>
        ) : null}

        {hasNeedle ? (
          <section className="vp-results" aria-label="Resultados da busca">
            <h2>
              {matches.length
                ? `${matches.length} resultado${matches.length === 1 ? "" : "s"}`
                : "Nada encontrado"}
            </h2>
            <div className="vp-grid">
              {matches.map((item) => (
                <Card
                  key={item.path}
                  bridge={bridge}
                  item={item}
                  progress={progressOf(item.path)}
                  favorite={favoriteSet.has(item.path)}
                  onPlay={() => play(item, matches)}
                  onFavorite={() => toggleFavorite(item.path)}
                />
              ))}
            </div>
          </section>
        ) : (
          <>
            {hero ? (
              <Hero
                bridge={bridge}
                item={hero.item}
                label={hero.label}
                recent={progressOf(hero.item.path)}
                resume={resumeAt(library.recent, hero.item.path)}
                favorite={favoriteSet.has(hero.item.path)}
                folder={nameOf(parentOf(hero.item.path))}
                onPlay={() => play(hero.item, hero.queue)}
                onFavorite={() => toggleFavorite(hero.item.path)}
              />
            ) : null}

            {continueList.length ? (
              <Rail title="Continuar assistindo">
                {continueList.map((item) => (
                  <Card
                    key={item.path}
                    bridge={bridge}
                    item={item}
                    progress={progressOf(item.path)}
                    favorite={favoriteSet.has(item.path)}
                    onPlay={() => play(item, continueList)}
                    onFavorite={() => toggleFavorite(item.path)}
                  />
                ))}
              </Rail>
            ) : null}

            {favoriteList.length ? (
              <Rail title="Favoritos">
                {favoriteList.map((item) => (
                  <Card
                    key={item.path}
                    bridge={bridge}
                    item={item}
                    progress={progressOf(item.path)}
                    favorite
                    onPlay={() => play(item, favoriteList)}
                    onFavorite={() => toggleFavorite(item.path)}
                  />
                ))}
              </Rail>
            ) : null}

            {listing?.items.length ? (
              <Rail title={`Em ${nameOf(listing.dir)}`}>
                {listing.items.map((item) => (
                  <Card
                    key={item.path}
                    bridge={bridge}
                    item={item}
                    progress={progressOf(item.path)}
                    favorite={favoriteSet.has(item.path)}
                    onPlay={() => play(item, listing.items)}
                    onFavorite={() => toggleFavorite(item.path)}
                  />
                ))}
              </Rail>
            ) : null}

            {listing?.folders.map((folder) => {
              const items = subRows[folder.path] ?? [];
              if (!items.length) return null;
              return (
                <Rail
                  key={folder.path}
                  title={folder.name}
                  action={
                    <button type="button" className="vp-link" onClick={() => setDir(folder.path)}>
                      <FolderOpen size={14} aria-hidden="true" /> Abrir pasta
                    </button>
                  }
                >
                  {items.map((item) => (
                    <Card
                      key={item.path}
                      bridge={bridge}
                      item={item}
                      progress={progressOf(item.path)}
                      favorite={favoriteSet.has(item.path)}
                      onPlay={() => play(item, items)}
                      onFavorite={() => toggleFavorite(item.path)}
                    />
                  ))}
                </Rail>
              );
            })}

            {listing && !listing.items.length && !listing.folders.length ? (
              <p className="vp-note">
                Nenhum vídeo nesta pasta. Escolha outra pasta ou adicione uma com “Adicionar pasta”.
              </p>
            ) : null}
          </>
        )}
      </div>

      {playing ? (
        <Player
          key={playing.item.path}
          bridge={bridge}
          item={playing.item}
          queue={playing.queue}
          resumeFrom={playingEntry && isInProgress(playingEntry) ? playingEntry.position : 0}
          favorite={favoriteSet.has(playing.item.path)}
          onFavorite={() => toggleFavorite(playing.item.path)}
          onProgress={(position, duration) => onProgress(playing.item.path, position, duration)}
          onPlay={(item) => play(item, playing.queue)}
          onClose={() => setPlaying(null)}
        />
      ) : null}
    </div>
  );
}

function Hero({
  bridge,
  item,
  label,
  recent,
  resume,
  favorite,
  folder,
  onPlay,
  onFavorite,
}: {
  bridge: MediaBridge;
  item: MediaItem;
  label: string;
  recent: MediaRecent | undefined;
  resume: number;
  favorite: boolean;
  folder: string;
  onPlay: () => void;
  onFavorite: () => void;
}) {
  const [artRef, art] = useThumbnail(bridge, item.path);
  const title = titleOf(item.name);
  return (
    <section className="vp-hero" aria-label={label}>
      <div ref={artRef} className="vp-hero-art" aria-hidden="true">
        {art ? <img src={art} alt="" /> : null}
      </div>
      <div className="vp-hero-body">
        <span className="vp-eyebrow">{label}</span>
        <h1>{title}</h1>
        <p>
          {folder}
          {recent && recent.duration > 0
            ? ` · ${formatTime(recent.position)} de ${formatTime(recent.duration)}`
            : ""}
        </p>
        <div className="vp-hero-actions">
          <button type="button" className="vp-pill is-solid" onClick={onPlay}>
            <Play size={16} aria-hidden="true" fill="currentColor" />
            {resume > 0 ? `Continuar em ${formatTime(resume)}` : "Assistir"}
          </button>
          <button
            type="button"
            className={favorite ? "vp-pill is-on" : "vp-pill"}
            onClick={onFavorite}
            aria-pressed={favorite}
          >
            <Star size={16} aria-hidden="true" fill={favorite ? "currentColor" : "none"} />
            {favorite ? "Favoritado" : "Favoritar"}
          </button>
        </div>
      </div>
    </section>
  );
}

function Rail({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const scroll = (direction: 1 | -1) => {
    const element = rail.current;
    if (!element) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    element.scrollBy({
      left: direction * element.clientWidth * 0.85,
      behavior: reduce ? "auto" : "smooth",
    });
  };
  return (
    <section className="vp-rail-wrap" aria-label={title}>
      <header>
        <h3>{title}</h3>
        {action}
      </header>
      <div className="vp-rail-frame">
        <button
          type="button"
          className="vp-arrow is-left"
          onClick={() => scroll(-1)}
          aria-label={`Anterior em ${title}`}
        >
          <ChevronLeft size={22} aria-hidden="true" />
        </button>
        <div ref={rail} className="vp-rail">
          {children}
        </div>
        <button
          type="button"
          className="vp-arrow is-right"
          onClick={() => scroll(1)}
          aria-label={`Próximo em ${title}`}
        >
          <ChevronRight size={22} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

function Card({
  bridge,
  item,
  progress,
  favorite,
  onPlay,
  onFavorite,
}: {
  bridge: MediaBridge;
  item: MediaItem;
  progress: MediaRecent | undefined;
  favorite: boolean;
  onPlay: () => void;
  onFavorite: () => void;
}) {
  const [artRef, art] = useThumbnail(bridge, item.path);
  const title = titleOf(item.name);
  const ratio =
    progress && progress.duration > 0 ? Math.min(1, progress.position / progress.duration) : 0;
  return (
    <article className="vp-card">
      <button
        ref={artRef}
        type="button"
        className="vp-card-art"
        onClick={onPlay}
        aria-label={`Tocar ${title}`}
      >
        {art ? (
          <img src={art} alt="" loading="lazy" />
        ) : (
          <span className="vp-card-fallback" aria-hidden="true">
            <Film size={28} />
          </span>
        )}
        <span className="vp-card-play" aria-hidden="true">
          <Play size={22} fill="currentColor" />
        </span>
        {ratio > 0 ? (
          <span className="vp-card-progress" style={{ width: `${ratio * 100}%` }} />
        ) : null}
      </button>
      <div className="vp-card-meta">
        <strong title={item.path}>{title}</strong>
        <span>
          {item.ext.toUpperCase()}
          {progress && progress.position > 0 ? ` · ${formatTime(progress.position)}` : ""}
        </span>
      </div>
      <button
        type="button"
        className={favorite ? "vp-card-fav is-on" : "vp-card-fav"}
        onClick={onFavorite}
        aria-pressed={favorite}
        aria-label={favorite ? `Tirar ${title} dos favoritos` : `Favoritar ${title}`}
      >
        <Star size={15} aria-hidden="true" fill={favorite ? "currentColor" : "none"} />
      </button>
    </article>
  );
}

/**
 * Miniatura quando o elemento (ref devolvida) entra na tela: IntersectionObserver, uma vez.
 * O resultado vem de thumbs.ts (fila e cache).
 */
function useThumbnail(
  bridge: MediaBridge,
  path: string,
): [(node: HTMLElement | null) => void, string | null] {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    setSrc(null);
    setSeen(false);
  }, [path]);
  useEffect(() => {
    if (!node || seen) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setSeen(true);
        observer.disconnect();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, seen]);
  useEffect(() => {
    if (!seen) return;
    const url = bridge.url(path);
    if (!url) return;
    let cancelled = false;
    void thumbnailOf(url, path).then((value) => {
      if (!cancelled) setSrc(value);
    });
    return () => {
      cancelled = true;
    };
  }, [bridge, path, seen]);
  return [setNode, src];
}

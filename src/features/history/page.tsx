import { History, Search, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { HistoryStore } from "@/features/browser/persistence/history-store";
import { hostOf } from "@/features/browser/store/selectors";
import type { HistoryVisit } from "@/features/browser/types";
import { BookmarkIcon } from "@/features/browser/ui/bookmark-icon";

const PAGE = 100;
const HOUR = 60 * 60 * 1000;

export const CLEAR_RANGES = [
  { id: "hour", label: "Última hora", ms: HOUR },
  { id: "day", label: "Últimas 24 horas", ms: 24 * HOUR },
  { id: "week", label: "Últimos 7 dias", ms: 7 * 24 * HOUR },
  { id: "all", label: "Todo o período", ms: null },
] as const;

function dayLabel(time: number, now: number) {
  const date = new Date(time);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - new Date(date).setHours(0, 0, 0, 0)) / (24 * HOUR));
  const full = date.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
  if (diff === 0) return `Hoje · ${full}`;
  if (diff === 1) return `Ontem · ${full}`;
  return full.charAt(0).toUpperCase() + full.slice(1);
}

const timeOf = (time: number) =>
  new Date(time).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

export function HistoryPage({
  store,
  onOpen,
}: {
  store: HistoryStore | null;
  onOpen: (url: string, newTab: boolean) => void;
}) {
  const [visits, setVisits] = useState<HistoryVisit[]>([]);
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [range, setRange] = useState<(typeof CLEAR_RANGES)[number]["id"]>("hour");
  const request = useRef(0);

  const load = useCallback(
    async (query: string, before: number | null) => {
      if (!store) return;
      const ticket = ++request.current;
      const page = await store.list({ text: query, before, limit: PAGE }).catch(() => []);
      if (ticket !== request.current) return;
      setVisits((list) => (before ? [...list, ...page] : page));
      setHasMore(page.length === PAGE);
      setLoaded(true);
    },
    [store],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void load(text, null), text ? 150 : 0);
    return () => window.clearTimeout(timer);
  }, [load, text]);

  // Voltou para a aba do histórico: mostra as visitas novas.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void load(text, null);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load, text]);

  const groups = useMemo(() => {
    const now = Date.now();
    const out: { label: string; visits: HistoryVisit[] }[] = [];
    for (const visit of visits) {
      const label = dayLabel(visit.visitedAt, now);
      const last = out[out.length - 1];
      if (last?.label === label) last.visits.push(visit);
      else out.push({ label, visits: [visit] });
    }
    return out;
  }, [visits]);

  async function remove(visit: HistoryVisit) {
    await store?.delete([visit.id]);
    setVisits((list) => list.filter((item) => item.id !== visit.id));
  }

  async function clear() {
    const choice = CLEAR_RANGES.find((item) => item.id === range)!;
    await store?.clear(choice.ms === null ? {} : { from: Date.now() - choice.ms });
    await load(text, null);
  }

  return (
    <div className="library-page" aria-label="Histórico">
      <header className="library-head">
        <div className="library-title">
          <History aria-hidden="true" />
          <div>
            <h1>Histórico</h1>
            <p>
              Páginas visitadas neste dispositivo nos últimos 90 dias. Guias anônimas não entram.
            </p>
          </div>
        </div>
        <label className="library-search">
          <Search aria-hidden="true" />
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Pesquisar no histórico"
            aria-label="Pesquisar no histórico"
          />
          {text && (
            <button type="button" aria-label="Limpar pesquisa" onClick={() => setText("")}>
              <X />
            </button>
          )}
        </label>
        <div className="library-clear">
          <select
            value={range}
            onChange={(event) => setRange(event.target.value as typeof range)}
            aria-label="Período para limpar"
          >
            {CLEAR_RANGES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <Button variant="outline" size="sm" onClick={() => void clear()}>
            <Trash2 /> Limpar histórico
          </Button>
        </div>
      </header>

      {loaded && visits.length === 0 && (
        <p className="library-empty">
          {text ? `Nada no histórico com "${text}".` : "Seu histórico está vazio."}
        </p>
      )}

      {groups.map((group) => (
        <section className="library-group" key={group.label}>
          <h2>{group.label}</h2>
          <ul>
            {group.visits.map((visit) => (
              <li key={visit.id} className="library-row">
                <time dateTime={new Date(visit.visitedAt).toISOString()}>
                  {timeOf(visit.visitedAt)}
                </time>
                <BookmarkIcon node={{ url: visit.url, icon: visit.icon, title: visit.title }} />
                <a
                  href={visit.url}
                  className="library-link"
                  title={visit.url}
                  onClick={(event) => {
                    event.preventDefault();
                    onOpen(visit.url, event.ctrlKey || event.metaKey || event.button === 1);
                  }}
                  onAuxClick={(event) => {
                    if (event.button !== 1) return;
                    event.preventDefault();
                    onOpen(visit.url, true);
                  }}
                >
                  <strong>{visit.title || visit.url}</strong>
                  <span>{hostOf(visit.url) ?? visit.url}</span>
                </a>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remover ${visit.title || visit.url} do histórico`}
                  title="Remover do histórico"
                  onClick={() => void remove(visit)}
                >
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {hasMore && (
        <div className="library-more">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load(text, visits[visits.length - 1]?.visitedAt ?? null)}
          >
            Carregar mais
          </Button>
        </div>
      )}
    </div>
  );
}

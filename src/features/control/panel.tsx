import {
  Cpu,
  Gauge,
  HardDrive,
  MemoryStick,
  Network,
  RefreshCw,
  Trash2,
  Wifi,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { LIMIT_RANGES, type LimitPrefs } from "@/features/browser/control/limits";
import type { DesktopBridge, GxStats, SpeedTestResult } from "@/features/browser/desktop";
import { BookmarkIcon } from "@/features/browser/ui/bookmark-icon";
import { cn } from "@/lib/utils";

import {
  formatBytes,
  formatKbps,
  formatMB,
  formatPercent,
  hotTabs,
  levelOf,
  simulatedStats,
  type HotSort,
  type HotTab,
} from "./model";

const POLL_MS = 2000;
const LEVEL_TEXT = { ok: "Normal", high: "Perto do limite", over: "Acima do limite" } as const;

/** Medidor circular (0–100 %) com o valor no centro e o estado escrito embaixo. */
function Ring({
  label,
  value,
  fraction,
  caption,
  level,
  icon,
}: {
  label: string;
  value: string;
  fraction: number;
  caption: string;
  level: "ok" | "high" | "over";
  icon: ReactNode;
}) {
  const radius = 42;
  const length = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, fraction));
  return (
    <figure className={cn("gx-ring", `level-${level}`)} aria-label={`${label}: ${value}`}>
      <svg viewBox="0 0 100 100" role="img" aria-hidden="true">
        <circle className="gx-ring-track" cx="50" cy="50" r={radius} />
        <circle
          className="gx-ring-value"
          cx="50"
          cy="50"
          r={radius}
          strokeDasharray={`${clamped * length} ${length}`}
          transform="rotate(-90 50 50)"
        />
      </svg>
      <div className="gx-ring-center">
        {icon}
        <strong>{value}</strong>
        <small>{label}</small>
      </div>
      <figcaption>
        {caption}
        {level !== "ok" && <em> · {LEVEL_TEXT[level]}</em>}
      </figcaption>
    </figure>
  );
}

function Section({
  icon,
  title,
  aside,
  children,
}: {
  icon: ReactNode;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="gx-section">
      <header>
        {icon}
        <h3>{title}</h3>
        {aside}
      </header>
      {children}
    </section>
  );
}

function LimitSlider({
  label,
  value,
  min,
  max,
  step,
  format,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  // Arrastando: só o número muda; a preferência grava ao soltar.
  const [draft, setDraft] = useState<number | null>(null);
  return (
    <div className={cn("gx-slider", disabled && "off")}>
      <div>
        <span>{label}</span>
        <strong>{format(draft ?? value)}</strong>
      </div>
      <Slider
        value={[draft ?? value]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-label={label}
        onValueChange={([next]) => setDraft(next ?? value)}
        onValueCommit={([next]) => {
          setDraft(null);
          if (next !== undefined) onChange(next);
        }}
      />
    </div>
  );
}

/**
 * GX Control (3.0): painel lateral da casca com uso de CPU e memória, limitadores de RAM,
 * CPU e rede, Hot Tabs Killer, teste de velocidade e limpeza de cache. No app os números
 * vêm do main (app.getAppMetrics); na versão web são uma demonstração.
 */
export function ControlPanel({
  desktop,
  tabs,
  limits,
  onLimits,
  onCloseTab,
  onActivateTab,
  onClose,
}: {
  desktop: DesktopBridge | null;
  tabs: Omit<HotTab, "memoryMB" | "cpuPercent" | "throttled">[];
  limits: LimitPrefs;
  onLimits: (changes: Partial<LimitPrefs>) => void;
  onCloseTab: (id: number) => void;
  onActivateTab: (id: number) => void;
  onClose: () => void;
}) {
  const [stats, setStats] = useState<GxStats | null>(null);
  const [sort, setSort] = useState<HotSort>("cpu");
  const [speed, setSpeed] = useState<SpeedTestResult | "running" | null>(null);
  const [cache, setCache] = useState<number | null>(null);
  const [cleaning, setCleaning] = useState<"running" | { freed: number } | null>(null);

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  useEffect(() => {
    let alive = true;
    let tick = 0;
    const read = async () => {
      tick += 1;
      const next = desktop
        ? await desktop.gxStats().catch(() => null)
        : simulatedStats(tabsRef.current, tick);
      if (alive && next) setStats(next);
    };
    void read();
    const timer = window.setInterval(() => void read(), POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [desktop, tabsRef]);

  const readCache = useCallback(() => {
    if (!desktop) return;
    void desktop
      .gxCacheSize()
      .then(setCache)
      .catch(() => {});
  }, [desktop]);
  useEffect(readCache, [readCache]);

  const ranked = useMemo(() => hotTabs(tabs, stats, sort), [tabs, stats, sort]);
  const ramCeiling = limits.ramLimitOn ? limits.ramLimitMB : (stats?.systemMemoryMB ?? 0);
  const cpuCeiling = limits.cpuLimitOn ? limits.cpuLimitPercent : 100;

  const runSpeedTest = async () => {
    setSpeed("running");
    if (desktop) {
      setSpeed(
        await desktop
          .gxSpeedTest()
          .catch((error): SpeedTestResult => ({ ok: false, error: String(error) })),
      );
      return;
    }
    // Web: só o download, direto do navegador (o servidor de teste aceita CORS).
    try {
      const start = performance.now();
      const response = await fetch("https://speed.cloudflare.com/__down?bytes=10000000", {
        cache: "no-store",
      });
      const bytes = (await response.arrayBuffer()).byteLength;
      const seconds = (performance.now() - start) / 1000;
      setSpeed({
        ok: true,
        pingMs: null,
        downMbps: Math.round(((bytes * 8) / seconds / 1e6) * 10) / 10,
        upMbps: null,
        at: Date.now(),
      });
    } catch (error) {
      setSpeed({ ok: false, error: String(error) });
    }
  };

  const clearCache = async () => {
    if (!desktop) return;
    setCleaning("running");
    const result = await desktop.gxClearCache().catch(() => null);
    setCleaning(result ? { freed: result.freedBytes } : null);
    if (result) setCache(result.cacheBytes);
  };

  return (
    <aside className="gx-panel" aria-label="GX Control" data-control-panel>
      <header className="gx-head">
        <Gauge aria-hidden="true" />
        <strong>GX Control</strong>
        {!desktop && <span className="gx-demo">Demonstração</span>}
        <Button variant="ghost" size="icon" aria-label="Fechar GX Control" onClick={onClose}>
          <X />
        </Button>
      </header>

      <div className="gx-body">
        <div className="gx-rings">
          <Ring
            label="CPU"
            icon={<Cpu aria-hidden="true" />}
            value={stats ? formatPercent(stats.cpuPercent) : "…"}
            fraction={stats ? stats.cpuPercent / 100 : 0}
            caption={limits.cpuLimitOn ? `Limite ${limits.cpuLimitPercent} %` : "Sem limite"}
            level={stats && limits.cpuLimitOn ? levelOf(stats.cpuPercent, cpuCeiling) : "ok"}
          />
          <Ring
            label="RAM"
            icon={<MemoryStick aria-hidden="true" />}
            value={stats ? formatMB(stats.memoryMB) : "…"}
            fraction={stats && ramCeiling ? stats.memoryMB / ramCeiling : 0}
            caption={
              limits.ramLimitOn
                ? `Limite ${formatMB(limits.ramLimitMB)}`
                : stats
                  ? `de ${formatMB(stats.systemMemoryMB)} do sistema`
                  : ""
            }
            level={stats && limits.ramLimitOn ? levelOf(stats.memoryMB, ramCeiling) : "ok"}
          />
        </div>
        {stats?.lastAction && (
          <p className="gx-note" role="status">
            Limitador de RAM hibernou “{stats.lastAction.title || "uma guia"}”.
          </p>
        )}

        <Section
          icon={<MemoryStick aria-hidden="true" />}
          title="Limitador de RAM"
          aside={
            <Switch
              checked={limits.ramLimitOn}
              onCheckedChange={(on) => onLimits({ ramLimitOn: on })}
              aria-label="Ligar limitador de RAM"
            />
          }
        >
          <LimitSlider
            label="Teto de memória"
            value={limits.ramLimitMB}
            {...LIMIT_RANGES.ramLimitMB}
            format={formatMB}
            disabled={!limits.ramLimitOn}
            onChange={(ramLimitMB) => onLimits({ ramLimitMB })}
          />
          <p className="gx-hint">
            Acima do teto, as guias em segundo plano mais pesadas hibernam (voltam ao clicar).
          </p>
        </Section>

        <Section
          icon={<Cpu aria-hidden="true" />}
          title="Limitador de CPU"
          aside={
            <Switch
              checked={limits.cpuLimitOn}
              onCheckedChange={(on) => onLimits({ cpuLimitOn: on })}
              aria-label="Ligar limitador de CPU"
            />
          }
        >
          <LimitSlider
            label="Uso máximo"
            value={limits.cpuLimitPercent}
            {...LIMIT_RANGES.cpuLimitPercent}
            format={(value) => `${value} %`}
            disabled={!limits.cpuLimitOn}
            onChange={(cpuLimitPercent) => onLimits({ cpuLimitPercent })}
          />
          <p className="gx-hint">
            Acima do limite, as guias em segundo plano rodam mais devagar; a guia à vista não.
          </p>
        </Section>

        <Section
          icon={<Network aria-hidden="true" />}
          title="Limitador de rede"
          aside={
            <Switch
              checked={limits.netLimitOn}
              onCheckedChange={(on) => onLimits({ netLimitOn: on })}
              aria-label="Ligar limitador de rede"
            />
          }
        >
          <LimitSlider
            label="Download"
            value={limits.netDownKbps}
            {...LIMIT_RANGES.netDownKbps}
            format={formatKbps}
            disabled={!limits.netLimitOn}
            onChange={(netDownKbps) => onLimits({ netDownKbps })}
          />
          <LimitSlider
            label="Upload"
            value={limits.netUpKbps}
            {...LIMIT_RANGES.netUpKbps}
            format={formatKbps}
            disabled={!limits.netLimitOn}
            onChange={(netUpKbps) => onLimits({ netUpKbps })}
          />
        </Section>

        <Section
          icon={<Zap aria-hidden="true" />}
          title="Hot Tabs Killer"
          aside={
            <div className="gx-sort" role="radiogroup" aria-label="Ordenar por">
              {(["cpu", "ram"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={sort === value}
                  className={cn(sort === value && "on")}
                  onClick={() => setSort(value)}
                >
                  {value.toUpperCase()}
                </button>
              ))}
            </div>
          }
        >
          <ul className="gx-tabs" aria-label="Guias por uso">
            {ranked.map((tab) => (
              <li key={tab.id} className={cn(tab.active && "active")}>
                <button
                  type="button"
                  className="gx-tab"
                  title={tab.url}
                  onClick={() => onActivateTab(tab.id)}
                >
                  <BookmarkIcon node={{ url: tab.url, icon: tab.favicon, title: tab.title }} />
                  <span className="gx-tab-title">{tab.title}</span>
                  {tab.hibernated ? (
                    <span className="gx-badge">Hibernada</span>
                  ) : (
                    <>
                      {tab.throttled && <span className="gx-badge">Lenta</span>}
                      <span className="gx-num" aria-label={`CPU ${formatPercent(tab.cpuPercent)}`}>
                        {formatPercent(tab.cpuPercent)}
                      </span>
                      <span className="gx-num" aria-label={`Memória ${formatMB(tab.memoryMB)}`}>
                        {formatMB(tab.memoryMB)}
                      </span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className="gx-kill"
                  aria-label={`Encerrar ${tab.title}`}
                  title="Encerrar guia"
                  onClick={() => onCloseTab(tab.id)}
                >
                  <X />
                </button>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          icon={<Wifi aria-hidden="true" />}
          title="Velocidade da internet"
          aside={
            <Button
              size="sm"
              variant="outline"
              disabled={speed === "running"}
              onClick={() => void runSpeedTest()}
            >
              {speed === "running" ? <RefreshCw className="spin" /> : null}
              {speed === "running" ? "Testando…" : "Testar"}
            </Button>
          }
        >
          {speed && speed !== "running" && speed.ok && (
            <dl className="gx-speed">
              <div>
                <dt>Download</dt>
                <dd>{speed.downMbps.toLocaleString("pt-BR")} Mbit/s</dd>
              </div>
              <div>
                <dt>Upload</dt>
                <dd>
                  {speed.upMbps === null ? "—" : `${speed.upMbps.toLocaleString("pt-BR")} Mbit/s`}
                </dd>
              </div>
              <div>
                <dt>Latência</dt>
                <dd>{speed.pingMs === null ? "—" : `${speed.pingMs} ms`}</dd>
              </div>
            </dl>
          )}
          {speed && speed !== "running" && !speed.ok && (
            <p className="gx-hint" role="alert">
              Não foi possível medir agora. Verifique a conexão e tente de novo.
            </p>
          )}
          {!speed && (
            <p className="gx-hint">Mede latência, download e upload em alguns segundos.</p>
          )}
        </Section>

        <Section icon={<HardDrive aria-hidden="true" />} title="Limpeza">
          {desktop ? (
            <div className="gx-clean">
              <span>
                Cache e temporários: <strong>{cache === null ? "…" : formatBytes(cache)}</strong>
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={cleaning === "running"}
                onClick={() => void clearCache()}
              >
                <Trash2 />
                {cleaning === "running" ? "Limpando…" : "Limpar"}
              </Button>
            </div>
          ) : (
            <p className="gx-hint">A limpeza de cache funciona no app Agzos para computador.</p>
          )}
          {cleaning && cleaning !== "running" && (
            <p className="gx-note" role="status">
              {formatBytes(cleaning.freed)} liberados. Logins e cookies foram mantidos.
            </p>
          )}
        </Section>
      </div>
    </aside>
  );
}

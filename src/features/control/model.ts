import type { GxStats } from "@/features/browser/desktop";

export type HotTab = {
  id: number;
  title: string;
  favicon?: string | undefined;
  url: string;
  active: boolean;
  hibernated: boolean;
  memoryMB: number;
  cpuPercent: number;
  throttled: boolean;
};

export type HotSort = "cpu" | "ram";

/** Guias da janela com o uso medido (as hibernadas aparecem com zero, no fim). */
export function hotTabs(
  tabs: Omit<HotTab, "memoryMB" | "cpuPercent" | "throttled">[],
  stats: GxStats | null,
  sort: HotSort,
): HotTab[] {
  const usage = new Map((stats?.tabs ?? []).map((tab) => [tab.id, tab]));
  const list = tabs.map((tab) => {
    const used = usage.get(tab.id);
    return {
      ...tab,
      memoryMB: used?.memoryMB ?? 0,
      cpuPercent: used?.cpuPercent ?? 0,
      throttled: used?.throttled ?? false,
    };
  });
  const primary = (tab: HotTab) => (sort === "cpu" ? tab.cpuPercent : tab.memoryMB);
  const secondary = (tab: HotTab) => (sort === "cpu" ? tab.memoryMB : tab.cpuPercent);
  return list.sort((a, b) => primary(b) - primary(a) || secondary(b) - secondary(a));
}

/** "512 MB", "1,5 GB". */
export function formatMB(mb: number): string {
  if (mb >= 1024) {
    return `${(mb / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} GB`;
  }
  return `${Math.round(mb)} MB`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return formatMB(bytes / 1024 / 1024);
}

/** kbit/s → "800 kbit/s", "10 Mbit/s". */
export function formatKbps(kbps: number): string {
  if (kbps >= 1000) {
    return `${(kbps / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} Mbit/s`;
  }
  return `${Math.round(kbps)} kbit/s`;
}

export function formatPercent(value: number): string {
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: value < 10 ? 1 : 0 })} %`;
}

/** Perto do teto: o medidor diz em texto (a cor só acompanha). */
export function levelOf(value: number, limit: number): "ok" | "high" | "over" {
  if (limit <= 0) return "ok";
  if (value > limit) return "over";
  return value >= limit * 0.85 ? "high" : "ok";
}

// Versão web (sem processos de verdade): números de demonstração, estáveis por guia, que
// oscilam um pouco a cada leitura.
function seeded(seed: number) {
  const value = Math.sin(seed * 9301 + 49297) * 233280;
  return value - Math.floor(value);
}

export function simulatedStats(
  tabs: { id: number; hibernated: boolean; active: boolean }[],
  tick: number,
): GxStats {
  const list = tabs.map((tab) => {
    if (tab.hibernated) {
      return { id: tab.id, memoryMB: 0, cpuPercent: 0, shared: 1, throttled: false };
    }
    const base = seeded(tab.id);
    const wobble = seeded(tab.id * 31 + tick) - 0.5;
    return {
      id: tab.id,
      memoryMB: Math.round(90 + base * 380 + wobble * 30),
      cpuPercent: Math.max(0, Math.round(((tab.active ? 6 : 1) + base * 9 + wobble * 4) * 10) / 10),
      shared: 1,
      throttled: false,
    };
  });
  const memoryMB = 420 + list.reduce((sum, tab) => sum + tab.memoryMB, 0);
  const cpuPercent = Math.min(
    100,
    Math.round((3 + list.reduce((sum, tab) => sum + tab.cpuPercent, 0)) * 10) / 10,
  );
  return {
    cpuPercent,
    memoryMB,
    processes: list.length + 4,
    cores: 8,
    systemMemoryMB: 16_384,
    freeMemoryMB: 16_384 - memoryMB - 6_000,
    tabs: list,
    lastAction: null,
  };
}

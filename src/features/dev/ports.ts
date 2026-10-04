import type { PortInfo, PortKillResult, TunnelResult } from "@/features/browser/desktop";

const normalize = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Filtro do painel de portas: número da porta, processo, PID ou projeto. */
export function filterPorts(ports: PortInfo[], query: string): PortInfo[] {
  const text = normalize(query.trim().replace(/^:/, ""));
  if (!text) return ports;
  return ports.filter((item) =>
    [
      String(item.port),
      item.name,
      item.pid === null ? "" : String(item.pid),
      item.project?.name ?? "",
    ]
      .map(normalize)
      .some((value) => value.includes(text)),
  );
}

export function killErrorText(error: PortKillResult["error"]): string {
  switch (error) {
    case "permission":
      return "O sistema não deixou encerrar esse processo (é de outro usuário ou do sistema).";
    case "gone":
      return "Esse processo já tinha saído.";
    default:
      return "Esse processo não está mais na lista. Atualize e tente de novo.";
  }
}

export function tunnelErrorText(error: TunnelResult["error"]): string {
  switch (error) {
    case "missing":
      return "cloudflared não encontrado. Instale ou escolha o binário para expor a porta.";
    case "timeout":
      return "O Cloudflare não respondeu a tempo. Confira a internet e tente de novo.";
    case "exited":
      return "O cloudflared fechou antes de abrir o túnel.";
    case "spawn":
      return "Não foi possível rodar o cloudflared.";
    default:
      return "Não foi possível abrir o túnel.";
  }
}

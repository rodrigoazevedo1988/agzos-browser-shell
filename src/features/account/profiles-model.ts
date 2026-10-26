import type { GoogleProfile, ProfileStatus } from "./bridge";

/**
 * Estado do cartão de um perfil: conta conectada; "conectando" (janela do perfil aberta sem
 * conta ainda); "falha" (sessão do Google, mas a conta não pôde ser lida); ou "sem conta".
 */
export type CardState = "connected" | "connecting" | "failed" | "idle";

export function cardStateOf(
  profile: Pick<GoogleProfile, "email">,
  status?: ProfileStatus,
): CardState {
  if (profile.email) return "connected";
  if (status?.reason === "read-failed") return "failed";
  if (status?.open) return "connecting";
  return "idle";
}

/**
 * Perfis que ganharam e-mail desde a última lista vista (conta conectada num perfil).
 * O primeiro estado (sem lista anterior) não avisa nada; perfil novo, sem e-mail, também não.
 */
export function newlyConnected(
  previous: GoogleProfile[] | null,
  next: GoogleProfile[],
): GoogleProfile[] {
  if (!previous) return [];
  const before = new Map(previous.map((profile) => [profile.id, profile.email]));
  return next.filter(
    (profile) =>
      Boolean(profile.email) && before.has(profile.id) && before.get(profile.id) !== profile.email,
  );
}

/**
 * Próximo índice de foco numa grade de cards (setas, Home, End). `columns` é quantos cards
 * cabem numa linha. Devolve null quando a tecla não move o foco.
 */
export function gridNextIndex({
  key,
  index,
  columns,
  count,
}: {
  key: string;
  index: number;
  columns: number;
  count: number;
}): number | null {
  if (count <= 0 || index < 0 || index >= count) return null;
  const cols = Math.max(1, Math.floor(columns));
  let next: number;
  switch (key) {
    case "ArrowRight":
      next = index + 1;
      break;
    case "ArrowLeft":
      next = index - 1;
      break;
    case "ArrowDown":
      next = index + cols;
      break;
    case "ArrowUp":
      next = index - cols;
      break;
    case "Home":
      next = 0;
      break;
    case "End":
      next = count - 1;
      break;
    default:
      return null;
  }
  if (next < 0 || next >= count) return null;
  return next;
}

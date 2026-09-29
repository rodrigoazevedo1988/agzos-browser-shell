import { useEffect, useState } from "react";

import type { DesktopBridge } from "../desktop";
import type { Credential } from "../types";

export const defaultCredentials: Credential[] = [
  { domain: "github.com", user: "mrcatofic", password: "agz-Gh8x2mK93" },
  { domain: "figma.com", user: "design@agzos.com", password: "fg-4Wn9Kp17" },
  { domain: "notion.so", user: "equipe@agzos.com", password: "nt-7Ra5Ls26" },
];

const WEB_KEY = "agzos-credentials";

function readWeb(): Credential[] | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(WEB_KEY) ?? "null") as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (item): item is Credential =>
        typeof item === "object" &&
        item !== null &&
        typeof item.domain === "string" &&
        typeof item.user === "string" &&
        typeof item.password === "string",
    );
  } catch {
    return null;
  }
}

/**
 * Cofre Agzos Key. Desktop: arquivo cifrado com safeStorage no main process.
 * Web: localStorage (dados de demonstração). Fica fora do snapshot do navegador.
 */
export function useCredentials(desktop: DesktopBridge | null) {
  const [credentials, setCredentials] = useState<Credential[]>(defaultCredentials);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const legacy = readWeb();
    if (!desktop) {
      if (legacy?.length) setCredentials(legacy);
      setReady(true);
      return;
    }
    // A 1.2 guardava no localStorage do app; migra para o cofre cifrado.
    window.localStorage.removeItem(WEB_KEY);
    void desktop
      .keyLoad()
      .then((stored) => {
        if (stored?.length) {
          setCredentials(stored);
        } else if (legacy?.length) {
          setCredentials(legacy);
          void desktop.keySave(legacy);
        }
      })
      .finally(() => setReady(true));
  }, [desktop]);

  useEffect(() => {
    if (!ready) return;
    if (desktop) void desktop.keySave(credentials);
    else window.localStorage.setItem(WEB_KEY, JSON.stringify(credentials));
  }, [credentials, desktop, ready]);

  return [credentials, setCredentials] as const;
}

import { useCallback, useEffect, useRef, useState } from "react";

import type { DesktopBridge, KeyResult } from "../desktop";
import type { KeyState, VaultEntry } from "../types";
import { defaultCredentials } from "./use-credentials";

const WEB_KEY = "agzos-credentials";

/** Credencial mocada da web -> VaultEntry (o painel trabalha só com VaultEntry). */
function credentialToEntry(domain: string, user: string, password: string): VaultEntry {
  return {
    id: `web-${domain}`,
    title: domain,
    url: `https://${domain}`,
    username: user,
    password,
    category: "Login",
    updatedAt: Date.now(),
  };
}

function readWebEntries(): VaultEntry[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(WEB_KEY) ?? "null") as unknown;
    const list = Array.isArray(parsed) ? parsed : defaultCredentials;
    return list
      .filter(
        (item): item is { domain: string; user: string; password: string } =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as { domain?: unknown }).domain === "string",
      )
      .map((item) => credentialToEntry(item.domain, item.user, item.password));
  } catch {
    return defaultCredentials.map((c) => credentialToEntry(c.domain, c.user, c.password));
  }
}

function writeWebEntries(entries: VaultEntry[]) {
  const list = entries.map((entry) => ({
    domain: entry.title || entry.url || "",
    user: entry.username ?? "",
    password: entry.password ?? "",
  }));
  window.localStorage.setItem(WEB_KEY, JSON.stringify(list));
}

export type VaultController = {
  state: KeyState;
  entries: VaultEntry[];
  loading: boolean;
  error: string | null;
  pair: (code: string) => Promise<boolean>;
  unlock: (password: string) => Promise<boolean>;
  lock: () => void;
  unpair: () => Promise<void>;
  add: (entry: VaultEntry) => Promise<void>;
  remove: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
  clearError: () => void;
};

const webState = (unlocked: boolean): KeyState => ({
  paired: true,
  unlocked,
  accountEmail: null,
  deviceId: "web",
});

/**
 * Controla o cofre Agzos Key. No desktop fala com o main (token/crypto nunca no renderer):
 * pareamento -> senha mestra -> lista cifrada. Na web (preview, sem backend) usa os dados
 * mocados do localStorage e já abre "desbloqueado".
 */
export function useVault(desktop: DesktopBridge | null): VaultController {
  const [state, setState] = useState<KeyState>(() =>
    desktop ? { paired: false, unlocked: false, accountEmail: null, deviceId: "" } : webState(true),
  );
  const [entries, setEntries] = useState<VaultEntry[]>(() => (desktop ? [] : readWebEntries()));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  const fail = (result: KeyResult<unknown>): result is { ok: false; error: string } => {
    if (!result.ok) {
      setError(result.error);
      return true;
    }
    return false;
  };

  const refresh = useCallback(async () => {
    if (!desktop) {
      const web = readWebEntries();
      // Mantém a chave agzos-credentials no localStorage (como a versão anterior).
      writeWebEntries(web);
      setEntries(web);
      return;
    }
    const st = await desktop.agzosKeyState();
    if (st.ok) setState(st.data);
    if (st.ok && st.data.paired && st.data.unlocked) {
      setLoading(true);
      const list = await desktop.agzosKeyList();
      setLoading(false);
      if (list.ok) setEntries(list.data.entries);
      else setError(list.error);
    }
  }, [desktop]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pair = useCallback(
    async (code: string): Promise<boolean> => {
      if (!desktop) return true;
      setError(null);
      setLoading(true);
      const res = await desktop.agzosKeyPair(code, "Agzos Browser");
      setLoading(false);
      if (fail(res)) return false;
      const st = await desktop.agzosKeyState();
      if (st.ok) setState(st.data);
      return true;
    },
    [desktop],
  );

  const unlock = useCallback(
    async (password: string): Promise<boolean> => {
      if (!desktop) {
        setState(webState(true));
        return true;
      }
      setError(null);
      setLoading(true);
      const res = await desktop.agzosKeyUnlock(password);
      if (fail(res)) {
        setLoading(false);
        return false;
      }
      const list = await desktop.agzosKeyList();
      setLoading(false);
      if (list.ok) setEntries(list.data.entries);
      setState((prev) => ({ ...prev, unlocked: true }));
      return true;
    },
    [desktop],
  );

  const lock = useCallback(() => {
    if (desktop) void desktop.agzosKeyLock();
    setEntries([]);
    setState((prev) => ({ ...prev, unlocked: false }));
  }, [desktop]);

  const unpair = useCallback(async () => {
    if (desktop) await desktop.agzosKeyUnpair();
    setEntries([]);
    setState({ paired: false, unlocked: false, accountEmail: null, deviceId: "" });
  }, [desktop]);

  const add = useCallback(
    async (entry: VaultEntry) => {
      if (!desktop) {
        const next = [...entriesRef.current.filter((item) => item.id !== entry.id), entry];
        setEntries(next);
        writeWebEntries(next);
        return;
      }
      setError(null);
      const res = await desktop.agzosKeySave(entry);
      if (fail(res)) return;
      await refresh();
    },
    [desktop, refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!desktop) {
        const next = entriesRef.current.filter((item) => item.id !== id);
        setEntries(next);
        writeWebEntries(next);
        return;
      }
      setError(null);
      const res = await desktop.agzosKeyRemove(id);
      if (fail(res)) return;
      setEntries((list) => list.filter((item) => item.id !== id));
    },
    [desktop],
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    state,
    entries,
    loading,
    error,
    pair,
    unlock,
    lock,
    unpair,
    add,
    remove,
    refresh,
    clearError,
  };
}

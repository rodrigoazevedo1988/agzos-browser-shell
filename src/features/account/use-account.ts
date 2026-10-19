import { useCallback, useEffect, useState } from "react";

import { accountBridge, type AccountState, type GoogleProfile } from "./bridge";

/**
 * Estado da Conta Agzos nesta janela: o da conta (empurrado pelo main a cada mudança), o
 * perfil Google da janela e o modal "Escolha uma conta" do início (o main decide se e
 * quando: depois da vinheta, só com login e perfis).
 */
export function useAgzosAccount() {
  const bridge = accountBridge();
  const [state, setState] = useState<AccountState | null>(null);
  const [windowProfile, setWindowProfile] = useState<GoogleProfile | null>(null);
  const [picker, setPicker] = useState<GoogleProfile[] | null>(null);

  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    const refreshProfile = () =>
      void bridge
        .windowProfile()
        .then((profile) => alive && setWindowProfile(profile))
        .catch(() => {});
    void bridge
      .state()
      .then((next) => alive && setState(next))
      .catch(() => {});
    refreshProfile();
    const off = bridge.onState((next) => {
      setState(next);
      refreshProfile();
      // Saiu da conta com o modal aberto: ele some (os perfis travam).
      if (!next.loggedIn) setPicker(null);
    });
    void bridge
      .startupPicker()
      .then((result) => alive && result && result.profiles.length && setPicker(result.profiles))
      .catch(() => {});
    return () => {
      alive = false;
      off();
    };
  }, [bridge]);

  const closePicker = useCallback(() => setPicker(null), []);
  return { bridge, state, windowProfile, picker, closePicker };
}

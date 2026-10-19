// Ponte da Conta Agzos (window.agzosAccount, electron/preload.cjs). O token da conta
// nunca chega aqui: a casca só vê nome, e-mail, plano e os perfis Google.

export type Plan = "free" | "premium";

export type GoogleProfile = {
  id: string;
  label: string;
  email: string;
  name: string;
  color: string;
  /** PNG 64×64 em data: (recodificado no main), ou null. */
  avatar: string | null;
  createdAt: number;
  lastUsed: number;
};

export type AccountState = {
  loggedIn: boolean;
  name: string;
  email: string;
  plan: Plan;
  /** Há chaveiro do sistema para guardar o login? */
  available?: boolean;
  profiles: GoogleProfile[];
  /** Perfis guardados mas travados (sem login). */
  lockedProfiles: number;
  pickerOnStart: boolean;
};

export type AgzosService = {
  id: string;
  name: string;
  description: string;
  plan: Plan;
  status: "soon" | "available";
  locked: boolean;
};

export type Failure = { ok: false; error: string; code?: string };
export type Result<T extends object = object> = ({ ok: true } & T) | Failure;
type WithAccount = { account?: AccountState };

export type AccountBridge = {
  state(): Promise<AccountState>;
  signup(payload: {
    name: string;
    email: string;
    password: string;
  }): Promise<Result<{ recoveryCodes: string[] }> & WithAccount>;
  login(payload: {
    email: string;
    password: string;
  }): Promise<Result<{ recoveryCodesLeft: number | null }> & WithAccount>;
  logout(): Promise<Result & WithAccount>;
  me(): Promise<Result<{ recoveryCodesLeft: number | null }> & WithAccount>;
  recover(payload: {
    email: string;
    recoveryCode: string;
    newPassword: string;
  }): Promise<Result<{ recoveryCodesLeft: number | null }>>;
  changePassword(payload: { currentPassword: string; newPassword: string }): Promise<Result>;
  regenerateCodes(payload: { password: string }): Promise<Result<{ recoveryCodes: string[] }>>;
  deleteAccount(payload: { password: string }): Promise<Result & WithAccount>;
  services(): Promise<Result<{ plan: Plan; services: AgzosService[] }>>;
  setPickerOnStart(showOnStart: boolean): Promise<AccountState>;
  windowProfile(): Promise<GoogleProfile | null>;
  startupPicker(): Promise<{ profiles: GoogleProfile[] } | null>;
  addProfile(label?: string): Promise<Result<{ profile: GoogleProfile }> & WithAccount>;
  openProfile(id: string): Promise<{ ok: boolean }>;
  signInProfile(id: string): Promise<{ ok: boolean }>;
  updateProfile(
    id: string,
    patch: { label?: string; color?: string },
  ): Promise<{ ok: boolean; profile?: GoogleProfile }>;
  removeProfile(id: string): Promise<{ ok: boolean } & WithAccount>;
  detectProfile(id: string): Promise<{ ok: boolean; profile?: GoogleProfile | null }>;
  onState(callback: (state: AccountState) => void): () => void;
};

type AccountWindow = Window & { agzosAccount?: AccountBridge };

export function accountBridge(): AccountBridge | null {
  if (typeof window === "undefined") return null;
  return (window as AccountWindow).agzosAccount ?? null;
}

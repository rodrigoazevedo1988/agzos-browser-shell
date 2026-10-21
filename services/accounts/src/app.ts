// API das Contas Agzos em /browser-api/v1. Quem chama é o processo principal do Agzos
// Browser (nunca uma página): requisições com Origin de navegador fora da lista são
// recusadas e toda chamada precisa do header X-Agzos-Client (um navegador só mandaria
// esse header depois de um preflight CORS, que esta API nunca aprova).
import type { Database } from "bun:sqlite";
import { AVATAR_MAX_BYTES, avatarUploadProblem } from "./avatar.ts";
import { createLimiter } from "./rate-limit.ts";
import {
  dummyPasswordHash,
  hashSecret,
  newRecoveryCodes,
  newSessionToken,
  normalizeDevice,
  normalizeEmail,
  normalizeName,
  normalizeRecoveryCode,
  passwordProblem,
  safeEqual,
  tokenHash,
  verifySecret,
} from "./security.ts";

export const API_PREFIX = "/browser-api/v1";

export type AppConfig = {
  sessionTtlMs: number;
  loginLockThreshold: number;
  loginLockMs: number;
  recoverLockThreshold: number;
  recoverLockMs: number;
  maxBodyBytes: number;
  allowedOrigins: string[];
};

export const DEFAULT_CONFIG: AppConfig = {
  sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
  loginLockThreshold: 5,
  loginLockMs: 15 * 60 * 1000,
  recoverLockThreshold: 5,
  recoverLockMs: 60 * 60 * 1000,
  maxBodyBytes: 16 * 1024,
  allowedOrigins: [],
};

type Plan = "free" | "premium";
type UserRow = {
  id: number;
  email: string;
  name: string;
  password_hash: string;
  plan: Plan;
  created_at: number;
  failed_logins: number;
  login_locked_until: number;
  failed_recoveries: number;
  recovery_locked_until: number;
};
type SessionRow = UserRow & { session_id: number; token_hash: string; expires_at: number };

/** Catálogo dos Serviços Agzos. Os acessos de verdade chegam na próxima versão. */
export const SERVICES: {
  id: string;
  name: string;
  description: string;
  plan: Plan;
  status: "soon" | "available";
}[] = [
  {
    id: "central",
    name: "Central de acessos",
    description: "Os serviços do Agzos Group reunidos num só lugar, com um login só.",
    plan: "free",
    status: "soon",
  },
  {
    id: "sync",
    name: "Sincronização",
    description: "Favoritos, guias e configurações iguais em todos os seus computadores.",
    plan: "premium",
    status: "soon",
  },
  {
    id: "vault-cloud",
    name: "Cofre na nuvem",
    description: "Cópia cifrada do Agzos Key para recuperar seus logins em outro aparelho.",
    plan: "premium",
    status: "soon",
  },
  {
    id: "ai-plus",
    name: "Agzos AI Plus",
    description: "Mais modelos e limites maiores no Agzos AI, sem chave própria.",
    plan: "premium",
    status: "soon",
  },
  {
    id: "support",
    name: "Suporte prioritário",
    description: "Atendimento direto com a equipe do Agzos.",
    plan: "premium",
    status: "soon",
  },
];

const MESSAGES = {
  badRequest: "Requisição inválida.",
  forbidden: "Origem não permitida.",
  notFound: "Endereço não encontrado.",
  noAvatar: "Esta conta não tem foto de perfil.",
  tooLarge: "Requisição grande demais.",
  unauthorized: "Sessão expirada. Entre de novo.",
  invalidLogin: "E-mail ou senha incorretos.",
  invalidRecovery: "Não foi possível redefinir a senha com esses dados.",
  invalidPassword: "Senha incorreta.",
  rateLimited: "Muitas tentativas. Espere alguns minutos e tente de novo.",
  signupFailed:
    "Não foi possível criar a conta com esse e-mail. Se você já tem conta, entre ou recupere a senha.",
  invalidEmail: "Informe um e-mail válido.",
  invalidName: "Informe seu nome (até 80 caracteres).",
  server: "Erro no servidor. Tente de novo.",
} as const;

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });

const fail = (status: number, code: string, message: string) =>
  json(status, { error: { code, message } });

export function createApp({
  db,
  config: overrides = {},
  now = Date.now,
}: {
  db: Database;
  config?: Partial<AppConfig>;
  now?: () => number;
}) {
  const config = { ...DEFAULT_CONFIG, ...overrides };
  // Por IP: toda tentativa conta. Por e-mail: só as falhas.
  const ipLogin = createLimiter({ limit: 30, windowMs: 10 * 60 * 1000, now });
  const ipRecover = createLimiter({ limit: 10, windowMs: 10 * 60 * 1000, now });
  const ipSignup = createLimiter({ limit: 10, windowMs: 60 * 60 * 1000, now });
  // Foto: por conta (troca e remoção), 30 por hora.
  const avatarChanges = createLimiter({ limit: 30, windowMs: 60 * 60 * 1000, now });
  const emailLogin = createLimiter({
    limit: config.loginLockThreshold,
    windowMs: config.loginLockMs,
    now,
  });
  const emailRecover = createLimiter({
    limit: config.recoverLockThreshold,
    windowMs: config.recoverLockMs,
    now,
  });

  const q = {
    userByEmail: db.query("SELECT * FROM users WHERE email = ?"),
    insertUser: db.query(
      "INSERT INTO users (email, name, password_hash, plan, created_at, updated_at) VALUES (?, ?, ?, 'free', ?, ?) RETURNING id",
    ),
    insertSession: db.query(
      "INSERT INTO sessions (user_id, token_hash, device, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    ),
    sessionByHash: db.query(
      "SELECT users.*, sessions.id AS session_id, sessions.token_hash AS token_hash, sessions.expires_at AS expires_at FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ?",
    ),
    touchSession: db.query("UPDATE sessions SET last_seen_at = ? WHERE id = ?"),
    deleteSession: db.query("DELETE FROM sessions WHERE id = ?"),
    deleteSessions: db.query("DELETE FROM sessions WHERE user_id = ?"),
    deleteOtherSessions: db.query("DELETE FROM sessions WHERE user_id = ? AND id != ?"),
    deleteExpired: db.query("DELETE FROM sessions WHERE expires_at <= ?"),
    insertCode: db.query(
      "INSERT INTO recovery_codes (user_id, code_hash, created_at) VALUES (?, ?, ?)",
    ),
    unusedCodes: db.query(
      "SELECT id, code_hash FROM recovery_codes WHERE user_id = ? AND used_at IS NULL",
    ),
    countCodes: db.query(
      "SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL",
    ),
    useCode: db.query("UPDATE recovery_codes SET used_at = ? WHERE id = ? AND used_at IS NULL"),
    deleteCodes: db.query("DELETE FROM recovery_codes WHERE user_id = ?"),
    setPassword: db.query("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?"),
    loginFailed: db.query(
      "UPDATE users SET failed_logins = ?, login_locked_until = ? WHERE id = ?",
    ),
    recoverFailed: db.query(
      "UPDATE users SET failed_recoveries = ?, recovery_locked_until = ? WHERE id = ?",
    ),
    deleteUser: db.query("DELETE FROM users WHERE id = ?"),
    avatarVersion: db.query("SELECT version FROM avatars WHERE user_id = ?"),
    avatarRow: db.query("SELECT mime, data FROM avatars WHERE user_id = ?"),
    upsertAvatar: db.query(
      `INSERT INTO avatars (user_id, mime, data, version, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         mime = excluded.mime,
         data = excluded.data,
         version = MAX(avatars.version + 1, excluded.version),
         updated_at = excluded.updated_at
       RETURNING version`,
    ),
    deleteAvatar: db.query("DELETE FROM avatars WHERE user_id = ?"),
  };

  const publicUser = (user: UserRow) => ({
    name: user.name,
    email: user.email,
    plan: user.plan,
    createdAt: user.created_at,
  });
  const codesLeft = (userId: number) => (q.countCodes.get(userId) as { n: number } | null)?.n ?? 0;
  /** Versão da foto (null sem foto). O app compara com a que tem em cache. */
  const avatarVersionOf = (userId: number): number | null =>
    (q.avatarVersion.get(userId) as { version: number } | null)?.version ?? null;

  async function storeCodes(userId: number): Promise<string[]> {
    const codes = newRecoveryCodes();
    const hashes = await Promise.all(
      codes.map((code) => hashSecret(normalizeRecoveryCode(code) as string)),
    );
    db.transaction(() => {
      q.deleteCodes.run(userId);
      for (const hash of hashes) q.insertCode.run(userId, hash, now());
    })();
    return codes;
  }

  function startSession(userId: number, device: string) {
    const token = newSessionToken();
    const at = now();
    const expiresAt = at + config.sessionTtlMs;
    q.insertSession.run(userId, tokenHash(token), normalizeDevice(device), at, at, expiresAt);
    return { token, expiresAt };
  }

  function authenticate(request: Request): SessionRow {
    const header = request.headers.get("authorization") ?? "";
    const match = /^Bearer ([A-Za-z0-9_-]{20,128})$/.exec(header);
    if (!match?.[1]) throw new HttpError(401, "unauthorized", MESSAGES.unauthorized);
    const hash = tokenHash(match[1]);
    const row = q.sessionByHash.get(hash) as SessionRow | null;
    if (!row || !safeEqual(row.token_hash, hash)) {
      throw new HttpError(401, "unauthorized", MESSAGES.unauthorized);
    }
    if (row.expires_at <= now()) {
      q.deleteSession.run(row.session_id);
      throw new HttpError(401, "unauthorized", MESSAGES.unauthorized);
    }
    q.touchSession.run(now(), row.session_id);
    return row;
  }

  /** Corpo binário (foto): lê até `limit` bytes e recusa o resto com 413. */
  async function readRaw(request: Request, limit: number): Promise<Uint8Array> {
    const length = Number(request.headers.get("content-length") ?? "0");
    if (length > limit) throw new HttpError(413, "too_large", MESSAGES.tooLarge);
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) {
          await reader.cancel().catch(() => {});
          throw new HttpError(413, "too_large", MESSAGES.tooLarge);
        }
        chunks.push(value);
      }
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }

  async function readBody(request: Request): Promise<Record<string, unknown>> {
    const type = request.headers.get("content-type") ?? "";
    if (!/^application\/json\b/i.test(type)) {
      throw new HttpError(415, "bad_request", MESSAGES.badRequest);
    }
    const length = Number(request.headers.get("content-length") ?? "0");
    if (length > config.maxBodyBytes) throw new HttpError(413, "too_large", MESSAGES.tooLarge);
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > config.maxBodyBytes) {
          await reader.cancel().catch(() => {});
          throw new HttpError(413, "too_large", MESSAGES.tooLarge);
        }
        chunks.push(value);
      }
    }
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw 0;
      return parsed as Record<string, unknown>;
    } catch {
      throw new HttpError(400, "bad_request", MESSAGES.badRequest);
    }
  }

  const rateLimited = () => new HttpError(429, "rate_limited", MESSAGES.rateLimited);
  const str = (value: unknown) => (typeof value === "string" ? value : "");

  // --- Rotas ---

  async function signup(request: Request, ip: string) {
    if (!ipSignup.allowed(ip)) throw rateLimited();
    ipSignup.hit(ip);
    const body = await readBody(request);
    const name = normalizeName(body["name"]);
    if (!name) throw new HttpError(400, "invalid_name", MESSAGES.invalidName);
    const email = normalizeEmail(body["email"]);
    if (!email) throw new HttpError(400, "invalid_email", MESSAGES.invalidEmail);
    const password = str(body["password"]);
    const problem = passwordProblem(password, email);
    if (problem) throw new HttpError(400, "weak_password", problem);
    const hash = await hashSecret(password);
    let userId: number;
    try {
      const row = q.insertUser.get(email, name, hash, now(), now()) as { id: number };
      userId = row.id;
    } catch {
      // E-mail já cadastrado (UNIQUE): mesma resposta genérica de qualquer recusa.
      throw new HttpError(409, "signup_failed", MESSAGES.signupFailed);
    }
    const recoveryCodes = await storeCodes(userId);
    const user = q.userByEmail.get(email) as UserRow;
    const session = startSession(userId, str(body["device"]));
    return json(201, {
      ...session,
      user: publicUser(user),
      recoveryCodes,
      avatarVersion: avatarVersionOf(userId),
    });
  }

  async function login(request: Request, ip: string) {
    if (!ipLogin.allowed(ip)) throw rateLimited();
    ipLogin.hit(ip);
    const body = await readBody(request);
    const email = normalizeEmail(body["email"]);
    const password = str(body["password"]);
    const key = email ?? "invalid";
    if (!emailLogin.allowed(key)) throw rateLimited();
    const user = email ? (q.userByEmail.get(email) as UserRow | null) : null;
    if (user && user.login_locked_until > now()) throw rateLimited();
    const ok =
      user && password
        ? await verifySecret(password, user.password_hash)
        : (await verifySecret(password || "x", await dummyPasswordHash()), false);
    if (!ok || !user) {
      emailLogin.hit(key);
      if (user) {
        const failures = user.failed_logins + 1;
        const lock = failures >= config.loginLockThreshold;
        q.loginFailed.run(lock ? 0 : failures, lock ? now() + config.loginLockMs : 0, user.id);
      }
      throw new HttpError(401, "invalid_login", MESSAGES.invalidLogin);
    }
    emailLogin.reset(key);
    q.loginFailed.run(0, 0, user.id);
    const session = startSession(user.id, str(body["device"]));
    return json(200, {
      ...session,
      user: publicUser(user),
      recoveryCodesLeft: codesLeft(user.id),
      avatarVersion: avatarVersionOf(user.id),
    });
  }

  async function recover(request: Request, ip: string) {
    if (!ipRecover.allowed(ip)) throw rateLimited();
    ipRecover.hit(ip);
    const body = await readBody(request);
    const email = normalizeEmail(body["email"]);
    const code = normalizeRecoveryCode(body["recoveryCode"]);
    const password = str(body["newPassword"]);
    const key = email ?? "invalid";
    if (!emailRecover.allowed(key)) throw rateLimited();
    const problem = passwordProblem(password, email);
    if (problem) throw new HttpError(400, "weak_password", problem);
    const user = email ? (q.userByEmail.get(email) as UserRow | null) : null;
    if (user && user.recovery_locked_until > now()) throw rateLimited();
    let matched: number | null = null;
    if (user && code) {
      const rows = q.unusedCodes.all(user.id) as { id: number; code_hash: string }[];
      // Confere todos (sem parar no primeiro): o tempo não diz qual código bateu.
      for (const row of rows) {
        if ((await verifySecret(code, row.code_hash)) && matched === null) matched = row.id;
      }
    } else {
      await verifySecret(code ?? "x", await dummyPasswordHash());
    }
    if (!user || matched === null) {
      emailRecover.hit(key);
      if (user) {
        const failures = user.failed_recoveries + 1;
        const lock = failures >= config.recoverLockThreshold;
        q.recoverFailed.run(lock ? 0 : failures, lock ? now() + config.recoverLockMs : 0, user.id);
      }
      throw new HttpError(400, "invalid_recovery", MESSAGES.invalidRecovery);
    }
    const hash = await hashSecret(password);
    const used = db.transaction(() => {
      const change = q.useCode.run(now(), matched);
      if (change.changes !== 1) return false;
      q.setPassword.run(hash, now(), user.id);
      q.deleteSessions.run(user.id);
      q.recoverFailed.run(0, 0, user.id);
      q.loginFailed.run(0, 0, user.id);
      return true;
    })();
    if (!used) throw new HttpError(400, "invalid_recovery", MESSAGES.invalidRecovery);
    emailRecover.reset(key);
    emailLogin.reset(key);
    return json(200, { ok: true, recoveryCodesLeft: codesLeft(user.id) });
  }

  async function requirePassword(request: Request, row: SessionRow, field = "password") {
    const body = await readBody(request);
    const password = str(body[field]);
    const key = `auth:${row.id}`;
    if (!emailLogin.allowed(key)) throw rateLimited();
    if (!password || !(await verifySecret(password, row.password_hash))) {
      emailLogin.hit(key);
      throw new HttpError(403, "invalid_password", MESSAGES.invalidPassword);
    }
    emailLogin.reset(key);
    return body;
  }

  async function changePassword(request: Request) {
    const row = authenticate(request);
    const body = await requirePassword(request, row, "currentPassword");
    const password = str(body["newPassword"]);
    const problem = passwordProblem(password, row.email);
    if (problem) throw new HttpError(400, "weak_password", problem);
    const hash = await hashSecret(password);
    db.transaction(() => {
      q.setPassword.run(hash, now(), row.id);
      q.deleteOtherSessions.run(row.id, row.session_id);
    })();
    return json(200, { ok: true });
  }

  async function regenerateCodes(request: Request) {
    const row = authenticate(request);
    await requirePassword(request, row);
    const recoveryCodes = await storeCodes(row.id);
    return json(200, { recoveryCodes });
  }

  async function deleteAccount(request: Request) {
    const row = authenticate(request);
    await requirePassword(request, row);
    q.deleteUser.run(row.id);
    return json(200, { ok: true });
  }

  function refresh(request: Request) {
    const row = authenticate(request);
    const device = (
      db.query("SELECT device FROM sessions WHERE id = ?").get(row.session_id) as {
        device: string;
      } | null
    )?.device;
    const session = db.transaction(() => {
      q.deleteSession.run(row.session_id);
      return startSession(row.id, device ?? "");
    })();
    return json(200, { ...session, user: publicUser(row) });
  }

  async function putAvatar(request: Request) {
    const row = authenticate(request);
    if (!avatarChanges.allowed(String(row.id))) throw rateLimited();
    avatarChanges.hit(String(row.id));
    const bytes = await readRaw(request, AVATAR_MAX_BYTES);
    const problem = avatarUploadProblem(request.headers.get("content-type"), bytes);
    if (problem) {
      const status = problem.code === "too_large" ? 413 : 400;
      throw new HttpError(status, problem.code, problem.message);
    }
    const mime = (request.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    const at = now();
    const { version } = q.upsertAvatar.get(row.id, mime, bytes, at, at) as { version: number };
    return json(200, { avatarVersion: version });
  }

  function getAvatar(request: Request) {
    const row = authenticate(request);
    const photo = q.avatarRow.get(row.id) as { mime: string; data: Uint8Array } | null;
    if (!photo) return fail(404, "not_found", MESSAGES.noAvatar);
    return new Response(photo.data, {
      status: 200,
      headers: {
        "Content-Type": photo.mime,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  function deleteAvatar(request: Request) {
    const row = authenticate(request);
    if (!avatarChanges.allowed(String(row.id))) throw rateLimited();
    avatarChanges.hit(String(row.id));
    q.deleteAvatar.run(row.id);
    return json(200, { ok: true, avatarVersion: null });
  }

  function services(request: Request) {
    const row = authenticate(request);
    return json(200, {
      plan: row.plan,
      services: SERVICES.map((service) => ({
        ...service,
        locked: service.plan === "premium" && row.plan !== "premium",
      })),
    });
  }

  const routes: Record<string, (request: Request, ip: string) => Promise<Response> | Response> = {
    "POST /signup": signup,
    "POST /login": login,
    "POST /logout": (request) => {
      const row = authenticate(request);
      q.deleteSession.run(row.session_id);
      return json(200, { ok: true });
    },
    "GET /me": (request) => {
      const row = authenticate(request);
      return json(200, {
        user: publicUser(row),
        recoveryCodesLeft: codesLeft(row.id),
        avatarVersion: avatarVersionOf(row.id),
      });
    },
    "POST /refresh": refresh,
    "POST /password/change": changePassword,
    "POST /password/recover": recover,
    "POST /recovery-codes/regenerate": regenerateCodes,
    "DELETE /account": deleteAccount,
    "GET /services": services,
    "GET /avatar": getAvatar,
    "PUT /avatar": putAvatar,
    "DELETE /avatar": deleteAvatar,
  };

  let lastSweep = 0;

  async function handle(request: Request, ip: string): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(`${API_PREFIX}/`)) {
      return fail(404, "not_found", MESSAGES.notFound);
    }
    const route = url.pathname.slice(API_PREFIX.length).replace(/\/+$/, "") || "/";
    if (request.method === "GET" && route === "/health") return json(200, { ok: true });
    const origin = request.headers.get("origin");
    if (origin !== null && !config.allowedOrigins.includes(origin)) {
      return fail(403, "forbidden", MESSAGES.forbidden);
    }
    if (!request.headers.get("x-agzos-client")) return fail(403, "forbidden", MESSAGES.forbidden);
    const handler = routes[`${request.method} ${route}`];
    if (!handler) return fail(404, "not_found", MESSAGES.notFound);
    if (now() - lastSweep > 60 * 60 * 1000) {
      lastSweep = now();
      q.deleteExpired.run(now());
    }
    try {
      return await handler(request, ip);
    } catch (error) {
      if (error instanceof HttpError) return fail(error.status, error.code, error.message);
      console.error("accounts: erro inesperado", error);
      return fail(500, "server_error", MESSAGES.server);
    }
  }

  return { handle, config };
}

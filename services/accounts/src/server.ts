// Servidor das Contas Agzos. Escuta só em 127.0.0.1: o nginx do domínio do OTA
// (agzosagency.com.br) repassa /browser-api/ para cá e manda o IP real em X-Real-IP.
import { createApp } from "./app.ts";
import { openDatabase } from "./db.ts";

const env = process.env;
const port = Number(env["PORT"] ?? 3920);
const host = env["HOST"] ?? "127.0.0.1";
const dbFile = env["ACCOUNTS_DB"] ?? "./data/accounts.db";
// Atrás do nginx (padrão): o IP vem do header que ele grava. TRUST_PROXY=0 usa o socket.
const trustProxy = env["TRUST_PROXY"] !== "0";
const allowedOrigins = (env["ALLOWED_ORIGINS"] ?? "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const db = openDatabase(dbFile);
const app = createApp({ db, config: { allowedOrigins } });

const server = Bun.serve({
  port,
  hostname: host,
  // Corpo maior que isso nem chega ao handler. JSON é conferido em 16 KB; a foto de perfil
  // (PUT /avatar, até 512 KB) tem o próprio limite no handler.
  maxRequestBodySize: 600 * 1024,
  fetch(request, srv) {
    const forwarded = trustProxy ? request.headers.get("x-real-ip")?.trim() : null;
    const ip = forwarded || srv.requestIP(request)?.address || "unknown";
    return app.handle(request, ip);
  },
});

console.log(`accounts: ouvindo em http://${server.hostname}:${server.port}/browser-api/v1`);

const stop = () => {
  server.stop();
  db.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

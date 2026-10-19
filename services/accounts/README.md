# Contas Agzos (API)

API própria das contas do Agzos Browser. Roda neste servidor (Bun + `bun:sqlite`) e é
servida pelo domínio do OTA em `https://agzosagency.com.br/browser-api/v1`. Os caminhos
`/api/` e `/api/v1/` pertencem a outros serviços e não são tocados.

Quem chama é só o processo principal do navegador (`electron/agzos-account.cjs`). O token
de sessão nunca chega à casca nem às páginas.

## Endpoints (`/browser-api/v1`)

Todas as chamadas (menos `GET /health`) precisam do header `X-Agzos-Client`. Requisições
com `Origin` de navegador fora de `ALLOWED_ORIGINS` recebem 403. Corpo sempre JSON
(`Content-Type: application/json`, até 16 KB). Erros: `{ "error": { "code", "message" } }`.

| Método e rota                     | Autenticação | Corpo                                  | Resposta                                                                        |
| --------------------------------- | ------------ | -------------------------------------- | ------------------------------------------------------------------------------- |
| `GET /health`                     | —            | —                                      | `{ ok }`                                                                        |
| `POST /signup`                    | —            | `{ name, email, password, device? }`   | 201 `{ token, expiresAt, user, recoveryCodes }` (os 8 códigos aparecem só aqui) |
| `POST /login`                     | —            | `{ email, password, device? }`         | `{ token, expiresAt, user, recoveryCodesLeft }`                                 |
| `POST /logout`                    | Bearer       | —                                      | `{ ok }`                                                                        |
| `GET /me`                         | Bearer       | —                                      | `{ user, recoveryCodesLeft }`                                                   |
| `POST /refresh`                   | Bearer       | —                                      | `{ token, expiresAt, user }` (o token antigo deixa de valer)                    |
| `POST /password/change`           | Bearer       | `{ currentPassword, newPassword }`     | `{ ok }` (outras sessões caem)                                                  |
| `POST /password/recover`          | —            | `{ email, recoveryCode, newPassword }` | `{ ok, recoveryCodesLeft }` (consome o código, derruba todas as sessões)        |
| `POST /recovery-codes/regenerate` | Bearer       | `{ password }`                         | `{ recoveryCodes }` (os antigos deixam de valer)                                |
| `DELETE /account`                 | Bearer       | `{ password }`                         | `{ ok }`                                                                        |
| `GET /services`                   | Bearer       | —                                      | `{ plan, services: [{ id, name, description, plan, status, locked }] }`         |

`user` = `{ name, email, plan: "free" | "premium", createdAt }`.

## Segurança

- Senhas e códigos de recuperação com Argon2id (`Bun.password`, 19 MiB, t=2).
- Tokens de sessão: 32 bytes aleatórios; o banco guarda só o sha256, com validade
  (30 dias) e o rótulo do aparelho.
- Recuperação de senha sem e-mail nesta versão: 8 códigos de uso único gerados no
  cadastro (ou em "gerar novos códigos").
- Limites: por IP (login 30/10 min, recuperação 10/10 min, cadastro 10/h) e por e-mail
  (5 falhas de login → 15 min; 5 falhas de recuperação → 60 min), em memória e com
  contadores de bloqueio no banco. E-mail inexistente recebe a mesma resposta e o mesmo
  bloqueio de um e-mail cadastrado.
- Mensagens genéricas (sem enumerar contas no login e na recuperação). O cadastro de um
  e-mail já usado responde 409 com texto genérico: sem verificação por e-mail não há
  como esconder isso por completo; o limite por IP segura a varredura.
- E-mails normalizados (trim, minúsculas, NFC); senha com no mínimo 10 caracteres.

## Rodar localmente

```sh
cd services/accounts
bun test
PORT=3920 ACCOUNTS_DB=./data/accounts.db bun src/server.ts
curl -s http://127.0.0.1:3920/browser-api/v1/health
```

Variáveis: `PORT` (3920), `HOST` (127.0.0.1), `ACCOUNTS_DB` (`./data/accounts.db`, WAL),
`TRUST_PROXY` (1: IP vem de `X-Real-IP` do nginx), `ALLOWED_ORIGINS` (lista separada por
vírgula; vazia por padrão).

## Deploy (neste servidor)

1. Confira que a porta está livre: `ss -ltn | grep 3920` (sem saída = livre).
2. Pasta do banco: `mkdir -p /var/www/agzos-browser/services/accounts/data && chmod 700 /var/www/agzos-browser/services/accounts/data`.
3. pm2:
   ```sh
   pm2 start /var/www/agzos-browser/services/accounts/deploy/ecosystem.config.cjs
   pm2 save
   curl -s http://127.0.0.1:3920/browser-api/v1/health   # {"ok":true}
   ```
   Se o bun não estiver em `/root/.bun/bin/bun`, defina `BUN_PATH` antes do `pm2 start`.
4. nginx: cole `deploy/nginx-browser-api.conf` nos dois `server { }` de
   `agzosagency.com.br` (443 e 80, que recebe o Cloudflare Tunnel), antes do location do OTA, depois
   `nginx -t && systemctl reload nginx`.
5. Teste de fora: `curl -s https://agzosagency.com.br/browser-api/v1/health`.
6. Backup: copie `data/accounts.db` com `sqlite3 data/accounts.db ".backup /caminho/backup.db"`
   (o WAL não deixa uma cópia simples do arquivo consistente).

Atualizar: `git pull` e `pm2 restart agzos-accounts`. Migrações novas entram em
`MIGRATIONS` (`src/db.ts`) e rodam sozinhas no início; nunca edite uma já aplicada.

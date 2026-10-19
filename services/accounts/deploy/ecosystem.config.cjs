// pm2 das Contas Agzos: `pm2 start services/accounts/deploy/ecosystem.config.cjs`.
const path = require("node:path");

const root = path.join(__dirname, "..");

module.exports = {
  apps: [
    {
      name: "agzos-accounts",
      cwd: root,
      script: "src/server.ts",
      // O daemon do pm2 nem sempre tem ~/.bun/bin no PATH.
      interpreter: process.env.BUN_PATH || "/root/.bun/bin/bun",
      env: {
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: "3920",
        ACCOUNTS_DB: path.join(root, "data", "accounts.db"),
        TRUST_PROXY: "1",
      },
      max_memory_restart: "256M",
      autorestart: true,
      time: true,
    },
  ],
};

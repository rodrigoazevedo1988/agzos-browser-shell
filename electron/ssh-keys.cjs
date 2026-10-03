// Chaves SSH do usuário (4.1): lista as de ~/.ssh (só a parte pública sai daqui), gera uma
// ed25519 nova com o ssh-keygen do sistema e informa o caminho da privada para as
// conexões salvas (ssh -i). A chave privada nunca é lida nem enviada para a casca.

const fs = require("node:fs");
const path = require("node:path");

const KEY_NAME = /^[A-Za-z0-9_.-]{1,64}$/;

/** "ssh-ed25519 AAAA… rodrigo@pc" → tipo e comentário. */
function parsePublicKey(text) {
  const parts = String(text ?? "")
    .trim()
    .split(/\s+/);
  if (parts.length < 2 || !/^(ssh-|ecdsa-|sk-)/.test(parts[0])) return null;
  return { type: parts[0], comment: parts.slice(2).join(" ") };
}

function listKeys(sshDir) {
  let files = [];
  try {
    files = fs.readdirSync(sshDir);
  } catch {
    return [];
  }
  return files
    .filter((file) => file.endsWith(".pub"))
    .flatMap((file) => {
      const publicPath = path.join(sshDir, file);
      let publicKey = "";
      try {
        publicKey = fs.readFileSync(publicPath, "utf8").trim();
      } catch {
        return [];
      }
      const info = parsePublicKey(publicKey);
      if (!info) return [];
      const privatePath = publicPath.slice(0, -4);
      return [
        {
          name: file.slice(0, -4),
          type: info.type,
          comment: info.comment,
          publicKey,
          privatePath: fs.existsSync(privatePath) ? privatePath : null,
        },
      ];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function keygenBinary({ platform, env, exists }) {
  if (platform === "win32") {
    const root = env.SystemRoot || env.windir || "C:\\Windows";
    const builtin = path.win32.join(root, "System32", "OpenSSH", "ssh-keygen.exe");
    return exists(builtin) ? builtin : "ssh-keygen.exe";
  }
  for (const file of [
    "/usr/bin/ssh-keygen",
    "/usr/local/bin/ssh-keygen",
    "/opt/homebrew/bin/ssh-keygen",
  ]) {
    if (exists(file)) return file;
  }
  return "ssh-keygen";
}

/**
 * Gera ~/.ssh/<nome> (ed25519). Não sobrescreve chave existente. A frase-senha vai como
 * argumento do ssh-keygen (processo local, sem shell) e não é guardada.
 */
function generateKey({ sshDir, name, comment, passphrase, execFile, binary }) {
  return new Promise((resolve) => {
    if (!KEY_NAME.test(String(name ?? "")) || name.startsWith(".")) {
      resolve({ ok: false, error: "name" });
      return;
    }
    const file = path.join(sshDir, name);
    if (fs.existsSync(file) || fs.existsSync(`${file}.pub`)) {
      resolve({ ok: false, error: "exists" });
      return;
    }
    const text = typeof comment === "string" ? comment.trim().slice(0, 120) : "";
    const secret = typeof passphrase === "string" ? passphrase : "";
    if (/[\r\n\0]/.test(text) || /[\r\n\0]/.test(secret)) {
      resolve({ ok: false, error: "value" });
      return;
    }
    try {
      fs.mkdirSync(sshDir, { recursive: true, mode: 0o700 });
    } catch {
      resolve({ ok: false, error: "storage" });
      return;
    }
    execFile(
      binary,
      ["-q", "-t", "ed25519", "-f", file, "-N", secret, "-C", text],
      { timeout: 20_000, windowsHide: true },
      (error) => {
        if (error) {
          resolve({ ok: false, error: error.code === "ENOENT" ? "no-keygen" : "keygen" });
          return;
        }
        const key = listKeys(sshDir).find((item) => item.name === name);
        resolve(key ? { ok: true, key } : { ok: false, error: "keygen" });
      },
    );
  });
}

module.exports = { generateKey, keygenBinary, listKeys, parsePublicKey };

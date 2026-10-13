// Smoke do print colado numa sessão SSH (4.9.7), rodado no CI de cada sistema
// (.github/workflows/clipboard-os.yml) contra um sshd local com chave. Usa o mesmo ssh que
// o app escolhe (sshBinary: OpenSSH do System32 no Windows) e o mesmo envio do main.
// Uso: node scripts/ssh-print-smoke.cjs <porta> <usuário> <chave>
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const { uploadPrint } = require("../electron/clipboard-image.cjs");
const { sshBinary } = require("../electron/terminal-launch.cjs");

const zlib = require("node:zlib");

const [port, user, key] = process.argv.slice(2);

/** PNG 37×21 laranja, sem depender de nada além do Node. */
function samplePng(width = 37, height = 21) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buffer) => {
    let c = 0xffffffff;
    for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.concat(
    Array.from({ length: height }, () =>
      Buffer.concat([
        Buffer.from([0]),
        ...Array.from({ length: width }, () => Buffer.from([255, 128, 0])),
      ]),
    ),
  );
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const sshFile = sshBinary({ platform: process.platform, env: process.env, exists: fs.existsSync });
const base = [
  "-o",
  "StrictHostKeyChecking=no",
  "-o",
  "UserKnownHostsFile=" + (process.platform === "win32" ? "NUL" : "/dev/null"),
  "-p",
  port,
];
const fail = (message) => {
  console.error(`FALHOU: ${message}`);
  process.exit(1);
};

(async () => {
  console.log("ssh:", sshFile);
  const png = samplePng();
  const ok = await uploadPrint(png, {
    sshFile,
    args: [...base, "-i", key, `${user}@127.0.0.1`],
    execFile,
  });
  console.log("com chave:", JSON.stringify(ok));
  if (!ok?.file) return fail("o print não chegou");
  const size = await new Promise((resolve) =>
    execFile(
      sshFile,
      ["-T", "-o", "BatchMode=yes", ...base, "-i", key, `${user}@127.0.0.1`, `wc -c < ${ok.file}`],
      (error, stdout, stderr) => resolve(error ? `erro ${stderr}` : String(stdout).trim()),
    ),
  );
  if (Number(size) !== png.length) return fail(`tamanho remoto ${size}, esperado ${png.length}`);
  const denied = await uploadPrint(png, {
    sshFile,
    args: [...base, `nobody-${Date.now()}@127.0.0.1`],
    execFile,
  });
  console.log("sem chave:", JSON.stringify(denied));
  if (denied?.error !== "ssh-auth") return fail("sem chave deveria dar ssh-auth");
  console.log("OK");
})().catch((error) => fail(error?.stack ?? String(error)));

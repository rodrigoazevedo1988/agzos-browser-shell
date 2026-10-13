// Smoke do print colado no terminal (4.9.6), rodado pelo Electron no CI de cada sistema
// (.github/workflows/clipboard-os.yml). O passo anterior põe uma imagem na área de
// transferência pelo caminho nativo do sistema (Clipboard.SetImage no Windows, PNGf no Mac,
// xclip no Linux), como a Ferramenta de Captura ou o Cmd+Ctrl+Shift+4; aqui o mesmo código
// do main a lê e salva. Uso: electron scripts/clipboard-image-smoke.cjs <largura> <altura>
const { app, clipboard, nativeImage } = require("electron");
const fs = require("node:fs");
const { pasteClipboardImage } = require("../electron/clipboard-image.cjs");

const [width, height] = process.argv.slice(-2).map(Number);
const fail = (message) => {
  console.error(`FALHOU: ${message}`);
  app.exit(1);
};
setTimeout(() => fail("tempo esgotado"), 30_000).unref();

app.whenReady().then(async () => {
  try {
    const items = await clipboard.read();
    console.log("tipos:", JSON.stringify(items.map((item) => item.types)));
    const file = (await pasteClipboardImage({ clipboard, nativeImage }))?.file;
    if (!file) return fail("nenhuma imagem lida da área de transferência");
    const png = fs.readFileSync(file);
    if (png.subarray(1, 4).toString() !== "PNG") return fail(`${file} não é PNG`);
    const size = nativeImage.createFromBuffer(png).getSize();
    console.log("arquivo:", file, `${size.width}x${size.height}`, `${png.length} bytes`);
    if (size.width !== width || size.height !== height) {
      return fail(`tamanho ${size.width}x${size.height}, esperado ${width}x${height}`);
    }
    console.log("OK");
    app.exit(0);
  } catch (error) {
    fail(error?.stack ?? String(error));
  }
});

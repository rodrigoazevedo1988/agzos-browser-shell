// Captura de tela e imagens salvas (4.5): nomes de arquivo e validação do PNG que a casca
// manda para copiar ou salvar.

const MAX_PNG_BYTES = 60 * 1024 * 1024;

/** Só PNG em base64 (o que o canvas da casca gera), até 60 MB. */
function isPngDataUrl(value) {
  return (
    typeof value === "string" &&
    value.startsWith("data:image/png;base64,") &&
    value.length < (MAX_PNG_BYTES * 4) / 3 + 64 &&
    /^[A-Za-z0-9+/]+=*$/.test(value.slice(22, 22 + 4096))
  );
}

const pad = (value) => String(value).padStart(2, "0");

/** "Captura 2026-10-03 às 14.05.33.png" (sem ":" para valer no Windows). */
function captureFileName(date) {
  return `Captura ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} às ${pad(
    date.getHours(),
  )}.${pad(date.getMinutes())}.${pad(date.getSeconds())}.png`;
}

const EXTENSIONS = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
};

/** Nome para a imagem salva: o do endereço (sem caracteres proibidos) com a extensão certa. */
function imageFileName(url, mime = "") {
  const extension = EXTENSIONS[String(mime).toLowerCase()] ?? null;
  let base = "imagem";
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "data:") {
      const last = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() ?? "");
      if (last) base = last;
    }
  } catch {
    base = "imagem";
  }
  base = base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 120) || "imagem";
  const current = /\.([a-z0-9]{2,5})$/i.exec(base)?.[1]?.toLowerCase();
  if (!extension) return current ? base : `${base}.png`;
  if (current === extension || (current === "jpeg" && extension === "jpg")) return base;
  return `${current ? base.slice(0, -(current.length + 1)) : base}.${extension}`;
}

module.exports = { captureFileName, imageFileName, isPngDataUrl };

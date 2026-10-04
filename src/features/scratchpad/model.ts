import type { CapturedRequest, ScratchpadRequest } from "@/features/browser/desktop";

export const SCRATCHPAD_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/** Headers → texto do editor ("Nome: valor" por linha). */
export function headersToText(headers: [string, string][]): string {
  return headers.map(([name, value]) => `${name}: ${value}`).join("\n");
}

/** Texto do editor → headers (linhas sem ":" ou começando com # ficam de fora). */
export function textToHeaders(text: string): [string, string][] {
  const headers: [string, string][] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    // Pseudo-headers do HTTP/2 (":authority: x") não vão.
    if (trimmed.startsWith(":")) continue;
    const index = trimmed.indexOf(":");
    if (index <= 0) continue;
    headers.push([trimmed.slice(0, index).trim(), trimmed.slice(index + 1).trim()]);
  }
  return headers;
}

/** Requisição capturada → editor. */
export function editorOf(request: CapturedRequest): ScratchpadRequest {
  return {
    method: request.method,
    url: request.url,
    headers: request.headers.filter(([name]) => !name.startsWith(":")),
    body: request.body,
  };
}

/** Corpo da resposta: JSON indentado quando dá, senão como veio. */
export function prettyBody(body: string, contentType: string): string {
  if (!/json/i.test(contentType) && !/^\s*[[{]/.test(body)) return body;
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** URL curta da lista: caminho + busca, com o host quando é de outro site. */
export function shortUrl(url: string, pageUrl: string): string {
  try {
    const parsed = new URL(url);
    const page = new URL(pageUrl);
    const path = `${parsed.pathname}${parsed.search}`;
    return parsed.host === page.host ? path : `${parsed.host}${path}`;
  } catch {
    return url;
  }
}

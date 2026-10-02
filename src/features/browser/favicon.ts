/**
 * Favicons dos atalhos, do Discador e da barra lateral (3.0): o serviço de ícones do Google
 * primeiro, o /favicon.ico do próprio site depois e, se os dois falharem, a inicial.
 */

/** "site.com", "https://site.com/x" → "site.com" (null se não der para ler um domínio). */
export function domainOf(value: string): string | null {
  const clean = value.trim();
  if (!clean) return null;
  try {
    const url = new URL(/^[a-z][\w+.-]*:\/\//i.test(clean) ? clean : `https://${clean}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** Endereços a tentar, em ordem, para o ícone do site. */
export function faviconSources(value: string, size = 64): string[] {
  const domain = domainOf(value);
  if (!domain) return [];
  return [
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size}`,
    `https://${domain}/favicon.ico`,
  ];
}

/** Inicial do nome (ou do domínio) para quando não há ícone. */
export function initialOf(name: string, url = ""): string {
  const source = name.trim() || domainOf(url) || "";
  return source.charAt(0).toUpperCase() || "?";
}

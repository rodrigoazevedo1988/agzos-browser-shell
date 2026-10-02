import { domainOf } from "@/features/browser/favicon";
import type { QuickLink } from "@/features/browser/types";

export type DialScope = "general" | "web";

/** Endereço digitado no "+" → card (null se não parecer um site). */
export function dialLinkOf(name: string, address: string): QuickLink | null {
  const url = address
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
  if (!url || /\s/.test(url) || !domainOf(url)) return null;
  return { name: name.trim() || domainOf(url) || url, url };
}

const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Busca "Geral": cards cujo nome ou endereço contém o texto (sem acento/maiúscula). */
export function filterDial(links: QuickLink[], query: string): QuickLink[] {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return links;
  return links.filter((link) => {
    const text = fold(`${link.name} ${link.url}`);
    return terms.every((term) => text.includes(term));
  });
}

/** Endereço do card para abrir na guia (os cards guardam o domínio sem esquema). */
export function dialHref(link: QuickLink): string {
  return /^https?:\/\//i.test(link.url) ? link.url : `https://${link.url}`;
}

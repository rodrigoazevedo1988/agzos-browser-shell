import { hashString, seededRandom } from "@/lib/seeded";

export type BlockedTracker = { host: string; category: string };

const categories: { name: string; min: number; max: number; hosts: string[] }[] = [
  {
    name: "Anúncios",
    min: 1,
    max: 5,
    hosts: [
      "doubleclick.net",
      "criteo.net",
      "taboola.com",
      "outbrain.com",
      "adsrvr.org",
      "amazon-adsystem.com",
    ],
  },
  {
    name: "Análise e métricas",
    min: 1,
    max: 4,
    hosts: ["google-analytics.com", "hotjar.com", "mixpanel.com", "segment.io", "clarity.ms"],
  },
  {
    name: "Redes sociais",
    min: 0,
    max: 3,
    hosts: ["facebook.net", "x.com", "linkedin.com", "tiktokv.com", "pinterest.com"],
  },
  {
    name: "Impressão digital",
    min: 0,
    max: 1,
    hosts: ["fingerprint.com", "deviceatlas.com", "adscore.com"],
  },
];

export function blockedFor(host: string): BlockedTracker[] {
  const random = seededRandom(hashString(host));
  const blocked: BlockedTracker[] = [];
  for (const category of categories) {
    const count = category.min + Math.floor(random() * (category.max - category.min + 1));
    const pool = [...category.hosts];
    for (let index = 0; index < count; index++) {
      const pick = Math.floor(random() * pool.length);
      const host = pool.splice(pick, 1)[0]!;
      blocked.push({ host, category: category.name });
    }
  }
  return blocked;
}

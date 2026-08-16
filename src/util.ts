// Normalización de URLs y títulos + similitud para clustering.

const TRACKING_PARAM = /^(utm_.*|fbclid|gclid|msclkid|mc_cid|mc_eid|cmpid|ito|smid|sh)$/i;

/** Forma canónica de una URL para dedup: sin www, sin tracking, sin hash, sin barra final. */
export function normalizeUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return raw.trim().toLowerCase();
  }
  const keep = new URLSearchParams();
  for (const [k, v] of u.searchParams) {
    if (!TRACKING_PARAM.test(k)) keep.append(k, v);
  }
  const qs = keep.toString();
  const host = u.host.replace(/^www\./, "");
  const path = u.pathname.replace(/\/+$/, "");
  return (host + path + (qs ? "?" + qs : "")).toLowerCase();
}

export function domainOf(raw: string): string {
  try {
    return new URL(raw).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"',
  "&#039;": "'", "&#39;": "'", "&apos;": "'", "&nbsp;": " ",
  "&ndash;": "–", "&mdash;": "—", "&hellip;": "…",
};

/** Limpia un título de feed: entidades HTML, espacios, sufijo "| Medio". */
export function cleanTitle(raw: string, sourceName?: string): string {
  let t = raw.replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m).replace(/\s+/g, " ").trim();
  if (sourceName) {
    const suffix = new RegExp(`\\s*[|\\-–—]\\s*${sourceName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
    t = t.replace(suffix, "");
  }
  return t;
}

// Stopwords en español, ya sin tildes (se comparan post-normalización)
const STOPWORDS = new Set([
  "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "al",
  "en", "y", "o", "u", "e", "que", "se", "su", "sus", "con", "por", "para",
  "es", "fue", "son", "sera", "esta", "este", "estos", "estas", "tras", "le",
  "lo", "como", "mas", "sobre", "entre", "hay", "ya", "no", "si", "a",
]);

/** Título normalizado para clustering: minúsculas, sin tildes, sin stopwords ni puntuación. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .join(" ");
}

/** Similitud Jaccard entre dos títulos ya normalizados. */
export function jaccard(a: string, b: string): number {
  const A = new Set(a.split(" ").filter(Boolean));
  const B = new Set(b.split(" ").filter(Boolean));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Umbral de clustering: dos títulos con Jaccard >= este valor son la misma noticia. */
export const CLUSTER_THRESHOLD = 0.5;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** "hace 5 min", "hace 3 h", "hace 2 días" */
export function timeAgo(unixSeconds: number, now = Math.floor(Date.now() / 1000)): string {
  const d = Math.max(0, now - unixSeconds);
  if (d < 60) return "recién";
  if (d < 3600) return `hace ${Math.floor(d / 60)} min`;
  if (d < 86400) return `hace ${Math.floor(d / 3600)} h`;
  const days = Math.floor(d / 86400);
  return days === 1 ? "hace 1 día" : `hace ${days} días`;
}

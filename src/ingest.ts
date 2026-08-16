// Ingesta: baja los feeds de `sources`, parsea RSS/Atom/news-sitemap,
// dedup por URL normalizada y clustering por similitud de títulos.

import { XMLParser } from "fast-xml-parser";
import { CLUSTER_THRESHOLD, cleanTitle, domainOf, jaccard, normalizeTitle, normalizeUrl } from "./util";

export interface FeedItem {
  title: string;
  url: string;
  publishedAt: number | null; // unix seconds
}

interface SourceRow {
  id: number;
  name: string;
  feed_url: string;
  format: string;
  url_exclude: string | null;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
});

function asArray<T>(x: T | T[] | undefined): T[] {
  if (x === undefined || x === null) return [];
  return Array.isArray(x) ? x : [x];
}

function text(x: unknown): string {
  if (typeof x === "string") return x;
  if (typeof x === "number") return String(x);
  if (x && typeof x === "object" && "#text" in (x as Record<string, unknown>)) {
    return String((x as Record<string, unknown>)["#text"]);
  }
  return "";
}

function parseDate(s: string): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
}

/** Parsea RSS 2.0, Atom o Google News sitemap y devuelve items crudos. */
export function parseFeed(xml: string): FeedItem[] {
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml);
  } catch {
    return [];
  }

  // RSS 2.0
  const channel = (doc.rss as Record<string, unknown> | undefined)?.channel as Record<string, unknown> | undefined;
  if (channel) {
    return asArray(channel.item as Record<string, unknown>[]).flatMap((item) => {
      const title = text(item.title);
      const url = text(item.link) || text((item["guid"] as Record<string, unknown>)?.["#text"] ?? item["guid"]);
      if (!title || !url.startsWith("http")) return [];
      return [{ title, url, publishedAt: parseDate(text(item.pubDate) || text(item["dc:date"])) }];
    });
  }

  // Atom
  const feed = doc.feed as Record<string, unknown> | undefined;
  if (feed) {
    return asArray(feed.entry as Record<string, unknown>[]).flatMap((entry) => {
      const title = text(entry.title);
      const links = asArray(entry.link as Record<string, unknown>[]);
      const alt = links.find((l) => l["@_rel"] === "alternate" || !l["@_rel"]) ?? links[0];
      const url = alt ? String(alt["@_href"] ?? "") : "";
      if (!title || !url.startsWith("http")) return [];
      return [{ title, url, publishedAt: parseDate(text(entry.published) || text(entry.updated)) }];
    });
  }

  // Google News sitemap (<urlset><url><news:news>…)
  const urlset = doc.urlset as Record<string, unknown> | undefined;
  if (urlset) {
    return asArray(urlset.url as Record<string, unknown>[]).flatMap((u) => {
      const loc = text(u.loc);
      const news = (u["news:news"] ?? u.news) as Record<string, unknown> | undefined;
      if (!news || !loc.startsWith("http")) return [];
      const title = text(news["news:title"] ?? news.title);
      const date = text(news["news:publication_date"] ?? news.publication_date);
      if (!title) return [];
      return [{ title, url: loc, publishedAt: parseDate(date) }];
    });
  }

  return [];
}

const MAX_ITEM_AGE_SECONDS = 72 * 3600; // no ingestar notas de más de 3 días
const FETCH_TIMEOUT_MS = 10_000;

export async function ingestAll(env: Env): Promise<{ inserted: number; clustered: number; errors: string[] }> {
  const now = Math.floor(Date.now() / 1000);
  const { results: sources } = await env.DB.prepare(
    "SELECT id, name, feed_url, format, url_exclude FROM sources WHERE enabled = 1"
  ).all<SourceRow>();

  // Títulos recientes (canónicos, vivos) para el clustering
  const { results: recent } = await env.DB.prepare(
    "SELECT id, title_normalized FROM stories WHERE created_at > ? AND dead = 0 AND canonical_id IS NULL"
  )
    .bind(now - 24 * 3600)
    .all<{ id: number; title_normalized: string }>();
  const recentTitles: { id: number; tn: string }[] = recent.map((r) => ({ id: r.id, tn: r.title_normalized }));

  let inserted = 0;
  let clustered = 0;
  const errors: string[] = [];

  const fetches = await Promise.allSettled(
    sources.map(async (src) => {
      const res = await fetch(src.feed_url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { "User-Agent": "hagov.news bot (+https://hagov.news)" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { src, xml: await res.text() };
    })
  );

  for (let i = 0; i < fetches.length; i++) {
    const f = fetches[i];
    const src = sources[i];
    if (f.status === "rejected") {
      const msg = f.reason instanceof Error ? f.reason.message : String(f.reason);
      errors.push(`${src.name}: ${msg}`);
      await env.DB.prepare("UPDATE sources SET last_error = ? WHERE id = ?").bind(msg, src.id).run();
      continue;
    }

    const items = parseFeed(f.value.xml);
    const exclude = src.url_exclude ? new RegExp(src.url_exclude) : null;
    for (const item of items) {
      if (exclude) {
        try {
          if (exclude.test(new URL(item.url).pathname)) continue;
        } catch {
          continue;
        }
      }
      const title = cleanTitle(item.title, src.name);
      if (title.length < 15) continue; // basura / títulos vacíos
      const urlNorm = normalizeUrl(item.url);
      const createdAt = Math.min(item.publishedAt ?? now, now);
      if (now - createdAt > MAX_ITEM_AGE_SECONDS) continue;

      const tn = normalizeTitle(title);

      // Clustering: buscar la nota canónica más parecida de las últimas 24 h
      let canonicalId: number | null = null;
      let best = 0;
      for (const r of recentTitles) {
        const s = jaccard(tn, r.tn);
        if (s > best) {
          best = s;
          if (s >= CLUSTER_THRESHOLD) canonicalId = r.id;
        }
      }

      const result = await env.DB.prepare(
        `INSERT OR IGNORE INTO stories (title, url, url_normalized, domain, source_id, created_at, canonical_id, title_normalized)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(title, item.url, urlNorm, domainOf(item.url), src.id, createdAt, canonicalId, tn)
        .run();

      if (result.meta.changes > 0) {
        inserted++;
        if (canonicalId !== null) {
          clustered++;
        } else {
          // Nueva canónica: entra al set para que duplicados de esta misma corrida clustericen
          recentTitles.push({ id: Number(result.meta.last_row_id), tn });
        }
      }
    }

    await env.DB.prepare("UPDATE sources SET last_fetched_at = ?, last_error = NULL WHERE id = ?")
      .bind(now, src.id)
      .run();
  }

  return { inserted, clustered, errors };
}

import { describe, expect, it } from "vitest";
import { CLUSTER_THRESHOLD, cleanTitle, jaccard, normalizeTitle, normalizeUrl, timeAgo } from "../src/util";

describe("normalizeUrl", () => {
  it("saca tracking, www, hash y barra final", () => {
    expect(
      normalizeUrl("https://www.infobae.com/politica/2026/08/15/nota-x/?utm_source=tw&utm_medium=social#comentarios")
    ).toBe("infobae.com/politica/2026/08/15/nota-x");
  });
  it("conserva query params reales", () => {
    expect(normalizeUrl("https://ejemplo.com/nota?id=42&fbclid=abc")).toBe("ejemplo.com/nota?id=42");
  });
  it("misma URL con y sin tracking dedup a lo mismo", () => {
    const a = normalizeUrl("https://www.clarin.com/politica/nota_0_x.html?gclid=123");
    const b = normalizeUrl("http://clarin.com/politica/nota_0_x.html/");
    expect(a).toBe(b);
  });
});

describe("cleanTitle", () => {
  it("decodifica entidades y colapsa espacios", () => {
    expect(cleanTitle("D&oacute;lar &amp; mercados:  qu&eacute; pasa".replace(/&oacute;/g, "&#243;").replace(/&eacute;/g, "e"))).toContain("&");
    expect(cleanTitle("A &amp; B  &quot;C&quot;")).toBe('A & B "C"');
  });
  it("saca el sufijo del medio", () => {
    expect(cleanTitle("Gran noticia del día | Infobae", "Infobae")).toBe("Gran noticia del día");
    expect(cleanTitle("Gran noticia del día - La Nación", "La Nación")).toBe("Gran noticia del día");
  });
});

describe("normalizeTitle", () => {
  it("saca tildes, stopwords y puntuación", () => {
    expect(normalizeTitle("El Gobierno anunció cambios en el Gabinete")).toBe("gobierno anuncio cambios gabinete");
  });
});

describe("jaccard clustering", () => {
  const a = normalizeTitle("El dólar blue superó los $1.500 por primera vez");
  const b = normalizeTitle("Dólar blue: superó los $1.500 por primera vez en la historia");
  const c = normalizeTitle("El Gobierno anunció cambios en el gabinete tras la derrota electoral");
  it("misma noticia en dos medios clusteriza", () => {
    expect(jaccard(a, b)).toBeGreaterThanOrEqual(CLUSTER_THRESHOLD);
  });
  it("noticias distintas no clusterizan", () => {
    expect(jaccard(a, c)).toBeLessThan(CLUSTER_THRESHOLD);
  });
  it("titulos vacíos no clusterizan", () => {
    expect(jaccard("", a)).toBe(0);
  });
});

describe("timeAgo", () => {
  it("formatea en castellano", () => {
    const now = 1_000_000;
    expect(timeAgo(now - 30, now)).toBe("recién");
    expect(timeAgo(now - 300, now)).toBe("hace 5 min");
    expect(timeAgo(now - 7200, now)).toBe("hace 2 h");
    expect(timeAgo(now - 86400 * 3, now)).toBe("hace 3 días");
  });
});

import { describe, expect, it } from "vitest";
import { parseFeed } from "../src/ingest";
// Fixtures reales descargados el 2026-08-15
import clarin from "./fixtures/clarin.xml?raw";
import pagina12 from "./fixtures/pagina12.xml?raw";
import elcanciller from "./fixtures/elcanciller.xml?raw";

describe("parseFeed", () => {
  it("parsea RSS de Clarín", () => {
    const items = parseFeed(clarin);
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) {
      expect(i.title.length).toBeGreaterThan(0);
      expect(i.url).toMatch(/^https?:\/\//);
    }
  });

  it("parsea news sitemap de Página/12 con fechas", () => {
    const items = parseFeed(pagina12);
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((i) => i.publishedAt !== null)).toBe(true);
    for (const i of items) expect(i.url).toContain("pagina12.com.ar");
  });

  it("parsea el feed de El Canciller", () => {
    const items = parseFeed(elcanciller);
    expect(items.length).toBeGreaterThan(0);
  });

  it("XML roto devuelve lista vacía sin tirar", () => {
    expect(parseFeed("esto no es xml <<<")).toEqual([]);
    expect(parseFeed("<html><body>bot wall</body></html>")).toEqual([]);
  });
});

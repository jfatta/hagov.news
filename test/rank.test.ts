import { describe, expect, it } from "vitest";
import { rankStories, score } from "../src/rank";

describe("ranking", () => {
  it("con igual puntaje, la más nueva gana", () => {
    expect(score(5, 1)).toBeGreaterThan(score(5, 10));
  });
  it("suficientes votos superan la edad", () => {
    expect(score(200, 6)).toBeGreaterThan(score(2, 1));
  });
  it("rankStories ordena por score sin mutar el original", () => {
    const now = 1_000_000;
    const stories = [
      { id: 1, points: 1, created_at: now - 40 * 3600 }, // vieja
      { id: 2, points: 1, created_at: now - 600 },       // nueva
      { id: 3, points: 50, created_at: now - 10 * 3600 }, // votada
    ];
    const ranked = rankStories(stories, now);
    expect(ranked.map((s) => s.id)).toEqual([3, 2, 1]);
    expect(stories[0].id).toBe(1);
  });
});

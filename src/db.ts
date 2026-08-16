// Queries D1. El ranking se calcula en JS (rank.ts) para no depender
// de las funciones matemáticas de SQLite.

import { FRONT_WINDOW_SECONDS, rankStories } from "./rank";

export interface StoryRow {
  id: number;
  title: string;
  url: string;
  domain: string;
  source_name: string | null;
  submitted_by_name: string | null;
  points: number;
  comment_count: number;
  created_at: number;
  dead: number;
  canonical_id: number | null;
}

export interface CommentRow {
  id: number;
  story_id: number;
  parent_id: number | null;
  username: string;
  user_id: number;
  body: string;
  points: number;
  created_at: number;
  dead: number;
  flags: number;
}

const STORY_SELECT = `
  SELECT s.id, s.title, s.url, s.domain, s.points, s.comment_count, s.created_at, s.dead, s.canonical_id,
         src.name AS source_name, u.username AS submitted_by_name
  FROM stories s
  LEFT JOIN sources src ON src.id = s.source_id
  LEFT JOIN users u ON u.id = s.submitted_by`;

export async function frontPage(env: Env, page: number, perPage = 30): Promise<StoryRow[]> {
  const now = Math.floor(Date.now() / 1000);
  const { results } = await env.DB.prepare(
    `${STORY_SELECT}
     WHERE s.dead = 0 AND s.canonical_id IS NULL AND s.created_at > ?
     ORDER BY s.created_at DESC LIMIT 600`
  )
    .bind(now - FRONT_WINDOW_SECONDS)
    .all<StoryRow>();
  return rankStories(results, now).slice((page - 1) * perPage, page * perPage);
}

export async function newestPage(env: Env, page: number, perPage = 30): Promise<StoryRow[]> {
  const { results } = await env.DB.prepare(
    `${STORY_SELECT}
     WHERE s.dead = 0 AND s.canonical_id IS NULL
     ORDER BY s.created_at DESC LIMIT ? OFFSET ?`
  )
    .bind(perPage, (page - 1) * perPage)
    .all<StoryRow>();
  return results;
}

export async function getStory(env: Env, id: number): Promise<StoryRow | null> {
  return await env.DB.prepare(`${STORY_SELECT} WHERE s.id = ?`).bind(id).first<StoryRow>();
}

/** Otras notas del mismo cluster ("cobertura en otros medios"). */
export async function getCoverage(env: Env, canonicalId: number): Promise<StoryRow[]> {
  const { results } = await env.DB.prepare(
    `${STORY_SELECT} WHERE s.canonical_id = ? AND s.dead = 0 ORDER BY s.created_at ASC`
  )
    .bind(canonicalId)
    .all<StoryRow>();
  return results;
}

export async function getComments(env: Env, storyId: number): Promise<CommentRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.story_id, c.parent_id, c.user_id, c.body, c.points, c.created_at, c.dead, c.flags,
            u.username
     FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.story_id = ?
     ORDER BY c.points DESC, c.created_at ASC`
  )
    .bind(storyId)
    .all<CommentRow>();
  return results;
}

export async function votedStoryIds(env: Env, userId: number, storyIds: number[]): Promise<Set<number>> {
  if (storyIds.length === 0) return new Set();
  const placeholders = storyIds.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT story_id FROM votes WHERE user_id = ? AND story_id IN (${placeholders})`
  )
    .bind(userId, ...storyIds)
    .all<{ story_id: number }>();
  return new Set(results.map((r) => r.story_id));
}

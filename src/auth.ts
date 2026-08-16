// Registro/login estilo HN: usuario + contraseña, nada más.
// PBKDF2-SHA256 vía WebCrypto (bcrypt no corre en Workers).

import { timingSafeEqual } from "node:crypto";

// Workers limita PBKDF2 a 100.000 iteraciones; con salt por usuario es adecuado.
const PBKDF2_ITERATIONS = 100_000;
const SESSION_TTL_SECONDS = 30 * 86400;

function toHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function pbkdf2(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS },
    key,
    256
  );
  return toHex(bits);
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { hash: await pbkdf2(password, salt), salt: toHex(salt) };
}

export async function verifyPassword(password: string, saltHex: string, expectedHash: string): Promise<boolean> {
  const actual = await pbkdf2(password, fromHex(saltHex));
  const a = new TextEncoder().encode(actual);
  const b = new TextEncoder().encode(expectedHash);
  if (a.byteLength !== b.byteLength) return false;
  return timingSafeEqual(a, b);
}

export async function sha256Hex(s: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}

export interface SessionUser {
  id: number;
  username: string;
  karma: number;
  is_admin: number;
  banned: number;
}

export async function createSession(env: Env, userId: number): Promise<string> {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const expires = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256Hex(token), userId, expires)
    .run();
  return `session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearSessionCookie(): string {
  return "session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0";
}

function sessionToken(request: Request): string | null {
  const cookie = request.headers.get("Cookie") ?? "";
  const m = cookie.match(/(?:^|;\s*)session=([0-9a-f]{64})/);
  return m ? m[1] : null;
}

export async function currentUser(env: Env, request: Request): Promise<SessionUser | null> {
  const token = sessionToken(request);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.username, u.karma, u.is_admin, u.banned
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`
  )
    .bind(await sha256Hex(token), Math.floor(Date.now() / 1000))
    .first<SessionUser>();
  return row ?? null;
}

export async function destroySession(env: Env, request: Request): Promise<void> {
  const token = sessionToken(request);
  if (!token) return;
  await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
}

/** Verifica el token de Turnstile. Si no hay secret configurado (dev local), pasa siempre. */
export async function verifyTurnstile(env: Env, token: string | null, ip: string | null): Promise<boolean> {
  const secret = (env as { TURNSTILE_SECRET?: string }).TURNSTILE_SECRET;
  if (!secret) return true;
  if (!token) return false;
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body,
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { success: boolean };
  return data.success;
}

// hagov.news — Worker principal: rutas HTTP + cron de ingesta.

import {
  clearSessionCookie,
  createSession,
  currentUser,
  destroySession,
  hashPassword,
  verifyPassword,
  verifyTurnstile,
  type SessionUser,
} from "./auth";
import { frontPage, getComments, getCoverage, getStory, newestPage, votedStoryIds, type CommentRow } from "./db";
import { ingestAll } from "./ingest";
import { cleanupRateLimits, rateLimit } from "./ratelimit";
import { page, redirect } from "./render/layout";
import {
  aboutPage,
  itemPage,
  loginPage,
  replyPage,
  settingsPage,
  storyList,
  submitPage,
  userPage,
  welcomePage,
} from "./render/pages";
import { cleanTitle, domainOf, escapeHtml, normalizeTitle, normalizeUrl } from "./util";

const COMMENTS_PER_HOUR = 20;
const REGISTRATIONS_PER_IP_PER_DAY = 5;
const LOGIN_ATTEMPTS_PER_IP = 15; // por ventana de 10 min — tolera typos, frena fuerza bruta
const LOGIN_WINDOW_SECONDS = 600;
const VOTES_PER_HOUR = 90;
const SUBMITS_PER_HOUR = 10;

function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function bad(msg: string, user: SessionUser | null, status = 400): Response {
  const res = page("error · hagov.news", `<p class="err">${escapeHtml(msg)}</p><p><a href="/">← volver</a></p>`, user);
  return new Response(res.body, { status, headers: res.headers });
}

async function form(request: Request): Promise<Record<string, string>> {
  const data = await request.formData();
  const out: Record<string, string> = {};
  for (const [k, v] of data) if (typeof v === "string") out[k] = v;
  return out;
}

const TURNSTILE_HEAD = `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await route(request, env, ctx);
    } catch (err) {
      console.error(JSON.stringify({ msg: "unhandled", error: String(err), url: request.url }));
      return new Response("error interno", { status: 500 });
    }
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const result = await ingestAll(env);
    console.log(JSON.stringify({ msg: "ingest", ...result }));
    await cleanupRateLimits(env);
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // Portada cacheada 60 s para visitantes anónimos
  const anonymous = !(request.headers.get("Cookie") ?? "").includes("session=");
  const cacheable = method === "GET" && anonymous && (path === "/" || path === "/nuevas" || path.startsWith("/item/"));
  const cache = caches.default;
  if (cacheable) {
    const hit = await cache.match(request.url);
    if (hit) return hit;
  }

  const user = anonymous ? null : await currentUser(env, request);
  if (user?.banned) return bad("cuenta suspendida", null, 403);

  let res: Response | null = null;

  if (method === "GET") {
    if (path === "/") res = await handleFront(env, url, user, "/");
    else if (path === "/nuevas") res = await handleFront(env, url, user, "/nuevas");
    else if (path.startsWith("/item/")) res = await handleItem(env, path, user);
    else if (path.startsWith("/responder/")) res = await handleReplyForm(env, path, user);
    else if (path.startsWith("/user/")) res = await handleUser(env, path, user);
    else if (path === "/login") {
      res = page("entrar · hagov.news", loginPage(undefined, env.TURNSTILE_SITE_KEY || undefined), user,
        env.TURNSTILE_SITE_KEY ? TURNSTILE_HEAD : "");
    } else if (path === "/enviar") {
      res = user ? page("enviar · hagov.news", submitPage(), user) : redirect("/login");
    } else if (path === "/logout") {
      await destroySession(env, request);
      res = redirect("/", clearSessionCookie());
    } else if (path === "/ajustes") {
      res = user ? page("ajustes · hagov.news", settingsPage(), user) : redirect("/login");
    } else if (path === "/bienvenida") {
      res = user ? page("bienvenida · hagov.news", welcomePage(user.username), user) : redirect("/login");
    } else if (path === "/acerca") {
      res = page("acerca · hagov.news", aboutPage(), user);
    } else if (path === "/admin" && user?.is_admin) {
      res = await handleAdmin(env, user);
    }
  } else if (method === "POST") {
    if (path === "/registro") res = await handleRegister(request, env);
    else if (path === "/login") res = await handleLogin(request, env);
    else if (path === "/votar") res = await handleVote(request, env, url, user);
    else if (path === "/comentar") res = await handleComment(request, env, user);
    else if (path === "/enviar") res = await handleSubmit(request, env, user);
    else if (path === "/denunciar") res = await handleFlag(request, env, user);
    else if (path === "/ajustes") res = await handleChangePassword(request, env, user);
    else if (path === "/admin/kill" && user?.is_admin) res = await handleKill(request, env);
    else if (path === "/admin/ban" && user?.is_admin) res = await handleBan(request, env);
    else if (path === "/admin/source" && user?.is_admin) res = await handleToggleSource(request, env);
  }

  if (!res) res = bad("página no encontrada", user, 404);

  if (cacheable && res.status === 200) {
    const cached = new Response(res.clone().body, res);
    cached.headers.set("Cache-Control", "public, max-age=60");
    // Sin esto, el navegador de un usuario podría reutilizar su copia local
    // "no logueado" de "/" incluso después de loguearse (misma URL, cookie distinta).
    cached.headers.set("Vary", "Cookie");
    ctx.waitUntil(cache.put(request.url, cached));
  }
  return res;
}

async function handleFront(env: Env, url: URL, user: SessionUser | null, pagePath: string): Promise<Response> {
  const p = Math.max(1, Math.min(10, parseInt(url.searchParams.get("p") ?? "1", 10) || 1));
  const stories = pagePath === "/" ? await frontPage(env, p) : await newestPage(env, p);
  const voted = user ? await votedStoryIds(env, user.id, stories.map((s) => s.id)) : new Set<number>();
  const title = pagePath === "/" ? "hagov.news" : "nuevas · hagov.news";
  return page(title, storyList(stories, user, voted, pagePath, p, (p - 1) * 30 + 1), user);
}

async function handleItem(env: Env, path: string, user: SessionUser | null): Promise<Response> {
  const id = parseInt(path.slice("/item/".length), 10);
  if (!id) return bad("nota inexistente", user, 404);
  const story = await getStory(env, id);
  if (!story || story.dead) return bad("nota inexistente", user, 404);
  if (story.canonical_id) return redirect(`/item/${story.canonical_id}`);
  const [coverage, comments] = await Promise.all([getCoverage(env, id), getComments(env, id)]);
  const voted = user ? await votedStoryIds(env, user.id, [id]) : new Set<number>();
  const votedComments = user ? await votedCommentIds(env, user.id, comments.map((c) => c.id)) : new Set<number>();
  return page(`${story.title} · hagov.news`, itemPage(story, coverage, comments, user, voted, votedComments), user);
}

async function votedCommentIds(env: Env, userId: number, ids: number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const { results } = await env.DB.prepare(
    `SELECT comment_id FROM comment_votes WHERE user_id = ? AND comment_id IN (${ids.map(() => "?").join(",")})`
  )
    .bind(userId, ...ids)
    .all<{ comment_id: number }>();
  return new Set(results.map((r) => r.comment_id));
}

async function handleReplyForm(env: Env, path: string, user: SessionUser | null): Promise<Response> {
  if (!user) return redirect("/login");
  const id = parseInt(path.slice("/responder/".length), 10);
  const comment = await env.DB.prepare(
    `SELECT c.*, u.username FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ? AND c.dead = 0`
  )
    .bind(id)
    .first<CommentRow>();
  if (!comment) return bad("comentario inexistente", user, 404);
  const story = await getStory(env, comment.story_id);
  if (!story) return bad("nota inexistente", user, 404);
  return page("responder · hagov.news", replyPage(story, comment), user);
}

async function handleUser(env: Env, path: string, viewer: SessionUser | null): Promise<Response> {
  const username = decodeURIComponent(path.slice("/user/".length));
  const u = await env.DB.prepare("SELECT username, karma, created_at, id FROM users WHERE username = ?")
    .bind(username)
    .first<{ username: string; karma: number; created_at: number; id: number }>();
  if (!u) return bad("usuario inexistente", viewer, 404);
  const { results: recent } = await env.DB.prepare(
    `SELECT c.*, u.username, s.title AS story_title FROM comments c
     JOIN users u ON u.id = c.user_id JOIN stories s ON s.id = c.story_id
     WHERE c.user_id = ? ORDER BY c.created_at DESC LIMIT 30`
  )
    .bind(u.id)
    .all<CommentRow & { story_title: string }>();
  return page(`${u.username} · hagov.news`, userPage(u, recent), viewer);
}

async function handleRegister(request: Request, env: Env): Promise<Response> {
  const f = await form(request);
  const username = (f.username ?? "").trim();
  const password = f.password ?? "";
  const ip = request.headers.get("CF-Connecting-IP");

  const fail = (msg: string) =>
    page("entrar · hagov.news", loginPage(msg, env.TURNSTILE_SITE_KEY || undefined), null,
      env.TURNSTILE_SITE_KEY ? TURNSTILE_HEAD : "");

  if (!/^[a-zA-Z0-9_]{2,20}$/.test(username)) return fail("usuario inválido: 2-20 caracteres, letras/números/_");
  if (password.length < 8) return fail("la contraseña necesita al menos 8 caracteres");
  if (password.length > 200) return fail("la contraseña es demasiado larga");
  if (!(await verifyTurnstile(env, f["cf-turnstile-response"] ?? null, ip))) return fail("verificación anti-bot fallida");

  if (ip) {
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE reg_ip = ? AND created_at > ?")
      .bind(ip, now() - 86400)
      .first<{ n: number }>();
    if ((count?.n ?? 0) >= REGISTRATIONS_PER_IP_PER_DAY) return fail("demasiados registros desde esta IP, probá mañana");
  }

  const { hash, salt } = await hashPassword(password);
  try {
    const result = await env.DB.prepare(
      "INSERT INTO users (username, password_hash, salt, created_at, reg_ip) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(username, hash, salt, now(), ip)
      .run();
    const cookie = await createSession(env, Number(result.meta.last_row_id));
    return redirect("/bienvenida", cookie);
  } catch {
    return fail("ese usuario ya existe");
  }
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const fail = (msg = "usuario o contraseña incorrectos") =>
    page("entrar · hagov.news", loginPage(msg), null);

  const ip = clientIp(request);
  const okRate = await rateLimit(env, `login:${ip}`, LOGIN_ATTEMPTS_PER_IP, LOGIN_WINDOW_SECONDS);
  if (!okRate) return fail("demasiados intentos, esperá unos minutos");

  const f = await form(request);
  const password = f.password ?? "";
  if (password.length > 200) return fail();

  const u = await env.DB.prepare("SELECT id, password_hash, salt, banned FROM users WHERE username = ?")
    .bind((f.username ?? "").trim())
    .first<{ id: number; password_hash: string; salt: string; banned: number }>();
  if (!u || u.banned) return fail();
  if (!(await verifyPassword(password, u.salt, u.password_hash))) return fail();
  return redirect("/", await createSession(env, u.id));
}

async function handleChangePassword(request: Request, env: Env, user: SessionUser | null): Promise<Response> {
  if (!user) return redirect("/login");
  const fail = (msg: string) => page("ajustes · hagov.news", settingsPage(msg, true), user);

  const okRate = await rateLimit(env, `pwchange:${user.id}`, 10, 3600);
  if (!okRate) return fail("demasiados intentos, esperá un rato");

  const f = await form(request);
  const currentPassword = f.current_password ?? "";
  const newPassword = f.new_password ?? "";
  if (newPassword.length < 8) return fail("la contraseña nueva necesita al menos 8 caracteres");
  if (newPassword.length > 200) return fail("la contraseña nueva es demasiado larga");

  const row = await env.DB.prepare("SELECT password_hash, salt FROM users WHERE id = ?")
    .bind(user.id)
    .first<{ password_hash: string; salt: string }>();
  if (!row || !(await verifyPassword(currentPassword, row.salt, row.password_hash))) {
    return fail("la contraseña actual no es correcta");
  }

  const { hash, salt } = await hashPassword(newPassword);
  await env.DB.prepare("UPDATE users SET password_hash = ?, salt = ? WHERE id = ?").bind(hash, salt, user.id).run();
  return page("ajustes · hagov.news", settingsPage("contraseña actualizada"), user);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function handleVote(request: Request, env: Env, url: URL, user: SessionUser | null): Promise<Response> {
  const isAjax = request.headers.get("X-Requested-With") === "fetch";
  const fail = (msg: string, status = 400) => (isAjax ? jsonResponse({ ok: false, error: msg }, status) : bad(msg, user, status));

  if (!user) return isAjax ? jsonResponse({ ok: false, error: "no logueado" }, 401) : redirect("/login");
  const type = url.searchParams.get("type");
  const id = parseInt(url.searchParams.get("id") ?? "", 10);
  const goto = url.searchParams.get("goto") ?? "/";
  if (!id || (type !== "story" && type !== "comment")) return fail("voto inválido");

  const okRate = await rateLimit(env, `vote:${user.id}`, VOTES_PER_HOUR, 3600);
  if (!okRate) return fail("demasiados votos por hora, esperá un rato", 429);

  let voted: boolean;

  if (type === "story") {
    const story = await env.DB.prepare("SELECT id FROM stories WHERE id = ?").bind(id).first<{ id: number }>();
    if (!story) return fail("nota inexistente", 404);

    const existing = await env.DB.prepare("SELECT 1 FROM votes WHERE user_id = ? AND story_id = ?")
      .bind(user.id, id)
      .first();
    voted = !existing;
    const delta = voted ? 1 : -1;
    await env.DB.batch([
      existing
        ? env.DB.prepare("DELETE FROM votes WHERE user_id = ? AND story_id = ?").bind(user.id, id)
        : env.DB.prepare("INSERT INTO votes (user_id, story_id) VALUES (?, ?)").bind(user.id, id),
      env.DB.prepare("UPDATE stories SET points = points + ? WHERE id = ?").bind(delta, id),
      env.DB.prepare(
        "UPDATE users SET karma = karma + ? WHERE id = (SELECT submitted_by FROM stories WHERE id = ? AND submitted_by IS NOT NULL)"
      ).bind(delta, id),
    ]);
  } else {
    const owner = await env.DB.prepare("SELECT user_id FROM comments WHERE id = ?")
      .bind(id)
      .first<{ user_id: number }>();
    if (!owner) return fail("comentario inexistente", 404);
    if (owner.user_id === user.id) return fail("no podés votar tu propio comentario");

    const existing = await env.DB.prepare("SELECT 1 FROM comment_votes WHERE user_id = ? AND comment_id = ?")
      .bind(user.id, id)
      .first();
    voted = !existing;
    const delta = voted ? 1 : -1;
    await env.DB.batch([
      existing
        ? env.DB.prepare("DELETE FROM comment_votes WHERE user_id = ? AND comment_id = ?").bind(user.id, id)
        : env.DB.prepare("INSERT INTO comment_votes (user_id, comment_id) VALUES (?, ?)").bind(user.id, id),
      env.DB.prepare("UPDATE comments SET points = points + ? WHERE id = ?").bind(delta, id),
      env.DB.prepare("UPDATE users SET karma = karma + ? WHERE id = (SELECT user_id FROM comments WHERE id = ?)").bind(
        delta,
        id
      ),
    ]);
  }

  if (isAjax) {
    const table = type === "story" ? "stories" : "comments";
    const row = await env.DB.prepare(`SELECT points FROM ${table} WHERE id = ?`).bind(id).first<{ points: number }>();
    return jsonResponse({ ok: true, points: row?.points ?? 0, voted });
  }
  return redirect(goto.startsWith("/") ? goto : "/");
}

async function handleComment(request: Request, env: Env, user: SessionUser | null): Promise<Response> {
  if (!user) return redirect("/login");
  const f = await form(request);
  const storyId = parseInt(f.story_id ?? "", 10);
  const parentId = f.parent_id ? parseInt(f.parent_id, 10) : null;
  const body = (f.body ?? "").trim();
  if (!storyId || body.length === 0 || body.length > 4000) return bad("comentario inválido", user);

  const story = await getStory(env, storyId);
  if (!story || story.dead) return bad("nota inexistente", user, 404);

  const okRate = await rateLimit(env, `comment:${user.id}`, COMMENTS_PER_HOUR, 3600);
  if (!okRate) return bad("demasiados comentarios por hora, bajá un cambio", user, 429);

  await env.DB.batch([
    env.DB.prepare("INSERT INTO comments (story_id, parent_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)").bind(
      storyId, parentId, user.id, body, now()
    ),
    env.DB.prepare("UPDATE stories SET comment_count = comment_count + 1 WHERE id = ?").bind(storyId),
  ]);
  return redirect(`/item/${storyId}`);
}

async function handleSubmit(request: Request, env: Env, user: SessionUser | null): Promise<Response> {
  if (!user) return redirect("/login");
  const f = await form(request);
  const title = cleanTitle(f.title ?? "");
  const rawUrl = (f.url ?? "").trim();
  const fail = (msg: string) => page("enviar · hagov.news", submitPage(msg), user);
  if (title.length < 10) return fail("el título es muy corto");
  if (title.length > 200) return fail("el título es demasiado largo");
  if (!/^https?:\/\//.test(rawUrl)) return fail("la url debe empezar con http(s)://");
  if (rawUrl.length > 2000) return fail("la url es demasiado larga");

  const okRate = await rateLimit(env, `submit:${user.id}`, SUBMITS_PER_HOUR, 3600);
  if (!okRate) return fail("demasiados envíos por hora, esperá un rato");

  const urlNorm = normalizeUrl(rawUrl);
  const existing = await env.DB.prepare("SELECT id, canonical_id FROM stories WHERE url_normalized = ?")
    .bind(urlNorm)
    .first<{ id: number; canonical_id: number | null }>();
  if (existing) return redirect(`/item/${existing.canonical_id ?? existing.id}`);

  const result = await env.DB.prepare(
    `INSERT INTO stories (title, url, url_normalized, domain, submitted_by, created_at, title_normalized)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(title, rawUrl, urlNorm, domainOf(rawUrl), user.id, now(), normalizeTitle(title))
    .run();
  const id = Number(result.meta.last_row_id);
  await env.DB.prepare("INSERT OR IGNORE INTO votes (user_id, story_id) VALUES (?, ?)").bind(user.id, id).run();
  return redirect(`/item/${id}`);
}

async function handleFlag(request: Request, env: Env, user: SessionUser | null): Promise<Response> {
  if (!user) return redirect("/login");
  const f = await form(request);
  const id = parseInt(f.comment_id ?? "", 10);
  if (id) await env.DB.prepare("UPDATE comments SET flags = flags + 1 WHERE id = ?").bind(id).run();
  return redirect((f.goto ?? "/").startsWith("/") ? f.goto ?? "/" : "/");
}

async function handleAdmin(env: Env, user: SessionUser): Promise<Response> {
  const { results: sources } = await env.DB.prepare(
    "SELECT id, name, feed_url, enabled, last_fetched_at, last_error FROM sources ORDER BY name"
  ).all<{ id: number; name: string; feed_url: string; enabled: number; last_fetched_at: number | null; last_error: string | null }>();
  const { results: flagged } = await env.DB.prepare(
    `SELECT c.id, c.body, c.flags, c.story_id, u.username FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.flags > 0 AND c.dead = 0 ORDER BY c.flags DESC LIMIT 50`
  ).all<{ id: number; body: string; flags: number; story_id: number; username: string }>();

  const srcRows = sources
    .map(
      (s) => `<tr><td>${escapeHtml(s.name)}</td>
<td>${s.enabled ? "✓" : "✗"}</td>
<td>${s.last_fetched_at ? new Date(s.last_fetched_at * 1000).toISOString().slice(0, 16) : "-"}</td>
<td>${escapeHtml(s.last_error ?? "")}</td>
<td><form method="post" action="/admin/source"><input type="hidden" name="id" value="${s.id}"><button class="inline">${s.enabled ? "apagar" : "prender"}</button></form></td></tr>`
    )
    .join("");
  const flagRows = flagged
    .map(
      (c) => `<tr><td>${c.flags}</td><td><a href="/user/${escapeHtml(c.username)}">${escapeHtml(c.username)}</a></td>
<td><a href="/item/${c.story_id}">${escapeHtml(c.body.slice(0, 120))}</a></td>
<td><form method="post" action="/admin/kill" style="display:inline"><input type="hidden" name="type" value="comment"><input type="hidden" name="id" value="${c.id}"><input type="hidden" name="goto" value="/admin"><button class="inline">matar</button></form></td></tr>`
    )
    .join("");

  return page(
    "admin · hagov.news",
    `<h1>fuentes</h1><table class="admin"><tr><th>fuente</th><th>on</th><th>último fetch (UTC)</th><th>error</th><th></th></tr>${srcRows}</table>
<h1 style="margin-top:1.2rem">comentarios denunciados</h1><table class="admin"><tr><th>flags</th><th>usuario</th><th>comentario</th><th></th></tr>${flagRows || "<tr><td colspan=4>ninguno</td></tr>"}</table>`,
    user
  );
}

async function handleKill(request: Request, env: Env): Promise<Response> {
  const f = await form(request);
  const id = parseInt(f.id ?? "", 10);
  if (id && f.type === "comment") {
    await env.DB.prepare("UPDATE comments SET dead = 1 WHERE id = ?").bind(id).run();
  } else if (id && f.type === "story") {
    await env.DB.prepare("UPDATE stories SET dead = 1 WHERE id = ?").bind(id).run();
  }
  return redirect((f.goto ?? "/admin").startsWith("/") ? f.goto ?? "/admin" : "/admin");
}

async function handleBan(request: Request, env: Env): Promise<Response> {
  const f = await form(request);
  const id = parseInt(f.user_id ?? "", 10);
  if (id) {
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET banned = 1 WHERE id = ?").bind(id),
      env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id),
    ]);
  }
  return redirect("/admin");
}

async function handleToggleSource(request: Request, env: Env): Promise<Response> {
  const f = await form(request);
  const id = parseInt(f.id ?? "", 10);
  if (id) await env.DB.prepare("UPDATE sources SET enabled = 1 - enabled WHERE id = ?").bind(id).run();
  return redirect("/admin");
}

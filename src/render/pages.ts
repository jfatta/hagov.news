// Fragmentos HTML de cada página. Todo server-rendered, sin JS obligatorio.

import type { CommentRow, StoryRow } from "../db";
import type { SessionUser } from "../auth";
import { escapeHtml, timeAgo } from "../util";

function voteLink(story: StoryRow, user: SessionUser | null, voted: Set<number>, goto: string): string {
  if (!user) return `<a href="/login" class="vote" title="entrá para votar">▲</a>`;
  const isVoted = voted.has(story.id);
  const target = `/votar?type=story&id=${story.id}&goto=${encodeURIComponent(goto)}`;
  const cls = isVoted ? "inline vote voted" : "inline vote";
  const title = isVoted ? "sacar voto" : "votar";
  return `<form method="post" class="votef" data-points="pts-s-${story.id}" action="${target}" style="display:inline"><button class="${cls}" title="${title}">▲</button></form>`;
}

function storyLine(s: StoryRow, user: SessionUser | null, voted: Set<number>, goto: string): string {
  const src = s.source_name
    ? escapeHtml(s.source_name)
    : s.submitted_by_name
      ? `<a href="/user/${escapeHtml(s.submitted_by_name)}" class="human">${escapeHtml(s.submitted_by_name)}</a>`
      : "?";
  const comments = s.comment_count === 1 ? "1 comentario" : `${s.comment_count} comentarios`;
  const admin = user?.is_admin
    ? ` · <form method="post" action="/admin/kill" style="display:inline"><input type="hidden" name="type" value="story"><input type="hidden" name="id" value="${s.id}"><input type="hidden" name="goto" value="${escapeHtml(goto)}"><button class="inline">[matar]</button></form>`
    : "";
  return `<li>
  ${voteLink(s, user, voted, goto)}
  <span class="t"><a href="${escapeHtml(s.url)}" rel="noopener">${escapeHtml(s.title)}</a>
  <span class="dom">(${escapeHtml(s.domain)})</span></span>
</li>
<div class="meta"><span id="pts-s-${s.id}">${s.points} pts</span> · ${src} · ${timeAgo(s.created_at)} · <a href="/item/${s.id}">${comments}</a>${admin}</div>`;
}

export function storyList(
  stories: StoryRow[],
  user: SessionUser | null,
  voted: Set<number>,
  pagePath: string,
  pageNum: number,
  startIndex: number
): string {
  const items = stories.map((s) => storyLine(s, user, voted, pagePath)).join("\n");
  const more =
    stories.length >= 30
      ? `<a class="more" href="${pagePath}?p=${pageNum + 1}">más »</a>`
      : "";
  return `<ol class="stories" start="${startIndex}" style="counter-reset:n ${startIndex - 1}">${items}</ol>${more}`;
}

function commentForm(storyId: number, parentId: number | null, label: string): string {
  return `<form method="post" action="/comentar" class="box">
  <input type="hidden" name="story_id" value="${storyId}">
  ${parentId ? `<input type="hidden" name="parent_id" value="${parentId}">` : ""}
  <textarea name="body" rows="4" required maxlength="4000" style="max-width:100%"></textarea><br>
  <button>${label}</button>
</form>`;
}

function renderCommentTree(
  comments: CommentRow[],
  parentId: number | null,
  story: StoryRow,
  user: SessionUser | null,
  votedComments: Set<number>
): string {
  const children = comments.filter((c) => c.parent_id === parentId);
  if (children.length === 0) return "";
  return children
    .map((c) => {
      const deadClass = c.dead ? " dead" : "";
      const body = c.dead ? "[eliminado]" : escapeHtml(c.body);
      const commentVoted = votedComments.has(c.id);
      const vote =
        user && !c.dead && user.id !== c.user_id
          ? `<form method="post" class="votef" data-points="pts-c-${c.id}" action="/votar?type=comment&id=${c.id}&goto=${encodeURIComponent(`/item/${story.id}`)}" style="display:inline"><button class="inline vote${commentVoted ? " voted" : ""}" title="${commentVoted ? "sacar voto" : "votar"}">▲</button></form> `
          : "";
      const admin =
        user?.is_admin && !c.dead
          ? ` · <form method="post" action="/admin/kill" style="display:inline"><input type="hidden" name="type" value="comment"><input type="hidden" name="id" value="${c.id}"><input type="hidden" name="goto" value="/item/${story.id}"><button class="inline">[matar]</button></form>`
          : "";
      const flag =
        user && !c.dead
          ? ` · <form method="post" action="/denunciar" style="display:inline"><input type="hidden" name="comment_id" value="${c.id}"><input type="hidden" name="goto" value="/item/${story.id}"><button class="inline">denunciar</button></form>`
          : "";
      const reply = user && !c.dead ? ` · <a href="/responder/${c.id}">responder</a>` : "";
      return `<div class="comment${deadClass}">
  <div class="chead">${vote}<a href="/user/${escapeHtml(c.username)}">${escapeHtml(c.username)}</a> · <span id="pts-c-${c.id}">${c.points} pts</span> · ${timeAgo(c.created_at)}${reply}${flag}${admin}</div>
  <div class="cbody">${body}</div>
  ${renderCommentTree(comments, c.id, story, user, votedComments)}
</div>`;
    })
    .join("\n");
}

export function itemPage(
  story: StoryRow,
  coverage: StoryRow[],
  comments: CommentRow[],
  user: SessionUser | null,
  voted: Set<number>,
  votedComments: Set<number>
): string {
  const coverageHtml =
    coverage.length > 0
      ? `<div class="coverage">cobertura: ${coverage
          .map((c) => `<a href="${escapeHtml(c.url)}" rel="noopener">${escapeHtml(c.source_name ?? c.domain)}</a>`)
          .join(" · ")}</div>`
      : "";
  const form = user
    ? commentForm(story.id, null, "comentar")
    : `<p class="meta" style="padding-left:0"><a href="/login">entrá</a> para comentar.</p>`;
  return `<ol class="stories">${storyLine(story, user, voted, `/item/${story.id}`)}</ol>
${coverageHtml}
${form}
${renderCommentTree(comments, null, story, user, votedComments)}`;
}

export function replyPage(story: StoryRow, comment: CommentRow): string {
  return `<h1>respondiendo a ${escapeHtml(comment.username)}</h1>
<div class="comment"><div class="cbody">${escapeHtml(comment.body)}</div></div>
${commentForm(story.id, comment.id, "responder")}`;
}

export function loginPage(error?: string, turnstileSiteKey?: string): string {
  const err = error ? `<p class="err">${escapeHtml(error)}</p>` : "";
  const turnstile = turnstileSiteKey
    ? `<div class="cf-turnstile" data-sitekey="${escapeHtml(turnstileSiteKey)}" data-action="turnstile-spin-v1" style="margin-top:.8rem"></div>`
    : "";
  return `${err}
<div class="box">
<h1>entrar</h1>
<form method="post" action="/login">
  <label>usuario <input type="text" name="username" required maxlength="20" autocomplete="username"></label>
  <label>contraseña <input type="password" name="password" required autocomplete="current-password"></label>
  <button>entrar</button>
</form>
</div>
<div class="box">
<h1>crear cuenta</h1>
<p class="meta" style="padding-left:0">solo usuario y contraseña. sin email, sin verificación, sin spam.</p>
<form method="post" action="/registro">
  <label>usuario <input type="text" name="username" required minlength="2" maxlength="20" pattern="[a-zA-Z0-9_]+" autocomplete="username"></label>
  <label>contraseña (mín. 8) <input type="password" name="password" required minlength="8" autocomplete="new-password"></label>
  ${turnstile}
  <button>crear cuenta</button>
</form>
</div>`;
}

export function submitPage(error?: string): string {
  const err = error ? `<p class="err">${escapeHtml(error)}</p>` : "";
  return `${err}<div class="box">
<h1>enviar</h1>
<form method="post" action="/enviar">
  <label>título <input type="text" name="title" required minlength="10" maxlength="200"></label>
  <label>url <input type="url" name="url" required maxlength="500"></label>
  <button>enviar</button>
</form>
</div>`;
}

export function userPage(
  u: { username: string; karma: number; created_at: number },
  recentComments: (CommentRow & { story_title: string })[]
): string {
  const comments = recentComments
    .map(
      (c) => `<div class="comment"><div class="chead">${timeAgo(c.created_at)} en <a href="/item/${c.story_id}">${escapeHtml(c.story_title)}</a></div>
<div class="cbody">${c.dead ? "[eliminado]" : escapeHtml(c.body)}</div></div>`
    )
    .join("\n");
  return `<h1>${escapeHtml(u.username)}</h1>
<p class="meta" style="padding-left:0">karma: ${u.karma} · cuenta creada ${timeAgo(u.created_at)}</p>
${comments || '<p class="meta" style="padding-left:0">sin comentarios todavía.</p>'}`;
}

export function welcomePage(username: string): string {
  return `<div class="box">
<h1>listo, ${escapeHtml(username)}</h1>
<p style="margin:.6rem 0">tu cuenta ya funciona. tres cosas que podés hacer:</p>
<p style="margin:.6rem 0">▲ votá las noticias que te parezcan importantes — los votos deciden la portada.</p>
<p style="margin:.6rem 0">💬 entrá a los <em>comentarios</em> de cualquier nota para discutirla.</p>
<p style="margin:.6rem 0">+ <a href="/enviar">enviá</a> una noticia que la portada todavía no tenga.</p>
<p style="margin:.9rem 0"><a href="/">ir a la portada »</a></p>
</div>`;
}

export function settingsPage(message?: string, isError = false): string {
  const msg = message ? `<p class="${isError ? "err" : "meta"}"${isError ? "" : ' style="padding-left:0"'}>${escapeHtml(message)}</p>` : "";
  return `${msg}<div class="box">
<h1>cambiar contraseña</h1>
<form method="post" action="/ajustes">
  <label>contraseña actual <input type="password" name="current_password" required autocomplete="current-password"></label>
  <label>contraseña nueva (mín. 8) <input type="password" name="new_password" required minlength="8" autocomplete="new-password"></label>
  <button>cambiar</button>
</form>
</div>`;
}

export function aboutPage(): string {
  return `<div class="box">
<h1>acerca de hagov.news</h1>
<p style="margin:.6rem 0">agregador minimalista de noticias argentinas. la portada se arma sola con los titulares
de una docena de medios (de todo el espectro) y los votos de la comunidad deciden qué sube.
sin algoritmo de engagement, sin tracking, sin popups, sin autoplay.</p>
<p style="margin:.6rem 0">el ranking decae con el tiempo: ninguna noticia vive más de ~48 h en portada.</p>
<p style="margin:.6rem 0">para votar, comentar y enviar noticias solo hace falta una cuenta: usuario y contraseña, sin email.</p>
</div>`;
}

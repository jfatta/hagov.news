// Shell HTML + CSS. Estética: minimalista cyberpunk — fondo oscuro,
// monospace, acento neón. Sin JS obligatorio, sin webfonts, sin imágenes.

import { escapeHtml } from "../util";
import type { SessionUser } from "../auth";

// Favicon: el mismo bloque ▮ verde del logo, sobre el fondo oscuro del sitio.
const FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='6' fill='#0b0f14'/><rect x='9' y='9' width='14' height='14' fill='#2de2a6'/></svg>`
  );

const CSS = `
:root{--bg:#0b0f14;--panel:#101720;--fg:#c9d7e0;--dim:#5c7186;--neon:#2de2a6;--neon2:#e83e8c;--link:#d7e4ee;--visited:#7d93a8;--border:#1c2836}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--fg);font:14px/1.5 ui-monospace,'Cascadia Code',Consolas,Menlo,monospace;max-width:52rem;margin:0 auto;padding:0 .75rem}
a{color:var(--link);text-decoration:none}
a:hover{color:var(--neon)}
header{display:flex;flex-wrap:wrap;gap:.4rem 1rem;align-items:baseline;padding:.7rem 0;border-bottom:1px solid var(--border);margin-bottom:.8rem}
header .logo{color:var(--neon);font-weight:700;font-size:1.05rem;text-shadow:0 0 8px rgba(45,226,166,.45)}
header .logo::before{content:"▮ "}
header h1{display:contents}
header nav{display:flex;gap:.9rem;font-size:.85rem}
header nav a{color:var(--dim)}
header nav a:hover{color:var(--neon)}
header .who{margin-left:auto;font-size:.85rem;color:var(--dim)}
header .who a{color:var(--fg)}
ol.stories{list-style:none;counter-reset:n}
ol.stories>li{counter-increment:n;display:flex;gap:.5rem;padding:.28rem 0;align-items:baseline}
ol.stories>li::before{content:counter(n) ".";color:var(--dim);min-width:2rem;text-align:right}
.vote{color:var(--dim);text-decoration:none;font-size:.9rem}
.vote:hover{color:var(--neon)}
.voted{color:var(--neon)}
.t a:visited{color:var(--visited)}
.dom{color:var(--dim);font-size:.8rem}
.meta{color:var(--dim);font-size:.78rem;padding-left:2.5rem;margin-top:-.15rem;margin-bottom:.25rem}
.meta a{color:var(--dim)}
.meta a:hover{color:var(--neon)}
.meta a.human{color:var(--neon);opacity:.75}
.meta a.human:hover{opacity:1}
.more{display:inline-block;margin:.9rem 0 0 2.5rem;color:var(--neon)}
h1{font-size:1.05rem;margin-bottom:.6rem}
.box{background:var(--panel);border:1px solid var(--border);padding:1rem;margin:.8rem 0;border-radius:2px}
form label{display:block;color:var(--dim);font-size:.8rem;margin-top:.7rem}
input[type=text],input[type=password],input[type=url],textarea{width:100%;max-width:26rem;background:var(--bg);border:1px solid var(--border);color:var(--fg);font:inherit;padding:.4rem;margin-top:.2rem}
input:focus,textarea:focus{outline:1px solid var(--neon);border-color:var(--neon)}
button{background:transparent;border:1px solid var(--neon);color:var(--neon);font:inherit;padding:.35rem .9rem;margin-top:.8rem;cursor:pointer}
button:hover{background:var(--neon);color:var(--bg)}
button.inline{border:none;padding:0;margin:0;color:var(--dim);font-size:.78rem}
button.inline:hover{background:transparent;color:var(--neon2)}
button.inline.voted{color:var(--neon)}
button.inline.voted:hover{color:var(--neon2)}
.err{color:var(--neon2);margin:.5rem 0}
.comment{margin:.7rem 0;padding-left:.8rem;border-left:1px solid var(--border)}
.comment .chead{color:var(--dim);font-size:.78rem}
.comment .chead a{color:var(--dim)}
.comment .cbody{margin:.15rem 0 .3rem;white-space:pre-wrap;overflow-wrap:anywhere}
.comment.dead .cbody{color:var(--dim);font-style:italic}
.coverage{color:var(--dim);font-size:.82rem;margin:.4rem 0 .4rem 2.5rem}
footer{border-top:1px solid var(--border);margin-top:1.5rem;padding:.8rem 0 1.5rem;color:var(--dim);font-size:.78rem;text-align:center}
table.admin{border-collapse:collapse;width:100%;font-size:.82rem}
table.admin td,table.admin th{border:1px solid var(--border);padding:.3rem .5rem;text-align:left}
@media (max-width:600px){body{font-size:13px}header .who{margin-left:0;width:100%}}
`;

const SITE_URL = "https://hagov.news";
const DEFAULT_DESCRIPTION =
  "Agregador minimalista de noticias argentinas: la portada la arma la comunidad votando, sin clickbait ni tracking.";

export interface PageOptions {
  extraHead?: string;
  description?: string;
  /** Ruta canónica (ej. "/item/123"). Si se omite, la página no lleva canonical ni og:url. */
  canonicalPath?: string;
  /** Páginas privadas o de acción (login, ajustes, admin...) no deben indexarse. */
  noindex?: boolean;
  /** La portada lleva el logo como <h1> real; el resto de las páginas lo dejan como link. */
  isHome?: boolean;
}

export function page(title: string, body: string, user: SessionUser | null, opts: PageOptions = {}): Response {
  const { extraHead = "", description = DEFAULT_DESCRIPTION, canonicalPath, noindex = false, isHome = false } = opts;
  const who = user
    ? `<a href="/user/${escapeHtml(user.username)}">${escapeHtml(user.username)}</a> (${user.karma}) · <a href="/ajustes">ajustes</a> · <a href="/logout">salir</a>`
    : `<a href="/login">entrar</a>`;
  const canonicalUrl = canonicalPath ? SITE_URL + canonicalPath : undefined;
  const seoTags = [
    `<meta name="description" content="${escapeHtml(description)}">`,
    noindex ? `<meta name="robots" content="noindex">` : "",
    canonicalUrl ? `<link rel="canonical" href="${escapeHtml(canonicalUrl)}">` : "",
    `<meta property="og:site_name" content="hagov.news">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:type" content="website">`,
    canonicalUrl ? `<meta property="og:url" content="${escapeHtml(canonicalUrl)}">` : "",
    `<meta name="twitter:card" content="summary">`,
    `<meta name="twitter:title" content="${escapeHtml(title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(description)}">`,
  ]
    .filter(Boolean)
    .join("\n");
  const logo = isHome
    ? `<h1><a class="logo" href="/">hagov.news</a></h1>`
    : `<a class="logo" href="/">hagov.news</a>`;
  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="icon" type="image/svg+xml" href="${FAVICON}">
${seoTags}
<style>${CSS}</style>
${extraHead}
</head>
<body>
<header>
  ${logo}
  <nav><a href="/nuevas">nuevas</a><a href="/enviar">enviar</a></nav>
  <span class="who">${who}</span>
</header>
<main>
${body}
</main>
<footer>noticias argentinas, sin algoritmo de engagement · <a href="/acerca">acerca de</a></footer>
<script>
document.addEventListener("submit", function (e) {
  var f = e.target;
  if (!f.classList || !f.classList.contains("votef")) return;
  e.preventDefault();
  var pointsId = f.getAttribute("data-points");
  var btn = f.querySelector("button");
  fetch(f.action, { method: "POST", headers: { "X-Requested-With": "fetch" } })
    .then(function (r) {
      var ct = r.headers.get("content-type") || "";
      if (!r.ok || ct.indexOf("json") === -1) { location.reload(); return null; }
      return r.json();
    })
    .then(function (data) {
      if (!data || !data.ok) return;
      var span = document.getElementById(pointsId);
      if (span) span.textContent = data.points + " pts";
      if (btn) {
        btn.classList.toggle("voted", !!data.voted);
        btn.title = data.voted ? "sacar voto" : "votar";
      }
    })
    .catch(function () { location.reload(); });
});
</script>
</body>
</html>`;
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export function redirect(to: string, setCookie?: string, status: 301 | 302 = 302): Response {
  const headers = new Headers({ Location: to });
  if (setCookie) headers.set("Set-Cookie", setCookie);
  return new Response(null, { status, headers });
}

-- hagov.news — schema D1
-- Aplicar con: npm run db:local  (o db:remote)

CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  feed_url TEXT NOT NULL UNIQUE,
  site_url TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'rss',      -- rss | news_sitemap
  enabled INTEGER NOT NULL DEFAULT 1,
  last_fetched_at INTEGER,
  last_error TEXT,
  url_exclude TEXT                         -- regex sobre el pathname; si matchea, el item se ignora
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  karma INTEGER NOT NULL DEFAULT 0,
  is_admin INTEGER NOT NULL DEFAULT 0,
  banned INTEGER NOT NULL DEFAULT 0,
  reg_ip TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stories (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  url_normalized TEXT NOT NULL UNIQUE,
  domain TEXT NOT NULL,
  source_id INTEGER REFERENCES sources(id),  -- NULL = enviada por usuario
  submitted_by INTEGER REFERENCES users(id),
  points INTEGER NOT NULL DEFAULT 1,
  comment_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,               -- unix seconds
  dead INTEGER NOT NULL DEFAULT 0,
  flags INTEGER NOT NULL DEFAULT 0,
  canonical_id INTEGER REFERENCES stories(id),
  title_normalized TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_stories_created ON stories(created_at);
CREATE INDEX IF NOT EXISTS idx_stories_canonical ON stories(canonical_id);

CREATE TABLE IF NOT EXISTS votes (
  user_id INTEGER NOT NULL REFERENCES users(id),
  story_id INTEGER NOT NULL REFERENCES stories(id),
  PRIMARY KEY (user_id, story_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY,
  story_id INTEGER NOT NULL REFERENCES stories(id),
  parent_id INTEGER REFERENCES comments(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  dead INTEGER NOT NULL DEFAULT 0,
  flags INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_comments_story ON comments(story_id);

CREATE TABLE IF NOT EXISTS comment_votes (
  user_id INTEGER NOT NULL REFERENCES users(id),
  comment_id INTEGER NOT NULL REFERENCES comments(id),
  PRIMARY KEY (user_id, comment_id)
);

-- Contador de tasa por ventana fija (login, votos, envíos, comentarios).
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

-- Fuentes verificadas el 2026-08-15 (curl devuelve XML válido en todas)
INSERT OR IGNORE INTO sources (name, feed_url, site_url, format) VALUES
  ('Infobae', 'https://www.infobae.com/arc/outboundfeeds/rss/?outputType=xml', 'https://www.infobae.com', 'rss'),
  ('Clarín', 'https://www.clarin.com/rss/lo-ultimo/', 'https://www.clarin.com', 'rss'),
  ('La Nación', 'https://www.lanacion.com.ar/arc/outboundfeeds/rss/?outputType=xml', 'https://www.lanacion.com.ar', 'rss'),
  ('TN', 'https://tn.com.ar/rss.xml', 'https://tn.com.ar', 'rss'),
  ('Perfil', 'https://www.perfil.com/feed', 'https://www.perfil.com', 'rss'),
  ('Página/12', 'https://www.pagina12.com.ar/arc/outboundfeeds/breakingnews-sitemap.xml', 'https://www.pagina12.com.ar', 'news_sitemap'),
  ('El Destape', 'https://www.eldestapeweb.com/sitemap-news.xml', 'https://www.eldestapeweb.com', 'news_sitemap'),
  ('Ámbito', 'https://www.ambito.com/rss/pages/home.xml', 'https://www.ambito.com', 'rss'),
  ('El Cronista', 'https://www.cronista.com/files/rss/news.xml', 'https://www.cronista.com', 'rss'),
  ('La Capital', 'https://www.lacapital.com.ar/rss/pages/home.xml', 'https://www.lacapital.com.ar', 'rss'),
  ('Chequeado', 'https://chequeado.com/feed/', 'https://chequeado.com', 'rss'),
  ('La Política Online', 'https://www.lapoliticaonline.com/files/rss/politica.xml', 'https://www.lapoliticaonline.com', 'rss'),
  ('La Política Online', 'https://www.lapoliticaonline.com/files/rss/economia.xml', 'https://www.lapoliticaonline.com', 'rss'),
  ('El Canciller', 'https://elcanciller.com/rss', 'https://elcanciller.com', 'rss'),
  ('Filo.news', 'https://www.filo.news/sitemap/sitemap-googlenews.xml', 'https://www.filo.news', 'news_sitemap');

-- El feed general de Infobae mezcla sus verticales internacionales; nos quedamos con lo argentino
UPDATE sources SET url_exclude = '^/(mexico|peru|colombia|venezuela|espana|america|estados-unidos)/'
WHERE feed_url LIKE '%infobae.com%';

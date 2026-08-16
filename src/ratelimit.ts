// Limitador de tasa genérico por ventana fija, respaldado en D1.
// HN no publica cómo frena bots, pero algo así de simple alcanza:
// cada key (login:ip, vote:userId, submit:userId...) tiene un contador por ventana de tiempo.

export async function rateLimit(env: Env, key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const windowStart = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds;
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1
     RETURNING count`
  )
    .bind(key, windowStart)
    .first<{ count: number }>();
  return (row?.count ?? 0) <= limit;
}

/** Borra ventanas viejas para que la tabla no crezca sin límite. Se llama desde el cron. */
export async function cleanupRateLimits(env: Env): Promise<void> {
  const cutoff = Math.floor(Date.now() / 1000) - 2 * 86400;
  await env.DB.prepare("DELETE FROM rate_limits WHERE window_start < ?").bind(cutoff).run();
}

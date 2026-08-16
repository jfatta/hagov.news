// Ranking estilo HN: la portada no se "reinicia" nunca; cada nota decae sola con las horas.

/** Gravedad: más alta que el 1.8 de HN porque las noticias envejecen más rápido. */
export const GRAVITY = 2.2;

/** Ventana de la portada: solo notas de las últimas 48 h. */
export const FRONT_WINDOW_SECONDS = 48 * 3600;

export function score(points: number, ageHours: number, gravity = GRAVITY): number {
  return points / Math.pow(ageHours + 2, gravity);
}

export interface Rankable {
  points: number;
  created_at: number;
}

export function rankStories<T extends Rankable>(stories: T[], now = Math.floor(Date.now() / 1000)): T[] {
  return [...stories].sort((a, b) => {
    const sa = score(a.points, (now - a.created_at) / 3600);
    const sb = score(b.points, (now - b.created_at) / 3600);
    return sb - sa;
  });
}

export interface City { n: string; x: number | null; y: number | null }

let cache: Promise<City[]> | null = null;

export function loadCities(): Promise<City[]> {
  cache ??= fetch(`${import.meta.env.BASE_URL}geo/cities.json`).then((r) => r.json() as Promise<City[]>);
  return cache;
}

const norm = (s: string) => s.replace(/[\s\-–־"'׳״()]/g, '').toLowerCase();

/** Exact typed prefix first, then prefix ignoring spaces and dashes, then matches anywhere. */
export function searchCities(all: City[], q: string, limit = 6): City[] {
  const raw = q.trim();
  const k = norm(q);
  if (!k) return [];
  const rank = (c: City) => {
    if (c.n.startsWith(raw)) return 0;
    if (norm(c.n).startsWith(k)) return 1;
    return norm(c.n).includes(k) ? 2 : 3;
  };
  return all
    .map((c) => ({ c, r: rank(c) }))
    .filter((x) => x.r < 3)
    .sort((a, b) => a.r - b.r || a.c.n.length - b.c.n.length)
    .slice(0, limit)
    .map((x) => x.c);
}

export function findCity(all: City[], name: string): City | undefined {
  const k = norm(name);
  return all.find((c) => norm(c.n) === k);
}

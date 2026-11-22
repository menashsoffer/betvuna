// Loads the map outline and the locality coordinates (both precomputed by scripts/build-geo.mjs).

export interface Geo {
  W: number;
  H: number;
  path: string;
  dots: [number, number][];
}

interface CityRow { n: string; x: number | null; y: number | null }

const base = import.meta.env.BASE_URL;
const norm = (s: string) => s.replace(/[\s\-–־"'׳״()]/g, '');

export async function loadGeo(): Promise<{ geo: Geo; cityPoint: (city: string) => [number, number] | null }> {
  const [geo, cities] = await Promise.all([
    fetch(`${base}geo/israel.json`).then((r) => r.json() as Promise<Geo>),
    fetch(`${base}geo/cities.json`).then((r) => r.json() as Promise<CityRow[]>).catch(() => [] as CityRow[]),
  ]);
  const byName = new Map<string, [number, number]>();
  for (const c of cities) if (c.x != null && c.y != null) byName.set(norm(c.n), [c.x, c.y]);
  return { geo, cityPoint: (city) => byName.get(norm(city)) ?? null };
}

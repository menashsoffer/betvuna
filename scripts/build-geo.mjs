// Builds public/geo/israel.json (map outline + dot grid) and public/geo/cities.json
// (every Israeli locality, projected into the same map coordinates).
// Sources: world-atlas (Natural Earth, public domain), israel-geolocation (CBS localities, MIT),
// @geomelon/israel (Wikidata, CC0) for localities whose coordinates are missing in the first.
// Run: node scripts/build-geo.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { feature, merge } from 'topojson-client';
import { geoContains, geoMercator, geoPath } from 'd3-geo';

const require = createRequire(import.meta.url);
const topo = JSON.parse(readFileSync(require.resolve('world-atlas/countries-10m.json'), 'utf8'));
const localities = JSON.parse(
  readFileSync('node_modules/israel-geolocation/dist/locations.json', 'utf8'),
);

const wikidata = JSON.parse(readFileSync('node_modules/@geomelon/israel/data.json', 'utf8')).cities;
const byHebrew = new Map(
  wikidata.filter((c) => c.translations?.he && Number.isFinite(c.latitude))
    .map((c) => [c.translations.he, [c.longitude, c.latitude]]),
);
// israel-geolocation uses this point when it has no real coordinates
const PLACEHOLDER = '31.046051,34.851612';
// Checked by hand, for localities missing from both sources
const MANUAL = {
  'ביתר עילית': [35.1167, 31.6983],
  'אביגיל': [35.145, 31.378],
  'אדוריים': [35.03, 31.48],
  'אחיה': [35.32, 32.07],
  'אלון מורה': [35.33, 32.235],
  'אלקנה': [35.035, 32.11],
  'אספר': [35.255, 31.6],
  'אפרת': [35.155, 31.655],
  'בית אריה': [35.05, 32.035],
  'בית הערבה': [35.5, 31.81],
  'בקעות': [35.44, 32.27],
  'ברכה': [35.255, 32.185],
  'גלגל': [35.465, 31.99],
  'הילה': [35.075, 32.04],
  'ורד יריחו': [35.43, 31.83],
  'חמדת': [35.47, 32.29],
  'חמרה': [35.42, 32.14],
  'יצהר': [35.24, 32.17],
  'כפר האורנים': [35.035, 31.935],
  'כרמי צור': [35.115, 31.615],
  'מבוא דותן': [35.17, 32.42],
  'מגדל עוז': [35.15, 31.635],
  'מגדלים': [35.39, 32.09],
  'מגרון': [35.25, 31.89],
  'מחנה טלי': [35.37, 31.96],
  'מכורה': [35.45, 32.18],
  'מעלה אדומים': [35.3, 31.775],
  'מעלה אפרים': [35.4, 32.08],
  'מעלה לבונה': [35.25, 32.065],
  'משכיות': [35.47, 32.31],
  'נופים': [35.07, 32.15],
  'נוקדים': [35.25, 31.65],
  'נחליאל': [35.13, 31.97],
  'נילי': [35.035, 31.955],
  'נתיב הגדוד': [35.48, 32.08],
  'סוסיה': [35.11, 31.39],
  'עדי עד': [35.37, 32.025],
  'עלי': [35.265, 32.065],
  'פסגות': [35.24, 31.9],
  'פצאל': [35.45, 32.04],
  'צופיה': [34.87, 31.66],
  'קדומים': [35.15, 32.215],
  'קליה': [35.46, 31.75],
  'ראש צורים': [35.13, 31.66],
  'רבבה': [35.16, 32.13],
  'רועי': [35.48, 32.25],
  'רחלים': [35.235, 32.1],
  'ריחן': [35.12, 32.46],
  'רימונים': [35.32, 31.94],
  'שחרית': [35.0, 31.91],
  'גודר': [35.28, 31.62],
  'אובנת': [35.44, 31.68],
  'חרשה': [35.13, 31.94],
  'בית רבן': [34.73, 31.85],
  'מקווה ישראל': [34.78, 32.035],
  'פרשים': [34.82, 31.35],
  'רמת הנשיא טראמפ': [35.73, 33.13],
};

const IDS = ['376', '275']; // Israel + the area west of the Jordan, drawn as one shape
const W = 200, H = 440;
const geoms = topo.objects.countries.geometries.filter((g) => IDS.includes(String(g.id)));
const shape = merge(topo, geoms);
const parts = feature(topo, topo.objects.countries).features.filter((f) => IDS.includes(String(f.id)));
const proj = geoMercator().fitExtent([[4, 4], [W - 4, H - 4]], { type: 'FeatureCollection', features: parts });
const round = (s) => s.replace(/\d+\.\d+/g, (m) => (+m).toFixed(1));

const dots = [];
for (let y = 4; y < H; y += 7) for (let x = 4; x < W; x += 7) {
  const ll = proj.invert([x, y]);
  if (parts.some((f) => geoContains(f, ll))) dots.push([x, y]);
}
writeFileSync('public/geo/israel.json', JSON.stringify({ W, H, path: round(geoPath(proj)(shape)), dots }));

const clean = (n) => n.replace(/\s+/g, ' ').replace(/\s*-\s*/g, '-').trim();
const cities = localities
  .filter((l) => l.name)
  .map((l) => {
    const n = clean(l.name);
    const own = Number.isFinite(l.lat) && `${l.lat},${l.lon}` !== PLACEHOLDER ? [l.lon, l.lat] : null;
    const lonlat = MANUAL[n] ?? own ?? byHebrew.get(l.name) ?? byHebrew.get(n) ?? null;
    if (!lonlat) return { n, x: null, y: null }; // selectable, just no dot on the map
    const [x, y] = proj(lonlat);
    return { n, x: +x.toFixed(1), y: +y.toFixed(1) };
  })
  .filter((c, i, a) => a.findIndex((d) => d.n === c.n) === i)
  .sort((a, b) => a.n.localeCompare(b.n, 'he'));
writeFileSync('public/geo/cities.json', JSON.stringify(cities));
const noDot = cities.filter((c) => c.x === null).length;
console.log(`israel.json: ${dots.length} dots · cities.json: ${cities.length} localities (${noDot} without coordinates)`);

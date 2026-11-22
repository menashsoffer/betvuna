// ?demo=1 — local rehearsal mode with no server: fake ambassadors with silhouette "selfies".
// Keys: Space pause/resume · + or ← add one · F jump to 40 · R start over.
// URL options: &n=40 (start with 40 already on the wall), &fast=1, &max=150.
import type { WallEntry } from '../shared/types';
import type { Wall } from './wall';

const FIRST = ['משה', 'יוסף', 'דוד', 'שמעון', 'אליהו', 'חיים', 'ראובן', 'נחום', 'עזרא', 'יעקב', 'ברוך', 'צבי', 'קלמן', 'תמיר',
  'גדליה', 'לוי', 'פנחס', 'הלל', 'שלמה', 'זאב', 'אריה', 'טוביה', 'מנחם', 'אהרן', 'יחיאל', 'שאול', 'דניאל', 'נתן', 'רפאל', 'חנוך',
  'בנימין', 'אברהם', 'עמרם', 'איתמר', 'נועם', 'יהודה', 'מרדכי', 'אלחנן', 'שמואל', 'יצחק'];
const LAST = ['לוי', 'כהן', 'אברהם', 'רוזן', 'ברגר', 'שפירא', 'גולד', 'סגל', 'טל', 'לנדאו', 'מזרחי', 'פרידמן', 'הלוי', 'וייס', 'זילבר',
  'דהן', 'כץ', 'נחמני', 'ישראלי', 'ענבי', 'קליין', 'צור', 'שטרן', 'רבינוביץ', 'חדד', 'בן דוד', 'מור', 'אוחנה', 'לוין', 'גרין', 'סופר',
  'ביטון', 'גל', 'שלו', 'אדלר', 'פרץ', 'עמר', 'ברק'];
const CITIES: [string, number][] = [['ירושלים', 6], ['בני ברק', 5], ['בית שמש', 4], ['מודיעין עילית', 4], ['אלעד', 3],
  ['ביתר עילית', 3], ['אשדוד', 3], ['פתח תקווה', 2], ['תל אביב - יפו', 1], ['חיפה', 1], ['באר שבע', 1], ['צפת', 1], ['טבריה', 1],
  ['נתניה', 1], ['אילת', 1], ['קרית גת', 1], ['עפולה', 1], ['אופקים', 1], ['רחובות', 1], ['קרית שמונה', 1], ['נתיבות', 1],
  ['חדרה', 1], ['כרמיאל', 1], ['דימונה', 1], ['אפרת', 1], ['קדומים', 1], ['עמנואל', 1], ['רכסים', 1]];

function silhouette(i: number): string {
  const h = [210, 30, 170, 260, 15, 190, 45, 140][i % 8];
  const l = [26, 32, 22, 30, 36, 28][i % 6];
  const skin = `hsl(${25 + ((i * 7) % 15)} ${20 + ((i * 5) % 20)}% ${48 + ((i * 11) % 22)}%)`;
  const cloth = `hsl(${(h + 180) % 360} 12% ${14 + ((i * 3) % 14)}%)`;
  const hat = i % 3 !== 1 ? `<path d="M33 37 C34 22 66 22 67 37 C61 31 39 31 33 37 Z" fill="hsl(0 0% ${8 + ((i * 4) % 14)}%)"/>` : '';
  const beard = i % 4 === 0 ? `<path d="M36 50 C38 71 62 71 64 50 C60 63 40 63 36 50 Z" fill="hsl(20 15% ${15 + ((i * 3) % 15)}%)"/>` : '';
  const s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">`
    + `<stop offset="0" stop-color="hsl(${h} 22% ${l + 18}%)"/><stop offset="1" stop-color="hsl(${h} 25% ${l}%)"/></linearGradient></defs>`
    + `<rect width="100" height="100" fill="url(#g)"/><path d="M10 100 C12 80 30 70 50 70 C70 70 88 80 90 100 Z" fill="${cloth}"/>`
    + `<rect x="43" y="54" width="14" height="18" rx="5" fill="${skin}"/><ellipse cx="50" cy="44" rx="16" ry="19" fill="${skin}"/>${hat}${beard}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`;
}

export function startDemo(wall: Wall, params: URLSearchParams): void {
  const fast = params.has('fast');
  const max = Math.min(Number(params.get('max')) || 70, 150);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const total = CITIES.reduce((a, [, w]) => a + w, 0);
  const pickCity = () => {
    let t = rnd() * total;
    for (const [c, w] of CITIES) if ((t -= w) <= 0) return c;
    return CITIES[0][0];
  };
  let seq = 0;
  const make = (): WallEntry => {
    const i = seq++;
    return {
      join_seq: seq,
      full_name: `${FIRST[(i * 7) % FIRST.length]} ${LAST[(i * 11 + 3) % LAST.length]}`,
      city: pickCity(),
      // every fifth one has no selfie, to show the initials circle
      photo: i % 5 === 4 ? null : silhouette(i),
      joined_at: new Date().toISOString(),
      is_simulated: true,
    };
  };

  let running = !params.has('paused');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const interval = () => (fast ? 1300 : 2900);
  const tick = () => {
    clearTimeout(timer);
    if (!running || seq >= max) return;
    wall.enqueue(make());
    timer = setTimeout(tick, interval());
  };

  const preset = Math.min(Number(params.get('n')) || 6, max);
  for (let k = 0; k < preset; k++) wall.addInstant(make());
  timer = setTimeout(tick, 900);

  window.addEventListener('keydown', (ev) => {
    if (ev.key === ' ') { running = !running; if (running) tick(); else clearTimeout(timer); ev.preventDefault(); }
    else if (ev.key === '+' || ev.key === 'ArrowLeft') { if (seq < 150) wall.enqueue(make()); }
    else if (ev.key === 'f' || ev.key === 'F' || ev.key === 'כ') { while (seq < 40) wall.addInstant(make()); }
    else if (ev.key === 'r' || ev.key === 'R' || ev.key === 'ר') { clearTimeout(timer); wall.clear(); seq = 0; seed = 7; running = true; timer = setTimeout(tick, 800); }
  });
}

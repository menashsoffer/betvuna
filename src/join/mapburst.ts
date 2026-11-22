import { findCity, loadCities } from './cities';

/** Tap animation "נדלק על המפה": the map of Israel draws itself in gold and the joiner's city lights up. */

interface Geo { W: number; H: number; path: string }
let geo: Promise<Geo> | null = null;
const loadGeo = () => (geo ??= fetch(`${import.meta.env.BASE_URL}geo/israel.json`).then((r) => r.json() as Promise<Geo>));

/** Start loading the map early so the tap feels instant. */
export function preloadMap(): void {
  loadGeo().catch(() => { geo = null; });
  loadCities().catch(() => {});
}

const SVG = 'http://www.w3.org/2000/svg';
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const play = (el: Element, kf: Keyframe[], o: KeyframeAnimationOptions) =>
  el.animate(kf, { fill: 'forwards', easing: 'cubic-bezier(.2,.7,.2,1)', ...o });

export interface MapBurst {
  /** Draws the map and lights the city; resolves when the city is lit. */
  done: Promise<void>;
  /** Screen position of the lit city (or the map centre if the city has no coordinates). */
  origin(): { x: number; y: number } | null;
  /** Dims the map into the background of the next screen. */
  dim(): void;
  remove(): void;
}

export function mapBurst(cityName: string): MapBurst {
  const wrap = document.createElement('div');
  wrap.className = 'mapburst';
  wrap.setAttribute('aria-hidden', 'true');
  document.body.appendChild(wrap);
  let dot: SVGCircleElement | null = null;

  const done = (async () => {
    const [g, cities] = await Promise.all([loadGeo(), loadCities().catch(() => [])]);
    const c = findCity(cities, cityName);
    const has = c && c.x != null && c.y != null;
    wrap.innerHTML = `<svg viewBox="0 0 ${g.W} ${g.H}"><path d="${g.path}"/></svg>`;
    const svg = wrap.querySelector('svg')!;
    const path = svg.querySelector('path')!;
    const fast = reduce();
    if (!fast) {
      const L = path.getTotalLength();
      path.style.strokeDasharray = `${L}`;
      await play(path, [{ strokeDashoffset: L }, { strokeDashoffset: 0 }], { duration: 1300, easing: 'ease-in-out' }).finished;
    }
    play(path, [{ fill: 'rgba(227,180,90,0)' }, { fill: 'rgba(227,180,90,.18)' }], { duration: fast ? 1 : 500 });
    const cx = has ? c!.x! : g.W * 0.45, cy = has ? c!.y! : g.H * 0.4;
    dot = document.createElementNS(SVG, 'circle');
    Object.entries({ cx, cy, r: 5, class: 'dot' }).forEach(([k, v]) => dot!.setAttribute(k, String(v)));
    svg.appendChild(dot);
    navigator.vibrate?.(25);
    if (fast) return;
    play(dot, [{ r: 0 }, { r: 9 }, { r: 5 }] as Keyframe[], { duration: 500 });
    for (let i = 0; i < 3; i++) {
      const ring = document.createElementNS(SVG, 'circle');
      Object.entries({ cx, cy, r: 5, class: 'ring' }).forEach(([k, v]) => ring.setAttribute(k, String(v)));
      svg.appendChild(ring);
      play(ring, [{ r: 5, opacity: 1 }, { r: 60, opacity: 0 }] as Keyframe[], { duration: 1000, delay: i * 220, easing: 'ease-out' });
    }
    await new Promise((r) => setTimeout(r, 650));
  })();

  return {
    done,
    origin() {
      if (!dot) return null;
      const r = dot.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    },
    dim() { play(wrap, [{ opacity: 1 }, { opacity: 0.16 }], { duration: 700, delay: 300 }); },
    remove() { wrap.remove(); },
  };
}

/** Pops the avatar out of the lit city and flies it to its place on the welcome screen. */
export function flyFrom(av: HTMLElement, from: { x: number; y: number } | null): void {
  if (!from || reduce()) return;
  const r = av.getBoundingClientRect();
  const dx = from.x - (r.left + r.width / 2), dy = from.y - (r.top + r.height / 2);
  play(av, [
    { transform: `translate(${dx}px,${dy}px) scale(.05)`, opacity: 0 },
    { transform: `translate(${dx}px,${dy}px) scale(.45)`, opacity: 1, offset: 0.35 },
    { transform: 'translate(0,0) scale(1.08)', opacity: 1, offset: 0.8 },
    { transform: 'none', opacity: 1 },
  ], { duration: 900 });
}

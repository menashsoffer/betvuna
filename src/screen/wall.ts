// The hall wall: map, rings of photo circles, side-light counters, the spotlight queue and the
// gravity settle. It only knows about WallEntry objects; where they come from (Supabase or the
// local demo) is the caller's business.
import type { WallEntry } from '../shared/types';
import type { Geo } from './geo';
import { gravityEase, holdTime, landingAngle, layoutRings, type Layout, type Slot } from './layout';

const NS = 'http://www.w3.org/2000/svg';

type State = 'spot' | 'settling' | 'placed';
interface Person {
  entry: WallEntry;
  el: HTMLDivElement;
  slot?: Slot;
  d: number;
  state: State;
  gone?: boolean;
}

export interface WallOptions {
  /** Base spotlight time in ms (shrinks as the queue grows). */
  hold?: number;
  /** Pause between one ambassador leaving the spotlight and the next arriving. */
  gap?: number;
}

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0]).join('');
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  parent?.appendChild(e);
  return e;
}

/** Loads and decodes a photo before it is shown big. Resolves null if it fails or is slow. */
function preload(url: string, timeout = 2500): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.alt = '';
    const t = setTimeout(() => resolve(img.complete && img.naturalWidth ? img : null), timeout);
    img.onload = () => {
      img.decode().catch(() => undefined).then(() => { clearTimeout(t); resolve(img); });
    };
    img.onerror = () => { clearTimeout(t); resolve(null); };
    img.src = url;
  });
}

export class Wall {
  private people: Person[] = [];
  private queue: WallEntry[] = [];
  private busy = false;
  /** Bumped by clear(), so a spotlight in progress knows the wall was reset under it. */
  private gen = 0;
  private loading: { seq: number; cancelled: boolean; entry: WallEntry } | null = null;
  private W = 0;
  private H = 0;
  private L: Layout | null = null;
  private readonly mapSvg: SVGSVGElement;
  private readonly cityLayer: SVGGElement;
  private readonly orbits: HTMLDivElement[] = [];
  private readonly dim: HTMLDivElement;
  private readonly numEl: HTMLElement;
  private readonly cityEl: HTMLElement;
  private readonly hold: number;
  private readonly gap: number;

  constructor(
    private readonly stage: HTMLElement,
    private readonly geo: Geo,
    private readonly cityPoint: (city: string) => [number, number] | null,
    opts: WallOptions = {},
  ) {
    this.hold = opts.hold ?? 1600;
    this.gap = opts.gap ?? 350;
    this.numEl = stage.querySelector('#num')!;
    this.cityEl = stage.querySelector('#nc')!;
    this.dim = stage.querySelector('.dim')!;

    this.mapSvg = svg('svg', { viewBox: `0 0 ${geo.W} ${geo.H}`, class: 'map', 'aria-hidden': 'true' });
    svg('path', { d: geo.path, class: 'land' }, this.mapSvg);
    this.cityLayer = svg('g', {}, this.mapSvg);
    stage.insertBefore(this.mapSvg, this.dim);

    for (const dz of stage.querySelectorAll<HTMLElement>('.light .dust')) {
      for (let i = 0; i < 16; i++) {
        const m = document.createElement('i');
        m.style.left = `${18 + Math.random() * 64}%`;
        m.style.top = `${25 + Math.random() * 75}%`;
        m.style.setProperty('--dx', `${Math.random() * 4 - 2}cqw`);
        m.style.animationDuration = `${6 + Math.random() * 7}s`;
        m.style.animationDelay = `${-Math.random() * 12}s`;
        dz.appendChild(m);
      }
    }

    new ResizeObserver(() => {
      for (const p of this.people) p.el.classList.add('instant');
      this.layout();
      requestAnimationFrame(() => { for (const p of this.people) p.el.classList.remove('instant'); });
    }).observe(stage);
    this.layout();
  }

  // ---------- public API ----------

  get size(): number { return this.people.length; }
  has(seq: number): boolean {
    return this.find(seq) != null || this.queue.some((q) => q.join_seq === seq) || this.loading?.seq === seq;
  }

  /** Put an ambassador straight onto their ring, no spotlight (first load of the screen). */
  addInstant(entry: WallEntry): void {
    if (this.has(entry.join_seq)) return this.update(entry);
    const p = this.create(entry, 'placed');
    if (entry.photo) {
      const img = new Image();
      img.alt = '';
      img.src = entry.photo;
      img.onerror = () => this.fillPhoto(p, null);
      this.fillPhoto(p, img);
    }
    this.insert(p);
    p.el.classList.add('instant');
    this.refreshCounts(false);
    this.layout();
    requestAnimationFrame(() => p.el.classList.remove('instant'));
  }

  /** A new joiner: spotlight in the centre, then fly to the ring and slide down. */
  enqueue(entry: WallEntry): void {
    if (this.has(entry.join_seq)) return this.update(entry);
    this.queue.push(entry);
    this.queue.sort((a, b) => a.join_seq - b.join_seq);
    if (!this.busy) void this.next();
  }

  /** Name, city or photo changed (admin edit). */
  update(entry: WallEntry): void {
    const q = this.queue.findIndex((x) => x.join_seq === entry.join_seq);
    if (q >= 0) { this.queue[q] = entry; return; }
    if (this.loading?.seq === entry.join_seq) { this.loading.entry = entry; return; }
    const p = this.find(entry.join_seq);
    if (!p) return;
    const prev = p.entry;
    p.entry = entry;
    if (prev.full_name !== entry.full_name || prev.city !== entry.city) this.fillName(p);
    if (prev.photo !== entry.photo) {
      if (!entry.photo) this.fillPhoto(p, null);
      else void preload(entry.photo).then((img) => { if (p.entry.photo === entry.photo) this.fillPhoto(p, img); });
    }
    if (prev.city !== entry.city) this.refreshCounts(false);
  }

  remove(seq: number): void {
    this.queue = this.queue.filter((q) => q.join_seq !== seq);
    if (this.loading?.seq === seq) this.loading.cancelled = true;
    const p = this.find(seq);
    if (!p) return;
    p.gone = true;
    this.people.splice(this.people.indexOf(p), 1);
    if (p.state === 'spot') this.dim.classList.remove('on');
    p.el.classList.add('out');
    setTimeout(() => p.el.remove(), reduced() ? 0 : 500);
    this.refreshCounts(false);
    this.layout();
  }

  clear(): void {
    this.gen++;
    this.busy = false;
    this.loading = null;
    this.queue = [];
    for (const p of this.people) { p.gone = true; p.el.remove(); }
    this.people = [];
    this.dim.classList.remove('on');
    this.refreshCounts(false);
    this.layout();
  }

  /** Every entry currently known (on the wall or waiting in the queue). */
  entries(): WallEntry[] {
    const all = [...this.people.map((p) => p.entry), ...this.queue];
    if (this.loading && !this.loading.cancelled) all.push(this.loading.entry);
    return all;
  }

  // ---------- queue and spotlight ----------

  private async next(): Promise<void> {
    const entry = this.queue.shift();
    if (!entry) { this.busy = false; return; }
    this.busy = true;
    const gen = this.gen;
    const loading = (this.loading = { seq: entry.join_seq, cancelled: false, entry });
    const img = entry.photo ? await preload(entry.photo) : null;
    if (gen !== this.gen) return; // wall was reset; clear() already freed the queue
    this.loading = null;
    if (loading.cancelled || this.find(entry.join_seq)) { void this.next(); return; }
    // the admin may have edited the entry while its photo loaded
    const latest = loading.entry;

    const p = this.create(latest, 'spot');
    this.fillPhoto(p, latest.photo === entry.photo ? img : null);
    this.insert(p);
    this.refreshCounts(true, latest.city);

    p.el.classList.add('instant', 'spot', 'in');
    this.dim.classList.add('on');
    this.layout(); // also centres the spotlight circle

    await this.wait(reduced() ? 900 : holdTime(this.queue.length, this.hold));
    if (gen !== this.gen) return;
    if (p.gone) { void this.next(); return; }
    p.el.classList.remove('instant', 'in');
    await this.frame();
    p.state = 'settling';
    p.el.classList.remove('spot');
    this.dim.classList.remove('on');
    this.layout();
    this.settle(p);
    await this.wait(this.gap);
    if (gen !== this.gen) return;
    void this.next();
  }

  private settle(p: Person): void {
    const s = p.slot;
    if (!s || reduced()) { this.placed(p); return; }
    const d = p.d;
    const sa = landingAngle(s, d, this.H);
    this.place(p.el, s.cx + s.r * Math.cos(sa), s.cy + s.r * Math.sin(sa), d);
    setTimeout(() => {
      if (p.gone || p.slot !== s) { this.placed(p); return; }
      p.el.classList.add('sliding');
      const T = 1150;
      const t0 = performance.now();
      const step = (now: number) => {
        if (p.gone) return;
        if (p.slot !== s) { this.placed(p); return; }
        const u = Math.min((now - t0) / T, 1);
        const a = sa + (s.ang - sa) * gravityEase(u);
        this.place(p.el, s.cx + s.r * Math.cos(a), s.cy + s.r * Math.sin(a), d);
        if (u < 1) requestAnimationFrame(step);
        else { p.el.classList.remove('sliding'); p.state = 'placed'; }
      };
      requestAnimationFrame(step);
    }, 1150);
  }

  private placed(p: Person): void {
    p.state = 'placed';
    p.el.classList.remove('sliding');
    if (p.slot) this.place(p.el, p.slot.x, p.slot.y, p.d);
  }

  // ---------- layout ----------

  layout(): void {
    const r = this.stage.getBoundingClientRect();
    if (!r.width) return;
    this.W = r.width;
    this.H = r.height;
    const L = layoutRings({ n: this.people.length, W: this.W, H: this.H, geoW: this.geo.W, geoH: this.geo.H, dots: this.geo.dots });
    this.L = L;
    Object.assign(this.mapSvg.style, { left: `${L.map.x}px`, top: `${L.map.y}px`, width: `${L.map.w}px`, height: `${L.map.h}px` });

    L.rings.forEach((rg, k) => {
      let o = this.orbits[k];
      if (!o) {
        o = document.createElement('div');
        o.className = 'orbit';
        this.stage.insertBefore(o, this.mapSvg);
        this.orbits[k] = o;
      }
      Object.assign(o.style, {
        left: `${rg.cx - rg.r}px`, top: `${rg.cy - rg.r}px`, width: `${rg.r * 2}px`, height: `${rg.r * 2}px`,
        opacity: rg.used ? '1' : '0',
      });
    });
    for (let k = L.rings.length; k < this.orbits.length; k++) this.orbits[k].style.opacity = '0';

    this.people.forEach((p, i) => {
      p.slot = L.slots[i];
      p.d = L.d;
      if (p.state === 'spot') this.place(p.el, this.W / 2, this.H * 0.5, this.H * 0.4);
      if (p.state !== 'placed' || !p.slot) return;
      this.place(p.el, p.slot.x, p.slot.y, L.d);
    });
  }

  private place(el: HTMLElement, x: number, y: number, d: number): void {
    el.style.transform = `translate3d(${x - d / 2}px, ${y - d / 2}px, 0)`;
    el.style.width = `${d}px`;
    el.style.height = `${d}px`;
    el.style.setProperty('--d', `${d}px`);
    el.classList.toggle('tiny', !(this.L?.showNames ?? true) && !el.classList.contains('spot'));
  }

  // ---------- elements ----------

  private create(entry: WallEntry, state: State): Person {
    const el = document.createElement('div');
    el.className = 'c';
    const body = document.createElement('div');
    body.className = 'body';
    const ph = document.createElement('div');
    ph.className = 'ph';
    const nm = document.createElement('div');
    nm.className = 'nm';
    body.append(ph, nm);
    el.append(body);
    this.stage.insertBefore(el, this.dim.nextSibling);
    const p: Person = { entry, el, d: 0, state };
    this.fillName(p);
    this.fillPhoto(p, null);
    return p;
  }

  private fillName(p: Person): void {
    const nm = p.el.querySelector('.nm')!;
    const small = document.createElement('small');
    small.textContent = p.entry.city;
    nm.replaceChildren(document.createTextNode(p.entry.full_name), small);
  }

  private fillPhoto(p: Person, img: HTMLImageElement | null): void {
    const ph = p.el.querySelector('.ph')!;
    if (img) { ph.replaceChildren(img); return; }
    const ini = document.createElement('div');
    ini.className = 'ini';
    ini.textContent = initials(p.entry.full_name);
    ph.replaceChildren(ini);
  }

  private insert(p: Person): void {
    const i = this.people.findIndex((x) => x.entry.join_seq > p.entry.join_seq);
    if (i < 0) this.people.push(p);
    else this.people.splice(i, 0, p);
  }

  private find(seq: number): Person | undefined {
    return this.people.find((p) => p.entry.join_seq === seq);
  }

  // ---------- counters and city dots ----------

  private refreshCounts(flare: boolean, newCity?: string): void {
    const byCity = new Map<string, number>();
    for (const p of this.people) byCity.set(p.entry.city, (byCity.get(p.entry.city) ?? 0) + 1);
    const prevCities = Number(this.cityEl.textContent || 0);
    this.numEl.textContent = String(this.people.length);
    this.cityEl.textContent = String(byCity.size);
    if (flare) {
      this.flare('lr');
      if (byCity.size > prevCities) this.flare('ll');
    }
    this.cityLayer.replaceChildren();
    for (const [city, n] of byCity) {
      const pt = this.cityPoint(city);
      if (!pt) continue;
      svg('circle', { cx: pt[0], cy: pt[1], r: 4 + 4.6 * Math.sqrt(n), class: 'halo' }, this.cityLayer);
      svg('circle', { cx: pt[0], cy: pt[1], r: 2.6 + 1.3 * Math.sqrt(n), class: 'dot' }, this.cityLayer);
    }
    const pt = newCity ? this.cityPoint(newCity) : null;
    if (pt) svg('circle', { cx: pt[0], cy: pt[1], r: 9, class: 'ripple' }, this.cityLayer);
  }

  private flare(id: string): void {
    const e = this.stage.querySelector(`#${id}`);
    if (!e) return;
    e.classList.remove('flare');
    void (e as HTMLElement).offsetWidth;
    e.classList.add('flare');
  }

  private wait(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
  private frame(): Promise<void> { return new Promise((r) => requestAnimationFrame(() => r())); }
}

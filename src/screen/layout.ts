// Pure geometry of the hall screen: where the map goes, how big the photo circles are,
// and which slot on which ring each ambassador takes. No DOM here, so it is unit-tested.

export interface LayoutInput {
  /** Number of ambassadors on the wall. */
  n: number;
  /** Stage size in pixels (16:9). */
  W: number;
  H: number;
  /** Map coordinate space (israel.json W/H) and its dot grid, used to keep circles off the land. */
  geoW: number;
  geoH: number;
  dots: ReadonlyArray<readonly [number, number]>;
}

export interface Slot {
  /** Circle centre in stage pixels. */
  x: number;
  y: number;
  /** Angle on its ring (radians, 0 = right, PI/2 = bottom) and the ring it sits on. */
  ang: number;
  r: number;
  cx: number;
  cy: number;
}

export interface Ring { cx: number; cy: number; r: number; used: boolean }

export interface Layout {
  map: { x: number; y: number; w: number; h: number; scale: number };
  /** Circle diameter in pixels. */
  d: number;
  /** Height reserved under each circle for the name, 0 when names are hidden. */
  label: number;
  showNames: boolean;
  rings: Ring[];
  slots: Slot[];
}

export type Box = readonly [x0: number, y0: number, x1: number, y1: number];

/** Areas no circle may touch: the title (top centre) and the two side lights. */
export function blockedBoxes(W: number, H: number): Box[] {
  return [
    [W * 0.22, 0, W * 0.78, H * 0.17],
    [0, 0, W * 0.185, H],
    [W * 0.815, 0, W, H],
  ];
}

const MAX_RINGS = 16;
/** Smallest circle that still gets a name under it: its name is d * 0.16 ≈ 11px. */
const NAME_MIN_PX = 68;

/** Map height as a share of the screen: 60% when empty, shrinking as the rings grow. */
export function mapShare(n: number): number {
  const early = 0.3 * Math.sqrt(Math.min(n / 60, 1));
  const late = 0.08 * Math.min(Math.max((n - 60) / 90, 0), 1);
  return 0.6 - early - late;
}

export function layoutRings({ n, W, H, geoW, geoH, dots }: LayoutInput): Layout {
  const mapH = H * mapShare(n);
  const scale = mapH / geoH;
  const mapW = geoW * scale;
  const cx = W / 2;
  const cy = H * 0.54;
  const mx = cx - mapW / 2;
  const my = cy - mapH / 2;
  const land = dots.map(([x, y]) => [mx + x * scale, my + y * scale] as const);
  const boxes = blockedBoxes(W, H);
  const pad = H * 0.012;
  // names only when they come out legible: on a low-res screen (e.g. 1024x512) tiny names are mush,
  // so they are dropped and the photos get the room instead (the spotlight still shows each name big)
  const nameMin = Math.max(H * 0.065, NAME_MIN_PX);

  const ringsFor = (d: number) => {
    const label = d > nameMin ? d * 0.4 : 0;
    const step = d * 1.06 + label;
    const gap = d * (label ? 1.42 : 1.12);
    const r0 = (mapH / 2) * 0.78 + d * 0.55;
    const ccy = cy - label * 0.3;
    const rings: { r: number; valid: Slot[] }[] = [];
    let total = 0;
    for (let k = 0; k < MAX_RINGS; k++) {
      const r = r0 + k * step;
      // every ring must be fully visible; only the title may cover its top
      if (ccy + r + d / 2 + label > H - pad || cx - r - d / 2 < W * 0.19) break;
      const count = Math.max(1, Math.floor((2 * Math.PI * r) / gap));
      const D = (2 * Math.PI) / count;
      // positions from the bottom of the ring outward, alternating sides, so a partial ring is a smile
      const order = [0];
      for (let q = 1; order.length < count; q++) {
        order.push(q);
        if (order.length < count) order.push(count - q);
      }
      const valid: Slot[] = [];
      for (const q of order) {
        const ang = Math.PI / 2 + q * D;
        const x = cx + r * Math.cos(ang);
        const y = ccy + r * Math.sin(ang);
        if (x - d / 2 < pad || x + d / 2 > W - pad || y - d / 2 < pad || y + d / 2 + label > H - pad) continue;
        const hits = (b: Box) => x + d / 2 > b[0] && x - d / 2 < b[2] && y - d / 2 < b[3] && y + d / 2 + label > b[1];
        if (boxes.some(hits)) continue;
        const m = d / 2 + scale * 7;
        let clear = true;
        for (const [px, py] of land) {
          const dy = py > y ? Math.max(0, py - y - label) : py - y;
          if (Math.hypot(px - x, dy) < m) { clear = false; break; }
        }
        if (clear) valid.push({ x, y, ang, r, cx, cy: ccy });
      }
      rings.push({ r, valid });
      total += valid.length;
    }
    return { rings, total, label, ccy };
  };

  let d = H * 0.155;
  let R = ringsFor(d);
  while (R.total < n && d > H * 0.012) {
    d *= 0.95;
    R = ringsFor(d);
  }

  const slots: Slot[] = [];
  const rings: Ring[] = [];
  let left = n;
  for (const rg of R.rings) {
    const used = left > 0 && rg.valid.length > 0;
    rings.push({ cx, cy: R.ccy, r: rg.r, used: used && n > 0 });
    if (!used) continue;
    const take = Math.min(left, rg.valid.length);
    slots.push(...rg.valid.slice(0, take));
    left -= take;
  }

  return {
    map: { x: mx, y: my, w: mapW, h: mapH, scale },
    d,
    label: R.label,
    showNames: R.label > 0,
    rings,
    slots,
  };
}

/**
 * Gravity landing: the angle a new circle first lands at, higher up its ring than its slot,
 * from which it slides down to the slot.
 */
export function landingAngle(slot: Slot, d: number, H: number, rand: () => number = Math.random): number {
  let off = slot.ang - Math.PI / 2;
  off = Math.atan2(Math.sin(off), Math.cos(off));
  const dir = off === 0 ? (rand() < 0.5 ? -1 : 1) : Math.sign(off);
  let sa = slot.ang + dir * (0.7 + rand() * 0.8);
  const lim = Math.PI / 2 + dir * Math.PI * 0.98;
  if (dir > 0 ? sa > lim : sa < lim) sa = lim;
  // never land behind the title
  while (slot.cy + slot.r * Math.sin(sa) - d / 2 < H * 0.19 && Math.abs(sa - slot.ang) > 0.15) sa -= dir * 0.05;
  return sa;
}

/** Falling-object easing: accelerates, then a small damped bounce at the end. */
export function gravityEase(u: number): number {
  if (u >= 1) return 1;
  if (u < 0.72) return Math.pow(u / 0.72, 2);
  const v = (u - 0.72) / 0.28;
  return 1 + Math.sin(v * Math.PI * 2) * 0.035 * (1 - v);
}

/** Spotlight time shortens from 1.6s to 0.45s as the queue grows. */
export function holdTime(queued: number, base = 1600): number {
  return Math.max(450, base / (1 + queued * 0.6));
}

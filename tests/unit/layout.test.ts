import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { blockedBoxes, gravityEase, holdTime, layoutRings } from '../../src/screen/layout';

const geo = JSON.parse(readFileSync(new URL('../../public/geo/israel.json', import.meta.url), 'utf8'));
const base = { geoW: geo.W, geoH: geo.H, dots: geo.dots as [number, number][] };

describe.each([
  [1920, 1080],
  [3840, 2160],
  [1280, 720],
  [1024, 512], // the hall projector: 2:1, low resolution
])('layoutRings at %dx%d', (W, H) => {
  it.each([0, 1, 5, 12, 30, 45, 60, 80, 100, 120, 150])('places %d ambassadors', (n) => {
    const L = layoutRings({ n, W, H, ...base });
    expect(L.slots).toHaveLength(n);
    const d = L.d;
    const boxes = blockedBoxes(W, H);
    for (const s of L.slots) {
      // inside the screen, names included
      expect(s.x - d / 2).toBeGreaterThanOrEqual(0);
      expect(s.x + d / 2).toBeLessThanOrEqual(W);
      expect(s.y - d / 2).toBeGreaterThanOrEqual(0);
      expect(s.y + d / 2 + L.label).toBeLessThanOrEqual(H);
      // off the title and the side lights
      for (const b of boxes) {
        const hit = s.x + d / 2 > b[0] && s.x - d / 2 < b[2] && s.y - d / 2 < b[3] && s.y + d / 2 > b[1];
        expect(hit).toBe(false);
      }
    }
    // no two circles overlap
    for (let i = 0; i < L.slots.length; i++)
      for (let j = i + 1; j < L.slots.length; j++)
        expect(Math.hypot(L.slots[i].x - L.slots[j].x, L.slots[i].y - L.slots[j].y)).toBeGreaterThanOrEqual(d * 0.999);
    // every used ring is fully on screen at the bottom and inside the lights
    for (const r of L.rings.filter((r) => r.used)) {
      expect(r.cy + r.r + d / 2 + L.label).toBeLessThanOrEqual(H);
      expect(r.cx - r.r - d / 2).toBeGreaterThanOrEqual(W * 0.185);
    }
  });

  it('circles stay readable', () => {
    // big screens keep names under 30 circles; any name shown is at least ~11px
    if (H >= 1080) expect(layoutRings({ n: 30, W, H, ...base }).showNames).toBe(true);
    for (const n of [5, 30, 80]) {
      const L = layoutRings({ n, W, H, ...base });
      if (L.showNames) expect(L.d * 0.16).toBeGreaterThanOrEqual(10.8);
    }
    expect(layoutRings({ n: 150, W, H, ...base }).d).toBeGreaterThan(H * 0.035);
  });
});

it('the map shrinks as the wall grows', () => {
  const h = (n: number) => layoutRings({ n, W: 1920, H: 1080, ...base }).map.h;
  expect(h(0)).toBeGreaterThan(h(30));
  expect(h(30)).toBeGreaterThan(h(60));
  expect(h(60)).toBeGreaterThan(h(150));
});

it('fills the bottom of the inner ring first (smile)', () => {
  const L = layoutRings({ n: 3, W: 1920, H: 1080, ...base });
  const ys = L.slots.map((s) => s.y);
  expect(Math.max(...ys)).toBe(ys[0]);
});

it('gravity easing and spotlight hold time', () => {
  expect(gravityEase(0)).toBe(0);
  expect(gravityEase(1)).toBe(1);
  expect(gravityEase(0.5)).toBeLessThan(0.5);
  expect(holdTime(0)).toBe(1600);
  expect(holdTime(20)).toBe(450);
});

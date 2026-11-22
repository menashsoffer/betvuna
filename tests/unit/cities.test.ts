import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { findCity, searchCities, type City } from '../../src/join/cities';

const all = JSON.parse(readFileSync('public/geo/cities.json', 'utf8')) as City[];

describe('cities', () => {
  it('has the main alumni towns with map coordinates', () => {
    for (const n of ['ירושלים', 'בני ברק', 'אלעד', 'ביתר עילית', 'מודיעין עילית', 'בית שמש', 'צפת', 'אפרת']) {
      const c = findCity(all, n);
      expect(c, n).toBeDefined();
      expect(c!.x, n).not.toBeNull();
    }
  });
  it('ranks the typed prefix first', () => {
    expect(searchCities(all, 'אלע')[0].n).toBe('אלעד');
    expect(searchCities(all, 'ביתר')[0].n).toBe('ביתר עילית');
    expect(searchCities(all, 'בני ב')[0].n).toBe('בני ברק');
  });
  it('matches ignoring dashes and spaces', () => {
    expect(findCity(all, 'תל אביב יפו')?.n).toBe('תל אביב-יפו');
  });
});

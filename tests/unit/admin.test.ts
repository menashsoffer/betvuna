import { describe, expect, it } from 'vitest';
import { cell, toCsv } from '../../src/admin/csv';
import { displayPhone, initials, search, stats, view, type Participant } from '../../src/admin/model';

const base: Participant = {
  id: '1', full_name: 'יוסף כהן', phone: '+972541234567', email: 'y@example.com', city: 'אלעד',
  photo_path: 'a.jpg', photo_hidden: false, wall_hidden: false, registered_by: null,
  joined_at: '2026-12-02T18:31:00Z', join_seq: 2, is_simulated: false, created_at: '2026-12-02T16:42:00Z',
};
const p = (o: Partial<Participant>): Participant => ({ ...base, ...o });

describe('csv', () => {
  it('starts with a BOM, uses CRLF and skips simulated', () => {
    const csv = toCsv([base, p({ id: '2', is_simulated: true, full_name: 'מדומה' })], 'all', (x) => (x ? `https://x/${x}` : null));
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split('\r\n');
    expect(lines).toHaveLength(3); // header, one row, trailing empty
    expect(lines[1]).toBe('2,יוסף כהן,054-123-4567,y@example.com,אלעד,https://x/a.jpg,02/12/2026 18:42,02/12/2026 20:31,');
    expect(csv).not.toContain('מדומה');
  });
  it('joined scope drops those who did not join', () => {
    const csv = toCsv([base, p({ id: '3', join_seq: null, joined_at: null, full_name: 'עוד לא' })], 'joined', () => null);
    expect(csv).not.toContain('עוד לא');
  });
  it('quotes and neutralises formulas', () => {
    expect(cell('a,b')).toBe('"a,b"');
    expect(cell('say "hi"')).toBe('"say ""hi"""');
    expect(cell('=1+1')).toBe("'=1+1");
    expect(cell(null)).toBe('');
  });
});

describe('model', () => {
  it('searches phone in any format', () => {
    expect(search(base, '054-123')).toBe(true);
    expect(search(base, '+972 54 1234')).toBe(true);
    expect(search(base, '4567')).toBe(true);
    expect(search(base, '0599')).toBe(false);
    expect(search(base, 'יוסף')).toBe(true);
  });
  it('counts stats', () => {
    const all = [base, p({ id: '2', join_seq: null, photo_path: null }), p({ id: '3', is_simulated: true, city: 'צפת', join_seq: 3 })];
    expect(stats(all)).toEqual({ registered: 2, joined: 1, onWall: 2, cities: 2, noPhoto: 1, hiddenPhotos: 0 });
  });
  it('filters and hides simulated by default', () => {
    const all = [base, p({ id: '2', join_seq: null }), p({ id: '3', is_simulated: true })];
    expect(view(all, { filter: 'waiting', q: '', showSimulated: false }).map((x) => x.id)).toEqual(['2']);
    expect(view(all, { filter: 'joined', q: '', showSimulated: true })).toHaveLength(2);
  });
  it('formats', () => {
    expect(displayPhone('+972541234567')).toBe('054-123-4567');
    expect(initials('יוסף בן דוד')).toBe('י״ד');
  });
});

describe('csv file name', () => {
  it('is ASCII and dated in Israel time', async () => {
    const { csvFileName } = await import('../../src/admin/csv');
    expect(csvFileName('joined', new Date('2026-12-02T18:31:00Z'))).toBe('ambassadors_2026-12-02_2031.csv');
  });
});

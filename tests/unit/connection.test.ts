import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WallEntry } from '../../src/shared/types';

// ---- fake Supabase: rpc answers from `server`, one broadcast channel we can drive by hand ----
const server = { epoch: 1, rows: [] as Omit<WallEntry, 'removed'>[], fail: false };
type Handler = (msg: { payload: unknown }) => void;
const channels: FakeChannel[] = [];
class FakeChannel {
  handlers = new Map<string, Handler>();
  status?: (s: string) => void;
  state = 'joining';
  tracked: unknown[] = [];
  constructor(public name: string, public opts: unknown) { channels.push(this); }
  on(_type: string, f: { event: string }, cb: Handler) { this.handlers.set(f.event, cb); return this; }
  subscribe(cb: (s: string) => void) { this.status = cb; return this; }
  track(p: unknown) { this.tracked.push(p); return Promise.resolve('ok'); }
  emit(event: string, payload: unknown) { this.handlers.get(event)?.({ payload }); }
  setStatus(s: string) { this.state = s === 'SUBSCRIBED' ? 'joined' : 'errored'; this.status?.(s); }
}
const fake = {
  rpc: vi.fn(async (fn: string, args?: { p_seq: number }) => {
    if (server.fail) return { data: null, error: new Error('offline') };
    if (fn === 'wall_state') return { data: { join_open: true, wall_epoch: server.epoch }, error: null };
    return { data: server.rows.filter((r) => r.join_seq > (args?.p_seq ?? 0)), error: null };
  }),
  channel: (name: string, opts: unknown) => new FakeChannel(name, opts),
  removeChannel: vi.fn(async () => 'ok'),
};
vi.mock('../../src/shared/supabase', () => ({
  supabase: () => fake,
  photoUrl: (p: string | null) => (p ? `https://cdn/${p}` : null),
}));

// ---- fake wall that records what it was asked to do ----
class FakeWall {
  shown = new Map<number, WallEntry>();
  log: string[] = [];
  has(seq: number) { return this.shown.has(seq); }
  entries() { return [...this.shown.values()]; }
  addInstant(e: WallEntry) { this.shown.set(e.join_seq, e); this.log.push(`instant ${e.join_seq}`); }
  enqueue(e: WallEntry) { this.shown.set(e.join_seq, e); this.log.push(`spot ${e.join_seq}`); }
  update(e: WallEntry) { this.shown.set(e.join_seq, e); this.log.push(`update ${e.join_seq}`); }
  remove(seq: number) { this.shown.delete(seq); this.log.push(`remove ${seq}`); }
  clear() { this.shown.clear(); this.log.push('clear'); }
}

const row = (join_seq: number, full_name = `אדם ${join_seq}`, photo: string | null = `photos/${join_seq}.jpg`) =>
  ({ join_seq, full_name, city: 'ירושלים', photo, joined_at: '2026-12-02T19:00:00Z', is_simulated: false });
const flush = () => new Promise((r) => setTimeout(r, 0));

(globalThis as { window?: EventTarget }).window ??= new EventTarget();
const { connectLive } = await import('../../src/screen/connection');

describe('connectLive', () => {
  let wall: FakeWall;
  let status: string[];
  let stop: () => void;
  const ch = () => channels[channels.length - 1];

  beforeEach(async () => {
    channels.length = 0;
    server.epoch = 1;
    server.fail = false;
    server.rows = [row(1), row(2, 'בלי תמונה', null)];
    wall = new FakeWall();
    status = [];
    stop?.();
    stop = connectLive(wall, (s) => status.push(s));
    await flush();
  });

  it('shows the existing wall at once, then goes online and announces itself to the admin', async () => {
    expect(wall.log).toEqual(['instant 1', 'instant 2']);
    expect(wall.shown.get(1)?.photo).toBe('https://cdn/photos/1.jpg');
    expect(wall.shown.get(2)?.photo).toBeNull();
    expect(ch().name).toBe('wall');
    expect(ch().opts).toEqual({ config: { presence: { key: 'screen' } } });
    ch().setStatus('SUBSCRIBED');
    await flush();
    expect(status.at(-1)).toBe('online');
    expect(ch().tracked[0]).toMatchObject({ role: 'screen' });
    expect(wall.log.filter((l) => l.startsWith('instant') || l.startsWith('spot'))).toHaveLength(2);
  });

  it('spotlights a new joiner and treats a repeat message as an update', async () => {
    ch().setStatus('SUBSCRIBED');
    await flush();
    wall.log = [];
    ch().emit('entry', row(3));
    ch().emit('entry', row(3, 'שם מתוקן'));
    expect(wall.log).toEqual(['spot 3', 'update 3']);
    expect(wall.shown.get(3)?.full_name).toBe('שם מתוקן');
  });

  it('fills a gap in join_seq from the server', async () => {
    ch().setStatus('SUBSCRIBED');
    await flush();
    server.rows.push(row(3), row(4), row(5));
    wall.log = [];
    ch().emit('entry', row(5));
    await flush();
    await flush();
    expect(wall.log).toContain('spot 5');
    expect(wall.log).toContain('spot 3');
    expect(wall.log).toContain('spot 4');
    expect([...wall.shown.keys()].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('removes a hidden ambassador', async () => {
    ch().emit('entry', { join_seq: 2, removed: true });
    expect(wall.shown.has(2)).toBe(false);
  });

  it('clears on reset', async () => {
    server.rows = [];
    server.epoch = 2;
    ch().emit('reset', { wall_epoch: 2 });
    await flush();
    expect(wall.log).toContain('clear');
    expect(wall.shown.size).toBe(0);
    ch().emit('entry', row(1, 'חדש אחרי איפוס'));
    expect(wall.shown.get(1)?.full_name).toBe('חדש אחרי איפוס');
  });

  it('after a disconnect, catches up: new joiners spotlighted, hidden ones removed, a missed reset honoured', async () => {
    ch().setStatus('SUBSCRIBED');
    await flush();
    ch().setStatus('CHANNEL_ERROR');
    expect(status.at(-1)).toBe('offline');
    server.rows = [row(1), row(3)];
    wall.log = [];
    ch().setStatus('SUBSCRIBED');
    await flush();
    expect([...wall.log].sort()).toEqual(['remove 2', 'spot 3', 'update 1']);
    expect([...wall.shown.keys()].sort()).toEqual([1, 3]);

    // the admin reset the wall while we were away
    ch().setStatus('CHANNEL_ERROR');
    server.epoch = 2;
    server.rows = [row(1, 'מישהו אחר')];
    wall.log = [];
    ch().setStatus('SUBSCRIBED');
    await flush();
    expect(wall.log[0]).toBe('clear');
    expect(wall.shown.get(1)?.full_name).toBe('מישהו אחר');
  });

  it('reports offline when the server cannot be reached', async () => {
    server.fail = true;
    ch().setStatus('SUBSCRIBED');
    await flush();
    expect(status.at(-1)).toBe('offline');
  });
});

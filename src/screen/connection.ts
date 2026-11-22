// Live feed for the hall screen: first load from wall_since(0), then the 'wall' broadcast channel.
// Self-healing: on every (re)subscribe, on a gap in join_seq, when the browser comes back online
// and once a minute, it reloads the whole wall from the server and reconciles.
import type { RealtimeChannel } from '@supabase/supabase-js';
import { SCREEN_PRESENCE_ROLE, WALL_CHANNEL } from '../shared/config';
import { photoUrl, supabase } from '../shared/supabase';
import type { WallEntry } from '../shared/types';
import type { Wall } from './wall';

/** The part of the wall this module drives (lets tests swap in a fake). */
export type WallLike = Pick<Wall, 'has' | 'entries' | 'addInstant' | 'enqueue' | 'update' | 'remove' | 'clear'>;

export type NetStatus = 'online' | 'connecting' | 'offline';

/** Presence shape agreed with the admin panel: it shows "screen connected" when role === 'screen'. */
const PRESENCE_KEY = SCREEN_PRESENCE_ROLE;

const RESYNC_EVERY = 60_000;
const WATCHDOG_EVERY = 15_000;

interface RowLike extends Omit<WallEntry, 'photo'> { photo: string | null }

const toEntry = (r: RowLike): WallEntry => ({
  join_seq: r.join_seq,
  full_name: r.full_name,
  city: r.city,
  photo: photoUrl(r.photo),
  joined_at: r.joined_at,
  is_simulated: r.is_simulated,
});

export function connectLive(wall: WallLike, onStatus: (s: NetStatus) => void): () => void {
  const sb = supabase();
  let ch: RealtimeChannel | null = null;
  let epoch: number | null = null;
  let loaded = false;
  let syncing: Promise<void> | null = null;
  let again = false;
  let joined = false;
  let lastOk = true;
  let strikes = 0;
  let stopped = false;

  const report = () => onStatus(!lastOk ? 'offline' : joined ? 'online' : loaded ? 'offline' : 'connecting');

  const highest = () => wall.entries().reduce((m, e) => Math.max(m, e.join_seq), 0);

  async function load(): Promise<void> {
    const [state, rows] = await Promise.all([sb.rpc('wall_state'), sb.rpc('wall_since', { p_seq: 0 })]);
    if (state.error || rows.error) throw state.error ?? rows.error;
    const ep = Number((state.data as { wall_epoch: number }).wall_epoch);
    if (epoch !== null && ep !== epoch) wall.clear();
    epoch = ep;
    const entries = ((rows.data ?? []) as RowLike[]).map(toEntry);
    const live = new Set(entries.map((e) => e.join_seq));
    for (const e of wall.entries()) if (!live.has(e.join_seq)) wall.remove(e.join_seq);
    for (const e of entries) {
      if (wall.has(e.join_seq)) wall.update(e);
      else if (!loaded) wall.addInstant(e); // the wall as it was before this screen opened
      else wall.enqueue(e); // joined while we were disconnected: show them properly
    }
    loaded = true;
  }

  /** Reload and reconcile; concurrent calls collapse into one extra run. */
  function resync(): Promise<void> {
    if (syncing) { again = true; return syncing; }
    syncing = load()
      .then(() => { lastOk = true; })
      .catch((err) => { lastOk = false; console.warn('[screen] resync failed', err); setTimeout(resync, 5000); })
      .finally(() => {
        syncing = null;
        report();
        if (again) { again = false; void resync(); }
      });
    return syncing;
  }

  function onEntry(payload: RowLike & { removed?: boolean }) {
    if (typeof payload?.join_seq !== 'number') return;
    if (payload.removed) { wall.remove(payload.join_seq); return; }
    const e = toEntry(payload);
    if (wall.has(e.join_seq)) { wall.update(e); return; }
    const gap = e.join_seq > highest() + 1;
    wall.enqueue(e);
    if (gap && loaded) void resync();
  }

  function onReset(payload: { wall_epoch?: number }) {
    wall.clear();
    if (typeof payload?.wall_epoch === 'number') epoch = payload.wall_epoch;
    void resync();
  }

  function open() {
    joined = false;
    report();
    const channel = sb.channel(WALL_CHANNEL, { config: { presence: { key: PRESENCE_KEY } } });
    ch = channel;
    channel
      .on('broadcast', { event: 'entry' }, ({ payload }) => onEntry(payload))
      .on('broadcast', { event: 'reset' }, ({ payload }) => onReset(payload))
      .subscribe((status) => {
        if (ch !== channel) return;
        if (status === 'SUBSCRIBED') {
          joined = true;
          strikes = 0;
          void channel.track({ role: PRESENCE_KEY, at: new Date().toISOString() });
          void resync();
        } else {
          joined = false;
        }
        report();
      });
  }

  // first paint as fast as possible, independent of the realtime handshake
  void resync();
  open();

  const resyncTimer = setInterval(() => { if (joined) void resync(); }, RESYNC_EVERY);
  // supabase-js rejoins on its own; if it is still not joined after two checks, start over
  const watchdog = setInterval(() => {
    if (stopped || !ch) return;
    if (ch.state === 'joined') { strikes = 0; return; }
    if (++strikes >= 2) {
      strikes = 0;
      const old = ch;
      ch = null;
      void sb.removeChannel(old).finally(open);
    }
  }, WATCHDOG_EVERY);
  const onOnline = () => void resync();
  const onOffline = () => { lastOk = false; report(); };
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

  return () => {
    stopped = true;
    clearInterval(resyncTimer);
    clearInterval(watchdog);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    if (ch) void sb.removeChannel(ch);
  };
}

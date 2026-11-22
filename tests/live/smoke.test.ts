// Read-only checks against the real Supabase project (writes nothing that stays).
// Run: npm run test:live
import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL || 'https://gapqvfjdymjfuzflicgk.supabase.co';
const key = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_eQol7Hwfv8wQ73t0YWFEog_C2U2S2kF';
const sb = createClient(url, key, { auth: { persistSession: false } });

describe('anon visitor', () => {
  it('cannot read participants, admin_emails, settings or wall_entries directly', async () => {
    for (const t of ['participants', 'admin_emails', 'settings', 'rate_events', 'wall_entries']) {
      const { data, error } = await sb.from(t).select('*').limit(1);
      expect(error, `${t} should be denied`).not.toBeNull();
      expect(data).toBeNull();
    }
  });

  it('can read the wall and its state', async () => {
    const wall = await sb.rpc('wall_since', { p_seq: 0 });
    expect(wall.error).toBeNull();
    expect(Array.isArray(wall.data)).toBe(true);
    for (const row of wall.data ?? []) {
      expect(Object.keys(row)).not.toContain('phone');
      expect(Object.keys(row)).not.toContain('email');
    }
    const state = await sb.rpc('wall_state');
    expect(state.error).toBeNull();
    expect(typeof state.data.join_open).toBe('boolean');
  });

  it('cannot run admin functions', async () => {
    for (const [fn, args] of [
      ['admin_reset_wall', {}],
      ['admin_simulate', { p_count: 1 }],
      ['admin_set_join_open', { p_open: false }],
      ['admin_join', { p_id: '00000000-0000-0000-0000-000000000000' }],
    ] as const) {
      const { error } = await sb.rpc(fn, args);
      expect(error, `${fn} should be denied`).not.toBeNull();
    }
  });

  it('register validates before writing', async () => {
    const bad = await sb.rpc('register', {
      p_name: 'בדיקה', p_phone: '12', p_email: 'a@b.co', p_city: 'ירושלים', p_consent: true,
    });
    expect(bad.error?.message).toContain('invalid_phone');
    const noConsent = await sb.rpc('register', {
      p_name: 'בדיקה', p_phone: '0599999999', p_email: 'a@b.co', p_city: 'ירושלים', p_consent: false,
    });
    expect(noConsent.error?.message).toContain('consent_required');
  });

  it('unknown tokens get nothing', async () => {
    const j = await sb.rpc('join_wall', { p_token: 'not-a-token' });
    expect(j.error?.message).toContain('unknown_token');
    const me = await sb.rpc('me', { p_tokens: ['not-a-token'] });
    expect(me.error).toBeNull();
    expect(me.data).toEqual([]);
    const r = await sb.rpc('recover', { p_phone: '0599999999' });
    expect(r.error).toBeNull();
    expect(r.data).toBeNull();
  });

  it('storage accepts only uuid.jpg names', async () => {
    const { error } = await sb.storage.from('photos').upload('hack.png', new Blob(['x'], { type: 'image/png' }));
    expect(error).not.toBeNull();
  });

  it('wall channel subscribes', async () => {
    const status = await new Promise<string>((resolve) => {
      const ch = sb.channel('wall').subscribe((s) => {
        if (s === 'SUBSCRIBED' || s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') { resolve(s); sb.removeChannel(ch); }
      });
    });
    expect(status).toBe('SUBSCRIBED');
  });
});

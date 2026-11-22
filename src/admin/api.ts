import type { RealtimeChannel, Session } from '@supabase/supabase-js';
import { PHOTO_BUCKET, SCREEN_PRESENCE_ROLE, WALL_CHANNEL } from '../shared/config';
import { photoUrl, supabase } from '../shared/supabase';
import { PARTICIPANT_COLUMNS, type Participant } from './model';

const sb = supabase;

export const photoPublicUrl = (path: string | null) => photoUrl(path);

export function onAuth(cb: (s: Session | null) => void) {
  sb().auth.onAuthStateChange((_e, s) => cb(s));
}

export async function sendMagicLink(email: string): Promise<void> {
  const redirect = location.origin + location.pathname;
  const { error } = await sb().auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } });
  if (error) throw error;
}

/** Redirects to Google; Supabase brings the browser back here with a session. */
export async function signInWithGoogle(): Promise<void> {
  const redirect = location.origin + location.pathname;
  const { error } = await sb().auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: redirect, queryParams: { prompt: 'select_account' } },
  });
  if (error) throw error;
}

export async function signOut() { await sb().auth.signOut(); }

export async function isAdmin(): Promise<boolean> {
  const { data, error } = await sb().rpc('is_admin');
  if (error) throw error;
  return Boolean(data);
}

export async function loadParticipants(): Promise<Participant[]> {
  const { data, error } = await sb().from('participants').select(PARTICIPANT_COLUMNS).limit(2000);
  if (error) throw error;
  return (data ?? []) as Participant[];
}

export async function loadSettings(): Promise<{ join_open: boolean; wall_epoch: number }> {
  const { data, error } = await sb().rpc('wall_state');
  if (error) throw error;
  return data as { join_open: boolean; wall_epoch: number };
}

export async function updateParticipant(id: string, patch: Partial<Participant>): Promise<void> {
  const { error } = await sb().from('participants').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

/** Deletes the participant row, then their photo. The row goes first so a failure never leaves a profile without its photo. */
export async function deleteParticipant(id: string, photoPath: string | null): Promise<void> {
  const { error } = await sb().from('participants').delete().eq('id', id);
  if (error) throw error;
  if (photoPath) await sb().storage.from(PHOTO_BUCKET).remove([photoPath]);
}

export async function uploadPhoto(jpeg: Blob): Promise<string> {
  const path = `${crypto.randomUUID()}.jpg`;
  const { error } = await sb().storage.from(PHOTO_BUCKET).upload(path, jpeg, { contentType: 'image/jpeg', upsert: false });
  if (error) throw error;
  return path;
}

export async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb().rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export async function registerManual(input: { name: string; phone: string; email: string; city: string; photoPath: string | null }) {
  return rpc<{ id: string; token: string }>('register', {
    p_name: input.name, p_phone: input.phone, p_email: input.email, p_city: input.city,
    p_consent: true, p_photo_path: input.photoPath, p_registered_by_token: null,
  });
}

/** Listens to the wall channel: any broadcast means data changed; presence tells if the hall screen is connected. */
export function watchWall(onChange: () => void, onScreen: (connected: boolean) => void, onLink: (ok: boolean) => void): RealtimeChannel {
  const ch = sb().channel(WALL_CHANNEL, { config: { presence: { key: 'admin' } } });
  const presence = () => {
    const state = ch.presenceState<{ role?: string }>();
    onScreen(Object.values(state).some((list) => list.some((m) => m.role === SCREEN_PRESENCE_ROLE)));
  };
  ch.on('broadcast', { event: 'entry' }, onChange)
    .on('broadcast', { event: 'reset' }, onChange)
    .on('broadcast', { event: 'settings' }, onChange)
    .on('presence', { event: 'sync' }, presence)
    .on('presence', { event: 'join' }, presence)
    .on('presence', { event: 'leave' }, presence)
    .subscribe((status) => {
      onLink(status === 'SUBSCRIBED');
      if (status !== 'SUBSCRIBED') onScreen(false);
    });
  return ch;
}

export const ERRORS: Record<string, string> = {
  invalid_phone: 'מספר טלפון לא תקין',
  rate_limited: 'יותר מדי ניסיונות, נסו שוב בעוד דקה',
  participants_phone_key: 'כבר יש משתתף עם מספר הטלפון הזה',
  not_admin: 'אין הרשאה',
  join_closed: 'ההצטרפות נעולה',
  image_too_large: 'התמונה גדולה מדי',
};

export function errText(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e);
  const k = Object.keys(ERRORS).find((key) => msg.includes(key));
  if (k) return ERRORS[k];
  if (/check constraint/.test(msg)) return 'אחד השדות לא תקין';
  if (/fetch|network/i.test(msg)) return 'אין חיבור לשרת';
  return msg;
}

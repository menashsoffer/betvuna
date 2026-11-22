import { PHOTO_BUCKET, WALL_CHANNEL } from '../shared/config';
import { photoUrl, supabase } from '../shared/supabase';

export interface Me {
  id: string;
  full_name: string;
  city: string;
  photo: string | null;
  joined: boolean;
  join_seq: number | null;
}

export class ApiError extends Error {}

const KNOWN = ['invalid_phone', 'consent_required', 'rate_limited', 'join_closed', 'unknown_token', 'image_too_large'];

function fail(error: { message?: string } | null): never {
  const code = KNOWN.find((k) => error?.message?.includes(k)) ?? 'network';
  throw new ApiError(code);
}

export async function uploadPhoto(jpeg: Blob): Promise<string> {
  const path = `${crypto.randomUUID()}.jpg`;
  const { error } = await supabase().storage.from(PHOTO_BUCKET).upload(path, jpeg, {
    contentType: 'image/jpeg', upsert: false,
  });
  if (error) fail(error);
  return path;
}

export async function register(input: {
  name: string; phone: string; email: string; city: string; photoPath?: string | null; registeredByToken?: string | null;
}): Promise<{ id: string; token: string }> {
  const { data, error } = await supabase().rpc('register', {
    p_name: input.name, p_phone: input.phone, p_email: input.email, p_city: input.city,
    // Consent is asked verbally at the event (decided 22.11); the server still records the time.
    p_consent: true,
    p_photo_path: input.photoPath ?? null, p_registered_by_token: input.registeredByToken ?? null,
  });
  if (error || !data) fail(error);
  return data as { id: string; token: string };
}

export async function setPhoto(token: string, path: string): Promise<void> {
  const { error } = await supabase().rpc('set_photo', { p_token: token, p_photo_path: path });
  if (error) fail(error);
}

export async function joinWall(token: string): Promise<number> {
  const { data, error } = await supabase().rpc('join_wall', { p_token: token });
  if (error) fail(error);
  return data as number;
}

export async function recover(phone: string): Promise<{ id: string; token: string } | null> {
  const { data, error } = await supabase().rpc('recover', { p_phone: phone });
  if (error) fail(error);
  return (data as { id: string; token: string } | null) ?? null;
}

export async function me(tokens: string[]): Promise<Me[]> {
  if (!tokens.length) return [];
  const { data, error } = await supabase().rpc('me', { p_tokens: tokens });
  if (error) fail(error);
  return ((data ?? []) as Me[]).map((m) => ({ ...m, photo: photoUrl(m.photo) }));
}

export async function joinOpen(): Promise<boolean> {
  const { data, error } = await supabase().rpc('wall_state');
  if (error) return true; // do not block the button on a read error; join_wall enforces it anyway
  return Boolean((data as { join_open: boolean }).join_open);
}

/** Calls back when the admin opens or locks the join button. */
export function onSettings(cb: (joinOpen: boolean) => void): () => void {
  const ch = supabase().channel(WALL_CHANNEL)
    .on('broadcast', { event: 'settings' }, ({ payload }) => cb(Boolean(payload?.join_open)))
    .subscribe();
  return () => { supabase().removeChannel(ch); };
}

export const MESSAGES: Record<string, string> = {
  invalid_phone: 'מספר הטלפון לא נראה תקין. צריך מספר נייד ישראלי, למשל 050-1234567.',
  consent_required: 'צריך לסמן את תיבת ההסכמה כדי להמשיך.',
  rate_limited: 'יותר מדי ניסיונות בדקה האחרונה. נסה שוב בעוד דקה.',
  join_closed: 'הפרטים נקלטו! המתן לאות מהבמה לאישור ההצטרפות לנבחרת השגרירים.',
  unknown_token: 'לא מצאנו את ההרשמה בטלפון הזה. נסה "כבר נרשמתי".',
  image_too_large: 'התמונה גדולה מדי. נסה לצלם שוב.',
  network: 'אין חיבור כרגע. בדוק את האינטרנט ונסה שוב.',
};

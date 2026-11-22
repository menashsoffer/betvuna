import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, PHOTO_BUCKET } from './config';

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  client ??= createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return client;
}

/** wall_entries.photo is "photos/<uuid>.jpg"; turn it into a public URL. */
export function photoUrl(photo: string | null): string | null {
  if (!photo) return null;
  const path = photo.replace(new RegExp(`^${PHOTO_BUCKET}/`), '');
  return `${SUPABASE_URL}/storage/v1/object/public/${PHOTO_BUCKET}/${path}`;
}

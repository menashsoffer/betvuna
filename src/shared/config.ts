// Public values: the publishable key is meant for the browser. Access is enforced by RLS and
// security-definer functions in the database. Never put a secret / service_role key here.
export const SUPABASE_URL: string =
  import.meta.env.VITE_SUPABASE_URL || 'https://gapqvfjdymjfuzflicgk.supabase.co';
export const SUPABASE_ANON_KEY: string =
  import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_eQol7Hwfv8wQ73t0YWFEog_C2U2S2kF';
export const PHOTO_BUCKET = 'photos';
export const WALL_CHANNEL = 'wall';

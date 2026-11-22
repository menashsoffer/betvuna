/** A row of public.participants as the admin sees it (token_hash is never selected). */
export interface Participant {
  id: string;
  full_name: string;
  phone: string;
  email: string;
  city: string;
  photo_path: string | null;
  photo_hidden: boolean;
  wall_hidden: boolean;
  registered_by: string | null;
  joined_at: string | null;
  join_seq: number | null;
  is_simulated: boolean;
  created_at: string;
}

export const PARTICIPANT_COLUMNS =
  'id,full_name,phone,email,city,photo_path,photo_hidden,wall_hidden,registered_by,joined_at,join_seq,is_simulated,created_at';

export type Filter = 'all' | 'joined' | 'waiting' | 'nophoto' | 'hidden';

export const FILTER_LABELS: Record<Filter, string> = {
  all: 'הכל', joined: 'הצטרפו', waiting: 'עוד לא', nophoto: 'בלי תמונה', hidden: 'מוסתרים',
};

export const isJoined = (p: Participant) => p.join_seq !== null;
export const onWall = (p: Participant) => isJoined(p) && !p.wall_hidden;

export function matches(p: Participant, f: Filter): boolean {
  switch (f) {
    case 'all': return true;
    case 'joined': return isJoined(p);
    case 'waiting': return !isJoined(p);
    case 'nophoto': return !p.photo_path;
    case 'hidden': return p.photo_hidden || p.wall_hidden;
  }
}

/** Search by name, city, email or phone (any digits format: 054-123, 54123, +97254…). */
export function search(p: Participant, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  if (p.full_name.toLowerCase().includes(s) || p.city.includes(s) || p.email.includes(s)) return true;
  let digits = s.replace(/\D/g, '');
  if (digits.length < 3) return false;
  if (digits.startsWith('972')) digits = digits.slice(3);
  if (digits.startsWith('0')) digits = digits.slice(1);
  return p.phone.slice(4).includes(digits);
}

export function view(all: Participant[], opts: { filter: Filter; q: string; showSimulated: boolean }): Participant[] {
  return all
    .filter((p) => (opts.showSimulated || !p.is_simulated) && matches(p, opts.filter) && search(p, opts.q))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export interface Stats { registered: number; joined: number; onWall: number; cities: number; noPhoto: number; hiddenPhotos: number }

export function stats(all: Participant[]): Stats {
  const real = all.filter((p) => !p.is_simulated);
  const wall = all.filter(onWall);
  return {
    registered: real.length,
    joined: real.filter(isJoined).length,
    onWall: wall.length,
    cities: new Set(wall.map((p) => p.city)).size,
    noPhoto: real.filter((p) => !p.photo_path).length,
    hiddenPhotos: real.filter((p) => p.photo_hidden).length,
  };
}

/** +972541234567 → 054-123-4567 */
export function displayPhone(e164: string): string {
  const m = /^\+972(5\d)(\d{3})(\d{4})$/.exec(e164);
  return m ? `0${m[1]}-${m[2]}-${m[3]}` : e164;
}

const TZ = 'Asia/Jerusalem';
export function fmtTime(iso: string | null): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('he-IL', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}
export function fmtDateTime(iso: string | null): string {
  if (!iso) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${g('day')}/${g('month')}/${g('year')} ${g('hour')}:${g('minute')}`;
}

export function initials(name: string): string {
  const w = name.trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '';
  return w.length === 1 ? w[0][0] : `${w[0][0]}״${w[w.length - 1][0]}`;
}

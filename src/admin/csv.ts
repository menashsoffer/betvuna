import { displayPhone, fmtDateTime, isJoined, type Participant } from './model';

const HEADERS = ['מספר שגריר', 'שם', 'טלפון', 'דוא"ל', 'יישוב', 'קישור לתמונה', 'שעת הרשמה', 'שעת הצטרפות', 'הוסתר מהמסך'];

/** Quote a cell for Excel, and neutralise formula injection (=, +, -, @ at the start). */
export function cell(v: string | number | null | undefined): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV that opens correctly in Hebrew Excel: UTF-8 with BOM, CRLF line ends.
 * Simulated ambassadors are never exported. `scope: 'joined'` keeps only those who joined.
 */
export function toCsv(all: Participant[], scope: 'joined' | 'all', photoUrl: (path: string | null) => string | null): string {
  const rows = all
    .filter((p) => !p.is_simulated && (scope === 'all' || isJoined(p)))
    .sort((a, b) => (a.join_seq ?? 1e9) - (b.join_seq ?? 1e9) || a.created_at.localeCompare(b.created_at))
    .map((p) => [
      p.join_seq ?? '', p.full_name, displayPhone(p.phone), p.email, p.city,
      photoUrl(p.photo_path) ?? '', fmtDateTime(p.created_at), fmtDateTime(p.joined_at), p.wall_hidden ? 'כן' : '',
    ].map(cell).join(','));
  return '﻿' + [HEADERS.map(cell).join(','), ...rows].join('\r\n') + '\r\n';
}

export function csvFileName(scope: 'joined' | 'all', now = new Date()): string {
  const [date, time] = fmtDateTime(now.toISOString()).split(' ');
  const [dd, mm, yyyy] = date.split('/');
  return `${scope === 'joined' ? 'ambassadors' : 'all-registrants'}_${yyyy}-${mm}-${dd}_${time.replace(':', '')}.csv`;
}

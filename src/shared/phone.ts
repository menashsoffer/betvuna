/** Normalize an Israeli mobile number to +9725XXXXXXXX, or return null. Mirrors public.normalize_phone. */
export function normalizePhone(input: string): string | null {
  let d = input.replace(/\D/g, '');
  if (d.startsWith('972')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  return /^5\d{8}$/.test(d) ? `+972${d}` : null;
}

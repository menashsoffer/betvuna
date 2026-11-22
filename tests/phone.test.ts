import { describe, expect, it } from 'vitest';
import { normalizePhone } from '../src/shared/phone';

describe('normalizePhone', () => {
  it.each([
    ['054-1234567', '+972541234567'],
    ['0541234567', '+972541234567'],
    ['+972 54 123 4567', '+972541234567'],
    ['972541234567', '+972541234567'],
  ])('%s', (input, out) => expect(normalizePhone(input)).toBe(out));

  it.each(['02-1234567', '12', '05412345678', ''])('rejects %s', (input) =>
    expect(normalizePhone(input)).toBeNull());
});

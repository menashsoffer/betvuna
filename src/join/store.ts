import type { StoredPerson } from '../shared/types';

const KEY = 'betvuna.people.v1';
let memory: StoredPerson[] = [];

/** People registered from this phone. Falls back to memory when storage is blocked (private mode). */
export function loadPeople(): StoredPerson[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) memory = JSON.parse(raw) as StoredPerson[];
  } catch { /* keep memory */ }
  return memory.filter((p) => p && typeof p.id === 'string' && typeof p.token === 'string');
}

export function savePerson(p: StoredPerson): void {
  memory = [...loadPeople().filter((x) => x.id !== p.id), p];
  try { localStorage.setItem(KEY, JSON.stringify(memory)); } catch { /* memory only */ }
}

/** Keeps only the people whose ids are listed (the rest were deleted by the admin). */
export function keepPeople(ids: Set<string>): void {
  memory = loadPeople().filter((p) => ids.has(p.id));
  try { localStorage.setItem(KEY, JSON.stringify(memory)); } catch { /* memory only */ }
}

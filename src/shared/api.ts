import {
  type Firestore, doc, getDoc, runTransaction, serverTimestamp, setDoc, updateDoc, writeBatch, arrayUnion,
} from 'firebase/firestore';
import { normalizePhone } from './phone';

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Record id: derived from phone + email, so knowing both lets you recover on another phone. */
export async function personId(phone: string, email: string): Promise<string> {
  return sha256Hex(`betvuna|${phone}|${email.trim().toLowerCase()}`);
}

export interface RegisterInput {
  fullName: string;
  phone: string;
  email: string;
  city: string;
  photoId: string | null;
  registeredBy?: string | null;
}

export type RegisterResult = { status: 'created'; pid: string } | { status: 'exists' };

export async function register(db: Firestore, uid: string, input: RegisterInput): Promise<RegisterResult> {
  const phone = normalizePhone(input.phone);
  if (!phone) throw new Error('invalid_phone');
  const email = input.email.trim().toLowerCase();
  const pid = await personId(phone, email);
  const phoneHash = await sha256Hex(phone);
  const batch = writeBatch(db);
  batch.set(doc(db, 'people', pid), {
    full_name: input.fullName.trim(),
    phone,
    phone_hash: phoneHash,
    email,
    city: input.city.trim(),
    photo_id: input.photoId,
    consent_at: serverTimestamp(),
    created_at: serverTimestamp(),
    owners: [uid],
    registered_by: input.registeredBy ?? null,
    join_seq: null,
  });
  batch.set(doc(db, 'phones', phoneHash), { pid });
  try {
    await batch.commit();
    return { status: 'created', pid };
  } catch (e) {
    if (isPermissionDenied(e)) return { status: 'exists' }; // phone already registered
    throw e;
  }
}

/** "Already registered" from another phone: phone + email identify the record. */
export async function recover(db: Firestore, uid: string, phoneInput: string, email: string): Promise<string | null> {
  const phone = normalizePhone(phoneInput);
  if (!phone) throw new Error('invalid_phone');
  const pid = await personId(phone, email);
  try {
    await updateDoc(doc(db, 'people', pid), { owners: arrayUnion(uid) });
    return pid;
  } catch (e) {
    if (isPermissionDenied(e) || isNotFound(e)) return null;
    throw e;
  }
}

export async function uploadPhoto(db: Firestore, uid: string, jpegDataUrl: string): Promise<string> {
  const photoId = crypto.randomUUID();
  await setDoc(doc(db, 'photos', photoId), { data: jpegDataUrl, uid, created_at: serverTimestamp() });
  return photoId;
}

export type JoinResult = { status: 'joined'; seq: number } | { status: 'already'; seq: number } | { status: 'closed' };

/** Replace the photo of a record this phone owns. */
export async function setPhoto(db: Firestore, uid: string, pid: string, jpegDataUrl: string): Promise<string> {
  const photoId = await uploadPhoto(db, uid, jpegDataUrl);
  await updateDoc(doc(db, 'people', pid), { photo_id: photoId });
  return photoId;
}

/** Join the wall: counter, person and wall row change together in one transaction. Idempotent. */
export async function joinWall(db: Firestore, pid: string): Promise<JoinResult> {
  const settings = await getDoc(doc(db, 'meta', 'settings'));
  if (settings.data()?.join_open !== true) return { status: 'closed' };
  return runTransaction(db, async (tx) => {
    const personRef = doc(db, 'people', pid);
    const counterRef = doc(db, 'meta', 'counter');
    const [person, counter] = [await tx.get(personRef), await tx.get(counterRef)];
    const p = person.data();
    if (!p) throw new Error('unknown_person');
    if (typeof p.join_seq === 'number') return { status: 'already', seq: p.join_seq } as const;
    const seq = counter.data()?.next as number;
    tx.update(counterRef, { next: seq + 1 });
    tx.update(personRef, { join_seq: seq });
    tx.set(doc(db, 'wall', String(seq)), {
      seq, pid, full_name: p.full_name, city: p.city, photo_id: p.photo_id ?? null,
      joined_at: serverTimestamp(), is_simulated: false, hidden: false,
    });
    return { status: 'joined', seq } as const;
  });
}

function code(e: unknown): string { return (e as { code?: string })?.code ?? ''; }
function isPermissionDenied(e: unknown) { return code(e) === 'permission-denied'; }
function isNotFound(e: unknown) { return code(e) === 'not-found'; }

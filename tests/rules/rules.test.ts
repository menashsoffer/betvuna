// Runs against the Firestore emulator: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run test:rules
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { type Firestore, collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { joinWall, recover, register, uploadPhoto } from '../../src/shared/api';

let env: RulesTestEnvironment;
const person = { fullName: 'משה כהן', phone: '054-1234567', email: 'Moshe@Example.com', city: 'ירושלים', photoId: null };

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-betvuna',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(() => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = asDb(ctx.firestore());
    await setDoc(doc(db, 'meta', 'settings'), { join_open: true, wall_epoch: 1 });
    await setDoc(doc(db, 'meta', 'counter'), { next: 1 });
    await setDoc(doc(db, 'admins', 'admin@example.com'), {});
  });
});

// rules-unit-testing returns the compat type; the modular API accepts it at runtime.
const asDb = (f: unknown) => f as Firestore;
const phone = (uid: string) => asDb(env.authenticatedContext(uid).firestore());
const admin = () => asDb(env.authenticatedContext('adm', { email: 'Admin@example.com', email_verified: true }).firestore());
const anon = () => asDb(env.unauthenticatedContext().firestore());

describe('register', () => {
  it('creates a record owned by this phone', async () => {
    const r = await register(phone('a'), 'a', person);
    expect(r.status).toBe('created');
  });
  it('rejects a second registration of the same phone', async () => {
    await register(phone('a'), 'a', person);
    expect((await register(phone('b'), 'b', { ...person, email: 'other@example.com' })).status).toBe('exists');
  });
  it('requires sign-in', async () => {
    expect((await register(anon(), 'x', person)).status).toBe('exists'); // denied
  });
  it('rejects bad fields and forged owners', async () => {
    await expect(register(phone('a'), 'a', { ...person, fullName: 'x' })).resolves.toEqual({ status: 'exists' });
    await expect(register(phone('a'), 'someone-else', person)).resolves.toEqual({ status: 'exists' });
  });
});

describe('privacy', () => {
  it('others cannot read or list people, phones', async () => {
    const r = await register(phone('a'), 'a', person);
    if (r.status !== 'created') throw new Error();
    await assertSucceeds(getDoc(doc(phone('a'), 'people', r.pid)));
    await assertFails(getDoc(doc(phone('b'), 'people', r.pid)));
    await assertFails(getDocs(collection(phone('b'), 'people')));
    await assertFails(getDocs(collection(anon(), 'phones')));
    await assertSucceeds(getDocs(collection(admin(), 'people')));
  });
});

describe('join', () => {
  it('joins once, idempotent, wall row is public', async () => {
    const r = await register(phone('a'), 'a', person);
    if (r.status !== 'created') throw new Error();
    expect(await joinWall(phone('a'), r.pid)).toEqual({ status: 'joined', seq: 1 });
    expect(await joinWall(phone('a'), r.pid)).toEqual({ status: 'already', seq: 1 });
    const wall = await getDocs(collection(anon(), 'wall'));
    expect(wall.size).toBe(1);
    expect(wall.docs[0].data().full_name).toBe('משה כהן');
    expect(Object.keys(wall.docs[0].data())).not.toContain('phone');
  });
  it('assigns consecutive numbers', async () => {
    const a = await register(phone('a'), 'a', person);
    const b = await register(phone('b'), 'b', { ...person, phone: '0521111111' });
    if (a.status !== 'created' || b.status !== 'created') throw new Error();
    await joinWall(phone('a'), a.pid);
    expect(await joinWall(phone('b'), b.pid)).toEqual({ status: 'joined', seq: 2 });
  });
  it('another phone cannot join for you', async () => {
    const r = await register(phone('a'), 'a', person);
    if (r.status !== 'created') throw new Error();
    await expect(joinWall(phone('b'), r.pid)).rejects.toThrow();
  });
  it('closed button', async () => {
    const r = await register(phone('a'), 'a', person);
    if (r.status !== 'created') throw new Error();
    await assertSucceeds(updateDoc(doc(admin(), 'meta', 'settings'), { join_open: false }));
    expect(await joinWall(phone('a'), r.pid)).toEqual({ status: 'closed' });
  });
  it('cannot write the wall or the counter directly', async () => {
    await assertFails(setDoc(doc(phone('a'), 'wall', '1'), {
      seq: 1, pid: 'x', full_name: 'זר', city: 'צפת', photo_id: null, joined_at: new Date(), is_simulated: false, hidden: false,
    }));
    await assertFails(updateDoc(doc(phone('a'), 'meta', 'counter'), { next: 2 }));
    await assertFails(updateDoc(doc(phone('a'), 'meta', 'settings'), { join_open: false }));
  });
});

describe('recover', () => {
  it('phone + email adds the new phone as owner', async () => {
    await register(phone('a'), 'a', person);
    const pid = await recover(phone('b'), 'b', '0541234567', 'moshe@example.com');
    expect(pid).toBeTruthy();
    expect(await joinWall(phone('b'), pid!)).toMatchObject({ status: 'joined' });
  });
  it('wrong email gets nothing', async () => {
    await register(phone('a'), 'a', person);
    expect(await recover(phone('b'), 'b', '0541234567', 'wrong@example.com')).toBeNull();
  });
});

describe('photos', () => {
  it('upload, public get by id, no listing, no overwrite', async () => {
    const id = await uploadPhoto(phone('a'), 'a', 'data:image/jpeg;base64,AAAA');
    await assertSucceeds(getDoc(doc(anon(), 'photos', id)));
    await assertFails(getDocs(collection(anon(), 'photos')));
    await assertFails(setDoc(doc(phone('b'), 'photos', id), { data: 'data:image/jpeg;base64,BB', uid: 'b', created_at: new Date() }));
    await assertFails(deleteDoc(doc(phone('a'), 'photos', id)));
  });
  it('rejects non-jpeg and oversized', async () => {
    await expect(uploadPhoto(phone('a'), 'a', 'data:image/png;base64,AAAA')).rejects.toThrow();
    await expect(uploadPhoto(phone('a'), 'a', 'data:image/jpeg;base64,' + 'A'.repeat(430000))).rejects.toThrow();
  });
});

describe('admin', () => {
  it('admin can hide a wall entry, unverified email cannot', async () => {
    const r = await register(phone('a'), 'a', person);
    if (r.status !== 'created') throw new Error();
    await joinWall(phone('a'), r.pid);
    await assertSucceeds(updateDoc(doc(admin(), 'wall', '1'), { hidden: true }));
    const fake = asDb(env.authenticatedContext('f', { email: 'admin@example.com', email_verified: false }).firestore());
    await assertFails(updateDoc(doc(fake, 'wall', '1'), { hidden: false }));
  });
});

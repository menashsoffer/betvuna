import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { FIREBASE_CONFIG, IS_CONFIGURED } from './config';

let app: FirebaseApp | null = null;

function ensureApp(): FirebaseApp {
  if (!IS_CONFIGURED) throw new Error('Firebase is not configured');
  app ??= initializeApp(FIREBASE_CONFIG);
  return app;
}

export const db = (): Firestore => getFirestore(ensureApp());
export const auth = (): Auth => getAuth(ensureApp());

/** Phones sign in anonymously; the uid owns the records registered from this phone. */
export async function phoneUid(): Promise<string> {
  const a = auth();
  if (a.currentUser) return a.currentUser.uid;
  return (await signInAnonymously(a)).user.uid;
}

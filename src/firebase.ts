import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, enableIndexedDbPersistence } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyBUuyPSwfCVm98ArAY1wCZioBXn2mqFCrs",
  authDomain: "zenith-fitness-18e2a.web.app",
  projectId: "zenith-fitness-18e2a",
  storageBucket: "zenith-fitness-18e2a.firebasestorage.app",
  messagingSenderId: "263741998199",
  appId: "1:263741998199:web:997b62caecb7d65e83f272",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Enable offline persistence for Firestore
enableIndexedDbPersistence(db).catch((err) => {
  if (err.code === 'failed-precondition') {
    console.warn('[Firebase] Persistence failed: multiple tabs open');
  } else if (err.code === 'unimplemented') {
    console.warn('[Firebase] Persistence not available in this browser');
  }
});

// Connect to emulators in development
if (import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://localhost:9099');
  connectFirestoreEmulator(db, 'localhost', 8080);
}

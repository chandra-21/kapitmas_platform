import { initializeApp } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword, signOut as firebaseSignOut } from 'firebase/auth'

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        'kapitmas-iot0.firebaseapp.com',
  projectId:         'kapitmas-iot0',
  storageBucket:     'kapitmas-iot0.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
}

const app  = initializeApp(firebaseConfig)
export const auth = getAuth(app)

export async function loginWithEmail(email: string, password: string): Promise<string> {
  const cred = await signInWithEmailAndPassword(auth, email, password)
  return cred.user.getIdToken()
}

export async function signOut(): Promise<void> {
  await firebaseSignOut(auth)
}

export function currentIdToken(): Promise<string | null> {
  // Fast path: Firebase already restored session (most API calls after first load)
  if (auth.currentUser) return auth.currentUser.getIdToken()

  // Slow path: wait for Firebase to restore session from storage on first load
  return new Promise(resolve => {
    const unsub = auth.onAuthStateChanged(user => {
      unsub()
      resolve(user ? user.getIdToken() : null)
    })
  })
}

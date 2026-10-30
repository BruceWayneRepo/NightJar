// Firebase settings for account sync.
// Paste the "firebaseConfig" object from Firebase console → Project settings → Your apps → Web app
// in place of null below. These values are public by design (they only identify the project);
// your data is protected by sign-in and the rules in firestore.rules.
// Leave it as null and Nightjar runs without accounts.
import type { FirebaseOptions } from "firebase/app";

const pasted: FirebaseOptions | null = {
  apiKey: "AIzaSyA89Ovi9vr58yIq-Nh2hkSTNAXFdhN_Fqw",
  authDomain: "nightjar-62ae3.firebaseapp.com",
  projectId: "nightjar-62ae3",
  storageBucket: "nightjar-62ae3.firebasestorage.app",
  messagingSenderId: "715702524187",
  appId: "1:715702524187:web:02cae591a9c1ae5d39dbbe",
};

// A build can also pass the settings as JSON in VITE_FIREBASE_CONFIG (used for local testing).
const fromEnv = import.meta.env.VITE_FIREBASE_CONFIG as string | undefined;

export const firebaseConfig: FirebaseOptions | null = fromEnv ? (JSON.parse(fromEnv) as FirebaseOptions) : pasted;

// Google sign-in key that Firebase made for this project (public). Used for the "stay connected to Drive" sign-in.
export const googleClientId = "715702524187-oq2mcemepdt8jegg8ev786qmd5qcr960.apps.googleusercontent.com";

// Local testing only: talk to the Firebase emulators on this computer.
export const useEmulators = import.meta.env.VITE_FIREBASE_EMULATORS === "1";

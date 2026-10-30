// Firebase settings for account sync.
// Paste the "firebaseConfig" object from Firebase console → Project settings → Your apps → Web app
// in place of null below. These values are public by design (they only identify the project);
// your data is protected by sign-in and the rules in firestore.rules.
// Leave it as null and Nightjar runs without accounts.
import type { FirebaseOptions } from "firebase/app";

const pasted: FirebaseOptions | null = null;

// A build can also pass the settings as JSON in VITE_FIREBASE_CONFIG (used for local testing).
const fromEnv = import.meta.env.VITE_FIREBASE_CONFIG as string | undefined;

export const firebaseConfig: FirebaseOptions | null = fromEnv ? (JSON.parse(fromEnv) as FirebaseOptions) : pasted;

// Local testing only: talk to the Firebase emulators on this computer.
export const useEmulators = import.meta.env.VITE_FIREBASE_EMULATORS === "1";

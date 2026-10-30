// What the Settings screen shows about your account. Kept free of Firebase so the app stays light;
// the Firebase part (sync.ts) loads in the background only when accounts are set up.
import { useSyncExternalStore } from "react";
import { firebaseConfig } from "@/firebase-config";

export type SyncStatus = "off" | "loading" | "signed-out" | "signing-in" | "syncing" | "synced" | "offline" | "error";

export type SyncState = {
  configured: boolean;
  status: SyncStatus;
  message: string | null;
  user: { name: string; email: string; photo: string | null } | null;
  /** Back up song files to Google Drive (saved in your account, applies to all devices). */
  backup: boolean;
  driveConnected: boolean;
  songsInAccount: number;
  songsBackedUp: number;
  /** Songs on this device waiting to go up to Drive. */
  songsWaiting: number;
  uploading: string | null;
};

let state: SyncState = {
  configured: Boolean(firebaseConfig),
  status: firebaseConfig ? "loading" : "off",
  message: null,
  user: null,
  backup: false,
  driveConnected: false,
  songsInAccount: 0,
  songsBackedUp: 0,
  songsWaiting: 0,
  uploading: null,
};

const listeners = new Set<() => void>();

export function setSync(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function getSync() {
  return state;
}

export function useSync() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

type SyncModule = typeof import("./sync");
let mod: SyncModule | null = null;

/** Load Firebase in the background (only if accounts are set up). */
export function startSyncIfConfigured() {
  if (!firebaseConfig) return;
  void import("./sync")
    .then((m) => {
      mod = m;
      m.start(firebaseConfig!);
    })
    .catch(() => setSync({ status: "error", message: "Couldn’t load account sync. Check your connection." }));
}

// These must run straight from a tap (Google's sign-in window is blocked otherwise), so the module is preloaded.
export const signIn = () => mod?.signIn();
export const signOutOfAccount = () => mod?.signOutOfAccount();
export const connectDrive = () => mod?.connectDrive();
export const setBackup = (on: boolean) => mod?.setBackup(on);
export const backupNow = () => mod?.backupNow();

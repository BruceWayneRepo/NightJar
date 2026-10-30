// Offline + install state for the UI: "update ready", "ready offline", and the Android install prompt.
import { useSyncExternalStore } from "react";
import { registerSW } from "virtual:pwa-register";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

type PwaState = {
  updateReady: boolean;
  offlineReady: boolean;
  canInstall: boolean;
  installed: boolean;
};

let state: PwaState = {
  updateReady: false,
  offlineReady: false,
  canInstall: false,
  installed: typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)").matches,
};
const listeners = new Set<() => void>();
const set = (patch: Partial<PwaState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

let installEvent: InstallEvent | null = null;
let updateSW: ((reload?: boolean) => Promise<void>) | null = null;

export function startPwa() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  // Only on a real host (https or localhost); the file:// copy and the chat preview skip it.
  if (!window.isSecureContext || location.protocol === "file:") return;
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh: () => set({ updateReady: true }),
    onOfflineReady: () => set({ offlineReady: true }),
  });
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installEvent = e as InstallEvent;
    set({ canInstall: true });
  });
  window.addEventListener("appinstalled", () => {
    installEvent = null;
    set({ canInstall: false, installed: true });
  });
}

export async function installApp() {
  if (!installEvent) return false;
  await installEvent.prompt();
  const { outcome } = await installEvent.userChoice;
  installEvent = null;
  set({ canInstall: false, installed: outcome === "accepted" || state.installed });
  return outcome === "accepted";
}

export function applyUpdate() {
  void updateSW?.(true);
}

export function dismissOfflineReady() {
  set({ offlineReady: false });
}

export function usePwa() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

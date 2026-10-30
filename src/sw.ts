/// <reference lib="webworker" />
// Nightjar offline helper (service worker).
// - Saves the app itself, the covers and the sample songs on the device on first visit.
// - Serves sample songs with seeking support (audio asks for byte ranges).
// - Keeps Google Fonts for offline use.
// Your imported songs live in IndexedDB, so they never needed the network.
import { cleanupOutdatedCaches, createHandlerBoundToURL, matchPrecache, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { CacheFirst, StaleWhileRevalidate } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { CacheableResponsePlugin } from "workbox-cacheable-response";
import { createPartialResponse } from "workbox-range-requests";

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

const AUDIO = /\.(wav|flac|mp3|m4a|ogg|opus|aiff?)$/i;

// 1. Sample songs: answer byte-range requests from the saved full file so seeking works offline.
//    Registered first so it wins over the plain precache route.
registerRoute(
  ({ url, request }) => url.origin === self.location.origin && AUDIO.test(url.pathname) && request.destination !== "document",
  async ({ request }) => {
    const full = await matchPrecache(request.url);
    if (!full) return fetch(request);
    return request.headers.has("range") ? createPartialResponse(request, full) : full;
  },
);

// 2. The app, covers and icons (list is filled in at build time).
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// 3. Any page load inside the app opens the saved app shell.
registerRoute(new NavigationRoute(createHandlerBoundToURL("index.html")));

// 4. Fonts.
registerRoute(
  ({ url }) => url.origin === "https://fonts.googleapis.com",
  new StaleWhileRevalidate({ cacheName: "nightjar-font-css" }),
);
registerRoute(
  ({ url }) => url.origin === "https://fonts.gstatic.com",
  new CacheFirst({
    cacheName: "nightjar-font-files",
    plugins: [new CacheableResponsePlugin({ statuses: [0, 200] }), new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 })],
  }),
);

// The page asks to switch to a new version only when you tap "Reload" (so music isn't cut off).
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
});

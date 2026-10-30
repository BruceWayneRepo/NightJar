import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// base "./" makes the build work from any folder or host (GitHub Pages, Vercel, a phone).
export default defineConfig({
  base: "./",
  plugins: [
    react(),
    // Offline support: builds src/sw.ts and fills in the list of files to save on the device.
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "prompt",
      injectRegister: false,
      manifest: false, // we ship public/manifest.webmanifest ourselves
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,png,jpg,webmanifest}"],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: { target: "es2020", assetsInlineLimit: 0 },
});

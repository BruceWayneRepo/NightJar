import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Shell } from "./components/nightjar/shell";
import { startPwa } from "./lib/nightjar/pwa";
import { startSyncIfConfigured } from "./lib/nightjar/sync-state";
import "./styles.css";

startPwa();
startSyncIfConfigured();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
);

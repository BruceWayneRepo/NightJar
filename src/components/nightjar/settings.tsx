import { useEffect, useState } from "react";
import { formatBytes } from "@/lib/nightjar/format";
import { requestPersistentStorage, storageUsage } from "@/lib/nightjar/idb";
import { installApp, usePwa } from "@/lib/nightjar/pwa";
import { setCrossfade, setEq, setVolume, useEngine, useStore } from "@/lib/nightjar/store";
import { PageHead } from "./parts";
import { AccountCard } from "./account";

const BAND_LABELS = ["80 Hz", "250 Hz", "1 kHz", "4 kHz", "10 kHz"];
const PRESETS: Record<string, number[]> = {
  Flat: [0, 0, 0, 0, 0],
  Warm: [3, 1.5, 0, -1, -2],
  "Late night": [2, 1, -1, -2, -4],
  Clarity: [-1, 0, 1, 2.5, 3],
  "Bass lift": [5, 2, 0, 0, 0],
};

export function SettingsView() {
  const crossfade = useStore((s) => s.crossfade);
  const eqOn = useStore((s) => s.eqOn);
  const eqGains = useStore((s) => s.eqGains);
  const volume = useStore((s) => s.volume);
  const tracks = useStore((s) => s.tracks);
  const snap = useEngine();
  const pwa = usePwa();
  const [usage, setUsage] = useState<{ usage: number; quota: number; free: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);

  useEffect(() => {
    void storageUsage().then(setUsage);
    void navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
  }, [tracks.length]);

  const local = tracks.filter((t) => t.storage === "local");
  const localBytes = local.reduce((s, t) => s + (t.bytes || 0), 0);
  const preset = Object.entries(PRESETS).find(([, g]) => g.every((v, i) => Math.abs(v - (eqGains[i] ?? 0)) < 0.01))?.[0];

  return (
    <div className="nj-page nj-settings">
      <PageHead eyebrow="Nightjar" title="Settings" />

      <AccountCard />

      <section className="nj-card">
        <h2 className="nj-h3">Playback</h2>
        <label className="nj-field">
          <span className="nj-field-label">
            Crossfade <b>{crossfade > 0 ? `${crossfade.toFixed(1)} s` : "Off"}</b>
          </span>
          <input type="range" className="nj-range" min={0} max={12} step={0.5} value={crossfade} style={{ ["--pct" as string]: `${(crossfade / 12) * 100}%` }} onChange={(e) => setCrossfade(Number(e.target.value))} />
          <span className="nj-muted nj-small">Overlaps the end of one track with the start of the next. Works with the screen off. Skipping by hand always uses a short fade.</span>
        </label>
        <label className="nj-field">
          <span className="nj-field-label">
            Volume <b>{Math.round(volume * 100)}%</b>
          </span>
          <input type="range" className="nj-range" min={0} max={1} step={0.01} value={volume} style={{ ["--pct" as string]: `${volume * 100}%` }} onChange={(e) => setVolume(Number(e.target.value))} />
        </label>
      </section>

      <section className="nj-card">
        <div className="nj-section-head">
          <h2 className="nj-h3">Equalizer</h2>
          <label className="nj-switch">
            <input type="checkbox" checked={eqOn} onChange={(e) => setEq(eqGains, e.target.checked)} />
            <span>{eqOn ? "On" : "Off"}</span>
          </label>
        </div>
        <div className="nj-chips">
          {Object.entries(PRESETS).map(([name, gains]) => (
            <button key={name} className={`nj-chip ${preset === name ? "is-on" : ""}`} onClick={() => setEq(gains, name === "Flat" ? eqOn : true)}>
              {name}
            </button>
          ))}
        </div>
        <div className={`nj-eq ${eqOn ? "" : "is-off"}`}>
          {BAND_LABELS.map((label, i) => (
            <label key={label} className="nj-eq-band">
              <span className="nj-eq-value">{(eqGains[i] ?? 0) > 0 ? "+" : ""}{(eqGains[i] ?? 0).toFixed(1)}</span>
              <input
                type="range"
                className="nj-range nj-vertical"
                min={-12}
                max={12}
                step={0.5}
                value={eqGains[i] ?? 0}
                aria-label={`${label} gain in dB`}
                onChange={(e) => {
                  const g = eqGains.slice();
                  g[i] = Number(e.target.value);
                  setEq(g, true);
                }}
              />
              <span className="nj-eq-label">{label}</span>
            </label>
          ))}
        </div>
        <p className="nj-muted nj-small">When off, the filters sit at 0 dB but the Web Audio graph is still in the signal path.</p>
      </section>

      <section className="nj-card">
        <h2 className="nj-h3">Storage on this device</h2>
        <dl className="nj-facts">
          <div><dt>Imported songs</dt><dd>{local.length} · {formatBytes(localBytes)}</dd></div>
          <div><dt>This site uses</dt><dd>{usage ? formatBytes(usage.usage) : "Unknown"}</dd></div>
          <div><dt>Space left for Nightjar</dt><dd>{usage ? formatBytes(usage.free) : "Unknown"}</dd></div>
          <div><dt>Protected from clean-up</dt><dd>{persisted === null ? "Unknown" : persisted ? "Yes" : "No"}</dd></div>
        </dl>
        {persisted === false && (
          <button className="nj-btn" onClick={() => void requestPersistentStorage().then(setPersisted)}>
            Keep my library safe
          </button>
        )}
        <p className="nj-muted nj-small">Your files never leave this browser. Clearing site data for Nightjar removes them.</p>
      </section>

      <section className="nj-card">
        <h2 className="nj-h3">App</h2>
        <dl className="nj-facts">
          <div><dt>Installed</dt><dd>{pwa.installed ? "Yes" : "No"}</dd></div>
          <div><dt>Works offline</dt><dd>{navigator.serviceWorker?.controller || pwa.offlineReady ? "Yes" : "After the first visit from the web link"}</dd></div>
        </dl>
        {pwa.canInstall && (
          <button className="nj-btn nj-btn-primary" onClick={() => void installApp()}>
            Install Nightjar
          </button>
        )}
        {!pwa.canInstall && !pwa.installed && (
          <p className="nj-muted nj-small">On Android Chrome: open the ⋮ menu and tap “Install app” or “Add to Home screen”.</p>
        )}
      </section>

      <section className="nj-card">
        <h2 className="nj-h3">Honest audio</h2>
        <dl className="nj-facts">
          <div><dt>Audio context rate</dt><dd>{snap.sampleRate ? `${(snap.sampleRate / 1000).toFixed(1)} kHz` : "Opens on first play"}</dd></div>
          <div><dt>Output bit depth</dt><dd>Not exposed by browsers</dd></div>
          <div><dt>Bit-perfect</dt><dd>No. The browser mixes and may resample.</dd></div>
        </dl>
        <p className="nj-muted nj-small">Nightjar shows what each file really is, read from its header, and tells you when the browser changes it on the way out.</p>
      </section>

      <section className="nj-card">
        <h2 className="nj-h3">Keyboard</h2>
        <dl className="nj-facts nj-keys">
          <div><dt>Play / pause</dt><dd><kbd>Space</kbd></dd></div>
          <div><dt>Seek 5 s</dt><dd><kbd>←</kbd> <kbd>→</kbd></dd></div>
          <div><dt>Next / previous</dt><dd><kbd>N</kbd> <kbd>P</kbd></dd></div>
          <div><dt>Volume</dt><dd><kbd>↑</kbd> <kbd>↓</kbd></dd></div>
          <div><dt>Now playing</dt><dd><kbd>F</kbd></dd></div>
        </dl>
      </section>
      <p className="nj-muted nj-small nj-center">Nightjar 1.3 · local-first · works offline · optional sync</p>
    </div>
  );
}

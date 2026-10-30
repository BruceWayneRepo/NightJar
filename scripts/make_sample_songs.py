"""Recreate the two catalog songs that were lost from the original upload.

Writes public/audio/roost.wav (12 s) and public/audio/platform.wav (16 s),
both 16-bit / 44.1 kHz stereo. Run from the project folder:

    pip install numpy
    python scripts/make_sample_songs.py
"""
import wave

import numpy as np

SR = 44100
rng = np.random.default_rng(7)


def reverb(x, taps=((0.031, 0.5), (0.047, 0.42), (0.061, 0.36), (0.083, 0.3), (0.113, 0.25), (0.149, 0.2))):
    y = x.copy()
    for d, g in taps:
        n = int(d * SR)
        for k in range(1, 6):
            off = n * k
            if off >= len(x):
                break
            y[off:] += x[:-off] * (g ** k)
    return y


def bell(f, dur, t0, total, amp=0.25):
    out = np.zeros(total)
    n = int(dur * SR)
    t = np.arange(n) / SR
    sig = np.zeros(n)
    for ratio, a, dec in ((1, 1, 2.2), (2.76, 0.45, 3.5), (5.4, 0.22, 5.5), (8.93, 0.1, 8)):
        sig += a * np.sin(2 * np.pi * f * ratio * t) * np.exp(-dec * t / (dur / 3))
    sig *= np.minimum(1, t / 0.004)
    s = int(t0 * SR)
    e = min(total, s + n)
    out[s:e] += amp * sig[: e - s]
    return out


def write(name, left, right):
    st = np.stack([left, right], 1)
    st /= np.max(np.abs(st)) * 1.12
    fade = int(0.8 * SR)
    env = np.ones(len(left))
    env[-fade:] = np.linspace(1, 0, fade)
    env[: int(0.05 * SR)] = np.linspace(0, 1, int(0.05 * SR))
    st *= env[:, None]
    pcm = (st * 32767).astype("<i2")
    w = wave.open(f"public/audio/{name}", "wb")
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
    w.close()


# Roost: sparse upper-register bells over a quiet low drone
T = 12
N = T * SR
t = np.arange(N) / SR
drone = 0.05 * np.sin(2 * np.pi * 73.42 * t) * (0.6 + 0.4 * np.sin(2 * np.pi * 0.11 * t)) + 0.03 * np.sin(2 * np.pi * 110 * t)
notes = [(880, 0.4), (1174.66, 1.9), (987.77, 3.6), (1318.51, 5.2), (880, 6.9), (1174.66, 8.1), (1567.98, 9.4)]
L = drone.copy()
R = drone.copy()
for i, (f, s) in enumerate(notes):
    b = bell(f, 3.2, s, N, 0.22)
    pan = 0.35 + 0.3 * ((i % 3) / 2)
    L += b * (1 - pan)
    R += b * pan
write("roost.wav", reverb(L), reverb(np.roll(R, 90)))

# Platform: bass, brushed noise, four chords
T = 16
N = T * SR
chords = [(146.83, (293.66, 349.23, 440.0)), (116.54, (293.66, 349.23, 466.16)), (130.81, (261.63, 329.63, 392.0)), (110.0, (277.18, 329.63, 440.0))]
L = np.zeros(N)
R = np.zeros(N)
seg = N // 4
for i, (bass, tones) in enumerate(chords):
    s = i * seg
    tt = np.arange(seg) / SR
    env = np.minimum(1, tt / 0.3) * np.exp(-tt * 0.25)
    pad = sum(np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(2 * np.pi * 2 * f * tt) for f in tones) * 0.05 * env
    b = 0.22 * np.sin(2 * np.pi * bass * tt) * np.exp(-tt * 0.9) + 0.12 * np.sin(2 * np.pi * bass * tt + 0.5) * np.exp(-((tt - 2) ** 2) * 4)
    L[s : s + seg] += pad + b
    R[s : s + seg] += pad * 0.9 + b
beat = 60 / 72
noise = rng.standard_normal(N)
hp = noise - np.convolve(noise, np.ones(8) / 8, "same")
for k in np.arange(0, T, beat / 2):
    s = int(k * SR)
    e = min(N, s + int(0.18 * SR))
    env = np.exp(-np.arange(e - s) / SR * 22) * (0.05 if int(round(k / beat * 2)) % 2 else 0.08)
    L[s:e] += hp[s:e] * env
    R[s:e] += hp[s:e] * env * 0.8
write("platform.wav", reverb(L), reverb(np.roll(R, 70)))
print("Wrote public/audio/roost.wav and public/audio/platform.wav")

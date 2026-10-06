"""Synthesises every game sound from scratch (original, code-made audio).

    python3 tools/sfx/synth.py            # writes docs/sounds/*.mp3 (needs ffmpeg)
    python3 tools/sfx/synth.py kill win   # only these

Each sound is built from noise, oscillators and envelopes with numpy; files
are encoded as small mono MP3s. Variants (_0, _1 …) use different seeds and
pitches so repeated shots don't sound identical.
"""
import os
import subprocess
import sys
import tempfile
import wave

import numpy as np

SR = 44100
np.seterr(over="ignore")  # soft filter edges overflow to 0 far outside the band
ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'docs', 'sounds')


# ── building blocks ──────────────────────────────────────────────────────────
def t_(d):
    return np.arange(int(SR * d)) / SR


def noise(d, rs):
    return rs.uniform(-1, 1, int(SR * d))


def band(x, lo, hi, soft=0.15):
    """FFT band-pass with soft edges (lo/hi in Hz)."""
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    m = np.ones_like(f)
    if lo > 0: m *= 1 / (1 + np.exp(-(f - lo) / (lo * soft + 1)))
    if hi < SR / 2: m *= 1 / (1 + np.exp((f - hi) / (hi * soft + 1)))
    return np.fft.irfft(X * m, len(x))


def env(d, a, decay, curve=1.0):
    """Attack (s) then exponential decay (time constant, s)."""
    t = t_(d)
    e = np.where(t < a, t / max(a, 1e-6), np.exp(-(t - a) / decay))
    return e ** curve


def sweep(d, f0, f1, shape='sin', k=3.0):
    """Oscillator gliding exponentially from f0 to f1."""
    t = t_(d)
    f = f1 + (f0 - f1) * np.exp(-t * k / d * 3)
    ph = 2 * np.pi * np.cumsum(f) / SR
    if shape == 'sin': return np.sin(ph)
    if shape == 'saw': return 2 * ((ph / (2 * np.pi)) % 1) - 1
    if shape == 'sq': return np.sign(np.sin(ph))
    return np.sin(ph)


def tone(d, f, shape='sin'):
    ph = 2 * np.pi * f * t_(d)
    if shape == 'sin': return np.sin(ph)
    if shape == 'tri': return 2 / np.pi * np.arcsin(np.sin(ph))
    if shape == 'saw': return 2 * ((f * t_(d)) % 1) - 1
    if shape == 'sq': return np.sign(np.sin(ph))
    return np.sin(ph)


def pad(x, d):
    n = int(SR * d)
    return np.pad(x, (0, max(0, n - len(x))))[:n]


def mix(*parts):
    n = max(len(p) for p in parts)
    return sum(np.pad(p, (0, n - len(p))) for p in parts)


def at(x, t0, d=None):
    """Delay x by t0 seconds."""
    return np.concatenate([np.zeros(int(SR * t0)), x])


def drive(x, k):
    return np.tanh(x * k) / np.tanh(k)


def reverb(x, size=0.25, wet=0.25, rs=None):
    """Cheap room: a few decaying echoes of a smeared copy."""
    rs = rs or np.random.RandomState(7)
    ir = np.zeros(int(SR * size * 2))
    for k in range(18):
        i = int(rs.uniform(0.01, size * 2) * SR)
        ir[min(i, len(ir) - 1)] += rs.uniform(0.3, 1) * np.exp(-i / SR / size * 2.5)
    wetx = np.convolve(x, ir)[:len(x) + len(ir)]
    return mix(x, wetx * wet / max(1e-6, np.abs(ir).sum()) * 3)


def fade(x, d=0.02):
    n = min(len(x), int(SR * d))
    x = x.copy(); x[-n:] *= np.linspace(1, 0, n)
    return x


def norm(x, peak=0.89):
    m = np.abs(x).max() or 1
    return fade(x / m * peak)


# ── sound recipes ────────────────────────────────────────────────────────────
def gunshot(rs, d, body, crack_lo, crack_hi, tail, boom, pitch=1.0):
    crack = band(noise(d, rs), crack_lo, crack_hi) * env(d, 0.0008, 0.035)
    thump = sweep(d, 180 * pitch, 45 * pitch) * env(d, 0.001, body) * boom
    rumble = band(noise(d, rs), 60, 900) * env(d, 0.004, tail) * 0.6
    mech = band(noise(d, rs), 2500, 7000) * env(d, 0.0005, 0.008) * at(np.ones(int(SR * d)), 0.0)[:int(SR * d)] * 0.4
    return reverb(drive(crack * 1.4 + thump + rumble + mech, 2.2), 0.18, 0.22, rs)


def glock(seed):
    rs = np.random.RandomState(seed)
    return gunshot(rs, 0.5, 0.05, 900, 6000, 0.12, 0.9, 1.1 + seed * 0.03)


def ak47(seed):
    rs = np.random.RandomState(seed)
    return gunshot(rs, 0.42, 0.07, 600, 5000, 0.14, 1.2, 0.9 + seed * 0.03)


def shotgun():
    rs = np.random.RandomState(31)
    shot = gunshot(rs, 0.7, 0.12, 300, 4500, 0.25, 1.6, 0.7)
    # Pump: two short mechanical clacks.
    clack = lambda: band(noise(0.06, rs), 1200, 5000) * env(0.06, 0.001, 0.012)
    return mix(shot, at(clack(), 0.55) * 0.5, at(clack(), 0.72) * 0.6)


def chaingun():
    rs = np.random.RandomState(41)
    out = np.zeros(int(SR * 1.15))
    for k in range(9):
        s = gunshot(rs, 0.25, 0.04, 800, 6000, 0.06, 0.8, 1.0 + rs.uniform(-0.05, 0.05))
        out = mix(out, at(s * (0.75 + 0.25 * rs.rand()), k * 0.09))
    whirr = sweep(1.15, 90, 140, 'saw') * env(1.15, 0.05, 0.6) * 0.12
    return mix(out, band(whirr, 80, 2000))


def railgun():
    d = 1.6
    rs = np.random.RandomState(51)
    charge = sweep(0.35, 300, 2400, 'sin', k=-1) * env(0.35, 0.3, 0.05) * 0.4
    zap = band(noise(d, rs), 1500, 9000) * env(d, 0.001, 0.08)
    beam = (tone(d, 70, 'saw') * 0.5 + sweep(d, 1800, 120, 'sin') * 0.6) * env(d, 0.001, 0.35)
    ring = tone(d, 2200) * env(d, 0.001, 0.5) * 0.12 * (1 + 0.5 * np.sin(2 * np.pi * 7 * t_(d)))
    return reverb(drive(mix(charge, at(zap + beam + ring, 0.3)), 1.8), 0.3, 0.3)


def whoosh(seed, d=0.6, lo=400, hi=3500, peak=0.35, tone_f=None):
    rs = np.random.RandomState(seed)
    t = t_(d)
    shape = np.exp(-((t - d * peak) / (d * 0.16)) ** 2)
    x = band(noise(d, rs), lo, hi) * shape
    x += band(noise(d, rs), lo * 2, hi * 1.6) * np.exp(-((t - d * (peak + 0.05)) / (d * 0.1)) ** 2) * 0.6
    if tone_f: x += np.sin(2 * np.pi * np.cumsum(tone_f * (0.8 + 0.4 * shape)) / SR) * shape * 0.25
    return x


def fist(seed):
    return whoosh(10 + seed, 0.45, 300, 2200, 0.3) * 0.9


def bat():
    return whoosh(20, 0.7, 180, 1600, 0.35)


def katana(seed):
    rs = np.random.RandomState(60 + seed)
    w = whoosh(60 + seed, 0.62, 1200, 8000, 0.28)
    shing = tone(0.62, 3100 + seed * 260) * env(0.62, 0.002, 0.18) * 0.15
    return mix(w, at(shing, 0.04) * (0.6 + 0.4 * rs.rand()))


def laser_sword(seed):
    d = 0.75 + seed * 0.08
    t = t_(d)
    swing = np.exp(-((t - d * 0.35) / (d * 0.2)) ** 2)
    f = 110 * (1 + 0.35 * swing) * (1 + 0.02 * np.sin(2 * np.pi * 31 * t))
    ph = 2 * np.pi * np.cumsum(f) / SR
    hum = (np.sin(ph) + 0.5 * np.sin(2 * ph) + 0.3 * np.sign(np.sin(3 * ph))) * (0.35 + 0.65 * swing)
    buzz = band(noise(d, np.random.RandomState(70 + seed)), 1500, 5000) * swing * 0.3
    return drive(hum * 0.6 + buzz, 1.5) * env(d, 0.03, d * 0.6)


def chainsaw(seed):
    d = 1.4
    t = t_(d)
    rev = 1 / (1 + np.exp(-(t - 0.15) * 30))
    f = 38 + 34 * rev + 3 * np.sin(2 * np.pi * 9 * t) + seed * 4
    ph = 2 * np.pi * np.cumsum(f) / SR
    eng = 2 * ((ph / (2 * np.pi)) % 1) - 1
    chain = band(noise(d, np.random.RandomState(80 + seed)), 1200, 6000) * rev * (0.5 + 0.5 * np.sign(np.sin(ph * 6)))
    return band(drive(eng * 0.9 + chain * 0.35, 2.5), 50, 6000) * env(d, 0.02, 0.9)


def flamethrower():
    d = 0.95
    rs = np.random.RandomState(90)
    roar = band(noise(d, rs), 80, 1400) * env(d, 0.05, 0.5)
    hiss = band(noise(d, rs), 2500, 9000) * env(d, 0.02, 0.3) * 0.35
    crack = np.zeros(int(SR * d))
    for _ in range(25):
        i = rs.randint(0, len(crack) - 200)
        crack[i:i + 60] += rs.uniform(-1, 1, 60) * np.exp(-np.arange(60) / 12)
    return drive(roar * 1.2 + hiss + band(crack, 1000, 8000) * 0.5, 1.6)


def tesla_shoot():
    d = 0.7
    rs = np.random.RandomState(100)
    t = t_(d)
    gate = (band(noise(d, rs), 5, 40) > 0).astype(float)
    buzz = np.sign(np.sin(2 * np.pi * np.cumsum(120 + 80 * rs.rand(len(t))) / SR)) * gate
    crackle = band(noise(d, rs), 3000, 12000) * (rs.rand(len(t)) > 0.97) * 3
    return band(drive(buzz * 0.5 + crackle, 2), 80, 12000) * env(d, 0.005, 0.3)


def sledge_shoot():
    return whoosh(110, 0.75, 120, 1100, 0.18) * 1.1


def impact(seed, d=0.5, low=70, crunch=0.6, bright=4000, wet=False):
    rs = np.random.RandomState(seed)
    thud = sweep(d, low * 2.2, low) * env(d, 0.001, 0.07)
    hit = band(noise(d, rs), 300, bright) * env(d, 0.0005, 0.03) * crunch
    x = thud + hit
    if wet:
        x += band(noise(d, rs), 200, 1500) * env(d, 0.01, 0.08) * 0.5
    return drive(x, 1.8)


def metal_impact(seed, f0):
    rs = np.random.RandomState(seed)
    d = 0.6
    ring = sum(tone(d, f0 * r) * a for r, a in ((1, 1), (2.76, 0.6), (5.4, 0.35))) * env(d, 0.001, 0.12)
    return mix(impact(seed, 0.5, 90, 0.5, 6000), ring * 0.35)


def zap_impact():
    rs = np.random.RandomState(120)
    d = 0.9
    t = t_(d)
    x = band(noise(d, rs), 2000, 12000) * (rs.rand(len(t)) > 0.9) * 2 + tone(d, 60, 'sq') * 0.3
    return drive(x * env(d, 0.002, 0.25), 2)


def laser_impact():
    d = 0.9
    x = sweep(d, 1600, 200, 'saw') * env(d, 0.001, 0.15)
    return mix(band(x, 100, 8000), impact(130, 0.5, 80, 0.4) * 0.6)


def saw_impact():
    d = 1.2
    rs = np.random.RandomState(140)
    grind = band(noise(d, rs), 600, 5000) * (0.6 + 0.4 * np.sign(np.sin(2 * np.pi * 55 * t_(d))))
    return mix(grind * env(d, 0.005, 0.3) * 0.8, impact(141, 0.5, 70, 0.5, 3000, True))


def pickup(seed, kind):
    """Grab: a cloth/hand rustle plus a click-clack or a ring for blades."""
    rs = np.random.RandomState(seed)
    d = 0.6
    rustle = band(noise(d, rs), 800, 5000) * env(d, 0.01, 0.05) * 0.4
    clack = lambda f: band(noise(0.08, rs), f, f * 4) * env(0.08, 0.0005, 0.01)
    if kind == 'gun':
        return drive(mix(rustle, at(clack(1500), 0.06), at(clack(1100), 0.17) * 0.9), 4)
    if kind == 'blade':
        ring = sum(tone(d, 2400 * r) * a for r, a in ((1, 1), (1.5, 0.4), (2.7, 0.25))) * env(d, 0.003, 0.2) * 0.3
        return mix(rustle, at(ring, 0.03))
    if kind == 'heavy':
        return mix(rustle, impact(seed, 0.5, 60, 0.4) * 0.7, at(clack(700), 0.12) * 0.7)
    if kind == 'engine':
        return mix(rustle, chainsaw(2)[:int(SR * 0.6)] * env(0.6, 0.02, 0.2) * 0.6)
    if kind == 'energy':
        return mix(rustle, sweep(0.6, 400, 1400, 'sin', k=-1) * env(0.6, 0.02, 0.2) * 0.4)
    if kind == 'gas':
        return mix(rustle, band(noise(d, rs), 2000, 9000) * env(d, 0.01, 0.15) * 0.5, at(clack(900), 0.05))
    return drive(mix(rustle, at(clack(800), 0.05), at(clack(600), 0.14) * 0.7), 4)


def voice(seed, d, f0, f1, vowel, gain=1.0, breath=0.2):
    """A short pained grunt: glottal pulse train through vowel formants."""
    rs = np.random.RandomState(seed)
    t = t_(d)
    f = f1 + (f0 - f1) * np.exp(-t / (d * 0.5)) + rs.uniform(-2, 2) * np.sin(2 * np.pi * 6 * t)
    ph = np.cumsum(f) / SR
    src = (ph % 1) ** 3 * 2 - 0.5  # buzzy pulse
    src += band(noise(d, rs), 300, 4000) * breath
    F = {'a': (750, 1200, 2600), 'u': (350, 800, 2400), 'o': (500, 900, 2500), 'e': (550, 1800, 2600)}[vowel]
    x = sum(band(src, fm * 0.85, fm * 1.15, 0.05) * a for fm, a in zip(F, (1, 0.6, 0.25)))
    return drive(x * gain, 2) * env(d, 0.02, d * 0.35)


def death(i):
    spec = [(0.9, 180, 90, 'a'), (1.0, 150, 70, 'u'), (0.7, 220, 120, 'e'), (0.6, 170, 110, 'o'),
            (0.8, 200, 80, 'a'), (0.5, 240, 140, 'u'), (0.75, 130, 70, 'o')][i]
    d, f0, f1, v = spec
    v_ = voice(200 + i, d, f0, f1, v)
    thud = impact(210 + i, 0.5, 60, 0.3) * 0.5
    return reverb(mix(v_, at(thud, d * 0.6)), 0.2, 0.2)


# Music-ish cues: a small sine/triangle synth with soft bell partials.
def note(f, d, shape='tri', a=0.005, dec=0.4):
    x = tone(d, f, shape) * 0.7 + tone(d, f * 2) * 0.2 + tone(d, f * 3.01) * 0.08
    return x * env(d, a, dec)


def hz(n):
    return 440 * 2 ** ((n - 69) / 12)


def seq(notes, step, shape='tri', dec=0.35, total=None):
    parts = [at(note(hz(n), max(dec * 3, step), shape, dec=dec) * v, i * step) for i, (n, v) in enumerate(notes) if n]
    x = mix(*parts)
    return pad(x, total) if total else x


def kill():
    return reverb(seq([(76, 1), (83, 0.9)], 0.09, 'tri', 0.18), 0.2, 0.25)


def position_change():
    return seq([(72, 0.8), (77, 0.8)], 0.07, 'sin', 0.12)


def position_first():
    return reverb(seq([(72, 0.7), (76, 0.8), (79, 0.9), (84, 1)], 0.07, 'tri', 0.25), 0.25, 0.3)


def join_lobby():
    ch = mix(*(note(hz(n), 1.4, 'sin', a=0.15, dec=0.6) * 0.5 for n in (60, 64, 67, 72)))
    return reverb(ch, 0.35, 0.35)


def btn_chat():
    return sweep(0.12, 900, 1500, 'sin', k=-1) * env(0.12, 0.002, 0.03)


def win():
    mel = [(67, 1), (72, 1), (76, 1), (79, 1), (None, 0), (76, 0.8), (79, 1), (84, 1)]
    lead = seq(mel, 0.16, 'tri', 0.3)
    bass = seq([(48, 0.8), (None, 0), (55, 0.7), (None, 0), (53, 0.8), (None, 0), (48, 0.9)], 0.16, 'sin', 0.4)
    chord = at(mix(*(note(hz(n), 1.6, 'sin', a=0.02, dec=0.8) * 0.35 for n in (60, 64, 67, 72))), 1.28)
    return reverb(mix(lead, bass * 0.8, chord), 0.4, 0.3)


def lose():
    mel = [(67, 0.9), (66, 0.85), (65, 0.8), (64, 0.75), (None, 0), (60, 0.8)]
    lead = seq(mel, 0.32, 'tri', 0.45)
    bass = at(mix(*(note(hz(n), 2.0, 'sin', a=0.05, dec=0.9) * 0.35 for n in (48, 51, 55))), 1.6)
    return reverb(mix(lead, bass), 0.45, 0.35)


SOUNDS = {
    'glock_shoot_0': lambda: glock(0), 'glock_shoot_1': lambda: glock(1), 'glock_shoot_2': lambda: glock(2),
    'ak47_shoot_0': lambda: ak47(3), 'ak47_shoot_1': lambda: ak47(4), 'ak47_shoot_2': lambda: ak47(5),
    'shotgun_shoot': shotgun, 'chaingun_shoot': chaingun, 'railgun_shoot': railgun,
    'fist_shoot_0': lambda: fist(0), 'fist_shoot_1': lambda: fist(1), 'fist_shoot_2': lambda: fist(2),
    'bat_shoot': bat,
    'katana_shoot_0': lambda: katana(0), 'katana_shoot_1': lambda: katana(1), 'katana_shoot_2': lambda: katana(2),
    'laser_sword_shoot_0': lambda: laser_sword(0), 'laser_sword_shoot_1': lambda: laser_sword(1), 'laser_sword_shoot_2': lambda: laser_sword(2),
    'chainsaw_shoot_0': lambda: chainsaw(0), 'chainsaw_shoot_1': lambda: chainsaw(1),
    'flamethrower_shoot': flamethrower, 'tesla_helmet_shoot_0': tesla_shoot, 'sledgehammer_shoot': sledge_shoot,
    'glock_impact': lambda: impact(300, 0.45, 80, 0.6, 5000, True),
    'ak47_impact': lambda: impact(301, 0.45, 75, 0.7, 5000, True),
    'shotgun_impact': lambda: impact(302, 0.55, 60, 0.9, 4000, True),
    'fist_impact': lambda: impact(303, 0.35, 90, 0.35, 2500),
    'katana_impact': lambda: metal_impact(304, 1900),
    'chainsaw_impact': saw_impact,
    'laser_sword_impact': laser_impact,
    'sledgehammer_impact': lambda: impact(305, 0.8, 45, 1.0, 3000, True),
    'tesla_helmet_impact': zap_impact,
    'glock_pickup': lambda: pickup(400, 'gun'), 'ak47_pickup': lambda: pickup(401, 'gun'),
    'shotgun_pickup': lambda: pickup(402, 'gun'), 'chaingun_pickup': lambda: pickup(403, 'heavy'),
    'railgun_pickup': lambda: pickup(404, 'energy'), 'bat_pickup': lambda: pickup(405, 'wood'),
    'katana_pickup': lambda: pickup(406, 'blade'), 'laser_sword_pickup': lambda: pickup(407, 'energy'),
    'chainsaw_pickup': lambda: pickup(408, 'engine'), 'flamethrower_pickup': lambda: pickup(409, 'gas'),
    'sledgehammer_pickup': lambda: pickup(410, 'heavy'), 'tesla_helmet_pickup': lambda: pickup(411, 'energy'),
    **{f'death_{i}': (lambda i=i: death(i)) for i in range(7)},
    'kill': kill, 'win': win, 'lose': lose, 'join_lobby': join_lobby,
    'position_first': position_first, 'position_change': position_change, 'btn_chat': btn_chat,
}

# Loudness per family so mixing in game stays balanced.
GAIN = {'laser_sword_shoot': 0.5, 'chainsaw_shoot': 0.6, 'shoot': 0.85, 'impact': 0.7, 'pickup': 0.6, 'death': 0.75}


def write_mp3(name, x):
    g = next((v for k, v in GAIN.items() if k in name), 0.8)
    x = norm(x, 0.95) * g
    pcm = (np.clip(x, -1, 1) * 32767).astype(np.int16)
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
        tmp = f.name
    with wave.open(tmp, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
    out = os.path.join(ROOT, name + '.mp3')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', tmp, '-codec:a', 'libmp3lame', '-b:a', '80k', out], check=True)
    os.remove(tmp)


def main():
    only = set(sys.argv[1:])
    for name, fn in SOUNDS.items():
        if only and name not in only: continue
        write_mp3(name, fn())
        print('wrote', name)


if __name__ == '__main__':
    main()

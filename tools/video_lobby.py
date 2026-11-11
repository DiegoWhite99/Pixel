#!/usr/bin/env python3
"""Video del lobby: comprime el video de assests/video a web/medios/pixel.mp4 y le cambia el sonido por musica lofi.

Pedido del usuario (11 nov): el video NO lleva la narracion original, solo la musica de fondo.
La musica se compone aqui, sintetizada con numpy (sin muestras ajenas, asi que no hay derechos de nadie):
piano electrico con los acordes Dm9 - G13 - Cmaj9 - Am9, bajo, bateria suave con swing y ruido de disco.
Dos compases duran lo mismo que el video (~73 pulsos por minuto), para que el bucle cuadre.
No hay ffmpeg en el PC: usa PyAV, que viene con faster-whisper.

    .venv/bin/python tools/video_lobby.py [video_original.mp4]

Deja tambien web/medios/pixel.jpg (el primer cuadro, de portada). El lobby lo carga con autoplay en
silencio; la musica se oye al activar el sonido.
"""
import glob
import sys
from fractions import Fraction

import av
import numpy as np

SR = 48000
ANCHO, ALTO, FPS = 960, 540, 24
SALIDA = "web/medios/pixel.mp4"
PORTADA = "web/medios/pixel.jpg"
VOL_MUSICA = 0.11          # RMS de la musica (es el unico sonido del video)

rng = np.random.default_rng(7)     # siempre la misma musica


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def paso_bajo(x, fc, orden=2):
    """Filtro paso bajo suave (magnitud de un Butterworth), en frecuencia: el audio es corto."""
    f = np.fft.rfftfreq(x.shape[-1], 1 / SR)
    return np.fft.irfft(np.fft.rfft(x) / np.sqrt(1 + (f / fc) ** (2 * orden)), n=x.shape[-1])


def paso_alto(x, fc, orden=2):
    f = np.fft.rfftfreq(x.shape[-1], 1 / SR)
    f[0] = 1e-6
    return np.fft.irfft(np.fft.rfft(x) / np.sqrt(1 + (fc / f) ** (2 * orden)), n=x.shape[-1])


def pegar(bus, señal, inicio):
    i = int(inicio * SR)
    if i >= bus.shape[-1]:
        return
    n = min(señal.shape[-1], bus.shape[-1] - i)
    bus[..., i:i + n] += señal[..., :n]


def piano(f, dur, t_global, desafino=0.0):
    """Piano electrico: parciales con caida propia, un poco de tremolo y la cinta que ondula (wow)."""
    t = np.arange(int((dur + 0.4) * SR)) / SR
    f = f * 2 ** (desafino / 1200)
    wow = 0.0025 * np.sin(2 * np.pi * 0.55 * (t + t_global))          # la cinta vieja
    fase = 2 * np.pi * f * (t + np.cumsum(wow) / SR)
    s = (1.00 * np.sin(fase) * np.exp(-t / 1.6)
         + 0.30 * np.sin(2 * fase) * np.exp(-t / 0.5)
         + 0.10 * np.sin(3 * fase) * np.exp(-t / 0.25)
         + 0.04 * np.sin(7 * fase) * np.exp(-t / 0.05))                 # el golpecito de la lengueta
    s *= 1 + 0.07 * np.sin(2 * np.pi * 4.2 * t)
    s *= np.minimum(1, t / 0.006)                                       # ataque
    s *= np.clip((dur + 0.35 - t) / 0.35, 0, 1)                         # se suelta al cambiar de acorde
    return s


def bajo(f, dur):
    t = np.arange(int(dur * SR)) / SR
    s = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t)
    return s * np.minimum(1, t / 0.01) * np.exp(-t / 1.4) * np.clip((dur - t) / 0.08, 0, 1)


def bombo():
    t = np.arange(int(0.45 * SR)) / SR
    fase = 2 * np.pi * np.cumsum(45 + 70 * np.exp(-t / 0.035)) / SR
    return np.sin(fase) * np.exp(-t / 0.2)


def caja():
    t = np.arange(int(0.35 * SR)) / SR
    ruido = paso_alto(rng.standard_normal(t.size), 900) * np.exp(-t / 0.09)
    return 0.55 * ruido + 0.45 * np.sin(2 * np.pi * 185 * t) * np.exp(-t / 0.06)


def platillo():
    t = np.arange(int(0.12 * SR)) / SR
    return paso_alto(rng.standard_normal(t.size), 6000) * np.exp(-t / 0.025)


def componer(n):
    """Dos compases de 4/4 que duran n muestras. Devuelve (2, n) en estereo."""
    dur = n / SR
    pulso = dur / 8
    swing = 0.12 * pulso
    teclas = np.zeros((2, n))
    graves = np.zeros(n)
    bateria = np.zeros(n)
    acordes = [  # (bajo, notas del piano) en MIDI
        (38, [53, 57, 60, 64]),        # Dm9: F A C E sobre D
        (43, [53, 59, 64, 69]),        # G13: F B E A sobre G
        (36, [52, 55, 59, 62]),        # Cmaj9: E G B D sobre C
        (45, [55, 60, 64, 71]),        # Am9: G C E B sobre A
    ]
    for k, (raiz, notas) in enumerate(acordes):
        t0 = k * 2 * pulso
        for j, m in enumerate(notas):
            vel = 0.8 + 0.2 * rng.random()
            ini = t0 + 0.018 * j + 0.004 * rng.random()                  # rasgueo lento, humano
            pegar(teclas[0], vel * piano(hz(m), 2 * pulso, ini, +4), ini)
            pegar(teclas[1], vel * piano(hz(m), 2 * pulso, ini, -4), ini)
        pegar(graves, bajo(hz(raiz), 2 * pulso), t0)
    for compas in range(2):
        b0 = compas * 4 * pulso
        for p in (0, 1.5, 2.5):
            pegar(bateria, 0.9 * bombo(), b0 + p * pulso)
        for p in (1, 3):
            pegar(bateria, 0.45 * caja(), b0 + p * pulso + 0.01)
        for c in range(8):
            pegar(bateria, (0.16 if c % 2 == 0 else 0.10) * platillo(), b0 + c * pulso / 2 + (swing if c % 2 else 0))
    teclas = paso_bajo(teclas, 2600)
    graves = paso_bajo(graves, 400)
    bateria = paso_bajo(bateria, 5000)
    # disco viejo: chasquidos sueltos y un siseo muy bajo
    disco = np.zeros((2, n))
    for _ in range(int(dur * 9)):
        i = rng.integers(0, n - 200)
        clic = rng.uniform(0.05, 0.35) * rng.standard_normal(60) * np.exp(-np.arange(60) / 12)
        disco[rng.integers(0, 2), i:i + 60] += clic
    disco = paso_alto(disco, 1500) + 0.004 * paso_bajo(rng.standard_normal((2, n)), 5000)
    musica = 0.55 * teclas + 0.55 * graves + 0.6 * bateria + 0.25 * disco
    musica *= VOL_MUSICA / np.sqrt((musica ** 2).mean())
    t = np.arange(n) / SR
    musica *= np.minimum(1, t / 0.03) * np.clip((dur - t) / 0.4, 0, 1)    # sin chasquido al dar la vuelta
    return musica


def main():
    original = sys.argv[1] if len(sys.argv) > 1 else sorted(glob.glob("assests/video/*.mp4"))[0]
    ent = av.open(original)
    vi = ent.streams.video[0]
    n_cuadros = vi.frames or int(round(float(ent.duration / 1e6) * FPS))
    n = int(round(n_cuadros / FPS * SR))
    audio = componer(n)                                  # la voz original no se usa
    pico = np.abs(audio).max()
    audio = (audio * (0.9 / pico if pico > 0.9 else 1.0)).astype(np.float32)

    sal = av.open(SALIDA, "w", options={"movflags": "+faststart"})
    vo = sal.add_stream("libx264", rate=FPS, options={"crf": "27", "preset": "slow", "profile": "high", "tune": "film"})
    vo.width, vo.height, vo.pix_fmt = ANCHO, ALTO, "yuv420p"
    ao = sal.add_stream("aac", rate=SR, layout="stereo")
    ao.bit_rate = 112000
    hecho, portada = 0, None

    def audio_hasta(muestra):
        nonlocal hecho
        while hecho < min(muestra, n):
            blq = np.ascontiguousarray(audio[:, hecho:hecho + 1024])
            fr = av.AudioFrame.from_ndarray(blq, format="fltp", layout="stereo")
            fr.sample_rate, fr.pts, fr.time_base = SR, hecho, Fraction(1, SR)
            for p in ao.encode(fr):
                sal.mux(p)
            hecho += blq.shape[1]

    for k, f in enumerate(ent.decode(video=0)):
        g = f.reformat(width=ANCHO, height=ALTO, format="yuv420p")
        g.pts, g.time_base = k, Fraction(1, FPS)
        if portada is None:
            portada = f.reformat(width=ANCHO, height=ALTO, format="yuvj420p")
        for p in vo.encode(g):
            sal.mux(p)
        audio_hasta(int((k + 1) / FPS * SR))
    audio_hasta(n)
    for p in vo.encode():
        sal.mux(p)
    for p in ao.encode():
        sal.mux(p)
    sal.close()

    j = av.open(PORTADA, "w", format="image2")
    js = j.add_stream("mjpeg", rate=1)
    js.width, js.height, js.pix_fmt = ANCHO, ALTO, "yuvj420p"
    for p in js.encode(portada):
        j.mux(p)
    for p in js.encode():
        j.mux(p)
    j.close()
    print("listo:", SALIDA, PORTADA)


if __name__ == "__main__":
    main()

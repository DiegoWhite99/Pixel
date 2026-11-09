#!/usr/bin/env python3
"""Fase 3 - Sintesis de voz con Piper.

Piper entrega 22050 Hz; el contrato con el ESP32 es 16000 Hz, 16 bit, mono.
El remuestreo se hace con numpy: filtro paso bajo anti-aliasing + interpolacion
lineal. No hace falta scipy.

Fase 13: voz infantil (no hay voces de nino en espanol para Piper). Con "agudo" = k, Piper habla
k veces mas lento (length_scale) y el audio se remuestrea como si fuera de sr*k: suena k veces mas
agudo (tono y formantes, como en los dibujos animados) y vuelve a durar lo mismo.
"""

import threading

import numpy as np
from piper import PiperVoice, SynthesisConfig

SR_DESTINO = 16000


def _paso_bajo(x, corte_hz, sr, taps=63):
    """FIR sinc enventanado. Evita el aliasing al bajar de 22050 a 16000."""
    n = np.arange(taps) - (taps - 1) / 2.0
    h = np.sinc(2.0 * (corte_hz / sr) * n) * np.hamming(taps)
    h /= h.sum()
    return np.convolve(x, h, mode="same")


def remuestrear(x, sr_origen, sr_destino):
    if sr_origen == sr_destino:
        return x
    if sr_destino < sr_origen:
        x = _paso_bajo(x, corte_hz=sr_destino * 0.45, sr=sr_origen)
    n_out = int(round(len(x) * sr_destino / float(sr_origen)))
    if n_out <= 0:
        return np.zeros(0, dtype=np.float64)
    pos = np.arange(n_out) * (sr_origen / float(sr_destino))
    i0 = np.floor(pos).astype(np.int64)
    i1 = np.minimum(i0 + 1, len(x) - 1)
    frac = pos - i0
    return x[i0] * (1.0 - frac) + x[i1] * frac


class Tts:
    def __init__(self, ruta_modelo, sr_destino=SR_DESTINO, hablante=None):
        self.voice = PiperVoice.load(ruta_modelo)
        self.sr_destino = sr_destino
        self.sr_origen = self.voice.config.sample_rate
        # modelos con varios hablantes (p. ej. sharvard: "M" y "F"); None = el unico que hay
        speaker_id = self.voice.config.speaker_id_map[hablante] if hablante is not None else None
        self.speaker_id = speaker_id
        self.cfg = SynthesisConfig(speaker_id=speaker_id)
        self.agudo = 1.0                 # 1 = normal; 1,3 infantil (ver arriba)
        self._lock = threading.Lock()

    def sintetizar(self, texto):
        """texto -> PCM 16 bit LE mono a sr_destino (bytes)."""
        texto = texto.strip()
        if not texto:
            return b""
        agudo = max(1.0, float(self.agudo or 1.0))
        cfg = self.cfg if agudo == 1.0 else SynthesisConfig(speaker_id=self.speaker_id,
                                                            length_scale=(getattr(self.voice.config, "length_scale", None) or 1.0) * agudo)
        with self._lock:
            trozos = [c.audio_int16_array for c in self.voice.synthesize(texto, cfg)]
        if not trozos:
            return b""
        audio = np.concatenate(trozos).astype(np.float64)
        audio = remuestrear(audio, self.sr_origen * agudo, self.sr_destino)
        audio = np.clip(np.round(audio), -32768, 32767).astype("<i2")
        return audio.tobytes()

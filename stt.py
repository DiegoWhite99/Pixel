#!/usr/bin/env python3
"""Fase 2 - Transcripcion con faster-whisper.

El modelo se carga UNA sola vez al arrancar el servidor y se reutiliza
en cada frase.
"""

import re
import threading
import time
import unicodedata

import numpy as np
from faster_whisper import WhisperModel
from faster_whisper.vad import VadOptions, get_speech_timestamps


def _a_float(pcm_bytes):
    return np.frombuffer(pcm_bytes, dtype="<i2").astype(np.float32) / 32768.0


def _trozos(texto):
    """'Píxel, YouTube, pon música.' -> ['pixel', 'youtube', 'pon musica'] (sin tildes, mayusculas ni signos)"""
    plano = "".join(c for c in unicodedata.normalize("NFD", texto.lower()) if unicodedata.category(c) != "Mn")
    return [" ".join(p) for p in (re.findall(r"\w+", t) for t in re.split(r"[,;:.!?¡¿]", plano)) if p]


MIN_TROZOS_ECO = 4


def eco_del_prompt(texto, prompt):
    """True si Whisper solo repitio su initial_prompt, cosa que hace con ruido.

    18 nov: con el audio del robot corrido un byte (ruido a todo volumen) Whisper escribia "Píxel, YouTube, pon
    música, reproduce, Soda Stereo, Queen, Bohemian Rhapsody", que trae la palabra de activacion, y el robot ponia
    Queen solo. Es eco una lista de 4 o mas trozos distintos, separados por comas, que son todos trozos del prompt.
    Una orden de verdad ("Píxel, pon Queen", "Píxel, busca en YouTube Soda Stereo") tiene trozos que no estan en
    el prompt, o menos de 4.
    """
    if not prompt:
        return False
    del_prompt = set(_trozos(prompt))
    trozos = _trozos(texto)
    return len(set(trozos)) >= MIN_TROZOS_ECO and all(t in del_prompt for t in trozos)


class Transcriptor:
    def __init__(self, model_size="small", device="cpu", compute_type="int8",
                 language="es", beam_size=1, cpu_threads=8, initial_prompt=None,
                 vad_umbral=0.35, temperatura=0.0, max_compresion=2.4):
        self.language = language
        self.beam_size = beam_size
        self.initial_prompt = initial_prompt    # vocabulario que Whisper debe esperar
        self.temperatura = temperatura          # una sola: sin la cadena de reintentos 0.0 -> 1.0
        self.max_compresion = max_compresion    # segmentos mas repetitivos que esto son un bucle
        self.model = WhisperModel(model_size, device=device,
                                  compute_type=compute_type, cpu_threads=cpu_threads)
        # ctranslate2 no garantiza llamadas concurrentes sobre el mismo modelo
        self._lock = threading.Lock()
        self.vad = VadOptions(threshold=vad_umbral, min_speech_duration_ms=250)

    def hay_voz(self, pcm_bytes):
        """True si el VAD Silero oye voz. Tarda milisegundos: sirve de filtro antes de Whisper.

        Solo decide; el audio que va a Whisper no se recorta.
        """
        return bool(get_speech_timestamps(_a_float(pcm_bytes), self.vad))

    def transcribir(self, pcm_bytes):
        """PCM 16-bit LE mono 16 kHz -> (texto, segundos que tardo)."""
        audio = _a_float(pcm_bytes)
        t0 = time.monotonic()
        with self._lock:
            segmentos, _info = self.model.transcribe(
                audio,
                language=self.language,
                beam_size=self.beam_size,
                vad_filter=False,
                initial_prompt=self.initial_prompt,
                temperature=self.temperatura,
            )
            # con una sola temperatura Whisper no reintenta: los bucles llegan tal cual
            texto = " ".join(s.text.strip() for s in segmentos
                             if s.compression_ratio <= self.max_compresion).strip()
        return texto, time.monotonic() - t0

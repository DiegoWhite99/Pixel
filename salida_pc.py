#!/usr/bin/env python3
"""Fase 8 - Voz de Pixel por la salida de audio del PC (el altavoz Bluetooth si esta conectado).

Un pacat persistente recibe el mismo PCM de 16 kHz que iria al ESP32. Escribe un hilo,
para que Sesion.enviar_audio no se bloquee mientras suena: el servidor sigue
sintetizando la frase siguiente, igual que cuando manda la voz al ESP32.
"""

import io
import os
import queue
import subprocess
import threading
import wave

LATENCIA_S = 0.4        # pacat + Bluetooth A2DP: lo que tarda en empezar a sonar; se suma a la sordera del micro


class SalidaPc:
    def __init__(self, sample_rate=16000):
        self.sample_rate = sample_rate
        self._cola = queue.Queue()
        self._proc = None
        threading.Thread(target=self._escribir, daemon=True).start()

    def _abrir(self):
        if self._proc is None or self._proc.poll() is not None:
            self._proc = subprocess.Popen(
                ["pacat", "--playback", "--raw", "--format=s16le", "--rate=%d" % self.sample_rate,
                 "--channels=1", "--latency-msec=100", "--client-name=Pixel", "--stream-name=voz"],
                stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return self._proc

    def reproducir(self, pcm):
        """PCM 16 bit LE mono: vuelve enseguida, suena en orden."""
        self._cola.put(pcm)

    def _escribir(self):
        while True:
            pcm = self._cola.get()
            if os.name == "nt":         # Windows (instalador .exe): sin pacat; winsound toca un WAV en memoria y espera
                self._windows(pcm)
                continue
            try:
                proc = self._abrir()
                proc.stdin.write(pcm)
                proc.stdin.flush()
            except (BrokenPipeError, OSError):
                self._proc = None       # se reabre con la siguiente frase

    def _windows(self, pcm):
        import winsound
        caja = io.BytesIO()
        with wave.open(caja, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(self.sample_rate)
            w.writeframes(pcm)
        try:
            winsound.PlaySound(caja.getvalue(), winsound.SND_MEMORY)
        except RuntimeError:
            pass                        # sin salida de audio: la frase se pierde, como con pacat caido

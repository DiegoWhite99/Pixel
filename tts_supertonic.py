#!/usr/bin/env python3
"""2.0.0 - La voz de alta calidad en el PC: Supertonic 3 (Supertone; modelo OpenRAIL-M en voces/supertonic3/,
fuera de git; algoritmo de su ejemplo oficial py/helper.py, MIT). El usuario la pidio el 10 nov ("las voces
estan del asco, busca cosas de calidad") y eligio la F4 de las muestras de voces_prueba/supertonic3/.

Misma interfaz que tts.Tts: sintetizar(texto) -> PCM 16 bit LE mono a 16000 Hz, y "agudo" (tipo de voz).
Todas las voces usan el mismo modelo: cambiar de voz es cambiar "estilo" (un JSON pequeno), sin recargar.
Lee letras, no fonemas: leer() escribe antes en palabras los numeros, horas, porcentajes, grados y precios,
igual que leer() de web/voz.js (las pruebas usan las mismas frases).
"""

import json
import os
import re
import threading
import unicodedata

import numpy as np
import onnxruntime as ort

from tts import SR_DESTINO, remuestrear

PASOS = 5               # pasos de calculo: 8 suena un poco mejor; 5 va a ~0,5 x tiempo real en este PC
VELOCIDAD = 1.05        # la del ejemplo oficial y la de las muestras
HILOS = 4

# ------------------------------------------------------------------ numeros en palabras (como web/voz.js)
UNIDADES = ["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce",
            "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiuno",
            "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve"]
DECENAS = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"]
CENTENAS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos",
            "ochocientos", "novecientos"]
FEMENINO = re.compile(r"^\s+(personas?|horas?|semanas?|veces|vez|tareas?|cosas?|notas?|canci[oó]n(es)?|llamadas?|citas?"
                      r"|reuniones|reuni[oó]n|alarmas?|p[aá]ginas?|preguntas?)\b", re.I)


def _apocope(t):
    return re.sub(r"uno$", "un", re.sub(r"veintiuno$", "veintiún", t))


def _menos_de_mil(n):
    if n == 100:
        return "cien"
    if n < 30:
        return UNIDADES[n]
    if n < 100:
        return DECENAS[n // 10] + (" y " + UNIDADES[n % 10] if n % 10 else "")
    return CENTENAS[n // 100] + (" " + _menos_de_mil(n % 100) if n % 100 else "")


def en_letras(n):
    if n < 1000:
        return _menos_de_mil(n)
    if n < 10 ** 6:
        m, r = divmod(n, 1000)
        return ("mil" if m == 1 else _apocope(_menos_de_mil(m)) + " mil") + (" " + _menos_de_mil(r) if r else "")
    if n < 10 ** 12:
        m, r = divmod(n, 10 ** 6)
        return ("un millón" if m == 1 else _apocope(en_letras(m)) + " millones") + (" " + en_letras(r) if r else "")
    return " ".join(UNIDADES[int(c)] for c in str(n))


def _cifras(s):
    return " ".join(UNIDADES[int(c)] for c in s)


def _decimales(s):
    return en_letras(int(s)) if len(s) <= 2 and s[0] != "0" else _cifras(s)


def _numero(m):
    if re.fullmatch(r"\d{1,3}(\.\d{3})+", m):
        return en_letras(int(m.replace(".", "")))
    x = re.fullmatch(r"(\d{1,3}(?:\.\d{3})+),(\d+)", m)
    if x:
        return en_letras(int(x.group(1).replace(".", ""))) + " coma " + _decimales(x.group(2))
    x = re.fullmatch(r"(\d+)([.,])(\d+)", m)
    if x:
        return _numero(x.group(1)) + (" coma " if x.group(2) == "," else " punto ") + _decimales(x.group(3))
    if m.isdigit():
        return _cifras(m) if len(m) > 1 and m[0] == "0" else en_letras(int(m))
    return " ".join(_numero(p) for p in re.split(r"[.,]", m) if p)


def leer(texto):
    s = str(texto or "")
    s = re.sub(r"\b([01]?\d|2[0-3]):([0-5]\d)\b",
               lambda m: en_letras(int(m.group(1))) + (" y " + en_letras(int(m.group(2))) if int(m.group(2)) else ""), s)
    s = re.sub(r"US\$\s?(\d[\d.,]*)", r"\1 dólares", s)
    s = re.sub(r"€\s?(\d[\d.,]*)", r"\1 euros", s)
    s = re.sub(r"\$\s?(\d[\d.,]*\d|\d)(\s*(?:pesos|d[oó]lares|euros))?", lambda m: m.group(1) + (m.group(2) or " pesos"), s)
    s = re.sub(r"(\d)\s?%", r"\1 por ciento", s)
    s = re.sub(r"(\d)\s?°\s?[CF]\b", r"\1 grados", s)
    s = re.sub(r"(\d)\s?°", r"\1 grados", s)

    def numero(m):
        t = _numero(m.group(0))
        sigue = m.string[m.end():]
        if t.endswith("uno") and re.match(r"\s+[a-záéíóúñ]", sigue, re.I):
            t = re.sub(r"uno$", "una", t) if FEMENINO.match(sigue) else _apocope(t)
        return t
    s = re.sub(r"\d+(?:[.,]\d+)*", numero, s)
    return re.sub(r"\s{2,}", " ", s)


# ------------------------------------------------------------------ la voz
class TtsSupertonic:
    def __init__(self, carpeta, estilo="F4", sr_destino=SR_DESTINO):
        self.carpeta = carpeta
        self.sr_destino = sr_destino
        self.agudo = 1.0
        self.pasos = PASOS
        self._lock = threading.Lock()
        with open(os.path.join(carpeta, "onnx", "tts.json")) as f:
            self.cfg = json.load(f)
        with open(os.path.join(carpeta, "onnx", "unicode_indexer.json")) as f:
            self.indice = json.load(f)
        op = ort.SessionOptions()
        op.intra_op_num_threads = HILOS
        self.redes = {n: ort.InferenceSession(os.path.join(carpeta, "onnx", n + ".onnx"), op, providers=["CPUExecutionProvider"])
                      for n in ("duration_predictor", "text_encoder", "vector_estimator", "vocoder")}
        self.sr_origen = self.cfg["ae"]["sample_rate"]
        self._estilos = {}
        self.estilo = estilo
        self._rng = np.random.default_rng()

    def _estilo(self, nombre):
        if nombre not in self._estilos:
            with open(os.path.join(self.carpeta, "voice_styles", nombre + ".json")) as f:
                v = json.load(f)
            self._estilos[nombre] = tuple(np.array(v[k]["data"], dtype=np.float32).reshape(1, *v[k]["dims"][1:])
                                          for k in ("style_ttl", "style_dp"))
        return self._estilos[nombre]

    def _ids(self, texto):
        t = re.sub(r"\s+", " ", unicodedata.normalize("NFKD", leer(texto))).strip()
        if not re.search(r"[.!?;:,'\")\]}…]$", t):
            t += "."
        t = "<es>%s</es>" % t
        ids = np.array([[self.indice[ord(c)] if ord(c) < len(self.indice) else -1 for c in t]], dtype=np.int64)
        return ids, np.ones((1, 1, ids.shape[1]), dtype=np.float32)

    def sintetizar(self, texto):
        """texto -> PCM 16 bit LE mono a sr_destino (bytes)."""
        texto = (texto or "").strip()
        if not texto:
            return b""
        agudo = max(0.8, float(self.agudo or 1.0))
        ttl, dp = self._estilo(self.estilo)
        ids, m = self._ids(texto)
        sr, trozo = self.sr_origen, self.cfg["ae"]["base_chunk_size"] * self.cfg["ttl"]["chunk_compress_factor"]
        dim = self.cfg["ttl"]["latent_dim"] * self.cfg["ttl"]["chunk_compress_factor"]
        R = self.redes
        with self._lock:
            dur = R["duration_predictor"].run(None, {"text_ids": ids, "style_dp": dp, "text_mask": m})[0] / (VELOCIDAD / agudo)
            emb = R["text_encoder"].run(None, {"text_ids": ids, "style_ttl": ttl, "text_mask": m})[0]
            largo = max(1, int(float(dur[0]) * sr))
            lat = (largo + trozo - 1) // trozo
            x = self._rng.standard_normal((1, dim, lat)).astype(np.float32)
            ml = np.ones((1, 1, lat), dtype=np.float32)
            total = np.array([self.pasos], dtype=np.float32)
            for k in range(self.pasos):
                x = R["vector_estimator"].run(None, {"noisy_latent": x, "text_emb": emb, "style_ttl": ttl, "text_mask": m,
                                                     "latent_mask": ml, "current_step": np.array([k], dtype=np.float32),
                                                     "total_step": total})[0]
            wav = R["vocoder"].run(None, {"latent": x})[0][0, :largo].astype(np.float64)
        # el tipo de voz (agudo): se genero agudo veces mas lento; al remuestrear como sr*agudo suena mas agudo
        audio = remuestrear(wav * 32767.0 * 0.9 / max(1e-6, float(np.abs(wav).max())), sr * agudo, self.sr_destino)
        return np.clip(np.round(audio), -32768, 32767).astype("<i2").tobytes()

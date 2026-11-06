#!/usr/bin/env python3
"""Fase 7 - Recordatorios locales, guardados en un JSON del proyecto.

El clasificador (qwen2.5:3b) separa que recordar y el trozo de la frase que
dice cuando. Ese trozo se interpreta aqui con reglas y la fecha se calcula
aqui, porque el modelo de 3B no es fiable con horas: se inventaba "de la
mañana" y convertia 7 de la tarde en 17.
"""

import json
import os
import re
import threading
import unicodedata
from datetime import datetime, timedelta

from llm import DIAS, MESES


def _sin_tildes(texto):
    return "".join(c for c in unicodedata.normalize("NFD", texto.lower())
                   if unicodedata.category(c) != "Mn")


_DIAS_PLANOS = [_sin_tildes(d) for d in DIAS]
_DIA_RELATIVO = {"hoy": 0, "manana": 1, "pasado manana": 2}


_NUMEROS = {"un": 1, "una": 1, "uno": 1, "dos": 2, "tres": 3, "cuatro": 4, "cinco": 5,
            "seis": 6, "siete": 7, "ocho": 8, "nueve": 9, "diez": 10, "once": 11, "doce": 12,
            "trece": 13, "catorce": 14, "quince": 15, "dieciseis": 16, "diecisiete": 17,
            "dieciocho": 18, "diecinueve": 19, "veinte": 20, "veinticinco": 25, "treinta": 30,
            "cuarenta": 40, "cuarenta y cinco": 45, "cincuenta": 50, "sesenta": 60, "noventa": 90}
_N = r"(?:\d{1,3}|%s)" % "|".join(sorted(map(re.escape, _NUMEROS), key=len, reverse=True))
_SEGUNDOS = {"segundo": 1, "minuto": 60, "hora": 3600}

# "en 10 minutos", "dentro de una hora y media", "en media hora", "en un cuarto de hora"
_RE_EN = re.compile(r"\b(?:en|dentro de)\s+(?:(?P<fr>media|un cuarto de)\s+hora|"
                    r"(?P<n>%s)\s+(?P<u>segundo|minuto|hora)s?(?P<ymedia>\s+y\s+media)?)\b" % _N)
# "pasado mañana", "hoy", "el viernes", "mañana" (no "de la mañana")
_RE_DIA = re.compile(r"\b(?P<d>pasado manana|hoy|%s)\b|(?<!la )\bmanana\b" % "|".join(_DIAS_PLANOS))
# "a las 3", "a la una", "a las 15:30", "a las 7 y media", "a las 3 y 20", "a las 8 menos cuarto"
_RE_HORA = re.compile(r"\ba\s+las?\s+(?P<h>%s)(?:\s*[:.h]\s*(?P<mm>\d{2})|\s+y\s+(?P<y>cuarto|media|%s)|"
                      r"\s+menos\s+(?P<menos>cuarto|%s))?\b" % (_N, _N, _N))
_RE_MEDIODIA = re.compile(r"\b(?:al|a)\s+(?P<m>mediodia|medianoche)\b")
_RE_PM = re.compile(r"\b(?:de|por) la (?:tarde|noche)\b|\bp\.?\s?m\b")
_RE_AM = re.compile(r"\b(?:de|por) la (?:manana|madrugada)\b|\ba\.?\s?m\b|\bdespiert")


def _num(s):
    return int(s) if s.isdigit() else _NUMEROS[s]


def extraer_hora(texto):
    """Piezas de "cuando" en una frase: {"en_segundos"} o {"dia", "hora", "minuto",
    "periodo"}; {} si no dice cuando. Acepta numeros en cifras o en palabras."""
    p = _sin_tildes(texto)
    m = _RE_EN.search(p)
    if m:
        if m.group("fr"):
            return {"en_segundos": 1800 if m.group("fr") == "media" else 900}
        seg = _num(m.group("n")) * _SEGUNDOS[m.group("u")]
        if m.group("ymedia"):
            seg += _SEGUNDOS[m.group("u")] // 2
        return {"en_segundos": seg}

    piezas = {}
    m = _RE_DIA.search(p)
    if m:
        piezas["dia"] = m.group("d") or "manana"
    m = _RE_HORA.search(p)
    if m:
        hora, minuto = _num(m.group("h")), 0
        if m.group("mm"):
            minuto = int(m.group("mm"))
        elif m.group("y"):
            minuto = {"cuarto": 15, "media": 30}.get(m.group("y")) or _num(m.group("y"))
        elif m.group("menos"):
            hora, minuto = hora - 1, 60 - ({"cuarto": 15}.get(m.group("menos")) or _num(m.group("menos")))
        piezas["hora"], piezas["minuto"] = hora, minuto
    else:
        m = _RE_MEDIODIA.search(p)
        if m:
            piezas["hora"], piezas["minuto"] = (12, 0) if m.group("m") == "mediodia" else (0, 0)
    if _RE_PM.search(p):
        piezas["periodo"] = "pm"
    elif _RE_AM.search(p):
        piezas["periodo"] = "am"
    if "hora" in piezas and not (0 <= piezas["hora"] <= 23 and 0 <= piezas["minuto"] <= 59):
        return {}
    return piezas


def resolver(datos, ahora):
    """Fecha y hora del recordatorio a partir de las piezas de extraer_hora().

    None si no dice cuando, o si dice un dia y esa hora ya paso.
    """
    if datos.get("en_segundos"):
        return ahora + timedelta(seconds=datos["en_segundos"])
    hora = datos.get("hora")
    if hora is None:
        return None
    minuto = datos.get("minuto") or 0

    dia = _sin_tildes(datos.get("dia") or "")
    if dia in _DIA_RELATIVO:
        dias = [ahora.date() + timedelta(days=_DIA_RELATIVO[dia])]
    elif dia in _DIAS_PLANOS:
        hasta = (_DIAS_PLANOS.index(dia) - ahora.weekday()) % 7
        dias = [ahora.date() + timedelta(days=hasta), ahora.date() + timedelta(days=hasta + 7)]
    else:
        dias = [ahora.date(), ahora.date() + timedelta(days=1)]     # la proxima vez que llegue esa hora

    periodo = datos.get("periodo")
    if periodo == "pm" and hora < 12:
        horas = [hora + 12]
    elif periodo == "am":
        horas = [hora % 12]
    elif hora <= 12 and not dia:
        horas = [hora % 12, hora % 12 + 12]     # "a las 5": las 5 o las 17, la que llegue antes
    elif 1 <= hora <= 6:
        horas = [hora + 12]                     # "mañana a las 3": de la tarde
    else:
        horas = [hora]

    for d in dias:
        for h in sorted(horas):
            t = datetime(d.year, d.month, d.day, h, minuto)
            if t > ahora:
                return t
    return None


def hora_hablada(t):
    """"a las 10 y 52 de la mañana", "a la 1 de la tarde", "a las 7 y media de la tarde"."""
    h12 = t.hour % 12 or 12
    minutos = {0: "", 15: " y cuarto", 30: " y media"}.get(t.minute, " y %d" % t.minute)
    if t.hour == 0:
        parte = "de la noche"
    elif t.hour < 6:
        parte = "de la madrugada"
    elif t.hour < 12:
        parte = "de la mañana"
    elif t.hour == 12:
        parte = "del mediodía"
    elif t.hour < 20:
        parte = "de la tarde"
    else:
        parte = "de la noche"
    return "%s %d%s %s" % ("a la" if h12 == 1 else "a las", h12, minutos, parte)


def fecha_de(dia, ahora):
    """Fecha de "hoy", "mañana", "pasado mañana" o un dia de la semana (el proximo, hoy incluido); None si no es ninguno."""
    dia = _sin_tildes(dia or "")
    if dia in _DIA_RELATIVO:
        return ahora.date() + timedelta(days=_DIA_RELATIVO[dia])
    if dia in _DIAS_PLANOS:
        return ahora.date() + timedelta(days=(_DIAS_PLANOS.index(dia) - ahora.weekday()) % 7)
    return None


def dia_hablado(fecha, ahora):
    """"hoy", "mañana" o "el viernes 23"."""
    dias = (fecha - ahora.date()).days
    if dias == 0:
        return "hoy"
    if dias == 1:
        return "mañana"
    return "el %s %d" % (DIAS[fecha.weekday()], fecha.day)


def cuando_hablado(cuando, ahora):
    """"el martes 21 a las 10 y 52 de la mañana" (el mes solo si no es el actual)."""
    dia = "el %s %d" % (DIAS[cuando.weekday()], cuando.day)
    if (cuando.year, cuando.month) != (ahora.year, ahora.month):
        dia += " de %s" % MESES[cuando.month - 1]
    return "%s %s" % (dia, hora_hablada(cuando))


class Agenda:
    """Recordatorios pendientes en un JSON. Segura entre hilos.

    Cada recordatorio: {"id", "texto", "cuando", "creado"}, fechas ISO locales.
    """

    def __init__(self, ruta):
        self.ruta = ruta
        self._lock = threading.Lock()
        self._items = []
        if os.path.exists(ruta):
            with open(ruta, encoding="utf-8") as f:
                self._items = json.load(f)
        self._siguiente = max((r["id"] for r in self._items), default=0) + 1

    def _guardar(self):
        tmp = self.ruta + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self._items, f, ensure_ascii=False, indent=2)
        os.replace(tmp, self.ruta)      # nunca queda un JSON a medias

    def agregar(self, texto, cuando):
        with self._lock:
            r = {"id": self._siguiente, "texto": texto,
                 "cuando": cuando.isoformat(timespec="seconds"),
                 "creado": datetime.now().isoformat(timespec="seconds")}
            self._siguiente += 1
            self._items.append(r)
            self._guardar()
            return dict(r)

    def pendientes(self):
        """Copia de los pendientes, del mas proximo al mas lejano."""
        with self._lock:
            return sorted((dict(r) for r in self._items), key=lambda r: r["cuando"])

    def borrar(self, ids):
        """Borra los de esos ids y los devuelve."""
        with self._lock:
            borrados = [r for r in self._items if r["id"] in ids]
            if borrados:
                self._items = [r for r in self._items if r["id"] not in ids]
                self._guardar()
            return borrados

    def vencidos(self, ahora):
        """Saca de la agenda los que ya tocan y los devuelve en orden."""
        limite = ahora.isoformat(timespec="seconds")
        with self._lock:
            ya = [r for r in self._items if r["cuando"] <= limite]
            if ya:
                self._items = [r for r in self._items if r["cuando"] > limite]
                self._guardar()
        return sorted(ya, key=lambda r: r["cuando"])

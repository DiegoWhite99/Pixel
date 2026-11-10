#!/usr/bin/env python3
"""2.0.0 - La lectura de numeros de la voz Supertonic en el PC (tts_supertonic.leer) debe dar lo mismo que
la de la app (web/voz.js, leer): mismas frases que tools/prueba_modulos.js. No carga el modelo.
    .venv/bin/python tools/prueba_voz.py"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from tts_supertonic import en_letras, leer  # noqa: E402

CASOS = [
    ("Mañana a las 3 de la tarde, el 10 de noviembre de 2026.", "Mañana a las tres de la tarde, el diez de noviembre de dos mil veintiséis."),
    ("Tienes 25 % de batería y hacen 21 °C.", "Tienes veinticinco por ciento de batería y hacen veintiún grados."),
    ("La reunión es a las 15:30 con 1 persona.", "La reunión es a las quince y treinta con una persona."),
    ("Cuesta $ 45.000, o 3,5 dólares.", "Cuesta cuarenta y cinco mil pesos, o tres coma cinco dólares."),
    ("Hola, ¿qué tal?", "Hola, ¿qué tal?"),
]
fallos = 0
for texto, esperado in CASOS:
    ok = leer(texto) == esperado
    fallos += not ok
    print(("BIEN " if ok else "MAL  ") + texto + ("" if ok else "  -> " + leer(texto)))
for n, esperado in ((2500000, "dos millones quinientos mil"), (115, "ciento quince"), (21000, "veintiún mil"), (1000000, "un millón")):
    ok = en_letras(n) == esperado
    fallos += not ok
    print(("BIEN " if ok else "MAL  ") + "%d = %s" % (n, en_letras(n)))
print("TODO BIEN" if not fallos else "%d FALLO(S)" % fallos)
sys.exit(1 if fallos else 0)

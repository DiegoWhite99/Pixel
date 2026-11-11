#!/usr/bin/env python3
"""Prueba de los instaladores: comprueba que Pixel contesto con voz a las dos frases de tools/frase_prueba.wav.

tools/cliente_prueba.py deja cada respuesta en respuesta_01.wav, respuesta_02.wav... en la carpeta actual.
La 1 ("que recordatorios tengo") es una accion sin IA; la 2 ("la capital de Francia"), sin Gemini ni Ollama,
debe decir llm.SIN_IA. Solo libreria estandar (corre con el Python de la maquina de GitHub).

    python3 tools/revisar_respuestas.py [carpeta]
"""
import glob
import os
import sys
import wave


def main(carpeta="."):
    respuestas = sorted(glob.glob(os.path.join(carpeta, "respuesta_*.wav")))
    duraciones = []
    for ruta in respuestas:
        with wave.open(ruta) as w:
            duraciones.append(w.getnframes() / float(w.getframerate()))
    for ruta, d in zip(respuestas, duraciones):
        print("%s: %.1f s de voz" % (os.path.basename(ruta), d))
    if len(respuestas) < 2 or any(d < 1.0 for d in duraciones[:2]):
        print("FALLO: esperaba 2 respuestas con voz y llegaron %d" % len(respuestas))
        return 1
    print("BIEN: Pixel contesto con voz a las dos frases")
    return 0


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:2]))

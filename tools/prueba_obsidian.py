#!/usr/bin/env python3
"""Fase 13 - Pruebas de obsidian.sincronizar con una base de datos falsa (en memoria) y una boveda
temporal: nada toca Firebase ni la boveda de verdad.
    .venv/bin/python tools/prueba_obsidian.py"""

import itertools
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import obsidian  # noqa: E402

UID = "u1"
reloj = itertools.count(1000)
base_datos = {}
ids = itertools.count(1)


def db(metodo, ruta, datos=None):
    """Como nube._db sobre usuarios/<uid>/cerebro[/<id>]"""
    partes = ruta.split("/")
    assert partes[:3] == ["usuarios", UID, "cerebro"], ruta
    if metodo == "GET":
        return {k: dict(v) for k, v in base_datos.items()} or None
    if datos is not None and isinstance(datos.get("actualizado"), dict):
        datos = dict(datos, actualizado=next(reloj))           # el {".sv": "timestamp"} de Firebase
    if metodo == "POST":
        id_ = "-N%04d" % next(ids)
        base_datos[id_] = datos
        return {"name": id_}
    if metodo == "PUT":
        base_datos[partes[3]] = datos
        return datos
    if metodo == "DELETE":
        base_datos.pop(partes[3], None)
        return None
    raise AssertionError(metodo)


fallos = 0


def comprobar(ok, que):
    global fallos
    fallos += not ok
    print(("BIEN " if ok else "MAL  ") + que)


with tempfile.TemporaryDirectory() as base:
    leer = lambda rel: open(os.path.join(base, rel), encoding="utf-8").read()
    # 1. una nota de la app llega a Obsidian, en su carpeta y con su cabecera
    base_datos["-Napp1"] = {"titulo": "Nombre", "texto": "Se llama Diego.", "tipo": "yo", "fijo": False, "actualizado": next(reloj), "origen": "voz"}
    base_datos["-Napp2"] = {"titulo": "Hablar: de tú", "texto": "Le habla de tú.", "tipo": "regla", "fijo": True, "actualizado": next(reloj), "origen": "app"}
    r = obsidian.sincronizar(base, UID, db)
    comprobar(r["a_obsidian"] == 2, "dos notas de la app pasan a Obsidian %s" % r)
    comprobar("Se llama Diego." in leer("Sobre mí/Nombre.md") and "id: -Napp1" in leer("Sobre mí/Nombre.md"), "archivo con cabecera en «Sobre mí»")
    comprobar(os.path.exists(os.path.join(base, "Reglas para Píxel", "Hablar  de tú.md")) or os.path.exists(os.path.join(base, "Reglas para Píxel", "Hablar de tú.md")), "título con «:» saneado")
    comprobar(os.path.exists(os.path.join(base, "LEEME.md")), "LEEME.md creado")
    r = obsidian.sincronizar(base, UID, db)
    comprobar(not any(r.values()), "segunda vuelta sin cambios %s" % r)

    # 2. editar en Obsidian sube a la app
    time.sleep(0.01)
    with open(os.path.join(base, "Sobre mí/Nombre.md"), "w", encoding="utf-8") as g:
        g.write("---\nid: -Napp1\ntipo: yo\nfijo: true\n---\nSe llama Diego Pérez.\n")
    r = obsidian.sincronizar(base, UID, db)
    comprobar(r["a_app"] == 1 and base_datos["-Napp1"]["texto"] == "Se llama Diego Pérez." and base_datos["-Napp1"]["fijo"] is True, "editar en Obsidian cambia la app %s" % r)
    r = obsidian.sincronizar(base, UID, db)
    comprobar(not any(r.values()), "después de subir no rebota %s" % r)

    # 3. una nota nueva en Obsidian (sin id) se crea en la app y recibe su id
    os.makedirs(os.path.join(base, "Gustos"), exist_ok=True)
    with open(os.path.join(base, "Gustos", "Música.md"), "w", encoding="utf-8") as g:
        g.write("Le encanta Queen.\n")
    r = obsidian.sincronizar(base, UID, db)
    nueva = [k for k, v in base_datos.items() if v["titulo"] == "Música"]
    comprobar(r["a_app"] == 1 and nueva and base_datos[nueva[0]]["tipo"] == "gusto" and base_datos[nueva[0]]["origen"] == "obsidian", "nota nueva en Obsidian llega a la app")
    comprobar(nueva and ("id: %s" % nueva[0]) in leer("Gustos/Música.md"), "el archivo recibe su id")

    # 4. mover de carpeta cambia el tipo
    time.sleep(0.01)
    os.makedirs(os.path.join(base, "Proyectos"), exist_ok=True)
    os.rename(os.path.join(base, "Gustos", "Música.md"), os.path.join(base, "Proyectos", "Música.md"))
    r = obsidian.sincronizar(base, UID, db)
    comprobar(base_datos[nueva[0]]["tipo"] == "proyecto", "mover de carpeta cambia el tipo")

    # 5. cambiar en la app reescribe y renombra el archivo
    base_datos["-Napp1"] = dict(base_datos["-Napp1"], titulo="Nombre completo", texto="Se llama Diego C.", actualizado=next(reloj))
    r = obsidian.sincronizar(base, UID, db)
    comprobar(os.path.exists(os.path.join(base, "Sobre mí", "Nombre completo.md")) and not os.path.exists(os.path.join(base, "Sobre mí", "Nombre.md")), "renombrado al cambiar el título en la app")

    # 6. borrar en un lado borra en el otro
    os.remove(os.path.join(base, "Proyectos", "Música.md"))
    r = obsidian.sincronizar(base, UID, db)
    comprobar(nueva[0] not in base_datos, "borrar en Obsidian borra en la app")
    del base_datos["-Napp1"]
    r = obsidian.sincronizar(base, UID, db)
    comprobar(not os.path.exists(os.path.join(base, "Sobre mí", "Nombre completo.md")), "borrar en la app borra en Obsidian")

    # 7. la app vacia no deja el LEEME sin sentido ni rompe nada
    base_datos.clear()
    r = obsidian.sincronizar(base, UID, db)
    comprobar(os.path.exists(os.path.join(base, "LEEME.md")), "sin notas sigue bien %s" % r)

# 8. Fase 14: el grafo. Mismas notas de ejemplo que la prueba "mapa" de prueba_modulos.js (los dos lados
#    deben dar los mismos enlaces)
EJEMPLO = [{"titulo": "Ana", "texto": "Mi hermana; estudia medicina.", "tipo": "persona"},
           {"titulo": "Feria de ciencias", "texto": "Proyecto Píxel con Ana para la feria.", "tipo": "proyecto"},
           {"titulo": "Música", "texto": "Le gusta Queen.", "tipo": "gusto"},
           {"titulo": "Estudio", "texto": "Estudia con MÚSICA de fondo. Ver [[Feria de ciencias]].", "tipo": "yo"}]
comprobar(obsidian.enlaces(EJEMPLO) == [(1, 0), (3, 1), (3, 2)], "enlaces: Feria->Ana, Estudio->Feria y Estudio->Música %s" % obsidian.enlaces(EJEMPLO))

with tempfile.TemporaryDirectory() as base:
    leer = lambda rel: open(os.path.join(base, rel), encoding="utf-8").read()
    base_datos.clear()
    for i, n in enumerate(EJEMPLO):
        base_datos["-Nej%d" % i] = dict(n, fijo=False, actualizado=next(reloj), origen="app")
    obsidian.sincronizar(base, UID, db)
    estudio = leer("Sobre mí/Estudio.md")
    comprobar(obsidian.MARCA in estudio and "[[Sobre mí]] · [[Feria de ciencias]] · [[Música]]" in estudio, "pie de enlaces en la nota")
    comprobar(base_datos["-Nej3"]["texto"] == EJEMPLO[3]["texto"], "el pie no llega a la app")
    comprobar("[[Sobre mí]] (1)" in leer("Tú.md") and "- [[Ana]]" in leer("Personas.md") and "[[Tú]]" in leer("Personas.md"), "notas índice: Tú y una por carpeta")
    # rehacer el pie no cuenta como cambio: la siguiente vuelta no sube nada
    r = obsidian.sincronizar(base, UID, db)
    comprobar(r == {"a_obsidian": 0, "a_app": 0, "borradas": 0}, "estable: el pie no se sube a la app %s" % r)
    # editar el texto en Obsidian si sube (sin el pie) y el pie se rehace
    editado = leer("Gustos/Música.md").replace("Le gusta Queen.", "Le gusta Queen; la oye con Ana.")   # leer antes de abrir para escribir
    with open(os.path.join(base, "Gustos", "Música.md"), "w", encoding="utf-8") as g:
        g.write(editado)
    r = obsidian.sincronizar(base, UID, db)
    comprobar(r["a_app"] == 1 and base_datos["-Nej2"]["texto"] == "Le gusta Queen; la oye con Ana.", "editar en Obsidian sube el texto sin el pie")
    comprobar("[[Gustos]] · [[Ana]]" in leer("Gustos/Música.md"), "y el pie ya la une con Ana")
    r = obsidian.sincronizar(base, UID, db)
    comprobar(not any(r.values()), "y queda estable %s" % r)
    # una carpeta sin notas pierde su indice; un archivo del usuario con nombre de indice no se toca
    with open(os.path.join(base, "Notas.md"), "w", encoding="utf-8") as g:
        g.write("Mis notas sueltas")
    del base_datos["-Nej2"]
    obsidian.sincronizar(base, UID, db)
    comprobar(not os.path.exists(os.path.join(base, "Gustos.md")) and leer("Notas.md") == "Mis notas sueltas", "índices: se quitan los vacíos y no pisa archivos del usuario")
    # colores del grafo
    comprobar(obsidian.colores(base) and '"path:\\"Personas\\""' in leer(".obsidian/graph.json") and not obsidian.colores(base), "colores del grafo una sola vez")

print("TODO BIEN" if not fallos else "%d FALLO(S)" % fallos)
sys.exit(1 if fallos else 0)

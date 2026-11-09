#!/usr/bin/env python3
"""Fase 13 - El cerebro de Pixel en Obsidian: sincroniza una boveda de Obsidian en el PC con las
notas de la app (usuarios/<uid>/cerebro en Firebase), en los dos sentidos.

- Cada nota es un archivo .md en la carpeta de su tipo ("Sobre mí", "Gustos", "Personas",
  "Proyectos", "Reglas para Píxel", "Notas"). El nombre del archivo es el titulo; mover un archivo
  de carpeta le cambia el tipo. Arriba lleva un frontmatter con su id, si es fija y de donde vino.
- Lo que se cambia en un lado aparece en el otro en unos segundos (CADA_S). Si cambio en los dos,
  gana el cambio mas nuevo. Una nota borrada en un lado se borra en el otro.
- .pixel-sync.json (en la boveda) recuerda lo ultimo sincronizado de cada nota: asi se distingue
  una nota nueva de una borrada.
- Solo para las cuentas que lo activaron en la app (usuarios/<uid>/confio/<pid> = true: el usuario
  confia en este PC para leer su cerebro; las reglas solo dejan leerlo asi). Con una sola cuenta
  la boveda es la de esa cuenta; con varias, una subcarpeta por cuenta.
Usa nube._db (la cuenta anonima de este Pixel). Solo libreria estandar.
"""

import hashlib
import json
import os
import re
import threading
import time

CADA_S = 5
TIPOS = {"yo": "Sobre mí", "gusto": "Gustos", "persona": "Personas", "proyecto": "Proyectos",
         "regla": "Reglas para Píxel", "nota": "Notas"}
CARPETAS = {v: k for k, v in TIPOS.items()}
ESTADO = ".pixel-sync.json"
LEEME = """# El cerebro de Píxel

Estas notas son lo que Píxel sabe de ti. Se sincronizan con la app (Personalidad → «Lo que Píxel sabe de ti») cada pocos segundos.

- Cada carpeta es un tipo de nota. **Reglas para Píxel** se cumplen siempre: escribe ahí cómo quieres que se comporte.
- El nombre del archivo es el tema de la nota. Moverla de carpeta le cambia el tipo.
- `fijo: true` en la cabecera hace que Píxel la tenga siempre presente.
- Si borras una nota aquí, también se borra en la app (y al revés).

Este archivo no se sincroniza.
"""

S = None        # modulo del servidor
N = None        # modulo nube
_estado = {"activa": False, "cuentas": {}, "error": "", "ultima": 0.0}


def _log(t):
    if S is not None:
        S.log(t)


# ------------------------------------------------------------------ archivos
def nombre_archivo(titulo):
    """Un nombre valido en Linux, Windows y Obsidian (que no admite * " \\ / < > : | ? # ^ [ ])."""
    t = re.sub(r'[*"\\/<>:|?#^\[\]]', " ", str(titulo or "")).strip().strip(".")
    return re.sub(r"\s+", " ", t)[:100] or "Sin título"


def armar(nota, id_):
    fm = ["---", "id: %s" % id_, "tipo: %s" % nota.get("tipo", "nota"), "fijo: %s" % ("true" if nota.get("fijo") else "false")]
    if nota.get("origen"):
        fm.append("origen: %s" % nota["origen"])
    fm.append("---")
    return "\n".join(fm) + "\n" + str(nota.get("texto", "")).rstrip() + "\n"


def leer(texto):
    """(frontmatter, cuerpo) de un .md"""
    fm = {}
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n?", texto, re.S)
    if m:
        for linea in m.group(1).splitlines():
            if ":" in linea:
                k, v = linea.split(":", 1)
                fm[k.strip()] = v.strip()
        texto = texto[m.end():]
    return fm, texto.strip()


def _hash(datos):
    return hashlib.sha1(datos).hexdigest()


def escanear(base):
    """Los .md de las carpetas de tipos: [{ruta (relativa), id, titulo, tipo, fijo, texto, hash, mtime}]"""
    notas = []
    for carpeta, tipo in CARPETAS.items():
        d = os.path.join(base, carpeta)
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            if not f.endswith(".md"):
                continue
            ruta = os.path.join(d, f)
            with open(ruta, "rb") as g:
                datos = g.read()
            fm, cuerpo = leer(datos.decode("utf-8", "replace"))
            notas.append({"ruta": os.path.relpath(ruta, base), "id": fm.get("id", ""), "titulo": f[:-3], "tipo": tipo,
                          "fijo": fm.get("fijo", "").lower() == "true", "origen": fm.get("origen", ""), "texto": cuerpo,
                          "hash": _hash(datos), "mtime": os.path.getmtime(ruta)})
    return notas


def escribir(base, nota, id_, ruta_vieja=None):
    """Escribe la nota en su carpeta. Devuelve (ruta relativa, hash)."""
    carpeta = TIPOS.get(nota.get("tipo"), TIPOS["nota"])
    os.makedirs(os.path.join(base, carpeta), exist_ok=True)
    rel = os.path.join(carpeta, nombre_archivo(nota.get("titulo")) + ".md")
    ocupada = os.path.join(base, rel)
    if os.path.exists(ocupada) and rel != ruta_vieja:
        with open(ocupada, encoding="utf-8", errors="replace") as g:
            if leer(g.read())[0].get("id") not in ("", id_):     # otra nota con el mismo titulo
                rel = os.path.join(carpeta, "%s (%s).md" % (nombre_archivo(nota.get("titulo")), id_[-4:]))
    datos = armar(nota, id_).encode("utf-8")
    with open(os.path.join(base, rel), "wb") as g:
        g.write(datos)
    if ruta_vieja and ruta_vieja != rel and os.path.exists(os.path.join(base, ruta_vieja)):
        os.remove(os.path.join(base, ruta_vieja))
    return rel, _hash(datos)


def _valida(n):
    return 0 < len(n["texto"]) <= 4000 and len(n["titulo"]) <= 100


# ------------------------------------------------------------------ una vuelta de sincronizacion
def sincronizar(base, uid, db, ahora_ms=None):
    """Una vuelta. db(metodo, ruta, datos) es nube._db. Devuelve un resumen {"a_obsidian", "a_app", "borradas"}."""
    os.makedirs(base, exist_ok=True)
    leeme = os.path.join(base, "LEEME.md")
    if not os.path.exists(leeme):
        with open(leeme, "w", encoding="utf-8") as g:
            g.write(LEEME)
    ruta_estado = os.path.join(base, ESTADO)
    try:
        with open(ruta_estado, encoding="utf-8") as g:
            estado = json.load(g)
    except (OSError, ValueError):
        estado = {}
    remoto = db("GET", "usuarios/%s/cerebro" % uid) or {}
    locales = escanear(base)
    por_id = {n["id"]: n for n in locales if n["id"]}
    res = {"a_obsidian": 0, "a_app": 0, "borradas": 0}
    nuevo_estado = {}

    def subir(n, id_=None):
        datos = {"titulo": n["titulo"], "texto": n["texto"], "tipo": n["tipo"], "fijo": n["fijo"],
                 "actualizado": {".sv": "timestamp"}, "origen": "obsidian"}
        if id_:
            db("PUT", "usuarios/%s/cerebro/%s" % (uid, id_), datos)
            return id_
        return db("POST", "usuarios/%s/cerebro" % uid, datos)["name"]

    for id_, n in remoto.items():
        if not isinstance(n, dict) or "texto" not in n:
            continue
        l, e = por_id.get(id_), estado.get(id_)
        if l is None:
            if e and n.get("actualizado") == e.get("remoto"):      # se borro en Obsidian
                db("DELETE", "usuarios/%s/cerebro/%s" % (uid, id_), None)
                res["borradas"] += 1
                continue
            rel, h = escribir(base, n, id_)                         # nueva en la app (o cambio mientras)
            nuevo_estado[id_] = {"ruta": rel, "hash": h, "remoto": n.get("actualizado")}
            res["a_obsidian"] += 1
            continue
        iguales = (l["titulo"] == nombre_archivo(n.get("titulo")) and l["tipo"] == n.get("tipo")
                   and l["texto"] == str(n.get("texto", "")).strip() and l["fijo"] == bool(n.get("fijo")))
        if not e:                                                   # primera vez con las dos: manda la app
            cambio_local, cambio_remoto = False, not iguales
        else:
            cambio_local = l["hash"] != e.get("hash") or l["ruta"] != e.get("ruta")   # editado, renombrado o movido
            cambio_remoto = n.get("actualizado") != e.get("remoto")
            if cambio_local and cambio_remoto:                      # en los dos lados: gana el mas nuevo
                if l["mtime"] * 1000 > (n.get("actualizado") or 0):
                    cambio_remoto = False
                else:
                    cambio_local = False
        if cambio_local:
            if _valida(l):
                subir(l, id_)
                res["a_app"] += 1
            nuevo_estado[id_] = {"ruta": l["ruta"], "hash": l["hash"], "remoto": None}   # el "actualizado" lo pone Firebase
        elif cambio_remoto and not iguales:
            rel, h = escribir(base, n, id_, l["ruta"])
            nuevo_estado[id_] = {"ruta": rel, "hash": h, "remoto": n.get("actualizado")}
            res["a_obsidian"] += 1
        else:
            nuevo_estado[id_] = {"ruta": l["ruta"], "hash": l["hash"], "remoto": n.get("actualizado")}

    for l in locales:
        if l["id"] and l["id"] in remoto:
            continue
        if l["id"] and l["id"] in estado:                           # se borro en la app
            os.remove(os.path.join(base, l["ruta"]))
            res["borradas"] += 1
            continue
        if not _valida(l):
            continue
        id_ = subir(l, l["id"] or None)                             # nueva en Obsidian
        nota = dict(l, origen="obsidian")
        rel, h = escribir(base, nota, id_, l["ruta"])
        nuevo_estado[id_] = {"ruta": rel, "hash": h, "remoto": None}
        res["a_app"] += 1

    with open(ruta_estado, "w", encoding="utf-8") as g:
        json.dump(nuevo_estado, g, ensure_ascii=False, indent=1)
    return res


# ------------------------------------------------------------------ hilo
def _cuentas():
    """Las cuentas duenas de este Pixel que activaron Obsidian en la app."""
    out = {}
    for uid, d in dict(N._estado.get("duenos") or {}).items():
        try:
            if N._db("GET", "usuarios/%s/confio/%s" % (uid, N._pid())):
                out[uid] = (d or {}).get("nombre") or uid[:6]
        except Exception:
            pass
    return out


def _bucle():
    base = os.path.expanduser(S.OBSIDIAN_BOVEDA)
    revisado = 0.0
    while True:
        try:
            if time.time() - revisado > 60 or not _estado["cuentas"]:
                _estado["cuentas"] = _cuentas()
                revisado = time.time()
            cuentas = _estado["cuentas"]
            for uid, nombre in cuentas.items():
                destino = base if len(cuentas) == 1 else os.path.join(base, nombre_archivo(nombre))
                r = sincronizar(destino, uid, N._db)
                if any(r.values()):
                    _log("obsidian: %d a Obsidian, %d a la app, %d borradas (%s)" % (r["a_obsidian"], r["a_app"], r["borradas"], nombre))
            _estado.update(error="", ultima=time.time())
        except Exception as e:
            if str(e)[:200] != _estado["error"]:
                _log("obsidian: %s: %s" % (type(e).__name__, e))
            _estado["error"] = str(e)[:200]
        time.sleep(CADA_S if _estado["cuentas"] else 30)


def iniciar(modulo_servidor, modulo_nube):
    global S, N
    S, N = modulo_servidor, modulo_nube
    if not S.OBSIDIAN_BOVEDA:
        return
    _estado["activa"] = True
    threading.Thread(target=_bucle, daemon=True, name="obsidian").start()
    _log("obsidian: bóveda en %s (se activa por cuenta desde la app)" % os.path.expanduser(S.OBSIDIAN_BOVEDA))


def estado():
    return {"activa": _estado["activa"], "cuentas": len(_estado["cuentas"]), "error": _estado["error"],
            "boveda": os.path.expanduser(S.OBSIDIAN_BOVEDA) if S and S.OBSIDIAN_BOVEDA else ""}

#!/usr/bin/env python3
"""Fase 13 - Un ESP32 puente simulado: habla con Firebase igual que el firmware (Pixel_portal.ino,
parte de puente), pero en el PC y sin hardware. Sirve para probar la app sin la placa, y es la
referencia del protocolo del puente:

  1. Entra en Firebase con una cuenta anonima (Identity Toolkit por REST): su uid es su id de puente.
  2. Al enlazarse (el ESP32 lo hace cuando el celular le pasa el uid por Bluetooth; aqui --dueno):
       pixeles/<id>/duenos/<uid>     = {nombre, desde}
       usuarios/<uid>/pixeles/<id>   = {nombre, desde, tipo: "puente"}
  3. Publica pixeles/<id>/estado = {json: '{"tipo":"puente","capacidades":[...],...}', t} y un latido
     en pixeles/<id>/vivo cada 10 s.
  4. Escucha pixeles/<id>/ordenes por streaming (SSE). Cada orden {uid, ruta, cuerpo (JSON)}:
       /api/aparato     {metodo: ir|rele|wol|http, ...}  -> la ejecuta
       /api/ir/aprender {segundos}                        -> devuelve {codigo}
     y contesta en pixeles/<id>/respuestas/<id_orden> = {uid, ok, mensaje|error, codigo?, t}; luego
     borra la orden.
Solo libreria estandar. Al salir borra sus datos y su cuenta.
    python3 tools/puente_simulado.py --dueno <uid> [--segundos 300]
Imprime una linea JSON por cada orden ejecutada (para las pruebas)."""

import argparse
import json
import signal
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

CLAVE = "AIzaSyAKcuXL3qvNDCUPUlZXjrSOUKW3k4z2hZ8"       # publica, la misma de la app
DB = "https://pixelassitance-default-rtdb.firebaseio.com"
SV = {".sv": "timestamp"}
CAPACIDADES = ["ir", "rele", "wol", "http"]
CODIGO_APRENDIDO = "nec:0x20DF10EF"                     # lo que "lee" el receptor infrarrojo simulado

auth = {"id": "", "uid": "", "vence": 0}


def _json(url, datos=None, metodo=None):
    cuerpo = None if datos is None else json.dumps(datos).encode()
    req = urllib.request.Request(url, data=cuerpo, method=metodo or ("POST" if cuerpo else "GET"),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as r:
        t = r.read()
        return json.loads(t) if t else None


def entrar():
    r = _json("https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=" + CLAVE, {"returnSecureToken": True})
    auth.update(id=r["idToken"], uid=r["localId"], vence=time.time() + int(r["expiresIn"]) - 120)


def db(metodo, ruta, datos=None):
    return _json("%s/%s.json?auth=%s" % (DB, ruta, urllib.parse.quote(auth["id"])), datos, metodo)


def ejecutar(ruta, cuerpo):
    """Lo que haria el firmware. Devuelve (ok, mensaje, extra)."""
    if ruta == "/api/ir/aprender":
        time.sleep(1.0)                                  # "apunta el control y aprieta"
        return True, "aprendido", {"codigo": CODIGO_APRENDIDO}
    if ruta != "/api/aparato":
        return False, "Esa orden no existe en el ESP32.", {}
    m = cuerpo.get("metodo")
    if m == "rele":
        if not isinstance(cuerpo.get("pin"), int):
            return False, "Falta el pin del relé.", {}
        return True, "relé %s en el pin %d" % ({1: "encendido", 0: "apagado", -1: "cambiado"}.get(cuerpo.get("estado"), "?"), cuerpo["pin"]), {}
    if m == "ir":
        if not str(cuerpo.get("codigo") or "").startswith(("nec:", "raw:")):
            return False, "Código infrarrojo no válido.", {}
        return True, "infrarrojo enviado", {}
    if m == "wol":
        return True, "paquete enviado", {}
    if m == "http":
        return True, "llamada hecha", {}
    return False, "El ESP32 no sabe hacer eso.", {}


def escuchar(ruta, al_cambiar, parar):
    """Streaming de la Realtime Database (SSE), como nube._escuchar."""
    while not parar.is_set():
        try:
            req = urllib.request.Request("%s/%s.json?auth=%s" % (DB, ruta, urllib.parse.quote(auth["id"])), headers={"Accept": "text/event-stream"})
            with urllib.request.urlopen(req, timeout=60) as r:
                evento = None
                for linea in r:
                    if parar.is_set():
                        return
                    linea = linea.decode().rstrip("\n")
                    if linea.startswith("event:"):
                        evento = linea[6:].strip()
                    elif linea.startswith("data:") and evento in ("put", "patch"):
                        d = json.loads(linea[5:])
                        al_cambiar(d["path"], d["data"])
                    elif evento in ("auth_revoked", "cancel"):
                        break
        except Exception:
            time.sleep(2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dueno", required=True)
    ap.add_argument("--nombre", default="ESP32 de prueba")
    ap.add_argument("--segundos", type=int, default=600)
    a = ap.parse_args()

    def terminar(*_):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, terminar)              # que limpie tambien si lo matan
    entrar()
    pid, uid = auth["uid"], a.dueno
    ahora = int(time.time() * 1000)
    db("PUT", "pixeles/%s/duenos/%s" % (pid, uid), {"nombre": "app", "desde": ahora})
    db("PUT", "usuarios/%s/pixeles/%s" % (uid, pid), {"nombre": a.nombre, "desde": ahora, "tipo": "puente"})
    db("PUT", "pixeles/%s/estado" % pid, {"json": json.dumps({"tipo": "puente", "nombre": a.nombre, "capacidades": CAPACIDADES,
                                                               "ip": "192.168.1.143", "ir_rx": True, "version": "simulado"}), "t": SV})
    print(json.dumps({"listo": pid}), flush=True)
    parar = threading.Event()
    vistas = set()
    lock = threading.Lock()

    def al_orden(ruta, datos):
        ordenes = {ruta.strip("/"): datos} if ruta != "/" else (datos or {})
        for id_, o in ordenes.items():
            if not isinstance(o, dict) or "/" in id_:
                continue
            with lock:
                if id_ in vistas:
                    continue
                vistas.add(id_)
            try:
                cuerpo = json.loads(o.get("cuerpo") or "{}")
            except ValueError:
                cuerpo = {}
            if o.get("uid") != uid:
                ok, texto, extra = False, "Esta app no es mi dueña.", {}
            else:
                ok, texto, extra = ejecutar(o.get("ruta"), cuerpo)
            print(json.dumps({"ruta": o.get("ruta"), "cuerpo": cuerpo, "ok": ok, "mensaje": texto}, ensure_ascii=False), flush=True)
            respuesta = dict(extra, uid=o.get("uid"), ok=ok, t=SV)
            respuesta["mensaje" if ok else "error"] = texto
            db("PUT", "pixeles/%s/respuestas/%s" % (pid, id_), respuesta)
            db("DELETE", "pixeles/%s/ordenes/%s" % (pid, id_))

    threading.Thread(target=escuchar, args=("pixeles/%s/ordenes" % pid, al_orden, parar), daemon=True).start()
    fin = time.time() + a.segundos
    try:
        while time.time() < fin:
            if time.time() > auth["vence"]:
                break                                        # una prueba no dura una hora
            db("PUT", "pixeles/%s/vivo" % pid, SV)
            for _ in range(10):
                time.sleep(1)
                if time.time() >= fin:
                    break
    except KeyboardInterrupt:
        pass
    finally:
        parar.set()
        for ruta in ("usuarios/%s/pixeles/%s" % (uid, pid), "pixeles/%s" % pid):
            try:
                db("DELETE", ruta)
            except Exception:
                pass
        try:
            _json("https://identitytoolkit.googleapis.com/v1/accounts:delete?key=" + CLAVE, {"idToken": auth["id"]})
        except Exception:
            pass
        print(json.dumps({"fin": pid}), flush=True)


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Fase 8 - Bluetooth del PC: altavoces, auriculares y moviles, con bluetoothctl y pactl.

El ESP32-S3 solo tiene Bluetooth de bajo consumo y no puede conectarse a altavoces
ni a moviles; el PC si (BlueZ). Lo que el asistente abre en el navegador (YouTube)
suena por la salida de audio del PC, asi que "Usar para la musica" la manda a un
altavoz Bluetooth conectado. Lo usa panel.py; las operaciones lentas (emparejar,
conectar, buscar) corren en un hilo y su progreso sale en estado()["operacion"].
"""

import os
import re
import subprocess
import threading
import time

BUSCAR_S = 12           # cuanto dura una busqueda
VISIBLE_S = 120         # cuanto queda el PC visible para que un movil lo empareje
CACHE_S = 4             # el panel pregunta cada 3 s: no relanzar bluetoothctl en cada pregunta
MAX_DISPOSITIVOS = 25

_RE_ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]|[\x01\x02]")
_RE_MAC = re.compile(r"^[0-9A-F]{2}(:[0-9A-F]{2}){5}$")
_ENV = dict(os.environ, LC_ALL="C")
_lock = threading.Lock()
_cache = {"t": 0.0, "datos": None}
_op = {"accion": "", "mac": "", "estado": "", "mensaje": "", "t": 0.0}
_buscando_hasta = 0.0
_visible_hasta = 0.0
_agente = None          # bluetoothctl con agente que acepta emparejamientos mientras el PC esta visible
_sink_pc = ""           # salida de audio del PC (no Bluetooth), para volver a ella


def _correr(args, timeout=15):
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=timeout, env=_ENV)
        return _RE_ANSI.sub("", r.stdout + r.stderr)
    except (subprocess.TimeoutExpired, OSError) as e:
        return "ERROR %s" % type(e).__name__


def _ctl(*args, timeout=15):
    return _correr(["bluetoothctl"] + list(args), timeout)


def _campos(texto):
    """'\tName: X\n\tPaired: yes' -> {'Name': 'X', 'Paired': 'yes'}"""
    d = {}
    for linea in texto.splitlines():
        if ":" in linea and linea.startswith(("\t", " ")):
            k, v = linea.strip().split(":", 1)
            d.setdefault(k.strip(), v.strip())
    return d


def _tipo(icono, clase):
    if icono.startswith("audio") or icono in ("multimedia-player",):
        return "audio"
    if icono == "phone":
        return "movil"
    if icono.startswith("input"):
        return "control"
    if icono == "computer":
        return "ordenador"
    return "otro" if (icono or clase) else ""


def _rssi(info):
    partes = info.get("RSSI", "").split()
    try:
        return int(partes[0]) if partes else None
    except ValueError:
        return None


def _sinks():
    """(sinks Bluetooth {mac: nombre_sink}, sink por defecto); recuerda la salida del PC."""
    global _sink_pc
    sinks = {}
    for linea in _correr(["pactl", "list", "short", "sinks"]).splitlines():
        partes = linea.split("\t")
        if len(partes) > 1 and partes[1].startswith("bluez_sink."):
            mac = partes[1].split(".")[1].replace("_", ":").upper()
            sinks[mac] = partes[1]
    defecto = ""
    for linea in _correr(["pactl", "info"]).splitlines():
        if linea.startswith("Default Sink:"):
            defecto = linea.split(":", 1)[1].strip()
    if defecto.startswith("alsa_output"):
        _sink_pc = defecto
    return sinks, defecto


def _sink_alsa():
    """La salida de audio del PC: la ultima vista por defecto, o la primera ALSA activa."""
    if _sink_pc:
        return _sink_pc
    alsa = [l.split("\t") for l in _correr(["pactl", "list", "short", "sinks"]).splitlines() if "\talsa_output" in l]
    vivas = [p[1] for p in alsa if len(p) > 4 and p[4] in ("RUNNING", "IDLE")]
    return (vivas or [p[1] for p in alsa] or [""])[0]


def _vivo():
    """Lo que cambia entre consultas: operacion en curso (con hace cuantos s), busqueda, visibilidad."""
    ahora = time.monotonic()
    op = dict(_op, hace=int(ahora - _op["t"]) if _op["t"] else None)
    op.pop("t")
    return {"operacion": op, "buscando": ahora < _buscando_hasta,
            "visible_s": max(0, int(_visible_hasta - ahora))}


def estado():
    """Bluetooth del PC para el panel (con cache de CACHE_S)."""
    with _lock:
        if _cache["datos"] is not None and time.monotonic() - _cache["t"] < CACHE_S:
            return dict(_cache["datos"], **_vivo())
    bloqueado = "Soft blocked: yes" in _correr(["rfkill", "list", "bluetooth"])
    show = _campos(_ctl("show"))
    hay = bool(show) and "No default controller" not in show.get("Controller", "")
    encendido = show.get("Powered") == "yes" and not bloqueado
    sinks, defecto = _sinks()
    dispositivos = []
    if encendido:
        for linea in _ctl("devices").splitlines():
            partes = linea.split(" ", 2)
            if len(partes) < 2 or partes[0] != "Device" or not _RE_MAC.match(partes[1]):
                continue
            mac = partes[1]
            info = _campos(_ctl("info", mac))
            nombre = info.get("Name") or info.get("Alias", "")
            tipo = _tipo(info.get("Icon", ""), info.get("Class", ""))
            emparejado = info.get("Paired") == "yes"
            if not emparejado and (not tipo or not info.get("Name")):
                continue                    # lo que no dice ni que es ni como se llama (balizas LE)
            dispositivos.append({
                "mac": mac, "nombre": nombre, "tipo": tipo, "emparejado": emparejado,
                "conectado": info.get("Connected") == "yes", "rssi": _rssi(info),
                "musica": sinks.get(mac) is not None and sinks.get(mac) == defecto,
                "puede_musica": mac in sinks,
            })
    dispositivos.sort(key=lambda d: (not d["conectado"], not d["emparejado"], d["nombre"].lower()))
    musica = next((d["nombre"] for d in dispositivos if d["musica"]), "")
    datos = {"hay": hay, "encendido": encendido, "bloqueado": bloqueado, "nombre_pc": show.get("Alias", ""),
             "dispositivos": dispositivos[:MAX_DISPOSITIVOS], "musica_en": musica or "los altavoces del PC"}
    with _lock:
        _cache.update(t=time.monotonic(), datos=datos)
    return dict(datos, **_vivo())


def _invalidar():
    with _lock:
        _cache["t"] = 0.0


def _en_hilo(accion, mac, funcion):
    """Corre una operacion lenta y deja su resultado en _op para el panel."""
    if _op["estado"] == "en_curso" and time.monotonic() - _op["t"] < 60:
        raise RuntimeError("Espera: todavía estoy con %s." % _op["accion"])
    _op.update(accion=accion, mac=mac, estado="en_curso", mensaje="", t=time.monotonic())

    def hilo():
        try:
            ok, mensaje = funcion()
        except Exception as e:
            ok, mensaje = False, "%s: %s" % (type(e).__name__, e)
        _op.update(estado="ok" if ok else "error", mensaje=mensaje, t=time.monotonic())
        _invalidar()

    threading.Thread(target=hilo, daemon=True).start()


def encender():
    _correr(["rfkill", "unblock", "bluetooth"])
    time.sleep(1.0)
    salida = _ctl("power", "on")
    _invalidar()
    if "succeeded" not in salida and "Changing power on" not in salida:
        raise RuntimeError("No pude encender el Bluetooth del PC: %s" % salida.strip()[-120:])


def apagar():
    _ctl("power", "off")
    _invalidar()


def buscar():
    global _buscando_hasta
    _buscando_hasta = time.monotonic() + BUSCAR_S

    def hilo():
        _ctl("--timeout", str(BUSCAR_S), "scan", "on", timeout=BUSCAR_S + 5)
        _invalidar()

    threading.Thread(target=hilo, daemon=True).start()


def _comprobar(mac):
    if not _RE_MAC.match(mac or ""):
        raise ValueError("Esa dirección Bluetooth no es válida.")


def emparejar(mac):
    """Empareja (Just Works, sin PIN), lo marca de confianza y lo conecta."""
    _comprobar(mac)

    def trabajo():
        salida = _ctl("--agent", "NoInputNoOutput", "pair", mac, timeout=40)
        if "Pairing successful" not in salida and "Already Paired" not in salida and "AlreadyExists" not in salida:
            return False, "No se pudo emparejar. Pon el aparato en modo emparejar (suele ser mantener el botón de Bluetooth) y prueba otra vez."
        _ctl("trust", mac)
        salida = _ctl("connect", mac, timeout=25)
        if "Connection successful" in salida:
            return True, "Emparejado y conectado."
        return True, "Emparejado. No se conectó solo: pulsa Conectar."

    _en_hilo("emparejar", mac, trabajo)


def conectar(mac):
    _comprobar(mac)

    def trabajo():
        salida = _ctl("connect", mac, timeout=25)
        if "Connection successful" in salida:
            return True, "Conectado."
        return False, "No se pudo conectar. ¿Está encendido y cerca?"

    _en_hilo("conectar", mac, trabajo)


def desconectar(mac):
    _comprobar(mac)
    _ctl("disconnect", mac, timeout=15)
    _invalidar()


def olvidar(mac):
    _comprobar(mac)
    _ctl("remove", mac, timeout=15)
    _invalidar()


def usar_para_musica(mac):
    """Manda el audio del PC (y lo que ya suena) al altavoz Bluetooth; mac vacia = altavoces del PC."""
    sinks, _ = _sinks()
    if mac:
        _comprobar(mac)
        destino = sinks.get(mac)
        if not destino:
            raise RuntimeError("Ese dispositivo no está conectado como altavoz.")
    else:
        destino = _sink_alsa()
        if not destino:
            raise RuntimeError("No sé cuál es la salida de audio del PC.")
    _correr(["pactl", "set-default-sink", destino])
    for linea in _correr(["pactl", "list", "short", "sink-inputs"]).splitlines():
        if linea.split("\t")[0].isdigit():
            _correr(["pactl", "move-sink-input", linea.split("\t")[0], destino])
    _invalidar()


def hacer_visible():
    """El PC visible VISIBLE_S segundos: un movil lo empareja desde sus ajustes y se acepta solo."""
    global _agente, _visible_hasta
    if _agente is not None and _agente.poll() is None:
        _visible_hasta = time.monotonic() + VISIBLE_S
        return
    _agente = subprocess.Popen(["bluetoothctl"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT, text=True, env=_ENV, bufsize=1)
    proc = _agente
    _visible_hasta = time.monotonic() + VISIBLE_S

    def escribir(cmd):
        try:
            proc.stdin.write(cmd + "\n")
            proc.stdin.flush()
        except (OSError, ValueError):
            pass

    for cmd in ("agent NoInputNoOutput", "default-agent", "pairable on", "discoverable on"):
        escribir(cmd)

    def leer():         # contesta "yes" a las preguntas del agente mientras esta visible
        for linea in proc.stdout:
            linea = _RE_ANSI.sub("", linea)
            if "(yes/no)" in linea:
                escribir("yes")
            m = re.search(r"Device ([0-9A-F:]{17}) Paired: yes", linea)
            if m:
                escribir("trust " + m.group(1))
                _op.update(accion="visible", mac=m.group(1), estado="ok", mensaje="Móvil emparejado.", t=time.monotonic())
                _invalidar()

    def cerrar():
        while time.monotonic() < _visible_hasta:
            time.sleep(1)
        for cmd in ("discoverable off", "pairable off", "quit"):
            escribir(cmd)
        time.sleep(1)
        if proc.poll() is None:
            proc.terminate()
        _invalidar()

    threading.Thread(target=leer, daemon=True).start()
    threading.Thread(target=cerrar, daemon=True).start()
    _invalidar()

#!/usr/bin/env python3
"""Fase 15 (12 nov) - La ventana de musica del PC: YouTube siempre en la misma ventana.

Pedido del usuario: "le digo pon en YouTube tal cosa ... quiero que se abra una pestana en el navegador y suene
la musica; que use la misma ventana, no tiene que generar un monton de ventanas por solicitud". Antes cada
cancion era un xdg-open / os.startfile: una pestana (o ventana) nueva cada vez.

Se abre un Chrome (o Edge) aparte, con su propio perfil (PERFIL) y el puerto de depuracion solo en 127.0.0.1.
Cada cancion abre su pestana en ESA ventana y cierra las anteriores: queda una sola, sonando. Si esa ventana
no esta (la primera vez o si se cerro), se abre otra. Sin Chrome ni Edge devuelve None y acciones._abrir usa
el navegador de siempre. En ese perfil se puede entrar a YouTube una vez y queda (cuenta, sin anuncios...).
Solo libreria estandar: el protocolo de depuracion de Chrome por HTTP (/json/list, /json/new, /json/close).
"""

import json
import os
import shutil
import subprocess
import threading
import time
import urllib.parse
import urllib.request

PUERTO = 9333
WINDOWS = os.name == "nt"
if WINDOWS:
    PERFIL = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "Pixel", "navegador")
else:
    PERFIL = os.path.join(os.environ.get("XDG_CACHE_HOME") or os.path.join(os.path.expanduser("~"), ".cache"), "pixel", "navegador")
LINUX = ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "microsoft-edge-stable",
         "brave-browser")
EXTRA = []                      # pruebas: ["--headless=new"]
LOG = print
_lock = threading.Lock()


def _cdp(ruta, metodo="GET", timeout=2.0):
    req = urllib.request.Request("http://127.0.0.1:%d%s" % (PUERTO, ruta), method=metodo)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        cuerpo = r.read()
    try:
        return json.loads(cuerpo)
    except ValueError:
        return None


def _paginas():
    """Las pestanas de la ventana de musica, o None si no esta abierta."""
    try:
        lista = _cdp("/json/list")
    except OSError:
        return None
    return [t for t in lista or [] if isinstance(t, dict) and t.get("type") == "page"]


def ejecutable():
    if WINDOWS:
        for base in (os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)"), os.environ.get("LOCALAPPDATA")):
            for rel in (("Google", "Chrome", "Application", "chrome.exe"), ("Microsoft", "Edge", "Application", "msedge.exe")):
                if base and os.path.exists(os.path.join(base, *rel)):
                    return os.path.join(base, *rel)
        return None
    return next((shutil.which(n) for n in LINUX if shutil.which(n)), None)


def abrir(url):
    """Pone url en la ventana de musica (la abre si hace falta). -> 0, o None si no hay Chrome ni Edge."""
    with _lock:
        pestanas = _paginas()
        if pestanas is None:
            exe = ejecutable()
            if not exe:
                return None
            os.makedirs(PERFIL, exist_ok=True)
            args = [exe, "--remote-debugging-port=%d" % PUERTO, "--remote-debugging-address=127.0.0.1",
                    "--user-data-dir=" + PERFIL, "--no-first-run", "--no-default-browser-check",
                    "--autoplay-policy=no-user-gesture-required", "--disable-features=Translate"] + EXTRA + ["--new-window", url]
            kw = {"stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL}
            if WINDOWS:
                kw["creationflags"] = 0x00000008 | 0x00000200       # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
            else:
                kw["start_new_session"] = True
            subprocess.Popen(args, **kw)
            LOG("navegador: ventana de música abierta con %s" % os.path.basename(exe))
            for _ in range(40):                     # que la siguiente cancion ya la encuentre
                if _paginas() is not None:
                    break
                time.sleep(0.25)
            return 0
        nueva = _cdp("/json/new?" + urllib.parse.quote(url, safe=":/?&=%#"), "PUT")
        for p in pestanas:                          # una sola pestana: la de la cancion nueva
            try:
                _cdp("/json/close/" + p["id"])
            except OSError:
                pass
        if isinstance(nueva, dict) and nueva.get("id"):
            try:
                _cdp("/json/activate/" + nueva["id"])
            except OSError:
                pass
        return 0

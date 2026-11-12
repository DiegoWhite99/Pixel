#!/usr/bin/env python3
"""Fase 15 (12 nov) - La ventana de Pixel en el PC: su panel de control (web/escritorio.html) en una ventana propia.

Pedido del usuario: "no desplegar un servidor web, necesito una ventana en Windows donde se vea Pixel". El lanzador
(pixel_lanzador.py) la abre como otro proceso (iniciar.py --ventana <url>): cerrarla no apaga a Pixel, que sigue
escuchando al robot y a las apps; el acceso directo la vuelve a abrir. El panel sigue siendo el de panel.py, pero
solo en este PC (127.0.0.1), sin que se vea un navegador.

  - Windows: pywebview con el motor de Edge que ya trae Windows (WebView2), con su icono en la barra de tareas.
    Una sola ventana: si ya hay una abierta, se trae al frente.
  - Linux, o si en Windows falla lo anterior: Chrome, Chromium o Edge en modo aplicacion (--app: sin barra de
    direcciones ni pestanas); si no hay ninguno, el navegador de siempre.
"""

import os
import shutil
import subprocess
import sys
import webbrowser

TITULO = "Píxel · Panel de control"
ANCHO, ALTO = 1200, 780
MINIMO = (960, 640)
FONDO = "#040b1d"                   # el de escritorio.css: sin destello blanco al abrir
ID_APP = "DivergencyIA.Pixel"       # Windows: la ventana sale en la barra de tareas como Pixel, con su icono
WINDOWS = os.name == "nt"
NAVEGADORES_APP = ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
                   "microsoft-edge", "microsoft-edge-stable", "brave-browser")
LOG = print
_mutex = None


def _ya_abierta():
    """Windows: True si ya hay una ventana de Pixel (y la trae al frente). Un mutex con nombre por sesion."""
    global _mutex
    import ctypes
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.CreateMutexW.restype = ctypes.c_void_p
    _mutex = k32.CreateMutexW(None, False, "Local\\PixelVentanaPanel")
    if ctypes.get_last_error() != 183:          # ERROR_ALREADY_EXISTS
        return False
    u32 = ctypes.windll.user32
    h = u32.FindWindowW(None, TITULO)
    if h:
        u32.ShowWindow(h, 9)                    # SW_RESTORE
        u32.SetForegroundWindow(h)
    return True


def _encender(app):
    """Arranca a Pixel en segundo plano (el boton «Encender Pixel» de la ventana, si se apago desde ella)."""
    cmd = [sys.executable, "-I", "-X", "utf8", os.path.join(app, "iniciar.py"), "--sin-ventana"]
    kw = {"stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL, "close_fds": True}
    if WINDOWS:
        kw["creationflags"] = 0x00000008 | 0x00000200       # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    else:
        kw["start_new_session"] = True
    subprocess.Popen(cmd, **kw)
    LOG("ventana: encendiendo a Píxel")


class _Api:
    """Lo que escritorio.js puede pedir a la ventana (window.pywebview.api)."""

    def __init__(self, app):
        self._app = app

    def encender(self):
        _encender(self._app)
        return True

    def cerrar(self):
        import webview
        for w in list(webview.windows):
            w.destroy()
        return True


def _pywebview(url, datos, app):
    import ctypes
    import webview
    try:
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(ID_APP)
    except (AttributeError, OSError):
        pass
    icono = os.path.normpath(os.path.join(app, "..", "pixel.ico"))
    webview.create_window(TITULO, url, width=ANCHO, height=ALTO, min_size=MINIMO, background_color=FONDO,
                          js_api=_Api(app))
    LOG("ventana: abierta (motor de Edge de Windows)")
    webview.start(gui="edgechromium", icon=icono if os.path.exists(icono) else None, private_mode=False,
                  storage_path=os.path.join(datos, "ventana"))


def _ruta_edge():
    for base in (os.environ.get("ProgramFiles(x86)"), os.environ.get("ProgramFiles"), os.environ.get("LOCALAPPDATA")):
        if base:
            ruta = os.path.join(base, "Microsoft", "Edge", "Application", "msedge.exe")
            if os.path.exists(ruta):
                return ruta
    return None


def _modo_aplicacion(url):
    """Chrome / Chromium / Edge con --app: una ventana sin barra de direcciones. False si no hay ninguno."""
    exe = _ruta_edge() if WINDOWS else next((shutil.which(n) for n in NAVEGADORES_APP if shutil.which(n)), None)
    if not exe:
        return False
    subprocess.Popen([exe, "--app=" + url, "--window-size=%d,%d" % (ANCHO, ALTO), "--disable-features=Translate"],
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     **({} if WINDOWS else {"start_new_session": True}))
    LOG("ventana: abierta en modo aplicación con %s" % os.path.basename(exe))
    return True


def mostrar(url, datos, app, log=print):
    """Abre la ventana del panel y espera a que se cierre (en Windows). -> 0."""
    global LOG
    LOG = log
    if WINDOWS:
        try:
            if _ya_abierta():
                LOG("ventana: ya estaba abierta; la traigo al frente")
                return 0
            _pywebview(url, datos, app)
            return 0
        except Exception as e:             # sin WebView2, sin .NET o cualquier fallo: que al menos se vea el panel
            LOG("ventana: no pude abrir la ventana propia (%s: %s)" % (type(e).__name__, e))
    try:
        if _modo_aplicacion(url):
            return 0
    except OSError as e:
        LOG("ventana: no pude abrir el modo aplicación (%s)" % e)
    LOG("ventana: abro el panel en el navegador")
    webbrowser.open(url)
    return 0

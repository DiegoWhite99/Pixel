#!/usr/bin/env python3
"""Fase 17 (2.6.1, 18 nov) - Actualizar Pixel desde su ventana.

Pedido del usuario: "en el panel de control, que haya un boton que llame las versiones mas recientes y se actualicen
y reciba notificaciones; me toca descargar todo el tiempo".

Solo en el programa instalado: instalador/pixel_lanzador.py llama configurar(). Desde el codigo (el PC del proyecto,
servidor.py a mano o con su servicio) no se activa: ahi se actualiza con git.
- Buscar: la ultima version publicada en GitHub (releases/latest, que no da las de prueba), a los 90 s de arrancar,
  cada 6 horas y con el boton "Buscar actualizaciones". Si hay una mas nueva: el aviso en la ventana y una
  notificacion del escritorio (Linux, notify-send), una sola vez por version (actualizacion.json en los datos).
- Actualizar: baja el paquete de este sistema y el SHA256SUMS de esa version, comprueba la huella y
    Linux: pkexec dpkg -i (Ubuntu pide la contrasena en su ventanita) y Pixel se reinicia solo: si corre como
      servicio (pixel-asistente.service, Restart=on-failure) sale con 75 y systemd lo vuelve a arrancar; si no, deja
      un "sleep 3; pixel --sin-ventana" y sale (la ventana que estaba abierta se reconecta sola);
    Windows: el instalador en silencio (/S) en la misma carpeta; cierra Pixel y lo vuelve a abrir (.onInstSuccess).
Las funciones puras (version_tupla, mas_nueva, leer_publicacion, huella_en, nombre_paquete) y el flujo con la red
simulada se prueban en tests/test_actualizar.py.
"""

import hashlib
import json
import os
import subprocess
import threading
import time
import urllib.request

REPO = "DiegoWhite99/Pixel"
API = "https://api.github.com/repos/%s/releases/latest" % REPO
DESCARGAS = "https://github.com/%s/releases/download/" % REPO
PRIMERA_S = 90                  # la primera busqueda, cuando Pixel ya arranco
CADA_S = 6 * 3600
WINDOWS = os.name == "nt"
SALIDA_SERVICIO = 75            # con Restart=on-failure, systemd vuelve a arrancar a Pixel

_lock = threading.Lock()
_conf = {"activo": False, "version": "", "datos": "", "carpeta": "", "programa": "/usr/bin/pixel", "log": print}
_estado = {"buscando": False, "ultima": "", "pagina": "", "revisado": 0, "error": "",
           "instalando": False, "fase": "", "avance": 0, "total": 0}


# ------------------------------------------------------------------ puro
def version_tupla(v):
    """"v2.6.1" -> (2, 6, 1); () si no es una version X.Y.Z."""
    partes = str(v or "").strip().lstrip("vV").split(".")
    if len(partes) != 3 or not all(p.isdigit() for p in partes):
        return ()
    return tuple(int(p) for p in partes)


def mas_nueva(nueva, actual):
    a, b = version_tupla(nueva), version_tupla(actual)
    return bool(a) and bool(b) and a > b


def nombre_paquete(version, windows=None):
    windows = WINDOWS if windows is None else windows
    return ("Pixel-%s-Setup.exe" if windows else "pixel_%s_amd64.deb") % version


def leer_publicacion(d):
    """La respuesta de GitHub (releases/latest) -> {version, archivos {nombre: url}, pagina}, o None si no sirve.
    Solo se aceptan descargas de este repositorio."""
    if not isinstance(d, dict) or d.get("draft") or d.get("prerelease"):
        return None
    version = str(d.get("tag_name") or "").lstrip("vV")
    if not version_tupla(version):
        return None
    archivos = {}
    for a in d.get("assets") or []:
        if not isinstance(a, dict):
            continue
        nombre, url = str(a.get("name") or ""), str(a.get("browser_download_url") or "")
        if nombre and url.startswith(DESCARGAS + "v" + version + "/"):
            archivos[nombre] = url
    pagina = str(d.get("html_url") or "")
    return {"version": version, "archivos": archivos,
            "pagina": pagina if pagina.startswith("https://github.com/%s/releases/" % REPO) else ""}


def huella_en(sumas, nombre):
    """La huella SHA-256 de nombre en un SHA256SUMS ("<huella>  <archivo>" por linea), o ""."""
    for linea in str(sumas or "").splitlines():
        partes = linea.split()
        if len(partes) == 2 and partes[1].lstrip("*") == nombre and len(partes[0]) == 64:
            return partes[0].lower()
    return ""


def _corto(e):
    return (str(e) or e.__class__.__name__)[:160]


# ------------------------------------------------------------------ estado
def configurar(version, datos, carpeta="", programa="/usr/bin/pixel", log=print, vigilar=True):
    """Lo llama el lanzador del programa instalado. carpeta: donde esta instalado (Windows, para /D=)."""
    _conf.update(activo=True, version=version, datos=datos, carpeta=carpeta, programa=programa, log=log)
    if vigilar:
        threading.Thread(target=_vigilar, daemon=True, name="actualizar").start()


def estado():
    """Lo que ve la ventana (panel.estado -> "actualizacion")."""
    if not _conf["activo"]:
        return {"activo": False}
    with _lock:
        e = dict(_estado)
    e.update(activo=True, actual=_conf["version"], hay=mas_nueva(e["ultima"], _conf["version"]),
             sistema="windows" if WINDOWS else "linux")
    return e


def _fase(texto, **mas):
    with _lock:
        _estado.update(fase=texto, **mas)


def _ruta(nombre):
    return os.path.join(_conf["datos"], nombre)


def _leer_json(ruta):
    try:
        with open(ruta, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _pedir(url, timeout=30):
    cab = {"User-Agent": "Pixel/%s" % _conf["version"]}
    if url == API:
        cab["Accept"] = "application/vnd.github+json"          # las descargas no la llevan (redirigen a otro servidor)
    return urllib.request.urlopen(urllib.request.Request(url, headers=cab), timeout=timeout)


# ------------------------------------------------------------------ buscar y avisar
def revisar(avisar=True):
    """Busca la ultima version publicada. -> la publicacion, o None (el error queda en el estado)."""
    with _lock:
        _estado.update(buscando=True, error="")
    try:
        with _pedir(API, timeout=20) as r:
            pub = leer_publicacion(json.loads(r.read().decode("utf-8")))
        if pub is None:
            raise ValueError("GitHub no dio una versión publicada")
        with _lock:
            _estado.update(ultima=pub["version"], pagina=pub["pagina"], revisado=int(time.time()))
        if avisar and mas_nueva(pub["version"], _conf["version"]):
            _avisar(pub["version"])
        return pub
    except Exception as e:
        with _lock:
            _estado["error"] = "No pude buscar versiones nuevas (%s). ¿Hay internet?" % _corto(e)
        _conf["log"]("actualizar: no pude buscar la ultima version: %s" % e)
        return None
    finally:
        with _lock:
            _estado["buscando"] = False


def _avisar(version):
    """La notificacion del escritorio, una vez por version."""
    ruta = _ruta("actualizacion.json")
    d = _leer_json(ruta)
    if d.get("avisada") == version:
        return
    _conf["log"]("actualizar: hay una version nueva, %s (tengo la %s)" % (version, _conf["version"]))
    if _notificar("Píxel %s ya está disponible" % version,
                  "Abre el Panel de control de Píxel y toca «Actualizar». Tienes la %s." % _conf["version"]):
        d["avisada"] = version
        try:
            with open(ruta, "w", encoding="utf-8") as f:
                json.dump(d, f)
        except OSError:
            pass


def _notificar(titulo, texto):
    """Notificacion del escritorio. En Windows no hay (queda el aviso de la ventana): devuelve True igual."""
    if WINDOWS:
        return True
    try:
        r = subprocess.run(["notify-send", "-a", "Píxel", "-i", "pixel", titulo, texto], timeout=10,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return r.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def _vigilar():
    time.sleep(PRIMERA_S)
    while True:
        if not _estado["instalando"]:
            revisar()
        time.sleep(CADA_S)


# ------------------------------------------------------------------ actualizar
def instalar():
    """Empieza a bajar e instalar la ultima version, en otro hilo. -> el mensaje para la ventana."""
    if not _conf["activo"]:
        raise RuntimeError("Este Píxel corre desde el código: se actualiza con git, no con este botón.")
    with _lock:
        if _estado["instalando"]:
            return "Ya estoy actualizando Píxel."
        _estado.update(instalando=True, fase="Buscando la última versión…", avance=0, total=0, error="")
    threading.Thread(target=_instalar, daemon=True, name="actualizar-instalar").start()
    return "Actualizando Píxel: lo bajo, lo instalo y se reinicia solo."


def _instalar():
    try:
        pub = revisar(avisar=False)
        if pub is None:
            raise RuntimeError(_estado["error"] or "no pude buscar la última versión")
        if not mas_nueva(pub["version"], _conf["version"]):
            _fase("", instalando=False)
            with _lock:
                _estado["error"] = ""
            return
        nombre = nombre_paquete(pub["version"])
        url, url_sumas = pub["archivos"].get(nombre), pub["archivos"].get("SHA256SUMS")
        if not url or not url_sumas:
            raise RuntimeError("la versión %s no trae el paquete de este sistema" % pub["version"])
        with _pedir(url_sumas) as r:
            huella = huella_en(r.read().decode("utf-8", "replace"), nombre)
        if not huella:
            raise RuntimeError("la versión %s no trae la huella de su paquete" % pub["version"])
        carpeta = _ruta("actualizacion")
        os.makedirs(carpeta, exist_ok=True)
        destino = os.path.join(carpeta, nombre)
        if not (os.path.exists(destino) and _sha256(destino) == huella):
            _bajar(url, destino, huella, pub["version"])
        _conf["log"]("actualizar: %s bajado y con su huella; lo instalo" % nombre)
        _fase("Instalando Píxel %s…" % pub["version"])
        if WINDOWS:
            _instalar_windows(destino)
        else:
            _instalar_linux(destino, pub["version"])
    except Exception as e:
        _conf["log"]("actualizar: no pude: %s" % e)
        with _lock:
            _estado.update(instalando=False, fase="", error="No pude actualizar: %s" % _corto(e))


def _sha256(ruta):
    h = hashlib.sha256()
    with open(ruta, "rb") as f:
        for trozo in iter(lambda: f.read(1 << 20), b""):
            h.update(trozo)
    return h.hexdigest()


def _bajar(url, destino, huella, version):
    tmp = destino + ".parte"
    with _pedir(url, timeout=60) as r:
        total = int(r.headers.get("Content-Length") or 0)
        _fase("Bajando Píxel %s…" % version, avance=0, total=total)
        hecho = 0
        with open(tmp, "wb") as f:
            for trozo in iter(lambda: r.read(1 << 16), b""):
                f.write(trozo)
                hecho += len(trozo)
                with _lock:
                    _estado["avance"] = hecho
    if _sha256(tmp) != huella:
        os.remove(tmp)
        raise RuntimeError("el paquete llegó dañado (huella distinta); vuelve a intentarlo")
    os.replace(tmp, destino)


def _instalar_linux(ruta, version):
    _fase("Instalando Píxel %s: Ubuntu te pide tu contraseña…" % version)
    try:
        r = subprocess.run(["pkexec", "dpkg", "-i", ruta], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=900)
    except FileNotFoundError:
        raise RuntimeError("falta pkexec; instálalo a mano con: sudo apt install %s" % ruta)
    if r.returncode == 126:                             # se cerro la ventanita de la contrasena
        raise RuntimeError("cancelaste la contraseña; vuelve a tocar «Actualizar»")
    if r.returncode == 127:                             # contrasena mala, o Ubuntu no pudo mostrar su ventanita
        raise RuntimeError("Ubuntu no dejó instalarlo (contraseña equivocada o sin ventana para pedirla). "
                           "Instálalo a mano con: sudo apt install %s" % ruta)
    if r.returncode != 0:
        salida = r.stdout.decode("utf-8", "replace").strip().splitlines()
        raise RuntimeError("dpkg falló (%s)" % (salida[-1] if salida else r.returncode))
    _conf["log"]("actualizar: Píxel %s instalado; me reinicio" % version)
    _fase("Píxel %s instalado. Reiniciando…" % version)
    threading.Timer(2.0, _reiniciar).start()           # que la ventana alcance a ver la fase


def _en_servicio():
    try:
        with open("/proc/self/cgroup", encoding="utf-8") as f:
            return "pixel-asistente.service" in f.read()
    except OSError:
        return False


def _reiniciar():
    if _en_servicio():
        os._exit(SALIDA_SERVICIO)
    subprocess.Popen(["sh", "-c", 'sleep 3; exec "$0" --sin-ventana', _conf["programa"]], start_new_session=True,
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=True)
    os._exit(0)


def _instalar_windows(ruta):
    args = [ruta, "/S"] + (["/D=" + _conf["carpeta"]] if _conf["carpeta"] else [])   # /D= va al final y sin comillas
    flags = 0x00000008 | 0x00000200          # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP: que no muera con Pixel
    try:
        subprocess.Popen(args, creationflags=flags | 0x01000000, close_fds=True)     # + CREATE_BREAKAWAY_FROM_JOB
    except OSError:
        subprocess.Popen(args, creationflags=flags, close_fds=True)
    _fase("Instalando: Píxel se cierra y vuelve a abrir solo en un momento.")

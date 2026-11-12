#!/usr/bin/env python3
"""Instaladores (11 nov) - Lanzador de Pixel para los paquetes .deb (Linux) y .exe (Windows).

Pedido del usuario: "que se descargue y se instale en el equipo de la persona, despues pedirle que se
vincule con su cuenta". El paquete trae un Python 3.10 propio, las dependencias y el codigo compilado;
este lanzador:
  1. usa una carpeta de datos del usuario (Linux ~/.local/share/pixel, Windows %LOCALAPPDATA%\\Pixel\\datos):
     ahi van los ajustes, la identidad en la nube, las claves que pegue en el panel, las voces y Whisper.
     Nunca escribe en la carpeta del programa (en Linux, /opt/pixel es de solo lectura);
  2. abre la ventana de Pixel (pixel_ventana.py, en otro proceso; 12 nov: "no desplegar un servidor web, necesito
     una ventana") con su panel de control (web/escritorio.html). Mientras baja la voz y el oido la primera vez
     (unos 600 MB, con su huella SHA-256 comprobada), una pagina de espera en el puerto del panel sirve ese mismo
     panel y su avance (/progreso);
  3. arranca el servidor (servidor.main) con sus rutas en esa carpeta, como el "servidor de prueba aislado"
     de CLAUDE.md: no hace falta tocar servidor.py. El panel escucha solo en este PC (127.0.0.1). Cuando el de
     verdad arranca, la ventana sigue sola y alli se vincula Pixel con la cuenta (codigo de 6 cifras).

Uso:  pixel [--sin-ventana] [--consola]        (--sin-navegador = --sin-ventana: el acceso de inicio de Windows)
      pixel --ventana [url]                    solo la ventana (la abre el propio lanzador)
Pruebas: PIXEL_DATOS, PIXEL_PUERTO, PIXEL_PANEL, PIXEL_DESCUBRIR, PIXEL_NUBE_DB ("" o "0" = sin nube), PIXEL_LLM_HOST.
La prueba de punta a punta de los paquetes publicados: .github/workflows/probar_instaladores.yml.
Opcional, en la carpeta de datos: config.json {"nombre": "Píxel de la sala"} (como sale en la app al buscarlo).
"""

import hashlib
import json
import os
import subprocess
import sys
import threading
import time
import traceback
import urllib.error
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VERSION = "2.2.1"
APP = os.path.dirname(os.path.abspath(__file__))
WINDOWS = os.name == "nt"
REGISTRO_MAX = 5 * 1024 * 1024        # pixel.log: al pasar de esto se guarda como pixel.log.1
CAPTURAS_DIAS = 7                     # las frases grabadas (la voz del usuario) se borran a los 7 dias

# Lo que se baja la primera vez: (ruta en la carpeta de datos, url, bytes, sha256). Versiones fijas: las mismas
# que usa el PC del proyecto (comprobadas el 11 nov contra voces/ del repo).
_PIPER = "https://huggingface.co/rhasspy/piper-voices/resolve/375a0fe641dea077c2a47b4e9a056d6da521eed3/es/es_ES/sharvard/medium/"
_ST = "https://huggingface.co/Supertone/supertonic-3/resolve/3cadd1ee6394adea1bd021217a0e650ede09a323/"
ARCHIVOS = [
    ("voces/es_ES-sharvard-medium.onnx", _PIPER + "es_ES-sharvard-medium.onnx", 76733615,
     "40febfb1679c69a4505ff311dc136e121e3419a13a290ef264fdf43ddedd0fb1"),
    ("voces/es_ES-sharvard-medium.onnx.json", _PIPER + "es_ES-sharvard-medium.onnx.json", 4903,
     "7438c9b699c72b0c3388dae1b68d3f364dc66a2150fe554a1c11f03372957b2c"),
    ("voces/supertonic3/LICENSE", _ST + "LICENSE", 15007,
     "0d944a9110fed9a9602d60e0423a272903e7bd21ab060490774efc77c2275e9f"),
    ("voces/supertonic3/onnx/tts.json", _ST + "onnx/tts.json", 8253,
     "42078d3aef1cd43ab43021f3c54f47d2d75ceb4e75f627f118890128b06a0d09"),
    ("voces/supertonic3/onnx/unicode_indexer.json", _ST + "onnx/unicode_indexer.json", 277676,
     "9bf7346e43883a81f8645c81224f786d43c5b57f3641f6e7671a7d6c493cb24f"),
    ("voces/supertonic3/onnx/duration_predictor.onnx", _ST + "onnx/duration_predictor.onnx", 3700147,
     "c3eb91414d5ff8a7a239b7fe9e34e7e2bf8a8140d8375ffb14718b1c639325db"),
    ("voces/supertonic3/onnx/text_encoder.onnx", _ST + "onnx/text_encoder.onnx", 36416150,
     "c7befd5ea8c3119769e8a6c1486c4edc6a3bc8365c67621c881bbb774b9902ff"),
    ("voces/supertonic3/onnx/vector_estimator.onnx", _ST + "onnx/vector_estimator.onnx", 256534781,
     "883ac868ea0275ef0e991524dc64f16b3c0376efd7c320af6b53f5b780d7c61c"),
    ("voces/supertonic3/onnx/vocoder.onnx", _ST + "onnx/vocoder.onnx", 101424195,
     "085de76dd8e8d5836d6ca66826601f615939218f90e519f70ee8a36ed2a4c4ba"),
] + [("voces/supertonic3/voice_styles/%s.json" % e, _ST + "voice_styles/%s.json" % e, n, h) for e, n, h in (
    ("F1", 292046, "bbdec6ee00231c2c742ad05483df5334cab3b52fda3ba38e6a07059c4563dbc2"),
    ("F2", 292423, "7c722c6a72707b1a77f035d67f0d1351ba187738e06f7683e8c72b1df3477fc6"),
    ("F3", 290794, "12f6ef2573baa2defa1128069cb59f203e3ab67c92af77b42df8a0e3a2f7c6ab"),
    ("F4", 291808, "c2fa764c1225a76dfc3e2c73e8aa4f70d9ee48793860eb34c295fff01c2e032b"),
    ("F5", 291479, "45966e73316415626cf41a7d1c6f3b4c70dbc1ba2bee5c1978ef0ce33244fc8d"),
    ("M1", 291748, "e35604687f5d23694b8e91593a93eec0e4eca6c0b02bb8ed69139ab2ea6b0a5b"),
    ("M2", 292055, "b76cbf62bac707c710cf0ae5aba5e31eea1a6339a9734bfae33ab98499534a50"),
    ("M3", 290198, "ea1ac35ccb91b0d7ecad533a2fbd0eec10c91513d8951e3b25fbba99954e159b"),
    ("M4", 291522, "ca8eefad4fcd989c9379032ff3e50738adc547eeb5e221b82593a6d7b3bac303"),
    ("M5", 291469, "dd22b92740314321f8ae11c5e87f8dd60d060f15dd3a632b5adf77f471f77af2"))]
WHISPER = "base"            # servidor.STT_MODELO; lo baja faster-whisper (Systran/faster-whisper-base, unos 145 MB)

_estado = {"fase": "Arrancando…", "hecho": 0, "total": 0, "error": "", "registro": ""}


def carpeta_datos():
    if os.environ.get("PIXEL_DATOS"):
        return os.path.abspath(os.environ["PIXEL_DATOS"])
    if WINDOWS:
        return os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "Pixel", "datos")
    base = os.environ.get("XDG_DATA_HOME") or os.path.join(os.path.expanduser("~"), ".local", "share")
    return os.path.join(base, "pixel")


def log(texto):
    print("%s lanzador: %s" % (time.strftime("%H:%M:%S"), texto), flush=True)


def abrir_registro(datos, rotar=True):
    """Con pythonw (Windows) o desde el menu no hay consola: todo va a pixel.log en la carpeta de datos.
    La ventana (otro proceso) escribe en el mismo, sin rotarlo: el de Pixel lo tiene abierto."""
    ruta = os.path.join(datos, "pixel.log")
    try:
        if rotar and os.path.getsize(ruta) > REGISTRO_MAX:
            os.replace(ruta, ruta + ".1")
    except OSError:
        pass
    f = open(ruta, "a", encoding="utf-8", buffering=1)
    sys.stdout = sys.stderr = f
    return ruta


def borrar_capturas_viejas(carpeta):
    limite = time.time() - CAPTURAS_DIAS * 86400
    try:
        for n in os.listdir(carpeta):
            ruta = os.path.join(carpeta, n)
            if n.endswith(".wav") and os.path.getmtime(ruta) < limite:
                os.remove(ruta)
    except OSError:
        pass


# ------------------------------------------------------------------ pagina de espera
# Mientras se prepara Pixel, el puerto del panel lo atiende esto: el mismo panel de la ventana (web/escritorio.*),
# /api/estado con 503 (el panel lo entiende como "preparando") y el avance en /progreso.
TIPOS = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
         ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon"}
PREPARANDO = "Píxel todavía se está preparando: espera a que termine."


class _Pagina(BaseHTTPRequestHandler):
    def do_GET(self):
        ruta = self.path.split("?", 1)[0]
        if ruta == "/progreso":
            self._mandar(200, "application/json; charset=utf-8", json.dumps(dict(_estado, version=VERSION)).encode("utf-8"))
            return
        if ruta.startswith("/api/"):
            self._mandar(503, "application/json; charset=utf-8", b'{"preparando": true}')
            return
        nombre = "escritorio.html" if ruta == "/" else ruta[1:]
        carpeta = os.path.join(APP, "web")
        tipo = TIPOS.get(os.path.splitext(nombre)[1])
        if "/" in nombre or "\\" in nombre or tipo is None or nombre not in os.listdir(carpeta):
            self._mandar(404, "text/plain; charset=utf-8", b"No existe.")
            return
        with open(os.path.join(carpeta, nombre), "rb") as f:
            self._mandar(200, tipo, f.read())

    def do_POST(self):
        cuerpo = json.dumps({"error": PREPARANDO}, ensure_ascii=False).encode("utf-8")
        self._mandar(503, "application/json; charset=utf-8", cuerpo)

    def _mandar(self, codigo, tipo, cuerpo):
        self.send_response(codigo)
        self.send_header("Content-Type", tipo)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)

    def log_message(self, *a):
        pass


def pagina_de_espera(puerto):
    """Atiende el puerto del panel hasta que arranque el de verdad. None si esta ocupado."""
    try:
        srv = ThreadingHTTPServer(("127.0.0.1", puerto), _Pagina)
    except OSError as e:
        log("no pude abrir la pagina de espera en el puerto %d (%s)" % (puerto, e))
        return None
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def en_marcha(puerto):
    """"listo" si el panel de Pixel responde, "preparando" si otro lanzador lo esta preparando, "" si no hay nadie."""
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d/api/estado" % puerto, timeout=1.5) as r:
            return "listo" if r.status == 200 else ""
    except urllib.error.HTTPError as e:
        return "preparando" if e.code == 503 else ""
    except Exception:
        return ""


def abrir_ventana(url):
    """La ventana de Pixel en otro proceso (pixel_ventana.py): cerrarla no apaga a Pixel."""
    cmd = [sys.executable, "-I", "-X", "utf8", os.path.join(APP, "iniciar.py"), "--ventana", url]
    kw = {"stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL, "close_fds": True}
    if WINDOWS:
        kw["creationflags"] = 0x00000008 | 0x00000200       # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    else:
        kw["start_new_session"] = True
    try:
        subprocess.Popen(cmd, **kw)
    except OSError as e:
        log("no pude abrir la ventana (%s): abro el panel en el navegador" % e)
        webbrowser.open(url)


# ------------------------------------------------------------------ descargas
def _sha256(ruta):
    h = hashlib.sha256()
    with open(ruta, "rb") as f:
        for trozo in iter(lambda: f.read(1 << 20), b""):
            h.update(trozo)
    return h.hexdigest()


# 12 nov (Windows del usuario, 2.2.0): "No pude preparar a Pixel: <urlopen error [WinError 10054] Se ha forzado la
# interrupcion de una conexion existente por el host remoto>" a los 73 de 456 MB. Antes cada corte volvia a bajar el
# archivo desde cero, a los 3 cortes se rendia y habia que cerrar Pixel a mano. Ahora sigue donde iba (Range), no
# cuenta como fallo un intento que avanzo, guarda lo bajado (.parte) aunque se cierre, y main() reintenta solo.
MAX_FALLOS_SEGUIDOS = 6                 # intentos seguidos sin avanzar nada antes de rendirse (main() reintenta luego)
AVANCE_MINIMO = 1 << 20                 # un intento que bajo al menos 1 MB no cuenta como fallo


def _bajar(url, destino, tam, huella, avance):
    """Baja url a destino siguiendo donde se corto; comprueba tamano y huella SHA-256."""
    tmp = destino + ".parte"
    fallos = 0
    while True:
        tengo = os.path.getsize(tmp) if os.path.exists(tmp) else 0
        if tengo > tam:                                 # sobra algo: no es de este archivo
            avance(-tengo)
            os.remove(tmp)
            tengo = 0
        if tengo < tam:
            bajado = 0
            try:
                cab = {"User-Agent": "Pixel-instalador/%s" % VERSION}
                if tengo:
                    cab["Range"] = "bytes=%d-" % tengo
                with urllib.request.urlopen(urllib.request.Request(url, headers=cab), timeout=60) as r:
                    if tengo and r.status != 206:       # el servidor no sabe seguir: desde cero
                        avance(-tengo)
                        tengo = 0
                    with open(tmp, "ab" if tengo else "wb") as f:
                        for trozo in iter(lambda: r.read(1 << 16), b""):
                            f.write(trozo)
                            bajado += len(trozo)
                            avance(len(trozo))
                if os.path.getsize(tmp) < tam:
                    raise ConnectionError("la descarga se cortó a medias")
            except Exception as e:
                fallos = 0 if bajado >= AVANCE_MINIMO else fallos + 1
                log("descarga cortada %s (%.0f de %.0f MB; %d sin avanzar): %s" % (
                    os.path.basename(destino), os.path.getsize(tmp) / 1048576.0 if os.path.exists(tmp) else 0,
                    tam / 1048576.0, fallos, e))
                if fallos >= MAX_FALLOS_SEGUIDOS:
                    raise
                _estado["fase"] = "Se cortó la conexión: sigo donde iba…"
                time.sleep(min(30, 2 * (fallos + 1)))
                _estado["fase"] = "Bajando la voz de Píxel…"
                continue
        if os.path.getsize(tmp) == tam and _sha256(tmp) == huella:
            os.replace(tmp, destino)
            return
        avance(-os.path.getsize(tmp))                   # llego entero pero distinto: desde cero
        os.remove(tmp)
        fallos += 1
        log("descarga dañada %s (huella distinta), la repito" % os.path.basename(destino))
        if fallos >= MAX_FALLOS_SEGUIDOS:
            raise ValueError("el archivo llegó dañado varias veces (tamaño o huella distintos)")


def bajar_lo_que_falte(datos):
    faltan = [a for a in ARCHIVOS if not (os.path.exists(os.path.join(datos, a[0]))
                                          and os.path.getsize(os.path.join(datos, a[0])) == a[2])]
    if faltan:
        # lo que ya estaba a medias (.parte de una vez anterior) cuenta como hecho: se sigue desde ahi
        ya = sum(min(os.path.getsize(p), a[2]) for a in faltan for p in [os.path.join(datos, a[0]) + ".parte"]
                 if os.path.exists(p))
        _estado.update(fase="Bajando la voz de Píxel…", hecho=ya, total=sum(a[2] for a in faltan))
        log("bajando %d archivos de voz (%.0f MB; ya había %.0f MB)" % (len(faltan), _estado["total"] / 1048576.0, ya / 1048576.0))

        def avance(n):
            _estado["hecho"] += n
        for rel, url, tam, huella in faltan:
            destino = os.path.join(datos, rel)
            os.makedirs(os.path.dirname(destino), exist_ok=True)
            _bajar(url, destino, tam, huella, avance)
    _estado.update(fase="Bajando el oído de Píxel…", hecho=0, total=0)
    from faster_whisper.utils import download_model
    download_model(WHISPER)                 # en HF_HOME (la carpeta de datos); si ya esta, no baja nada


# ------------------------------------------------------------------ el servidor
def configurar(datos):
    """Las rutas del servidor en la carpeta de datos, y los puertos de las pruebas."""
    import panel
    import puente_pc
    import servidor
    servidor.BASE_DIR = datos                       # los .json relativos (ajustes, nube_token, gemini_clave...) y voces/
    servidor.CAPTURE_DIR = os.path.join(datos, "capturas")
    panel.WEB_DIR = os.path.join(APP, "web")        # ruta absoluta: os.path.join(BASE_DIR, ...) la respeta
    for n in ("TV_CERT", "TV_CLAVE", "TV_EMPAREJADOS"):
        setattr(puente_pc, n, os.path.join(datos, os.path.basename(getattr(puente_pc, n))))
    # en el panel, solo las voces que estan en este equipo (las de voces_prueba/ no vienen en el paquete)
    panel.VOCES = [v for v in panel.VOCES if os.path.exists(os.path.join(datos, v[2]))] or panel.VOCES[:1]
    try:
        with open(os.path.join(datos, "config.json"), encoding="utf-8") as f:
            cfg = json.load(f)
        if isinstance(cfg.get("nombre"), str) and cfg["nombre"].strip():
            servidor.NUBE_NOMBRE = cfg["nombre"].strip()[:40]
    except (OSError, ValueError):
        pass
    env = os.environ
    if env.get("PIXEL_PUERTO"):
        servidor.PORT = int(env["PIXEL_PUERTO"])
    if env.get("PIXEL_PANEL"):
        servidor.PANEL_PORT = int(env["PIXEL_PANEL"])
    if env.get("PIXEL_DESCUBRIR") is not None:
        servidor.DESCUBRIR_PORT = int(env["PIXEL_DESCUBRIR"] or 0)
    if "PIXEL_NUBE_DB" in env:              # "" o "0" = sin nube (en Windows una variable no puede quedar vacia)
        servidor.NUBE_DB = "" if env["PIXEL_NUBE_DB"] in ("", "0") else env["PIXEL_NUBE_DB"]
    if env.get("PIXEL_LLM_HOST"):
        servidor.LLM_HOST = env["PIXEL_LLM_HOST"]
    # 12 nov: el panel es la ventana de este PC, no una pagina para toda la red; y desde ella se puede apagar
    panel.DIRECCION = "127.0.0.1"
    panel.PROGRAMA = {"version": VERSION, "apagar": True}

    def apagar(d):
        servidor.log("panel: Píxel apagado desde su ventana")
        threading.Timer(0.6, lambda: os._exit(0)).start()
        return {"mensaje": "Píxel se apaga."}
    panel.RUTAS_SOLO_LOCAL["/api/apagar"] = apagar
    return servidor, panel


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    datos = carpeta_datos()
    os.makedirs(os.path.join(datos, "capturas"), exist_ok=True)
    os.environ.setdefault("HF_HOME", os.path.join(datos, "modelos"))     # Whisper, antes de importar huggingface_hub
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
    if "--consola" not in argv or sys.stdout is None:
        _estado["registro"] = abrir_registro(datos, rotar="--ventana" not in argv)
    else:
        _estado["registro"] = "la consola"
    sys.path.insert(0, APP)
    puerto = int(os.environ.get("PIXEL_PANEL") or 8080)
    url = "http://127.0.0.1:%d/escritorio.html" % puerto
    if "--ventana" in argv:                 # este proceso es solo la ventana (lo abre abrir_ventana)
        i = argv.index("--ventana")
        if len(argv) > i + 1 and argv[i + 1].startswith("http://127.0.0.1:"):
            url = argv[i + 1]
        import pixel_ventana
        return pixel_ventana.mostrar(url, datos, APP, log)
    log("Píxel %s | programa en %s | datos en %s" % (VERSION, APP, datos))
    ventana = "--sin-navegador" not in argv and "--sin-ventana" not in argv
    ya = en_marcha(puerto)
    if ya:
        log("Píxel ya está en marcha (%s): abro su ventana" % ya)
        if ventana:
            abrir_ventana(url)
        return 0
    espera = pagina_de_espera(puerto)
    if ventana:
        abrir_ventana(url)
    borrar_capturas_viejas(os.path.join(datos, "capturas"))
    espera_s = 30
    while True:                             # sin internet o con cortes: reintenta solo, sin tener que cerrar Pixel
        try:
            bajar_lo_que_falte(datos)
            break
        except Exception as e:
            traceback.print_exc()
            _estado["error"] = ("La descarga se cortó (%s). Lo intento otra vez solo en %d s, siguiendo donde iba; "
                                "revisa que haya internet." % (e, espera_s))
            time.sleep(espera_s)
            _estado["error"] = ""
            espera_s = min(espera_s * 2, 300)
    try:
        _estado.update(fase="Cargando la voz y el oído de Píxel…", hecho=0, total=0)
        servidor, panel = configurar(datos)
    except Exception as e:
        traceback.print_exc()
        _estado["error"] = "No pude preparar a Píxel: %s. ¿Hay internet? Ciérralo y ábrelo otra vez." % e
        time.sleep(600 if espera else 0)        # que se alcance a leer el error en la pagina
        return 1
    iniciar_panel = panel.iniciar

    def iniciar_sin_espera(modulo):             # el panel de verdad toma el puerto de la pagina de espera
        if espera is not None:
            espera.shutdown()
            espera.server_close()
        iniciar_panel(modulo)
    panel.iniciar = iniciar_sin_espera
    try:
        servidor.main()
    except Exception:
        traceback.print_exc()
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

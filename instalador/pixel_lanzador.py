#!/usr/bin/env python3
"""Instaladores (11 nov) - Lanzador de Pixel para los paquetes .deb (Linux) y .exe (Windows).

Pedido del usuario: "que se descargue y se instale en el equipo de la persona, despues pedirle que se
vincule con su cuenta". El paquete trae un Python 3.10 propio, las dependencias y el codigo compilado;
este lanzador:
  1. usa una carpeta de datos del usuario (Linux ~/.local/share/pixel, Windows %LOCALAPPDATA%\\Pixel\\datos):
     ahi van los ajustes, la identidad en la nube, las claves que pegue en el panel, las voces y Whisper.
     Nunca escribe en la carpeta del programa (en Linux, /opt/pixel es de solo lectura);
  2. abre el navegador en el panel (http://localhost:8080) con una pagina de "Preparando a Pixel" mientras
     baja la voz y el oido la primera vez (unos 600 MB, con su huella SHA-256 comprobada);
  3. arranca el servidor (servidor.main) con sus rutas en esa carpeta, como el "servidor de prueba aislado"
     de CLAUDE.md: no hace falta tocar servidor.py. Cuando el panel de verdad arranca, la pagina se recarga
     sola y alli se vincula Pixel con la cuenta (codigo de 6 cifras, como siempre).

Uso:  pixel [--sin-navegador] [--consola]
Pruebas: PIXEL_DATOS, PIXEL_PUERTO, PIXEL_PANEL, PIXEL_DESCUBRIR, PIXEL_NUBE_DB ("" o "0" = sin nube), PIXEL_LLM_HOST.
La prueba de punta a punta de los paquetes publicados: .github/workflows/probar_instaladores.yml.
Opcional, en la carpeta de datos: config.json {"nombre": "Píxel de la sala"} (como sale en la app al buscarlo).
"""

import hashlib
import json
import os
import sys
import threading
import time
import traceback
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VERSION = "2.1.0"
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


def abrir_registro(datos):
    """Con pythonw (Windows) o desde el menu no hay consola: todo va a pixel.log en la carpeta de datos."""
    ruta = os.path.join(datos, "pixel.log")
    try:
        if os.path.getsize(ruta) > REGISTRO_MAX:
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


# ------------------------------------------------------------------ pagina de "Preparando a Pixel"
PAGINA = """<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Preparando a Píxel</title>
<style>
:root{--azul:#1971c2;--verde:#087f5b;--texto:#0f2a3d;--suave:#5b7083;--fondo:#f4f9fd}
@media (prefers-color-scheme:dark){:root{--texto:#e7f1fa;--suave:#9fb3c4;--fondo:#0e1b26}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--fondo);color:var(--texto);
font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:16px;box-sizing:border-box}
main{max-width:460px;width:100%;text-align:center}
h1{font-size:24px;margin:0 0 6px}p{margin:6px 0;color:var(--suave)}
.barra{height:12px;border-radius:999px;background:rgba(25,113,194,.15);overflow:hidden;margin:18px 0 8px}
.barra i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--azul),var(--verde));transition:width .4s}
.barra.sin i{width:30%;animation:ir 1.4s ease-in-out infinite}
@keyframes ir{0%{margin-left:-30%}100%{margin-left:100%}}
@media (prefers-reduced-motion:reduce){.barra.sin i{animation:none;width:100%;opacity:.5}}
.error{color:#c92a2a;font-weight:600}code{font-size:13px;word-break:break-all}
</style></head><body><main>
<h1>Preparando a Píxel</h1>
<p id="fase">Un momento…</p>
<div class="barra sin" id="barra"><i></i></div>
<p id="cifras"></p>
<p>La primera vez bajo la voz y el oído de Píxel (unos 600 MB). Después arranca en segundos.</p>
<p id="error" class="error" hidden></p>
</main><script>
const $ = (s) => document.querySelector(s);
const mb = (b) => (b / 1048576).toFixed(0) + " MB";
async function mirar() {
  try {
    const r = await fetch("/api/estado", {cache: "no-store"});
    if (r.ok) { location.reload(); return; }            // ya responde el panel de verdad
    const p = await (await fetch("/progreso", {cache: "no-store"})).json();
    $("#fase").textContent = p.fase;
    const hay = p.total > 0;
    $("#barra").classList.toggle("sin", !hay);
    $("#barra i").style.width = hay ? Math.round(p.hecho / p.total * 100) + "%" : "";
    $("#cifras").textContent = hay ? mb(p.hecho) + " de " + mb(p.total) : "";
    $("#error").hidden = !p.error;
    if (p.error) $("#error").textContent = p.error + " Detalles en " + p.registro;
  } catch (e) { $("#fase").textContent = "Arrancando a Píxel…"; }
  setTimeout(mirar, 1500);
}
mirar();
</script></body></html>"""


class _Pagina(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/progreso"):
            self._mandar(200, "application/json; charset=utf-8", json.dumps(_estado).encode("utf-8"))
        elif self.path.startswith("/api/"):
            self._mandar(503, "application/json; charset=utf-8", b'{"preparando": true}')
        else:
            self._mandar(200, "text/html; charset=utf-8", PAGINA.encode("utf-8"))

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
    """Sirve "Preparando a Pixel" en el puerto del panel hasta que arranque el de verdad. None si esta ocupado."""
    try:
        srv = ThreadingHTTPServer(("127.0.0.1", puerto), _Pagina)
    except OSError as e:
        log("no pude abrir la pagina de espera en el puerto %d (%s)" % (puerto, e))
        return None
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def ya_esta_en_marcha(puerto):
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d/api/estado" % puerto, timeout=1.5) as r:
            return r.status == 200
    except Exception:
        return False


# ------------------------------------------------------------------ descargas
def _sha256(ruta):
    h = hashlib.sha256()
    with open(ruta, "rb") as f:
        for trozo in iter(lambda: f.read(1 << 20), b""):
            h.update(trozo)
    return h.hexdigest()


def _bajar(url, destino, tam, huella, avance):
    tmp = destino + ".parte"
    for intento in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Pixel-instalador/%s" % VERSION})
            with urllib.request.urlopen(req, timeout=60) as r, open(tmp, "wb") as f:
                for trozo in iter(lambda: r.read(1 << 16), b""):
                    f.write(trozo)
                    avance(len(trozo))
            if os.path.getsize(tmp) == tam and _sha256(tmp) == huella:
                os.replace(tmp, destino)
                return
            raise ValueError("el archivo llegó dañado (tamaño o huella distintos)")
        except Exception as e:
            avance(-(os.path.getsize(tmp) if os.path.exists(tmp) else 0))
            log("descarga fallida (%d/3) %s: %s" % (intento + 1, os.path.basename(destino), e))
            if intento == 2:
                raise
            time.sleep(3)
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)


def bajar_lo_que_falte(datos):
    faltan = [a for a in ARCHIVOS if not (os.path.exists(os.path.join(datos, a[0]))
                                          and os.path.getsize(os.path.join(datos, a[0])) == a[2])]
    if faltan:
        _estado.update(fase="Bajando la voz de Píxel…", hecho=0, total=sum(a[2] for a in faltan))
        log("bajando %d archivos de voz (%.0f MB)" % (len(faltan), _estado["total"] / 1048576.0))

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
    return servidor, panel


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    datos = carpeta_datos()
    os.makedirs(os.path.join(datos, "capturas"), exist_ok=True)
    os.environ.setdefault("HF_HOME", os.path.join(datos, "modelos"))     # Whisper, antes de importar huggingface_hub
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
    if "--consola" not in argv or sys.stdout is None:
        _estado["registro"] = abrir_registro(datos)
    else:
        _estado["registro"] = "la consola"
    log("Píxel %s | programa en %s | datos en %s" % (VERSION, APP, datos))
    sys.path.insert(0, APP)
    puerto = int(os.environ.get("PIXEL_PANEL") or 8080)
    url = "http://localhost:%d/" % puerto
    navegador = "--sin-navegador" not in argv
    if ya_esta_en_marcha(puerto):
        log("Píxel ya está en marcha: abro el panel")
        if navegador:
            webbrowser.open(url)
        return 0
    espera = pagina_de_espera(puerto)
    if navegador:
        webbrowser.open(url)
    borrar_capturas_viejas(os.path.join(datos, "capturas"))
    try:
        bajar_lo_que_falte(datos)
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

#!/usr/bin/env python3
"""Fase 13 - El PC como puente: ejecuta las ordenes de aparatos que llegan de la app de internet.

La app (web/aparatos.js) manda las ordenes por la nube (nube.py las ejecuta como los POST del
panel). Aqui estan las rutas:
    /api/pc            el propio PC: volumen, musica (MPRIS), abrir paginas, YouTube, bloquear,
                       apagar la pantalla y suspender
    /api/aparato       Wake-on-LAN (despertar otro PC) y http (enchufes o luces WiFi de la red de casa)
    /api/youtube/buscar  busca un video para el reproductor de la app del celular (yt-dlp)
    /api/tv            un TV Android o Google TV por WiFi (libreria androidtvremote2: el mismo
    /api/tv/emparejar  protocolo que la app "Google TV"). La primera vez se empareja: el TV muestra
    /api/tv/codigo     un codigo de 6 caracteres que se escribe en la app.
El certificado con el que el PC se presenta al TV queda en TV_CERT / TV_CLAVE (fuera de git).
Solo usa la libreria estandar, pactl, playerctl, xset, gdbus y systemctl; androidtvremote2 es opcional.
"""

import asyncio
import ipaddress
import json
import os
import re
import socket
import subprocess
import threading
import urllib.parse
import urllib.request

TV_CERT = "tv_cert.pem"
TV_CLAVE = "tv_clave.pem"
TV_NOMBRE = "Pixel asistente de voz"
TV_TIMEOUT_S = 12
PASO_VOLUMEN = 10           # %
SUSPENDER_TRAS_S = 2        # se contesta antes de suspender
PAGINAS = {"youtube": "https://www.youtube.com", "netflix": "https://www.netflix.com", "spotify": "https://open.spotify.com",
           "gmail": "https://mail.google.com", "correo": "https://mail.google.com", "calendario": "https://calendar.google.com",
           "whatsapp": "https://web.whatsapp.com", "google": "https://www.google.com", "drive": "https://drive.google.com",
           "chatgpt": "https://chatgpt.com", "claude": "https://claude.ai"}
# apps del TV: paquete o enlace que entiende send_launch_app_command
APPS_TV = {"youtube": "https://www.youtube.com", "netflix": "com.netflix.ninja", "prime video": "com.amazon.amazonvideo.livingroom",
           "disney": "com.disney.disneyplus", "spotify": "com.spotify.tv.android", "max": "com.wbd.stream",
           "plex": "com.plexapp.android", "twitch": "tv.twitch.android.app", "ajustes": "com.android.tv.settings"}

S = None                    # modulo del servidor (para el log y las rutas de archivos)


class ErrorPuente(Exception):
    """Algo que se le dice al usuario tal cual."""


def _log(texto):
    if S is not None:
        S.log(texto)


def _ruta(nombre):
    base = os.path.dirname(os.path.abspath(__file__))
    return nombre if os.path.isabs(nombre) else os.path.join(base, nombre)


def _correr(cmd, timeout=6):
    """Ejecuta un comando de escritorio. Devuelve (codigo, salida). Se sustituye en las pruebas."""
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL)
        return p.returncode, (p.stdout + p.stderr).strip()
    except FileNotFoundError:
        return 127, "no esta instalado: %s" % cmd[0]
    except subprocess.TimeoutExpired:
        return 124, "tardo demasiado"


def _abrir(url):
    import acciones
    return acciones._abrir(url)


# ------------------------------------------------------------------ el propio PC
def _volumen(cambio):
    rc, out = _correr(["pactl", "set-sink-volume", "@DEFAULT_SINK@", cambio])
    if rc != 0:
        raise ErrorPuente("No pude cambiar el volumen del PC.")


def _media(orden):
    rc, out = _correr(["playerctl", orden])
    if rc != 0:
        raise ErrorPuente("No hay nada sonando en el PC." if "No players" in out or rc == 1 else "No pude manejar la música del PC.")


def _url_de(valor):
    v = str(valor or "").strip()
    if not v:
        raise ErrorPuente("¿Qué abro en el PC?")
    if re.match(r"^https?://", v):
        return v
    clave = v.lower()
    if clave in PAGINAS:
        return PAGINAS[clave]
    if re.match(r"^[\w-]+(\.[\w-]+)+(/\S*)?$", v):
        return "https://" + v
    return "https://www.google.com/search?q=" + urllib.parse.quote(v)


def _bloquear():
    rc, _ = _correr(["gdbus", "call", "--session", "--dest", "org.gnome.ScreenSaver", "--object-path", "/org/gnome/ScreenSaver",
                     "--method", "org.gnome.ScreenSaver.Lock"])
    if rc != 0:
        rc, _ = _correr(["loginctl", "lock-sessions"])
    if rc != 0:
        raise ErrorPuente("No pude bloquear el PC.")


def _suspender_luego():
    def hilo():
        import time
        time.sleep(SUSPENDER_TRAS_S)
        _log("puente: suspendiendo el PC por orden de la app")
        _correr(["systemctl", "suspend"])
    threading.Thread(target=hilo, daemon=True).start()


def control(d):
    """/api/pc: {accion, valor?} -> {mensaje}"""
    accion, valor = str(d.get("accion") or ""), d.get("valor")
    if accion in ("subir_volumen", "bajar_volumen"):
        _volumen(("+" if accion == "subir_volumen" else "-") + "%d%%" % PASO_VOLUMEN)
    elif accion == "volumen":
        try:
            n = max(0, min(150, int(float(valor))))
        except (TypeError, ValueError):
            raise ErrorPuente("¿A qué volumen? Dime un número del 0 al 100.")
        _volumen("%d%%" % n)
    elif accion == "silenciar":
        if _correr(["pactl", "set-sink-mute", "@DEFAULT_SINK@", "toggle"])[0] != 0:
            raise ErrorPuente("No pude silenciar el PC.")
    elif accion == "pausa":                     # alternar (el boton de los aparatos)
        _media("play-pause")
    elif accion == "pausar":                    # exacto (la musica de la app: "para", "pausa")
        if _correr(["playerctl", "--all-players", "pause"])[0] != 0:
            raise ErrorPuente("No hay nada sonando en el PC.")
    elif accion == "play":
        _media("play")
    elif accion in ("siguiente", "anterior"):
        _media("next" if accion == "siguiente" else "previous")
    elif accion == "abrir":
        if _abrir(_url_de(valor)) not in (0, None):
            raise ErrorPuente("No pude abrir el navegador del PC.")
    elif accion == "youtube":
        import acciones
        consulta = str(valor or "").strip()
        if not consulta:
            _abrir(PAGINAS["youtube"])
            return {"mensaje": "YouTube abierto en el PC."}
        if re.match(r"^https://www\.youtube\.com/watch\?v=[\w-]{11}$", consulta):   # la app ya busco el video
            _abrir(consulta)
            return {"mensaje": consulta}
        vid, titulo = acciones._buscar(consulta)
        if not vid:
            raise ErrorPuente("No encontré %s en YouTube." % consulta)
        _abrir("https://www.youtube.com/watch?v=%s" % vid)
        return {"mensaje": titulo or consulta, "decir": "Listo, puse %s en el PC." % acciones._hablable(titulo or consulta)}
    elif accion == "bloquear":
        _bloquear()
    elif accion == "apagar_pantalla":
        if _correr(["xset", "dpms", "force", "off"])[0] != 0:
            raise ErrorPuente("No pude apagar la pantalla.")
    elif accion in ("suspender", "apagar"):
        _suspender_luego()
        return {"mensaje": "suspendiendo", "decir": "Listo, suspendo el PC."}
    elif accion == "encender":
        return {"mensaje": "ya encendido", "decir": "El PC ya está encendido."}
    else:
        raise ErrorPuente("No sé hacer eso con el PC.")
    _log("puente: PC %s%s" % (accion, " (%s)" % valor if valor not in (None, "") else ""))
    return {"mensaje": accion}


# ------------------------------------------------------------------ Wake-on-LAN y http
def wol(mac):
    """Paquete magico a la red: 6 x FF y 16 veces la MAC, por UDP al puerto 9."""
    limpio = re.sub(r"[^0-9a-fA-F]", "", str(mac or ""))
    if len(limpio) != 12:
        raise ErrorPuente("La MAC no es válida.")
    paquete = b"\xff" * 6 + bytes.fromhex(limpio) * 16
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        for destino in ("255.255.255.255", _broadcast()):
            if destino:
                s.sendto(paquete, (destino, 9))
    return paquete


def _broadcast():
    """La direccion de broadcast de la red del PC (x.y.z.255 para una /24)."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("192.0.2.1", 9))         # no manda nada: solo elige la interfaz de salida
            ip = s.getsockname()[0]
        return str(ipaddress.ip_network(ip + "/24", strict=False).broadcast_address)
    except OSError:
        return ""


def _privada(url):
    """Solo aparatos de la red de casa: la orden viene de internet y no debe servir para llamar a cualquier sitio."""
    p = urllib.parse.urlparse(url)
    if p.scheme not in ("http", "https") or not p.hostname:
        return False
    try:
        ip = ipaddress.ip_address(socket.gethostbyname(p.hostname))
    except (OSError, ValueError):
        return False
    return ip.is_private and not ip.is_loopback


def aparato(d):
    """/api/aparato: {metodo: wol|http, ...} -> {mensaje}"""
    metodo = d.get("metodo")
    if metodo == "wol":
        wol(d.get("mac"))
        _log("puente: Wake-on-LAN a %s" % d.get("mac"))
        return {"mensaje": "paquete enviado"}
    if metodo == "http":
        url = str(d.get("url") or "")
        if not _privada(url):
            raise ErrorPuente("Esa dirección no es de un aparato de tu red de casa.")
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Pixel"}), timeout=6) as r:
                r.read(2000)
        except Exception as e:
            raise ErrorPuente("El aparato no contestó (%s)." % type(e).__name__)
        return {"mensaje": "hecho"}
    if metodo in ("ir", "rele"):
        raise ErrorPuente("Eso lo hace el ESP32, no el PC.")
    raise ErrorPuente("No sé manejar ese aparato.")


# ------------------------------------------------------------------ TV Android / Google TV
class _Tv:
    """Un hilo con su propio bucle asyncio para androidtvremote2; un control por IP, que se reconecta."""

    def __init__(self):
        self.bucle = None
        self.controles = {}
        self.emparejando = {}
        self.lock = threading.Lock()

    def _arrancar(self):
        with self.lock:
            if self.bucle is None:
                self.bucle = asyncio.new_event_loop()
                threading.Thread(target=self.bucle.run_forever, daemon=True, name="tv").start()

    def correr(self, corrutina, timeout=TV_TIMEOUT_S):
        self._arrancar()
        return asyncio.run_coroutine_threadsafe(corrutina, self.bucle).result(timeout)

    async def _nuevo(self, ip):
        from androidtvremote2 import AndroidTVRemote
        r = AndroidTVRemote(TV_NOMBRE, _ruta(TV_CERT), _ruta(TV_CLAVE), ip, enable_ime=False)
        await r.async_generate_cert_if_missing()
        return r

    async def _control(self, ip):
        r = self.controles.get(ip)
        if r is None or r._remote_message_protocol is None:      # sin conexion viva: otra
            r = await self._nuevo(ip)
            await r.async_connect()
            r.keep_reconnecting()
            self.controles[ip] = r
        return r

    async def tecla(self, ip, tecla):
        r = await self._control(ip)
        r.send_key_command("KEYCODE_" + tecla if not tecla.startswith("KEYCODE_") else tecla)

    async def abrir(self, ip, enlace):
        r = await self._control(ip)
        r.send_launch_app_command(enlace)

    async def emparejar(self, ip):
        r = await self._nuevo(ip)
        nombre, _ = await r.async_get_name_and_mac()
        await r.async_start_pairing()
        self.emparejando[ip] = r
        return nombre

    async def codigo(self, ip, codigo):
        r = self.emparejando.pop(ip, None)
        if r is None:
            raise ErrorPuente("Primero toca «Emparejar con el TV».")
        await r.async_finish_pairing(codigo)
        r.disconnect()


TV = _Tv()


def _tv_ok():
    try:
        import androidtvremote2  # noqa: F401
        return True
    except ImportError:
        return False


def _ip_tv(d):
    ip = str(d.get("ip") or "").strip()
    try:
        if not ipaddress.ip_address(ip).is_private:
            raise ValueError
    except ValueError:
        raise ErrorPuente("La IP del TV no es válida.")
    return ip


def _error_tv(e):
    nombre = type(e).__name__
    _log("puente: TV %s: %s" % (nombre, e))
    if nombre == "InvalidAuth":
        return ErrorPuente("El TV no reconoce a Píxel: emparéjalo otra vez desde Dispositivos.")
    if nombre in ("CannotConnect", "TimeoutError", "ConnectionClosed", "OSError", "ConnectionRefusedError"):
        return ErrorPuente("No encuentro el TV. ¿Está encendido y en la misma red WiFi?")
    return ErrorPuente("El TV dio un error: %s" % nombre)


def tv(d):
    """/api/tv: {ip, tecla} o {ip, abrir, valor?}"""
    if not _tv_ok():
        raise ErrorPuente("Falta la librería del TV en el PC (androidtvremote2).")
    ip = _ip_tv(d)
    try:
        if d.get("abrir"):
            app = str(d["abrir"]).lower().strip()
            enlace = APPS_TV.get(app, app)
            if app == "youtube" and d.get("valor"):
                import acciones
                vid, _ = acciones._buscar(str(d["valor"]))
                if vid:
                    enlace = "https://www.youtube.com/watch?v=%s" % vid
            TV.correr(TV.abrir(ip, enlace))
            return {"mensaje": "abierto %s" % app}
        tecla = re.sub(r"[^A-Z0-9_]", "", str(d.get("tecla") or "").upper())
        if not tecla:
            raise ErrorPuente("¿Qué botón del TV?")
        TV.correr(TV.tecla(ip, tecla))
        _log("puente: TV %s %s" % (ip, tecla))
        return {"mensaje": tecla}
    except ErrorPuente:
        raise
    except Exception as e:
        raise _error_tv(e)


def tv_emparejar(d):
    if not _tv_ok():
        raise ErrorPuente("Falta la librería del TV en el PC (androidtvremote2).")
    ip = _ip_tv(d)
    try:
        nombre = TV.correr(TV.emparejar(ip), timeout=20)
    except ErrorPuente:
        raise
    except Exception as e:
        raise _error_tv(e)
    return {"mensaje": "Mira el código de 6 caracteres que muestra %s y escríbelo aquí." % (nombre or "el TV")}


def tv_codigo(d):
    ip = _ip_tv(d)
    codigo = re.sub(r"[^0-9A-Fa-f]", "", str(d.get("codigo") or ""))
    if len(codigo) != 6:
        raise ErrorPuente("El código tiene 6 caracteres (números y letras de la A a la F).")
    try:
        TV.correr(TV.codigo(ip, codigo.upper()), timeout=20)
    except ErrorPuente:
        raise
    except Exception as e:
        if type(e).__name__ == "InvalidAuth":
            raise ErrorPuente("Ese código no es. Vuelve a tocar «Emparejar con el TV».")
        raise _error_tv(e)
    _log("puente: TV %s emparejado" % ip)
    return {"mensaje": "¡Emparejado! Ya puedo manejar el TV."}


# ------------------------------------------------------------------ YouTube para la app del celular
_ydl = None
_ydl_lock = threading.Lock()


def buscar_youtube(d):
    """/api/youtube/buscar: {consulta} -> {resultados: JSON [{id, titulo, canal}]}. La app del celular
    pone el video en su propio reproductor (web/musica.js); el PC solo lo busca (yt-dlp, sin clave)."""
    global _ydl
    consulta = str(d.get("consulta") or "").strip()[:150]
    if not consulta:
        raise ErrorPuente("¿Qué busco en YouTube?")
    with _ydl_lock:
        if _ydl is None:
            import yt_dlp
            _ydl = yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "extract_flat": True, "skip_download": True, "socket_timeout": 10})
        try:
            info = _ydl.extract_info("ytsearch5:" + consulta, download=False)
        except Exception as e:
            raise ErrorPuente("No pude buscar en YouTube (%s)." % type(e).__name__)
    res = [{"id": e.get("id"), "titulo": e.get("title") or "", "canal": e.get("channel") or e.get("uploader") or ""}
           for e in (info or {}).get("entries") or [] if e.get("id") and len(e.get("id")) == 11]
    _log("puente: YouTube '%s' -> %s" % (consulta, res[0]["titulo"] if res else "nada"))
    return {"mensaje": res[0]["titulo"] if res else "", "resultados": json.dumps(res, ensure_ascii=False)}


# ------------------------------------------------------------------ estado
def _mac_pc():
    """La MAC de la interfaz con la ruta por defecto (para encender este PC por Wake-on-LAN)."""
    try:
        with open("/proc/net/route") as f:
            for linea in f.readlines()[1:]:
                campos = linea.split()
                if campos[1] == "00000000":
                    with open("/sys/class/net/%s/address" % campos[0]) as g:
                        return g.read().strip()
    except OSError:
        pass
    return ""


def estado():
    caps = ["pc", "wol", "http", "youtube"] + (["atv"] if _tv_ok() else [])
    return {"capacidades": caps, "mac": _mac_pc()}


def rutas(error_panel):
    """Las rutas para panel.RUTAS_POST, traduciendo ErrorPuente al error del panel."""
    def envolver(f):
        def ruta(d):
            try:
                return f(d or {})
            except ErrorPuente as e:
                raise error_panel(str(e))
        return ruta
    return {"/api/pc": envolver(control), "/api/aparato": envolver(aparato), "/api/tv": envolver(tv),
            "/api/tv/emparejar": envolver(tv_emparejar), "/api/tv/codigo": envolver(tv_codigo),
            "/api/youtube/buscar": envolver(buscar_youtube)}


if __name__ == "__main__":
    print(estado())

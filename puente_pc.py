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

12 nov (el usuario, con el programa en Windows: "no puedo subir ni bajar volumen ni nada ni suspender; como lo
tenemos aqui debe funcionar todo"): en Windows no hay pactl, playerctl ni systemctl. Ahi se usan las teclas
multimedia del sistema (volumen y musica: las entiende Windows y cualquier navegador o reproductor), y la API
de Windows para bloquear, apagar la pantalla y suspender; la MAC sale de GetAdaptersInfo. Ver _Windows.
"""

import asyncio
import ipaddress
import json
import os
import re
import socket
import subprocess
import threading
import time
import urllib.parse
import urllib.request

TV_CERT = "tv_cert.pem"
TV_EMPAREJADOS = "tv_emparejados.json"     # las IP de los TV emparejados de verdad (el certificado se crea antes)
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
WINDOWS = os.name == "nt"


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
        # errors="replace": en Windows los programas de consola no escriben en UTF-8 (ver red_wifi._TEXTO)
        p = subprocess.run(cmd, capture_output=True, text=True, errors="replace", timeout=timeout, stdin=subprocess.DEVNULL)
        return p.returncode, (p.stdout + p.stderr).strip()
    except FileNotFoundError:
        return 127, "no esta instalado: %s" % cmd[0]
    except subprocess.TimeoutExpired:
        return 124, "tardo demasiado"


def _abrir(url):
    import acciones
    return acciones._abrir(url)


# ------------------------------------------------------------------ Windows (12 nov)
class _Windows:
    """Lo mismo que pactl / playerctl / loginctl / systemctl, con la API de Windows (ctypes, sin instalar nada)."""
    # teclas virtuales: las del teclado multimedia (Windows sube o baja el volumen de 2 en 2)
    TECLAS = {"subir": 0xAF, "bajar": 0xAE, "silencio": 0xAD, "play-pause": 0xB3, "next": 0xB0, "previous": 0xB1,
              "stop": 0xB2}
    PASO = 2

    @staticmethod
    def tecla(nombre, veces=1):
        import ctypes
        vk = _Windows.TECLAS[nombre]
        for _ in range(veces):
            ctypes.windll.user32.keybd_event(vk, 0, 1, 0)          # KEYEVENTF_EXTENDEDKEY
            ctypes.windll.user32.keybd_event(vk, 0, 1 | 2, 0)      # ... | KEYEVENTF_KEYUP

    @staticmethod
    def volumen(cambio):
        """cambio: "+10%", "-10%" o "35%" (como pactl)."""
        m = re.match(r"^([+-]?)(\d+)%$", cambio)
        signo, n = m.group(1), int(m.group(2))
        pasos = max(1, round(n / _Windows.PASO))
        if signo:
            _Windows.tecla("subir" if signo == "+" else "bajar", pasos)
        else:                                       # exacto: a cero y luego hasta n (sin leer el volumen actual)
            _Windows.tecla("bajar", 100 // _Windows.PASO)
            if n:
                _Windows.tecla("subir", min(pasos, 100 // _Windows.PASO))

    @staticmethod
    def bloquear():
        import ctypes
        if not ctypes.windll.user32.LockWorkStation():
            raise ErrorPuente("No pude bloquear el PC.")

    @staticmethod
    def apagar_pantalla():
        import ctypes
        # WM_SYSCOMMAND, SC_MONITORPOWER, 2 = apagar; PostMessage para no quedarse esperando a todas las ventanas
        ctypes.windll.user32.PostMessageW(0xFFFF, 0x0112, 0xF170, 2)

    @staticmethod
    def suspender():
        """SetSuspendState pide el privilegio de apagar activado en el proceso (el usuario lo tiene, apagado)."""
        import ctypes
        from ctypes import wintypes

        class LUID(ctypes.Structure):
            _fields_ = [("LowPart", wintypes.DWORD), ("HighPart", wintypes.LONG)]

        class TOKEN_PRIVILEGES(ctypes.Structure):
            _fields_ = [("PrivilegeCount", wintypes.DWORD), ("Luid", LUID), ("Attributes", wintypes.DWORD)]
        adv, k32 = ctypes.windll.advapi32, ctypes.windll.kernel32
        k32.GetCurrentProcess.restype = wintypes.HANDLE          # con los tipos exactos: en 64 bits son punteros
        adv.OpenProcessToken.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)]
        adv.LookupPrivilegeValueW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR, ctypes.POINTER(LUID)]
        adv.AdjustTokenPrivileges.argtypes = [wintypes.HANDLE, wintypes.BOOL, ctypes.POINTER(TOKEN_PRIVILEGES),
                                              wintypes.DWORD, ctypes.c_void_p, ctypes.c_void_p]
        token = wintypes.HANDLE()
        if adv.OpenProcessToken(k32.GetCurrentProcess(), 0x0020 | 0x0008, ctypes.byref(token)):
            tp = TOKEN_PRIVILEGES(1, LUID(), 0x00000002)                # SE_PRIVILEGE_ENABLED
            if adv.LookupPrivilegeValueW(None, "SeShutdownPrivilege", ctypes.byref(tp.Luid)):
                adv.AdjustTokenPrivileges(token, False, ctypes.byref(tp), 0, None, None)
            k32.CloseHandle(token)
        if not ctypes.windll.powrprof.SetSuspendState(False, False, False):
            _log("puente: Windows no dejó suspender (SetSuspendState)")

    @staticmethod
    def mac():
        """La MAC del adaptador que tiene la IP con la que este PC sale a la red (GetAdaptersInfo)."""
        import ctypes
        ip = _ip_salida()

        class IP_ADDR_STRING(ctypes.Structure):
            pass
        IP_ADDR_STRING._fields_ = [("Next", ctypes.POINTER(IP_ADDR_STRING)), ("IpAddress", ctypes.c_char * 16),
                                   ("IpMask", ctypes.c_char * 16), ("Context", ctypes.c_ulong)]

        class IP_ADAPTER_INFO(ctypes.Structure):
            pass
        IP_ADAPTER_INFO._fields_ = [
            ("Next", ctypes.POINTER(IP_ADAPTER_INFO)), ("ComboIndex", ctypes.c_ulong), ("AdapterName", ctypes.c_char * 260),
            ("Description", ctypes.c_char * 132), ("AddressLength", ctypes.c_uint), ("Address", ctypes.c_ubyte * 8),
            ("Index", ctypes.c_ulong), ("Type", ctypes.c_uint), ("DhcpEnabled", ctypes.c_uint),
            ("CurrentIpAddress", ctypes.POINTER(IP_ADDR_STRING)), ("IpAddressList", IP_ADDR_STRING),
            ("GatewayList", IP_ADDR_STRING), ("DhcpServer", IP_ADDR_STRING), ("HaveWins", ctypes.c_int),
            ("PrimaryWinsServer", IP_ADDR_STRING), ("SecondaryWinsServer", IP_ADDR_STRING),
            ("LeaseObtained", ctypes.c_int64), ("LeaseExpires", ctypes.c_int64)]
        tam = ctypes.c_ulong(0)
        ctypes.windll.iphlpapi.GetAdaptersInfo(None, ctypes.byref(tam))
        buf = ctypes.create_string_buffer(tam.value or 1)
        if ctypes.windll.iphlpapi.GetAdaptersInfo(buf, ctypes.byref(tam)) != 0:
            return ""
        a = ctypes.cast(buf, ctypes.POINTER(IP_ADAPTER_INFO))
        primera = ""
        while a:
            info = a.contents
            mac = ":".join("%02x" % b for b in info.Address[:info.AddressLength]) if info.AddressLength == 6 else ""
            ips = []
            d = info.IpAddressList
            while True:
                ips.append(d.IpAddress.decode("ascii", "replace"))
                if not d.Next:
                    break
                d = d.Next.contents
            if mac and ip in ips:
                return mac
            if mac and not primera and any(x and x != "0.0.0.0" for x in ips):
                primera = mac
            a = info.Next
        return primera


def _ip_salida():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))        # UDP: no envia nada, solo elige la interfaz
        return s.getsockname()[0]
    except OSError:
        return ""
    finally:
        s.close()


# ------------------------------------------------------------------ el propio PC
def _volumen(cambio):
    if WINDOWS:
        _Windows.volumen(cambio)
        return
    rc, out = _correr(["pactl", "set-sink-volume", "@DEFAULT_SINK@", cambio])
    if rc != 0:
        raise ErrorPuente("No pude cambiar el volumen del PC.")


def _media(orden):
    if WINDOWS:                                 # play, pause y play-pause son la misma tecla en Windows
        _Windows.tecla({"play": "play-pause", "pause": "play-pause"}.get(orden, orden))
        return
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
    if WINDOWS:
        _Windows.bloquear()
        return
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
        if WINDOWS:
            _Windows.suspender()
        else:
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
    elif accion == "silenciar" and WINDOWS:
        _Windows.tecla("silencio")
    elif accion == "silenciar":
        if _correr(["pactl", "set-sink-mute", "@DEFAULT_SINK@", "toggle"])[0] != 0:
            raise ErrorPuente("No pude silenciar el PC.")
    elif accion == "pausa":                     # alternar (el boton de los aparatos)
        _media("play-pause")
    elif accion == "pausar" and WINDOWS:        # Windows no tiene "solo pausa": la tecla alterna
        _Windows.tecla("play-pause")
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
    elif accion == "apagar_pantalla" and WINDOWS:
        _Windows.apagar_pantalla()
    elif accion == "apagar_pantalla":
        if _correr(["xset", "dpms", "force", "off"])[0] != 0:
            raise ErrorPuente("No pude apagar la pantalla.")
    elif accion in ("suspender", "apagar"):
        _suspender_luego()
        return {"mensaje": "suspendiendo", "decir": "Listo, suspendo el PC."}
    elif accion == "encender":
        return {"mensaje": "ya encendido", "decir": "El PC ya está encendido."}
    elif accion == "whatsapp":                  # Fase 14: la app ya pregunto "¿Se lo mando?" y el usuario dijo que si
        return whatsapp(d.get("numero"), d.get("texto"))
    elif accion == "probar":                    # Fase 14: "Probar" en Dispositivos de la app; no cambia nada
        return {"mensaje": "listo", "resultados": json.dumps(diagnostico(), ensure_ascii=False)}
    else:
        raise ErrorPuente("No sé hacer eso con el PC.")
    _log("puente: PC %s%s" % (accion, " (%s)" % valor if valor not in (None, "") else ""))
    return {"mensaje": accion}


# ------------------------------------------------------------------ WhatsApp (Fase 14)
WHATSAPP_ESPERA_S = 12      # lo que tarda WhatsApp Web en abrir el chat con el mensaje ya escrito
WHATSAPP_MAX_S = 30


# Titulo de la ventana del navegador cuando su pestaña activa es WhatsApp Web: "(90) WhatsApp - Google Chrome".
# Estricto a proposito: "WhatsApp - Buscar con Google" no vale (no se debe escribir en otra pestaña).
RE_TITULO_WA = re.compile(r"^(\(\d+\)\s*)?WhatsApp\s+[-–—]\s+(Google Chrome|Chromium)\s*$", re.I)


def _ventana_whatsapp():
    """El id de la ventana del navegador cuya pestaña activa es WhatsApp Web, o "" """
    rc, out = _correr(["xdotool", "search", "--onlyvisible", "--name", "WhatsApp"])
    for w in (out.split() if rc == 0 else []):
        if w.isdigit():
            rc2, nombre = _correr(["xdotool", "getwindowname", w])
            if rc2 == 0 and RE_TITULO_WA.match(nombre.strip()):
                return w
    return ""


def _traer_pestana_whatsapp():
    """Si WhatsApp Web esta en una pestaña de fondo de Chrome, la trae al frente con la busqueda de
    pestañas (Ctrl+Shift+A, "WhatsApp", Enter). Solo cuenta si despues la pestaña activa es WhatsApp Web
    (titulo estricto); si no, cierra el buscador y devuelve "" (no se toca ninguna otra pestaña)."""
    rc, out = _correr(["xdotool", "search", "--onlyvisible", "--class", "google-chrome"])
    ventanas = [w for w in out.split() if w.isdigit()] if rc == 0 else []
    if not ventanas:
        return ""
    _correr(["xdotool", "windowactivate", "--sync", ventanas[-1], "key", "--clearmodifiers", "ctrl+shift+a"])
    time.sleep(0.8)
    _correr(["xdotool", "type", "--delay", "25", "WhatsApp"])
    time.sleep(0.6)
    _correr(["xdotool", "key", "--clearmodifiers", "Return"])
    time.sleep(1.0)
    w = _ventana_whatsapp()
    if not w:
        _correr(["xdotool", "key", "--clearmodifiers", "Escape"])
    return w


# Con WhatsApp Web ya abierto no se ve que chat quedo abierto (el titulo de la ventana no lo dice): el mensaje
# se deja escrito y el usuario oprime Intro. Asi nunca se envia a otra persona por error.
WHATSAPP_ENVIAR_EN_PESTANA = False


def _al_portapapeles(texto):
    """Pone texto en el portapapeles con xclip y devuelve lo que habia (texto) para dejarlo como estaba.
    Se sustituye en las pruebas."""
    try:
        antes = subprocess.run(["xclip", "-selection", "clipboard", "-o"], capture_output=True, timeout=2,
                               stdin=subprocess.DEVNULL).stdout.decode("utf-8")
    except (OSError, subprocess.TimeoutExpired, UnicodeDecodeError):
        antes = None
    try:
        # xclip se queda en segundo plano sirviendo el portapapeles: sin DEVNULL, run() lo esperaria
        subprocess.run(["xclip", "-selection", "clipboard", "-i"], input=texto.encode("utf-8"), timeout=3,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except (OSError, subprocess.TimeoutExpired):
        raise ErrorPuente("Falta xclip en el PC para escribir en WhatsApp (sudo apt install xclip).")
    return antes


def _pegar(texto):
    """Escribe texto en la ventana activa pegandolo (portapapeles + Ctrl+V). xdotool type confunde teclas
    con la distribucion de teclado del usuario (latam,us): el 10 nov los ":" de https: salieron como "ñ" y la
    pestaña quedo en http://httpsñ//web.whatsapp.com/... Pegar respeta tildes, signos y emojis."""
    antes = _al_portapapeles(texto)
    time.sleep(0.15)
    _correr(["xdotool", "key", "--clearmodifiers", "ctrl+v"])
    time.sleep(0.6)
    if antes:
        _al_portapapeles(antes)


def _escribir_en_whatsapp_abierto(ventana, num, texto):
    """En la pestaña de WhatsApp Web que ya esta abierta, SIN recargarla (pedido del usuario el 10 nov):
    cierra el chat que haya (Escape), abre "Nuevo chat" (Ctrl+Alt+N), busca el numero, abre el primer
    resultado y pega el mensaje. Si el numero no esta en sus contactos, el mensaje queda en el buscador y no
    se envia a nadie. Se busca sin el indicativo (los ultimos 10 digitos): asi coincide con como lo guardo."""
    _correr(["xdotool", "windowactivate", "--sync", ventana])
    time.sleep(0.4)
    for _ in range(2):                          # el primero cierra menus o paneles; el segundo, el chat abierto
        _correr(["xdotool", "key", "--clearmodifiers", "Escape"])
        time.sleep(0.3)
    _correr(["xdotool", "key", "--clearmodifiers", "ctrl+alt+n"])
    time.sleep(1.2)
    _pegar(num[-10:])
    time.sleep(2.5)                             # que WhatsApp busque
    _correr(["xdotool", "key", "--clearmodifiers", "Down"])
    time.sleep(0.3)
    _correr(["xdotool", "key", "--clearmodifiers", "Return"])
    time.sleep(1.5)                             # se abre el chat con la caja de escribir lista
    _pegar(texto)


def whatsapp(numero, texto):
    """El mensaje en WhatsApp Web del PC. La app solo manda esta orden despues de que el usuario confirma.
    - Si WhatsApp Web ya esta abierto (o en una pestaña de fondo), se escribe en ESA pestaña sin recargarla
      ni abrir otra (pedidos del usuario del 10 nov): busca a la persona y deja el mensaje escrito.
    - Si no esta abierto, se abre con xdg-open el enlace oficial "click to chat" (pestaña nueva, con el chat y
      el mensaje ya puestos) y, con xdotool, se oprime Enter para enviarlo. Dos Enter separados: si el
      primero llega antes de que cargue el chat no hace nada, y si ya lo envio el segundo cae en la caja vacia."""
    num = re.sub(r"\D", "", str(numero or ""))
    if not 8 <= len(num) <= 15:
        raise ErrorPuente("Ese número no parece válido.")
    texto = str(texto or "").strip()[:1000]
    if not texto:
        raise ErrorPuente("El mensaje está vacío.")
    url = "https://web.whatsapp.com/send?phone=%s&text=%s" % (num, urllib.parse.quote(texto))
    xdotool = _correr(["xdotool", "version"])[0] == 0
    ventana = (_ventana_whatsapp() or _traer_pestana_whatsapp()) if xdotool else ""
    if ventana:
        _escribir_en_whatsapp_abierto(ventana, num, texto)
        _log("puente: WhatsApp a +%s...%s escrito en la pestaña que ya estaba abierta" % (num[:2], num[-2:]))
        if not WHATSAPP_ENVIAR_EN_PESTANA:
            return {"mensaje": "escrito", "decir": "Te lo dejé escrito en WhatsApp, en el PC. Revisa que sea su chat y oprime Intro para enviarlo."}
        _correr(["xdotool", "key", "--clearmodifiers", "Return"])
        return {"mensaje": "enviado", "decir": "Listo: lo escribí en WhatsApp del PC y oprimí enviar."}
    _abrir(url)
    _log("puente: WhatsApp a +%s...%s abierto en una pestaña nueva" % (num[:2], num[-2:]))
    if not xdotool:
        return {"mensaje": "abierto", "decir": "Te lo dejé escrito en WhatsApp del PC: oprime Intro para enviarlo."}
    t0 = time.time()
    time.sleep(WHATSAPP_ESPERA_S)
    ventana = _ventana_whatsapp()
    while not ventana and time.time() - t0 < WHATSAPP_MAX_S:
        time.sleep(2)
        ventana = _ventana_whatsapp()
    if not ventana:
        return {"mensaje": "abierto", "decir": "Abrí WhatsApp en el PC, pero no encontré su ventana para enviarlo. Míralo y oprime Intro."}
    for i in range(2):
        _correr(["xdotool", "windowactivate", "--sync", ventana, "key", "--clearmodifiers", "Return"])
        if i == 0:
            time.sleep(4)
    return {"mensaje": "enviado", "decir": "Listo: lo escribí en WhatsApp del PC y oprimí enviar."}


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
    try:
        ips = sorted(set(_tvs_emparejados()) | {ip})
        with open(_ruta(TV_EMPAREJADOS), "w", encoding="utf-8") as f:
            json.dump(ips, f)
    except OSError:
        pass
    return {"mensaje": "¡Emparejado! Ya puedo manejar el TV."}


def _tvs_emparejados():
    try:
        with open(_ruta(TV_EMPAREJADOS), encoding="utf-8") as f:
            return [str(x) for x in json.load(f)]
    except (OSError, ValueError):
        return []


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
    if WINDOWS:
        try:
            return _Windows.mac()
        except Exception as e:
            _log("puente: no pude leer la MAC del PC (%s)" % e)
            return ""
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


def diagnostico():
    """Lo que el PC puede manejar ahora mismo (la prueba de la app). Solo lee: no cambia nada."""
    d = {"volumen": None, "musica": None, "tv": "sin la librería" if not _tv_ok() else "sin emparejar", "mac": _mac_pc()}
    if WINDOWS:                 # con las teclas multimedia de Windows: se maneja, pero no se puede leer
        d.update(volumen="con las teclas de volumen de Windows", musica="con las teclas multimedia de Windows")
        if _tv_ok() and _tvs_emparejados():
            d["tv"] = "emparejado (%s)" % ", ".join(_tvs_emparejados())
        return d
    rc, out = _correr(["pactl", "get-sink-volume", "@DEFAULT_SINK@"])
    m = re.search(r"(\d+)%", out) if rc == 0 else None
    d["volumen"] = int(m.group(1)) if m else None
    rc, out = _correr(["playerctl", "--list-all"])
    jugadores = [x for x in out.splitlines() if x.strip()] if rc == 0 else []
    if jugadores:
        rc, st = _correr(["playerctl", "status"])
        d["musica"] = "%s (%s)" % (st if rc == 0 else "?", jugadores[0].split(".")[0])
    else:
        d["musica"] = "nada abierto" if rc in (0, 1) else "sin playerctl"
    if _tv_ok() and _tvs_emparejados():
        d["tv"] = "emparejado (%s)" % ", ".join(_tvs_emparejados())
    return d


def estado():
    caps = ["pc", "wol", "http", "youtube", "whatsapp"] + (["atv"] if _tv_ok() else [])
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

"""Fase 16 - Vincular el robot desde el PC: por Bluetooth y luego con un WiFi (17 nov).

Pedidos del usuario: "una nueva adicion al panel de control: establecer la conexion por Bluetooth ... seleccionar la
red y darle al robot la red", y luego, al ver un formulario: "no se entiende, esto debe ser asi: detectar por Bluetooth
Pixel y debe salir la lista de dispositivos, y uno selecciona Pixel Assistance ... despues otro boton de vincular con
WiFi ... la opcion: desea vincular a Pixel Assistance con el WiFi de este servidor, si o no; si no, busca la red y
poner contrasena". Pasos:
  1. iniciar_deteccion(): la lista de aparatos Bluetooth cercanos (el robot primero).
  2. iniciar_vincular(direccion): el PC se conecta al elegido y lee su estado; si no es un robot Pixel, lo dice.
  3. iniciar_wifi(usar_pc, ssid, clave): con usar_pc, la red de este PC y la clave que tiene guardada; si no, la red
     que se elija (iniciar_buscar_redes) y la clave que se escriba.
  4. Enseguida, el enlace con la app (_enlazar_app; tambien iniciar_enlace_app): el verde de la luz lo pide ("si
     detecta API, red, y enlace con la app y el panel de control"), y antes solo se podia hacer desde la app. El PC
     deja la marca de enlace en las cuentas con las que esta enlazado (nube.marcar_enlace_robot). Si el robot ya
     tiene dueno, con eso se anota solo; si no, el panel le pide su codigo por Bluetooth, el robot se lo manda al PC
     por la red ("codigo:NNNNNN", que entonces no se dice en voz alta) y el panel se lo devuelve con el dueno.

El robot ya recibe la red por Bluetooth de bajo consumo, como lo hace la app (Fase 13, web/aparatos.js): se escribe
{"ssid", "clave"} en su caracteristica BLE_NUBE y se lee esa misma caracteristica hasta que dice "wifi": true. El
firmware solo acepta una red nueva si no tiene WiFi o si esta en modo enlazar (un toque corto a BOOT): eso no cambia.

Bluetooth con bleak (Linux: BlueZ; Windows: WinRT). Las redes que ve el PC y sus claves guardadas: nmcli en Linux,
netsh en Windows (sin probar en un Windows de verdad). La clave guardada nunca va a la ventana ni al registro: el PC
la lee y se la escribe al robot.

Trabaja de fondo (como red_wifi.buscar): las rutas del panel lo arrancan y la ventana ve el avance en /api/estado.
"""
import asyncio
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import xml.etree.ElementTree as ET

SERVICIO = "6e400001-8f4d-4b7a-9c9a-70697865c000"     # BLE_SERVICIO del firmware (Pixel_portal.ino)
NUBE = "6e400003-8f4d-4b7a-9c9a-70697865c000"         # BLE_NUBE (puente.ino): estado en JSON; se le escribe la red
NOMBRES_ROBOT = {"Pixel Assistance", "Pixel"}       # como se anuncia (17 nov: "Pixel Assistance"; antes "Pixel")
DETECTAR_S = 8.0
CONECTAR_S = 20.0
ESPERAR_WIFI_S = 45.0       # como la app (aparatos.js): el robot prueba la red 15 s y busca su nombre exacto
ESPERAR_APP_S = 15.0        # el robot reintenta anotarse en la cuenta cada 5 s
ESPERAR_PC_S = 25.0         # tras el WiFi, el robot busca su PC por la red
ESPERAR_CODIGO_S = 15.0
LEER_CADA_S = 2.0
MAX_SSID, MAX_CLAVE = 32, 64    # lo que guarda el firmware
MAX_APARATOS = 30
NO_ES_PIXEL = "Ese aparato no es un robot Píxel. Elige «Pixel Assistance» en la lista."
# 17 nov: al conectarse el PC por Bluetooth, el robot (solo con el cable del PC) se reinicio por falta de corriente, y
# el panel decia "no es un robot Pixel". Ahora se reintenta, y si sigue cayendose se dice la causa probable.
INTENTOS_BLE = 3
ENTRE_INTENTOS_S = 4.0
SE_CAE = ("El robot se desconectó del Bluetooth: se está reiniciando, seguramente por falta de corriente (mira si "
          "su luz se pone roja). Conéctalo a un cargador o a un power bank y vuelve a intentarlo.")

LOG = print                 # panel.iniciar lo cambia por servidor.log
_lock = threading.Lock()
# estado: "" | "detectando" | "vinculando" | "buscando_redes" | "dando" | "enlazando" | "listo" | "error"
_estado = {"estado": "", "fase": "", "aparatos": [], "vinculado": None, "redes": [], "red_pc": "",
           "red_pc_guardada": False}
OCUPADO = ("detectando", "vinculando", "buscando_redes", "dando", "enlazando")


class Error(Exception):
    """Un fallo con un mensaje para el usuario (en espanol, con tildes)."""


def estado():
    """Para /api/estado."""
    with _lock:
        return json.loads(json.dumps(_estado))


def _poner(**cambios):
    with _lock:
        _estado.update(cambios)


def _empezar(estado_nuevo, fase):
    """Marca el trabajo que empieza; Error si ya hay otro (una cosa a la vez con el Bluetooth)."""
    with _lock:
        if _estado["estado"] in OCUPADO:
            raise Error("Espera: ya estoy hablando con el robot.")
        _estado.update(estado=estado_nuevo, fase=fase)


# ------------------------------------------------------------------ Bluetooth

def _bleak():
    try:
        import bleak
    except ImportError:
        raise Error("Este programa todavía no trae el Bluetooth para vincular el robot. Actualiza Píxel.")
    return bleak


def _leer_json(datos):
    try:
        d = json.loads(bytes(datos).decode("utf-8", "replace"))
    except ValueError:
        return {}
    return d if isinstance(d, dict) else {}


def _robot(direccion, nombre, d):
    """Lo que la ventana muestra del robot vinculado (lo que dice su BLE_NUBE)."""
    return {"direccion": direccion, "nombre": nombre or "Pixel Assistance", "id": d.get("id") or "",
            "wifi": bool(d.get("wifi")), "red": d.get("red") or "", "emparejar": bool(d.get("emparejar")),
            "app": bool(d.get("app")), "luz": d.get("luz") or "", "pc": bool(d.get("pc"))}


_RE_MAC = re.compile(r"^([0-9A-F]{2}[-:]){5}[0-9A-F]{2}$", re.I)


def _aparatos(vistos):
    """La lista para elegir: con nombre (BlueZ pone la MAC cuando no hay), el robot primero y luego por senal."""
    aparatos = []
    for disp, adv in vistos:
        uuids = [u.lower() for u in (getattr(adv, "service_uuids", None) or [])]
        pixel = SERVICIO in uuids
        nombre = (getattr(adv, "local_name", None) or disp.name or "").strip()
        if _RE_MAC.match(nombre):
            nombre = ""
        if not nombre and not pixel:
            continue
        aparatos.append({"direccion": disp.address, "nombre": nombre or "Pixel Assistance", "rssi": adv.rssi,
                         "pixel": pixel})
    aparatos.sort(key=lambda a: (not a["pixel"], -(a["rssi"] if a["rssi"] is not None else -200)))
    return aparatos[:MAX_APARATOS]


async def _detectar():
    bleak = _bleak()
    vistos = await bleak.BleakScanner.discover(timeout=DETECTAR_S, return_adv=True)
    return _aparatos(vistos.values())


async def _con_reintentos(hacer, avisar=None):
    """Corre hacer() (una corrutina nueva cada vez) hasta INTENTOS_BLE veces si el Bluetooth se corta. Los Error (con
    su mensaje para el usuario) no se reintentan."""
    for intento in range(1, INTENTOS_BLE + 1):
        try:
            return await hacer()
        except Error:
            raise
        except Exception as e:
            LOG("robot_wifi: Bluetooth cortado (intento %d de %d): %s: %s" % (intento, INTENTOS_BLE, type(e).__name__, e))
            if intento == INTENTOS_BLE:
                raise Error(SE_CAE)
            if avisar:
                avisar("El robot se desconectó del Bluetooth; reintento (%d de %d)…" % (intento + 1, INTENTOS_BLE))
            await asyncio.sleep(ENTRE_INTENTOS_S)


async def _leer_robot(direccion, avisar=None):
    """(nombre, estado) del robot en esa direccion; Error si no aparece o no es un robot Pixel."""
    bleak = _bleak()

    async def leer():
        disp = await bleak.BleakScanner.find_device_by_address(direccion, timeout=DETECTAR_S * 2)
        if disp is None:
            raise Error("No encuentro ese aparato por Bluetooth. Acércalo a este computador y vuelve a detectar.")
        async with bleak.BleakClient(disp, timeout=CONECTAR_S) as c:
            servicios = getattr(c, "services", None)
            if servicios is not None and servicios.get_characteristic(NUBE) is None:
                raise Error(NO_ES_PIXEL)                    # conecta, pero no tiene el servicio del robot
            d = _leer_json(await c.read_gatt_char(NUBE))
        if "id" not in d:
            raise Error(NO_ES_PIXEL)
        return disp.name, d
    return await _con_reintentos(leer, avisar)


async def _dar_red(direccion, ssid, clave, avisar):
    bleak = _bleak()
    avisar("Conectando con el robot por Bluetooth…")
    disp = await bleak.BleakScanner.find_device_by_address(direccion, timeout=DETECTAR_S * 2)
    if disp is None:
        raise Error("No encuentro al robot por Bluetooth. Acércalo a este computador y vuelve a detectar.")
    async with bleak.BleakClient(disp, timeout=CONECTAR_S) as c:
        antes = _leer_json(await c.read_gatt_char(NUBE))
        if antes.get("wifi") and not antes.get("emparejar"):
            if antes.get("red") == ssid:
                return antes
            raise Error("El robot ya está conectado a «%s». Para darle otra red, toca una vez el botón BOOT del robot "
                        "y vuelve a intentarlo." % (antes.get("red") or "otra red"))
        avisar("Dándole la red «%s» al robot…" % ssid)
        await c.write_gatt_char(NUBE, json.dumps({"ssid": ssid, "clave": clave}).encode("utf-8"), response=True)
        avisar("Esperando a que el robot entre a «%s»…" % ssid)
        limite = time.monotonic() + ESPERAR_WIFI_S
        d = {}
        while time.monotonic() < limite:
            await asyncio.sleep(LEER_CADA_S)
            d = _leer_json(await c.read_gatt_char(NUBE))
            if d.get("wifi") and d.get("red") == ssid:
                return d
    if d.get("red") != ssid:
        raise Error("El robot no recibió la red. Vuelve a intentarlo.")
    raise Error("El robot no pudo entrar a «%s». Revisa la contraseña y que la red sea de 2,4 GHz." % ssid)


# ------------------------------------------------------------------ enlace con la app

_codigo = {"esperando": False, "cifras": "", "evento": threading.Event()}


def recibir_codigo(cifras):
    """La llama servidor.py cuando el robot manda su codigo ("codigo:NNNNNN"). True si lo estaba esperando el panel:
    entonces no se dice por el altavoz."""
    if not _codigo["esperando"]:
        return False
    _codigo["cifras"] = cifras
    _codigo["evento"].set()
    return True


async def _esperar(leer, listo, segundos):
    limite = time.monotonic() + segundos
    d = await leer()
    while not listo(d) and time.monotonic() < limite:
        await asyncio.sleep(LEER_CADA_S)
        d = await leer()
    return d


async def _enlazar_app(direccion, duenos, avisar):
    """duenos: [(uid, nombre de la app)], con la marca de enlace ya puesta. Devuelve el estado del robot enlazado."""
    bleak = _bleak()
    disp = await bleak.BleakScanner.find_device_by_address(direccion, timeout=DETECTAR_S * 2)
    if disp is None:
        raise Error("No encuentro al robot por Bluetooth. Acércalo a este computador y vuelve a intentarlo.")
    async with bleak.BleakClient(disp, timeout=CONECTAR_S) as c:
        async def leer():
            return _leer_json(await c.read_gatt_char(NUBE))

        d = await leer()
        if d.get("app"):
            return d
        if d.get("dueno"):                     # ya tiene dueno: con la marca se anota solo (reintenta cada 5 s)
            avisar("Esperando a que el robot se anote en tu cuenta…")
            d = await _esperar(leer, lambda x: x.get("app"), ESPERAR_APP_S)
            if d.get("app"):
                return d
        if not d.get("pc"):
            avisar("Esperando a que el robot se conecte a este panel…")
            d = await _esperar(leer, lambda x: x.get("pc"), ESPERAR_PC_S)
            if not d.get("pc"):
                raise Error("El robot aún no está conectado a este panel. Cuando el bombillo esté azul, toca «Enlazar».")
        avisar("Pidiéndole su código al robot…")
        _codigo.update(esperando=True, cifras="")
        _codigo["evento"].clear()
        try:
            await c.write_gatt_char(NUBE, json.dumps({"pedir_codigo": True}).encode("utf-8"), response=True)
            llego = await asyncio.get_running_loop().run_in_executor(None, _codigo["evento"].wait, ESPERAR_CODIGO_S)
        finally:
            _codigo["esperando"] = False
        if not llego or not _codigo["cifras"]:
            raise Error("El robot no mandó su código. Vuelve a intentarlo.")
        uid, nombre = duenos[0]
        avisar("Enlazando el robot con tu cuenta…")
        await c.write_gatt_char(NUBE, json.dumps({"dueno": uid, "nombre": nombre[:40], "codigo": _codigo["cifras"]})
                                .encode("utf-8"), response=True)
        d = await _esperar(leer, lambda x: x.get("app"), ESPERAR_APP_S * 2)
        if d.get("app"):
            return d
    raise Error("El robot no quedó enlazado con la app. Vuelve a intentarlo.")


def _hacer_enlace(robot, marcar, registrar, app_por_red=None):
    """Pone la marca de enlace y espera al robot. Corre dentro de un trabajo de fondo.

    Si el robot ya tiene dueno, con la marca se anota solo, y eso se ve sin Bluetooth: el robot le dice a su PC
    "app": true (debug "robot:{...}", app_por_red()). Solo si no llega, se usa el Bluetooth (el codigo)."""
    _poner(estado="enlazando", fase="Enlazando el robot con la app…")
    try:
        duenos = marcar(robot["id"])
    except RuntimeError as e:
        raise Error(str(e))
    d = None
    if app_por_red:
        _poner(fase="Esperando a que el robot se anote en tu cuenta…")
        limite = time.monotonic() + ESPERAR_APP_S
        while time.monotonic() < limite and not app_por_red():
            time.sleep(0.5)
        if app_por_red():
            d = dict(robot, app=True)
    if d is None:
        if not robot.get("direccion"):
            raise Error("El robot no se anotó en tu cuenta. Vincúlalo por Bluetooth (paso 1) y vuelve a tocar «Enlazar».")
        avisar = lambda f: _poner(fase=f)       # noqa: E731
        d = asyncio.run(_con_reintentos(lambda: _enlazar_app(robot["direccion"], duenos, avisar), avisar))
        d = _robot(robot["direccion"], robot["nombre"], d)
    _poner(estado="listo", fase="Listo: el robot quedó enlazado con la app.", vinculado=d)
    if registrar:
        registrar("robot", "Robot enlazado con la app")


# ------------------------------------------------------------------ redes del PC

def _correr(args, tiempo=20):
    """Salida de un programa del sistema. En Windows su consola no escribe en UTF-8 (ver CLAUDE.md, 2.1.2)."""
    r = subprocess.run(args, capture_output=True, timeout=tiempo)
    cod = "oem" if sys.platform == "win32" else "utf-8"
    return r.returncode, r.stdout.decode(cod, "replace")


def _campos(linea):
    """Campos de una linea de `nmcli -t`: ':' separa, y '\\:' o '\\\\' van escapados."""
    campos, actual, i = [], "", 0
    while i < len(linea):
        c = linea[i]
        if c == "\\" and i + 1 < len(linea):
            actual += linea[i + 1]
            i += 2
            continue
        if c == ":":
            campos.append(actual)
            actual = ""
        else:
            actual += c
        i += 1
    campos.append(actual)
    return campos


def _redes_nmcli(salida):
    """Agrupa por nombre las lineas de `nmcli -t -f IN-USE,SSID,SIGNAL,SECURITY,FREQ dev wifi list`."""
    redes = {}
    for linea in salida.splitlines():
        c = _campos(linea)
        if len(c) < 5 or not c[1]:
            continue                                    # redes ocultas: sin nombre no se pueden elegir
        uso, ssid, senal, seguridad, frec = c[:5]
        mhz = int(re.sub(r"\D", "", frec) or 0)
        r = redes.setdefault(ssid, {"ssid": ssid, "senal": 0, "abierta": True, "ghz24": False, "del_pc": False})
        r["senal"] = max(r["senal"], int(senal or 0))
        r["abierta"] = r["abierta"] and seguridad.strip() in ("", "--")
        r["ghz24"] = r["ghz24"] or 0 < mhz < 3000
        r["del_pc"] = r["del_pc"] or uso.strip() == "*"
    return list(redes.values())


def _guardadas_nmcli():
    """{ssid: nombre de la conexion} de las redes WiFi que este PC tiene guardadas."""
    _, salida = _correr(["nmcli", "-t", "-f", "NAME,TYPE", "connection", "show"])
    guardadas = {}
    for linea in salida.splitlines():
        c = _campos(linea)
        if len(c) >= 2 and c[1] == "802-11-wireless":
            _, ssid = _correr(["nmcli", "-t", "-e", "no", "-g", "802-11-wireless.ssid", "connection", "show", c[0]])
            if ssid.strip("\n"):
                guardadas[ssid.rstrip("\n")] = c[0]
    return guardadas


def _netsh_perfiles():
    """{ssid: clave} de los perfiles WiFi de Windows (export a XML: no depende del idioma de Windows)."""
    perfiles = {}
    with tempfile.TemporaryDirectory() as carpeta:
        _correr(["netsh", "wlan", "export", "profile", "key=clear", "folder=" + carpeta])
        for nombre in os.listdir(carpeta):
            try:
                raiz = ET.parse(os.path.join(carpeta, nombre)).getroot()
            except ET.ParseError:
                continue
            ns = {"w": raiz.tag.split("}")[0].strip("{")} if raiz.tag.startswith("{") else {}
            pre = "w:" if ns else ""
            ssid = raiz.find(".//%sSSIDConfig/%sSSID/%sname" % (pre, pre, pre), ns)
            clave = raiz.find(".//%skeyMaterial" % pre, ns)
            if ssid is not None and ssid.text:
                perfiles[ssid.text] = clave.text if clave is not None and clave.text else ""
    return perfiles


def _redes_netsh(salida, actual):
    """Las redes de `netsh wlan show networks mode=bssid`. Las palabras de netsh cambian con el idioma de Windows:
    solo se usan "SSID", los porcentajes y "GHz"."""
    redes, r = {}, None
    for linea in salida.splitlines():
        m = re.match(r"^SSID \d+ : (.*)$", linea.rstrip("\r"))
        if m:
            ssid = m.group(1)
            r = redes.setdefault(ssid, {"ssid": ssid, "senal": 0, "abierta": False, "ghz24": None,
                                        "del_pc": ssid == actual}) if ssid else None
            continue
        if r is None:
            continue
        p = re.search(r":\s*(\d+)%", linea)
        if p:
            r["senal"] = max(r["senal"], int(p.group(1)))
        g = re.search(r":\s*(\d+)[.,]?\d*\s*GHz", linea)
        if g:
            r["ghz24"] = bool(r["ghz24"]) or g.group(1) == "2"
        if re.search(r":\s*(Open|Abierta|Ouvert|Offen|Aperta)\s*$", linea, re.I):
            r["abierta"] = True
    for r in redes.values():
        if r["ghz24"] is None:          # sin la banda en la salida: que el usuario decida
            r["ghz24"] = True
    return list(redes.values())


def redes_del_pc(rescan="auto"):
    """(redes, red_actual): las redes WiFi que ve este PC, con su senal, si el robot las ve (2,4 GHz) y si el PC
    tiene su clave guardada. rescan="no": sin volver a buscar (rapido)."""
    if sys.platform.startswith("linux"):
        cod, salida = _correr(["nmcli", "-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY,FREQ", "dev", "wifi", "list",
                               "--rescan", rescan], tiempo=30)
        if cod:
            raise Error("No pude ver las redes WiFi de este computador.")
        redes = _redes_nmcli(salida)
        guardadas = _guardadas_nmcli()
    elif sys.platform == "win32":
        _, interfaces = _correr(["netsh", "wlan", "show", "interfaces"])
        m = re.search(r"^\s*SSID\s*: (.*)$", interfaces, re.M)
        actual = m.group(1).rstrip("\r") if m else ""
        _, salida = _correr(["netsh", "wlan", "show", "networks", "mode=bssid"], tiempo=30)
        redes = _redes_netsh(salida, actual)
        guardadas = _netsh_perfiles()
    else:
        raise Error("Ver las redes WiFi del computador solo funciona en Linux y Windows.")
    for r in redes:
        r["guardada"] = r["ssid"] in guardadas
        r["solo_5ghz"] = not r.pop("ghz24")
    redes.sort(key=lambda r: (not r["del_pc"], r["solo_5ghz"], -r["senal"], r["ssid"].lower()))
    actual = next((r["ssid"] for r in redes if r["del_pc"]), "")
    return redes, actual


def clave_guardada(ssid):
    """La clave que este PC tiene guardada para esa red ("" si es abierta). Nunca se muestra ni se anota."""
    if sys.platform.startswith("linux"):
        conexion = _guardadas_nmcli().get(ssid)
        if conexion:
            cod, clave = _correr(["nmcli", "-s", "-t", "-e", "no", "-g", "802-11-wireless-security.psk",
                                  "connection", "show", conexion])
            clave = clave.rstrip("\n")
            if cod == 0 and clave:
                return clave
            cod, seguridad = _correr(["nmcli", "-t", "-e", "no", "-g", "802-11-wireless-security.key-mgmt",
                                      "connection", "show", conexion])
            if cod == 0 and not seguridad.strip():
                return ""                           # red abierta
    elif sys.platform == "win32":
        perfiles = _netsh_perfiles()
        if ssid in perfiles:
            return perfiles[ssid]
    raise Error("No pude leer la clave guardada de «%s». Escríbela a mano." % ssid)


# ------------------------------------------------------------------ lo que usa el panel

def _en_hilo(nombre, trabajo):
    def correr():
        try:
            trabajo()
        except Error as e:
            _poner(estado="error", fase=str(e))
        except Exception as e:
            LOG("robot_wifi: ERROR %s: %s: %s" % (nombre, type(e).__name__, e))
            _poner(estado="error", fase=_mensaje_bluetooth(e))
    threading.Thread(target=correr, daemon=True).start()


def _sin_redes_del_robot(redes):
    return [r for r in redes if r["ssid"] not in NOMBRES_ROBOT]     # la red de configuracion del propio robot


def iniciar_deteccion():
    """Paso 1: los aparatos Bluetooth cercanos. Empieza de cero: el robot vinculado antes deja de estarlo."""
    _empezar("detectando", "Buscando aparatos por Bluetooth…")
    _poner(aparatos=[], vinculado=None, redes=[])

    def trabajo():
        aparatos = _detectar_sync()
        fase = "" if aparatos else "No encontré aparatos por Bluetooth. Enciende el robot cerca de este computador."
        _poner(estado="listo" if aparatos else "error", fase=fase, aparatos=aparatos)
    _en_hilo("detectando", trabajo)


def _detectar_sync():
    return asyncio.run(_detectar())


def iniciar_vincular(direccion):
    """Paso 2: el PC se conecta al aparato elegido y comprueba que es el robot."""
    if not _RE_DIRECCION.match(direccion or ""):
        raise Error("Elige un aparato de la lista.")
    _empezar("vinculando", "Vinculando por Bluetooth…")

    def trabajo():
        nombre, d = asyncio.run(_leer_robot(direccion, lambda f: _poner(fase=f)))
        vinculado = _robot(direccion, nombre, d)
        try:
            redes, actual = redes_del_pc(rescan="no")
        except Error:
            redes, actual = [], ""
        redes = _sin_redes_del_robot(redes)
        guardada = any(r["ssid"] == actual and r["guardada"] for r in redes)
        _poner(estado="listo", fase="", vinculado=vinculado, redes=redes, red_pc=actual, red_pc_guardada=guardada)
        LOG("robot_wifi: robot vinculado por Bluetooth (%s, %s)" % (vinculado["nombre"], direccion))
    _en_hilo("vinculando", trabajo)


def iniciar_buscar_redes():
    """Con «No»: las redes WiFi que ve este PC, para elegir una."""
    _empezar("buscando_redes", "Buscando redes WiFi…")

    def trabajo():
        redes, actual = redes_del_pc()
        _poner(estado="listo", fase="", redes=_sin_redes_del_robot(redes), red_pc=actual)
    _en_hilo("buscando redes", trabajo)


def iniciar_wifi(usar_pc, ssid="", clave="", registrar=None, usar_guardada=False, marcar=None, app_por_red=None):
    """Paso 3: le da al robot vinculado una red WiFi. usar_pc: la de este PC, con la clave que tiene guardada;
    usar_guardada: la red elegida en la lista, con la clave que este PC tiene guardada de ella."""
    actual = estado()
    robot = actual["vinculado"]
    if not robot:
        raise Error("Primero vincula el robot por Bluetooth.")
    if usar_pc:
        ssid = actual["red_pc"]
        if not ssid:
            raise Error("Este computador no está conectado a un WiFi. Elige «No» y escoge la red.")
    if not ssid or len(ssid.encode("utf-8")) > MAX_SSID:
        raise Error("Elige una red WiFi.")
    if usar_pc or usar_guardada:
        try:
            clave = clave_guardada(ssid)
        except Error:
            raise Error("No pude leer la contraseña que este computador tiene de «%s». %s" % (
                ssid, "Elige «No» y escríbela." if usar_pc else "Escríbela."))
    if len(clave.encode("utf-8")) > MAX_CLAVE or 0 < len(clave) < 8:
        raise Error("La contraseña de un WiFi tiene entre 8 y 64 caracteres.")
    _empezar("dando", "Conectando con el robot por Bluetooth…")

    def trabajo():
        avisar = lambda f: _poner(fase=f)       # noqa: E731
        d = asyncio.run(_con_reintentos(lambda: _dar_red(robot["direccion"], ssid, clave, avisar), avisar))
        robot_ahora = _robot(robot["direccion"], robot["nombre"], d)
        _poner(estado="listo", fase="Listo: el robot está conectado a «%s»." % ssid, vinculado=robot_ahora)
        if registrar:
            registrar("robot", "WiFi del robot: «%s»" % ssid)
        if marcar and not robot_ahora["app"] and robot_ahora["id"]:
            _hacer_enlace(robot_ahora, marcar, registrar, app_por_red)    # paso 4, enseguida
    _en_hilo("dando la red", trabajo)


def iniciar_enlace_app(marcar, registrar=None, app_por_red=None, id_por_red=None):
    """Paso 4 a mano (si fallo tras el WiFi): enlazar el robot con la app de las cuentas de este PC. Sirve con el
    robot vinculado por Bluetooth o solo conectado a este PC por la red (su id llega en su debug "robot:{...}")."""
    robot = estado()["vinculado"]
    if not (robot and robot.get("id")):
        rid = id_por_red() if id_por_red else ""
        if not rid:
            raise Error("Primero vincula el robot por Bluetooth.")
        robot = {"direccion": "", "nombre": "Pixel Assistance", "id": rid}
    _empezar("enlazando", "Enlazando el robot con la app…")
    _en_hilo("enlazando con la app", lambda: _hacer_enlace(robot, marcar, registrar, app_por_red))


_RE_DIRECCION = re.compile(r"^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$|^[0-9A-Fa-f-]{36}$")


def _mensaje_bluetooth(e):
    texto = str(e).lower()
    if "not powered" in texto or "no bluetooth adapters" in texto or "org.bluez.error.notready" in texto:
        return "El Bluetooth de este computador está apagado. Préndelo y vuelve a intentarlo."
    if "timeout" in texto or isinstance(e, asyncio.TimeoutError):
        return "El aparato no contestó por Bluetooth. Acércalo a este computador y vuelve a intentarlo."
    return "Algo falló con el Bluetooth. Vuelve a detectar el robot."

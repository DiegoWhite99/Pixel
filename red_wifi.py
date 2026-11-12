#!/usr/bin/env python3
"""Fase 9 - Dispositivos WiFi de la red local: buscarlos y saber si siguen encendidos.

Sin dependencias. Un datagrama UDP a cada IP de la red obliga al PC a preguntar por
ARP, y /proc/net/arp dice quien contesto (con su MAC), aunque no responda a ping.
Luego, a cada uno: nombre por mDNS (consulta "legacy unicast" a 224.0.0.251) y por
DNS inverso, puertos tipicos de enchufes y luces (Tuya 6668, Kasa 9999, Shelly en
/shelly) y el fabricante por la MAC. Lo usa panel.py: buscar() corre en un hilo y
su progreso y resultado salen en estado().
"""

import collections
import concurrent.futures
import json
import os
import re
import socket
import struct
import subprocess
import threading
import time
import urllib.request

MAX_HOSTS = 254         # solo se recorre la /24 del PC, aunque la red sea mayor
ESPERA_ARP_S = 2.5      # tras tocar todas las IP, cuanto se espera a las respuestas ARP
MDNS_S = 2.0
TCP_TIMEOUT_S = 0.6
VIGILAR_S = 30          # cada cuanto se comprueba si los guardados siguen encendidos
# 12 nov (prueba de GitHub): hay redes donde el router contesta el ARP de TODAS las IP con su propia MAC (proxy
# ARP; asi es la red de las maquinas de GitHub). Salian 237 "equipos" iguales y en Windows la busqueda pasaba de
# 2 minutos. Una MAC en mas IP que esto no son equipos: se descartan (un repetidor WiFi tiene unos pocos detras).
ECO_ARP = 12

# puerto -> lo que suele haber detras
PUERTOS = {
    80: "web", 443: "web segura", 6668: "Tuya", 9999: "Kasa", 8081: "Sonoff",
    8008: "Chromecast", 8009: "Chromecast", 62078: "iPhone", 7000: "AirPlay",
    22: "SSH", 445: "Windows", 3389: "Escritorio remoto", 554: "camara", 631: "impresora",
    9100: "impresora", 1883: "MQTT", 8123: "Home Assistant", 1400: "Sonos", 6053: "ESPHome",
}
SERVICIOS_MDNS = (
    "_googlecast._tcp", "_airplay._tcp", "_raop._tcp", "_hap._tcp", "_homekit._tcp",
    "_shelly._tcp", "_ewelink._tcp", "_esphomelib._tcp", "_wled._tcp", "_hue._tcp",
    "_ipp._tcp", "_printer._tcp", "_spotify-connect._tcp", "_sonos._tcp",
    "_companion-link._tcp", "_androidtvremote2._tcp", "_amzn-wplay._tcp",
    "_matter._tcp", "_workstation._tcp", "_smb._tcp", "_arduino._tcp", "_http._tcp",
)
# prefijos de MAC de Espressif: el chip de casi todos los enchufes y luces WiFi baratos (y del ESP32 de Pixel)
ESPRESSIF = {
    "18:fe:34", "24:0a:c4", "24:62:ab", "24:6f:28", "2c:f4:32", "30:ae:a4", "3c:61:05", "3c:71:bf",
    "40:f5:20", "48:3f:da", "4c:11:ae", "54:32:04", "5c:cf:7f", "60:01:94", "68:c6:3a", "70:b8:f6",
    "78:21:84", "7c:9e:bd", "7c:df:a1", "80:7d:3a", "84:cc:a8", "84:f3:eb", "8c:aa:b5", "94:b9:7e",
    "98:f4:ab", "a0:20:a6", "a4:cf:12", "ac:67:b2", "b4:e6:2d", "bc:dd:c2", "c4:4f:33", "c8:2b:96",
    "cc:50:e3", "d8:a0:1d", "dc:4f:22", "e8:db:84", "ec:fa:bc", "f4:12:fa", "08:3a:f2", "10:52:1c",
    "34:85:18", "34:94:54", "58:bf:25", "64:e8:33", "48:27:e2", "dc:54:75", "ec:da:3b", "f0:9e:9e",
    "20:6e:f1",         # visto en el ESP32-S3 de Pixel (Pixel-877C = ...:87:7c)
}
TIPOS = ("luz", "enchufe", "tv", "altavoz", "camara", "impresora", "movil", "ordenador", "router", "pixel", "otro")

# Windows (instalador .exe): no hay "ip" ni /proc/net/arp; "arp -a" y "ping -n" si. Sin ventana de consola.
WINDOWS = os.name == "nt"
_SIN_VENTANA = {"creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0)} if WINDOWS else {}
# 12 nov (Windows en espanol): "arp -a" escribe "Dirección" en la pagina de codigos de la consola (oem), no en
# UTF-8. Con text=True y -X utf8 la lectura fallaba en el hilo de subprocess, stdout quedaba en None y re.finditer
# daba "No pude buscar: expected string or bytes-like object". Solo hacen falta las IP y las MAC (ASCII).
_TEXTO = {"encoding": "oem" if WINDOWS else "utf-8", "errors": "replace"}


def _hay(texto, *palabras):
    """Alguna palabra que empiece por una de estas ("tv" vale en "tv-sala", no en "atv")."""
    return re.search(r"\b(?:%s)" % "|".join(map(re.escape, palabras)), texto) is not None


_RE_TITULO = re.compile(rb"<title[^>]*>([^<]{1,80})</title>", re.I)
_lock = threading.Lock()
_busqueda = {"estado": "", "fase": "", "t": 0.0, "encontrados": [], "red": ""}
_vivos = {}             # mac -> {"ip", "ok", "t"}: ultima comprobacion de los guardados


# ------------------------------------------------------------------ red y ARP

def _red():
    """(ip del PC, puerta de enlace, lista de IP a recorrer): la interfaz con ruta por defecto, o la primera con IP."""
    if WINDOWS:
        return _red_windows()
    ruta = subprocess.run(["ip", "-o", "route", "get", "1.1.1.1"], capture_output=True, text=True).stdout
    m = re.search(r"via (\S+) .*?src (\S+)", ruta)
    if m:
        gateway, ip = m.group(1), m.group(2)
    else:                                   # red sin salida a internet (router propio en la feria)
        direcciones = subprocess.run(["ip", "-o", "-4", "addr", "show", "scope", "global"],
                                     capture_output=True, text=True).stdout
        m = re.search(r"inet (\d+\.\d+\.\d+\.\d+)/", direcciones)
        if not m:
            raise RuntimeError("El PC no está conectado a ninguna red.")
        gateway, ip = "", m.group(1)
    base = ip.rsplit(".", 1)[0]
    ips = ["%s.%d" % (base, i) for i in range(1, 255) if "%s.%d" % (base, i) != ip]
    return ip, gateway, ips[:MAX_HOSTS]


def _red_windows():
    """Como _red(), sin "ip": la IP de la interfaz que sale a internet (un UDP sin enviar nada). Sin puerta de enlace."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("1.1.1.1", 80))
        ip = s.getsockname()[0]
    except OSError:
        raise RuntimeError("El PC no está conectado a ninguna red.")
    finally:
        s.close()
    base = ip.rsplit(".", 1)[0]
    ips = ["%s.%d" % (base, i) for i in range(1, 255) if "%s.%d" % (base, i) != ip]
    return ip, "", ips[:MAX_HOSTS]


def _arp_windows():
    """{ip: mac} de "arp -a" (las MAC vienen con guiones: 00-11-22-33-44-55)."""
    tabla = {}
    try:
        salida = subprocess.run(["arp", "-a"], capture_output=True, timeout=5, **_TEXTO, **_SIN_VENTANA).stdout
    except (OSError, subprocess.TimeoutExpired):
        return tabla
    for m in re.finditer(r"(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F]{2}(?:-[0-9a-fA-F]{2}){5})", salida or ""):
        mac = m.group(2).lower().replace("-", ":")
        if mac not in ("00:00:00:00:00:00", "ff:ff:ff:ff:ff:ff"):
            tabla[m.group(1)] = mac
    return tabla


def _arp():
    """{ip: mac} de las entradas ARP completas."""
    if WINDOWS:
        return _arp_windows()
    tabla = {}
    try:
        with open("/proc/net/arp") as f:
            next(f)
            for linea in f:
                partes = linea.split()
                if len(partes) >= 4 and partes[2] == "0x2" and partes[3] != "00:00:00:00:00:00":
                    tabla[partes[0]] = partes[3].lower()
    except OSError:
        pass
    return tabla


def _sin_eco_arp(tabla, gateway=""):
    """Quita las IP que contesta otro por ellas: la misma MAC en mas de ECO_ARP direcciones (salvo el router)."""
    cuantas = collections.Counter(tabla.values())
    falsas = {m for m, n in cuantas.items() if n > ECO_ARP}
    return {i: m for i, m in tabla.items() if m not in falsas or i == gateway}


def _tocar(ips):
    """Un datagrama vacio a cada IP (puerto 9, discard): el kernel resuelve su MAC por ARP."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        for ip in ips:
            try:
                s.sendto(b"", (ip, 9))
            except OSError:
                pass
    finally:
        s.close()


# ------------------------------------------------------------------ mDNS

def _nombre_dns(datos, i):
    """Lee un nombre DNS (con punteros de compresion) desde i: (nombre, posicion tras el)."""
    partes, saltado, fin = [], False, i
    for _ in range(64):
        largo = datos[i]
        if largo == 0:
            i += 1
            break
        if largo & 0xC0 == 0xC0:
            if not saltado:
                fin = i + 2
            i, saltado = ((largo & 0x3F) << 8) | datos[i + 1], True
            continue
        partes.append(datos[i + 1:i + 1 + largo].decode("utf-8", "replace"))
        i += 1 + largo
    return ".".join(partes), (fin if saltado else i)


def _consulta_mdns(preguntas):
    cab = struct.pack(">HHHHHH", 0, 0, len(preguntas), 0, 0, 0)
    cuerpo = b""
    for nombre, tipo in preguntas:
        for parte in nombre.split("."):
            cuerpo += bytes([len(parte.encode())]) + parte.encode()
        cuerpo += b"\x00" + struct.pack(">HH", tipo, 0x8001)      # clase IN con respuesta unicast
    return cab + cuerpo


def _leer_mdns(datos):
    """Registros de una respuesta: lista de (nombre, tipo, valor)."""
    _, _, nq, nr, na, nx = struct.unpack(">HHHHHH", datos[:12])
    i = 12
    for _ in range(nq):
        _, i = _nombre_dns(datos, i)
        i += 4
    registros = []
    for _ in range(nr + na + nx):
        nombre, i = _nombre_dns(datos, i)
        tipo, _, _, largo = struct.unpack(">HHIH", datos[i:i + 10])
        i += 10
        rdata = datos[i:i + largo]
        if tipo == 12:                                      # PTR
            valor = _nombre_dns(datos, i)[0]
        elif tipo == 16:                                    # TXT
            valor, j = {}, 0
            while j < len(rdata):
                trozo = rdata[j + 1:j + 1 + rdata[j]].decode("utf-8", "replace")
                j += 1 + rdata[j]
                if "=" in trozo:
                    k, v = trozo.split("=", 1)
                    valor[k.lower()] = v
        elif tipo == 33:                                    # SRV: el nombre del equipo
            valor = _nombre_dns(datos, i + 6)[0]
        elif tipo == 1 and largo == 4:
            valor = socket.inet_ntoa(rdata)
        else:
            valor = None
        registros.append((nombre, tipo, valor))
        i += largo
    return registros


def _mdns(ips):
    """{ip: {"nombres": [...], "servicios": [...], "txt": {...}}} de lo que conteste por mDNS."""
    res = {}
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.settimeout(0.25)
    try:
        s.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 255)
        servicios = [(srv + ".local", 12) for srv in SERVICIOS_MDNS]
        inversos = [(".".join(reversed(ip.split("."))) + ".in-addr.arpa", 12) for ip in ips]
        for lote in (servicios[:12], servicios[12:]):
            s.sendto(_consulta_mdns(lote), ("224.0.0.251", 5353))
        for k in range(0, len(inversos), 40):
            s.sendto(_consulta_mdns(inversos[k:k + 40]), ("224.0.0.251", 5353))
        fin = time.monotonic() + MDNS_S
        while time.monotonic() < fin:
            try:
                datos, (ip, _) = s.recvfrom(9000)
            except socket.timeout:
                continue
            try:
                registros = _leer_mdns(datos)
            except (IndexError, struct.error):
                continue
            d = res.setdefault(ip, {"nombres": [], "servicios": [], "txt": {}})
            for nombre, tipo, valor in registros:
                if tipo == 12 and nombre.endswith(".in-addr.arpa") and valor:
                    d["nombres"].append(valor.replace(".local", ""))
                elif tipo == 12 and valor and nombre.split(".local")[0] in SERVICIOS_MDNS:
                    servicio = nombre.split(".local")[0]
                    if servicio not in d["servicios"]:
                        d["servicios"].append(servicio)
                    instancia = valor.split("." + servicio)[0]
                    if instancia and len(instancia) < 60:
                        d["nombres"].append(instancia)
                elif tipo == 16 and isinstance(valor, dict):
                    d["txt"].update(valor)
                elif tipo == 33 and valor:
                    d["nombres"].append(valor.replace(".local", ""))
    except OSError:
        pass
    finally:
        s.close()
    return res


# ------------------------------------------------------------------ sondas por equipo

def _puerto(ip, puerto):
    """True abierto, False cerrado pero el equipo contesta, None sin respuesta."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(TCP_TIMEOUT_S)
    try:
        r = s.connect_ex((ip, puerto))
        return True if r == 0 else (False if r == 111 else None)      # 111: conexion rehusada
    except OSError:
        return None
    finally:
        s.close()


def _http(ip, ruta, maximo=4096):
    try:
        with urllib.request.urlopen("http://%s%s" % (ip, ruta), timeout=1.2) as r:
            return r.read(maximo)
    except Exception:
        return b""


def _kasa(ip):
    """Enchufes y bombillas TP-Link Kasa: get_sysinfo por el puerto 9999 (cifrado XOR con clave 171)."""
    def cifrar(texto):
        clave, salida = 171, bytearray()
        for b in texto.encode():
            clave ^= b
            salida.append(clave)
        return struct.pack(">I", len(salida)) + bytes(salida)

    try:
        with socket.create_connection((ip, 9999), timeout=1.2) as s:
            s.sendall(cifrar('{"system":{"get_sysinfo":{}}}'))
            datos = s.recv(4096)
            while len(datos) >= 4 and len(datos) < struct.unpack(">I", datos[:4])[0] + 4:
                trozo = s.recv(4096)
                if not trozo:
                    break
                datos += trozo
        clave, texto = 171, bytearray()
        for b in datos[4:]:
            texto.append(clave ^ b)
            clave = b
        info = json.loads(texto.decode())["system"]["get_sysinfo"]
        return {"nombre": info.get("alias", ""), "modelo": info.get("model", ""),
                "tipo": "luz" if "light" in json.dumps(info).lower() else "enchufe"}
    except Exception:
        return None


def _shelly(ip):
    try:
        info = json.loads(_http(ip, "/shelly").decode())
    except ValueError:
        return None
    modelo = info.get("type") or info.get("model") or info.get("app") or ""
    if not modelo:
        return None
    tipo = "luz" if any(k in modelo.lower() for k in ("bulb", "dimmer", "rgbw", "duo", "vintage", "shbl")) else "enchufe"
    return {"nombre": info.get("name") or "", "modelo": modelo, "tipo": tipo}


def _hostname(ip):
    try:
        nombre = socket.gethostbyaddr(ip)[0]
    except (OSError, UnicodeError):
        return ""
    return "" if nombre == ip or nombre.startswith("_") else nombre.split(".")[0]      # "_gateway" de systemd-resolved


def _privada(mac):
    """MAC aleatoria (bit de administracion local): moviles y portatiles modernos."""
    return int(mac[1], 16) & 0x2 != 0


def _examinar(ip, mac, mdns, ips_pixel, gateway):
    """Todo lo que se sabe de un equipo: nombre, fabricante, tipo, puertos."""
    abiertos = [p for p in PUERTOS if _puerto(ip, p)]
    info = mdns.get(ip, {"nombres": [], "servicios": [], "txt": {}})
    nombres = [n for n in info["nombres"] if n]
    txt, servicios = info["txt"], info["servicios"]
    fabricante, modelo, tipo = "", "", ""
    if mac[:8] in ESPRESSIF:
        fabricante = "chip ESP (Espressif)"
    if 9999 in abiertos:
        kasa = _kasa(ip)
        if kasa:
            fabricante, modelo, tipo = "TP-Link Kasa", kasa["modelo"], kasa["tipo"]
            nombres.insert(0, kasa["nombre"])
    if 80 in abiertos and not tipo and ("shelly" in " ".join(nombres + servicios).lower() or mac[:8] in ESPRESSIF):
        shelly = _shelly(ip)
        if shelly:
            fabricante, modelo, tipo = "Shelly", shelly["modelo"], shelly["tipo"]
            nombres.insert(0, shelly["nombre"])
    if "fn" in txt:                                       # Chromecast y Google TV: nombre amigable
        nombres.insert(0, txt["fn"])
    if "md" in txt and not modelo:
        modelo = txt["md"]
    titulo = ""
    if 80 in abiertos and not tipo:
        m = _RE_TITULO.search(_http(ip, "/"))
        titulo = m.group(1).decode("utf-8", "replace").strip() if m else ""
    host = _hostname(ip)

    if ip in ips_pixel:
        tipo = "pixel"
    elif ip == gateway:
        tipo = "router"
    elif not tipo:
        todo = " ".join(nombres + servicios + [titulo, host, modelo]).lower()
        if 6668 in abiertos or "tuya" in todo or "smart life" in todo:
            fabricante, tipo = fabricante or "Tuya / Smart Life", "enchufe"
        elif "_ewelink._tcp" in servicios or 8081 in abiertos and mac[:8] in ESPRESSIF:
            fabricante, tipo = "Sonoff", "enchufe"
        elif _hay(todo, "wled", "hue", "bulb", "lamp", "light", "foco", "bombilla", "yeelight"):
            tipo = "luz"
        elif 6053 in abiertos or _hay(todo, "tasmota", "esphome", "plug", "enchufe", "switch", "relay"):
            tipo = "enchufe"
        elif "_googlecast._tcp" in servicios or "_androidtvremote2._tcp" in servicios or "_amzn-wplay._tcp" in servicios \
                or _hay(todo, "tv", "roku", "chromecast", "firetv", "fire-tv"):
            tipo = "tv" if not _hay(todo, "speaker", "nest", "home-mini", "altavoz") else "altavoz"
        elif "_sonos._tcp" in servicios or "_spotify-connect._tcp" in servicios or 1400 in abiertos \
                or "_raop._tcp" in servicios and "_airplay._tcp" not in servicios:
            tipo = "altavoz"
        elif "_ipp._tcp" in servicios or "_printer._tcp" in servicios or 631 in abiertos or 9100 in abiertos:
            tipo = "impresora"
        elif 554 in abiertos or _hay(todo, "camera", "camara", "cam", "ipc"):
            tipo = "camara"
        elif 62078 in abiertos or _hay(todo, "iphone", "ipad", "android", "galaxy", "redmi", "xiaomi", "moto", "huawei", "honor"):
            tipo = "movil"
        elif any(p in abiertos for p in (22, 445, 3389)) or "_workstation._tcp" in servicios \
                or _hay(todo, "desktop", "laptop", "macbook", "pc", "portatil"):
            tipo = "ordenador"
        elif mac[:8] in ESPRESSIF and abiertos:      # sin puertos abiertos puede ser un ESP32 de Pixel
            tipo = "enchufe"
        elif _privada(mac):
            tipo = "movil"
        else:
            tipo = "otro"
    nombre = next((n for n in nombres + [titulo, host] if n), "")
    if not fabricante and _privada(mac):
        fabricante = "dirección privada"
    return {"ip": ip, "mac": mac, "nombre": nombre[:60], "tipo": tipo, "fabricante": fabricante,
            "modelo": modelo[:40], "puertos": [PUERTOS[p] for p in abiertos], "host": host}


# ------------------------------------------------------------------ busqueda

def buscar(ips_pixel=()):
    """Arranca una busqueda en un hilo; el progreso sale en estado()["busqueda"]."""
    with _lock:
        if _busqueda["estado"] == "buscando" and time.monotonic() - _busqueda["t"] < 90:
            raise RuntimeError("Ya estoy buscando en la red.")
        _busqueda.update(estado="buscando", fase="Mirando quién está en la red…", t=time.monotonic())

    def hilo():
        try:
            ip, gateway, ips = _red()
            _busqueda["red"] = ip.rsplit(".", 1)[0] + ".0/24"
            _tocar(ips)
            time.sleep(0.6)
            _tocar(ips)                     # segunda pasada: algunos equipos dormidos tardan en contestar
            time.sleep(ESPERA_ARP_S)
            tabla = _sin_eco_arp({i: m for i, m in _arp().items() if i in ips}, gateway)
            _busqueda["fase"] = "Preguntando nombres a %d equipos…" % len(tabla)
            mdns = _mdns(list(tabla))
            _busqueda["fase"] = "Probando si son enchufes, luces o pantallas…"
            with concurrent.futures.ThreadPoolExecutor(max_workers=24) as ex:
                futuros = [ex.submit(_examinar, i, m, mdns, set(ips_pixel), gateway) for i, m in tabla.items()]
                encontrados = [f.result() for f in futuros]
            orden = {t: n for n, t in enumerate(TIPOS)}
            encontrados.sort(key=lambda d: (d["tipo"] in ("router", "pixel"), orden.get(d["tipo"], 99),
                                            not d["nombre"], tuple(int(x) for x in d["ip"].split("."))))
            ahora = time.monotonic()
            for d in encontrados:
                _vivos[d["mac"]] = {"ip": d["ip"], "ok": True, "t": ahora}
            _busqueda.update(estado="listo", fase="", encontrados=encontrados, t=ahora)
        except Exception as e:
            _busqueda.update(estado="error", fase="No pude buscar: %s" % e, t=time.monotonic())

    threading.Thread(target=hilo, daemon=True).start()


def estado():
    hace = int(time.monotonic() - _busqueda["t"]) if _busqueda["t"] else None
    return {"busqueda": {"estado": _busqueda["estado"], "fase": _busqueda["fase"], "hace": hace,
                         "red": _busqueda["red"], "encontrados": _busqueda["encontrados"]}}


# ------------------------------------------------------------------ guardados: siguen encendidos?

def vivo(mac):
    """{"ip", "ok", "hace"} de la ultima comprobacion, o None si aun no se comprobo."""
    v = _vivos.get(mac)
    return None if v is None else {"ip": v["ip"], "ok": v["ok"], "hace": int(time.monotonic() - v["t"])}


def comprobar(guardados):
    """guardados: {mac: ip}. Mira cada uno por ARP y por TCP; si cambio de IP (DHCP), la encuentra por la MAC."""
    if not guardados:
        return
    _tocar(list(guardados.values()))
    time.sleep(1.0)
    tabla = {m: i for i, m in _arp().items()}
    for mac, ip in guardados.items():
        ip = tabla.get(mac, ip)
        ok = any(_puerto(ip, p) is not None for p in (80, 6668, 9999, 443, 8081))
        if not ok:
            cmd = ["ping", "-n", "1", "-w", "1000", ip] if WINDOWS else ["ping", "-c", "1", "-W", "1", ip]
            try:
                ok = subprocess.run(cmd, capture_output=True, **_SIN_VENTANA).returncode == 0
            except OSError:
                ok = False
        _vivos[mac] = {"ip": ip, "ok": ok, "t": time.monotonic()}


def vigilar(leer_guardados):
    """Hilo: cada VIGILAR_S comprueba los dispositivos WiFi guardados (leer_guardados() -> {mac: ip})."""
    def hilo():
        while True:
            try:
                comprobar(leer_guardados())
            except Exception:
                pass
            time.sleep(VIGILAR_S)

    threading.Thread(target=hilo, daemon=True).start()


if __name__ == "__main__":
    buscar()
    while _busqueda["estado"] == "buscando":
        print(_busqueda["fase"])
        time.sleep(1)
    print(json.dumps(estado(), ensure_ascii=False, indent=1))

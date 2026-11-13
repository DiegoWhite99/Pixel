#!/usr/bin/env python3
"""Fase 8 - Panel de administracion web, solo con la libreria estandar.

Sirve la app de web/ y una API JSON en PANEL_PORT, dentro del proceso del servidor:
lee el estado vivo (conexiones del ESP32, agenda, cuentas) y permite personalizar
el agente (voz, personalidad, largo de las respuestas), gestionar contactos, agenda
y dispositivos (Bluetooth y WiFi), y vincular Google. Lo arranca servidor.main()
con panel.iniciar().

La misma app de web/ esta publicada en Firebase Hosting; desde alli no llama a esta API
sino a la nube (nube.py, Fase 10), que ejecuta sus ordenes con estas mismas funciones.

Sin autenticacion: cualquiera en la misma red puede abrirlo. En la feria, red propia.
Un POST que venga de otra pagina (cabecera Origin ajena) se rechaza.
"""

import json
import os
import re
import socket
import threading
import time
import urllib.request
from datetime import date, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import acciones
import bluetooth_pc
import gemini
import groq_ia
import llm
import nube
import puente_pc
import recordatorios
import red_wifi

S = None           # el modulo del servidor en marcha; lo pone iniciar()

# voces que se ofrecen: id, nombre para la pantalla, modelo, hablante (o estilo). Desde la 2.0.0 (10 nov) van
# primero las de alta calidad, Supertonic 3 (tts_supertonic.py; las mismas que la app, web/voz.js): el
# usuario dijo que las de Piper estaban "del asco" y eligio la F4. Todas usan el mismo modelo (una carpeta);
# cambiar entre ellas no lo recarga. Las de Piper siguen para elegirlas en el panel.
SUPERTONIC = "voces/supertonic3"
VOCES = [("st-F4", "Alta calidad · Mujer 4 (la elegida)", SUPERTONIC, "F4")] + [
    ("st-%s" % e, "Alta calidad · %s %s" % ("Mujer" if e[0] == "F" else "Hombre", e[1]), SUPERTONIC, e)
    for e in ("F1", "F2", "F3", "F5", "M1", "M2", "M3", "M4", "M5")] + [
    ("claude", "Mujer · México", "voces_prueba/modelos/es_MX-claude-high.onnx", None),
    ("ald", "Hombre · México", "voces/es_MX-ald-medium.onnx", None),
    ("sharvard-f", "Sharvard · mujer · España", "voces/es_ES-sharvard-medium.onnx", "F"),
    ("daniela", "Daniela · mujer · Argentina (lenta)", "voces_prueba/modelos/es_AR-daniela-high.onnx", None),
]
RESPUESTAS = {"corta": "Responde en 1 o 2 frases.", "normal": "Responde en 2 a 4 frases."}
PERSONALIDAD_MAX = 300
PRUEBA_VOZ = "Hola, soy %s. Así sueno ahora."
PRUEBA_PC = "Hola, así suenan los altavoces del PC."     # sin "Píxel": el micro sigue abierto y no debe activarse
WEB_DIR = "web"
TIPOS_MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
              ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
              ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json",
              ".ico": "image/x-icon"}

# Fase 13: tipo de voz (tts.Tts.agudo): infantil = mas aguda sin hablar mas rapido (no hay voces de nino en espanol)
TONOS = {"normal": 1.0, "infantil": 1.32, "muy_infantil": 1.55}
# 2.0.0: el tono propio de cada voz, como base en web/voz.js. La de hombre (~160 Hz) un 8 % mas grave.
BASE_VOZ = {"ald": 0.92}
AJUSTES = {"voz": "st-F4", "personalidad": "", "respuesta": "normal", "salida_voz": "esp32", "tono": "normal",
           "ia": "gemini",        # Fase 15: la IA de internet que contesta primero si hay clave de las dos
           # 2.4.0, espejo con la app (web/espejo.js): la hora de Firebase (ms) del ultimo cambio de los ajustes del
           # agente (personalidad, respuesta, voz, tono) y de cada clave de IA y de la preferida. Gana el mas reciente.
           "t": 0, "ia_t": {}}
CAMPOS_ESPEJO = ("personalidad", "respuesta", "voz", "tono")
# 2.4.0: el perfil del usuario que escribio en la app (el texto de PixelPerfil.paraPrompt), para que el robot y el PC
# lo traten igual que la app. Lo manda la app de la cuenta que lo cambio mas recientemente (web/espejo.js).
PERFIL = {"texto": "", "t": 0, "de": ""}
PERFIL_MAX = 4000
# Lo que el PC hace por la IA (web/agente.md, {{CAPACIDADES}}): aqui la IA no llama funciones
CAPACIDADES_PC = (
    "- Te oyen por el robot Píxel o por los altavoces del computador, y te hablan por el micrófono del robot o del celular.\n"
    "- El programa hace estas cosas antes de llegar a ti, cuando el usuario las pide con estas palabras: «recuérdame…» y "
    "«qué recordatorios tengo»; «agenda…» y «qué tengo en el calendario» (en su Google Calendar si lo conectó en el "
    "programa); «manda un correo a…» (siempre lo lee antes y espera su «sí»); «pon … en YouTube» (en el computador).\n"
    "- Tú no ejecutas acciones ni tienes funciones: nunca digas que hiciste algo. Si te piden una de esas cosas con otras "
    "palabras, di que lo repitan empezando así, por ejemplo «Píxel, recuérdame…».\n"
    "- Lo demás (aparatos de la casa, música en el celular, notas, WhatsApp, el modo enfoque) lo hace Píxel en la app del celular.")
IAS = ("gemini", "groq")
# Donde escucha el panel. El programa instalado (instalador/pixel_lanzador.py) pone 127.0.0.1: su panel es la
# ventana de Pixel en ese PC, no una pagina para toda la red (pedido del 12 nov: "no desplegar un servidor web").
DIRECCION = "0.0.0.0"
PROGRAMA = {}        # el programa instalado: {"version", "apagar"} (lo pone el lanzador; sale en /api/estado)
SALIDAS_VOZ = ("esp32", "pc")
ACEPTADOS = {}      # mac -> {"nombre", "aceptado"} (Bluetooth del ESP32) o + {"via": "wifi", "ip", "tipo", "fabricante"}
_RE_MAC = re.compile(r"^[0-9a-f]{2}(:[0-9a-f]{2}){5}$")
_RE_IP = re.compile(r"^\d{1,3}(\.\d{1,3}){3}$")
_lock = threading.Lock()
_google = {"estado": "", "error": ""}       # vinculacion en curso o su ultimo resultado
_ollama = {"t": 0.0, "ok": False}           # cache de 10 s del chequeo de Ollama


def _ruta(nombre):
    return os.path.join(S.BASE_DIR, nombre)


def _guardar_json(ruta, datos):
    tmp = ruta + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(datos, f, ensure_ascii=False, indent=2)
    os.replace(tmp, ruta)


def _ip_local():
    """IP del PC en la red (la que el ESP32 necesita como SERVER_IP)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))        # UDP: no envia nada, solo elige interfaz
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def _ollama_ok():
    if time.monotonic() - _ollama["t"] > 10:
        try:
            with urllib.request.urlopen(S.LLM_HOST + "/api/tags", timeout=0.5):
                _ollama["ok"] = True
        except Exception:
            _ollama["ok"] = False
        _ollama["t"] = time.monotonic()
    return _ollama["ok"]


# ------------------------------------------------------------------ ajustes

def aplicar_ajustes():
    """Voz y prompt de sistema segun AJUSTES; vale para las conexiones abiertas y las nuevas."""
    from llm import prompt_con_fecha
    from tts import Tts
    voz = next((v for v in VOCES if v[0] == AJUSTES["voz"]), VOCES[0])
    if voz[2] == SUPERTONIC:
        from tts_supertonic import TtsSupertonic
        if S.TTS_VOZ != SUPERTONIC or S.TTS is None:
            S.TTS = TtsSupertonic(_ruta(SUPERTONIC), estilo=voz[3])
        S.TTS.estilo = voz[3]                   # misma carpeta: solo cambia el estilo, sin recargar
        S.TTS_VOZ, S.TTS_HABLANTE = voz[2], voz[3]
    elif (voz[2], voz[3]) != (S.TTS_VOZ, S.TTS_HABLANTE) or S.TTS is None:
        S.TTS = Tts(_ruta(voz[2]), hablante=voz[3]) if voz[3] else Tts(_ruta(voz[2]))
        S.TTS_VOZ, S.TTS_HABLANTE = voz[2], voz[3]
    system = instrucciones_pc() or prompt_con_fecha(date.today()).replace(RESPUESTAS["normal"], RESPUESTAS[AJUSTES["respuesta"]]) \
        + (" Tu estilo: %s" % AJUSTES["personalidad"] if AJUSTES["personalidad"] else "")
    S.LLM_SYSTEM = system
    with S._sesiones_lock:
        for sesion in S.SESIONES + list(S.MOVILES.values()):
            sesion.llm.system = system
    S.SALIDA_VOZ = AJUSTES["salida_voz"]
    llm.PREFERIDA = AJUSTES.get("ia") if AJUSTES.get("ia") in IAS else "gemini"
    S.TTS.agudo = TONOS.get(AJUSTES.get("tono"), 1.0) * BASE_VOZ.get(voz[0], 1.0)
    S.log("panel: voz %s (%s) por %s, respuestas %s, personalidad %r; instrucciones %s (%d caracteres)%s"
          % (voz[0], AJUSTES.get("tono", "normal"), AJUSTES["salida_voz"], AJUSTES["respuesta"], AJUSTES["personalidad"],
             "de la app (web/agente.md)" if "Divergencia IA" in system else "de respaldo", len(system),
             ", con el perfil de " + (PERFIL["de"] or "la app") if PERFIL["texto"] else ", sin perfil"))


def instrucciones_pc(hoy=None):
    """2.4.0: las mismas instrucciones que la app (web/agente.md) con el perfil, el largo y el estilo de aqui. Sin el
    archivo (no deberia pasar: va con el programa), "" y aplicar_ajustes usa las de antes."""
    import llm
    try:
        with open(os.path.join(_ruta(WEB_DIR), "agente.md"), encoding="utf-8") as f:
            plantilla = f.read()
    except OSError:
        return ""
    perfil = PERFIL["texto"] or "Todavía no escribió su perfil. Puede hacerlo en la app de Píxel, en Perfil."
    estilo = "Estilo que pidió el usuario: " + AJUSTES["personalidad"] if AJUSTES["personalidad"] else "Sin estilo especial: amable y natural."
    return llm.instrucciones(plantilla, hoy or date.today(), S.ACTIVACION, perfil, RESPUESTAS[AJUSTES["respuesta"]],
                             estilo, CAPACIDADES_PC)


def cargar_ajustes():
    ruta = _ruta(S.AJUSTES_ARCHIVO)
    if os.path.exists(ruta):
        with open(ruta, encoding="utf-8") as f:
            AJUSTES.update({k: v for k, v in json.load(f).items() if k in AJUSTES})
    ruta = _ruta(getattr(S, "PERFIL_ARCHIVO", "perfil.json"))
    if os.path.exists(ruta):
        try:
            with open(ruta, encoding="utf-8") as f:
                PERFIL.update({k: v for k, v in json.load(f).items() if k in PERFIL})
        except (OSError, ValueError):
            pass
    aplicar_ajustes()


# ------------------------------------------------------------------ estado

def _item(r):
    """Recordatorio o evento para la pantalla: id, texto, cuando (ISO) y cuando dicho."""
    t = datetime.fromisoformat(r["cuando"])
    return {"id": r["id"], "texto": r["texto"], "cuando": r["cuando"],
            "dicho": recordatorios.cuando_hablado(t, datetime.now())}


def estado():
    ahora = time.monotonic()
    with S._sesiones_lock:
        sesiones = list(S.SESIONES)
    cerca = {}          # mac -> lo mejor que lo vio algun ESP32: rssi y hace cuantos segundos
    for s in sesiones:
        if s.ble_t is None:
            continue
        for v in s.ble:
            hace = int(ahora - s.ble_t)
            if v["mac"] not in cerca or v["rssi"] > cerca[v["mac"]]["rssi"]:
                cerca[v["mac"]] = {"rssi": v["rssi"], "hace": hace}
    dispositivos = []
    for s in sesiones:
        callado = ahora - s.ultimo_audio
        dispositivos.append({
            "ip": s.addr[0], "puerto": s.addr[1],
            "desde": s.desde.strftime("%H:%M:%S"),
            "minutos": int((datetime.now() - s.desde).total_seconds() // 60),
            "estado": "sin datos" if callado > 5 else ("hablando" if s.respondiendo.is_set() else "escuchando"),
            "frases": s.n_frases, "pico": s.pico_sesion,
            "piso": round(s.piso) if s.piso is not None else None,
            "ultimo": s.ultimo_texto,
            "ble": {"yo": s.ble_yo,
                    "vistos": [dict(v, aceptado=v["mac"] in ACEPTADOS) for v in s.ble],
                    "hace": int(ahora - s.ble_t) if s.ble_t is not None else None},
        })
    mios = []
    with _lock:
        aceptados = dict(ACEPTADOS)
    for mac in sorted(aceptados, key=lambda m: aceptados[m]["nombre"].lower()):
        a = aceptados[mac]
        if a.get("via") == "wifi":
            v = red_wifi.vivo(mac)
            mios.append(dict(a, mac=mac, ip=v["ip"] if v else a["ip"],
                             encendido=v["ok"] if v else None, hace=v["hace"] if v else None))
        else:
            mios.append(dict(a, mac=mac, via="ble", cerca=mac in cerca and cerca[mac]["hace"] < 120,
                             **(cerca.get(mac) or {"rssi": None, "hace": None})))
    wifi = red_wifi.estado()
    wifi["busqueda"]["encontrados"] = [dict(d, agregado=d["mac"] in aceptados)
                                       for d in wifi["busqueda"]["encontrados"]]
    activos = [d for d in dispositivos if d["estado"] != "sin datos"]

    hoy = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    pendientes = [_item(r) for r in acciones.AGENDA.pendientes()]
    eventos = [_item(e) for e in acciones.EVENTOS.pendientes() if e["cuando"] >= hoy]

    google = acciones.GOOGLE
    return {
        "servidor": {"ip": _ip_local(), "puerto": S.PORT, "panel": S.PANEL_PORT,
                     "ollama": _ollama_ok(), "stt": S.STT_MODELO, "llm": S.LLM_MODELO},
        "dispositivos": dispositivos,
        "activos": len(activos),
        "celulares": nube.celulares(),      # Fase 11: las apps enlazadas que hacen de Pixel, escuchen o no
        "mis_dispositivos": mios,
        "bt_pc": bluetooth_pc.estado(),
        "wifi": wifi,
        "nube": nube.estado_local(),
        "puente": puente_pc.estado(),       # Fase 13: lo que este PC sabe hacer como puente de aparatos
        "obsidian": _obsidian(),
        "portal": {"red": "Pixel asistente de voz", "clave": "pixel2026", "direccion": "192.168.4.1"},
        "agente": {"activacion": S.ACTIVACION, "ajustes": dict(AJUSTES), "perfil": dict(PERFIL),
                   "voces": [{"id": v[0], "nombre": v[1]} for v in VOCES],
                   "personalidad_max": PERSONALIDAD_MAX},
        "cuentas": {
            "google": {"vinculada": google is not None,
                       "autorizado": getattr(google, "autorizado", None),
                       "credenciales": os.path.exists(_ruta(S.GOOGLE_CLIENTE)),
                       "estado": _google["estado"], "error": _google["error"]},
            "contactos": [{"nombre": n, "correo": c} for n, c in acciones.CONTACTOS.items()],
            "gemini": gemini.estado(),          # sin la clave: solo si hay, el modelo y el ultimo error
            "groq": groq_ia.estado(),
            "ia": AJUSTES.get("ia", "gemini"),
        },
        "agenda": {"recordatorios": pendientes, "eventos": eventos},
        "programa": PROGRAMA,
    }


def _obsidian():
    import sys
    m = sys.modules.get("obsidian")
    return m.estado() if m else {"activa": False, "cuentas": 0, "error": "", "boveda": ""}


def voz():
    """La voz que esta sonando o va a sonar (volumen cada pocos ms y cuando empieza), para la boca de la cara 3D."""
    with S._sesiones_lock:
        sesiones = list(S.SESIONES)
    ahora = int(time.time() * 1000)
    segmentos = [v for s in sesiones for v in list(s.voz) if v["t"] + len(v["niveles"]) * v["paso"] > ahora - 2000]
    return {"ahora": ahora, "segmentos": segmentos}


# ------------------------------------------------------------------ acciones del panel

class ErrorPanel(Exception):
    pass


def _hora(d):
    """La hora del cambio: la que trae la orden de la app (espejo) o la de ahora, con el reloj de Firebase."""
    t = d.get("t")
    return int(t) if isinstance(t, (int, float)) and not isinstance(t, bool) and t > 0 else nube.ahora_ms()


def _marcar_ia(cual, d):
    """Apunta la hora del cambio de una clave (gemini, groq) o de la preferida, para el espejo con la app."""
    with _lock:
        AJUSTES["ia_t"] = dict(AJUSTES.get("ia_t") or {}, **{cual: _hora(d)})
        _guardar_json(_ruta(S.AJUSTES_ARCHIVO), AJUSTES)


def guardar_agente(d):
    voz, respuesta = d.get("voz"), d.get("respuesta")
    salida = d.get("salida_voz") or AJUSTES["salida_voz"]
    tono = d.get("tono") or AJUSTES.get("tono", "normal")
    personalidad = (d.get("personalidad") or "").strip()
    if voz not in [v[0] for v in VOCES] or respuesta not in RESPUESTAS or salida not in SALIDAS_VOZ or tono not in TONOS:
        raise ErrorPanel("Voz, tipo de voz, salida o largo de respuesta desconocidos.")
    if len(personalidad) > PERSONALIDAD_MAX:
        raise ErrorPanel("La personalidad admite hasta %d caracteres." % PERSONALIDAD_MAX)
    nuevos = dict(voz=voz, respuesta=respuesta, personalidad=personalidad, tono=tono)
    with _lock:
        if any(AJUSTES.get(k) != nuevos[k] for k in CAMPOS_ESPEJO) or "t" in d:
            AJUSTES["t"] = _hora(d)              # 2.4.0: el espejo con la app compara esta hora
        AJUSTES.update(nuevos, salida_voz=salida)
        _guardar_json(_ruta(S.AJUSTES_ARCHIVO), AJUSTES)
        aplicar_ajustes()
    return {"mensaje": "Guardado. Las próximas respuestas ya lo usan."}


def probar_voz(d):
    """donde: "pc" (la salida de audio del PC), "esp32" (el altavoz de Pixel) o nada (por donde habla ahora)."""
    donde = d.get("donde")
    if donde == "pc":
        if S.SALIDA_PC is None or S.TTS is None:
            raise ErrorPanel("El PC no tiene salida de audio.")
        threading.Thread(target=lambda: S.SALIDA_PC.reproducir(S.TTS.sintetizar(PRUEBA_PC)), daemon=True).start()
        return {"mensaje": "Escucha: suena por %s." % bluetooth_pc.estado()["musica_en"]}
    if donde == "esp32":
        with S._sesiones_lock:
            sesion = S.SESIONES[-1] if S.SESIONES else None
        if sesion is None:
            raise ErrorPanel("No hay ningún ESP32 conectado para oír la prueba.")
        sesion.cola.put(("decir_esp32", PRUEBA_VOZ % S.ACTIVACION))
        return {"mensaje": "Escucha el altavoz de Píxel."}
    sesion = S.sesion_que_habla()       # sin ESP32, el celular que escucha (Fase 11)
    if sesion is None:
        raise ErrorPanel("No hay ningún ESP32 conectado ni ningún celular escuchando para oír la prueba.")
    sesion.cola.put(("decir", PRUEBA_VOZ % S.ACTIVACION))
    if isinstance(sesion, S.SesionMovil):
        return {"mensaje": "Escucha el celular."}
    return {"mensaje": "Escucha: suena por el altavoz del PC." if AJUSTES["salida_voz"] == "pc" else "Escucha el ESP32."}


def guardar_contacto(d):
    nombre = (d.get("nombre") or "").strip()
    correo = (d.get("correo") or "").strip()
    if not nombre or "@" not in correo or " " in correo or len(nombre) > 40:
        raise ErrorPanel("Pon un nombre y un correo válido.")
    with _lock:
        contactos = dict(acciones.CONTACTOS)
        contactos[nombre] = correo
        _guardar_json(_ruta(S.CONTACTOS_ARCHIVO), contactos)
        acciones.CONTACTOS = contactos
    return {"mensaje": "Contacto guardado."}


def borrar_contacto(d):
    with _lock:
        contactos = dict(acciones.CONTACTOS)
        if contactos.pop(d.get("nombre"), None) is None:
            raise ErrorPanel("Ese contacto no existe.")
        _guardar_json(_ruta(S.CONTACTOS_ARCHIVO), contactos)
        acciones.CONTACTOS = contactos
    return {"mensaje": "Contacto borrado."}


def borrar_agenda(d):
    agenda = {"recordatorio": acciones.AGENDA, "evento": acciones.EVENTOS}.get(d.get("tipo"))
    # 2.4.3: los recordatorios de la nube tienen id de texto ("<uid>/<clave>", agenda_nube.py)
    if agenda is None or not (isinstance(d.get("id"), int) or (d.get("tipo") == "recordatorio" and isinstance(d.get("id"), str))):
        raise ErrorPanel("No sé qué borrar.")
    if not agenda.borrar({d["id"]}):
        raise ErrorPanel("Ya no estaba.")
    return {"mensaje": "Borrado."}


def aceptar_dispositivo(d):
    mac = (d.get("mac") or "").strip().lower()
    nombre = (d.get("nombre") or "").strip()
    if not _RE_MAC.match(mac):
        raise ErrorPanel("Esa dirección Bluetooth no es válida.")
    if not nombre or len(nombre) > 40:
        raise ErrorPanel("Ponle un nombre de hasta 40 caracteres.")
    with _lock:
        ACEPTADOS[mac] = {"nombre": nombre, "aceptado": datetime.now().isoformat(timespec="seconds")}
        _guardar_json(_ruta(S.DISPOSITIVOS_ARCHIVO), ACEPTADOS)
    S.log("panel: dispositivo Bluetooth aceptado: %s (%s)" % (nombre, mac))
    return {"mensaje": "%s aceptado." % nombre}


def buscar_wifi(d):
    with S._sesiones_lock:
        ips_pixel = [s.addr[0] for s in S.SESIONES] + list(S.PIXELES_VISTOS)
    try:
        red_wifi.buscar(ips_pixel)
    except RuntimeError as e:
        raise ErrorPanel(str(e))
    return {"mensaje": "Buscando en tu red WiFi…"}


def agregar_wifi(d):
    mac = (d.get("mac") or "").strip().lower()
    ip = (d.get("ip") or "").strip()
    nombre = (d.get("nombre") or "").strip()
    tipo = d.get("tipo") or "otro"
    if not _RE_MAC.match(mac) or not _RE_IP.match(ip):
        raise ErrorPanel("Ese dispositivo no tiene una dirección válida.")
    if not nombre or len(nombre) > 40:
        raise ErrorPanel("Ponle un nombre de hasta 40 caracteres.")
    if tipo not in red_wifi.TIPOS:
        raise ErrorPanel("Tipo de dispositivo desconocido.")
    visto = next((x for x in red_wifi.estado()["busqueda"]["encontrados"] if x["mac"] == mac), {})
    with _lock:
        ACEPTADOS[mac] = {"nombre": nombre, "aceptado": datetime.now().isoformat(timespec="seconds"),
                          "via": "wifi", "ip": ip, "tipo": tipo, "fabricante": visto.get("fabricante", "")}
        _guardar_json(_ruta(S.DISPOSITIVOS_ARCHIVO), ACEPTADOS)
    S.log("panel: dispositivo WiFi agregado: %s (%s, %s, %s)" % (nombre, tipo, ip, mac))
    return {"mensaje": "%s agregado." % nombre}


def _wifi_guardados():
    with _lock:
        return {m: a["ip"] for m, a in ACEPTADOS.items() if a.get("via") == "wifi"}


def olvidar_dispositivo(d):
    mac = (d.get("mac") or "").strip().lower()
    with _lock:
        if ACEPTADOS.pop(mac, None) is None:
            raise ErrorPanel("Ese dispositivo no estaba aceptado.")
        _guardar_json(_ruta(S.DISPOSITIVOS_ARCHIVO), ACEPTADOS)
    return {"mensaje": "Dispositivo olvidado."}


def _bt(funcion, mensaje, con_mac=True):
    """Envuelve una operacion de bluetooth_pc: sus errores salen como mensaje del panel."""
    def ruta(d):
        try:
            funcion(d.get("mac") or "") if con_mac else funcion()
        except (RuntimeError, ValueError) as e:
            raise ErrorPanel(str(e))
        return {"mensaje": mensaje}
    return ruta


def vincular_google(d):
    import servicios_google
    cliente, token = _ruta(S.GOOGLE_CLIENTE), _ruta(S.GOOGLE_TOKEN)
    if not os.path.exists(cliente):
        raise ErrorPanel("Falta google_cliente.json: primero hay que crear las credenciales en Google Cloud.")
    if _google["estado"] == "esperando":
        raise ErrorPanel("Ya hay una vinculación abierta en el navegador del PC.")

    def hilo():
        _google.update(estado="esperando", error="")
        try:
            servicios_google.autorizar(cliente, token)
            acciones.GOOGLE = servicios_google.Google(cliente, token)
            _google["estado"] = "vinculada"
            S.log("panel: Google vinculado")
        except Exception as e:
            _google.update(estado="error", error=("%s: %s" % (type(e).__name__, e))[:200])
            S.log("panel: fallo al vincular Google: %s" % _google["error"])

    threading.Thread(target=hilo, daemon=True).start()
    return {"mensaje": "Se abrió Google en el navegador del PC. Entra con la cuenta y acepta."}


def guardar_perfil(d):
    """2.4.0: el perfil del usuario desde la app (orden de la nube, solo de las cuentas enlazadas): el robot y este PC
    lo tratan igual que la app (instrucciones_pc). Lo cambia la app, no la ventana: aqui solo se muestra."""
    texto = d.get("texto")
    if not isinstance(texto, str) or len(texto) > PERFIL_MAX:
        raise ErrorPanel("Ese perfil no se puede guardar.")
    with _lock:
        PERFIL.update(texto=texto.strip(), t=_hora(d), de=str(d.get("de") or "")[:60])
        _guardar_json(_ruta(S.PERFIL_ARCHIVO), PERFIL)
        aplicar_ajustes()
    return {"mensaje": "Perfil al día: Píxel ya lo usa también aquí."}


def guardar_credencial_google(d):
    """2.4.0: la credencial de "App de escritorio" de Google Cloud, cargada desde la ventana del programa (el
    usuario: "te pedi que se vinculara en la aplicacion de escritorio la cuenta de Google y no lo hace"). Sin ella
    "Conectar con Google" no puede abrir el permiso. Se guarda como google_cliente.json en la carpeta de datos."""
    texto = d.get("json")
    try:
        cred = json.loads(texto) if isinstance(texto, str) and len(texto) < 20000 else None
    except ValueError:
        cred = None
    if not isinstance(cred, dict):
        raise ErrorPanel("Ese archivo no es la credencial: es el .json que bajas de Google Cloud al crear el cliente.")
    if "web" in cred and "installed" not in cred:
        raise ErrorPanel("Esa credencial es de tipo «Aplicación web». Crea una de tipo «App de escritorio» y carga esa.")
    datos = cred.get("installed")
    if not isinstance(datos, dict) or not str(datos.get("client_id", "")).endswith(".apps.googleusercontent.com") \
            or not datos.get("client_secret"):
        raise ErrorPanel("A ese archivo le falta el cliente de Google («installed»). Bájalo otra vez desde Google Cloud.")
    with _lock:
        S.GOOGLE_CLIENTE = "google_cliente.json"     # la de la carpeta de datos manda sobre la del paquete
        ruta = _ruta(S.GOOGLE_CLIENTE)
        _guardar_json(ruta, {"installed": datos})
        try:
            os.chmod(ruta, 0o600)
        except OSError:
            pass
    S.log("panel: credencial de Google cargada (%s…)" % datos["client_id"][:12])
    return {"mensaje": "Credencial guardada. Ahora toca «Conectar con Google»."}


def guardar_gemini(d):
    """Guarda la clave de Gemini (vacia = quitarla) y la prueba. Se usa desde ya, sin reiniciar."""
    clave = (d.get("clave") or "").strip()
    if clave and (len(clave) < 20 or len(clave) > 200 or any(c.isspace() for c in clave)):
        raise ErrorPanel("Esa clave no parece de Gemini: cópiala entera desde Google AI Studio.")
    gemini.guardar(clave)
    if not clave:
        S.log("panel: clave de Gemini quitada; responde Ollama")
        _marcar_ia("gemini", d)
        nube.publicar_ia()
        return {"mensaje": "Clave quitada. Píxel vuelve a usar la IA local."}
    S.log("panel: clave de Gemini guardada")
    ok, texto = gemini.probar()
    S.log("panel: prueba de Gemini: %s" % texto)
    if not ok and gemini.clave_rechazada():       # 12 nov: una clave que Google no acepta no se queda
        gemini.guardar("")
        nube.publicar_ia()
        raise ErrorPanel(texto)
    _marcar_ia("gemini", d)
    nube.publicar_ia()                          # 12 nov: que la app de las cuentas vinculadas la tenga
    if not ok:
        raise ErrorPanel("Clave guardada, pero falla. " + texto)
    return {"mensaje": "Clave guardada. " + texto}


def probar_gemini(d):
    ok, texto = gemini.probar()
    S.log("panel: prueba de Gemini: %s" % texto)
    if not ok:
        raise ErrorPanel(texto)
    return {"mensaje": texto}


def guardar_groq(d):
    """Fase 15: como guardar_gemini, con la clave de Groq (gsk_...). Al probarla se elige el modelo."""
    clave = (d.get("clave") or "").strip()
    if clave and (len(clave) < 20 or len(clave) > 200 or any(c.isspace() for c in clave)):
        raise ErrorPanel("Esa clave no parece de Groq: cópiala entera desde console.groq.com → API Keys.")
    groq_ia.guardar(clave)
    if not clave:
        S.log("panel: clave de Groq quitada")
        _marcar_ia("groq", d)
        nube.publicar_ia()
        return {"mensaje": "Clave de Groq quitada."}
    S.log("panel: clave de Groq guardada")
    ok, texto = groq_ia.probar()
    S.log("panel: prueba de Groq: %s" % texto)
    if not ok and groq_ia.clave_rechazada():      # una clave que Groq no acepta no se queda
        groq_ia.guardar("")
        nube.publicar_ia()
        raise ErrorPanel(texto)
    _marcar_ia("groq", d)
    nube.publicar_ia()
    if not ok:
        raise ErrorPanel("Clave guardada, pero falla. " + texto)
    return {"mensaje": "Clave guardada. " + texto}


def probar_groq(d):
    ok, texto = groq_ia.probar()
    S.log("panel: prueba de Groq: %s" % texto)
    if not ok:
        raise ErrorPanel(texto)
    return {"mensaje": texto}


def elegir_ia(d):
    """Cual de las dos IA de internet contesta primero (la otra queda de respaldo, y Ollama despues)."""
    ia = d.get("ia")
    if ia not in IAS:
        raise ErrorPanel("Esa IA no la conozco.")
    with _lock:
        AJUSTES["ia"] = ia
        _guardar_json(_ruta(S.AJUSTES_ARCHIVO), AJUSTES)
        aplicar_ajustes()
    _marcar_ia("preferida", d)
    nube.publicar_ia()
    return {"mensaje": "Primero contesta %s." % ("Gemini" if ia == "gemini" else "Groq")}


RUTAS_POST = {
    "/api/agente": guardar_agente,
    "/api/agente/probar": probar_voz,
    "/api/contactos": guardar_contacto,
    "/api/contactos/borrar": borrar_contacto,
    "/api/agenda/borrar": borrar_agenda,
    "/api/google/vincular": vincular_google,
    "/api/dispositivos/aceptar": aceptar_dispositivo,
    "/api/dispositivos/olvidar": olvidar_dispositivo,
    "/api/wifi/buscar": buscar_wifi,
    "/api/wifi/agregar": agregar_wifi,
    "/api/bt/encender": _bt(bluetooth_pc.encender, "Bluetooth del PC encendido.", con_mac=False),
    "/api/bt/apagar": _bt(bluetooth_pc.apagar, "Bluetooth del PC apagado.", con_mac=False),
    "/api/bt/buscar": _bt(bluetooth_pc.buscar, "Buscando aparatos durante %d s…" % bluetooth_pc.BUSCAR_S, con_mac=False),
    "/api/bt/visible": _bt(bluetooth_pc.hacer_visible, "El PC está visible %d s." % bluetooth_pc.VISIBLE_S, con_mac=False),
    "/api/bt/emparejar": _bt(bluetooth_pc.emparejar, "Emparejando…"),
    "/api/bt/conectar": _bt(bluetooth_pc.conectar, "Conectando…"),
    "/api/bt/desconectar": _bt(bluetooth_pc.desconectar, "Desconectado."),
    "/api/bt/olvidar": _bt(bluetooth_pc.olvidar, "Olvidado."),
    "/api/bt/musica": _bt(bluetooth_pc.usar_para_musica, "Salida de la música cambiada."),
}

# Fase 13: el PC como puente de aparatos (el propio PC, TV Android, Wake-on-LAN, http)
RUTAS_POST.update(puente_pc.rutas(ErrorPanel))

# Solo desde el panel local: no van en RUTAS_POST porque nube.py ejecuta esas como ordenes
# que llegan de internet, y la clave de Gemini solo se pone o se quita desde la red de casa.
# 2.4.0: las claves de IA y la preferida ya se pueden cambiar desde la app de las cuentas vinculadas (nube.py solo
# ejecuta ordenes de los duenos). Antes eran solo locales; el usuario pidio que el PC y la app sean un espejo.
RUTAS_POST.update({
    "/api/perfil": guardar_perfil,
    "/api/gemini/clave": guardar_gemini,
    "/api/gemini/probar": probar_gemini,
    "/api/groq/clave": guardar_groq,
    "/api/groq/probar": probar_groq,
    "/api/ia": elegir_ia,
})
RUTAS_SOLO_LOCAL = {
    "/api/google/credencial": guardar_credencial_google,     # un archivo de este PC: no llega por la nube
}


class Manejador(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _origen_ajeno(self):
        """El Origin de la peticion si viene de otra pagina ("" si es la propia o no lo dice)."""
        origen = self.headers.get("Origin") or ""
        return "" if not origen or origen == "http://" + (self.headers.get("Host") or "") else origen

    def _responder(self, codigo, cuerpo, tipo="application/json; charset=utf-8"):
        datos = cuerpo if isinstance(cuerpo, bytes) else json.dumps(cuerpo, ensure_ascii=False).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(datos)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(datos)

    def do_GET(self):
        ruta = self.path.split("?", 1)[0]
        if ruta == "/api/estado":
            self._responder(200, estado())
            return
        if ruta == "/api/voz":
            self._responder(200, voz())
            return
        nombre = "index.html" if ruta == "/" else ruta[1:]
        carpeta = _ruta(WEB_DIR)
        tipo = TIPOS_MIME.get(os.path.splitext(nombre)[1])
        if "/" in nombre or tipo is None or nombre not in os.listdir(carpeta):
            self._responder(404, {"error": "No existe."})
            return
        with open(os.path.join(carpeta, nombre), "rb") as f:
            self._responder(200, f.read(), tipo)

    def do_POST(self):
        funcion = RUTAS_POST.get(self.path) or RUTAS_SOLO_LOCAL.get(self.path)
        largo = int(self.headers.get("Content-Length") or 0)
        if self._origen_ajeno():
            self._responder(403, {"error": "Origen no permitido."})
            return
        if funcion is None or largo > 20000:
            self._responder(404, {"error": "No existe."})
            return
        try:
            datos = json.loads(self.rfile.read(largo) or b"{}")
            self._responder(200, funcion(datos if isinstance(datos, dict) else {}))
        except ErrorPanel as e:
            self._responder(400, {"error": str(e)})
        except Exception as e:
            S.log("panel: ERROR en %s: %s: %s" % (self.path, type(e).__name__, e))
            self._responder(500, {"error": "Algo falló en el servidor."})


def iniciar(modulo_servidor):
    """Carga los ajustes guardados y abre el panel en un hilo."""
    global S
    S = modulo_servidor
    puente_pc.S = modulo_servidor
    cargar_ajustes()
    ruta = _ruta(S.DISPOSITIVOS_ARCHIVO)
    if os.path.exists(ruta):
        with open(ruta, encoding="utf-8") as f:
            ACEPTADOS.update(json.load(f))
    red_wifi.vigilar(_wifi_guardados)
    srv = ThreadingHTTPServer((DIRECCION, S.PANEL_PORT), Manejador)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    S.log("panel de administracion: http://%s:%d  (en este PC: http://localhost:%d)"
          % (_ip_local() if DIRECCION == "0.0.0.0" else DIRECCION, S.PANEL_PORT, S.PANEL_PORT))

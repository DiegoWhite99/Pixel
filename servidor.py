#!/usr/bin/env python3
"""Fase 3 - Servidor del asistente de voz local (STT -> LLM -> TTS).

Recibe audio PCM del ESP32-S3, detecta fin de frase con un VAD por energia,
guarda la frase como WAV, la transcribe (faster-whisper), se la pasa al LLM
(Ollama, en streaming) y sintetiza la respuesta frase a frase (Piper),
devolviendola al ESP32 como audio.

Protocolo (contrato acordado con el firmware):
    1 byte de tipo + 4 bytes de longitud (uint32 little-endian) + payload
    0x01 audio ESP32 -> servidor
    0x02 audio servidor -> ESP32
    0x03 fin de turno (sin payload)
    0x04 texto de debug (UTF-8)

Audio: PCM 16 kHz, 16 bits con signo, mono, little-endian.

El pipeline corre en un hilo aparte: el bucle de recepcion nunca se bloquea.
Requiere el .venv del proyecto (faster-whisper, numpy, piper-tts) y Ollama.
"""

import array
import json
import math
import os
import queue
import re
import socket
import struct
import sys
import threading
import time
import wave
from collections import deque
from datetime import date, datetime

import numpy as np

import acciones
import salida_pc

# ---------------------------------------------------------------- parametros

# Palabra de activacion: solo se procesan frases que empiezan con ella
ACTIVACION = "Píxel"                    # antes "Nova": Whisper la oia como "No, no." o "Noa" (ver memoria.md)
ACTIVACION_VARIANTES = ("bixel",)       # como la escribe Whisper a veces (plano() ya iguala Pixel y Píxel); "Bíxel" visto el 21 oct
ACTIVACION_PREFIJOS = ("oye", "hey", "hola")    # "Oye Píxel", "hey Píxel", "hola Píxel"
ACTIVACION_SI_COMA_U_ORDEN = ()         # variantes que solo valen con coma o verbo de accion despues
ACTIVACION_SI_SIGUE_ORDEN = ()          # variantes que solo valen con verbo de accion despues
ACTIVACION_SALTA_A = ()                 # variantes tras las que se salta una "a" antes de buscar el verbo
ACTIVACION_RESPUESTA = "Dime"           # si solo dicen "Píxel"
ACTIVACION_VENTANA_S = 8.0              # tras "Dime", la siguiente frase no necesita "Píxel"

# Reposo: tras este tiempo sin interaccion lo anuncia por voz y olvida la conversacion
REPOSO_S = 120.0
REPOSO_FRASE = "Veo que no hay interacción. Entro en modo reposo."

# Recordatorios (Fase 7): se guardan en este JSON y un hilo los dice por voz cuando toca
RECORDATORIOS_ARCHIVO = "recordatorios.json"    # relativo a la carpeta del proyecto
EVENTOS_ARCHIVO = "eventos.json"                # calendario local, cuando Google no esta autorizado
RECORDATORIO_FRASE = "Recordatorio: %s."
RECORDATORIOS_REVISAR_S = 1.0

# Google (Fase 7): calendario y correo. Sin estos archivos esas acciones dicen que no estan configuradas
GOOGLE_CLIENTE = "google_cliente.json"      # Google Auth platform > Clients > Desktop app > descargar el JSON
GOOGLE_TOKEN = "google_token.json"          # lo crea: .venv/bin/python servicios_google.py autorizar
CONTACTOS_ARCHIVO = "contactos.json"        # {"Ana": "ana@...", ...}: los unicos destinatarios de correo
CONFIRMAR_S = 20.0                          # tras leer el borrador, cuanto espera el "sí, envíalo"

# Panel de administracion (Fase 8): http://<IP del PC>:PANEL_PORT, tambien desde el movil
PANEL_PORT = 8080
AJUSTES_ARCHIVO = "ajustes.json"            # voz, personalidad y largo de respuesta elegidos en el panel
PERFIL_ARCHIVO = "perfil.json"              # 2.4.0: el perfil del usuario que manda la app (web/espejo.js)
DISPOSITIVOS_ARCHIVO = "dispositivos.json"  # dispositivos Bluetooth aceptados en el panel

# Por donde habla Pixel: "esp32" (su altavoz) o "pc" (salida de audio del PC: el altavoz
# Bluetooth si esta conectado). Lo cambia el panel (ajustes.json).
SALIDA_VOZ = "esp32"

# Pixel en la nube (Fase 10, nube.py): la app de https://pixelassitance.web.app lo encuentra y lo
# maneja desde cualquier sitio. Mismo proyecto de Firebase que web/app.js. NUBE_DB vacio = sin nube.
NUBE_API_KEY = "AIzaSyAKcuXL3qvNDCUPUlZXjrSOUKW3k4z2hZ8"    # publica: la seguridad esta en database.rules.json
NUBE_DB = "https://pixelassitance-default-rtdb.firebaseio.com"
NUBE_TOKEN = "nube_token.json"      # la identidad de este Pixel en Firebase: no se comparte
NUBE_NOMBRE = "Pixel Assistance"    # como sale en la app al buscarlo
# Fase 13 (obsidian.py): boveda de Obsidian sincronizada con el cerebro de la app (usuarios/<uid>/cerebro),
# solo para las cuentas que lo activan en la app. Vacio = sin Obsidian. Fuera del repo: son datos personales.
OBSIDIAN_BOVEDA = "~/Obsidian/Pixel"

# Sonidos (13 nov, el usuario: "el robot no toma ni los sonidos ni nada de Pixel de la web... deben ser iguales"):
# los mismos de la app (web/agente.js, SONIDOS y PENSAR), generados con numpy igual que alli con Web Audio: cada
# nota con un armonico un poco desafinado (campanita) que sube en 12 ms y se apaga sola. Antes eran dos barridos.
SONIDO_NOTAS = {                        # (Hz, retraso en s)
    "entrada": ((659.25, 0.0), (987.77, 0.08), (1318.51, 0.16)),    # mi, si, mi agudo: sube ("te escucho")
    "salida": ((1318.51, 0.0), (987.77, 0.08), (659.25, 0.16)),     # al reves: baja ("ya termine")
    "aviso": ((880.0, 0.0), (1174.66, 0.12)),                       # lo que dice por su cuenta (recordatorio)
}
SONIDO_DURA_S = 0.34
SONIDO_VOLUMEN = 0.12                   # fraccion del maximo, como el gain de la app
PENSAR_NOTAS = (523.25, 659.25, 783.99, 659.25)     # do, mi, sol, mi: muy bajito mientras piensa
PENSAR_DURA_S = 0.28
PENSAR_VOLUMEN = 0.035
PENSAR_DESDE_S = 0.6                    # si contesta antes, no suena
PENSAR_CADA_S = 0.42

HOST = "0.0.0.0"
PORT = 8765
DESCUBRIR_PORT = 8766     # UDP: el ESP32 grita "PIXEL? <nombre>" por broadcast y se le contesta "PIXEL <PORT>"; 0 = no

SAMPLE_RATE = 16000
SAMPLE_WIDTH = 2          # 16 bits con signo
CHANNELS = 1

FRAME_MS = 20
FRAME_BYTES = SAMPLE_RATE * SAMPLE_WIDTH * FRAME_MS // 1000   # 640 bytes

MSG_AUDIO_IN = 0x01
MSG_AUDIO_OUT = 0x02
MSG_END_TURN = 0x03
MSG_DEBUG = 0x04
FRASE_CODIGO_ROBOT = "Para enlazarme con la app, mi código es:"
# 13 nov (el usuario: "va muy rapido con lo del codigo"): los codigos se dicen cifra por cifra, cada una sola y con
# un silencio despues, y dos veces (_decir_codigo). Antes iban en una frase con comas ("6, 3, 7...") y sonaban seguidas.
CIFRAS_PALABRAS = ("Cero", "Uno", "Dos", "Tres", "Cuatro", "Cinco", "Seis", "Siete", "Ocho", "Nueve")
CODIGO_PAUSA_S = 0.55                  # despues de cada cifra (la voz ya viene sin su silencio: _sin_bordes)
CODIGO_OTRA_VEZ = "Otra vez."

MAX_PAYLOAD = 1 << 20     # 1 MiB, para no confiar en una longitud corrupta

# VAD por energia
CALIB_FRAMES = 25         # 500 ms de ruido de fondo al conectar (se toma la mediana)
NOISE_MULT = 3.5          # cuanto hay que superar el piso de ruido
PISO_BAJA = 0.05          # fuera de las frases el piso sigue al ruido: baja rapido (~0.4 s)...
PISO_SUBE = 0.002         # ...y sube despacio (~10 s), para que la voz no lo arrastre
# Ruido continuo (musica, TV): mantiene el VAD "en voz" hasta MAX_PHRASE_MS y el piso no se entera.
# Si Silero dice que una frase larga no tenia voz, su volumen mediano sube el umbral; se olvida solo.
RUIDO_LARGO_S = 2.0       # frases sin voz de al menos esto ensenan el ruido continuo
RUIDO_LARGO_MULT = 1.6    # el umbral queda este tanto por encima de ese ruido
RUIDO_LARGO_OLVIDO = 0.9985   # por trama fuera de frase: se olvida a la mitad en ~9 s de calma
UMBRAL_MAX = 4000.0       # nunca mas sordo que esto
MIN_RMS = 600.0           # nunca abre frase por debajo de este RMS, aunque el piso sea bajo
SPEECH_FRAMES_START = 3   # 60 ms de voz seguidos para abrir la frase
SILENCE_FRAMES_END = 35   # 700 ms de silencio para cerrarla
PREROLL_FRAMES = 15       # 300 ms previos, para no cortar el ataque
MIN_PHRASE_MS = 300       # mas corto que esto se descarta (golpe, chasquido)
MAX_PHRASE_MS = 15000     # corte de seguridad
ECO_MARGEN_S = 0.3        # micro sordo este extra tras el fin estimado de la voz
BOCA_PASO_MS = 50         # la boca de la cara 3D sigue el volumen de la voz en trozos de este largo
BOCA_REFERENCIA = 5000.0  # RMS de la voz de Piper que abre la boca del todo
BOCA_GUARDA_S = 30        # segmentos de voz que se recuerdan para la app

# STT (faster-whisper)
STT_MODELO = "base"
STT_DEVICE = "cpu"
STT_COMPUTE = "int8"
STT_IDIOMA = "es"
STT_BEAM = 1
STT_THREADS = 8             # medido: 8 hilos va mas rapido que el automatico
STT_VAD_UMBRAL = 0.35       # Silero antes de Whisper: medido, descarta 244 de 262 ruidos reales sin perder voz
STT_TEMPERATURA = 0.0       # sin reintentos: con ellos un ruido dejaba el micro sordo hasta 37 s (memoria.md)
STT_MAX_COMPRESION = 2.4    # sin reintentos no hay red: se descartan los segmentos en bucle ("Vio, Vio, Vio...")
STT_PROMPT = ACTIVACION + ", YouTube, pon música, reproduce, busca en YouTube, Soda Stereo, Queen, Bohemian Rhapsody"

# LLM (Ollama)
LLM_MODELO = "qwen2.5:3b"
LLM_HOST = "http://127.0.0.1:11434"
LLM_NUM_PREDICT = 150
LLM_TEMPERATURA = 0.5
LLM_MAX_TURNOS = 4          # pares usuario/asistente que se recuerdan
LLM_SYSTEM = None           # prompt con la fecha; se arma en main()

# Fase 11: Gemini (Google) en vez de Ollama si hay clave; sin clave, o si falla, responde Ollama
GEMINI_CLAVE = "gemini_clave.json"     # la pega el usuario en el panel (Cuentas); da acceso a su cuenta: no se comparte
GEMINI_MODELO = "gemini-3.5-flash-lite"   # medido el 6 nov con la clave real: 0,88 s. 3.8 Flash daba 429 (20 peticiones/dia gratis)
GEMINI_PENSAR = "low"                  # thinkingLevel; 3.5 Flash-Lite lo acepta ("minimal" daba 400 en 3.8 Flash)
GEMINI_MAX_TOKENS = 1024               # holgado: el razonamiento tambien gasta tokens del tope
GEMINI_TIMEOUT = 10.0                  # s sin recibir nada antes de pasarse a Ollama
GROQ_CLAVE = "groq_clave.json"         # Fase 15: la clave de Groq (gsk_...), como la de Gemini; tampoco se comparte

# Fase 11: el celular hace de ESP32 remoto por la nube (SesionMovil, nube.py y la app de internet)
MOVIL_LATENCIA_S = 1.0      # de dejar la voz en la nube a que suena en el celular (estimado, para las ventanas)

# TTS (Piper)
TTS_VOZ = "voces/es_ES-sharvard-medium.onnx"     # antes es_MX-ald-medium (masculina)
TTS_HABLANTE = "F"          # el modelo trae "M" y "F"; medida la mas ligera de las femeninas que se oyen bien

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CAPTURE_DIR = os.path.join(BASE_DIR, "capturas")

TRANSCRIPTOR = None       # se cargan una sola vez en main()
TTS = None
CLASIFICADOR = None
AGENDA = None
SALIDA_PC = None          # salida_pc.SalidaPc, para SALIDA_VOZ = "pc"

SESIONES = []            # conexiones abiertas; los recordatorios van a la mas reciente
MOVILES = {}             # uid -> SesionMovil: los celulares enlazados que le han hablado o escuchan (Fase 11)
PIXELES_VISTOS = {}      # ip -> nombre de los ESP32 que buscaron el servidor (la busqueda WiFi los reconoce)
AL_HABLAR = None         # funcion sin argumentos que se llama con cada trozo de voz nuevo (la nube la publica)
AL_REGISTRAR = None      # funcion (tipo, texto, detalle): el registro de acciones de la app (nube.registrar)
_sesiones_lock = threading.Lock()

_print_lock = threading.Lock()


def log(msg):
    stamp = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    with _print_lock:
        print("[%s] %s" % (stamp, msg), flush=True)


# Acciones que se anotan en el registro de la app (las de solo mirar, como ver_calendario, no)
REGISTRAR_ACCIONES = {"recordatorio", "borrar_recordatorio", "crear_evento", "youtube"}


def registrar(tipo, texto, detalle=""):
    """11 nov: anota lo que hizo Pixel (la app lo muestra en Registro, con su hora). Nunca rompe el turno."""
    if AL_REGISTRAR is None:
        return
    try:
        AL_REGISTRAR(tipo, texto, detalle)
    except Exception as e:
        log("registro: no pude anotar: %s" % e)


# ------------------------------------------------------------------- utiles

def frame_rms(frame_bytes):
    """RMS de una trama PCM 16-bit little-endian."""
    samples = array.array("h")
    samples.frombytes(frame_bytes)
    if sys.byteorder == "big":
        samples.byteswap()
    if not samples:
        return 0.0
    total = 0
    for s in samples:
        total += s * s
    return math.sqrt(total / len(samples))


def frame_peak(frame_bytes):
    samples = array.array("h")
    samples.frombytes(frame_bytes)
    if sys.byteorder == "big":
        samples.byteswap()
    if not samples:
        return 0
    return max(abs(s) for s in samples)


def guardar_wav(path, pcm_bytes):
    with wave.open(path, "wb") as wf:
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(SAMPLE_WIDTH)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(pcm_bytes)


def encode_msg(msg_type, payload=b""):
    return struct.pack("<BI", msg_type, len(payload)) + payload


FIN_FRASE = ".!?\u2026"
CORTE_PRIMERA = ",;"
CIERRES = "\"')\u00bb"
PRIMERA_MIN_PALABRAS = 6    # la 1a frase tambien corta en , o ; si ya lleva esto


def _entre_digitos(buf, i):
    """True si el signo en buf[i] puede ser parte de una cifra (8.848, 3,5).

    Si va tras un digito y aun no ha llegado el siguiente caracter, no se puede
    saber: se trata como cifra y se espera al siguiente trozo del LLM.
    """
    if i == 0 or not buf[i - 1].isdigit():
        return False
    return i + 1 >= len(buf) or buf[i + 1].isdigit()


def extraer_frases(buf, primera=False):
    """Parte el texto que va llegando del LLM en frases completas.

    Corta en . ! ? y puntos suspensivos, salvo un punto dentro de una cifra.
    Si `primera` es True, la primera frase tambien se corta en coma o punto
    y coma cuando ya lleva PRIMERA_MIN_PALABRAS palabras, para que la voz
    arranque antes. Las demas cortan solo en fin de frase.

    Devuelve (lista de frases cerradas, resto todavia incompleto).
    """
    frases = []
    ini = 0
    i = 0
    while i < len(buf):
        c = buf[i]
        corta = False
        if c in FIN_FRASE:
            corta = not (c == "." and _entre_digitos(buf, i))
        elif primera and c in CORTE_PRIMERA:
            corta = (not _entre_digitos(buf, i)
                     and len(buf[ini:i].split()) >= PRIMERA_MIN_PALABRAS)
        if corta:
            j = i + 1
            while j < len(buf) and buf[j] in FIN_FRASE + CIERRES:
                j += 1
            trozo = buf[ini:j].strip()
            if trozo:
                frases.append(trozo)
                primera = False
            ini = j
            i = j
        else:
            i += 1
    return frases, buf[ini:]


def nuevo_llm():
    """Un Llm por conversacion: cada una lleva su propio historial."""
    from llm import Llm
    return Llm(
        modelo=LLM_MODELO,
        host=LLM_HOST,
        num_predict=LLM_NUM_PREDICT,
        temperatura=LLM_TEMPERATURA,
        max_turnos=LLM_MAX_TURNOS,
        system=LLM_SYSTEM,
    )


def _regex_palabras(palabras, prefijos=(), en_medio=False):
    """Regex sobre texto plano: [prefijo] palabra, al inicio (o tras un espacio o signo si en_medio), con o sin coma."""
    if not palabras:
        return re.compile(r"(?!)")      # lista vacia: nunca coincide
    variantes = sorted({acciones.plano(v) for v in palabras}, key=len, reverse=True)
    palabra = "|".join(r"[\s,]+".join(map(re.escape, v.split())) for v in variantes)
    prefijo = ""
    if prefijos:
        prefijo = r"(?:(?:%s)[\s,]+)?" % "|".join(re.escape(acciones.plano(p)) for p in prefijos)
    inicio = r"(?<![^\s,.;:!?\u00a1\u00bf\u2026\"'])" if en_medio else r"^[\s\u00a1\u00bf\"'.,]*"
    return re.compile(r"%s%s(?P<w>%s)\b[\s,.;:!?\u00a1\u00bf\u2026\"']*" % (inicio, prefijo, palabra))


_RE_ACTIVACION = _regex_palabras(ACTIVACION_VARIANTES + (ACTIVACION,), ACTIVACION_PREFIJOS)
# con musica, TV o gente de fondo el VAD junta todo en una frase: "...hola, así suenan... Píxel, pon Queen"
_RE_ACTIVACION_EN_MEDIO = _regex_palabras(ACTIVACION_VARIANTES + (ACTIVACION,), ACTIVACION_PREFIJOS, en_medio=True)
_RE_ACTIVACION_SI_COMA = _regex_palabras(ACTIVACION_SI_COMA_U_ORDEN, ACTIVACION_PREFIJOS)
_RE_ACTIVACION_SI_ORDEN = _regex_palabras(ACTIVACION_SI_SIGUE_ORDEN)
_SALTA_A = {acciones.plano(v) for v in ACTIVACION_SALTA_A}

# confirmacion de un correo: "sí, envíalo", "envíalo", "mándalo"; nunca si empieza con "no"
_RE_CONFIRMA = re.compile(r"\b(?:envi|mand)\w*(?:lo|la)\b")
_RE_NIEGA = re.compile(r"^\W*no\b")


def quitar_activacion(texto):
    """(True, resto) si el texto empieza con la palabra de activacion, o con un verbo de
    accion seguido de ella, o si la tiene en medio (resto: lo que va despues); (False, texto) si no."""
    p = acciones.plano(texto)                           # plano conserva la longitud
    m = _RE_ACTIVACION.match(p)
    if m:
        return True, texto[m.end():].strip()
    # "Reproduce, Píxel, reproduce Queen": la palabra justo despues de un verbo de accion
    n = acciones.verbo_al_inicio(texto)
    m = _RE_ACTIVACION.match(p[n:]) if n else None
    if m:
        resto = texto[n + m.end():].strip()
        if not acciones.empieza_con_orden(resto):       # "Pon, Píxel, Queen" -> "Pon Queen"
            resto = (texto[:n].strip(" ,.¡¿\"'") + " " + resto).strip()
        return True, resto
    m = _RE_ACTIVACION_SI_COMA.match(p)
    if m:
        resto = texto[m.end():]
        coma = p[m.end("w"):].lstrip().startswith(",")
        if not coma and re.sub(r"[\s,]+", " ", m.group("w")) in _SALTA_A:
            a = re.match(r"a\s+", acciones.plano(resto))
            if a and acciones.empieza_con_orden(resto[a.end():]):
                resto = resto[a.end():]
        if coma or acciones.empieza_con_orden(resto):
            return True, resto.strip()
    m = _RE_ACTIVACION_SI_ORDEN.match(p)
    if m and acciones.empieza_con_orden(texto[m.end():]):
        return True, texto[m.end():].strip()
    # la palabra en medio de la frase, como con Alexa: vale lo que va despues de la ultima vez que aparece.
    # Solo si se nota que la llaman: tras una pausa (signo antes) o con pausa despues ("..., Píxel, pon").
    # Asi "un píxel de la pantalla" no la activa.
    ultima = None
    for m in _RE_ACTIVACION_EN_MEDIO.finditer(p):
        antes = p[:m.start()].rstrip()
        pausa_antes = not antes or antes[-1] in ".,;:!?\u2026"
        pausa_despues = m.end() >= len(p.rstrip()) or any(c in ".,;:!?\u2026" for c in p[m.end("w"):m.end()])
        if pausa_antes or pausa_despues:
            ultima = m
    if ultima is not None:
        return True, texto[ultima.end():].strip()
    return False, texto


def _nota(f, dura, vol):
    """Una nota como nota() de web/agente.js: seno + armonico (x2.01, gain 0.22), sube de 0.0001 a vol en 12 ms
    (rampa exponencial) y baja a 0.0001 al llegar a dura; se para 20 ms despues."""
    n = int(round((dura + 0.02) * SAMPLE_RATE))
    t = np.arange(n) / float(SAMPLE_RATE)
    sube = 0.012
    env = np.where(t < sube, 0.0001 * (vol / 0.0001) ** (t / sube),
                   vol * (0.0001 / vol) ** ((np.minimum(t, dura) - sube) / (dura - sube)))
    return env * (np.sin(2 * np.pi * f * t) + 0.22 * np.sin(2 * np.pi * f * 2.01 * t))


def generar_sonido(notas, dura=SONIDO_DURA_S, vol=SONIDO_VOLUMEN):
    """Las notas [(Hz, retraso s)] mezcladas: PCM 16 bit LE mono a SAMPLE_RATE."""
    largo = int(round((max(d for _, d in notas) + dura + 0.02) * SAMPLE_RATE))
    x = np.zeros(largo)
    for f, d in notas:
        y = _nota(f, dura, vol)
        i = int(round(d * SAMPLE_RATE))
        x[i:i + len(y)] += y[:largo - i]
    return np.round(np.clip(x, -1.0, 1.0) * 32767).astype("<i2").tobytes()


BEEP_RECIBIDO = generar_sonido(SONIDO_NOTAS["entrada"])     # los nombres de antes: SesionMovil los distingue
BEEP_SALIDA = generar_sonido(SONIDO_NOTAS["salida"])
BEEP_AVISO = generar_sonido(SONIDO_NOTAS["aviso"])
PENSAR_PCM = tuple(generar_sonido(((f, 0.0),), PENSAR_DURA_S, PENSAR_VOLUMEN) for f in PENSAR_NOTAS)
_SONIDOS = {id(x) for x in (BEEP_RECIBIDO, BEEP_SALIDA, BEEP_AVISO) + PENSAR_PCM}


_CIFRAS_CACHE = {}


def _cifra_dicha(n):
    """La voz de una cifra sola ("Seis."), guardada por voz: los codigos se dicen sin esperar a sintetizar."""
    clave = (id(TTS), n)
    if clave not in _CIFRAS_CACHE:
        _CIFRAS_CACHE[clave] = _sin_bordes(TTS.sintetizar(CIFRAS_PALABRAS[n] + "."))
    return _CIFRAS_CACHE[clave]


def _sin_bordes(pcm, umbral=400, antes_s=0.04, despues_s=0.08):
    """Quita el silencio que la voz pone antes y despues (Supertonic: casi 1 s con una palabra sola)."""
    x = np.frombuffer(pcm, dtype=np.int16)
    fuerte = np.flatnonzero(np.abs(x) > umbral)
    if not len(fuerte):
        return pcm
    a = max(0, fuerte[0] - int(antes_s * SAMPLE_RATE))
    z = min(len(x), fuerte[-1] + int(despues_s * SAMPLE_RATE))
    return x[a:z].tobytes()


def es_sonido(pcm):
    """Una campanita (no es voz: la boca de la cara no se mueve con ella)."""
    return id(pcm) in _SONIDOS


# ------------------------------------------------------------------- sesion

class Sesion:
    """Estado de una conexion: trocea en tramas de 20 ms y segmenta frases.

    El VAD corre en el hilo del socket. El pipeline pesado (STT, LLM, TTS)
    corre en un hilo trabajador, para que recibir nunca se bloquee.
    """

    def __init__(self, sock, addr):
        self.sock = sock
        self.addr = addr
        self.peer = "%s:%d" % addr

        self.pcm_buf = bytearray()      # audio crudo aun sin trocear en tramas
        self.preroll = deque(maxlen=PREROLL_FRAMES)

        self.calib = []                 # RMS de las primeras tramas
        self.umbral = None

        self.en_voz = False
        self.frases_voz = 0             # tramas de voz seguidas (para abrir)
        self.frames_silencio = 0        # tramas de silencio seguidas (cerrar)
        self.frase = bytearray()

        self.n_frases = 0
        self.total_bytes = 0
        self.pico_sesion = 0
        self.descartadas = 0            # tramas tiradas mientras responde
        self.fin_reproduccion = 0.0     # cuando termina de sonar en el ESP32 (estimado)
        self.voz = deque()              # segmentos de voz para la boca de la app: {t (ms de reloj), paso, niveles}
        self.ruido_largo = 0.0          # volumen del ruido continuo aprendido de frases sin voz
        self.forzar_esp32 = False       # "Probar" del altavoz de Pixel: por el ESP32 aunque la voz vaya al PC
        self.ventana_hasta = 0.0        # hasta cuando una frase puede empezar sin la palabra
        self.t_inicio_frase = 0.0       # cuando el VAD abrio la frase en curso
        self.ultima_interaccion = None  # fin de la ultima respuesta a una frase aceptada; None = en reposo
        self.turno_aceptado = False     # el turno en curso paso la palabra de activacion
        self.pendiente = None           # accion que espera el "sí, envíalo": dict de "confirmar" + "hasta"
        self.desde = datetime.now()     # para el panel
        self.piso = None                # piso de ruido calibrado
        self.ultimo_texto = ""          # ultima frase que entendio Whisper
        self.ultimo_audio = time.monotonic()
        self.ble_yo = None              # nombre Bluetooth del ESP32 ("Pixel asistente de voz")
        self.ble = []                   # dispositivos Bluetooth que ve: [{"nombre", "mac", "rssi"}]
        self.ble_t = None               # cuando llego la ultima lista

        self.llm = nuevo_llm()

        self._send_lock = threading.Lock()
        self._pensando = None           # (evento para pararlo, hilo) mientras suenan las notas de "pensando"
        self._pensar_lock = threading.Lock()
        self.respondiendo = threading.Event()
        self.cola = queue.Queue()
        self.worker = threading.Thread(target=self._worker, daemon=True)
        self.worker.start()

    # -- envio ------------------------------------------------------------

    def _enviar(self, msg_type, payload=b""):
        with self._send_lock:
            self.sock.sendall(encode_msg(msg_type, payload))

    def debug(self, texto):
        """Manda texto de debug al ESP32 (0x04). Nunca tumba la sesion."""
        try:
            self._enviar(MSG_DEBUG, texto.encode("utf-8"))
        except OSError:
            pass

    def enviar_audio(self, pcm):
        """Manda PCM al ESP32 en mensajes 0x02 de ~20 ms, o a la salida del PC si SALIDA_VOZ = "pc".

        Lleva la cuenta de cuando terminara de sonar: cada trozo no puede
        empezar antes de enviarse ni antes de que acabe el anterior. Por el PC
        empieza LATENCIA_S mas tarde (Bluetooth), y el micro sigue sordo hasta entonces.
        """
        p = self._pensando
        if p is not None and threading.current_thread() is not p[1]:
            self._parar_pensando()      # llega la respuesta: se acaban las notas de "pensando"
        self.respondiendo.set()         # el micro queda sordo desde que empieza a sonar algo
        por_pc = SALIDA_VOZ == "pc" and SALIDA_PC is not None and not self.forzar_esp32
        dur = len(pcm) / float(SAMPLE_RATE * SAMPLE_WIDTH)
        latencia = salida_pc.LATENCIA_S if por_pc else 0.0
        inicio = max(time.monotonic() + latencia, self.fin_reproduccion)
        self.fin_reproduccion = inicio + dur
        if not es_sonido(pcm):
            self._apuntar_voz(pcm, inicio)
        if por_pc:
            SALIDA_PC.reproducir(pcm)
            return
        for off in range(0, len(pcm), FRAME_BYTES):
            self._enviar(MSG_AUDIO_OUT, pcm[off:off + FRAME_BYTES])

    # Mientras piensa, como la app (sonarPensando de web/agente.js): tras PENSAR_DESDE_S, una nota suave cada
    # PENSAR_CADA_S hasta que suena la respuesta. El celular (SesionMovil) pone el suyo al recibir el "oido".
    PENSAR_SONIDO = True

    def _empezar_pensando(self):
        if not self.PENSAR_SONIDO:
            return
        self._parar_pensando()
        fin = threading.Event()

        def notas():
            i = 0
            if fin.wait(PENSAR_DESDE_S):
                return
            while True:
                with self._pensar_lock:         # _parar_pensando espera a que acabe de mandar la nota
                    if fin.is_set():
                        return
                    try:
                        self.enviar_audio(PENSAR_PCM[i % len(PENSAR_PCM)])
                    except OSError:
                        return
                i += 1
                if fin.wait(PENSAR_CADA_S):
                    return

        hilo = threading.Thread(target=notas, daemon=True)
        self._pensando = (fin, hilo)
        hilo.start()

    def _parar_pensando(self):
        p, self._pensando = self._pensando, None
        if p is not None:
            p[0].set()
            with self._pensar_lock:
                pass

    def _apuntar_voz(self, pcm, inicio):
        """Volumen de la voz cada BOCA_PASO_MS, con la hora a la que empieza a sonar: la app mueve la boca con el."""
        muestras = np.frombuffer(pcm, dtype=np.int16).astype(np.float32)
        paso = SAMPLE_RATE * BOCA_PASO_MS // 1000
        n = len(muestras) // paso
        if n == 0:
            return
        rms = np.sqrt((muestras[:n * paso].reshape(n, paso) ** 2).mean(axis=1))
        niveles = [round(float(min(1.0, r / BOCA_REFERENCIA)), 2) for r in rms]
        t_ms = int((time.time() + inicio - time.monotonic()) * 1000)
        ahora_ms = int(time.time() * 1000)
        while self.voz and self.voz[0]["t"] + len(self.voz[0]["niveles"]) * BOCA_PASO_MS < ahora_ms - BOCA_GUARDA_S * 1000:
            self.voz.popleft()
        self.voz.append({"t": t_ms, "paso": BOCA_PASO_MS, "niveles": niveles})
        if AL_HABLAR is not None:
            AL_HABLAR()

    def enviar_fin_turno(self):
        self._enviar(MSG_END_TURN)

    def fin_respuesta(self, cierre=True):
        """Cierra una respuesta (LLM, accion o "Dime"): la campanita de salida (si cierre) y 0x03."""
        if cierre:
            self.enviar_audio(BEEP_SALIDA)
        self.enviar_fin_turno()

    # -- VAD --------------------------------------------------------------

    def _calibrar(self, rms):
        self.calib.append(rms)
        if len(self.calib) < CALIB_FRAMES:
            return
        # mediana: un "pop" del micro al arrancar no lo sube (el 22 oct calibro 411 con un ruido real de 40-160)
        piso = sorted(self.calib)[len(self.calib) // 2]
        self.piso = piso
        self._recalcular_umbral()
        self.umbral_dicho = self.umbral
        log("%s  piso de ruido=%.0f  umbral de voz=%.0f" % (self.peer, piso, self.umbral))
        self.debug("umbral=%.0f" % self.umbral)

    def _recalcular_umbral(self):
        self.umbral = min(UMBRAL_MAX, max(self.piso * NOISE_MULT, MIN_RMS, self.ruido_largo * RUIDO_LARGO_MULT))

    def _seguir_ruido(self, rms):
        """Fuera de las frases, el piso sigue al ruido real: corrige una mala calibracion y se adapta al sitio."""
        self.piso += (rms - self.piso) * (PISO_BAJA if rms < self.piso else PISO_SUBE)
        self.ruido_largo *= RUIDO_LARGO_OLVIDO
        self._recalcular_umbral()
        if abs(self.umbral - self.umbral_dicho) > 0.25 * self.umbral_dicho:
            log("%s  piso de ruido=%.0f  umbral de voz=%.0f (ajustado)" % (self.peer, self.piso, self.umbral))
            self.umbral_dicho = self.umbral

    def _reset_vad(self):
        """Arranca de cero despues de responder, sin re-calibrar."""
        self.en_voz = False
        self.frases_voz = 0
        self.frames_silencio = 0
        self.frase.clear()
        self.preroll.clear()
        self.pcm_buf.clear()

    def _cerrar_frase(self, motivo):
        pcm = bytes(self.frase)
        self.frase.clear()
        self.en_voz = False
        self.frases_voz = 0
        self.frames_silencio = 0

        dur_ms = len(pcm) * 1000 // (SAMPLE_RATE * SAMPLE_WIDTH)
        if dur_ms < MIN_PHRASE_MS:
            log("%s  descartada (%d ms, demasiado corta)" % (self.peer, dur_ms))
            return

        self.n_frases += 1
        nombre = "%s_%s_%02d.wav" % (
            datetime.now().strftime("%Y%m%d_%H%M%S"),
            self.addr[0].replace(".", "-"),
            self.n_frases,
        )
        path = os.path.join(CAPTURE_DIR, nombre)
        guardar_wav(path, pcm)
        pico = frame_peak(pcm)
        log("%s  FRASE %d guardada: %s  (%d ms, pico=%d, %s)"
            % (self.peer, self.n_frases, nombre, dur_ms, pico, motivo))

        # el micro sigue abierto mientras se transcribe: se queda sordo cuando empieza a sonar
        # la respuesta (enviar_audio). Asi no se pierde lo que se dice justo despues de "Pixel".
        self.cola.put((pcm, self.t_inicio_frase))

    def procesar_frame(self, frame):
        rms = frame_rms(frame)
        pico = frame_peak(frame)
        if pico > self.pico_sesion:
            self.pico_sesion = pico

        if self.umbral is None:
            self._calibrar(rms)
            self.preroll.append(frame)
            return

        hay_voz = rms >= self.umbral

        if not self.en_voz:
            self.preroll.append(frame)
            self._seguir_ruido(rms)
            if hay_voz:
                self.frases_voz += 1
                if self.frases_voz >= SPEECH_FRAMES_START:
                    self.en_voz = True
                    self.t_inicio_frase = time.monotonic()
                    self.frames_silencio = 0
                    for f in self.preroll:
                        self.frase += f
                    self.preroll.clear()
                    log("%s  inicio de voz (rms=%.0f)" % (self.peer, rms))
            else:
                self.frases_voz = 0
            return

        # dentro de una frase
        self.frase += frame
        if hay_voz:
            self.frames_silencio = 0
        else:
            self.frames_silencio += 1
            if self.frames_silencio >= SILENCE_FRAMES_END:
                self._cerrar_frase("silencio")
                return

        dur_ms = len(self.frase) * 1000 // (SAMPLE_RATE * SAMPLE_WIDTH)
        if dur_ms >= MAX_PHRASE_MS:
            self._cerrar_frase("limite de %d ms" % MAX_PHRASE_MS)

    def alimentar_audio(self, payload):
        self.total_bytes += len(payload)
        self.ultimo_audio = time.monotonic()

        # mientras el asistente habla, tiramos el audio del micro para que
        # no se escuche a si mismo
        if self.respondiendo.is_set():
            self.descartadas += len(payload) // FRAME_BYTES
            return

        self.pcm_buf += payload
        while len(self.pcm_buf) >= FRAME_BYTES:
            frame = bytes(self.pcm_buf[:FRAME_BYTES])
            del self.pcm_buf[:FRAME_BYTES]
            self.procesar_frame(frame)

    def recibir_ble(self, texto):
        """Lista de Bluetooth que manda el firmware con portal: debug "ble:{"yo", "vistos"}"."""
        try:
            d = json.loads(texto)
            vistos = [{"nombre": str(v.get("n") or ""), "mac": str(v.get("m") or ""), "rssi": int(v.get("r"))}
                      for v in d.get("vistos", [])]
        except (ValueError, TypeError, AttributeError):
            log("%s  lista de Bluetooth ilegible: %r" % (self.peer, texto[:120]))
            return
        if self.ble_yo is None or len(vistos) != len(self.ble):
            log("%s  Bluetooth: soy %s, veo %d dispositivo(s)" % (self.peer, d.get("yo"), len(vistos)))
        self.ble_yo, self.ble, self.ble_t = str(d.get("yo") or ""), vistos, time.monotonic()

    def fin_de_turno(self):
        log("%s  0x03 fin de turno" % self.peer)
        if self.respondiendo.is_set():
            return
        if self.en_voz:
            self._cerrar_frase("fin de turno")
        else:
            self.frases_voz = 0

    # -- pipeline (hilo aparte) -------------------------------------------

    def _worker(self):
        while True:
            try:
                item = self.cola.get(timeout=1.0)
            except queue.Empty:
                if (self.pendiente is not None and not self.respondiendo.is_set()
                        and time.monotonic() > self.pendiente["hasta"]):
                    self.respondiendo.set()
                    self._con_micro_sordo(self._caducar)
                    continue
                if (self.ultima_interaccion is not None and not self.respondiendo.is_set()
                        and time.monotonic() - self.ultima_interaccion >= REPOSO_S):
                    self.respondiendo.set()
                    self._con_micro_sordo(self._reposo)
                continue
            if item is None:
                return
            if item[0] == "recordatorio":           # lo encola vigilar_recordatorios()
                self.respondiendo.set()
                self._con_micro_sordo(self._recordar, item[1])
                continue
            if item[0] == "decir":                  # lo encola el panel ("Probar voz")
                self.respondiendo.set()
                self._con_micro_sordo(self._decir, item[1])
                continue
            if item[0] == "decir_esp32":            # "Probar" del altavoz de Pixel en el panel
                self.respondiendo.set()
                self.forzar_esp32 = True
                try:
                    self._con_micro_sordo(self._decir, item[1])
                finally:
                    self.forzar_esp32 = False
                continue
            if item[0] in ("codigo", "codigo_esp32"):   # un codigo de enlace (nube.py; el robot: por su altavoz)
                self.respondiendo.set()
                self.forzar_esp32 = item[0] == "codigo_esp32"
                try:
                    self._con_micro_sordo(self._decir_codigo, item[1], item[2])
                finally:
                    self.forzar_esp32 = False
                continue
            self.turno_aceptado = False
            self._con_micro_sordo(self._turno, *item)
            if self.turno_aceptado:
                self.ultima_interaccion = time.monotonic()

    def _con_micro_sordo(self, funcion, *args):
        """Corre funcion y, si algo sono (micro sordo), lo reabre cuando el ESP32 termina de sonar."""
        try:
            funcion(*args)
        except Exception as e:
            self._parar_pensando()
            log("%s  ERROR en el pipeline: %s: %s" % (self.peer, type(e).__name__, e))
            self.debug("error: %s" % type(e).__name__)
            try:
                self.enviar_fin_turno()     # que el ESP32 no se quede esperando
            except OSError:
                pass
        finally:
            self._parar_pensando()
            # el ESP32 sigue sonando despues de que terminamos de enviar:
            # el micro sigue sordo hasta que acabe (estimado) + margen
            if self.respondiendo.is_set():
                espera = self.fin_reproduccion + ECO_MARGEN_S - time.monotonic()
                if espera > 0:
                    time.sleep(espera)
                    log("%s  micro reabierto %.2f s despues del ultimo envio"
                        % (self.peer, espera))
                self._reset_vad()
                self.respondiendo.clear()

    def _turno(self, pcm, t_inicio):
        dur_s = len(pcm) / float(SAMPLE_RATE * SAMPLE_WIDTH)

        # --- ruido: Silero decide en milisegundos; Whisper con el prompt tardaba hasta 37 s ---
        t0 = time.monotonic()
        if not TRANSCRIPTOR.hay_voz(pcm):
            log("%s  RUIDO: Silero no oye voz en %.2f s de audio (%.0f ms), no paso por Whisper"
                % (self.peer, dur_s, 1000 * (time.monotonic() - t0)))
            if dur_s >= RUIDO_LARGO_S and self.umbral is not None:      # musica o TV de fondo: subir el umbral
                muestras = np.frombuffer(pcm, dtype=np.int16).astype(np.float32)
                n = len(muestras) // 320
                mediana = float(np.median(np.sqrt((muestras[:n * 320].reshape(n, 320) ** 2).mean(axis=1))))
                if mediana > self.ruido_largo:
                    self.ruido_largo = mediana
                    self._recalcular_umbral()
                    self.umbral_dicho = self.umbral
                    log("%s  ruido continuo de fondo (musica, TV...) de %.0f: umbral de voz=%.0f"
                        % (self.peer, mediana, self.umbral))
            self.debug("(ruido)")
            return              # sin 0x03: no sono nada, y el firmware se queda sordo ~0,5 s con cada 0x03

        # --- STT ---
        texto, t_stt = TRANSCRIPTOR.transcribir(pcm)
        if not texto:
            log("%s  TEXTO: (vacio, Whisper no saco nada)" % self.peer)
            log("%s  STT: %.2f s para %.2f s de audio" % (self.peer, t_stt, dur_s))
            self.debug("(sin texto)")
            return

        self.ultimo_texto = texto

        # --- un correo espera el "sí, envíalo": esta frase lo decide, sin palabra de activacion ---
        if self.pendiente is not None and t_inicio <= self.pendiente["hasta"]:
            self.turno_aceptado = True
            self._confirmar(texto)
            return

        # --- palabra de activacion, antes de acciones y LLM ("Píxel, Píxel" cuenta como una) ---
        activa, resto = quitar_activacion(texto)
        while activa and resto:
            otra, despues = quitar_activacion(resto)
            if not otra:
                break
            resto = despues
        en_ventana = t_inicio <= self.ventana_hasta
        if not activa and not en_ventana:
            log("%s  ignorada (sin %s): %s" % (self.peer, ACTIVACION, texto))
            return
        self.ventana_hasta = 0.0            # la ventana vale para una sola frase
        self.turno_aceptado = True
        if activa and not resto and (self.en_voz or not self.cola.empty()):
            # "Pixel" y sigue hablando: sin beep ni "Dime", que dejarian el micro sordo y cortarian la orden
            self.ventana_hasta = time.monotonic() + ACTIVACION_VENTANA_S
            log('%s  ACTIVACION sola: "%s", pero ya sigue hablando: no digo "%s", espero la orden'
                % (self.peer, texto, ACTIVACION_RESPUESTA))
            return
        # "te escuche", antes de procesar: como la app, tambien con la frase que va dentro de la ventana del "Dime"
        self.enviar_audio(BEEP_RECIBIDO)
        if activa and not resto:
            log('%s  ACTIVACION sola: "%s" -> respondo "%s"' % (self.peer, texto, ACTIVACION_RESPUESTA))
            self._decir(ACTIVACION_RESPUESTA, cierre=False)     # la app no pone la campanita de salida tras el "Dime"
            self.ventana_hasta = self.fin_reproduccion + ACTIVACION_VENTANA_S
            log("%s  ventana abierta: %.0f s desde que termina de sonar \"%s\""
                % (self.peer, ACTIVACION_VENTANA_S, ACTIVACION_RESPUESTA))
            return
        if activa:
            log('%s  ACTIVACION: "%s"' % (self.peer, texto))
            texto = resto
        else:
            log("%s  dentro de la ventana, sin %s" % (self.peer, ACTIVACION))

        log('%s  TEXTO: "%s"' % (self.peer, texto))
        self.debug("tu: " + texto)
        self._empezar_pensando()

        # --- intencion: reglas (filtro rapido); si no detectan nada, el clasificador LLM.
        #     Con regex, el clasificador solo corrige el nombre si la busqueda no da resultados. ---
        hallada = acciones.detectar(texto)
        if hallada is not None:
            nombre, params, funcion = hallada
            log('%s  INTENCION via regex: %s | consulta "%s"' % (self.peer, nombre, params.get("consulta")))
            self._accion((nombre, dict(params, texto=texto), funcion))
            return
        clas, t_clas = CLASIFICADOR.clasificar(texto)
        funciones = dict((n, f) for n, _, f in acciones.ACCIONES)
        if clas and clas.get("accion") in funciones and not acciones.hay_pedido(texto):
            # el 3B convierte palabras que no entiende en busquedas ("Mezcuchas" -> "Mezcal Chistes")
            log('%s  clasificador dijo %s ("%s") pero la frase no suena a pedido -> LLM'
                % (self.peer, clas["accion"], clas.get("consulta")))
            clas = {"accion": "ninguna"}
        if clas and clas.get("accion") in funciones and clas.get("consulta"):
            log('%s  INTENCION via clasificador: %s | consulta "%s" | clasificador %s %.2f s'
                % (self.peer, clas["accion"], clas["consulta"], CLASIFICADOR.motor, t_clas))
            self._accion((clas["accion"], {"consulta": clas["consulta"]}, funciones[clas["accion"]]))
            return
        log("%s  INTENCION: ninguna (clasificador %s: %s, %.2f s) -> LLM" % (self.peer, CLASIFICADOR.motor, clas, t_clas))

        # --- LLM en streaming + TTS por frase ---
        t0 = time.monotonic()
        t_primer_token = None
        t_tts = 0.0
        bytes_audio = 0
        buf = ""
        dichas = []

        def hablar(frase):
            nonlocal t_tts, bytes_audio
            t1 = time.monotonic()
            audio = TTS.sintetizar(frase)
            t_tts += time.monotonic() - t1
            if audio:
                self.enviar_audio(audio)
                bytes_audio += len(audio)
            dichas.append(frase)

        for trozo in self.llm.responder(texto):
            if t_primer_token is None:
                t_primer_token = time.monotonic() - t0
            buf += trozo
            frases, buf = extraer_frases(buf, primera=not dichas)
            for f in frases:
                hablar(f)

        resto = buf.strip()
        if resto:
            hablar(resto)

        t_llm_total = time.monotonic() - t0
        self.fin_respuesta()

        respuesta = " ".join(dichas)
        dur_audio = bytes_audio / float(SAMPLE_RATE * SAMPLE_WIDTH)
        log('%s  RESPUESTA: "%s"' % (self.peer, respuesta))
        log("%s  tiempos -> STT %.2f s (audio %.2f s) | LLM %s 1er token %.2f s (total %.2f s) | TTS %.2f s (%.2f s de voz)"
            % (self.peer, t_stt, dur_s, self.llm.motor,
               t_primer_token if t_primer_token is not None else -1.0,
               t_llm_total, t_tts, dur_audio))
        self.debug("ia: " + respuesta)

    def _reposo(self):
        """Nadie interactua desde hace REPOSO_S: lo dice por voz y olvida la conversacion."""
        log("%s  REPOSO: %.0f s sin interaccion, olvido %d mensajes del historial"
            % (self.peer, time.monotonic() - self.ultima_interaccion, len(self.llm.historial)))
        self.ultima_interaccion = None
        self.ventana_hasta = 0.0
        self.llm.historial.clear()
        self._decir(REPOSO_FRASE)

    def _recordar(self, texto):
        """Dice un recordatorio que vencio, con el sonido de aviso delante (como avisar() de la app, sin el de salida)."""
        log('%s  RECORDATORIO: "%s"' % (self.peer, texto))
        self.enviar_audio(BEEP_AVISO)
        self._decir(RECORDATORIO_FRASE % texto, cierre=False)

    def _decir_codigo(self, intro, cifras):
        """Un codigo de enlace despacio: intro, cada cifra sola con un silencio despues, "Otra vez." y las cifras.
        Cada trozo sale en cuanto esta: el robot empieza a hablar enseguida. El codigo no va al registro."""
        silencio = b"\x00\x00" * int(CODIGO_PAUSA_S * SAMPLE_RATE)
        self.enviar_audio(BEEP_AVISO)
        for vuelta in range(2):
            audio = TTS.sintetizar(intro if vuelta == 0 else CODIGO_OTRA_VEZ)
            if audio:
                self.enviar_audio(audio + silencio)
            for c in cifras:
                audio = _cifra_dicha(int(c))
                if audio:
                    self.enviar_audio(audio + silencio)
        self.fin_respuesta(cierre=False)
        self.debug("ia: (codigo de enlace)")

    def _decir(self, texto, cierre=True):
        """Dice un texto fijo por voz (sin LLM) y cierra el turno."""
        audio = TTS.sintetizar(texto)
        if audio:
            self.enviar_audio(audio)
        self.fin_respuesta(cierre)
        self.debug("ia: " + texto)

    def _accion(self, hallada):
        """Ejecuta una accion detectada y responde por voz sin pasar por el LLM."""
        nombre, params, funcion = hallada
        log("%s  INTENCION: %s  %s" % (self.peer, nombre, {k: v for k, v in params.items() if not callable(v)}))
        res = funcion(params)
        log("%s  ACCION %s %s: %s" % (self.peer, nombre, "OK" if res["ok"] else "FALLO",
                                      " | ".join("%s=%s" % kv for kv in res["log"].items())))
        t1 = time.monotonic()
        audio = TTS.sintetizar(res["decir"])
        t_tts = time.monotonic() - t1
        if audio:
            self.enviar_audio(audio)
        self.fin_respuesta()
        log('%s  RESPUESTA (sin LLM): "%s"  | TTS %.2f s (%.2f s de voz)'
            % (self.peer, res["decir"], t_tts, len(audio) / float(SAMPLE_RATE * SAMPLE_WIDTH)))
        self.debug("ia: " + res["decir"])
        if res["ok"] and nombre in REGISTRAR_ACCIONES and not res.get("confirmar"):   # lo que espera un "sí", al confirmarse
            registrar(nombre, res["decir"], self._origen())
        if res.get("confirmar"):
            # la cuenta empieza cuando termina de sonar el borrador en el ESP32
            self.pendiente = dict(res["confirmar"], hasta=self.fin_reproduccion + CONFIRMAR_S)
            log("%s  ESPERANDO CONFIRMACION (%.0f s): %s" % (self.peer, CONFIRMAR_S, self.pendiente["que"]))

    def _confirmar(self, texto):
        """La frase que sigue a un borrador: solo "sí, envíalo" lo ejecuta; cualquier otra lo cancela."""
        pendiente, self.pendiente = self.pendiente, None
        p = acciones.plano(texto)
        if _RE_CONFIRMA.search(p) and not _RE_NIEGA.match(p):
            log('%s  CONFIRMADO ("%s"): %s' % (self.peer, texto, pendiente["que"]))
            dicho = pendiente["ejecutar"]()
            # lo que dijo Pixel ("Listo, correo enviado a..." o el fallo) y que era, tal cual
            registrar("correo" if pendiente["que"].startswith("correo") else "confirmado", dicho,
                      "%s · %s" % (pendiente["que"], self._origen()))
        else:
            log('%s  NO CONFIRMADO ("%s"): %s' % (self.peer, texto, pendiente["que"]))
            dicho = pendiente["cancelado"]
        log('%s  RESPUESTA (confirmacion): "%s"' % (self.peer, dicho))
        self._decir(dicho)

    def _origen(self):
        return "por voz, desde el ESP32"

    def _caducar(self):
        """Nadie dijo nada en CONFIRMAR_S: no se ejecuta y se avisa."""
        pendiente, self.pendiente = self.pendiente, None
        log("%s  CONFIRMACION CADUCADA: %s" % (self.peer, pendiente["que"]))
        self._decir(pendiente["caducado"])

    # -- cierre -----------------------------------------------------------

    def cerrar(self):
        self.cola.put(None)
        self.worker.join(timeout=30)
        seg = self.total_bytes / (SAMPLE_RATE * SAMPLE_WIDTH)
        log("%s  cerrada. %.1f s de audio, %d frase(s), pico=%d, %d tramas ignoradas mientras hablaba"
            % (self.peer, seg, self.n_frases, self.pico_sesion, self.descartadas))
        if self.pico_sesion < 1000:
            log("%s  AVISO: pico muy bajo (%d). Revisa ganancia o cableado del INMP441."
                % (self.peer, self.pico_sesion))


# ----------------------------------------------------------------- celular (Fase 11)

class SesionMovil(Sesion):
    """El celular hace de ESP32 remoto, a traves de la nube (nube.py y la app de internet).

    El VAD corre en el navegador: llegan frases ya cortadas (alimentar_frase) y el turno es el
    de Sesion (Silero, Whisper, "Pixel", acciones, IA, Piper). La voz no va por un socket: cada
    trozo se le da a escribir(tipo, pcm, dime, **extra) y nube.py lo deja en la Realtime
    Database para que el celular lo toque. tipo: "oido" (beep de frase aceptada), "voz",
    "cierre" (beep de fin), "fin" (fin de turno, sin audio) o "video" (YouTube: id y titulo,
    para el boton "Abrir en YouTube"). dime=True en el "Dime" de la palabra sola: el celular
    lo salta si el usuario ya sigue hablando (aqui no se sabe: el VAD esta alli).

    Va en MOVILES, no en SESIONES. Sin ESP32 conectado, sesion_que_habla() elige el celular que
    escucha para los recordatorios, "Probar voz" y el codigo de enlace. El celular calla su micro
    mientras toca la voz, asi que aqui no se espera a que acabe.
    """

    PENSAR_SONIDO = False               # el celular pone sus notas de "pensando" al recibir el "oido"

    def __init__(self, uid, escribir):
        self.uid = uid
        self.escribir = escribir
        self.dime = False
        self.escucha_hasta = 0.0        # la app tiene "Escuchar" puesto (latido de nube.py) hasta entonces
        self.escucha_desde = 0.0
        super().__init__(None, ("movil-" + uid[:6], 0))
        self.peer = "movil:" + uid[:6]

    def escuchando(self):
        return time.monotonic() < self.escucha_hasta

    def _accion(self, hallada):
        """Las acciones van igual, pero YouTube no abre el PC: el video se manda al celular."""
        nombre, params, funcion = hallada
        super()._accion((nombre, dict(params, abrir=self._abrir_video), funcion))

    def _origen(self):
        return "por voz, desde el celular"

    def _abrir_video(self, vid, titulo):
        self.escribir("video", None, False, id=vid, titulo=titulo or "")

    def _enviar(self, msg_type, payload=b""):
        if msg_type == MSG_END_TURN:
            self.escribir("fin", None, self.dime)
        # el texto de debug (0x04) no le sirve al celular

    def enviar_audio(self, pcm):
        dur = len(pcm) / float(SAMPLE_RATE * SAMPLE_WIDTH)
        inicio = max(time.monotonic() + MOVIL_LATENCIA_S, self.fin_reproduccion)
        self.fin_reproduccion = inicio + dur        # para la ventana del "Dime" y la del "sí, envíalo"
        tipo = "oido" if pcm is BEEP_RECIBIDO else "cierre" if es_sonido(pcm) else "voz"
        self.escribir(tipo, pcm, self.dime)

    def _decir(self, texto, cierre=True):
        self.dime = texto == ACTIVACION_RESPUESTA
        try:
            super()._decir(texto, cierre)
        finally:
            self.dime = False

    def _con_micro_sordo(self, funcion, *args):
        """Como en Sesion, pero sin esperar a que acabe de sonar: el celular se ensordece solo."""
        try:
            funcion(*args)
        except Exception as e:
            log("%s  ERROR en el pipeline: %s: %s" % (self.peer, type(e).__name__, e))
            self.escribir("fin", None, False)       # que el celular no se quede "pensando"
        finally:
            self.respondiendo.clear()

    def _reposo(self):
        """En el celular el reposo no se dice (sonaria en el bolsillo): solo se olvida la conversacion."""
        log("%s  REPOSO: %.0f s sin interaccion, olvido %d mensajes del historial (sin decirlo)"
            % (self.peer, time.monotonic() - self.ultima_interaccion, len(self.llm.historial)))
        self.ultima_interaccion = None
        self.ventana_hasta = 0.0
        self.llm.historial.clear()

    def alimentar_frase(self, pcm):
        """Una frase que corto el celular: se guarda en capturas/ como las del ESP32 y va al turno."""
        dur_s = len(pcm) / float(SAMPLE_RATE * SAMPLE_WIDTH)
        ahora = time.monotonic()
        pico = frame_peak(pcm)
        self.total_bytes += len(pcm)
        self.ultimo_audio = ahora
        self.pico_sesion = max(self.pico_sesion, pico)
        self.n_frases += 1
        nombre = "%s_%s_%02d.wav" % (datetime.now().strftime("%Y%m%d_%H%M%S"), self.addr[0], self.n_frases)
        guardar_wav(os.path.join(CAPTURE_DIR, nombre), pcm)
        log("%s  FRASE %d guardada: %s  (%d ms, pico=%d, del celular)"
            % (self.peer, self.n_frases, nombre, dur_s * 1000, pico))
        # cuando empezo a hablar, en el reloj de aqui (para la ventana del "Dime"): mas pronto que tarde
        self.cola.put((pcm, ahora - dur_s - MOVIL_LATENCIA_S))

    def cerrar(self):
        self.cola.put(None)
        self.worker.join(timeout=30)
        log("%s  cerrada. %.1f s de audio en %d frase(s)"
            % (self.peer, self.total_bytes / float(SAMPLE_RATE * SAMPLE_WIDTH), self.n_frases))


# ----------------------------------------------------------------- conexion

def recv_exacto(sock, n):
    """Lee exactamente n bytes o devuelve None si el otro lado cerro."""
    buf = bytearray()
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            return None
        buf += chunk
    return bytes(buf)


def sesion_que_habla():
    """Por donde dice Pixel lo que no es respuesta (recordatorios, "Probar voz", el codigo de enlace):
    el ESP32 mas reciente y, sin ESP32, el celular que se puso a escuchar el ultimo (Fase 11). None si no hay."""
    with _sesiones_lock:
        if SESIONES:
            return SESIONES[-1]
        oyen = [m for m in MOVILES.values() if m.escuchando()]
    return max(oyen, key=lambda m: m.escucha_desde) if oyen else None


def vigilar_recordatorios():
    """Hilo: cada recordatorio que vence va a la cola de sesion_que_habla().

    Pasa por la cola para no mezclarse con una respuesta que este sonando. Sin ESP32
    ni celular escuchando se quedan en el JSON y se dicen en cuanto alguien este.
    """
    while True:
        time.sleep(RECORDATORIOS_REVISAR_S)
        try:
            sesion = sesion_que_habla()
            if sesion is None:
                continue
            for r in AGENDA.vencidos(datetime.now()):
                log('%s  recordatorio vencido (tocaba %s): "%s"' % (sesion.peer, r["cuando"], r["texto"]))
                sesion.cola.put(("recordatorio", r["texto"]))
        except Exception as e:
            log("ERROR vigilando recordatorios: %s: %s" % (type(e).__name__, e))


def responder_descubrimiento():
    """Hilo: contesta a los ESP32 que buscan el servidor ("PIXEL? <nombre>" -> "PIXEL <PORT>").

    Asi el ESP32 lo encuentra aunque el PC cambie de IP o se este en otra red: el
    firmware lo pregunta por broadcast UDP cuando no conecta con la IP guardada.
    """
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        s.bind((HOST, DESCUBRIR_PORT))
    except OSError as e:
        log("AVISO: no puedo escuchar el descubrimiento en UDP %d (%s): los ESP32 no me encontraran solos" % (DESCUBRIR_PORT, e))
        return
    log("descubrimiento: los ESP32 me encuentran por broadcast en UDP %d" % DESCUBRIR_PORT)
    while True:
        try:
            datos, origen = s.recvfrom(256)
            if not datos.startswith(b"PIXEL?"):
                continue
            s.sendto(b"PIXEL %d" % PORT, origen)
            nombre = datos[6:].decode("utf-8", "replace").strip()[:40] or "ESP32"
            if PIXELES_VISTOS.get(origen[0]) != nombre:
                log("descubrimiento: %s (%s) busca el servidor; le digo el puerto %d" % (origen[0], nombre, PORT))
            PIXELES_VISTOS[origen[0]] = nombre
        except Exception as e:
            log("ERROR en el descubrimiento: %s: %s" % (type(e).__name__, e))


def atender(sock, addr):
    sesion = Sesion(sock, addr)
    with _sesiones_lock:
        SESIONES.append(sesion)
    log("%s  conectado" % sesion.peer)
    sesion.debug("servidor listo | activacion: %s | acciones: %s"
                 % (ACTIVACION, ", ".join(n for n, _, _ in acciones.ACCIONES)))
    try:
        sock.settimeout(120.0)
        while True:
            cab = recv_exacto(sock, 5)
            if cab is None:
                break
            msg_type, length = struct.unpack("<BI", cab)

            if length > MAX_PAYLOAD:
                log("%s  longitud invalida (%d) en tipo 0x%02x, cierro"
                    % (sesion.peer, length, msg_type))
                break

            payload = b""
            if length:
                payload = recv_exacto(sock, length)
                if payload is None:
                    break

            if msg_type == MSG_AUDIO_IN:
                sesion.alimentar_audio(payload)
            elif msg_type == MSG_END_TURN:
                sesion.fin_de_turno()
            elif msg_type == MSG_DEBUG:
                texto = payload.decode("utf-8", "replace")
                if texto.startswith("ble:"):
                    sesion.recibir_ble(texto[4:])
                elif texto.startswith("codigo:"):
                    # 12 nov: la app quiere enlazar al robot por Bluetooth y el robot pide decir su codigo (el
                    # autenticador): el PC lo dice por el altavoz del robot. El codigo no va al registro.
                    cifras = "".join(c for c in texto[7:] if c.isdigit())[:6]
                    if len(cifras) == 6:
                        log("%s  el robot pide decir su código para enlazar la app" % sesion.peer)
                        sesion.cola.put(("codigo_esp32", FRASE_CODIGO_ROBOT, cifras))
                else:
                    log("%s  debug ESP32: %s" % (sesion.peer, texto))
            elif msg_type == MSG_AUDIO_OUT:
                log("%s  recibido 0x02 (%d bytes). Ese tipo es servidor->ESP32, lo ignoro."
                    % (sesion.peer, length))
            else:
                log("%s  tipo desconocido 0x%02x (%d bytes), lo ignoro"
                    % (sesion.peer, msg_type, length))
    except socket.timeout:
        log("%s  sin datos por 120 s, cierro" % sesion.peer)
    except ConnectionResetError:
        log("%s  conexion reiniciada por el otro extremo" % sesion.peer)
    except OSError as e:
        log("%s  error de socket: %s" % (sesion.peer, e))
    finally:
        with _sesiones_lock:
            SESIONES.remove(sesion)
        sesion.cerrar()
        try:
            sock.close()
        except OSError:
            pass


def main():
    global TRANSCRIPTOR, TTS, LLM_SYSTEM, CLASIFICADOR, AGENDA, SALIDA_PC
    os.makedirs(CAPTURE_DIR, exist_ok=True)

    log("cargando faster-whisper '%s' (%s, %s, idioma=%s, beam=%d, hilos=%d, temperatura=%.1f, compresion max=%.1f)..."
        % (STT_MODELO, STT_DEVICE, STT_COMPUTE, STT_IDIOMA, STT_BEAM, STT_THREADS,
           STT_TEMPERATURA, STT_MAX_COMPRESION))
    t0 = time.monotonic()
    from stt import Transcriptor
    TRANSCRIPTOR = Transcriptor(
        model_size=STT_MODELO,
        device=STT_DEVICE,
        compute_type=STT_COMPUTE,
        language=STT_IDIOMA,
        beam_size=STT_BEAM,
        cpu_threads=STT_THREADS,
        initial_prompt=STT_PROMPT,
        vad_umbral=STT_VAD_UMBRAL,
        temperatura=STT_TEMPERATURA,
        max_compresion=STT_MAX_COMPRESION,
    )
    log("  STT listo en %.1f s" % (time.monotonic() - t0))
    log("  initial_prompt: %s" % STT_PROMPT)

    log("cargando Piper '%s' (hablante %s)..." % (TTS_VOZ, TTS_HABLANTE))
    t0 = time.monotonic()
    from tts import Tts
    TTS = Tts(os.path.join(BASE_DIR, TTS_VOZ), hablante=TTS_HABLANTE)
    log("  TTS listo en %.1f s (%d Hz -> %d Hz)"
        % (time.monotonic() - t0, TTS.sr_origen, TTS.sr_destino))

    from llm import prompt_con_fecha
    LLM_SYSTEM = prompt_con_fecha(date.today())
    log("prompt de sistema: %s" % LLM_SYSTEM)

    log("conectando con Ollama (%s) y calentando '%s'..." % (LLM_HOST, LLM_MODELO))
    t0 = time.monotonic()
    try:
        nuevo_llm().calentar()
        log("  LLM listo en %.1f s" % (time.monotonic() - t0))
    except Exception as e:
        log("  AVISO: no pude calentar el LLM (%s: %s). El primer turno sera lento."
            % (type(e).__name__, e))

    from clasificador import Clasificador
    CLASIFICADOR = Clasificador(modelo=LLM_MODELO, host=LLM_HOST)
    t0 = time.monotonic()
    prueba, _ = CLASIFICADOR.clasificar("hola")       # deja su prompt en la cache de Ollama
    log("  clasificador listo en %.1f s (prueba: %s)" % (time.monotonic() - t0, prueba))

    def corregir(texto):
        r, _ = CLASIFICADOR.clasificar(texto)
        return r["consulta"] if r and r["accion"] == "youtube" and r["consulta"] else None
    acciones.CORRECTOR = corregir

    import recordatorios
    AGENDA = recordatorios.Agenda(os.path.join(BASE_DIR, RECORDATORIOS_ARCHIVO))
    acciones.AGENDA = AGENDA
    acciones.EVENTOS = recordatorios.Agenda(os.path.join(BASE_DIR, EVENTOS_ARCHIVO))
    acciones.EXTRACTOR = CLASIFICADOR.extraer_recordatorio
    t0 = time.monotonic()
    CLASIFICADOR.extraer_recordatorio("recuérdame probar en 1 minuto")    # en frio tardaba 7.5 s
    log("  extractor de recordatorios listo en %.1f s" % (time.monotonic() - t0))
    threading.Thread(target=vigilar_recordatorios, daemon=True).start()
    if DESCUBRIR_PORT:
        threading.Thread(target=responder_descubrimiento, daemon=True).start()
    log("recordatorios: %s | %d pendiente(s)" % (AGENDA.ruta, len(AGENDA.pendientes())))

    # despues de calentar: asi el calentamiento va a Ollama y el respaldo responde rapido
    import gemini
    gemini.configurar(GEMINI_MODELO, GEMINI_PENSAR, GEMINI_MAX_TOKENS, GEMINI_TIMEOUT, log)
    if gemini.cargar(os.path.join(BASE_DIR, GEMINI_CLAVE)):
        log("Gemini: clave cargada; responde %s y Ollama queda de respaldo" % GEMINI_MODELO)
    else:
        log("Gemini: sin clave (se pone en el panel, Cuentas); responde Ollama")
    import groq_ia
    groq_ia.configurar(GEMINI_TIMEOUT, log)
    if groq_ia.cargar(os.path.join(BASE_DIR, GROQ_CLAVE)):
        log("Groq: clave cargada (modelo %s)" % (groq_ia.modelo() or "sin elegir: se elige al probarla en el panel"))

    import servicios_google
    try:
        acciones.GOOGLE = servicios_google.Google(os.path.join(BASE_DIR, GOOGLE_CLIENTE),
                                                  os.path.join(BASE_DIR, GOOGLE_TOKEN))
        log("Google: autorizado el %s (en modo Testing caduca a los 7 dias)" % acciones.GOOGLE.autorizado)
    except servicios_google.NoAutorizado as e:
        log("Google: no configurado (%s). Calendario local en %s; correo desactivado."
            % (e, acciones.EVENTOS.ruta))
    ruta = os.path.join(BASE_DIR, CONTACTOS_ARCHIVO)
    if os.path.exists(ruta):
        with open(ruta, encoding="utf-8") as f:
            acciones.CONTACTOS = json.load(f)
    log("contactos para correo: %s" % (", ".join(acciones.CONTACTOS) or "ninguno (%s)" % ruta))

    SALIDA_PC = salida_pc.SalidaPc(SAMPLE_RATE)
    import panel
    panel.iniciar(sys.modules[__name__])
    if NUBE_DB:
        import nube
        nube.iniciar(sys.modules[__name__], panel)
        import obsidian                 # Fase 13: el cerebro de la app en una boveda de Obsidian
        obsidian.iniciar(sys.modules[__name__], nube)
        log("nube: conectando con %s en segundo plano" % NUBE_DB)

    log("palabra de activacion: %s | variantes: %s | con coma o verbo despues: %s | solo con verbo despues: %s | prefijos: %s | ventana: %.0f s"
        % (ACTIVACION, ", ".join(ACTIVACION_VARIANTES), ", ".join(ACTIVACION_SI_COMA_U_ORDEN),
           ", ".join(ACTIVACION_SI_SIGUE_ORDEN), ", ".join(ACTIVACION_PREFIJOS), ACTIVACION_VENTANA_S))
    log("acciones registradas: %s" % ", ".join(n for n, _, _ in acciones.ACCIONES))
    log("filtro de ruido Silero: umbral %.2f | reposo tras %.0f s sin interaccion" % (STT_VAD_UMBRAL, REPOSO_S))
    if not os.environ.get("DISPLAY"):
        log("  AVISO: no hay DISPLAY; xdg-open no podra abrir el navegador")

    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((HOST, PORT))
    srv.listen(4)

    log("escuchando en %s:%d  (PCM %d Hz, 16 bit, mono)" % (HOST, PORT, SAMPLE_RATE))
    log("las frases se guardan en %s" % CAPTURE_DIR)
    log("Ctrl+C para parar")

    try:
        while True:
            sock, addr = srv.accept()
            sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            threading.Thread(target=atender, args=(sock, addr), daemon=True).start()
    except KeyboardInterrupt:
        log("parando")
    finally:
        srv.close()


if __name__ == "__main__":
    main()

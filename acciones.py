#!/usr/bin/env python3
"""Fase 4 - Acciones del asistente: intencion -> funcion.

Cada accion tiene:
  - un detector: reglas (regex) sobre el texto de Whisper que devuelven sus
    parametros, o None si el texto no es para ella;
  - una funcion que la ejecuta y devuelve que decir por voz y que registrar.

Se evaluan ANTES del LLM. Para agregar luces o sensores: escribir el detector
y la funcion y registrarla con @registrar(nombre, detector).
"""

import re
import subprocess
import threading
import time
import unicodedata
from datetime import datetime, timedelta

import recordatorios
import servicios_google

ACCIONES = []           # [(nombre, detector, funcion)] en orden de prioridad
CORRECTOR = None        # funcion(texto) -> consulta corregida o None; la pone el servidor
AGENDA = None           # recordatorios.Agenda; la pone el servidor
EVENTOS = None          # recordatorios.Agenda con los eventos del calendario local (sin Google); la pone el servidor
EXTRACTOR = None        # funcion(texto) -> ({"texto", "cuando"} o None, segundos); la pone el servidor
GOOGLE = None           # servicios_google.Google, o None si no esta autorizado; lo pone el servidor
CONTACTOS = {}          # {"Ana": "ana@...", ...}: los unicos destinatarios posibles; lo pone el servidor
CORREO_ASUNTO = "Mensaje desde Píxel"
CORREO_FIRMA = "\n\n--\nDictado por voz al asistente Píxel."
EVENTO_MIN = 60         # duracion de los eventos que se crean por voz


def registrar(nombre, detector):
    def decorador(funcion):
        ACCIONES.append((nombre, detector, funcion))
        return funcion
    return decorador


def detectar(texto):
    """(nombre, params, funcion) de la primera accion que reconoce el texto, o None."""
    for nombre, detector, funcion in ACCIONES:
        params = detector(texto)
        if params is not None:
            return nombre, params, funcion
    return None


def plano(texto):
    """Minusculas y sin tildes, con la MISMA longitud que el original.

    Asi los indices de un match sobre el texto plano sirven para recortar
    el original con sus mayusculas y acentos.
    """
    return "".join(unicodedata.normalize("NFD", c.lower())[0] for c in texto)


# ------------------------------------------------------------ recordatorios
# Van antes que YouTube: "ponme una alarma a las 5" no es un video.

_RECORDATORIO = r"(?:recordatorios?|alarmas?)"
# recuérdame, recuerda, recordar, avísame, despiértame, alarma, recordatorio, temporizador
_RE_CREAR = re.compile(r"\b(?:recuerd(?:a|ame|eme|ale)|recordarme|avis(?:ame|eme)|"
                       r"despiert(?:ame|eme)|alarma|recordatorio|temporizador)\b")
_RE_CREAR_ROTO = re.compile(r"\b(?:record|recuerd|acuerd)\w*")
# "borra el recordatorio del café", "cancela la alarma", "elimina todos los recordatorios"
_RE_BORRAR = re.compile(r"\b(?:borr|elimin|quit|cancel)\w*\b.*?\b%s\b"
                        r"(?:\s+(?:de la|del|de|para|sobre)\b)?(?P<q>.*)" % _RECORDATORIO)
# "qué recordatorios tengo", "dime mis alarmas", "¿tengo algún recordatorio?"; recordat* porque
# Whisper lo rompe ("que recordato Dios tengo")
_RE_VER_COSA = re.compile(r"\b(?:recordat\w*|alarmas?)\b")
_RE_VER_PREGUNTA = re.compile(r"\b(?:tengo|hay|mis|cuales|cuantos|cuantas|dime|lista)\b")
# "recuerda me comprar café" (Whisper parte "recuérdame"), "que llame a mamá", y la orden
# cuando el modelo la deja en el texto: "anotar en el calendario el dentista"
_EN_CALENDARIO = r"\s+en\s+(?:el|la|mi)\s+(?:calendario|agenda)"
_RE_TEXTO_SOBRA = re.compile(r"^(?:(?:me|que|a mi|(?:agendar|anotar|apuntar|programar)(?:%s)?|"
                             r"(?:agend|a[gj]en|anot|apunt)(?:a|ame|e)\b(?:%s)?|"     # "agenda menacita", "ajename"
                             r"(?:agend|anot|apunt|program)\w*%s)\b\s*)+"
                             % (_EN_CALENDARIO, _EN_CALENDARIO, _EN_CALENDARIO), re.I)
_RE_TODOS = re.compile(r"\btod[oa]s\b")
_VACIAS = {"el", "la", "los", "las", "lo", "de", "del", "a", "al", "que", "en", "un", "una",
           "y", "mi", "mis", "para", "por", "con"}


def _palabras(texto):
    return {w for w in re.findall(r"\w+", plano(texto)) if w not in _VACIAS}


def detectar_borrar_recordatorio(texto):
    p = plano(texto)
    m = _RE_BORRAR.search(p)
    if not m:
        return None
    return {"consulta": _limpiar(texto[m.start("q"):m.end("q")]), "todos": bool(_RE_TODOS.search(p))}


def detectar_ver_recordatorios(texto):
    p = plano(texto)
    return {} if _RE_VER_COSA.search(p) and _RE_VER_PREGUNTA.search(p) else None


def detectar_recordatorio(texto):
    p = plano(texto)
    if _RE_CREAR.search(p):
        return {}
    # Whisper rompe "recuérdame" ("Recordamente en 3 minutos..."): vale si ademas dice cuando
    if _RE_CREAR_ROTO.search(p) and recordatorios.extraer_hora(texto):
        return {}
    return None


@registrar("borrar_recordatorio", detectar_borrar_recordatorio)
def borrar_recordatorio(params):
    pendientes = AGENDA.pendientes()
    info = {"consulta": params["consulta"], "pendientes": len(pendientes)}
    if not pendientes:
        return {"ok": False, "decir": "No tienes recordatorios.", "log": info}
    if params["todos"]:
        elegidos = pendientes
    elif params["consulta"]:
        buscadas = _palabras(params["consulta"])
        puntos = [len(buscadas & _palabras(r["texto"])) for r in pendientes]
        if max(puntos) == 0:
            return {"ok": False, "decir": "No encontré un recordatorio de %s." % params["consulta"], "log": info}
        elegidos = [pendientes[puntos.index(max(puntos))]]     # el mas parecido; si empatan, el mas proximo
    elif len(pendientes) == 1:
        elegidos = pendientes
    else:
        return {"ok": False, "decir": "Tienes %d recordatorios. Dime cuál borro, por ejemplo: borra el "
                "recordatorio de %s." % (len(pendientes), pendientes[0]["texto"]), "log": info}
    borrados = AGENDA.borrar({r["id"] for r in elegidos})
    info["borrados"] = [r["id"] for r in borrados]
    if len(borrados) == 1:
        decir = "Listo, borré el recordatorio de %s." % borrados[0]["texto"]
    else:
        decir = "Listo, borré tus %d recordatorios." % len(borrados)
    return {"ok": True, "decir": decir, "log": info}


@registrar("ver_recordatorios", detectar_ver_recordatorios)
def ver_recordatorios(params):
    pendientes = AGENDA.pendientes()
    info = {"pendientes": len(pendientes)}
    if not pendientes:
        return {"ok": True, "decir": "No tienes recordatorios.", "log": info}
    ahora = datetime.now()
    partes = ["%s, %s" % (r["texto"], recordatorios.cuando_hablado(datetime.fromisoformat(r["cuando"]), ahora))
              for r in pendientes[:5]]
    if len(pendientes) > 5:
        partes.append("%d más" % (len(pendientes) - 5))
    lista = partes[0] if len(partes) == 1 else "; ".join(partes[:-1]) + "; y " + partes[-1]
    cabeza = "Tienes un recordatorio" if len(pendientes) == 1 else "Tienes %d recordatorios" % len(pendientes)
    return {"ok": True, "decir": "%s: %s." % (cabeza, lista), "log": info}


def _que_y_cuando(texto):
    """(que, piezas de la hora, info para el log) de un recordatorio o un evento; que es None si no se entiende."""
    info = {}
    datos, seg = EXTRACTOR(texto)
    info["extractor_s"] = round(seg, 2)
    info["extraido"] = datos
    if not datos:
        return None, {}, info
    m = _RE_TEXTO_SOBRA.match(plano(datos["texto"]))       # plano conserva la longitud
    que = datos["texto"][m.end():] if m else datos["texto"]
    # el trozo que el modelo copio; si no trae hora, la frase entera. La manana o la tarde
    # se buscan en toda la frase: el modelo copia "mañana a las 6" sin el "despiértame"
    toda = recordatorios.extraer_hora(texto)
    piezas = recordatorios.extraer_hora(datos["cuando"]) or toda
    if "hora" in piezas and "periodo" not in piezas and "periodo" in toda:
        piezas["periodo"] = toda["periodo"]
    info["piezas"] = piezas
    return que or None, piezas, info


@registrar("recordatorio", detectar_recordatorio)
def recordatorio(params):
    que, piezas, info = _que_y_cuando(params["texto"])
    if not que:
        return {"ok": False, "decir": "No entendí el recordatorio. Prueba así: recuérdame comprar pan "
                "en 10 minutos.", "log": info}
    ahora = datetime.now()
    cuando = recordatorios.resolver(piezas, ahora)
    if cuando is None:
        return {"ok": False, "decir": "¿Para cuándo te recuerdo %s? Dímelo con la hora, por ejemplo: "
                "en 10 minutos o mañana a las 3." % que, "log": info}
    r = AGENDA.agregar(que, cuando)
    info["id"], info["cuando"] = r["id"], r["cuando"]
    return {"ok": True, "decir": "Listo, te recuerdo %s %s." % (que, recordatorios.cuando_hablado(cuando, ahora)),
            "log": info}


# ---------------------------------------------------- Google: calendario y correo

_SIN_GOOGLE = "El correo no está configurado todavía."
_DIAS_SEMANA = r"lunes|martes|miercoles|jueves|viernes|sabado|domingo"

# "agenda la reunión mañana a las 3", "anota...", "pon en el calendario..." (con hora)
# (Whisper escribe "agéndame" como "ajename": a[gj]en* vale porque ademas se exige la hora)
_RE_EVENTO_VERBO = re.compile(r"^\W*(?:agend\w*|a[gj]en\w*|anot\w*|apunt\w*|program\w*)\b")
_RE_EVENTO_PON = re.compile(r"^\W*(?:pon(?:me)?|crea|crear|anade|mete)\b.*\b(?:calendario|agenda)\b")
# "¿qué tengo mañana?", "¿tengo citas el viernes?", "lee mi calendario"
_RE_CAL_COSA = re.compile(r"\b(?:calendario|agenda|agendad[oa]s?|eventos?|citas?|reuniones)\b")
_RE_CAL_PREGUNTA = re.compile(r"\b(?:que|cuales|cuantas|cuantos|tengo|hay|dime|lee|leeme|mira|revisa)\b")
_RE_QUE_TENGO = re.compile(r"\bque\s+tengo\s+(?:para\s+)?(?:hoy|manana|pasado\s+manana|el\s+(?:%s))\b" % _DIAS_SEMANA)
# "qué tengo pendiente para mañana", "¿tengo algo el viernes?", "qué hay para hoy": pregunta + dia
_RE_CAL_PREGUNTA_DIA = re.compile(r"\b(?:que\s+tengo|tengo\s+algo|que\s+hay\s+para|pendientes?)\b")
_RE_CAL_DIA = re.compile(r"\b(?:hoy|manana|%s)\b" % _DIAS_SEMANA)


def detectar_crear_evento(texto):
    p = plano(texto)
    if (_RE_EVENTO_VERBO.search(p) or _RE_EVENTO_PON.search(p)) and recordatorios.extraer_hora(texto):
        return {}
    return None


def detectar_ver_calendario(texto):
    p = plano(texto)
    if (_RE_QUE_TENGO.search(p) or (_RE_CAL_COSA.search(p) and _RE_CAL_PREGUNTA.search(p))
            or (_RE_CAL_PREGUNTA_DIA.search(p) and _RE_CAL_DIA.search(p))):
        return {}
    return None


def _fallo_google(e, que):
    if isinstance(e, servicios_google.NoAutorizado):
        return "No pude %s: Google no está autorizado. Hay que volver a autorizarlo." % que
    return "No pude %s: Google no responde." % que


def _eventos(desde, hasta):
    """Lo que hay entre dos fechas: eventos (de Google si esta autorizado; si no, los locales)
    y los recordatorios pendientes. [{"titulo", "inicio"}], los de todo el dia primero."""
    eventos = GOOGLE.eventos(desde, hasta) if GOOGLE is not None else []
    locales = AGENDA.pendientes() + (EVENTOS.pendientes() if GOOGLE is None else [])
    for r in locales:
        inicio = datetime.fromisoformat(r["cuando"])
        if desde <= inicio < hasta:
            eventos.append({"titulo": r["texto"], "inicio": inicio})
    return sorted(eventos, key=lambda e: (e["inicio"] is not None, e["inicio"] or desde))


@registrar("crear_evento", detectar_crear_evento)
def crear_evento(params):
    que, piezas, info = _que_y_cuando(params["texto"])
    if not que:
        return {"ok": False, "decir": "No entendí qué agendo. Prueba así: agenda la reunión con Ana "
                "mañana a las 3.", "log": info}
    ahora = datetime.now()
    inicio = recordatorios.resolver(piezas, ahora)
    if inicio is None:
        return {"ok": False, "decir": "¿Para cuándo agendo %s?" % que, "log": info}
    titulo = que[0].upper() + que[1:]
    if GOOGLE is None:                              # calendario local, en EVENTOS
        info["id"], info["donde"] = EVENTOS.agregar(titulo, inicio)["id"], "local"
    else:
        try:
            info["id"] = GOOGLE.crear_evento(titulo, inicio, inicio + timedelta(minutes=EVENTO_MIN))
        except Exception as e:
            info["error"] = ("%s: %s" % (type(e).__name__, e))[:200]
            return {"ok": False, "decir": _fallo_google(e, "crear el evento"), "log": info}
        info["donde"] = "google"
    info["inicio"] = inicio.isoformat(timespec="seconds")
    return {"ok": True, "decir": "Listo, agendé %s %s." % (que, recordatorios.cuando_hablado(inicio, ahora)),
            "log": info}


@registrar("ver_calendario", detectar_ver_calendario)
def ver_calendario(params):
    ahora = datetime.now()
    dia = recordatorios.fecha_de(recordatorios.extraer_hora(params["texto"]).get("dia"), ahora) or ahora.date()
    medianoche = datetime(dia.year, dia.month, dia.day)
    desde = max(ahora, medianoche)                  # de hoy, solo lo que queda
    info = {"dia": dia.isoformat()}
    try:
        eventos = _eventos(desde, medianoche + timedelta(days=1))
    except Exception as e:
        info["error"] = ("%s: %s" % (type(e).__name__, e))[:200]
        return {"ok": False, "decir": _fallo_google(e, "leer el calendario"), "log": info}
    info["eventos"] = len(eventos)
    cuando = recordatorios.dia_hablado(dia, ahora)
    if not eventos:
        return {"ok": True, "decir": "No tienes nada en el calendario %s." % cuando, "log": info}
    partes = ["%s, %s" % (recordatorios.hora_hablada(e["inicio"]) if e["inicio"] else "todo el día", e["titulo"])
              for e in eventos[:5]]
    if len(eventos) > 5:
        partes.append("%d más" % (len(eventos) - 5))
    lista = partes[0] if len(partes) == 1 else "; ".join(partes[:-1]) + "; y " + partes[-1]
    cabeza = "un evento" if len(eventos) == 1 else "%d eventos" % len(eventos)
    return {"ok": True, "decir": "%s tienes %s: %s." % (cuando[0].upper() + cuando[1:], cabeza, lista), "log": info}


# El correo solo va a nombres de CONTACTOS y nunca sale sin el "sí, envíalo": la accion
# devuelve "confirmar" con la funcion que envia, y es la sesion la que espera la respuesta.

# "manda un correo a Ana diciendo que llego tarde"
_RE_CORREO = re.compile(r"\b(?:mand|envi|escrib)\w*\b.*?\b(?:correo|mail|email|e-mail|mensaje)\b")
_RE_CORREO_PARTES = re.compile(r"\b(?:a|para)\s+(?P<n>\w+(?:\s+\w+)?)\s*,?\s*(?:diciendo(?:le)?|que\s+dig[ao]|"
                               r"que\s+dice|con\s+el\s+mensaje|y\s+dile|dile|:)\s*(?:que\s+)?(?P<msg>.+)")


def detectar_correo(texto):
    p = plano(texto)
    m = _RE_CORREO.search(p)
    if not m:
        return None
    partes = _RE_CORREO_PARTES.search(p, m.end())
    if not partes:
        return {"para": None, "mensaje": None}
    return {"para": texto[partes.start("n"):partes.end("n")],
            "mensaje": texto[partes.start("msg"):partes.end("msg")].strip(" .,;")}


def _contacto(nombre):
    """(nombre, direccion) de CONTACTOS que coincide con lo que se dijo, o None."""
    dicho = plano(nombre).split()
    for n, direccion in CONTACTOS.items():
        guardado = plano(n).split()
        if guardado and dicho and (dicho[:len(guardado)] == guardado or dicho[0] == guardado[0]):
            return n, direccion
    return None


@registrar("correo", detectar_correo)
def correo(params):
    """Arma el borrador y lo lee. No envia: eso solo pasa si la sesion oye "sí, envíalo"."""
    if GOOGLE is None:
        return {"ok": False, "decir": _SIN_GOOGLE, "log": {}}
    info = {"para": params["para"], "mensaje": params["mensaje"]}
    if not params["para"] or not params["mensaje"]:
        return {"ok": False, "decir": "Dímelo todo junto, por ejemplo: manda un correo a Ana diciendo "
                "que llego tarde.", "log": info}
    contacto = _contacto(params["para"])
    if contacto is None:
        return {"ok": False, "decir": "No tengo a %s en los contactos." % params["para"], "log": info}
    nombre, direccion = contacto
    mensaje = params["mensaje"][0].upper() + params["mensaje"][1:]
    info["direccion"] = direccion

    def enviar():
        try:
            GOOGLE.enviar_correo(direccion, CORREO_ASUNTO, mensaje + "." + CORREO_FIRMA)
        except Exception as e:
            return _fallo_google(e, "enviar el correo")
        return "Listo, correo enviado a %s." % nombre

    return {"ok": True, "log": info,
            "decir": "Borrador para %s. Asunto: %s. Dice: %s. ¿Lo envío? Di: sí, envíalo."
                     % (nombre, CORREO_ASUNTO, mensaje),
            "confirmar": {"que": "correo a %s <%s>: %s" % (nombre, direccion, mensaje), "ejecutar": enviar,
                          "cancelado": "De acuerdo, no envío el correo.",
                          "caducado": "No me confirmaste, así que no envío el correo."}}


# ------------------------------------------------------------------ YouTube

# youtube, you tube, youtu, yutube, yutu(b), yo tuve / yo tube (asi lo oye Whisper a veces)
_YT = r"(?:you\s?tube|youtu|yu\s?tube?|yutub|yutu|yo\s?tu[bv]e)"
# reproduce, reproduces, reproducen, reprodúceme/lo/la, reproducir, reproduzca(s/n)
_REPRODUCIR = r"reproduc(?:e|es|en|eme|elo|ela|ir)|reproduzc(?:a|as|an)"
_VERBO = r"(?:pon(?:me|er|ga|gas)?|%s|busc(?:a|ame|ar)|busque)" % _REPRODUCIR
_VERBO_MEDIA = r"(?:pon(?:me|er|ga|gas)?|%s)" % _REPRODUCIR
_NO_SE = r"(?<!se )"        # "se reproduce" no es una orden ("como se reproduce un pez")

# "pon X en youtube"
_RE_YT_DESPUES = re.compile(r"\b%s%s\b[\s,]+(?P<q>.+?)\s+(?:en|por)\s+(?:el\s+)?%s" % (_NO_SE, _VERBO, _YT))
# "busca en youtube X"
_RE_YT_ANTES = re.compile(r"\b%s%s\b[\s,]+(?:en|por)\s+(?:el\s+)?%s\b(?P<q>.*)" % (_NO_SE, _VERBO, _YT))
# "pon X" / "reproduce X" sin decir youtube
_RE_SIN_YT = re.compile(r"\b%s(?P<v>%s)\b[\s,]+(?P<q>.+)" % (_NO_SE, _VERBO_MEDIA))

_RE_ORDEN = re.compile(r"^[\s\u00a1\u00bf\"'.,]*%s\b" % _VERBO)


def empieza_con_orden(texto):
    """True si el texto empieza con un verbo de accion (pon, ponme, reproduce, busca...)."""
    return bool(_RE_ORDEN.match(plano(texto)))


def verbo_al_inicio(texto):
    """Hasta donde llega el verbo de accion con que empieza el texto (0 si no empieza con uno)."""
    m = _RE_ORDEN.match(plano(texto))
    return m.end() if m else 0


# palabras que hacen que "pon X" suene a cancion o video
_MEDIA = re.compile(r"\b(?:cancion(?:es)?|musica|videos?|videoclip|temas?|album|disco|"
                    r"playlist|lista de reproduccion|concierto|trailer|karaoke)\b")

# "reproduce" tal como lo escribe Whisper con el INMP441: reprusa, reparuse, repreves, reporo;
# y "produce", con el "re" mordido
_REPRODUCIR_ROTO = r"rep\w*|produc\w*"
_RE_PEDIDO = re.compile(r"\b%s(?:%s|%s|quier[oae]|quisiera)\b|\b%s"
                        % (_NO_SE, _VERBO, _REPRODUCIR_ROTO, _YT))


def hay_pedido(texto):
    """True si el texto suena a pedir algo: un verbo de accion en cualquier parte
    (aunque venga destrozado), "quiero", YouTube o una palabra de musica o video."""
    p = plano(texto)
    return bool(_RE_PEDIDO.search(p) or _MEDIA.search(p))

_RELLENO_INICIO = re.compile(r"^(?:(?:me|nos|a|porfa|por favor)\s+)+", re.I)
_RELLENO_FIN = re.compile(r"\s*,?\s*(?:por favor|porfa)\s*$", re.I)


# (Official Video), [Official Audio], 【MV】, y tambien un "(DVD ..." sin cerrar
_ETIQUETAS = re.compile(r"\s*[(\[【][^)\]】]*(?:[)\]】]|$)")
_HASHTAGS = re.compile(r"#\S+")


def _sin_simbolos(texto):
    limpio = "".join(c for c in texto if unicodedata.category(c) not in ("So", "Sk", "Cs", "Co"))
    limpio = limpio.replace("|", ",")
    return re.sub(r"\s+,", ",", re.sub(r"\s+", " ", limpio)).strip(" ,-–—")


def _hablable(titulo):
    """Titulo listo para el TTS: sin lo que va entre parentesis o corchetes, sin
    hashtags, sin lo que sigue a | o //, y sin emojis ni simbolos sueltos."""
    corto = re.split(r"\s*(?:\||//)\s*", titulo)[0]
    corto = _HASHTAGS.sub("", _ETIQUETAS.sub("", corto))
    return _sin_simbolos(corto) or _sin_simbolos(titulo)


def _limpiar(consulta):
    consulta = consulta.strip(" \t.,;:!?¡¿\"'«»")
    consulta = _RELLENO_INICIO.sub("", consulta)
    consulta = _RELLENO_FIN.sub("", consulta)
    return consulta.strip(" \t.,;:!?¡¿\"'«»")


# "produce X" al empezar la frase es "reproduce" con el "re" mordido (el micro aun estaba sordo)
_RE_PRODUCE = re.compile(r"^[\s\u00a1\u00bf\"'.,]*(?=produc(?:e|eme|elo|ela|ir)\b)")


def detectar_youtube(texto):
    m = _RE_PRODUCE.match(plano(texto))
    if m:
        texto = texto[:m.end()] + "re" + texto[m.end():]
    p = plano(texto)
    for regex in (_RE_YT_DESPUES, _RE_YT_ANTES):
        m = regex.search(p)
        if m:
            return {"consulta": _limpiar(texto[m.start("q"):m.end("q")])}
    m = _RE_SIN_YT.search(p)
    if m and (m.group("v").startswith("reprodu") or _MEDIA.search(m.group("q"))):
        return {"consulta": _limpiar(texto[m.start("q"):m.end("q")])}
    return None


_ydl = None
_ydl_lock = threading.Lock()


def _buscar(consulta):
    """Primer resultado de YouTube: (id, titulo), o (None, None). Solo metadatos."""
    global _ydl
    with _ydl_lock:
        if _ydl is None:
            import yt_dlp
            _ydl = yt_dlp.YoutubeDL({
                "quiet": True,
                "no_warnings": True,
                "extract_flat": True,       # no visita la pagina del video
                "skip_download": True,
                "socket_timeout": 10,
            })
        info = _ydl.extract_info("ytsearch1:" + consulta, download=False)
    entradas = (info or {}).get("entries") or []
    if not entradas:
        return None, None
    return entradas[0].get("id"), entradas[0].get("title")


def _abrir(url):
    """xdg-open en el navegador del PC. Devuelve el codigo de salida, o None si
    a los 3 s sigue vivo (pasa cuando arranca un navegador nuevo)."""
    proc = subprocess.Popen(["xdg-open", url], stdin=subprocess.DEVNULL,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                            start_new_session=True)
    try:
        return proc.wait(timeout=3)
    except subprocess.TimeoutExpired:
        return None


@registrar("youtube", detectar_youtube)
def youtube(params):
    consulta = params["consulta"]
    info = {"consulta": consulta, "id": None, "titulo": None, "busqueda_s": None}
    if not consulta:
        return {"ok": False, "decir": "No entendí qué quieres que ponga en YouTube.", "log": info}

    t0 = time.monotonic()
    try:
        vid, titulo = _buscar(consulta)
    except Exception as e:
        info["busqueda_s"] = round(time.monotonic() - t0, 2)
        info["error"] = ("%s: %s" % (type(e).__name__, e))[:200]
        return {"ok": False, "decir": "No pude buscar %s en YouTube." % consulta, "log": info}
    info["busqueda_s"] = round(time.monotonic() - t0, 2)
    if not vid and CORRECTOR is not None and params.get("texto"):
        # sin resultados: pedir la correccion del nombre y buscar otra vez
        t1 = time.monotonic()
        corregida = CORRECTOR(params["texto"])
        info["clasificador_s"] = round(time.monotonic() - t1, 2)
        info["corregida"] = corregida
        if corregida and corregida != consulta:
            t2 = time.monotonic()
            try:
                vid, titulo = _buscar(corregida)
            except Exception as e:
                info["busqueda2_s"] = round(time.monotonic() - t2, 2)
                info["error"] = ("%s: %s" % (type(e).__name__, e))[:200]
                return {"ok": False, "decir": "No pude buscar %s en YouTube." % corregida, "log": info}
            info["busqueda2_s"] = round(time.monotonic() - t2, 2)
            if vid:
                consulta = corregida
    info["id"], info["titulo"] = vid, titulo
    if not vid:
        return {"ok": False, "decir": "No encontré %s en YouTube." % consulta, "log": info}

    rc = _abrir("https://www.youtube.com/watch?v=%s" % vid)
    info["xdg_open"] = "sigue vivo a los 3 s" if rc is None else "exit %d" % rc
    if rc not in (0, None):
        return {"ok": False, "decir": "Encontré el video, pero no pude abrir el navegador.", "log": info}
    return {"ok": True, "decir": "Listo, reproduciendo %s." % _hablable(titulo or consulta), "log": info}

#!/usr/bin/env python3
"""Fase 15 - Cliente de Groq (API compatible con OpenAI), solo con urllib.

Pedido del usuario (12 nov): "agrega un cliente mas en API como Groq". Igual que gemini.py: la clave la pega el
usuario en el panel del programa (Tus APIs) y se guarda en GROQ_CLAVE; si hay clave, las respuestas habladas
(llm.Llm) y el clasificador pueden ir a Groq. El orden entre Gemini y Groq lo elige el usuario (llm.PREFERIDA);
si los dos fallan, responde Ollama.

REST (https://console.groq.com/docs):
    POST <URL>/chat/completions             {"stream": true} va soltando el texto (SSE, "data: [DONE]" al final)
    GET  <URL>/models                       la lista de modelos de esa clave (probar la clave y elegir modelo)
La clave va en la cabecera Authorization: nunca en la URL, en el log ni en /api/estado.

El modelo no se fija aqui: Groq cambia su lista a menudo. Al probar la clave se elige el primero de PREFERIDOS
que la lista tenga (o el primero que sirva para chatear) y se guarda junto a la clave.
"""

import json
import os
import re
import threading
import time
import urllib.error
import urllib.request

NOMBRE = "groq"
URL = "https://api.groq.com/openai/v1"
PREFERIDOS = ("llama-3.3-70b-versatile", "openai/gpt-oss-120b", "openai/gpt-oss-20b",
              "meta-llama/llama-4-maverick-17b-128e-instruct", "llama-3.1-8b-instant")
_NO_CHAT = re.compile(r"whisper|tts|guard|orpheus|playai|distil|compound|safeguard", re.I)
MAX_TOKENS = 400        # respuestas de voz cortas
TIMEOUT = 10.0
PAUSA_S = 60.0          # tras un fallo de conexion no se reintenta en este rato (como gemini.PAUSA_S)
PAUSA_CUPO_S = 120.0    # tras un 429: el limite de Groq es por minuto, no por dia
LOG = print

_clave = None
_modelo = ""
_ruta = None
_lock = threading.Lock()
_pausa_hasta = 0.0
_estado = {"error": "", "error_t": 0.0, "ok_t": 0.0}


class ErrorGroq(Exception):
    pass


Error = ErrorGroq


class _ErrorConexion(ErrorGroq):
    """Sin internet, DNS o timeout."""


class _ErrorCupo(ErrorGroq):
    """HTTP 429: demasiadas peticiones en este minuto."""


def configurar(timeout, log):
    global TIMEOUT, LOG
    TIMEOUT, LOG = timeout, log


# ------------------------------------------------------------------ clave

def cargar(ruta):
    """Lee la clave (y el modelo elegido) guardados en ruta. -> True si hay clave."""
    global _clave, _modelo, _ruta
    _ruta = ruta
    clave, modelo = None, ""
    try:
        with open(ruta, encoding="utf-8") as f:
            d = json.load(f)
        clave = (d.get("clave") or "").strip() or None
        modelo = (d.get("modelo") or "").strip()
    except FileNotFoundError:
        pass
    except (OSError, ValueError, AttributeError) as e:
        LOG("groq: no pude leer %s (%s)" % (ruta, type(e).__name__))
    with _lock:
        _clave, _modelo = clave, modelo
    return clave is not None


def _escribir(clave, modelo):
    tmp = _ruta + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)     # solo la lee este usuario
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump({"clave": clave, "modelo": modelo}, f)
    os.replace(tmp, _ruta)


def guardar(clave):
    """Guarda la clave (o la borra si viene vacia) y se usa desde ya, sin reiniciar. El modelo se elige al probar."""
    global _clave, _modelo, _pausa_hasta
    clave = (clave or "").strip()
    with _lock:
        if clave:
            _escribir(clave, "")
        elif _ruta and os.path.exists(_ruta):
            os.remove(_ruta)
        _clave, _modelo, _pausa_hasta = clave or None, "", 0.0
        _estado.update(error="", error_t=0.0, ok_t=0.0)


def hay_clave():
    return _clave is not None


def activo():
    """Hay clave, ya se sabe con que modelo, y no esta en pausa por un fallo reciente."""
    return _clave is not None and bool(_modelo) and time.monotonic() >= _pausa_hasta


def modelo():
    return _modelo


def estado():
    """Para /api/estado: nunca la clave."""
    ahora = time.time()
    return {"configurada": hay_clave(), "modelo": _modelo, "error": _estado["error"],
            "hace_error": int(ahora - _estado["error_t"]) if _estado["error_t"] else None,
            "hace_ok": int(ahora - _estado["ok_t"]) if _estado["ok_t"] else None}


# ------------------------------------------------------------------ peticiones

def _limpiar(texto):
    texto = str(texto)
    return texto.replace(_clave, "***") if _clave else texto


def _fallo(texto, pausa=0.0):
    global _pausa_hasta
    _estado.update(error=_limpiar(texto)[:200], error_t=time.time())
    if pausa:
        _pausa_hasta = time.monotonic() + pausa
        LOG("groq: no lo intento en %.0f s (%s)" % (pausa, _limpiar(texto)[:120]))


def _pausa_de(e):
    return PAUSA_S if isinstance(e, _ErrorConexion) else PAUSA_CUPO_S if isinstance(e, _ErrorCupo) else 0.0


def _resumen_http(e):
    """"HTTP 401: Invalid API Key" a partir del JSON de error (al estilo OpenAI)."""
    try:
        err = json.loads(e.read()).get("error", {})
        texto = "HTTP %d: %s" % (e.code, err.get("message", "") if isinstance(err, dict) else err)
    except Exception:
        texto = "HTTP %d" % e.code
    return _limpiar(texto)[:200]


def _abrir(ruta, cuerpo=None, timeout=None):
    clave = _clave
    if not clave:
        raise ErrorGroq("sin clave")
    req = urllib.request.Request(
        URL + ruta,
        data=json.dumps(cuerpo).encode("utf-8") if cuerpo is not None else None,
        # sin User-Agent propio, Cloudflare (delante de Groq) puede rechazar el de urllib con un 403
        headers={"Authorization": "Bearer " + clave, "Content-Type": "application/json",
                 "User-Agent": "Pixel/1.0"},
    )
    try:
        return urllib.request.urlopen(req, timeout=timeout or TIMEOUT)
    except urllib.error.HTTPError as e:
        raise (_ErrorCupo if e.code == 429 else ErrorGroq)(_resumen_http(e)) from None
    except (urllib.error.URLError, OSError) as e:
        raise _ErrorConexion(_limpiar("sin conexion: %s" % getattr(e, "reason", e))) from None


def _cuerpo(system, mensajes, json_salida, stream):
    c = {"model": _modelo, "max_completion_tokens": MAX_TOKENS, "stream": stream,
         "messages": [{"role": "system", "content": system}]
         + [{"role": "assistant" if m["role"] == "assistant" else "user", "content": m["content"]} for m in mensajes]}
    if _modelo.startswith("openai/gpt-oss"):
        c["reasoning_effort"] = "low"           # razona poco: es para hablar rapido
    if json_salida:
        c["response_format"] = {"type": "json_object"}
    return c


def generar(system, mensajes, json_salida=False, timeout=None):
    """Respuesta entera. mensajes: [{"role": "user"|"assistant", "content"}]. Lanza ErrorGroq."""
    try:
        with _abrir("/chat/completions", _cuerpo(system, mensajes, json_salida, False), timeout) as r:
            d = json.loads(r.read())
        texto = ((d.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
        if not texto.strip():
            raise ErrorGroq("respuesta vacia")
    except ErrorGroq as e:
        _fallo(str(e), _pausa_de(e))
        raise
    except (OSError, ValueError, AttributeError, IndexError) as e:
        _fallo("respuesta rota: %s" % e, PAUSA_S)
        raise ErrorGroq(_limpiar("respuesta rota: %s" % e)) from None
    _estado["ok_t"] = time.time()
    return texto


def generar_stream(system, mensajes, timeout=None):
    """Generador: cede trozos de texto segun llegan. Lanza ErrorGroq (si ya cedio algo, a media respuesta)."""
    dio = False
    try:
        with _abrir("/chat/completions", _cuerpo(system, mensajes, False, True), timeout) as r:
            for linea in r:
                linea = linea.strip()
                if not linea.startswith(b"data:"):
                    continue
                dato = linea[5:].strip()
                if dato == b"[DONE]":
                    break
                d = json.loads(dato)
                if "error" in d:
                    err = d["error"]
                    raise ErrorGroq(_limpiar(err.get("message", "error") if isinstance(err, dict) else err)[:200])
                trozo = ((d.get("choices") or [{}])[0].get("delta") or {}).get("content") or ""
                if trozo:
                    dio = True
                    yield trozo
        if not dio:
            raise ErrorGroq("respuesta vacia")
    except ErrorGroq as e:
        _fallo(str(e), _pausa_de(e))
        raise
    except (OSError, ValueError, AttributeError, IndexError) as e:
        _fallo("se corto: %s" % e, PAUSA_S)
        raise ErrorGroq(_limpiar("se corto: %s" % e)) from None
    _estado["ok_t"] = time.time()


def clave_rechazada():
    """La ultima prueba dijo que la clave no vale."""
    return bool(_estado.get("rechazada"))


def rechazada(e):
    """El error dice que la clave no vale (no que falte internet o haya que esperar)."""
    return str(e).startswith(("HTTP 401", "HTTP 403"))


def elegir_modelo(ids):
    """El primero de PREFERIDOS que este en la lista; si no, el primero que sirva para chatear ("" si ninguno)."""
    for m in PREFERIDOS:
        if m in ids:
            return m
    return next((m for m in sorted(ids) if not _NO_CHAT.search(m)), "")


def probar():
    """Comprueba la clave con la lista de modelos, elige uno y hace una pregunta corta. -> (ok, mensaje)."""
    global _modelo, _pausa_hasta
    if not hay_clave():
        return False, "No hay clave guardada."
    _pausa_hasta = 0.0
    _estado["rechazada"] = False
    try:
        with _abrir("/models", timeout=8) as r:
            d = json.loads(r.read())
        ids = [m.get("id", "") for m in d.get("data", []) if isinstance(m, dict) and m.get("active", True) is not False]
    except ErrorGroq as e:
        _estado["rechazada"] = rechazada(e)
        _fallo(str(e), _pausa_de(e))
        if rechazada(e):
            return False, "Groq no acepta esa clave. Cópiala entera desde console.groq.com → API Keys."
        return False, "Groq no responde: %s" % e
    except (OSError, ValueError, AttributeError) as e:
        _fallo("lista de modelos rota: %s" % e)
        return False, "Groq no responde bien: %s" % _limpiar(e)
    elegido = elegir_modelo(ids)
    if not elegido:
        _fallo("ningun modelo para chatear")
        return False, "La clave vale, pero Groq no ofrece ningún modelo para conversar."
    with _lock:
        _modelo = elegido
        if _clave and _ruta:
            _escribir(_clave, elegido)
    t0 = time.monotonic()
    try:
        texto = generar("Responde con una sola frase corta, en español.",
                        [{"role": "user", "content": "Saluda a los visitantes de la feria."}], timeout=15)
    except _ErrorCupo as e:
        return False, "La clave vale, pero Groq pide esperar un momento (%s)." % e
    except ErrorGroq as e:
        return False, "La clave vale, pero %s no respondió: %s" % (elegido, e)
    return True, "Groq (%s) responde en %.1f s: %s" % (elegido, time.monotonic() - t0, texto.strip()[:150])

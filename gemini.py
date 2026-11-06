#!/usr/bin/env python3
"""Fase 11 - Cliente de la API de Gemini (Google), solo con urllib.

Si hay clave (GEMINI_CLAVE; la pega el usuario en el panel, Cuentas), las respuestas
habladas (llm.Llm) y el clasificador (clasificador.Clasificador) van a Gemini en vez de
a Ollama. Si Gemini falla (sin internet, clave mala, cupo agotado, tarda demasiado),
quien llama vuelve a Ollama en ese turno: Pixel sigue funcionando en local.

REST de la Gemini API:
    POST <URL>/models/<modelo>:generateContent                 JSON entero (clasificador)
    POST <URL>/models/<modelo>:streamGenerateContent?alt=sse   va soltando el texto (voz)
    GET  <URL>/models                                          ListModels (probar la clave)
La clave va en la cabecera x-goog-api-key: nunca en la URL, en el log ni en /api/estado.
"""

import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

URL = "https://generativelanguage.googleapis.com/v1beta"

# valores por defecto; servidor.main() pone los suyos con configurar()
MODELO = "gemini-3.8-flash"
PENSAR = "low"          # thinkingLevel; "" = no mandar thinkingConfig
MAX_TOKENS = 1024
TIMEOUT = 10.0          # s sin recibir nada antes de darlo por fallido
PAUSA_S = 60.0          # tras un fallo de conexion no se reintenta en este rato: no pagar el timeout en cada turno
LOG = print

_clave = None
_ruta = None
_lock = threading.Lock()
_sin_pensar = False     # el modelo rechazo thinkingConfig (400): se manda sin el
_pausa_hasta = 0.0
_estado = {"error": "", "error_t": 0.0, "ok_t": 0.0}


class ErrorGemini(Exception):
    pass


def configurar(modelo, pensar, max_tokens, timeout, log):
    global MODELO, PENSAR, MAX_TOKENS, TIMEOUT, LOG
    MODELO, PENSAR, MAX_TOKENS, TIMEOUT, LOG = modelo, pensar, max_tokens, timeout, log


# ------------------------------------------------------------------ clave

def cargar(ruta):
    """Lee la clave guardada en ruta, si la hay. -> True si hay clave."""
    global _clave, _ruta
    _ruta = ruta
    clave = None
    try:
        with open(ruta, encoding="utf-8") as f:
            clave = (json.load(f).get("clave") or "").strip() or None
    except FileNotFoundError:
        pass
    except (OSError, ValueError, AttributeError) as e:
        LOG("gemini: no pude leer %s (%s)" % (ruta, type(e).__name__))
    with _lock:
        _clave = clave
    return clave is not None


def guardar(clave):
    """Guarda la clave (o la borra si viene vacia) y se usa desde ya, sin reiniciar."""
    global _clave, _sin_pensar, _pausa_hasta
    clave = (clave or "").strip()
    with _lock:
        if clave:
            tmp = _ruta + ".tmp"
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)     # solo la lee este usuario
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump({"clave": clave}, f)
            os.replace(tmp, _ruta)
        elif os.path.exists(_ruta):
            os.remove(_ruta)
        _clave = clave or None
        _sin_pensar, _pausa_hasta = False, 0.0
        _estado.update(error="", error_t=0.0, ok_t=0.0)


def hay_clave():
    return _clave is not None


def activo():
    """Hay clave y no esta en pausa por un fallo de conexion reciente."""
    return _clave is not None and time.monotonic() >= _pausa_hasta


def estado():
    """Para /api/estado: nunca la clave."""
    ahora = time.time()
    return {"configurada": hay_clave(), "modelo": MODELO, "error": _estado["error"],
            "hace_error": int(ahora - _estado["error_t"]) if _estado["error_t"] else None,
            "hace_ok": int(ahora - _estado["ok_t"]) if _estado["ok_t"] else None}


# ------------------------------------------------------------------ peticiones

def _limpiar(texto):
    """Por si acaso: la clave nunca sale en un mensaje."""
    texto = str(texto)
    return texto.replace(_clave, "***") if _clave else texto


def _fallo(texto, conexion=False):
    global _pausa_hasta
    _estado.update(error=_limpiar(texto)[:200], error_t=time.time())
    if conexion:
        _pausa_hasta = time.monotonic() + PAUSA_S


def _bien():
    _estado["ok_t"] = time.time()


class _ErrorConexion(ErrorGemini):
    pass


def _abrir(ruta, cuerpo=None, timeout=None):
    clave = _clave
    if not clave:
        raise ErrorGemini("sin clave")
    req = urllib.request.Request(
        URL + ruta,
        data=json.dumps(cuerpo).encode("utf-8") if cuerpo is not None else None,
        headers={"x-goog-api-key": clave, "Content-Type": "application/json"},
    )
    try:
        return urllib.request.urlopen(req, timeout=timeout or TIMEOUT)
    except urllib.error.HTTPError as e:
        raise ErrorGemini(_resumen_http(e)) from None
    except (urllib.error.URLError, OSError) as e:      # sin internet, DNS, timeout
        raise _ErrorConexion(_limpiar("sin conexion: %s" % getattr(e, "reason", e))) from None


def _resumen_http(e):
    """"HTTP 400 INVALID_ARGUMENT: API key not valid..." a partir del JSON de error de Google."""
    try:
        err = json.loads(e.read()).get("error", {})
        texto = "HTTP %d %s: %s" % (e.code, err.get("status", ""), err.get("message", ""))
    except Exception:
        texto = "HTTP %d" % e.code
    return _limpiar(texto)[:200]


def _quitar_pensar(e):
    """Si el modelo rechazo thinkingConfig, se reintenta sin el (y ya siempre sin el)."""
    global _sin_pensar
    if not _sin_pensar and PENSAR and "HTTP 400" in str(e) and "thinking" in str(e).lower():
        _sin_pensar = True
        LOG("gemini: %s no acepta thinkingLevel=%s (%s); sigo sin el" % (MODELO, PENSAR, e))
        return True
    return False


def _cuerpo(system, mensajes, json_salida):
    # Sin "temperature": en Gemini 3 Google recomienda dejarla en su valor por defecto (1.0);
    # mas baja puede dar bucles. El largo lo marca el prompt ("2 a 4 frases").
    conf = {"maxOutputTokens": MAX_TOKENS}
    if PENSAR and not _sin_pensar:
        conf["thinkingConfig"] = {"thinkingLevel": PENSAR}
    if json_salida:
        conf["responseMimeType"] = "application/json"
    return {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]}
                     for m in mensajes],
        "generationConfig": conf,
    }


def _texto(d):
    """El texto de la respuesta (sin las partes de razonamiento, si vinieran)."""
    try:
        partes = d["candidates"][0]["content"]["parts"]
    except (KeyError, IndexError, TypeError):
        return ""
    return "".join(p.get("text", "") for p in partes if isinstance(p, dict) and not p.get("thought"))


def _motivo(d):
    try:
        return d["candidates"][0].get("finishReason") or "?"
    except (KeyError, IndexError, TypeError, AttributeError):
        return (d.get("promptFeedback") or {}).get("blockReason") or "sin candidatos"


def _llamar(ruta, cuerpo_fn, timeout):
    """Abre la peticion; si el modelo rechaza thinkingConfig, reintenta una vez sin el."""
    try:
        return _abrir(ruta, cuerpo_fn(), timeout)
    except ErrorGemini as e:
        if _quitar_pensar(e):
            return _abrir(ruta, cuerpo_fn(), timeout)
        raise


def generar(system, mensajes, json_salida=False, timeout=None):
    """Respuesta entera. mensajes: [{"role": "user"|"assistant", "content"}]. Lanza ErrorGemini."""
    try:
        with _llamar("/models/%s:generateContent" % MODELO,
                     lambda: _cuerpo(system, mensajes, json_salida), timeout) as r:
            d = json.loads(r.read())
        texto = _texto(d)
        if not texto.strip():
            raise ErrorGemini("respuesta vacia (%s)" % _motivo(d))
    except _ErrorConexion as e:
        _fallo(str(e), conexion=True)
        raise
    except ErrorGemini as e:
        _fallo(str(e))
        raise
    except (OSError, ValueError) as e:
        _fallo("respuesta rota: %s" % e, conexion=True)
        raise ErrorGemini(_limpiar("respuesta rota: %s" % e)) from None
    _bien()
    return texto


def generar_stream(system, mensajes, timeout=None):
    """Generador: cede trozos de texto segun llegan (SSE). Lanza ErrorGemini; si ya cedio algo,
    el error llega a media respuesta y quien llama decide que hacer con lo dicho."""
    dio = False
    try:
        r = _llamar("/models/%s:streamGenerateContent?alt=sse" % MODELO,
                    lambda: _cuerpo(system, mensajes, False), timeout)
        with r:
            for linea in r:
                linea = linea.strip()
                if not linea.startswith(b"data:"):
                    continue
                d = json.loads(linea[5:])
                if "error" in d:
                    err = d["error"]
                    raise ErrorGemini(_limpiar("%s: %s" % (err.get("status", "error"), err.get("message", "")))[:200])
                trozo = _texto(d)
                if trozo:
                    dio = True
                    yield trozo
        if not dio:
            raise ErrorGemini("respuesta vacia")
    except _ErrorConexion as e:
        _fallo(str(e), conexion=True)
        raise
    except ErrorGemini as e:
        _fallo(str(e))
        raise
    except (OSError, ValueError) as e:      # se corto la conexion o llego algo raro a medias
        _fallo("se corto: %s" % e, conexion=True)
        raise ErrorGemini(_limpiar("se corto: %s" % e)) from None
    _bien()


def probar():
    """Comprueba la clave y el modelo con ListModels y una pregunta corta. -> (ok, mensaje)."""
    global _pausa_hasta
    if not hay_clave():
        return False, "No hay clave guardada."
    _pausa_hasta = 0.0
    modelos, token = [], ""
    try:
        for _ in range(10):         # paginas de la lista
            ruta = "/models?pageSize=1000" + ("&pageToken=" + urllib.parse.quote(token) if token else "")
            with _abrir(ruta, timeout=8) as r:
                d = json.loads(r.read())
            modelos += [m.get("name", "").split("/")[-1] for m in d.get("models", [])
                        if "generateContent" in m.get("supportedGenerationMethods", [])]
            token = d.get("nextPageToken") or ""
            if not token:
                break
    except ErrorGemini as e:
        _fallo(str(e), conexion=isinstance(e, _ErrorConexion))
        return False, "Gemini no acepta la clave o no responde: %s" % e
    except (OSError, ValueError) as e:
        _fallo("lista de modelos rota: %s" % e)
        return False, "Gemini no responde bien: %s" % _limpiar(e)
    if MODELO not in modelos:
        flash = [m for m in modelos if "flash" in m][:8]
        texto = "La clave vale, pero el modelo %s no está disponible. Algunos que sí: %s" % (
            MODELO, ", ".join(flash) or "ninguno Flash")
        _fallo(texto)
        return False, texto
    t0 = time.monotonic()
    try:
        texto = generar("Responde con una sola frase corta, en español.",
                        [{"role": "user", "content": "Saluda a los visitantes de la feria."}], timeout=15)
    except ErrorGemini as e:
        return False, "La clave vale, pero %s no respondió: %s" % (MODELO, e)
    return True, "Gemini %s responde en %.1f s: %s" % (MODELO, time.monotonic() - t0, texto.strip()[:150])

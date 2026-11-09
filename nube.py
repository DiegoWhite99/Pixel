#!/usr/bin/env python3
"""Fase 10 - Pixel en la nube: la app de internet lo encuentra y lo maneja, como Alexa.

El servidor entra solo en Firebase como usuario anonimo (Identity Toolkit por REST; el
token de renovacion se guarda en NUBE_TOKEN), publica su estado en la Realtime Database
y escucha por streaming (SSE) las ordenes de la app y las solicitudes de enlace.

Enlazar: Pixel abre el "modo enlace", aparece en /visibles y la app lo lista. Para que
nadie se adueñe de el solo por verlo, hay que escribir en la app un codigo de 6 cifras
que Pixel dice en voz alta y que sale en el panel local; lo comprueba el servidor, no
las reglas, para poder cortar tras MAX_FALLOS intentos. Sin dueños, el modo enlace
queda abierto. Las ordenes de la app ejecutan las mismas funciones que los POST del
panel (panel.RUTAS_POST). Lo arranca servidor.main() si NUBE_DB tiene valor.

Estructura (las reglas estan en database.rules.json):
    visibles/<pid>                   {nombre, hasta}: Pixel en modo enlace
    pixeles/<pid>/estado             {json, t}: lo mismo que /api/estado, como texto JSON
    pixeles/<pid>/vivo               marca de tiempo cada VIVO_S
    pixeles/<pid>/voz                {json}: volumen de la voz que suena, para la boca de la cara 3D
    pixeles/<pid>/duenos/<uid>       {nombre, desde}: apps enlazadas
    pixeles/<pid>/mirando/<uid>      latido de la app abierta: se publica mas a menudo
    pixeles/<pid>/solicitudes/<uid>  {codigo, n, nombre}: codigo vacio = "dilo en voz alta"
    pixeles/<pid>/ordenes/<id>       {uid, ruta, cuerpo (JSON), t}
    pixeles/<pid>/respuestas/<id>    {uid, ok, mensaje | error, n}
    pixeles/<pid>/frases/<id>        {uid, pcm, t}: frase que oyo el celular (PCM 16 kHz en base64)
    pixeles/<pid>/habla/<uid>/<id>   {tipo, pcm, dime, id, titulo}: voz (o video) de Pixel para ese celular
    pixeles/<pid>/escuchando/<uid>   latido del celular con "Escuchar" puesto
    usuarios/<uid>/pixeles/<pid>     {nombre, desde}: los Pixel de cada app

Fase 11: con "Escuchar" en la app, el celular hace de ESP32 remoto. Corta las frases en el
navegador y las deja en frases/; aqui cada una va a la SesionMovil de ese uid (servidor.py),
que hace el mismo turno que con el ESP32, y su voz se escribe en habla/<uid>, en orden. Sin
ESP32 conectado, el celular que escucha dice tambien los recordatorios y el codigo de enlace.
"""

import base64
import binascii
import hmac
import json
import os
import queue
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

ENLACE_S = 300          # cuanto dura el modo enlace abierto a mano
ENLACE_SIN_DUENO_S = 3600
MAX_FALLOS = 8          # codigos malos (de cualquiera) antes de cerrar el modo enlace
RAPIDO_S = 2.5          # cada cuanto se publica el estado si alguien tiene la app abierta
LENTO_S = 30.0
MIRANDO_S = 60          # la app esta abierta si su latido es de hace menos de esto
VIVO_S = 10
RESPUESTA_S = 60        # las respuestas se borran pasado este tiempo
DECIR_CADA_S = 12       # como mucho, cada cuanto se dice el codigo en voz alta
FRASE_CODIGO = "Para enlazar la app, mi código es: %s."
FRASE_ENLAZADO = "¡Listo! Ya estoy enlazado con tu app."
SV = {".sv": "timestamp"}
MOVIL_MAX_S = 12        # frase mas larga que se acepta del celular (el corta a los 10 s)
MOVIL_VIEJA_S = 30      # frases que esperaban mas que esto (Pixel estaba apagado) se tiran
MOVIL_INACTIVO_S = 600  # sin frases en este rato, la sesion del celular se cierra
HABLA_S = 60            # la voz para el celular se borra pasado este tiempo (el la borra al tocarla)
ESCUCHA_S = 45          # el celular escucha si su latido (cada 15 s) es de hace menos de esto

S = None                # modulo del servidor
P = None                # modulo del panel
_auth = {"uid": "", "id": "", "refresh": "", "vence": 0.0}
_auth_lock = threading.Lock()
_estado = {"activa": False, "conectada": False, "error": "", "duenos": {}, "enlace": None}
_ordenes = queue.Queue()
_hechas = set()         # ordenes ya encoladas: el streaming puede repetirlas al reconectar
_respuestas = []        # (monotonic, id) para borrarlas pasado RESPUESTA_S
_mirando = {"hasta": 0.0}
_hay_voz = threading.Event()
_dicho = {"t": 0.0}
_frases = queue.Queue()
_frases_vistas = set()  # como _hechas, para las frases del celular
_habla = queue.Queue()  # (uid, tipo, pcm, dime, extra) que escribir, en orden
_hablas = []            # (monotonic, uid, clave) para borrarlas pasado HABLA_S
_ultima_clave = [0]
_reloj = {"offset": 0}  # reloj de Firebase - reloj de aqui (ms), de lo que devuelve el latido


class SinNube(Exception):
    pass


# ------------------------------------------------------------------ HTTP y sesion anonima

def _json(url, datos=None, metodo=None, form=False, timeout=15):
    cuerpo, cab = None, {}
    if datos is not None:
        if form:
            cuerpo, cab["Content-Type"] = urllib.parse.urlencode(datos).encode(), "application/x-www-form-urlencoded"
        else:
            cuerpo, cab["Content-Type"] = json.dumps(datos, ensure_ascii=False).encode("utf-8"), "application/json"
    req = urllib.request.Request(url, data=cuerpo, headers=cab, method=metodo)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        try:
            detalle = json.loads(e.read()).get("error")
            detalle = detalle.get("message") if isinstance(detalle, dict) else detalle
        except Exception:
            detalle = ""
        if any(k in str(detalle) for k in ("OPERATION_NOT_ALLOWED", "ADMIN_ONLY_OPERATION", "CONFIGURATION_NOT_FOUND")):
            raise SinNube("Falta activar el inicio de sesión anónimo en Firebase (Authentication).")
        if e.code == 404 and ("firebaseio" in url or "firebasedatabase" in url):
            raise SinNube("La Realtime Database no existe todavía en Firebase.")
        raise SinNube("Firebase respondió %d: %s" % (e.code, detalle or e.reason))


def _ruta(nombre):
    return os.path.join(S.BASE_DIR, nombre)


def _entrar():
    """Renueva el token (o crea la cuenta anonima de este Pixel la primera vez)."""
    with _auth_lock:
        # time.time(), no monotonic(): monotonic no avanza con el PC suspendido, y al despertar el
        # token caducado seguia pareciendo valido (9 nov: 401 "Permission denied" sin parar)
        if _auth["id"] and time.time() < _auth["vence"]:
            return
        ruta = _ruta(S.NUBE_TOKEN)
        guardado = {}
        if os.path.exists(ruta):
            with open(ruta, encoding="utf-8") as f:
                guardado = json.load(f)
        clave = urllib.parse.quote(S.NUBE_API_KEY)
        if guardado.get("refresh"):
            r = _json("https://securetoken.googleapis.com/v1/token?key=" + clave,
                      {"grant_type": "refresh_token", "refresh_token": guardado["refresh"]}, form=True)
            uid, token, refresh, dura = r["user_id"], r["id_token"], r["refresh_token"], int(r["expires_in"])
        else:
            r = _json("https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=" + clave, {"returnSecureToken": True})
            uid, token, refresh, dura = r["localId"], r["idToken"], r["refreshToken"], int(r["expiresIn"])
            S.log("nube: cuenta anonima nueva para este Pixel: %s" % uid)
        _auth.update(uid=uid, id=token, refresh=refresh, vence=time.time() + dura - 300)
        if guardado.get("refresh") != refresh or guardado.get("uid") != uid:
            tmp = ruta + ".tmp"
            with open(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w", encoding="utf-8") as f:
                json.dump({"uid": uid, "refresh": refresh}, f)
            os.replace(tmp, ruta)


def _url(ruta):
    _entrar()
    return "%s/%s.json?auth=%s" % (S.NUBE_DB.rstrip("/"), ruta, urllib.parse.quote(_auth["id"]))


def _db(metodo, ruta, datos=None):
    return _json(_url(ruta), datos, metodo)


def _pid():
    return _auth["uid"]


def _ahora_ms():
    return int(time.time() * 1000)


# ------------------------------------------------------------------ enlace

def nombre():
    return S.NUBE_NOMBRE or "Píxel"


def abrir_enlace(segundos=ENLACE_S):
    """Abre el modo enlace con un codigo nuevo; devuelve el codigo."""
    codigo = "%06d" % secrets.randbelow(10 ** 6)
    _estado["enlace"] = {"codigo": codigo, "hasta": time.monotonic() + segundos, "fallos": 0}
    _db("PUT", "visibles/" + _pid(), {"nombre": nombre(), "hasta": _ahora_ms() + segundos * 1000})
    S.log("nube: modo enlace abierto %d s, codigo %s" % (segundos, codigo))
    return codigo


def cerrar_enlace():
    _estado["enlace"] = None
    _db("DELETE", "visibles/" + _pid())


def decir_codigo():
    """Pixel dice el codigo por su altavoz (o por el celular que escucha). False si no hay por donde."""
    enlace = _estado["enlace"]
    if enlace is None:
        return False
    sesion = S.sesion_que_habla()
    if sesion is None:
        return False
    if time.monotonic() - _dicho["t"] > DECIR_CADA_S:
        _dicho["t"] = time.monotonic()
        sesion.cola.put(("decir", FRASE_CODIGO % ", ".join(enlace["codigo"])))
    return True


def _responder(clave, uid, ok, texto, **extra):
    datos = dict(extra, uid=uid, ok=ok, t=SV)
    datos["mensaje" if ok else "error"] = texto
    _db("PUT", "pixeles/%s/respuestas/%s" % (_pid(), clave), datos)
    _respuestas.append((time.monotonic(), clave))


def _solicitud(uid, s):
    """Una app pide oir el codigo (codigo vacio) o enlazarse con el."""
    _db("DELETE", "pixeles/%s/solicitudes/%s" % (_pid(), uid))
    n = str(s.get("n") or "")
    clave = "enlace-" + uid
    enlace = _estado["enlace"]
    if enlace is None or time.monotonic() > enlace["hasta"]:
        _responder(clave, uid, False, "Píxel no está en modo enlace. En el PC de Píxel: panel → Cuentas → Enlazar otra app.", n=n)
        return
    codigo = str(s.get("codigo") or "").strip()
    if not codigo:
        dicho = decir_codigo()
        _responder(clave, uid, True, "Escucha a Píxel." if dicho else "Píxel no tiene altavoz conectado: mira el código en el panel del PC.",
                   n=n, dicho=dicho)
        return
    if hmac.compare_digest(codigo, enlace["codigo"]):
        app = (str(s.get("nombre") or "App").strip() or "App")[:40]
        _db("PUT", "pixeles/%s/duenos/%s" % (_pid(), uid), {"nombre": app, "desde": SV})
        _db("PUT", "usuarios/%s/pixeles/%s" % (uid, _pid()), {"nombre": nombre(), "desde": SV})
        _estado["duenos"][uid] = {"nombre": app, "desde": _ahora_ms()}
        cerrar_enlace()
        _responder(clave, uid, True, "Enlazado.", n=n, enlazado=True)
        S.log("nube: app enlazada: %s (%s)" % (app, uid))
        sesion = S.sesion_que_habla()
        if sesion is not None:
            sesion.cola.put(("decir", FRASE_ENLAZADO))
        return
    enlace["fallos"] += 1
    S.log("nube: codigo de enlace incorrecto (%d de %d)" % (enlace["fallos"], MAX_FALLOS))
    if enlace["fallos"] >= MAX_FALLOS:
        cerrar_enlace()
        _responder(clave, uid, False, "Demasiados intentos. Pide un código nuevo en el panel del PC.", n=n)
    else:
        _responder(clave, uid, False, "Ese código no es. Pide a Píxel que lo diga otra vez.", n=n)


def quitar(d):
    """Desenlaza una app (desde el panel local o desde una app enlazada)."""
    uid = str(d.get("uid") or "")
    if uid not in _estado["duenos"]:
        raise P.ErrorPanel("Esa app no estaba enlazada.")
    _db("DELETE", "pixeles/%s/duenos/%s" % (_pid(), uid))
    _db("DELETE", "usuarios/%s/pixeles/%s" % (uid, _pid()))
    _estado["duenos"].pop(uid, None)
    S.log("nube: app desenlazada: %s" % uid)
    return {"mensaje": "App desenlazada."}


def _ruta_enlazar(d):
    if not _estado["conectada"]:
        raise P.ErrorPanel("Píxel no está conectado a la nube: %s" % (_estado["error"] or "sin internet"))
    codigo = abrir_enlace()
    decir_codigo()
    return {"mensaje": "Código %s, válido %d minutos." % (codigo, ENLACE_S // 60)}


def _ruta_decir(d):
    if _estado["enlace"] is None:
        raise P.ErrorPanel("No hay ningún código abierto: pulsa Enlazar otra app.")
    if not decir_codigo():
        raise P.ErrorPanel("No hay ningún ESP32 conectado para decirlo.")
    return {"mensaje": "Escucha a Píxel."}


# ------------------------------------------------------------------ estado para el panel

def estado_local():
    """Lo que ve el panel local (con el codigo mientras el modo enlace esta abierto)."""
    enlace = _estado["enlace"]
    quedan = int(enlace["hasta"] - time.monotonic()) if enlace else 0
    return {"activa": _estado["activa"], "conectada": _estado["conectada"], "error": _estado["error"],
            "pid": _pid(), "nombre": nombre() if S else "",
            "duenos": [dict(v, uid=k) for k, v in sorted(_estado["duenos"].items(), key=lambda x: x[1].get("desde") or 0)],
            "enlace": {"codigo": enlace["codigo"], "quedan_s": quedan} if enlace and quedan > 0 else None}


# ------------------------------------------------------------------ hilos

def _escuchar(ruta, al_cambiar):
    """Hilo: streaming (SSE) de la Realtime Database en ruta; al_cambiar(hijo, valor) por cada hijo."""
    while True:
        try:
            req = urllib.request.Request(_url(ruta), headers={"Accept": "text/event-stream"})
            with urllib.request.urlopen(req, timeout=90) as r:
                evento = ""
                for linea in r:
                    linea = linea.decode("utf-8").rstrip("\r\n")
                    if linea.startswith("event:"):
                        evento = linea[6:].strip()
                        if evento in ("cancel", "auth_revoked"):
                            break
                    elif linea.startswith("data:") and evento in ("put", "patch"):
                        d = json.loads(linea[5:])
                        camino, valor = d.get("path", "/"), d.get("data")
                        if camino == "/":
                            for hijo, v in (valor or {}).items() if isinstance(valor, dict) else []:
                                al_cambiar(hijo, v)
                        else:
                            hijo = camino.strip("/").split("/")[0]
                            if camino.strip("/") == hijo:
                                al_cambiar(hijo, valor)
                    if time.time() > _auth["vence"]:
                        break                       # token a punto de caducar: reconectar con uno nuevo
        except Exception as e:
            _estado["error"] = str(e)[:200]
            time.sleep(5)


def _al_orden(id_, orden):
    if isinstance(orden, dict) and orden.get("ruta") and id_ not in _hechas:
        if len(_hechas) > 2000:
            _hechas.clear()
        _hechas.add(id_)
        _ordenes.put((id_, orden))


def _al_solicitud(uid, s):
    if isinstance(s, dict):
        try:
            _solicitud(uid, s)
        except Exception as e:
            S.log("nube: ERROR con una solicitud de enlace: %s: %s" % (type(e).__name__, e))


def _trabajar():
    """Hilo: ejecuta las ordenes de la app con las funciones del panel, una a una."""
    while True:
        id_, o = _ordenes.get()
        uid = str(o.get("uid") or "")
        try:
            if uid not in _estado["duenos"]:
                raise P.ErrorPanel("Esta app ya no está enlazada con Píxel.")
            funcion = P.RUTAS_POST.get(o["ruta"])
            if funcion is None:
                raise P.ErrorPanel("Esa orden no existe.")
            cuerpo = json.loads(o.get("cuerpo") or "{}")
            res = funcion(cuerpo if isinstance(cuerpo, dict) else {})
            ok, texto = True, res.get("mensaje", "Hecho.")
            # Fase 13: lo que la app debe decir (puente_pc) va tambien en la respuesta
            extra = {k: res[k] for k in ("decir", "codigo", "resultados") if res.get(k)}
        except P.ErrorPanel as e:
            ok, texto, extra = False, str(e), {}
        except Exception as e:
            S.log("nube: ERROR en la orden %s: %s: %s" % (o.get("ruta"), type(e).__name__, e))
            ok, texto, extra = False, "Algo falló en el servidor.", {}
        try:
            _responder(id_, uid, ok, texto, **extra)
            _db("DELETE", "pixeles/%s/ordenes/%s" % (_pid(), id_))
        except Exception as e:
            S.log("nube: no pude responder una orden: %s" % e)


def _publicar_voz():
    """Hilo: en cuanto Pixel habla, publica el volumen de su voz (si alguien tiene la app abierta)."""
    while True:
        _hay_voz.wait()
        _hay_voz.clear()
        if not _estado["duenos"] or time.monotonic() > _mirando["hasta"]:
            continue
        try:
            _db("PUT", "pixeles/%s/voz" % _pid(), {"json": json.dumps(P.voz()["segmentos"])})
        except Exception as e:
            _estado["error"] = str(e)[:200]


# ------------------------------------------------------------------ el celular como ESP32 remoto (Fase 11)

def _al_frase(id_, f):
    """Del streaming de frases/: solo encola, para no frenar la lectura."""
    if isinstance(f, dict) and id_ not in _frases_vistas:
        if len(_frases_vistas) > 2000:
            _frases_vistas.clear()
        _frases_vistas.add(id_)
        _frases.put((id_, f))


def _movil(uid):
    with S._sesiones_lock:
        sesion = S.MOVILES.get(uid)
        if sesion is None:
            escribir = lambda tipo, pcm=None, dime=False, **extra: _habla.put((uid, tipo, pcm, dime, extra))
            sesion = S.MOVILES[uid] = S.SesionMovil(uid, escribir)
            nueva = True
        else:
            nueva = False
    if nueva:
        S.log("nube: sesion %s para el celular de %s (%s)" % (sesion.peer, _app(uid), uid))
    return sesion


def _app(uid):
    return (_estado["duenos"].get(uid) or {}).get("nombre") or "App"


def _al_escuchando(uid, t):
    """Latido de "Escuchar" (o su borrado al parar o al cerrar la app)."""
    if uid not in _estado["duenos"]:
        return
    if isinstance(t, (int, float)) and (_ahora_ms() + _reloj["offset"] - t) / 1000.0 < ESCUCHA_S:
        sesion = _movil(uid)
        if not sesion.escuchando():
            sesion.escucha_desde = time.monotonic()
            S.log("nube: el celular de %s escucha (%s)" % (_app(uid), sesion.peer))
        sesion.escucha_hasta = time.monotonic() + ESCUCHA_S
        return
    with S._sesiones_lock:
        sesion = S.MOVILES.get(uid)
    if sesion is not None and sesion.escuchando():
        sesion.escucha_hasta = 0.0
        S.log("nube: el celular de %s deja de escuchar (%s)" % (_app(uid), sesion.peer))


def celulares():
    """Para el panel: las apps enlazadas como celulares de Pixel, escuchen o no."""
    lista = []
    for uid, d in sorted(_estado["duenos"].items(), key=lambda x: x[1].get("desde") or 0):
        with S._sesiones_lock:
            s = S.MOVILES.get(uid)
        oye = bool(s and s.escuchando())
        lista.append({"uid": uid, "nombre": "Celular de %s" % (d.get("nombre") or "App"), "escuchando": oye,
                      "estado": ("hablando" if s.fin_reproduccion > time.monotonic() else "escuchando") if oye else "sin escuchar",
                      "frases": s.n_frases if s else 0, "ultimo": s.ultimo_texto if s else ""})
    return lista


def _atender_frases():
    """Hilo: cada frase del celular se borra de la nube y va a la sesion de su uid."""
    while True:
        id_, f = _frases.get()
        try:
            _db("DELETE", "pixeles/%s/frases/%s" % (_pid(), id_))
        except Exception as e:
            S.log("nube: no pude borrar una frase del celular: %s" % e)
        uid = str(f.get("uid") or "")
        t = f.get("t")
        if uid not in _estado["duenos"]:
            S.log("nube: frase de una app que no esta enlazada (%s): la tiro" % uid)
            continue
        espera = (_ahora_ms() + _reloj["offset"] - t) / 1000.0 if isinstance(t, (int, float)) else 0.0
        if espera > MOVIL_VIEJA_S:
            S.log("nube: frase del celular de hace %.0f s (Pixel no estaba): la tiro" % espera)
            continue
        try:
            pcm = base64.b64decode(str(f.get("pcm") or ""), validate=True)
        except (ValueError, binascii.Error):
            S.log("nube: frase del celular ilegible: la tiro")
            continue
        pcm = pcm[:len(pcm) // 2 * 2]
        dur = len(pcm) / float(S.SAMPLE_RATE * S.SAMPLE_WIDTH)
        if not S.MIN_PHRASE_MS / 1000.0 <= dur <= MOVIL_MAX_S:
            S.log("nube: frase del celular de %.1f s: la tiro" % dur)
            continue
        try:
            _movil(uid).alimentar_frase(pcm)
        except Exception as e:
            S.log("nube: ERROR con una frase del celular: %s: %s" % (type(e).__name__, e))


def _escribir_habla():
    """Hilo: la voz para cada celular, en orden. Las claves (milisegundos) siempre crecen."""
    while True:
        uid, tipo, pcm, dime, extra = _habla.get()
        clave = max(_ahora_ms(), _ultima_clave[0] + 1)
        _ultima_clave[0] = clave
        datos = dict(extra, tipo=tipo)
        if pcm:
            datos["pcm"] = base64.b64encode(pcm).decode("ascii")
        if dime:
            datos["dime"] = True
        try:
            _db("PUT", "pixeles/%s/habla/%s/%013d" % (_pid(), uid, clave), datos)
            _hablas.append((time.monotonic(), uid, clave))
        except Exception as e:
            S.log("nube: no pude dejar la voz para el celular: %s" % e)


def _limpiar_moviles(ahora):
    """Desde _publicar: borra la voz vieja y cierra las sesiones de celular que ya no hablan."""
    while _hablas and ahora - _hablas[0][0] > HABLA_S:
        _, uid, clave = _hablas.pop(0)
        _db("DELETE", "pixeles/%s/habla/%s/%013d" % (_pid(), uid, clave))
    with S._sesiones_lock:
        cerrar = [(uid, s) for uid, s in S.MOVILES.items() if uid not in _estado["duenos"] or (
            not s.escuchando() and ahora - s.ultimo_audio > MOVIL_INACTIVO_S and s.cola.empty())]
        for uid, _ in cerrar:
            del S.MOVILES[uid]
    for _, sesion in cerrar:
        threading.Thread(target=sesion.cerrar, daemon=True).start()


def _publicar():
    """Hilo: latido, estado (deprisa si alguien tiene la app abierta) y limpieza de respuestas."""
    hecho = {"estado": -1e9, "vivo": -1e9, "mirar": -1e9}
    anterior = None
    while True:
        try:
            ahora = time.monotonic()
            enlace = _estado["enlace"]
            if not _estado["duenos"] and (enlace is None or enlace["hasta"] - ahora < 60):
                abrir_enlace(ENLACE_SIN_DUENO_S)
            elif enlace is not None and ahora > enlace["hasta"]:
                cerrar_enlace()
            if ahora - hecho["mirar"] > 5:
                hecho["mirar"] = ahora
                latidos = _db("GET", "pixeles/%s/mirando" % _pid()) or {}
                if any(isinstance(t, (int, float)) and t > _ahora_ms() - MIRANDO_S * 1000 for t in latidos.values()):
                    _mirando["hasta"] = ahora + 10
            cada = RAPIDO_S if ahora < _mirando["hasta"] else LENTO_S
            if _estado["duenos"] and ahora - hecho["estado"] > cada:
                e = P.estado()
                e["nube"] = dict(e["nube"], enlace=None)       # el codigo no sale del PC
                texto = json.dumps(e, ensure_ascii=False, sort_keys=True)
                if texto != anterior or ahora - hecho["estado"] > LENTO_S:
                    _db("PUT", "pixeles/%s/estado" % _pid(), {"json": texto, "t": SV})
                    anterior = texto
                hecho["estado"] = ahora
            if ahora - hecho["vivo"] > VIVO_S:
                t_nube = _db("PUT", "pixeles/%s/vivo" % _pid(), SV)    # devuelve la hora de Firebase
                if isinstance(t_nube, (int, float)):
                    _reloj["offset"] = t_nube - _ahora_ms()
                hecho["vivo"] = ahora
            while _respuestas and ahora - _respuestas[0][0] > RESPUESTA_S:
                _, clave = _respuestas.pop(0)
                _db("DELETE", "pixeles/%s/respuestas/%s" % (_pid(), clave))
            _limpiar_moviles(ahora)
            if not _estado["conectada"]:
                S.log("nube: conectada como %s (%s), %d app(s) enlazada(s)" % (nombre(), _pid(), len(_estado["duenos"])))
            _estado.update(conectada=True, error="")
        except Exception as e:
            if _estado["conectada"] or _estado["error"] != str(e)[:200]:
                S.log("nube: sin conexion: %s" % e)
            _estado.update(conectada=False, error=str(e)[:200])
            time.sleep(10)
        time.sleep(0.5)


def iniciar(modulo_servidor, modulo_panel):
    """Conecta con Firebase en un hilo (sin internet reintenta solo) y arranca la escucha."""
    global S, P
    S, P = modulo_servidor, modulo_panel
    _estado["activa"] = True
    P.RUTAS_POST.update({"/api/nube/enlazar": _ruta_enlazar, "/api/nube/decir": _ruta_decir, "/api/nube/quitar": quitar})

    def arrancar():
        while True:
            try:
                _entrar()
                _estado["duenos"] = _db("GET", "pixeles/%s/duenos" % _pid()) or {}
                break
            except Exception as e:
                _estado.update(conectada=False, error=str(e)[:200])
                S.log("nube: no pude entrar en Firebase: %s (reintento en 30 s)" % e)
                time.sleep(30)
        S.AL_HABLAR = _hay_voz.set
        for objetivo, args in ((_publicar, ()), (_trabajar, ()), (_publicar_voz, ()),
                               (_atender_frases, ()), (_escribir_habla, ()),
                               (_escuchar, ("pixeles/%s/ordenes" % _pid(), _al_orden)),
                               (_escuchar, ("pixeles/%s/solicitudes" % _pid(), _al_solicitud)),
                               (_escuchar, ("pixeles/%s/frases" % _pid(), _al_frase)),
                               (_escuchar, ("pixeles/%s/escuchando" % _pid(), _al_escuchando))):
            threading.Thread(target=objetivo, args=args, daemon=True).start()

    threading.Thread(target=arrancar, daemon=True).start()

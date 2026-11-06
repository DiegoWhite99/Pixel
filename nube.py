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
    usuarios/<uid>/pixeles/<pid>     {nombre, desde}: los Pixel de cada app
"""

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
        if _auth["id"] and time.monotonic() < _auth["vence"]:
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
        _auth.update(uid=uid, id=token, refresh=refresh, vence=time.monotonic() + dura - 300)
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
    """Pixel dice el codigo por su altavoz. False si no hay ningun ESP32 conectado para decirlo."""
    enlace = _estado["enlace"]
    if enlace is None:
        return False
    with S._sesiones_lock:
        sesion = S.SESIONES[-1] if S.SESIONES else None
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
        with S._sesiones_lock:
            sesion = S.SESIONES[-1] if S.SESIONES else None
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
                    if time.monotonic() > _auth["vence"]:
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
        except P.ErrorPanel as e:
            ok, texto = False, str(e)
        except Exception as e:
            S.log("nube: ERROR en la orden %s: %s: %s" % (o.get("ruta"), type(e).__name__, e))
            ok, texto = False, "Algo falló en el servidor."
        try:
            _responder(id_, uid, ok, texto)
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
                _db("PUT", "pixeles/%s/vivo" % _pid(), SV)
                hecho["vivo"] = ahora
            while _respuestas and ahora - _respuestas[0][0] > RESPUESTA_S:
                _, clave = _respuestas.pop(0)
                _db("DELETE", "pixeles/%s/respuestas/%s" % (_pid(), clave))
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
                               (_escuchar, ("pixeles/%s/ordenes" % _pid(), _al_orden)),
                               (_escuchar, ("pixeles/%s/solicitudes" % _pid(), _al_solicitud))):
            threading.Thread(target=objetivo, args=args, daemon=True).start()

    threading.Thread(target=arrancar, daemon=True).start()

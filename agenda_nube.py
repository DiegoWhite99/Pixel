"""2.4.3 - Recordatorios: una sola lista para la app, el PC y el robot.

El usuario (13 nov): "la ESP32 no esta mandando los recordatorios ni nada" y "deben ser iguales". Antes la app
guardaba los suyos en usuarios/<uid>/recordatorios (Firebase) y el PC en recordatorios.json: el robot nunca decia
los de la app y la app no veia los que se pedian al robot.

AgendaNube tiene la misma forma que recordatorios.Agenda (pendientes, agregar, borrar, vencidos, ruta), asi que
acciones.py, panel.py y vigilar_recordatorios() no cambian. Con la nube conectada y cuentas enlazadas, los
recordatorios van a la lista de cada cuenta (la de la app); sin ellas, al JSON local, como antes.
  - Ids: los de la nube son "<uid>/<clave>" (texto); los locales, numeros.
  - Se dice una sola vez: como la app (revisarRecordatorios en web/agente.js), quien lo va a decir lo borra
    primero, con un borrado condicional (ETag): si otro lo borro antes, no se dice.
  - La lista se lee como mucho cada REFRESCAR_S (el panel la pide a cada rato).
  - Lo que quedaba en el JSON local pasa a la nube la primera vez que hay cuentas.
Las reglas (database.rules.json) dejan leer y escribir esa lista al PC o robot que esta en usuarios/<uid>/pixeles.
"""
import json
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime

REFRESCAR_S = 15.0
TEXTO_MAX = 200                 # lo que aceptan las reglas


def _ms(dt):
    return int(dt.timestamp() * 1000)


def _iso(ms):
    return datetime.fromtimestamp(ms / 1000.0).isoformat(timespec="seconds")


def _valido(r):
    return isinstance(r, dict) and isinstance(r.get("texto"), str) and isinstance(r.get("cuando"), (int, float))


class AgendaNube:
    def __init__(self, local, nube, log=print):
        self.local = local
        self.nube = nube
        self.log = log
        self.ruta = local.ruta
        self._lock = threading.RLock()
        self._cache = {}            # uid -> {clave: {"texto", "cuando" (ms), "creado"}}
        self._leido = 0.0
        self._migrado = False

    # -- nube ------------------------------------------------------------------

    def _duenos(self):
        e = self.nube._estado
        if not (e.get("activa") and e.get("conectada")):
            return []
        return sorted(e.get("duenos") or {})

    def _refrescar(self, forzar=False):
        duenos = self._duenos()
        if not duenos:
            self._cache = {}
            return []
        if forzar or time.monotonic() - self._leido >= REFRESCAR_S or set(self._cache) != set(duenos):
            cache = {}
            for uid in duenos:
                try:
                    v = self.nube._db("GET", "usuarios/%s/recordatorios" % uid) or {}
                    cache[uid] = {k: r for k, r in v.items() if _valido(r)} if isinstance(v, dict) else {}
                except Exception as e:
                    self.log("recordatorios: no pude leer los de la cuenta %s… (%s)" % (uid[:6], e))
                    cache[uid] = self._cache.get(uid, {})
            self._cache = cache
            self._leido = time.monotonic()
            self._migrar(duenos)
        return duenos

    def _migrar(self, duenos):
        """Una vez: lo que habia en el JSON local pasa a la lista de las cuentas (que la app lo vea)."""
        if self._migrado:
            return
        self._migrado = True
        viejos = self.local.pendientes()
        for r in viejos:
            if self._a_la_nube(duenos, r["texto"], datetime.fromisoformat(r["cuando"])):
                self.local.borrar({r["id"]})
        if viejos:
            self.log("recordatorios: %d del PC pasaron a la lista de la app" % len(viejos))

    def _a_la_nube(self, duenos, texto, cuando):
        primero = None
        datos = {"texto": texto[:TEXTO_MAX], "cuando": _ms(cuando), "creado": int(time.time() * 1000)}
        for uid in duenos:
            try:
                r = self.nube._db("POST", "usuarios/%s/recordatorios" % uid, datos)
                clave = (r or {}).get("name")
                if clave:
                    self._cache.setdefault(uid, {})[clave] = dict(datos)
                    primero = primero or self._item(uid, clave, datos)
            except Exception as e:
                self.log("recordatorios: no pude guardar en la cuenta %s… (%s)" % (uid[:6], e))
        return primero

    def _item(self, uid, clave, r):
        return {"id": "%s/%s" % (uid, clave), "texto": r["texto"], "cuando": _iso(r["cuando"]),
                "creado": _iso(r["creado"]) if isinstance(r.get("creado"), (int, float)) else ""}

    def _reclamar(self, uid, clave):
        """Lo borra solo si sigue como estaba (ETag): True si este PC lo dice; False si otro lo dijo antes."""
        url = self.nube._url("usuarios/%s/recordatorios/%s" % (uid, clave))
        with urllib.request.urlopen(urllib.request.Request(url, headers={"X-Firebase-ETag": "true"}), timeout=10) as r:
            etag = r.headers.get("ETag")
            if json.loads(r.read() or b"null") is None:
                return False
        try:
            with urllib.request.urlopen(urllib.request.Request(url, method="DELETE", headers={"if-match": etag}),
                                        timeout=10):
                return True
        except urllib.error.HTTPError as e:
            if e.code == 412:           # cambio o lo borro otro entre medias
                return False
            raise

    # -- lo que usan acciones.py, panel.py y servidor.vigilar_recordatorios ----

    def pendientes(self):
        with self._lock:
            self._refrescar()
            nube = [self._item(uid, k, r) for uid, xs in self._cache.items() for k, r in xs.items()]
            return sorted(nube + self.local.pendientes(), key=lambda r: r["cuando"])

    def agregar(self, texto, cuando):
        with self._lock:
            duenos = self._refrescar()
            if duenos:
                r = self._a_la_nube(duenos, texto, cuando)
                if r:
                    return r
            return self.local.agregar(texto, cuando)

    def borrar(self, ids):
        with self._lock:
            locales = {i for i in ids if not isinstance(i, str)}
            borrados = self.local.borrar(locales) if locales else []
            for i in ids:
                if not isinstance(i, str) or "/" not in i:
                    continue
                uid, clave = i.split("/", 1)
                r = self._cache.get(uid, {}).get(clave)
                try:
                    self.nube._db("DELETE", "usuarios/%s/recordatorios/%s" % (uid, clave))
                except Exception as e:
                    self.log("recordatorios: no pude borrar %s (%s)" % (i, e))
                    continue
                if r is not None:
                    self._cache[uid].pop(clave, None)
                    borrados.append(self._item(uid, clave, r))
            return borrados

    def vencidos(self, ahora):
        ya = list(self.local.vencidos(ahora))
        with self._lock:
            self._refrescar()
            limite = _ms(ahora)
            for uid, xs in list(self._cache.items()):
                for clave, r in sorted(xs.items(), key=lambda kv: kv[1]["cuando"]):
                    if r["cuando"] > limite:
                        continue
                    xs.pop(clave, None)
                    try:
                        if self._reclamar(uid, clave):
                            ya.append(self._item(uid, clave, r))
                    except Exception as e:     # vuelve con la siguiente lectura (cada REFRESCAR_S), sin repetir el aviso cada segundo
                        self.log("recordatorios: no pude marcar %s/%s (%s)" % (uid[:6], clave, e))
        return sorted(ya, key=lambda r: r["cuando"])

"""2.4.3: los recordatorios del PC (y del robot) son los de la app: usuarios/<uid>/recordatorios."""
from datetime import datetime, timedelta

import agenda_nube
import recordatorios


class _NubeFalsa:
    def __init__(self, duenos=("U1",), conectada=True):
        self._estado = {"activa": True, "conectada": conectada, "duenos": {u: {} for u in duenos}}
        self.datos = {}             # ruta -> valor
        self.lecturas = 0
        self._n = 0

    def _db(self, metodo, ruta, datos=None):
        if metodo == "GET":
            self.lecturas += 1
            pre = ruta + "/"
            return {k[len(pre):]: v for k, v in self.datos.items() if k.startswith(pre)} or None
        if metodo == "POST":
            self._n += 1
            clave = "-K%03d" % self._n
            self.datos["%s/%s" % (ruta, clave)] = dict(datos)
            return {"name": clave}
        if metodo == "DELETE":
            self.datos.pop(ruta, None)
            return None
        raise AssertionError(metodo)


def _agenda(tmp_path, nube, monkeypatch):
    a = agenda_nube.AgendaNube(recordatorios.Agenda(str(tmp_path / "r.json")), nube, log=lambda *x: None)

    def reclamar(uid, clave):        # el borrado condicional: solo el primero que llega lo dice
        ruta = "usuarios/%s/recordatorios/%s" % (uid, clave)
        return nube.datos.pop(ruta, None) is not None
    monkeypatch.setattr(a, "_reclamar", reclamar)
    return a


def test_lo_que_se_pide_al_robot_va_a_la_lista_de_la_app(tmp_path, monkeypatch):
    nube = _NubeFalsa()
    a = _agenda(tmp_path, nube, monkeypatch)
    cuando = datetime.now() + timedelta(hours=1)
    r = a.agregar("pagar la luz", cuando)
    assert r["id"].startswith("U1/") and r["texto"] == "pagar la luz"
    (ruta, guardado), = nube.datos.items()
    assert ruta.startswith("usuarios/U1/recordatorios/")
    assert guardado["cuando"] == int(cuando.timestamp() * 1000) and isinstance(guardado["creado"], int)
    assert a.local.pendientes() == []
    assert [x["texto"] for x in a.pendientes()] == ["pagar la luz"]


def test_los_de_la_app_los_dice_el_robot_una_sola_vez(tmp_path, monkeypatch):
    nube = _NubeFalsa()
    ya = int((datetime.now() - timedelta(seconds=5)).timestamp() * 1000)
    nube.datos["usuarios/U1/recordatorios/-app1"] = {"texto": "llamar a mamá", "cuando": ya, "creado": ya}
    a = _agenda(tmp_path, nube, monkeypatch)
    dichos = a.vencidos(datetime.now())
    assert [d["texto"] for d in dichos] == ["llamar a mamá"]
    assert a.vencidos(datetime.now()) == []          # no se repite
    assert nube.datos == {}                            # borrado de la nube: la app ya no lo dice


def test_si_la_app_lo_dijo_antes_el_robot_no_lo_repite(tmp_path, monkeypatch):
    nube = _NubeFalsa()
    ya = int((datetime.now() - timedelta(seconds=5)).timestamp() * 1000)
    nube.datos["usuarios/U1/recordatorios/-app1"] = {"texto": "agua", "cuando": ya}
    a = _agenda(tmp_path, nube, monkeypatch)
    a.pendientes()                                     # ya lo tiene leido
    nube.datos.clear()                                 # la app lo dijo (y lo borro) entre medias
    assert a.vencidos(datetime.now()) == []


def test_los_del_pc_pasan_a_la_app_y_se_borran(tmp_path, monkeypatch):
    nube = _NubeFalsa()
    a = _agenda(tmp_path, nube, monkeypatch)
    a.local.agregar("viejo del PC", datetime.now() + timedelta(hours=2))
    assert [x["texto"] for x in a.pendientes()] == ["viejo del PC"]
    assert a.local.pendientes() == []
    rid = a.pendientes()[0]["id"]
    assert [x["texto"] for x in a.borrar({rid})] == ["viejo del PC"]
    assert nube.datos == {} and a.pendientes() == []


def test_sin_cuentas_es_como_antes(tmp_path, monkeypatch):
    nube = _NubeFalsa(duenos=())
    a = _agenda(tmp_path, nube, monkeypatch)
    r = a.agregar("local", datetime.now() + timedelta(minutes=1))
    assert isinstance(r["id"], int) and nube.datos == {}
    assert [x["texto"] for x in a.vencidos(datetime.now() + timedelta(minutes=2))] == ["local"]


def test_no_lee_la_nube_a_cada_rato(tmp_path, monkeypatch):
    nube = _NubeFalsa()
    a = _agenda(tmp_path, nube, monkeypatch)
    for _ in range(20):
        a.pendientes()
        a.vencidos(datetime.now())
    assert nube.lecturas == 1

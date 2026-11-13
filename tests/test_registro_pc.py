"""Registro de acciones del PC (servidor.registrar y nube.registrar, 2.1.0): se anota lo hecho, despues
de hacerlo; el correo solo tras el "si, envialo". Sin red: la nube solo encola."""
import nube
import servidor


class _TtsMudo:
    def sintetizar(self, texto):
        return b""


def _sesion(monkeypatch, anotado, clase=servidor.Sesion):
    monkeypatch.setattr(servidor, "AL_REGISTRAR", lambda *a: anotado.append(a))
    monkeypatch.setattr(servidor, "TTS", _TtsMudo())
    s = clase.__new__(clase)                 # sin socket ni hilos: solo lo que usan _accion y _confirmar
    s.peer, s.pendiente, s.fin_reproduccion = "prueba", None, 0.0
    s.fin_respuesta = lambda cierre=True: None
    s.debug = lambda texto: None
    return s


def test_accion_hecha_se_anota_y_las_de_mirar_no(monkeypatch):
    anotado = []
    s = _sesion(monkeypatch, anotado)
    s._accion(("crear_evento", {}, lambda p: {"ok": True, "decir": "Listo, agendé la cita.", "log": {}}))
    s._accion(("ver_calendario", {}, lambda p: {"ok": True, "decir": "Mañana no tienes nada.", "log": {}}))
    s._accion(("recordatorio", {}, lambda p: {"ok": False, "decir": "No entendí para cuándo.", "log": {}}))
    assert anotado == [("crear_evento", "Listo, agendé la cita.", "por voz, desde el ESP32")]


def test_correo_solo_al_confirmar(monkeypatch):
    anotado = []
    s = _sesion(monkeypatch, anotado)
    confirmar = {"que": "correo a Ana Prueba <ana@example.com>: hola", "ejecutar": lambda: "Listo, correo enviado a Ana Prueba.",
                 "cancelado": "De acuerdo, no envío el correo.", "caducado": "No me confirmaste."}
    borrador = {"ok": True, "decir": "Borrador para Ana Prueba. ¿Lo envío?", "log": {}, "confirmar": confirmar}
    s._accion(("correo", {}, lambda p: borrador))
    assert anotado == [] and s.pendiente is not None          # el borrador no se anota
    s._confirmar("no, espera")
    assert anotado == []                                      # cancelado: nada
    s._accion(("correo", {}, lambda p: borrador))
    s._confirmar("sí, envíalo")
    assert anotado == [("correo", "Listo, correo enviado a Ana Prueba.", "correo a Ana Prueba <ana@example.com>: hola · por voz, desde el ESP32")]


def test_desde_el_celular(monkeypatch):
    anotado = []
    s = _sesion(monkeypatch, anotado, servidor.SesionMovil)
    s.escribir = lambda *a, **k: None
    s.dime = False
    s._abrir_video = lambda vid, titulo: None
    s._accion(("youtube", {}, lambda p: {"ok": True, "decir": "Te pongo Queen.", "log": {}}))
    assert anotado == [("youtube", "Te pongo Queen.", "por voz, desde el celular")]


def test_un_fallo_del_registro_no_rompe_el_turno(monkeypatch):
    monkeypatch.setattr(servidor, "AL_REGISTRAR", lambda *a: 1 / 0)
    servidor.registrar("correo", "x")                         # no lanza


def test_la_entrada_de_la_nube_cumple_las_reglas():
    while not nube._registro.empty():
        nube._registro.get_nowait()
    nube.registrar("correo", "x" * 300, "")
    nube.registrar("crear_evento", "Listo", "d" * 600)
    a, b = nube._registro.get_nowait(), nube._registro.get_nowait()
    assert a == {"t": {".sv": "timestamp"}, "tipo": "correo", "texto": "x" * 200, "aparato": "PC"}   # sin detalle vacio
    assert len(b["detalle"]) == 500 and b["tipo"] == "crear_evento"

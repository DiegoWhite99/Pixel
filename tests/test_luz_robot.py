"""17 nov: la luz del robot. Pedido: "azul es WiFi, verde si todo esta bien conectado, rojo si hay un error y amarillo
si no hay API". El PC le dice al robot si hay una IA de internet que le conteste (Ollama no es una API).

Con IAs simuladas: no gasta cupo de Gemini ni de Groq.
"""
import pytest

import llm
import servidor


class IaFalsa:
    """Hace de gemini.py o groq_ia.py: mismo NOMBRE, Error, activo, hay_clave, generar_stream y LOG."""

    class Error(Exception):
        pass

    def __init__(self, nombre, contesta=True, clave=True, en_pausa=False):
        self.NOMBRE = nombre
        self.contesta, self.clave, self.en_pausa = contesta, clave, en_pausa
        self.LOG = lambda texto: None

    def hay_clave(self):
        return self.clave

    def activo(self):
        return self.clave and not self.en_pausa

    def generar_stream(self, system, mensajes):
        if not self.contesta:
            raise self.Error("HTTP 401: clave no valida")
        yield "Hola, "
        yield "soy Píxel."


@pytest.fixture(autouse=True)
def sin_resultados(monkeypatch):
    monkeypatch.setattr(llm, "_resultado", {})


def test_hay_api_si_alguna_ia_de_internet_puede_contestar(monkeypatch):
    monkeypatch.setattr(llm, "PROVEEDORES", (IaFalsa("gemini", en_pausa=True), IaFalsa("groq")))
    assert llm.hay_api()
    monkeypatch.setattr(llm, "PROVEEDORES", (IaFalsa("gemini", clave=False), IaFalsa("groq", en_pausa=True)))
    assert not llm.hay_api()


def test_si_falla_la_preferida_pero_contesta_la_otra_si_hay_api(monkeypatch):
    monkeypatch.setattr(llm, "PROVEEDORES", (IaFalsa("gemini", contesta=False), IaFalsa("groq")))
    monkeypatch.setattr(llm, "PREFERIDA", "gemini")
    m = llm.Llm()
    assert "".join(m.responder("hola")) == "Hola, soy Píxel."
    assert m.motor == "groq"                        # el servidor manda "estado:con_api"


def test_el_robot_recibe_el_estado_como_debug():
    dichos = []

    class SesionFalsa:
        def debug(self, texto):
            dichos.append(texto)

    servidor.Sesion.avisar_estado_api(SesionFalsa(), True)
    servidor.Sesion.avisar_estado_api(SesionFalsa(), False)
    assert dichos == ["estado:con_api", "estado:sin_api"]


def test_una_clave_rechazada_sin_pausa_ya_no_cuenta_como_api(monkeypatch):
    """Google rechaza la clave (401) y no pone a Gemini en pausa: igual el robot debe saber que no hay API."""
    monkeypatch.setattr(llm, "PROVEEDORES", (IaFalsa("gemini", contesta=False),))
    monkeypatch.setattr(llm, "PREFERIDA", "gemini")
    monkeypatch.setattr(llm.Llm, "_ollama", lambda self, texto: iter(["respaldo"]))
    assert llm.hay_api()                                    # aun no se sabe
    "".join(llm.Llm().responder("hola"))
    assert not llm.hay_api()                                # fallo: amarillo
    llm.anotar("gemini", True)                              # la prueba del panel contesto
    assert llm.hay_api()                                    # ya hay API: puede pasar a verde


def test_a_cada_robot_se_le_avisa_solo_cuando_cambia(monkeypatch):
    class RobotFalso:
        api_enviada = None
        peer = "robot"

        def __init__(self):
            self.dichos = []

        def avisar_estado_api(self, hay):
            self.api_enviada = hay
            self.dichos.append(hay)

    robot = RobotFalso()
    monkeypatch.setattr(servidor, "SESIONES", [robot])
    monkeypatch.setattr(servidor, "log", lambda texto: None)
    hay = {"v": True}
    monkeypatch.setattr(llm, "hay_api", lambda: hay["v"])
    servidor.avisar_api_a_robots()
    servidor.avisar_api_a_robots()
    hay["v"] = False
    servidor.avisar_api_a_robots()
    hay["v"] = True
    servidor.avisar_api_a_robots()
    assert robot.dichos == [True, False, True]

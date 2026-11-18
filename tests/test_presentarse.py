"""18 nov - "Que Pixel se presente otra vez" de la app suena por donde habla Pixel (pedido: "si ya habia seleccionado que
la salida de audio salga por el robot, debe ser por ahi, no por el PC"). El panel recibe la orden /api/presentarse con
el texto que arma la app (perfil.js, presentacion()) y la deja en la cola del robot; el robot la dice frase por frase."""
import queue
from types import SimpleNamespace

import pytest

import panel
import servidor

FRASE = ("¡Hola, Ana! Soy Píxel, un agente de inteligencia artificial creado por Divergencia IA. Soy un híbrido: "
         "un asistente de voz con inteligencia artificial. Te invito a entrar a tu perfil.")


@pytest.fixture
def robot(monkeypatch):
    r = SimpleNamespace(cola=queue.Queue())
    monkeypatch.setattr(panel, "S", servidor)
    monkeypatch.setattr(servidor, "SESIONES", [r])
    monkeypatch.setattr(panel, "AJUSTES", dict(panel.AJUSTES, salida_voz="esp32"))
    return r


def test_la_orden_la_puede_mandar_la_app():
    assert "/api/presentarse" in panel.RUTAS_POST                 # por la nube, solo de las cuentas duenas
    assert "/api/presentarse" not in panel.RUTAS_SOLO_LOCAL


def test_va_a_la_cola_del_robot(robot, monkeypatch):
    assert panel.presentarse({"texto": FRASE})["mensaje"] == "Píxel se presenta por el robot."
    assert robot.cola.get_nowait() == ("presentar", FRASE)
    monkeypatch.setattr(panel, "AJUSTES", dict(panel.AJUSTES, salida_voz="pc"))
    assert "altavoces del PC" in panel.presentarse({"texto": FRASE})["mensaje"]


@pytest.mark.parametrize("texto", ["Abre la puerta", "", None, FRASE + "x" * 2000])
def test_solo_la_presentacion(robot, texto):
    with pytest.raises(panel.ErrorPanel):
        panel.presentarse({"texto": texto})
    assert robot.cola.empty()


def test_sin_robot(robot, monkeypatch):
    monkeypatch.setattr(servidor, "SESIONES", [])
    with pytest.raises(panel.ErrorPanel):
        panel.presentarse({"texto": FRASE})


def test_frase_por_frase_con_un_solo_cierre(monkeypatch):
    dichas, enviado, cierres = [], [], []
    monkeypatch.setattr(servidor, "TTS", SimpleNamespace(sintetizar=lambda f: dichas.append(f) or b"\0\0"))
    s = SimpleNamespace(enviar_audio=enviado.append, fin_respuesta=lambda cierre=True: cierres.append(cierre),
                        debug=lambda t: None)
    servidor.Sesion._decir_frases(s, FRASE)
    assert len(dichas) == 4 and dichas[0] == "¡Hola, Ana!" and dichas[-1] == "Te invito a entrar a tu perfil."
    assert len(enviado) == 4 and cierres == [True]

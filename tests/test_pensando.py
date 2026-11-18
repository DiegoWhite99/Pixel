"""18 nov - Pixel pensando, a la vez en todos lados (pedidos: "cuando este pensando me gustaria que el led se ponga de
muchos colores" y "el Pixel animado debe ir en reaccion simultanea al Pixel de la web"): el robot recibe
"estado:pensando" / "estado:listo" (su luz en arcoiris, firmware), y /api/voz (la ventana) y la nube (la app) dicen
"pensando" para que las caras pongan cara de pensar."""
from types import SimpleNamespace

import panel
import servidor


def sesion(clase=servidor.Sesion):
    mandados = []
    s = SimpleNamespace(LUZ_PENSANDO=clase.LUZ_PENSANDO, debug=mandados.append)
    return s, mandados


def test_al_robot_una_vez_por_cambio(monkeypatch):
    avisos = []
    monkeypatch.setattr(servidor, "AL_HABLAR", lambda: avisos.append(1))
    s, mandados = sesion()
    for si in (True, True, False, False, True):
        servidor.Sesion._avisar_pensando(s, si)
    assert mandados == ["estado:pensando", "estado:listo", "estado:pensando"]
    assert len(avisos) == 3                     # la nube publica cada cambio (la cara de la app)


def test_al_celular_no(monkeypatch):
    monkeypatch.setattr(servidor, "AL_HABLAR", None)
    s, mandados = sesion(servidor.SesionMovil)
    servidor.Sesion._avisar_pensando(s, True)
    assert mandados == []


def test_api_voz_dice_si_piensa(monkeypatch):
    monkeypatch.setattr(panel, "S", servidor)
    robot = SimpleNamespace(voz=[], _luz_pensando=True)
    monkeypatch.setattr(servidor, "SESIONES", [robot])
    assert panel.voz()["pensando"] is True
    robot._luz_pensando = False
    assert panel.voz()["pensando"] is False
    monkeypatch.setattr(servidor, "SESIONES", [])
    assert panel.voz() == {"ahora": panel.voz()["ahora"], "segmentos": [], "pensando": False}

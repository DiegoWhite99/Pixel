"""18 nov - Contesta uno solo (pedido: "si le doy al robot, el de la web no tiene por que hablar, y viceversa").

En la ventana, Voz -> Por donde habla: el robot o este computador (contesta "pc") o la app de internet ("app").
Aqui: la regla del servidor (callado_por_ajuste), que el panel lo guarda sin tocar la salida de voz, y que lo que
manda la app o el espejo (sin el campo) no lo cambia. La parte de la app esta en tools/prueba_modulos.js.
"""
import json

import pytest

import panel
import servidor


@pytest.fixture
def pc(tmp_path, monkeypatch):
    monkeypatch.setattr(panel, "S", servidor)
    monkeypatch.setattr(servidor, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(panel, "AJUSTES", dict(panel.AJUSTES, t=0, ia_t={}))
    monkeypatch.setattr(panel, "aplicar_ajustes", lambda: None)
    return tmp_path


def _guardado(carpeta):
    return json.load(open(carpeta / servidor.AJUSTES_ARCHIVO, encoding="utf-8"))


BASE = {"voz": "st-F4", "respuesta": "normal", "tono": "normal", "personalidad": ""}


@pytest.mark.parametrize("contesta, es_movil, hay_robot, callado", [
    ("pc", False, True, ""),                       # el robot contesta
    ("pc", True, True, "contesta el robot"),       # el celular como microfono del PC se calla
    ("pc", True, False, ""),                       # sin robot conectado, el celular si
    ("app", False, True, "contesta la app de internet"),   # el robot se calla
    ("app", True, True, ""),                       # el celular (la app) contesta
    ("app", True, False, ""),
])
def test_regla_del_servidor(monkeypatch, contesta, es_movil, hay_robot, callado):
    monkeypatch.setattr(servidor, "CONTESTA", contesta)
    assert servidor.callado_por_ajuste(es_movil, hay_robot) == callado


def test_por_defecto_contesta_el_pc():
    assert panel.AJUSTES["contesta"] == "pc"
    assert servidor.CONTESTA == "pc"


def test_la_ventana_elige_la_app_sin_tocar_la_salida(pc):
    panel.guardar_agente(dict(BASE, salida_voz="pc", contesta="app"))
    g = _guardado(pc)
    assert g["contesta"] == "app" and g["salida_voz"] == "pc"
    panel.guardar_agente(dict(BASE, salida_voz="esp32", contesta="pc"))
    g = _guardado(pc)
    assert g["contesta"] == "pc" and g["salida_voz"] == "esp32"


def test_la_app_y_el_espejo_no_lo_cambian(pc):
    panel.guardar_agente(dict(BASE, salida_voz="esp32", contesta="app"))
    panel.guardar_agente(dict(BASE, salida_voz="esp32"))            # como manda web/espejo.js: sin "contesta"
    assert _guardado(pc)["contesta"] == "app"


def test_valor_desconocido(pc):
    with pytest.raises(panel.ErrorPanel):
        panel.guardar_agente(dict(BASE, salida_voz="esp32", contesta="los dos"))


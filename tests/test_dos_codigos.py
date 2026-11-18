"""17 nov (el usuario: "son dos códigos, uno para el robot ESP32-S3 y otro para el panel de control"): el código del
Panel de control solo sale en su ventana; el del robot lo dice el robot presentándose como robot."""
import nube
import servidor


def test_el_codigo_del_panel_no_se_dice_por_el_parlante_del_robot(monkeypatch):
    dichos, respuestas = [], []

    class SesionFalsa:
        class cola:
            @staticmethod
            def put(item):
                dichos.append(item)

    monkeypatch.setattr(servidor, "sesion_que_habla", lambda: SesionFalsa(), raising=False)
    monkeypatch.setattr(nube, "S", servidor)
    monkeypatch.setattr(nube, "_db", lambda *a, **k: None)
    monkeypatch.setattr(nube, "_responder", lambda clave, uid, ok, texto, **extra: respuestas.append((ok, texto, extra)))
    monkeypatch.setitem(nube._estado, "enlace", {"codigo": "123456", "hasta": 1e12, "fallos": 0})
    nube._solicitud("uidPrueba", {"codigo": "", "n": "abc"})       # una app pide "que lo diga"
    assert dichos == []
    assert respuestas and respuestas[0][1] == nube.SIN_VOZ and respuestas[0][2].get("dicho") is False
    assert not hasattr(nube, "decir_codigo")


def test_el_robot_dice_que_es_su_codigo_de_robot():
    assert "robot" in servidor.FRASE_CODIGO_ROBOT.lower()

"""15 nov: la ventana del programa saluda con la voz del PC (GET /api/voz/saludo) y queda una sola voz, la de
mujer (pedidos del usuario: "quiero que Pixel hable, tenga voz en esa parte de 'hola soy Pixel'" y "vamos a
usar la de mujer, solo esa"). Sin modelos de voz: la voz se simula."""
import io
import os
import re
import types
import wave

import panel

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _frases_de_la_ventana():
    """El saludo tal como lo escribe web/escritorio.js (FRASES): cada linea junta, y las lineas con un espacio."""
    with open(os.path.join(RAIZ, "web", "escritorio.js"), encoding="utf-8") as f:
        js = f.read()
    bloque = re.search(r"const FRASES = \[(.*?)\n  \];", js, re.S).group(1)
    lineas = [fila for fila in re.findall(r"\[(\{.*?\})\],", bloque)]
    return " ".join("".join(re.findall(r't: "([^"]*)"', fila)) for fila in lineas)


def test_el_saludo_que_se_dice_es_el_que_se_escribe():
    assert _frases_de_la_ventana() == panel.SALUDO_VENTANA
    assert panel.SALUDO_VENTANA.startswith("Hola, soy Píxel,")


class _VozFalsa:
    sr_destino = 16000

    def __init__(self):
        self.veces = 0

    def sintetizar(self, texto):
        self.veces += 1
        return b"\x01\x00" * 1600          # 0,1 s


def test_saludo_wav_y_se_sintetiza_una_vez(monkeypatch):
    voz = _VozFalsa()
    monkeypatch.setattr(panel, "S", types.SimpleNamespace(TTS=voz, SAMPLE_RATE=16000, log=lambda *a: None))
    monkeypatch.setattr(panel, "_saludo", {"clave": None, "wav": b""})
    wav = panel.saludo_wav()
    with wave.open(io.BytesIO(wav)) as w:
        assert (w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()) == (1, 2, 16000, 1600)
    assert panel.saludo_wav() == wav and voz.veces == 1, "la segunda vez sale de la memoria"
    monkeypatch.setitem(panel.AJUSTES, "tono", "infantil")
    panel.saludo_wav()
    assert voz.veces == 2, "con otro tono se vuelve a decir"


def test_sin_voz_cargada_no_hay_saludo(monkeypatch):
    monkeypatch.setattr(panel, "S", types.SimpleNamespace(TTS=None, SAMPLE_RATE=16000, log=lambda *a: None))
    assert panel.saludo_wav() is None


def test_una_sola_voz_la_de_mujer():
    assert [v[0] for v in panel.VOCES] == ["st-F4"]
    assert panel.VOCES[0][1] == "Mujer"

"""18 nov - El Queen fantasma: con ruido, Whisper repite su initial_prompt y no debe contar como orden.

Los textos de eco son los que salieron de verdad en servidor.log; las ordenes, frases que si se dicen.
"""

import pytest

pytest.importorskip("faster_whisper")
import servidor  # noqa: E402
from stt import eco_del_prompt  # noqa: E402

PROMPT = servidor.STT_PROMPT


@pytest.mark.parametrize("texto", [
    "Píxel, YouTube, pon música, reproduce, Soda Stereo, Queen, Bohemian Rhapsody",
    "Píxel, YouTube, pon música, reproduce, Soda Stereo, Queen, Bohemian Rhapsody,",
    "Píxel, YouTube, pon música, reproduce,",
    "Píxel, YouTube, pon música, reproduce, busca en YouTube, Soda Stereo, Queen, Bohemian Rhapsody",
    "Pixel. YouTube. Pon música. Reproduce.",
    "Soda Stereo, YouTube, Soda Stereo, Queen, Bohemian Rhapsody",
])
def test_eco(texto):
    assert eco_del_prompt(texto, PROMPT)


@pytest.mark.parametrize("texto", [
    "Píxel, pon Queen",
    "Píxel, pon Bohemian Rhapsody de Queen",
    "Píxel, busca en YouTube Soda Stereo",
    "Píxel, reproduce Soda Stereo",
    "Píxel, pon música",
    "Píxel, Píxel, Píxel, Píxel",
    "Píxel, YouTube, Soda Stereo",
    "Píxel, ¿qué hora es?",
    "",
])
def test_orden_de_verdad(texto):
    assert not eco_del_prompt(texto, PROMPT)


def test_sin_prompt():
    assert not eco_del_prompt("Píxel, YouTube, pon música, reproduce", None)

"""2.4.2 (13 nov, el usuario: "va muy rapido con lo del codigo"): el codigo de enlace se dice cifra por cifra, cada
una sola con un silencio despues, y dos veces; y sin la campanita de salida."""
import numpy as np

import servidor


class _TtsFalso:
    """Cada texto suena como 0,2 s de tono, con 0,5 s de silencio delante y detras (como Supertonic)."""
    def __init__(self):
        self.dichos = []

    def sintetizar(self, texto):
        self.dichos.append(texto)
        sr = servidor.SAMPLE_RATE
        tono = (8000 * np.sin(np.arange(int(0.2 * sr)) * 0.3)).astype("<i2")
        silencio = np.zeros(int(0.5 * sr), dtype="<i2")
        return np.concatenate([silencio, tono, silencio]).tobytes()


def test_codigo_cifra_por_cifra(monkeypatch):
    tts = _TtsFalso()
    monkeypatch.setattr(servidor, "TTS", tts)
    servidor._CIFRAS_CACHE.clear()
    s = servidor.Sesion.__new__(servidor.Sesion)
    enviados, cierres = [], []
    s.enviar_audio = enviados.append
    s.fin_respuesta = lambda cierre=True: cierres.append(cierre)
    s.debug = lambda texto: None

    s._decir_codigo(servidor.FRASE_CODIGO_ROBOT, "637748")

    assert enviados[0] is servidor.BEEP_AVISO
    # intro + 6 cifras, "Otra vez." + 6 cifras
    assert len(enviados) == 1 + 2 * 7
    assert tts.dichos.count("Seis.") == 1 and tts.dichos.count("Siete.") == 1     # cada cifra se sintetiza una vez
    assert tts.dichos[0] == servidor.FRASE_CODIGO_ROBOT and servidor.CODIGO_OTRA_VEZ in tts.dichos
    pausa = int(servidor.CODIGO_PAUSA_S * servidor.SAMPLE_RATE) * 2
    cifra = enviados[2]
    assert cifra.endswith(b"\x00" * pausa)                      # el silencio de despues
    assert len(cifra) < len(tts.sintetizar("x")) - 0.5 * 32000 + pausa   # sin el silencio que pone la voz
    assert cierres == [False]                                    # sin la campanita de salida

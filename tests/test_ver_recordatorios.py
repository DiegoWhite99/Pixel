"""13 nov: pedir un recordatorio que nombra "mis ..." no es preguntar por los recordatorios."""
import pytest

import acciones


@pytest.mark.parametrize("frase, accion", [
    ("Por favor enviamos un recordatorio a las tres de la tarde de cómo manejar mis finanzas", "recordatorio"),
    ("recuérdame mañana a las 8 llamar a mis papás", "recordatorio"),
    ("Ponme un recordatorio a las 5", "recordatorio"),
    ("qué recordatorios tengo", "ver_recordatorios"),
    ("cuántos recordatorios hay", "ver_recordatorios"),
    ("dime mis recordatorios", "ver_recordatorios"),
    ("tengo recordatorios mañana", "ver_recordatorios"),
])
def test_ver_o_crear(frase, accion):
    assert acciones.detectar(frase)[0] == accion

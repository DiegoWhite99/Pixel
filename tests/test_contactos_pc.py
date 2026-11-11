"""Busqueda de contactos en el PC (acciones._contacto): sin adivinar entre homonimos."""
import acciones


def _con(contactos, monkeypatch):
    monkeypatch.setattr(acciones, "CONTACTOS", contactos)


def test_nombre_exacto(monkeypatch):
    _con({"Óscar Mauricio": "om@x.co", "Ana Gómez": "ana@x.co"}, monkeypatch)
    assert acciones._contacto("oscar mauricio") == ("Óscar Mauricio", "om@x.co")


def test_nombre_que_no_existe_no_se_inventa(monkeypatch):
    _con({"Óscar Mauricio": "om@x.co"}, monkeypatch)
    assert acciones._contacto("oscar rodriguez") is None


def test_un_nombre_de_pila_con_un_solo_contacto(monkeypatch):
    _con({"Óscar Mauricio": "om@x.co", "Ana Gómez": "ana@x.co"}, monkeypatch)
    assert acciones._contacto("a ana") == ("Ana Gómez", "ana@x.co")


def test_dos_contactos_con_el_mismo_nombre_pregunta(monkeypatch):
    _con({"Óscar Mauricio": "om@x.co", "Óscar Rodríguez": "or@x.co"}, monkeypatch)
    assert acciones._contacto("oscar") is None
    assert acciones._contacto("oscar rodriguez") == ("Óscar Rodríguez", "or@x.co")

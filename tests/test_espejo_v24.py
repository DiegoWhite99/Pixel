"""2.4.0 (12 nov): el PC y la app de internet son un espejo (claves de IA, IA preferida y ajustes del agente), y la
credencial de Google se carga desde la ventana del programa. Sin red: Gemini, Groq y Firebase se simulan."""
import json
import pathlib
from datetime import date

import pytest

import gemini
import groq_ia
import llm
import nube
import panel
import servidor

RAIZ = pathlib.Path(__file__).resolve().parent.parent


@pytest.fixture
def pc(tmp_path, monkeypatch):
    """El panel con sus archivos en una carpeta temporal, sin cargar voces ni publicar en la nube."""
    monkeypatch.setattr(panel, "S", servidor)          # lo pone servidor.main()
    monkeypatch.setattr(servidor, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(servidor, "GOOGLE_CLIENTE", "google_cliente.json")
    monkeypatch.setattr(panel, "AJUSTES", dict(panel.AJUSTES, t=0, ia_t={}))
    monkeypatch.setattr(panel, "PERFIL", {"texto": "", "t": 0, "de": ""})
    monkeypatch.setattr(panel, "WEB_DIR", str(RAIZ / "web"))      # ruta absoluta: _ruta() la respeta
    monkeypatch.setattr(panel, "aplicar_ajustes", lambda: None)
    publicadas = []
    monkeypatch.setattr(nube, "publicar_ia", lambda: publicadas.append(1))
    monkeypatch.setattr(nube, "ahora_ms", lambda: 1_700_000_000_000)
    return publicadas


def _guardado(tmp_path):
    return json.load(open(tmp_path / servidor.AJUSTES_ARCHIVO, encoding="utf-8"))


def test_las_claves_de_ia_se_pueden_cambiar_desde_la_app():
    for ruta in ("/api/gemini/clave", "/api/gemini/probar", "/api/groq/clave", "/api/groq/probar", "/api/ia"):
        assert ruta in panel.RUTAS_POST, ruta          # nube.py solo ejecuta RUTAS_POST (y solo de los duenos)
        assert ruta not in panel.RUTAS_SOLO_LOCAL
    assert "/api/google/credencial" in panel.RUTAS_SOLO_LOCAL
    assert "/api/google/credencial" not in panel.RUTAS_POST


def test_ajustes_del_agente_con_la_hora_del_cambio(pc, tmp_path):
    base = {"voz": "st-F4", "respuesta": "corta", "tono": "normal", "personalidad": "Amable"}
    panel.guardar_agente(dict(base, t=12345))                    # viene de la app: su hora
    assert panel.AJUSTES["t"] == 12345 and _guardado(tmp_path)["t"] == 12345
    panel.guardar_agente(dict(base, salida_voz="pc"))            # solo la salida (no se copia): la hora no cambia
    assert panel.AJUSTES["t"] == 12345 and panel.AJUSTES["salida_voz"] == "pc"
    panel.guardar_agente(dict(base, personalidad="Seria"))       # desde la ventana del PC: la hora de ahora
    assert panel.AJUSTES["t"] == 1_700_000_000_000


def test_la_ia_preferida_con_su_hora(pc):
    panel.elegir_ia({"ia": "groq", "t": 777})
    assert panel.AJUSTES["ia"] == "groq" and panel.AJUSTES["ia_t"]["preferida"] == 777 and pc


def test_una_clave_buena_se_marca_y_una_mala_no(pc, monkeypatch):
    guardada = {}
    monkeypatch.setattr(gemini, "guardar", lambda c: guardada.update(clave=c))
    monkeypatch.setattr(gemini, "probar", lambda: (True, "listo"))
    monkeypatch.setattr(gemini, "clave_rechazada", lambda: False)
    panel.guardar_gemini({"clave": "A" * 39, "t": 999})
    assert guardada["clave"] == "A" * 39 and panel.AJUSTES["ia_t"]["gemini"] == 999
    # una clave que Google rechaza: se quita y la hora no cambia (la app no la da por copiada)
    monkeypatch.setattr(gemini, "probar", lambda: (False, "API key not valid"))
    monkeypatch.setattr(gemini, "clave_rechazada", lambda: True)
    with pytest.raises(panel.ErrorPanel):
        panel.guardar_gemini({"clave": "B" * 39, "t": 2000})
    assert guardada["clave"] == "" and panel.AJUSTES["ia_t"]["gemini"] == 999
    # quitarla desde la app tambien se marca
    panel.guardar_gemini({"clave": "", "t": 3000})
    assert panel.AJUSTES["ia_t"]["gemini"] == 3000


def test_el_pc_publica_cada_clave_con_su_hora_tambien_la_quitada(monkeypatch):
    escrito = []
    monkeypatch.setattr(nube, "_db", lambda metodo, ruta, datos=None: escrito.append((metodo, ruta, datos)))
    monkeypatch.setattr(nube, "_pid", lambda: "pc1")
    monkeypatch.setattr(nube, "nombre", lambda: "PC de prueba")
    monkeypatch.setitem(nube._estado, "activa", True)
    monkeypatch.setitem(nube._auth, "id", "token")
    monkeypatch.setattr(nube, "S", servidor, raising=False)
    monkeypatch.setattr(nube, "P", panel, raising=False)
    monkeypatch.setattr(panel, "AJUSTES", dict(panel.AJUSTES, ia_t={"gemini": 10, "groq": 20, "preferida": 30}))
    monkeypatch.setattr(gemini, "hay_clave", lambda: True)
    monkeypatch.setattr(gemini, "clave", lambda: "CLAVE-GEMINI-0123456789")
    monkeypatch.setattr(groq_ia, "hay_clave", lambda: False)
    monkeypatch.setattr(llm, "PREFERIDA", "gemini")

    class Hilo:                     # el hilo de publicar, al momento
        def __init__(self, target, daemon=None):
            self.target = target

        def start(self):
            self.target()
    monkeypatch.setattr(nube.threading, "Thread", Hilo)
    nube.publicar_ia()
    metodo, ruta, d = escrito[-1]
    assert (metodo, ruta) == ("PUT", "pixeles/pc1/ia")
    assert d["gemini"] == {"clave": "CLAVE-GEMINI-0123456789", "modelo": gemini.MODELO, "t": 10}
    assert d["groq"]["clave"] == "" and d["groq"]["t"] == 20        # la quitada tambien va, con su hora
    assert d["preferida"] == "gemini" and d["preferida_t"] == 30


def test_la_credencial_de_google_se_carga_desde_la_ventana(pc, tmp_path):
    escritorio = {"installed": {"client_id": "123-abc.apps.googleusercontent.com", "client_secret": "GOCSPX-prueba",
                                "redirect_uris": ["http://localhost"]}}
    r = panel.guardar_credencial_google({"json": json.dumps(escritorio)})
    assert "Conectar con Google" in r["mensaje"]
    assert json.load(open(tmp_path / "google_cliente.json", encoding="utf-8")) == {"installed": escritorio["installed"]}
    web = {"web": {"client_id": "123-abc.apps.googleusercontent.com", "client_secret": "x"}}
    with pytest.raises(panel.ErrorPanel, match="App de escritorio"):
        panel.guardar_credencial_google({"json": json.dumps(web)})
    for malo in ("no es json", json.dumps({"installed": {"client_id": "otro"}}), None):
        with pytest.raises(panel.ErrorPanel):
            panel.guardar_credencial_google({"json": malo})


def test_el_perfil_de_la_app_llega_al_pc(pc, tmp_path):
    r = panel.guardar_perfil({"texto": "- Su nombre: Ana Prueba.\n- Háblale de tú.", "t": 555, "de": "Ana Prueba"})
    assert "Perfil" in r["mensaje"]
    assert panel.PERFIL == {"texto": "- Su nombre: Ana Prueba.\n- Háblale de tú.", "t": 555, "de": "Ana Prueba"}
    assert json.load(open(tmp_path / servidor.PERFIL_ARCHIVO, encoding="utf-8"))["t"] == 555
    with pytest.raises(panel.ErrorPanel):
        panel.guardar_perfil({"texto": "x" * (panel.PERFIL_MAX + 1)})
    assert "/api/perfil" in panel.RUTAS_POST


def test_el_robot_usa_las_instrucciones_de_la_app(pc):
    """El usuario: "el Pixel de la ESP32 es uno viejo... tiene que ser igual lo que esta en la app, la web y el robot"."""
    panel.PERFIL.update(texto="- Su nombre: Ana Prueba.\n- Quiere que le digas «Anita».")
    panel.AJUSTES.update(personalidad="Divertido y breve", respuesta="corta")
    t = panel.instrucciones_pc(date(2026, 11, 12))
    assert "{{" not in t
    assert "creado por Divergencia IA" in t and "feria" not in t
    assert "Anita" in t and "Divertido y breve" in t and panel.RESPUESTAS["corta"] in t
    assert "jueves 12 de noviembre de 2026" in t and "«recuérdame…»" in t
    # lo que es solo de la app (sus funciones y su memoria) no va: aqui la IA no llama funciones
    assert "## Cómo usas las herramientas" not in t and "## Memoria y personalidad" not in t
    assert "## Seguridad" in t and "## Quién es el usuario" in t


"""2.2.0 (12 nov): la busqueda en la red de Windows, Groq como segunda IA de internet y la pagina de espera
que sirve la ventana del programa. Sin red: todo se simula."""
import json
import os
import socket
import sys
import types
import urllib.error
import urllib.request

import pytest

import gemini
import groq_ia
import llm
import red_wifi

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "instalador"))
import pixel_lanzador  # noqa: E402

# "arp -a" de un Windows en espanol, tal cual sale: en la pagina de codigos de la consola (850), no en UTF-8
ARP_WINDOWS = ("\r\nInterfaz: 192.168.1.5 --- 0xb\r\n"
               "  Dirección de Internet          Dirección física      Tipo\r\n"
               "  192.168.1.1           a4-2b-b0-11-22-33     dinámico\r\n"
               "  192.168.1.255         ff-ff-ff-ff-ff-ff     estático\r\n").encode("cp850")


def _run_como_windows(salida):
    """subprocess.run de mentira que decodifica como lo haria el de verdad con los argumentos que recibe."""
    def run(cmd, **kw):
        if kw.get("text") or kw.get("encoding") or kw.get("errors"):
            codif = kw.get("encoding") or "utf-8"
            codif = "cp850" if codif == "oem" else codif
            try:
                texto = salida.decode(codif, kw.get("errors") or "strict")
            except UnicodeDecodeError:
                texto = None            # asi quedaba stdout en Windows: el hilo lector fallaba y no habia nada
            return types.SimpleNamespace(stdout=texto, returncode=0)
        return types.SimpleNamespace(stdout=salida, returncode=0)
    return run


def test_arp_de_windows_en_espanol(monkeypatch):
    """El error que vio el usuario: "No pude buscar: expected string or bytes-like object"."""
    monkeypatch.setattr(red_wifi.subprocess, "run", _run_como_windows(ARP_WINDOWS))
    assert red_wifi._arp_windows() == {"192.168.1.1": "a4:2b:b0:11:22:33"}


def test_router_que_contesta_por_todas_las_ip():
    """La red de GitHub: el router contesta el ARP de las 254 IP con su MAC; no son 254 equipos."""
    tabla = {"10.1.0.%d" % i: "12:34:56:78:9a:bc" for i in range(2, 240)}
    tabla.update({"10.1.0.1": "12:34:56:78:9a:bc", "10.1.0.250": "aa:bb:cc:00:00:01", "10.1.0.251": "aa:bb:cc:00:00:02"})
    assert red_wifi._sin_eco_arp(tabla, "10.1.0.1") == {"10.1.0.1": "12:34:56:78:9a:bc", "10.1.0.250": "aa:bb:cc:00:00:01",
                                                        "10.1.0.251": "aa:bb:cc:00:00:02"}
    repetidor = {"192.168.1.%d" % i: "aa:aa:aa:aa:aa:aa" for i in range(10, 15)}       # 5 equipos tras un repetidor
    assert red_wifi._sin_eco_arp(repetidor) == repetidor


def test_arp_sin_salida_no_revienta(monkeypatch):
    monkeypatch.setattr(red_wifi.subprocess, "run", lambda *a, **k: types.SimpleNamespace(stdout=None))
    assert red_wifi._arp_windows() == {}


# ------------------------------------------------------------------ Groq y Gemini

def test_groq_elige_modelo():
    assert groq_ia.elegir_modelo(["whisper-large-v3", "llama-3.1-8b-instant", "llama-3.3-70b-versatile"]) == "llama-3.3-70b-versatile"
    assert groq_ia.elegir_modelo(["whisper-large-v3", "qwen/qwen3-32b"]) == "qwen/qwen3-32b"
    assert groq_ia.elegir_modelo(["whisper-large-v3", "playai-tts"]) == ""


def test_gemini_elige_otro_flash_si_falta_el_suyo():
    lista = ["gemini-2.5-flash", "gemini-3.1-flash-lite", "gemini-3.1-flash-lite-preview-06", "gemini-3.5-flash", "text-embedding-004"]
    assert gemini.elegir_modelo(lista) == "gemini-3.1-flash-lite"
    assert gemini.elegir_modelo(["gemini-2.5-flash", "gemini-3.5-flash"]) == "gemini-3.5-flash"
    assert gemini.elegir_modelo(["text-embedding-004"]) == ""


def test_groq_guarda_la_clave_y_el_modelo(tmp_path, monkeypatch):
    ruta = str(tmp_path / "groq_clave.json")
    groq_ia.cargar(ruta)
    groq_ia.guardar("gsk_" + "x" * 40)
    assert groq_ia.hay_clave() and not groq_ia.activo()           # sin modelo hasta probarla

    class Resp:
        def __init__(self, d):
            self.d = json.dumps(d).encode()

        def read(self):
            return self.d

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def abrir(req, timeout=None):
        assert req.get_header("Authorization") == "Bearer gsk_" + "x" * 40
        if req.full_url.endswith("/models"):
            return Resp({"data": [{"id": "whisper-large-v3"}, {"id": "llama-3.3-70b-versatile"}]})
        cuerpo = json.loads(req.data)
        assert cuerpo["model"] == "llama-3.3-70b-versatile" and not cuerpo["stream"]
        return Resp({"choices": [{"message": {"content": "¡Hola, feria!"}}]})
    monkeypatch.setattr(urllib.request, "urlopen", abrir)
    ok, texto = groq_ia.probar()
    assert ok and "llama-3.3-70b-versatile" in texto
    assert json.load(open(ruta)) == {"clave": "gsk_" + "x" * 40, "modelo": "llama-3.3-70b-versatile"}
    assert groq_ia.estado()["modelo"] == "llama-3.3-70b-versatile" and "clave" not in groq_ia.estado()
    groq_ia.guardar("")
    assert not os.path.exists(ruta) and not groq_ia.hay_clave()


def test_groq_clave_mala(tmp_path, monkeypatch):
    groq_ia.cargar(str(tmp_path / "g.json"))
    groq_ia.guardar("gsk_" + "y" * 40)

    def abrir(req, timeout=None):
        raise urllib.error.HTTPError(req.full_url, 401, "Unauthorized", {},
                                     __import__("io").BytesIO(b'{"error": {"message": "Invalid API Key"}}'))
    monkeypatch.setattr(urllib.request, "urlopen", abrir)
    ok, texto = groq_ia.probar()
    assert not ok and "no acepta esa clave" in texto
    groq_ia.guardar("")


class _Ia:
    """Un proveedor de mentira con la misma forma que gemini y groq_ia."""
    Error = RuntimeError

    def __init__(self, nombre, activo=True, falla=False):
        self.NOMBRE, self._activo, self._falla, self.llamadas = nombre, activo, falla, 0

    def activo(self):
        return self._activo

    def hay_clave(self):
        return self._activo

    def LOG(self, *a):
        pass

    def generar_stream(self, system, mensajes):
        self.llamadas += 1
        if self._falla:
            raise RuntimeError("sin cupo")
        yield "Soy " + self.NOMBRE


@pytest.mark.parametrize("preferida,esperado", [("gemini", "gemini"), ("groq", "groq")])
def test_contesta_primero_la_preferida(monkeypatch, preferida, esperado):
    g, q = _Ia("gemini"), _Ia("groq")
    monkeypatch.setattr(llm, "PROVEEDORES", (g, q))
    monkeypatch.setattr(llm, "PREFERIDA", preferida)
    m = llm.Llm()
    assert "".join(m.responder("hola")) == "Soy " + esperado and m.motor == esperado


def test_si_falla_la_preferida_contesta_la_otra(monkeypatch):
    g, q = _Ia("gemini", falla=True), _Ia("groq")
    monkeypatch.setattr(llm, "PROVEEDORES", (g, q))
    monkeypatch.setattr(llm, "PREFERIDA", "gemini")
    m = llm.Llm()
    assert "".join(m.responder("hola")) == "Soy groq" and g.llamadas == 1


# ------------------------------------------------------------------ pagina de espera del programa

def _puerto_libre():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def test_pagina_de_espera_sirve_la_ventana(monkeypatch):
    monkeypatch.setattr(pixel_lanzador, "APP", RAIZ)          # su web/ es la del repo
    puerto = _puerto_libre()
    srv = pixel_lanzador.pagina_de_espera(puerto)
    try:
        base = "http://127.0.0.1:%d" % puerto
        with urllib.request.urlopen(base + "/") as r:
            assert b"escritorio.js" in r.read()
        with urllib.request.urlopen(base + "/escritorio.css") as r:
            assert r.headers["Content-Type"].startswith("text/css")
        with urllib.request.urlopen(base + "/progreso") as r:
            assert json.loads(r.read())["version"] == pixel_lanzador.VERSION
        with pytest.raises(urllib.error.HTTPError) as e:
            urllib.request.urlopen(base + "/api/estado")
        assert e.value.code == 503
        with pytest.raises(urllib.error.HTTPError) as e:
            urllib.request.urlopen(urllib.request.Request(base + "/api/groq/clave", data=b"{}"))
        assert e.value.code == 503 and "preparando" in json.loads(e.value.read())["error"]
        for malo in ("/../servidor.py", "/servidor.py", "/%2e%2e/servidor.py"):
            with pytest.raises(urllib.error.HTTPError) as e:
                urllib.request.urlopen(base + malo)
            assert e.value.code == 404
        assert pixel_lanzador.en_marcha(puerto) == "preparando"
    finally:
        srv.shutdown()
        srv.server_close()
    assert pixel_lanzador.en_marcha(puerto) == ""


# ------------------------------------------------------------------ descargas que se cortan (2.2.1)

def _servidor_que_corta(datos, con_range=True):
    """Sirve datos; la primera vez corta la conexion a la mitad (como el WinError 10054 del usuario)."""
    import http.server
    import threading
    pedidos = []

    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            rango = self.headers.get("Range")
            pedidos.append(rango)
            desde = int(rango.split("=")[1].split("-")[0]) if rango and con_range else 0
            self.send_response(206 if desde else 200)
            self.send_header("Content-Length", str(len(datos) - desde))
            self.end_headers()
            if len(pedidos) == 1:                       # el primero se corta a la mitad
                self.wfile.write(datos[:len(datos) // 2])
                self.wfile.flush()
                self.connection.shutdown(socket.SHUT_RDWR)
                return
            self.wfile.write(datos[desde:])

        def log_message(self, *a):
            pass

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, pedidos


@pytest.mark.parametrize("con_range", [True, False])
def test_descarga_cortada_sigue_donde_iba(tmp_path, monkeypatch, con_range):
    import hashlib
    datos = os.urandom(3 * 1024 * 1024)
    srv, pedidos = _servidor_que_corta(datos, con_range)
    monkeypatch.setattr(pixel_lanzador.time, "sleep", lambda s: None)
    hecho = []
    try:
        destino = str(tmp_path / "voz.onnx")
        pixel_lanzador._bajar("http://127.0.0.1:%d/voz.onnx" % srv.server_address[1], destino, len(datos),
                              hashlib.sha256(datos).hexdigest(), hecho.append)
    finally:
        srv.shutdown()
    assert open(destino, "rb").read() == datos and not os.path.exists(destino + ".parte")
    assert len(pedidos) == 2 and pedidos[0] is None and pedidos[1] == "bytes=%d-" % (len(datos) // 2)
    assert sum(hecho) == len(datos)                     # el avance de la pantalla cuadra aunque se repita


# ------------------------------------------------------------------ 2.3.0: el PC con Windows hace lo mismo que con Linux

def test_windows_volumen_y_musica_con_teclas(monkeypatch):
    import puente_pc
    teclas = []
    monkeypatch.setattr(puente_pc, "WINDOWS", True)
    monkeypatch.setattr(puente_pc._Windows, "tecla", staticmethod(lambda n, veces=1: teclas.append((n, veces))))
    puente_pc.control({"accion": "subir_volumen"})
    puente_pc.control({"accion": "bajar_volumen"})
    puente_pc.control({"accion": "volumen", "valor": 30})
    puente_pc.control({"accion": "silenciar"})
    for a in ("pausa", "pausar", "play", "siguiente", "anterior"):
        puente_pc.control({"accion": a})
    assert teclas == [("subir", 5), ("bajar", 5), ("bajar", 50), ("subir", 15), ("silencio", 1),
                      ("play-pause", 1), ("play-pause", 1), ("play-pause", 1), ("next", 1), ("previous", 1)]


def test_windows_bloquear_pantalla_y_diagnostico(monkeypatch):
    import puente_pc
    hechos = []
    monkeypatch.setattr(puente_pc, "WINDOWS", True)
    monkeypatch.setattr(puente_pc._Windows, "bloquear", staticmethod(lambda: hechos.append("bloquear")))
    monkeypatch.setattr(puente_pc._Windows, "apagar_pantalla", staticmethod(lambda: hechos.append("pantalla")))
    monkeypatch.setattr(puente_pc._Windows, "mac", staticmethod(lambda: "aa:bb:cc:dd:ee:ff"))
    monkeypatch.setattr(puente_pc, "_correr", lambda *a, **k: (_ for _ in ()).throw(AssertionError("en Windows no hay pactl")))
    puente_pc.control({"accion": "bloquear"})
    puente_pc.control({"accion": "apagar_pantalla"})
    assert hechos == ["bloquear", "pantalla"]
    d = puente_pc.diagnostico()
    assert d["mac"] == "aa:bb:cc:dd:ee:ff" and "teclas" in d["volumen"]
    assert puente_pc.estado()["mac"] == "aa:bb:cc:dd:ee:ff"


def test_musica_en_una_sola_ventana(tmp_path, monkeypatch):
    """Dos canciones seguidas: la ventana de musica es la misma y queda una sola pestana (Chrome sin pantalla)."""
    import navegador
    if not navegador.ejecutable():
        pytest.skip("sin Chrome")
    monkeypatch.setattr(navegador, "PERFIL", str(tmp_path / "perfil"))
    monkeypatch.setattr(navegador, "PUERTO", _puerto_libre())
    monkeypatch.setattr(navegador, "EXTRA", ["--headless=new"])
    monkeypatch.setattr(navegador, "LOG", lambda *a: None)
    import http.server
    import threading
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), type("H", (http.server.BaseHTTPRequestHandler,), {
        "do_GET": lambda self: (self.send_response(200), self.end_headers(), self.wfile.write(b"<title>ok</title>")),
        "log_message": lambda self, *a: None}))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d" % srv.server_address[1]
    try:
        assert navegador.abrir(base + "/cancion1") == 0
        assert navegador.abrir(base + "/cancion2") == 0
        assert navegador.abrir(base + "/cancion3") == 0
        import time as _t
        _t.sleep(1)
        paginas = navegador._paginas()
        assert [p["url"] for p in paginas] == [base + "/cancion3"]
    finally:
        srv.shutdown()
        try:
            urllib.request.urlopen("http://127.0.0.1:%d/json/version" % navegador.PUERTO, timeout=2)
            import subprocess
            subprocess.run(["pkill", "-f", "[u]ser-data-dir=" + navegador.PERFIL])
        except Exception:
            pass

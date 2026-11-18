"""18 nov (Fase 17) - Actualizar Pixel desde su ventana (actualizar.py), con GitHub, pkexec y el instalador simulados:
no baja, no instala y no reinicia nada de verdad."""
import hashlib
import io
import json

import pytest

import actualizar as A
import panel

PAQUETE = b"paquete de prueba de pixel"
HUELLA = hashlib.sha256(PAQUETE).hexdigest()
BASE = "https://github.com/DiegoWhite99/Pixel/releases/download/v2.7.0/"


def publicacion(tag="v2.7.0", prerelease=False, otra_url=False):
    pre = "https://ejemplo.invalid/" if otra_url else BASE
    return {"tag_name": tag, "prerelease": prerelease, "draft": False,
            "html_url": "https://github.com/DiegoWhite99/Pixel/releases/tag/" + tag,
            "assets": [{"name": "pixel_2.7.0_amd64.deb", "browser_download_url": pre + "pixel_2.7.0_amd64.deb"},
                       {"name": "Pixel-2.7.0-Setup.exe", "browser_download_url": pre + "Pixel-2.7.0-Setup.exe"},
                       {"name": "SHA256SUMS", "browser_download_url": pre + "SHA256SUMS"}]}


class Resp(io.BytesIO):
    def __init__(self, datos):
        super().__init__(datos)
        self.headers = {"Content-Length": str(len(datos))}

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.close()


@pytest.fixture
def pc(tmp_path, monkeypatch):
    """Un programa instalado 2.6.1 con su carpeta de datos temporal y la red simulada."""
    red = {"api": publicacion(), "paquete": PAQUETE,
           "sumas": "%s  pixel_2.7.0_amd64.deb\n%s  Pixel-2.7.0-Setup.exe\n" % (HUELLA, HUELLA), "pedidos": []}

    def pedir(url, timeout=30):
        red["pedidos"].append(url)
        if url == A.API:
            return Resp(json.dumps(red["api"]).encode())
        if url.endswith("SHA256SUMS"):
            return Resp(red["sumas"].encode())
        return Resp(red["paquete"])
    monkeypatch.setattr(A, "_pedir", pedir)
    monkeypatch.setattr(A, "_conf", dict(A._conf))
    monkeypatch.setattr(A, "_estado", dict(A._estado))
    monkeypatch.setattr(A, "WINDOWS", False)
    avisos, reinicios, corridas = [], [], []
    monkeypatch.setattr(A, "_notificar", lambda t, x: avisos.append(t) or True)
    monkeypatch.setattr(A, "_reiniciar", lambda: reinicios.append(1))

    class Timer:                                   # el reinicio, enseguida
        def __init__(self, s, f):
            self.f = f

        def start(self):
            self.f()
    monkeypatch.setattr(A.threading, "Timer", Timer)

    class Corrida:
        returncode = 0
        stdout = b""

    def correr(args, **k):
        corridas.append(args)
        return Corrida()
    monkeypatch.setattr(A.subprocess, "run", correr)
    A.configurar("2.6.1", str(tmp_path), carpeta="C:\\Pixel", log=lambda t: None, vigilar=False)
    return {"red": red, "avisos": avisos, "reinicios": reinicios, "corridas": corridas, "datos": tmp_path, "Corrida": Corrida}


def instalar_ya():
    A._estado["instalando"] = True
    A._instalar()


def test_versiones():
    assert A.version_tupla("v2.6.1") == (2, 6, 1)
    assert A.version_tupla("2.10.0") == (2, 10, 0)
    assert A.version_tupla("2.6") == () and A.version_tupla("2.6.1-beta") == () and A.version_tupla(None) == ()
    assert A.mas_nueva("2.10.0", "2.9.9") and A.mas_nueva("v2.6.2", "2.6.1")
    assert not A.mas_nueva("2.6.1", "2.6.1") and not A.mas_nueva("2.6.0", "2.6.1") and not A.mas_nueva("x", "2.6.1")
    assert A.nombre_paquete("2.7.0", windows=False) == "pixel_2.7.0_amd64.deb"
    assert A.nombre_paquete("2.7.0", windows=True) == "Pixel-2.7.0-Setup.exe"


def test_leer_publicacion():
    p = A.leer_publicacion(publicacion())
    assert p["version"] == "2.7.0" and set(p["archivos"]) == {"pixel_2.7.0_amd64.deb", "Pixel-2.7.0-Setup.exe", "SHA256SUMS"}
    assert p["pagina"].endswith("/tag/v2.7.0")
    assert A.leer_publicacion(publicacion(prerelease=True)) is None          # las de prueba no se ofrecen
    assert A.leer_publicacion(publicacion(tag="ultima")) is None
    assert A.leer_publicacion(publicacion(otra_url=True))["archivos"] == {}   # solo descargas de este repositorio
    assert A.leer_publicacion("nada") is None


def test_huella_en():
    sumas = "%s  pixel_2.7.0_amd64.deb\n%s *Pixel-2.7.0-Setup.exe\n" % ("a" * 64, "B" * 64)
    assert A.huella_en(sumas, "pixel_2.7.0_amd64.deb") == "a" * 64
    assert A.huella_en(sumas, "Pixel-2.7.0-Setup.exe") == "b" * 64
    assert A.huella_en(sumas, "otro.deb") == ""


def test_desde_el_codigo_no_hay_boton(monkeypatch):
    monkeypatch.setattr(A, "_conf", dict(A._conf, activo=False))
    assert A.estado() == {"activo": False}
    with pytest.raises(panel.ErrorPanel):
        panel.buscar_version({})
    with pytest.raises(panel.ErrorPanel):
        panel.instalar_version({})


def test_solo_desde_la_ventana_de_este_pc():
    for ruta in ("/api/actualizar/buscar", "/api/actualizar/instalar"):
        assert ruta in panel.RUTAS_SOLO_LOCAL and ruta in panel.RUTAS_SOLO_ESTE_PC
        assert ruta not in panel.RUTAS_POST                 # la nube (la app) no puede instalar programas


def test_buscar_avisa_una_vez(pc):
    assert A.revisar()["version"] == "2.7.0"
    e = A.estado()
    assert e["activo"] and e["hay"] and e["ultima"] == "2.7.0" and e["actual"] == "2.6.1" and e["revisado"]
    A.revisar()
    assert pc["avisos"] == ["Píxel 2.7.0 ya está disponible"]       # la notificacion del escritorio, una sola vez
    assert json.load(open(pc["datos"] / "actualizacion.json"))["avisada"] == "2.7.0"
    assert "Hay una versión nueva: 2.7.0" in panel.buscar_version({})["mensaje"]


def test_al_dia(pc):
    pc["red"]["api"] = publicacion(tag="v2.6.1")
    assert not A.estado()["hay"]
    assert panel.buscar_version({})["mensaje"] == "Tienes la última versión (2.6.1)."
    instalar_ya()
    assert pc["corridas"] == [] and not A.estado()["instalando"] and pc["avisos"] == []


def test_actualizar_en_linux(pc):
    instalar_ya()
    ruta = str(pc["datos"] / "actualizacion" / "pixel_2.7.0_amd64.deb")
    assert open(ruta, "rb").read() == PAQUETE
    assert pc["corridas"] == [["pkexec", "dpkg", "-i", ruta]]
    assert pc["reinicios"] == [1]
    assert "instalado" in A.estado()["fase"] and not A.estado()["error"]


def test_paquete_danado_no_se_instala(pc):
    pc["red"]["paquete"] = b"otra cosa"
    instalar_ya()
    e = A.estado()
    assert pc["corridas"] == [] and pc["reinicios"] == []
    assert "dañado" in e["error"] and not e["instalando"]


def test_sin_contrasena(pc):
    pc["Corrida"].returncode = 126                     # cerro la ventanita de la contrasena
    instalar_ya()
    e = A.estado()
    assert "cancelaste la contraseña" in e["error"] and not e["instalando"] and pc["reinicios"] == []
    pc["Corrida"].returncode = 127                     # o Ubuntu no pudo pedirla: como instalarlo a mano
    instalar_ya()
    assert "sudo apt install" in A.estado()["error"] and pc["reinicios"] == []


def test_actualizar_en_windows(pc, monkeypatch):
    monkeypatch.setattr(A, "WINDOWS", True)
    lanzados = []
    monkeypatch.setattr(A.subprocess, "Popen", lambda args, **k: lanzados.append(args))
    instalar_ya()
    ruta = str(pc["datos"] / "actualizacion" / "Pixel-2.7.0-Setup.exe")
    assert lanzados == [[ruta, "/S", "/ABRIR", "/D=C:\\Pixel"]]      # /ABRIR: que lo vuelva a abrir (solo el boton)
    assert pc["corridas"] == [] and "vuelve a abrir solo" in A.estado()["fase"]

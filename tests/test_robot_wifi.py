"""17 nov (Fase 16): darle el WiFi al robot por Bluetooth desde el PC (robot_wifi.py).

Sin Bluetooth de verdad: el robot va simulado (hace lo que hace puente.ino con BLE_NUBE).
"""
import asyncio
import json
import threading

import pytest

import panel
import robot_wifi


def test_campos_de_nmcli_con_dos_puntos_escapados():
    assert robot_wifi._campos(r"*:Mi\:Red:80:WPA2:2412 MHz") == ["*", "Mi:Red", "80", "WPA2", "2412 MHz"]
    assert robot_wifi._campos(r" :C\\D:5:--:2437 MHz") == [" ", "C\\D", "5", "--", "2437 MHz"]


def test_redes_de_nmcli_agrupadas_y_con_la_banda():
    salida = "\n".join([
        "*:Cabaña:100:WPA2 WPA3:2412 MHz",
        " :Vecino 5G:100:WPA2 WPA3:5240 MHz",
        " :Vecino 5G:70:WPA2 WPA3:5805 MHz",
        " :Cafeteria:60:WPA2:5240 MHz",
        " :Cafeteria:90:WPA2:2437 MHz",
        " :Cafe:40::2462 MHz",
        " ::100:WPA2:2412 MHz",                       # oculta: no se puede elegir
        "*:Casa :55:WPA2:2412 MHz",                  # el espacio del final es parte del nombre
    ])
    redes = {r["ssid"]: r for r in robot_wifi._redes_nmcli(salida)}
    assert set(redes) == {"Cabaña", "Vecino 5G", "Cafeteria", "Cafe", "Casa "}
    assert redes["Cabaña"]["del_pc"] and redes["Cabaña"]["ghz24"]
    assert not redes["Vecino 5G"]["ghz24"]                               # solo 5 GHz: el robot no la ve
    assert redes["Cafeteria"]["ghz24"] and redes["Cafeteria"]["senal"] == 90
    assert redes["Cafe"]["abierta"] and not redes["Cabaña"]["abierta"]


def test_redes_de_netsh_en_espanol():
    salida = "\r\n".join([
        "Nombre de interfaz : Wi-Fi",
        "Hay 2 redes visibles actualmente.",
        "",
        "SSID 1 : Cabaña",
        "    Tipo de red             : Infraestructura",
        "    Autenticación           : WPA2-Personal",
        "    BSSID 1                 : aa:bb:cc:dd:ee:ff",
        "         Señal             : 91%",
        "         Banda             : 2,4 GHz",
        "         Canal             : 1",
        "",
        "SSID 2 : Vecino 5G",
        "    Autenticación           : WPA2-Personal",
        "    BSSID 1                 : aa:bb:cc:dd:ee:00",
        "         Señal             : 80%",
        "         Banda             : 5 GHz",
        "SSID 3 : Libre",
        "    Autenticación           : Abierta",
        "         Señal             : 30%",
    ])
    redes = {r["ssid"]: r for r in robot_wifi._redes_netsh(salida, "Cabaña")}
    assert redes["Cabaña"]["del_pc"] and redes["Cabaña"]["ghz24"] and redes["Cabaña"]["senal"] == 91
    assert redes["Vecino 5G"]["ghz24"] is False
    assert redes["Libre"]["abierta"] and redes["Libre"]["ghz24"] is True     # sin banda: que el usuario decida


@pytest.fixture
def vinculado(monkeypatch):
    """Un robot ya vinculado por Bluetooth (paso 1 hecho), con este PC en «Cabaña»."""
    monkeypatch.setitem(robot_wifi._estado, "vinculado", {"direccion": "AA:BB:CC:00:00:01", "nombre": "Pixel Assistance"})
    monkeypatch.setitem(robot_wifi._estado, "red_pc", "Cabaña")
    monkeypatch.setitem(robot_wifi._estado, "estado", "")


def test_sin_vincular_no_hay_wifi(monkeypatch):
    monkeypatch.setitem(robot_wifi._estado, "vinculado", None)
    with pytest.raises(robot_wifi.Error, match="Primero vincula"):
        robot_wifi.iniciar_wifi(True)


@pytest.mark.parametrize("ssid,clave,error", [
    ("", "12345678", "Elige una red"),
    ("Casa", "corta", "entre 8 y 64"),
    ("x" * 33, "12345678", "Elige una red"),
])
def test_datos_malos_no_llegan_al_bluetooth(vinculado, ssid, clave, error):
    with pytest.raises(robot_wifi.Error, match=error):
        robot_wifi.iniciar_wifi(False, ssid, clave)


def test_si_con_el_wifi_del_pc_sin_contrasena_guardada_pide_elegir_no(vinculado, monkeypatch):
    def sin_clave(ssid):
        raise robot_wifi.Error("no")
    monkeypatch.setattr(robot_wifi, "clave_guardada", sin_clave)
    with pytest.raises(robot_wifi.Error, match="Elige «No»"):
        robot_wifi.iniciar_wifi(True)


def test_vincular_pide_un_aparato_de_la_lista():
    with pytest.raises(robot_wifi.Error, match="Elige un aparato"):
        robot_wifi.iniciar_vincular("")


def test_lista_de_aparatos_el_robot_primero_y_sin_nombres_que_son_mac():
    class D:
        def __init__(self, direccion, nombre):
            self.address, self.name = direccion, nombre

    class A:
        def __init__(self, rssi, uuids=(), nombre=None):
            self.rssi, self.service_uuids, self.local_name = rssi, list(uuids), nombre

    vistos = [
        (D("AA:00:00:00:00:01", "Audífonos"), A(-40)),
        (D("AA:00:00:00:00:02", "AA-00-00-00-00-02"), A(-30)),                      # BlueZ: sin nombre
        (D("AA:BB:CC:00:00:01", "Pixel Assistance"), A(-70, [robot_wifi.SERVICIO.upper()])),
        (D("AA:00:00:00:00:03", None), A(-50, [], "Celular")),
    ]
    aparatos = robot_wifi._aparatos(vistos)
    assert [a["nombre"] for a in aparatos] == ["Pixel Assistance", "Audífonos", "Celular"]
    assert aparatos[0]["pixel"] and not aparatos[1]["pixel"]


class RobotFalso:
    """Lo que hace el firmware: BLE_NUBE da su estado en JSON y acepta {"ssid", "clave"} si no tiene WiFi o esta
    en modo enlazar; a la segunda lectura ya entro a la red."""

    def __init__(self, wifi=False, red="Casa ", emparejar=False, entra=True):
        self.d = {"id": "abc", "wifi": wifi, "red": red, "dueno": True, "emparejar": emparejar, "pc": False}
        self.entra, self.escrito, self.lecturas = entra, None, 0

    def bleak(self):
        robot = self

        class Cliente:
            def __init__(self, disp, timeout):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def read_gatt_char(self, uuid):
                assert uuid == robot_wifi.NUBE
                robot.lecturas += 1
                if robot.escrito and robot.entra and robot.lecturas >= 3:
                    robot.d.update(wifi=True, red=robot.escrito["ssid"])
                return json.dumps(robot.d).encode()

            async def write_gatt_char(self, uuid, datos, response):
                assert uuid == robot_wifi.NUBE and response
                if not robot.d["wifi"] or robot.d["emparejar"]:
                    robot.escrito = json.loads(datos)
                    robot.d.update(wifi=False, red=robot.escrito["ssid"])

        class Escaner:
            @staticmethod
            async def find_device_by_address(direccion, timeout):
                return object()

        class Modulo:
            BleakClient = Cliente
            BleakScanner = Escaner
        return Modulo


def _dar(monkeypatch, robot, ssid="Cabaña", clave="clave-larga"):
    monkeypatch.setattr(robot_wifi, "_bleak", robot.bleak)
    monkeypatch.setattr(robot_wifi, "LEER_CADA_S", 0.01)
    monkeypatch.setattr(robot_wifi, "ESPERAR_WIFI_S", 0.5)
    fases = []
    return asyncio.run(robot_wifi._dar_red("AA:BB:CC:00:00:01", ssid, clave, fases.append)), fases


def test_le_da_la_red_y_espera_a_que_entre(monkeypatch):
    robot = RobotFalso()
    d, fases = _dar(monkeypatch, robot)
    assert robot.escrito == {"ssid": "Cabaña", "clave": "clave-larga"}
    assert d["wifi"] and d["red"] == "Cabaña"
    assert any("Esperando" in f for f in fases)
    assert not any("clave-larga" in f for f in fases)          # la clave nunca sale en el avance


def test_si_ya_tiene_wifi_pide_el_boton_boot(monkeypatch):
    robot = RobotFalso(wifi=True, red="Casa ")
    with pytest.raises(robot_wifi.Error, match="BOOT"):
        _dar(monkeypatch, robot)
    assert robot.escrito is None


def test_en_modo_enlazar_si_acepta_otra_red(monkeypatch):
    robot = RobotFalso(wifi=True, red="Casa ", emparejar=True)
    d, _ = _dar(monkeypatch, robot)
    assert d["red"] == "Cabaña"


def test_clave_mala_dice_que_no_pudo_entrar(monkeypatch):
    with pytest.raises(robot_wifi.Error, match="no pudo entrar"):
        _dar(monkeypatch, RobotFalso(entra=False))


def _bleak_falso(servicio_del_robot, lectura):
    class Servicios:
        @staticmethod
        def get_characteristic(uuid):
            return object() if servicio_del_robot else None

    class Cliente:
        services = Servicios()

        def __init__(self, disp, timeout):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def read_gatt_char(self, uuid):
            return lectura()

    class Escaner:
        @staticmethod
        async def find_device_by_address(direccion, timeout):
            class Disp:
                name = "Pixel Assistance"
            return Disp()

    class Modulo:
        BleakClient, BleakScanner = Cliente, Escaner
    return Modulo


def test_un_aparato_que_no_es_el_robot(monkeypatch):
    monkeypatch.setattr(robot_wifi, "_bleak", lambda: _bleak_falso(False, lambda: b"{}"))
    with pytest.raises(robot_wifi.Error, match="no es un robot Píxel"):
        asyncio.run(robot_wifi._leer_robot("AA:00:00:00:00:01"))


def test_si_el_robot_se_reinicia_reintenta_y_dice_la_causa(monkeypatch):
    """17 nov: al conectarse el PC por Bluetooth el robot se reinicio por falta de corriente."""
    lecturas = []

    def se_cae():
        lecturas.append(1)
        raise EOFError("disconnected")

    monkeypatch.setattr(robot_wifi, "_bleak", lambda: _bleak_falso(True, se_cae))
    monkeypatch.setattr(robot_wifi, "ENTRE_INTENTOS_S", 0)
    monkeypatch.setattr(robot_wifi, "LOG", lambda t: None)
    with pytest.raises(robot_wifi.Error, match="falta de corriente"):
        asyncio.run(robot_wifi._leer_robot("AA:BB:CC:00:00:01"))
    assert len(lecturas) == robot_wifi.INTENTOS_BLE


def test_si_se_corta_una_vez_al_segundo_intento_vincula(monkeypatch):
    veces = []

    def lectura():
        veces.append(1)
        if len(veces) == 1:
            raise EOFError("disconnected")
        return b'{"id": "robotpid123", "wifi": true, "red": "Caba\\u00f1a", "app": false}'

    monkeypatch.setattr(robot_wifi, "_bleak", lambda: _bleak_falso(True, lectura))
    monkeypatch.setattr(robot_wifi, "ENTRE_INTENTOS_S", 0)
    monkeypatch.setattr(robot_wifi, "LOG", lambda t: None)
    nombre, d = asyncio.run(robot_wifi._leer_robot("AA:BB:CC:00:00:01"))
    assert d["id"] == "robotpid123" and len(veces) == 2


def test_rutas_solo_desde_este_pc():
    assert panel.RUTAS_SOLO_ESTE_PC <= set(panel.RUTAS_SOLO_LOCAL)
    assert not panel.RUTAS_SOLO_ESTE_PC & set(panel.RUTAS_POST)     # la nube no las ejecuta


def test_red_de_la_lista_con_contrasena_guardada(vinculado, monkeypatch):
    dado = {}

    async def dar_red(direccion, ssid, clave, avisar):
        dado.update(direccion=direccion, ssid=ssid, clave=clave)
        return {"wifi": True, "red": ssid}

    monkeypatch.setattr(robot_wifi, "_dar_red", dar_red)
    monkeypatch.setattr(robot_wifi, "clave_guardada", lambda ssid: "guardada-" + ssid)
    monkeypatch.setattr(robot_wifi, "_en_hilo", lambda nombre, trabajo: trabajo())
    robot_wifi.iniciar_wifi(False, "Oficina", "", usar_guardada=True)
    assert dado == {"direccion": "AA:BB:CC:00:00:01", "ssid": "Oficina", "clave": "guardada-Oficina"}
    assert robot_wifi.estado()["vinculado"]["red"] == "Oficina"
    assert "guardada-" not in robot_wifi.estado()["fase"]


def test_detectar_otra_vez_empieza_de_cero(vinculado, monkeypatch):
    monkeypatch.setattr(robot_wifi, "_detectar_sync", lambda: [{"direccion": "AA:BB:CC:00:00:01", "nombre": "Pixel Assistance",
                                                               "rssi": -40, "pixel": True}])
    monkeypatch.setattr(robot_wifi, "_en_hilo", lambda nombre, trabajo: trabajo())
    robot_wifi.iniciar_deteccion()
    e = robot_wifi.estado()
    assert e["vinculado"] is None and e["aparatos"][0]["nombre"] == "Pixel Assistance"


class RobotParaEnlazar:
    """El firmware al enlazarse: con dueno y la marca puesta se anota solo (a la 3.a lectura); sin dueno, {pedir_codigo}
    hace un codigo que le llega al PC por la red, y {dueno, codigo} con ese codigo lo enlaza."""

    def __init__(self, dueno, pc=True):
        self.d = {"id": "robotpid123", "wifi": True, "red": "Cabaña", "dueno": dueno, "app": False, "pc": pc}
        self.lecturas, self.escritos, self.codigo = 0, [], "482913"

    def bleak(self):
        robot = self

        class Cliente:
            def __init__(self, disp, timeout):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def read_gatt_char(self, uuid):
                robot.lecturas += 1
                if robot.d["dueno"] and robot.lecturas >= 3:
                    robot.d["app"] = True
                return json.dumps(robot.d).encode()

            async def write_gatt_char(self, uuid, datos, response):
                o = json.loads(datos)
                robot.escritos.append(o)
                if o.get("pedir_codigo"):           # el robot se lo manda a su PC: servidor.py llama a recibir_codigo
                    threading.Timer(0.05, robot_wifi.recibir_codigo, [robot.codigo]).start()
                if o.get("codigo") == robot.codigo and o.get("dueno"):
                    robot.d["dueno"] = True
                    robot.lecturas = 0

        class Escaner:
            @staticmethod
            async def find_device_by_address(direccion, timeout):
                return object()

        class Modulo:
            BleakClient, BleakScanner = Cliente, Escaner
        return Modulo


def _enlazar(monkeypatch, robot):
    monkeypatch.setattr(robot_wifi, "_bleak", robot.bleak)
    monkeypatch.setattr(robot_wifi, "LEER_CADA_S", 0.01)
    for nombre in ("ESPERAR_APP_S", "ESPERAR_PC_S", "ESPERAR_CODIGO_S"):
        monkeypatch.setattr(robot_wifi, nombre, 1.0)
    return asyncio.run(robot_wifi._enlazar_app("AA:BB:CC:00:00:01", [("uidPrueba", "Celular de prueba")], lambda f: None))


def test_enlazar_con_la_app_si_ya_tiene_dueno_basta_la_marca(monkeypatch):
    robot = RobotParaEnlazar(dueno=True)
    assert _enlazar(monkeypatch, robot)["app"]
    assert robot.escritos == []                         # no hizo falta el codigo


def test_enlazar_con_la_app_sin_dueno_usa_el_codigo_que_llega_por_la_red(monkeypatch):
    robot = RobotParaEnlazar(dueno=False)
    assert _enlazar(monkeypatch, robot)["app"]
    assert robot.escritos == [{"pedir_codigo": True}, {"dueno": "uidPrueba", "nombre": "Celular de prueba", "codigo": "482913"}]
    assert not robot_wifi.recibir_codigo("111111")      # ya no lo espera: el siguiente codigo se dice en voz alta


def test_enlazar_sin_conexion_con_el_panel_lo_dice(monkeypatch):
    with pytest.raises(robot_wifi.Error, match="aún no está conectado a este panel"):
        _enlazar(monkeypatch, RobotParaEnlazar(dueno=False, pc=False))


def test_tras_el_wifi_se_enlaza_solo_con_la_app(vinculado, monkeypatch):
    pasos = []

    async def dar_red(direccion, ssid, clave, avisar):
        return {"id": "robotpid123", "wifi": True, "red": ssid, "app": False}

    async def enlazar(direccion, duenos, avisar):
        pasos.append(("enlazar", duenos))
        return {"id": "robotpid123", "wifi": True, "red": "Cabaña", "app": True}

    monkeypatch.setattr(robot_wifi, "_dar_red", dar_red)
    monkeypatch.setattr(robot_wifi, "_enlazar_app", enlazar)
    monkeypatch.setattr(robot_wifi, "clave_guardada", lambda ssid: "contrasena-larga")
    monkeypatch.setattr(robot_wifi, "_en_hilo", lambda nombre, trabajo: trabajo())
    robot_wifi.iniciar_wifi(True, marcar=lambda pid: pasos.append(("marca", pid)) or [("uidPrueba", "app")])
    assert pasos == [("marca", "robotpid123"), ("enlazar", [("uidPrueba", "app")])]
    assert robot_wifi.estado()["vinculado"]["app"]

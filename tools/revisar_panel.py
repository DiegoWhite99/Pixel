#!/usr/bin/env python3
"""2.2.0 (12 nov) - Revisa el panel de un Pixel instalado (lo usa .github/workflows/probar_instaladores.yml).

Solo libreria estandar. Con Pixel ya en marcha en este equipo:
  1. el panel responde, sirve la ventana (escritorio.html) y NO se abre a la red (solo 127.0.0.1);
  2. la busqueda de aparatos en la red termina sin error (en Windows en espanol fallaba con
     "No pude buscar: expected string or bytes-like object");
  3. una clave de Google y una de Groq inventadas reciben una respuesta clara (Pixel llega a Google y a Groq por
     internet) y no se quedan guardadas;
  4. una peticion desde otra pagina web se rechaza (403).
Guarda el estado del panel en panel.json. Uso: python3 tools/revisar_panel.py [puerto del panel]
"""
import json
import socket
import sys
import time
import urllib.error
import urllib.request

PUERTO = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
BASE = "http://127.0.0.1:%d" % PUERTO
malos = []


def bien(cond, texto):
    print(("  bien: " if cond else "  MAL: ") + texto, flush=True)
    if not cond:
        malos.append(texto)


def pedir(ruta, datos=None, cabeceras=None):
    req = urllib.request.Request(BASE + ruta, data=None if datos is None else json.dumps(datos).encode("utf-8"),
                                 headers=dict({"Content-Type": "application/json"}, **(cabeceras or {})))
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            cuerpo = r.read()
            return r.status, cuerpo
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def estado():
    codigo, cuerpo = pedir("/api/estado")
    return json.loads(cuerpo) if codigo == 200 else None


print("Panel")
e = estado()
bien(e is not None, "el panel responde en %s" % BASE)
if e is None:
    sys.exit(1)
with open("panel.json", "w", encoding="utf-8") as f:
    json.dump(e, f, ensure_ascii=False, indent=1)
print("  programa:", e.get("programa"))
codigo, cuerpo = pedir("/escritorio.html")
bien(codigo == 200 and b"escritorio.js" in cuerpo, "sirve la ventana de Píxel (escritorio.html)")
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
try:
    s.connect(("10.255.255.255", 1))
    ip = s.getsockname()[0]
except OSError:
    ip = "127.0.0.1"
finally:
    s.close()
if not ip.startswith("127."):
    c = socket.socket()
    c.settimeout(3)
    abierto = c.connect_ex((ip, PUERTO)) == 0
    c.close()
    bien(not abierto, "el panel no se abre a la red (%s:%d cerrado)" % (ip, PUERTO))

print("Búsqueda en la red")
codigo, cuerpo = pedir("/api/wifi/buscar", {})
bien(codigo == 200, "empieza la búsqueda (%d %s)" % (codigo, cuerpo.decode("utf-8", "replace")[:120]))
b = {}
for _ in range(120):                    # hasta 4 minutos: en Windows cada equipo se mira mas despacio
    time.sleep(2)
    b = (estado() or {}).get("wifi", {}).get("busqueda", {})
    if b.get("estado") != "buscando":
        break
print("  resultado: %s, %d equipos en %s %s" % (b.get("estado"), len(b.get("encontrados") or []), b.get("red"), b.get("fase") or ""))
bien(b.get("estado") == "listo", "la búsqueda termina sin error")

print("Claves inventadas")
for api, clave, nombre in (("gemini", "AIza" + "0" * 35, "Google"), ("groq", "gsk_" + "0" * 40, "Groq")):
    codigo, cuerpo = pedir("/api/%s/clave" % api, {"clave": clave})
    texto = json.loads(cuerpo).get("error") or json.loads(cuerpo).get("mensaje") or ""
    print("  %s: %d %s" % (nombre, codigo, texto))
    bien(codigo == 400, "%s: la clave inventada no se acepta" % nombre)
    if "no acepta" not in texto:
        print("  AVISO: %s no contestó (¿sin internet?); no se pudo ver que lo rechazara él" % nombre)
    guardada = ((estado() or {}).get("cuentas", {}).get(api) or {}).get("configurada")
    bien(guardada is False, "%s: la clave rechazada no se queda guardada" % nombre)

print("Otra página web")
codigo, _ = pedir("/api/ia", {"ia": "groq"}, {"Origin": "https://otra-pagina.example"})
bien(codigo == 403, "una petición desde otra página se rechaza (%d)" % codigo)

print("\n" + ("BIEN: el panel está como debe" if not malos else "%d MAL: %s" % (len(malos), "; ".join(malos))))
sys.exit(1 if malos else 0)

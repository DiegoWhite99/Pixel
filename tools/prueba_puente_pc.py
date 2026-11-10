#!/usr/bin/env python3
"""Fase 14 - Pruebas de WhatsApp en el PC (puente_pc.whatsapp) sin tocar el escritorio: xdotool, xdg-open y
time.sleep se sustituyen. Nada se abre ni se envia de verdad (probarlo de verdad mandaria un mensaje).
    .venv/bin/python tools/prueba_puente_pc.py"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import puente_pc as P  # noqa: E402

P.time.sleep = lambda s: None
P.WHATSAPP_ESPERA_S = 0
P.WHATSAPP_MAX_S = 0                    # sin esperar a la ventana (time.sleep no pasa el tiempo aqui)
fallos = 0


def comprobar(ok, que, detalle=""):
    global fallos
    fallos += not ok
    print(("BIEN " if ok else "MAL  ") + que + ("" if ok else "  -> %s" % detalle))


def escritorio(ventanas, fondo=False):
    """Un escritorio falso. ventanas: {id: titulo}. fondo: WhatsApp esta en una pestaña de fondo (sale al
    buscarla con Ctrl+Shift+A). Devuelve (llamadas, abiertos)."""
    llamadas, abiertos, estado = [], [], {"ventanas": dict(ventanas)}

    def correr(cmd, timeout=6):
        llamadas.append(" ".join(cmd))
        if cmd[:2] == ["xdotool", "version"]:
            return 0, "xdotool version 3.2"
        if cmd[:2] == ["xdotool", "search"]:
            if "--class" in cmd:
                return 0, "\n".join(estado["ventanas"])
            return 0, "\n".join(w for w, t in estado["ventanas"].items() if "whatsapp" in t.lower())
        if cmd[:2] == ["xdotool", "getwindowname"]:
            return 0, estado["ventanas"].get(cmd[2], "")
        if cmd[:2] == ["xdotool", "key"] and cmd[-1] == "Return" and fondo and any("ctrl+shift+a" in x for x in llamadas):
            estado["ventanas"]["200"] = "(3) WhatsApp - Google Chrome"   # la busqueda de pestañas la trajo al frente
        return 0, ""
    P._correr = correr
    P._abrir = lambda url: abiertos.append(url) or 0
    return llamadas, abiertos


URL = "https://web.whatsapp.com/send?phone=573001234567&text=hola"

# 1. WhatsApp Web ya abierto: se usa ESA pestaña (Ctrl+L, la direccion, Enter), sin abrir otra
llamadas, abiertos = escritorio({"100": "Píxel - Google Chrome", "200": "(90) WhatsApp - Google Chrome"})
r = P.whatsapp("+57 300 123 4567", "hola")
comprobar(not abiertos, "ya abierto: no abre otra pestaña", abiertos)
comprobar("xdotool windowactivate --sync 200 key --clearmodifiers ctrl+l" in llamadas and ("xdotool type --delay 6 " + URL) in llamadas,
          "carga el chat en la misma pestaña", llamadas)
comprobar(llamadas.count("xdotool windowactivate --sync 200 key --clearmodifiers Return") == 2 and r["mensaje"] == "enviado",
          "y oprime Enter dos veces en esa ventana", r)

# 2. En una pestaña de fondo: la busca con Ctrl+Shift+A y la usa
llamadas, abiertos = escritorio({"100": "Píxel - Google Chrome"}, fondo=True)
r = P.whatsapp("573001234567", "hola")     # la app ya manda el numero con su indicativo
comprobar(any("ctrl+shift+a" in x for x in llamadas) and not abiertos and any(x.startswith("xdotool type --delay 6 https://web.whatsapp.com") for x in llamadas),
          "pestaña de fondo: la trae con la búsqueda de pestañas y la usa", llamadas)

# 3. No esta abierto: pestaña nueva con xdg-open; la busqueda se cierra con Escape
llamadas, abiertos = escritorio({"100": "Píxel - Google Chrome"})
r = P.whatsapp("573001234567", "hola")     # la app ya manda el numero con su indicativo
comprobar(abiertos == [URL], "no abierto: abre una pestaña nueva", abiertos)
comprobar("xdotool key --clearmodifiers Escape" in llamadas and not any(x.startswith("xdotool type --delay 6") for x in llamadas),
          "y no escribe en ninguna otra pestaña", llamadas)

# 4. Una pestaña que solo habla de WhatsApp no vale
llamadas, abiertos = escritorio({"100": "WhatsApp - Buscar con Google - Google Chrome"})
r = P.whatsapp("573001234567", "hola")     # la app ya manda el numero con su indicativo
comprobar(abiertos == [URL] and not any("ctrl+l" in x for x in llamadas), "«WhatsApp - Buscar con Google» no se toca", llamadas)

# 5. El numero y el mensaje (la app normaliza; aqui solo se comprueba el largo)
for malo in ("123", "", "abc"):
    try:
        P.whatsapp(malo, "hola")
        comprobar(False, "número malo %r" % malo)
    except P.ErrorPuente:
        comprobar(True, "número malo %r: error" % malo)

print("TODO BIEN" if not fallos else "%d FALLO(S)" % fallos)
sys.exit(1 if fallos else 0)

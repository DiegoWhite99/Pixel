"""11 nov - Un Pixel del PC DE PRUEBA para probar el microfono del celular (Fase 11) de punta a punta.

Arranca el servidor de verdad con OTRA identidad en Firebase (no la del Pixel del usuario), puertos de
prueba (8799 y panel 8081), sin descubrimiento, sin Google ni Gemini (responde Ollama) y con todos sus
archivos en una carpeta temporal. Deja en <carpeta>/pc.json su id y el codigo de enlace, y en
<carpeta>/frase.wav una frase dicha con su voz ("Píxel, recuérdame ...") para el microfono falso de Chrome.
Al crear <carpeta>/parar (o a los 10 min) borra de Firebase todo lo de este Pixel de prueba y sale.

  .venv/bin/python tools/pc_de_prueba.py <carpeta>
  (en otra terminal) PUPPETEER=... node tools/prueba_oido.js <carpeta>
"""
import json
import os
import sys
import threading
import time
import wave

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import acciones  # noqa: E402
import nube  # noqa: E402
import servidor  # noqa: E402

FRASE = "Píxel, recuérdame tomar agua en diez minutos."


def main(carpeta):
    os.makedirs(carpeta, exist_ok=True)
    servidor.PORT, servidor.PANEL_PORT, servidor.DESCUBRIR_PORT = 8799, 8081, 0
    for nombre, archivo in (("RECORDATORIOS_ARCHIVO", "recordatorios.json"), ("EVENTOS_ARCHIVO", "eventos.json"),
                            ("AJUSTES_ARCHIVO", "ajustes.json"), ("DISPOSITIVOS_ARCHIVO", "dispositivos.json"),
                            ("CONTACTOS_ARCHIVO", "contactos.json"), ("GOOGLE_TOKEN", "google_token.json"),
                            ("GOOGLE_CLIENTE", "google_cliente.json"), ("GEMINI_CLAVE", "gemini_clave.json"),
                            ("NUBE_TOKEN", "nube_token.json")):
        setattr(servidor, nombre, os.path.join(carpeta, archivo))      # absolutas: join(BASE_DIR, x) da x
    servidor.CAPTURE_DIR = os.path.join(carpeta, "capturas")
    servidor.OBSIDIAN_BOVEDA = os.path.join(carpeta, "boveda")
    servidor.NUBE_NOMBRE = "Pixel de prueba"
    acciones._abrir = lambda url: 0
    threading.Thread(target=servidor.main, daemon=True).start()

    fin = time.monotonic() + 600
    while time.monotonic() < fin and not (nube._estado.get("conectada") and nube._estado.get("enlace") and servidor.TTS):
        time.sleep(1)
    if not nube._estado.get("enlace"):
        servidor.log("PRUEBA: no se conecto a la nube")
        return 1
    pcm = servidor.TTS.sintetizar(FRASE)
    silencio = b"\x00\x00" * servidor.SAMPLE_RATE
    with wave.open(os.path.join(carpeta, "frase.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(servidor.SAMPLE_RATE)
        w.writeframes(silencio * 2 + pcm + silencio * 5)
    pid = nube._pid()
    with open(os.path.join(carpeta, "pc.json"), "w") as f:
        json.dump({"pid": pid, "codigo": nube._estado["enlace"]["codigo"], "nombre": nube.nombre(), "frase": FRASE}, f)
    servidor.log("PRUEBA: listo (pid %s); esperando %s" % (pid, os.path.join(carpeta, "parar")))
    while time.monotonic() < fin and not os.path.exists(os.path.join(carpeta, "parar")):
        time.sleep(1)
    for ruta in ("pixeles/" + pid, "visibles/" + pid):                # lo de este Pixel de prueba, nada mas
        try:
            nube._db("DELETE", ruta)
        except Exception as e:
            servidor.log("PRUEBA: no pude borrar %s: %s" % (ruta, e))
    servidor.log("PRUEBA: borrado lo del Pixel de prueba en Firebase")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))

#!/usr/bin/env python3
"""Fase 3 - Cliente de Ollama en streaming.

Usa solo urllib (libreria estandar): no hace falta instalar nada.
Fase 11: si hay clave de Gemini, responde Gemini (gemini.py) y Ollama queda de respaldo.
"""

import json
import threading
import urllib.error
import urllib.request

import gemini

# Una sola generacion de Ollama a la vez: el modelo es uno y la CPU tambien.
# Es de modulo, no de instancia, porque cada conversacion tiene su propio Llm.
_OLLAMA = threading.Lock()

SYSTEM_PROMPT = (
    "Te llamas Píxel y eres el asistente de voz de una demo en una feria tecnológica; hablas en español. "
    "Responde en 2 a 4 frases. "
    "Sé concreto: da datos específicos como cifras, nombres, fechas o ejemplos, "
    "en vez de generalidades. "
    "Si no sabes algo o no estás seguro, dilo claramente en vez de inventar. "
    "No uses listas, viñetas, markdown ni emojis, porque tu respuesta se lee en voz alta. "
    "Tú no puedes agendar, recordar, poner música ni enviar nada: nunca digas que lo hiciste. "
    "Si te piden algo así, di que lo repitan empezando con 'agenda', 'recuérdame' o 'pon'."
)

DIAS = ("lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo")
MESES = ("enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
         "agosto", "septiembre", "octubre", "noviembre", "diciembre")


def prompt_con_fecha(hoy):
    """SYSTEM_PROMPT + la fecha de hoy, escrita en espanol (sin depender del locale)."""
    fecha = "%s %d de %s de %d" % (DIAS[hoy.weekday()], hoy.day, MESES[hoy.month - 1], hoy.year)
    return "%s Hoy es %s." % (SYSTEM_PROMPT, fecha)



class Llm:
    def __init__(self, modelo="qwen2.5:3b", host="http://127.0.0.1:11434",
                 system=SYSTEM_PROMPT, num_predict=60, temperatura=0.7,
                 max_turnos=4, keep_alive="30m", timeout=30, espera_lock=20):
        self.modelo = modelo
        self.host = host.rstrip("/")
        self.system = system
        self.num_predict = num_predict
        self.temperatura = temperatura
        self.max_turnos = max_turnos      # cuantos pares usuario/asistente recordar
        self.keep_alive = keep_alive
        self.timeout = timeout
        self.espera_lock = espera_lock
        self.historial = []               # propio de esta conversacion
        self.motor = None                 # quien dio la ultima respuesta: "gemini" u "ollama" (para el log)

    # -- utilidades -------------------------------------------------------

    def _conversacion(self, texto_usuario):
        return self.historial[-self.max_turnos * 2:] + [{"role": "user", "content": texto_usuario}]

    def _mensajes(self, texto_usuario):
        return [{"role": "system", "content": self.system}] + self._conversacion(texto_usuario)

    def _recordar(self, texto_usuario, texto):
        texto = texto.strip()
        if texto:
            self.historial.append({"role": "user", "content": texto_usuario})
            self.historial.append({"role": "assistant", "content": texto})
            sobran = len(self.historial) - self.max_turnos * 2
            if sobran > 0:
                del self.historial[:sobran]

    def _peticion(self, cuerpo, ruta):
        return urllib.request.Request(
            self.host + ruta,
            data=json.dumps(cuerpo).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )

    def calentar(self):
        """Fuerza a Ollama a cargar el modelo en RAM (evita 10 s en el 1er turno)."""
        req = self._peticion({"model": self.modelo, "keep_alive": self.keep_alive}, "/api/chat")
        with urllib.request.urlopen(req, timeout=self.timeout) as r:
            r.read()

    # -- generacion -------------------------------------------------------

    def responder(self, texto_usuario):
        """Generador: cede trozos de texto segun los va soltando el modelo.

        Con clave de Gemini responde Gemini; si falla antes de decir nada, este turno
        responde Ollama. Al terminar guarda el turno en el historial.
        """
        if gemini.activo():
            dicho = []
            try:
                for trozo in gemini.generar_stream(self.system, self._conversacion(texto_usuario)):
                    dicho.append(trozo)
                    yield trozo
            except gemini.ErrorGemini as e:
                if dicho:
                    gemini.LOG("gemini: se corto a media respuesta (%s)" % e)
                else:
                    gemini.LOG("gemini: fallo (%s); este turno responde Ollama" % e)
            if dicho:
                self.motor = "gemini"
                self._recordar(texto_usuario, "".join(dicho))
                return
        self.motor = "ollama"
        yield from self._ollama(texto_usuario)

    def _ollama(self, texto_usuario):
        if not _OLLAMA.acquire(timeout=self.espera_lock):
            raise RuntimeError("Ollama sigue ocupado tras %s s" % self.espera_lock)
        try:
            cuerpo = {
                "model": self.modelo,
                "messages": self._mensajes(texto_usuario),
                "stream": True,
                "keep_alive": self.keep_alive,
                "options": {
                    "num_predict": self.num_predict,
                    "temperature": self.temperatura,
                },
            }
            completo = []
            req = self._peticion(cuerpo, "/api/chat")
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                for linea in r:
                    if not linea.strip():
                        continue
                    dato = json.loads(linea)
                    if "error" in dato:
                        raise RuntimeError("Ollama: %s" % dato["error"])
                    trozo = dato.get("message", {}).get("content", "")
                    if trozo:
                        completo.append(trozo)
                        yield trozo
                    if dato.get("done"):
                        break

            self._recordar(texto_usuario, "".join(completo))
        finally:
            _OLLAMA.release()

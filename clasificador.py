#!/usr/bin/env python3
"""Fase 7 - Clasificador de intencion con el LLM local (Ollama).

Una llamada corta a qwen2.5:3b que devuelve solo JSON:
    {"accion": "youtube", "consulta": "..."}   o   {"accion": "ninguna"}
y corrige nombres de artistas y canciones que Whisper transcribe mal.

Tambien separa un recordatorio en que recordar y el trozo de la frase que dice
cuando; ese trozo lo interpreta recordatorios.extraer_hora().
"""

import json
import time
import urllib.request

import llm      # comparte el candado de Ollama: una generacion a la vez

PROMPT = """Clasificas frases dichas a un asistente de voz. Responde SOLO con JSON.
- Si piden poner, reproducir o buscar musica o un video: {"accion":"youtube","consulta":"..."}
- Si no (preguntas, charla, cualquier otra cosa): {"accion":"ninguna"}
La frase viene de un reconocedor de voz con errores. En "consulta" pon solo el artista y/o la cancion, o el tema del video, corrigiendo los nombres mal escritos con tu conocimiento de artistas y canciones. No incluyas "pon", "reproduce", "busca", "YouTube" ni "musica de".
Ejemplos:
reproducir Alejandro Sáncín en YouTube => {"accion":"youtube","consulta":"Alejandro Sanz"}
reproducir Alejandro San Senjito => {"accion":"youtube","consulta":"Alejandro Sanz"}
Boschandre Zepaya en YouTube => {"accion":"youtube","consulta":"Andrés Cepeda"}
Pónme la canción, buenian el rapsod y de que => {"accion":"youtube","consulta":"Bohemian Rhapsody Queen"}
pon música de Sastreo => {"accion":"youtube","consulta":"Soda Stereo"}
busca en YouTube cómo hacer arepas => {"accion":"youtube","consulta":"cómo hacer arepas"}
¿qué hora es? => {"accion":"ninguna"}
¿quién canta La Bamba? => {"accion":"ninguna"}
¿YouTube es gratis? => {"accion":"ninguna"}
cuéntame un chiste => {"accion":"ninguna"}"""


# Solo separa QUE y CUANDO: el modelo no hace cuentas con horas (con 7 claves numericas
# se inventaba "de la mañana" y convertia 7 pm en 17) y cada token de salida cuesta ~0.1 s
PROMPT_RECORDATORIO = """De una frase que pide un recordatorio o agendar un evento, separa QUÉ hay que recordar o agendar y CUÁNDO. Responde SOLO con JSON: {"texto":"...","cuando":"..."}
- "texto": lo que hay que recordar, corto y en infinitivo, sin "recuérdame" ni la fecha ni la hora. Para una alarma sin motivo: "la alarma".
- "cuando": copia literal de la parte de la frase que dice cuándo. Si no lo dice: "".
Ejemplos:
recuérdame sacar la basura en 20 minutos => {"texto":"sacar la basura","cuando":"en 20 minutos"}
avísame en media hora que apague el horno => {"texto":"apagar el horno","cuando":"en media hora"}
avísame el sábado que llame al banco => {"texto":"llamar al banco","cuando":"el sábado"}
despiértame pasado mañana a las 7 y media => {"texto":"despertarte","cuando":"pasado mañana a las 7 y media"}
pon una alarma a las 9 de la noche => {"texto":"la alarma","cuando":"a las 9 de la noche"}
recuérdame el dentista el jueves a las 4 => {"texto":"el dentista","cuando":"el jueves a las 4"}
apunta en la agenda la cena con Luis el sábado a las 8 => {"texto":"la cena con Luis","cuando":"el sábado a las 8"}
recuérdame pagar la luz => {"texto":"pagar la luz","cuando":""}"""


class Clasificador:
    def __init__(self, modelo="qwen2.5:3b", host="http://127.0.0.1:11434",
                 num_predict=40, timeout=20, keep_alive="30m"):
        self.modelo = modelo
        self.url = host.rstrip("/") + "/api/chat"
        self.num_predict = num_predict
        self.timeout = timeout
        self.keep_alive = keep_alive

    def _preguntar(self, prompt, texto, num_predict):
        """El JSON que devuelve el modelo para el texto, o None si algo falla."""
        cuerpo = {
            "model": self.modelo,
            "stream": False,
            "format": "json",
            "keep_alive": self.keep_alive,
            "options": {"temperature": 0, "num_predict": num_predict},
            "messages": [{"role": "system", "content": prompt},
                         {"role": "user", "content": texto}],
        }
        req = urllib.request.Request(self.url, data=json.dumps(cuerpo).encode("utf-8"),
                                     headers={"Content-Type": "application/json"})
        if not llm._OLLAMA.acquire(timeout=self.timeout):
            return None
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                contenido = json.loads(r.read())["message"]["content"]
            return json.loads(contenido)
        except Exception:
            return None
        finally:
            llm._OLLAMA.release()

    def clasificar(self, texto):
        """-> (dict o None, segundos). Nunca lanza: si algo falla devuelve None."""
        t0 = time.monotonic()
        d = self._preguntar(PROMPT, texto, self.num_predict)
        if not isinstance(d, dict) or d.get("accion") not in ("youtube", "ninguna"):
            return None, time.monotonic() - t0
        if d["accion"] == "youtube":
            consulta = d.get("consulta")
            d = {"accion": "youtube", "consulta": consulta.strip() if isinstance(consulta, str) else ""}
        else:
            d = {"accion": "ninguna"}
        return d, time.monotonic() - t0

    def extraer_recordatorio(self, texto):
        """-> ({"texto", "cuando"} o None, segundos). "cuando" es el trozo literal de la
        frase que dice cuando ("" si no lo dice); lo interpreta recordatorios.extraer_hora()."""
        t0 = time.monotonic()
        d = self._preguntar(PROMPT_RECORDATORIO, texto, 40)
        if not isinstance(d, dict) or not isinstance(d.get("texto"), str) or not d["texto"].strip():
            return None, time.monotonic() - t0
        cuando = d.get("cuando")
        return {"texto": d["texto"].strip(" .,"),
                "cuando": cuando.strip() if isinstance(cuando, str) else ""}, time.monotonic() - t0

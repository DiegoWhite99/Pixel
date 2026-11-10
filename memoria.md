# Asistente de voz local: diagnóstico de YouTube y Fase 5 ("Nova")

Fecha: 19 de octubre de 2026

> **Aviso sobre la sesión del ESP32 de las 15:10–15:18:** mientras se probaba con el ESP32, un proceso de medición en segundo plano ocupaba ~5 núcleos de CPU. Eso explica los tiempos de Whisper de 22–33 s y las respuestas lentas del LLM de esa sesión. El proceso se detuvo después.

---

## Parte 1. Diagnóstico de YouTube (sin cambios en el código)

### 1. Whisper `base` contra `small`, ambos con el `initial_prompt` de esa sesión

| Lo que salió en vivo | `base` | `small` |
|---|---|---|
| "Boschandre Zepaya en YouTube" | igual · 0.97 s | "Buscan 13PA en YouTube" · 2.77 s |
| "André Sepera en YouTube." | igual · 0.89 s | **"Andrés Cepeda en YouTube"** · 2.87 s |
| "Pon Queen and YouTube" | igual · 0.92 s | **"Pon Queen en YouTube"** · 2.81 s |
| "Pon música" | igual · 2.52 s | igual · 2.72 s |

`small` arregla 2 de las 4 frases, empeora 1 y tarda unas 3 veces más.

### 2. El `initial_prompt` sí se aplica

Prompt de esa sesión: `"YouTube, pon música, reproduce, busca en YouTube, Soda Stereo, Queen, Bohemian Rhapsody"`.

Comprobado en cuatro sitios:
- **Código:** se define en `servidor.py` (`STT_PROMPT`) y se pasa a Whisper en `stt.py` (`initial_prompt=self.initial_prompt`).
- **faster-whisper:** la versión 1.2.1 acepta `initial_prompt`.
- **En ejecución:** interceptando la llamada, Whisper recibe ese texto exacto.
- **El servidor de las 15:10:** ya tenía ese código; los archivos son de las 15:02 y el log de arranque lo muestra.

**Hallazgo principal:** con el prompt, cada ruido le cuesta a Whisper **9–20 s**, frente a 0.8–3.6 s sin prompt (medido con la CPU libre). Todo ese tiempo el micro está sordo. Whisper reintenta hasta 6 veces con distinta temperatura (0.0 a 1.0), y en un caso acabó escribiendo el propio prompt sobre el ruido (*"Soda Stereo, Queen, B…"*). Con una sola temperatura es rápido (1.2–2.9 s), pero devuelve basura repetida (*"la familia, la familia…"*), así que eso solo no arregla nada.

### 3. Propuestas (sin aplicar, probadas en un script aparte)

- **(a) "<algo> en YouTube" sin verbo:**
  - La regla con verbo acepta también "and" e "y" como conector: *"Pon Queen and YouTube"* buscaría "Queen".
  - Sin verbo, una frase que **termina** en "en/and/y YouTube", tiene 6 palabras o menos y no es pregunta cuenta como búsqueda: *"Andrés Cepeda en YouTube"* buscaría "Andrés Cepeda".
  - Las preguntas (*"¿Qué opinas de lo que vi en YouTube?"*, *"Cómo funciona el algoritmo de YouTube"*) siguen yendo al LLM.
  - Falso positivo conocido: *"Me gusta ver videos en YouTube"* buscaría "gusta ver videos".
- **(b) "Pon música" sin artista:** si la consulta es genérica ("música", "algo de música", "una canción", "la música"), responder por voz *"¿Qué música quieres?"* y no abrir nada. "música de Soda Stereo", "la canción Despacito" o "Queen" sí abren. Lo que se responda después ("Soda Stereo") no tendría verbo ni "YouTube", así que no abriría nada por sí solo.
- **(c) Extra, no pedida:** activar el VAD que ya trae faster-whisper (`vad_filter=True`, Silero, sin instalar nada). 3 de 4 ruidos pasan de 8–20 s a **0.01 s**. Contrapartida: una frase empeoró (*"André Sepera"* → *"y Receptera"*).

---

## Parte 2. Fase 5: palabra de activación "Nova"

### Cambios en `servidor.py`

- Constantes al inicio del bloque de parámetros:
  - `ACTIVACION = "Nova"`
  - `ACTIVACION_VARIANTES = ("nova", "nueva", "noba", "no va", "nobá")`
  - `ACTIVACION_PREFIJOS = ("oye",)`
  - `ACTIVACION_RESPUESTA = "Dime"`
  - `ACTIVACION_VENTANA_S = 8.0`
- El `initial_prompt` se arma con la constante: ahora es `"Nova, YouTube, pon música, reproduce, busca en YouTube, Soda Stereo, Queen, Bohemian Rhapsody"`.
- Filtro entre Whisper y acciones/LLM:
  - **Sin "Nova":** imprime `ignorada (sin Nova): <texto>` y no hace nada más.
  - **"Nova" + texto:** quita la palabra y procesa el resto como antes (acciones primero, LLM después).
  - **"Nova" sola:** responde "Dime" y abre una ventana de 8 s en la que la siguiente frase no necesita "Nova".

### Decisiones tomadas

- A las frases ignoradas no se les envía nada al ESP32, ni siquiera `0x03`.
- La ventana empieza cuando termina de sonar "Dime" (estimado), y una frase entra si **empieza** dentro de ella.
- La ventana vale para una sola frase.

### Prueba con audio, sin el ESP32

El "Hola" es una grabación real del ESP32; lo demás es voz de Piper.

| Audio | Lo que entendió Whisper | ¿Activó? | Qué hizo |
|---|---|---|---|
| "Nova, pon música de Queen en YouTube" | "Nova, pon música de **Kenon**, YouTube." | sí | abrió *"Zarcort - Olvidate Ft. Xenon"*: equivocado |
| "Hola" (real) | "Hola" | no | ignorada |
| "Hola, ¿cómo estás?" | igual | no | ignorada |
| "Nova." | **"Roa!"** | no | ignorada: Whisper no la entendió |
| "Nueva, ¿qué hora es?" | "Nova, **Goddess**" | sí | el LLM recibió "Goddess" |
| "Oye, Nova." (2ª prueba) | "Oye, Nova" | sí, sola | **"Dime"** y ventana de 8 s |
| "¿Cuál es la capital de Francia?" (~3.6 s después de "Dime") | igual | por la ventana | *"La capital de Francia es París."* |
| "¿Y cuántos habitantes tiene?" | "y cuántos habitantes tienen." | no | ignorada: la ventana ya se usó |

### Otras pruebas

- **Detección sobre texto:** 15 de 15 frases bien. Dos falsos positivos que vienen de las variantes pedidas: *"Nueva York…"* y *"No va a llover…"* activan.
- **Ventana con un Whisper simulado:** una frase que empieza a los 7.5 s se procesa; a los 8.5 s, no; un segundo uso no vale.
- **Ruido real:** con "Nova" en el prompt, en 16 ruidos reales Whisper no escribió nada y "Nova" no se activó. Aun así, 5 de ellos tardaron 13.6–23.8 s.

### Punto débil: "Nova" dicha sola

De 6 formas de decirla (voz de Piper), Whisper entendió 3 (*"Nova."*, *"Nova,"*, *"Oye, Nova."*). Las otras salieron como *"Nord"*, *"Loa!"* y *"Lola, yeah, Nova."*. Con voz real puede ir mejor o peor: hace falta probarlo con el ESP32.

---

## Pendientes

- **Pestañas de Chrome de las pruebas, sin cerrar:** el sistema de permisos bloqueó mandar teclas a Chrome. Quedan abiertas: el karaoke de Bohemian Rhapsody, la de "Nimalito" (probablemente ahora muestra la webcam de Boston), 2 de Soda Stereo, Bohemian Rhapsody subtitulado y Zarcort. Se pueden cerrar a mano. Hubo un script para cerrar el karaoke y la de Nimalito/Boston, pero estaba en una carpeta temporal de la sesión que puede ya no existir.
- **Estado del servidor:** corriendo con la Fase 5 en el puerto 8765 y con el ESP32 conectado. Falta la confirmación con hardware real.

---

# Actualización 16:41: muestras de voz y clasificador solo como respaldo

Fecha: 19 de octubre de 2026

## Parte 1. Voces de Piper en español

La voz del servidor **no se cambió**; sigue siendo `es_MX-ald-medium`. Falta elegir una.

| Voz | Calidad | Tamaño |
|---|---|---|
| es_AR-daniela-high | high | 108.9 MB |
| es_MX-claude-high | high | 60.2 MB |
| es_ES-davefx-medium | medium | 60.3 MB |
| es_ES-sharvard-medium (2 hablantes: M y F) | medium | 73.2 MB |
| es_MX-ald-medium **(la actual)** | medium | 60.3 MB |
| es_ES-mls_10246-low / es_ES-mls_9972-low | low | 60.2 MB c/u |
| es_ES-carlfm-x_low | x_low | 26.8 MB |
| es_MX-ald-x_low | x_low | 20.0 MB |

Se descargaron las dos "high" y las dos "medium" de España en `./voces_prueba/modelos/`. Los WAV de prueba están en `./voces_prueba/`, a 16 kHz (tal como los recibiría el ESP32), e incluyen la voz actual como referencia.

Texto usado: *"Hola, soy Nova, el asistente de voz de esta demo. Funciono cien por ciento en local, sin conexión a la nube."*

| WAV | Síntesis | Audio | Velocidad |
|---|---|---|---|
| es_MX-ald-medium (actual) | 0.79 s | 7.4 s | 9.3× tiempo real |
| es_MX-claude-high | 0.78 s | 7.5 s | 9.6× |
| es_AR-daniela-high | **3.07 s** | 5.3 s | **1.7×**, la más lenta |
| es_ES-davefx-medium | 0.62 s | 5.6 s | 9.0× |
| es_ES-sharvard-medium_M | 0.71 s | 6.5 s | 9.1× |
| es_ES-sharvard-medium_F | 0.85 s | 6.4 s | 7.5× |

Con `daniela-high`, la primera frase de cada respuesta tardaría algo más en sonar. Las demás van igual de rápidas que la actual.

Para escucharlas, de una en una:

```
cd /home/diego/pixel-asistente-voz && for f in voces_prueba/*.wav; do echo "$f"; aplay -q "$f"; sleep 0.5; done
```

## Parte 2. Clasificador: corrección solo si no hay resultados

### Cambios

- Cuando la regex detecta la acción, se busca en YouTube con la consulta original y **no se llama al clasificador**. Solo si YouTube no da resultados se le pide la corrección del nombre y se busca otra vez (`acciones.CORRECTOR`, que el servidor conecta al arrancar).
- Si la regex no detecta nada, decide el clasificador, como antes.
- Ejemplo nuevo en el prompt: *"¿quién canta La Bamba?"* → ninguna. Se eligió otra canción a propósito, para que la prueba con *Bohemian Rhapsody* no estuviera copiada del prompt.

### Los 5 errores que antes empeoraban

| Frase (con "Nova, …") | Vía | ¿Clasificador? | Video que abriría | Latencia |
|---|---|---|---|---|
| pon algo de Chakira | clasificador¹ | sí (deja "Chakira") | Shakira - Las de la Intuición ✓ | 4.18 s |
| reproduce Carlos Bives | regex | **no** | Carlos Vives - Cumbiana ✓ | 1.53 s |
| pon Ricardo Arijona en YouTube | regex | **no** | Ricardo Arjona - Acompáñame a Estar Solo ✓ | 1.96 s |
| pon la canción Despasito | regex | **no** | Luis Fonsi - Despacito ✓ | 1.59 s |
| pon música de Kenon, YouTube | regex | no | Xenon y Droow - Equilibrio ✗ | 1.72 s |

¹ Las reglas no la detectan porque "algo de" no es una de sus palabras de música; decide el clasificador.

### Frases reales del ESP32

| Frase | Vía | ¿Clasificador? | Video que abriría | Latencia |
|---|---|---|---|---|
| No va a reproducir Alejandro Sáncín en YouTube | regex | **sí**: sin resultados → "Alejandro Sanz" | Alejandro Sanz ~ Grandes Sucessos ✓ | 5.33 s |
| No va a reproducir Alejandro San Senjito | regex | **sí**: sin resultados → "Alejandro Sanz" | Alejandro Sanz ~ Grandes Sucessos ✓ | 4.98 s |
| Nova reproducen YouTube a Alejandro Sanz | regex | no | Alejandro Sanz ~ Grandes Sucessos ✓ | 1.59 s |
| Nova, pon, Iron Maiden en YouTube | regex | no | Iron Maiden - The Trooper ✓ | 1.87 s |
| Nova, Pong Queen, YouTube | clasificador | sí → "Queen YouTube" | Queen – Bohemian Rhapsody ✓ | 4.49 s |
| Nova, ¿cómo funcionas? | clasificador | sí → ninguna | va al LLM | 2.01 s + 0.16 s de 1er token |
| Nova, ¿qué es YouTube? | clasificador | sí → ninguna | va al LLM | 2.00 s + 1.02 s de 1er token |
| Nova, ¿quién canta Bohemian Rhapsody? | clasificador | sí → **youtube** ✗ | abriría Bohemian Rhapsody | 5.04 s |

La latencia se mide desde que termina Whisper hasta que se abriría el video. En las pruebas no se abrieron pestañas (`xdg-open` sustituido); la búsqueda en YouTube sí era real.

### Resultado

- Desaparecen las dos correcciones que estropeaban la búsqueda (Carlos Vives y Arjona).
- Los casos de Alejandro Sanz se siguen arreglando.
- Las acciones detectadas por regex abren en **1.5–2.0 s** (antes ~4.5 s). Cuando hace falta corregir, ~5 s.
- *"Kenon"* sigue abriendo un video equivocado.

### Lo que no funcionó

El ejemplo nuevo no bastó: *"¿quién canta Bohemian Rhapsody?"* sigue saliendo como acción, porque el modelo de 3B no generaliza el patrón desde un solo ejemplo.

**Propuesta (no aplicada):** una regla que mande al LLM, sin pasar por el clasificador, las preguntas que empiezan por *quién/qué/cuál/cómo* y no llevan un verbo de acción.

## Pendientes

- Elegir la voz entre las muestras de `./voces_prueba/`.
- Decidir si se aplica la regla para las preguntas tipo *"¿quién canta X?"*.
- Estado del servidor: corriendo en el puerto 8765 con estos cambios, con el ESP32 conectado.

---

# Actualización 20 de octubre: palabra de activación, ruido y voz

Fecha: 20 de octubre de 2026. Solo mediciones; no se cambió el código.

## Por qué falla "Nova"

De 15 frases reales del ESP32 que el log marcó como "No, no.", "Noa" o "Ainoa", 12 eran "Nova" dicha sola. Whisper `base` las escribe "No, no.", "Noa" o "Noah", y `small` acierta solo 4. Empieza por "No", la palabra más común del español, y la "v" entre vocales casi no suena por el INMP441.

## Candidatas (Piper → Whisper `base` con el `initial_prompt` del servidor)

4 voces (ald, claude, davefx, sharvard F) × 3 frases ("W.", "W, ¿qué hora es?", "W, pon música de Queen en YouTube.") × 2 condiciones (limpio; ruido real del ESP32 a 10 dB y habla un 10% más rápida) = 24 audios por palabra. Falsas activaciones: 12 audios reales del ESP32 sin la palabra (4 de ruido y 8 de charla) transcritos con cada prompt.

| Palabra | Aciertos | Dicha sola | Falsas activaciones | Fallos típicos |
|---|---|---|---|---|
| Píxel | 23/24 | 7/8 | 0/12 | "Vincent" |
| Cronos | 23/24 | 8/8 | 1/12 (en ruido) | "¡Pero los" |
| Diver ("díver") | 22/24 | 6/8 | 0/12 | "Lilo de" |
| Kepler | 22/24 | 6/8 | 1/12 (en ruido) | "Te lo", "y ahora" |
| Tesla | 21/24 | 6/8 | 0/12 | "Vesa", "Tes las" |
| Nova | 20/24 | 6/8 | 0/12 | "No aciones", "Nuevo", "No!" |
| Jarvis | 20/24 | 5/8 | 0/12 | "Paris", "Carvis", "Curtis" |
| Dáiver (Diver a la inglesa) | 18/24 | 4/8 | — | "Dáiler", "Budá" |
| Galileo | 18/24 | 5/8 | 0/12 | "Cada idea", "Vale, Leo" |

Con voz sintética "Nova" acierta 20/24, pero con voz real falla mucho más: esta prueba es optimista y hay que confirmar con el ESP32. Cronos y Kepler aparecieron en ruido porque Whisper copia el prompt.

## Ruido que llega a Whisper

- De 370 frases del 19 de octubre, 262 (71%) eran ruido: Whisper no sacó texto. Le costaron 516 s en total, con mediana de 0.9 s y máximo de 37 s, y todo ese tiempo el micro estuvo sordo.
- El VAD Silero que ya trae faster-whisper (`faster_whisper.vad.get_speech_timestamps`, umbral 0.35), usado solo como filtro antes de Whisper, descarta 244 de los 262 ruidos en ~4 ms por frase. De 76 frases con texto descarta 5, y las 5 eran alucinaciones ("No, no, no.", "¿Qué pasa?" con 8.8 s de STT).
- Un umbral de pico no sirve: la ganancia cambia mucho entre sesiones (pico de sesión de 2156 a 26193).

## Otros problemas de turnos vistos en el log

- Respuestas del LLM de 9 a 20 s de voz (mediana de 161 caracteres, máximo 513), sin forma de interrumpirlas.
- Un "No, no." dentro de la ventana de "Dime" fue al LLM, que contestó 12 s sobre "ponumbia" y "plexio" de turnos anteriores: el historial arrastra basura.
- Los títulos de YouTube se leen enteros: "(Official Video)", "[Official Audio]", "DDJ 400 PIONEER DJ".

## Cambios aplicados (20 de octubre)

- **Palabra de activación: "Píxel".** Se quitaron las variantes de "Nova" ("nueva", "no va", "No, …"), que solo existían por lo mal que Whisper la entendía. Con la lista vacía, `_regex_palabras` devuelve una regex que nunca coincide. Falta confirmarla con voz real en el ESP32.
- **Filtro de ruido Silero antes de Whisper** (`Transcriptor.hay_voz`, `STT_VAD_UMBRAL = 0.35`). En el log aparece como `RUIDO: Silero no oye voz…`; se manda `0x03`, igual que cuando Whisper no sacaba texto. Deja pasar las 13 frases reales de "Nova" dicha sola.
- **Modo reposo:** a los `REPOSO_S = 120` s desde el fin de la última respuesta a una frase aceptada, dice *"Veo que no hay interacción. Entro en modo reposo."* y borra el historial del LLM. Solo una vez por conversación.
- **Títulos de YouTube limpios:** se quita lo que va entre paréntesis o corchetes, los hashtags y lo que sigue a `|` o `//`.
- Prueba completa con `tools/cliente_prueba.py` en el puerto 8799: el ruido se descartó en 10 ms, "Píxel, ¿cuál es la capital de Francia?" respondió "La capital de Francia es París." y el reposo (acortado a 10 s para la prueba) sonó y borró 2 mensajes.

## Pendientes

- Confirmar "Píxel" con voz real: decirla unas 10 veces sola y 10 con una orden, y revisar el log y `capturas/`.
- Elegir la voz entre las muestras de `./voces_prueba/`.

## Voz femenina (20 de octubre, 14:54)

Voces femeninas de Piper en español, identificadas midiendo el tono (180-209 Hz). La síntesis va hasta el PCM de 16 kHz, mediana de varias corridas. "Sin carga" es con la CPU libre; "con carga", con la prueba de Whisper corriendo.

| Voz | Calidad | Sin carga | Con carga | Whisper `small` sobre la muestra |
|---|---|---|---|---|
| es_ES-sharvard-medium (F) | medium | 0.30 s | 0.79 s | perfecta |
| es_MX-claude-high | high | 0.31 s | 1.22 s | "funcionó" por "funciono" |
| es_AR-daniela-high | high | 1.35 s | 4.61 s | "del Estadema", "la NUE" |
| es_ES-mls_10246-low / mls_9972-low | low | 0.47-0.52 s | — | ilegibles; 57% de silencio |

Se aplicó **es_ES-sharvard-medium, hablante F**: es la más ligera y se entiende bien. `Tts` acepta ahora `hablante` (nombre del `speaker_id_map`). Para es_ES no existe calidad high.

## Medición del reconocimiento (20 de octubre, 14:36-16:44)

**Referencia.** `large-v3-turbo` con beam 5, sin prompt. Las transcripciones del log no sirven, porque son del mismo `base`. La referencia también falla con "Nova" (escribe "Noa", "Noah", "No va") y con "Píxel" ("Fixen", "Bixen"), así que para la palabra de activación se aceptan esas variantes en la referencia y no en la hipótesis.

**Grupos.** *Voz real* = Silero oye voz, pico ≥ 3000, al menos 100 ms con RMS > 1000 y la referencia escribe algo: 102 frases, 53 con la palabra (42 Nova, 11 Píxel). *Ruido o silencio*, donde solo se mide el tiempo: 63 audios que pasan el filtro Silero (casi todos "Gracias." inventados) y 105 de los 330 que Silero descarta.

**Métricas.** Acierto y WER se calculan sin la palabra de activación. Beam 1, 8 hilos. Los tiempos con temperatura única (t0) se midieron aparte, con el servidor en reposo.

| Modelo | Prompt | vad_filter | Temp. | Acierto | WER | Cortas | Nombres | Píxel | Palabra (total) | Voz mediana / p90 | Ruido que pasa Silero: media / máx |
|---|---|---|---|---|---|---|---|---|---|---|---|
| base (actual) | sí | no | reintentos | 28% | 58% | 39% | 65% | 11/11 | 35/53 | 0.82 / 2.00 s | 6.85 / 24.6 s |
| base | sí | sí | reintentos | 29% | 61% | 39% | 65% | 11/11 | 36/53 | 0.81 / 1.19 s | 5.46 / 33.1 s |
| base | no | no | reintentos | 17% | 76% | 22% | 55% | 4/11 | 4/53 | 0.88 / 3.06 s | 2.58 / 14.1 s |
| base | no | sí | reintentos | 16% | 79% | 22% | 56% | 3/11 | 3/53 | 0.87 / 3.01 s | 1.98 / 7.5 s |
| base | sí | sí | 0 | 27% | 51%* | 37% | 63% | 11/11 | 34/53 | 0.61 / 0.65 s | 0.74 / 1.9 s |
| small | sí | no | reintentos | 43% | 46% | 49% | 75% | 11/11 | 44/53 | 2.46 / 3.02 s | 4.99 / 41.8 s |
| small | sí | sí | reintentos | 43% | 44% | 47% | 80% | 11/11 | 42/53 | 2.35 / 2.99 s | 4.40 / 38.1 s |
| small | no | no | reintentos | 25% | 68% | 25% | 73% | 8/11 | 9/53 | 2.46 / 3.54 s | 4.55 / 26.6 s |
| small | no | sí | reintentos | 24% | 67% | 24% | 73% | 8/11 | 9/53 | 2.49 / 3.44 s | 4.11 / 30.3 s |
| **small** | **sí** | **sí** | **0** | **42%** | **44%** | **45%** | **80%** | **11/11** | **42/53** | **1.77 / 1.90 s** | **1.62 / 5.2 s** |

\* `base` con temperatura 0 se desboca en 5 de 102 frases ("un chico, un chico, …", 112 palabras). Sin tope por frase, su WER es 385%. `small` con temperatura 0 no se desbocó ninguna vez.

- **El prompt es imprescindible:** sin él, "Píxel" se detecta 3-8 veces de 11 y la palabra en total 3-9 de 53. También mejora las frases cortas.
- **vad_filter casi no cambia el acierto:** sobre el ruido crudo baja el tiempo de 3.6 s a 0.01 s, pero eso ya lo hace el filtro Silero del servidor.
- **Lo que hace sordo al micro son los reintentos de temperatura:** con temperatura 0, el máximo en el ruido que pasa Silero baja de 24.6-41.8 s a 1.9-5.2 s.
- **Recomendación:** `small` + prompt + `vad_filter=True` + `temperature=0`. Sin aplicar todavía.

---

# Actualización 21 de octubre: diagnóstico del micro y cambios de software

Fecha: 21 de octubre de 2026.

## El micro no está muerto, pero oye apagado

- **Sketch de diagnóstico** (I2S estéreo, misma escala que el `pico=` del log: muestra de 32 bits `>> 16`): canal izquierdo con un piso de RMS de 80–370; canal derecho, 0. El pin L/R está bien a GND y el piso es igual al de las sesiones del 19 y 20 (piso calibrado 47–507).
- **El "pico de 126" que circulaba** no era del micro: era el `piso de ruido=126` de la sesión del 20 oct a las 14:54, o el aviso de pico bajo de una conexión que duró 2 s.
- **Falta lo agudo.** Porcentaje de la energía de la voz (frases con Silero ≥ 0,5):

| | 1–3 kHz | 3–8 kHz |
|---|---|---|
| Piper a 16 kHz (referencia) | 5–26 % | 1–3 % |
| ESP32, 19 oct (128 frases) | 0,20 % | 0,00 % |
| ESP32, 20 oct (186 frases) | 0,14 % | 0,01 % |
| ESP32, 21 oct | 0,34 % | 0,00 % |

Le faltan unos 20 dB por encima de 1 kHz desde el primer día. Explica que se pierdan consonantes ("reprusa" por "reproduce", "Bíxel", "Mezcuchas"). Lo más probable es que algo tape el puerto acústico del INMP441, o que esté dañado.

## Prueba con el servidor (09:44–10:18)

- 12 frases activadas: **5 bien** (Marc Anthony, Eddie Santiago, "cuéntame una historia", Killing in the Name, Black Summer) y 7 mal. Tres abrieron un vídeo equivocado por correcciones del clasificador: "Mezcuchas" → "Mezcal Chistes", "reprusa en el maiden" → "Replusion Maiden" (escena de terror), "Reyhad Chili Peppers" → campeón de comer chiles.
- Las que salen bien empiezan por un verbo bien oído; cuando el verbo llega roto decide el clasificador, y suele fallar.
- "Píxel" falló como "Bíxel" y una vez quedó en medio de la frase ("La Recepción, Píxel, …"), que no cuenta.
- Whisper con reintentos: 7 frases de ruido o música le costaron entre 11,8 y 16,2 s cada una, con el micro sordo. También salieron bucles ("Vio, Vio, …") y basura con letras coreanas y rusas.
- El ESP32 reconectó 4 veces en 6 minutos (09:44–09:50), una tras solo 2 s de audio. Falta ver en el Serial Monitor si se reinicia.
- La música de los vídeos abiertos por el asistente, sonando cerca del micro, dispara frases sin parar.

## Cambios aplicados (10:26)

- **`STT_TEMPERATURA = 0.0`** y **`STT_MAX_COMPRESION = 2.4`**: sin reintentos, y se descartan los segmentos con compresión > 2,4 (bucles). Con las capturas de hoy, las 7 frases que costaban 11,8–16,2 s pasan a ~1,8 s y salen vacías; las órdenes salen con el mismo texto en 0,5–0,7 s.
- **`ACTIVACION_VARIANTES = ("bixel",)`**.
- **El clasificador solo puede decidir YouTube si la frase suena a pedido** (`acciones.hay_pedido`): un verbo de acción en cualquier parte, incluidas las formas rotas de "reproduce" (`rep(r|ar)…`), "quiero", YouTube o una palabra de música. Con las frases de hoy: "Mezcuchas", "de Reyhad Chili Peppers" y "¿quién canta Bohemian Rhapsody?" van al LLM. Contrapartida: "Kero, Killing in the Name…", que antes acertó, también va al LLM.

## Pendientes

- Revisar el puerto acústico del INMP441 o cambiarlo, y repetir la medición de bandas.
- Averiguar las reconexiones del ESP32.
- Probar `small` (+1,2 s por frase, acierta más según la tabla del 20 oct).
- El clasificador sigue corrigiendo mal nombres cuando sí hay pedido ("Mark Ronson" por "Marc Anthony", "Radcliffe" por "Red Hot").
- Medir los tokens/s de Ollama (el "6 tokens/s" no está medido aquí). LLM: primer token en 4 s.

## Más cambios (10:47)

- `hay_pedido` acepta cualquier palabra que empiece por "rep" ("Reporo, Sequín, stun").
- "Píxel" activa también justo después de un verbo de acción: "Reproduce, Píxel, reproduce Bohemian Rhapsody" → "Reproduce Bohemian Rhapsody"; "Pon, Píxel, Queen" → "Pon Queen".
- En vivo tras el reinicio de las 10:26, Whisper tardó 2,3 s como máximo en las frases que no sacaron texto (antes, hasta 16,2 s). "Kingston Town" necesitó 6 intentos ("Queen, Stun, Town"…): el problema que queda son las consonantes.
- Velocidad de Ollama medida: lee el prompt a ~1300 tok/s y genera a ~9–10 tok/s (no 6).

---

# Fase 7, parte 1: recordatorios locales (21 de octubre)

## Diseño

- Tres acciones, por regex y antes que YouTube: `recordatorio` (recuérdame, recuerda, avísame, despiértame, alarma…), `ver_recordatorios` y `borrar_recordatorio`.
- **Primer intento descartado:** qwen2.5:3b devolvía 7 claves (en_minutos, día, hora, minuto, periodo…). Con 10 frases falló en 4 cosas: se inventó "de la mañana" en "mañana a las 3" y en "alarma a las 5", convirtió "7 de la tarde" en 17 y contó "en una hora" dos veces. Además tardaba ~5 s, porque ~39 tokens de salida a 9 tok/s son 4,5 s.
- **Diseño final:** el 3B solo devuelve `{"texto", "cuando"}` (~2–2,5 s; en frío 7,5 s, por eso se calienta al arrancar). `recordatorios.extraer_hora()` interpreta el "cuando" con reglas y `resolver()` calcula la fecha. Las horas de 1 a 6 sin "de la mañana" se toman como de la tarde, salvo "despiértame"; sin día, la próxima vez que llega esa hora.
- Los ejemplos del prompt son distintos de las frases de prueba.

## Prueba sin ESP32

Servidor aislado en el puerto 8799; frases con la voz davefx de Piper, enviadas con `tools/cliente_prueba.py`.

| Frase | Whisper | Texto | Hora | Respondió |
|---|---|---|---|---|
| recuérdame comprar café en 10 minutos | "recuerda me comprar café en 10 minutos" | comprar café | hoy 11:12 | "Listo, te recuerdo comprar café el miércoles 21 a las 11 y 12 de la mañana." |
| recuérdame la reunión mañana a las 3 | "recuerda a mi la reunión mañana a las tres" | reunión | jueves 22, 15:00 | "Listo, te recuerdo reunión el jueves 22 a las 3 de la tarde." |
| ponme una alarma a las 5 | "pon una alarma a las 5" | la alarma | hoy 17:00 | "Listo, te recuerdo la alarma el miércoles 21 a las 5 de la tarde." |
| avísame el viernes a las 7 de la tarde que llame a mamá | "…a la **sete** de la tarde…" | llamar a mamá | — (no entiende "sete") | "¿Para cuándo te recuerdo llamar a mamá? Dímelo con la hora…" |
| recuérdame tomar agua en 1 minuto | "recuerda me tomar agua en un minuto" | tomar agua | 11:04:17 | confirmación, y **a las 11:04:17 en punto** beep + "Recordatorio: tomar agua." |
| ¿qué recordatorios tengo? | "que recordato Dios tengo" | — | — | "Tienes 3 recordatorios: comprar café, …; la alarma, …; y reunión, …" |
| borra el recordatorio del café | igual | — | — | "Listo, borré el recordatorio de comprar café." |
| ¿qué recordatorios tengo? (2ª vez) | "¿qué recorda tu alió este himo?" | — | — | fue al LLM: Whisper la destrozó |

## Pendientes

- "sete" (7 en portugués): el asistente pregunta la hora en vez de fallar en silencio.
- Texto sin artículo a veces ("te recuerdo reunión").
- ~~Probarlo con el ESP32 y voz real.~~ Hecho a las 11:15: "Píxel" → "Dime" → "…ir a comprar café en 2 minutos" → confirmó y disparó a las 11:17:03 en punto. Antes falló dos veces porque Whisper escribió "Recordamente" y "recordame": ahora una palabra que empiece por record/recuerd/acuerd cuenta como recordatorio si la frase dice cuándo ("¿recuerdas la capital de Francia?" sigue yendo al LLM).

---

# Fase 7, parte 2: Google Calendar y Gmail (21 de octubre)

Código listo y probado con un Google falso. Faltan las credenciales: los pasos de la consola los hace el usuario.

## Diseño

- `servicios_google.py`, solo stdlib (OAuth de escritorio con PKCE y 127.0.0.1). Alcances mínimos: `calendar.events.owned` y `gmail.send`, ambos "sensibles". `gmail.readonly` y `gmail.compose` son "restringidos" y exigen auditoría.
- En modo Testing la autorización caduca a los 7 días: hay que reautorizar en la semana de la feria.
- Recomendado: una cuenta de Gmail solo para la demo.
- Correo: solo a `contactos.json`. Lee el borrador en voz alta y espera 20 s. Solo "envíalo" o "mándalo" lo envían; cualquier otra frase con voz cancela; el silencio caduca y lo avisa.

## Prueba con Google falso (servidor aislado en el puerto 8799, voces de Piper)

| Frase | Resultado |
|---|---|
| agenda la reunión con Ana mañana a las 3 | crear_evento("Reunión con Ana", 22 oct 15:00–16:00). "Listo, agendé reunión con Ana el jueves 22 a las 3 de la tarde." |
| ¿qué tengo mañana en el calendario? | "Mañana tienes 2 eventos: todo el día, Cumpleaños de Ana; y a las 10 de la mañana, Dentista." |
| manda un correo a Ana diciendo… + "Sí, mándalo" | lee el borrador, **CONFIRMADO**, envío falso a ana@ejemplo.com, "Listo, correo enviado a Ana." |
| … + "No, mejor no" | NO CONFIRMADO, "De acuerdo, no envío el correo." |
| … sin respuesta | CADUCADA a los 20 s, "No me confirmaste, así que no envío el correo." |
| … a Pedro (no está en contactos) | "No tengo a Pedro en los contactos." |
| … + "Sí, envíalo" (dos veces) | Whisper escribió "Tee en B0" y "Sí, en míralo": **no envió** (cancelar es lo seguro) |

- **"Sí, envíalo" se transcribe mal:** 1 de 4 voces de Piper salió bien ("en Bídello", "en Villalo", "en Bilalo"). "Sí, mándalo": 3 de 4.
- Whisper juntó "Ana diciendo" en "analiciendo" / "anariciendo"; con una pausa tras el nombre sale bien.
- En el borrador, "llego tarde" salió como "llevo tarde": leerlo antes de enviar sirve.

## Pendientes

- Credenciales y primera autorización; probar con Google de verdad.
- Decidir qué frase pide el borrador ("sí, envíalo" o "sí, mándalo").
- Filtro de palabras para lo que el asistente repite en voz alta: a las 11:21 Whisper oyó "Recuerda matarme en tres minutos" y lo confirmó y lo dijo tal cual.
- Ajustar "funciono 100% en local" en el prompt del LLM: calendario y correo pasan por Google.

## Calendario local (12:20)

- Crear la cuenta de Google se complicó (la personal está en recuperación, con 6 h de espera; crear una nueva pedía demasiados datos). Se decidió: calendario **local** ya, y correo cuando se recupere la cuenta personal (opción fácil: contraseña de aplicación por SMTP, sin consola de Google).
- Sin Google, "agenda X mañana a las 3" guarda en `eventos.json` y "¿qué tengo mañana?" lee esos eventos **y** los recordatorios del día. Con Google autorizado, las mismas frases usan Google Calendar.
- Prueba de texto: "agenda la reunión con Ana mañana a las 3", "anota en el calendario el dentista el viernes a las 10 y media", "apunta el cumpleaños de Sofía el domingo a las 5 de la tarde" y "pon en el calendario la cena con mis papás el sábado a las 8 de la noche" quedan bien, y "¿qué tengo mañana / el viernes / el domingo?" los lee. El modelo dejaba "anotar en el calendario" como título: se añadió un ejemplo al prompt y se quita en el código.
- Los eventos locales no avisan a su hora (los recordatorios sí). Todavía no se pueden borrar eventos por voz.
- El LLM fingía acciones: ante "General Menarro Nión para mañana a las 3 de la tarde" (era "agenda una reunión…") dijo "está programado para mañana a las 3", sin guardar nada. Se añadió al prompt de sistema que no puede agendar, recordar, poner música ni enviar, y que pida repetirlo con "agenda", "recuérdame" o "pon". Ahora responde, por ejemplo, "Agenda una cita con tu médico para el lunes."

---

# Fase 8: panel de administración y portal WiFi (21 de octubre, tarde)

- **Panel** (`panel.py`, `panel.html`) en `http://192.168.1.216:8080`, dentro del servidor. Pestañas:
    - Inicio: estado, lo último que oyó.
    - Dispositivos: ESP32 conectados en vivo, cómo añadir uno con el portal y Bluetooth como "próximamente".
    - Cuentas: Google, contactos del correo.
    - Agente: 6 voces instaladas, personalidad con plantillas, respuesta corta o normal, "Guardar y probar" en el ESP32.
    - Agenda: recordatorios y eventos con borrar.
- **Probado con un servidor aislado** (puertos 8799 y 8081) y un ESP32 simulado: guardar el agente (se aplica sin reiniciar), probar la voz (sonó con la voz nueva), añadir un contacto válido y rechazar uno malo, borrar un recordatorio creado por voz, y vincular Google sin credenciales (error claro).
- **Personalidad:** "corta" acorta las respuestas. El estilo (formal, entusiasta) apenas se nota con el 3B, y el 3B se inventa datos ("ESP32 con ARM Cortex-M4 y 256 MB de RAM").
- **Bluetooth:** el ESP32-S3 solo tiene BLE: sirve para configurar, no para audio. Queda como "próximamente".
- **Firmware con portal WiFi** (`~/Arduino/Pixel_portal/Pixel_portal.ino`): compila (73 % de la flash), con volumen de fábrica 1.0 como el firmware en uso. **Sin subir:** el Serial Monitor del IDE tenía ocupado `/dev/ttyUSB0`.
- **Bluetooth (16:05):** el firmware `Pixel_portal.ino` con BLE está subido. El ESP32 se anuncia como **Pixel-877C**, y en la primera búsqueda vio 20 dispositivos (de −71 a −86 dBm), casi todos sin nombre: los móviles y relojes no suelen anunciarlo. Ocupa 1,20 MB, el 91 % de la partición por defecto. Falta comprobar que la voz sigue igual de bien con el Bluetooth buscando cada 30 s.
- **Para subir el firmware hay que cerrar el Arduino IDE:** su Monitor Serie se reabre solo y ocupa `/dev/ttyUSB0` (dio "busy" tres veces). Al final se cerró el proceso del monitor justo antes de subir.
- **Buscar y aceptar (16:20):** el panel tiene "Buscar dispositivos", que espera la siguiente lista Bluetooth del ESP32, con "Aceptar" por dispositivo y "Mis dispositivos" para ver si están cerca o no. Probado con el ESP32 real: se aceptó 21:39:e2:3a:50:ae como "Prueba" (cerca, −70 dBm), salió marcado en la lista, se olvidó, y `dispositivos.json` quedó vacío. Sin cambios de firmware.
- **Conectar aparatos (16:27):** el ESP32-S3 no puede (solo BLE), pero el PC sí: tiene Bluetooth y PulseAudio con módulo Bluetooth. `bluetooth_pc.py` y su tarjeta en el panel encienden, buscan, emparejan, conectan, olvidan, mandan la música a un altavoz y hacen visible el PC para el móvil. Al encender el Bluetooth del PC (estaba bloqueado por rfkill), el **MOVISUN EGG NEO+**, ya emparejado antes, se conectó solo y PulseAudio lo puso como salida: el audio del PC sale por él. La búsqueda encontró además BOGAMALT45M, BOGCTCALT8JM y "coe3".
- Pendiente: marca de las luces o enchufes WiFi para integrarlos; decidir si la voz de Píxel también sale por el altavoz Bluetooth.
- **Voz por el altavoz Bluetooth (16:32):** opción "Por dónde habla" en el panel (ESP32 o altavoz del PC). Activada a petición del usuario: "Probar voz" sonó por el MOVISUN (en PulseAudio, el canal "Pixel · voz" va al sink bluez del MOVISUN) y el micro reabrió 3,16 s después, con la latencia del Bluetooth (0,4 s) sumada. No se ofrece "por los dos" porque se oiría con eco. Falta confirmar con voz real que el micro no capta el final de la respuesta si el altavoz está cerca del ESP32.
- Confirmado por el usuario: la prueba de voz se oyó por el MOVISUN.

---

# Cierre del 21 de octubre: dónde lo dejamos

## Estado

- **Servidor:** `servidor.py` corriendo (puerto 8765) con el panel en `http://192.168.1.216:8080` (`http://localhost:8080` en el PC). Si el PC se reinicia: `cd ~/pixel-asistente-voz && .venv/bin/python servidor.py`, con Ollama en marcha.
- **ESP32-S3:** firmware `~/Arduino/Pixel_portal/Pixel_portal.ino` con portal WiFi "Pixel-Config" y Bluetooth LE (se anuncia como Pixel-877C). `Etb_boot.ino` queda como respaldo. Para subir firmware hay que cerrar el Arduino IDE entero.
- **Bluetooth del PC:** encendido; el MOVISUN EGG NEO+ conectado. Por él salen la música y la voz de Píxel (`ajustes.json`: `salida_voz = "pc"`).
- **Funciona:** voz y STT con temperatura 0, recordatorios, calendario local (`eventos.json`, con 2 eventos de prueba repetidos el 22 oct a las 15:00), panel (dispositivos, Bluetooth, agente, agenda, contactos).
- **Sin terminar:** correo (falta cuenta), Google, luces y enchufes WiFi.

## Pendientes, en orden

1. Probar una conversación con el MOVISUN cerca del ESP32, por si el micro capta el final de la respuesta (subir `salida_pc.LATENCIA_S` o `ECO_MARGEN_S` si pasa).
2. Micrófono: revisar el puerto acústico del INMP441 o cambiarlo (le faltan unos 20 dB por encima de 1 kHz).
3. Luces o enchufes WiFi: falta saber la marca (Tuya/Smart Life, Shelly, Sonoff, Tapo).
4. Correo: recuperar el Gmail personal (en recuperación, 6 h de espera desde el mediodía), crear la contraseña de aplicación, programar el envío por SMTP y decidir la frase ("sí, mándalo" se entiende mejor que "sí, envíalo").
5. Cambiar la contraseña de la cuenta de la universidad: quedó escrita en el chat.
6. Filtro de palabras para lo que el asistente repite en voz alta (caso "Recuerda matarme").
7. Borrar eventos por voz; que recuerde la pregunta "¿Para cuándo?"; avisos de eventos a su hora.
8. Reconexiones del ESP32: mirarlas con el Serial Monitor (y cerrarlo antes de subir firmware).
9. Para la feria: router o hotspot propio; probar con ruido de gente.
10. Decidir si se borra la página publicada "Conexiones de Píxel" (sustituida por el panel).

---

# Fase 9: app web nueva, cara 3D, dispositivos WiFi y Firebase (22 de octubre)

Pedido: (1) visual clara, fondo blanco con verdes y azules; (2) una cara 3D de Píxel, un círculo con ojitos robóticos y boca, "como el lobby de Mario 64"; (3) mejor "agregar dispositivos" por Bluetooth y por WiFi; y luego dejar todo listo para subir a Firebase.

- **La app pasó a `web/`** (`index.html`, `estilos.css`, `app.js`, `cara3d.js`, `icono.svg`, `manifest.webmanifest`). `panel.py` sirve esa carpeta. `panel.html` queda sin usar hasta que se confirme la nueva.
- **Cara 3D** (`cara3d.js`, WebGL 1 a mano, sin librerías, funciona sin internet):
    - Esfera blanca con ojos de LED azul-verde en pantallitas azul marino y boca de LED. Ojos "^ ^" cuando está feliz, "O" cuando la agarran y una línea con "Zzz" cuando no hay ESP32. La boca se mueve mientras habla.
    - Los ojos siguen al ratón; en el móvil miran a su aire.
    - Se estira al arrastrarla y vuelve rebotando, como la cara de Mario 64. Suelo a cuadros blanco y verde menta, y cielo con nubes.
    - Probada en Chrome sin pantalla (SwiftShader): dibuja, se deforma y no da errores de consola.
- **WiFi** (`red_wifi.py`): la primera búsqueda en la red de casa (192.168.1.0/24) tardó unos 10 s y encontró 5 aparatos:
    - el router Starlink (por el título de su web);
    - 3 móviles con MAC privada;
    - el ESP32 de Píxel, `20:6e:f1:91:87:7c` en 192.168.1.143. Su MAC termina como su nombre Bluetooth, Pixel-877C. El prefijo `20:6e:f1` de Espressif no estaba en la tabla y se añadió.
    - Ningún aparato contestó por mDNS.
- **Agregar por WiFi probado:** un móvil quedó guardado como "Móvil de prueba" (en un JSON de prueba) y salió "Encendido" en "Mis dispositivos".
- **Bluetooth:** la hoja enciende el Bluetooth si hace falta, busca 12 s con barra de progreso, ordena por señal y "Agregar" empareja, confía y conecta. Si es un altavoz, ofrece "Usar para la música".
- **Firebase preparado, sin publicar:**
    - `firebase.json` sirve `web/`. El proyecto es **pixelassitance**, de la cuenta personal de Gmail del usuario, y está en `.firebaserc`.
    - Probado sirviendo `web/` en el puerto 5000: pide la dirección, avisa si está mal, conecta por CORS y guarda la personalidad (POST).
    - Un POST desde otra página da 403.
- **Límite de la app en internet:** solo va en Chrome, en la misma WiFi que el PC y aceptando el permiso de "red local". Safari (iPhone) y Firefox bloquean llamar a una IP de la red desde una página https; ahí sirve la dirección local `http://192.168.1.216:8080`.

## Pendientes

1. ~~Publicar en Firebase~~ Hecho el 22 de octubre: **https://pixelassitance.web.app** (6 archivos, verificados con 200). Para volver a publicar tras cambiar `web/`: `npx firebase-tools deploy --only hosting` en la carpeta del proyecto. Antes se quitó del HTML la clave del portal (sale de `/api/estado`). Falta probarla en Chrome con el servidor encendido.
2. Borrar `panel.html` cuando el usuario dé el visto bueno a la app nueva.
3. Encender y apagar por voz los aparatos WiFi: falta la marca (Tuya/Smart Life, Shelly, Sonoff, Tapo). Kasa y Shelly ya se reconocen al buscar.
4. Reconocer el ESP32 de Píxel en la búsqueda WiFi aunque no esté conectado al servidor (ahora sale como "Otro aparato · chip ESP").

---

# Fase 10: Píxel en la nube, enlazar como Alexa (22 de octubre, mediodía)

El usuario no quería que la app de internet pidiera "localhost" o una IP: "entro a la app, busco a Píxel en dispositivos y me enlazo con él", como Alexa. Una página https no puede buscar en la red local, así que el aparato y la app se encuentran en Firebase.

- **`nube.py`:** el servidor entra solo con una cuenta anónima, publica su estado en la Realtime Database y escucha órdenes y solicitudes de enlace por streaming. La app ejecuta lo mismo que el panel local.
- **Enlace:** código de 6 cifras que Píxel dice en voz alta y que sale en el panel local (Cuentas). Lo comprueba el servidor; tras 8 intentos malos cierra el modo enlace.
- **Firebase:** web app "Pixel" y la base `pixelassitance-default-rtdb` (us-central1, la creó el usuario en modo bloqueado), con las reglas de `database.rules.json` subidas. Anónimo activado. Se quitaron CORS y la pantalla "Conectar con Píxel" de la Fase 9.
- **Prueba de punta a punta** con un "Píxel de prueba" (identidad aparte) y Chrome automático:
    - la app lo listó;
    - "que diga el código" avisó de que no había altavoz (sin ESP32);
    - rechazó un código malo y aceptó el bueno;
    - le llegó el estado;
    - una orden (cambiar personalidad) se aplicó en el servidor en ~0,5 s.
    - Después se borraron de la nube los datos del Píxel de prueba. Quedan 3 cuentas anónimas de prueba en Authentication, sin datos.
- **"Entrar con Google"** (lo pidió el usuario): la app entra con Google y el enlace queda en la cuenta, así que vale en todos sus dispositivos. El servidor sigue anónimo.
- Publicada en https://pixelassitance.web.app.

## Pendientes

1. Que el usuario active Google en Authentication y pruebe con su servidor real: el primer arranque crea `nube_token.json` y abre el modo enlace.
2. El prompt del LLM dice "funcionas 100% en local, sin conexión a la nube": sigue siendo cierto para la voz y la IA, pero la app ya usa la nube.

## Píxel encuentra el servidor solo (22 de octubre, 12:05)

- El usuario pegó `Etb_boot.ino` (el firmware viejo) preguntando si estaba bien para que "el programa encuentre a Píxel". Problemas: IP del servidor fija (192.168.1.216), `sendDebug` que solo manda el primer byte del largo, y sin portal ni Bluetooth. `Pixel_portal.ino` ya corregía los dos últimos.
- **Descubrimiento por broadcast UDP (8766):** si `Pixel_portal.ino` falla 2 veces seguidas con la IP guardada, pregunta "PIXEL? Pixel-XXXX". `servidor.py` contesta "PIXEL 8765" y el ESP32 guarda la IP en Preferences. No cambia el protocolo TCP.
- Probado el lado del servidor con un broadcast desde Python. El firmware compila con arduino-cli: 1.204.185 bytes, 91 % de la partición, como antes. **Falta subirlo a la placa** (copia del anterior en `Pixel_portal.ino.respaldo-21oct`).
- La búsqueda WiFi del panel ya marca como Píxel a los ESP32 que preguntaron por el servidor (`PIXELES_VISTOS`), aunque no estén conectados.

## "Estaba mejor ayer": micro, turnos, boca y arranque solo (22 de octubre, 12:15-12:40)

- **Imagine Dragons → Imagine de John Lennon:** las frases llegaban mordidas.
    - Tras "Píxel" con pausa, el servidor contestaba "Dime" y quedaba sordo mientras el usuario ya decía la orden: "**produce** Imagine Dragons", "reproduce, **imagín**".
    - Además, el micro estaba sordo desde que se cerraba la frase, también mientras Whisper transcribía.
    - Ahora queda sordo solo mientras suena algo, y sin "Dime" si el usuario sigue hablando. "produce" al empezar la frase cuenta como "reproduce".
    - Probado con sus grabaciones reales encadenadas ("Píxel" + pausa + "produce Imagine Dragons"): no dijo "Dime", y el regex buscó "Imagine Dragons" → "Imagine Dragons - Believer".
- **El micro está mucho mejor tras sus cambios de hardware:**
    - voz/ruido 29,6 veces, contra 3,9 el 21 oct;
    - voz p90 1280, contra 125 el 21 oct;
    - sin desvío DC.
    - Pero el servidor calibró el piso en 411 (umbral 1438, por encima de la voz normal). Ahora el piso se calibra con la mediana y sigue al ruido. Una calibración mala se corrige en ~1,5 s de silencio (probado con tramas sintéticas).
- **Firmware:** la placa lleva `Etb_boot.ino`, sin Bluetooth. Se le arreglaron a él y a `Pixel_portal.ino`:
    - vaciar el micro al arrancar (pop) y al conectar (audio viejo durante la calibración);
    - `sendDebug` con el largo completo;
    - reconectar si un envío queda a medias;
    - buscar el servidor por broadcast.
    - Los dos compilan (69 % y 91 %). Copias en `*.respaldo-22oct` / `*.respaldo-21oct`. **Falta subir uno a la placa.**
- **Voz por el ESP32** otra vez (`salida_voz: "esp32"`), a petición del usuario; la del PC queda como opción.
- **Boca sincronizada con la voz real** (`/api/voz` y `pixeles/<pid>/voz`): 52 trozos de 50 ms vistos durante una respuesta de prueba.
- **Como Alexa:** el usuario no quiere arrancar el servidor a mano. El servicio de usuario `pixel.service` arranca con la sesión gráfica y se reinicia solo. En la app sale como "Pixel Assistance" (`NUBE_NOMBRE`). El usuario pensó en llevar el cerebro a la nube (Gemini) y decidió dejarlo en el PC con el modelo local.
- **La voz volvió sola al PC:** el formulario de Personalidad se pintaba una sola vez, así que al guardar (voz Claude, modo profesor) mandó el `salida_voz: "pc"` viejo. Ahora se repinta cuando cambian los ajustes en el servidor, salvo mientras se edita.
- **12:27, servicio en marcha:** el ESP32 se reconectó solo, piso 85 / umbral 600 (el servidor viejo había calibrado 798) y la nube conectada como Pixel Assistance con 1 app enlazada.
- **Ruido sin 0x03 (12:30):** tras el reinicio, la mayoría de frases eran ruido de verdad (Whisper tampoco oía nada, picos de ~1000), pero cada una mandaba un 0x03, y el firmware quedaba sordo ~0,5 s cada vez. Ya no se manda.
- **Altavoz de Píxel en Mis dispositivos:** muestra por dónde habla Píxel. Se llegó a programar que la música del PC sonara por el ESP32, pero el usuario no lo quiere: "el PC, la TV y demás salen por sus salidas originales". Se quitó antes de activarlo.
- **"Está re tonto" (12:40), leído en el log:**
    - el YouTube de antes siguió con reproducción automática ("Cozy at 3am"), y el micro nuevo, más sensible, lo oía: frases de 15 s de "ruido";
    - "Píxel, Píxel" se mandó a la IA como la pregunta "Píxel", y contestó 21 s; el prompt ni decía su nombre;
    - el "Probar" del PC habló a la vez que la orden y todo se juntó en una frase que no empezaba por "Píxel".
- **Arreglos:**
    - "Te llamas Píxel" en el prompt;
    - activación repetida;
    - activación en medio de la frase si hay pausa;
    - umbral que aprende el ruido continuo.
    - Probado con la grabación real (voz del PC de fondo + "Píxel, produce Imagine Dragons" encima): puso "Imagine Dragons - Believer".

## Nombre "Pixel asistente de voz" (6 de noviembre)

El usuario pidió que todo fuera con "pixel asistente de voz". Eligió la carpeta del PC y el nombre del ESP32. La app sigue diciendo "Píxel", en la nube sale "Pixel Assistance" y la dirección sigue siendo pixelassitance.web.app.

- **Carpeta:** ahora es `~/pixel-asistente-voz`. Se cambiaron las rutas de `pixel.service`, de los scripts de `.venv/bin` y `venv/bin` (primera línea y `activate`) y de los comandos de este archivo. `servidor.log` conserva las rutas viejas. El servicio arrancó bien desde la carpeta nueva y la nube conectó con la misma identidad.
- **ESP32:** `Pixel_portal.ino` se anuncia por Bluetooth como "Pixel asistente de voz" y abre el portal con ese mismo nombre. Antes eran `Pixel-XXXX` y `Pixel-Config`; está todo en `NOMBRE_PIXEL`.
    - Va sin tildes y sin las cifras de la MAC: en el core 3.3.12 el nombre va en la respuesta al escaneo BLE (31 bytes), y así cabe entero (24 bytes con la cabecera).
    - `Etb_boot.ino.mejoras-22oct` usa el mismo nombre al buscar el servidor. `Etb_boot.ino` no tiene nombre.
    - Los dos compilan (91 % y 69 %), pero **falta subirlos a la placa**. Copia del anterior en `Pixel_portal.ino.respaldo-06nov`.
- El panel (`panel.py`) y `web/index.html` ya dicen el nombre nuevo de la red del portal. La app publicada en Firebase sigue diciendo "Pixel-Config" hasta que se vuelva a publicar.

---

# Fase 11: Gemini en vez de Ollama (6 de noviembre, rama `vinculacion_movil`)

El 22 de octubre el usuario había decidido dejar el cerebro en el PC. El 6 de noviembre pidió cambiar el modelo de IA por la API de Gemini. Todavía no tiene la clave: la está sacando.

- **Qué cambia:** con clave, las respuestas habladas (`llm.Llm`) y el clasificador (`clasificador.Clasificador`) preguntan a Gemini (`gemini.py`, solo `urllib`). Sin clave, o si Gemini falla antes de decir nada, ese turno responde Ollama. Whisper y Piper siguen en el PC.
- **Modelo:** primero se eligió `gemini-3.8-flash`, el Flash vigente (salió el 2 de septiembre de 2026). No admite `thinkingLevel: "minimal"` (da 400), así que iba con `"low"`.
- **Medido con la clave real del usuario (6 nov), plan gratis:**
    - `gemini-3.8-flash` da HTTP 429 RESOURCE_EXHAUSTED desde la primera petición. El detalle de cuota (`GenerateRequestsPerDayPerProjectPerModel-FreeTier` = 20) dice que da 20 peticiones al día. Cada turno gasta 2 (clasificador y respuesta).
    - `gemini-2.5-flash` y `gemini-2.5-flash-lite` dan 404: ya no están para usuarios nuevos.
    - Responden bien `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-3.5-flash` y `gemini-flash-lite-latest`. **`gemini-3.5-flash-lite`** contesta en 0,88 s y acepta `"low"`: es el que queda en `GEMINI_MODELO`.
    - Según una fuente de terceros (scriptbyai.com, "Gemini API free tier limits"), los Flash-Lite tienen unas 500 peticiones al día gratis, y 3.8 y 3.6 Flash solo 20. Google no lo confirma.
- **Cupo agotado:** un 429 deja a Gemini en pausa `PAUSA_CUPO_S` (10 min). Mientras, responde Ollama sin intentarlo, así que cada turno no pierde la ida y vuelta.
- **Sin `temperature`:** en Gemini 3, Google recomienda dejarla en su valor por defecto. El largo de la respuesta lo sigue marcando el prompt ("2 a 4 frases"). `maxOutputTokens` va en 1024, holgado, porque el razonamiento también gasta del tope.
- **Prompt de sistema:** se quitó "funcionas 100% en local, sin conexión a la nube" (pendiente de la Fase 10).
- **La clave:**
    - Se pega en el panel local (Cuentas → Gemini) y se guarda en `gemini_clave.json` con permisos 600, fuera de git.
    - Vale al momento, sin reiniciar.
    - Las rutas para ponerla y probarla no están en `RUTAS_POST`, así que la nube no puede tocarla. Probado: una orden de la nube a `/api/gemini/clave` contesta "Esa orden no existe." y no llama a Gemini.
- **Probado contra un Gemini simulado en local** (21 comprobaciones): la clave va en la cabecera y no en la URL, el streaming SSE, los roles del historial, el modo JSON, el reintento sin `thinkingConfig`, ListModels, la caída a Ollama con clave mala y sin conexión, la pausa de 60 s tras un fallo de conexión, y que la clave no sale ni en el log ni en el estado.
- **Probado con el servidor de prueba y la grabación real "Píxel, ¿Qué es el sistema operativo de Linux?":**
    - Sin clave responde Ollama: 1er token en 5,39 s, total 16,1 s.
    - Con una clave falsa, el Gemini real contesta "API key not valid". El clasificador cae a Ollama tras 0,35 s y la respuesta tras 0,6 s, y el turno responde igual (1er token de Ollama en 0,80 s). La clave no aparece en el log.
    - Un POST de la clave desde otra página da 403.
- **No probado:** una conversación entera por voz con Gemini en el servidor real (lo reinicia el coordinador tras revisar).

## Pendientes

1. Con la clave ya puesta (6 nov): medir la latencia de Gemini contra la de Ollama con grabaciones reales en el servidor real.
2. Con una clave mala, cada turno pierde ~1 s en los dos intentos fallidos, porque solo los fallos de conexión y el 429 (cupo) hacen pausa. Si molesta, pausar también los demás 4xx.
3. Ollama se descarga de la RAM tras 30 min sin usarse (`keep_alive`). Con Gemini contestando siempre, el primer respaldo tras ese rato será lento (~10 s).
4. La app publicada en Firebase no tiene la tarjeta de Gemini hasta que se vuelva a publicar. Desde internet solo enseña el estado: la clave nunca viaja por la nube.

# Fase 11: el celular como Píxel (6 de noviembre, rama `vinculacion_movil`, sin publicar)

El usuario pidió que Píxel funcione "como un Alexa en el celular" (opción b: decir "Píxel" sin tocar, con la app abierta). Luego dijo que por ahora no puede usar el ESP32, así que el celular tiene que hacer de micrófono y altavoz. Ver CLAUDE.md, "El celular como Píxel".

- **Diseño:**
    - El celular corta las frases (VAD en el navegador) y las deja en la Realtime Database.
    - El PC hace el mismo turno que con el ESP32 y deja la voz para ese celular.
    - Sin ESP32, los recordatorios, "Probar voz" y el código de enlace van al celular que escucha.
    - YouTube pedido desde el celular sale como tarjeta "Abrir en YouTube" en la app, no en el PC.
- **Probado en el servidor, con nube falsa y capturas reales:**
    - Sin "Píxel" no devuelve nada.
    - Las frases de una app no enlazada y las de hace 60 s se tiran.
    - "Píxel" sola: beep y "Dime" marcado `dime`. Después, la frase "¿Qué le hace en el fondo?" sin "Píxel" entró por la ventana.
    - "Píxel, ¿qué es Linux?": 1 beep, 3-4 trozos de voz, cierre y fin, con las claves siempre crecientes.
    - Con el celular escuchando y sin ESP32: un recordatorio vencido llegó al celular en 0,7 s, y "Probar voz" respondió "Escucha el celular.".
    - "pon Queen en YouTube": llegó al celular un `video` con el id y el título, y Píxel dijo "Listo, te dejo Queen – Bohemian Rhapsody en la pantalla." No se abrió nada en el PC; sin celular, el PC se abre como siempre.
    - El ESP32 por TCP (`cliente_prueba.py` con la frase de Linux) respondió igual que antes, sin mandar nada al celular.
- **Probado en Chrome sin pantalla, con micro falso (la frase de Linux en bucle) y base de datos falsa:**
    - El contexto iba a 44,1 kHz. Cortó dos frases de 3,56 y 3,58 s (el original dura 3,56 s).
    - Whisper las entendió como "Píxel, qué es el sistema operativo de Linux?" y se activó.
    - Mientras suena la voz no capta.
    - Salta el "Dime" si el usuario sigue hablando.
    - La tarjeta de YouTube y el latido de "Escuchar" funcionan.
    - "Parar" suelta el micro, y sin permiso sale el aviso.
    - En modo local la página carga sin errores y el botón no aparece.
- **Uso de Firebase (medido):**
    - Una frase de 3-4 s ocupa unos 130-175 mil caracteres en base64 (100-130 KB).
    - Una respuesta de 15-23 s de voz ocupa 0,6-1 MB.
    - El plan gratis (Spark) da 10 GB al mes de descarga. Cada frase con voz que oye el celular sube, lleve "Píxel" o no: en una feria con mucho ruido puede ser mucho.
- **Latencia (servidor de prueba con Ollama):** el primer trozo de voz de la respuesta de Linux llegó a los 6,8-12 s, porque Piper espera la frase entera. Con Gemini debería bajar.

## Pendientes

1. **Parado a medias:** el usuario está pensando en llevar el cerebro a la nube, y quizá el puente celular→PC ya no haga falta. No está publicado ni probado con un celular real.
2. Para probarlo de verdad: publicar las reglas (`frases`, `escuchando`, `habla`) y el hosting, reiniciar el servicio y tocar Escuchar en Chrome Android y Safari iPhone.
3. Ver en iPhone si, con el micro abierto, la voz sale por el auricular en vez del altavoz. Se pone `navigator.audioSession.type = "play-and-record"`, pero no está probado.
4. Si el uso de Firebase molesta: mandar la voz en μ-law de 8 bits, que pesa la mitad.

# Fase 12: Píxel en la app, sin PC (6 de noviembre, rama `vinculacion_movil`, sin publicar)

El usuario no quiere depender del PC: "si lo quiero usar siempre en el cel como un agente tengo que tener el pc, esto no debe funcionar así". Eligió la opción 1: Píxel vive en la app web. Oye con el reconocimiento de voz del navegador, piensa con Gemini por Firebase AI Logic y habla con la voz del celular. Ver CLAUDE.md, "Píxel en la app". El puente celular→PC de la Fase 11 queda sin uso. Su celular es Android y ya tiene instalada la app de pixelassitance.web.app.

## Firebase AI Logic y App Check

- El usuario activó AI Logic con la "Gemini Developer API" (plan Spark, gratis). Con el SDK web 13.1.0, `gemini-3.5-flash-lite` contestó en streaming en 1,4 s, con function calling y `thinkingLevel` LOW (21:53 UTC).
- **Trampa:** al pulsar "Comienza a usar esta API" a las 21:47:46 UTC, la consola dejó App Check **ENFORCED** para `firebaseml.googleapis.com`, sin que el usuario lo pidiera. Tardó unos 15 min en notarse: hasta las 21:53 funcionó, y desde las 22:06 todo dio 401 "Firebase App Check token is invalid", con sesión y sin ella, en Node y en Chrome.
- Con el permiso del usuario se dejó en UNENFORCED a las 22:15 UTC, con un PATCH a la API de App Check (`firebaseappcheck.googleapis.com/v1/projects/pixelassitance/services/firebaseml.googleapis.com?updateMask=enforcementMode`). Se usó el token del CLI de firebase-tools, en `~/.config/configstore/firebase-tools.json`, que tiene el alcance cloud-platform.
- Sin App Check, cualquiera que copie la config pública de la app puede gastar el cupo gratis. No cobra nada: el plan es Spark.

## Pruebas (6 nov, 22:29-22:31 UTC)

Chrome sin pantalla (puppeteer-core), `web/` servido en localhost con `?nube=anonimo`, Gemini de verdad por AI Logic y reconocimiento de voz falso que dicta frases. Los recordatorios y los ajustes, en una base de datos falsa en memoria, porque las reglas nuevas no están publicadas. Pruebas en `scratchpad/navegador/prueba.js` y `prueba_rec.js` de la sesión 9ada51a4.

- **Pregunta:** "¿Cuál es la capital de Francia?" → París, con 2 datos más. La primera frase llega a la voz en 1,4-1,5 s. "¿Y la de Italia?" usa el historial: Roma, 0,6 s.
- **Música:** "pon Bohemian Rhapsody de Queen" → "Te dejo Bohemian Rhapsody Queen en la pantalla.", con la tarjeta de búsqueda de YouTube.
- **Voz:**
    - Una frase sin "Píxel" se ignora.
    - "Píxel" sola → "Dime", con el reconocimiento parado mientras habla. En la ventana, "qué día es hoy" → "Hoy es viernes 6 de noviembre de 2026 y son las cinco y veintinueve de la tarde."
    - "oye pixel pixel pon algo de Shakira" → tarjeta de Shakira.
    - Parar suelta el reconocimiento.
- **Recordatorios:**
    - Crear "en 1 minuto", "en 2 horas" y "mañana a las 8 de la mañana", verlos ("Tienes 2 recordatorios: …") y borrar "el de mamá" funcionan.
    - Uno vencido con la app cerrada → "Se me pasó un recordatorio de hoy a las 5:24 de la tarde: regar las plantas."
    - El de 1 minuto se dijo a su hora: "Recordatorio: tomar agua."
    - Contra la base real, sin reglas, sale "No pude guardar el recordatorio…" a los 8 s.
- **Arreglo:** con `cuando` en ISO, Gemini redondeaba la hora al minuto, y "en 1 minuto" quedaba en 15-23 s. Ahora `crear_recordatorio` tiene `en_minutos`, y la app suma esos minutos a la hora actual: 60 s y 7200 s exactos. `cuando` se queda para horas concretas: "mañana a las 8" quedó a las 08:00:00.
- Personalidad sin "Por dónde habla", Agenda sin eventos, Cuentas sin las tarjetas del PC. El panel local (8080) sigue igual y no carga `agente.js`.
- Peticiones a Gemini en las pruebas buenas: 14. Errores de consola: ninguno. La cuenta anónima de cada prueba se borró. En Auth quedan 6 anónimas, todas del 22 oct: el Píxel del PC (z1UAW2…) y 5 restos de pruebas de ese día.

## Pendientes

1. Reglas publicadas el 9 nov (`--only database`, solo añaden `usuarios/<uid>/recordatorios` y `ajustes`). Canal de prueba: https://pixelassitance--prueba-ob3okavt.web.app (`hosting:channel:deploy prueba --expires 7d`, caduca el 16 nov; el dominio quedó autorizado para entrar con Google). Falta probarlo en el Android del usuario, con Chrome. No se pudo probar sin celular: el reconocimiento de voz real y su corte en Android, las voces del celular, el Wake Lock y si la voz se oye a sí misma.
2. Configurar App Check (reCAPTCHA v3) antes de publicar en pixelassitance.web.app, y luego volver a ENFORCED.
3. Con la app cerrada no suenan los recordatorios: haría falta Cloud Messaging, y el plan Spark no tiene Cloud Functions.
4. Borrar las 5 cuentas anónimas de prueba del 22 oct, si se quiere.

## 9 de noviembre: la nube del servidor caía tras suspender el PC

- El PC estuvo suspendido desde el 7 nov a las 12:18 (último `vivo` en Firebase) hasta el 9 nov a las 08:30. Al despertar, `nube.py` daba 401 "Permission denied" cada ~11 s, porque medía la caducidad del token con `time.monotonic()`, que no avanza durante la suspensión: el token caducado seguía pareciendo válido. No tenía que ver con las reglas nuevas, y con un token nuevo se leía todo bien.
- Arreglo: `_entrar()` y `_escuchar()` usan `time.time()`. Tras reiniciar el servicio: "nube: conectada" en 2 s.
- El ESP32 se conectó a las 08:43 con `piso=0` y `pico=0`. Ya pasaba el 6 nov a las 17:24 ("1955 s de audio, 0 frases, pico=0"). La ganancia del portal (shift 13-16) no puede dejar el audio en 0, así que el INMP441 manda ceros por el canal izquierdo. Puede ser L/R fuera de GND, VDD o GND sueltos, o SCK (IO4), WS (IO5) o SD (IO6) sueltos. El 21 oct el canal izquierdo daba un piso de 80-370.

## 9 de noviembre: el celular se adelantaba ("Píxel… necesito que reproduzcas No te va a gustar" → "reproduce")

- El usuario lo probó en su Android (canal de prueba). "Píxel" → "Dime", y de lo siguiente solo quedaba "reproduce". El ESP32 no oyó nada: piso 0.
- Causa: Chrome en Android da el resultado final en cada pausa corta y corta el reconocimiento (`onend`). `agente.js` respondía con cada final, y durante "Dime" y al rearrancar se perdían palabras.
- Arreglo en `agente.js`:
    - Los trozos se juntan en `oye.pendiente` y solo se responde tras `PAUSA_FIN_MS` (1,2 s) sin resultados, ni provisionales.
    - Tras "Píxel" sola se espera `PAUSA_PIXEL_MS` (1,8 s) antes de decir "Dime", por si sigue la orden.
    - A media frase se rearranca enseguida.
    - Si se corta sin final, vale lo provisional.
    - Si la respuesta acaba en "?", se abre la ventana de 8 s.
    - El prompt avisa a Gemini de que el texto viene de un reconocimiento de voz.
- Probado con un reconocimiento falso que se corta como el de Android (`prueba_android.js`):
    - "Píxel" … "necesito que reproduzcas" … "No te va a gustar", con pausas de 0,6-0,7 s → una sola orden, sin "Dime", con la tarjeta "No te va a gustar".
    - "Píxel" sola → "Dime" a los 2,2 s. En la ventana, "qué hora es" sin "Píxel" → la hora.
    - "Píxel reproduce" → "¿Qué canción o artista te gustaría escuchar?". "algo de Queen" sin "Píxel" → tarjeta de Queen.
    - Una frase provisional cortada sin final también vale. Una frase ajena se ignora.
- Subido al mismo canal de prueba a las 08:56.

# Fase 13: el agente completo (9 de noviembre, rama `vinculacion_movil`)

El usuario pidió cinco cosas para el Píxel del celular:
1. Manejar aparatos (PC, TV y demás), con el ESP32 de puente.
2. Conectar Google Calendar ("determinante").
3. Gmail: leer, redactar, ordenar, corregir y enviar.
4. Pomodoro y Eisenhower, a elegir.
5. Un `.md` que Gemini siga, un RAG con su personalidad y lo que hace, y Obsidian para moldearlo y construir la identidad del usuario con el tiempo.

Contestó:
- Aparatos: TV, PC, luces o enchufes y aire o ventilador.
- Su TV es Android o Google TV.
- Piezas: ninguna todavía.
- Me dio permiso para activar las API de Google y publicar las reglas.

Diseño en CLAUDE.md, "Fase 13".

## Hecho

- APIs `calendar-json` y `gmail` activadas en el proyecto 794659517422, con el token del CLI de firebase-tools (alcance cloud-platform). Reglas publicadas (`--only database`), solo añaden.
- Obsidian 1.15.0 (AppImage) en `~/Aplicaciones/obsidian`, con un acceso en el menú y la bóveda `~/Obsidian/Pixel` registrada.
- `androidtvremote2` 0.3.3 instalado en `.venv`, sin conflictos.
- La placa lleva **Etb_boot.ino**: el log dice "ESP32-S3 conectado" sin nombre, y `Pixel_portal` añade ": Pixel asistente de voz". El firmware del puente compila (1,34 MB con `huge_app`), pero **no se ha cargado**: falta el permiso del usuario.

## Pruebas (9 nov, Chrome sin pantalla, Gemini y Firebase de verdad)

Todas pasan: `tools/prueba_app.js` (36 comprobaciones), `tools/prueba_modulos.js` (19) y `tools/prueba_obsidian.py` (14).

- **Cerebro:**
    - "recuerda que me llamo Diego y estudio ingeniería de sistemas" → 2 notas. "¿cómo me llamo y qué estudio?" lo sabe.
    - "¿cómo funciona la técnica pomodoro?" → 25/5/4, sacado de saber.md.
    - Una regla "termina con cambio y fuera" se cumple.
    - "olvida lo que estudio" borra solo esa nota. Antes guardaba todo en una sola nota y la borraba entera: ahora va un dato por nota.
- **Enfoque:**
    - Dos tareas en sus cuadrantes. "¿qué hago primero?" → el informe, y propone un pomodoro.
    - "sí, empieza un pomodoro con esa" → pomodoro con la tarea.
    - Al vencer: "¡Tiempo! Terminaste el pomodoro 1 de 4…", pasa a descanso y la tarea cuenta 1 pomodoro.
- **Google (simulado):**
    - Agenda de hoy, crear evento a las 16:00, resumen de 2 correos y leer el de Ana.
    - Responder en el hilo, con `In-Reply-To`; corregirlo "más formal" sin enviar. "envíalo" envía.
    - "archiva el de la tienda" archiva solo ese.
    - Sin token pide "Conectar Google".
- **Aparatos (ESP32 simulado):**
    - "apaga la lámpara" → relé pin 16 a 0. "prende la tele" → infrarrojo NEC.
    - "sube el volumen del aire" → pide aprender el botón. Aprender "encender" del aire desde la página y luego "enciende el aire" funciona.
    - Sin puente lo dice.
- **Errores encontrados y arreglados:**
    - Gemini rechaza el rol `function` (400): las respuestas de función van con `user`.
    - Con 30 peticiones en ~5 min, Gemini dio 429 y al minuto volvió: es el límite **por minuto** del plan gratis, no el del día. Ahora avisa, espera y reintenta una vez.
    - El candado global de los botones de Dispositivos bloqueaba "Aprender" mientras otro esperaba respuesta.
    - El filtro RX del RMT (`rmtSetRxMinThreshold` 100 µs) pasaba el máximo del hardware (~3 µs): el aprendizaje habría fallado siempre.
- PC como puente: probado en seco (comandos apuntados, sin tocar el escritorio).
    - pactl, playerctl, abrir, gdbus y xset correctos. Rechaza URLs públicas y errores "No encuentro el TV".
    - No se probó por la nube con la cuenta real (habría que enlazar una cuenta de prueba y el PC diría el código en voz alta).

## Pendientes

1. **Cargar el firmware del puente** en el ESP32 (cambia Etb_boot por Pixel_portal + puente): pedir permiso y cerrar el Arduino IDE. Luego probar el enlace por Bluetooth desde el Android.
2. Probar Google de verdad en su celular: Cuentas → "Conectar Calendar y Gmail". Google avisará de "app no verificada".
3. Activar Obsidian en la app (Personalidad → "Obsidian en el PC" → Activar) y abrir Obsidian en el PC.
4. Agregar el TV Android: su IP, y emparejarlo con el código que muestra el TV (puente del PC).
5. Piezas: módulo IR emisor (KY-005) en IO16, receptor (VS1838B) en IO15, relé en IO18.
6. App Check antes de publicar en el sitio principal (sigue pendiente de la Fase 12).

## 9 de noviembre: cara nueva (pedido del usuario)

"Quítale la boca y los ojitos deben ser dos esferas amarillas, pero con retroiluminación y que sean muy expresivas."

- `cara3d.js` rehecho, con la misma API y el mismo estirado tipo Mario 64. Diseño en CLAUDE.md.
- Decisión propia: un visor oscuro detrás de los ojos. Sobre la cara blanca la retroiluminación no se veía. Se puede quitar si no le gusta.
- Error encontrado al probarla: el primer cuadro de `requestAnimationFrame` puede traer una hora anterior a la de `montar()`. Con el dt negativo, los muelles nuevos explotaban: brillo −13 y la cabeza girada 15 rad. Ahora el dt va de 0 a 1/30.
- Probado en Chrome sin pantalla:
    - Los 12 gestos, sin errores, y la app de punta a punta (cerebro).
    - Con 12 caras WebGL en una misma página, Chrome sin pantalla pierde contextos. En la app hay una sola.
- Publicado en el canal de prueba con todo lo de la Fase 13.

## 9 de noviembre: la música suena en la app (no la tarjeta)

El usuario, con una captura de la tarjeta "Abrir en YouTube": "no quiero que me deje el enlace en la pantalla, quiero que corra en YouTube la canción o el video".

- `musica.js`: reproductor de YouTube embebido. Probado en Chrome sin pantalla con el video real `irp8CNj9qBI`:
    - Suena solo y con volumen tras el toque a Escuchar.
    - Baja a 12 al decir "Píxel…". Pausa, sigue, siguiente y quitar funcionan.
- Error encontrado: si se pausaba en los primeros 3,5 s, la comprobación de "¿arrancó solo?" lo volvía a poner, sin volumen. Ahora solo actúa si nunca sonó.
- Error encontrado: un título largo con `nowrap` dentro de un grid `auto` ensanchaba la página en el celular. Ahora `minmax(0, 1fr)` y `min-width: 0`.
- **Pendiente:** la clave de la YouTube Data API.
    - Activar `youtube.googleapis.com` y crear una clave de navegador restringida a `search.list` y a los dominios de la app. El sistema de permisos lo bloqueó porque crea una credencial: el usuario tiene que aprobarlo.
    - Mientras tanto busca el PC (yt-dlp, 1,5 s), si está encendido y enlazado a la cuenta.
    - Sin clave ni PC sale la tarjeta de antes.

## 9 de noviembre: ojos LED, personalidad y la clave de YouTube

- El usuario: "los ojitos están bien pero los quiero como un LED, que estén dentro de lo negro, no afuera".
    - Ahora se dibujan en el shader de la cabeza: rejilla de puntos, formas de LED (corazón, X, espiral, "> <") y halo sobre el visor.
    - Probados los 12 gestos en Chrome sin pantalla.
- El usuario pidió que, si lo molestan, diga "jejeje, qué divertido" y, si es mucho, se moleste ("ya no me toques así"), además de eventos al azar. Luego añadió que a los 5 min sin actividad diga que se va a dormir.
    - Todo en `humor.js`. Prueba de punta a punta (`prueba_app.js humor`):
        - Tres zarandeos → mareado + "¿Quién apagó la gravedad?".
        - 11 toques → "¡Jejeje, qué divertido!", después "Ya, ya… que me despeinas", "¡Basta! Déjame un ratito, porfa" y "Hmph. Me voy a hacer el dormido…".
        - Eventos al azar: guiño, curioso, feliz, bostezo.
        - 5 min → "Bueno, me echo una siestita…" y los ojos cerrados. Un toque → "¡Ah! Estaba soñando con ovejas eléctricas."
        - "gracias" → corazones.
    - Primer fallo: el "jejeje" iba al 75 % y con el límite de 2,5 s no salía. Ahora el primer toque tras 6 s siempre lo dice.
- **Clave de YouTube:** el usuario la autorizó ("así de una"). Se activó `youtube.googleapis.com` y se creó la clave "Pixel: buscar en YouTube (app web)".
    - Al principio daba 403 "Requests to this API youtube method … are blocked": en la restricción puse el método como `google.youtube.api.v3.V3DataSearchService.List`, y el nombre bueno es `youtube.api.v3.V3DataSearchService.List`. Corregido con un PATCH.
    - Desde la app funciona en unos 20 s. Desde otro sitio: "Requests from referer … are blocked".
    - La prueba de música ya usa la búsqueda real: Queen – Bohemian Rhapsody (Official Video Remastered) suena sola.

## 9 de noviembre: la música en YouTube aparte, no dentro de la app

El usuario: "lo de YouTube está genial, pero la gracia es que abra otra ventana y reproduzca el YouTube, no dentro de la app".

- **PC:** se abre en una ventana aparte (`popup`). En una pestaña, la de Píxel quedaba oculta (`document.hidden`) y dejaba de oír.
- **YouTube manda `Cross-Origin-Opener-Policy: same-origin-allow-popups`** (comprobado con curl). Cuando lo abre otra página, la referencia queda cerrada y el nombre de la ventana se borra, así que no se puede cambiar el video, pausarlo ni cerrarlo. "Siguiente" abre otra ventana.
- **Android:** Chrome no abre otra app sin un toque. Hay pantalla entera "Toca para abrir en YouTube" con `intent://`.
    - En la prueba, `navigator.userActivation.isActive` dio verdadero sin toque. Ahora solo se fía del toque de Enviar (`est.porEscrito`).
- El reproductor de la app queda como opción ("Aquí en la app") y "En el PC" usa el puente.
- Prueba completa: 59 comprobaciones bien y 40 peticiones a Gemini.

## 9 de noviembre: la música, manejada por voz como un asistente de verdad

El usuario: "si le digo que pare la canción, debe pararla; si le digo cambia de canción, la cambia; debe ser un asistente en toda norma".

- Abrir youtube.com directamente no se puede manejar, por su COOP. La solución es `web/reproductor.html`, la ventana de música de Píxel: mismo origen, con el reproductor de YouTube dentro, manejada por `ventana.Pixel`.
    - Probado en Chrome sin pantalla: se abre sin toque desde una orden de voz (con las ventanas emergentes permitidas) y suena con volumen.
    - Funcionan "para", "pausa", "sigue", "cambia de canción" (en la misma ventana), otra canción por nombre (en la misma ventana), "súbele el volumen" (100) y "quita la música" (la cierra).
    - En Android suena en la app y ofrece abrirla en la app de YouTube.
- Error encontrado: con `videoId` en el constructor del reproductor, el primer video de la ventana no arrancaba solo. Con `loadVideoById` sí.
- Música: prueba de punta a punta bien, 16 peticiones a Gemini.

## 9 de noviembre: Píxel baila con la música

El usuario: "cuando esté en modo música, que se ponga a bailar al ritmo de la canción".

- El audio de YouTube no se puede analizar: va en un iframe de otro origen y Web Audio no lo alcanza. Usar el micrófono a la vez que el reconocimiento de voz es arriesgado en Android.
- Por eso Gemini da el `bpm` en `poner_musica` (para "Acróstico" dio 70, de balada), y la cara baila contando con el tiempo del video. Va al tempo de la canción, aunque no a cada golpe exacto: no se sabe dónde cae el primero.
- Probado: tira de cuadros a 120 BPM con los tres pasos (rebote y vaivén, asentir, giro completo). En la prueba de música baila mientras suena y para en la pausa.
- **Se agotó el cupo diario de Gemini** (9 nov, ~12:00): `GenerateRequestsPerDayPerProjectPerModel-FreeTier` en `gemini-3.5-flash-lite`, por las muchas pruebas del día (unas 300 peticiones). `gemini-flash-lite-latest` comparte ese cupo; `gemini-3.1-flash-lite` tiene el suyo y respondió bien, con function calling incluido (sus llamadas traen `id`).
    - Ahora `agente.js` pasa solo al 3.1 cuando el 3.5 agota el día.
    - Además, los atajos de música resuelven "para", "pausa", "cambia de canción"… sin Gemini. La prueba de música bajó de 16 a 6 peticiones.

## 9 de noviembre: firmware del puente cargado en el ESP32

- El usuario lo autorizó ("sí, carga el firmware") y cerró el Arduino IDE.
- La placa es un ESP32-S3 con 16 MB de flash y 8 MB de PSRAM. Antes de cargar se guardó la flash entera (Etb_boot) en `~/Arduino/respaldos/esp32_etb_boot_09nov_16MB.bin`. Se cargó Pixel_portal + puente con `huge_app` y `PSRAM=opi`.
- Dos errores del puente, encontrados en la placa real (el simulador no los mostraba):
    1. Google contesta a Identity Toolkit y securetoken con `Transfer-Encoding: chunked`. El lector no lo entendía: la cuenta se creaba, pero el ESP32 no leía la respuesta y a los 15 s creaba otra. Así quedaron unas 15 cuentas anónimas vacías entre las 14:38 y las 14:44; el sistema de permisos no me dejó borrarlas.
    2. `setTimeout(10)` en Arduino ESP32 3.x son 10 **ms** (Stream), no segundos. El ESP32 no esperaba la respuesta y salía `HTTP -1`.
- Tras arreglarlos, en el registro serie: WiFi OK, servidor OK, Bluetooth anunciándose, infrarrojo listo (IO16/IO15) y "Firebase: dentro como 3t0baibQJBdUr51eWATNEUQnvWp2".
- Falta enlazarlo desde el celular (Dispositivos → Agregar ESP32 por Bluetooth). El micrófono sigue dando 0: es el hardware.

## 9 de noviembre: notas dictadas con análisis

El usuario: "cuando le diga «Píxel, toma nota», que tome las notas como un block de notas, con la fecha y el contexto, y un botón «Analizar con Píxel» que saque un resumen, las ideas generales y específicas y lo más destacado. Que diga «tomando notas para el día tal a la hora tal» y empiece a transcribir".

- Hecho en `apuntes.js`. Prueba de punta a punta (`prueba_app.js notas`, 1 petición a Gemini):
    - "toma nota de la clase de biología" → "Tomando notas para el lunes 9 de noviembre a las 2:49 de la tarde".
    - Tres frases dictadas sin "Píxel", con párrafo tras una pausa.
    - "termina la nota" → "guardé tu nota de 34 palabras. ¿Quieres que la analice?".
    - "sí" → resumen, ideas y lo destacado; entre los pendientes, estudiar la mitosis.
- Error mío, encontrado en la captura: la clase CSS `.hoja` de las notas también la llevan los `<dialog class="hoja">`. Mi `display: grid` mostraba "Agregar dispositivo" y "Buscar a Píxel" cerrados al final de la página. Renombrada a `.nota-hoja`, y la prueba lo comprueba.
- Después, el usuario: "el formato visual me ocupa mucha pantalla". Pidió filtrar por fechas y asunto, que Píxel saque lo más importante y le asigne el asunto, y que borre las notas de más de 30 días.
    - Hecho: lista compacta con una fila por nota, agrupada por día, con filtros de fecha, asunto y palabras. `clasificar()` pone el asunto y lo importante al guardar (una petición). El borrado a los 30 días va al abrir la app.
    - Prueba de notas (3 peticiones a Gemini, todo bien):
        - Asunto «Biología» y "El examen es el viernes 14 de noviembre y se debe estudiar mitosis".
        - La nota de 31 días se borró. Los filtros por asunto, ayer y "telofase" funcionan. La hoja se abre al tocar la fila.

## 9 de noviembre: baile según el género y figuras musicales en el fondo

El usuario: "ponle más animaciones cuando esté escuchando música según el género, y en el fondo que salgan figuras musicales".

- Gemini da `genero` junto con `bpm` en la misma petición. `cara3d.js` tiene 11 estilos con pasos, ojos, color de LED y figuras propios.
- Probado: tiras de 6 géneros, con reguetón guiñando, rock "> <", electrónica en neón morado, balada con corazones, salsa con cadera y clásica.
- En la prueba de música, "Acróstico" dio 110 BPM y pop, salen las figuras y en la pausa el fondo se calma.
- El panel local (8080) sigue sin errores.

## 9 de noviembre: modo música, voz infantil y escenarios por género

El usuario: "toca diferenciar cuándo se queda en modo música y no… me gustaría que cambiemos la voz a una voz infantil, toca que descargue el paquete de voces, revisa en GitHub un repo". Después: "que el fondo cambie según el género: salsa, por allá Puerto Rico con playas; rock o metal, escenario negro con luces tenues; electrónica, luces y láseres".

- **Modo música:** gancho `hero()` de los módulos. Mientras suena, Inicio dice "♪ Modo música" (título y píldora) con colores propios, y en pausa "Música en pausa". Al quitarla vuelve a "Te escucho".
- **Voz infantil:** no hay ningún paquete de voz de niño en español:
    - Piper: HirCoir/Piper-TTS-Spanish, Trelis piper-tts-onnx-models, AIHeaven/piper_unofficial_voices.
    - En el navegador: vits-web y piper-tts-web usan las mismas voces de Piper.
    - Así que no se descargó nada: la voz es la misma, más aguda.
    - En el celular, `pitch` 1,55 y `rate` 1,08 ("Infantil", por defecto) o 1,9 ("Muy infantil").
    - En el PC, `TTS.agudo`: tono medio de 216 Hz normal, 283 infantil (×1,32) y 327 muy infantil (×1,55), sin cambiar la duración.
    - Se elige en Personalidad → "Tipo de voz".
- **Escenarios** (`web/escenarios.js`): playa del Caribe con garita del Morro (salsa y cumbia), la misma al atardecer (reguetón), escenario negro con luces tenues (rock ámbar, metal rojo), láseres con bola de espejos y rejilla (electrónica), noche con luna (balada), ciudad (rap), teatro (clásica rojo, jazz azul) y bombillos con confeti (pop).
    - Laten con el compás (`--golpe`). Con escena, el suelo de cuadros del WebGL queda solo como sombra.
    - Primera captura: el suelo de cuadros tapaba la parte de abajo de todas las escenas. Y en la página de prueba con 11 escenas, los degradados compartían id (todas salían con el cielo de la playa); ahora cada escena lleva su nombre en los ids.
    - Comprobado en la app de verdad, en tamaño de celular, con Gemini y YouTube simulados (0 cupo): salsa → playa, rock → escenario, electrónica → láser; pausa → "Música en pausa" sin escena; "quita la música" → "Te escucho".
- **YouTube bloqueó al Chrome sin pantalla** tras las pruebas del día: "Accede para confirmar que no eres un bot" en la ventana y error 150 en todos los videos dentro de la app.
    - Antes, Píxel saltaba los 5 resultados y se callaba: paraba la música y cerraba la ventana sin decir nada.
    - Ahora `videoFallo()` lo dice, deja la tarjeta "Abrir en YouTube" y la ventana queda con un aviso abajo (enlace al video y el recuadro de YouTube a la vista, por si pide iniciar sesión).
    - No se intentó esquivar el bloqueo (por ejemplo, cambiando el user agent). `prueba_app.js musica` lo detecta y marca lo que necesita sonido como `OMIT`.
    - También se acabó el cupo diario de la YouTube Data API (429). Píxel respondió con la tarjeta de siempre.
- Error mío en un script de prueba: si fallaba, buscaba `window.nube` para borrar la cuenta anónima, pero `nube` no está en `window`. Quedó una cuenta anónima más sin borrar (sin datos), que se suma a las ~15 del ESP32.

## 10 de noviembre: v1.0.0 y segunda fase

- Publicada en vivo la versión del 9 nov y creada la primera etiqueta, `v1.0.0` (`515c390`).
- El usuario pidió una segunda fase con su plan de 6 puntos. Hecho, sin gastar cupo de Gemini en las pruebas (Gemini interceptado: 0 llamadas):
    - **Pomodoro/Eisenhower en Inicio.** Probado de punta a punta en la app (cuenta anónima, borrada al final):
        - "organiza mis tareas" desde Enfoque vuelve a Inicio y abre la guía.
        - "tengo que entregar el informe de física para el viernes" ya cuenta como urgente: solo pregunta si es importante. "llamar a la abuela" → no / "mmm creo que sí" → Planificar. "organizar el escritorio, no es urgente ni importante" → Eliminar.
        - "listo" → resumen y "¿Empezamos un pomodoro con ella?" → "sí" → modo Pomodoro con el anillo. Pausa, sigue y "¿cuánto queda?" por voz; "Ya terminé" → anuncio y descanso; "para el pomodoro" → Inicio normal.
        - Errores míos encontrados al probar frases: "¿qué es un pomodoro?" empezaba uno (el atajo aceptaba "un" como verbo); "qué hago hoy" iba a la matriz (puede ser el calendario); "creo que sí" no se entendía.
        - El anillo se salía por abajo de la escena: el SVG tomaba el alto de una fila de grid sin alto definido.
    - **Mapa del cerebro.** Con 10 notas de ejemplo: 17 nodos (Tú + 6 carpetas + 10 notas), 7 conexiones.
        - Primera versión: todo apretado en el centro y etiquetas pisadas. Más repulsión, aristas más largas y etiquetas que no chocan.
        - `obsidian.py`: pie de enlaces, índices y colores. La prueba de Obsidian tenía un error mío: `open(..., "w")` vaciaba la nota antes de leerla, y una nota vacía cuenta como borrada.
    - **ESP32.** Sin piezas ni volver a cargar el firmware: la prueba usa la orden que no existe (eco) y `http` al panel del PC.
        - Con el ESP32 simulado: en línea, contesta en 0,5 s. Por voz: "ESP32 de prueba funciona".
        - El diagnóstico del PC decía "TV emparejado" solo porque existía el certificado (creado en mis pruebas del 9 nov): nunca se emparejó. Ahora cuenta `tv_emparejados.json`.
    - **Google.** "Probar con mi cuenta" probado con un Google simulado: 3 pasos bien y 0 escrituras.
    - **Regla del correo.** Una prueba la protege.
- Pendiente, necesita al usuario (uno a uno):
    1. Enlazar el ESP32 desde el celular (Dispositivos → "Agregar ESP32 por Bluetooth") y tocar "Probar".
    2. Conectar Google en el celular y "Probar con mi cuenta"; luego "Píxel, crea un evento mañana a las 3".
    3. Activar Obsidian en Personalidad y abrir la vista de grafo en el PC.
    4. Emparejar el TV.

### Después: "Píxel, modo enfoque"

El usuario: "cuando te diga modo enfoque, el agente me muestra las dos opciones y me propone hacer el Eisenhower, me guía, y después por cada tarea me da el pomodoro".

- Hecho en `tiempo.js`, sin Gemini. Probado de punta a punta (0 llamadas a Gemini, cuenta anónima borrada):
    - "Píxel, modo enfoque" → las dos opciones y "¿Empezamos con la matriz?" → "sí" → guía con 2 tareas → "listo" → "¿Empezamos? Te doy un pomodoro para cada una" → "sí" → plan de 2.
    - "¿La terminaste?" → "aún no" → pomodoro 2 de 3 con la misma tarea → "sí, ya la terminé" → la tacha → pomodoro 3 de 3 con la siguiente → "¡Terminaste tu plan de enfoque!".
- Reglas de la base de datos publicadas otra vez: el pomodoro admite `plan`, `paso` y `seguir`.
- El usuario mandó una captura con la tarjeta del modo enfoque rota en el PC: la clase `.enfoque` de la tarjeta chocaba con la rejilla de 2 columnas de la página Enfoque (`.enfoque { grid-template-columns: 260px 2fr }`, solo con más de 760 px; mi prueba era de 390 px y no lo vio). Arreglado y rehecho el diseño: opciones en filas con icono, la etiqueta "Empezar aquí" y la tira "1 Ordenar tareas → 2 Pomodoro por tarea". Revisado a 1280 y a 390 px.

### WhatsApp (v1.2.1)

- Pedido: "entra a WhatsApp y escríbele a tal persona hola". Se explicaron las opciones: enlace oficial wa.me, bots no oficiales (riesgo de bloqueo) y la API oficial (es para empresas). El usuario eligió hacerlo en los dos lados, celular y PC, y pidió el tag 1.2.1 para esto.
- Probado con un Gemini simulado (0 de cupo):
    - Ana, con número guardado: "¿Se lo mando?" → botón → `api.whatsapp.com/send/?phone=573001234567&text=Hola`.
    - Laura, sin número: lo pregunta → "300 765 4321" → lo guarda en su nota → "sí" → abre.
    - "no" → no abre nada.
- Errores encontrados:
    - La pregunta del número no terminaba en "?" y el número sin "Píxel" se ignoraba.
    - `window.open(…, "noopener")` siempre devuelve `null`, y Píxel decía "toca Abrir WhatsApp" aunque ya lo había abierto.
- El camino del PC (WhatsApp Web + `xdotool`) se probó solo con sustitutos: probarlo de verdad mandaría un mensaje real.

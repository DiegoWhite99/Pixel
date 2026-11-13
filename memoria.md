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

### Ajustes y consumo de Gemini (v1.3.0)

- Pedido: una pestaña Ajustes con todos los modos, interruptor y si gastan Gemini; un visual del costo; consumo bajo.
- Precios buscados en la página oficial (10 nov 2026): 3.5 Flash-Lite US$ 0,30 / 2,50 por millón (entrada / salida, pensar incluido) y 3.1 Flash-Lite 0,25 / 1,50. El plan gratis no cobra. Google no da un número fijo de peticiones gratis por día ("depende del modelo"), así que la pantalla no inventa un límite.
- Por defecto, consumo bajo: aprender solo y asunto automático de notas apagados (cada uno costaba una petición en segundo plano), 2 turnos de historial y RAG más corto.
- Error encontrado al probar: con streaming, el resumen final del SDK de Firebase AI no trae `usageMetadata` (`aggregateResponses` solo junta los candidatos) y los tokens salían en 0. Ahora se leen de los trozos.
- Probado en la app con un Gemini simulado que devuelve tokens:
    - 1 petición, 1.300 tokens (1.200 de entrada y 100 de salida) y "pagando serían US$ 0,0006".
    - Apagar «Modo enfoque» esconde su pestaña y su atajo. Con Gemini apagado contesta en local sin pedir nada, y el modo enfoque sigue.
    - "salir" no sacaba del modo enfoque (la tarjeta lo dice): arreglado.

### Sonidos de entrada, pensar y salida

- Pedido: "pon sonidos de entrada cuando llamo a Píxel, de pensar y de salida". Hechos con Web Audio (campanita: nota + armónico x2,01). Reemplazan los pitidos de antes.
- Probado con un AudioContext falso que apunta las notas: "¿qué hora es?" con Gemini tardando 1,6 s → 659 988 1319 (entrada), 523 659 784 659 (pensando), 1319 988 659 (salida). "Píxel" solo: entrada y "Dime". Un atajo: sin "pensando". Con "Sonidos" apagado en Ajustes: nada.

### WhatsApp en el PC: usar la pestaña que ya está abierta

- El usuario: "si ya está abierto WhatsApp en el PC no debe iniciar una nueva pestaña, debe mantenerse en la pestaña y redactar el mensaje desde allí". Con otra pestaña, WhatsApp Web deja la nueva en "está abierto en otra ventana".
- Ahora `puente_pc.whatsapp` busca la ventana de WhatsApp Web por su título (estricto) o la trae de fondo con Ctrl+Shift+A. En esa pestaña escribe la dirección `send?phone=…&text=…` y oprime Enter. Solo abre otra pestaña si WhatsApp no está abierto.
- Probado con un escritorio falso (`tools/prueba_puente_pc.py`, 10 casos), y en el escritorio real solo la parte de reconocer la ventana: encontró "(90) WhatsApp - Google Chrome". Enviar de verdad no se probó: mandaría un mensaje real.

### v1.3.1 publicada (10 nov)

- Sonidos y WhatsApp en la pestaña abierta. README reescrito con la tabla de versiones, una sección por versión y cómo publicar una nueva.
- `main` se fusionó hasta v1.3.1, para que GitHub muestre el README nuevo; la rama por defecto es `main`.

### Proveedores de IA, cambio de cuenta y reglas (10 nov, después de v1.3.1)

- **Pedido:** "un espacio en Ajustes donde se ponga la API key según el proveedor"; "que acepten GPT, Kimi, etc. solo con la API key"; y en el panel cómo se gasta.
- **CORS comprobado con una petición OPTIONS desde el origen de la app:** OpenAI, DeepSeek, OpenRouter, Anthropic y Gemini sí; Kimi (api.moonshot.ai) no, así que va por OpenRouter.
- **Probado en el navegador con servicios simulados:**
    - GPT: «Buscar modelos» deja fuera los de embeddings, la herramienta va en dos vueltas con `role: tool`, y la clave mala da un mensaje claro.
    - Claude: la librería oficial cargó en la página, la herramienta va en dos vueltas devolviendo el bloque de pensar tal cual, Haiku va sin respaldo y Opus con `fallbacks: "default"`.
    - Gemini con clave propia.
    - El panel aparta lo de la clave propia.
    - Con clave propia no se llama al Gemini gratis.
- **Sorpresa:** la librería 1.3.0 manda la clave como `Authorization: Bearer`. La guía de Claude lo confirma para la API `2026-10-21`.
- **Reglas:** se encontró y se cerró el hueco de `usuarios/<uid>/pixeles/<pid>` (cualquier cuenta anónima podía meterse en la lista de otro). Probado: sin permiso el ESP32 simulado no entra; con permiso sí, y funciona.

# 2.0.0: Píxel te conoce (10 de noviembre, rama `vinculacion_movil`)

El usuario aprobó el plan y pidió además: que en la presentación diga que es «un agente de IA creado por Divergencia IA» y voces de hombre y mujer mexicanos, «súper suaves y elocuentes», en Ajustes. Diseño en CLAUDE.md, «2.0.0».

## Voces de México en el celular

- Se buscaron voces mexicanas gratis que funcionen sin PC. Las oficiales de Piper son dos: `es_MX-claude-high` (mujer, apache-2.0) y `es_MX-ald-medium` (hombre, unlicense), 63 MB cada una. Las de HirCoir (Veritasium, Lucas Melor…) imitan a personas reales: no se usaron.
- La librería `@mintplex-labs/piper-tts-web@1.0.5` sirve, con dos trampas:
    - desde `+esm` de jsDelivr trae `onnxruntime-web@1.27.0`, que no casa con sus archivos `.wasm` de la 1.18 (fallo «no available backend found»);
    - su `TtsSession` es única: pedir otra voz devuelve la primera (las dos muestras salían iguales).
- Por eso `voz_trabajador.js` hace la síntesis a mano en un hilo aparte, con las versiones fijas y la caché del navegador.
- **Medido en Chrome sin pantalla (PC, un hilo):**

| | Mujer | Hombre |
|---|---|---|
| Preparar la primera vez (bajar 63 MB y cargar) | 8,6 s | 5,9 s |
| Primera frase (5,5 y 6,2 s de voz) | 1,07 s | 1,03 s |
| Segunda frase (1,7 y 2,0 s de voz) | 0,30 s | 0,34 s |
| Preparar con la voz ya en caché | — | 1,0 s |

  Mientras genera, la página sigue a unos 60 cuadros por segundo (38 en 620 ms).
- **Tono medio** (autocorrelación): mujer 179 Hz, hombre 158-161 Hz. La de hombre se baja un 8 % (`base` 0,92 en el celular y `BASE_VOZ` en el PC): medido en el PC, 0,94 la dejó en 152 Hz.
- El PC (`panel.VOCES`, `ajustes.json`) pasó a «Mujer · México» con tono normal; el servidor se reinició a las 14:51 y el log dice `panel: voz claude (normal)`.

## Pruebas de punta a punta (Chrome sin pantalla, cuenta anónima borrada al final)

- **Voz** (0 peticiones a la IA, 7 de 7): por defecto mujer de México con tono normal; Personalidad ya no muestra la voz; habla por Web Audio sin `speechSynthesis` y la boca sigue el volumen (143 niveles, de 0,05 a 1); elegir «Hombre» se guarda y se baja; «Escuchar» otra voz no cambia la guardada; «La voz del celular» usa `speechSynthesis`; al volver a una de México, tono normal.
    - Un fallo encontrado y arreglado: tras cambiar de voz, el hilo había soltado la anterior y «Escuchar» la daba por lista. Ahora el hilo la recarga sola desde la caché.
- **Entrada y perfil** (1 petición a la IA, 14 de 14): sin sesión solo se ve a Píxel con «Entrar con Google» y la firma de Divergencia IA; la primera vez queda registrado; tarjeta y presentación en voz alta con la voz de México; se apunta la bienvenida; la cuenta sale arriba; el perfil guardado entra en las instrucciones («Quiere que le digas «Anita»», «Háblale de usted»); la foto se recorta, se guarda y sale arriba; el .md con la plantilla llena el formulario sin IA y no guarda solo; un .md libre lo lee la IA (puso «Vale», de usted, y los gustos); «Borrar mi perfil» lo deja vacío.

## Pendientes

1. Probar en el celular de verdad: cuánto tarda la voz de México en Android (la primera frase de cada respuesta), y que la presentación suene tras «Entrar con Google».
2. El nombre «Divergencia IA» está como `CREADOR` en `perfil.js`, en `agente.md`, en `INSTRUCCIONES_MINIMAS` y en la firma de la pantalla de entrada (`app.js`). Si se escribe distinto, cambiarlo en los cuatro.
3. Los visitantes de la feria bajan 63 MB de voz cada uno: con el WiFi de la feria está bien; con datos del celular, Píxel usa su voz hasta que termine.

## Más pedidos del 10 nov (tarde)

- **«✓ Guardado» en el perfil**: probado (17 de 17 en la prueba del perfil, 0 peticiones).
- **WhatsApp en el PC**: la pestaña quedó en `http://xn--https-sta//web.whatsapp.com/send?...`. `xn--https-sta` es «httpsñ»: `xdotool type` con el teclado `latam,us` escribió «ñ» en vez de «:». Ahora todo se pega con `xclip`, y con WhatsApp abierto se busca el chat con «Nuevo chat» sin recargar. `tools/prueba_puente_pc.py`: todo bien. Falta probarlo con su WhatsApp de verdad (Ctrl+Alt+N y la búsqueda por número no se pueden probar sin él).
- **Contactos**: 10 de 10 en el navegador (importa de la memoria una sola vez, agrega, avisa, rechaza sin datos, edita sin duplicar, WhatsApp y Gmail lo encuentran, borra), 0 peticiones.

## Voces de calidad: Supertonic 3 (10 nov)

El usuario: «las voces están del asco, busca cosas de calidad, sé que hay voces en GitHub de calidad, garantiza eso».
- **Supertonic 3** (Supertone, mayo 2026; código MIT, modelo OpenRAIL-M): 31 idiomas con español, 10 voces (F1-F5, M1-M5), 44,1 kHz, sin fonemas (lee letras: no necesita espeak). Pesa 398 MB en fp32 (vector_estimator 256, vocoder 101, text_encoder 36). Supertonic 2: 263 MB, 5 idiomas.
- No se pudo instalar su librería (`pip install supertonic`: denegado por venir de fuera); se escribió el algoritmo de su ejemplo oficial con el onnxruntime del `.venv`.
- **Muestras** en `voces_prueba/supertonic3/` (y `piper_mujer_claude`, `piper_hombre_ald` para comparar). Tono: F 165-205 Hz, M 85-132 Hz.
- **Whisper small** las entiende igual que a Piper (las diferencias son «Píxel/Pixel», «tres/3» y «un agente/una gente»), y les pone «¿…?» a las preguntas.
- **Velocidad en el PC (Python, 4 hilos):** 8 pasos 0,54-0,79 × tiempo real; 4 pasos 0,46; 3 pasos 0,36.
- **En el navegador (Chrome sin pantalla, WebAssembly de un hilo, como en el celular):** 4 pasos = 1,0 × tiempo real (8,2 s de voz en 8,2 s: 6,3 s los pasos, 1,7 s el vocoder); 8 pasos = 1,7 ×. En un celular sería 2 a 4 veces más lento: hace falta WebGPU, que aquí no se pudo medir (Chrome sin pantalla solo tiene SwiftShader, por software).

## La voz elegida: Supertonic 3, F4 (10 nov, tarde)

- El usuario oyó las muestras y eligió `supertonic3_F4`. Las voces de Piper se quitaron de la app.
- **Números:** Supertonic lee «3», «10» y «2026», pero no «°C» («21…»), y con «$ 45.000 pesos, o 3,5 dólares» Whisper oyó «$45,000 o $35,000». Por eso `leer()` los pasa a palabras antes; con eso Whisper oyó «21 grados», «45 mil pesos» y «25 %».
- **En la app** (Chrome sin pantalla, WebAssembly): 8 de 8 en la prueba de la voz (por defecto la F4, bajada y lista en 21-40 s, suena por Web Audio sin `speechSynthesis`, la boca sigue el volumen, elegir «Hombre 1» se guarda, «Escuchar» no cambia la guardada, la del celular sigue funcionando, cifras en palabras). Bajó a 4 pasos sola (va a ~1 × tiempo real en WebAssembly).
- Con `--enable-unsafe-swiftshader`, Chrome sin pantalla ofrece una «tarjeta gráfica» por software: ahora se descarta (`tarjetaDeVerdad`).
- **En el PC:** se carga en 0,9 s; 1,6 s de voz en 0,78 s, 5,1 s en 1,71 s, 5,0 s en 2,79 s. Servidor reiniciado a las 15:57: `panel: voz st-F4 (normal)`.
- **Pendiente:** medirla en el Android del usuario (con y sin WebGPU) y ver si la bajada de 400 MB es aceptable en la feria.

## 2.3.0 (12 nov, tarde)

Pedidos del usuario tras probar la 2.2.1 en su Windows, y lo que se decidió:
- **Google en el programa** («no está vinculado Google, no arrastra los datos a la app web»). Eligió «las dos cosas»: Calendar y Gmail por voz desde el PC, y la configuración del programa en la app. La configuración (las claves de IA) ya llega a la app. Para Calendar y Gmail en el programa falta un cliente OAuth de «app de escritorio» que tiene que crear él en Google Cloud (proyecto `pixelassitance`). Iría dentro del paquete público (`instalador/google_programa.json`): preguntarle antes de meterlo.
- **Tus APIs** («no sale nada, debe salir qué API estoy usando y si está en uso»). La ventana marca «En uso» y «De respaldo». El PC publica sus claves en `pixeles/<pid>/ia`, y la app las usa si la cuenta no tiene una propia en ese aparato. La regla nueva sale con la 2.3.0.
- **Música** («no quiero que se reproduzca YouTube dentro de la app», «que use la misma ventana»). En el PC se usa `navegador.py`: tres canciones seguidas dejan una sola pestaña (Chrome sin pantalla, `test_musica_en_una_sola_ventana`). En la app suena en una pestaña con nombre fijo, también en el celular; si el navegador no deja abrirla, sale el botón «Abrir la música».
- **Robot** («quita el nombre de ESP32, se llama Píxel», «poder quitar el dispositivo», «cada vez que detecta la ESP32 me debe dar un autenticador»). Para el código eligió «al agregarlo en la app». El firmware se cargó a las 13:49. Probado con un robot simulado: el PC dijo el código por voz (8,8 s) y no lo escribió en el registro.
- **Windows** («en Windows no puedo subir ni bajar volumen ni suspender, y no sale la MAC»): `puente_pc._Windows`. Probado aquí simulando Windows; en un Windows de verdad lo prueba `.github/workflows/probar_instaladores.yml` (paso «El PC desde la app en Windows»), al publicar.
- Pruebas antes de armar: ruff, pytest (31), `prueba_modulos.js` (85), las cuatro pruebas de la app en Chrome y `prueba_escritorio.js`, todas bien. La animación de entrada de la ventana falló una vez por tiempo (251 → 250 px); la prueba ahora mide varias veces.


## 2.4.0: un solo Píxel (12 nov, tarde)

El usuario: «las configuraciones deben ser un espejo de uno al otro», «el Píxel de la ESP32 es uno viejo… esto ya no va para una feria… tiene que ser igual lo que está en la app, la web y el robot», «en Windows ya no sea la versión de prueba».
- **Decisión:** la app hace de centro del espejo. Cada lado guarda la hora de su último cambio, y gana la más reciente. Se descartó que el PC leyera directo `usuarios/<uid>`: habría pedido reglas nuevas para las cuentas del PC, y la app ya está abierta cuando se cambia algo en ella. La clave de IA de la app sigue en `localStorage`, pero ahora también va al PC enlazado, y el PC la publica para sus dueños.
- **Las claves dejan de ser solo locales en el PC:** `/api/gemini/clave` y las demás pasan a `RUTAS_POST`. Antes la nube no podía tocarlas a propósito (ver «Gemini» más abajo). Las órdenes solo se aceptan de los dueños.
- **Lo que encontró la prueba de punta a punta** (`tools/prueba_espejo.js`, 8 vueltas):
    1. `const Espejo` no queda en `window`, y los avisos lo buscaban ahí.
    2. La regla `$otro: false` de `ajustes` rechazaba `t`. Habría roto guardar los ajustes en la app publicada. Se publicó la regla con el permiso del usuario.
    3. `get()` de Firebase da lo escrito en la página antes de que el servidor lo rechace (un «bien» falso). La prueba ahora lee el servidor por REST.
    4. Un fallo en los ajustes cortaba el espejo de las claves; ahora van por separado.
    5. El aviso al espejo salía solo si la prueba de la clave iba bien; ahora sale al final, en todos los casos.
    6. El espejo trabajaba solo con el PC elegido. El robot piensa con su PC y el usuario tiene otro (Windows), así que ahora trabaja con todos.
- **Medido:** cada orden de la app la hace el PC en 0,4 a 2,4 s. Con dos PC de prueba, el segundo, que no es el elegido, queda igual que el primero en unos segundos.
- **El robot:** ahora usa `web/agente.md`, unos 3,9 mil caracteres. Antes eran unos 600. Con Ollama de respaldo, la primera palabra tardará más.

---

# Apendice: referencia detallada (movida desde CLAUDE.md el 11 nov)

Este apendice guarda el detalle por fase que antes estaba en CLAUDE.md. Los datos de red y de cuentas se quitaron porque este repo es publico: estan en las notas privadas del usuario.

## (antes CLAUDE.md)

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es

Asistente de voz para una demo de feria, todo en el PC salvo la IA de Gemini, que es opcional (Fase 11). Un ESP32-S3 (micrófono INMP441; su firmware **no** está en este repo) manda audio por TCP; el servidor en Python lo transcribe (faster-whisper), decide qué hacer (acciones por regex, clasificador LLM o respuesta libre del LLM vía Ollama) y devuelve voz sintetizada (Piper). Palabra de activación: "Píxel" (antes "Nova", que Whisper oía como "No, no."; ver `memoria.md`).

Git: https://github.com/DiegoWhite99/Pixel, **público**. Ahí no entran claves, grabaciones ni datos personales: ver `.gitignore`. El 9 nov se fusionó `vinculacion_movil` (Fases 11 a 13) en `main`; el trabajo nuevo sigue en `vinculacion_movil`. Versiones: etiquetas `vX.Y.Z` (X cambio grande, Y funciones nuevas, Z arreglos), con su historia en `README.md` (tabla y una sección por versión: al publicar una, se escribe ahí). `v1.0.0`, `v1.2.1`, `v1.3.0`, `v1.3.1` y `v2.0.0` son del 10 nov; `v2.0.0` está publicada y `main` apunta a ella. El repositorio tiene su propio `core.sshCommand` con `~/.ssh/id_ed25519_wikiia`: la llave por defecto, `id_ed25519`, es una deploy key del repo AGATA, y GitHub la rechaza aquí. No hay `requirements.txt` ni linter; las únicas pruebas son las de la Fase 13 (`tools/prueba_*`). Las dependencias viven en `.venv/` (Python 3.10: faster-whisper 1.2.1, piper-tts 1.8.0 (trae onnxruntime, que usa también la voz Supertonic de `tts_supertonic.py`), numpy, yt-dlp y, desde la Fase 13, androidtvremote2 0.3.3); `venv/` es una copia con los mismos paquetes que no se usa. Ollama corre aparte en `127.0.0.1:11434` con el modelo `qwen2.5:3b`. Con clave de Gemini, Gemini responde y Ollama queda de respaldo (ver **Gemini**).

## Comandos

```bash
# El servidor arranca solo con la sesión gráfica: servicio de usuario ~/.config/systemd/user/pixel.service
# (Restart=always, salida añadida a servidor.log). Python se carga al arrancar: tras cambiar un .py, reiniciarlo.
systemctl --user restart pixel      # status / stop / start
tail -f servidor.log

# A mano (solo con el servicio parado). Necesita Ollama arriba y DISPLAY para que xdg-open abra el navegador.
.venv/bin/python servidor.py

# Cliente que simula al ESP32 (solo stdlib). Guarda la voz recibida como respuesta_NN.wav en el cwd.
python3 tools/cliente_prueba.py capturas/<archivo>.wav     # reenviar una frase real grabada
python3 tools/cliente_prueba.py --host [IP del servidor: notas privadas] --fin-de-turno --espera 30 archivo.wav
```

El audio sintético del cliente (sin WAV) solo prueba el VAD: no dice "Píxel", así que el servidor ignora las frases y no responde nada.

Probar la lógica sin cargar modelos: importar `servidor` es barato (los modelos se cargan en `main()`):

```bash
.venv/bin/python -c "import servidor; print(servidor.quitar_activacion('Oye Píxel, pon Queen en YouTube'))"
.venv/bin/python -c "import acciones; print(acciones.detectar('pon Queen en YouTube'))"
.venv/bin/python -c "import servidor; print(servidor.extraer_frases('Hola. Mide 8.848 m, más', primera=True))"
```

Ojo: ejecutar una acción de YouTube busca de verdad y abre una pestaña en el navegador del PC. Para pruebas, sustituir `acciones._abrir`.

Servidor de prueba aislado, para no tocar el real ni sus JSON (luego `tools/cliente_prueba.py --port 8799`):

```bash
.venv/bin/python -c "import servidor, acciones; servidor.PORT = 8799; servidor.PANEL_PORT = 8081; servidor.RECORDATORIOS_ARCHIVO = '/tmp/r.json'; servidor.EVENTOS_ARCHIVO = '/tmp/e.json'; servidor.AJUSTES_ARCHIVO = '/tmp/a.json'; servidor.DISPOSITIVOS_ARCHIVO = '/tmp/d.json'; servidor.CONTACTOS_ARCHIVO = '/tmp/c.json'; servidor.GOOGLE_TOKEN = '/tmp/g.json'; servidor.GEMINI_CLAVE = '/tmp/gm.json'; servidor.NUBE_DB = ''; servidor.DESCUBRIR_PORT = 0; servidor.CAPTURE_DIR = '/tmp/capturas'; acciones._abrir = lambda url: 0; servidor.main()"
```

- `PANEL_PORT`: el panel se abre siempre en `main()`; con el servidor real arriba, el 8080 está ocupado y el de prueba se cae al arrancar.
- `AJUSTES_ARCHIVO`: el `ajustes.json` real puede tener `"salida_voz": "pc"`. Entonces la voz suena por el altavoz del PC y no llega ningún 0x02, así que el cliente no guarda `respuesta_NN.wav`. Sin archivo, la salida es `"esp32"`.
- `GOOGLE_TOKEN`: sin ese archivo, Google no se carga. Entonces `crear_evento` y `ver_calendario` usan el calendario local de prueba, y `correo` dice que no está configurado. Así, aunque el real esté autorizado, el de prueba no toca la cuenta de Google.
- `GEMINI_CLAVE`: el de prueba arranca sin clave (Ollama). Una clave puesta en su panel (8081) va a `/tmp/gm.json`, no a la del real.
- La grabación de `capturas/` empieza ya con voz, y el VAD calibra con los primeros 500 ms: sin 1 s de silencio delante, se pierde "Píxel" y la frase se ignora.
- `NUBE_DB = ''`: sin nube. Con el `nube_token.json` real, el de prueba sería el mismo Píxel que el real en Firebase. Para probar la nube, usar otra identidad: `servidor.NUBE_TOKEN = '/tmp/n.json'; servidor.NUBE_NOMBRE = 'Píxel de prueba'`. Al acabar, borrar sus datos (`visibles/<pid>`, `pixeles/<pid>` y `usuarios/<uid>/pixeles/<pid>` de cada dueño) con `nube._db()` y ese token.
- El Bluetooth del PC es uno solo: el panel de prueba busca, empareja y cambia la salida de audio de verdad, igual que el real.
- Python carga `panel.py` al arrancar, pero los archivos de `web/` se leen en cada petición: los cambios de la web se ven al recargar y los de Python piden reiniciar.

Probar la web en un Chrome sin pantalla (la cara usa WebGL): `puppeteer-core` instalado fuera del repo, con `executablePath: "/usr/bin/google-chrome"` y `args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]`. `http://localhost:8081/?nube` abre la app en modo internet desde el panel de prueba. Con `?nube=anonimo` (solo en localhost) entra sin Google: una prueba automática no puede iniciar sesión con Google. El código de enlace sale de `/api/estado` (`nube.enlace.codigo`) del panel local, y `POST /api/nube/enlazar` lo reabre.

Buscar en la red WiFi sin el servidor: `.venv/bin/python red_wifi.py` (tarda unos 10 s).

Pruebas de las Fases 13 y 14 (las únicas automáticas del proyecto):

```bash
node tools/prueba_modulos.js                 # funciones puras de web/*.js en Node, sin página (segundos)
.venv/bin/python tools/prueba_obsidian.py    # sincronización con Obsidian, con base de datos falsa
.venv/bin/python tools/prueba_puente_pc.py    # WhatsApp en el PC (xdotool y xdg-open sustituidos: no envía nada)
# de punta a punta: Chrome sin pantalla, Gemini y Firebase de verdad (cuenta anónima que se borra al final),
# Google simulado y un ESP32 simulado (tools/puente_simulado.py). Gasta ~35 peticiones de Gemini.
python3 -m http.server 8099 -d web &
PUPPETEER=<carpeta>/node_modules/puppeteer-core node tools/prueba_app.js [cerebro|enfoque|google|aparatos]
```

`prueba_app.js` espera `PAUSA` ms (3000) antes de cada frase: el plan gratis de Gemini tiene un límite por minuto (429).

La parte `musica` necesita que YouTube suene en Chrome sin pantalla. Tras muchas pruebas seguidas, YouTube le pide "Accede para confirmar que no eres un bot" (en la app sale como error 150 en todos los videos). No se esquiva: la prueba lo detecta, comprueba que Píxel lo dice y deja el botón, y marca lo demás `OMIT`. Lo mismo si se acaba el cupo diario de búsquedas de la YouTube Data API (429; Píxel dice "No puedo buscar el video exacto"). El 9 nov se gastaron los dos. Para ver el modo música sin gastar cupo: interceptar la petición a Gemini con una llamada `poner_musica` falsa, poner un `window.YT` falso y usar `PixelMusica.usarBuscador()`.

## Arquitectura

**Protocolo con el ESP32** (contrato fijo con el firmware; no cambiarlo sin cambiar el firmware): cabecera `struct "<BI"` = 1 byte de tipo + uint32 LE de longitud + payload. `0x01` audio ESP32→servidor, `0x02` audio servidor→ESP32, `0x03` fin de turno (sin payload), `0x04` texto de debug UTF-8. Audio PCM 16 kHz, 16 bit con signo, mono, en tramas de 20 ms (640 bytes).

**Descubrimiento** (aparte del protocolo TCP): `responder_descubrimiento()` escucha UDP `DESCUBRIR_PORT` (8766). A "PIXEL? <nombre>" contesta "PIXEL <PORT>" y apunta la IP en `PIXELES_VISTOS`, que la búsqueda WiFi usa para marcar esos aparatos como Píxel. `Pixel_portal.ino` lo pregunta por broadcast cuando no conecta con la IP guardada, y guarda la que le contesta. `Etb_boot.ino` no lo usa (ver Firmware, abajo).

**Hilos por conexión** (`servidor.py`, clase `Sesion`):
- El hilo del socket solo recibe y corre el VAD por energía (calibra el piso de ruido en los primeros 500 ms). Cada frase cerrada se guarda en `capturas/` y se encola.
- Un hilo trabajador ejecuta `_turno()`. El micro queda sordo (`respondiendo`) solo desde que algo empieza a sonar: lo activa `enviar_audio()`. Así se descarta el audio para que Píxel no se oiga a sí mismo, y sigue sordo hasta el fin estimado de la reproducción en el ESP32 (`fin_reproduccion` + `ECO_MARGEN_S`). Mientras se transcribe, el micro sigue abierto: antes se perdía lo dicho justo después de "Píxel".
- El VAD calibra el piso con la mediana de los primeros 500 ms. Fuera de las frases lo sigue (`_seguir_ruido`: baja deprisa y sube despacio). El 22 oct una calibración mala, 411 con ruido real de 40-160, cortaba palabras.
- El ruido continuo (música, TV) deja el VAD "en voz" hasta `MAX_PHRASE_MS`, y el piso no se entera. Si Silero dice que una frase de `RUIDO_LARGO_S` o más no tenía voz, su RMS mediano sube el umbral (`ruido_largo` × `RUIDO_LARGO_MULT`). Se olvida solo en unos 9 s de calma; el tope es `UMBRAL_MAX`.
- El ruido sin voz no manda 0x03: el firmware queda sordo ~0,5 s con cada 0x03.

**Flujo de un turno** (`Sesion._turno`), en este orden:
1. Filtro de ruido: `Transcriptor.hay_voz()` (VAD Silero de faster-whisper, milisegundos). Si no hay voz, la frase no llega a Whisper, que con el `initial_prompt` puede tardar hasta 37 s en un ruido.
2. STT (`stt.Transcriptor.transcribir`), con una sola temperatura (`STT_TEMPERATURA`, sin reintentos) y descartando los segmentos en bucle (`STT_MAX_COMPRESION`).
3. Palabra de activación (`quitar_activacion`): `ACTIVACION_VARIANTES` y compañía admiten grafías erróneas de Whisper, algunas solo si sigue coma o verbo de acción. "Píxel" sola responde "Dime" y abre una ventana de 8 s para **una** frase sin "Píxel". Si el usuario ya sigue hablando (`en_voz` o hay otra frase en cola), no hay beep ni "Dime": solo se abre la ventana. "Píxel, Píxel" cuenta como una sola llamada.
    - En medio de la frase también vale (`_RE_ACTIVACION_EN_MEDIO`): se toma lo que va tras la última aparición. Pasa cuando música, TV u otra voz juntan todo en una frase. Solo cuenta con pausa antes o después (signo de puntuación), así "un píxel de la pantalla" no la activa. Las frases sin activación se ignoran sin mandar nada al ESP32, ni siquiera `0x03`.
4. Intención: primero `acciones.detectar()` (regex, rápido); si no hay coincidencia, `clasificador.Clasificador` (Gemini u Ollama, JSON), cuyo "youtube" solo vale si `acciones.hay_pedido()` ve un verbo de acción (aunque llegue roto), "quiero", YouTube o una palabra de música; si no, la frase va al LLM. Con regex, el clasificador solo se usa como `acciones.CORRECTOR` cuando YouTube no da resultados (corrige el nombre y busca otra vez).
5. Si no es acción: `llm.Llm.responder()` en streaming; `extraer_frases()` parte el texto en frases (la primera también corta en coma para que la voz arranque antes) y cada frase va a Piper y se envía en cuanto está lista.
6. Toda respuesta (LLM, acción, "Dime" o reposo) termina con `fin_respuesta()`: beep descendente y luego `0x03`.

**Reposo:** si pasan `REPOSO_S` desde la última respuesta a una frase aceptada, el hilo trabajador (que espera la cola con timeout) dice `REPOSO_FRASE`, borra el historial del `Llm` y no lo repite hasta la siguiente interacción.

**Recursos compartidos:** Whisper, Piper y el clasificador se cargan una vez en `main()` como globales del módulo. Cada sesión tiene su propio `Llm` (historial propio). `llm._OLLAMA` es un candado **de módulo** compartido por `Llm` y `Clasificador`: una sola generación de Ollama a la vez. Las llamadas a Gemini no lo toman. Whisper y Piper tienen su propio candado.

**Acciones** (`acciones.py`): se registran con `@registrar(nombre, detector)`; el detector devuelve un dict de parámetros o `None`, y la función devuelve `{"ok", "decir", "log"}`. `plano()` pasa a minúsculas y quita tildes **conservando la longitud**, así los índices de un match sobre el texto plano recortan el original con sus mayúsculas y acentos. Las acciones de recordatorio van registradas antes que YouTube y solo se detectan por regex. El clasificador general solo puede devolver `"youtube"` o `"ninguna"`: si una acción nueva debe poder elegirla él, hay que tocar su prompt y su validación en `clasificador.py`.

**Recordatorios** (`recordatorios.py`, Fase 7): `Clasificador.extraer_recordatorio()` pide al 3B solo `{"texto", "cuando"}`, donde `cuando` es el trozo literal de la frase. `recordatorios.extraer_hora()` lo interpreta con reglas ("en 10 minutos", "mañana a las 3", números en palabras) y `resolver()` calcula la fecha: con horas, el 3B se inventaba "de la mañana" y convertía 7 pm en 17. `Agenda` guarda los pendientes en `RECORDATORIOS_ARCHIVO`. El hilo `vigilar_recordatorios()` mete cada vencido en la cola de la sesión más reciente (`SESIONES`), así nunca se mezcla con una respuesta que esté sonando. Sin nadie conectado se quedan en el JSON.

**Google** (`servicios_google.py`, Fase 7): Calendar y Gmail solo con stdlib. OAuth de escritorio con PKCE y redirección a `127.0.0.1`; alcances `calendar.events.owned` y `gmail.send`, que solo envía y no lee. No se llama `google.py` porque taparía el paquete `google` de protobuf. Se autoriza con `.venv/bin/python servicios_google.py autorizar`. En modo Testing la autorización caduca a los 7 días. `google_cliente.json` y `google_token.json` dan acceso a la cuenta: no se comparten. Sin ellos, `crear_evento` y `ver_calendario` usan el calendario local (`EVENTOS_ARCHIVO`, otra `Agenda` que no se vigila: los eventos no avisan). `ver_calendario` lee siempre también los recordatorios pendientes de ese día. `correo` dice que no está configurado.

**Panel de administración** (`panel.py` + la app de `web/`, Fases 8 y 9): `servidor.main()` lo arranca en `PANEL_PORT` (8080), en un hilo, solo con stdlib y sin fuentes de internet. Se abre en `http://<IP del PC>:8080`, también desde el móvil. `panel.html` es la versión anterior y ya no se sirve.
- `GET /` y `GET /<archivo>` sirven solo archivos sueltos de `web/` (sin subcarpetas) con las extensiones de `TIPOS_MIME`.
- `GET /api/estado` lee el estado vivo: `SESIONES` (con `desde`, `piso`, `ultimo_texto`, `ultimo_audio`), agenda, Google, contactos, Bluetooth del PC y la búsqueda WiFi.
- Los `POST /api/...` sirven para guardar el agente (voz entre `panel.VOCES`, personalidad, respuesta corta o normal; se persiste en `AJUSTES_ARCHIVO` y se aplica en vivo cambiando `TTS`, `LLM_SYSTEM` y `llm.system` de cada sesión), probar la voz (encola `("decir", texto)` en la sesión más reciente), gestionar contactos, borrar de la agenda, vincular Google y, solo desde la red local, poner la clave de Gemini.
- "Agregar dispositivo" es una hoja (`<dialog>`) con tres caminos: Bluetooth del PC, WiFi y otro Píxel (los pasos del portal). "Mis dispositivos" empieza por los dos altavoces fijos, "Altavoz de Píxel" (el del ESP32) y "Altavoces del PC". Cada uno marca si Píxel habla por él, tiene "Que hable por aquí" (cambia `salida_voz`) y un "Probar" que suena en ese altavoz: `/api/agente/probar` con `donde`, `"esp32"` aunque la voz vaya al PC (`forzar_esp32`) o `"pc"`. Después junta los emparejados del PC, los WiFi y los Bluetooth recordados del ESP32. La música y el resto de los aparatos suenan por su salida de siempre: el usuario no quiere que el audio del PC pase por Píxel.
- `DISPOSITIVOS_ARCHIVO` va por MAC: `{"nombre", "aceptado"}` para los Bluetooth vistos por el ESP32, y además `"via": "wifi", "ip", "tipo", "fabricante"` para los WiFi.
- "Detectar cuando está cerca de Píxel" espera la siguiente lista Bluetooth del ESP32 (como mucho 30 s) y ofrece "Recordar" en cada uno. Los móviles rotan su MAC Bluetooth, así que recordarlos dura poco.
- WiFi (`red_wifi.py`, Fase 9, solo stdlib más `ip` y `ping`):
    - `buscar()` corre en un hilo. Manda un datagrama UDP a cada IP de la /24 del PC y lee `/proc/net/arp`, así ve también lo que no contesta a ping. Luego pregunta nombres por mDNS ("legacy unicast", incluido el PTR inverso de cada IP) y DNS inverso, y prueba los puertos de `PUERTOS`, Kasa (9999) y Shelly (`/shelly`).
    - El tipo se adivina con reglas: puertos, servicios mDNS, palabras del nombre, prefijo Espressif (`ESPRESSIF`) y MAC privada (móviles). El usuario lo corrige al agregar.
    - `vigilar()` comprueba cada 30 s los WiFi guardados (ARP, TCP y ping) y sigue al aparato por la MAC si el DHCP le cambia la IP.
    - Todavía no los enciende ni los apaga: falta saber la marca.
- Bluetooth del PC (`bluetooth_pc.py`: `bluetoothctl` y `pactl` por subprocess, con caché de 4 s):
    - encender (`rfkill unblock` + `power on`), buscar 12 s, emparejar con agente NoInputNoOutput + trust + connect, conectar, desconectar y olvidar;
    - "Usar para la música" cambia el sink por defecto de PulseAudio y mueve lo que ya suena; al volver, va a la salida ALSA que había;
    - "Hacer visible para el móvil" abre 120 s un `bluetoothctl` con agente que contesta "yes" solo.
    - Las operaciones lentas van en un hilo; su progreso sale en `bt_pc.operacion`.
- **"Por dónde habla"** (`SALIDA_VOZ`, en `ajustes.json`):
    - `"esp32"` manda la voz como 0x02, como siempre.
    - `"pc"` la manda a `salida_pc.SalidaPc`: un `pacat` persistente con un hilo escritor, así que suena por el sink por defecto, el altavoz Bluetooth si está conectado. No se envía 0x02 (el LED no se pone amarillo), pero sí 0x03. `fin_reproduccion` suma `salida_pc.LATENCIA_S` (0,4 s) para que el micro siga sordo mientras suena.
- No tiene autenticación: cualquiera en la red puede usarlo. Sí rechaza (403) un POST con la cabecera `Origin` de otra página, para que otra web abierta en el navegador no pueda manejarlo. No hay CORS: la app de internet no llama a esta API.

**App web y Firebase** (`web/`, Fase 9): una sola app para el panel local y para Firebase Hosting. HTML, CSS y JS sin compilar y sin librerías. El modo local no usa nada de internet; el modo internet carga el SDK de Firebase 13.1.0 de gstatic (`SDK` en `app.js`; la 13 trae `firebase-ai.js`).
- `cara3d.js`: la cara de Píxel en WebGL 1 a mano. Desde el 9 nov (Fase 13, a pedido del usuario) no tiene boca, y los ojos son dos LED amarillos **dentro del visor negro**: el usuario los quiso "como un LED, dentro de lo negro, no afuera".
    - La cabeza es una esfera UV de 48×72, con una textura fija: blanca, con el visor oscuro y mejillas.
    - Arrastrarla desplaza los vértices con peso gaussiano alrededor del punto agarrado. Al soltar vuelve con muelles amortiguados, como la cara de Mario 64.
    - Los LED se dibujan en el shader de la cabeza (`FS_CARA`), en longitud y latitud sacadas de la UV, así que se estiran con la cara. Por ojo van `uC` (centro y escala), `uA` (párpado de arriba y apertura) y `uB` (párpado de abajo, brillo y forma).
    - Formas por distancia con signo: 0 = ojo con párpados (curvas `arriba`/`incl`/`curvaA` y `abajo`/`curvaB`), 1 corazón, 2 X, 3 "> <" y 4 espiral. Llevan rejilla de puntos de LED, núcleo casi blanco, borde naranja y un halo que ilumina el visor (retroiluminación). Fuera del visor no se pintan.
    - `GESTOS` define normal, escuchando, hablando, pensando, feliz (^ ^ con rubor), sorpresa, triste, enojado, curioso, guiño, dormido, aburrido, bostezo, amor (corazones que laten), error (X), mareado (espirales), risa/apretado ("> <") y bailando (ver **Música**).
    - La cabeza acompaña cada gesto (`CABEZA`: ladeo, cabeceo, salto y vaivén). `evento(nombre)` encadena gestos cortos (`EVENTOS`: bostezo, estornudo, tararear, mareo, risa, corazones, guiño, mirar).
    - El tamaño va con un muelle que rebota al cambiar de gesto. Parpadea (a veces doble) y mira al ratón, o vistazos al azar. Sin boca, al hablar los ojos laten con `boca(nivel)`.
    - `app.js` y `agente.js` le pasan el estado ("esperando", "escuchando", "pensando", "hablando", "sin-servidor", "normal") y emociones de un rato; `emocion(n, 0)` las quita. `alAgarrar` y `alSoltar(toque, info)` avisan a `humor.js`.
    - `depurar()` da los valores de los ojos, para las pruebas. El `dt` va de 0 a 1/30: el primer cuadro puede traer una hora anterior a la de montar, y con dt negativo los muelles explotaban.
    - Sin WebGL se ve un SVG plano parecido. `icono.svg` también cambió.
- `estilos.css`: solo tema claro, porque se pidió fondo blanco con azules y verdes.
- Modo internet (`*.web.app`, `*.firebaseapp.com` o `?nube`): no llama a `/api`, todo pasa por la nube (abajo).
    - Se entra con Google (`signInWithPopup`) y el enlace es de la cuenta.
    - `enviar()` escribe una orden y espera su respuesta. El estado llega por `onValue`.
    - Cada 20 s escribe un latido en `mirando/<uid>`, y entonces Píxel publica más a menudo. Si `vivo` tiene más de 40 s, muestra a Píxel desconectado.
- Publicar: proyecto `pixelassitance` (cuenta personal del usuario), https://pixelassitance.web.app.
    - `firebase.json` sirve `web/` y las reglas de `database.rules.json`.
    - El CLI del PC ya tiene la sesión iniciada: `npx firebase-tools deploy --only hosting` o `--only database`.

**Píxel en la nube** (`nube.py`, Fase 10): la app de internet encuentra a Píxel y lo maneja sin direcciones, como Alexa.
- El servidor entra solo en Firebase con una cuenta anónima (Identity Toolkit por REST). Su token de renovación queda en `NUBE_TOKEN` (`nube_token.json`): es la identidad de este Píxel, no se comparte.
- En la Realtime Database (`NUBE_DB`) publica el estado (`P.estado()` como texto JSON, sin el código de enlace) y un latido. Escucha `ordenes` y `solicitudes` por streaming SSE con `urllib`.
- El estado y los cuerpos de las órdenes viajan como texto JSON: la Realtime Database borra los `null` y las listas vacías.
- Enlace:
    - Sin dueños, o con "Enlazar otra app" en el panel local (Cuentas), Píxel aparece en `visibles` con un código de 6 cifras. Lo dice en voz alta si hay un ESP32 conectado y sale en el panel local.
    - La app escribe la solicitud y el servidor compara el código. Las reglas no lo hacen, para poder cortar tras `MAX_FALLOS` intentos.
    - Si acierta, escribe `duenos/<uid>` y `usuarios/<uid>/pixeles/<pid>`.
- Las órdenes ejecutan las mismas funciones que los POST del panel (`panel.RUTAS_POST`, ampliado con `/api/nube/enlazar`, `/decir` y `/quitar`). La respuesta se escribe en `respuestas/<id>` y se borra al minuto.
- Reglas en `database.rules.json`: cada Píxel solo escribe lo suyo y solo sus dueños leen su estado o le mandan órdenes.
- En la consola de Firebase están activados el acceso anónimo (lo usa el servidor) y Google (la app).

**Firmware** (fuera del repo, en `~/Arduino/`). No se sabe cuál lleva la placa: preguntarlo antes de suponerlo.
- `Pixel_portal/Pixel_portal.ino`, con portal WiFi y BLE:
    - Busca el servidor por broadcast, vacía el micro al arrancar y al conectar, y reconecta si un envío queda a medias.
    - Se compila sin subirlo con `~/.local/bin/arduino-cli compile --fqbn esp32:esp32:esp32s3:PartitionScheme=huge_app --build-path <carpeta temporal> ~/Arduino/Pixel_portal` (core esp32 3.3.12; desde la Fase 13 necesita la partición grande).
    - Guarda red, IP del servidor, volumen y ganancia en Preferences.
    - Si no encuentra la red, o si se mantiene BOOT 3 s, abre la red `Pixel asistente de voz` (clave `[clave del portal: notas privadas]`) con un formulario en `192.168.4.1`, y el LED se pone morado.
    - **Código al enlazarlo desde la app (12 nov, 2.3.0):** la app escribe `{"pedir_codigo": true}` por BLE. `atenderPedirCodigo()` (en `loop()`, que es quien habla con el PC) inventa 6 cifras con `esp_random`, válidas 3 minutos y con 5 intentos, y manda el debug `codigo:NNNNNN`; el PC lo dice por el altavoz. El BLE ya no acepta un dueño sin el código o sin el modo emparejar (BOOT). Además da `"codigo"` (`pedido` o `bloqueado`, nunca las cifras) y `"pc"` (`pcConectado`, que pone `loop()`). La orden `/api/olvidar` borra el dueño. Cargado el 12 nov a las 13:49.
    - **Luz (12 nov, para usarlo con batería):** al encender parpadea 4 veces en verde y queda **verde** (encendido, sin el PC); conectado al servidor del PC, **azul**; si se pierde el PC, vuelve a verde. Además, amarillo mientras habla, morado en el portal, cian al emparejar y rojo solo si falla el micro o el parlante. Copia de antes en `Pixel_portal.ino.respaldo-12nov` y `puente.ino.respaldo-12nov`. Sin carga por WiFi: para cambiarlo hay que conectarlo por USB.
    - **Placa nueva y micrófono USB (12 nov, tarde):**
        - La placa es una ESP32-S3 (QFN56, rev. 0.2) con 16 MB de flash y 8 MB de PSRAM en el chip. Sirve el mismo `--fqbn esp32:esp32:esp32s3:PartitionScheme=huge_app,PSRAM=opi`. Al PC va por el puerto COM (puente CH343, `/dev/ttyACM0`).
        - El micrófono no es el INMP441: es un micrófono USB («MUSIC-BOOST USB Microphone», `1b3f:0004`, audio USB 1, mono, 16 bits, 44,1 o 48 kHz). Va en el puerto 4 de un hub `1a40:0801` de 4 puertos, enchufado al puerto USB nativo. El hub tiene la corriente de un powerbank.
        - Con el programa de antes daba «piso de ruido=0». Una prueba con resistencias internas en IO6 lo confirmó: ese pin estaba al aire en los dos canales. Las ráfagas con «pico=32768» eran interferencia, no audio: casi todo silencio exacto y solo de 18 a 65 valores distintos.
        - `micro_usb.ino` lo lee con el anfitrión USB del core (ESP-IDF 5.5.5, que trae los hubs activados: `CONFIG_USB_HOST_HUBS_SUPPORTED=y`). Lo pone a 48 kHz, le pasa un paso bajo FIR (63 coeficientes, Hamming, 7,2 kHz) y lo baja a 16 kHz. Sin micrófono USB, `loop()` sigue con el I2S de antes. La «sensibilidad» del portal multiplica por 1, 2, 4 u 8.
        - **Dos trampas:**
            - `usb_host_interface_claim()` no manda SET_INTERFACE. Sin esa orden, el micrófono sigue en la alterna 0 y contesta cada milisegundo con paquetes vacíos. Hay que mandarla aparte (`0x01, 0x0B`).
            - Sin la función `enum_filter_cb`, en 5 arranques el micrófono no apareció; en los que se pudo medir, solo se reconoció el hub. Con ella, se reconoció en los 4 arranques que hubo. Es una coincidencia observada, no una causa probada. Por si acaso, si hay hub pero no micrófono, `musbTareaVigia` reinicia el puerto (hasta 5 veces).
        - **Medido:** 1000 paquetes por segundo, 96 000 bytes/s, unas 15 984 muestras/s de salida. En el servidor, piso de ruido de 336 a 448 y una frase de 1,9 s con pico 18 234. Whisper oyó «Hola, hola, hola, hola». El volumen del micrófono es 22,5 dB (de −12 a 33).
        - Los avisos van al servidor como debug «micro USB: …» (reconociendo, listo, desconectado). Copia del programa anterior en `*.respaldo-12nov-tarde`. Las pruebas que se usaron (`Prueba_mic`, `Prueba_usb`) quedaron fuera de `~/Arduino`.
        - El parlante MAX98357A va en BCLK=IO17, LRC=IO14 y DIN=IO7. **Con VIN a 5 V no sonaba:** el pin de 5 V de esta placa recibe corriente pero no la entrega. **A 3,3 V suena** (16:20). Con la prueba del pitido (`Prueba_parlante`: 1 kHz por el MAX, medido con el micrófono USB), el tono subió entre 56 y 531 veces sobre el silencio con los pines del programa, y nada con BCLK y LRC cruzados.
- `Etb_boot/Etb_boot.ino` es el básico del 21 oct:
    - Red e IP del servidor fijas (`SERVER_IP` = [IP del servidor: notas privadas]), sin portal, sin Bluetooth y sin descubrimiento.
    - Su `sendDebug` solo manda el primer byte del largo: un texto de más de 255 bytes rompe el protocolo.
    - Las mejoras de `Pixel_portal.ino` para él están en `Etb_boot.ino.mejoras-22oct`, sin aplicar. El 22 oct a las 14:59, `Etb_boot.ino` volvió a la versión original (igual a `Etb_boot.ino.respaldo-22oct`).

- **Fase 13:** `Pixel_portal/puente.ino` (con `certs.h`) hace del ESP32 un puente de aparatos (ver **Aparatos**). Pide la librería ArduinoJson 7. La placa es un ESP32-S3 N16R8 (16 MB de flash y 8 MB de PSRAM octal, MAC [MAC: notas privadas]).
    - Se compila y se carga con `--fqbn esp32:esp32:esp32s3:PartitionScheme=huge_app,PSRAM=opi`. Ocupa 1,35 MB; la partición de por defecto tiene 1,3. Con la PSRAM, las conexiones TLS no le quitan RAM al Bluetooth.
    - **Cargado el 9 nov a las 14:41**, con permiso del usuario: Pixel_portal + puente. Antes llevaba Etb_boot, y su copia completa está en `~/Arduino/respaldos/esp32_etb_boot_09nov_16MB.bin` (para volver: `esptool write_flash 0 <archivo>`).
    - Su cuenta de Firebase es `[uid de la cuenta del ESP32: notas privadas]`. Aún sin dueño: se enlaza desde la app por Bluetooth.
    - Hay que cerrar el Arduino IDE para cargar: su monitor serie se queda con `/dev/ttyUSB0`. Abrir el puerto reinicia la placa (`stty -F /dev/ttyUSB0 115200 raw -hupcl; cat`).
    - Cuidado al escribir para el ESP32: `Stream::setTimeout` va en **milisegundos**. Google contesta con `Transfer-Encoding: chunked`.

**Bluetooth en `Pixel_portal.ino`:** solo BLE, porque el S3 no tiene Bluetooth clásico.
- Se anuncia como `Pixel asistente de voz` (`NOMBRE_PIXEL`, el mismo nombre que la red del portal), con una característica de solo lectura con la red y el servidor. Va sin tildes y sin las cifras de la MAC: el nombre va en la respuesta al escaneo BLE (31 bytes), y con 4 bytes más ya no cabría entero.
- Cada 30 s hace una búsqueda de 3 s y manda los 20 dispositivos con más señal como texto de debug `0x04` con el prefijo `ble:` y un JSON `{"yo", "vistos":[{"n","m","r"}]}`. No es un tipo de mensaje nuevo: el protocolo no cambia.
- El servidor lo separa en `atender()` y lo guarda con `Sesion.recibir_ble()`. El panel lo muestra en la tarjeta de cada ESP32.
- Su `sendDebug` escribe el largo completo.
- Ocupa el 91 % de la partición por defecto.

**Correo, nunca sin confirmar:**
- Solo va a nombres de `contactos.json`.
- La acción `correo` no envía: devuelve `"confirmar"` con la función que envía, y la sesión (`Sesion.pendiente`) espera `CONFIRMAR_S` desde que termina de sonar el borrador.
- Solo "envíalo" o "mándalo" (`_RE_CONFIRMA`, nunca si empieza con "no") lo ejecutan. Cualquier otra frase con voz cancela, y el silencio caduca con aviso.
- No poner la frase de confirmación en `STT_PROMPT`: Whisper copia el prompt sobre el ruido.
- Para probar sin Google, sustituir `servicios_google.Google` por una clase falsa con `eventos`, `crear_evento` y `enviar_correo`.

**Boca sincronizada:** `enviar_audio()` apunta en `Sesion.voz` el volumen de cada trozo de voz cada `BOCA_PASO_MS` y la hora de reloj a la que empieza a sonar. No apunta los beeps.
- El panel lo da en `GET /api/voz`, que la app consulta cada 300 ms en Inicio.
- La nube lo publica en `pixeles/<pid>/voz` en cuanto Píxel habla (`servidor.AL_HABLAR`).
- La app busca el trozo que suena ahora con el desfase de reloj y llama a `cara.boca(nivel)`.

**Gemini** (`gemini.py`, Fase 11): si hay clave, `Llm.responder()` y el `Clasificador` le preguntan a Gemini en vez de a Ollama.
- REST `v1beta` con `urllib`. La clave va en la cabecera `x-goog-api-key`: nunca en la URL, en el log ni en `/api/estado`. La voz usa `:streamGenerateContent?alt=sse` y el clasificador `responseMimeType` JSON.
- Si falla antes de decir nada (sin internet, clave mala, 4xx/5xx, `GEMINI_TIMEOUT`), ese turno responde Ollama y queda una línea `gemini: fallo (...)` en el log. Tras un fallo de conexión se salta Gemini `gemini.PAUSA_S` (60 s), y tras un HTTP 429 (cupo agotado) `gemini.PAUSA_CUPO_S` (10 min): así no se paga la ida y vuelta en cada turno.
- `GEMINI_MODELO` = `gemini-3.5-flash-lite` con `thinkingLevel` `"low"`. Medido el 6 nov con la clave del usuario, en el plan gratis:
    - 3.5 Flash-Lite contesta en 0,88 s y acepta `"low"`. También responden `gemini-3.1-flash-lite`, `gemini-3.5-flash` y `gemini-flash-lite-latest`.
    - `gemini-3.8-flash` da 429 desde la primera petición: su cupo gratis es de 20 peticiones al día (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`). Según una fuente de terceros, los Flash-Lite tienen unas 500; Google no lo confirma.
    - `gemini-2.5-flash` y `gemini-2.5-flash-lite` dan 404 a usuarios nuevos.
    - Cada turno gasta 2 peticiones (clasificador y respuesta).
- Si el modelo rechaza `thinkingConfig`, reintenta sin él. No se manda `temperature`: en Gemini 3, Google recomienda dejar la de por defecto.
- La clave se pega en el panel local (Cuentas) y se guarda en `GEMINI_CLAVE` (`gemini_clave.json`, permisos 600, fuera de git). Vale al momento, sin reiniciar. `main()` la carga después de calentar Ollama, para que el respaldo responda rápido.
- `/api/gemini/clave` y `/api/gemini/probar` están en `panel.RUTAS_SOLO_LOCAL`, no en `RUTAS_POST`: `nube.py` ejecuta `RUTAS_POST` como órdenes de internet, así que la nube no puede poner ni probar la clave. En modo internet la tarjeta solo enseña el estado.
- "Probar" busca `GEMINI_MODELO` en la lista de modelos (ListModels) y hace una pregunta corta.
- Los logs del turno dicen quién contestó: `clasificador gemini|ollama` y `LLM gemini|ollama 1er token`.
- Para probar sin clave real, apuntar `gemini.URL` a un servidor simulado en local.

**El celular como micrófono del PC** (Fase 11, commit `b51e2cb`; **sin uso**): el celular mandaba sus frases a `pixeles/<pid>/frases` y el PC le devolvía la voz por `habla/<uid>`. Se cambió por "Píxel en la app" (abajo), que no necesita el PC. El cliente de `app.js` y sus reglas (`frases`, `escuchando`, `habla`) se quitaron. Están en ese commit, igual que su descripción en este archivo. El código del servidor sigue ahí, sin uso: `SesionMovil`, `MOVILES` y `sesion_que_habla()` en `servidor.py`, y `_atender_frases` y `_escribir_habla` en `nube.py`.

**Píxel en la app** (`web/agente.js`, Fase 12, rama `vinculacion_movil`): en la app de internet, el celular es Píxel entero, sin PC ni servidor. Vale para cualquier cuenta de Google. Enlazar el Píxel del PC queda opcional, para manejar el ESP32 y el panel.
- `app.js` carga `agente.js` solo en modo internet, al iniciar Firebase, y llama a `Agente.iniciar(app)`. En modo internet, Inicio, Personalidad y Agenda son del agente. Al cargarse, `agente.js` no toca la página: sus funciones de texto (`Agente.texto`) se prueban en Node.
- **Oír:** `webkitSpeechRecognition` continuo, con resultados intermedios. Se vuelve a arrancar cada vez que se corta, y Android lo corta tras cada frase. No funciona en Firefox: sale un aviso y queda la caja "Escribe a Píxel". Mientras habla, el reconocimiento se para. Pide Wake Lock.
- **Activación:** `activacion()` porta `servidor.quitar_activacion`, con variantes, prefijos, "Píxel, Píxel" y "Píxel" en medio de la frase. El reconocimiento del navegador casi no pone comas: en medio también vale si lo que sigue es una orden o una pregunta (`ARRANQUE`, `PREGUNTA`). "Píxel" sola dice "Dime" y abre 8 s para una frase sin "Píxel".
- **Pensar:** Gemini por Firebase AI Logic (`gemini-3.5-flash-lite`, `thinkingLevel` LOW), en streaming, con 4 turnos de historial que se olvidan tras 2 min. No hay clave en la página: AI Logic usa la Gemini Developer API del proyecto, en el plan gratis. Hace una petición por turno, o dos si una herramienta devuelve datos (Fase 13).
    - Acciones por function calling: `poner_musica`, `crear_recordatorio` (`en_minutos` para "en 10 minutos", que la app suma a la hora actual; `cuando` en ISO local para horas concretas, que calcula Gemini con la hora del prompt), `ver_recordatorios` y `borrar_recordatorio`. La frase de confirmación se arma en local.
    - Un 429 por minuto avisa y reintenta una vez; el del día dice que se acabó el cupo de hoy.
- **Hablar:** frase a frase, con `extraerFrases()` portado de `servidor.extraer_frases`. Desde la 2.0.0 habla con la voz de México de `voz.js` (ver **2.0.0**); `speechSynthesis` queda para «La voz del celular» y mientras la de México no está bajada. La boca de la cara sigue `Agente.nivelBoca()`.
    - **Voz infantil** (pedido del usuario el 9 nov): "Tipo de voz", ahora en Ajustes (`ajustes.tono`: `normal`, `infantil` o `muy_infantil`; por defecto `normal` desde la 2.0.0). `TONOS` en `agente.js` sube `pitch` y `rate` de cada frase (1,55 en infantil). No hay voces de niño en español para Piper ni para el navegador (ver **TTS**), así que es la misma voz más aguda.
- **YouTube:** sin servidor no se busca el video exacto. Sale una tarjeta "Abrir en YouTube" con la búsqueda.
- **Datos:** `usuarios/<uid>/recordatorios/<id>` (`{texto, cuando ms, creado}`) y `usuarios/<uid>/ajustes` (`{personalidad, respuesta, voz, tono}`; `voz` = `mx-mujer`, `mx-hombre`, `celular` o el `voiceURI` de una voz del celular, y vacía = `mx-mujer`). Solo el dueño los lee o escribe, con tipos y tamaños validados en `database.rules.json`.
    - Un recordatorio vencido se borra con una transacción antes de decirlo, así lo dice un solo aparato. Con la app cerrada no suena: se dice al volver, avisando que va tarde.
- **App Check:** al activar AI Logic en la consola, Firebase lo dejó "aplicado" (ENFORCED) para `firebaseml.googleapis.com`, y Gemini daba 401 "Firebase App Check token is invalid". Ver `memoria.md`, Fase 12.
    - El 6 nov se dejó en UNENFORCED por la API de App Check (`firebaseappcheck.googleapis.com/v1/projects/pixelassitance/services/firebaseml.googleapis.com`). Un cambio tarda unos 15 min en hacer efecto.
    - Para volver a activarlo: clave de reCAPTCHA v3 en `APP_CHECK_CLAVE` (`agente.js`), la app web registrada en App Check y luego ENFORCED.
- **Probar sin celular:** con `web/` servido en localhost, abrir `?nube=anonimo` con `puppeteer-core`, poniendo un `webkitSpeechRecognition` falso que dicte frases y la caja de texto. Chrome sin pantalla no tiene reconocimiento de voz real. Las cuentas anónimas de prueba quedan en Firebase Auth: hay que borrarlas.

**Fase 13: el agente completo** (rama `vinculacion_movil`). `agente.js` es el núcleo: voz, Gemini y confirmaciones. Las capacidades van en módulos que carga al iniciar (`MODULOS`) y que se registran con `Agente.modulo({...})`: herramientas (function calling), `ejecutar`, `contexto` para el prompt, `capacidad`, `montar`, `pintar`, `alUsuario`, `alSegundo`, `alTurno`, `alOirParcial`, `atajo`, `dictar` y `hero`. Todos se cargan solo en modo internet.
- **Modo música** (pedido del usuario el 9 nov: "diferenciar cuándo se queda en modo música y no"): el gancho `hero()` de un módulo cambia el recuadro de Inicio. `musica.js` lo usa mientras hay música: el título y la píldora dicen "♪ Modo música" (o "Música en pausa") y `.hero.modo-musica` lo pinta de morado y naranja. Al quitar la música vuelve a "Te escucho".
- **Modelos:** `MODELOS` = `gemini-3.5-flash-lite` y, de respaldo, `gemini-3.1-flash-lite`. El cupo gratis es por modelo y por día.
    - Con un 429 `GenerateRequestsPerDayPerProjectPerModel-FreeTier`, pasa al siguiente sin decir nada y lo recuerda hasta medianoche del Pacífico (`localStorage` `pixel.modelo`).
    - `gemini-flash-lite-latest` es el mismo 3.5: comparte su cupo.
    - El 9 nov las pruebas agotaron el cupo diario del 3.5 (unas 300 peticiones). Las pruebas de punta a punta gastan ~45 cada vez: no se deben correr enteras sin necesidad.
- **Atajos** (`atajo(texto)` de un módulo): órdenes que se resuelven sin Gemini. La música las usa mientras suena ("para", "pausa", "sigue", "cambia de canción", "la anterior", "más alto", "volumen al 40"): son instantáneas y no gastan cupo.
- **Bucle con Gemini** (`pensar`): una herramienta devuelve un texto, que se dice tal cual (la app confirma en local, sin otra petición), o `{respuesta}`: datos que vuelven a Gemini para que los resuma (correos, eventos, tareas). Hasta `MAX_RONDAS` vueltas.
    - Las respuestas de función van con rol `"user"` (con `"function"`, 400). Cada llamada lleva su respuesta, con el `id` de la llamada si lo trae (3.1 lo pone), y las partes del modelo vuelven con su `thoughtSignature`: Gemini 3 lo exige.
    - Un 429 por minuto avisa y reintenta una vez tras lo que pide Google (5-20 s). El del día dice "mañana".
- **Confirmaciones** (`Agente.nucleo.confirmar`): lo que no tiene vuelta atrás espera un "sí" por voz (`si`: RegExp sobre el texto plano, sin "pero/cambia…") o el botón de la tarjeta `#ag-confirmar`.
    - Lo usan enviar un correo (solo "envíalo/mándalo"; `seguir`: una corrección va a Gemini y la pregunta sigue en pie 30 min), borrar un evento, la papelera y suspender el PC.
    - **Gemini no tiene herramienta para enviar**: solo redacta borradores.
- **Instrucciones:** `web/agente.md` es el prompt de sistema, con `{{ACTIVACION}}`, `{{LARGO}}`, `{{CAPACIDADES}}`, `{{ESTILO}}` y `{{FECHA}}`. Le siguen el contexto de los módulos y, si hay, la pregunta pendiente.
- **Cerebro** (`cerebro.js`): notas en `usuarios/<uid>/cerebro/<id>` = `{titulo, texto, tipo, fijo, actualizado, origen}`. Tipos: `yo`, `gusto`, `persona`, `proyecto`, `regla` y `nota`.
    - RAG sin servicios de fuera: BM25 (palabras de 5 letras, sin tildes ni palabras vacías, más un extra por las palabras del título) sobre las notas y los trozos `## ` de `web/saber.md`.
    - Las reglas, las de tipo `yo` y las fijas entran siempre. El resto, las 5 que más tienen que ver con la frase y la anterior.
    - Herramientas: `recordar` (un dato por nota; si el título coincide, la actualiza), `olvidar` y `que_sabes_de_mi`.
    - Con "aprender" activo (`preferencias/aprender`), al acabar cada conversación (2 min sin hablar, al menos 2 turnos) una petición a Gemini con JSON extrae hasta 3 datos nuevos (`origen: "aprendido"`).
    - La tarjeta va en Personalidad. El correo de una persona (tipo `persona`) lo usa Gmail.
- **Google** (`google.js`): Calendar y Gmail con fetch, con el token de `reauthenticateWithPopup` y los alcances `calendar.events` y `gmail.modify`. Las API se activaron en el proyecto el 9 nov.
    - El token dura 1 h y Firebase no lo renueva. Se guarda en `localStorage` (`pixel.google`, por uid). Sin él, la herramienta dice que toque "Conectar Google" (`#ag-google`), y al conectar repite lo que se pidió.
    - Con cuentas anónimas no se puede: en las pruebas se pone un token falso en `localStorage` y se interceptan `googleapis.com`.
    - Calendario: `ver_calendario`, `crear_evento`, `mover_evento` y `borrar_evento`. Los eventos de 7 días salen en Agenda.
    - Gmail: `buscar_correos` (numerados, `g.ultimos`), `leer_correo` (sin citas, lo marca leído), `redactar_correo` (borrador en Gmail; si es respuesta, en el hilo con `In-Reply-To`), `corregir_borrador` y `ordenar_correos` (archivar, leído, destacar, importante, spam, etiquetas, papelera).
    - El destinatario sale del correo dicho, de las notas `persona` o de quien le escribió.
- **Enfoque** (`tiempo.js`, pestaña Enfoque): el usuario elige Pomodoro, Eisenhower o los dos (`preferencias/enfoque`), y según eso Gemini tiene unas herramientas u otras.
    - `usuarios/<uid>/pomodoro` lleva `fin` fijo; pausado, `fin: 0` y `queda`. El fin de fase se pasa con una transacción y lo anuncia el aparato que la gana. Si la app estuvo cerrada más de 5 min, solo se avisa.
    - Tareas en `usuarios/<uid>/tareas/<id>` `{texto, urgente, importante, hecha, creada, vence, pomodoros}`. `que_hago_ahora` va por cuadrante y por lo que vence antes.
- **Aparatos** (`aparatos.js`, Dispositivos): el navegador no puede hablar con la red de casa ni mandar infrarrojo, así que las órdenes van por Firebase a un **puente**.
    - Un puente es un Píxel enlazado (`usuarios/<uid>/pixeles/<pid>`) que recibe `pixeles/<pid>/ordenes` como el PC. Las capacidades salen de su estado: el del PC las trae en `puente`; el del ESP32 es `{tipo: "puente", capacidades}`. `app.js` (`elegirPixel`) ignora los de `tipo: "puente"`.
    - Aparatos en `usuarios/<uid>/aparatos/<aid>` = `{nombre, tipo, metodo, puente, config, acciones}`. Métodos: `pc`, `atv` (TV Android), `ir`, `rele`, `wol` y `http`.
    - `plan()` traduce la acción a la orden. Una acción propia (`acciones.encender = {metodo: "wol", mac, puente}`) manda sobre el método: así el PC se enciende por red desde el ESP32.
    - Herramientas `controlar_aparato` y `ver_aparatos`. Botones rápidos; "⋯" para aprender botones infrarrojos (`/api/ir/aprender`), emparejar el TV y la MAC de Wake-on-LAN.
    - "Agregar ESP32 por Bluetooth" usa Web Bluetooth (Chrome): lee la característica `BLE_NUBE`, le pasa la red si no tiene y luego el uid del dueño.
- **PC como puente** (`puente_pc.py`, rutas en `panel.RUTAS_POST`):
    - `/api/pc`: volumen con `pactl`, música con `playerctl` (MPRIS), abrir y YouTube con `xdg-open`, bloquear con `gdbus` (GNOME), apagar la pantalla con `xset` y suspender con `systemctl`, 2 s después de contestar.
    - `/api/aparato`: Wake-on-LAN, y http solo a IP privadas.
    - `/api/youtube/buscar`: busca para el reproductor de la app del celular (capacidad `youtube`).
    - `/api/tv`, `/api/tv/emparejar` y `/api/tv/codigo`: TV Android con `androidtvremote2` (instalado en `.venv` el 9 nov). Va en un bucle asyncio propio, con el certificado en `tv_cert.pem`/`tv_clave.pem`, fuera de git.
    - `nube._trabajar` pasa `decir`, `codigo` y `resultados` de la respuesta.
    - Para probar sin tocar el escritorio, sustituir `puente_pc._correr` y `puente_pc._abrir`.
- **ESP32 como puente** (`~/Arduino/Pixel_portal/puente.ino`): una tarea en el núcleo 0 que no depende del servidor de voz.
    - Entra con una cuenta anónima, cuyo token de renovación queda en Preferences "puente". Escucha `ordenes` por SSE con HTTPS a mano, contra las raíces GTS R1/R4 de `certs.h`, y escribe con una conexión keep-alive.
    - Órdenes: infrarrojo por RMT (`nec:0x…` o `raw:…`, emisor en IO16 y receptor en IO15), relé (pines de `PINES_RELE`, con `invertido`), Wake-on-LAN y http solo a la red de casa.
    - Enlace: un toque corto a BOOT da 2 min de modo emparejar, con el LED cian. La pulsación de 3 s sigue abriendo el portal.
    - `tools/puente_simulado.py` hace lo mismo en el PC: es la referencia del protocolo.
- **Música** (`musica.js`): "Píxel, pon…" la pone ya, y se maneja por voz como un asistente de verdad: "para", "pausa", "sigue", "cambia de canción", "la anterior", "más alto" (pedidos del usuario el 9 nov). Hay tres salidas con la misma interfaz (`SALIDAS`: `poner`, `pausar`, `seguir`, `parar`, `volumen` y `estado`). Se elige en Personalidad (`localStorage` `pixel.musica`, por aparato) o por voz (`donde`):
    - `ventana` (por defecto; él la quiere "en otra ventana"): `web/reproductor.html`, la ventana de música de Píxel, con el reproductor de YouTube dentro. Se reutiliza para cada canción, y en la app queda solo la barra de mando (`.musica.remota`).
        - No se abre youtube.com directamente: manda `Cross-Origin-Opener-Policy: same-origin-allow-popups`, y la página que lo abre pierde la ventana (no podría pararla ni cambiarla).
        - La app la maneja por `ventana.Pixel` (mismo origen). Es una ventana aparte (`popup`): en una pestaña, la de Píxel quedaría oculta y dejaría de oír.
        - Hay que permitir una vez las ventanas emergentes. Si no, suena en la app y lo dice. Si Chrome no la deja sonar sola, la ventana pide un toque una sola vez.
        - En Android suena en la app: una ventana sería una pestaña que tapa a Píxel, y una web no maneja la app de YouTube. Hay un botón para abrirla en la app de YouTube (`intent://`), ya sin control.
    - `app`: el reproductor embebido de Inicio (IFrame Player API).
    - `pc`: el navegador del PC (`/api/pc`: `youtube` con la URL exacta). `pausar` es `playerctl --all-players pause`, `play` es `playerctl play` (no el alternar de los aparatos), y antes de cada canción se pausa la anterior.
    - Para buscar el video exacto, primero prueba la YouTube Data API con `YOUTUBE_CLAVE`, que sale de `web/claves.js` (fuera de git; la plantilla es `claves.ejemplo.js`, y Hosting publica la carpeta local con la clave). Es la clave de navegador "Pixel: buscar en YouTube (app web)", creada el 9 nov con permiso del usuario: solo `youtube.api.v3.V3DataSearchService.List`, y solo desde pixelassitance.web.app, firebaseapp.com, el canal `prueba` y localhost:8099/8081. Un canal de prueba nuevo hay que añadirlo a la clave. Cupo: unas 100 búsquedas al día.
    - Si no, un puente con `youtube` en línea (el PC: `/api/youtube/buscar`, con yt-dlp, 5 resultados en `resultados` como texto JSON). Si tampoco, la tarjeta de antes.
    - Si un video no deja verse fuera de YouTube (error 101/150), pasa al siguiente resultado. Al acabar uno, sigue con el siguiente.
    - Si ninguno se deja poner (`videoFallo`), Píxel lo dice ("YouTube no me dejó poner ese video aquí") y deja la tarjeta "Abrir en YouTube". La ventana de música queda abierta con su aviso (`Pixel.aviso`): una barra abajo con el enlace al video, para que se pueda tocar el recuadro de YouTube por si pide iniciar sesión. Si ni con el toque arranca, la ventana muestra ese mismo aviso a los 6 s.
    - **Píxel baila** mientras suena (pedido del usuario). El audio de YouTube no se puede analizar (va dentro de su iframe), así que `poner_musica` lleva `bpm`: Gemini lo da en la misma petición o lo estima por el género.
        - `cara.bailar(bpm, reloj)` baila contando con el tiempo del video (`getCurrentTime`, suavizado porque llega a saltos): si se pausa, para, y al seguir retoma el paso. Por encima de 150 BPM va a medio tiempo.
        - Hay tres pasos que cambian cada 8 tiempos: rebote con vaivén, asentir mirando a los lados, y un giro completo. La cabeza se aplasta en cada golpe (`uEscala`) y los ojos ^ ^ saltan y destellan.
        - Hablando o pensando, baila menos. `humor.js` no lanza eventos mientras baila.
        - **Según el género** (`genero` de `poner_musica`, que lo da Gemini; `estiloDe()` también entiende nombres sueltos), `ESTILOS` define los pasos, los ojos, el color de los LED y las figuras:
            - Reguetón: perreo y lado, ojos «chévere» y guiño.
            - Rock y metal: cabezazos y sacudidas, ojos "> <".
            - Electrónica: robot y pulso, **LED neón** que cambian de color en cada golpe (`uTinte`).
            - Balada: se mece, ojos de éxtasis y corazones.
            - Salsa y cumbia: cadera, paso y giro.
            - Rap: asentir con actitud.
            - Clásica: director de orquesta.
            - Jazz.
        - Los pasos están en `PASOS` y se mueven también de lado (`centro.x`).
        - **Fondo** (`.fondo-musica`, una capa que `cara3d.js` pone detrás del lienzo, en `.escena`): en cada golpe (o cada 2, según `cada`) sube una figura (♪ ♫ ♬ ♩; ♥ en balada, ⚡ ★ en rock, ◆ ▲ ● en electrónica) del color del género, con un destello radial. Con movimiento reducido no hay figuras.
        - **Escenarios por género** (`web/escenarios.js`, pedido del usuario el 9 nov). Son SVG hechos a mano, sin imágenes ni nada de internet, en la capa `.escenario` del fondo:
            - Salsa y cumbia: una playa del Caribe de día, con palmeras que se mecen, olas y una garita del Morro (Puerto Rico). Reguetón: la misma playa al atardecer.
            - Rock: escenario negro con luces ámbar tenues que barren, amplificadores y humo. Metal: igual, con luces rojas.
            - Electrónica: láseres que barren, bola de espejos, focos de colores y un suelo de rejilla que avanza.
            - Balada: noche con luna y estrellas. Rap: la ciudad de noche. Clásica: teatro con telón rojo. Jazz: telón azul. Pop: guirnalda de bombillos y confeti.
            - `cara3d.js` pone el golpe del compás en la variable CSS `--golpe` (0 a 1): con ella laten las luces, los láseres y los bombillos (reglas `.es-*` en `estilos.css`). Con escena, el suelo de cuadros del WebGL se funde a solo la sombra (`uSoloSombra`), y Píxel queda de pie en la arena o en el escenario.
            - Se dibujan en 400×300 con `slice`: lo importante va entre y=30 y 270 y entre x=25 y 375. Los ids de cada escena llevan su nombre (`es-playa-…`).
            - En pausa la escena se va (deja de bailar). `tools/prueba_modulos.js` comprueba que cada género tiene escena y que el SVG está bien cerrado.
    - La música (en la app o en la ventana) baja a 12 en cuanto lo provisional trae "Píxel" (`alOirParcial`) y mientras Píxel piensa o habla.
    - Para las pruebas, `PixelMusica.usarBuscador()` cambia la búsqueda y `PixelMusica.estado()` da la cola, la salida y el estado de la ventana o del reproductor.
- **Notas dictadas** (`apuntes.js`, pestaña Notas; pedido del usuario el 9 nov):
    - "Píxel, toma nota [de …]" es un atajo, sin Gemini (también existe la herramienta `tomar_nota`). Píxel dice "Tomando notas para el lunes 9 de noviembre a las 2:49 de la tarde…" y la cara se pone en "escribiendo".
    - Desde ahí, `dictar()` (un gancho que el núcleo llama antes de buscar "Píxel") se queda con todo lo que se oye: cada frase con mayúscula y punto, y un párrafo nuevo tras 6 s de pausa.
    - "Píxel, termina la nota", "deja de tomar notas" o "Píxel, listo" (`esFin`) la guardan y preguntan si la analiza: un "sí" sin "Píxel" en la ventana basta. Tras 5 min de silencio se cierra sola.
    - "Analizar con Píxel" (botón o `analizar_nota`) hace una petición a Gemini con JSON: `resumen`, `ideas_generales`, `ideas_especificas`, `destacado` y `pendientes`.
    - Al guardar una nota, `clasificar()` hace una petición a Gemini que le pone `asunto` (1 a 3 palabras, reusando los que ya hay) e `importante` (una frase). Si falla, salen del título y de la primera frase. El análisis también los actualiza.
    - La pestaña es una lista compacta (pedido del usuario: la hoja "ocupa mucha pantalla"): una fila por nota (hora, título, ★ lo importante, asunto), agrupadas por día ("Hoy", "Ayer", "Jueves 5 de noviembre"). Se filtra por fecha (todas, hoy, ayer, 7 días o un día), por asunto (botones con su cantidad) y por palabras. Al tocar una fila se abre su hoja completa, y solo una a la vez.
    - **A los 30 días se borran solas** (`limpiarViejas`, una vez por sesión al cargar, porque no hay servidor). La hoja dice "se borra en N días".
    - Datos en `usuarios/<uid>/apuntes/<id>` = `{titulo, contexto, creado, actualizado, texto, asunto, importante, analisis (texto JSON), analizado}`, con reglas publicadas.
    - La hoja usa la clase `.nota-hoja`, no `.hoja`: `.hoja` es la de los `<dialog>`, y un `display` sobre ella mostraba los diálogos cerrados.
    - `humor.js` no se duerme ni lanza eventos mientras se dicta.
- **Obsidian** (`obsidian.py`): sincroniza `OBSIDIAN_BOVEDA` (`~/Obsidian/Pixel`) con el cerebro, en los dos sentidos, cada 5 s.
    - Hay una carpeta por tipo, el nombre del archivo es el título y lleva un frontmatter con id, tipo y fijo. Gana el cambio más nuevo, y lo borrado en un lado se borra en el otro. `.pixel-sync.json` recuerda lo sincronizado.
    - Solo para las cuentas que lo activan en la app: el botón escribe `usuarios/<uid>/confio/<pid>`, y las reglas solo dejan leer el cerebro así.
    - Obsidian 1.15 está instalado como AppImage en `~/Aplicaciones/obsidian`, con un acceso en el menú y la bóveda registrada en `~/.config/obsidian/obsidian.json`.

**Fase 14: segunda fase** (10 nov, rama `vinculacion_movil`, después de `v1.0.0`). El plan del usuario: aparatos y ESP32 listos para verificar, Google Calendar de verdad, la regla del correo, Pomodoro/Eisenhower en la pantalla principal y el mapa del cerebro como en Obsidian.
- **Inicio cambia con el enfoque** (`tiempo.js`; pedido: "cuando invoque esta función, que cambie la pantalla principal"):
    - Con un pomodoro en marcha, `hero()` pone "Enfoque · 24:57" (o "Descanso", "Pomodoro en pausa") y `agente.js` marca `.hero[data-modo]` (`pomodoro`, `descanso`, `matriz`; la música sigue con `.modo-musica`). Hay un anillo rojo con el tiempo alrededor de Pixel (`#escena-pomo`) y la tarjeta `#modo-enfoque` con Pausar/Seguir, "Ya terminé" (acaba la fase: `saltarFase`) y Parar. Al empezar un pomodoro o la guía se va a Inicio (`irAInicio`).
    - Mientras se trabaja, `humor.js` no se duerme ni hace payasadas (`PixelTiempo.enfocado()`).
    - **Guía de Eisenhower** sin Gemini: "Píxel, organiza mis tareas" (o "la matriz de Eisenhower", o el botón "Guíame" de Enfoque, o la herramienta `guiar_matriz`). Con el gancho `dictar` oye sin "Píxel": pide una tarea, pregunta si es urgente y si es importante (lo que ya dijo no lo pregunta: `leerTarea`), la guarda y al decir "listo" resume por cuadrante, dice por dónde empezar y ofrece un pomodoro con esa (una confirmación: basta "sí"). Se contesta también con botones o escribiendo. "Cancela" sale; 2 min sin contestar la cierra.
    - Atajos sin Gemini: "empieza un pomodoro (de 50 minutos) (para X)", "pausa / sigue / para el pomodoro", "¿cuánto queda?" (solo con uno en marcha) y "¿qué hago primero?".
    - **"Píxel, modo enfoque"** (atajo `pidoEnfoque`, o la herramienta `modo_enfoque`): Inicio muestra las dos herramientas (`htmlEnfoque`, guía en el paso `inicio`) y Píxel propone empezar por la matriz. "Sí" o "matriz" abre la guía; "pomodoro" va directo al plan. Una tira de pasos (`pasosEnfoque`: 1 ordenar → 2 pomodoro por tarea) marca dónde va.
    - Ojo con los nombres de clase de la tarjeta `#modo-enfoque`: la primera versión usaba `.enfoque`, que es la rejilla de 2 columnas de la página Enfoque, y en el PC (más de 760 px) partía la tarjeta en dos. La del modo enfoque se llama `.elegir`, y la rejilla ahora es `.grid.enfoque`.
    - **Plan: un pomodoro para cada tarea.** Al acabar la guía, con 2 o más tareas importantes, ofrece `empezarPlan()`: las de Hacer ya y Planificar en orden (`planDeTareas`, como mucho 12). El pomodoro guarda `plan` (texto JSON `[{id, texto}]`), `paso` y `seguir` (reglas publicadas el 10 nov).
        - Al acabar cada pomodoro pregunta "¿La terminaste?" (`t.pregunta`, se contesta en el descanso sin "Píxel" o con los botones de la tarjeta). "Sí" la tacha. "Aún no" pone `seguir` y el siguiente pomodoro repite esa tarea (`total` + 1). Sin respuesta, sigue con la siguiente y la otra queda pendiente en la matriz.
        - La transacción de `revisar()` elige la tarea del siguiente pomodoro (`avanzarPlan`, saltando las ya hechas). Sin más tareas, pasa al descanso largo: "¡Terminaste tu plan de enfoque!". "Con esa" es la tarea que Píxel acaba de proponer (`t.sugerida`). Una pregunta ("¿qué es un pomodoro?") va a Gemini.
- **Mapa del cerebro** (`web/mapa.js` + `grafo()`/`enlaces()` de `cerebro.js`; pedido: "un visual de cómo se forman los nodos de conexión en Obsidian"): en Personalidad, un grafo de fuerzas en canvas como el de Obsidian. "Tú" en el centro, una burbuja por carpeta y sus notas; las notas que se nombran (su título con palabras completas, o `[[Título]]`) van unidas. Se arrastra y se toca (sale la nota y con qué se conecta). Las etiquetas que chocan se esconden. `MapaCerebro` es un `const` global (no está en `window`).
    - `obsidian.py` dibuja lo mismo en Obsidian: al pie de cada nota un bloque desde `MARCA` (`<!-- pixel:enlaces`) con su carpeta y las notas que nombra; notas índice `Tú.md` y una por carpeta (con `pixel: indice` en la cabecera; no pisa un archivo del usuario con ese nombre); colores por tipo en `.obsidian/graph.json` si el usuario no puso los suyos (los mismos que `COLORES` de `cerebro.js`). El bloque se quita al leer y el hash de la nota se calcula sin él: rehacerlo no se sube a la app.
    - `enlaces()` está en los dos lados (Python y JS): las pruebas usan las mismas notas de ejemplo y deben dar los mismos pares.
- **Probar un puente** (Dispositivos → "Probar", o "Píxel, prueba el ESP32 / el PC", sin Gemini): `probarPuente()` en `aparatos.js`, sin piezas.
    - ESP32: la orden `/api/eco` (no existe: si contesta "Esa orden no existe en el ESP32", recibe y contesta) y luego `http` al panel del PC (`/api/voz`) por el WiFi de casa, si el PC está en línea. "Esta app no es mi dueña" = hay que volver a enlazarlo.
    - PC: `/api/pc {accion: "probar"}` (`puente_pc.diagnostico()`, solo lee): volumen, reproductor (playerctl) y TV. El TV cuenta como emparejado solo si está en `tv_emparejados.json` (se escribe al acertar el código; el certificado se crea antes).
    - `tools/puente_simulado.py` hace el `http` de verdad, con el mismo filtro de red de casa que el firmware.
- **Google con la cuenta real**: Cuentas → "Probar con mi cuenta" (`PixelGoogle.probar`, solo lee): Calendar (eventos de 7 días) y Gmail (`/profile`). Sigue sin probarse con la cuenta del usuario: hace falta su celular.
- **WhatsApp** (`web/whatsapp.js` y `puente_pc.whatsapp`; pedido: "dile que entre a WhatsApp y le escriba a tal persona hola"). Con el enlace oficial "click to chat" (`wa.me`), sin bots ni programas no oficiales: con esos WhatsApp puede bloquear el número.
    - La herramienta `escribir_whatsapp` no envía: arma el mensaje y pregunta "¿Se lo mando?" (`confirmar`, con `seguir`: una corrección va a Gemini). Solo "sí" o el botón llaman a `abrir()`.
    - **Celular:** abre `wa.me/<número>?text=` (WhatsApp redirige a `api.whatsapp.com/send`) y el usuario toca enviar. Si el navegador no deja abrir sin un toque (el "sí" fue por voz), queda la tarjeta `#ag-whatsapp` con "Abrir WhatsApp". No usar `noopener` en `window.open`: con él siempre devuelve `null`.
    - **PC:** cuando el usuario lo pide, o si la app está en un computador con el PC en línea, va la orden `/api/pc {accion: "whatsapp", numero, texto}`. `xdotool` lo instaló el usuario el 10 nov; el servicio tiene `DISPLAY` y `XAUTHORITY`. Sin `xdotool`, lo deja escrito.
        - Si WhatsApp Web ya está abierto, usa **esa pestaña** (pedido del usuario: no abrir otra, que dejaría "WhatsApp está abierto en otra ventana"). La reconoce por el título de la ventana (`RE_TITULO_WA`, estricto: "(90) WhatsApp - Google Chrome", no "WhatsApp - Buscar con Google"). Si está de fondo, la trae con la búsqueda de pestañas de Chrome (Ctrl+Shift+A, "WhatsApp", Enter), y solo la usa si después el título lo confirma.
        - En esa pestaña, **sin recargarla** (pedido del 10 nov): Escape dos veces (cierra el chat abierto), Ctrl+Alt+N («Nuevo chat»), pega los últimos 10 dígitos del número, Abajo, Intro (abre el primer resultado) y pega el mensaje. **No lo envía** (`WHATSAPP_ENVIAR_EN_PESTANA = False`): el título de la ventana no dice qué chat quedó abierto, así que el usuario revisa y oprime Intro. Si el número no está en sus contactos, el texto queda en el buscador y no le llega a nadie.
        - Todo se **pega** con `xclip` (`_pegar`, deja el portapapeles como estaba), nunca con `xdotool type`: con el teclado `latam,us` del usuario, los «:» de `https:` salían «ñ» y la pestaña quedaba en `http://httpsñ//web.whatsapp.com/…` (10 nov).
        - Si no está abierto en ninguna parte, abre una pestaña nueva con `xdg-open` (el enlace ya trae el chat correcto), espera `WHATSAPP_ESPERA_S` y oprime Enter dos veces. El segundo cae en la caja vacía si el primero ya envió.
        - Pruebas sin tocar el escritorio: `.venv/bin/python tools/prueba_puente_pc.py`.
    - **Números:** van en la nota de la persona en el cerebro ("WhatsApp: +57 300 123 4567", `conNumero`). Si no lo tiene, Píxel lo pregunta; la respuesta termina en "?" para que el número se diga sin "Píxel", y lo guarda con `Cerebro.recordar`. El indicativo por defecto sale del idioma del navegador (`es-CO` → 57).
    - No probar el camino del PC de verdad: enviaría un mensaje real. Se prueba con `_abrir` y `_correr` sustituidos.
- **Ajustes** (`web/ajustes.js`, pestaña Ajustes; `v1.3.0`; pedido: "todos los modos de Píxel con un switch de on y off y una descripción: esto gasta la licencia de Gemini, esto no", "un visual del costo de Gemini" y "dejar el consumo en bajo").
    - `MODOS` lista cada modo con lo que hace, si gasta Gemini (`si`, `aveces`, `no`, `ahorra`) y cuánto. Cada interruptor va en `usuarios/<uid>/preferencias/modos/<id>`, salvo "Aprender solo", que sigue en `preferencias/aprender`.
    - `agente.js` (`nucleo.activo`, `usar(m)`) apaga los módulos en `false`: sin herramientas, atajos, `dictar`, `hero`, `alSegundo`, `alTurno` ni contexto. Sus pestañas (Enfoque, Notas) se esconden. Con `gemini` apagado, `orden()` contesta en local y no pregunta nada a Gemini.
    - `MODOS_DEFECTO` deja el consumo bajo: `aprender` y `clasificar` (asunto de las notas con Gemini) apagados, `analizar` (ofrecerlo al acabar una nota) encendido, y `ahorro` encendido. `ahorro` = 2 turnos de historial en vez de 4, y el RAG del cerebro con 3 notas y la mitad de caracteres.
    - Una prueba de `prueba_modulos.js` exige que cada módulo de `MODULOS` tenga su entrada en `MODOS`.
- **Consumo de Gemini**: `contarUso()` (`agente.js`) apunta cada petición que contesta en `usuarios/<uid>/uso/<día del cupo>` (`diaDelCupo`: el día de Google, que empieza a medianoche del Pacífico). Guarda `{peticiones, entrada, salida, por: {charla, herramienta, aprender, clasificar, analizar}, m: {<modelo con "_">: {n, e, s}}}`.
    - La salida incluye los tokens de "pensar" (Google los cobra así).
    - Con streaming, el resumen final del SDK (`aggregateResponses`) no trae `usageMetadata`: se lee de los trozos de `r.stream`. `generarJSON(prompt, instrucciones, motivo)` lo lee de `r.response`.
    - Ajustes dibuja: cifras de hoy, columnas de 7 días (una serie, un color, con globo y "Ver en tabla"), en qué se gasta y lo que costaría con el plan de pago (`PRECIOS`).
    - `PRECIOS` = precios oficiales del 10 nov 2026 (ai.google.dev/gemini-api/docs/pricing): 3.5 Flash-Lite US$ 0,30 entrada y 2,50 salida por millón de tokens, y 3.1 Flash-Lite 0,25 y 1,50. El plan gratis no cobra; Google no publica un número fijo de peticiones gratis por día.
    - Los días de más de 30 se borran al abrir.
- **Sonidos** (`agente.js`, pedido del 10 nov: "sonidos de entrada cuando llamo a Píxel, de pensar y de salida"). Con Web Audio, sin archivos: notas con un armónico que suenan a campanita.
    - `sonido("entrada")`: mi-si-mi subiendo, al empezar cada orden y antes del "Dime".
    - `sonido("salida")`: la misma bajando, al acabar. Se espera a que termine antes de volver a escuchar.
    - `sonido("aviso")`: lo que dice por su cuenta (recordatorios, `anunciar`).
    - `sonarPensando()`: do-mi-sol-mi muy bajito mientras el estado es "pensando". Empieza a los 600 ms, así que un atajo instantáneo no lo hace sonar.
    - Reemplazan los `beep()` de antes. Se apagan con el modo `sonidos` de Ajustes.
    - En las pruebas, un `AudioContext` falso apunta las frecuencias.
- **Proveedor de IA con la clave del usuario** (`web/proveedores.js`, `web/proveedor_claude.js`; Ajustes → «Proveedor de IA»). Pedido: "un espacio donde se ponga la API key según el proveedor… que acepten GPT, Kimi, etc. solo con la API key, y en el panel se vea cómo se gasta".
    - **Proveedores:**
        - `pixel`: el de siempre, Gemini por Firebase, gratis.
        - `gemini`: REST con `x-goog-api-key`.
        - `claude`: la librería oficial `@anthropic-ai/sdk@1.3.0` cargada desde jsDelivr, con `dangerouslyAllowBrowser`. Va en su propio archivo.
        - `openai`, `openrouter`, `deepseek` y `otro`: compatibles con la API de OpenAI, con `/chat/completions` en vivo y `/models` para elegir.
    - **Kimi (Moonshot) no tiene CORS** (comprobado el 10 nov): se usa por OpenRouter. OpenAI, DeepSeek, OpenRouter, Anthropic y Gemini sí dejan que la página los llame. Los modelos no se inventan: los de OpenAI, OpenRouter y compañía salen de `/models` («Buscar modelos») o los escribe el usuario.
    - **La clave se guarda solo en el aparato** (`localStorage` `pixel.ia`): nunca va a la nube ni a git.
    - `Proveedores.motor()` devuelve el mismo objeto que `getGenerativeModel` de Firebase: `generateContentStream({contents})` con trozos al estilo Gemini, y `generateContent(prompt)`. `pensar()` y `generarJSON()` no cambian con el proveedor. Con clave propia no se cambia de modelo cuando se acaba el cupo; si la clave falla, `textoError` dice de quién es el problema.
    - **Claude:**
        - `messages.stream` + `finalMessage()`, `eager_input_streaming` en cada herramienta, con la entrada validada aquí. No ejecuta herramientas si el `stop_reason` es `max_tokens` o `refusal`. Esfuerzo `low`.
        - En las vueltas con herramientas devuelve el `content` de Claude tal cual, con sus bloques de pensar (`crudos`).
        - Opus y Sonnet llevan `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`). Haiku no.
        - Con la API `2026-10-21`, la librería manda la clave como `Authorization: Bearer`, no `x-api-key`: es lo correcto.
    - **El consumo:** lo de la clave propia se apunta como `propia:<modelo>` y Ajustes lo cuenta aparte, como costo real. Los precios salen de `LISTA` (Gemini y Claude), de OpenRouter, o los escribe el usuario. Probado en el navegador con GPT, Claude y Gemini simulados (`proveedor.js` de las pruebas de esa sesión). Con claves reales todavía no se probó.
- **Cuenta de Google**: al entrar siempre se elige la cuenta (`prompt: select_account`), y en Cuentas hay «Cambiar de cuenta». Sirve para la cuenta de demostración de la feria. Calendar y Gmail no se piden al entrar, para que un visitante que solo charla no vea el aviso de «app no verificada».
- **Reglas** (revisión del 10 nov): cada usuario solo ve lo suyo, cada Píxel solo lo suyo, y las órdenes solo las crean los dueños. `visibles` publica nombre y hora, no el código.
    - **Hueco cerrado:** un Píxel (cualquier cuenta anónima) podía meterse en la lista `usuarios/<uid>/pixeles` de cualquier usuario del que supiera el uid. Ahora solo entra si ya estaba, o si la app escribió antes `usuarios/<uid>/enlazando/<pid>` (vale 15 min).
    - La app lo escribe al pedir el código (`pedirAPixel`) y antes de pasarle la cuenta al ESP32 por Bluetooth. `puente_simulado.py` avisa su `pid` y reintenta, como el ESP32.
    - Queda sin cerrar que una cuenta anónima puede gastar el Gemini del proyecto o escribir en su propia rama: eso lo cierra App Check (pendiente).
- **La regla del correo** (el usuario: "que no envíe sin aprobación, mantener esa regla"): una prueba de `prueba_modulos.js` falla si alguna herramienta se llama como enviar, si `drafts/send` aparece más de una vez o si `enviarBorrador` se usa fuera de una confirmación.

**2.0.0: Píxel te conoce** (10 nov, rama `vinculacion_movil`). Pedido del usuario: "un login con Google… el nombre de la cuenta, subir la foto del perfil y los datos; Píxel en su primer contacto te dice que es un agente de IA creado por Divergencia IA… y te invita a entrar a configuración; que el agente se perfile según el formulario o un archivo Markdown", y "voces de hombre y mujer mexicanos, súper suaves y elocuentes, en Ajustes".
- **Pantalla de entrada** (`app.js`): en modo internet, sin sesión, `body.sin-sesion` esconde pestañas, píldoras y tarjetas, y deja solo a Píxel con «Entrar con Google» (`vista()` fuerza Inicio). Se espera a `nube.authListo` (lo pone `sesion()`) para no enseñarla de golpe a quien ya tiene sesión guardada. El toque de «Entrar» desbloquea el audio y empieza a bajar la voz.
- **Mi perfil** (`web/perfil.js`, módulo `perfil`; se abre tocando la foto de arriba, `#cuenta`, sin pestaña propia): `usuarios/<uid>/perfil` = `{nombre ≤60, apodo ≤40, trato: tu|usted, foto, sobre, gustos, ayuda, reglas (≤600 cada uno), creado, actualizado, bienvenida}`, con reglas publicadas el 10 nov.
    - **Registro:** si no existe, se crea con el nombre de Google al entrar.
    - **Foto:** recortada a 256×256 en JPEG dentro de la misma base de datos (máx. 120 000 caracteres, `data:image/jpeg;base64,…`): el almacén de archivos de Firebase pide el plan de pago. Sin foto propia, la de Google (`photoURL`).
    - **Markdown:** «Descargar plantilla» (`aMarkdown`), «Subir archivo .md» y «Descargar mi perfil». `leerMarkdown()` reconoce los títulos de la plantilla y parecidos (`TITULOS`) sin IA; lo que va bajo títulos desconocidos se junta en `sobre`. Sin ningún título conocido, una petición `generarJSON(…, "perfil")` lo pasa a los campos. En los dos casos llena el formulario y solo se guarda con «Guardar perfil».
    - **En las instrucciones:** `{{PERFIL}}` de `agente.md` ("Quién es el usuario") con `paraPrompt()`, sin pronombres (no se adivina el género). Con «Consumo bajo», cada campo entra más corto. Las reglas del perfil cambian el estilo, nunca la seguridad.
    - «Borrar mi perfil» lo quita (se vuelve a crear vacío); las notas, tareas y recordatorios se quedan.
- **Primer contacto:** si el perfil no tiene `bienvenida`, Píxel se presenta en voz alta (`presentacion()`: agente de IA creado por Divergencia IA, híbrido de asistente de voz e IA, la capacidad se la da el modelo que el usuario elija, y la invitación al perfil) y sale la tarjeta `#bienvenida` (debajo de la cara) con «Ir a mi perfil» y «Después». Espera la voz de México como mucho 15 s. Se apunta `bienvenida` para no repetirlo; «Que Píxel se presente otra vez» está en el perfil. `agente.md` también dice quién lo creó.
- **Voz de alta calidad: Supertonic 3** (`web/voz.js` + `web/voz_trabajador.js`; Ajustes → «Voz de Píxel», `#card-voz`; Personalidad ya no muestra la voz en modo internet). El usuario dijo que las de Piper estaban «del asco» y eligió la **F4** de las muestras de `voces_prueba/supertonic3/`.
    - Supertonic 3, de Supertone (`huggingface.co/Supertone/supertonic-3`, versión fija en `BASE`; modelo OpenRAIL-M, código de ejemplo MIT). 31 idiomas, 10 voces (`st-F1`…`st-M5`; por defecto `st-F4`). Las 10 usan el mismo modelo: cada voz es un JSON de estilo. Las de Piper guardadas antes (`mx-mujer`, `mx-hombre`) pasan a `st-F4`/`st-M1` (`ALIAS`).
    - Lee letras, no fonemas: `leer()` escribe en palabras números, horas («15:30» → «quince y treinta»), porcentajes, grados y precios. `tts_supertonic.leer` hace lo mismo en el PC (`tools/prueba_voz.py` compara las dos).
    - Pesa **398 MB** (fp32: vector_estimator 256, vocoder 101, text_encoder 36). Se baja una vez a la caché `pixel-voces-2`, sola solo con WiFi y sin ahorro de datos; con datos, «Bajar ahora» o «Escuchar». La caché vieja de Piper (`pixel-voces-1`) se borra.
    - `voz_trabajador.js` (module worker) sigue el `helper.js` oficial con `onnxruntime-web@1.22.0`: WebGPU si hay una tarjeta gráfica de verdad (no SwiftShader), si no WebAssembly de un hilo.
    - **Pasos** (`ajustarPasos`): empieza con 5, sube hasta 8 si sobra tiempo y baja hasta 4 si va justa. Con 3 frases seguidas a más de 1,3 × tiempo real con 4 pasos, `lenta()`: habla la del celular y Ajustes ofrece «Intentar otra vez».
    - Medido en Chrome sin pantalla (WebAssembly, PC): 4 pasos ≈ 1 × tiempo real; bajada y lista en 20-40 s desde Hugging Face. En el celular no se ha medido.
    - `agente.js`: `decirFrase` pide el sonido al encolar (la frase siguiente se genera mientras suena la anterior); `siguiente()` lo hace sonar con `VozPixel.reproducir` (Web Audio, `playbackRate` = tono) y, si falla, usa `speechSynthesis`. La boca sigue el volumen real (`envolvente`). La presentación espera la voz como mucho 15 s; si aún se baja, habla con la del celular.
    - **En el PC** (`tts_supertonic.TtsSupertonic`, modelo en `voces/supertonic3/`, fuera de git): `panel.VOCES` empieza por las 10 de alta calidad (`SUPERTONIC`); cambiar entre ellas solo cambia el estilo. 5 pasos, 4 hilos: 0,34-0,56 × tiempo real y se carga en 0,9 s. El `ajustes.json` real tiene `st-F4` desde el 10 nov.
- **«✓ Guardado»** (pedido: "que salga un ok, está guardado, y se vea guardado"): al guardar el perfil, el botón pasa a «✓ Guardado» en verde (desactivado hasta que se cambie algo), al lado dice «¡Listo, quedó guardado!» y luego «Guardado hoy a las …», y el formulario brilla un momento. Con cambios sin guardar dice «Tienes cambios sin guardar» (`pintarGuardado` en `perfil.js`).
- **Contactos** (`web/contactos.js`, pestaña Contactos; pedido: "una opción que se llame Contactos con el nombre, el celular y el correo"): `usuarios/<uid>/contactos/<id>` = `{nombre ≤60, telefono (solo cifras con indicativo), correo ≤120, actualizado}`, con reglas publicadas.
    - La primera vez pasa solas las notas de personas del cerebro con número o correo (`desdeNotas`) y marca `preferencias/contactos_importados`: lo que se borre no vuelve.
    - WhatsApp (`buscarPersona`, `guardarNumero`) y Gmail (`correoDePersona`) buscan aquí primero, y un número dicho por voz se guarda aquí (antes, en la nota del cerebro).
    - Herramientas `guardar_contacto` y `ver_contactos`. Agregar, editar y borrar en la pestaña, con buscador.
- Pruebas: `prueba_modulos.js` (voz, perfil y contactos, 64 en total) y `tools/prueba_voz.py` (los números del PC como en la app). Las de punta a punta de esta sesión (tarjeta de voz, entrada, registro, presentación, perfil, foto, .md) están en `memoria.md`, 2.0.0.

**TTS** (`tts.py`): Piper sale a 22050 Hz y se remuestrea a 16000 Hz con numpy (FIR paso bajo + interpolación lineal, sin scipy).
- **Voz infantil** (9 nov): no existe una voz de niño en español para Piper. Se revisaron HirCoir/Piper-TTS-Spanish, la colección piper-tts-onnx-models de Trelis y AIHeaven/piper_unofficial_voices (Hugging Face), y para el navegador vits-web y piper-tts-web: solo hay voces adultas.
- Por eso `TTS.agudo` (1,0 normal) sube el tono sin cambiar la duración: Piper habla `agudo` veces más lento (`length_scale`) y luego se remuestrea como si su frecuencia fuera `sr × agudo`. `panel.TONOS` = normal 1,0, infantil 1,32 y muy infantil 1,55, en `ajustes.json` (`tono`; por defecto `normal` desde la 2.0.0), y se aplica en vivo. Medido: 216, 283 y 327 Hz de tono medio.
- `agudo` por debajo de 1 baja el tono (mínimo 0,8): `panel.BASE_VOZ` lo usa para la voz de hombre (`ald`, 0,92: de ~158 a ~146 Hz), igual que `base` en `web/voz.js`.

**Configuración:** todos los parámetros (VAD, modelos, variantes de activación, beeps, `STT_PROMPT`) son constantes al inicio de `servidor.py`; no hay CLI ni variables de entorno. El prompt de sistema lleva la fecha, que se fija al arrancar.

## Convenciones

- Todo en español: nombres, comentarios, logs. Comentarios y docstrings sin tildes; los textos que se dicen por voz sí llevan tildes.
- HTTP con `urllib` de la librería estándar (sin `requests`). El cliente de prueba usa solo stdlib.
- Los módulos se nombran por fases en su docstring ("Fase 3 - …").

## Notas del proyecto

- `memoria.md` es el registro de mediciones y decisiones (Whisper `base` contra `small`, el coste del `initial_prompt`, falsos positivos de la activación, muestras de voces). Léelo antes de tocar el STT, la activación o el clasificador, y anota ahí los resultados nuevos. Tiene una lista de pendientes.
- `capturas/` tiene frases reales del ESP32 (WAV 16 kHz mono), útiles como casos de prueba. `servidor.log` guarda la salida de sesiones anteriores. Sus líneas llevan la hora pero no la fecha: cada arranque empieza con `cargando faster-whisper`, y eso separa los días.
- Voces del PC (`panel.VOCES`): desde la 2.0.0 van primero las 10 de alta calidad de Supertonic 3 (`voces/supertonic3/`, `st-F4` es la del `ajustes.json` real); siguen las de Piper: «Mujer · México» (`voces_prueba/modelos/es_MX-claude-high.onnx`), «Hombre · México» (`voces/es_MX-ald-medium.onnx`), Sharvard F (`voces/es_ES-sharvard-medium`, la de `TTS_VOZ` en `servidor.py` antes de cargar los ajustes) y Daniela. `voces_prueba/` tiene candidatas y sus WAV de muestra; las femeninas están en `voces_prueba/femeninas/`.

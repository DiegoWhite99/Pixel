# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es

Asistente de voz para una demo de feria. Un ESP32-S3 (micrófono INMP441; su firmware **no** está en este repo) manda audio por TCP. El servidor en Python lo transcribe (faster-whisper), decide la acción (regex, clasificador LLM o respuesta libre del LLM) y devuelve voz (Piper o Supertonic). Palabra de activación: "Píxel". Gemini responde si hay clave; si no, Ollama (`qwen2.5:3b` en `127.0.0.1:11434`).

Repo público: https://github.com/DiegoWhite99/Pixel. No entran claves, grabaciones ni datos personales (ver `.gitignore`). Ramas: `main` (v2.0.0) y `vinculacion_movil` (trabajo nuevo). Versiones `vX.Y.Z` con su historia en `README.md`.

**Detalle y mediciones:** `memoria.md`, con el registro de decisiones y, al final, el apéndice "Referencia detallada" (el detalle por fase que antes estaba aquí). **Funciones, código y rutas:** `docs/FUNCIONES.md`. **Auditoría de esta limpieza:** `docs/AUDITORIA.md`.

## Comandos

```bash
# Servidor: servicio de usuario (Restart=always, salida en servidor.log). Python carga al arrancar: tras cambiar un .py, reiniciar.
systemctl --user restart pixel
tail -f servidor.log

# A mano (con el servicio parado; necesita Ollama y DISPLAY)
.venv/bin/python servidor.py

# Pruebas (no gastan Gemini ni Firebase; ver docs/AUDITORIA.md, sección 4)
.venv/bin/python -m pytest                          # todas
.venv/bin/python -m pytest -k obsidian              # una
node tools/prueba_modulos.js                        # funciones puras de web/*.js

# Linter: ruff (reglas en ruff.toml: solo errores reales y pyflakes)
.venv/bin/ruff check .

# Cliente que simula al ESP32 (solo stdlib)
python3 tools/cliente_prueba.py capturas/<archivo>.wav
```

Dependencias: `requirements.txt` (ejecución) y `requirements-dev.txt` (pruebas y linter). Python 3.10. `venv/` es una copia sin uso.

Para probar la lógica sin cargar modelos, importar `servidor` o `acciones` es barato (los modelos cargan en `main()`):

```bash
.venv/bin/python -c "import acciones; print(acciones.detectar('pon Queen en YouTube'))"
```

Ojo: una acción de YouTube busca de verdad y abre el navegador del PC. Para pruebas, sustituir `acciones._abrir`.

Servidor de prueba aislado (no toca el real ni sus JSON; luego `tools/cliente_prueba.py --port 8799`):

```bash
.venv/bin/python -c "import servidor, acciones; servidor.PORT = 8799; servidor.PANEL_PORT = 8081; servidor.RECORDATORIOS_ARCHIVO = '/tmp/r.json'; servidor.EVENTOS_ARCHIVO = '/tmp/e.json'; servidor.AJUSTES_ARCHIVO = '/tmp/a.json'; servidor.DISPOSITIVOS_ARCHIVO = '/tmp/d.json'; servidor.CONTACTOS_ARCHIVO = '/tmp/c.json'; servidor.GOOGLE_TOKEN = '/tmp/g.json'; servidor.GEMINI_CLAVE = '/tmp/gm.json'; servidor.NUBE_DB = ''; servidor.DESCUBRIR_PORT = 0; servidor.CAPTURE_DIR = '/tmp/capturas'; acciones._abrir = lambda url: 0; servidor.main()"
```

Con el servidor real arriba, el panel (8080) está ocupado: la prueba usa 8081. El `ajustes.json` real puede tener `"salida_voz": "pc"`; sin archivo, la salida es `"esp32"`. Para probar la nube, usar otra identidad (`servidor.NUBE_TOKEN`, `servidor.NUBE_NOMBRE`) y borrar los datos al acabar.

Chrome sin pantalla para la web: `puppeteer-core` fuera del repo, con `executablePath: "/usr/bin/google-chrome"` y `args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]`. Las pruebas de punta a punta (`tools/prueba_app.js`) gastan cupo de Gemini: ver docs/AUDITORIA.md.

## Arquitectura

**Protocolo con el ESP32** (contrato fijo con el firmware): cabecera `struct "<BI"` = tipo (1 byte) + longitud (uint32 LE) + payload. `0x01` audio ESP32→servidor, `0x02` audio servidor→ESP32, `0x03` fin de turno, `0x04` texto de debug UTF-8. PCM 16 kHz, 16 bit, mono, tramas de 20 ms (640 bytes).

**Hilos por conexión** (`servidor.py`, clase `Sesion`): el hilo del socket solo recibe y corre el VAD por energía (calibra el piso con los primeros 500 ms). Cada frase cerrada se guarda en `capturas/` y se encola. Un hilo trabajador ejecuta `_turno()`. El micro queda sordo mientras suena la voz (`enviar_audio()`, `fin_reproduccion` + `ECO_MARGEN_S`) para que Píxel no se oiga a sí mismo.

**Flujo de un turno** (`Sesion._turno`):
1. Filtro de ruido: `Transcriptor.hay_voz()` (VAD de faster-whisper). Sin voz, la frase no llega a Whisper.
2. STT (`stt.py`), una temperatura, descartando segmentos en bucle.
3. Activación (`quitar_activacion`): variantes de Whisper, "Píxel" sola abre una ventana de 8 s para una frase; también vale en medio de la frase (`_RE_ACTIVACION_EN_MEDIO`). Lo que no tiene activación se ignora sin mandar nada al ESP32.
4. Intención: `acciones.detectar()` (regex); si no hay coincidencia, `clasificador.py` (Gemini u Ollama, JSON). Con regex, el clasificador solo corrige nombres cuando YouTube no da resultados.
5. Si no es acción: `llm.Llm.responder()` en streaming. `extraer_frases()` parte el texto y cada frase va a TTS en cuanto está lista.
6. Toda respuesta termina con `fin_respuesta()`: beep y `0x03`.

**Reposo:** tras `REPOSO_S` sin interacción, se borra el historial del `Llm`.

**Recursos compartidos:** Whisper, Piper y el clasificador se cargan una vez en `main()`. Cada sesión tiene su `Llm`. `llm._OLLAMA` es un candado de módulo: una generación de Ollama a la vez. Las llamadas a Gemini no lo toman.

**Acciones** (`acciones.py`): `@registrar(nombre, detector)`. El detector devuelve parámetros o `None`; la función devuelve `{"ok", "decir", "log"}`. `plano()` conserva la longitud del texto. El clasificador general solo puede devolver `"youtube"` o `"ninguna"`: una acción nueva que deba elegirla también tiene que tocar su prompt en `clasificador.py`.

**Recordatorios** (`recordatorios.py`): el LLM extrae solo `{texto, cuando}` y las reglas interpretan la hora. `vigilar_recordatorios()` manda cada vencido a `sesion_que_habla()` (el ESP32 más reciente), por la cola, sin mezclarse con una respuesta que suene.

**Google** (`servicios_google.py`): Calendar y Gmail con stdlib, OAuth de escritorio. Alcances de solo crear y enviar; el correo nunca se envía sin confirmación (`Sesion.pendiente`).

**Panel local** (`panel.py` + `web/`): `servidor.main()` lo arranca en `PANEL_PORT` (8080). Sirve la misma app que Firebase, pero hablando con `/api/...` (rutas en `panel.RUTAS_POST`). `RUTAS_SOLO_LOCAL` son las que no puede ejecutar la nube (la clave de Gemini). Rechaza POST con cabecera `Origin` ajena (403). Sin autenticación: cualquiera en la red puede usarlo.

**Micrófono del celular (Fase 11):** `servidor.SesionMovil` y `nube.py` (`_atender_frases`, `_escribir_habla`, `celulares()`). El celular corta las frases y la nube las pasa al turno normal; la voz vuelve al celular por `habla/<uid>`. Hoy el servidor lo soporta, pero el cliente de la app que manda las frases se quitó en el commit de "Píxel en la app" (ver `memoria.md`). Para volver a usarlo hay que restaurar ese cliente desde el commit `b51e2cb`. Es clave para el proyecto: no quitar.

**Nube** (`nube.py`, Fases 10 y 12): el servidor entra en Firebase con una cuenta anónima y publica estado y latido en la Realtime Database (`NUBE_DB`). Escucha órdenes y solicitudes por SSE. Las órdenes ejecutan las mismas funciones que `RUTAS_POST`. Las reglas (`database.rules.json`) dejan que cada Píxel escriba solo lo suyo y que solo sus dueños lean su estado o le manden órdenes. El enlace usa un código de 6 cifras que comprueba el servidor (no las reglas), con `MAX_FALLOS` intentos.

**App de internet** (`web/`, Firebase Hosting, proyecto `pixelassitance`): HTML, CSS y JS sin compilar. Modo local y modo internet (`*.web.app`, `*.firebaseapp.com` o `?nube`). En internet, `web/agente.js` es el núcleo: voz (`webkitSpeechRecognition`, `VozPixel` con Supertonic 3), Gemini por Firebase AI Logic (`pensar`), confirmaciones de lo irreversible, y los módulos de `MODULOS` (cerebro, google, tiempo, aparatos, música, humor, apuntes, contactos, whatsapp, ajustes, perfil), que se registran con `Agente.modulo({...})`. `web/agente.md` es el prompt de sistema.

**Gemini:** REST `v1beta` desde `gemini.py` (clave en la cabecera `x-goog-api-key`, nunca en la URL ni en logs). Si falla, responde Ollama y pausa Gemini unos segundos (`PAUSA_S`), o 10 min tras un 429 (`PAUSA_CUPO_S`). El plan gratis tiene cupo diario por modelo: las pruebas de punta a punta lo gastan.

**Aparatos y puentes:** `puente_pc.py` (el PC: volumen, música por MPRIS, YouTube, WhatsApp, Wake-on-LAN, TV Android) y el ESP32 con `Pixel_portal/puente.ino` (firmware fuera del repo). Los aparatos van en Firebase como órdenes a un "puente". `red_wifi.py` busca equipos en la red y `bluetooth_pc.py` controla el Bluetooth del PC. `salida_pc.py` manda la voz al altavoz del PC.

**Voz:** Piper (`tts.py`) y Supertonic 3 (`tts_supertonic.py`, compartido con `onnxruntime`). `panel.VOCES` lista las voces del PC. La boca de la cara se sincroniza con el volumen de la voz (`Sesion.voz`, `GET /api/voz`).

**Firmware** (fuera del repo, en `~/Arduino/`): `Pixel_portal/Pixel_portal.ino` (portal WiFi, BLE, descubrimiento por UDP), `Pixel_portal/puente.ino` (puente de aparatos, Fase 13) y `Etb_boot/Etb_boot.ino` (básico, sin portal). No se sabe qué placa lleva cada uno: preguntar antes de suponer. Detalles de la placa, pines y la cuenta del ESP32 en las notas privadas del usuario.

## Convenciones

- Todo en español: nombres, comentarios y logs. Los comentarios y docstrings van sin tildes; los textos que se dicen por voz sí llevan tildes.
- HTTP con `urllib` (sin `requests`).
- Los módulos se nombran por fases en su docstring ("Fase 3 - ...").
- Protocolo y firmware: no cambiar el contrato con el ESP32 sin cambiar el firmware.
- Correo: nunca se envía sin confirmación del usuario.
- Antes de tocar STT, activación o clasificador, leer `memoria.md` y anotar las mediciones nuevas ahí.

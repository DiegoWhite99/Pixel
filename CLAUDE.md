# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es

Asistente de voz para una demo de feria, todo en el PC salvo la IA de Gemini, que es opcional (Fase 11). Un ESP32-S3 (micrófono INMP441; su firmware **no** está en este repo) manda audio por TCP; el servidor en Python lo transcribe (faster-whisper), decide qué hacer (acciones por regex, clasificador LLM o respuesta libre del LLM vía Ollama) y devuelve voz sintetizada (Piper). Palabra de activación: "Píxel" (antes "Nova", que Whisper oía como "No, no."; ver `memoria.md`).

Git: https://github.com/DiegoWhite99/Pixel, **público**. Ahí no entran claves, grabaciones ni datos personales: ver `.gitignore`. `main` guarda el estado del 6 nov, y el trabajo nuevo va en la rama `vinculacion_movil`. El repositorio tiene su propio `core.sshCommand` con `~/.ssh/id_ed25519_wikiia`: la llave por defecto, `id_ed25519`, es una deploy key del repo AGATA, y GitHub la rechaza aquí. No hay `requirements.txt`, ni tests, ni linter. Las dependencias viven en `.venv/` (Python 3.10: faster-whisper 1.2.1, piper-tts 1.8.0, numpy, yt-dlp); `venv/` es una copia con los mismos paquetes que no se usa. Ollama corre aparte en `127.0.0.1:11434` con el modelo `qwen2.5:3b`. Con clave de Gemini, Gemini responde y Ollama queda de respaldo (ver **Gemini**).

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
python3 tools/cliente_prueba.py --host 192.168.1.216 --fin-de-turno --espera 30 archivo.wav
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

**App web y Firebase** (`web/`, Fase 9): una sola app para el panel local y para Firebase Hosting. HTML, CSS y JS sin compilar y sin librerías. El modo local no usa nada de internet; el modo internet carga el SDK de Firebase 10.14.1 de gstatic.
- `cara3d.js`: la cara de Píxel en WebGL 1 a mano.
    - Es una esfera UV de 40×64. Ojos y boca son LED dibujados en dos texturas equirectangulares de 2048×1024 (color y brillo). Solo se repinta y se sube con `texSubImage2D` la zona de la cara, y solo cuando cambia.
    - Arrastrarla desplaza los vértices con peso gaussiano alrededor del punto agarrado. Al soltar vuelve con muelles amortiguados, como la cara de Mario 64.
    - `app.js` le pasa el estado de `/api/estado` ("esperando", "escuchando", "hablando", "sin-servidor") y emociones de un rato ("feliz", "sorpresa"). Sin WebGL se ve un SVG plano.
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
    - Se compila sin subirlo con `~/.local/bin/arduino-cli compile --fqbn esp32:esp32:esp32s3 --build-path <carpeta temporal> ~/Arduino/Pixel_portal` (core esp32 3.3.12).
    - Guarda red, IP del servidor, volumen y ganancia en Preferences.
    - Si no encuentra la red, o si se mantiene BOOT 3 s, abre la red `Pixel asistente de voz` (clave `pixel2026`) con un formulario en `192.168.4.1`, y el LED se pone morado.
- `Etb_boot/Etb_boot.ino` es el básico del 21 oct:
    - Red e IP del servidor fijas (`SERVER_IP` = 192.168.1.216), sin portal, sin Bluetooth y sin descubrimiento.
    - Su `sendDebug` solo manda el primer byte del largo: un texto de más de 255 bytes rompe el protocolo.
    - Las mejoras de `Pixel_portal.ino` para él están en `Etb_boot.ino.mejoras-22oct`, sin aplicar. El 22 oct a las 14:59, `Etb_boot.ino` volvió a la versión original (igual a `Etb_boot.ino.respaldo-22oct`).

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
- Si falla antes de decir nada (sin internet, clave mala, 4xx/5xx, `GEMINI_TIMEOUT`), ese turno responde Ollama y queda una línea `gemini: fallo (...)` en el log. Tras un fallo de conexión se salta Gemini `gemini.PAUSA_S` (60 s), para no pagar el timeout en cada turno.
- `GEMINI_MODELO` = `gemini-3.8-flash` con `thinkingLevel` `"low"`: 3.8 Flash no admite `"minimal"` (400). Si el modelo rechaza `thinkingConfig`, reintenta sin él. No se manda `temperature`: en Gemini 3, Google recomienda dejar la de por defecto.
- La clave se pega en el panel local (Cuentas) y se guarda en `GEMINI_CLAVE` (`gemini_clave.json`, permisos 600, fuera de git). Vale al momento, sin reiniciar. `main()` la carga después de calentar Ollama, para que el respaldo responda rápido.
- `/api/gemini/clave` y `/api/gemini/probar` están en `panel.RUTAS_SOLO_LOCAL`, no en `RUTAS_POST`: `nube.py` ejecuta `RUTAS_POST` como órdenes de internet, así que la nube no puede poner ni probar la clave. En modo internet la tarjeta solo enseña el estado.
- "Probar" busca `GEMINI_MODELO` en la lista de modelos (ListModels) y hace una pregunta corta.
- Los logs del turno dicen quién contestó: `clasificador gemini|ollama` y `LLM gemini|ollama 1er token`.
- Para probar sin clave real, apuntar `gemini.URL` a un servidor simulado en local.

**TTS** (`tts.py`): Piper sale a 22050 Hz y se remuestrea a 16000 Hz con numpy (FIR paso bajo + interpolación lineal, sin scipy).

**Configuración:** todos los parámetros (VAD, modelos, variantes de activación, beeps, `STT_PROMPT`) son constantes al inicio de `servidor.py`; no hay CLI ni variables de entorno. El prompt de sistema lleva la fecha, que se fija al arrancar.

## Convenciones

- Todo en español: nombres, comentarios, logs. Comentarios y docstrings sin tildes; los textos que se dicen por voz sí llevan tildes.
- HTTP con `urllib` de la librería estándar (sin `requests`). El cliente de prueba usa solo stdlib.
- Los módulos se nombran por fases en su docstring ("Fase 3 - …").

## Notas del proyecto

- `memoria.md` es el registro de mediciones y decisiones (Whisper `base` contra `small`, el coste del `initial_prompt`, falsos positivos de la activación, muestras de voces). Léelo antes de tocar el STT, la activación o el clasificador, y anota ahí los resultados nuevos. Tiene una lista de pendientes.
- `capturas/` tiene frases reales del ESP32 (WAV 16 kHz mono), útiles como casos de prueba. `servidor.log` guarda la salida de sesiones anteriores. Sus líneas llevan la hora pero no la fecha: cada arranque empieza con `cargando faster-whisper`, y eso separa los días.
- `voces/` tiene la voz en uso: `es_ES-sharvard-medium` con hablante `"F"` (`TTS_VOZ` y `TTS_HABLANTE` en `servidor.py`; el modelo también trae `"M"`). `voces_prueba/` tiene candidatas y sus WAV de muestra; las femeninas están en `voces_prueba/femeninas/`.

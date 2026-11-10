# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es

Asistente de voz para una demo de feria, todo en el PC salvo la IA de Gemini, que es opcional (Fase 11). Un ESP32-S3 (micrófono INMP441; su firmware **no** está en este repo) manda audio por TCP; el servidor en Python lo transcribe (faster-whisper), decide qué hacer (acciones por regex, clasificador LLM o respuesta libre del LLM vía Ollama) y devuelve voz sintetizada (Piper). Palabra de activación: "Píxel" (antes "Nova", que Whisper oía como "No, no."; ver `memoria.md`).

Git: https://github.com/DiegoWhite99/Pixel, **público**. Ahí no entran claves, grabaciones ni datos personales: ver `.gitignore`. El 9 nov se fusionó `vinculacion_movil` (Fases 11 a 13) en `main`; el trabajo nuevo sigue en `vinculacion_movil`. Versiones: etiquetas `vX.Y.Z`; la primera, `v1.0.0` (10 nov), es `515c390`, lo publicado en pixelassitance.web.app ese día. El repositorio tiene su propio `core.sshCommand` con `~/.ssh/id_ed25519_wikiia`: la llave por defecto, `id_ed25519`, es una deploy key del repo AGATA, y GitHub la rechaza aquí. No hay `requirements.txt` ni linter; las únicas pruebas son las de la Fase 13 (`tools/prueba_*`). Las dependencias viven en `.venv/` (Python 3.10: faster-whisper 1.2.1, piper-tts 1.8.0, numpy, yt-dlp y, desde la Fase 13, androidtvremote2 0.3.3); `venv/` es una copia con los mismos paquetes que no se usa. Ollama corre aparte en `127.0.0.1:11434` con el modelo `qwen2.5:3b`. Con clave de Gemini, Gemini responde y Ollama queda de respaldo (ver **Gemini**).

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

Pruebas de las Fases 13 y 14 (las únicas automáticas del proyecto):

```bash
node tools/prueba_modulos.js                 # funciones puras de web/*.js en Node, sin página (segundos)
.venv/bin/python tools/prueba_obsidian.py    # sincronización con Obsidian, con base de datos falsa
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
    - Si no encuentra la red, o si se mantiene BOOT 3 s, abre la red `Pixel asistente de voz` (clave `pixel2026`) con un formulario en `192.168.4.1`, y el LED se pone morado.
- `Etb_boot/Etb_boot.ino` es el básico del 21 oct:
    - Red e IP del servidor fijas (`SERVER_IP` = 192.168.1.216), sin portal, sin Bluetooth y sin descubrimiento.
    - Su `sendDebug` solo manda el primer byte del largo: un texto de más de 255 bytes rompe el protocolo.
    - Las mejoras de `Pixel_portal.ino` para él están en `Etb_boot.ino.mejoras-22oct`, sin aplicar. El 22 oct a las 14:59, `Etb_boot.ino` volvió a la versión original (igual a `Etb_boot.ino.respaldo-22oct`).

- **Fase 13:** `Pixel_portal/puente.ino` (con `certs.h`) hace del ESP32 un puente de aparatos (ver **Aparatos**). Pide la librería ArduinoJson 7. La placa es un ESP32-S3 N16R8 (16 MB de flash y 8 MB de PSRAM octal, MAC 20:6e:f1:91:87:7c).
    - Se compila y se carga con `--fqbn esp32:esp32:esp32s3:PartitionScheme=huge_app,PSRAM=opi`. Ocupa 1,35 MB; la partición de por defecto tiene 1,3. Con la PSRAM, las conexiones TLS no le quitan RAM al Bluetooth.
    - **Cargado el 9 nov a las 14:41**, con permiso del usuario: Pixel_portal + puente. Antes llevaba Etb_boot, y su copia completa está en `~/Arduino/respaldos/esp32_etb_boot_09nov_16MB.bin` (para volver: `esptool write_flash 0 <archivo>`).
    - Su cuenta de Firebase es `3t0baibQJBdUr51eWATNEUQnvWp2`. Aún sin dueño: se enlaza desde la app por Bluetooth.
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
- **Hablar:** `speechSynthesis` frase a frase, con `extraerFrases()` portado de `servidor.extraer_frases`. Elige la mejor voz en español o la de los ajustes. La boca de la cara sigue `Agente.nivelBoca()`.
    - **Voz infantil** (pedido del usuario el 9 nov): "Tipo de voz" en Personalidad (`ajustes.tono`: `normal`, `infantil` o `muy_infantil`; por defecto `infantil`). `TONOS` en `agente.js` sube `pitch` y `rate` de cada frase (1,55 en infantil). No hay voces de niño en español para Piper ni para el navegador (ver **TTS**), así que es la misma voz más aguda.
- **YouTube:** sin servidor no se busca el video exacto. Sale una tarjeta "Abrir en YouTube" con la búsqueda.
- **Datos:** `usuarios/<uid>/recordatorios/<id>` (`{texto, cuando ms, creado}`) y `usuarios/<uid>/ajustes` (`{personalidad, respuesta, voz}`). Solo el dueño los lee o escribe, con tipos y tamaños validados en `database.rules.json`.
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
    - **PC:** cuando el usuario lo pide, o si la app está en un computador con el PC en línea, la orden `/api/pc {accion: "whatsapp", numero, texto}` abre `web.whatsapp.com/send` con `xdg-open`, espera `WHATSAPP_ESPERA_S` y oprime Enter dos veces con `xdotool` en la ventana "WhatsApp". El segundo Enter cae en la caja vacía si el primero ya envió. `xdotool` lo instaló el usuario el 10 nov; el servicio tiene `DISPLAY` y `XAUTHORITY`. Sin `xdotool`, lo deja escrito.
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
- **La regla del correo** (el usuario: "que no envíe sin aprobación, mantener esa regla"): una prueba de `prueba_modulos.js` falla si alguna herramienta se llama como enviar, si `drafts/send` aparece más de una vez o si `enviarBorrador` se usa fuera de una confirmación.

**TTS** (`tts.py`): Piper sale a 22050 Hz y se remuestrea a 16000 Hz con numpy (FIR paso bajo + interpolación lineal, sin scipy).
- **Voz infantil** (9 nov): no existe una voz de niño en español para Piper. Se revisaron HirCoir/Piper-TTS-Spanish, la colección piper-tts-onnx-models de Trelis y AIHeaven/piper_unofficial_voices (Hugging Face), y para el navegador vits-web y piper-tts-web: solo hay voces adultas.
- Por eso `TTS.agudo` (1,0 normal) sube el tono sin cambiar la duración: Piper habla `agudo` veces más lento (`length_scale`) y luego se remuestrea como si su frecuencia fuera `sr × agudo`. `panel.TONOS` = normal 1,0, infantil 1,32 y muy infantil 1,55, en `ajustes.json` (`tono`; por defecto `infantil`, como en el celular), y se aplica en vivo. Medido: 216, 283 y 327 Hz de tono medio.

**Configuración:** todos los parámetros (VAD, modelos, variantes de activación, beeps, `STT_PROMPT`) son constantes al inicio de `servidor.py`; no hay CLI ni variables de entorno. El prompt de sistema lleva la fecha, que se fija al arrancar.

## Convenciones

- Todo en español: nombres, comentarios, logs. Comentarios y docstrings sin tildes; los textos que se dicen por voz sí llevan tildes.
- HTTP con `urllib` de la librería estándar (sin `requests`). El cliente de prueba usa solo stdlib.
- Los módulos se nombran por fases en su docstring ("Fase 3 - …").

## Notas del proyecto

- `memoria.md` es el registro de mediciones y decisiones (Whisper `base` contra `small`, el coste del `initial_prompt`, falsos positivos de la activación, muestras de voces). Léelo antes de tocar el STT, la activación o el clasificador, y anota ahí los resultados nuevos. Tiene una lista de pendientes.
- `capturas/` tiene frases reales del ESP32 (WAV 16 kHz mono), útiles como casos de prueba. `servidor.log` guarda la salida de sesiones anteriores. Sus líneas llevan la hora pero no la fecha: cada arranque empieza con `cargando faster-whisper`, y eso separa los días.
- `voces/` tiene la voz en uso: `es_ES-sharvard-medium` con hablante `"F"` (`TTS_VOZ` y `TTS_HABLANTE` en `servidor.py`; el modelo también trae `"M"`). `voces_prueba/` tiene candidatas y sus WAV de muestra; las femeninas están en `voces_prueba/femeninas/`.

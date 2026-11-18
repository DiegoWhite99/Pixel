# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es

Asistente de voz. Desde el 12 nov **ya no es una demo de feria**: es un producto de verdad, y el robot, el programa del PC y la app de internet tienen que ser **un mismo Píxel** (ajustes, claves de IA, voz, personalidad y lo que sabe del usuario, copiados en los dos sentidos; ver `web/espejo.js`). Un ESP32-S3 (el robot nuevo trae un micrófono USB tras un hub, ver `memoria.md`; su firmware **no** está en este repo) manda audio por TCP. El servidor en Python lo transcribe (faster-whisper), decide la acción (regex, clasificador LLM o respuesta libre del LLM) y devuelve voz (Piper o Supertonic). Palabra de activación: "Píxel". Gemini o Groq responden si hay clave (`llm.motores()`, la preferida primero); si no, Ollama (`qwen2.5:3b` en `127.0.0.1:11434`).

Repo público: https://github.com/DiegoWhite99/Pixel. No entran claves, grabaciones ni datos personales (ver `.gitignore`). Ramas: `main` (v2.6.2) y `vinculacion_movil` (trabajo nuevo). Versiones `vX.Y.Z` con su historia en `README.md`.

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

# Pruebas en Chrome sin pantalla, con Google y la IA SIMULADOS (no envían ni crean nada real, no gastan cupo).
# Crean cuentas anónimas de prueba en Firebase. Necesitan la web servida en 8099.
python3 -m http.server 8099 -d web &
PUPPETEER=<carpeta>/node_modules/puppeteer-core node tools/prueba_entrada.js           # lobby, sin IA incluida, clave por cuenta
PUPPETEER=<carpeta>/node_modules/puppeteer-core node tools/prueba_correo.js            # confirmaciones y destinatarios
PUPPETEER=<carpeta>/node_modules/puppeteer-core node tools/prueba_contactos_google.js  # botón «Exportar contactos»
PUPPETEER=<carpeta>/node_modules/puppeteer-core node tools/prueba_whatsapp_registro.js # WhatsApp sin adivinar, registro de acciones
PUPPETEER=<carpeta>/node_modules/puppeteer-core node tools/prueba_escritorio.js [capturas] # la ventana del programa (API simulada)

# Micrófono del celular de punta a punta: un Píxel del PC DE PRUEBA (otra identidad en Firebase, puertos 8799/8081,
# archivos en <tmp>) y una cuenta anónima que se enlaza con su código. Al acabar borra lo suyo de Firebase.
.venv/bin/python tools/pc_de_prueba.py <tmp> &     # espera a que escriba <tmp>/pc.json
PUPPETEER=<carpeta>/node_modules/puppeteer-core node tools/prueba_oido.js <tmp>

# Espejo app <-> PC (2.4.0): igual, pero con la IA simulada en el PC de prueba (claves inventadas, Groq simulado).
.venv/bin/python tools/pc_de_prueba.py <tmp> --ia-simulada &
PUPPETEER=<carpeta>/node_modules/puppeteer-core node tools/prueba_espejo.js <tmp> [<tmp2>]   # <tmp2>: segundo PC, ver 2.4.0

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

Servidor de prueba aislado, sin nube (no toca el real ni sus JSON; luego `tools/cliente_prueba.py --port 8799`):

```bash
.venv/bin/python -c "import servidor, acciones; servidor.PORT = 8799; servidor.PANEL_PORT = 8081; servidor.RECORDATORIOS_ARCHIVO = '/tmp/r.json'; servidor.EVENTOS_ARCHIVO = '/tmp/e.json'; servidor.AJUSTES_ARCHIVO = '/tmp/a.json'; servidor.PERFIL_ARCHIVO = '/tmp/p.json'; servidor.DISPOSITIVOS_ARCHIVO = '/tmp/d.json'; servidor.CONTACTOS_ARCHIVO = '/tmp/c.json'; servidor.GOOGLE_CLIENTE = '/tmp/gc.json'; servidor.GOOGLE_TOKEN = '/tmp/g.json'; servidor.GEMINI_CLAVE = '/tmp/gm.json'; servidor.GROQ_CLAVE = '/tmp/gq.json'; servidor.OBSIDIAN_BOVEDA = '/tmp/boveda'; servidor.NUBE_DB = ''; servidor.DESCUBRIR_PORT = 0; servidor.CAPTURE_DIR = '/tmp/capturas'; acciones._abrir = lambda url: 0; servidor.main()"
```

La lista completa de rutas que hay que apartar es la de `tools/pc_de_prueba.py` (`main`): si se agrega un archivo de datos a `servidor.py`, agregarlo allí y aquí. Antes faltaban `GROQ_CLAVE`, `PERFIL_ARCHIVO`, `GOOGLE_CLIENTE` y `OBSIDIAN_BOVEDA`: la prueba leía la clave de Groq real y podía pisar el perfil y la bóveda de Obsidian reales.

Con el servidor real arriba, el panel (8080) está ocupado: la prueba usa 8081. El `ajustes.json` real puede tener `"salida_voz": "pc"`; sin archivo, la salida es `"esp32"`. Para probar la nube, usar otra identidad (`servidor.NUBE_TOKEN`, `servidor.NUBE_NOMBRE`) y borrar los datos al acabar.

Chrome sin pantalla para la web: `puppeteer-core` fuera del repo, con `executablePath: "/usr/bin/google-chrome"` y `args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]`. `?nube=anonimo` (solo en localhost) entra con una cuenta anónima. `tools/prueba_app.js` usa la IA de verdad y desde el 11 nov necesita una clave en la cuenta de prueba; no se ha adaptado.

Al simular Google en una prueba de navegador, simular **solo** gmail, calendar, oauth2 (tokeninfo) y people. Si se simula todo `googleapis.com`, también cae la sesión de Firebase (`identitytoolkit`, `securetoken`): tras recargar, la app parece sin permiso de Google. Así falló una prueba el 11 nov. Para la IA: poner la clave en `localStorage` `pixel.ia:<uid>` y simular `generativelanguage.googleapis.com`. Bloquear Hugging Face en las pruebas: la voz son 398 MB.

Los datos de las pruebas (nombres de ejemplo como «Ana Prueba») van solo en cuentas anónimas de prueba. Nunca inventar nombres, correos ni personas para pruebas o instrucciones que toquen la cuenta real del usuario: preguntar.

## Arquitectura

**Protocolo con el ESP32** (contrato fijo con el firmware): cabecera `struct "<BI"` = tipo (1 byte) + longitud (uint32 LE) + payload. `0x01` audio ESP32→servidor, `0x02` audio servidor→ESP32, `0x03` fin de turno, `0x04` texto de debug UTF-8 (desde la 2.6.0 también lleva estado en los dos sentidos: PC→robot `estado:con_api`/`estado:sin_api`; robot→PC `robot:{"luz","app","api","id"}`, `energia:...`, `micro USB:...`). PCM 16 kHz, 16 bit, mono, tramas de 20 ms (640 bytes).

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

**Recordatorios** (`recordatorios.py`): el LLM extrae solo `{texto, cuando}` y las reglas interpretan la hora. `vigilar_recordatorios()` manda cada vencido a `sesion_que_habla()` (el ESP32 más reciente), por la cola, sin mezclarse con una respuesta que suene. Con la nube enlazada, `servidor.AGENDA` es una `agenda_nube.AgendaNube` que usa la lista de la app (ver 2.4.2 y 2.4.3).

**Google** (`servicios_google.py`): Calendar y Gmail con stdlib, OAuth de escritorio. Alcances de solo crear y enviar; el correo nunca se envía sin confirmación (`Sesion.pendiente`).

**Panel local** (`panel.py` + `web/`): `servidor.main()` lo arranca en `PANEL_PORT` (8080). Sirve la misma app que Firebase, pero hablando con `/api/...` (rutas en `panel.RUTAS_POST`). `RUTAS_SOLO_LOCAL` son las que no puede ejecutar la nube (la clave de Gemini). Rechaza POST con cabecera `Origin` ajena (403). Sin autenticación: cualquiera en la red puede usarlo.

**Micrófono del celular (Fase 11):** `servidor.SesionMovil` y `nube.py` (`_atender_frases`, `_escribir_habla`, `celulares()`). En la app, `web/oido.js` (botón «Usar el PC» en Inicio, solo con un Píxel del PC enlazado): corta las frases (VAD por energía; además pide 160 ms con voz para no subir golpes a Firebase), las deja en `pixeles/<pid>/frases` y toca la voz que vuelve por `habla/<uid>`. Piensa el PC, así que sirve sin clave de IA en la app. Es una cosa u otra: al usar el PC se para la escucha de `agente.js`, y su «Escuchar» para esto. Se quitó en la Fase 12 y se restauró el 11 nov desde `b51e2cb`, con sus reglas (`frases`, `escuchando`, `habla`). Es clave para el proyecto: no quitar.

**Registro de acciones** (11 nov, tras el correo que salió a quien no era): lo que Píxel hizo de verdad, con su hora. La app anota con `Agente.nucleo.registrar(tipo, texto, detalle)` en `usuarios/<uid>/registro` (correo enviado, evento creado/movido/borrado, WhatsApp, orden a un aparato, recordatorio, contactos de Google); el PC, con `servidor.registrar` → `nube.registrar` en `pixeles/<pid>/registro` (acciones de `REGISTRAR_ACCIONES` y el correo al confirmarse; guarda las últimas 300). Se anota **después** de hacerlo, nunca antes (lo comprueba `prueba_modulos.js`). `web/registro.js` junta las dos listas en la pestaña Registro. No es un modo: no se apaga en Ajustes.

**Nube** (`nube.py`, Fases 10 y 12): el servidor entra en Firebase con una cuenta anónima y publica estado y latido en la Realtime Database (`NUBE_DB`). En la app sale con el nombre `servidor.NUBE_NOMBRE` («Panel de control» desde el 15 nov, pedido del usuario: es lo que controla el PC); al conectar, `nube.nombre_a_duenos()` lo pone en `usuarios/<uid>/pixeles/<pid>` de cada cuenta, que es de donde lo lee la app. Escucha órdenes y solicitudes por SSE. Las órdenes ejecutan las mismas funciones que `RUTAS_POST`. Las reglas (`database.rules.json`) dejan que cada Píxel escriba solo lo suyo y que solo sus dueños lean su estado o le manden órdenes. El enlace usa un código de 6 cifras que comprueba el servidor (no las reglas), con `MAX_FALLOS` intentos.

**App de internet** (`web/`, Firebase Hosting, proyecto `pixelassitance`): HTML, CSS y JS sin compilar. Modo local y modo internet (`*.web.app`, `*.firebaseapp.com` o `?nube`). En internet, `web/agente.js` es el núcleo: voz (`webkitSpeechRecognition`, `VozPixel` con Supertonic 3), la IA (`pensar`), confirmaciones de lo irreversible, y los módulos de `MODULOS` (cerebro, google, tiempo, aparatos, música, humor, apuntes, contactos, whatsapp, ajustes, perfil), que se registran con `Agente.modulo({...})`. `web/agente.md` es el prompt de sistema.

**La IA de la app es de cada cuenta** (11 nov; pedido: "cada persona paga Gemini o el proveedor que quiera"). No hay IA incluida: antes existía el proveedor `pixel`, el Gemini del proyecto por Firebase AI Logic, y se quitó con su carga en `agente.js`. `Proveedores.actual()` sin clave da `{propio: false}`: Píxel dice `SIN_CLAVE` y no llama a nadie; `generarJSON` falla. La clave se guarda en `localStorage` `pixel.ia:<uid>` (por cuenta; sin sesión no se guarda) y, desde el 15 nov, también en `usuarios/<uid>/ia`, que solo esa cuenta lee (pedido: "siempre me bota las claves de Gemini"). `app.js` (`sesion`) la escucha y `Proveedores.desdeNube`/`mezclarNube` mezclan clave por clave: gana la hora más nueva (`cfg.t`), y un borrado a propósito también viaja. Los precios no suben (sus nombres llevan puntos). De la clave solo se mira que esté entera (`claveValida`: sin espacios, 16 a 400 caracteres); al guardarla la prueba el servicio y, si la rechaza, no se queda. Antes se exigía «AIza…» y una clave de Google de otro formato no se podía guardar (captura del usuario, 12 nov). Las dos cuentas de demostración la ponen a mano en Ajustes. Firebase AI Logic sigue activado en el proyecto: la app ya no lo usa, pero el servicio sigue abierto hasta que se desactive en la consola.

**Entrada** (11 nov): sin sesión, `app.js` (`revisarNube`) manda a `web/lobby.html` (salvo `?nube=anonimo`). El lobby explica Píxel, tiene las descargas y hace el login con `signInWithPopup` (siempre `select_account`); después pasa a la app. Nunca reenvía solo a la app, para que no haya vueltas sin fin. Pedido del usuario: el texto visible del lobby no nombra la tecnología por dentro (ESP32, relés, Markdown, tokens…; lo comprueba `prueba_modulos.js`). Su video de presentación es el de `assests/video/` (sin git), rehecho con `tools/video_lobby.py`: 960×540, ~0,6 MB por el cupo diario de Hosting, **sin la narración original** (pedido) y con música lofi compuesta en el propio script. Usa PyAV del `.venv`: no hay ffmpeg. Su configuración de Firebase debe ser igual a `NUBE` de `app.js` (lo comprueba `prueba_modulos.js`). Ya dentro, la tarjeta «Primeros pasos» (`pintarPasos`) pide vincular el Píxel y poner la clave de IA, y se va sola cuando están las dos.

**Instaladores** (11 nov, `instalador/`): `instalador/construir.sh [linux|windows|todo]` arma `dist/pixel_<versión>_amd64.deb`, `dist/Pixel-<versión>-Setup.exe` y `dist/SHA256SUMS` (sin sudo; `dist/` está en `.gitignore`). Cada paquete lleva su propio Python 3.10 portátil y las versiones de `instalador/bloqueo.txt`. En Linux el código va compilado con Nuitka (.so); en Windows, como .pyc (el flujo `instalador/windows/nuitka.yml` lo compilaría en GitHub, no está activo). `revisar_secretos` frena el armado si va una clave o un dato personal (`web/claves.js` va vacía). `instalador/pixel_lanzador.py` guarda los datos en `~/.local/share/pixel` (o `%LOCALAPPDATA%\Pixel\datos`), apunta ahí las rutas de `servidor` (como el servidor de prueba aislado), baja ~600 MB de voces y Whisper la primera vez (con su huella SHA-256) y abre el panel para vincular. Descargas y herramientas en `$PIXEL_CACHE` (por defecto `~/.cache/pixel-instalador`). Tras cambiar el servidor o `web/`, rearmar. Se publican como archivos de la versión en GitHub (`releases/download/vX.Y.Z/...`, no en Firebase Hosting: su plan gratis da ~360 MB de descarga al día); los botones de descarga de `web/lobby.html` y el README llevan el número de versión en la dirección. Al publicar una versión corre `.github/workflows/probar_instaladores.yml`: en Windows y Ubuntu limpios baja cada paquete de ese enlace, lo instala, arranca Píxel (sin nube: `PIXEL_NUBE_DB=0`), le dice `tools/frase_prueba.wav` y comprueba con `tools/revisar_respuestas.py` que contesta con voz. Desde la 2.2.0 también corre `tools/revisar_panel.py` (búsqueda en la red, claves inventadas, panel cerrado a la red) y, en Windows, abre la ventana y guarda fotos de ella y del instalador en el artefacto `windows`. Una etiqueta ya subida no se mueve: un arreglo es una versión nueva (así nació la 2.1.1). En Windows no hay Bluetooth del PC ni WhatsApp por xdotool; el volumen, la música, bloquear y suspender sí (2.3.0). Desde la 2.4.0 el .exe ya no se presenta como «versión de prueba» (pedido del usuario: «necesito que sirva»). Desde la 2.5.0 (17 nov), Linux es **estable** y Windows **beta** en el lobby, el README y las notas de la versión de GitHub (nombre visible de cada archivo con `archivo#nombre` en `gh release create`); pedido: el usuario no tiene un Windows a mano para usarlo de verdad, así que Ubuntu es la plataforma principal. Para publicar: primero como versión de prueba (`--prerelease`), y solo cuando pasa `probar_instaladores.yml` se quita la marca (queda como la última). Sin Ollama, Gemini ni Groq, Píxel dice `llm.SIN_IA` en vez de solo el pitido. Los programas de consola de Windows no escriben en UTF-8: leer su salida con `errors="replace"` (o `encoding="oem"`), nunca con `text=True` a secas (así falló «Buscar en la red» en la 2.1.2).

**Ventana del programa** (2.2.0, 12 nov; pedido: "no desplegar un servidor web, necesito una ventana" y "un dashboard todo azul" distinto de la app): `web/escritorio.html/.css/.js`, con la bienvenida (Píxel llega del fondo y dice el saludo exacto del usuario, que comprueba `prueba_modulos.js`) y Inicio, Dispositivos, Tus APIs y Voz. Desde el 15 nov el saludo suena con la voz del PC (`GET /api/voz/saludo`, `panel.SALUDO_VENTANA`, que debe ser igual a `FRASES`: lo comprueba `tests/test_saludo_ventana.py`), y las letras van a su ritmo; `pixel_ventana.py` abre la ventana con `--autoplay-policy=no-user-gesture-required`. Habla solo con el panel local (`/api/estado` y las rutas de `panel.py`; `/api/apagar` la agrega el lanzador). `instalador/pixel_ventana.py` la abre en otro proceso (`iniciar.py --ventana`): en Windows con pywebview (WebView2, `SOLO_WINDOWS` de `construir.sh`), una sola ventana (mutex); si falla, o en Linux, Chrome/Edge con `--app`. Cerrarla no apaga a Píxel. En el programa instalado el panel escucha solo en `127.0.0.1` (`panel.DIRECCION`); el servidor de desarrollo sigue en `0.0.0.0`. Mientras baja la voz, la página de espera del lanzador sirve esa misma ventana, con `/api/estado` en 503 y el avance en `/progreso`. Las imágenes del programa (icono azul, franjas del instalador) están hechas en `instalador/imagenes/` desde `web/icono_programa.svg` (`instalador/imagenes.js`); la app de internet sigue con `web/icono.svg`.

**Groq** (`groq_ia.py`, 2.2.0): igual que `gemini.py` (mismo `NOMBRE`, `Error`, `activo`, `generar`, `generar_stream`, `probar`), API compatible con OpenAI. El modelo se elige al probar la clave (`PREFERIDOS`, de la lista de esa clave) y se guarda con ella en `groq_clave.json`. `llm.PREFERIDA` (ajuste `ia`, ruta `/api/ia`) dice cuál contesta primero; si falla, la otra, y al final Ollama. Una clave que Google o Groq rechazan no se queda guardada (`clave_rechazada()`). En la app de internet, Groq es un proveedor más de `web/proveedores.js`.

**2.3.0 (12 nov):**
- **Windows en el puente del PC:** `puente_pc._Windows` (teclas multimedia con `keybd_event`, `LockWorkStation`, `SetSuspendState`, MAC con `GetAdaptersInfo`).
- **Música en el PC:** `navegador.py`. YouTube siempre en la misma ventana: un Chrome/Edge aparte, con su perfil y el puerto de depuración en 127.0.0.1. Cada canción abre su pestaña y cierra las demás. Se llega por `acciones._abrir`, así que las pruebas que lo sustituyen siguen sin abrir nada.
- **Música en la app:** suena en una pestaña con nombre fijo (`PESTANA`). Si el navegador no deja abrirla, sale el botón «Abrir la música»; nunca la pantallita.
- **La IA del PC en la app:**
    - El PC publica sus claves en `pixeles/<pid>/ia` con `nube.publicar_ia()`, al conectar y al guardar. La regla deja leerlo solo a los dueños.
    - `proveedores.js` usa esa clave si la cuenta no tiene una propia en ese aparato (`delPc`, `iaDelPc`), y Ajustes muestra cuál está «En uso».
- **Robot:**
    - En la app se llama «robot Píxel», no ESP32.
    - «Quitar» en Puentes manda `/api/olvidar` al robot o `/api/nube/quitar` al PC, y borra `usuarios/<uid>/pixeles/<pid>`.
    - Al agregarlo por Bluetooth, la app manda `{pedir_codigo}`. El firmware inventa 6 cifras y manda el debug `codigo:NNNNNN`. El PC lo dice por el altavoz del robot (`FRASE_CODIGO_ROBOT`) y no lo escribe en el registro. Sin el PC (`"pc": false` en el BLE), vale el botón BOOT.
- **Google en el programa:** tarjeta en la ventana. La credencial de app de escritorio va en `instalador/google_programa.json` (fuera de git), y `construir.sh` la mete en el paquete si existe. Hoy no existe.

**2.4.0 (12 nov): un solo Píxel** (pedido: "las configuraciones deben ser un espejo", "tiene que ser igual lo que está en la app, la web y el robot"):
- **Espejo** (`web/espejo.js`, con todos los PC enlazados, no solo el elegido; la app hace de centro):
    - Claves de Gemini y Groq e IA preferida. El PC publica `pixeles/<pid>/ia` con la hora de cada una, también la quitada (`AJUSTES["ia_t"]`). La app guarda la suya en `cfg.t` (`Proveedores.marcar`).
    - Personalidad, largo, voz y tono: `usuarios/<uid>/ajustes.t` y `AJUSTES["t"]`.
    - Gana la hora más reciente, con el reloj de Firebase (`nube.ahora_ms`). Si empatan (datos de antes de la 2.4.0), manda el PC si tiene algo.
    - Lo de la app va con las órdenes del panel, que el PC solo acepta de sus dueños. Las de IA (`/api/gemini/clave`, `/api/groq/clave`, `/api/ia`) ya están en `RUTAS_POST`; antes eran solo locales.
    - Un PC con la 2.3.0 o anterior no se toca (su `agente.ajustes` no trae `t`).
    - La regla `usuarios/$uid/ajustes/t` se publicó el 12 nov (sin ella, `$otro` rechaza la hora).
- **El robot usa las instrucciones de la app:**
    - `panel.instrucciones_pc()` rellena `web/agente.md` con `llm.instrucciones()`. Le quita "Cómo usas las herramientas" y "Memoria y personalidad", y le pone `CAPACIDADES_PC`.
    - El perfil llega de la app (`/api/perfil`, `perfil.json`, gana el `actualizado` más nuevo) y la ventana lo muestra.
    - `llm.SYSTEM_PROMPT` queda solo de respaldo, ya sin "feria".
- **Google en el programa:** `/api/google/credencial` (solo local) guarda el JSON de "App de escritorio" como `google_cliente.json` en la carpeta de datos. La tarjeta trae los pasos y el botón para cargarlo.
- **Pruebas:**
    - `tests/test_espejo_v24.py`;
    - `tools/prueba_espejo.js <carpeta> [<carpeta2>]`, con `tools/pc_de_prueba.py <carpeta> --ia-simulada` y, para un segundo PC, `--puerto 8798 --panel 8082 --nombre "Pixel de prueba 2"`. Las claves son inventadas, Groq va simulado, y al final borra la cuenta anónima y lo de cada PC.

**2.4.1 (13 nov): los sonidos de la app en el robot** (pedido: "deben ser iguales"). `servidor.py` genera con numpy las mismas notas que `SONIDOS`/`PENSAR`/`nota()` de `web/agente.js` (`SONIDO_NOTAS`, `generar_sonido`): entrada al aceptar la frase (también en la ventana del «Dime»), notas de pensando en otro hilo hasta que suena la respuesta (`_empezar_pensando`/`_parar_pensando`; no en `SesionMovil`, donde las pone el celular), salida al terminar (no tras el «Dime» ni un recordatorio: `fin_respuesta(cierre=False)`) y aviso antes de un recordatorio. Si se cambia un sonido en la app, cambiarlo aquí también.

**2.4.2 y 2.4.3 (13 nov): el robot, su PC y los recordatorios.**
- **Código de enlace despacio:** `Sesion._decir_codigo` dice cada cifra sola (`_sin_bordes`, `_CIFRAS_CACHE`) y dos veces; también el del PC. La app se reconecta sola si se corta el Bluetooth (`conexionBle`).
- **Su PC:** el descubrimiento contesta `PIXEL <puerto> <id>` (`respuesta_descubrimiento`, `id_pc()` = el pid de Firebase). El firmware guarda `pcid` y solo se conecta a ese PC (espera si está apagado). La app lo cambia con la orden `/api/servidor` y lo muestra («Piensa con», `robotPc` en `web/aparatos.js`). Con dos Píxel del PC en la red (el usuario tiene este Ubuntu y un Windows), antes se iba con el primero que contestara.
- **Recordatorios: una sola lista** (`agenda_nube.AgendaNube`, envuelve a `recordatorios.Agenda` con la misma forma). Con cuentas enlazadas, la del PC es `usuarios/<uid>/recordatorios` (la de la app), con ids `"<uid>/<clave>"`. Se dice una vez: borrado condicional con ETag (`_reclamar`), como la transacción de la app. La lista se lee como mucho cada 15 s. La regla de `recordatorios` deja leer y escribir a los pid de `usuarios/<uid>/pixeles`. Pruebas: `tests/test_agenda_nube.py`.
- **Firmware** (fuera del repo, 13 nov): una sola conexión TLS (mira las órdenes cada 1,5 s), el anillo del micro y las pilas del USB en la PSRAM, `advertiseOnDisconnect(true)`, sin búsqueda BLE con la app conectada. Detalle en `memoria.md`.

**2.6.0 (17 nov): la luz del robot y vincularlo desde el panel.**
- **Luz RGB del robot** (KY-016 en R=IO6, G=IO5, B=IO4; el micrófono INMP441 de esos pines se quitó del firmware). Solo los cuatro colores que pidió el usuario, no agregar otros: azul WiFi, verde = red + panel de control + API + enlace con la app, amarillo = sin API, rojo = error (brownout o no entra a su WiFi) hasta volver a estar bien conectado. La decisión está en `~/Arduino/Pixel_portal/luz_estado.h`, probada en el PC con `pruebas/prueba_luz.cpp` (`g++ -std=c++17`).
- **API para la luz:** `llm.hay_api()` (con clave, sin pausa y sin fallo en lo último: `llm.anotar`, también desde las pruebas del panel). `servidor.avisar_api_a_robots()` manda `estado:...` solo si cambió (fin de respuesta, panel, y `vigilar_api` cada 3 s).
- **El robot cuenta su luz**: al PC por debug `robot:{...}` (`Sesion.robot`, en `/api/estado` → `dispositivos[].robot`) y a la app en `pixeles/<pid>/estado` (`luz`, `api`, `app`). `web/luz_robot.js` lo dibuja igual en la ventana (`escritorio.js`) y en la app (`aparatos.js`); lo comprueba `prueba_modulos.js`. Lo que pide un botón no se queda pegado: el estado lo dicen el color y las cuatro condiciones (pedido: "los colores son los testigos de la conectividad").
- **Vincular el robot desde la ventana** (`robot_wifi.py`, Fase 16, `bleak` 3.1.0): detectar por Bluetooth → vincular → «¿WiFi de este servidor? sí/no» + lista de redes (nmcli; netsh en Windows, sin probar) → enlace con la app (`nube.marcar_enlace_robot`; la regla `usuarios/$uid/enlazando` deja escribir a un PC enlazado a esa cuenta que no sea `tipo: puente`, publicada el 17 nov con permiso). Rutas `/api/robot/*` en `RUTAS_SOLO_LOCAL` y además `RUTAS_SOLO_ESTE_PC` (solo desde 127.0.0.1): usan las contraseñas WiFi guardadas en el PC. El código del robot pedido por el panel no se dice en voz alta (`robot_wifi.recibir_codigo`).
- **Instaladores:** `bleak` en `bloqueo.txt`; en Windows las `winrt-*==3.2.1` (las últimas con ruedas cp310) en `SOLO_WINDOWS`; en Linux `dbus-fast` en `SOLO_LINUX`.
- **App:** sin Bluetooth web ya no sale el aviso de `chrome://flags` (pedido: "no muestres estos errores, estamos en Chrome y se contradice"); el botón lleva al Panel de control.
- **Cara 3D** (`cara3d.js`) en la bienvenida (`montar(canvas, {soloSombra: true})`) y en el logo (`{sinSuelo: true}`) de la ventana.
- **Firmware (fuera del repo):** se anuncia como «Pixel Assistance»; rechaza el aparato USB `1a86:5394` del hub nuevo (hacía abortar el reconocimiento USB de ESP-IDF 5.5.5); tras 3 caídas seguidas, o 2 apagones seguidos justo al prender el puerto USB, arranca sin USB. Con solo el cable del PC (y el hub con micrófono, placa amarilla y lector) se reinicia por falta de corriente: ver `memoria.md`.

**Después de la 2.6.2 (va en la 2.6.3):** la presentación de la app suena por donde habla Píxel cuando contesta el robot o el PC (`/api/presentarse` en `RUTAS_POST`, solo el texto con «creado por Divergencia IA»; `Sesion._decir_frases`; `perfil.js presentarse` con `contestaElRobot` y `ordenNube`; `tests/test_presentarse.py`).

**2.6.2 (18 nov):** la 2.6.1 sin el cuelgue del instalador de Windows en la prueba de GitHub (la 2.6.1 quedó solo como versión de prueba): `.onInstSuccess` vuelve a abrir Píxel solo con `/ABRIR` (lo pasa `actualizar.py`), no con cualquier `/S`, porque `probar_instaladores.yml` instala con `Start-Process -Wait`, que espera también a lo que abrió el instalador.

**2.6.1 (18 nov): actualizaciones desde el panel, calibración cognitiva, contesta uno solo, dos códigos y sin órdenes fantasmas.**
- **Actualizaciones (Fase 17, `actualizar.py`)** (pedido: "un botón que llame las versiones más recientes y se actualicen y reciba notificaciones; me toca descargar todo el tiempo"): solo en el programa instalado (`pixel_lanzador.configurar` llama `actualizar.configurar`; desde el código `estado()` da `{activo: false}` y la ventana lo dice). Busca `releases/latest` de GitHub (no da las de prueba: por eso la marca `--prerelease` hasta que pasa `probar_instaladores.yml`) a los 90 s y cada 6 h; aviso en la ventana y `notify-send` una vez por versión (`actualizacion.json` en los datos). Actualizar: baja el paquete y `SHA256SUMS` de esa versión (solo URLs de este repo), comprueba la huella; Linux `pkexec dpkg -i` y reinicio (como servicio sale con 75 para `Restart=on-failure`; si no, `sleep 3; pixel --sin-ventana`); Windows el `.exe` con `/S /D=<carpeta>` y `.onInstSuccess` lo vuelve a abrir (sin probar en un Windows real). Rutas `/api/actualizar/buscar|instalar` en `RUTAS_SOLO_LOCAL` y `RUTAS_SOLO_ESTE_PC`. Pruebas: `tests/test_actualizar.py` (red simulada) y `prueba_escritorio.js`; probado contra GitHub de verdad bajando la 2.6.0 (sin instalarla).
- **Calibración cognitiva** (pedido: "hay un formulario que uno llena y el agente lo toma de referencia… agrega este y realiza el empalme"): `web/calibracion.js` (`Calibracion`, puro: las 14 preguntas del usuario, su matriz de arquetipos, los modificadores y `paraPrompt`), dentro de Mi perfil. Se guarda en `usuarios/<uid>/perfil/calibracion` `{respuestas: {p1..p14: A-D|V|F}, temperatura?}` (regla nueva; el trato acepta `neutro`). `PixelPerfil.paraPrompt` lo agrega al final, en versión corta si el perfil no cabe en 3900 letras (`panel.PERFIL_MAX` es 4000 y el espejo manda el texto entero al PC). Pruebas en `tools/prueba_modulos.js`.
- **Contesta uno solo** (pedido: "me están hablando los dos al tiempo… si le doy al robot, el de la web no tiene por qué hablar, y viceversa"): ajuste `contesta` (`"pc"` por defecto, o `"app"`) en `panel.AJUSTES`, elegido en la ventana como tercera opción de «Por dónde habla» («La app de internet»; se guarda aparte y no toca `salida_voz`). El servidor (`servidor.callado_por_ajuste`, en `_turno` tras la activación): con `"app"` el robot no contesta; con `"pc"` y un robot conectado, tampoco el celular como micrófono del PC (`SesionMovil`). La app (`contestaElRobot` en `app.js`, `Agente.callarSi`) se calla al oír «Píxel» si su Panel en línea dice `"pc"` y tiene un robot; un Panel sin el campo (2.6.0) no la calla. Pruebas: `tests/test_quien_contesta.py`.
- **Dos códigos** (pedido: "son dos códigos, uno para el robot y otro para el panel de control"): el del PC ya no se dice en voz alta (`nube.SIN_VOZ`); solo sale en su ventana, con «Vincular con mi cuenta» (abre la app con `?enlazar=&codigo=&nombre=`, `enlazarDesdePanel` en `app.js`) y la marca `#xxxx` del pid. El robot dice el suyo con `FRASE_CODIGO_ROBOT`.
- **Puentes en la app:** dos opciones con su descripción; «Vincular Panel de control» lleva `data-buscar-pixel` (el diálogo `#enlazar` de Cuentas).
- **Eco del prompt:** con ruido, Whisper escribe su `initial_prompt` («Píxel, YouTube, pon música… Queen»), que trae la activación: `stt.eco_del_prompt` lo descarta («TEXTO FANTASMA»). No cambiar `STT_PROMPT` sin revisar `tests/test_eco_prompt.py`.
- **Firmware (fuera del repo):** el anillo del micrófono USB solo guarda muestras enteras (le cabe un byte menos que su tamaño y el audio quedaba corrido un byte); `onWrite` del Bluetooth repone el estado en el acto (la app leía su propio mensaje y pedía el botón BOOT); `conectar()` pone `luzPorAvisar`. Detalle en `memoria.md` (18 nov).

**Gemini:** REST `v1beta` desde `gemini.py` (clave en la cabecera `x-goog-api-key`, nunca en la URL ni en logs). Si falla, responde Ollama y pausa Gemini unos segundos (`PAUSA_S`), o 10 min tras un 429 (`PAUSA_CUPO_S`). El plan gratis tiene cupo diario por modelo: las pruebas de punta a punta lo gastan.

**Aparatos y puentes:** `puente_pc.py` (el PC: volumen, música por MPRIS, YouTube, WhatsApp, Wake-on-LAN, TV Android) y el ESP32 con `Pixel_portal/puente.ino` (firmware fuera del repo). Los aparatos van en Firebase como órdenes a un "puente". `red_wifi.py` busca equipos en la red y `bluetooth_pc.py` controla el Bluetooth del PC. `salida_pc.py` manda la voz al altavoz del PC.

**Voz:** Piper (`tts.py`) y Supertonic 3 (`tts_supertonic.py`, compartido con `onnxruntime`). Desde el 15 nov hay una sola voz, la de mujer: `st-F4` («Mujer») en `panel.VOCES` y en `web/voz.js` (pedido: "vamos a usar la de mujer, solo esa"). Otra voz guardada cae en esa (`VozPixel.normal`); la del celular sigue de respaldo en la app. La boca de la cara se sincroniza con el volumen de la voz (`Sesion.voz`, `GET /api/voz`).

**Firmware** (fuera del repo, en `~/Arduino/`): `Pixel_portal/Pixel_portal.ino` (portal WiFi, BLE, descubrimiento por UDP; desde el 17 nov se llama **«Pixel Assistance»** en Bluetooth y en su red de configuración (15 nov: «Pixel»; antes «Pixel asistente de voz»), y `corregirNombreRed()` encuentra una red WiFi cuyo nombre tiene espacios al final, como la de la casa del usuario, que el portal y la app recortan), `Pixel_portal/puente.ino` (puente de aparatos, Fase 13), `Pixel_portal/micro_usb.ino` (micrófono USB tras un hub, 12 nov; ver `memoria.md`) y `Etb_boot/Etb_boot.ino` (básico, sin portal). No se sabe qué placa lleva cada uno: preguntar antes de suponer. Detalles de la placa, pines y la cuenta del ESP32 en las notas privadas del usuario.

## Convenciones

- Todo en español: nombres, comentarios y logs. Los comentarios y docstrings van sin tildes; los textos que se dicen por voz sí llevan tildes.
- HTTP con `urllib` (sin `requests`).
- Los módulos se nombran por fases en su docstring ("Fase 3 - ...").
- Protocolo y firmware: no cambiar el contrato con el ESP32 sin cambiar el firmware.
- Correo: nunca se envía sin confirmación del usuario.
- Antes de tocar STT, activación o clasificador, leer `memoria.md` y anotar las mediciones nuevas ahí.

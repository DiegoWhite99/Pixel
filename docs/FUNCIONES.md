# Funciones de Píxel: qué hacen, qué código usan y por dónde llegan

Cómo leerla: **Entrada** es la vía por la que llega la orden (voz del ESP32, voz de la app, botón del panel, orden de la nube, o tarea programada). **Código** es el archivo y la función principal. **Ruta** es la ruta HTTP o la herramienta de Gemini, cuando existe.

## 1. Voz y conversación (servidor, ESP32 y PC)

| Función | Entrada | Código | Ruta / herramienta |
|---|---|---|---|
| Recibir audio del ESP32 y cortar frases | ESP32 (`0x01`) | `servidor.py`: `Sesion.recibir`, `Sesion._vad` | TCP `PORT` (8765) |
| Filtro de ruido (¿hay voz?) | ESP32 | `stt.py`: `Transcriptor.hay_voz` | — |
| Transcribir voz a texto | ESP32 | `stt.py`: `Transcriptor.transcribir` | — |
| Palabra de activación "Píxel" | ESP32, app | `servidor.py`: `quitar_activacion`, `_RE_ACTIVACION_EN_MEDIO`; `web/agente.js`: `activacion()` | — |
| Decidir la intención (regex) | ESP32 | `acciones.py`: `detectar` | — |
| Decidir la intención (clasificador) | ESP32 | `clasificador.py`: `Clasificador` | Gemini o Ollama |
| Responder con el modelo, en streaming | ESP32, PC | `llm.py`: `Llm.responder`, `motores`; `gemini.py`, `groq_ia.py` | Gemini `:streamGenerateContent`, Groq `/chat/completions` o Ollama `/api/chat` |
| Partir la respuesta en frases para la voz | ESP32 | `servidor.py`: `extraer_frases` | — |
| Hablar (Piper) | ESP32, PC | `tts.py`: `Tts`; `tts_supertonic.py`: `TtsSupertonic` | `panel.py`: `probar_voz` |
| Reposo (olvida la conversación) | ESP32 | `servidor.py`: `Sesion._reposo` | — |
| Sonidos de entrada, pensando, salida y aviso (los mismos de la app, 13 nov) | ESP32 | `servidor.py`: `generar_sonido`, `SONIDO_NOTAS`, `_empezar_pensando`, `fin_respuesta` | `web/agente.js`: `SONIDOS`, `PENSAR` |
| Boca de la cara sincronizada | PC, app | `servidor.py`: `Sesion.voz`; `panel.py` | `GET /api/voz` |

## 2. Voz y conversación en la app de internet (sin PC)

| Función | Entrada | Código | Ruta / herramienta |
|---|---|---|---|
| Oír (reconocimiento continuo) | app | `web/agente.js`: `iniciar`, `oir` | `webkitSpeechRecognition` |
| Entrada: lobby y login con Google | web | `web/lobby.html` (login); `web/app.js`: `revisarNube` (sin sesión, manda al lobby) | `signInWithPopup` |
| Primeros pasos (vincular el Píxel y poner la clave de IA) | app | `web/app.js`: `pintarPasos` | tarjeta `#pasos` |
| Pensar con la IA de la cuenta (streaming, herramientas) | app | `web/agente.js`: `pensar`, `MAX_RONDAS`; `web/proveedores.js`: `actual`, `motor` | la API del proveedor, con la clave de la cuenta (`pixel.ia:<uid>`) |
| Elegir proveedor y clave de IA | app | `web/ajustes.js`: `montarIA`, `formularioIA`; `web/proveedores.js`: `guardar`, `probar` | tarjeta `#card-ia` |
| Hablar frase a frase | app | `web/agente.js`: `decirFrase`, `siguiente`; `web/voz.js`, `web/voz_trabajador.js` | Supertonic 3 (Web Audio) |
| Confirmar lo irreversible | app | `web/agente.js`: `nucleo.confirmar`, `si` | botón `#ag-confirmar` o "sí" por voz |
| Contar el consumo de la IA | app | `web/agente.js`: `contarUso`, `diaDelCupo` | `usuarios/<uid>/uso/<día>` |
| Presentación en el primer contacto | app | `web/agente.js`: `presentacion`; `web/perfil.js` | tarjeta `#bienvenida` |
| Sonidos de entrada, salida y aviso | app | `web/agente.js`: `sonido`, `sonarPensando` | — |
| Modo enfoque y cambio de pantalla | app | `web/tiempo.js`: `htmlEnfoque`, `pidoEnfoque` | herramienta `modo_enfoque` |
| Celular como micrófono del PC (**Fase 11, servidor listo; falta el cliente**) | celular, nube | `servidor.py`: `SesionMovil`; `nube.py`: `_atender_frases`, `_escribir_habla`, `celulares` | `pixeles/<pid>/frases`, `habla/<uid>` |

## 3. Acciones de voz (regex en `acciones.py`)

| Acción | Entrada | Código | Qué hace |
|---|---|---|---|
| `youtube` | ESP32 | `acciones.py`: `detectar_youtube`, `youtube` | Busca el video y lo abre en el PC (`_abrir`) o en la app |
| `recordatorio` | ESP32 | `acciones.py`: `detectar_recordatorio`; `recordatorios.py`: `extraer_hora`, `resolver` | Guarda un aviso en `Agenda` |
| `ver_recordatorios` | ESP32 | `acciones.py`: `detectar_ver_recordatorios` | Dice los pendientes |
| `borrar_recordatorio` | ESP32 | `acciones.py`: `detectar_borrar_recordatorio` | Borra uno o todos |
| `crear_evento` | ESP32 | `acciones.py`: `detectar_crear_evento`; `servicios_google.py` | Calendar (o calendario local) |
| `ver_calendario` | ESP32 | `acciones.py`: `detectar_ver_calendario` | Eventos del día y recordatorios |
| `correo` | ESP32 | `acciones.py`: `detectar_correo`; `servicios_google.py`: `enviar_correo` | Pide confirmación ("envíalo") y luego envía |

## 4. Vigilancia y tareas programadas

| Función | Entrada | Código | Ruta |
|---|---|---|---|
| Avisar recordatorios que vencen | tarea del servidor | `servidor.py`: `vigilar_recordatorios` | → cola de `sesion_que_habla()` |
| Elegir por dónde habla el servidor | tarea del servidor, panel | `servidor.py`: `sesion_que_habla` | — |
| Vigilar aparatos WiFi | tarea del PC | `red_wifi.py`: `vigilar` | cada 30 s |
| Sincronizar con Obsidian | tarea del PC | `obsidian.py`: `sincronizar` | cada 5 s |

## 5. Panel local (`panel.py`, mismo `web/` que la app; en el programa instalado, su ventana `web/escritorio.html`)

| Función | Entrada | Código | Ruta |
|---|---|---|---|
| Estado en vivo | panel, app local | `panel.py`: `estado` | `GET /api/estado` |
| Guardar personalidad, voz y respuesta | panel | `panel.py`: `guardar_agente` | `POST /api/agente` |
| Probar la voz | panel | `panel.py`: `probar_voz` | `POST /api/agente/probar` |
| Guardar y borrar contactos | panel | `panel.py`: `guardar_contacto`, `borrar_contacto` | `POST /api/contactos`, `/api/contactos/borrar` |
| Borrar de la agenda | panel | `panel.py`: `borrar_agenda` | `POST /api/agenda/borrar` |
| Vincular Google | panel | `panel.py`: `vincular_google` | `POST /api/google/vincular` |
| Aceptar u olvidar un aparato Bluetooth | panel | `panel.py`: `aceptar_dispositivo`, `olvidar_dispositivo` | `POST /api/dispositivos/aceptar`, `/olvidar` |
| Buscar y agregar WiFi | panel | `red_wifi.py`: `buscar`; `panel.py`: `buscar_wifi`, `agregar_wifi` | `POST /api/wifi/buscar`, `/api/wifi/agregar` |
| Bluetooth del PC (encender, buscar, emparejar, conectar, olvidar, visible, música) | panel | `bluetooth_pc.py`; `panel.py`: `_bt` | `POST /api/bt/...` (8 rutas) |
| Poner la clave de Gemini y probarla (solo red local) | panel | `panel.py`: `guardar_gemini`, `probar_gemini` | `POST /api/gemini/clave`, `/api/gemini/probar` |
| Poner la clave de Groq y probarla (elige el modelo) | panel, ventana | `panel.py`: `guardar_groq`, `probar_groq`; `groq_ia.py` | `POST /api/groq/clave`, `/api/groq/probar` |
| Cuál IA de internet contesta primero (Gemini o Groq) | ventana | `panel.py`: `elegir_ia`; `llm.motores` | `POST /api/ia` |
| Apagar Píxel (solo el programa instalado) | ventana | `instalador/pixel_lanzador.py`: `configurar` → `apagar` | `POST /api/apagar` |
| La ventana del programa: bienvenida y panel de control azul | ventana | `web/escritorio.*`; `instalador/pixel_ventana.py`: `mostrar` | `GET /escritorio.html` |
| Etiquetas de la app | panel | — | `GET /api/tags` |

## 6. Nube (`nube.py`, Píxel en Firebase)

| Función | Entrada | Código | Ruta / nodo |
|---|---|---|---|
| Entrar en Firebase con cuenta anónima | arranque | `nube.py`: `_entrar`, `_auth` | Identity Toolkit |
| Publicar estado y latido | tarea | `nube.py`: `_publicar`, `_publicar_voz` | `pixeles/<pid>/estado`, `vivo`, `voz` |
| Modo enlace y código de 6 cifras | app | `nube.py`: `abrir_enlace`, `_solicitud`, `decir_codigo` | `visibles/<pid>`, `solicitudes/<uid>` |
| Ejecutar órdenes de la app | app | `nube.py`: `_al_orden`, `_trabajar` | `pixeles/<pid>/ordenes` → mismas rutas que `panel.RUTAS_POST` |
| Escuchar solicitudes de enlace | app | `nube.py`: `_al_solicitud` | `pixeles/<pid>/solicitudes` |
| Celular que escucha (**Fase 11**) | celular | `nube.py`: `_al_escuchando`, `_movil`, `_limpiar_moviles` | `pixeles/<pid>/escuchando/<uid>` |
| El celular como micrófono del PC: frases y voz (**Fase 11**, restaurada el 11 nov) | celular | `web/oido.js`: `cortador`, `mandarFrase`, `alHabla`, `tocar`; `nube.py`: `_al_frase`, `_atender_frases`, `_escribir_habla`; `servidor.py`: `SesionMovil` | `pixeles/<pid>/frases`, `pixeles/<pid>/habla/<uid>` |
| Registro de acciones del PC | voz (ESP32 o celular) | `servidor.py`: `registrar`, `REGISTRAR_ACCIONES`; `nube.py`: `registrar`, `_escribir_registro` | `pixeles/<pid>/registro` |

## 7. Google (`servicios_google.py` en el PC; `web/google.js` en la app)

| Función | Entrada | Código | Herramienta de Gemini |
|---|---|---|---|
| Ver calendario | ESP32, app | `servicios_google.py`: `eventos`; `acciones.py`: `ver_calendario` | `ver_calendario` |
| Crear evento | ESP32, app | `servicios_google.py`: `crear_evento`; `acciones.py`: `crear_evento` | `crear_evento` |
| Mover y borrar evento (confirma antes de borrar) | app | `web/google.js`: `encontrarEvento`, `ejecutar` | `mover_evento`, `borrar_evento` |
| Buscar y leer correos | app | `web/google.js`: `buscarCorreos`, `textoCorreo` | `buscar_correos`, `leer_correo` |
| Redactar y corregir borrador (no envía) | app | `web/google.js`: `guardarBorrador` | `redactar_correo`, `corregir_borrador` |
| Enviar correo (solo con confirmación) | ESP32, app | `servicios_google.py`: `enviar_correo`; `web/google.js`: `enviarBorrador` | botón o "envíalo" |
| Ordenar correos (archivar, leer, destacar, etc.) | app | `web/google.js`: `ordenarCorreos` | `ordenar_correos` |

## 8. Música (`web/musica.js`; `puente_pc.py` para el PC)

| Función | Entrada | Código | Ruta / herramienta |
|---|---|---|---|
| Poner música (ventana, app o PC) | app | `web/musica.js`: `poner`; salidas `ventana`, `app`, `pc` | `poner_musica` |
| Controlar (pausa, siguiente, volumen) | app | `web/musica.js`: `pausar`, `seguir`, `siguiente`, `volumen` | `controlar_musica` |
| Buscar el video exacto | app | `web/musica.js`: `buscarApi`, `buscarPc`; `web/claves.js` | YouTube Data API, o `/api/youtube/buscar` |
| Controlar el reproductor del PC | app | `puente_pc.py`: `control` | `POST /api/pc` (`accion`: `pausa`, `volumen`, `youtube`, ...) |
| Bailar al ritmo (`bpm` y género) | app | `web/cara3d.js`: `bailar`, `ESTILOS`; `web/escenarios.js` | — |

## 9. Enfoque: Pomodoro y Eisenhower (`web/tiempo.js`)

| Función | Entrada | Código | Herramienta |
|---|---|---|---|
| Iniciar, pausar, seguir y parar el pomodoro | app | `web/tiempo.js`: `empezar`, `pausar`, `reanudar`, `saltarFase` | `iniciar_pomodoro`, `pausar_pomodoro`, `reanudar_pomodoro`, `parar_pomodoro` |
| Plan: un pomodoro por tarea | app | `web/tiempo.js`: `empezarPlan`, `avanzarPlan`, `revisar` | — |
| Guía de Eisenhower | app | `web/tiempo.js`: `guiaEmpezar`, `htmlGuia`, `leerTarea` | `guiar_matriz` |
| Qué hago ahora | app | `web/tiempo.js`: `pideQueHago` | `que_hago_ahora` |
| Tareas (agregar, mover, completar, borrar) | app | `web/tiempo.js`: `ejecutar` (herramientas de tareas) | `agregar_tarea`, `mover_tarea`, `completar_tarea`, `borrar_tarea` |
| Ver tareas y estado del pomodoro | app | `web/tiempo.js`: `ejecutar` (herramientas de consulta) | `ver_tareas`, `estado_pomodoro` |
| Configurar el enfoque | app | `web/tiempo.js`: `guardarCfg` | `configurar_enfoque` |

## 10. Notas, cerebro, contactos, WhatsApp y aparatos (app)

| Función | Código | Herramienta |
|---|---|---|
| Tomar nota dictada y guardarla | `web/apuntes.js`: `empezar`, `dictar`, `terminar` | `tomar_nota` |
| Analizar una nota con Gemini | `web/apuntes.js`: `analizar` | `analizar_nota` |
| Ver y leer notas | `web/apuntes.js`: `filtrarNotas`, `notaDe` | `ver_notas`, `leer_nota` |
| Recordar, olvidar y decir qué sabe | `web/cerebro.js`: `ejecutar`, `buscar` (BM25) | `recordar`, `olvidar`, `que_sabes_de_mi` |
| Aprender solo de la conversación | `web/cerebro.js`: `aprender` | — |
| Mapa del cerebro | `web/mapa.js`: `MapaCerebro`; `web/cerebro.js`: `grafo`, `enlaces` | — |
| Guardar y ver contactos | `web/contactos.js`: `guardar`, `buscar` | `guardar_contacto`, `ver_contactos` |
| Traer los contactos de Google (botón «Exportar contactos») | `web/google.js`: `traerContactos`, `contactoDeGoogle`; `web/contactos.js` | People API (`contacts.readonly`) |
| Enviar por WhatsApp (solo con "sí"; espera los contactos y pregunta si hay dos parecidos) | `web/whatsapp.js`: `buscarPersona`, `ejecutar`, `abrir`; `web/contactos.js`: `esperar`, `candidatosDe`; `puente_pc.py`: `whatsapp` | `escribir_whatsapp`; `POST /api/pc` (`accion: "whatsapp"`) |
| Registro de acciones (pestaña Registro) | `web/agente.js`: `registrar`; `web/registro.js`: `juntar`, `pintar`, `podar` | `usuarios/<uid>/registro` y `pixeles/<pid>/registro` |
| Controlar aparatos (Wake-on-LAN, TV, IR, relé, http) | `web/aparatos.js`: `plan`, `ejecutar`, `probarPuente` | `controlar_aparato`, `ver_aparatos` |
| Aparatos desde el PC | `puente_pc.py`: `aparato`, `wol`, `tv` | `POST /api/aparato`, `/api/tv`, `/api/tv/emparejar`, `/api/tv/codigo` |
| Perfil y Markdown | `web/perfil.js`: `leerMarkdown`, `aMarkdown`, `paraPrompt` | — |
| Ajustes, modos y costo de Gemini | `web/ajustes.js`: `MODOS`, `PRECIOS` | — |
| Proveedor de IA propio (Claude, OpenAI, etc.) | `web/proveedores.js`, `web/proveedor_claude.js` | — |
| Humor de la cara (animaciones) | `web/humor.js` | — |
| Cara 3D de Píxel | `web/cara3d.js`: `GESTOS`, `EVENTOS`, `boca` | — |

## 11. Firmware en el ESP32 (`~/Arduino/`, fuera del repo)

| Función | Código |
|---|---|
| Portal WiFi y formulario | `Pixel_portal/Pixel_portal.ino` |
| Buscar el servidor por UDP | `Pixel_portal/Pixel_portal.ino` (`PIXEL? ...`) |
| Anunciarse por BLE y mandar la lista Bluetooth vista | `Pixel_portal/Pixel_portal.ino` |
| Puente de aparatos: infrarrojo, relé, Wake-on-LAN, http | `Pixel_portal/puente.ino` |
| Enlazar el puente por Bluetooth (botón BOOT) | `Pixel_portal/puente.ino` |

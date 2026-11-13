# Píxel, asistente de voz

Píxel es un agente de inteligencia artificial creado por Divergencia IA, con cara de robot, hecho para una feria de tecnología. Vive en una aplicación web que se instala en el celular: oye la palabra **«Píxel»**, piensa con la inteligencia artificial que elijas (cada persona pone su clave), contesta con una voz natural de alta calidad y mueve su cara en 3D. Se entra con la cuenta de Google y cada persona tiene su perfil. Un computador y un ESP32 son opcionales: le dan micrófono y altavoz propios y le dejan manejar los aparatos de la casa.

- **Aplicación:** https://pixelassitance.web.app (en el celular, con Chrome).
- **Programa para el computador:** [Linux (.deb)](https://github.com/DiegoWhite99/Pixel/releases/download/v2.4.2/pixel_2.4.2_amd64.deb) y [Windows (.exe)](https://github.com/DiegoWhite99/Pixel/releases/download/v2.4.2/Pixel-2.4.2-Setup.exe), en [Versiones de GitHub](https://github.com/DiegoWhite99/Pixel/releases).
- **Versión actual:** 2.4.2, del 13 de noviembre de 2026.
- **Cómo está hecho por dentro:** `CLAUDE.md`. **Mediciones y decisiones:** `memoria.md`.

## Qué puede hacer

| Para… | Dile… |
|---|---|
| Conversar | «Píxel, ¿cuánto mide el Everest?» |
| Recordatorios | «Píxel, recuérdame en 10 minutos sacar la ropa» |
| Google Calendar | «Píxel, ¿qué tengo mañana?» · «Píxel, crea un evento el viernes a las 3» |
| Gmail | «Píxel, léeme el último correo de Ana» · «respóndele que sí voy». Nunca envía sin que digas «envíalo». |
| WhatsApp | «Píxel, escríbele a Ana por WhatsApp: hola». Siempre pregunta «¿Se lo mando?». |
| Modo enfoque | «Píxel, modo enfoque»: ordena tus tareas con la matriz de Eisenhower y te da un pomodoro para cada una |
| Notas | «Píxel, toma nota de la clase de física» … «Píxel, termina la nota» |
| Música | «Píxel, pon salsa» · «pausa» · «cambia de canción». Baila y cambia el fondo según el género. |
| Aparatos | «Píxel, súbele al volumen del PC» · «Píxel, prueba el robot» |
| Su memoria | «Píxel, recuerda que mi hermana se llama Laura». Se ve como un mapa en Personalidad y, en el computador, en Obsidian. |
| Contactos | «Píxel, guarda el número de Ana: 300 123 4567». Están en la pestaña Contactos, con su celular y su correo. |
| Tu perfil | Toca tu foto arriba: cómo te llama, si te trata de tú o de usted, tus gustos y en qué te ayuda. También con un archivo Markdown. |
| Hablarle al computador | En Inicio, «Usar el PC»: el celular hace de micrófono del Píxel de tu casa, y su voz sale en el celular. |
| Ver lo que hizo | Pestaña Registro: cada correo enviado, evento, WhatsApp, orden a un aparato o recordatorio, con su hora y desde dónde. |

En **Ajustes** se elige la voz de Píxel y la IA con la que piensa, y cada modo tiene su interruptor, que dice si gasta el cupo gratis de Gemini o no. Ahí también se ve cuánto se ha gastado.

## Versiones

Cada versión tiene un número **X.Y.Z** y una etiqueta en git (`vX.Y.Z`):

- **X** sube con un cambio grande, que cambia cómo se usa Píxel.
- **Y** sube con funciones nuevas.
- **Z** sube con arreglos y mejoras pequeñas.

| Versión | Fecha | Qué trae |
|---|---|---|
| **2.4.2** | 13 nov 2026 | Enlazar el robot desde la app: el código se dice despacio (cifra por cifra, dos veces) y, si el Bluetooth se corta, la app se vuelve a conectar sola. |
| **2.4.1** | 13 nov 2026 | El robot y el programa del PC suenan como la app: la campanita al llamarlo, las notas suaves mientras piensa, la campanita al terminar y el aviso de los recordatorios. |
| **2.4.0** | 12 nov 2026 | Un solo Píxel: el programa del PC (y el robot) y la app copian entre sí, en los dos sentidos, las claves de IA, la IA preferida, la voz, el tipo de voz, la personalidad y el largo de las respuestas; el perfil de la app llega al PC. El robot usa las mismas instrucciones que la app. Google se conecta en el programa cargando su credencial. Windows ya no es «versión de prueba». |
| **2.3.0** | 12 nov 2026 | En Windows el PC se maneja como en Linux (volumen, música, bloquear, suspender, su MAC). La música suena en una pestaña, siempre la misma. La IA del programa del PC llega a la app con su indicador «En uso». El robot se llama Píxel, se puede quitar y pide un código al agregarlo. Google en el programa, a un paso. |
| **2.2.1** | 12 nov 2026 | La primera descarga de la voz ya no se rinde si se corta internet: sigue donde iba y reintenta sola. La búsqueda en la red ignora las direcciones que el router contesta por todas. |
| **2.2.0** | 12 nov 2026 | El programa del computador se abre en su propia ventana: un panel de control azul, con Píxel que llega desde el fondo y saluda. Icono e instalador nuevos. Groq como otra IA (en el programa y en la app). Arreglada la búsqueda de aparatos en Windows. La app ya acepta claves de Google que no empiezan por «AIza». |
| **2.1.2** | 11 nov 2026 | Windows: desinstalar con Píxel abierto ya borra el programa entero. Enlace con la cuenta probado con el programa instalado. |
| **2.1.1** | 11 nov 2026 | Instaladores publicados, con una prueba de punta a punta en Windows y Ubuntu limpios. Página de entrada sin nombres de tecnología y con video de presentación. |
| **2.1.0** | 11 nov 2026 | Instaladores para Linux y Windows, página de entrada, la IA de cada cuenta (sin Gemini incluido), registro de acciones, el celular como micrófono del computador, confirmaciones estrictas para correos y eventos, destinatarios solo de Contactos (también en WhatsApp) y un botón para traer los contactos de Google (aún sin probar de punta a punta). |
| **2.0.0** | 10 nov 2026 | Entrada con Google, perfil con foto y archivo Markdown, Píxel se presenta, voz de alta calidad (Supertonic 3), Contactos, la IA con tu propia clave y WhatsApp sin recargar la pestaña. |
| **1.3.1** | 10 nov 2026 | Sonidos al llamarlo, al pensar y al terminar. WhatsApp en el computador usa la pestaña que ya está abierta. |
| **1.3.0** | 10 nov 2026 | Pestaña Ajustes: un interruptor por modo y el consumo de Gemini. Consumo bajo por defecto. |
| **1.2.1** | 10 nov 2026 | WhatsApp, modo enfoque con un pomodoro por tarea, mapa del cerebro, y probar el ESP32, el computador y Google. |
| **1.0.0** | 10 nov 2026 | Píxel entero en el celular: Gemini, Calendar, Gmail, Pomodoro, Eisenhower, cerebro, aparatos, música, notas y voz infantil. |

No hay 1.1.0: la segunda fase salió directamente como 1.2.1.

### 2.4.2 · 13 de noviembre de 2026

Pedido del usuario: «va muy rápido con lo del código, le doy repetir el código y se pierde la conexión».

- **El código se dice despacio:** «Para enlazarme con la app, mi código es:», cada cifra sola («Seis.», «Tres.»…) con un silencio después, «Otra vez.» y las cifras de nuevo, con el aviso delante (`Sesion._decir_codigo`). También el código de enlace del PC. Antes iba en una frase con comas y sonaba seguido.
- **La app no se rinde si se corta el Bluetooth** al agregar el robot (`conexionBle` en `web/aparatos.js`): se vuelve a conectar sola. Antes, un corte hacía que la app pidiera el botón BOOT, que tampoco podía llegar.
- Firmware del robot (fuera de este repositorio):
    - tras un corte vuelve a anunciarse por Bluetooth (antes desaparecía hasta reiniciarlo);
    - no busca otros aparatos mientras la app está conectada;
    - usa una sola conexión segura con la nube y mira las órdenes cada 1,5 s (dos conexiones no le cabían en la memoria).

### 2.4.1 · 13 de noviembre de 2026

Pedido del usuario: «el robot no toma ni los sonidos ni nada de Píxel de la web, te recuerdo que deben ser iguales».

- **Los mismos sonidos que la app** en el robot y en el programa del PC (`servidor.py`, igual que `SONIDOS` y `PENSAR` de `web/agente.js`: las mismas notas, el mismo armónico y el mismo volumen):
    - al aceptar lo que dices, la campanita que sube (mi, si, mi), también en la frase que sigue al «Dime»;
    - mientras piensa, una nota suave (do, mi, sol, mi) cada 0,42 s, desde los 0,6 s y hasta que suena la respuesta;
    - al terminar, la campanita que baja (no tras el «Dime» ni tras un recordatorio, como en la app);
    - antes de un recordatorio, el aviso de dos notas.
- Antes eran dos pitidos cortos y silencio mientras pensaba.
- Las campanitas no mueven la boca de la cara.
- Firmware del robot (fuera de este repositorio): el audio del micrófono USB pasó a la memoria PSRAM. Ocupaba la memoria interna que necesita la conexión segura, y el robot no podía entrar en la nube ni enlazarse con la app («SSL - Memory allocation failed»).

### 2.4.0 · 12 de noviembre de 2026

Pedido del usuario: «las configuraciones deben ser un espejo de uno al otro», «tiene que ser igual lo que está en la app, la web y el robot». Ya no es una demo de feria.

- **Un espejo entre el programa del PC y la app** (`web/espejo.js`), con todos los PC enlazados a la cuenta, no solo el elegido:
    - las claves de Gemini y Groq y cuál contesta primero: puestas o quitadas en un lado, aparecen o se quitan en el otro;
    - la voz, el tipo de voz, la personalidad y el largo de las respuestas;
    - gana el cambio más reciente (cada lado guarda la hora del cambio con el reloj de la nube). La app hace de centro: lo que cambia en un PC llega a la app y de ahí a los demás PC.
- **El robot es el mismo Píxel que la app:** el programa del PC usa las mismas instrucciones (`web/agente.md`), sin las partes que solo tiene la app, y el perfil que escribiste en la app («Lo que Píxel sabe de ti» en la ventana del programa). Antes el robot se presentaba como «el asistente de una demo en una feria».
- **Google en el programa:** la tarjeta de Google trae los pasos para crear la credencial de «App de escritorio» en Google Cloud y un botón para cargar el archivo. Después, «Conectar con Google».
- **Windows** ya no se presenta como versión de prueba.
- **Robot nuevo:** micrófono USB detrás de un hub (`micro_usb.ino`, fuera de este repositorio) y luz verde o azul.
- Pruebas: `tests/test_espejo_v24.py`, las del espejo en `tools/prueba_modulos.js` y `tools/prueba_espejo.js` (de punta a punta, con dos PC de prueba y una cuenta anónima que se borra al final).

### 2.3.0 · 12 de noviembre de 2026

Pedidos del usuario tras probar la 2.2.1 en su Windows.

- **El PC con Windows, como con Linux:** subir y bajar el volumen, silenciar, pausar, siguiente y anterior (con las teclas multimedia del sistema), bloquear, apagar la pantalla y suspender (con la API de Windows), y su MAC para encenderlo por red. Antes en Windows no funcionaba nada de eso.
- **La música en una pestaña, siempre la misma:**
    - En el PC, YouTube sale en una ventana de música propia, con su perfil: cada canción reemplaza a la anterior, en vez de abrir una pestaña nueva por pedido.
    - En la app, «pon tal canción» la pone en una pestaña del navegador (siempre la misma), ya no en la pantallita debajo de Píxel. Si el navegador no deja abrirla sola, sale el botón «Abrir la música».
- **La IA del programa del PC llega a la app:** las claves de Gemini o Groq que pongas en la ventana del PC las usa también la app de las cuentas vinculadas a ese PC, mientras no tengan una clave propia en ese aparato. En Ajustes → Proveedor de IA se ve cuál es y cuál está **«En uso»**, y en la ventana del PC dice «En uso» o «De respaldo». La clave viaja por la nube y solo la pueden leer las cuentas vinculadas a ese PC.
- **El robot se llama Píxel:** en la app ya no dice «ESP32». Cada puente tiene un botón **«Quitar»**: el robot olvida a su dueño y el PC desenlaza esa cuenta.
- **Código al agregar el robot desde la app:** Píxel inventa un código de 6 cifras y el PC lo dice por el altavoz del robot; se escribe en la app. Sin el PC conectado, vale pulsar una vez su botón BOOT, como antes. Requiere el firmware nuevo del robot (cargado el 12 nov).
- **Google en el programa (calendario y correo):** la ventana del PC tiene la tarjeta «Google» para conectar la cuenta, y lo que se le pida por voz al robot o al PC irá a Google Calendar y Gmail. Falta la credencial de «app de escritorio» del proyecto en Google Cloud: el programa la trae en cuanto exista.
- **Prueba de GitHub en Windows:** también lee la MAC, toca el volumen y pone tres canciones de YouTube comprobando que queda una sola pestaña.

### 2.2.1 · 12 de noviembre de 2026

- **Primera descarga:** en el Windows del usuario, la conexión se cortó a los 73 de 456 MB («WinError 10054») y Píxel se rindió: cada corte volvía a bajar el archivo desde cero, a los 3 cortes paraba y había que cerrarlo con el Administrador de tareas. Ahora sigue donde iba, no se rinde mientras avance, guarda lo bajado aunque se cierre y, si no hay internet, lo vuelve a intentar solo cada poco.
- **La ventana propia en Windows:** en la 2.2.0 no arrancaba (al armar el instalador se quitaron unas piezas de la librería de la ventana que ella pide al empezar) y Píxel la abría en Edge en modo aplicación. Lo vio la prueba de GitHub y salió también en el Windows del usuario.
- **Buscar en la red:** en algunas redes el router contesta por todas las direcciones con la suya (así es la red de las máquinas de GitHub: salían 237 «equipos» y en Windows la búsqueda pasaba de 2 minutos). Esas direcciones ya no cuentan como aparatos.
- **Prueba de GitHub:** si falla una revisión, sigue con las demás (en la 2.2.0 no llegó a abrir la ventana de Windows por eso).

### 2.2.0 · 12 de noviembre de 2026

Pedidos del usuario tras probar la 2.1.2 en Windows.

- **Una ventana, no una página web.** El programa ya no abre el navegador: abre la ventana de Píxel (en Windows, con el motor de Edge que trae el sistema; en Linux, Chrome o Chromium sin barra de direcciones si los hay). El panel solo se abre en ese computador, no en la red. Cerrar la ventana no apaga a Píxel; para apagarlo, «Apagar Píxel» en el panel.
- **Panel de control nuevo, todo azul**, distinto de la app de internet. Al abrirlo, Píxel llega desde el fondo hasta el frente y dice: «Hola, soy Píxel, un agente creado por Divergency IA. Bienvenido al panel de control. Aquí puedes vincular tus dispositivos y guardar tus APIs.» Tiene Inicio (estado de un vistazo), Dispositivos (el código de 6 cifras para vincular, las cuentas vinculadas, el robot y los aparatos de la red), Tus APIs y Voz. Mientras baja la voz la primera vez, el avance sale ahí mismo.
- **Groq**, una IA muy rápida, como segunda opción junto a Gemini: en el programa (Tus APIs, con la opción de cuál contesta primero; la otra queda de respaldo) y en la app (Ajustes → Proveedor de IA).
- **Claves:** en la app (Ajustes → Proveedor de IA) una clave de Google que no empezaba por «AIza» salía como «Esa clave no parece de Google Gemini» y no se podía guardar (captura del usuario). Ahora la app solo mira que la clave esté entera y la prueba con el servicio al guardarla: si la acepta se queda, si la rechaza no. Lo mismo en el programa del computador, y si el modelo de Gemini de siempre no está para esa clave, usa otro Flash en vez de rechazarla.
- **Arreglo:** en un Windows en español, «Buscar en la red» fallaba con «No pude buscar: expected string or bytes-like object». La lista de equipos de Windows llega en otra codificación, la lectura fallaba en silencio y quedaba vacía.
- **Instalador:** icono propio (también en los accesos y la ventana), páginas azules con Píxel, y «Divergency IA» como editor.
- **Prueba de GitHub:** además de lo de antes, comprueba la búsqueda en la red, que una clave de Google inventada recibe una respuesta clara, que el panel no se abre a la red y, en Windows, que se abre una sola ventana de Píxel, con fotos de ella y del instalador.

### 2.1.2 · 11 de noviembre de 2026

- **Windows:** al desinstalar (o actualizar) con Píxel abierto, ahora sí lo cierra. El instalador es de 32 bits y buscaba a Píxel con un PowerShell de 32 bits, que no ve la ruta de un programa de 64 bits: nunca lo encontraba, y la carpeta del programa quedaba bloqueada. Ahora lo busca de una forma que sirve en los dos, espera a que suelte sus archivos y reintenta el borrado. Lo encontró la prueba de GitHub en la 2.1.1, donde todo lo demás pasó en Windows y en Ubuntu 22.04 y 24.04.
- **Enlace con la cuenta probado con el programa instalado:** el `.deb` desempaquetado entra solo a Firebase, abre el modo enlace con su código, una cuenta de prueba lo enlaza, usa «Usar el PC» y el registro muestra lo que hizo. Después se borró de Firebase todo lo del PC de prueba.

### 2.1.1 · 11 de noviembre de 2026

Los instaladores, publicados y probados de verdad.

- **Descargas** en [Versiones de GitHub](https://github.com/DiegoWhite99/Pixel/releases/tag/v2.1.1), con los botones del lobby apuntando ahí.
- **Prueba de punta a punta** (`.github/workflows/probar_instaladores.yml`): en un Windows y dos Ubuntu limpios de GitHub, baja cada instalador del enlace del lobby, lo instala como una persona, arranca Píxel, le dice dos frases grabadas (`tools/frase_prueba.wav`), comprueba que contesta con voz y lo desinstala. Corre sola al publicar una versión.
- **Lobby:** ya no nombra la tecnología por dentro (la placa, relés, Markdown…) y tiene un video de presentación con música lofi, sin voz.
- **Paquetes:** su descripción y su LÉEME tampoco nombran la tecnología. «Píxel, prueba el robot» prueba el robot.

### 2.1.0 · 11 de noviembre de 2026

Píxel se puede instalar, cada persona usa su propia IA, y se ve todo lo que hizo. Además, arreglos de seguridad en el correo y los eventos.

- **Instaladores** (se publicaron con la 2.1.1):
  - `.deb` para Ubuntu y Debian: `sudo apt install ./pixel_<versión>_amd64.deb`. El código va compilado.
  - `.exe` para Windows, como versión de prueba. En Windows no hay Bluetooth, volumen, música del sistema ni WhatsApp desde el computador.
  - Cada uno lleva su propio Python. La primera vez baja unos 600 MB (voces y reconocimiento de voz, comprobados con su huella) y abre el panel para vincular el computador con la cuenta.
  - Sin Gemini ni Ollama, Píxel dice que le falta la IA en vez de solo sonar el pitido.
- **Página de entrada:** sin sesión, la app abre una página que explica Píxel, con las descargas y «Entrar con Google». Ya dentro, «Primeros pasos» pide vincular el Píxel y poner la clave de IA.
- **La IA es de cada cuenta:** ya no hay Gemini incluido. Cada persona pone su clave en Ajustes → Proveedor de IA; sin clave, Píxel lo dice y no llama a ninguna IA.
- **Registro de acciones:** pestaña nueva con lo que Píxel hizo de verdad (correos, eventos, WhatsApp, aparatos, recordatorios, contactos de Google), con hora y si fue en el celular, el computador o el PC de casa. Se anota después de hacerlo, nunca antes.
- **El celular como micrófono del computador:** «Usar el PC» en Inicio. El celular corta las frases y las manda al Píxel de la casa; piensa el computador y su voz vuelve al celular. Sirve sin clave de IA en la app.
- **WhatsApp:** espera a que lleguen los contactos y, si dos se parecen igual, pregunta a cuál escribir.
- **Correo:** solo «sí», «envíalo» o «mándalo» confirman el envío. Una frase cualquiera con «manda» ya no envía el borrador pendiente.
- **Destinatarios:** un correo sale solo de Contactos o de las notas de personas. Si hay dos contactos que encajan igual, Píxel pregunta cuál. Ya no se busca en el historial de Gmail para adivinar.
- **Contactos al entrar:** la búsqueda espera a que llegue la lista desde Firebase.
- **Eventos:** crear un evento pide confirmación («¿Lo agendo…?») antes de llamar a Calendar.
- **Cuerpo del correo:** los `\n` escritos se convierten en saltos de línea reales.
- **Computador:** la búsqueda de contactos ya no toma al primero que coincide con el nombre.
- **Contactos de Google:** el botón «Exportar contactos» trae los contactos de la cuenta (solo lectura). Aún no está probado de punta a punta: falta activar la People API en el proyecto.

### 2.0.0 · 10 de noviembre de 2026

Cambia cómo se empieza a usar Píxel: ahora cada persona entra con su cuenta y Píxel la conoce.

- **Pantalla de entrada:** sin sesión solo se ve a Píxel con «Entrar con Google». La primera vez quedas registrado.
- **Mi perfil** (tocando tu foto, arriba):
  - foto, nombre, cómo quieres que te llame, si te trata de tú o de usted, sobre ti, tus gustos, en qué te ayuda y reglas para Píxel;
  - o un **archivo Markdown**: con la plantilla se lee sin gastar la IA; escrito a tu manera, lo lee la IA con una petición;
  - al guardar se ve «✓ Guardado»;
  - Píxel lo usa en cada respuesta.
- **Primer contacto:** la primera vez, Píxel se presenta en voz alta («un agente de inteligencia artificial creado por Divergencia IA…») y te invita a llenar tu perfil.
- **Voz de alta calidad:** Supertonic 3, de Supertone, con la voz Mujer 4 por defecto y 10 para elegir en Ajustes.
  - En el celular se baja una vez (unos 400 MB) y después habla sin internet. Si el aparato es muy lento para ella, usa la voz del celular.
  - Lee bien las cifras, las horas, los porcentajes y los precios.
  - El computador y el ESP32 también hablan con ella.
- **Contactos:** nombre, celular y correo, en su propia pestaña. WhatsApp y Gmail los buscan ahí.
- **La IA con tu clave** (Ajustes → Proveedor de IA): Gemini, Claude, GPT, OpenRouter (para Kimi), DeepSeek u otro compatible. La clave se queda en tu aparato, y el consumo se ve por modelo.
- **WhatsApp en el computador:** si WhatsApp Web ya está abierto, escribe en esa pestaña sin recargarla y deja el mensaje para que tú lo envíes. Se arregló una dirección rota que salía con el teclado latinoamericano.
- **Cuenta de Google:** al entrar siempre se elige la cuenta, y hay «Cambiar de cuenta».
- **Seguridad:** reglas nuevas para el perfil y los contactos (cada quien ve solo lo suyo), y se cerró un hueco por el que un Píxel podía meterse en la lista de otro usuario.
- **Pruebas nuevas:** `tools/prueba_voz.py` y más casos en `tools/prueba_modulos.js` (64).

### 1.3.1 · 10 de noviembre de 2026

- **Sonidos:**
  - tres notas que suben cuando lo llamas;
  - una melodía muy suave mientras espera a Gemini (solo si tarda más de medio segundo);
  - las mismas notas bajando cuando termina;
  - se apagan en Ajustes → Sonidos.
- **WhatsApp en el computador:** si WhatsApp Web ya está abierto, escribe el mensaje en esa misma pestaña. Antes abría otra, y WhatsApp se quejaba de estar abierto en dos ventanas.
- Prueba nueva: `tools/prueba_puente_pc.py`.

### 1.3.0 · 10 de noviembre de 2026

- **Pestaña Ajustes:**
  - los 14 modos de Píxel, cada uno con su interruptor;
  - para cada modo, si gasta Gemini y cuánto;
  - con Gemini apagado, Píxel solo hace lo que no lo necesita.
- **Consumo de Gemini:**
  - peticiones y palabras (tokens) de hoy y de los últimos 7 días, y en qué se gastan;
  - lo que costaría con el plan de pago, según los precios oficiales de Google;
  - con el plan gratis, que es el que usa Píxel, no cuesta nada.
- **Consumo bajo por defecto:**
  - «Aprender solo» y el asunto automático de las notas vienen apagados;
  - cada pregunta lleva menos historial.
- **Arreglos:**
  - las palabras gastadas se contaban en 0;
  - «salir» no sacaba del modo enfoque.

### 1.2.1 · 10 de noviembre de 2026

- **WhatsApp:**
  - con el enlace oficial de WhatsApp;
  - en el celular abre el chat con el mensaje escrito, y en el computador lo envía;
  - guarda el número de cada persona en su memoria.
- **Modo enfoque:**
  - muestra las dos herramientas y propone empezar por la matriz;
  - te guía por voz y te da un pomodoro para cada tarea;
  - al terminar cada uno pregunta «¿La terminaste?»;
  - todo sin gastar Gemini.
- **Pomodoro en la pantalla principal:** un anillo con el tiempo alrededor de Píxel.
- **Mapa del cerebro:** tus notas como una red de nodos, igual que en Obsidian.
- **Botones para probar:** «Probar» en el ESP32 y en el computador, y «Probar con mi cuenta» para Google, que solo lee.

### 1.0.0 · 10 de noviembre de 2026

Lo hecho del 21 de octubre al 9 de noviembre:

- **Base:**
  - Píxel completo en el celular, sin depender del computador;
  - la cara 3D con ojos LED;
  - personalidad: se ríe, se duerme y hace cosas al azar.
- **Con Google:** Calendar, y Gmail con confirmación antes de enviar.
- **Organización:** Pomodoro y matriz de Eisenhower, notas dictadas con análisis, y el cerebro con su copia en Obsidian.
- **Aparatos:** el computador y el ESP32 hacen de puente hacia los aparatos de la casa.
- **Música:** YouTube por voz, con baile y escenarios según el género.
- **Voz infantil.**

### Ver o volver a una versión

```bash
git tag -l -n1          # las versiones
git checkout v1.3.0     # ver el código de una versión
git checkout vinculacion_movil   # volver al trabajo de hoy
```

Para volver a publicar una versión vieja: `git checkout vX.Y.Z` y luego `npx firebase-tools deploy --only hosting`. Necesita `web/claves.js`; ver *Claves* abajo.

### Publicar una versión nueva

1. Pasar las pruebas (abajo).
2. Escribir la versión en la tabla y en su sección de arriba.
3. Guardar los cambios en `vinculacion_movil` y fusionarlos en `main`.
4. Subir el número en `instalador/construir.sh`, `instalador/pixel_lanzador.py`, `instalador/LEEME.txt` y los botones de `web/lobby.html`, y armar: `instalador/construir.sh todo`.
5. `git tag -a vX.Y.Z -m "Píxel X.Y.Z: …"` y `git push origin main vinculacion_movil vX.Y.Z`.
6. `gh release create vX.Y.Z dist/* --prerelease`: al publicarla corre sola la prueba de los instaladores (pestaña Actions). Si pasa, `gh release edit vX.Y.Z --prerelease=false --latest`.
7. `npx firebase-tools deploy --only hosting`. Si cambiaron las reglas de la base de datos, también `--only database`.

## Partes del proyecto

| Parte | Dónde | Qué hace |
|---|---|---|
| La aplicación | `web/` (Firebase Hosting) | Píxel en el celular: oír, Gemini, voz, cara, módulos (`agente.js` y los demás `.js`). |
| La nube | Firebase (`database.rules.json`) | Cuentas, datos de cada usuario y las órdenes a los puentes. |
| El computador | `servidor.py` y compañía | Opcional: Píxel con el ESP32 (voz), el panel local (`http://<IP>:8080`) y el puente del PC (volumen, música, TV, WhatsApp, Obsidian). |
| La voz | `web/voz.js` (celular) y `tts_supertonic.py` (computador) | Supertonic 3. En el celular se baja de Hugging Face; en el computador va en `voces/supertonic3/`. |
| El ESP32 | `~/Arduino/Pixel_portal/` (fuera de este repositorio) | Micrófono y altavoz, y puente de infrarrojo, relé y encendido por red. |

## Puesta en marcha del computador

Con el instalador (arriba) no hace falta nada de esto: trae su propio Python y baja lo demás la primera vez. Para armar los instaladores: `instalador/construir.sh` (ver `CLAUDE.md`).

Desde el código:

- Python 3.10 en `.venv/` con faster-whisper 1.2.1, piper-tts 1.8.0, numpy, yt-dlp y androidtvremote2.
- Ollama en `127.0.0.1:11434` con `qwen2.5:3b`, de respaldo de Gemini.
- La voz **Supertonic 3** en `voces/supertonic3/` (no va en git: pesa 398 MB). Se descarga de https://huggingface.co/Supertone/supertonic-3: las carpetas `onnx/` y `voice_styles/` tal cual. Su licencia (OpenRAIL-M) va en `voces/supertonic3/LICENSE`.
- Las voces de Piper de respaldo (`es_ES-sharvard-medium` y compañía) en `voces/`, de https://huggingface.co/rhasspy/piper-voices.
- Para que el computador envíe por WhatsApp: `sudo apt install xdotool xclip`, y WhatsApp Web abierto en Chrome.

```bash
systemctl --user restart pixel      # el servidor arranca solo con la sesión
tail -f servidor.log
```

## Claves y privacidad

Este repositorio es público: aquí no entran claves, grabaciones ni datos personales.

- `web/claves.js` lleva la clave de navegador de YouTube. Para crearlo, copia `web/claves.ejemplo.js` como `web/claves.js` y pon la clave.
- `nube_token.json`, `google_*.json`, `gemini_clave.json`, los certificados del TV, `capturas/` y los datos de uso se quedan en el computador. Ver `.gitignore`.

## Pruebas

```bash
node tools/prueba_modulos.js                  # las funciones de la aplicación (segundos)
.venv/bin/python tools/prueba_obsidian.py     # la sincronización con Obsidian
.venv/bin/python tools/prueba_puente_pc.py    # WhatsApp en el computador (no envía nada)
.venv/bin/python tools/prueba_voz.py          # los números de la voz, iguales en el computador y en la app
```

La prueba de punta a punta (`tools/prueba_app.js`) usa Gemini y YouTube de verdad, así que gasta cupo. Cómo se corre: `CLAUDE.md`.

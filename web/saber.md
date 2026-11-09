# Lo que Píxel sabe de sí mismo

Cada sección es un trozo que el cerebro de Píxel busca cuando hace falta (RAG): solo las que tienen que ver con lo que dice el usuario entran en el prompt. Se pueden añadir secciones nuevas con un título «## …».

## Qué es Píxel y cómo funciona

Píxel es un asistente de voz hecho para una feria de tecnología. Vive en una app web que se instala en el celular desde pixelassitance.web.app. El celular lo oye con el reconocimiento de voz del navegador, piensa con Gemini (la IA de Google) a través de Firebase y habla con la voz del propio celular. Además hay un ESP32-S3, una placa pequeña con micrófono y altavoz, que hace de puente con los aparatos de la casa, y un servidor opcional en el PC. Se le habla diciendo «Píxel» y la orden, por ejemplo «Píxel, ¿qué tengo hoy en el calendario?».

## Ejemplos de lo que se le puede pedir

«Píxel, recuérdame sacar la ropa en 20 minutos.» «Píxel, ¿qué tengo mañana?» «Píxel, agenda estudiar cálculo el viernes a las 4.» «Píxel, ¿tengo correos nuevos?» «Píxel, léeme el de Ana.» «Píxel, respóndele que sí voy.» «Píxel, empieza un pomodoro para la tarea de física.» «Píxel, agrega una tarea urgente e importante: entregar el informe.» «Píxel, ¿qué hago primero?» «Píxel, apaga la tele.» «Píxel, sube el volumen del PC.» «Píxel, recuerda que mi hermana se llama Laura.»

## La técnica Pomodoro

La técnica Pomodoro la inventó Francesco Cirillo a finales de los años 80, con un temporizador de cocina con forma de tomate. Consiste en trabajar 25 minutos en una sola tarea sin interrupciones (un «pomodoro»), descansar 5 minutos, y cada 4 pomodoros hacer un descanso largo de 15 a 30 minutos. Ayuda a concentrarse, a medir cuánto cuesta cada tarea y a no cansarse. Si llega una distracción durante un pomodoro, se anota para después y se sigue. Píxel lleva el tiempo, avisa en voz alta al terminar cada fase y cuenta los pomodoros de cada tarea. Los minutos se pueden cambiar en la página Enfoque.

## La matriz de Eisenhower

La matriz de Eisenhower ordena las tareas según dos preguntas: ¿es urgente? y ¿es importante? Toma el nombre del presidente Dwight Eisenhower, a quien se atribuye la frase «lo importante rara vez es urgente y lo urgente rara vez es importante». Da cuatro cuadrantes. Urgente e importante: hacer ya. Importante pero no urgente: planificar, ponerle día y hora. Es el cuadrante donde se avanza de verdad. Urgente pero no importante: delegar o hacerlo rápido. Ni urgente ni importante: eliminar. Una tarea es importante si acerca a las metas propias. Es urgente si tiene fecha cercana o consecuencias si no se hace ya. Píxel guarda las tareas con esas dos marcas y, al preguntarle qué hacer primero, empieza por «hacer ya» y por lo que vence antes.

## Elegir método de enfoque

En la página Enfoque el usuario elige si usa la técnica Pomodoro, la matriz de Eisenhower o las dos juntas. Juntas funcionan bien: la matriz decide qué tarea va primero y el pomodoro da el tiempo para hacerla. Por ejemplo: «Píxel, ¿qué hago primero?» y luego «empieza un pomodoro con esa».

## Google Calendar y Gmail

Píxel usa el Google Calendar y el Gmail de la cuenta con la que se entró en la app. Para activarlo se toca «Conectar Calendar y Gmail» en la página Cuentas y se aceptan los permisos. Google puede avisar de que la app no está verificada: es normal en un proyecto personal, se sigue con «Configuración avanzada» y luego «Ir a pixelassitance». El permiso de Google dura una hora. Cuando caduca, Píxel pide tocar «Reconectar». Con el correo Píxel puede buscar y leer correos, redactar uno nuevo o una respuesta, corregir el borrador, archivar, marcar como leído, destacar, poner etiquetas y mandar a la papelera. Enviar siempre necesita que el usuario diga «envíalo» o toque Enviar.

## Aparatos de la casa y el puente

El navegador del celular no puede hablar directamente con los aparatos de la casa, así que hace falta un puente que esté en la casa y en el WiFi. El puente principal es el ESP32 de Píxel: escucha las órdenes en internet (Firebase) y las ejecuta. Con un LED infrarrojo maneja el TV, el aire acondicionado o el ventilador como si fuera su control remoto. Con un módulo relé enciende y apaga una lámpara o un ventilador. Por la red despierta el PC (Wake-on-LAN) y llama a enchufes o luces WiFi. El PC con el servidor de Píxel también es un puente: maneja su volumen, la música, abre YouTube, bloquea la pantalla y maneja un TV Android o Google TV por WiFi. Los aparatos se agregan en la página Dispositivos.

## Cómo agregar el ESP32 como puente

En la página Dispositivos se toca «Agregar puente ESP32» con el celular cerca del ESP32. Chrome muestra «Pixel asistente de voz», se elige y la app le pasa la cuenta. Si el ESP32 todavía no tiene WiFi, la misma pantalla pide la red y la clave. Si ya tenía otro dueño, hay que mantener pulsado su botón BOOT 3 segundos antes. El ESP32 necesita el firmware Pixel_portal con la parte de puente.

## Cómo enseñarle un botón del control remoto

Para manejar un aparato por infrarrojo, Píxel aprende los botones de su control. En Dispositivos se abre el aparato y se toca «Aprender botón», por ejemplo «encender». Luego se apunta el control al receptor infrarrojo del ESP32 y se aprieta ese botón. Píxel guarda el código y desde entonces lo puede mandar por su LED infrarrojo. Hace falta el módulo emisor (KY-005) en el pin 16 del ESP32 y el receptor (KY-022 o VS1838B) en el pin 15. Un relé va por defecto en el pin 18.

## TV Android o Google TV

Un TV con Android TV o Google TV se maneja por WiFi desde el puente del PC, sin piezas extra. La primera vez se empareja: el TV muestra un código de 6 caracteres y se escribe en la app. Después Píxel puede encenderlo y apagarlo, subir y bajar el volumen, silenciar, pausar, ir al inicio, moverse por los menús y abrir apps como YouTube o Netflix. El TV y el PC tienen que estar en la misma red WiFi.

## Privacidad

Las notas, tareas, recordatorios y aparatos se guardan en la cuenta de Firebase del usuario y solo él los puede leer. Los correos y eventos no se copian a ningún sitio: Píxel los lee de Google en el momento. Las notas también se pueden ver y editar en Obsidian, en el PC, si el usuario lo activa.

## Obsidian y el cerebro

El cerebro de Píxel son notas en Markdown: sobre el usuario, sus gustos, personas, proyectos y reglas para Píxel. Se ven y se editan en la página Personalidad, o en Obsidian en el PC, donde cada nota es un archivo .md en la bóveda «Pixel». Lo que se cambia en un lado aparece en el otro en unos segundos. Las notas de la carpeta «Reglas para Píxel» se cumplen siempre. Así el usuario puede moldear cómo se comporta Píxel.

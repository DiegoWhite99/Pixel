# Píxel, asistente de voz

Píxel es un agente de inteligencia artificial creado por Divergencia IA, con cara de robot, hecho para una feria de tecnología. Vive en una aplicación web que se instala en el celular: oye la palabra **«Píxel»**, piensa con Gemini (o con el modelo que elijas), contesta con una voz natural de alta calidad y mueve su cara en 3D. Se entra con la cuenta de Google y cada persona tiene su perfil. Un computador y un ESP32 son opcionales: le dan micrófono y altavoz propios y le dejan manejar los aparatos de la casa.

- **Aplicación:** https://pixelassitance.web.app (en el celular, con Chrome).
- **Versión actual:** 2.0.0, del 10 de noviembre de 2026.
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
| Aparatos | «Píxel, súbele al volumen del PC» · «Píxel, prueba el ESP32» |
| Su memoria | «Píxel, recuerda que mi hermana se llama Laura». Se ve como un mapa en Personalidad y, en el computador, en Obsidian. |
| Contactos | «Píxel, guarda el número de Ana: 300 123 4567». Están en la pestaña Contactos, con su celular y su correo. |
| Tu perfil | Toca tu foto arriba: cómo te llama, si te trata de tú o de usted, tus gustos y en qué te ayuda. También con un archivo Markdown. |

En **Ajustes** se elige la voz de Píxel y la IA con la que piensa, y cada modo tiene su interruptor, que dice si gasta el cupo gratis de Gemini o no. Ahí también se ve cuánto se ha gastado.

## Versiones

Cada versión tiene un número **X.Y.Z** y una etiqueta en git (`vX.Y.Z`):

- **X** sube con un cambio grande, que cambia cómo se usa Píxel.
- **Y** sube con funciones nuevas.
- **Z** sube con arreglos y mejoras pequeñas.

| Versión | Fecha | Qué trae |
|---|---|---|
| **2.0.0** | 10 nov 2026 | Entrada con Google, perfil con foto y archivo Markdown, Píxel se presenta, voz de alta calidad (Supertonic 3), Contactos, la IA con tu propia clave y WhatsApp sin recargar la pestaña. |
| **1.3.1** | 10 nov 2026 | Sonidos al llamarlo, al pensar y al terminar. WhatsApp en el computador usa la pestaña que ya está abierta. |
| **1.3.0** | 10 nov 2026 | Pestaña Ajustes: un interruptor por modo y el consumo de Gemini. Consumo bajo por defecto. |
| **1.2.1** | 10 nov 2026 | WhatsApp, modo enfoque con un pomodoro por tarea, mapa del cerebro, y probar el ESP32, el computador y Google. |
| **1.0.0** | 10 nov 2026 | Píxel entero en el celular: Gemini, Calendar, Gmail, Pomodoro, Eisenhower, cerebro, aparatos, música, notas y voz infantil. |

No hay 1.1.0: la segunda fase salió directamente como 1.2.1.

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
4. `git tag -a vX.Y.Z -m "Píxel X.Y.Z: …"` y `git push origin main vinculacion_movil vX.Y.Z`.
5. `npx firebase-tools deploy --only hosting`. Si cambiaron las reglas de la base de datos, también `--only database`.

## Partes del proyecto

| Parte | Dónde | Qué hace |
|---|---|---|
| La aplicación | `web/` (Firebase Hosting) | Píxel en el celular: oír, Gemini, voz, cara, módulos (`agente.js` y los demás `.js`). |
| La nube | Firebase (`database.rules.json`) | Cuentas, datos de cada usuario y las órdenes a los puentes. |
| El computador | `servidor.py` y compañía | Opcional: Píxel con el ESP32 (voz), el panel local (`http://<IP>:8080`) y el puente del PC (volumen, música, TV, WhatsApp, Obsidian). |
| La voz | `web/voz.js` (celular) y `tts_supertonic.py` (computador) | Supertonic 3. En el celular se baja de Hugging Face; en el computador va en `voces/supertonic3/`. |
| El ESP32 | `~/Arduino/Pixel_portal/` (fuera de este repositorio) | Micrófono y altavoz, y puente de infrarrojo, relé y encendido por red. |

## Puesta en marcha del computador

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

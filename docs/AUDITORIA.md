# Auditoría del proyecto Píxel (11 nov 2026)

Rama `vinculacion_movil`. Esta auditoría no hace commit: los cambios están en el árbol de trabajo para revisarlos.

## 1. Lo hecho

- **CLAUDE.md reescrito** (de 76 KB a unas 12 KB). Ahora tiene solo lo que una sesión nueva necesita: qué es, comandos, arquitectura en grandes bloques y convenciones. El detalle por fase se movió a `memoria.md` como apéndice "Referencia detallada", y los datos de red y de cuentas se quitaron de ahí.
- **Tabla de funciones** en `docs/FUNCIONES.md`: 11 áreas, con qué hace cada función, su archivo y función, y la ruta HTTP o herramienta de Gemini. Todos los nombres se comprobaron contra el código; 30 estaban mal escritos en el primer borrador y se corrigieron.
- **Pruebas con pytest**: `tests/test_pruebas.py` ejecuta los 3 scripts Python y la prueba de Node que ya existían. Las 4 pasan (ninguna gasta Gemini ni Firebase). Antes, `pytest` no encontraba nada: los archivos se llaman `prueba_*.py`.
- **Linter**: `ruff.toml` con solo `E9` y `F` (errores reales y nombres sin definir o imports sobrantes). Resultado: limpio.
- **Dependencias**: `requirements.txt` y `requirements-dev.txt`, con las versiones que están instaladas.
- **Código del celular (Fase 11): se mantiene.** Lo quité por error en un primer intento, y lo restauré desde git: `nube.py`, `servidor.py`, `panel.py` y `acciones.py` están iguales al último commit.
- **`panel.html`**: lo borré y lo restauré. Sigue en el repo, sin cambios. Ningún archivo Python lo referencia; es tu decisión si lo quitas.

## 2. Hallazgos

### Documentación y datos sensibles
- El `CLAUDE.md` original (en git, repo público) tenía la clave del portal del ESP32, la IP del servidor, la MAC y el uid de la cuenta del ESP32. Ya no están en `CLAUDE.md` ni en el apéndice de `memoria.md`.
- **Pendiente:** `memoria.md` tenía 6 coincidencias de esos mismos datos antes de esta sesión (líneas de la sección de firmware y del panel). No las cambié porque son registro histórico. Si quieres, las sustituyo por "[notas privadas]".
- Si esa clave del portal se publicó, conviene cambiarla en el firmware.
- Como el repo es público, cualquier dato que esté en git ya está expuesto: borrarlo ahora no lo quita del historial.

### Entorno de Python
- `.venv/`: Python 3.10.12 (enlace a `/usr/bin/python3.10`). Los paquetes están bien: faster-whisper 1.2.1, piper-tts 1.8.0, numpy 2.2.6, yt-dlp, androidtvremote2 0.3.3, onnxruntime 1.23.2. Los módulos importan.
- **Instalado hoy en `.venv`:** pytest 9.2.0 y ruff 0.17.4. Son las herramientas de prueba y de lint; no afectan al servidor.
- `venv/`: otra copia del mismo entorno (552 MB), sin uso según `CLAUDE.md`. **No la borré: ¿la quitamos?**
- Espacio: `voces/` 517 MB y `voces_prueba/` 440 MB (modelos de voz, fuera de git); `capturas/` 261 MB. Son datos, no código. Para liberar espacio, `voces_prueba/` (las candidatas que ya no se usan) es el candidato obvio.

### Código
- No encontré funciones de Python sin llamar, ni importaciones sin usar, ni depuración olvidada. El único "código sin uso" es el que el propio proyecto llama así (Fase 11), y se mantiene por decisión tuya.
- **La Fase 11 (celular como micrófono) está a medias:** el servidor y `nube.py` la soportan, pero el cliente de la app que manda las frases se quitó en el commit "Píxel en la app" (y sus reglas). Para reactivarla hay que restaurar el cliente desde `b51e2cb`. ¿Lo hacemos?
- La regla "el correo nunca se envía sin confirmación" se verifica solo en la prueba de `prueba_modulos.js` (lo dice `CLAUDE.md`). No revisé el código de cada herramienta: queda como pendiente.

### Linter
- `ruff check` con reglas por defecto daba 849 avisos, 843 de ellos por líneas largas (E501). El código usa líneas largas a propósito (textos de voz, paneles), así que no los incluí.
- Con `E9` y `F` no hay ningún aviso.

## 3. Qué es el linter, en corto

Un linter lee el código sin ejecutarlo y avisa de problemas. `ruff` hace dos tipos de comprobaciones:
- **Errores reales** (`F`): usar un nombre que no existe, un import que nadie usa, una variable que se pisa. Son los que pueden romper el servidor en un camino que no se ha probado.
- **Estilo** (`E`): sobre todo líneas largas y espacios. Aquí no aportan mucho.

Comando: `.venv/bin/ruff check .` (la configuración está en `ruff.toml`).

## 4. Propuesta de pruebas

### 4a. Sin Gemini ni Firebase (se pueden correr siempre)

Ya existen y pasan:
- `tools/prueba_modulos.js`: 64 pruebas de funciones puras de la web.
- `tools/prueba_obsidian.py`: sincronización con Obsidian, con base falsa.
- `tools/prueba_puente_pc.py`: WhatsApp en el PC, sin enviar nada.
- `tools/prueba_voz.py`: números en palabras, igual en el PC que en la app.

Propuesta nueva, sin cupo de Gemini (la recomiendo):
- **Gemini simulado**: apuntar `gemini.URL` a un servidor local que devuelva respuestas fijas y un 429. Probaría el clasificador, el respaldo a Ollama y las pausas (`PAUSA_S`, `PAUSA_CUPO_S`). No gasta nada.
- **Activación y acciones**: casos reales de `capturas/` (WAV del ESP32) pasados por `quitar_activacion`, `detectar` y `extraer_frases`. Con esto se ve si un cambio rompe la activación de "Píxel".
- **Recordatorios**: `recordatorios.extraer_hora` y `resolver` con frases de ejemplo, incluido "7 pm" (que antes salía como 17).

### 4b. Gastan cupo de Gemini (solo bajo pedido)

- `tools/prueba_app.js` (de punta a punta: cerebro, enfoque, google, aparatos, música). Cuesta unas 35 a 45 peticiones de Gemini y necesita Chrome sin pantalla, `http.server` en 8099 y, para la música, cupo de la YouTube Data API.
- Propuesta: correrlo **una parte por vez**, nunca completo, y no tras otra prueba de Gemini el mismo día.
- La parte de música, si YouTube pide "confirma que no eres un bot", queda marcada como `OMIT` (así lo hace el script).

## 5. Plan de esta sesión (en orden)

1. **Hecho:** auditoría, CLAUDE.md, tabla de funciones, pytest, ruff, requirements.
2. **Tuyo, antes de seguir:**
   - ¿Borro `venv/` (552 MB) y `voces_prueba/` (440 MB)?
   - ¿Quitamos `panel.html`? (Ningún código lo usa.)
   - ¿Restauro el cliente del celular (Fase 11) desde `b51e2cb`?
   - ¿Reemplazo los datos sensibles que quedan en `memoria.md`?
3. **Después:** revisar la regla del correo en el código (no solo en la prueba), y montar el Gemini simulado de 4a.
4. **Al final:** correr `pytest`, `ruff` y el servidor aislado (ver `CLAUDE.md`) para confirmar que nada se rompió, y decidir el commit (no se ha hecho ninguno).

## 6. Cambios en el árbol de trabajo (sin commit)

- Modificados: `CLAUDE.md`, `memoria.md` (apéndice).
- Nuevos: `docs/AUDITORIA.md`, `docs/FUNCIONES.md`, `tests/test_pruebas.py`, `pytest.ini`, `ruff.toml`, `requirements.txt`, `requirements-dev.txt`.
- Sin cambios: el código Python y la web (lo que se tocó y se revirtió quedó igual que en git).

## 7. Nota sobre el servidor en marcha

El servicio `pixel` corre con el código anterior. Como no cambió ningún `.py`, no hace falta reiniciarlo para esta sesión.

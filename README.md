# Pixel

Píxel, asistente de voz para una demo de feria. Un ESP32-S3 con micrófono manda el audio por WiFi a un PC. El PC lo transcribe con faster-whisper, decide qué hacer (una acción o una respuesta de un modelo de lenguaje en Ollama) y contesta con la voz de Piper. La app web de `web/` es el panel en la red local y, publicada en Firebase, enlaza el celular con Píxel desde cualquier lugar.

La arquitectura y los comandos están en `CLAUDE.md`. Las mediciones y las decisiones están en `memoria.md`.

## Puesta en marcha

- Python 3.10 con faster-whisper 1.2.1, piper-tts 1.8.0, numpy y yt-dlp en `.venv/`.
- Ollama en `127.0.0.1:11434` con el modelo `qwen2.5:3b`.
- La voz de Piper `es_ES-sharvard-medium` (`.onnx` y `.onnx.json`) en `voces/`. No está en el repositorio por su tamaño: se descarga de https://huggingface.co/rhasspy/piper-voices, carpeta `es/es_ES/sharvard/medium`.

```bash
.venv/bin/python servidor.py
```

El firmware del ESP32 no está en este repositorio.

Las claves (`nube_token.json`, `google_*.json`), las grabaciones de `capturas/` y los datos de uso (`ajustes.json`, `contactos.json`…) se quedan en el PC: ver `.gitignore`.

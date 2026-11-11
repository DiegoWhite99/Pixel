"""Pruebas automaticas del proyecto: ejecuta los scripts de tools/ que ya existen.

Ninguna llama a Gemini ni a Firebase, ni necesita el servidor ni el ESP32.
    .venv/bin/python -m pytest
Para una sola: .venv/bin/python -m pytest tests/test_pruebas.py -k obsidian
Las pruebas de punta a punta (tools/prueba_app.js) gastan cupo de Gemini: no van aqui.
"""
import os
import shutil
import subprocess
import sys

import pytest

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

PYTHON = ["tools/prueba_obsidian.py", "tools/prueba_puente_pc.py", "tools/prueba_voz.py"]


def _correr(cmd):
    return subprocess.run(cmd, cwd=RAIZ, capture_output=True, text=True, timeout=300)


@pytest.mark.parametrize("script", PYTHON)
def test_python(script):
    r = _correr([sys.executable, script])
    assert r.returncode == 0, r.stdout[-2000:] + r.stderr[-2000:]
    assert "TODO BIEN" in r.stdout


@pytest.mark.skipif(shutil.which("node") is None, reason="hace falta node")
def test_modulos_js():
    r = _correr(["node", "tools/prueba_modulos.js"])
    assert r.returncode == 0, r.stdout[-2000:] + r.stderr[-2000:]
    assert "todo bien" in r.stdout

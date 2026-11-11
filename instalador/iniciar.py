"""Instaladores - punto de entrada: el Python del paquete lo corre con -I (sin variables ni carpetas del usuario).
Linux: /usr/bin/pixel. Windows: el acceso directo (pythonw.exe -I -X utf8 iniciar.py)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pixel_lanzador  # noqa: E402

sys.exit(pixel_lanzador.main())

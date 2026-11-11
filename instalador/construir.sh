#!/usr/bin/env bash
# Instaladores (11 nov) - arma dist/pixel_<version>_amd64.deb (Linux) y dist/Pixel-<version>-Setup.exe (Windows).
#
#   instalador/construir.sh [linux|windows|todo]        (por defecto: todo)
#
# Cada paquete lleva su propio Python 3.10 (python-build-standalone, con su huella comprobada), las dependencias
# exactas de instalador/bloqueo.txt (las del .venv que funciona), la web del panel y el codigo:
#   - Linux: compilado a codigo maquina con Nuitka (un .so por modulo, sin los .py).
#   - Windows: .pyc sin los .py (Nuitka para Windows solo se puede en Windows: instalador/windows/nuitka.yml;
#     con PIXEL_PYD=<carpeta con sus .pyd> el .exe lleva esos en vez de los .pyc).
# No mete claves ni datos del usuario: lo comprueba revisar_secretos() antes de empaquetar.
# Necesita internet, gcc, dpkg-deb y fakeroot. Sin sudo. El icono de Windows necesita node y PUPPETEER
# (puppeteer-core, como las pruebas del navegador); sin ellos, los accesos usan el icono de Python.
# Descargas y herramientas: $PIXEL_CACHE (por defecto ~/.cache/pixel-instalador).
set -euo pipefail

VERSION=2.1.0
RAIZ=$(cd "$(dirname "$0")/.." && pwd)
INST=$RAIZ/instalador
DIST=$RAIZ/dist
CACHE=${PIXEL_CACHE:-$HOME/.cache/pixel-instalador}
OBRA=$CACHE/obra
QUE=${1:-todo}

PBS_URL=https://github.com/astral-sh/python-build-standalone/releases/download/20261009
PBS_LIN=cpython-3.10.22+20261009-x86_64-unknown-linux-gnu-install_only.tar.gz
PBS_LIN_SHA=1780de9ddda04e956d2a4a0ad09b7f5667d92f4f12cd0881ec939de5d542903f
PBS_WIN=cpython-3.10.22+20261009-x86_64-pc-windows-msvc-install_only.tar.gz
PBS_WIN_SHA=cb023e83e42d8937ba77c7cf83641083c3b81e88e1226e1c694a347ae1924d54
NUITKA=nuitka==4.3.5
# Dependencias que solo pide Windows (marcadores sys_platform == "win32" de tqdm y humanfriendly)
SOLO_WINDOWS="colorama==0.4.6 pyreadline3==3.5.6"

aviso() { printf '\n== %s\n' "$*"; }

# bajar <url> <archivo en la cache> <sha256>
bajar() {
  local destino=$CACHE/$2
  if [ ! -f "$destino" ] || [ "$(sha256sum < "$destino" | cut -d' ' -f1)" != "$3" ]; then
    curl -fsSL --retry 3 -o "$destino.parte" "$1"
    mv "$destino.parte" "$destino"
  fi
  [ "$(sha256sum < "$destino" | cut -d' ' -f1)" = "$3" ] || { echo "huella distinta: $2" >&2; exit 1; }
}

# Los modulos del servidor: todos los .py de la raiz del repo (tools/ y tests/ no van)
modulos() { ls "$RAIZ"/*.py; }

# La web del panel, sin la clave de YouTube de este PC (web/claves.js va vacia, como la plantilla)
copiar_web() {
  mkdir -p "$1"
  cp -r "$RAIZ"/web/. "$1"/
  rm -f "$1/claves.js"
  find "$1" -name '.*' -exec rm -rf {} +
  cp "$RAIZ/web/claves.ejemplo.js" "$1/claves.js"
}

# Lo que sobra del Python portatil (en Linux: bin/, include/, share/; en Windows: Scripts\, include\, libs\, tcl\)
recortar_python() {
  local lib=$1
  rm -rf "$lib"/{idlelib,tkinter,turtledemo,ensurepip,lib2to3,test,unittest/test} "$lib"/site-packages/pip "$lib"/site-packages/pip-*.dist-info
  find "$lib" -name '_tkinter*' -delete
}

revisar_secretos() {
  local dir=$1 malo=0
  aviso "revisando que no vayan claves ni datos personales en $(basename "$dir")"
  # la clave de Firebase de servidor.py y web/app.js es publica (la seguridad esta en database.rules.json)
  local publica
  publica=$(grep -o 'AIza[0-9A-Za-z_-]\{35\}' "$RAIZ/servidor.py" | head -1)
  if grep -rIl --exclude-dir=site-packages -e 'AIza[0-9A-Za-z_-]\{35\}' "$dir" | xargs -r grep -ho 'AIza[0-9A-Za-z_-]\{35\}' | sort -u | grep -v "^$publica\$"; then
    echo "  MAL: hay una clave de Google que no es la publica de Firebase"; malo=1
  fi
  for n in nube_token.json google_cliente.json google_token.json gemini_clave.json gemini.json tv_cert.pem tv_clave.pem \
           tv_emparejados.json ajustes.json contactos.json dispositivos.json eventos.json recordatorios.json memoria.md servidor.log; do
    if [ -n "$(find "$dir" -name "$n" -not -path '*/site-packages/*' -print -quit)" ]; then echo "  MAL: va $n"; malo=1; fi
  done
  if [ -n "$(find "$dir" \( -name '*.wav' -o -name 'capturas' \) -not -path '*/site-packages/*' -print -quit)" ]; then echo "  MAL: van grabaciones"; malo=1; fi
  if grep -rIq --exclude-dir=site-packages -e 'client_secret' -e 'refresh_token"\s*:' "$dir"; then echo "  MAL: va un secreto de OAuth"; malo=1; fi
  if ! grep -q 'youtube: ""' "$(find "$dir" -path '*web/claves.js' | head -1)"; then echo "  MAL: web/claves.js no va vacia"; malo=1; fi
  [ $malo = 0 ] && echo "  bien: nada que no deba ir"
  return $malo
}

# ------------------------------------------------------------------ Linux (.deb)
linux() {
  aviso "Linux: Python portatil 3.10 y dependencias"
  bajar "$PBS_URL/${PBS_LIN/+/%2B}" "$PBS_LIN" "$PBS_LIN_SHA"
  local raiz=$OBRA/deb opt
  opt=$raiz/opt/pixel
  rm -rf "$raiz" && mkdir -p "$opt" "$raiz/DEBIAN"
  tar xzf "$CACHE/$PBS_LIN" -C "$opt"
  "$opt/python/bin/python3" -m pip install -q --disable-pip-version-check --no-warn-script-location --no-compile \
    -r "$INST/bloqueo.txt"
  recortar_python "$opt/python/lib/python3.10"
  rm -rf "$opt/python/include" "$opt/python/share" "$opt/python/lib"/{tcl*,tk*,itcl*,thread*,libtcl*,libtk*}
  find "$opt/python/bin" -mindepth 1 -not -name 'python3' -not -name 'python3.10' -not -name 'python' -delete
  # .pyc por adelantado (/opt es de solo lectura); con la ruta final, no la de esta obra
  "$opt/python/bin/python3" -m compileall -q -j 0 -s "$raiz" -p / "$opt/python/lib/python3.10" > /dev/null || true

  aviso "Linux: compilando el codigo con Nuitka"
  local nk=$CACHE/nuitka/python/bin/python3
  if [ ! -x "$nk" ] || ! "$nk" -m nuitka --version > /dev/null 2>&1; then
    rm -rf "$CACHE/nuitka" && mkdir -p "$CACHE/nuitka"
    tar xzf "$CACHE/$PBS_LIN" -C "$CACHE/nuitka"
    "$nk" -m pip install -q --disable-pip-version-check "$NUITKA" ordered-set zstandard
  fi
  local fuente=$OBRA/fuente
  rm -rf "$fuente" && mkdir -p "$fuente" "$opt/app"
  cp $(modulos) "$INST/pixel_lanzador.py" "$fuente"/
  ls "$fuente"/*.py | xargs -P "$(nproc)" -I{} "$nk" -m nuitka --module --nofollow-imports --python-flag=no_docstrings \
    --remove-output --assume-yes-for-downloads --quiet --output-dir="$opt/app" {}
  rm -f "$opt/app"/*.pyi
  [ "$(ls "$opt/app"/*.so | wc -l)" = "$(ls "$fuente"/*.py | wc -l)" ] || { echo "faltan modulos compilados" >&2; exit 1; }
  cp "$INST/iniciar.py" "$opt/app/"
  copiar_web "$opt/app/web"

  install -Dm755 "$INST/linux/pixel" "$raiz/usr/bin/pixel"
  install -Dm644 "$INST/linux/pixel.desktop" "$raiz/usr/share/applications/pixel.desktop"
  install -Dm644 "$RAIZ/web/icono.svg" "$raiz/usr/share/icons/hicolor/scalable/apps/pixel.svg"
  install -Dm644 "$INST/linux/pixel-asistente.service" "$raiz/usr/lib/systemd/user/pixel-asistente.service"
  install -Dm644 "$INST/LEEME.txt" "$opt/LEEME.txt"
  revisar_secretos "$raiz"

  local kb
  kb=$(du -sk --exclude=DEBIAN "$raiz" | cut -f1)
  sed -e "s/@VERSION@/$VERSION/" -e "s/@TAMANO@/$kb/" "$INST/linux/control" > "$raiz/DEBIAN/control"
  (cd "$raiz" && find . -path ./DEBIAN -prune -o -type f -printf '%P\0' | xargs -0 md5sum > DEBIAN/md5sums)
  chmod -R u+rwX,go+rX,go-w "$raiz"
  mkdir -p "$DIST"
  aviso "Linux: empaquetando (xz)"
  fakeroot dpkg-deb -Zxz -z6 --build "$raiz" "$DIST/pixel_${VERSION}_amd64.deb"
}

# ------------------------------------------------------------------ Windows (.exe)
windows() {
  aviso "Windows: Python portatil 3.10 y ruedas de Windows"
  bajar "$PBS_URL/${PBS_LIN/+/%2B}" "$PBS_LIN" "$PBS_LIN_SHA"      # el de Linux compila los .pyc
  bajar "$PBS_URL/${PBS_WIN/+/%2B}" "$PBS_WIN" "$PBS_WIN_SHA"
  local herr=$CACHE/py-lin/python/bin/python3
  [ -x "$herr" ] || { mkdir -p "$CACHE/py-lin" && tar xzf "$CACHE/$PBS_LIN" -C "$CACHE/py-lin"; }
  local org=$OBRA/win
  rm -rf "$org" && mkdir -p "$org"
  tar xzf "$CACHE/$PBS_WIN" -C "$org"
  local sp=$org/python/Lib/site-packages
  # --platform: pip baja y desempaqueta las ruedas de Windows (cp310, win_amd64) sin ejecutar nada
  "$herr" -m pip install -q --disable-pip-version-check --no-warn-script-location --no-compile --no-deps \
    --only-binary=:all: --platform win_amd64 --python-version 3.10 --implementation cp --abi cp310 \
    --target "$sp" -r "$INST/bloqueo.txt" $SOLO_WINDOWS
  rm -rf "$sp/bin"
  recortar_python "$org/python/Lib"
  rm -rf "$org/python"/{include,libs,tcl,Scripts}
  find "$org/python" -name '*.pdb' -delete           # simbolos de depuracion: no hacen falta para correr
  find "$org/python/DLLs" \( -name 'tcl*' -o -name 'tk*' \) -delete

  mkdir -p "$org/app"
  if [ -n "${PIXEL_PYD:-}" ]; then
    aviso "Windows: el codigo compilado con Nuitka en GitHub (.pyd de $PIXEL_PYD)"
    cp "$PIXEL_PYD"/*.pyd "$org/app"/
    [ "$(ls "$org/app"/*.pyd | wc -l)" = "$(( $(modulos | wc -l) + 1 ))" ] || { echo "faltan .pyd en $PIXEL_PYD" >&2; exit 1; }
  else
    aviso "Windows: el codigo como .pyc (Python 3.10, sin los .py)"
    cp $(modulos) "$INST/pixel_lanzador.py" "$org/app"/
    "$herr" -m compileall -q -b -o 2 -s "$org" -p 'C:\Pixel' "$org/app" > /dev/null
    rm -f "$org/app"/*.py
  fi
  cp "$INST/iniciar.py" "$org/app/"
  copiar_web "$org/app/web"
  sed 's/$/\r/' "$INST/LEEME.txt" > "$org/LEEME.txt"
  revisar_secretos "$org"

  aviso "Windows: makensis"
  local nsis=$CACHE/nsis
  if [ ! -x "$nsis/raiz/usr/bin/makensis" ]; then
    mkdir -p "$nsis" && (cd "$nsis" && apt download nsis nsis-common > /dev/null && for d in *.deb; do dpkg -x "$d" raiz; done)
  fi
  local icono=()
  if [ -n "${PUPPETEER:-}" ] && command -v node > /dev/null; then
    node "$INST/icono.js" "$RAIZ/web/icono.svg" "$OBRA/pixel.ico" && icono=(-DICONO="$OBRA/pixel.ico")
  fi
  mkdir -p "$DIST"
  NSISDIR=$nsis/raiz/usr/share/nsis "$nsis/raiz/usr/bin/makensis" -V2 -DVERSION=$VERSION -DORIGEN="$org" \
    -DSALIDA="$DIST/Pixel-$VERSION-Setup.exe" "${icono[@]}" "$INST/windows/pixel.nsi"
}

# Todo en un solo bloque: bash lo lee entero antes de empezar, asi editar este archivo mientras corre no lo rompe
{
  mkdir -p "$CACHE"
  case $QUE in
    linux) linux ;;
    windows) windows ;;
    todo) linux; windows ;;
    *) echo "uso: $0 [linux|windows|todo]" >&2; exit 2 ;;
  esac
  aviso "huellas"
  (cd "$DIST" && sha256sum pixel_*_amd64.deb Pixel-*-Setup.exe 2>/dev/null > SHA256SUMS; cat SHA256SUMS)
  ls -la "$DIST"
  exit 0
}

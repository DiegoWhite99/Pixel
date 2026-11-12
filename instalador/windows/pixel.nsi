; Instaladores (11 nov) - Pixel para Windows: instala por usuario (sin permisos de administrador) en
; %LOCALAPPDATA%\Pixel el Python 3.10 del paquete, las dependencias, el codigo (.pyc) y la web del panel.
; Lo arma instalador/construir.sh con el makensis de Linux:
;   makensis -DVERSION=2.2.0 -DORIGEN=<carpeta armada> -DSALIDA=<Setup.exe> -DICONO=<pixel.ico>
;            -DBIENVENIDA=<164x314.bmp> -DCABECERA=<150x57.bmp> pixel.nsi
; Los datos del usuario (ajustes, claves que pegue en el panel, voces, Whisper) van en %LOCALAPPDATA%\Pixel\datos.
; 2.2.0 (12 nov, pedido: "mejorar el instalador, generar un icono", "todo azul"): icono propio, paginas de
; bienvenida y cabecera en azul con Pixel (instalador/imagenes/), y Pixel se abre en su ventana, no en el navegador.

Unicode true
SetCompressor /SOLID lzma
SetCompressorDictSize 64
RequestExecutionLevel user
ManifestDPIAware true

!include "MUI2.nsh"

!define NOMBRE "Píxel"
!define EDITOR "Divergency IA"
!define CLAVE_DESINSTALAR "Software\Microsoft\Windows\CurrentVersion\Uninstall\Pixel"
!define PYW '"$INSTDIR\python\pythonw.exe"'
!define ARGS '-I -X utf8 "$INSTDIR\app\iniciar.py"'

Name "${NOMBRE} ${VERSION}"
OutFile "${SALIDA}"
InstallDir "$LOCALAPPDATA\Pixel"
InstallDirRegKey HKCU "${CLAVE_DESINSTALAR}" "InstallLocation"
BrandingText "${NOMBRE} · ${EDITOR}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=0 "ProductName" "${NOMBRE}"
VIAddVersionKey /LANG=0 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=0 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=0 "CompanyName" "${EDITOR}"
VIAddVersionKey /LANG=0 "FileDescription" "Instalador de ${NOMBRE}, asistente de voz"
VIAddVersionKey /LANG=0 "LegalCopyright" "${EDITOR}"

!define MUI_ICON "${ICONO}"
!define MUI_UNICON "${ICONO}"
; azul como la ventana de Pixel: fondo de la bienvenida, el final y la cabecera, y su texto
!define MUI_BGCOLOR "071533"
!define MUI_TEXTCOLOR "FFFFFF"
!define MUI_WELCOMEFINISHPAGE_BITMAP "${BIENVENIDA}"
; sin esto, la casilla «Abrir Pixel ahora» sale con letra negra sobre el azul (con los temas de Windows,
; SetCtlColors no cambia el color del texto de una casilla: fallo #443 de NSIS; MUI2 solo lo arregla en alto contraste)
!define MUI_FORCECLASSICCONTROLS
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT
!define MUI_HEADERIMAGE_BITMAP "${CABECERA}"
!define MUI_HEADERIMAGE_UNBITMAP "${CABECERA}"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Hola, soy ${NOMBRE}"
!define MUI_WELCOMEPAGE_TEXT "Un agente creado por ${EDITOR}.$\r$\n$\r$\nEsto instala mi programa en este computador: oigo al robot por la red, pienso con la inteligencia artificial que elijas y le devuelvo la voz.$\r$\n$\r$\nNo hace falta ser administrador. La primera vez que me abras bajaré mi voz y mi oído (unos 600 MB), así que necesitas internet.$\r$\n$\r$\nAl final se abre mi panel de control para vincularme con tu cuenta y guardar tus APIs."
!define MUI_FINISHPAGE_TITLE "${NOMBRE} está instalado"
!define MUI_FINISHPAGE_TEXT "Lo encuentras en el menú de inicio y en el escritorio.$\r$\n$\r$\nSi cierras su ventana, ${NOMBRE} sigue escuchando al robot. Para apagarlo del todo, usa «Apagar Píxel» en su panel."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Abrir ${NOMBRE} ahora"
!define MUI_FINISHPAGE_RUN_FUNCTION AbrirPixel
!define MUI_FINISHPAGE_LINK "Abrir la app de Píxel en internet"
!define MUI_FINISHPAGE_LINK_LOCATION "https://pixelassitance.web.app"
!define MUI_FINISHPAGE_LINK_COLOR "7DD3FC"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Spanish"

; Cierra Pixel si esta abierto (una actualizacion o la desinstalacion necesitan sus archivos libres) y ESPERA a
; que suelte sus archivos. Ojo (prueba de GitHub, 11 nov): este instalador es de 32 bits, asi que "powershell"
; es el de 32 bits, y ahi Get-Process no ve la ruta (.Path) de un proceso de 64 bits: el filtro no encontraba a
; Pixel, no lo cerraba y la desinstalacion dejaba la carpeta python. Win32_Process (CIM) da ExecutablePath
; desde 32 o 64 bits. Ver tambien BORRAR_CARPETA.
!macro CERRAR_PIXEL
  nsExec::Exec `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$d = '$INSTDIR\python\*'; $$p = @(Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -like $$d }); foreach ($$x in $$p) { Stop-Process -Id $$x.ProcessId -Force -ErrorAction SilentlyContinue }; foreach ($$x in $$p) { Wait-Process -Id $$x.ProcessId -Timeout 20 -ErrorAction SilentlyContinue }"`
  Pop $0
  Sleep 1000
!macroend

; RMDir /r con dos reintentos: un archivo que Windows aun no suelta (el antivirus, un proceso que acaba de
; cerrarse) no debe dejar el programa a medio borrar
!macro BORRAR_CARPETA CARPETA
  RMDir /r "${CARPETA}"
  IfFileExists "${CARPETA}\*.*" 0 +5
    Sleep 2000
    RMDir /r "${CARPETA}"
    IfFileExists "${CARPETA}\*.*" 0 +2
      Sleep 4000
  RMDir /r "${CARPETA}"
!macroend

Function AbrirPixel
  Exec '${PYW} ${ARGS}'
FunctionEnd

Section "${NOMBRE} (necesario)" SecPixel
  SectionIn RO
  !insertmacro CERRAR_PIXEL
  !insertmacro BORRAR_CARPETA "$INSTDIR\python"
  !insertmacro BORRAR_CARPETA "$INSTDIR\app"
  SetOutPath "$INSTDIR"
  File /r "${ORIGEN}\python"
  File /r "${ORIGEN}\app"
  File "${ORIGEN}\LEEME.txt"
  File "/oname=pixel.ico" "${ICONO}"
  CreateDirectory "$INSTDIR\datos"
  WriteUninstaller "$INSTDIR\Desinstalar.exe"
  CreateDirectory "$SMPROGRAMS\${NOMBRE}"
  CreateShortcut "$SMPROGRAMS\${NOMBRE}\${NOMBRE}.lnk" ${PYW} '${ARGS}' "$INSTDIR\pixel.ico" 0 SW_SHOWNORMAL "" "Abre el panel de control de Píxel"
  CreateShortcut "$SMPROGRAMS\${NOMBRE}\Desinstalar ${NOMBRE}.lnk" "$INSTDIR\Desinstalar.exe"
  WriteRegStr HKCU "${CLAVE_DESINSTALAR}" "DisplayName" "${NOMBRE}"
  WriteRegStr HKCU "${CLAVE_DESINSTALAR}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${CLAVE_DESINSTALAR}" "Publisher" "${EDITOR}"
  WriteRegStr HKCU "${CLAVE_DESINSTALAR}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${CLAVE_DESINSTALAR}" "DisplayIcon" "$INSTDIR\pixel.ico"
  WriteRegStr HKCU "${CLAVE_DESINSTALAR}" "UninstallString" '"$INSTDIR\Desinstalar.exe"'
  WriteRegDWORD HKCU "${CLAVE_DESINSTALAR}" "NoModify" 1
  WriteRegDWORD HKCU "${CLAVE_DESINSTALAR}" "NoRepair" 1
SectionEnd

Section "Acceso en el escritorio" SecEscritorio
  CreateShortcut "$DESKTOP\${NOMBRE}.lnk" ${PYW} '${ARGS}' "$INSTDIR\pixel.ico" 0 SW_SHOWNORMAL "" "Abre el panel de control de Píxel"
SectionEnd

Section "Arrancar Píxel al iniciar Windows" SecInicio
  CreateShortcut "$SMSTARTUP\${NOMBRE}.lnk" ${PYW} '${ARGS} --sin-navegador' "$INSTDIR\pixel.ico" 0 SW_SHOWMINIMIZED "" "Píxel en segundo plano"
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecPixel} "El programa y su panel de control."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecEscritorio} "Un acceso directo a Píxel en el escritorio."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecInicio} "Píxel queda escuchando al robot desde que enciendes el computador, sin abrir su ventana."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Section "Uninstall"
  !insertmacro CERRAR_PIXEL
  Delete "$SMPROGRAMS\${NOMBRE}\${NOMBRE}.lnk"
  Delete "$SMPROGRAMS\${NOMBRE}\Desinstalar ${NOMBRE}.lnk"
  RMDir "$SMPROGRAMS\${NOMBRE}"
  Delete "$DESKTOP\${NOMBRE}.lnk"
  Delete "$SMSTARTUP\${NOMBRE}.lnk"
  !insertmacro BORRAR_CARPETA "$INSTDIR\python"
  !insertmacro BORRAR_CARPETA "$INSTDIR\app"
  Delete "$INSTDIR\pixel.ico"
  Delete "$INSTDIR\LEEME.txt"
  Delete "$INSTDIR\Desinstalar.exe"
  DeleteRegKey HKCU "${CLAVE_DESINSTALAR}"
  MessageBox MB_YESNO|MB_ICONQUESTION "¿Borrar también tus datos de Píxel?$\r$\n$\r$\nSon tus ajustes, la vinculación con tu cuenta, las claves que pegaste y la voz y el oído bajados (unos 600 MB). Si piensas volver a instalarlo, mejor no." /SD IDNO IDNO fin
    RMDir /r "$INSTDIR\datos"
  fin:
  RMDir "$INSTDIR"
SectionEnd

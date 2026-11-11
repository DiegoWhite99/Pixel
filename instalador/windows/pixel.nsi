; Instaladores (11 nov) - Pixel para Windows: instala por usuario (sin permisos de administrador) en
; %LOCALAPPDATA%\Pixel el Python 3.10 del paquete, las dependencias, el codigo (.pyc) y la web del panel.
; Lo arma instalador/construir.sh con el makensis de Linux:
;   makensis -DVERSION=2.1.0 -DORIGEN=<carpeta armada> -DSALIDA=<Setup.exe> [-DICONO=<pixel.ico>] pixel.nsi
; Los datos del usuario (ajustes, claves que pegue en el panel, voces, Whisper) van en %LOCALAPPDATA%\Pixel\datos.

Unicode true
SetCompressor /SOLID lzma
SetCompressorDictSize 64
RequestExecutionLevel user
ManifestDPIAware true

!include "MUI2.nsh"

!define NOMBRE "Píxel"
!define EDITOR "Divergencia IA"
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

!ifdef ICONO
  !define MUI_ICON "${ICONO}"
  !define MUI_UNICON "${ICONO}"
!endif
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Instalar ${NOMBRE}"
!define MUI_WELCOMEPAGE_TEXT "Esto instala el programa del computador de ${NOMBRE}: oye al robot por la red, piensa con la IA y le devuelve la voz.$\r$\n$\r$\nNo hace falta ser administrador. La primera vez que lo abras bajará la voz y el oído de Píxel (unos 600 MB), así que necesitas internet.$\r$\n$\r$\nAl final se abre su panel en el navegador para vincularlo con tu cuenta."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Abrir ${NOMBRE} ahora"
!define MUI_FINISHPAGE_RUN_FUNCTION AbrirPixel

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Spanish"

; Cierra Pixel si esta abierto (una actualizacion o la desinstalacion necesitan sus archivos libres)
!macro CERRAR_PIXEL
  nsExec::Exec `powershell -NoProfile -NonInteractive -Command "Get-Process python,pythonw -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like '$INSTDIR\python\*' } | Stop-Process -Force"`
  Pop $0
!macroend

Function AbrirPixel
  Exec '${PYW} ${ARGS}'
FunctionEnd

Section "${NOMBRE} (necesario)" SecPixel
  SectionIn RO
  !insertmacro CERRAR_PIXEL
  RMDir /r "$INSTDIR\python"
  RMDir /r "$INSTDIR\app"
  SetOutPath "$INSTDIR"
  File /r "${ORIGEN}\python"
  File /r "${ORIGEN}\app"
  File "${ORIGEN}\LEEME.txt"
  !ifdef ICONO
    File "/oname=pixel.ico" "${ICONO}"
  !endif
  CreateDirectory "$INSTDIR\datos"
  WriteUninstaller "$INSTDIR\Desinstalar.exe"
  CreateDirectory "$SMPROGRAMS\${NOMBRE}"
  CreateShortcut "$SMPROGRAMS\${NOMBRE}\${NOMBRE}.lnk" ${PYW} '${ARGS}' "$INSTDIR\pixel.ico" 0 SW_SHOWNORMAL "" "Arranca Píxel y abre su panel"
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
  CreateShortcut "$DESKTOP\${NOMBRE}.lnk" ${PYW} '${ARGS}' "$INSTDIR\pixel.ico" 0 SW_SHOWNORMAL "" "Arranca Píxel y abre su panel"
SectionEnd

Section "Arrancar Píxel al iniciar Windows" SecInicio
  CreateShortcut "$SMSTARTUP\${NOMBRE}.lnk" ${PYW} '${ARGS} --sin-navegador' "$INSTDIR\pixel.ico" 0 SW_SHOWMINIMIZED "" "Píxel en segundo plano"
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecPixel} "El programa y su panel."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecEscritorio} "Un acceso directo a Píxel en el escritorio."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecInicio} "Píxel queda escuchando al robot desde que enciendes el computador, sin abrir el navegador."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Section "Uninstall"
  !insertmacro CERRAR_PIXEL
  Delete "$SMPROGRAMS\${NOMBRE}\${NOMBRE}.lnk"
  Delete "$SMPROGRAMS\${NOMBRE}\Desinstalar ${NOMBRE}.lnk"
  RMDir "$SMPROGRAMS\${NOMBRE}"
  Delete "$DESKTOP\${NOMBRE}.lnk"
  Delete "$SMSTARTUP\${NOMBRE}.lnk"
  RMDir /r "$INSTDIR\python"
  RMDir /r "$INSTDIR\app"
  Delete "$INSTDIR\pixel.ico"
  Delete "$INSTDIR\LEEME.txt"
  Delete "$INSTDIR\Desinstalar.exe"
  DeleteRegKey HKCU "${CLAVE_DESINSTALAR}"
  MessageBox MB_YESNO|MB_ICONQUESTION "¿Borrar también tus datos de Píxel?$\r$\n$\r$\nSon tus ajustes, la vinculación con tu cuenta, las claves que pegaste y la voz y el oído bajados (unos 600 MB). Si piensas volver a instalarlo, mejor no." /SD IDNO IDNO fin
    RMDir /r "$INSTDIR\datos"
  fin:
  RMDir "$INSTDIR"
SectionEnd

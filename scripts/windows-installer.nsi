; Instalador do Windows (4.8.4). Gerado pelo scripts/build-all.sh com o makensis:
;   makensis -DVERSION=4.8.4 -DSRC=<pasta win> -DICON=<icon.ico> -DOUT=<setup.exe> windows-installer.nsi
;
; Instala por usuário (sem administrador) em %LOCALAPPDATA%\Programs\Agzos Browser, para o
; OTA continuar copiando a versão nova por cima da pasta sem pedir permissão. Cria os
; atalhos (Área de trabalho e menu Iniciar) e a entrada em "Programas e Recursos".
; Nunca toca no perfil (%APPDATA%\Agzos Browser: login, cache, abas) nem em cópias
; portáteis em outras pastas. O desinstalador também não apaga o perfil.

Unicode true
SetCompressor /SOLID lzma
RequestExecutionLevel user

!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"

!define APP_NAME "Agzos Browser"
!define APP_EXE "AgzosBrowser.exe"
!define UNINSTALLER "Desinstalar Agzos Browser.exe"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgzosBrowser"

Name "${APP_NAME}"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\Programs\${APP_NAME}"
BrandingText "${APP_NAME} ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APP_NAME}"
VIAddVersionKey "CompanyName" "Agzos"
VIAddVersionKey "FileDescription" "Instalador do ${APP_NAME}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "Agzos"

!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Abrir o ${APP_NAME}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "PortugueseBR"

; Arquivos do programa em uso não podem ser trocados: pede para fechar o navegador.
!macro WAIT_CLOSED
  ${Do}
    nsExec::ExecToStack '"$SYSDIR\cmd.exe" /c tasklist /FI "IMAGENAME eq ${APP_EXE}" /NH | "$SYSDIR\find.exe" /I "${APP_EXE}"'
    Pop $0
    Pop $1
    ${If} $0 != 0
      ${Break}
    ${EndIf}
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Feche o ${APP_NAME} (todas as janelas e apps instalados) e clique em Repetir." IDRETRY +2
    Abort
  ${Loop}
!macroend

Function .onInit
  !insertmacro WAIT_CLOSED
FunctionEnd

Section "Agzos Browser" SecMain
  SectionIn RO
  SetOutPath "$INSTDIR"
  File /r "${SRC}\*.*"
  WriteUninstaller "$INSTDIR\${UNINSTALLER}"

  CreateShortcut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0
  CreateShortcut "$SMPROGRAMS\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0

  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "Agzos"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "URLInfoAbout" "https://agzosagency.com.br/browser/"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" '"$INSTDIR\${APP_EXE}",0'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\${UNINSTALLER}"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\${UNINSTALLER}" /S'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" "$0"
SectionEnd

Function un.onInit
  !insertmacro WAIT_CLOSED
FunctionEnd

Section "Uninstall"
  Delete "$DESKTOP\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}.lnk"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  ; Só a pasta do programa (fixa, sem página de escolha). O perfil em %APPDATA% fica.
  ${If} ${FileExists} "$INSTDIR\${APP_EXE}"
    RMDir /r "$INSTDIR"
  ${EndIf}
SectionEnd

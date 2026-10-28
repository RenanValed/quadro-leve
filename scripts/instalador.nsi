; Instalador do Quadro Leve (gerado no Mac com makensis)
; Checa e instala o WebView2 Runtime, copia o app, cria atalhos e desinstalador.
Unicode true
!include "MUI2.nsh"
!include "x64.nsh"
!include "WinVer.nsh"
!include "LogicLib.nsh"

!ifndef SRC
  !define SRC "..\dist\QuadroLeve-windows"
!endif
!define APPNAME "Quadro Leve"
!ifndef APPVER
  !define APPVER "0.0.0"
!endif
!define PUBLISHER "ciarevit"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\QuadroLeve"
!define WV2KEY "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
!define WV2KEYUSER "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
!define WV2URL "https://go.microsoft.com/fwlink/p/?LinkId=2124703"

Name "${APPNAME}"
OutFile "..\dist\Instalar-QuadroLeve-${APPVER}.exe"
InstallDir "$PROGRAMFILES64\${APPNAME}"
InstallDirRegKey HKLM "${UNINSTKEY}" "InstallLocation"
RequestExecutionLevel admin
SetCompressor /SOLID lzma
BrandingText "${APPNAME} ${APPVER}"
VIProductVersion "${APPVER}.0"
VIFileVersion "${APPVER}.0"
VIAddVersionKey /LANG=1046 "ProductName" "${APPNAME}"
VIAddVersionKey /LANG=1046 "CompanyName" "${PUBLISHER}"
VIAddVersionKey /LANG=1046 "FileDescription" "Instalador do ${APPNAME} (quadro branco local, sem internet)"
VIAddVersionKey /LANG=1046 "FileVersion" "${APPVER}"
VIAddVersionKey /LANG=1046 "ProductVersion" "${APPVER}"
VIAddVersionKey /LANG=1046 "LegalCopyright" "${PUBLISHER}"
VIAddVersionKey /LANG=1046 "Comments" "Codigo aberto em HTML/JS; nao coleta dados; so grava em Documentos\${APPNAME}."

!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Instalar o ${APPNAME}"
!define MUI_WELCOMEPAGE_TEXT "Este assistente instala o ${APPNAME} no seu computador.$\r$\n$\r$\nEle confere se o Windows tem o que o programa precisa (o WebView2 da Microsoft) e instala sozinho o que faltar.$\r$\n$\r$\nClique em Avançar para continuar."
!define MUI_FINISHPAGE_RUN "$INSTDIR\QuadroLeve.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Abrir o ${APPNAME} agora"
!define MUI_FINISHPAGE_SHOWREADME "$INSTDIR\LEIA-ME.txt"
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Ler o guia rápido (caneta, atalhos, onde ficam os projetos)"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "PortugueseBR"

Var WV2OK

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "O ${APPNAME} precisa de um Windows de 64 bits."
    Abort
  ${EndIf}
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_ICONSTOP "O ${APPNAME} precisa do Windows 10 ou mais novo."
    Abort
  ${EndIf}
  ; Atualização por cima: o app não pode estar aberto (arquivo em uso).
  FindWindow $0 "" "${APPNAME}"
  ${If} $0 != 0
    MessageBox MB_ICONEXCLAMATION|MB_RETRYCANCEL "O ${APPNAME} está aberto. Feche o programa (seus quadros já estão salvos em Documentos) e clique em Repetir." IDRETRY retry_check
    Abort
    retry_check:
    FindWindow $0 "" "${APPNAME}"
    ${If} $0 != 0
      MessageBox MB_ICONSTOP "O ${APPNAME} ainda está aberto. Feche e rode o instalador de novo."
      Abort
    ${EndIf}
  ${EndIf}
  ; Instala por cima da versão anterior, na mesma pasta.
  SetRegView 64
  ReadRegStr $0 HKLM "${UNINSTKEY}" "DisplayVersion"
  ${If} $0 != ""
    DetailPrint "Versão anterior encontrada: $0. Será atualizada para ${APPVER}."
  ${EndIf}
FunctionEnd

Function CheckWebView2
  StrCpy $WV2OK "0"
  SetRegView 64
  ReadRegStr $0 HKLM "${WV2KEY}" "pv"
  ${If} $0 != ""
  ${AndIf} $0 != "0.0.0.0"
    StrCpy $WV2OK "1"
  ${Else}
    ReadRegStr $0 HKCU "${WV2KEYUSER}" "pv"
    ${If} $0 != ""
    ${AndIf} $0 != "0.0.0.0"
      StrCpy $WV2OK "1"
    ${EndIf}
  ${EndIf}
FunctionEnd

Section "Verificar e instalar o WebView2" SEC_WV2
  SectionIn RO
  DetailPrint "Conferindo o WebView2 Runtime da Microsoft..."
  Call CheckWebView2
  ${If} $WV2OK == "1"
    DetailPrint "WebView2 já instalado (versão $0). Nada a fazer."
    Goto wv2_done
  ${EndIf}
  DetailPrint "WebView2 não encontrado. Baixando o instalador oficial da Microsoft (2 MB)..."
  nsExec::ExecToLog '"$SYSDIR\curl.exe" -L -sS --retry 2 -o "$TEMP\MicrosoftEdgeWebview2Setup.exe" "${WV2URL}"'
  Pop $1
  ${If} $1 != 0
  ${OrIfNot} ${FileExists} "$TEMP\MicrosoftEdgeWebview2Setup.exe"
    MessageBox MB_ICONEXCLAMATION|MB_OK "Não foi possível baixar o WebView2 (sem internet?).$\r$\n$\r$\nA instalação continua, mas o programa só vai abrir depois que você instalar o WebView2 pelo site da Microsoft:$\r$\n${WV2URL}"
    Goto wv2_done
  ${EndIf}
  DetailPrint "Instalando o WebView2 (pode levar 1 a 3 minutos, aguarde)..."
  ExecWait '"$TEMP\MicrosoftEdgeWebview2Setup.exe" /silent /install' $1
  Delete "$TEMP\MicrosoftEdgeWebview2Setup.exe"
  Call CheckWebView2
  ${If} $WV2OK == "1"
    DetailPrint "WebView2 instalado com sucesso."
  ${Else}
    MessageBox MB_ICONEXCLAMATION|MB_OK "O instalador do WebView2 terminou com código $1 e o runtime não foi encontrado.$\r$\nSe o programa abrir em branco, instale pelo site da Microsoft:$\r$\n${WV2URL}"
  ${EndIf}
wv2_done:
SectionEnd

Section "Instalar o ${APPNAME}" SEC_APP
  SectionIn RO
  SetOutPath "$INSTDIR"
  File "${SRC}\QuadroLeve.exe"
  File "${SRC}\resources.neu"
  File "${SRC}\LEIA-ME.txt"
  File "${SRC}\SEGURANCA.txt"
  File "${SRC}\quadro.ico"
  WriteUninstaller "$INSTDIR\Desinstalar.exe"

  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\QuadroLeve.exe"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\Desinstalar.lnk" "$INSTDIR\Desinstalar.exe"
  CreateShortcut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\QuadroLeve.exe"

  CreateDirectory "$DOCUMENTS\${APPNAME}"

  SetRegView 64
  WriteRegStr HKLM "${UNINSTKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKLM "${UNINSTKEY}" "DisplayVersion" "${APPVER}"
  WriteRegStr HKLM "${UNINSTKEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKLM "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\QuadroLeve.exe"
  WriteRegStr HKLM "${UNINSTKEY}" "UninstallString" '"$INSTDIR\Desinstalar.exe"'
  WriteRegDWORD HKLM "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINSTKEY}" "NoRepair" 1

  ; Associa .quadro ao programa (duplo clique abre o projeto). O Windows só lê a última extensão,
  ; por isso .board.json nunca funcionaria: seria tratado como .json.
  WriteRegStr HKCR ".quadro" "" "QuadroLeve.Board"
  WriteRegStr HKCR ".quadro" "Content Type" "application/json"
  WriteRegStr HKCR "QuadroLeve.Board" "" "Quadro do ${APPNAME}"
  WriteRegStr HKCR "QuadroLeve.Board\DefaultIcon" "" "$INSTDIR\quadro.ico"
  WriteRegStr HKCR "QuadroLeve.Board\shell\open" "" "Abrir no ${APPNAME}"
  WriteRegStr HKCR "QuadroLeve.Board\shell\open\command" "" '"$INSTDIR\QuadroLeve.exe" "%1"'
  DeleteRegKey HKCR ".board.json"
  ; Avisa o Explorer que as associações mudaram
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
SectionEnd

Section "Uninstall"
  Delete "$INSTDIR\QuadroLeve.exe"
  Delete "$INSTDIR\resources.neu"
  Delete "$INSTDIR\LEIA-ME.txt"
  Delete "$INSTDIR\SEGURANCA.txt"
  Delete "$INSTDIR\quadro.ico"
  Delete "$INSTDIR\Desinstalar.exe"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk"
  Delete "$SMPROGRAMS\${APPNAME}\Desinstalar.lnk"
  RMDir "$SMPROGRAMS\${APPNAME}"
  Delete "$DESKTOP\${APPNAME}.lnk"
  SetRegView 64
  DeleteRegKey HKLM "${UNINSTKEY}"
  DeleteRegKey HKCR ".quadro"
  DeleteRegKey HKCR "QuadroLeve.Board"
  ; Os projetos em Documentos\Quadro Leve ficam no PC de propósito.
SectionEnd

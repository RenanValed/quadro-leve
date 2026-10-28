#!/usr/bin/env bash
# Gera o pacote do Quadro Leve para Windows a partir do Mac.
# Uso: bash scripts/empacotar.sh
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf dist
VER=$(python3 -c "import json;print(json.load(open('neutralino.config.json'))['version'])")
echo "Versão: $VER"
npx -y @neutralinojs/neu build
OUT=dist/QuadroLeve
test -f "$OUT/QuadroLeve-win_x64.exe" || { echo "ERRO: faltou o .exe"; exit 1; }
test -f "$OUT/resources.neu" || { echo "ERRO: faltou o resources.neu"; exit 1; }
# Confere que o HTML e o JS entraram no resources.neu
for f in resources/index.html resources/js/neutralino.js; do
  grep -q -F "$(basename "$f")" "$OUT/resources.neu" || { echo "ERRO: $f não está no resources.neu"; exit 1; }
done
PK=dist/QuadroLeve-windows
rm -rf "$PK"; mkdir -p "$PK"
cp "$OUT/QuadroLeve-win_x64.exe" "$PK/QuadroLeve.exe"
cp "$OUT/resources.neu" "$PK/"
cp LEIA-ME.md "$PK/LEIA-ME.txt" 2>/dev/null || true
cp SEGURANCA.md "$PK/SEGURANCA.txt" 2>/dev/null || true
cp scripts/quadro.ico "$PK/"
cat > "$PK/instalar-webview2.cmd" <<'CMD'
@echo off
rem O Quadro Leve usa o WebView2 do Windows. No Windows 11 ele ja vem instalado.
rem Se o programa abrir uma janela em branco ou nao abrir, rode este arquivo uma vez.
reg query "HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" /v pv >nul 2>&1 && (
  echo WebView2 ja esta instalado. Pode abrir o QuadroLeve.exe.
  pause
  exit /b 0
)
echo Baixando o instalador oficial da Microsoft (2 MB)...
curl.exe -L -sS -o "%TEMP%\MicrosoftEdgeWebview2Setup.exe" "https://go.microsoft.com/fwlink/p/?LinkId=2124703"
"%TEMP%\MicrosoftEdgeWebview2Setup.exe" /install
echo Pronto. Agora abra o QuadroLeve.exe.
pause
CMD
( cd dist && rm -f QuadroLeve-windows.zip && zip -qr QuadroLeve-windows.zip QuadroLeve-windows -x '*.DS_Store' -x '*/._*' -x '._*' )
# Instalador (NSIS). Usa o makensis corrigido para Apple Silicon (ver scripts/bin/LEIA-ME-makensis.md).
MK=scripts/bin/makensis-mac-arm64
if [ -x "$MK" ] && [ -d /opt/homebrew/share/nsis ]; then
  ( cd scripts && NSISDIR=/opt/homebrew/share/nsis NSISCONFDIR=/opt/homebrew/etc ../$MK -V2 -DAPPVER=$VER instalador.nsi )
else
  echo "AVISO: makensis indisponível; só o zip portátil foi gerado."
fi
( cd dist && shasum -a 256 Instalar-QuadroLeve-*.exe QuadroLeve-windows.zip QuadroLeve-windows/QuadroLeve.exe QuadroLeve-windows/resources.neu > SHA256SUMS.txt && cat SHA256SUMS.txt )
ls -la dist/QuadroLeve-windows dist/QuadroLeve-windows.zip dist/Instalar-QuadroLeve-*.exe 2>/dev/null
echo "Pacote pronto em dist/: zip portátil + Instalar-QuadroLeve-*.exe"

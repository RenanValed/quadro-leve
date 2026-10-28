#!/usr/bin/env bash
# Publica o pacote da pasta dist/ como Release no GitHub (link de download que Gmail e Drive não bloqueiam).
# Uso: bash scripts/publicar-release.sh [owner/repo]   (padrão: RenanValed/quadro-leve)
# Precisa: gh logado; dist/ gerado por scripts/empacotar.sh. Cria o repositório se não existir.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="${1:-RenanValed/quadro-leve}"
VER=$(python3 -c "import json;print(json.load(open('neutralino.config.json'))['version'])")
test -f "dist/Instalar-QuadroLeve-$VER.exe" || { echo "Rode scripts/empacotar.sh antes"; exit 1; }
if ! gh repo view "$REPO" >/dev/null 2>&1; then
  gh repo create "$REPO" --public --description "Quadro Leve: quadro branco local para Windows, leve e sem internet" --confirm
fi
NOTES="Quadro Leve $VER. Instale com Instalar-QuadroLeve-$VER.exe (ou use o zip portátil). Confira o hash em SHA256SUMS.txt. Leia SEGURANCA.md antes de instalar."
gh release create "v$VER" --repo "$REPO" --title "Quadro Leve $VER" --notes "$NOTES" \
  "dist/Instalar-QuadroLeve-$VER.exe" dist/QuadroLeve-windows.zip dist/SHA256SUMS.txt LEIA-ME.md SEGURANCA.md
gh release view "v$VER" --repo "$REPO" --json url -q .url

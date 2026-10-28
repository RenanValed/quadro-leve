# Juiz (opus), rodada 1 — 27/10/2026

Nota 6,5/10. Veredito: não empacotar ainda; vira "empacotar com ressalvas" depois das quatro obrigatórias.

## Obrigatórias (bloqueiam o pacote)
1. Fallback silencioso para o IndexedDB quando o Neutralino não responde em 5 s: perde o trabalho (porta aleatória muda a origem) e o X da janela deixa de fechar. Faixa vermelha, timeout de 15 s e porta fixa.
2. Uma falha passageira do disco (Defender/OneDrive) deixa a faixa vermelha para sempre: 3 tentativas com 150 ms e zerar o erro quando um save der certo.
3. Texto em edição se perde ao fechar pelo X: `commitEdit` no `windowClose` e no autosave.
4. Slider de espessura na barra de seleção se recria a cada passo e enche o desfazer: prévia no `input`, comando único no `change`.

## Desejáveis
Aviso de Windows Ink quando a caneta chega como mouse; bloquear Ctrl+roda fora do canvas; `fs` guardado no comando de resize; teto de 16 Mpx na exportação; `.tmp`/`.bak` no `load` e nos recentes; barras normalizadas nos recentes; `dirty` do `saveAs`; clique duplo criando duas notas; mover seleção grande sem regenerar Path2D.

## O que só dá para medir no Windows
Desempenho real no WebView2 do i3 (redesenho de 25 ms no Mac deve dar 60 a 100 ms lá), memória somada dos processos, tempo de save com imagens, caminho com acento, caneta com e sem Windows Ink.

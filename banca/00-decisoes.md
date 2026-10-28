# Banca de 27/10/2026 — Quadro Leve

Rodada de críticos antes da execução. Três agentes em paralelo:
pesquisa (sonnet), avaliador (opus), crítico (opus). Executor: sonnet. Juiz final: opus.

## Notas do avaliador
- Ideia: 8/10. Arquitetura: 7,5/10. Veredito: aprovar com ajustes.

## Decisões tomadas a partir dos pareceres
1. Tudo no canvas, lista única `items[]` ordenada por camada. Nada de DOM para objetos (o crítico mostrou que tinta no canvas + cards no DOM quebra a ordem de camada e a exportação PNG).
2. Dois canvases: estático (cache dos itens confirmados) e vivo (traço em andamento, `desynchronized`). Durante pan e zoom, transform CSS no bitmap; redesenho real só no fim do gesto.
3. Pontos em Float32Array, simplificação RDP ao soltar, contorno com pressão guardado como Path2D com bounding box.
4. Borracha por traço na v1 (vetorial parcial fica para a v1.1; nunca por pixel).
5. Projeto em `.board.json` com `schemaVersion`, ids estáveis, pontos quantizados com delta; gravação atômica (.tmp → .bak → principal), fila serial de saves, recuperação separada do autosave.
6. Autosave só com mudança, 3 s após a última edição, teto de 30 s, nunca durante um traço.
7. Runtime blindado: F5/Ctrl+R/F12 bloqueados (recarregar mata o token nativo), menu de contexto bloqueado, faixa vermelha com "baixar cópia" se a API nativa falhar.
8. Caneta: ponta borracha (`buttons & 32`), botão lateral = pan, hover ignorado, `pointercancel` confirma o traço, detecção de modo mouse (pressão fixa 0,5) com aviso para ligar o Windows Ink.
9. RAM realista: 120 a 200 MB somando os processos do WebView2 (não 40 a 90). Ainda cabe nos 4 GB.
10. Zip de entrega leva o executável, o `resources.neu`, o LEIA-ME e um `.cmd` que instala o WebView2 Runtime se faltar.

## Cortado da v1 (explicitamente)
Laço livre (fica seleção retangular), régua, tinta→forma, conectores que grudam, colaboração, modelos, reações, rotação de objetos.

## Critérios de aceite (do avaliador)
- Quadro de 5.000 traços + 200 notas: pan e zoom com p95 < 22 ms; nenhuma long task > 50 ms durante um traço.
- Memória: até 180 MB vazio, até 300 MB com o quadro de teste.
- Ida e volta salvar/abrir com JSON idêntico; salvar em < 500 ms; matar o processo e reabrir perde no máximo 30 s.

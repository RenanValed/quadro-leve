# Rodada 1.1.0 — 27/10/2026

Pedidos do Renan depois de instalar a 1.0.0: caixa de configurações que mudava de tamanho com a espessura, responsividade em janela estreita, conectores de fluxo entre notas e formas (estilo flowchart), atualização por cima sem tocar nos quadros salvos, código limpo sem redundância (Prettier), e o alerta de antivírus/SmartScreen.

## Feito
- Barra de contexto virou linha própria da grade (fora do palco), com quebra de linha; rótulo de px e slot da caneta com caixa fixa.
- Tipo de item `link` (from/to, cor, espessura, cabeça), ferramenta Conectar (L), âncora na borda da caixa, segue o item, apaga junto, desfaz junto, copia só com as duas pontas. schemaVersion continua 1.
- Instalador: checa app aberto, lê a versão do config, informações de versão no PE, download do WebView2 por `curl.exe` (sem PowerShell), SEGURANCA.txt e SHA256SUMS.txt no pacote.
- Prettier (`.prettierrc`), constantes e helpers unificados, código morto removido (rodada 4 do executor a partir do juiz de código limpo).

## Juiz de código limpo (opus): deixado para depois
Quebrar `buildCtx`, `onKey` e os handlers de ponteiro (acima de 100 linhas); query única na borracha; cache do `selBox`; tirar `lastText` da RAM; serializar uma vez no `doAuto`; âncora do conector na curva da elipse/losango (hoje é a caixa).

## Distribuição
Gmail bloqueia `.exe` mesmo em zip ou com senha; Drive marca binário sem assinatura como malware e trava o link. Caminho: GitHub Releases (`scripts/publicar-release.sh`, não rodado) e, para apagar o aviso de vez, certificado de assinatura de código.

# Rodada 1.2.0 — 27/10/2026 (noite)
Pedidos: responsividade na vertical; tema escuro e fundo só de pontos pelo menu Exibir; fonte, peso e itálico no texto; traço parado 1 s vira reta; modificadores Shift/Alt/Ctrl no padrão de design; abrir projeto por duplo clique (extensão `.quadro`, o Windows só lê a última extensão); níveis de correção do traço (desativada, baixa, média, alta) em Exibir; traço ao vivo igual ao final (mesma função `outline`, filtro de entrada, sem salto ao soltar).
Executor sonnet, 55 casos no cdp-smoke. Porta voltou a 0 para permitir segunda instância pelo Explorer. Ressalvas: caminho Neutralino (NL_ARGS, Neutralino.storage) só por função pura; dica de ferramenta cortada quando a barra lateral rola em janela baixa.

# Quadro Leve

Quadro branco feito para PC fraco: poucas dependências, pouca memória, traço com pressão da mesa digitalizadora. É HTML, CSS e JavaScript puro rodando dentro do Neutralino, e a mesma página abre direto no navegador como prévia.

## Como instalar no Windows

1. Dê dois cliques em **Instalar-QuadroLeve-1.0.0.exe** e siga o assistente (Avançar, Avançar, Instalar).
2. Na primeira vez o Windows pode mostrar a tela azul do SmartScreen. Clique em **Mais informações** e depois em **Executar assim mesmo**. Acontece porque o instalador não tem assinatura digital paga.
3. O Windows pede permissão de administrador (a janela do UAC). Confirme: é preciso para gravar em Arquivos de Programas e instalar o WebView2 para todos os usuários.
4. O instalador confere sozinho se o PC tem o **WebView2 Runtime** da Microsoft (o motor que desenha a tela). No Windows 11 ele já vem; no Windows 10 costuma vir pelo Windows Update. Se faltar, o instalador baixa o pacote oficial da Microsoft (2 MB) e instala em silêncio. Isso precisa de internet nessa única vez.
5. No fim, marque "Abrir o Quadro Leve agora". O atalho fica na área de trabalho e no menu Iniciar. Arquivos `.quadro` abrem com um duplo clique (os antigos `.board.json` também abrem).

O programa pede Windows 10 ou 11 de 64 bits. Nada mais é instalado: o binário usa só bibliotecas do próprio Windows.

**Versão portátil (sem instalar)**: descompacte `QuadroLeve-windows.zip` numa pasta e abra `QuadroLeve.exe`. O `resources.neu` precisa ficar ao lado do `.exe`. Se a janela abrir em branco, rode `instalar-webview2.cmd` uma vez.

**Desinstalar**: Configurações, Aplicativos, Quadro Leve. Os seus quadros em `Documentos\Quadro Leve` ficam no PC.

**No navegador (só para testar)**
Abra `resources/index.html` por um servidor local (ou a prévia publicada). Nesse modo os quadros ficam guardados no próprio navegador.

## Onde ficam os projetos

No Windows, em `Documentos\Quadro Leve\`. Cada quadro novo é um arquivo `nome.quadro`. O formato é o mesmo JSON de antes (só mudou o nome, porque o Windows só olha a última extensão). Quadros antigos `nome.board.json` continuam abrindo e, ao salvar, gravam no mesmo arquivo, sem renomear.
- `nome.quadro.bak` (ou `.board.json.bak`) é a versão anterior, guardada a cada salvamento.
- `_recuperacao\` guarda cópias de segurança do que ainda não foi salvo. Se o app fechar de repente, ao abrir o quadro ele pergunta se você quer recuperar.
- `recentes.json` é a lista da tela inicial.

O salvamento é automático (3 segundos depois da última mudança, no máximo a cada 30 segundos no arquivo principal). Ctrl+S salva na hora. Se o disco falhar, aparece uma faixa vermelha com o botão "Baixar cópia".

## Pressão da caneta (Wacom e XP-Pen)

Para o traço engrossar e afinar com a pressão, o **Windows Ink** precisa estar ligado no driver:
- **Wacom:** Wacom Tablet Properties, aba Mapeamento, marque "Usar Windows Ink".
- **XP-Pen:** Painel do driver, aba da caneta, marque "Windows Ink".

Depois de mudar, feche e abra o Quadro Leve. Se a barra de baixo mostrar "Ligue o Windows Ink no driver da mesa para ter pressão", o app está recebendo pressão fixa e o traço varia só pela velocidade.

Botão lateral da caneta move a tela. A ponta de borracha da caneta apaga. Encostar a palma na mesa com a caneta por perto é ignorado.

## Atalhos

| Tecla | O que faz |
|---|---|
| V / P / H / E | Selecionar, caneta, marca-texto, borracha |
| N / T / S | Nota adesiva, texto, formas |
| L | Conectar: arraste de um item (nota, forma, texto, imagem) até outro para ligar com seta. Apagar um item leva os conectores dele. Em conectores, linhas e setas, os botões Reto, Curva e Cotovelo mudam o trajeto; a bolinha no meio puxa a curva (duplo clique volta ao automático, Shift trava o ângulo) |
| 1, 2, 3 | Troca a caneta. Cor e espessura (1 a 24) ficam na barra de cima; cada uma das três guarda a sua |
| Espaço (segurado) ou botão do meio | Mover a tela |
| Roda | Rola na vertical. Shift+roda rola na horizontal |
| Ctrl+roda | Zoom no ponto do cursor (10% a 800%) |
| Ctrl+0 / Ctrl+1 | Ajustar à tela / 100% |
| Ctrl+Z, Ctrl+Y (ou Ctrl+Shift+Z) | Desfazer, refazer |
| Ctrl+A, Ctrl+D | Selecionar tudo, duplicar |
| Ctrl+C, Ctrl+V | Copiar e colar (cola também imagem copiada de fora) |
| Ctrl+Shift+] e Ctrl+Shift+[ | Trazer para frente, mandar para trás |
| Delete | Apaga a seleção |
| Setas (Shift = 10×) | Move a seleção |
| Esc | Termina a edição ou tira a seleção |
| Ctrl+S / Ctrl+Shift+S | Salvar / Salvar como |
| Ctrl+O / Ctrl+N | Abrir / Novo |
| Ctrl+E | Exportar PNG |

Com a ferramenta Selecionar, clique num item e a barra de cima mostra o que dá para mudar nele: forma (retângulo, elipse, triângulo, losango, linha, seta), contorno, preenchimento, espessura, cor da nota, cor e tamanho do texto. Duplo clique numa nota ou texto edita. Arrastar uma imagem do Explorer para o quadro insere (fotos grandes são reduzidas a 2048 px). Com várias coisas selecionadas, Shift+clique soma ou tira da seleção. Shift ao puxar uma alça de canto mantém a proporção.

## Menu Exibir

- **Tema claro ou escuro.** O escuro muda a interface e o fundo do quadro (preto, com grade ou pontos em cinza). É uma preferência sua, não do quadro: fica gravada no programa. Os itens que já existem não mudam; só a tinta padrão da caneta e do texto passa a ser clara no escuro.
- **Fundo: nenhum, grade ou pontos.** Esse é guardado em cada quadro.
- **Correção do traço: desativada, baixa, média ou alta (padrão: média).** Mexe em duas coisas: o filtro que alisa o traço enquanto você desenha e a regra de "virar reta". O traço salvo é exatamente o que apareceu na tela enquanto você desenhava (nada é simplificado ao soltar). Segurar a caneta parada (1,5 s no baixo, 1 s no médio, 0,6 s no alto) transforma o traço em andamento numa reta até o ponteiro, e ela segue o ponteiro enquanto você não soltar (Shift trava em passos de 15°). Ao soltar, um traço que já era quase reto vira reta de dois pontos (só se tiver pelo menos 40 de comprimento, para não mexer em pontinhos e letras). Desativada: nada disso acontece.

## Texto e notas

Com o texto ou a nota selecionados (ou com a ferramenta Texto), a barra de cima tem a fonte (Sistema, Serifa, Mono, Arredondada, Estreita) e os botões N (negrito) e I (itálico). São fontes que já vêm no Windows; nada é baixado.

## Modificadores

| Tecla | Faz |
|---|---|
| Shift ao puxar alça | Redimensiona mantendo a proporção |
| Alt ao puxar alça | Redimensiona a partir do centro |
| Shift+Alt na alça | Proporcional, a partir do centro |
| Shift ao desenhar forma | Quadrado ou círculo |
| Alt ao desenhar forma | Desenha a partir do centro |
| Shift com linha, seta ou conector | Ângulo travado em passos de 15° |
| Shift ao mover | Trava no eixo horizontal ou vertical |
| Shift+clique | Soma ou tira da seleção |
| Alt+arrastar a seleção | Duplica e move a cópia (um Ctrl+Z desfaz tudo) |
| Ctrl+clique | Seleciona o item que está abaixo do selecionado (percorre a pilha) |
| Ctrl+arrastar | Move só o item sob o cursor, ignorando o grupo selecionado |
| Ctrl+roda ou Alt+roda | Zoom no cursor |

## Teste de estresse

No navegador, abra o console (F12) e rode `__stress(5000, 200)`. Ele cria 5000 traços e 200 notas e devolve o tempo de redesenho. `__bench(10)` mede o redesenho da tela atual.

## Dentro da pasta

- `resources/index.html` e `resources/js/*.js` são o app inteiro.
- `neutralino.config.json` é a configuração (a janela fecha pelo evento `windowClose`, para dar tempo de salvar).
- `tests/roundtrip.mjs` (Node) confere a gravação e leitura do arquivo; `tests/cdp-smoke.mjs` roda um teste no Chrome sem janela.

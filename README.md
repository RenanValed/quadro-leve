# Quadro Leve

Quadro branco para Windows feito para PC fraco: 4 GB de RAM, processador antigo, mesa digitalizadora Wacom ou XP-Pen. Roda 100% local, sem internet e sem conta. Caneta com pressão, marca-texto, notas adesivas, texto com fontes, formas, conectores de fluxo (reto, curva, cotovelo), tema escuro, desfazer ilimitado e projetos salvos em `Documentos\Quadro Leve`.

É HTML, CSS e JavaScript puro, sem framework, empacotado com [Neutralinojs](https://neutralino.js.org) (usa o WebView2 que já vem no Windows, por isso o programa tem 2,5 MB).

## Instalar

Baixe o `Instalar-QuadroLeve-x.y.z.exe` na página de [Releases](../../releases) e siga o [LEIA-ME](LEIA-ME.md). O instalador confere o WebView2 e instala sozinho se faltar. Há também a versão portátil em zip.

O instalador ainda não tem assinatura digital, então o Windows mostra a tela do SmartScreen na primeira vez: "Mais informações" e "Executar assim mesmo". O que o programa faz e não faz está em [SEGURANCA.md](SEGURANCA.md). Os hashes de cada versão ficam no `SHA256SUMS.txt` da Release.

## Rodar no navegador (prévia)

Sirva a pasta `resources` com qualquer servidor estático e abra o `index.html`. Nesse modo os quadros ficam no próprio navegador.

```bash
python3 -m http.server 8765 --directory resources
```

## Desenvolver

```bash
npx @neutralinojs/neu update      # baixa os binários do Neutralino (pasta bin/)
node tests/roundtrip.mjs          # gravação e leitura do formato
node tests/cdp-smoke.mjs          # teste no Chrome sem janela (55 casos)
bash scripts/empacotar.sh         # build, zip portátil e instalador (NSIS)
```

O instalador é gerado no macOS com um `makensis` recompilado (ver `scripts/bin/LEIA-ME-makensis.md`). Em Windows ou Linux, use o `makensis` normal do NSIS 3.

## Pastas

- `resources/` o app inteiro (`index.html` e `js/`)
- `tests/` testes em Node e Chrome headless
- `scripts/` empacotamento, instalador e publicação
- `banca/` pareceres da banca de revisão e decisões de cada versão

Licença MIT.

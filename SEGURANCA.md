# Segurança do Quadro Leve

## O que o programa é
Um quadro branco que roda só no seu computador. É HTML, CSS e JavaScript abertos (a pasta `resources` tem o código inteiro, legível) dentro do Neutralinojs, um empacotador de código aberto (MIT) que usa o WebView2 do próprio Windows para desenhar a janela.

## O que ele faz
- Grava e lê os seus quadros em `Documentos\Quadro Leve` (arquivos `.board.json`, texto puro, abríveis no Bloco de Notas).
- Abre uma porta local (`127.0.0.1:38765`) que só o próprio programa usa para falar com a janela. Ela não aceita conexão de fora da máquina e não sai para a internet.

## O que ele não faz
- Não acessa a internet. Não há nenhuma URL, download ou envio de dados no código.
- Não coleta telemetria, não lê outros arquivos, não instala serviço, não roda ao ligar o Windows, não altera o registro além da própria entrada em "Programas instalados" e da associação do `.board.json`.
- Não pede senha, não pede cartão, não cria conta.

## Por que o Windows avisa
- **SmartScreen ("O Windows protegeu o computador")**: aparece para qualquer programa baixado que não tem assinatura digital de uma empresa e ainda não é conhecido pela Microsoft. É um aviso de reputação, não uma detecção de vírus. Clique em **Mais informações → Executar assim mesmo**.
- **Defender ou outro antivírus (nomes como `Wacapew`, `ML`, `Heur`, `Generic`)**: é heurística sobre o empacotador. Instaladores NSIS e binários Neutralino sem assinatura caem nisso com frequência. Para confirmar que é falso positivo, envie o arquivo em https://www.virustotal.com e veja que os grandes motores não acusam; se acusarem, reporte como falso positivo em https://www.microsoft.com/wdsi/filesubmission.

## O que já foi feito para reduzir os avisos
- O instalador não usa PowerShell nem scripts; só copia arquivos e cria atalhos.
- Se faltar o WebView2 da Microsoft, ele baixa o instalador oficial (`go.microsoft.com`) com o `curl.exe` do próprio Windows, uma vez só, e nada mais.
- O instalador tem informações de versão, nome e fabricante embutidas.
- Cada versão sai com os hashes SHA-256 em `SHA256SUMS.txt`. Confira no PowerShell: `Get-FileHash .\Instalar-QuadroLeve-1.1.0.exe`.

## O que apaga o aviso de vez
Assinatura de código (certificado emitido para a ciarevit). Não é de graça: um certificado OV custa na faixa de US$ 100 a 300 por ano e a reputação no SmartScreen leva algumas semanas; um EV ou o Azure Trusted Signing (cerca de US$ 10 por mês, exige CNPJ verificado) tira o aviso de imediato. Com o certificado, a assinatura entra no mesmo script de empacotamento (`signtool` ou `osslsigncode`).

## Como instalar (Windows 10 ou 11)

1. Baixe o **BTC-Radar-Setup-win-x64.exe** aqui embaixo, na secao **Assets**.
2. Clique duas vezes nele e va em **Avancar**. Nao pede senha de administrador.
3. Abra o **BTC Radar** pelo Menu Iniciar. O painel abre no seu navegador.

### O Windows vai dizer que nao conhece o programa

Vai aparecer uma janela azul, *"O Windows protegeu o seu computador"*. Isso e esperado e
**nao quer dizer que tem virus**: quer dizer que este arquivo nao foi assinado com um
certificado pago e ainda nao foi baixado por gente suficiente para o Windows conhece-lo.

Para continuar: clique em **Mais informacoes** — o link pequeno, logo abaixo do texto — e
depois no botao **Executar assim mesmo**.

Quem quiser conferir que baixou exatamente o arquivo que saiu daqui pode comparar a soma
de verificacao no fim desta pagina, com `Get-FileHash caminho\do\arquivo.exe` no PowerShell.

### Nao quer instalar nada?

Baixe o **BTC-Radar-win-x64-portatil.zip**, descompacte onde quiser (serve pendrive) e
clique no **BTC Radar.exe** de dentro. Nessa versao os dados ficam na propria pasta.

### Onde ficam os seus dados

Em `%LOCALAPPDATA%\BTC Radar\data`. Desinstalar o programa **nao** apaga essa pasta:
historico, snapshots e a chave da IA continuam la, e uma versao nova instalada por cima
encontra tudo no lugar.

### No Linux

Nada disto e necessario — veja o README do projeto.

---

Isto nao e recomendacao de investimento. O painel junta dado publico e mostra de onde cada
numero veio; ele nao preve preco.

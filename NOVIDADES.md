## O que mudou

- **O painel agora se atualiza sozinho.** Quando sai versão nova, aparece um aviso no canto da tela com as novidades e um botão "atualizar agora". Ele baixa o instalador, confere o arquivo contra o SHA-256 que o GitHub publica, instala por cima e o painel volta sozinho em uns 30 segundos. Histórico, snapshots e chave da IA ficam. O número da versão no topo mostra qual você tem — clique nele pra procurar na hora.
- **Inflação na análise do Fed.** CPI cheio, núcleo, núcleo dos últimos 3 meses anualizado e inflação ao produtor (PPI), direto do BLS, com a data do próximo CPI. Aparece na aba Sentimento, abaixo do payroll, e entra na nota do Fed com o mesmo peso do emprego.
- **Abas enxutas.** Saíram "Gráfico" e "Liquidez", que só ampliavam painéis da Visão geral — o gráfico e o livro continuam lá. A barra agora é Visão geral, Sentimento, Técnico, Quem compra, Snapshots e Alertas, com os atalhos 1 a 6 na mesma ordem.
- **Instalador corrigido.** Leva todos os módulos do painel, e instalações novas guardam os dados em `%LOCALAPPDATA%\BTC Radar\data`, como o LEIA-ME sempre disse.

## Como atualizar

- **Quem tem a 1.0.0:** essa versão ainda não sabe se atualizar sozinha. Baixe o `BTC-Radar-Setup` abaixo e instale por cima **uma vez** — seus dados ficam. Daqui pra frente o painel avisa e atualiza sozinho.
- **Linux (git clone):** o painel faz `git pull` e reinicia sozinho quando você clicar em "atualizar agora".
- **Versão portátil (zip):** baixe o zip novo e troque a pasta, mantendo a sua pasta `data`.

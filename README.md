# BTC Radar

Painel local de mercado do bitcoin. Roda na sua maquina, num servidor Node simples,
**sem nenhuma dependencia npm**. As unicas chamadas de rede sao para as APIs publicas das
corretoras e, se voce quiser os resumos em texto, para o Gemini.

![sem dependencias](https://img.shields.io/badge/dependencias-zero-brightgreen) ![node](https://img.shields.io/badge/node-%3E%3D22-blue) ![licenca](https://img.shields.io/badge/licen%C3%A7a-MIT-lightgrey)

## O que ele mostra

| Aba | O que tem dentro |
|---|---|
| **Visao geral** | preco ao vivo, open interest agregado de 4 corretoras, funding, basis, liquidacoes, leitura do mercado em portugues e o detector de **acumulacao x distribuicao** |
| **Grafico** | preco, open interest, long/short e liquidacoes empilhados no mesmo eixo de tempo |
| **Liquidez** | profundidade do livro, maiores muros de ordem e mapa de onde o preco realmente estourou posicoes |
| **Sentimento** | Fear & Greed, analise das noticias de 11 portais e dos documentos do Fed, ultimo payroll do BLS e mercado preditivo (Polymarket, Yahoo, Deribit) |
| **Snapshots** | congela o estado do mercado num instante, com a sua anotacao, pra estudar depois. Nada expira |
| **Tecnico** | EMA, RSI, MACD, Bollinger, ATR e estrutura em 4 tempos graficos, cada indicador com voto visivel |
| **Quem compra** | fluxo dos ETFs a vista (bitcoin, ether, solana), tesouraria de empresas de capital aberto, varejo x contas grandes e o **cabo de guerra** da fita por tamanho de ordem |
| **Alertas** | alertas de preco, funding e liquidacao, com notificacao do navegador |

## Rodando no Linux (Mint, Ubuntu, Debian)

> O pacote `nodejs` que vem no apt do Mint costuma ser a versao 18, velha demais: o painel usa
> `fetch` e `WebSocket` nativos do Node 22. Use o repositorio da NodeSource abaixo.
> O `start.sh` confere a versao e avisa se estiver velha.

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

git clone https://github.com/SEU-USUARIO/btc-radar.git ~/btc-radar
cd ~/btc-radar
chmod +x linux/start.sh
./linux/start.sh
```

Abre sozinho em <http://localhost:8899>. Nao precisa configurar nada antes: a pasta `data/`
e criada no primeiro boot.

Para deixar coletando o tempo todo, mesmo com o navegador fechado:

```bash
cp linux/btc-radar.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now btc-radar
```

Atalho no menu: copie `linux/btc-radar.desktop` para `~/.local/share/applications/`.

## Rodando no Windows

### O jeito facil: o instalador

1. Baixe o **`BTC-Radar-Setup-...-win-x64.exe`** na pagina de
   [Releases](https://github.com/elvistech2/btccockpit/releases).
2. Clique duas vezes e va em **Avancar**. Nao pede senha de administrador e nao instala
   nada mais no computador: o Node vem dentro do proprio instalador.
3. Clique em **BTC Radar** no Menu Iniciar. O painel abre no navegador em
   <http://localhost:8899>.

O Windows costuma mostrar um aviso azul de "SmartScreen" em programa sem certificado pago:
clique em **Mais informacoes** e depois em **Executar assim mesmo**.

O que o instalador coloca no Menu Iniciar:

| Atalho | Pra que serve |
|---|---|
| **BTC Radar** | abre o painel (sobe o servidor sozinho, se preciso) |
| **Parar o BTC Radar** | para o servidor que fica coletando em segundo plano |
| **Pasta de dados do BTC Radar** | abre onde ficam historico, snapshots e a chave da IA |
| **Modo diagnostico (com janela)** | sobe mostrando a mensagem de erro, quando algo nao funciona |

Na tela de instalacao da pra marcar **"Manter o BTC Radar coletando dados desde que o
computador liga"** — util porque a fita de negocios e o historico por minuto so existem
enquanto o servidor esta de pe.

Seus dados ficam em `%LOCALAPPDATA%\BTC Radar\data` e **nao sao apagados** quando voce
desinstala nem quando instala uma versao nova por cima.

### Sem instalar: a versao portatil

Na mesma pagina de Releases tem o **`BTC-Radar-...-win-x64-portatil.zip`**. Descompacte
onde quiser (inclusive num pendrive) e clique em **BTC Radar.exe**. Nessa versao os dados
ficam na pasta `data` ao lado do programa, e nada e escrito fora dela.

### A partir do codigo-fonte

Quem baixou o repositorio (botao verde **Code > Download ZIP**, ou `git clone`) clica duas
vezes em **`Instalar BTC Radar (Windows).cmd`**. Ele confere se voce tem Node 22+, baixa o
oficial da nodejs.org so pra dentro da pasta se nao tiver (conferindo a soma SHA256), cria
os atalhos e abre o painel — tudo dentro do seu usuario, sem administrador.

Para desfazer: **Menu Iniciar > BTC Radar > Desinstalar o BTC Radar**.

Quem prefere a linha de comando continua podendo:

```powershell
git clone https://github.com/elvistech2/btccockpit.git
cd btccockpit
node server.js
```

`node gen-icon.js` regenera o icone.

### Gerando os pacotes voce mesmo

Num Windows com Visual Studio Build Tools (C++) e [Inno Setup 6](https://jrsoftware.org/isdl.php):

```powershell
powershell -ExecutionPolicy Bypass -File windows\build.ps1
```

Sai tudo em `build\saida`. O mesmo script roda na Action `pacote windows`, que anexa os
dois arquivos na Release a cada tag `v*`.

## Atualizacoes

O painel consulta a Release mais nova deste repositorio ao abrir e a cada 6 horas. Quando
tem versao nova, aparece um aviso com as novidades e o botao **atualizar agora**:

- **Windows instalado:** baixa o `BTC-Radar-Setup`, confere o SHA-256 contra o que o GitHub
  publica, fecha o servidor, instala por cima em modo silencioso e sobe o painel de novo.
  Historico, snapshots e chave ficam.
- **Linux com git clone:** `git pull --ff-only` e reinicia o servidor (com systemd, ele sobe sozinho).
- **Versao portatil:** o aviso aparece, mas a troca e manual (o node.exe em uso nao pode ser trocado por ele mesmo).

O numero da versao no topo do painel mostra qual esta instalada; clique nele pra procurar na hora.

**Publicando uma versao:** atualize `version` no `package.json` e o texto de `NOVIDADES.md`,
faca o commit e crie a tag: `git tag v1.2.3 && git push origin v1.2.3`. O GitHub monta o
instalador e o zip e publica a Release sozinho — e os paineis instalados passam a oferecer a atualizacao.

## A chave da inteligencia artificial

So a analise de noticias e a do Fed usam IA. Todo o resto do painel funciona sem chave nenhuma.

**Voce nao precisa editar arquivo na mao**: abra o painel, va na aba **Sentimento** e cole a chave
no campo do topo. O servidor pergunta ao Google se a chave presta antes de gravar, guarda em
`data/config.json` e **nunca devolve ela pro navegador** — a tela so mostra uma mascara tipo `AQ.Ab…v3JA`.

Chave gratuita em <https://aistudio.google.com/apikey>.

`data/config.json`, se quiser editar direto:

```json
{
  "geminiKey": "sua chave",
  "geminiModel": "gemini-3.6-flash",
  "snapshotMin": 0
}
```

`snapshotMin`: 0 significa snapshot so quando voce clicar. Numero maior liga o automatico a cada N minutos.

Se o modelo gratuito estiver lotado (erro 503) ou a cota do dia acabar (429), o servidor desce uma
fila de cinco modelos antes de desistir, e mostra a ultima analise que deu certo marcada como velha.

## Rede e seguranca

O servidor escuta **so em 127.0.0.1**: ninguem na sua rede alcanca o painel, porque ele guarda a chave
da IA e aceita gravar configuracao. Para abrir de proposito (celular, outro computador da casa):

```bash
BTC_RADAR_HOST=0.0.0.0 node server.js
```

A porta tambem muda por variavel: `BTC_RADAR_PORT=9000`. Nao exponha isto na internet aberta.

## De onde vem cada dado

| Dado | Fonte | Precisa de chave? |
|---|---|---|
| Preco, klines, open interest, funding, long/short | Binance, Bybit, OKX, Hyperliquid | nao |
| Liquidacoes executadas | Bybit (WebSocket), OKX, Gate.io | nao |
| Fluxo dos ETFs a vista | SoSoValue | nao |
| Tesouraria de empresas | CoinGecko | nao |
| Medo e ganancia | alternative.me | nao |
| Noticias | RSS de 11 portais de economia e cripto | nao |
| Documentos do Fed | federalreserve.gov | nao |
| Payroll, desemprego, salario | BLS (api.bls.gov) | nao |
| Juros, dolar, Nasdaq, ouro | Yahoo Finance | nao |
| Probabilidade de corte de juro | Polymarket | nao |
| Volatilidade implicita | Deribit | nao |
| Stablecoins | DefiLlama | nao |
| Resumo em texto das analises | Google Gemini | **sim** (gratuita) |

O que precisa de CORS passa pelo proxy do proprio servidor, em `/px/...`, com cache por rota.

## Onde ficam seus dados

Tudo em `data/`, em JSONL (uma linha por registro), e **nada e apagado automaticamente**
(no Windows instalado, essa pasta e `%LOCALAPPDATA%\BTC Radar\data`; a variavel
`BTC_RADAR_DATA` manda em qualquer sistema):

- `history.jsonl` — foto por minuto de open interest, funding e basis
- `liquidations.jsonl` — cada liquidacao capturada
- `snapshots.jsonl` — seus snapshots, com anotacao
- `sentiment.jsonl` — historico das notas de sentimento
- `tape.jsonl` — fita de negocios por faixa de tamanho, balde de 5 minutos
- `tesourarias.jsonl`, `premios.jsonl` — series montadas por coleta propria

`backup.js` copia tudo compactado pra `backups/` no boot e a cada 6 horas, guardando as 14 copias
mais recentes **e a primeira de cada mes pra sempre**.

Nem `data/` nem `backups/` vao pro Git (veja o `.gitignore`) — sao seus dados e sua chave.

## Honestidade sobre os limites

Este painel nao preve preco e nao foi feito pra isso. Ele junta dado publico e mostra de onde cada
numero veio. O que voce precisa saber antes de confiar em qualquer coisa aqui:

- **Os pesos sao julgamento, nao backtest.** O termometro de sentimento (30% medo/ganancia, 25% noticias,
  25% Fed, 20% preditivo), os votos do modulo tecnico e os do detector de acumulacao foram escolhidos
  por bom senso e nunca foram testados contra o historico.
- **A Binance nao entra nas liquidacoes.** O stream de futuros nao entrega mensagem em varias regioes,
  nao existe REST publico e o arquivo diario saiu do ar. Liquidacao aqui e de Bybit, OKX e Gate.
- **Nao existe heatmap de liquidacao de graca.** O painel mostra liquidacao *executada* (real) e niveis
  *estimados* por alavancagem, rotulados como estimativa.
- **A fita so existe a partir do momento em que o servidor sobe.** Ela nao tem passado.
- **Os parsers de RSS e HTML quebram calados** quando o site muda de formato.
- **Isto nao e recomendacao de investimento.**

## Licenca

MIT — veja `LICENSE`.

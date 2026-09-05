# Como subir esta pasta no GitHub

## Antes de tudo: a chave

O arquivo `data/config.json` (o que guarda a chave do Gemini) **nao esta aqui** e nao pode ir.
O `.gitignore` ja bloqueia a pasta `data/` inteira, deixando passar so o exemplo vazio.
Se voce ja usou alguma chave em conversa ou print, gere outra em <https://aistudio.google.com/apikey>
e apague a antiga.

## Pela linha de comando (recomendado)

Dentro desta pasta:

```bash
git init
git add .
git commit -m "BTC Radar: primeiro commit"
git branch -M main
```

Crie o repositorio vazio em <https://github.com/new> — nome `btc-radar`, marque **Private**,
e **nao** marque README, .gitignore nem licenca (ja existem aqui). Depois cole:

```bash
git remote add origin https://github.com/SEU-USUARIO/btc-radar.git
git push -u origin main
```

Na primeira vez ele pede login pelo navegador.

### Se voce for fazer isso do Linux

```bash
sudo apt install -y git
git config --global user.name "Seu Nome"
git config --global user.email "seu@email.com"
```

## Pelo site, sem instalar nada

1. <https://github.com/new>, nome `btc-radar`, **Private**, sem README/gitignore/licenca.
2. Clique em **uploading an existing file**.
3. Arraste os arquivos desta pasta, inclusive a pasta `linux`. Nao arraste `data` nem `backups`.
4. Escreva "primeiro commit" e clique em **Commit changes**.

## Conferindo que nao vazou nada

Na pagina do repositorio nao pode existir nenhum arquivo `.jsonl` nem `data/config.json`.
No terminal, isto lista exatamente o que subiu:

```bash
git ls-files
```

## Atualizando depois de mexer no codigo

```bash
git add .
git commit -m "o que mudou"
git push
```

## Clonando no Linux Mint

```bash
sudo apt update && sudo apt install -y git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

git clone https://github.com/SEU-USUARIO/btc-radar.git ~/btc-radar
cd ~/btc-radar
chmod +x linux/start.sh
./linux/start.sh
```

O painel abre em <http://localhost:8899>. A chave da IA voce cola direto na aba **Sentimento**.
Para deixar rodando sempre, veja a secao de systemd no README.

# Atalho historico: a logica toda mora em windows\iniciar.ps1 (acha o Node, cuida da
# pasta de dados, sobe escondido e abre o navegador). Mantido pra quem ja tinha o
# habito de chamar este arquivo.
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $dir 'windows\iniciar.ps1') @args

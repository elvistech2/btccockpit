; Instalador do BTC Radar para Windows.
; Compila com Inno Setup 6 (ISCC.exe). O build.ps1 ao lado prepara tudo antes:
; baixa o Node, compila o "BTC Radar.exe" e monta a pasta build\app.
;
; Instala no perfil do usuario (sem pedir senha de administrador) e guarda os dados
; em %LOCALAPPDATA%\BTC Radar\data, que sobrevive a desinstalacao e a atualizacoes.

#define Nome     "BTC Radar"
; o build.ps1 passa a versao do package.json em /DVersao=; o valor abaixo e so o padrao
#ifndef Versao
  #define Versao "1.0.0"
#endif
#define Exe      "BTC Radar.exe"
#define Site     "https://github.com/elvistech2/btccockpit"

[Setup]
AppId={{7E4C1B62-9C3F-4A18-9F2A-4B7D5E0A31C4}
AppName={#Nome}
AppVersion={#Versao}
AppVerName={#Nome} {#Versao}
AppPublisher=BTC Radar
AppPublisherURL={#Site}
AppSupportURL={#Site}
AppUpdatesURL={#Site}/releases
DefaultDirName={autopf}\{#Nome}
DefaultGroupName={#Nome}
DisableProgramGroupPage=yes
DisableDirPage=auto
LicenseFile=..\LICENSE
InfoAfterFile=LEIA-ME.txt
OutputDir=..\build\saida
; sem a versao no nome: e o que sustenta o link .../releases/latest/download/...
OutputBaseFilename=BTC-Radar-Setup-win-x64
SetupIconFile=..\icon.ico
UninstallDisplayIcon={app}\{#Exe}
UninstallDisplayName={#Nome}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; Sem administrador: instala em %LOCALAPPDATA%\Programs\BTC Radar.
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
MinVersion=10.0
CloseApplications=no

[Languages]
Name: "brasileiro"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"
Name: "ingles"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "atalhodesktop"; Description: "Criar um atalho na Area de Trabalho"; GroupDescription: "Atalhos:"
Name: "iniciarcomwindows"; Description: "Manter o BTC Radar coletando dados desde que o computador liga"; GroupDescription: "Inicializacao:"; Flags: unchecked

[Files]
Source: "..\build\app\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Dirs]
; A pasta de dados nasce junto com a instalacao pra o atalho dela nunca ficar quebrado.
Name: "{localappdata}\{#Nome}\data"

[Icons]
Name: "{group}\{#Nome}"; Filename: "{app}\{#Exe}"; WorkingDir: "{app}"
Name: "{group}\Parar o {#Nome}"; Filename: "{app}\{#Exe}"; Parameters: "--parar"; WorkingDir: "{app}"; IconIndex: 0
Name: "{group}\Pasta de dados do {#Nome}"; Filename: "{localappdata}\{#Nome}\data"
Name: "{group}\Modo diagnostico (com janela)"; Filename: "{app}\BTC Radar (com janela).cmd"; WorkingDir: "{app}"
Name: "{autodesktop}\{#Nome}"; Filename: "{app}\{#Exe}"; WorkingDir: "{app}"; Tasks: atalhodesktop
Name: "{userstartup}\{#Nome}"; Filename: "{app}\{#Exe}"; Parameters: "--silencioso"; WorkingDir: "{app}"; Tasks: iniciarcomwindows

[Run]
Filename: "{app}\{#Exe}"; Description: "Abrir o {#Nome} agora"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; Para o painel antes de apagar os arquivos; se ja estiver parado, nao faz nada.
Filename: "{app}\{#Exe}"; Parameters: "--parar"; Flags: runhidden skipifdoesntexist; RunOnceId: "PararBtcRadar"

[Code]
// A pasta de dados fica de fora de proposito: historico, snapshots e a chave da IA
// sao da pessoa, nao do programa. O desinstalador so avisa onde ela esta.
procedure CurUninstallStepChanged(CurStep: TUninstallStep);
var
  dados: String;
begin
  if CurStep = usPostUninstall then
  begin
    dados := ExpandConstant('{localappdata}\{#Nome}\data');
    if DirExists(dados) then
      MsgBox('O BTC Radar foi removido.' + #13#10#13#10 +
             'Seus dados (historico, snapshots e a chave da IA) continuam em:' + #13#10 +
             dados + #13#10#13#10 +
             'Apague essa pasta a mao se nao quiser mais guardar nada.',
             mbInformation, MB_OK);
  end;
end;
